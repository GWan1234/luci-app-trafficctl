'use strict';
'require view';
'require fs';

var STORAGE_KEY = 'trafficctl_opts';

var SERVICE_PORTS = {
	20:'ftp-data', 21:'ftp', 22:'ssh', 23:'telnet', 25:'smtp',
	53:'dns', 80:'http', 110:'pop3', 143:'imap', 179:'bgp',
	443:'https', 465:'smtps', 587:'smtp', 853:'dns-tls',
	993:'imaps', 995:'pop3s', 1194:'openvpn', 3478:'stun',
	5222:'xmpp', 5228:'gcm', 8080:'http-alt', 8443:'https-alt',
	19302:'stun', 51820:'wireguard'
};

// CSS variables for theme support — defined in injectStyles(), reactive to LuCI dark mode
var C = {
	thBg:          'var(--tm-th-bg)',
	thFg:          'var(--tm-th-fg)',
	rowEven:       'var(--tm-bg)',
	rowOdd:        'var(--tm-bg-alt)',
	proto:         'var(--tm-proto)',
	hostname:      'var(--tm-text)',
	service:       'var(--tm-service)',
	stateOk:       'var(--tm-state-ok)',
	stateWait:     'var(--tm-state-wait)',
	stateClose:    'var(--tm-state-close)',
	optsBg:        'var(--tm-bg-subtle)',
	optsBorder:    'var(--tm-border)',
	infoBg:        'var(--tm-info-bg)',
	infoBorder:    'var(--tm-info-border)',
	infoFg:        'var(--tm-info-fg)',
	blockedBg:     'var(--tm-blocked-bg)',
	blockedBorder: 'var(--tm-blocked-border)',
	blockedFg:     'var(--tm-blocked-fg)',
	rateFg:        'var(--tm-rate-fg)',
	textMute:      'var(--tm-text-mute)',
	textFaint:     'var(--tm-text-faint)',
	border:        'var(--tm-border)',
	speedFg:       'var(--tm-speed)',
	mac:           'var(--tm-text-mute)',
	dropFg:        'var(--tm-drop-fg)',
	shapeFg:       'var(--tm-shape-fg)'
};

var RATE_PRESETS = [
	{v:'0',      l:'Off'},
	{v:'1000',   l:'1 Mbit/s'},
	{v:'2000',   l:'2 Mbit/s'},
	{v:'5000',   l:'5 Mbit/s'},
	{v:'10000',  l:'10 Mbit/s'},
	{v:'25000',  l:'25 Mbit/s'},
	{v:'50000',  l:'50 Mbit/s'},
	{v:'100000', l:'100 Mbit/s'},
	{v:'custom', l:'Custom…'}
];

var GROUP_OPTS = [
	{v:'none',    l:'None (per-flow)'},
	{v:'host',    l:'Hostname / Dst IP'},
	{v:'service', l:'Service'},
	{v:'port',    l:'Port'},
	{v:'proto',   l:'Protocol'}
];

