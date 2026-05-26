#!/bin/sh
# Runs INSIDE an OpenWrt rootfs Docker container.
# Usage: sh /tests/test_install.sh /dist/luci-app-trafficctl_*.ipk
set -e

IPK="$1"

mkdir -p /var/lock /tmp/opkg-lists

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
