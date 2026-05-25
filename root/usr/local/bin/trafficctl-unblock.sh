#!/bin/sh
# Unblock internet access for a device.
# Usage: trafficctl-unblock.sh <ip> [label]

. /usr/local/bin/trafficctl-fw.sh

IP="$1"
LABEL="${2:-block_$IP}"

if [ -z "$IP" ]; then
    echo '{"ok":false,"msg":"usage: trafficctl-unblock.sh <ip> [label]"}'
    exit 1
fi

if ! tctl_validate_ip "$IP"; then
    echo '{"ok":false,"msg":"invalid IP address"}'
    exit 1
fi

COMMENT="tctl_block_${LABEL}"

tctl_block_remove "$IP" "$COMMENT"
if [ $? -eq 0 ]; then
    echo "{\"ok\":true,\"msg\":\"internet unblocked for $IP\"}"
else
    echo "{\"ok\":false,\"msg\":\"failed to unblock $IP\"}"
    exit 1
fi
