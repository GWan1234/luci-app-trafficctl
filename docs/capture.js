'use strict';
const { chromium } = require('playwright');
const { execSync }  = require('child_process');
const path          = require('path');
const fs            = require('fs');

const APP_URL    = 'https://dyr.ozerki.net/cgi-bin/luci/admin/status/trafficctl';
const IMG_DARK   = path.join(__dirname, 'img', 'dark');
const IMG_LIGHT  = path.join(__dirname, 'img', 'light');
const IMG_GIF    = path.join(__dirname, 'img');
const TMP_FRAMES = '/tmp/tc_frames';

// ── helpers ────────────────────────────────────────────────────────────────

function mkdirs() {
  [IMG_DARK, IMG_LIGHT, TMP_FRAMES].forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function clearFrames() {
  fs.readdirSync(TMP_FRAMES).forEach(f => fs.unlinkSync(path.join(TMP_FRAMES, f)));
}

async function shot(page, file) {
  await page.screenshot({ path: file, fullPage: false });
  console.log('  ✓', path.relative('/tmp/luci-app-trafficctl', file));
}

async function setDark(page, on) {
  await page.evaluate(d => document.documentElement.setAttribute('data-darkmode', String(d)), on);
  await page.waitForTimeout(300);
}

function makeGif(pattern, output, fps = 2) {
  const palette = '/tmp/palette.png';
  try {
    execSync(`ffmpeg -y -framerate ${fps} -i "${path.join(TMP_FRAMES, pattern)}" -vf "scale=1200:-1:flags=lanczos,palettegen" "${palette}" 2>/dev/null`);
    execSync(`ffmpeg -y -framerate ${fps} -i "${path.join(TMP_FRAMES, pattern)}" -i "${palette}" -filter_complex "scale=1200:-1:flags=lanczos[x];[x][1:v]paletteuse" -loop 0 "${output}" 2>/dev/null`);
    console.log('  ✓ GIF:', path.relative('/tmp/luci-app-trafficctl', output));
  } catch (e) {
    console.error('  ✗ GIF failed:', e.message);
  }
}

// Navigate to all-devices view by clearing lastIp and doing a full page.goto
// Retries on network errors (wifi reload may temporarily disconnect all clients)
async function gotoAllDevices(page) {
  await page.evaluate(() => {
    try {
      const o = JSON.parse(localStorage.getItem('trafficctl_opts') || '{}');
      delete o.lastIp;
      localStorage.setItem('trafficctl_opts', JSON.stringify(o));
    } catch (e) {}
  }).catch(() => {});
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
      return;
    } catch (e) {
      console.log(`    goto retry ${attempt + 1}/5: ${e.message.split('\n')[0]}`);
      await page.waitForTimeout(5000);
    }
  }
  throw new Error('gotoAllDevices: failed after 5 retries');
}

// Wait until a button with given label becomes visible — reliable operation-complete signal
async function waitForButton(page, label, timeout = 30000) {
  await page.waitForFunction(t => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.includes(t) && b.offsetParent !== null) return true;
    }
    return false;
  }, label, { timeout }).catch(() => {});
  await page.waitForTimeout(500);
}

// Wait for ✓ Done banner (not any stray checkmark in the table)
async function waitDone(page, timeout = 20000) {
  await page.waitForFunction(() => {
    for (const el of document.querySelectorAll('div')) {
      if (el.textContent.trim().startsWith('✓') && el.offsetParent !== null
          && el.style.display !== 'none') return true;
    }
    return false;
  }, { timeout }).catch(() => {});
  await page.waitForTimeout(600);
}

async function selectDevice(page, ip) {
  await page.evaluate(ip => {
    for (const row of document.querySelectorAll('tr.tm-row')) {
      const cells = row.querySelectorAll('td');
      if (cells[1] && cells[1].textContent.trim() === ip) { row.click(); return; }
    }
  }, ip);
  await page.waitForTimeout(1200);
}

