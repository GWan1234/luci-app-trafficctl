# API Reference

All backend functionality is exposed through shell scripts located in `/usr/local/bin/`. Each script outputs JSON to stdout and is invoked by the LuCI frontend via `fs.exec_direct()` through rpcd.

---

## Common Conventions

- **Input validation**: Every script that accepts an IP validates it with `^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$` before proceeding.
- **Error format**: `{"ok":false,"msg":"Human-readable error message"}`
- **Success format (actions)**: `{"ok":true,"msg":"Human-readable success message"}`
- **Rate units**: All rate values are in **kbit/s** (kilobits per second). The conversion from UI presets (Mbit/s) happens in the frontend.
- **Exit codes**: 0 on success, 1 on input validation failure. Action failures still return exit 0 with `ok:false` in JSON.

---

## Query Scripts

### traffic-summary.sh

Returns a summary of all active LAN devices with their connection counts and control status.

**Arguments:** None

**Invocation:**
```sh
/usr/local/bin/traffic-summary.sh
```

**Output:** JSON array of device objects.

```json
[
  {
    "ip": "192.168.1.100",
    "name": "iPhone-Denis",
    "mac": "AA:BB:CC:DD:EE:FF",
    "total": 47,
    "tcp": 38,
    "udp": 9,
    "blocked": false,
    "block_bytes": 0,
    "wifi_blocked": false,
    "rate_limit_kbit": 0,
    "shape_kbit": 10000
  },
  {
    "ip": "192.168.1.101",
    "name": "Kids-iPad",
    "mac": "11:22:33:44:55:66",
    "total": 12,
    "tcp": 10,
    "udp": 2,
    "blocked": false,
    "block_bytes": 0,
    "wifi_blocked": false,
    "rate_limit_kbit": 5000,
    "shape_kbit": 0
  }
]
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `ip` | string | Device LAN IP address |
| `name` | string | Hostname from DHCP lease, or IP if unknown |
| `mac` | string | MAC address (uppercase), empty if not in DHCP leases |
| `total` | number | Total active connections (TCP + UDP + other) |
| `tcp` | number | TCP connection count |
| `udp` | number | UDP connection count |
| `blocked` | boolean | Whether internet is blocked for this device |
| `block_bytes` | number | Bytes matched by the block rule (cumulative) |
| `wifi_blocked` | boolean | Whether MAC is in WiFi deny list |
| `rate_limit_kbit` | number | Active policer rate in kbit/s (0 = not limited) |
| `shape_kbit` | number | Active shaper rate in kbit/s (0 = not shaped) |

---

### traffic-by-ip.sh

Returns detailed connection information for a single device.

**Arguments:**

| Position | Required | Description |
|----------|----------|-------------|
| 1 | Yes | IPv4 address of the device |
| `--proto` | No | Filter by protocol: `tcp`, `udp`, or `all` (default: `all`) |
| `--rdns` | No | Enable reverse DNS lookup for destination IPs |

**Invocation:**
```sh
/usr/local/bin/traffic-by-ip.sh 192.168.1.100
/usr/local/bin/traffic-by-ip.sh 192.168.1.100 --proto tcp
/usr/local/bin/traffic-by-ip.sh 192.168.1.100 --proto udp --rdns
```

**Output:**

```json
{
  "ip": "192.168.1.100",
  "name": "iPhone-Denis",
  "mac": "AA:BB:CC:DD:EE:FF",
  "timestamp": "2025-05-25 14:30:22",
  "blocked": false,
  "block_packets": 0,
  "block_bytes": 0,
  "wifi_blocked": false,
  "total": 47,
  "protocols": {
    "tcp": 38,
    "udp": 9
  },
  "tcp_states": {
    "ESTABLISHED": 32,
    "TIME_WAIT": 4,
    "CLOSE_WAIT": 2
  },
  "connections": [
    {
      "proto": "tcp",
      "dst": "142.250.80.46",
      "host": "lhr25s34-in-f14.1e100.net",
      "port": 443,
      "service": "https",
      "bytes": 125000,
      "state": "ESTABLISHED"
    },
    {
      "proto": "udp",
      "dst": "8.8.8.8",
      "host": "dns.google",
      "port": 53,
      "service": "dns",
      "bytes": 512,
      "state": ""
    }
  ],
  "rate_limit_kbit": 0,
  "shape_kbit": 10000
}
```

**Fields (top-level):**

| Field | Type | Description |
|-------|------|-------------|
| `ip` | string | Queried IP address |
| `name` | string | Device hostname |
| `mac` | string | MAC address |
| `timestamp` | string | Query timestamp (YYYY-MM-DD HH:MM:SS) |
| `blocked` | boolean | Internet block status |
| `block_packets` | number | Packets matched by block rule |
| `block_bytes` | number | Bytes matched by block rule |
| `wifi_blocked` | boolean | WiFi deny list status |
| `total` | number | Total connection count |
| `protocols` | object | `{tcp: N, udp: N}` |
| `tcp_states` | object | `{STATE_NAME: count, ...}` |
| `connections` | array | Array of connection objects |
| `rate_limit_kbit` | number | Active policer rate (0 = none) |
| `shape_kbit` | number | Active shaper rate (0 = none) |

**Fields (connection object):**

| Field | Type | Description |
|-------|------|-------------|
| `proto` | string | `"tcp"` or `"udp"` |
| `dst` | string | Destination IP address |
| `host` | string | Reverse DNS hostname (empty if not resolved or `--rdns` not set) |
| `port` | number | Destination port |
| `service` | string | Service name (e.g., `"https"`, `"dns"`) or empty |
| `bytes` | number | Bytes transferred on this connection |
| `state` | string | TCP state (e.g., `"ESTABLISHED"`, `"TIME_WAIT"`) or empty for UDP |

**Error:**
```json
{"error": "Invalid IP address"}
```

---

### ratelimit-stats.sh

Returns drop counters from the nftables rate-limiter table.

**Arguments:** None

**Invocation:**
```sh
/usr/local/bin/ratelimit-stats.sh
```

**Output:**

```json
[
  {
    "ip": "192.168.1.101",
    "rate_kbit": 5000,
    "packets": 1423,
    "bytes": 2134567
  }
]
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `ip` | string | Device IP with active rate limit |
| `rate_kbit` | number | Configured rate in kbit/s |
| `packets` | number | Cumulative dropped packets |
| `bytes` | number | Cumulative dropped bytes |

