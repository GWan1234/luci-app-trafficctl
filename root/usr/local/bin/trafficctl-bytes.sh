#!/bin/sh
# shellcheck shell=dash
# Per-device byte counters from conntrack (for speed calculation).
# Output: JSON array [{"ip":"...","bytes_in":N,"bytes_out":N}]

. /usr/local/bin/trafficctl-fw.sh

LAN_DEV=$(tctl_get_lan_device)
LAN_SUBNET=$(ip -4 addr show dev "$LAN_DEV" 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1 | awk '{print $2}')
LAN_PREFIX=$(echo "$LAN_SUBNET" | cut -d. -f1-3)

[ -z "$LAN_PREFIX" ] && { echo '[]'; exit 0; }

cat /proc/net/nf_conntrack 2>/dev/null | awk -v prefix="$LAN_PREFIX" '
BEGIN { printf "[" }
{
    src=""; dst=""; bytes_in=0; bytes_out=0
    for (i=1; i<=NF; i++) {
        if ($i ~ /^src=/) {
            v = substr($i, 5)
            if (v ~ "^"prefix"\\." && src == "") src = v
        }
        if ($i ~ /^bytes=/) {
            v = substr($i, 7) + 0
            if (src != "" && bytes_in == 0) bytes_in = v
            else if (src != "" && bytes_out == 0) bytes_out = v
        }
    }
    if (src != "" && src ~ "^"prefix"\\.") {
        key = src
        in_total[key] += bytes_out
        out_total[key] += bytes_in
    }
}
END {
    n = 0
    for (ip in in_total) {
        if (n > 0) printf ","
        printf "{\"ip\":\"%s\",\"bytes_in\":%d,\"bytes_out\":%d}", ip, in_total[ip], out_total[ip]
        n++
    }
    printf "]\n"
}
'