async function pickOption(page, triggerText, optionText) {
  await page.evaluate(t => {
    for (const el of document.querySelectorAll('span[style*="dashed"]')) {
      if (el.textContent.trim() === t) { el.click(); return; }
    }
    const el = document.querySelector('span[style*="dashed"]');
    if (el) el.click();
  }, triggerText);
  await page.waitForTimeout(300);
  await page.evaluate(t => {
    for (const el of document.querySelectorAll('div[style*="cursor:pointer"][style*="font-size:12px"]')) {
      if (el.textContent.trim() === t) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return; }
    }
  }, optionText);
  await page.waitForTimeout(300);
}

async function openSettings(page) {
  const arrow = page.locator('.tm-settings-arrow');
  const txt = await arrow.textContent().catch(() => '▾');
  if (txt.includes('▸')) {
    await page.locator('div:has(.tm-settings-arrow)').first().click();
    await page.waitForTimeout(500);
  }
}

async function closeSettings(page) {
  const arrow = page.locator('.tm-settings-arrow');
  const txt = await arrow.textContent().catch(() => '▸');
  if (txt.includes('▾')) {
    await page.locator('div:has(.tm-settings-arrow)').first().click();
    await page.waitForTimeout(400);
  }
}

// Find best candidate phone device in the device overview table
async function findPhone(page) {
  const result = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr.tm-row');
    const candidates = [];
    const exclude = ['mbp', 'macbook', 'imac', 'laptop', 'desktop', 'pc', 'server', 'nas',
                     'work', 'workmb', 'mini', 'air', 'pro'];
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const name = cells[0].textContent.toLowerCase();
      const ip   = (cells[1].textContent || '').trim();
      // Only local IPs (device overview) — skip external IPs (connection table)
      if (!ip.match(/^192\.168\.\d+\.\d+$/)) continue;
      if (exclude.some(x => name.includes(x))) continue;
      const isWifi = row.innerHTML.includes('📶');
      const score =
        (name.includes('евген') || name.includes('evgen') || name.includes('eugene') || name.includes('zhenya')) ? 100 :
        (name.includes('phone') || name.includes('iphone') || name.includes('android'))                          ? 80  :
        (name.includes('samsung') || name.includes('xiaomi') || name.includes('huawei') || name.includes('pixel')) ? 70 :
        isWifi ? 10 : 0;
      candidates.push({ name: cells[0].textContent.trim(), ip, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  });
  console.log('  Devices:', result.map(r => `${r.name} (${r.ip}) score=${r.score}`).join(', '));
  const pick = result.find(r => r.score >= 50) || null;
  if (!pick && result.length > 0) {
    console.log('  ⚠ No phone-like device (scores < 50), using highest-scored device');
    return result[0];
  }
  if (!pick) console.log('  ⚠ No devices found at all — is the page showing device overview?');
  return pick;
}

// Ensure phone has no rate limit, no WiFi block, no internet block
async function cleanPhone(page, ip) {
  console.log('  Cleaning phone state…');
  await selectDevice(page, ip);
  await closeSettings(page);

  const rate = await page.evaluate(() => {
    const el = document.querySelector('span[style*="dashed"]');
    return el ? el.textContent.trim() : 'Off';
  });
  if (rate !== 'Off') {
    console.log(`    Removing rate limit (${rate})…`);
    await pickOption(page, rate, 'Off');
    await page.locator('button:has-text("Apply")').click();
    await waitDone(page);
  }

  const unblockInet = page.locator('button:has-text("Unblock Internet")');
  if (await unblockInet.isVisible().catch(() => false)) {
    console.log('    Unblocking internet…');
    await unblockInet.click();
    await waitForButton(page, 'Block Internet');
  }

  const unblockWifi = page.locator('button:has-text("Unblock WiFi")');
  if (await unblockWifi.isVisible().catch(() => false)) {
    console.log('    Unblocking WiFi…');
    await unblockWifi.click();
    await waitForButton(page, 'Block WiFi', 30000);
  }

  await page.waitForTimeout(1500);
  console.log('  Clean ✓');
}

// ── capture one full scenario (dark or light) ──────────────────────────────

