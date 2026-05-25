#!/bin/sh
# shellcheck shell=dash
# Firewall abstraction layer for trafficctl.
# Detects nft vs iptables and provides unified functions.
# Source this file: . /usr/local/bin/trafficctl-fw.sh

if command -v nft >/dev/null 2>&1 && nft list tables 2>/dev/null | grep -q .; then
    TCTL_FW="nft"
else
    TCTL_FW="iptables"
fi

# ── Rate Limiting (policer) ────────────────────────────────────────────────

tctl_ratelimit_add() {
    local ip="$1" rate_kbit="$2" comment="$3"
    local rate_kbyte=$((rate_kbit / 8))
    [ "$rate_kbyte" -lt 1 ] && rate_kbyte=1

    if [ "$TCTL_FW" = "nft" ]; then
        nft add table netdev tm_ratelimit 2>/dev/null
        local wan_dev
        wan_dev=$(tctl_get_wan_device)
        nft add chain netdev tm_ratelimit dl \
            "{ type filter hook ingress device $wan_dev priority -200; policy accept; }" 2>/dev/null
        nft add rule netdev tm_ratelimit dl \
            "ip daddr $ip limit rate over ${rate_kbyte} kbytes/second counter drop comment \"$comment\""
    else
        iptables -t mangle -A FORWARD -d "$ip" -m hashlimit \
            --hashlimit-above "${rate_kbit}kbit/sec" --hashlimit-burst "${rate_kbit}kbit" \
            --hashlimit-mode dstip --hashlimit-name "rl_${comment}" \
            -j DROP -m comment --comment "$comment" 2>/dev/null
    fi
}

tctl_ratelimit_remove() {
    local ip="$1" comment="$2"

    if [ "$TCTL_FW" = "nft" ]; then
        for h in $(nft -a list chain netdev tm_ratelimit dl 2>/dev/null \
                   | grep "daddr $ip " | grep -o 'handle [0-9]*' | awk '{print $2}'); do
            nft delete rule netdev tm_ratelimit dl handle "$h"
        done
    else
        while iptables -t mangle -D FORWARD -d "$ip" -m comment --comment "$comment" 2>/dev/null; do :; done
    fi
}

tctl_ratelimit_list() {
    if [ "$TCTL_FW" = "nft" ]; then
        nft list table netdev tm_ratelimit 2>/dev/null
    else
        iptables -t mangle -L FORWARD -nv --line-numbers 2>/dev/null | grep "rl_ratelimit"
    fi
}

# ── Internet Blocking ──────────────────────────────────────────────────────

tctl_block_add() {
    local ip="$1" comment="$2"

    if [ "$TCTL_FW" = "nft" ]; then
        nft add rule inet fw4 forward "ip saddr $ip counter drop comment \"$comment\""
    else
        iptables -I FORWARD -s "$ip" -j DROP -m comment --comment "$comment"
    fi
}

tctl_block_remove() {
    local ip="$1" comment="$2"

    if [ "$TCTL_FW" = "nft" ]; then
        for h in $(nft -a list chain inet fw4 forward 2>/dev/null \
                   | grep "$comment" | grep -o 'handle [0-9]*' | awk '{print $2}'); do
            nft delete rule inet fw4 forward handle "$h"
        done
    else
        while iptables -D FORWARD -s "$ip" -m comment --comment "$comment" -j DROP 2>/dev/null; do :; done
    fi
}

tctl_is_blocked() {
    local ip="$1"
    if [ "$TCTL_FW" = "nft" ]; then
        nft list chain inet fw4 forward 2>/dev/null | grep -q "ip saddr $ip .*drop"
    else
        iptables -L FORWARD -n 2>/dev/null | grep -q "DROP.*$ip"
    fi
}

# ── Helpers ────────────────────────────────────────────────────────────────

tctl_get_wan_device() {
    # Detect WAN interface device name
    local dev
    dev=$(uci -q get network.wan.device 2>/dev/null)
    [ -z "$dev" ] && dev=$(uci -q get network.wan.ifname 2>/dev/null)
    [ -z "$dev" ] && dev="wan"
    echo "$dev"
}

tctl_get_lan_device() {
    local dev
    dev=$(uci -q get network.lan.device 2>/dev/null)
    [ -z "$dev" ] && dev=$(uci -q get network.lan.ifname 2>/dev/null)
    [ -z "$dev" ] && dev="br-lan"
    echo "$dev"
}

tctl_validate_ip() {
    echo "$1" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' || return 1
    local IFS='.'; set -- $1
    [ "$1" -le 255 ] && [ "$2" -le 255 ] && [ "$3" -le 255 ] && [ "$4" -le 255 ] 2>/dev/null
}

tctl_get_wifi_interfaces() {
    # Returns all WiFi interface names (radio0, radio1, etc.)
    uci show wireless 2>/dev/null | grep '=wifi-iface' | cut -d. -f2 | cut -d= -f1
}