**Notes:**
- Returns an empty array `[]` if no rate limits are active or if nftables is not available.
- On iptables (fw3), this script returns `[]` as hashlimit counters are not easily parsed.

---

### shape-stats.sh

Returns tc/HTB class statistics for all shaped devices.

**Arguments:** None

**Invocation:**
```sh
/usr/local/bin/shape-stats.sh
```

**Output:**

```json
[
  {
    "ip": "192.168.1.100",
    "rate_kbit": 10000,
    "bytes": 45678901,
    "packets": 32456,
    "backlog": 4096
  }
]
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `ip` | string | Device IP (derived from tc class ID) |
| `rate_kbit` | number | Configured shaping rate |
| `bytes` | number | Total bytes passed through this class |
| `packets` | number | Total packets passed through this class |
| `backlog` | number | Current queue backlog in bytes (0 = no congestion) |

**Notes:**
- Returns `[]` if tc is not installed or no HTB qdisc exists on br-lan.
- The IP is reconstructed from the class ID using the reverse of the encoding formula: `third_octet = classid_dec / 256`, `fourth_octet = classid_dec % 256`, prefix `192.168.`.

---

### rdns-lookup.sh

Performs a reverse DNS lookup for a single IP address.

**Arguments:**

| Position | Required | Description |
|----------|----------|-------------|
| 1 | Yes | IPv4 address to look up |

**Invocation:**
```sh
/usr/local/bin/rdns-lookup.sh 142.250.80.46
```

**Output:**

```json
{"ip": "142.250.80.46", "host": "lhr25s34-in-f14.1e100.net"}
```

If no PTR record exists:
```json
{"ip": "142.250.80.46", "host": ""}
```

**Notes:**
- Uses `dig -x` with a 4-second timeout and 1 retry.
- Requires the `bind-dig` package.
- The frontend calls this once per unique external IP, in parallel, after rendering the connection table.

---

### traffic-bytes.sh

Returns raw byte counters for bandwidth speed calculation.

**Arguments:** None

**Invocation:**
```sh
/usr/local/bin/traffic-bytes.sh
```

**Output:**

```json
[
  {"ip": "192.168.1.100", "bytes_in": 456789012, "bytes_out": 12345678},
  {"ip": "192.168.1.101", "bytes_in": 78901234, "bytes_out": 5678901}
]
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `ip` | string | Device IP |
| `bytes_in` | number | Total bytes received by this device (download) |
| `bytes_out` | number | Total bytes sent by this device (upload) |

