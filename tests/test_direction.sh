#!/bin/bash
# Regression tests: rate limiting and shaping must apply to BOTH directions.
#
# The original implementations only ever touched download (nft matched
# "ip daddr" at WAN ingress; tc built an HTB tree on the LAN device only), so a
# limited device still uploaded at full line rate. These assert the upload half
# exists and is removed again.

PASS=0
FAIL=0

BIN="$(cd "$(dirname "$0")/.." && pwd)/luci-app-trafficctl/root/usr/local/bin"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
MOCKBIN="$TMPDIR/bin"
mkdir -p "$MOCKBIN"
NFT_LOG="$TMPDIR/nft.log"
TC_LOG="$TMPDIR/tc.log"

assert_contains() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s' "$haystack" | grep -qF -- "$needle"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        printf "FAIL: %s\n  expected to find: '%s'\n  in:\n%s\n" "$desc" "$needle" "$haystack"
    fi
}

# ── mocks ────────────────────────────────────────────────────────────────────
cat > "$MOCKBIN/uci" <<'MOCK'
#!/bin/sh
case "$3" in
    network.wan.device) echo "eth1" ;;
    network.lan.device) echo "br-lan" ;;
    # Patterns quoted: [0] is a glob character class otherwise, so these
    # would never match the literal uci key.
    "firewall.@zone[0].name") echo "lan" ;;
    "firewall.@zone[0].network") echo "lan" ;;
    *) exit 1 ;;
esac
MOCK

cat > "$MOCKBIN/ubus" <<'MOCK'
#!/bin/sh
echo '{"l3_device":"br-lan","ipv4-address":[{"address":"192.168.1.1","mask":24}]}'
MOCK

cat > "$MOCKBIN/jsonfilter" <<'MOCK'
#!/bin/sh
input=$(cat)
case "$2" in
    '@.l3_device') echo "br-lan" ;;
    '@["ipv4-address"][0].address') echo "192.168.1.1" ;;
    '@["ipv4-address"][0].mask') echo "24" ;;
esac
MOCK

IP_LOG="$TMPDIR/ip.log"
cat > "$MOCKBIN/ip" <<MOCK
#!/bin/sh
echo "\$*" >> "$IP_LOG"
case "\$*" in
    "link show tctl-ifb0") exit 1 ;;   # not created yet
esac
exit 0
MOCK

cat > "$MOCKBIN/nft" <<MOCK
#!/bin/sh
echo "\$*" >> "$NFT_LOG"
case "\$*" in
    "list tables") echo "table inet fw4" ;;
esac
exit 0
MOCK

cat > "$MOCKBIN/tc" <<MOCK
#!/bin/sh
echo "\$*" >> "$TC_LOG"
case "\$*" in
    "class show dev tctl-ifb0") echo "class htb 1:1 root rate 1000Mbit" ;;
    *"class show"*) exit 0 ;;
esac
exit 0
MOCK

