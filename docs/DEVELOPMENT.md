# Development Guide

This document covers setting up a development environment, testing, adding features, and understanding the build system.

---

## Prerequisites

- A Linux or macOS workstation
- An OpenWrt router (physical or QEMU) for testing
- SSH access to the router
- Basic familiarity with shell scripting and JavaScript

---

## Development Setup

### Option 1: Direct Edit on Router (fastest iteration)

The fastest way to develop is to edit files directly on the router or sync them via scp:

```sh
# On your workstation, set up a sync alias
alias deploy-trafficctl='scp root/usr/local/bin/*.sh root@192.168.1.1:/usr/local/bin/ && \
  scp htdocs/luci-static/resources/view/trafficmon.js root@192.168.1.1:/www/luci-static/resources/view/ && \
  ssh root@192.168.1.1 "chmod +x /usr/local/bin/*.sh && /etc/init.d/rpcd restart"'
```

After deploying, hard-refresh the browser (Ctrl+Shift+R) to pick up JavaScript changes.

### Option 2: QEMU Virtual Router

For testing without physical hardware:

```sh
# Download OpenWrt x86_64 image
wget https://downloads.openwrt.org/releases/23.05.4/targets/x86/64/openwrt-23.05.4-x86-64-generic-ext4-combined.img.gz
gunzip openwrt-23.05.4-x86-64-generic-ext4-combined.img.gz

# Resize disk (optional, for more space)
qemu-img resize openwrt-23.05.4-x86-64-generic-ext4-combined.img 512M

# Run with two network interfaces (LAN + WAN)
qemu-system-x86_64 \
  -drive file=openwrt-23.05.4-x86-64-generic-ext4-combined.img,format=raw \
  -m 256M \
  -netdev user,id=wan,hostfwd=tcp::2222-:22,hostfwd=tcp::8080-:80 \
  -device virtio-net-pci,netdev=wan \
  -netdev tap,id=lan,ifname=tap0,script=no,downscript=no \
  -device virtio-net-pci,netdev=lan \
  -nographic
```

Access via:
- SSH: `ssh -p 2222 root@localhost`
- LuCI: `http://localhost:8080`

Install required packages in QEMU:
```sh
opkg update
opkg install conntrack luci jq tc-full kmod-sched-core
```

### Option 3: OpenWrt Build System (for package builds)

```sh
git clone https://git.openwrt.org/openwrt/openwrt.git
cd openwrt
git checkout v23.05.4

# Add this package as a feed
echo "src-link trafficctl /path/to/luci-app-trafficctl" >> feeds.conf
./scripts/feeds update trafficctl
./scripts/feeds install luci-app-trafficctl

# Configure
make menuconfig
# Select: LuCI > Applications > luci-app-trafficctl

# Build just this package
make package/luci-app-trafficctl/compile V=s
```

The output ipk will be in `bin/packages/*/trafficctl/`.

---

## Project Structure

```
luci-app-trafficctl/
├── Makefile                          # OpenWrt package Makefile
├── README.md
├── LICENSE
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── COMPATIBILITY.md
│   └── DEVELOPMENT.md
├── htdocs/
│   └── luci-static/
│       └── resources/
│           └── view/
│               └── trafficmon.js     # Frontend (single file)
├── po/
│   └── templates/
│       └── trafficmon.pot            # Translation template
├── root/
│   ├── etc/
│   │   └── hotplug.d/
│   │       └── iface/
│   │           └── 99-shaperestore   # Persistence on reboot
│   ├── usr/
│   │   ├── local/
│   │   │   └── bin/
│   │   │       ├── trafficctl-fw.sh  # Firewall abstraction
│   │   │       ├── traffic-summary.sh
│   │   │       ├── traffic-by-ip.sh
│   │   │       ├── traffic-bytes.sh
│   │   │       ├── block-device.sh
│   │   │       ├── unblock-device.sh
│   │   │       ├── ratelimit-device.sh
│   │   │       ├── ratelimit-stats.sh
│   │   │       ├── shape-device.sh
│   │   │       ├── shape-stats.sh
│   │   │       ├── macfilter-add.sh
│   │   │       ├── macfilter-remove.sh
│   │   │       └── rdns-lookup.sh
│   │   └── share/
│   │       └── rpcd/
│   │           └── acl.d/
│   │               └── luci-app-trafficmon.json
│   └── www/
│       └── luci-static/
│           └── resources/
│               └── view/
│                   └── trafficmon.js  # (symlink or copy)
└── .git/
```

---

## How to Add a New Feature

### Adding a New Backend Script

