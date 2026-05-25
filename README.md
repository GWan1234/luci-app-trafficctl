# luci-app-trafficctl

Per-device traffic monitoring and control for OpenWrt routers. Monitor connections, limit bandwidth, shape traffic, block internet access, and manage WiFi MAC filtering -- all from a single LuCI page.

---

## Features

- **Real-time Per-device Monitoring** -- View active connections per device with TCP/UDP counts, TCP state breakdown, destination IPs, and live bandwidth speed (sparkline graphs).
- **Traffic Shaping (Queue)** -- tc/HTB classes on the LAN bridge with fq_codel leaf qdiscs. Queues excess traffic instead of dropping, providing smoother throughput.
- **Rate Limiting (Policer)** -- nftables or iptables-based packet dropping when a device exceeds the configured rate. Instant enforcement, no queuing.
- **Internet Blocking** -- Layer 3 drop rules per device. Connections are killed immediately and counter stats are tracked.
- **WiFi MAC Filtering** -- Block any device from associating with WiFi. Works across all radio interfaces (2.4 GHz, 5 GHz, 6 GHz) automatically.
- **Interface Detection** -- Shows actual connection interface: WiFi band (2.4G/5G/6G) or LAN port name (lan2/lan3/lan4).
- **Live Speed Polling** -- Optional polling with configurable interval or off by default; shows sparkline per device.
- **Reverse DNS** -- Optional hostname resolution for external destination IPs.
- **Searchable Device Picker** -- Inline search by name, IP, or MAC with filtered dropdown.
- **Reboot Persistence** -- Shaping rules survive reboot via a hotplug script that restores tc/HTB classes when the LAN interface comes up.

---

## Compatibility

| OpenWrt Version | Firewall | Status |
|-----------------|----------|--------|
| 23.05+          | fw4 / nftables | Fully supported |
| 22.03           | fw4 / nftables | Fully supported |
| 21.02           | fw3 / iptables | Supported (auto-detected) |

Runs on all architectures (no compiled code): `mips`, `mipsel`, `arm`, `aarch64`, `x86_64`.

---

## Installation

### From source (OpenWrt build system)

```sh
# Add to your feeds.conf:
echo "src-git trafficctl https://github.com/YusDyr/luci-app-trafficctl.git" >> feeds.conf

# Update and install:
./scripts/feeds update trafficctl
./scripts/feeds install luci-app-trafficctl

# Build:
make package/luci-app-trafficctl/compile V=s
```

### Manual installation

Copy the `root/` tree to the router's filesystem, then restart rpcd:

```sh
scp -r root/* root@router:/
scp -r htdocs/luci-static root@router:/www/
ssh root@router 'chmod +x /usr/local/bin/trafficctl-*.sh /usr/libexec/rpcd/trafficctl && /etc/init.d/rpcd restart'
```

### Required packages

```sh
# Core (always required)
opkg install conntrack luci-base

# For traffic shaping
opkg install tc-full kmod-sched-core kmod-sched-htb

# For interface detection
opkg install iw-full

# For reverse DNS (optional)
opkg install bind-dig
```

---

## Quick Start

1. Install the package (see above).
2. Navigate to **Status > Traffic Control** in LuCI.
3. The summary table shows all active devices with connection counts, traffic, speed limits, and connection interface.
4. Use the search bar to find a device by name, IP, or MAC.
5. Select a device to see its per-connection detail table.
6. Use the action buttons to pause internet, block WiFi, or set a speed limit.

---

## Configuration

### Speed Limit Modes

| Mode | Mechanism | Behavior | Best For |
|------|-----------|----------|----------|
| **Shaper** | tc/HTB + fq_codel | Queues excess packets | Smooth streaming, lower jitter |
| **Limiter** | nft `limit rate` / iptables `hashlimit` | Drops excess packets | Quick enforcement, low overhead |

### Persistence

- Shaping rules are saved to `/etc/trafficmon/shapes.json`.
- On reboot, the hotplug script at `/etc/hotplug.d/iface/99-trafficctl-shapes` re-applies shaping when the LAN interface comes up.
- Rate limiter rules (nft policer) are **not** persisted -- they are intended as temporary throttles.
- Internet block rules are **not** persisted -- they are session-based.

### WiFi MAC Filtering

When a device is WiFi-blocked:
- Its MAC is added to the deny list on **all** wifi-iface sections.
- `macfilter=deny` is set on each interface.
- `wifi reload` is called to apply without full restart.

---

## Architecture

```mermaid
flowchart LR
    A((LuCI\nBrowser)) -->|JSON-RPC| B[rpcd backend]

    B --> C{Query or\nAction?}

    C -->|query| D[/Monitoring/]
    C -->|action| E[/Control/]

    D --> F[(conntrack)]
    D --> G[(iw / brctl)]

    E --> H[Firewall\nabstraction]
    E --> I[tc / HTB]
    E --> J[hostapd]

    H --> K[(nftables)]
    H --> L[(iptables)]

    I --> M[(shapes.json)]
    M -.->|boot restore| I
```

The frontend talks to a thin rpcd dispatcher over ubus. Backend shell scripts split into two groups: **monitoring** (read-only, pulls data from conntrack and wireless subsystems) and **control** (writes firewall rules, tc classes, or WiFi MAC filters). A firewall abstraction layer auto-detects nft vs iptables at runtime. Shaping state persists across reboots via a hotplug script.

---

## Project Layout

| Path | Role |
|------|------|
| `htdocs/.../view/trafficctl/status.js` | Frontend — single ES5 file, no deps |
| `root/usr/libexec/rpcd/trafficctl` | rpcd backend — JSON-RPC dispatch |
| `root/usr/local/bin/trafficctl-*.sh` | Backend scripts (monitoring + control) |
| `root/usr/local/bin/trafficctl-fw.sh` | Firewall abstraction layer (sourced) |
| `root/etc/hotplug.d/iface/99-trafficctl-shapes` | Boot persistence for tc rules |
| `root/usr/share/rpcd/acl.d/` | ACL permissions |
| `Makefile` | OpenWrt package build |
| `docs/` | Extended docs (architecture, API, compat) |

---

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component diagram, data flow sequences, tc/HTB hierarchy, security model |
| [API.md](docs/API.md) | All rpcd methods, script arguments, JSON output formats |
| [COMPATIBILITY.md](docs/COMPATIBILITY.md) | OpenWrt version matrix, nft/iptables feature parity, known limitations |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Dev setup, deploy commands, code style, debugging |

---

## Contributing

Contributions are welcome. Please:

1. Fork the repository and create a feature branch.
2. Test on at least one real OpenWrt device.
3. Ensure both nftables and iptables code paths work if your change touches firewall logic.
4. Keep the single-file JavaScript approach -- no bundlers, no npm, no transpilation.
5. Shell scripts must be POSIX sh compatible (BusyBox ash/dash).
6. All scripts emit JSON to stdout.

### Code Style

- **JavaScript**: ES5 syntax (LuCI compatibility), `'use strict'`, no external dependencies.
- **Shell**: POSIX `/bin/sh`, validate all IP input, output JSON only.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

Copyright 2024-2025 Denis Iusupov.