chmod +x "$MOCKBIN"/*

# tc needs the WAN device to look present
mkdir -p "$TMPDIR/sys/class/net/eth1"

# br-lan is a bridge with two physical ports. Ingress hooks must land on the
# PORTS: a netdev ingress hook bound to the bridge itself never sees bridged
# traffic, which is how upload limiting silently did nothing.
mkdir -p "$TMPDIR/sys/class/net/br-lan/brif/lan1" \
         "$TMPDIR/sys/class/net/br-lan/brif/lan2"
export TCTL_SYSFS_NET="$TMPDIR/sys/class/net"

# ── limiter: both directions ─────────────────────────────────────────────────
: > "$NFT_LOG"
PATH="$MOCKBIN:$PATH" sh -c ". $BIN/trafficctl-fw.sh; tctl_ratelimit_add 192.168.1.50 5000 rl_test" >/dev/null 2>&1
NFT=$(cat "$NFT_LOG")

assert_contains "limiter: download chain hooked on WAN ingress" \
    "add chain netdev tm_ratelimit dl { type filter hook ingress device eth1" "$NFT"
assert_contains "limiter: download rule matches daddr" \
    "add rule netdev tm_ratelimit dl ip daddr 192.168.1.50 limit rate over 625 kbytes/second" "$NFT"

assert_contains "limiter: upload chain on first bridge port" \
    "add chain netdev tm_ratelimit ul_lan1 { type filter hook ingress device lan1 priority -200" "$NFT"
assert_contains "limiter: upload chain on second bridge port" \
    "add chain netdev tm_ratelimit ul_lan2 { type filter hook ingress device lan2 priority -200" "$NFT"
assert_contains "limiter: upload rule matches saddr on port chain" \
    "add rule netdev tm_ratelimit ul_lan1 ip saddr 192.168.1.50 limit rate over 625 kbytes/second" "$NFT"

# The regression itself: hooking the bridge matches nothing.
if printf '%s' "$NFT" | grep -q "hook ingress device br-lan"; then
    FAIL=$((FAIL + 1))
    printf "FAIL: limiter: ingress hook bound to the bridge instead of its ports\n"
else
    PASS=$((PASS + 1))
fi

# ── limiter: removal clears both ─────────────────────────────────────────────
: > "$NFT_LOG"
PATH="$MOCKBIN:$PATH" sh -c ". $BIN/trafficctl-fw.sh; tctl_ratelimit_remove 192.168.1.50 rl_test" >/dev/null 2>&1
NFT=$(cat "$NFT_LOG")
assert_contains "limiter: removal scans the whole table" "list table netdev tm_ratelimit" "$NFT"

# ── shaper: both directions ──────────────────────────────────────────────────
: > "$TC_LOG"
SHAPE="$TMPDIR/shape.sh"
sed -e "s|/usr/local/bin/trafficctl-fw.sh|$BIN/trafficctl-fw.sh|" \
    -e "s|SHAPES_FILE=\"/etc/trafficctl/shapes.json\"|SHAPES_FILE=\"$TMPDIR/shapes.json\"|" \
    -e "s|/sys/class/net/|$TMPDIR/sys/class/net/|g" \
    "$BIN/trafficctl-shape.sh" > "$SHAPE"
OUT=$(PATH="$MOCKBIN:$PATH" sh "$SHAPE" add 192.168.1.50 5000 2>&1)
TC=$(cat "$TC_LOG")

assert_contains "shaper: add reports success" '"ok":true' "$OUT"
assert_contains "shaper: says both directions" 'both directions' "$OUT"

# 192.168.1.50 -> o3=1, o4=50 -> 1*256+50 = 306 -> 0x132
assert_contains "shaper: download class on LAN device" \
    "class add dev br-lan parent 1:1 classid 1:132 htb rate 5000kbit" "$TC"
assert_contains "shaper: download filter matches dst" \
    "filter add dev br-lan parent 1:0 prio 10 protocol ip u32 match ip dst 192.168.1.50/32" "$TC"

# Upload must be shaped PRE-NAT on an IFB fed from LAN ingress. At WAN egress
# the source is already masqueraded to the router's WAN address, so a per-client
# src filter there would match nothing.
assert_contains "shaper: upload class on the IFB device" \
    "class add dev tctl-ifb0 parent 1:1 classid 1:132 htb rate 5000kbit" "$TC"
assert_contains "shaper: upload filter matches src on IFB" \
    "filter add dev tctl-ifb0 parent 1:0 prio 10 protocol ip u32 match ip src 192.168.1.50/32" "$TC"

IPL=$(cat "$IP_LOG")
assert_contains "shaper: IFB device created" "link add name tctl-ifb0 type ifb" "$IPL"
assert_contains "shaper: IFB device brought up" "link set tctl-ifb0 up" "$IPL"

assert_contains "shaper: ingress qdisc on first bridge port" \
    "qdisc add dev lan1 handle ffff: ingress" "$TC"
assert_contains "shaper: ingress mirrored into the IFB" \
    "action mirred egress redirect dev tctl-ifb0" "$TC"

if printf '%s' "$TC" | grep -q "filter add dev eth1 .*match ip src"; then
    FAIL=$((FAIL + 1))
    printf "FAIL: shaper: upload filtered on WAN egress, where NAT has already rewritten the source\n"
else
    PASS=$((PASS + 1))
fi

# ── shaper: removal clears both ──────────────────────────────────────────────
: > "$TC_LOG"
PATH="$MOCKBIN:$PATH" sh "$SHAPE" remove 192.168.1.50 >/dev/null 2>&1
TC=$(cat "$TC_LOG")
assert_contains "shaper: removes LAN class" "class del dev br-lan classid 1:132" "$TC"
assert_contains "shaper: removes IFB class" "class del dev tctl-ifb0 classid 1:132" "$TC"
assert_contains "shaper: removes upload filter" \
    "filter del dev tctl-ifb0 parent 1:0 prio 10 protocol ip u32 match ip src 192.168.1.50/32" "$TC"

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