async function captureTheme(page, dark, phone) {
  const DIR   = dark ? IMG_DARK : IMG_LIGHT;
  const label = dark ? 'dark' : 'light';
  console.log(`\n══ ${label} theme ══════════════════════════════════════`);

  await setDark(page, dark);

  // 1. Overview — wait for speed data
  console.log('  [01] Overview…');
  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(5000);
  await shot(page, path.join(DIR, '01-overview.png'));

  // 2. Speed graph GIF (12 frames × 2s)
  console.log('  [GIF] Speed graph (12 frames × 2s)…');
  clearFrames();
  for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: path.join(TMP_FRAMES, `sg_${String(i).padStart(3,'0')}.png`) });
    if (i < 11) await page.waitForTimeout(2000);
  }
  makeGif('sg_%03d.png', path.join(IMG_GIF, `speed-graph-${label}.gif`), 3);

  // 3. Device detail
  console.log(`  [02] Device detail → ${phone.name} (${phone.ip})`);
  await selectDevice(page, phone.ip);
  await closeSettings(page);
  await shot(page, path.join(DIR, '02-device-detail.png'));

  // 4–5. Block / Unblock internet + GIF
  console.log('  [03-04] Block/Unblock internet…');
  clearFrames();
  let fi = 0;
  const frame = async () => {
    await page.screenshot({ path: path.join(TMP_FRAMES, `bi_${String(fi++).padStart(3,'0')}.png`) });
  };

  await frame(); // unblocked state
  const blockBtn = page.locator('button:has-text("Block Internet")');
  if (await blockBtn.isVisible().catch(() => false)) {
    await blockBtn.click();
    await waitForButton(page, 'Unblock Internet');
    await frame(); await frame();
    await shot(page, path.join(DIR, '03-internet-blocked.png'));
    await page.locator('button:has-text("Unblock Internet")').click();
    await waitForButton(page, 'Block Internet');
    await frame(); await frame();
    await shot(page, path.join(DIR, '04-internet-unblocked.png'));
  }
  makeGif('bi_%03d.png', path.join(IMG_GIF, `block-internet-${label}.gif`), 2);

  // 6–7. Block / Unblock WiFi (no wifi reload — only target MAC is affected)
  const wifiBlockBtn = page.locator('button:has-text("Block WiFi")');
  if (await wifiBlockBtn.isVisible().catch(() => false)) {
    console.log('  [05-06] Block/Unblock WiFi…');
    await wifiBlockBtn.click();
    await waitForButton(page, 'Unblock WiFi');
    await shot(page, path.join(DIR, '05-wifi-blocked.png'));
    await page.locator('button:has-text("Unblock WiFi")').click();
    await waitForButton(page, 'Block WiFi', 30000);
    await page.waitForTimeout(1000);
    await shot(page, path.join(DIR, '06-wifi-unblocked.png'));
  } else {
    console.log('  (WiFi button not visible for this device)');
  }

  // 8–10. Rate limit GIF: Off → Limiter 10M → Shaper 10M → Off
  console.log('  [07-09] Rate limit sequence…');
  clearFrames(); fi = 0;

  await frame(); // frame 0: clean state

  await pickOption(page, 'Off', '10 Mbit/s');
  await pickOption(page, 'Shaper (queue)', 'Limiter (drop)');
  await frame(); // frame 1: options selected, not yet applied

  await page.locator('button:has-text("Apply")').click();
  await waitDone(page);
  await frame(); await frame(); // frames 2-3: limiter active
  await shot(page, path.join(DIR, '07-limiter-applied.png'));

  await pickOption(page, 'Limiter (drop)', 'Shaper (queue)');
  await page.locator('button:has-text("Apply")').click();
  await waitDone(page);
  await frame(); // frame 4: shaper active
  await shot(page, path.join(DIR, '08-shaper-applied.png'));

  await pickOption(page, '10 Mbit/s', 'Off');
  await page.locator('button:has-text("Apply")').click();
  await waitDone(page);
  await frame(); await frame(); // frames 5-6: throttle removed
  await shot(page, path.join(DIR, '09-throttle-removed.png'));

  makeGif('bi_%03d.png', path.join(IMG_GIF, `rate-limit-${label}.gif`), 2);

  // 11. Settings panel (all-devices) — open all collapsible sections
  console.log('  [10] Settings panel…');
  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(1000);
  await openSettings(page);
  await shot(page, path.join(DIR, '10-settings.png'));

  // 12. Telegram Bot section
  console.log('  [19] Telegram Bot section…');
  await page.evaluate(() => {
    const labels = document.querySelectorAll('div[style*="font-weight:600"]');
    for (const el of labels) {
      if (el.textContent.includes('Telegram Bot')) { el.click(); break; }
    }
  });
  await page.waitForTimeout(2000);
  await shot(page, path.join(DIR, '19-telegram-settings.png'));

  // 13. Logging & Persistence section
  console.log('  [20] Logging & Persistence section…');
  await page.evaluate(() => {
    const labels = document.querySelectorAll('div[style*="font-weight:600"]');
    for (const el of labels) {
      if (el.textContent.includes('Logging')) { el.click(); break; }
    }
  });
  await page.waitForTimeout(2000);
  await shot(page, path.join(DIR, '20-logging-settings.png'));

  // 14. Connections table section
  console.log('  [21] Connections table section…');
  await page.evaluate(() => {
    const labels = document.querySelectorAll('div[style*="font-weight:600"]');
    for (const el of labels) {
      if (el.textContent.includes('Connections table')) { el.click(); break; }
    }
  });
  await page.waitForTimeout(500);
  await shot(page, path.join(DIR, '21-connections-table-settings.png'));

  // 15. Activity Log panel
  console.log('  [22] Activity Log panel…');
  await page.evaluate(() => {
    const cb = document.getElementById('tm-activity');
    if (cb && !cb.checked) cb.click();
  });
  await page.waitForTimeout(2000);
  await closeSettings(page);
  await page.waitForTimeout(500);
  await shot(page, path.join(DIR, '22-activity-log.png'));
  // Turn off activity for clean subsequent shots
  await page.evaluate(() => {
    const cb = document.getElementById('tm-activity');
    if (cb && cb.checked) cb.click();
  });
  await page.waitForTimeout(300);

  // 16. Column toggle: hide MAC, then restore
  // Chips may be inside a collapsed section — use evaluate to click via DOM directly
  console.log('  [11] Column toggle…');
  await openSettings(page);
  // Ensure "Connections table" section is expanded
  await page.evaluate(() => {
    const labels = document.querySelectorAll('div[style*="font-weight:600"]');
    for (const el of labels) {
      if (el.textContent.includes('Connections table')) {
        const next = el.nextElementSibling;
        if (next && next.style.display === 'none') el.click();
        break;
      }
    }
  });
  await page.waitForTimeout(600);
  // Click MAC chip via DOM (bypasses Playwright visibility checks)
  const toggled = await page.evaluate(() => {
    for (const el of document.querySelectorAll('span[style*="border-radius"]')) {
      if (el.textContent.trim() === 'MAC') { el.click(); return true; }
    }
    return false;
  });
  if (toggled) {
    await page.waitForTimeout(500);
    await shot(page, path.join(DIR, '11-col-mac-hidden.png'));
    // Restore
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('span[style*="border-radius"]')) {
        if (el.textContent.trim() === 'MAC') { el.click(); return; }
      }
    });
    await page.waitForTimeout(400);
  }
  await closeSettings(page);

  // Helper: toggle #tm-extended via DOM click (works even when panel is collapsed)
  const setExtended = async (on) => {
    await page.evaluate(on => {
      const cb = document.getElementById('tm-extended');
      if (cb && cb.checked !== on) cb.click();
    }, on);
    await page.waitForTimeout(600);
  };

  // 13. Extended stats — all-devices view
  console.log('  [12] Extended stats (all devices)…');
  await setExtended(true);
  await closeSettings(page);
  await page.waitForTimeout(400);
  await shot(page, path.join(DIR, '12-extended-stats-all.png'));

  // 14. Extended stats — per-device with active limiter (shows real stats)
  console.log('  [13] Extended stats (per device)…');
  await selectDevice(page, phone.ip);
  await closeSettings(page);
  // Apply limiter so extended panel has data
  await pickOption(page, 'Off', '10 Mbit/s');
  await pickOption(page, 'Shaper (queue)', 'Limiter (drop)');
  await page.locator('button:has-text("Apply")').click();
  await waitDone(page);
  await page.waitForTimeout(800);
  await setExtended(true);
  await shot(page, path.join(DIR, '13-extended-stats-device.png'));
  // Remove limiter, disable extended
  await pickOption(page, '10 Mbit/s', 'Off');
  await page.locator('button:has-text("Apply")').click();
  await waitDone(page);
  await setExtended(false);

  // 15. Group by service
  console.log('  [14] Group by service…');
  await openSettings(page);
  await pickOption(page, 'None (per-flow)', 'Service');
  await page.waitForTimeout(800);
  await closeSettings(page);
  await page.waitForTimeout(400);
  await shot(page, path.join(DIR, '14-group-by-service.png'));

  // 16. Group by hostname
  console.log('  [15] Group by hostname…');
  await openSettings(page);
  await pickOption(page, 'Service', 'Hostname / Dst IP');
  await page.waitForTimeout(800);
  await closeSettings(page);
  await page.waitForTimeout(400);
  await shot(page, path.join(DIR, '15-group-by-host.png'));

  // Reset grouping
  await openSettings(page);
  await pickOption(page, 'Hostname / Dst IP', 'None (per-flow)');
  await page.waitForTimeout(500);
  await closeSettings(page);

  // 17. Searchable device picker — type a query, show filtered table
  console.log('  [16] Searchable device picker…');
  await gotoAllDevices(page);
  await setDark(page, dark);
  await page.waitForTimeout(1000);
  const searchInput = page.locator('input[placeholder*="Search"]');
  await searchInput.click();
  await searchInput.type('cam', { delay: 80 });
  await page.waitForTimeout(600);
  await shot(page, path.join(DIR, '16-search-filter.png'));
  await searchInput.clear();
  await page.waitForTimeout(400);

  // 18. WiFi/Link column — full overview scrolled to show band info clearly
  console.log('  [17] Link/band column…');
  await page.waitForTimeout(500);
  await shot(page, path.join(DIR, '17-link-band.png'));

  // 19. "?" tooltip for unreachable device (if any exist in the table)
  console.log('  [18] Unreachable ? tooltip…');
  const tooltipShot = await page.evaluate(() => {
    // Look for a link-badge cell showing "?" or a title/tooltip attribute on link badges
    for (const el of document.querySelectorAll('td span, td a')) {
      if (el.textContent.trim() === '?' || el.title) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  });
  if (tooltipShot) {
    await page.mouse.move(tooltipShot.x, tooltipShot.y);
    await page.waitForTimeout(800);
    await shot(page, path.join(DIR, '18-unreachable-tooltip.png'));
    await page.mouse.move(0, 0);
  } else {
    console.log('    (no unreachable device with tooltip found, skipping)');
  }
}

// ── main ───────────────────────────────────────────────────────────────────

(async () => {
  mkdirs();

  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx  = browser.contexts()[0];
  const page = ctx.pages()[0];

  await page.setViewportSize({ width: 1300, height: 820 });

  // Ensure we start on all-devices overview (not a remembered device detail)
  await gotoAllDevices(page);

  // Detect phone device from the table
  const phone = await findPhone(page);
  if (!phone) { console.error('No device found in table!'); process.exit(1); }
  console.log(`\nUsing device: ${phone.name} (${phone.ip})\n`);

  // Clean phone before dark theme
  await cleanPhone(page, phone.ip);
  await captureTheme(page, true,  phone);

  // Clean phone before light theme
  await cleanPhone(page, phone.ip);
  await captureTheme(page, false, phone);

  // Final cleanup
  await cleanPhone(page, phone.ip);
  await setDark(page, false);
  await gotoAllDevices(page);

  await browser.close();
  console.log('\n✓ All done. Files saved to docs/img/');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
