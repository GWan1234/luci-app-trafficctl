#!/bin/sh
# shellcheck shell=dash
# Show traffic shaping statistics for all shaped devices.
# Output: JSON array [{"ip":"...","rate_kbit":N,"bytes":N,"packets":N,"backlog":N}]

. /usr/local/bin/trafficctl-fw.sh

LAN_DEV=$(tctl_get_lan_device)

if ! command -v tc >/dev/null 2>&1; then
    echo '[]'; exit 0
fi

if ! tc qdisc show dev "$LAN_DEV" 2>/dev/null | grep -q "htb 1:"; then
    echo '[]'; exit 0
fi

# Get LAN subnet prefix (first 2 octets)
SUBNET=$(ip -4 addr show dev "$LAN_DEV" 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1 | awk '{print $2}')
if [ -n "$SUBNET" ]; then
    PREFIX=$(echo "$SUBNET" | cut -d. -f1-2)
else
    PREFIX="192.168"
fi

tc -s class show dev "$LAN_DEV" 2>/dev/null | awk -v prefix="$PREFIX" '
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

/class fq_codel/ { skip = 1; next }
/^class htb 1:/ {
    minor = $3
    sub(/^1:/, "", minor)
    if (minor == "1" || minor == "fffe") { skip = 1; next }
    skip = 0
    dec_val = hex2dec(minor)
    current_o3 = int(dec_val / 256)
    current_o4 = dec_val % 256
    current_rate = 0
    for (i = 1; i <= NF; i++) {
        if ($i == "rate") {
            v = $(i+1)
            if (v ~ /Gbit/) { sub(/Gbit/, "", v); current_rate = (v+0) * 1000000 }
            else if (v ~ /Mbit/) { sub(/Mbit/, "", v); current_rate = (v+0) * 1000 }
            else if (v ~ /[Kk]bit/) { sub(/[Kk]bit/, "", v); current_rate = v+0 }
            break
        }
    }
    bytes = 0; pkts = 0; backlog = 0
}
/Sent [0-9]+ bytes/ && !skip {
    for (i = 1; i <= NF; i++) {
        if ($i == "Sent") bytes = $(i+1)
        if ($i ~ /^[0-9]+$/ && $(i+1) == "pkt") pkts = $i
    }
}
/backlog/ && !skip {
    for (i = 1; i <= NF; i++) {
        if ($i == "backlog") {
            v = $(i+1); sub(/b$/, "", v)
            backlog = v + 0
        }
    }
    if (current_rate > 0 && current_rate < 1000000) {
        if (first) printf ","
        printf "{\"ip\":\"%s.%d.%d\",\"rate_kbit\":%d,\"bytes\":%d,\"packets\":%d,\"backlog\":%d}\n", \
            prefix, current_o3, current_o4, current_rate, bytes, pkts, backlog
        first = 1
    }
}
BEGIN { printf "[" }
END   { printf "]\n" }
'