**Notes:**
- The frontend stores two consecutive readings and calculates speed as `(bytes_in[t] - bytes_in[t-1]) / dt`.
- Counters may reset on conntrack table flush or reboot.
- Polled every 2 seconds by the frontend in dashboard mode.

---

## Action Scripts

### block-device.sh

Blocks a device's internet access by inserting a drop rule in the forward chain.

**Arguments:**

| Position | Required | Description |
|----------|----------|-------------|
| 1 | Yes | IPv4 address to block |
| 2 | No | Human-readable label (default: the IP) |

**Invocation:**
```sh
/usr/local/bin/block-device.sh 192.168.1.100 "Kids-iPad"
```

**Output (success):**
```json
{"ok": true, "msg": "Kids-iPad (192.168.1.100) blocked"}
```

**Output (already blocked):**
```json
{"ok": false, "msg": "Already blocked"}
```

**Output (error):**
```json
{"ok": false, "msg": "Could not find ct state handle"}
```

**Side effects:**
- Inserts a drop rule before the ct state vmap rule in `inet fw4 forward`.
- Flushes the fw4 flowtable to prevent offloaded connections from bypassing the rule.
- Kills all existing conntrack entries for the device (`conntrack -D -s <IP>`).

---

### unblock-device.sh

Removes all block rules for a device.

**Arguments:**

| Position | Required | Description |
|----------|----------|-------------|
| 1 | Yes | IPv4 address to unblock |
| 2 | No | Human-readable label (default: the IP) |

**Invocation:**
```sh
/usr/local/bin/unblock-device.sh 192.168.1.100 "Kids-iPad"
```

**Output (success):**
```json
{"ok": true, "msg": "Kids-iPad (192.168.1.100) unblocked (1 rule(s) removed)"}
```

**Output (not blocked):**
```json
{"ok": false, "msg": "No block rule found for 192.168.1.100"}
```

---

### ratelimit-device.sh

Sets or removes a download rate limit (policer) for a device.

**Arguments:**

| Position | Required | Description |
|----------|----------|-------------|
| 1 | Yes | IPv4 address |
| 2 | Yes | Rate in kbit/s (`0` to remove) |
| 3 | No | Human-readable label |

**Invocation:**
```sh
# Set 5 Mbit/s limit
/usr/local/bin/ratelimit-device.sh 192.168.1.100 5000 "Kids-iPad"

# Remove limit
/usr/local/bin/ratelimit-device.sh 192.168.1.100 0 "Kids-iPad"
```

**Output (set):**
```json
{"ok": true, "msg": "Download limited to 5000 kbit/s for Kids-iPad"}
```

**Output (removed):**
```json
{"ok": true, "msg": "Rate limit removed for Kids-iPad"}
```

**Implementation notes:**
- Creates the `netdev tm_ratelimit` table and `dl` chain if they do not exist.
- Removes any existing rule for the IP before adding a new one (idempotent).
- The nft rule uses `limit rate over N kbytes/second` where N = kbit / 8.
- On iptables, uses `hashlimit` with `--hashlimit-above Nkbit/sec`.

---

### shape-device.sh

Manages tc/HTB traffic shaping classes for a device.

**Arguments:**

| Position | Required | Description |
|----------|----------|-------------|
| 1 | Yes | Action: `add`, `remove`, or `status` |
| 2 | Yes | IPv4 address |
| 3 | Conditional | Rate in kbit/s (required for `add`) |
| 4 | No | Human-readable label |

**Invocation:**
```sh
# Add shaping at 10 Mbit/s
/usr/local/bin/shape-device.sh add 192.168.1.100 10000 "Kids-iPad"

# Remove shaping
/usr/local/bin/shape-device.sh remove 192.168.1.100 0 "Kids-iPad"

# Query status
/usr/local/bin/shape-device.sh status 192.168.1.100
```

**Output (add):**
```json
{"ok": true, "msg": "Download shaped to 10000 kbit/s for Kids-iPad"}
```

**Output (remove):**
```json
{"ok": true, "msg": "Shaping removed for Kids-iPad"}
```

**Output (status):**
```json
{"ip": "192.168.1.100", "rate_kbit": 10000, "bytes": 45678901, "packets": 32456, "backlog": 0}
```

