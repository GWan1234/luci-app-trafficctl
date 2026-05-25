#!/bin/sh
# Show traffic shaping statistics for all shaped devices.
# Output: JSON array [{"ip":"...","rate_kbit":N,"bytes":N,"packets":N,"backlog":N}]

. /usr/local/bin/trafficctl-fw.sh

LAN_DEV=$(tctl_get_lan_device)
SHAPES_FILE="/etc/trafficmon/shapes.json"

# Busybox awk has no strtonum, so provide hex2dec
hex2dec() {
    local hex="$1"
    local dec=0
    local i=0
    local len=${#hex}
    while [ $i -lt $len ]; do
        local c=$(echo "$hex" | cut -c$((i+1)))
        case "$c" in
            [0-9]) dec=$((dec * 16 + c)) ;;
            a|A) dec=$((dec * 16 + 10)) ;;
            b|B) dec=$((dec * 16 + 11)) ;;
            c|C) dec=$((dec * 16 + 12)) ;;
            d|D) dec=$((dec * 16 + 13)) ;;
            e|E) dec=$((dec * 16 + 14)) ;;
            f|F) dec=$((dec * 16 + 15)) ;;
        esac
        i=$((i + 1))
    done
    echo "$dec"
}

# Convert classid minor (hex) back to IP
classid_to_ip() {
    local hex_minor="$1"
    local dec=$(hex2dec "$hex_minor")
    local o3=$((dec / 256))
    local o4=$((dec % 256))
    # We need the network prefix from LAN; assume common /24 or read from shapes.json
    # Get subnet from LAN device
    local subnet
    subnet=$(ip -4 addr show dev "$LAN_DEV" 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1 | awk '{print $2}')
    local prefix
    if [ -n "$subnet" ]; then
        prefix=$(echo "$subnet" | cut -d. -f1-2)
    else
        prefix="192.168"
    fi
    echo "${prefix}.${o3}.${o4}"
}

# Parse rate string to kbit
rate_to_kbit() {
    local rate="$1"
    local num unit
    num=$(echo "$rate" | grep -oE '[0-9]+')
    case "$rate" in
        *Gbit*) echo $((num * 1000000)) ;;
        *Mbit*) echo $((num * 1000)) ;;
        *Kbit*|*kbit*) echo "$num" ;;
        *bit*) echo $((num / 1000)) ;;
        *) echo "$num" ;;
    esac
}

tc -s class show dev "$LAN_DEV" 2>/dev/null | awk -v lan_dev="$LAN_DEV" '
function hex2dec(hex,    i, c, dec, len) {
    dec = 0
    len = length(hex)
    for (i = 1; i <= len; i++) {
        c = substr(hex, i, 1)
        if (c ~ /[0-9]/) dec = dec * 16 + (c + 0)
        else if (c == "a" || c == "A") dec = dec * 16 + 10
        else if (c == "b" || c == "B") dec = dec * 16 + 11
        else if (c == "c" || c == "C") dec = dec * 16 + 12
        else if (c == "d" || c == "D") dec = dec * 16 + 13
        else if (c == "e" || c == "E") dec = dec * 16 + 14
        else if (c == "f" || c == "F") dec = dec * 16 + 15
    }
    return dec
}

function rate_to_kbit(rate,    num) {
    num = rate + 0
    if (rate ~ /Gbit/) return num * 1000000
    if (rate ~ /Mbit/) return num * 1000
    if (rate ~ /[Kk]bit/) return num
    if (rate ~ /bit/) return int(num / 1000)
    return num
}

/^class htb 1:/ {
    # Extract classid
    split($4, parts, ":")
    minor = parts[2]
    # Skip root class 1:1, default 1:fffe
    if (minor == "1" || minor == "fffe") { skip=1; next }
    skip = 0
    classid_hex = minor
    # Get rate
    rate_kbit = 0
    for (i = 1; i <= NF; i++) {
        if ($i == "rate") { rate_kbit = rate_to_kbit($(i+1)); break }
    }
    # Compute IP from classid
    dec_val = hex2dec(classid_hex)
    o3 = int(dec_val / 256)
    o4 = dec_val % 256
    current_ip = ""
    current_rate = rate_kbit
    current_o3 = o3
    current_o4 = o4
}

/Sent [0-9]+ bytes/ && !skip {
    bytes = 0; packets = 0; backlog = 0
    for (i = 1; i <= NF; i++) {
        if ($i == "Sent") bytes = $(i+1)
        if ($i == "bytes") { packets = $(i+1); gsub(/[^0-9]/, "", packets) }
        if ($i == "backlog") { backlog = $(i+1); gsub(/[^0-9]/, "", backlog) }
    }
    # Store for output
    if (current_rate > 0 && current_rate < 1000000) {
        results[n_results] = sprintf("%d %d %d %d %d %d", current_o3, current_o4, current_rate, bytes, packets+0, backlog+0)
        n_results++
    }
}

BEGIN { n_results = 0 }
END {
    printf "["
    for (i = 0; i < n_results; i++) {
        split(results[i], f, " ")
        if (i > 0) printf ","
        printf "{\"ip\":\"_prefix_.%s.%s\",\"rate_kbit\":%s,\"bytes\":%s,\"packets\":%s,\"backlog\":%s}", f[1], f[2], f[3], f[4], f[5], f[6]
    }
    printf "]\n"
}
' | {
    # Replace _prefix_ with actual LAN prefix
    subnet=$(ip -4 addr show dev "$LAN_DEV" 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1 | awk '{print $2}')
    if [ -n "$subnet" ]; then
        prefix=$(echo "$subnet" | cut -d. -f1-2)
    else
        prefix="192.168"
    fi
    sed "s/_prefix_/$prefix/g"
}
