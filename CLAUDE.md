# CLAUDE.md

## Project

luci-app-trafficctl — OpenWrt LuCI plugin for real-time traffic monitoring and per-device control (block, rate-limit, shape, WiFi deny).

## Target Platform

- OpenWrt 23.x (kernel 5.15+)
- Router: 192.168.0.1, shell is **fish** (use `ssh root@192.168.0.1 sh -c '"command"'` or pipe via stdin)
- Firewall: fw4 / nftables (with iptables fallback detection)
- Shell scripts: POSIX sh / dash (NOT bash) — no arrays, no `[[`, no `<<<`
- BusyBox utilities (limited awk, no gawk features like match() with arrays)

## Directory Structure

```
htdocs/luci-static/resources/view/trafficctl/
  status.js              — Main frontend (single-file LuCI view)

root/usr/local/bin/
  trafficctl-fw.sh       — Shared library (fw detection, validation helpers)
  trafficctl-summary.sh  — All devices summary (JSON array)
  trafficctl-device.sh   — Per-device detail + connections
  trafficctl-block.sh    — Block internet (nft/iptables)
  trafficctl-unblock.sh  — Unblock internet
  trafficctl-macfilter-add.sh    — WiFi MAC deny
  trafficctl-macfilter-remove.sh — WiFi MAC allow
  trafficctl-ratelimit.sh        — nft policing (drop-based)
  trafficctl-ratelimit-stats.sh  — Limiter counters
  trafficctl-shape.sh            — tc/HTB shaping (queue-based)
  trafficctl-shape-stats.sh      — Shaper counters
  trafficctl-bytes.sh            — Per-device byte counters
  trafficctl-rdns.sh             — Reverse DNS lookup

root/usr/libexec/rpcd/
  trafficctl             — rpcd/ubus backend (JSON object output, not arrays)
```

## JavaScript Conventions

- **ES5 only** — no `let`, `const`, arrow functions, template literals, destructuring
- `var` everywhere, `function` keyword only
- LuCI globals available: `E()`, `_()`, `L`, `view`, `rpc`, `dom`, `ui`, `form`, `fs`
- `rpc.declare()` for ubus calls
- ESLint config: `.eslintrc.json` (no-var: off, prefer-const: off)
- Run `node --check status.js` for syntax validation

## Shell Script Conventions

- Shebang: `#!/bin/sh`
- All scripts output JSON to stdout
- rpcd scripts (`root/usr/libexec/rpcd/trafficctl`) must output JSON **objects** (not bare arrays) — wrap with `{"result": ...}`
- Validate IPs with `tctl_validate_ip` from trafficctl-fw.sh
- Use `2>/dev/null` on commands that may fail (nft, tc, iptables)
- Filter `dig` output: `grep -v '^;;'` to remove error messages

## Deployment

scp does NOT work to the router. Deploy files like this:

```sh
ssh root@192.168.0.1 sh -c '"cat > /path/to/file"' < local/file
# For scripts, also chmod:
ssh root@192.168.0.1 sh -c '"cat > /usr/local/bin/script.sh && chmod +x /usr/local/bin/script.sh"' < root/usr/local/bin/script.sh
# Frontend:
ssh root@192.168.0.1 sh -c '"cat > /www/luci-static/resources/view/trafficctl/status.js"' < htdocs/luci-static/resources/view/trafficctl/status.js
```

## Key Technical Details

- Traffic data comes from `/proc/net/nf_conntrack` (conntrack parsing)
- WiFi detection: `iw dev <iface> station dump` → list of connected MACs
- tc/HTB shaping: classid derived from IP octets (`1:<hex(o3*256+o4)>`)
- Reserved HTB classids: `1:1` (root), `1:fffe` (default) — skip these
- Burst calculation for tc: `rate_kbit * 125 / 100` (10ms of data, min 1600 bytes)
- Persistent shapes stored in `/etc/trafficmon/shapes.json`

## UI Design Principles

- Colorblind-safe: blue-orange contrast (no red-green reliance)
- Inline pickers (mkInlinePick) instead of `<select>` for settings
- Collapsible settings panel
- Pointer cursor on interactive elements
- iOS-style toggles for boolean options
- Chip/pill style for column visibility toggles