function loadOpts() {
	try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}'); }
	catch(e) { return {}; }
}
function saveOpts(o) {
	try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(o)); } catch(e) {}
}
function fmtBytes(b) {
	if (b == null || isNaN(b)) return '—';
	if (b < 1024) return b + ' B';
	if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
	if (b < 1073741824) return (b/1048576).toFixed(2) + ' MB';
	return (b/1073741824).toFixed(2) + ' GB';
}
function fmtSpeed(bps) {
	if (!bps || bps < 1) return '—';
	if (bps < 1024) return bps.toFixed(0) + ' B/s';
	if (bps < 1048576) return (bps/1024).toFixed(1) + ' KB/s';
	if (bps < 1073741824) return (bps/1048576).toFixed(2) + ' MB/s';
	return (bps/1073741824).toFixed(2) + ' GB/s';
}
function fmtRate(kbit) {
	if (!kbit || kbit <= 0) return '—';
	var mbit = kbit / 1000;
	if (mbit >= 1) return (mbit % 1 === 0 ? mbit.toFixed(0) : mbit.toFixed(1)) + ' Mbit/s';
	return kbit + ' kbit/s';
}
function escHtml(s) {
	return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function injectStyles() {
	if (document.getElementById('tm-style')) return;
	var s = document.createElement('style');
	s.id = 'tm-style';
	s.textContent =
		':root {' +
			'--tm-bg:        #ffffff;' +
			'--tm-bg-alt:    #f7fafc;' +
			'--tm-bg-subtle: #f7f8fa;' +
			'--tm-text:      #1a202c;' +
			'--tm-text-mute: #718096;' +
			'--tm-text-faint:#a0aec0;' +
			'--tm-border:    #e2e8f0;' +
			'--tm-th-bg:     #4a5568;' +
			'--tm-th-fg:     #ffffff;' +
			'--tm-proto:     #2b6cb0;' +
			'--tm-service:   #805ad5;' +
			'--tm-state-ok:  #276749;' +
			'--tm-state-wait:#c53030;' +
			'--tm-state-close:#c05621;' +
			'--tm-info-bg:   #ebf8ff;' +
			'--tm-info-border:#90cdf4;' +
			'--tm-info-fg:   #2c5282;' +
			'--tm-blocked-bg:#fff5f5;' +
			'--tm-blocked-border:#fc8181;' +
			'--tm-blocked-fg:#c53030;' +
			'--tm-rate-fg:   #c05621;' +
			'--tm-drop-fg:   #9b2c2c;' +
			'--tm-speed:     #3182ce;' +
			'--tm-shape-fg:  #2b6cb0;' +
			'--tm-hover:     #ebf8ff;' +
		'}' +
		':root[data-darkmode="true"],' +
		'html[data-darkmode="true"],' +
		'body.dark, .dark {' +
			'--tm-bg:        #1e1e1e;' +
			'--tm-bg-alt:    #262626;' +
			'--tm-bg-subtle: #242424;' +
			'--tm-text:      #e2e8f0;' +
			'--tm-text-mute: #a0aec0;' +
			'--tm-text-faint:#718096;' +
			'--tm-border:    #3a3a3a;' +
			'--tm-th-bg:     #2d3748;' +
			'--tm-th-fg:     #e2e8f0;' +
			'--tm-proto:     #63b3ed;' +
			'--tm-service:   #b794f4;' +
			'--tm-state-ok:  #68d391;' +
			'--tm-state-wait:#fc8181;' +
			'--tm-state-close:#f6ad55;' +
			'--tm-info-bg:   #1a365d;' +
			'--tm-info-border:#2c5282;' +
			'--tm-info-fg:   #bee3f8;' +
			'--tm-blocked-bg:#3d1818;' +
			'--tm-blocked-border:#9b2c2c;' +
			'--tm-blocked-fg:#fc8181;' +
			'--tm-rate-fg:   #f6ad55;' +
			'--tm-drop-fg:   #fc8181;' +
			'--tm-speed:     #63b3ed;' +
			'--tm-shape-fg:  #63b3ed;' +
			'--tm-hover:     #2d3748;' +
		'}' +
		'@keyframes tm-spin{to{transform:rotate(360deg)}}' +
		'@keyframes tm-pulse{0%,100%{opacity:.5}50%{opacity:1}}' +
		'.tm-spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--tm-border);' +
		'border-top-color:var(--tm-text);border-radius:50%;animation:tm-spin .7s linear infinite;' +
		'vertical-align:middle;margin-right:6px}' +
		'.tm-speed-active{color:var(--tm-speed)!important;font-weight:600}' +
		'.tm-speed-idle{color:var(--tm-text-faint)!important}' +
		'tr.tm-row:hover td{background:var(--tm-hover)!important;cursor:pointer}' +
		'.tm-link{color:inherit;text-decoration:none;border-bottom:1px dotted var(--tm-text-faint)}' +
		'.tm-link:hover{border-bottom-style:solid}';
	document.head.appendChild(s);
}

var TH = 'cursor:pointer;padding:7px 12px;white-space:nowrap;background:' + C.thBg +
         ';color:' + C.thFg + ';border:none;font-size:12px;font-weight:600;user-select:none;text-align:left';

var PRIVATE_RE = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;

// Aggregate connections by a field. Returns array of {key, count, bytes, tcp, udp}.
function groupConnections(conns, groupBy) {
	if (groupBy === 'none') return null;
	var keyFn;
	switch(groupBy) {
		case 'host':    keyFn = function(c){ return c.host || c.dst || '?'; }; break;
		case 'service': keyFn = function(c){ return c.service || SERVICE_PORTS[c.port] || ('port '+c.port); }; break;
		case 'port':    keyFn = function(c){ return String(c.port); }; break;
		case 'proto':   keyFn = function(c){ return c.proto || '?'; }; break;
		default:        return null;
	}
	var groups = {};
	conns.forEach(function(c) {
		var k = keyFn(c);
		if (!groups[k]) groups[k] = {key: k, count: 0, bytes: 0, tcp: 0, udp: 0, sample: c};
		groups[k].count++;
		groups[k].bytes += (c.bytes || 0);
		if (c.proto === 'tcp') groups[k].tcp++;
		else if (c.proto === 'udp') groups[k].udp++;
	});
	return Object.keys(groups).map(function(k){ return groups[k]; });
}

function buildGroupedTable(groups, sortCol, sortDir) {
	var cols = [
		{ key:'key',   label:'Group', num:false },
		{ key:'count', label:'Conns', num:true  },
		{ key:'tcp',   label:'TCP',   num:true  },
		{ key:'udp',   label:'UDP',   num:true  },
		{ key:'bytes', label:'Bytes', num:true  }
	];

	var sorted = groups.slice().sort(function(a, b) {
		var av = a[sortCol], bv = b[sortCol];
		if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
		av = String(av||''); bv = String(bv||'');
		return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
	});

	var thead = E('thead', {}, E('tr', {}, cols.map(function(c) {
		var arrow = c.key === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
		return E('th', { 'style': TH, 'data-col': c.key, 'data-num': c.num ? '1' : '0' }, c.label + arrow);
	})));

	var tbody = E('tbody', {}, sorted.map(function(r, i) {
		var bg = i%2===0 ? C.rowEven : C.rowOdd;
		var td = 'padding:6px 12px;border-bottom:1px solid '+C.border+';color:'+C.hostname+';font-size:12px;background:'+bg;
		return E('tr', { 'class': 'tm-row' }, [
			E('td', { 'style': td+';font-weight:500;color:'+C.proto }, escHtml(r.key)),
			E('td', { 'style': td+';text-align:right;font-weight:600' }, String(r.count)),
			E('td', { 'style': td+';text-align:right;color:'+C.proto }, String(r.tcp)),
			E('td', { 'style': td+';text-align:right;color:'+C.stateClose }, String(r.udp)),
			E('td', { 'style': td+';text-align:right;font-family:monospace;font-weight:500' }, fmtBytes(r.bytes))
		]);
	}));

	return E('table', {
		'style': 'width:100%;border-collapse:collapse;font-size:12px;border:1px solid '+C.border+';border-radius:4px;overflow:hidden'
	}, [thead, tbody]);
}

function buildTable(conns, sortCol, sortDir, rdnsMode) {
	var cols = [
		{ key:'proto',   label:'Proto',    num:false },
		{ key:'dst',     label:'Dst IP',   num:false },
		{ key:'host',    label:'Hostname', num:false },
		{ key:'port',    label:'Port',     num:true  },
		{ key:'service', label:'Service',  num:false },
		{ key:'bytes',   label:'Bytes',    num:true  },
		{ key:'state',   label:'State',    num:false }
	];

	var sorted = conns.slice().sort(function(a, b) {
		var av = a[sortCol], bv = b[sortCol];
		if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
		av = String(av||''); bv = String(bv||'');
		return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
	});

	var thead = E('thead', {}, E('tr', {}, cols.map(function(c) {
		var arrow = c.key === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
		return E('th', { 'style': TH, 'data-col': c.key, 'data-num': c.num ? '1' : '0' }, c.label + arrow);
	})));

	var tbody = E('tbody', {}, sorted.map(function(r, i) {
		var state = escHtml(r.state || '');
		var sc = state === 'ESTABLISHED' ? C.stateOk : state === 'TIME_WAIT' ? C.stateWait : state === 'CLOSE_WAIT' ? C.stateClose : C.hostname;
		var bg = i%2===0 ? C.rowEven : C.rowOdd;
		var td = 'padding:5px 12px;border-bottom:1px solid '+C.border+';color:'+C.hostname+';font-size:12px;background:'+bg;

		var dst = r.dst || '';
		var isExternal = dst && !PRIVATE_RE.test(dst);
		var dstEl = dst
			? E('a', { 'href': 'https://ipinfo.io/'+dst, 'target': '_blank', 'rel': 'noopener noreferrer',
			           'class':'tm-link', 'onclick': 'event.stopPropagation()' }, dst)
			: '';

		var hostCell = E('td', { 'style': td+';color:'+C.hostname, 'data-dst': dst });
		if (r.host) {
			hostCell.textContent = r.host;
		} else if (rdnsMode && isExternal) {
			hostCell.innerHTML = '<span style="color:'+C.textFaint+';font-style:italic">resolving…</span>';
		} else {
			hostCell.textContent = '—';
		}

		return E('tr', { 'class': 'tm-row' }, [
			E('td', { 'style': td+';color:'+C.proto+';font-weight:600'                     }, r.proto || ''),
			E('td', { 'style': td+';font-family:monospace'                                 }, dstEl),
			hostCell,
			E('td', { 'style': td+';text-align:right;font-family:monospace'                }, String(r.port || '')),
			E('td', { 'style': td+';color:'+C.service                                      }, escHtml(r.service || (SERVICE_PORTS[r.port]||''))),
			E('td', { 'style': td+';text-align:right;font-family:monospace;font-weight:500'}, fmtBytes(r.bytes)),
			E('td', { 'style': td+';color:'+sc+';font-weight:500'                          }, state)
		]);
	}));

	return E('table', {
		'style': 'width:100%;border-collapse:collapse;font-size:12px;border:1px solid '+C.border+';border-radius:4px;overflow:hidden'
	}, [thead, tbody]);
}

function buildSummaryTable(rows, sortCol, sortDir, onSort, onSelect, speedMap, dropMap, shapeMap) {
	var cols = [
		{ key:'name',             label:'Device',     num:false },
		{ key:'ip',               label:'IP',         num:false },
		{ key:'mac',              label:'MAC',        num:false },
		{ key:'_speed',           label:'DL Speed',   num:true  },
		{ key:'total',            label:'Conns',      num:true  },
		{ key:'tcp',              label:'TCP',        num:true  },
		{ key:'udp',              label:'UDP',        num:true  },
		{ key:'blocked',          label:'Inet',       num:false },
		{ key:'wifi_blocked',     label:'WiFi',       num:false },
		{ key:'_throttle_kbit',   label:'Throttle',   num:true  },
		{ key:'_drop_packets',    label:'Dropped',    num:true  },
		{ key:'_backlog',         label:'Queued',     num:true  }
	];

	function ipToInt(s) {
		var p = String(s||'').split('.');
		if (p.length !== 4) return 0;
		return ((parseInt(p[0])||0)*16777216 + (parseInt(p[1])||0)*65536 + (parseInt(p[2])||0)*256 + (parseInt(p[3])||0));
	}

	// Attach current speed to each row from speedMap (if any)
	speedMap = speedMap || {};
	dropMap  = dropMap  || {};
	shapeMap = shapeMap || {};
	rows.forEach(function(r) {
		var s = speedMap[r.ip];
		r._speed = s ? s.current : 0;
		var d = dropMap[r.ip];
		r._drop_packets = d ? d.packets : 0;
		r._drop_bytes   = d ? d.bytes   : 0;
		var sh = shapeMap[r.ip];
		r._backlog = sh ? sh.backlog : 0;
		// Unified throttle: prefer shape if active, else limiter
		r._throttle_kbit = (r.shape_kbit || 0) > 0 ? r.shape_kbit : (r.rate_limit_kbit || 0);
		r._throttle_mode = (r.shape_kbit || 0) > 0 ? 'shaper' : ((r.rate_limit_kbit || 0) > 0 ? 'limiter' : 'none');
	});

	var sorted = rows.slice().sort(function(a, b) {
		var av = a[sortCol], bv = b[sortCol];
		if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
		if (typeof av === 'boolean') return sortDir === 'asc' ? (av?1:0)-(bv?1:0) : (bv?1:0)-(av?1:0);
		if (sortCol === 'ip') {
			var d = ipToInt(av) - ipToInt(bv);
			return sortDir === 'asc' ? d : -d;
		}
		av = String(av||''); bv = String(bv||'');
		return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
	});

	var thead = E('thead', {}, E('tr', {}, cols.map(function(c) {
		var arrow = c.key === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
		var th = E('th', { 'style': TH, 'data-col': c.key, 'data-num': c.num ? '1' : '0' }, c.label + arrow);
		th.addEventListener('click', function() { onSort(c.key, c.num); });
		return th;
	})));

	var tbody = E('tbody', {}, sorted.map(function(r, i) {
		var bg = i%2===0 ? C.rowEven : C.rowOdd;
		var td = 'padding:6px 12px;border-bottom:1px solid '+C.border+';color:'+C.hostname+';font-size:12px;background:'+bg;
		var inetBadge = r.blocked
			? E('span', { 'style': 'color:'+C.blockedFg+';font-weight:600' }, '⛔ blocked')
			: E('span', { 'style': 'color:'+C.stateOk }, '✓ ok');
		var wifiBadge = r.wifi_blocked
			? E('span', { 'style': 'color:'+C.stateWait+';font-weight:600' }, '📵 blocked')
			: E('span', { 'style': 'color:'+C.textFaint }, '—');
		var throttleBadge;
		if (r._throttle_mode === 'shaper') {
			throttleBadge = E('span', { 'style': 'color:'+C.shapeFg+';font-weight:600', 'title': 'Shaper (tc/HTB queue)' }, '🌊 ' + fmtRate(r._throttle_kbit));
		} else if (r._throttle_mode === 'limiter') {
			throttleBadge = E('span', { 'style': 'color:'+C.rateFg+';font-weight:600', 'title': 'Limiter (nft drop)' }, '⚡ ' + fmtRate(r._throttle_kbit));
		} else {
			throttleBadge = E('span', { 'style': 'color:'+C.textFaint }, '—');
		}

		var dp = r._drop_packets || 0;
		var dropBadge = dp > 0
			? E('span', {
				'style': 'color:'+C.dropFg+';font-weight:600',
				'title': fmtBytes(r._drop_bytes || 0) + ' dropped'
			}, '🚫 ' + dp)
			: E('span', { 'style': 'color:'+C.textFaint }, '—');

		var bl = r._backlog || 0;
		var backlogBadge = bl > 0
			? E('span', { 'style': 'color:'+C.shapeFg+';font-weight:600', 'title': 'Bytes queued in tc' }, fmtBytes(bl))
			: E('span', { 'style': 'color:'+C.textFaint }, '—');

		var macEl = r.mac
			? E('a', {
				'href': '/cgi-bin/luci/admin/network/dhcp',
				'target': '_blank',
				'rel': 'noopener',
				'class': 'tm-link',
				'title': 'Open DHCP/DNS bindings',
				'onclick': 'event.stopPropagation()'
			}, r.mac)
			: '';

		// Speed cell (initially —, updated by background polling)
		var sd = speedMap[r.ip];
		var speedCell = E('td', {
			'style': td+';text-align:right;font-family:monospace',
			'data-speed-ip': r.ip,
			'title': sd ? ('Avg: '+fmtSpeed(sd.avg)+' / Max: '+fmtSpeed(sd.max)) : 'Calculating…'
		});
		if (sd && sd.current > 1024) {
			speedCell.className = 'tm-speed-active';
			speedCell.textContent = fmtSpeed(sd.current);
		} else {
			speedCell.className = 'tm-speed-idle';
			speedCell.textContent = sd ? fmtSpeed(sd.current) : '—';
		}

		var row = E('tr', { 'class': 'tm-row', 'title': 'Click to inspect ' + r.name }, [
			E('td', { 'style': td+';font-weight:600;color:'+C.proto  }, escHtml(r.name)),
			E('td', { 'style': td+';font-family:monospace'           }, escHtml(r.ip)),
			E('td', { 'style': td+';font-family:monospace;color:'+C.mac+';font-size:11px' }, macEl || ''),
			speedCell,
			E('td', { 'style': td+';text-align:right;font-weight:600'}, String(r.total)),
			E('td', { 'style': td+';text-align:right;color:'+C.proto }, String(r.tcp)),
			E('td', { 'style': td+';text-align:right;color:'+C.stateClose }, String(r.udp)),
			E('td', { 'style': td+';text-align:center'               }, inetBadge),
			E('td', { 'style': td+';text-align:center'               }, wifiBadge),
			E('td', { 'style': td+';text-align:center'               }, throttleBadge),
			E('td', { 'style': td+';text-align:center', 'data-drop-ip': r.ip }, dropBadge),
			E('td', { 'style': td+';text-align:center', 'data-backlog-ip': r.ip }, backlogBadge)
		]);
		row.addEventListener('click', function() { onSelect(r.ip, r.name); });
		return row;
	}));

	return E('table', {
		'style': 'width:100%;border-collapse:collapse;font-size:12px;border:1px solid '+C.border+';border-radius:4px;overflow:hidden'
	}, [thead, tbody]);
}

function setStatus(el, type, msg) {
	var styles = {
		loading: 'background:var(--tm-info-bg);border:1px solid var(--tm-info-border);color:var(--tm-info-fg)',
		ok:      'background:var(--tm-info-bg);border:1px solid var(--tm-state-ok);color:var(--tm-state-ok)',
		error:   'background:var(--tm-blocked-bg);border:1px solid var(--tm-blocked-border);color:var(--tm-blocked-fg)',
		action:  'background:var(--tm-info-bg);border:1px solid var(--tm-rate-fg);color:var(--tm-rate-fg)'
	};
	el.style.cssText = 'padding:8px 14px;border-radius:4px;font-size:13px;margin-bottom:10px;' + (styles[type]||styles.ok);
	el.innerHTML = type === 'loading' ? '<span class="tm-spinner"></span>'+escHtml(msg) : escHtml(msg);
	el.style.display = '';
}

return view.extend({
	_timer:        null,
	_bytesTimer:   null,
	_dropTimer:    null,
	_shapeTimer:   null,
	_bytesHistory: {},  // ip -> {bytes_in, bytes_out, time}
	_speedHistory: {},  // ip -> array of last N {speed, time}
	_speedMap:     {},  // ip -> {current, avg, max} (for sorting and initial render)
	_dropMap:      {},  // ip -> {packets, bytes} cumulative drop counters from nft
	_shapeMap:     {},  // ip -> {packets, bytes, backlog, rate_kbit} from tc/HTB
	_sortCol:    'bytes',
	_sortDir:    'desc',
	_sumCol:     '_speed',
	_sumDir:     'desc',

	load: function() {
		return fs.read('/tmp/dhcp.leases').catch(function() { return ''; });
	},

	render: function(leasesRaw) {
		var self = this;
		var opts = loadOpts();
		injectStyles();

		// Parse DHCP leases
		var devices = [];
		(leasesRaw || '').split('\n').forEach(function(line) {
			var p = line.trim().split(/\s+/);
			if (p.length >= 4 && p[2] && p[3] && p[3] !== '*') {
				devices.push({ ip: p[2], name: p[3] });
			}
		});
		devices.sort(function(a, b) { return a.name.localeCompare(b.name); });

		var select = E('select', { 'class': 'cbi-input-select', 'style': 'min-width:280px' },
			[E('option', { 'value': '__all__' }, '— All active devices —')]
			.concat(devices.map(function(d) {
				return E('option', { 'value': d.ip }, d.name + '  —  ' + d.ip);
			}))
		);
		var savedIp = opts.lastIp || '__all__';
		Array.prototype.forEach.call(select.options, function(o) {
			if (o.value === savedIp) o.selected = true;
		});

		function mkCheck(id, label, checked, onChange) {
			var cb = E('input', { 'type': 'checkbox', 'id': id, 'style': 'margin-right:4px' });
			cb.checked = !!checked;
			cb.addEventListener('change', onChange);
			return E('label', { 'style': 'margin-right:16px;cursor:pointer;white-space:nowrap;color:'+C.hostname+';font-size:13px' }, [cb, label]);
		}
		function mkLabel(t) {
			return E('span', { 'style': 'color:'+C.textMute+';font-size:12px;margin-right:4px' }, t);
		}

		var showStats = mkCheck('tm-stats', 'Stats', opts.showStats !== false, function() {
			var o = loadOpts(); o.showStats = this.checked; saveOpts(o);
			statsDiv.style.display = this.checked ? '' : 'none';
		});
		var showConns = mkCheck('tm-conns', 'Connections', opts.showConns !== false, function() {
			var o = loadOpts(); o.showConns = this.checked; saveOpts(o);
			connsDiv.style.display = this.checked ? '' : 'none';
		});
		var rdnsCheck = mkCheck('tm-rdns', 'Reverse DNS', opts.rdns, function() {
			var o = loadOpts(); o.rdns = this.checked; saveOpts(o);
		});

		var refreshSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option',{'value':'0'},'Off'), E('option',{'value':'5'},'5s'),
			E('option',{'value':'10'},'10s'), E('option',{'value':'30'},'30s'),
			E('option',{'value':'60'},'60s')
		]);
		Array.prototype.forEach.call(refreshSel.options, function(o) {
			if (o.value === String(opts.refresh||0)) o.selected = true;
		});
		refreshSel.addEventListener('change', function() {
			var o = loadOpts(); o.refresh = parseInt(this.value); saveOpts(o); self._setupTimer();
		});

		var protoSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option',{'value':'all'},'All'), E('option',{'value':'tcp'},'TCP only'), E('option',{'value':'udp'},'UDP only')
		]);
		Array.prototype.forEach.call(protoSel.options, function(o) {
			if (o.value === (opts.proto||'all')) o.selected = true;
		});
		protoSel.addEventListener('change', function() {
			var o = loadOpts(); o.proto = this.value; saveOpts(o);
		});

		// Group-by selector (per-device view)
		var groupSel = E('select', { 'class': 'cbi-input-select' },
			GROUP_OPTS.map(function(g){ return E('option', {'value': g.v}, g.l); })
		);
		Array.prototype.forEach.call(groupSel.options, function(o) {
			if (o.value === (opts.groupBy||'none')) o.selected = true;
		});
		groupSel.addEventListener('change', function() {
			var o = loadOpts(); o.groupBy = this.value; saveOpts(o); runQuery();
		});

		// Output areas
		var statusDiv = E('div', { 'style': 'display:none' });
		var statsDiv  = E('div', { 'style': 'margin:8px 0' + (opts.showStats===false?';display:none':'') });
		var connsDiv  = E('div', { 'style': opts.showConns===false?'display:none':'' });

		var blockBtn   = E('button', { 'class': 'cbi-button cbi-button-negative' }, '⛔ Block');
		var unblockBtn = E('button', { 'class': 'cbi-button cbi-button-action'   }, '✅ Unblock');
		var wifiBtn = E('button', { 'class': 'cbi-button', 'style': 'display:none' }, '');

		function updateWifiBtn(wifiBlocked, hasMac) {
			if (!hasMac) { wifiBtn.style.display = 'none'; return; }
			wifiBtn.style.display = '';
			wifiBtn.disabled = false;
			if (wifiBlocked) {
				wifiBtn.textContent = '📶 WiFi Unblock';
				wifiBtn.style.cssText = 'background:#22c55e;color:#fff;border:1px solid #16a34a;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:13px';
				wifiBtn._wifiAction = 'unblock';
			} else {
				wifiBtn.textContent = '📵 WiFi Block';
				wifiBtn.style.cssText = 'background:#f97316;color:#fff;border:1px solid #ea580c;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:13px';
				wifiBtn._wifiAction = 'block';
			}
		}

		// Speed Limit row with Custom support
		var rateSel = E('select', { 'class': 'cbi-input-select' },
			RATE_PRESETS.map(function(p) { return E('option', { 'value': p.v }, p.l); })
		);
		var customInput = E('input', { 'type':'number', 'min':'1', 'step':'1', 'placeholder':'value',
			'class':'cbi-input-text', 'style':'width:90px;display:none' });
		var customUnit = E('select', { 'class':'cbi-input-select', 'style':'display:none' }, [
			E('option', {'value':'mbit'}, 'Mbit/s'),
			E('option', {'value':'kbit'}, 'kbit/s')
		]);
		var modeSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'limiter' }, 'Limiter (drop)'),
			E('option', { 'value': 'shaper'  }, 'Shaper (queue)')
		]);
		var rateBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, 'Apply');

		rateSel.addEventListener('change', function() {
			var isCustom = this.value === 'custom';
			customInput.style.display = isCustom ? '' : 'none';
			customUnit.style.display  = isCustom ? '' : 'none';
		});

		var rateLimitRow = E('div', {
			'style': 'display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap'
		}, [mkLabel('Speed Limit:'), rateSel, customInput, customUnit, mkLabel('Mode:'), modeSel, rateBtn]);

		function getRateKbit() {
			var v = rateSel.value;
			if (v !== 'custom') return v;
			var n = parseFloat(customInput.value);
			if (!n || n <= 0) return '0';
			if (customUnit.value === 'mbit') return String(Math.round(n * 1000));
			return String(Math.round(n));
		}

		var actionRow = E('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px' },
			[blockBtn, unblockBtn, wifiBtn]);
		var perDeviceOpts = E('span', {}, [mkLabel('Proto:'), protoSel,
			E('span',{'style':'display:inline-block;width:8px'}),
			mkLabel('Group by:'), groupSel,
			E('span',{'style':'display:inline-block;width:8px'}),
			rdnsCheck]);

		function isAllMode() { return select.value === '__all__'; }

		function updateModeUI() {
			var all = isAllMode();
			actionRow.style.display     = all ? 'none' : '';
			rateLimitRow.style.display  = all ? 'none' : '';
			perDeviceOpts.style.display = all ? 'none' : '';
		}

		// ── Background bandwidth polling (only in all-devices mode) ───────
		function updateSpeedCells() {
			Object.keys(self._speedMap).forEach(function(ip) {
				var s = self._speedMap[ip];
				var cell = connsDiv.querySelector('td[data-speed-ip="'+ip+'"]');
				if (!cell) return;
				if (s.current > 1024) {
					cell.className = 'tm-speed-active';
				} else {
					cell.className = 'tm-speed-idle';
				}
				cell.textContent = fmtSpeed(s.current);
				cell.title = 'Avg: '+fmtSpeed(s.avg)+' / Max: '+fmtSpeed(s.max);
			});
		}

		function pollDrops() {
			if (document.hidden) return;
			if (!isAllMode()) return;
			fs.exec_direct('/usr/local/bin/trafficctl-ratelimit-stats.sh', [])
				.then(function(raw) {
					var data; try { data = JSON.parse(raw); } catch(e) { return; }
					data.forEach(function(d) {
						self._dropMap[d.ip] = { packets: d.packets, bytes: d.bytes, rate_kbit: d.rate_kbit };
					});
					// Update drop cells in place
					Object.keys(self._dropMap).forEach(function(ip) {
						var dp = self._dropMap[ip].packets || 0;
						var db = self._dropMap[ip].bytes   || 0;
						var cell = connsDiv.querySelector('td[data-drop-ip="'+ip+'"]');
						if (!cell) return;
						while (cell.firstChild) cell.removeChild(cell.firstChild);
						if (dp > 0) {
							cell.appendChild(E('span', {
								'style': 'color:'+C.dropFg+';font-weight:600',
								'title': fmtBytes(db) + ' dropped'
							}, '🚫 ' + dp));
						} else {
							cell.appendChild(E('span', { 'style': 'color:'+C.textFaint }, '—'));
						}
					});
				})
				.catch(function(){});
		}

		function pollShapeStats() {
			if (document.hidden) return;
			if (!isAllMode()) return;
			fs.exec_direct('/usr/local/bin/trafficctl-shape-stats.sh', [])
				.then(function(raw) {
					var data; try { data = JSON.parse(raw); } catch(e) { return; }
					data.forEach(function(d) {
						self._shapeMap[d.ip] = { packets: d.packets, bytes: d.bytes, backlog: d.backlog, rate_kbit: d.rate_kbit };
					});
					// Update backlog cells in place
					Object.keys(self._shapeMap).forEach(function(ip) {
						var bl = self._shapeMap[ip].backlog || 0;
						var cell = connsDiv.querySelector('td[data-backlog-ip="'+ip+'"]');
						if (!cell) return;
						while (cell.firstChild) cell.removeChild(cell.firstChild);
						if (bl > 0) {
							cell.appendChild(E('span', { 'style': 'color:'+C.shapeFg+';font-weight:600', 'title': 'Bytes queued in tc' }, fmtBytes(bl)));
						} else {
							cell.appendChild(E('span', { 'style': 'color:'+C.textFaint }, '—'));
						}
					});
				})
				.catch(function(){});
		}

		function pollBytes() {
			if (document.hidden) return;
			if (!isAllMode()) return;
			fs.exec_direct('/usr/local/bin/trafficctl-bytes.sh', [])
				.then(function(raw) {
					var data; try { data = JSON.parse(raw); } catch(e) { return; }
					var now = Date.now();
					data.forEach(function(d) {
						var prev = self._bytesHistory[d.ip];
						if (prev) {
							var dt = (now - prev.time) / 1000;
							if (dt < 0.5) return;
							var dIn = d.bytes_in - prev.bytes_in;
							if (dIn < 0) dIn = 0;
							var speed = dIn / dt;
							if (!self._speedHistory[d.ip]) self._speedHistory[d.ip] = [];
							self._speedHistory[d.ip].push({speed: speed, time: now});
							if (self._speedHistory[d.ip].length > 30) self._speedHistory[d.ip].shift();
							var hist = self._speedHistory[d.ip];
							var sum = 0, max = 0;
							hist.forEach(function(h){ sum += h.speed; if (h.speed > max) max = h.speed; });
							self._speedMap[d.ip] = {
								current: speed,
								avg: sum / hist.length,
								max: max
							};
						}
						self._bytesHistory[d.ip] = {
							bytes_in: d.bytes_in,
							bytes_out: d.bytes_out,
							time: now
						};
					});
					updateSpeedCells();
				})
				.catch(function(){});
		}

		// ── Run single device ──────────────────────────────────────────────
		function runSingle(ip) {
			var o = loadOpts();
			var params = [ip];
			if (o.proto && o.proto !== 'all') { params.push('--proto'); params.push(o.proto); }

			runBtn.disabled = true;
			setStatus(statusDiv, 'loading', 'Running…');

			fs.exec_direct('/usr/local/bin/trafficctl-device.sh', params)
				.then(function(raw) {
					var data; try { data = JSON.parse(raw); } catch(e) {
						setStatus(statusDiv, 'error', 'Parse error: ' + raw.slice(0,120)); return;
					}

					if (opts.showStats !== false) {
						var parts = ['Connections: <b>'+data.total+'</b>'];
						if (data.total > 0) {
							parts.push('TCP: <b>'+(data.protocols.tcp||0)+'</b>');
							parts.push('UDP: <b>'+(data.protocols.udp||0)+'</b>');
							if (data.tcp_states) {
								Object.keys(data.tcp_states).forEach(function(s) {
									parts.push(escHtml(s)+': <b>'+data.tcp_states[s]+'</b>');
								});
							}
						}
						if ((data.shape_kbit || 0) > 0) {
							parts.push('Shaped: <b style="color:'+C.shapeFg+'">🌊 '+fmtRate(data.shape_kbit)+'</b>');
							var sm = self._shapeMap[data.ip || select.value] || {};
							if ((sm.backlog||0) > 0) parts.push('Queued: <b style="color:'+C.shapeFg+'">'+fmtBytes(sm.backlog)+'</b>');
							if ((sm.bytes||0) > 0) parts.push('Passed: <b>'+fmtBytes(sm.bytes)+'</b>');
						} else if ((data.rate_limit_kbit || 0) > 0) {
							parts.push('Speed limit: <b style="color:'+C.rateFg+'">⚡ '+fmtRate(data.rate_limit_kbit)+'</b>');
							var dm = self._dropMap[data.ip || select.value] || {};
							if ((dm.packets||0) > 0) {
								parts.push('Dropped: <b style="color:'+C.dropFg+'">🚫 '+dm.packets+' pkts / '+fmtBytes(dm.bytes||0)+'</b>');
							}
						}
						var wifiPart = data.wifi_blocked
							? ' &nbsp;|&nbsp; <b style="color:'+C.stateWait+'">📵 WiFi blocked</b> ('+escHtml(data.mac||'') + ')'
							: (data.mac ? ' &nbsp;|&nbsp; <span style="color:'+C.textFaint+'">MAC: '+escHtml(data.mac)+'</span>' : '');
						statsDiv.style.cssText = 'padding:8px 14px;border-radius:4px;font-size:13px;margin-bottom:8px;' +
							(data.blocked ? 'background:'+C.blockedBg+';border:1px solid '+C.blockedBorder+';color:'+C.blockedFg
							             : 'background:'+C.infoBg   +';border:1px solid '+C.infoBorder+';color:'+C.infoFg);
						statsDiv.innerHTML = (data.blocked
							? '<b>⛔ BLOCKED</b> — '+data.block_packets+' pkts, '+fmtBytes(data.block_bytes)+' dropped &nbsp;|&nbsp; '
							: '') + parts.join(' &nbsp;|&nbsp; ') + wifiPart +
							' &nbsp;<span style="color:'+C.textFaint+';font-size:11px">'+escHtml(data.timestamp)+'</span>';
					}

					blockBtn.disabled   = data.blocked;
					unblockBtn.disabled = !data.blocked;
					updateWifiBtn(data.wifi_blocked, !!data.mac);

					// Sync rate/mode selectors from backend state
					var curShapeRate = data.shape_kbit || 0;
					var curLimitRate = data.rate_limit_kbit || 0;
					var curRate = curShapeRate > 0 ? curShapeRate : curLimitRate;
					modeSel.value = curShapeRate > 0 ? 'shaper' : 'limiter';

					var curRateStr = String(curRate);
					var matched = false;
					Array.prototype.forEach.call(rateSel.options, function(o) {
						if (o.value === curRateStr) { o.selected = true; matched = true; }
					});
					if (!matched && curRate > 0) {
						Array.prototype.forEach.call(rateSel.options, function(o) {
							if (o.value === 'custom') o.selected = true;
						});
						customInput.value = curRate * 8;
						customUnit.value = 'kbit';
						customInput.style.display = '';
						customUnit.style.display = '';
					} else if (matched) {
						customInput.style.display = 'none';
						customUnit.style.display = 'none';
					} else {
						rateSel.options[0].selected = true;
						customInput.style.display = 'none';
						customUnit.style.display = 'none';
					}

					while (connsDiv.firstChild) connsDiv.removeChild(connsDiv.firstChild);
					if (!data.connections || data.connections.length === 0) {
						connsDiv.appendChild(E('p', {'style':'color:'+C.textMute+';padding:12px 0'}, 'No active connections.'));
					} else {
						var groupBy = o.groupBy || 'none';
						var tbl;
						if (groupBy !== 'none') {
							var groups = groupConnections(data.connections, groupBy);
							tbl = buildGroupedTable(groups, self._sortCol === 'bytes' || self._sortCol === 'count' ? self._sortCol : 'bytes', self._sortDir);
							Array.prototype.forEach.call(tbl.querySelectorAll('th'), function(th) {
								th.addEventListener('click', function() {
									var col = th.getAttribute('data-col');
									if (self._sortCol === col) {
										self._sortDir = self._sortDir === 'asc' ? 'desc' : 'asc';
									} else {
										self._sortCol = col;
										self._sortDir = th.getAttribute('data-num') === '1' ? 'desc' : 'asc';
									}
									runQuery();
								});
							});
							connsDiv.appendChild(E('div',{'style':'overflow-x:auto'},[tbl]));
							connsDiv.appendChild(E('p',{'style':'color:'+C.textFaint+';font-size:11px;margin-top:6px'},
								groups.length+' groups from '+data.connections.length+' connections. Click header to sort.'));
						} else {
							tbl = buildTable(data.connections, self._sortCol, self._sortDir, o.rdns);
							Array.prototype.forEach.call(tbl.querySelectorAll('th'), function(th) {
								th.addEventListener('click', function() {
									var col = th.getAttribute('data-col');
									if (self._sortCol === col) {
										self._sortDir = self._sortDir === 'asc' ? 'desc' : 'asc';
									} else {
										self._sortCol = col;
										self._sortDir = th.getAttribute('data-num') === '1' ? 'desc' : 'asc';
									}
									runQuery();
								});
							});
							connsDiv.appendChild(E('div',{'style':'overflow-x:auto'},[tbl]));
							connsDiv.appendChild(E('p',{'style':'color:'+C.textFaint+';font-size:11px;margin-top:6px'},
								data.connections.length+' connections. Click header to sort.'));

							if (o.rdns) {
								var seen = {};
								data.connections.forEach(function(c) {
									var dst = c.dst || '';
									if (!dst || seen[dst]) return;
									if (PRIVATE_RE.test(dst)) return;
									seen[dst] = true;
									fs.exec_direct('/usr/local/bin/trafficctl-rdns.sh', [dst])
										.then(function(raw) {
											var res; try { res = JSON.parse(raw); } catch(e) { res = null; }
											var host = (res && res.host) ? res.host : null;
											Array.prototype.forEach.call(
												connsDiv.querySelectorAll('td[data-dst="'+dst+'"]'),
												function(cell) {
													if (host) {
														cell.textContent = host;
														cell.style.color = C.hostname;
													} else {
														cell.innerHTML = '<span style="color:'+C.textFaint+'">—</span>';
													}
												}
											);
										})
										.catch(function() {
											Array.prototype.forEach.call(
												connsDiv.querySelectorAll('td[data-dst="'+dst+'"]'),
												function(cell) { cell.innerHTML = '<span style="color:'+C.textFaint+'">—</span>'; }
											);
										});
								});
							}
						}
					}
					setStatus(statusDiv, 'ok', '✓ '+new Date().toLocaleTimeString());
				})
				.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
				.then(function() { runBtn.disabled = false; });
		}

		// ── Run all devices ────────────────────────────────────────────────
		function runAll() {
			runBtn.disabled = true;
			setStatus(statusDiv, 'loading', 'Scanning all devices…');

			fs.exec_direct('/usr/local/bin/trafficctl-summary.sh', [])
				.then(function(raw) {
					var rows; try { rows = JSON.parse(raw); } catch(e) {
						setStatus(statusDiv, 'error', 'Parse error: '+raw.slice(0,120)); return;
					}
					var limited = rows.filter(function(r){return (r.rate_limit_kbit||0) > 0;}).length;
					var shaped  = rows.filter(function(r){return (r.shape_kbit||0) > 0;}).length;
					var totalDropPkts = Object.keys(self._dropMap).reduce(function(s, ip) { return s + (self._dropMap[ip].packets||0); }, 0);
					statsDiv.style.cssText = 'padding:8px 14px;border-radius:4px;font-size:13px;margin-bottom:8px;background:'+C.infoBg+';border:1px solid '+C.infoBorder+';color:'+C.infoFg;
					statsDiv.innerHTML = 'Active devices: <b>'+rows.length+'</b>'
						+ ' &nbsp;|&nbsp; Blocked: <b style="color:'+C.blockedFg+'">'
						+ rows.filter(function(r){return r.blocked;}).length+'</b>'
						+ ' &nbsp;|&nbsp; WiFi blocked: <b style="color:'+C.stateWait+'">'
						+ rows.filter(function(r){return r.wifi_blocked;}).length+'</b>'
						+ (limited > 0 ? ' &nbsp;|&nbsp; Limited: <b style="color:'+C.rateFg+'">⚡ '+limited+'</b>' : '')
						+ (shaped > 0 ? ' &nbsp;|&nbsp; Shaped: <b style="color:'+C.shapeFg+'">🌊 '+shaped+'</b>' : '')
						+ (totalDropPkts > 0 ? ' &nbsp;|&nbsp; Dropped: <b style="color:'+C.dropFg+'">🚫 '+totalDropPkts+' pkts</b>' : '')
						+ ' &nbsp;<span style="color:'+C.textFaint+';font-size:11px">'+new Date().toLocaleTimeString()+'</span>';

					while (connsDiv.firstChild) connsDiv.removeChild(connsDiv.firstChild);
					if (rows.length === 0) {
						connsDiv.appendChild(E('p',{'style':'color:'+C.textMute+';padding:12px 0'},'No active devices.'));
					} else {
						var tbl = buildSummaryTable(
							rows,
							self._sumCol,
							self._sumDir,
							function(key, isNum) {
								if (self._sumCol === key) {
									self._sumDir = self._sumDir === 'asc' ? 'desc' : 'asc';
								} else {
									self._sumCol = key;
									self._sumDir = isNum ? 'desc' : 'asc';
								}
								runAll();
							},
							function(ip) {
								Array.prototype.forEach.call(select.options, function(o) {
									if (o.value === ip) { o.selected = true; }
								});
								var o = loadOpts(); o.lastIp = ip; saveOpts(o);
								updateModeUI();
								runQuery();
							},
							self._speedMap,
							self._dropMap,
							self._shapeMap
						);
						connsDiv.appendChild(E('div',{'style':'overflow-x:auto'},[tbl]));
						connsDiv.appendChild(E('p',{'style':'color:'+C.textFaint+';font-size:11px;margin-top:6px'},
							'Click a row to inspect that device. Download speed updates every 2 seconds.'));
					}
					setStatus(statusDiv, 'ok', '✓ '+new Date().toLocaleTimeString());
					self._startBytesPoll();
				})
				.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
				.then(function() { runBtn.disabled = false; });
		}

		function runQuery() {
			var ip = select.value;
			var o = loadOpts(); o.lastIp = ip; saveOpts(o);
			updateModeUI();
			if (ip === '__all__') {
				runAll();
			} else {
				self._stopBytesPoll();
				pollDrops(); // refresh drop counters for per-device stats display
				runSingle(ip);
			}
		}

		// Rate limit / shaper apply handler
		rateBtn.addEventListener('click', function() {
			var ip   = select.value;
			var name = select.options[select.selectedIndex].text.split('  —  ')[0].trim();
			var kbit = getRateKbit();
			var mode = modeSel.value;
			rateBtn.disabled = true;

			if (kbit === '0') {
				setStatus(statusDiv, 'loading', 'Removing throttle for '+name+'…');
				Promise.all([
					fs.exec_direct('/usr/local/bin/trafficctl-ratelimit.sh', [ip, '0', name]),
					fs.exec_direct('/usr/local/bin/trafficctl-shape.sh', ['remove', ip, '0', name])
				]).then(function(results) {
					var res; try { res = JSON.parse(results[0]); } catch(e) { res = {ok:true,msg:'Throttle removed'}; }
					setStatus(statusDiv, 'ok', res.msg || 'Throttle removed for '+name);
					runQuery();
				}).catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
				  .then(function() { rateBtn.disabled = false; });
			} else if (mode === 'shaper') {
				setStatus(statusDiv, 'loading', 'Shaping '+name+' to '+fmtRate(parseInt(kbit))+'…');
				fs.exec_direct('/usr/local/bin/trafficctl-ratelimit.sh', [ip, '0', name])
					.then(function() {
						return fs.exec_direct('/usr/local/bin/trafficctl-shape.sh', ['add', ip, kbit, name]);
					})
					.then(function(r) {
						var res; try { res = JSON.parse(r); } catch(e) { res = {ok:false,msg:r}; }
						setStatus(statusDiv, res.ok ? 'action' : 'error', res.msg||'?');
						runQuery();
					})
					.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
					.then(function() { rateBtn.disabled = false; });
			} else {
				setStatus(statusDiv, 'loading', 'Limiting '+name+' to '+fmtRate(parseInt(kbit))+'…');
				fs.exec_direct('/usr/local/bin/trafficctl-shape.sh', ['remove', ip, '0', name])
					.then(function() {
						return fs.exec_direct('/usr/local/bin/trafficctl-ratelimit.sh', [ip, kbit, name]);
					})
					.then(function(r) {
						var res; try { res = JSON.parse(r); } catch(e) { res = {ok:false,msg:r}; }
						setStatus(statusDiv, res.ok ? 'action' : 'error', res.msg||'?');
						runQuery();
					})
					.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
					.then(function() { rateBtn.disabled = false; });
			}
		});

		wifiBtn.addEventListener('click', function() {
			var ip   = select.value;
			var name = select.options[select.selectedIndex].text.split('  —  ')[0].trim();
			var action = wifiBtn._wifiAction;
			wifiBtn.disabled = true;
			setStatus(statusDiv, 'loading', (action==='block' ? 'Adding to' : 'Removing from')+' WiFi deny list: '+name+'…');
			var script = action === 'block' ? '/usr/local/bin/trafficctl-macfilter-add.sh' : '/usr/local/bin/trafficctl-macfilter-remove.sh';
			fs.exec_direct(script, [ip]).then(function(r) {
				var res; try { res = JSON.parse(r); } catch(e) { res = {ok:false,msg:r}; }
				setStatus(statusDiv, res.ok ? (action==='block'?'action':'ok') : 'error', res.msg||'?');
				runQuery();
			});
		});

		blockBtn.addEventListener('click', function() {
			var ip   = select.value;
			var name = select.options[select.selectedIndex].text.split('  —  ')[0].trim();
			blockBtn.disabled = true;
			setStatus(statusDiv, 'loading', 'Blocking '+name+'…');
			fs.exec_direct('/usr/local/bin/trafficctl-block.sh', [ip, name]).then(function(r) {
				var res; try { res = JSON.parse(r); } catch(e) { res = {ok:false,msg:r}; }
				setStatus(statusDiv, res.ok?'action':'error', res.msg||'?');
				runQuery();
			});
		});
		unblockBtn.addEventListener('click', function() {
			var ip   = select.value;
			var name = select.options[select.selectedIndex].text.split('  —  ')[0].trim();
			unblockBtn.disabled = true;
			setStatus(statusDiv, 'loading', 'Unblocking '+name+'…');
			fs.exec_direct('/usr/local/bin/trafficctl-unblock.sh', [ip, name]).then(function(r) {
				var res; try { res = JSON.parse(r); } catch(e) { res = {ok:false,msg:r}; }
				setStatus(statusDiv, res.ok?'ok':'error', res.msg||'?');
				runQuery();
			});
		});

		var runBtn = E('button', {
			'class': 'cbi-button cbi-button-action important',
			'click': function() { runQuery(); }
		}, '▶ Run');

		this._setupTimer = function() {
			if (self._timer) { clearInterval(self._timer); self._timer = null; }
			var iv = parseInt(loadOpts().refresh||0);
			if (iv > 0) self._timer = setInterval(runQuery, iv*1000);
		};

		this._startBytesPoll = function() {
			if (self._bytesTimer) return;
			pollBytes();
			self._bytesTimer = setInterval(pollBytes, 2000);
			// Poll drops and shape stats less frequently (every 5s)
			pollDrops();
			self._dropTimer = setInterval(pollDrops, 5000);
			pollShapeStats();
			self._shapeTimer = setInterval(pollShapeStats, 5000);
		};
		this._stopBytesPoll = function() {
			if (self._bytesTimer) { clearInterval(self._bytesTimer); self._bytesTimer = null; }
			if (self._dropTimer)  { clearInterval(self._dropTimer);  self._dropTimer  = null; }
			if (self._shapeTimer) { clearInterval(self._shapeTimer); self._shapeTimer = null; }
		};

		this._setupTimer();
		select.addEventListener('change', function() { runQuery(); });
		setTimeout(function() { runQuery(); }, 0);

		var ob = 'border:1px solid '+C.optsBorder+';background:'+C.optsBg;
		return E('div', {'class':'cbi-map', 'style':'color:'+C.hostname}, [
			E('h2', {'style':'color:'+C.hostname}, 'Traffic Control'),
			E('div', {'class':'cbi-section'}, [
				E('div', {'style':'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px'},
					[select, runBtn]),
				actionRow,
				rateLimitRow,
				statusDiv,
				E('div', {'style':'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px;padding:8px 12px;border-radius:4px;'+ob}, [
					mkLabel('Show:'), showStats, showConns,
					E('span',{'style':'border-left:1px solid '+C.border+';height:18px;margin:0 8px'}),
					mkLabel('Refresh:'), refreshSel,
					E('span',{'style':'border-left:1px solid '+C.border+';height:18px;margin:0 8px'}),
					perDeviceOpts
				]),
				statsDiv,
				connsDiv
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
