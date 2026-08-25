# Changelog

All notable changes to luci-app-trafficctl since v1.0.0.

---

## [Unreleased]

### Security

- **The activity-log path could be pointed at any file.** `log_file` was written to UCI unvalidated and then used both as an append target and as a `tail`+`mv` rotation target, so a caller with the write ACL could read any root-owned file back through `activity_log` (which was in the **read** ACL) or empty one — `max_lines=1` rounded the rotation keep-count to zero. The path is now confined to `/tmp/trafficctl/` or `/var/log/`, `max_lines` to 20–100000, and `activity_log` is a write method.
- **Private signing keys were exposed to a mutable third-party action.** All three workflows passed `APK_PRIVATE_KEY`/`USIGN_PRIVATE_KEY` into `openwrt/gh-action-sdk@main`; the action is now pinned to a commit SHA.
- The Telegram bot token no longer appears in a command line (visible via `ps` to any local account) — the API URL is fed to curl on stdin, and `telegram_test` receives the token through the environment.
- `/etc/config/trafficctl` holds the bot token and the metrics token and is now kept at mode 0600 after every commit, not only after saving Telegram settings.
- `workflow_dispatch` inputs are no longer interpolated into `run:` blocks.

### Bug Fixes

- **Shaping a device could tear down every other device's shape.** The HTB classid was derived from the last two octets of the address, so `192.168.0.1` mapped onto the reserved root class `1:1` and shaping it deleted the root; `x.x.255.254` mapped onto the default class; and addresses from different subnets sharing their last two octets collided. Minors are now allocated and persisted, with pre-upgrade shapes still removable.
- **The shaper destroyed a pre-existing QoS setup.** The first shape unconditionally replaced the root qdisc, wiping an SQM/cake configuration. A root qdisc that is not a recognised default is now left alone and shaping declines instead.
- **Unblocking one device could unblock another.** Rule removal matched the comment as a substring, so `192.168.1.1` also matched `192.168.1.10`; the iptables state check had the same flaw and made `block` report "already blocked" without installing a rule. Comments are now matched in full and addresses as whole fields.
- **Controls created in LuCI could not be removed from the Telegram bot** (and vice versa) while still reporting success: the rule comment was built from the caller's label. Comments are now derived from the target.
- **Paused port ranges were only partly paused.** On the iptables path a range was truncated to its low port — `8000-8100` blocked only 8000 — while the UI showed the whole range as paused. Ranges are now passed as `lo:hi`.
- Concurrent shape writes no longer lose an entry: the lock is an atomic `mkdir` rather than a test-then-create file, and a waiter no longer deletes a lock still held by another writer.
- **Device aliases and shaping rules are no longer lost on a firmware upgrade** — `/etc/trafficctl` is now listed in `/lib/upgrade/keep.d/`, which default sysupgrade otherwise skips.
- Undeclared runtime dependencies (`tc`, `iw`, `hostapd_cli`) are now declared, so shaping and WiFi deauthentication no longer fail silently on a clean install.
- Hotplug scripts now ship executable.
- Frontend: the graph popup and its 2-second timer are removed on view teardown instead of accumulating one per visit; per-device speed history is capped; activity-log lines are rendered as text; SVG gradient IDs are unique per graph; a failed WiFi block no longer leaves the button permanently disabled.
- Releases: a scoped breaking change (`feat(scope)!:`) and a `BREAKING CHANGE:` footer are now detected, `refactor:`/`ci:` bump the patch version as documented, the tag is created after the rebase so it cannot be orphaned, the release is gated on the compatibility matrix, and a known-broken unsigned `.apk` is no longer published.
- **A commit body merely mentioning `BREAKING CHANGE` no longer forces a major release.** The footer search was unanchored, so prose describing the footer counted as one; this branch's own history would have published v2.0.0 from `fix:`/`ci:`/`docs:`/`test:` commits. The footer is now recognised only at the start of a line followed by `:` or ` #`.

### Documentation

- `docs/API.md` documents all 31 rpcd methods (13 were missing) with their ACL level; added `CONTRIBUTING.md`, issue and PR templates.

