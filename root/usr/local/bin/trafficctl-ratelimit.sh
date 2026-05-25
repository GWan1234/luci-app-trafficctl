#!/bin/sh
# Rate-limit a device's download bandwidth (policer).
# Usage: trafficctl-ratelimit.sh <ip> <rate_kbit> [label]
# rate_kbit=0 removes the limit.

. /usr/local/bin/trafficctl-fw.sh

IP="$1"
RATE="$2"
LABEL="${3:-rl_$IP}"

if [ -z "$IP" ] || [ -z "$RATE" ]; then
    echo '{"ok":false,"msg":"usage: trafficctl-ratelimit.sh <ip> <rate_kbit> [label]"}'
    exit 1
fi

if ! tctl_validate_ip "$IP"; then
    echo '{"ok":false,"msg":"invalid IP address"}'
    exit 1
fi

COMMENT="rl_ratelimit_${LABEL}"

if [ "$RATE" = "0" ]; then
    tctl_ratelimit_remove "$IP" "$COMMENT"
    if [ $? -eq 0 ]; then
        echo "{\"ok\":true,\"msg\":\"rate limit removed for $IP\"}"
    else
        echo "{\"ok\":false,\"msg\":\"failed to remove rate limit for $IP\"}"
        exit 1
    fi
else
    # Remove any existing limit first
    tctl_ratelimit_remove "$IP" "$COMMENT" 2>/dev/null
    tctl_ratelimit_add "$IP" "$RATE" "$COMMENT"
    if [ $? -eq 0 ]; then
        echo "{\"ok\":true,\"msg\":\"rate limit set to ${RATE} kbit/s for $IP\"}"
    else
        echo "{\"ok\":false,\"msg\":\"failed to set rate limit for $IP\"}"
        exit 1
    fi
fi
