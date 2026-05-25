#!/bin/sh
# Summary of all active LAN devices with traffic control status.
# Output: JSON array with per-device info.

. /usr/local/bin/trafficctl-fw.sh

LAN_DEV=$(tctl_get_lan_device)
LAN_SUBNET=$(ip -4 addr show dev "$LAN_DEV" 2>/dev/null | grep -oE 'inet [0-9.]+/[0-9]+' | head -1 | awk '{print $2}')

# Get all active IPs from conntrack
get_active_ips() {
    cat /proc/net/nf_conntrack 2>/dev/null | \
        grep -oE 'src=[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | \
        sed 's/src=//' | sort -u | \
        grep -v '^127\.' | grep -v '^255\.'
}

# Get device name from DHCP leases
get_name() {
    local ip="$1"
    if [ -f /tmp/dhcp.leases ]; then
        awk -v ip="$ip" '$3 == ip {print $4}' /tmp/dhcp.leases | head -1
    fi
}

# Get MAC from DHCP leases or ARP
get_mac() {
    local ip="$1"
    local mac=""
    if [ -f /tmp/dhcp.leases ]; then
        mac=$(awk -v ip="$ip" '$3 == ip {print $2}' /tmp/dhcp.leases | head -1)
    fi
    if [ -z "$mac" ]; then
        mac=$(ip neigh show "$ip" 2>/dev/null | grep -oE '[0-9a-fA-F:]{17}' | head -1)
    fi
    echo "$mac" | tr 'A-F' 'a-f'
}

# Get traffic totals from conntrack
get_traffic() {
    local ip="$1"
    cat /proc/net/nf_conntrack 2>/dev/null | grep "src=$ip " | awk -v ip="$ip" '
    BEGIN { total=0; tcp=0; udp=0 }
    {
        proto=""
        for (i=1; i<=NF; i++) {
            if ($i == "tcp") proto="tcp"
            else if ($i == "udp") proto="udp"
        }
        # Take the first bytes= field after src=<ip> (original direction)
        src_key = "src=" ip
        seen_src=0
        for (i=1; i<=NF; i++) {
            if ($i == src_key) { seen_src=1; continue }
            if (seen_src && index($i, "bytes=") == 1) {
                b = substr($i, 7) + 0
                total += b
                if (proto == "tcp") tcp += b
                else if (proto == "udp") udp += b
                break
            }
        }
    }
    END { printf "%d %d %d", total, tcp, udp }
    '
}

# Check if IP is blocked (firewall)
check_blocked() {
    local ip="$1"
    if tctl_is_blocked "$ip"; then
        echo "1"
    else
        echo "0"
    fi
}

# Get block bytes from nft/iptables counters
get_block_bytes() {
    local ip="$1"
    if [ "$TCTL_FW" = "nft" ]; then
        nft list chain inet fw4 forward 2>/dev/null | grep "ip saddr $ip" | grep -oE 'bytes [0-9]+' | awk '{print $2}' | head -1
    else
        iptables -L FORWARD -nvx 2>/dev/null | grep "DROP" | grep "$ip" | awk '{print $2}' | head -1
    fi
}

# Check if MAC is wifi-blocked (in deny maclist)
check_wifi_blocked() {
    local mac="$1"
    [ -z "$mac" ] && echo "0" && return
    local ifaces=$(tctl_get_wifi_interfaces)
    for iface in $ifaces; do
        local maclist=$(uci -q get "wireless.${iface}.maclist")
        if echo "$maclist" | grep -qi "$mac"; then
            echo "1"
            return
        fi
    done
    echo "0"
}

# Get rate limit for IP
get_rate_limit() {
    local ip="$1"
    if [ "$TCTL_FW" = "nft" ]; then
        nft list table netdev tm_ratelimit 2>/dev/null | grep "daddr $ip" | \
            grep -oE '[0-9]+ kbytes' | awk '{print $1 * 8}'
    else
        iptables -t mangle -L FORWARD -nv 2>/dev/null | grep "rl_ratelimit" | grep "$ip" | \
            grep -oE '[0-9]+kbit' | head -1 | sed 's/kbit//'
    fi
}

# Get shape rate for IP from tc
get_shape_kbit() {
    local ip="$1"
    local o3=$(echo "$ip" | cut -d. -f3)
    local o4=$(echo "$ip" | cut -d. -f4)
    local dec=$((o3 * 256 + o4))
    local hex=$(printf "%x" "$dec")
    local classid="1:$hex"
    tc class show dev "$LAN_DEV" classid "$classid" 2>/dev/null | \
        grep -oE 'rate [0-9]+[A-Za-z]+' | head -1 | awk '{
            rate=$2
            num=rate+0
            if (rate ~ /Gbit/) print num*1000000
            else if (rate ~ /Mbit/) print num*1000
            else if (rate ~ /[Kk]bit/) print num
            else print num
        }'
}

# Filter to only LAN IPs
LAN_PREFIX=$(echo "$LAN_SUBNET" | cut -d. -f1-3)

ACTIVE_IPS=$(get_active_ips | grep "^${LAN_PREFIX}\.")

printf "["
FIRST=1
for ip in $ACTIVE_IPS; do
    NAME=$(get_name "$ip")
    MAC=$(get_mac "$ip")
    TRAFFIC=$(get_traffic "$ip")
    TOTAL=$(echo "$TRAFFIC" | awk '{print $1}')
    TCP=$(echo "$TRAFFIC" | awk '{print $2}')
    UDP=$(echo "$TRAFFIC" | awk '{print $3}')
    BLOCKED=$(check_blocked "$ip")
    BLOCK_BYTES=$(get_block_bytes "$ip")
    [ -z "$BLOCK_BYTES" ] && BLOCK_BYTES=0
    WIFI_BLK=$(check_wifi_blocked "$MAC")
    RATE_LIM=$(get_rate_limit "$ip")
    [ -z "$RATE_LIM" ] && RATE_LIM=0
    SHAPE=$(get_shape_kbit "$ip")
    [ -z "$SHAPE" ] && SHAPE=0
    [ -z "$NAME" ] && NAME="*"

    if [ "$FIRST" = "1" ]; then
        FIRST=0
    else
        printf ","
    fi
    printf '{"ip":"%s","name":"%s","mac":"%s","total":%d,"tcp":%d,"udp":%d,"blocked":%s,"block_bytes":%d,"wifi_blocked":%s,"rate_limit_kbit":%d,"shape_kbit":%d}' \
        "$ip" "$NAME" "$MAC" "$TOTAL" "$TCP" "$UDP" \
        "$([ "$BLOCKED" = "1" ] && echo true || echo false)" \
        "$BLOCK_BYTES" \
        "$([ "$WIFI_BLK" = "1" ] && echo true || echo false)" \
        "$RATE_LIM" "$SHAPE"
done
printf "]\n"
