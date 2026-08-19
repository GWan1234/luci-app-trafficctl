#!/bin/sh
# shellcheck shell=dash
# Traffic shaping (tc/HTB) for per-device bandwidth control.
# Usage: trafficctl-shape.sh <add|remove|status> <ip> [rate_kbit] [label]

. /usr/local/bin/trafficctl-fw.sh

SHAPES_FILE="/etc/trafficctl/shapes.json"
LAN_DEV=$(tctl_get_lan_device)
# Upload is shaped on the WAN device's egress — the only place LAN->WAN
# traffic can be queued. Shaping the LAN device alone (as this did originally)
# only ever touches the download direction.
WAN_DEV=$(tctl_get_wan_device)

ACTION="$1"
IP="$2"
RATE="$3"
# shellcheck disable=SC2034
LABEL="${4:-shape_$IP}"

# Convert IP to classid: 1:<hex of 3rd*256+4th octet>
ip_to_classid() {
    local ip="$1"
    local o3 o4 dec hex
    o3=$(echo "$ip" | cut -d. -f3)
    o4=$(echo "$ip" | cut -d. -f4)
    dec=$((o3 * 256 + o4))
    hex=$(printf "%x" "$dec")
    echo "1:$hex"
}

ensure_root_qdisc() {
    local dev="${1:-$LAN_DEV}"
    # Set up root HTB hierarchy if not present
    tc class show dev "$dev" 2>/dev/null | grep -q "class htb 1:1 " && return 0
    tc qdisc del dev "$dev" root 2>/dev/null
    tc qdisc add dev "$dev" root handle 1: htb default fffe r2q 10
    tc class add dev "$dev" parent 1: classid 1:1 htb rate 1000mbit ceil 1000mbit burst 125000b cburst 125000b
    tc class add dev "$dev" parent 1:1 classid 1:fffe htb rate 1000mbit ceil 1000mbit burst 125000b cburst 125000b prio 0
    tc qdisc add dev "$dev" parent 1:fffe fq_codel 2>/dev/null
}

# Attach one shaping class on a device, matching the given IP in the given
# direction ("dst" on the LAN side for download, "src" on the WAN side for
# upload).
shape_attach() {
    local dev="$1" match="$2" ip="$3" classid="$4" rate="$5" burst="$6"

    tc filter del dev "$dev" parent 1:0 prio 10 protocol ip u32 match ip "$match" "$ip"/32 2>/dev/null
    tc qdisc del dev "$dev" parent "$classid" 2>/dev/null
    tc class del dev "$dev" classid "$classid" 2>/dev/null

    ensure_root_qdisc "$dev" || return 1
    tc class add dev "$dev" parent 1:1 classid "$classid" htb \
        rate "${rate}kbit" ceil "${rate}kbit" burst "${burst}b" cburst "${burst}b" 2>&1 || return 1
    tc qdisc add dev "$dev" parent "$classid" fq_codel 2>/dev/null
    tc filter add dev "$dev" parent 1:0 prio 10 protocol ip u32 \
        match ip "$match" "$ip"/32 flowid "$classid" 2>&1 || return 1
}

shape_detach() {
    local dev="$1" match="$2" ip="$3" classid="$4"
    tc filter del dev "$dev" parent 1:0 prio 10 protocol ip u32 match ip "$match" "$ip"/32 2>/dev/null
    tc qdisc del dev "$dev" parent "$classid" 2>/dev/null
    tc class del dev "$dev" classid "$classid" 2>/dev/null
}

save_shape() {
    local ip="$1" rate="$2"
    mkdir -p "$(dirname "$SHAPES_FILE")"
    [ ! -f "$SHAPES_FILE" ] && echo "[]" > "$SHAPES_FILE"

    local lockf="/tmp/trafficctl_shapes.lock"
    local tmpf="/tmp/shapes_rebuild.$$"
    # shellcheck disable=SC2064
    trap "rm -f '$tmpf' '$lockf'" EXIT

    # Simple file lock (wait up to 5 seconds)
    local tries=0
    while [ -f "$lockf" ] && [ "$tries" -lt 50 ]; do
        tries=$((tries + 1))
        sleep 0.1 2>/dev/null || sleep 1
    done
    echo $$ > "$lockf"

    # Portable: extract entries with grep, filter, rebuild JSON
    local old_entries
    old_entries=$(grep -oE '\{"ip":"[^"]+","rate_kbit":[0-9]+\}' "$SHAPES_FILE" 2>/dev/null || true)
    local filtered
    filtered=$(echo "$old_entries" | grep -v "\"ip\":\"$ip\"" || true)
    if [ "$rate" -gt 0 ] 2>/dev/null; then
        if [ -n "$filtered" ]; then
            filtered=$(printf "%s\n%s" "$filtered" "{\"ip\":\"$ip\",\"rate_kbit\":$rate}")
        else
            filtered="{\"ip\":\"$ip\",\"rate_kbit\":$rate}"
        fi
    fi
    printf "[" > "$tmpf"
    echo "$filtered" | awk 'NF{if(n++)printf ",";printf "%s",$0}' >> "$tmpf"
    printf "]" >> "$tmpf"

    mv "$tmpf" "$SHAPES_FILE"
    rm -f "$lockf"
}