**Output (tc not installed):**
```json
{"ok": false, "msg": "tc not installed. Run: opkg install tc-full kmod-sched-core"}
```

**Implementation notes:**
- Initializes the HTB qdisc on first use (`htb default fffe` with 1000mbit root class).
- Class ID is deterministic: `1:<hex(octet3 * 256 + octet4)>`.
- Each class gets a fq_codel leaf qdisc for fair queuing and latency management.
- State is persisted to `/etc/trafficmon/shapes.json` on `add`/`remove`.

---

### macfilter-add.sh

Blocks a device from WiFi by adding its MAC to the deny list on all radio interfaces.

**Arguments:**

| Position | Required | Description |
|----------|----------|-------------|
| 1 | Yes | IPv4 address (MAC is resolved from DHCP leases) |

**Invocation:**
```sh
/usr/local/bin/macfilter-add.sh 192.168.1.100
```

**Output (success):**
```json
{"ok": true, "msg": "WiFi blocked for AA:BB:CC:DD:EE:FF (added to 2 interface(s))"}
```

**Output (already blocked):**
```json
{"ok": false, "msg": "AA:BB:CC:DD:EE:FF already in WiFi deny list"}
```

**Output (no MAC found):**
```json
{"ok": false, "msg": "MAC not found for 192.168.1.100 (device must have an active DHCP lease)"}
```

**Side effects:**
- Sets `macfilter=deny` on every wifi-iface section.
- Adds MAC to the `maclist` on every wifi-iface section.
- Commits wireless config (`uci commit wireless`).
- Runs `wifi reload` in the background.

---

### macfilter-remove.sh

Unblocks a device from WiFi by removing its MAC from all deny lists.

**Arguments:**

| Position | Required | Description |
|----------|----------|-------------|
| 1 | Yes | IPv4 address |

**Invocation:**
```sh
/usr/local/bin/macfilter-remove.sh 192.168.1.100
```

**Output (success):**
```json
{"ok": true, "msg": "WiFi unblocked for AA:BB:CC:DD:EE:FF (removed from 2 interface(s))"}
```

**Output (not in list):**
```json
{"ok": false, "msg": "AA:BB:CC:DD:EE:FF not found in any WiFi deny list"}
```

---

## Rate Units Reference

All internal rates are in **kbit/s** (kilobits per second).

| UI Display | Internal Value (kbit/s) | nft Value (kbytes/s) |
|------------|------------------------|---------------------|
| 1 Mbit/s | 1000 | 125 |
| 2 Mbit/s | 2000 | 250 |
| 5 Mbit/s | 5000 | 625 |
| 10 Mbit/s | 10000 | 1250 |
| 25 Mbit/s | 25000 | 3125 |
| 50 Mbit/s | 50000 | 6250 |
| 100 Mbit/s | 100000 | 12500 |

The conversion formula: `kbytes_per_second = kbit_per_second / 8`

The minimum enforceable rate is 8 kbit/s (1 kbyte/s) due to nftables using integer kbytes/second.

---

## rpcd ACL Configuration

The ACL file (`/usr/share/rpcd/acl.d/luci-app-trafficmon.json`) grants execution permissions to the LuCI frontend:

```json
{
  "luci-app-trafficmon": {
    "description": "Traffic Monitor - view and block devices",
    "read": {
      "cgi-io": ["exec"],
      "ubus": {
        "file": ["read"]
      },
      "uci": ["wireless"],
      "file": {
        "/tmp/dhcp.leases": ["read"],
        "/usr/local/bin/traffic-by-ip.sh *": ["exec"],
        "/usr/local/bin/block-device.sh *": ["exec"],
        "/usr/local/bin/unblock-device.sh *": ["exec"],
        "/usr/local/bin/macfilter-add.sh *": ["exec"],
        "/usr/local/bin/macfilter-remove.sh *": ["exec"],
        "/usr/local/bin/traffic-summary.sh": ["exec"],
        "/usr/local/bin/rdns-lookup.sh *": ["exec"],
        "/usr/local/bin/ratelimit-device.sh *": ["exec"],
        "/usr/local/bin/traffic-bytes.sh": ["exec"],
        "/usr/local/bin/ratelimit-stats.sh": ["exec"],
        "/usr/local/bin/shape-device.sh *": ["exec"],
        "/usr/local/bin/shape-stats.sh": ["exec"]
      }
    }
  }
}
```

Scripts with `*` in their path accept arguments. Scripts without `*` are called with no arguments.
