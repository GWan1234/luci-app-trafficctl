#!/bin/bash
# Tests for trafficctl-macfilter-add.sh / trafficctl-macfilter-remove.sh —
# previously had NO test coverage at all. Fakes uci/hostapd_cli/ubus/ip on
# PATH and runs the real scripts, asserting on the uci list mutations and the
# runtime hostapd ACL calls made.
#
# The key behavior under test: the scripts must respect whichever ACL policy
# ("allow"/whitelist vs "deny"/blacklist) the admin already configured on a
# wifi interface, rather than forcing "deny" — forcing deny would invert a
# curated whitelist (letting in everything it meant to keep out).

PASS=0
FAIL=0

BIN="$(cd "$(dirname "$0")/.." && pwd)/luci-app-trafficctl/root/usr/local/bin"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
MOCKBIN="$TMPDIR/bin"
mkdir -p "$MOCKBIN"

assert_contains() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s' "$haystack" | grep -qF -- "$needle"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        printf "FAIL: %s\n  expected to find: '%s'\n  in:\n%s\n" "$desc" "$needle" "$haystack"
    fi
}

assert_not_contains() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s' "$haystack" | grep -qF -- "$needle"; then
        FAIL=$((FAIL + 1))
        printf "FAIL: %s\n  should NOT contain: '%s'\n" "$desc" "$needle"
    else
        PASS=$((PASS + 1))
    fi
}

ADD_SH="$TMPDIR/macfilter-add.sh"
REMOVE_SH="$TMPDIR/macfilter-remove.sh"
sed "s|/usr/local/bin/trafficctl-fw.sh|$BIN/trafficctl-fw.sh|" "$BIN/trafficctl-macfilter-add.sh" > "$ADD_SH"
sed "s|/usr/local/bin/trafficctl-fw.sh|$BIN/trafficctl-fw.sh|" "$BIN/trafficctl-macfilter-remove.sh" > "$REMOVE_SH"

UCI_LOG="$TMPDIR/uci.log"
HOSTAPD_LOG="$TMPDIR/hostapd.log"
LEASES_FILE="$TMPDIR/dhcp.leases"

cat > "$MOCKBIN/hostapd_cli" <<MOCK
#!/bin/sh
echo "\$*" >> "$HOSTAPD_LOG"
exit 0
MOCK
chmod +x "$MOCKBIN/hostapd_cli"

# tctl_hostapd_block_mac/unblock_mac iterate RUNNING hostapd interfaces via
# `ubus list | grep ^hostapd.`.
cat > "$MOCKBIN/ubus" <<'MOCK'
#!/bin/sh
case "$*" in
    list) echo "hostapd.wifi0" ;;
    *) exit 1 ;;
esac
MOCK
chmod +x "$MOCKBIN/ubus"

cat > "$MOCKBIN/ip" <<'MOCK'
#!/bin/sh
exit 1
MOCK
chmod +x "$MOCKBIN/ip"

# dnsmasq lease format: <expiry> <mac> <ip> <hostname> <clientid>
echo "1787600000 aa:bb:cc:dd:ee:ff 192.168.1.50 device-name *" > "$LEASES_FILE"
sed -i.bak "s|/tmp/dhcp.leases|$LEASES_FILE|g" "$ADD_SH" "$REMOVE_SH"

run_add() { : > "$UCI_LOG"; : > "$HOSTAPD_LOG"; PATH="$MOCKBIN:$PATH" sh "$ADD_SH" "$@" 2>&1; }
run_remove() { : > "$UCI_LOG"; : > "$HOSTAPD_LOG"; PATH="$MOCKBIN:$PATH" sh "$REMOVE_SH" "$@" 2>&1; }

set_uci_single_iface() {
    # $1 = macfilter mode ("deny"/"allow"/""), $2 = existing maclist content
    local mode="$1" maclist="$2"
    cat > "$MOCKBIN/uci" <<MOCK
#!/bin/sh
echo "\$*" >> "$UCI_LOG"
case "\$*" in
    "show wireless") echo "wireless.wifi0=wifi-iface" ;;
    -q\ get\ wireless.wifi0.macfilter) echo "$mode" ;;
    -q\ get\ wireless.wifi0.maclist) echo "$maclist" ;;
    *) exit 1 ;;
esac
exit 0
MOCK
    chmod +x "$MOCKBIN/uci"
}

# ── validation ───────────────────────────────────────────────────────────────

OUT=$(run_add)
assert_contains "add: missing ip rejected" '"ok":false' "$OUT"

OUT=$(run_add 'bad;ip')
assert_contains "add: invalid ip rejected" '"ok":false' "$OUT"

# ── add on a deny/blacklist radio: MAC gets ADDED to the deny list ──────────