remove_shape() {
    local ip="$1"
    save_shape "$ip" "0"
}

do_add() {
    local classid
    classid=$(ip_to_classid "$IP")

    # Calculate burst: 10ms of data, minimum 1600 bytes
    local burst_bytes
    burst_bytes=$(( RATE * 125 / 100 ))
    [ "$burst_bytes" -lt 1600 ] && burst_bytes=1600

    # Download: queue on the LAN device, matching traffic destined to the client.
    if ! shape_attach "$LAN_DEV" dst "$IP" "$classid" "$RATE" "$burst_bytes"; then
        echo "{\"ok\":false,\"msg\":\"tc setup failed for $IP on $LAN_DEV\"}"
        return 1
    fi

    # Upload: queue on the WAN device, matching traffic sourced from the client.
    # Reported separately so a WAN-side failure doesn't look like a total failure.
    local ul_ok=1
    if [ -n "$WAN_DEV" ] && [ -d "/sys/class/net/$WAN_DEV" ]; then
        shape_attach "$WAN_DEV" src "$IP" "$classid" "$RATE" "$burst_bytes" || ul_ok=0
    else
        ul_ok=0
    fi

    save_shape "$IP" "$RATE"
    if [ "$ul_ok" = "1" ]; then
        echo "{\"ok\":true,\"msg\":\"shape ${RATE} kbit/s applied to $IP both directions (class $classid)\"}"
    else
        echo "{\"ok\":true,\"msg\":\"shape ${RATE} kbit/s applied to $IP (download only — WAN device $WAN_DEV unavailable)\"}"
    fi
}

do_remove() {
    local classid
    classid=$(ip_to_classid "$IP")

    shape_detach "$LAN_DEV" dst "$IP" "$classid"
    [ -n "$WAN_DEV" ] && shape_detach "$WAN_DEV" src "$IP" "$classid"

    remove_shape "$IP"
    echo "{\"ok\":true,\"msg\":\"shape removed for $IP\"}"
}

do_status() {
    local classid
    classid=$(ip_to_classid "$IP")
    local info
    info=$(tc -s class show dev "$LAN_DEV" classid "$classid" 2>/dev/null)
    if [ -n "$info" ]; then
        local rate_val
        rate_val=$(echo "$info" | grep -oE 'rate [0-9]+[a-zA-Z]+' | head -1 | awk '{print $2}')
        echo "{\"ok\":true,\"ip\":\"$IP\",\"classid\":\"$classid\",\"info\":\"$rate_val\"}"
    else
        echo "{\"ok\":true,\"ip\":\"$IP\",\"classid\":\"$classid\",\"info\":\"no shape active\"}"
    fi
}

# Main
case "$ACTION" in
    add)
        if [ -z "$IP" ] || [ -z "$RATE" ]; then
            echo '{"ok":false,"msg":"usage: trafficctl-shape.sh add <ip> <rate_kbit> [label]"}'
            exit 1
        fi
        if ! tctl_validate_ip "$IP"; then
            echo '{"ok":false,"msg":"invalid IP address"}'
            exit 1
        fi
        do_add
        ;;
    remove)
        if [ -z "$IP" ]; then
            echo '{"ok":false,"msg":"usage: trafficctl-shape.sh remove <ip>"}'
            exit 1
        fi
        if ! tctl_validate_ip "$IP"; then
            echo '{"ok":false,"msg":"invalid IP address"}'
            exit 1
        fi
        do_remove
        ;;
    status)
        if [ -z "$IP" ]; then
            echo '{"ok":false,"msg":"usage: trafficctl-shape.sh status <ip>"}'
            exit 1
        fi
        if ! tctl_validate_ip "$IP"; then
            echo '{"ok":false,"msg":"invalid IP address"}'
            exit 1
        fi
        do_status
        ;;
    *)
        echo '{"ok":false,"msg":"usage: trafficctl-shape.sh <add|remove|status> <ip> [rate_kbit] [label]"}'
        exit 1
        ;;
esac