1. Create your script in `root/usr/local/bin/`:
   ```sh
   #!/bin/sh
   # Validate input
   IP="$1"
   if ! echo "$IP" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
       echo '{"ok":false,"msg":"Invalid IP"}'
       exit 1
   fi

   # Do work...

   # Output JSON
   echo '{"ok":true,"msg":"Done"}'
   ```

2. Make it executable: `chmod +x root/usr/local/bin/your-script.sh`

3. Add it to the rpcd ACL file (`root/usr/share/rpcd/acl.d/luci-app-trafficmon.json`):
   ```json
   "/usr/local/bin/your-script.sh *": ["exec"]
   ```

4. Call it from the frontend:
   ```javascript
   fs.exec_direct('/usr/local/bin/your-script.sh', [ip, arg2])
       .then(function(raw) {
           var res = JSON.parse(raw);
           // handle response
       });
   ```

5. Restart rpcd on the router: `/etc/init.d/rpcd restart`

### Adding a New UI Element

The frontend is a single `view.extend()` object in `trafficmon.js`. To add UI:

1. Create DOM elements using LuCI's `E()` helper:
   ```javascript
   var myButton = E('button', {
       'class': 'cbi-button cbi-button-action',
       'click': function() { /* handler */ }
   }, 'Button Label');
   ```

2. Add to the render tree (returned from `render()`).

3. Style using CSS variables from the `C` object for dark mode support.

### Adding Firewall Backend Support

If your feature needs firewall rules, add functions to `trafficctl-fw.sh`:

```sh
tctl_your_feature() {
    local ip="$1"
    if [ "$TCTL_FW" = "nft" ]; then
        # nftables implementation
    else
        # iptables implementation
    fi
}
```

---

## Code Style Guide

### Shell Scripts

- Use `#!/bin/sh` (POSIX sh, not bash).
- No bashisms: no `[[ ]]`, no `$(( ))` for non-integer math, no arrays, no `local -a`.
- Validate all IP inputs before use.
- Output only JSON to stdout. Debug/error info goes to stderr.
- Use `2>/dev/null` on commands that may fail in some environments.
- Quote all variable expansions: `"$VAR"`, not `$VAR`.
- Use meaningful variable names: `RATE_KBIT`, not `r`.
- Comment the purpose of each script at the top.

**Allowed constructs:**
```sh
local var="value"           # local variables
$((expr))                   # arithmetic
case/esac                   # pattern matching
for ... in ...; do ... done # loops
[ condition ]               # test
command1 | command2         # pipes
$(command)                  # command substitution
```

**Forbidden constructs:**
```sh
[[ condition ]]    # bash-only
declare -A         # bash arrays
${var,,}           # bash case modification
<(command)         # process substitution
function name {}   # use name() {} instead
```

### JavaScript

- ES5 syntax only (no `let`, `const`, arrow functions, template literals, `class`).
- `'use strict';` at the top.
- No external dependencies, no npm, no bundlers.
- Use LuCI's `E()` for DOM creation, not `innerHTML` (except for styled status messages).
- CSS variables (via the `C` object) for all colors to support dark mode.
- All user-visible strings should be wrappable in `_()` for i18n (future).

### JSON Output

- Always valid JSON (use `jq` to assemble if complex).
- Consistent field naming: `snake_case`.
- Numbers for numeric values (not strings).
- Booleans for boolean values (not "true"/"false" strings).
- Empty arrays `[]` instead of null for absent collections.

---

## Testing

### Manual Testing on Hardware

1. Deploy scripts to router.
2. Open LuCI in browser, navigate to Traffic Monitor.
3. Verify the dashboard loads with device list.
4. Test each feature (see [COMPATIBILITY.md](COMPATIBILITY.md) testing checklist).

### Script Testing via SSH

You can test scripts directly via SSH:

```sh
# Test connection query
ssh root@router '/usr/local/bin/traffic-by-ip.sh 192.168.1.100' | jq .

# Test block/unblock
ssh root@router '/usr/local/bin/block-device.sh 192.168.1.100 test'
ssh root@router '/usr/local/bin/unblock-device.sh 192.168.1.100 test'

# Test rate limiting
ssh root@router '/usr/local/bin/ratelimit-device.sh 192.168.1.100 5000 test'
ssh root@router '/usr/local/bin/ratelimit-stats.sh' | jq .
ssh root@router '/usr/local/bin/ratelimit-device.sh 192.168.1.100 0 test'

# Test shaping
ssh root@router '/usr/local/bin/shape-device.sh add 192.168.1.100 10000 test'
ssh root@router '/usr/local/bin/shape-device.sh status 192.168.1.100' | jq .
ssh root@router '/usr/local/bin/shape-stats.sh' | jq .
ssh root@router '/usr/local/bin/shape-device.sh remove 192.168.1.100 0 test'

# Verify nft rules
ssh root@router 'nft list table netdev tm_ratelimit'
ssh root@router 'nft list chain inet fw4 forward'

# Verify tc classes
ssh root@router 'tc -s class show dev br-lan'
```

