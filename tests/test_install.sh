#!/bin/sh
# Runs INSIDE an OpenWrt rootfs Docker container.
# Usage: sh /tests/test_install.sh /dist/luci-app-trafficctl_*.ipk
set -e

IPK="$1"

mkdir -p /var/lock /tmp/opkg-lists

# Ensure opkg recognises "Architecture: all" packages.
# OpenWrt rootfs images may not list "all" in their arch config, which causes
# opkg to reject the package with "incompatible with the architectures
# configured" even though arch:all is universally installable.
# /etc/opkg/arch.conf is the canonical location since OpenWrt 18.06+; older
# images use /etc/opkg.conf.  We prepend the entry so it takes lowest priority
# (priority 1) without disturbing any existing arch entries.
for f in /etc/opkg/arch.conf /etc/opkg.conf; do
  if [ -f "$f" ]; then
    grep -q "^arch all " "$f" || sed -i "1s|^|arch all 1\n|" "$f"
    break
  fi
done

opkg install --force-depends "$IPK"

for f in \
  /usr/local/bin/trafficctl-summary.sh \
  /usr/local/bin/trafficctl-fw.sh \
  /usr/local/bin/trafficctl-device.sh \
  /usr/local/bin/trafficctl-telegram.sh \
  /usr/local/bin/trafficctl-block.sh \
  /usr/local/bin/trafficctl-unblock.sh \
  /usr/local/bin/trafficctl-ratelimit.sh \
  /usr/local/bin/trafficctl-shape.sh \
  /usr/libexec/rpcd/luci.trafficctl \
  /www/luci-static/resources/view/trafficctl/status.js \
  /usr/share/luci/menu.d/luci-app-trafficctl.json \
  /usr/share/rpcd/acl.d/luci-app-trafficctl.json \
  /etc/config/trafficctl; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
done

for s in /usr/local/bin/trafficctl-*.sh /usr/libexec/rpcd/luci.trafficctl; do
  ash -n "$s" || { echo "SYNTAX ERROR: $s"; exit 1; }
  [ -x "$s" ] || { echo "NOT EXECUTABLE: $s"; exit 1; }
done

echo "All checks passed."