set_uci_single_iface "deny" "11:22:33:44:55:66"
OUT=$(run_add 192.168.1.50)
assert_contains "add (deny radio): reports ok" '"ok":true' "$OUT"
assert_contains "add (deny radio): MAC resolved from leases in the response" "aa:bb:cc:dd:ee:ff" "$OUT"
UCI=$(cat "$UCI_LOG")
assert_contains "add (deny radio): MAC added to the blacklist" \
    "add_list wireless.wifi0.maclist=aa:bb:cc:dd:ee:ff" "$UCI"
assert_not_contains "add (deny radio): macfilter mode left untouched (already deny)" \
    "wireless.wifi0.macfilter=" "$UCI"
HOSTAPD=$(cat "$HOSTAPD_LOG")
assert_contains "add (deny radio): deny_acl ADD_MAC issued" "deny_acl ADD_MAC aa:bb:cc:dd:ee:ff" "$HOSTAPD"
assert_contains "add (deny radio): client deauthenticated" "deauthenticate aa:bb:cc:dd:ee:ff" "$HOSTAPD"
assert_not_contains "add (deny radio): never touches accept_acl" "accept_acl" "$HOSTAPD"

# ── add on an unconfigured radio (no macfilter set yet): creates deny mode ──

set_uci_single_iface "" ""
OUT=$(run_add 192.168.1.50)
UCI=$(cat "$UCI_LOG")
assert_contains "add (unconfigured radio): creates deny mode on demand" \
    "wireless.wifi0.macfilter=deny" "$UCI"
assert_contains "add (unconfigured radio): MAC added to the new blacklist" \
    "add_list wireless.wifi0.maclist=aa:bb:cc:dd:ee:ff" "$UCI"

# ── add on an allow/whitelist radio where the target IS listed (i.e. an ──────
# ── allowed device): blocking means DROPPING it from the allow-list, never ──
# ── forcing deny mode (that would invert the whole whitelist). ─────────────

set_uci_single_iface "allow" "aa:bb:cc:dd:ee:ff"
OUT=$(run_add 192.168.1.50)
assert_contains "add (allow radio): reports ok" '"ok":true' "$OUT"
UCI=$(cat "$UCI_LOG")
assert_contains "add (allow radio): MAC dropped from the whitelist" \
    "del_list wireless.wifi0.maclist=aa:bb:cc:dd:ee:ff" "$UCI"
assert_not_contains "add (allow radio): never forces deny mode onto a whitelist radio" \
    "wireless.wifi0.macfilter=deny" "$UCI"
assert_not_contains "add (allow radio): never adds to maclist (that would be wrong on a whitelist)" \
    "add_list wireless.wifi0.maclist" "$UCI"
HOSTAPD=$(cat "$HOSTAPD_LOG")
assert_contains "add (allow radio): accept_acl DEL_MAC issued (not deny_acl)" \
    "accept_acl DEL_MAC aa:bb:cc:dd:ee:ff" "$HOSTAPD"
assert_not_contains "add (allow radio): never issues deny_acl on a whitelist radio" "deny_acl" "$HOSTAPD"

# ── remove: inverse of add on each radio type ───────────────────────────────

set_uci_single_iface "deny" "aa:bb:cc:dd:ee:ff"
OUT=$(run_remove 192.168.1.50)
assert_contains "remove (deny radio): reports ok" '"ok":true' "$OUT"
UCI=$(cat "$UCI_LOG")
assert_contains "remove (deny radio): MAC dropped from the blacklist" \
    "del_list wireless.wifi0.maclist=aa:bb:cc:dd:ee:ff" "$UCI"
HOSTAPD=$(cat "$HOSTAPD_LOG")
assert_contains "remove (deny radio): deny_acl DEL_MAC issued" "deny_acl DEL_MAC aa:bb:cc:dd:ee:ff" "$HOSTAPD"

set_uci_single_iface "allow" "11:22:33:44:55:66"
OUT=$(run_remove 192.168.1.50)
assert_contains "remove (allow radio): reports ok" '"ok":true' "$OUT"
UCI=$(cat "$UCI_LOG")
assert_contains "remove (allow radio): MAC added back to the whitelist" \
    "add_list wireless.wifi0.maclist=aa:bb:cc:dd:ee:ff" "$UCI"
HOSTAPD=$(cat "$HOSTAPD_LOG")
assert_contains "remove (allow radio): accept_acl ADD_MAC issued" "accept_acl ADD_MAC aa:bb:cc:dd:ee:ff" "$HOSTAPD"

OUT=$(run_remove 'bad;ip')
assert_contains "remove: invalid ip rejected" '"ok":false' "$OUT"

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