### Speed Testing

To verify rate limiting and shaping work:

1. Apply a limit/shape to a device.
2. From that device, run a speed test (e.g., https://fast.com or `iperf3`).
3. Verify the measured speed matches the configured rate (within 10%).
4. Check drop/backlog counters increase during the test.

### Browser Console Testing

Open the browser console (F12) on the Traffic Monitor page:

```javascript
// Check stored preferences
JSON.parse(localStorage.getItem('trafficmon_opts'))

// Manually trigger a refresh
document.querySelector('.cbi-button-action.important').click()
```

---

## Build System

### OpenWrt Package Makefile

The `Makefile` follows standard LuCI package conventions:

```makefile
include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-trafficctl
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Denis Iusupov <yusdyr@gmail.com>

LUCI_TITLE:=LuCI Traffic Control
LUCI_DESCRIPTION:=Per-device traffic monitoring, rate limiting, shaping, blocking
LUCI_DEPENDS:=+conntrack +luci-base
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

define Package/$(PKG_NAME)/conffiles
/etc/trafficmon/shapes.json
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
```

Key points:
- `LUCI_PKGARCH:=all` -- No compiled code, architecture-independent.
- `LUCI_DEPENDS` -- Declares runtime dependencies.
- `conffiles` -- Marks `shapes.json` as a config file (preserved on sysupgrade).
- The `luci.mk` include handles installing files from the standard LuCI directory layout (`htdocs/`, `root/`, `po/`).

### Directory Layout Convention

The OpenWrt build system (via `luci.mk`) expects:
- `htdocs/` -- Files installed to `/www/` (web root)
- `root/` -- Files installed to `/` (root filesystem)
- `po/` -- Translation files

Files in `root/usr/local/bin/` get installed to `/usr/local/bin/` on the target.

### Building a Release

```sh
# Tag a release
git tag v1.0.0
git push --tags

# In the OpenWrt build tree
make package/luci-app-trafficctl/compile V=s

# The ipk is ready for distribution
ls bin/packages/*/trafficctl/luci-app-trafficctl_1.0.0-1_all.ipk
```

---

## Debugging

### Common Issues

**"Permission denied" when script runs from LuCI:**
- Check the ACL file is in `/usr/share/rpcd/acl.d/`.
- Ensure the script path in the ACL matches exactly.
- Restart rpcd: `/etc/init.d/rpcd restart`.
- Check rpcd logs: `logread | grep rpcd`.

**Script works via SSH but not from LuCI:**
- rpcd runs scripts as a restricted user. Commands like `nft` and `tc` need to be accessible.
- Check the script's dependencies are in PATH for rpcd.

**tc commands fail:**
- Verify `tc-full` is installed (not just the minimal `tc`).
- Verify kernel modules: `lsmod | grep sch_htb`.
- Try: `opkg install kmod-sched-core kmod-sched`.

**Shaping not restored after reboot:**
- Check `/etc/trafficmon/shapes.json` exists and contains valid JSON.
- Check the hotplug script: `cat /etc/hotplug.d/iface/99-shaperestore`.
- Test manually: `ACTION=ifup INTERFACE=lan /etc/hotplug.d/iface/99-shaperestore`.

**Dark mode not working:**
- The CSS uses `[data-darkmode="true"]` and `.dark` selectors.
- Verify your LuCI theme sets one of these attributes on `<html>` or `<body>`.

### Enabling Debug Output

Add debug logging to a script temporarily:

```sh
exec 2>/tmp/trafficctl-debug.log
set -x
```

Then check the log: `cat /tmp/trafficctl-debug.log`

---

## Contributing Workflow

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`.
3. Make changes, test on real hardware or QEMU.
4. Ensure both nftables and iptables paths work (if touching firewall code).
5. Run ShellCheck on shell scripts: `shellcheck root/usr/local/bin/*.sh`.
6. Commit with a descriptive message.
7. Push and open a pull request.

### Pull Request Checklist

- [ ] Tested on OpenWrt 23.05 (nftables)
- [ ] Tested on OpenWrt 21.02 (iptables) OR confirmed change is nft-only
- [ ] Shell scripts pass `shellcheck` without errors
- [ ] JSON output is valid (tested with `| jq .`)
- [ ] No bashisms in shell scripts
- [ ] JavaScript is ES5 compatible
- [ ] Dark mode works (CSS variables used, not hardcoded colors)
- [ ] ACL file updated if new scripts added
- [ ] Documentation updated if API changed