### Tests

- Tests that redefined local copies of the functions they claimed to check now exercise the real scripts, and the previously untested rpcd backend, block/unblock, macfilter and metrics CGI are covered. Each bug above has a regression test verified to fail against the old behaviour.

---

## [1.13.1] - 2026-08-24

**Full Changelog**: https://github.com/YusDyr/luci-app-trafficctl/compare/v1.13.0...v1.13.1

---

## [1.13.0] — 2026-08-24

### Features

- **Bidirectional rate limiting and shaping** — limits and shapers previously only affected download. Upload is now shaped via an IFB device fed from LAN-side ingress (a `match ip src` filter on the WAN side can't work post-NAT), and partial application is reported honestly instead of silently half-working. ([#27](https://github.com/YusDyr/luci-app-trafficctl/pull/27))
- **Port Forwards tab** — view and manage DNAT rules from the app. ([#27](https://github.com/YusDyr/luci-app-trafficctl/pull/27))
- **Routed-subnet monitoring** and improved device naming. ([#27](https://github.com/YusDyr/luci-app-trafficctl/pull/27))
- **Optional netifyd DPI labels** — per-device application names when the Netify agent is installed. Entirely optional: not a package dependency, and inert when the agent or its socket is absent. ([#27](https://github.com/YusDyr/luci-app-trafficctl/pull/27))
- **Subnet and whole-network limits** — rate-limit an entire subnet or the whole LAN from the UI, either per-device or as an aggregate. ([#27](https://github.com/YusDyr/luci-app-trafficctl/pull/27))
- **Download and upload speed shown separately per device**, each in its own sortable column.
- **Prometheus metrics endpoint** — `/cgi-bin/trafficctl-metrics`, disabled by default, with an optional shared token. ([#27](https://github.com/YusDyr/luci-app-trafficctl/pull/27))

### Bug Fixes

- Per-device speed monitoring no longer stops on kernels where dynamic nftables counter maps are unsupported.
- The custom rate field no longer closes itself a few seconds after being opened.
- Netify telemetry is read from the socket sink rather than the agent API socket, and the sample window now covers the aggregator's report interval.
- Client-controlled device names are escaped in the summary JSON.

Thanks to [@adeelahmad](https://github.com/adeelahmad) for this contribution.

---

## [1.12.1] — 2026-08-24

### Bug Fixes

- **UI controls readable on non-Bootstrap themes** — around 14 declarations bypassed the theme palette with literal colours. Tooltips were painted dark-on-white unconditionally (unreadable once the page went dark), text on accent-filled chips and buttons was hardcoded white (invisible on themes with a pale accent), the toggle knob was always white, and every shadow used a fixed black tuned for light backgrounds. All colour literals now live in the `:root`/dark blocks. ([#30](https://github.com/YusDyr/luci-app-trafficctl/issues/30))

### Internal

- Config is read via `config_load` / `config_get` with defaults instead of repeated `uci -q get` calls — the Telegram bot's `load_config()` alone dropped from 12 forks to 1, and it runs every 60s. Suggested by [@stangri](https://github.com/stangri). ([#29](https://github.com/YusDyr/luci-app-trafficctl/issues/29))

---

## [1.12.0] — 2026-08-24

### Features

- **Back/forward navigates between devices** — selecting a device now pushes a history entry, so mobile back gestures and mouse back buttons work. Option tweaks (columns, filters, intervals) still replace the entry, so the history stack doesn't fill with chip clicks. ([#26](https://github.com/YusDyr/luci-app-trafficctl/issues/26))

---

## [1.11.0] — 2026-08-24

### Features

- **WiFi allow-mode (whitelist) ACLs are supported** — the package now adapts to whichever `macfilter` policy each radio uses, instead of assuming a blacklist. ([#31](https://github.com/YusDyr/luci-app-trafficctl/issues/31))

### Security

- **Blocking a device no longer inverts a whitelist.** Blocking used to force `macfilter=deny` on every wifi-iface. On a router configured with `macfilter=allow`, that silently reinterpreted the administrator's curated allow-list as a block-list — letting in every device the whitelist existed to exclude, and banning every device it listed. The configured policy is now respected and never overwritten: on a deny radio blocking adds the MAC, on an allow radio it removes it.

---

## [1.10.1] — 2026-08-24

### Bug Fixes

- **The device view no longer freezes when a device is selected** — selecting a device stopped all polling, so speed, drop and backlog figures and the connection table stayed frozen until a manual refresh. This also made the per-device speed graph dead code, since the only thing driving it was skipped in that mode. ([#26](https://github.com/YusDyr/luci-app-trafficctl/issues/26))

---

## [1.10.0] — 2026-08-24

### Features

- **Per-device upload speed column** — upload was already being computed from `bytes_out` but never surfaced. ([#32](https://github.com/YusDyr/luci-app-trafficctl/issues/32))

### Bug Fixes

- **Live table updates work again** — six selectors still queried `td[data-…]` even though the tables became `<div class="td">` in the 1.6 LuCI-native conversion, so they matched nothing. Between full table rebuilds the speed, sparkline, drop-counter and backlog cells never refreshed, and clicking a sparkline never opened the speed-graph popup. ([#26](https://github.com/YusDyr/luci-app-trafficctl/issues/26))

---

## [1.9.0] — 2026-08-15

### Features

- **Egress interface per connection** — the connections table can show which WAN a connection actually uses, resolved from the conntrack fwmark via `ip route get <dst> mark <mark>`, so it honours mwan3's policy routing. Only populated where the router restores the connmark; left blank otherwise rather than showing a misleading main-table answer. Optional column, hidden by default. Thanks to [@the-e3n](https://github.com/the-e3n) for the diagnostics. ([#10](https://github.com/YusDyr/luci-app-trafficctl/issues/10))

---

## [1.8.1] — 2026-08-15

### Bug Fixes

- **Telegram bot responds to commands again on OpenWrt 25.12 / APK and snapshot** — newer `jsonfilter` returns an empty string for `jsonfilter -l '@.result'`, which left the update counter empty and made BusyBox ash spam `sh: out of range` while never processing `/start`, `/help`, `/devices` or any inline button. Reported and root-caused by [@lavatti](https://github.com/lavatti). ([#22](https://github.com/YusDyr/luci-app-trafficctl/issues/22))

### CI

- The install and upgrade tests now exercise a real `opkg install` instead of masking its failure with a manual tar extract — they had been validating tar extraction, not opkg.
- The compat matrix is trimmed to x86-64. The other architectures were never actually running: OpenWrt publishes its rootfs container images for `linux/amd64` only, so those jobs failed `docker pull` and green-skipped. Since the package is `Architecture: all`, version coverage is what matters.
- ESLint and ShellCheck now fail on warnings, and ShellCheck actually scans every script (its file list had been silently matching nothing for the init.d, rpcd and hotplug scripts).
- `feature-build.yml` had a YAML error that made it fail on every run; fixed.
- `docker pull` is retried, so a transient ghcr.io blip no longer reds the build.

---

## [1.8.0] — 2026-06-21

### Features

- **Devices on secondary bridges and VLANs are discovered** — device discovery enumerates every interface in the non-WAN firewall zones instead of assuming a single LAN. VPN/tunnel zones are excluded, so WireGuard/AmneziaWG peers aren't mistaken for LAN clients. ([#13](https://github.com/YusDyr/luci-app-trafficctl/issues/13))

---

## [1.7.1] — 2026-06-21

### Performance

- **The dashboard no longer re-scans firewall and conntrack state per device** — the summary rebuilt everything inside the per-device loop, re-reading all of `/proc/net/nf_conntrack` and re-dumping nft chains and tc classes for every client. With many devices that was dozens of heavy forks every few seconds, reported as the UI heavily loading the router. All shared state is now fetched once.
- The Telegram bot scans for new devices periodically rather than on every poll iteration.

### Bug Fixes

- Temp files are removed via EXIT traps, so a script killed mid-run (which is exactly what rpcd does on a loaded router) no longer leaves scratch files filling tmpfs.

---

## [1.7.0] — 2026-06-04

### Features

- **Flow-offload awareness** — the settings panel shows the current offload mode with SW/HW toggles and explains the trade-offs. With hardware offload active the kernel stops syncing byte counts back to conntrack, so speed monitoring reads near zero; the UI now warns about this instead of showing frozen values.
- **Batch reverse DNS** — all uncached addresses are resolved in one `network.rrdns.lookup` round-trip, removing the stuck "resolving…" state.
- **Per-device speed graph** below the extended stats panel.

### Bug Fixes

- Dropped the `bind-dig` dependency: reverse DNS uses the built-in `rpcd-mod-rrdns` with a BusyBox `nslookup` fallback.
- `build-ipk.sh` uses `--format ustar`, preventing macOS PaxHeader entries from corrupting installs on BusyBox tar.

---

## [1.6.6] — 2026-05-29

### Bug Fixes

- **Fix feed-based install** — `./scripts/feeds install -p trafficctl luci-app-trafficctl` was failing with `target pattern contains no '%'` because OpenWrt's `find -L … -mindepth 1` skipped the repository-root Makefile. The repository is now laid out with the package source in a `luci-app-trafficctl/` subdirectory, which is what OpenWrt's feed scanner expects. ([#7](https://github.com/YusDyr/luci-app-trafficctl/issues/7))
- **Fix `/etc/config/trafficctl` clobbering on `opkg --force-reinstall`** — runtime state files (`shapes.json`, `telegram_known.json`) were listed as conffiles, which made opkg refuse to install on a fresh device. Conffiles now contain only `/etc/config/trafficctl`.
- **Stop renaming `/etc/trafficmon/` to `/etc/trafficctl/`** — the previous migration code could collide with other `trafficmon`-named packages on the same router. Postinst no longer touches the old directory; existing installations should migrate manually if needed.

### CI

- New OpenWrt SDK feed-install regression test (3 SDK versions) reproduces the user-facing path that issue #7 was about.
- New upgrade test (×2 SDK versions) installs the previously-released package, marks the config, installs the new build, and asserts the marker survives.
- New dependency test (×3 versions) verifies that missing deps fail cleanly and that `opkg update` / `apk update` resolves them.
- APK signing migrated from RSA to NIST P-256 (EC) keys — matches what `apk-tools v3` actually requires.
- snapshot/x86-64 compat job now tolerates upstream `rpcd-mod-luci` / `rpcd-mod-ucode` post-install hook noise that doesn't affect our package.

### Installation

- Same install commands as v1.5.0+ — see the v1.5.0 entry below.

---

## [1.5.0] — 2026-05-27

### Features

- **Auto-detect software flow offload** ([#5](https://github.com/YusDyr/luci-app-trafficctl/issues/5)) — the realtime monitor now detects whether the router is running OpenWrt's software flow offload and switches its measurement strategy accordingly:
  - **No offload** — conntrack byte counters are accurate; we read them.
  - **Offload active** — conntrack stops accounting for fast-path packets after the flow is offloaded. We instead read an nftables counter map attached at `forward priority -200` (before the offload hook), which captures every packet.
  - The choice is re-evaluated on each refresh, so toggling flow offload in OpenWrt doesn't break the speed graph.

### Installation

- `opkg install` (OpenWrt 21.02 – 24.10):
  ```sh
  opkg install https://github.com/YusDyr/luci-app-trafficctl/releases/latest/download/luci-app-trafficctl.ipk
  ```
- `apk add` (OpenWrt 25.12+):
  ```sh
  apk add --allow-untrusted https://github.com/YusDyr/luci-app-trafficctl/releases/latest/download/luci-app-trafficctl.apk
  ```
- LuCI web UI: **System → Software → Upload Package**.

---

## [1.4.0] — 2026-05-27

### Features

- **APK package format for OpenWrt 25.12+** — releases now ship both `.ipk` (21.02 – 24.10) and `.apk` (25.12+, apk-tools v3) variants. APKs are built via the OpenWrt SDK so the resulting file uses the real APKv3 format (`ADBd` magic), not a fallback APKv2 archive that `apk-tools v3` refuses.
- **Signed packages** — IPKs are signed with usign, APKs with a NIST P-256 EC key. Public keys live in `keys/`. Signatures are verified by `apk add` automatically and by `opkg` when `option check_signature` is set.
- **Telegram bot test infrastructure** — added mock + integration + end-to-end test suites for the Telegram bot under `tests/`. All run on every PR.

### Bug Fixes

- **Don't shadow `awk`'s reserved word `load`** — variable rename in `trafficctl-summary.sh` keeps gawk happy on devices that use it instead of busybox awk.
- Several CI debug-output and portability fixes for the Telegram E2E test runner.

### CI

- **Full compatibility matrix** — 52 combinations spanning OpenWrt 21.02 / 22.03 / 23.05 / 24.10.1 / 24.10.6 / 25.12.0 / 25.12.4 / snapshot × x86-64 / x86-generic / armsr / arm_a9 / arm_a15 / armvirt32 / mips_24kc / aarch64_cortex-a53.
- Releases are now produced only by `feat:` / `fix:` / `perf:` commits — `ci:`, `refactor:`, `docs:` no longer trigger a version bump.
- APK builds via `openwrt/gh-action-sdk` instead of a hand-rolled apk-tools wrapper.

---

## [1.3.0](https://github.com/YusDyr/luci-app-trafficctl/compare/v1.2.1...v1.3.0) (2026-05-26)


### Features

* redesign Telegram Bot settings with mode toggle, live preview, and template variables ([#2](https://github.com/YusDyr/luci-app-trafficctl/issues/2)) ([8d49873](https://github.com/YusDyr/luci-app-trafficctl/commit/8d498737de53db551648f254d005a1ecf0b5d4bc))


### CI

* add release-please for automated changelog and releases ([f1c9834](https://github.com/YusDyr/luci-app-trafficctl/commit/f1c9834b37a19ae091b5c6b993e1309a06c74709))

## [1.2.1] — 2026-05-26

### Bug Fixes

- **Fix broken IPK format** — package was built with Debian `ar` format instead of OpenWrt's gzip-tar format; `opkg` rejected it with `Malformed package file` on all devices ([#1](https://github.com/YusDyr/luci-app-trafficctl/issues/1))
- **Fix rpcd binary path** — binary was installed as `trafficctl` but rpcd expects `luci.trafficctl`
- **Fix ShellCheck SC2086** — unquoted variable in `uci` call in `trafficctl-fw.sh`
- **Fix ESLint no-redeclare** — duplicate `chipActiveStyle` declaration in `status.js`

### CI

- Per-test badges: ShellCheck, ESLint, Tests each have their own status badge
- Release is blocked from publishing if any test fails
- OpenWrt compatibility matrix: tested across 3 versions (21.02, 22.03, snapshot) × 4 architectures (x86-64, aarch64, arm\_a15, armvirt-32)
- All CI jobs moved to GitHub-hosted runners

### Installation

- Install directly on the router without `scp`:
  ```sh
  opkg install https://github.com/YusDyr/luci-app-trafficctl/releases/latest/download/luci-app-trafficctl.ipk
  ```
- Install via LuCI web UI — **System → Software → Upload Package**
- Stable download URLs: [`luci-app-trafficctl.ipk`](https://github.com/YusDyr/luci-app-trafficctl/releases/latest/download/luci-app-trafficctl.ipk), [`luci-app-trafficctl_all.ipk`](https://github.com/YusDyr/luci-app-trafficctl/releases/latest/download/luci-app-trafficctl_all.ipk), [`luci-app-trafficctl_latest_all.ipk`](https://github.com/YusDyr/luci-app-trafficctl/releases/latest/download/luci-app-trafficctl_latest_all.ipk)

---

## [1.2.0] — 2026-05-26

### New Features

- **Interactive speed graph popup** — hover any device's sparkline to see a full-size graph with download + upload dual lines, gradient fill, min/max band, rate limit overlay line, and an interactive crosshair showing precise values at any point in time. History starts from page load and is never lost.
- **Recent devices quick-access bar** — selecting a device (via table click or search) adds it to a chip bar below the search field. Up to 6 recent devices persist across page reloads (localStorage). One-click switching between frequently monitored devices.
- **Activity logging** — all mutable actions (blocks, rate limits, shapes, WiFi denials, config changes) are logged with timestamp, source IP, username, and trigger (LuCI / Telegram / CLI). Logs are viewable in the UI and optionally forwarded to syslog.
- **Reboot persistence for blocks & rate limits** — new `persist_rules` option in Settings. When enabled, internet blocks and rate limits are saved to `/etc/trafficmon/rules.json` and automatically restored on boot alongside traffic shaping rules.
- **New device detection** — instant notification when a new device joins the network. Detects via ARP, DHCP leases, and WiFi station list. DHCP hotplug trigger provides near-realtime alerts. Integrates with Telegram notifications.
- **Per-device column toggles** — show/hide individual table columns (MAC, Speed, Conns, etc.) from the Connections table settings section.
- **Settings panel collapsed by default** — cleaner look on page load; expand on demand.

### Improvements

- **WiFi blocking no longer restarts WiFi** — uses `hostapd_cli deny_acl` + `deauthenticate` to disconnect only the target client. Other WiFi clients stay connected with zero interruption.
- **Speed display in bits (not bytes)** — sparkline and graph values now show Kbit/s and Mbit/s as expected for network speeds. Clean labels: no trailing ".0" for whole numbers (e.g., "10 Mbit/s" not "10.0 Mbit/s").
- **Stable graph scale** — spike filter caps speed at 1 Gbit/s (link ceiling) to discard conntrack counter resets. Y-axis uses 98th percentile scaling so occasional spikes don't crush the useful range.
- **Nice Y-axis values** — graph ticks are multiples of 100 or 500 Kbit/s (or 1/5/10 Mbit/s for faster links) with at least 5 gridlines for readability.
- **Upload speed tracking** — graphs now show both download (solid blue) and upload (dashed green) simultaneously.
- **Compact table headers** — limiter, drop, and queue columns use icon-only headers to save horizontal space.
- **Sort by name** — device table can be sorted alphabetically by hostname.
- **Sparkline rate limit line** — a subtle horizontal line on each sparkline shows the active speed limit for that device.
- **Redesigned speed limit UI** — pill-style chip picker for rate presets + segmented toggle for shaper/limiter mode selection.

### Bug Fixes

- Fixed speed showing in bytes instead of bits.
- Fixed graph popup not showing rate limit line for shaped devices (fallback to summary data).
- Fixed initial page load sometimes showing blank table.
- Fixed WiFi capture disconnecting all clients during screenshot automation.
- Fixed rate limit removal failing to match by IP on some configurations.

---

## [1.1.0] — 2025-05-18

### New Features

- **Telegram bot** — remote control from your phone. Send `/devices` to see active devices with inline keyboard buttons for block, unblock, rate limit, shape, WiFi deny. Long polling — runs entirely on the router, no external server needed.
- **New device notifications** — Telegram alerts when an unknown device joins your network.
- **Bot configuration UI** — token, chat ID, notification toggles, and a "Test" button directly in LuCI Settings.

### Improvements

- CI pipeline with ShellCheck, ESLint, and automated tests.
- CodeQL security scanning enabled.
- System requirements documented (RAM, flash, CPU).

---

## [1.0.0] — 2025-05-10

Initial release.

- Real-time per-device traffic monitoring via conntrack.
- Internet blocking (nftables / iptables auto-detection).
- Rate limiting (nft policer with drop counters).
- Traffic shaping (tc/HTB with fq_codel, persistent across reboots).
- WiFi MAC filtering.
- Interface detection (2.4G / 5G / 6G / LAN port).
- Live speed sparklines with configurable poll interval.
- Reverse DNS lookup for destination IPs.
- Searchable device picker (command palette style).
- Dark / light theme support.
- OpenWrt 21.02–23.05 compatibility.
