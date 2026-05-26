'use strict';
'require view';
'require rpc';
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

var callTrafficctl = rpc.declare({
	object: 'luci.trafficctl',
	method: 'summary',
	expect: { result: [] }
});

var callDevice = rpc.declare({
	object: 'luci.trafficctl',
	method: 'device',
	params: ['ip', 'proto']
});

var callBytes = rpc.declare({
	object: 'luci.trafficctl',
	method: 'bytes',
	expect: { result: [] }
});

var callBlock = rpc.declare({
	object: 'luci.trafficctl',
	method: 'block',
	params: ['ip', 'label']
});

var callUnblock = rpc.declare({
	object: 'luci.trafficctl',
	method: 'unblock',
	params: ['ip', 'label']
});

var callMacfilterAdd = rpc.declare({
	object: 'luci.trafficctl',
	method: 'macfilter_add',
	params: ['ip']
});

var callMacfilterRemove = rpc.declare({
	object: 'luci.trafficctl',
	method: 'macfilter_remove',
	params: ['ip']
});

var callRatelimit = rpc.declare({
	object: 'luci.trafficctl',
	method: 'ratelimit',
	params: ['ip', 'rate_kbit', 'label']
});

var callRatelimitStats = rpc.declare({
	object: 'luci.trafficctl',
	method: 'ratelimit_stats',
	expect: { result: [] }
});

var callShapeAdd = rpc.declare({
	object: 'luci.trafficctl',
	method: 'shape_add',
	params: ['ip', 'rate_kbit', 'label']
});

var callShapeRemove = rpc.declare({
	object: 'luci.trafficctl',
	method: 'shape_remove',
	params: ['ip', 'label']
});

var callShapeStats = rpc.declare({
	object: 'luci.trafficctl',
	method: 'shape_stats',
	expect: { result: [] }
});

var callRdns = rpc.declare({
	object: 'luci.trafficctl',
	method: 'rdns',
	params: ['ip']
});

var callTelegramGet = rpc.declare({
	object: 'luci.trafficctl',
	method: 'telegram_config_get'
});

var callTelegramSet = rpc.declare({
	object: 'luci.trafficctl',
	method: 'telegram_config_set',
	params: ['enabled', 'bot_token', 'chat_id', 'poll_interval',
		'notify_new_device', 'notify_known_device',
		'btn_block_inet', 'btn_block_wifi', 'btn_limiter', 'btn_shaper']
});

var callTelegramTest = rpc.declare({
	object: 'luci.trafficctl',
	method: 'telegram_test',
	params: ['bot_token', 'chat_id']
});

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
	{v:'0',      l: _('Off')},
	{v:'1000',   l:'1 Mbit/s'},
	{v:'2000',   l:'2 Mbit/s'},
	{v:'5000',   l:'5 Mbit/s'},
	{v:'10000',  l:'10 Mbit/s'},
	{v:'25000',  l:'25 Mbit/s'},
	{v:'50000',  l:'50 Mbit/s'},
	{v:'100000', l:'100 Mbit/s'},
	{v:'custom', l: _('Custom…')}
];

var GROUP_OPTS = [
	{v:'none',    l: _('None (per-flow)')},
	{v:'host',    l: _('Hostname / Dst IP')},
	{v:'service', l: _('Service')},
	{v:'port',    l: _('Port')},
	{v:'proto',   l: _('Protocol')}
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

function mkEthIcon(size) {
	var s = size || 14;
	var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', s);
	svg.setAttribute('height', s);
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.style.cssText = 'display:inline-block;vertical-align:middle;margin-right:3px';
	var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', 'M4 7h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM7 11v2M10 11v2M13 11v2M16 11v2');
	svg.appendChild(path);
	return svg;
}

function renderSparkline(history, globalMax, width, height) {
	if (!history || history.length < 2) return null;
	var maxVal = globalMax || 1;
	var w = width || 60;
	var h = height || 20;
	var step = w / (history.length - 1);
	var points = [];
	for (var i = 0; i < history.length; i++) {
		var x = (i * step).toFixed(1);
		var y = (h - (history[i].speed / maxVal) * (h - 2) - 1).toFixed(1);
		points.push(x + ',' + y);
	}
	var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', w);
	svg.setAttribute('height', h);
	svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
	svg.style.cssText = 'display:block;margin:0 auto';
	var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
	polyline.setAttribute('points', points.join(' '));
	polyline.setAttribute('fill', 'none');
	polyline.setAttribute('stroke', 'var(--tm-speed)');
	polyline.setAttribute('stroke-width', '1.5');
	polyline.setAttribute('stroke-linejoin', 'round');
	var area = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
	area.setAttribute('points', '0,' + h + ' ' + points.join(' ') + ' ' + (w - 0) + ',' + h);
	area.setAttribute('fill', 'var(--tm-speed)');
	area.setAttribute('opacity', '0.1');
	area.setAttribute('stroke', 'none');
	svg.appendChild(area);
	svg.appendChild(polyline);
	return svg;
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
		'.tm-link:hover{border-bottom-style:solid}' +
		'.tm-toggle-input{position:absolute;opacity:0;width:0;height:0}' +
		'.tm-toggle{position:relative;display:inline-block;width:34px;height:18px;background:var(--tm-border);' +
		'border-radius:9px;cursor:pointer;transition:background .2s}' +
		'.tm-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;' +
		'background:#fff;border-radius:50%;transition:transform .2s;box-shadow:0 1px 2px rgba(0,0,0,.2)}' +
		'.tm-toggle-input:checked+.tm-toggle{background:var(--tm-proto)}' +
		'.tm-toggle-input:checked+.tm-toggle::after{transform:translateX(16px)}';
	document.head.appendChild(s);
}

var TH = 'cursor:pointer;padding:7px 12px;white-space:nowrap;background:' + C.thBg +
         ';color:' + C.thFg + ';border:none;font-size:12px;font-weight:600;user-select:none;text-align:left';

var PRIVATE_RE = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;

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
		{ key:'key',   label: _('Group'), num:false },
		{ key:'count', label: _('Conns'), num:true  },
		{ key:'tcp',   label:'TCP',       num:true  },
		{ key:'udp',   label:'UDP',       num:true  },
		{ key:'bytes', label: _('Bytes'), num:true  }
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
		{ key:'proto',   label: _('Proto'),    num:false },
		{ key:'dst',     label: _('Dst IP'),   num:false },
		{ key:'host',    label: _('Hostname'), num:false },
		{ key:'port',    label: _('Port'),     num:true  },
		{ key:'service', label: _('Service'),  num:false },
		{ key:'bytes',   label: _('Bytes'),    num:true  },
		{ key:'state',   label: _('State'),    num:false }
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
		var dstEl = dst
			? E('a', { 'href': 'https://ipinfo.io/'+dst, 'target': '_blank', 'rel': 'noopener noreferrer',
			           'class':'tm-link', 'onclick': 'event.stopPropagation()' }, dst)
			: '';

		var hostCell = E('td', { 'style': td+';color:'+C.hostname, 'data-dst': dst });
		if (r.host) {
			hostCell.textContent = r.host;
		} else if (rdnsMode && !PRIVATE_RE.test(dst)) {
			hostCell.innerHTML = '<span style="color:'+C.textFaint+';font-style:italic">' + _('resolving…') + '</span>';
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

function buildSummaryTable(rows, sortCol, sortDir, onSort, onSelect, speedMap, dropMap, shapeMap, speedHistory, hiddenCols) {
	var cols = [
		{ key:'name',             label: _('Device'),   num:false, tip: _('Device hostname from DHCP lease') },
		{ key:'ip',               label:'IP',           num:false, tip: _('Local IP address') },
		{ key:'mac',              label:'MAC',          num:false, tip: _('Hardware MAC address'), hide:true },
		{ key:'_speed',           label: _('DL Speed'), num:true,  tip: _('Current download speed (bytes/sec from router to device)') },
		{ key:'_spark',           label: '',            num:false, tip: _('Speed history graph (shared scale)') },
		{ key:'conns',            label: _('Conns'),    num:true,  tip: _('Active connections in conntrack') },
		{ key:'total',            label: _('Bytes'),    num:true,  tip: _('Total bytes transferred (conntrack)'), hide:true },
		{ key:'tcp',              label:'TCP',          num:true,  tip: _('TCP bytes transferred'), hide:true },
		{ key:'udp',              label:'UDP',          num:true,  tip: _('UDP bytes transferred'), hide:true },
		{ key:'blocked',          label: _('Inet'),     num:false, tip: _('Internet access status (paused = traffic blocked)') },
		{ key:'conn_type',        label: _('Link'),     num:false, tip: _('Connection interface (WiFi band or LAN port)') },
		{ key:'_throttle_kbit',   label: _('Speed Limit'), num:true,  tip: _('Active speed limit: shaper (queue) or limiter (drop)') },
		{ key:'_drop_packets',    label: _('Dropped'),  num:true,  tip: _('Packets dropped by rate limiter'), hide:true },
		{ key:'_backlog',         label: _('Queued'),   num:true,  tip: _('Bytes queued in traffic shaper'), hide:true }
	];

	hiddenCols = hiddenCols || {};
	var visibleCols = cols.filter(function(c) { return !hiddenCols[c.key]; });

	function ipToInt(s) {
		var p = String(s||'').split('.');
		if (p.length !== 4) return 0;
		return ((parseInt(p[0])||0)*16777216 + (parseInt(p[1])||0)*65536 + (parseInt(p[2])||0)*256 + (parseInt(p[3])||0));
	}

	speedMap = speedMap || {};
	dropMap  = dropMap  || {};
	shapeMap = shapeMap || {};
	speedHistory = speedHistory || {};

	var globalSpeedMax = 0;
	Object.keys(speedHistory).forEach(function(ip) {
		var hist = speedHistory[ip];
		if (hist) {
			hist.forEach(function(h) { if (h.speed > globalSpeedMax) globalSpeedMax = h.speed; });
		}
	});

	rows.forEach(function(r) {
		var s = speedMap[r.ip];
		r._speed = s ? s.current : 0;
		var d = dropMap[r.ip];
		r._drop_packets = d ? d.packets : 0;
		r._drop_bytes   = d ? d.bytes   : 0;
		var sh = shapeMap[r.ip];
		r._backlog = sh ? sh.backlog : 0;
		r._throttle_kbit = (r.shape_kbit || 0) > 0 ? r.shape_kbit : (r.rate_limit_kbit || 0);
		r._throttle_mode = (r.shape_kbit || 0) > 0 ? 'shaper' : ((r.rate_limit_kbit || 0) > 0 ? 'limiter' : 'none');
	});

	var sorted = rows.slice().sort(function(a, b) {
		var av = a[sortCol], bv = b[sortCol];
		if (typeof av === 'number') {
			var diff = sortDir === 'asc' ? av - bv : bv - av;
			if (diff !== 0) return diff;
			return String(a.name || '').localeCompare(String(b.name || ''));
		}
		if (typeof av === 'boolean') return sortDir === 'asc' ? (av?1:0)-(bv?1:0) : (bv?1:0)-(av?1:0);
		if (sortCol === 'ip') {
			var d = ipToInt(av) - ipToInt(bv);
			return sortDir === 'asc' ? d : -d;
		}
		av = String(av||''); bv = String(bv||'');
		return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
	});

	var thead = E('thead', {}, E('tr', {}, visibleCols.map(function(c) {
		var arrow = c.key === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
		var thStyle = TH + (c.key === '_spark' ? ';cursor:default;width:68px' : '');
		var attrs = { 'style': thStyle, 'data-col': c.key, 'data-num': c.num ? '1' : '0' };
		if (c.tip) attrs.title = c.tip;
		var th = E('th', attrs, c.label + arrow);
		if (c.key !== '_spark') th.addEventListener('click', function() { onSort(c.key, c.num); });
		return th;
	})));

	var tbody = E('tbody', {}, sorted.map(function(r, i) {
		var bg = i%2===0 ? C.rowEven : C.rowOdd;
		var td = 'padding:6px 12px;border-bottom:1px solid '+C.border+';color:'+C.hostname+';font-size:12px;background:'+bg;

		var sd = speedMap[r.ip];
		var cellMap = {};

		cellMap.name = E('td', { 'style': td+';font-weight:600;color:'+C.proto }, escHtml(r.name));
		cellMap.ip = E('td', { 'style': td+';font-family:monospace' }, escHtml(r.ip));
		var macEl = r.mac ? E('a', { 'href':'/cgi-bin/luci/admin/network/dhcp','target':'_blank','rel':'noopener','class':'tm-link','title':_('Open DHCP/DNS bindings'),'onclick':'event.stopPropagation()' }, r.mac) : '';
		cellMap.mac = E('td', { 'style': td+';font-family:monospace;color:'+C.mac+';font-size:11px' }, macEl || '');

		cellMap._speed = E('td', { 'style': td+';text-align:right;font-family:monospace', 'data-speed-ip': r.ip, 'title': sd ? (_('Avg')+': '+fmtSpeed(sd.avg)+' / '+_('Max')+': '+fmtSpeed(sd.max)) : _('Calculating…') });
		if (sd && sd.current > 1024) { cellMap._speed.className = 'tm-speed-active'; cellMap._speed.textContent = fmtSpeed(sd.current); }
		else { cellMap._speed.className = 'tm-speed-idle'; cellMap._speed.textContent = sd ? fmtSpeed(sd.current) : '—'; }

		cellMap._spark = E('td', { 'style': td+';text-align:center;padding:2px 4px', 'data-spark-ip': r.ip });
		var sparkSvg = renderSparkline(speedHistory[r.ip], globalSpeedMax, 60, 20);
		if (sparkSvg) cellMap._spark.appendChild(sparkSvg);

		cellMap.conns = E('td', { 'style': td+';text-align:right;font-weight:600' }, String(r.conns||0));
		cellMap.total = E('td', { 'style': td+';text-align:right;font-family:monospace;font-size:11px' }, fmtBytes(r.total||0));
		cellMap.tcp = E('td', { 'style': td+';text-align:right;font-family:monospace;font-size:11px;color:'+C.proto }, fmtBytes(r.tcp||0));
		cellMap.udp = E('td', { 'style': td+';text-align:right;font-family:monospace;font-size:11px;color:'+C.stateClose }, fmtBytes(r.udp||0));

		var inetBadge = r.blocked
			? E('span', { 'style': 'color:'+C.rateFg+';font-weight:600' }, '⏸️ ' + _('paused'))
			: E('span', { 'style': 'color:'+C.proto }, '▶️ ' + _('ok'));
		cellMap.blocked = E('td', { 'style': td+';text-align:center' }, inetBadge);

		var linkBadge;
		var ct = r.conn_type || 'ethernet';
		var isWifi = (ct === 'wifi' || ct === '2.4G' || ct === '5G' || ct === '6G');
		if (ct === '?') {
			var tip = _('Unknown — device unreachable');
			if (r.conn_last) {
				var parts = r.conn_last.split('@');
				var lastType = parts[0] || '';
				var lastTs = parseInt(parts[1], 10);
				if (lastTs) {
					var ago = Math.floor((Date.now()/1000) - lastTs);
					var agoStr = ago < 60 ? ago + 's' : ago < 3600 ? Math.floor(ago/60) + 'm' : Math.floor(ago/3600) + 'h';
					tip = _('Last seen') + ': ' + lastType + ', ' + agoStr + ' ' + _('ago');
				}
			}
			linkBadge = E('span', { 'style': 'color:'+C.textFaint+';cursor:help', 'title': tip }, '❓');
		} else if (isWifi) {
			var wLabel = ct === 'wifi' ? 'WiFi' : ct;
			linkBadge = r.wifi_blocked
				? E('span', { 'style': 'color:'+C.rateFg+';font-weight:600;text-decoration:line-through' }, '📶 ' + wLabel)
				: E('span', { 'style': 'color:'+C.proto }, '📶 ' + wLabel);
		} else {
			var ethLabel = (ct === 'ethernet') ? 'eth' : ct;
			linkBadge = E('span', { 'style': 'color:'+C.textMute }, [mkEthIcon(14), document.createTextNode(ethLabel)]);
		}
		cellMap.conn_type = E('td', { 'style': td+';text-align:center' }, linkBadge);

		var throttleBadge;
		if (r._throttle_mode === 'shaper') { throttleBadge = E('span', { 'style': 'color:'+C.shapeFg+';font-weight:600', 'title': _('Shaper (tc/HTB queue)') }, '🌊 ' + fmtRate(r._throttle_kbit)); }
		else if (r._throttle_mode === 'limiter') { throttleBadge = E('span', { 'style': 'color:'+C.rateFg+';font-weight:600', 'title': _('Limiter (nft drop)') }, '⚡ ' + fmtRate(r._throttle_kbit)); }
		else { throttleBadge = E('span', { 'style': 'color:'+C.textFaint }, '—'); }
		cellMap._throttle_kbit = E('td', { 'style': td+';text-align:center' }, throttleBadge);

		var dp = r._drop_packets || 0;
		var dropBadge = dp > 0 ? E('span', { 'style': 'color:'+C.dropFg+';font-weight:600', 'title': fmtBytes(r._drop_bytes||0)+' '+_('dropped') }, '🚫 ' + dp) : E('span', { 'style': 'color:'+C.textFaint }, '—');
		cellMap._drop_packets = E('td', { 'style': td+';text-align:center', 'data-drop-ip': r.ip }, dropBadge);

		var bl = r._backlog || 0;
		var backlogBadge = bl > 0 ? E('span', { 'style': 'color:'+C.shapeFg+';font-weight:600', 'title': _('Bytes queued in tc') }, fmtBytes(bl)) : E('span', { 'style': 'color:'+C.textFaint }, '—');
		cellMap._backlog = E('td', { 'style': td+';text-align:center', 'data-backlog-ip': r.ip }, backlogBadge);

		var cells = visibleCols.map(function(c) { return cellMap[c.key]; });
		var row = E('tr', { 'class': 'tm-row', 'title': _('Click to inspect') + ' ' + r.name }, cells);
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

function updateUrlParams(opts) {
	var params = new URLSearchParams();
	if (opts.lastIp && opts.lastIp !== '__all__') params.set('ip', opts.lastIp);
	if (opts.refresh && opts.refresh > 0) params.set('refresh', String(opts.refresh));
	if (opts.pollInterval) params.set('poll', String(opts.pollInterval));
	if (opts.avgWindow && opts.avgWindow !== 15) params.set('avg', String(opts.avgWindow));
	if (opts.avgMethod && opts.avgMethod !== 'simple') params.set('method', opts.avgMethod);
	if (opts.extendedStats) params.set('extended', '1');
	if (opts.rdns) params.set('rdns', '1');
	var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
	history.replaceState(null, '', newUrl);
}

function applyUrlParams(opts) {
	var urlParams = new URLSearchParams(window.location.search);
	var paramIp = urlParams.get('ip');
	var paramRefresh = urlParams.get('refresh');
	var paramPoll = urlParams.get('poll');
	var paramAvg = urlParams.get('avg');
	var paramMethod = urlParams.get('method');
	var paramExtended = urlParams.get('extended');
	var paramRdns = urlParams.get('rdns');

	if (paramIp) opts.lastIp = paramIp;
	if (paramRefresh) opts.refresh = parseInt(paramRefresh) || 0;
	if (paramPoll) opts.pollInterval = parseInt(paramPoll) || 0;
	if (paramAvg) opts.avgWindow = parseInt(paramAvg) || 15;
	if (paramMethod && (paramMethod === 'ewma' || paramMethod === 'simple')) opts.avgMethod = paramMethod;
	if (paramExtended === '1') opts.extendedStats = true;
	if (paramRdns === '1') opts.rdns = true;
	return opts;
}

function buildExtendedStatsPanel(ip, shapeMap, dropMap, speedMap) {
	var sm = shapeMap[ip];
	var dm = dropMap[ip];
	var spd = speedMap[ip];

	var panelStyle = 'background:var(--tm-bg-subtle);border:1px solid var(--tm-border);border-radius:4px;padding:12px 16px;font-size:13px;margin:8px 0';
	var td = 'padding:5px 12px;border-bottom:1px solid var(--tm-border);font-size:13px';
	var tooltips = {
		'Drops': _('packets dropped by queue overflow'),
		'Overlimits': _('rate exceeded events'),
		'ECN marks': _('congestion signals without drop'),
		'Flows': _('active concurrent connections in queue'),
		'Queue memory': _('bytes allocated by the queue discipline'),
		'Lended / Borrowed': _('own-rate vs parent-rate packets'),
		'Utilization': _('current speed as percentage of rate limit'),
		'Packets dropped': _('traffic discarded by nft policer'),
		'Bytes dropped': _('traffic discarded by nft policer'),
		'Drop ratio': _('percentage of total traffic that was dropped')
	};
	var rows = [];

	function addRow(label, value, color) {
		var tip = tooltips[label] || '';
		rows.push(E('tr', { 'class': 'tm-row' }, [
			E('td', { 'style': td + ';color:var(--tm-text-mute)', 'title': tip }, label),
			E('td', { 'style': td + ';text-align:right;font-family:monospace;font-weight:600' + (color ? ';color:' + color : '') }, value)
		]));
	}

	if (sm && sm.rate_kbit > 0) {
		if (sm.drops != null) addRow(_('Drops'), String(sm.drops), sm.drops > 0 ? 'var(--tm-drop-fg)' : null);
		if (sm.overlimits != null) addRow(_('Overlimits'), String(sm.overlimits), sm.overlimits > 0 ? 'var(--tm-rate-fg)' : null);
		if (sm.ecn_mark != null) addRow(_('ECN marks'), String(sm.ecn_mark), sm.ecn_mark > 0 ? 'var(--tm-rate-fg)' : null);
		if (sm.new_flows != null || sm.old_flows != null) {
			addRow(_('Flows'), (sm.new_flows || 0) + ' ' + _('new') + ' / ' + (sm.old_flows || 0) + ' ' + _('old'), null);
		}
		if (sm.memory_used != null) addRow(_('Queue memory'), fmtBytes(sm.memory_used), null);
		if (sm.lended != null || sm.borrowed != null) {
			addRow(_('Lended') + ' / ' + _('Borrowed'), (sm.lended || 0) + ' / ' + (sm.borrowed || 0), null);
		}
		if (spd && sm.rate_kbit > 0) {
			var currentBps = spd.current || 0;
			var rateBytes = (sm.rate_kbit * 1000) / 8;
			var util = rateBytes > 0 ? ((currentBps / rateBytes) * 100) : 0;
			var utilColor = util > 95 ? 'var(--tm-drop-fg)' : util > 70 ? 'var(--tm-rate-fg)' : 'var(--tm-state-ok)';
			addRow(_('Utilization'), util.toFixed(1) + '%', utilColor);
		}
	} else if (dm && dm.rate_kbit > 0) {
		addRow(_('Packets dropped'), String(dm.packets || 0), (dm.packets || 0) > 0 ? 'var(--tm-drop-fg)' : null);
		addRow(_('Bytes dropped'), fmtBytes(dm.bytes || 0), (dm.bytes || 0) > 0 ? 'var(--tm-drop-fg)' : null);
		var dropBytes = dm.bytes || 0;
		var passBytes = dm.pass_bytes || 0;
		var totalBytes = dropBytes + passBytes;
		var dropRatio = totalBytes > 0 ? ((dropBytes / totalBytes) * 100) : 0;
		var drColor = dropRatio > 10 ? 'var(--tm-drop-fg)' : dropRatio > 2 ? 'var(--tm-rate-fg)' : null;
		addRow(_('Drop ratio'), dropRatio.toFixed(1) + '%', drColor);
	}

	if (rows.length === 0) {
		return E('div', { 'style': panelStyle + ';color:var(--tm-text-mute)' }, _('No extended stats available for this device.'));
	}

	var tbl = E('table', { 'style': 'width:100%;border-collapse:collapse;border:1px solid var(--tm-border);border-radius:4px;overflow:hidden' }, [
		E('tbody', {}, rows)
	]);

	return E('div', { 'style': panelStyle }, [
		E('div', { 'style': 'margin-bottom:8px;font-weight:600;font-size:14px;color:var(--tm-text)' }, _('Extended Statistics')),
		tbl
	]);
}

function buildExtendedStatsLegend(shapeMap, dropMap) {
	var panelStyle = 'position:sticky;top:0;background:var(--tm-bg-subtle);border:1px solid var(--tm-border);border-radius:4px;padding:12px 16px;font-size:13px;margin:8px 0';
	var rowStyle = 'display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px dotted var(--tm-border)';
	var labelStyle = 'color:var(--tm-text-mute);font-size:12px';
	var valueStyle = 'font-family:monospace;font-weight:600;color:var(--tm-text);font-size:13px';
	var totalDrops = 0, totalOverlimits = 0, totalEcn = 0, totalMemory = 0;
	var totalDropPkts = 0, totalDropBytes = 0;
	var shapedCount = 0, limitedCount = 0;

	Object.keys(shapeMap).forEach(function(ip) {
		var sm = shapeMap[ip];
		if (sm && sm.rate_kbit > 0) {
			shapedCount++;
			totalDrops += (sm.drops || 0);
			totalOverlimits += (sm.overlimits || 0);
			totalEcn += (sm.ecn_mark || 0);
			totalMemory += (sm.memory_used || 0);
		}
	});
	Object.keys(dropMap).forEach(function(ip) {
		var dm = dropMap[ip];
		if (dm && dm.rate_kbit > 0) {
			limitedCount++;
			totalDropPkts += (dm.packets || 0);
			totalDropBytes += (dm.bytes || 0);
		}
	});

	var rows = [];
	function addRow(label, value, color) {
		var vs = color ? valueStyle + ';color:' + color : valueStyle;
		rows.push(E('div', { 'style': rowStyle }, [
			E('span', { 'style': labelStyle }, label),
			E('span', { 'style': vs }, value)
		]));
	}

	if (shapedCount > 0) {
		addRow(_('Shaped devices'), String(shapedCount), 'var(--tm-shape-fg)');
		addRow(_('Total drops'), String(totalDrops), totalDrops > 0 ? 'var(--tm-drop-fg)' : null);
		addRow(_('Overlimits'), String(totalOverlimits), totalOverlimits > 0 ? 'var(--tm-rate-fg)' : null);
		addRow(_('ECN marks'), String(totalEcn));
		addRow(_('Total queue memory'), fmtBytes(totalMemory));
	}
	if (limitedCount > 0) {
		addRow(_('Limited devices'), String(limitedCount), 'var(--tm-rate-fg)');
		addRow(_('Total dropped'), totalDropPkts + ' ' + _('pkts') + ' / ' + fmtBytes(totalDropBytes), totalDropPkts > 0 ? 'var(--tm-drop-fg)' : null);
	}
	if (rows.length === 0) {
		rows.push(E('div', { 'style': 'padding:4px 0;color:var(--tm-text-mute)' }, _('No extended stats available.')));
	}

	return E('div', { 'style': panelStyle }, [
		E('div', { 'style': 'margin-bottom:8px;font-weight:600;font-size:14px;color:var(--tm-text)' }, _('Extended Statistics') + ' (' + _('all devices') + ')'),
		E('div', { 'style': 'display:flex;flex-direction:column' }, rows)
	]);
}

function buildSearchSelect(devices, placeholder, onSelect) {
	var selectedValue = '__all__';
	var recentIps = [];
	var MAX_RECENT = 5;
	var wrapper = E('div', { 'style': 'position:relative;display:inline-block;width:100%;max-width:480px' });
	var input = E('input', {
		'type': 'text',
		'placeholder': placeholder,
		'autocomplete': 'off',
		'style': 'width:100%;padding:8px 32px 8px 12px;font-size:14px;border:2px solid var(--tm-border);border-radius:6px;cursor:pointer;background:var(--tm-bg);color:var(--tm-text)'
	});
	var clearBtn = E('span', {
		'style': 'position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;color:var(--tm-text-mute);font-size:16px;display:none;line-height:1'
	}, '×');
	var dropdown = E('div', {
		'style': 'position:absolute;top:100%;left:0;right:0;max-height:280px;overflow-y:auto;' +
				 'background:var(--tm-bg);border:1px solid var(--tm-border);border-top:none;border-radius:0 0 4px 4px;' +
				 'box-shadow:0 4px 8px rgba(0,0,0,.15);z-index:100;display:none'
	});
	wrapper.appendChild(input);
	wrapper.appendChild(clearBtn);
	wrapper.appendChild(dropdown);

	var highlightIdx = -1;
	var ITEM_STYLE = 'padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--tm-border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

	function addToRecent(ip) {
		recentIps = recentIps.filter(function(r) { return r !== ip; });
		recentIps.unshift(ip);
		if (recentIps.length > MAX_RECENT) recentIps.length = MAX_RECENT;
	}

	function highlightMatch(text, q) {
		if (!q) return escHtml(text);
		var lower = text.toLowerCase();
		var idx = lower.indexOf(q);
		if (idx === -1) return escHtml(text);
		return escHtml(text.substring(0, idx)) + '<b>' + escHtml(text.substring(idx, idx + q.length)) + '</b>' + escHtml(text.substring(idx + q.length));
	}

	function deviceLabel(d) {
		return d.name + '  —  ' + d.ip + (d.mac ? '  (' + d.mac + ')' : '');
	}

	function mkItem(it, idx, q) {
		var item = E('div', { 'style': ITEM_STYLE, 'data-value': it.value });
		if (q && it.value !== '__all__') {
			item.innerHTML = highlightMatch(it.label, q);
		} else {
			item.textContent = it.label;
		}
		if (it.section) {
			item.style.cssText = 'padding:3px 10px;font-size:11px;color:var(--tm-text-mute);font-weight:600;text-transform:uppercase;letter-spacing:.3px;cursor:default;border-bottom:1px solid var(--tm-border)';
			return item;
		}
		if (it.value === '__all__') {
			item.style.cssText = ITEM_STYLE + ';font-weight:600;color:var(--tm-proto)';
		}
		item.addEventListener('mousedown', function(ev) {
			ev.preventDefault();
			selectItem(it.value, it.label);
		});
		item.addEventListener('mouseenter', function() {
			highlightIdx = idx;
			updateHighlight(dropdown);
		});
		return item;
	}

	function renderItems(filter) {
		while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
		var q = (filter || '').toLowerCase();
		var items = [];
		items.push({ value: '__all__', label: '— ' + _('All active devices') + ' —', searchText: '' });

		if (!q && recentIps.length > 0) {
			items.push({ section: true, label: _('Recent'), value: '_hdr_recent' });
			recentIps.forEach(function(ip) {
				var d = devices.filter(function(dev) { return dev.ip === ip; })[0];
				if (d) items.push({ value: d.ip, label: deviceLabel(d), searchText: '' });
			});
			items.push({ section: true, label: _('All'), value: '_hdr_all' });
		}

		devices.forEach(function(d) {
			var st = (d.name + ' ' + d.ip + ' ' + (d.mac||'')).toLowerCase();
			if (!q || st.indexOf(q) !== -1) {
				items.push({ value: d.ip, label: deviceLabel(d), searchText: st });
			}
		});

		highlightIdx = -1;
		var actionIdx = 0;
		items.forEach(function(it) {
			var item = mkItem(it, actionIdx, q);
			dropdown.appendChild(item);
			if (!it.section) actionIdx++;
		});
	}

	function updateHighlight(dd) {
		var actionIdx = 0;
		Array.prototype.forEach.call(dd.children, function(el) {
			if (el.getAttribute('data-value') && el.getAttribute('data-value').indexOf('_hdr_') === 0) return;
			el.style.background = actionIdx === highlightIdx ? 'var(--tm-hover)' : '';
			actionIdx++;
		});
	}

	function selectItem(value, label, silent) {
		selectedValue = value;
		if (value === '__all__') {
			input.value = '';
			clearBtn.style.display = 'none';
		} else {
			addToRecent(value);
			input.value = label.replace(/\s+\(.*\)$/, '');
			clearBtn.style.display = '';
		}
		dropdown.style.display = 'none';
		if (!silent) onSelect(value);
	}

	input.addEventListener('focus', function() {
		this.style.cursor = 'text';
		renderItems(input.value);
		dropdown.style.display = '';
	});
	input.addEventListener('blur', function() {
		this.style.cursor = 'pointer';
		setTimeout(function() { dropdown.style.display = 'none'; }, 150);
	});
	input.addEventListener('input', function() {
		renderItems(input.value);
		dropdown.style.display = '';
	});
	input.addEventListener('keydown', function(ev) {
		var actionItems = [];
		Array.prototype.forEach.call(dropdown.children, function(el) {
			var v = el.getAttribute('data-value');
			if (v && v.indexOf('_hdr_') !== 0) actionItems.push(el);
		});
		if (ev.key === 'ArrowDown') {
			ev.preventDefault();
			highlightIdx = Math.min(highlightIdx + 1, actionItems.length - 1);
			updateHighlight(dropdown);
		} else if (ev.key === 'ArrowUp') {
			ev.preventDefault();
			highlightIdx = Math.max(highlightIdx - 1, 0);
			updateHighlight(dropdown);
		} else if (ev.key === 'Enter') {
			ev.preventDefault();
			if (highlightIdx >= 0 && highlightIdx < actionItems.length) {
				var el = actionItems[highlightIdx];
				selectItem(el.getAttribute('data-value'), el.textContent);
			}
		} else if (ev.key === 'Escape') {
			dropdown.style.display = 'none';
			input.blur();
		}
	});
	clearBtn.addEventListener('click', function() {
		selectItem('__all__', '');
		input.focus();
	});

	return {
		el: wrapper,
		getValue: function() { return selectedValue; },
		setValue: function(val, label) { selectItem(val, label || val, true); },
		updateDevices: function(newDevices) { devices = newDevices; }
	};
}

return view.extend({
	_timer:        null,
	_bytesTimer:   null,
	_dropTimer:    null,
	_shapeTimer:   null,
	_bytesHistory: {},
	_speedHistory: {},
	_speedMap:     {},
	_dropMap:      {},
	_shapeMap:     {},
	_speedEwma:    {},
	_sortCol:    'bytes',
	_sortDir:    'desc',
	_sumCol:     '_speed',
	_sumDir:     'desc',
	_hiddenCols: {},
	_queryGen:   0,

	load: function() {
		return fs.read('/tmp/dhcp.leases').catch(function() { return ''; });
	},

	render: function(leasesRaw) {
		var self = this;
		var opts = loadOpts();
		opts = applyUrlParams(opts);
		saveOpts(opts);
		injectStyles();

		var devices = [];
		(leasesRaw || '').split('\n').forEach(function(line) {
			var p = line.trim().split(/\s+/);
			if (p.length >= 4 && p[2] && p[3] && p[3] !== '*') {
				devices.push({ ip: p[2], name: p[3], mac: p[1] || '' });
			}
		});
		devices.sort(function(a, b) { return a.name.localeCompare(b.name); });

		var savedIp = opts.lastIp || '__all__';
		var searchSelect = buildSearchSelect(devices, _('Search device (name, IP, MAC)…'), function(value) {
			var o = loadOpts(); o.lastIp = value; saveOpts(o); updateUrlParams(o);
			updateModeUI();
			runQuery();
		});
		if (savedIp && savedIp !== '__all__') {
			var matchDev = devices.filter(function(d) { return d.ip === savedIp; })[0];
			searchSelect.setValue(savedIp, matchDev ? matchDev.name + '  —  ' + matchDev.ip : savedIp);
		}

		function mkToggle(id, label, checked, onChange) {
			var cb = E('input', { 'type': 'checkbox', 'id': id, 'class': 'tm-toggle-input' });
			cb.checked = !!checked;
			cb.addEventListener('change', onChange);
			var track = E('label', { 'class': 'tm-toggle', 'for': id });
			return E('div', { 'style': 'display:inline-flex;align-items:center;gap:6px;margin-right:12px;white-space:nowrap' }, [
				cb, track,
				E('label', { 'for': id, 'style': 'cursor:pointer;color:'+C.hostname+';font-size:12px;user-select:none' }, label)
			]);
		}
		function mkLabel(t) {
			return E('span', { 'style': 'color:'+C.textMute+';font-size:12px;margin-right:4px;white-space:nowrap' }, t);
		}

		function mkInlinePick(options, currentValue, onChange) {
			var wrapper = E('span', {'style':'position:relative;display:inline-block'});
			var display = E('span', {
				'style': 'color:var(--tm-text);font-size:12px;font-weight:500;cursor:pointer;' +
					'border-bottom:1px dashed var(--tm-text-mute);padding-bottom:1px;white-space:nowrap'
			});
			var popup = E('div', {
				'style': 'display:none;position:absolute;top:calc(100% + 4px);left:50%;transform:translateX(-50%);' +
					'background:var(--tm-bg);border:1px solid var(--tm-border);border-radius:6px;' +
					'box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:200;padding:4px 0;white-space:nowrap'
			});
			var selectedValue = currentValue;

			function updateDisplay() {
				var label = selectedValue;
				for (var i = 0; i < options.length; i++) {
					if (options[i].v === selectedValue) { label = options[i].l; break; }
				}
				display.textContent = label;
			}

			function buildPopup() {
				while (popup.firstChild) popup.removeChild(popup.firstChild);
				options.forEach(function(opt) {
					var active = opt.v === selectedValue;
					var item = E('div', {
						'style': 'padding:4px 14px;cursor:pointer;font-size:12px;' +
							(active ? 'color:var(--tm-proto);font-weight:600;background:var(--tm-hover)' : 'color:var(--tm-text)')
					}, opt.l);
					item.addEventListener('mousedown', function(ev) {
						ev.preventDefault();
						selectedValue = opt.v;
						updateDisplay();
						popup.style.display = 'none';
						onChange(opt.v);
					});
					item.addEventListener('mouseenter', function() { this.style.background = 'var(--tm-hover)'; });
					item.addEventListener('mouseleave', function() { this.style.background = active ? 'var(--tm-hover)' : ''; });
					popup.appendChild(item);
				});
			}

			display.addEventListener('click', function(ev) {
				ev.stopPropagation();
				buildPopup();
				popup.style.display = popup.style.display === 'none' ? '' : 'none';
			});
			document.addEventListener('click', function() { popup.style.display = 'none'; });

			wrapper.appendChild(display);
			wrapper.appendChild(popup);
			updateDisplay();
			return { el: wrapper, getValue: function() { return selectedValue; }, setValue: function(v) { selectedValue = v; updateDisplay(); } };
		}

		var showStats = mkToggle('tm-stats', _('Stats'), opts.showStats !== false, function() {
			var o = loadOpts(); o.showStats = this.checked; saveOpts(o); updateUrlParams(o);
			statsDiv.style.display = this.checked ? '' : 'none';
		});
		var showConns = mkToggle('tm-conns', _('Connections'), opts.showConns !== false, function() {
			var o = loadOpts(); o.showConns = this.checked; saveOpts(o); updateUrlParams(o);
			connsDiv.style.display = this.checked ? '' : 'none';
		});
		var rdnsCheck = mkToggle('tm-rdns', _('rDNS'), opts.rdns, function() {
			var o = loadOpts(); o.rdns = this.checked; saveOpts(o); updateUrlParams(o);
		});
		var extStatsCheck = mkToggle('tm-extended', _('Extended'), opts.extendedStats, function() {
			var o = loadOpts(); o.extendedStats = this.checked; saveOpts(o); updateUrlParams(o);
			extStatsDiv.style.display = this.checked ? '' : 'none';
			if (this.checked) updateExtendedStats();
		});

		var extStatsDiv = E('div', { 'style': opts.extendedStats ? '' : 'display:none' });

		var refreshPick = mkInlinePick([
			{v:'0',l:_('Off')},{v:'5',l:'5s'},{v:'10',l:'10s'},{v:'30',l:'30s'},{v:'60',l:'60s'}
		], String(opts.refresh||0), function(v) {
			var o = loadOpts(); o.refresh = parseInt(v); saveOpts(o); updateUrlParams(o); self._setupTimer();
		});

		var pollIntervalPick = mkInlinePick([
			{v:'0',l:_('Off')},{v:'1',l:'1s'},{v:'2',l:'2s'},{v:'5',l:'5s'}
		], String(opts.pollInterval||0), function(v) {
			var o = loadOpts(); o.pollInterval = parseInt(v); saveOpts(o); updateUrlParams(o);
			self._restartBytesPoll();
		});

		var avgWindowPick = mkInlinePick([
			{v:'5',l:'5s'},{v:'15',l:'15s'},{v:'30',l:'30s'},{v:'60',l:'60s'}
		], String(opts.avgWindow||15), function(v) {
			var o = loadOpts(); o.avgWindow = parseInt(v); saveOpts(o); updateUrlParams(o);
		});

		var avgMethodPick = mkInlinePick([
			{v:'simple',l:_('Simple')},{v:'ewma',l:_('EWMA')}
		], opts.avgMethod||'simple', function(v) {
			var o = loadOpts(); o.avgMethod = v; saveOpts(o); updateUrlParams(o);
		});

		var protoPick = mkInlinePick([
			{v:'all',l:_('All')},{v:'tcp',l:'TCP'},{v:'udp',l:'UDP'}
		], opts.proto||'all', function(v) {
			var o = loadOpts(); o.proto = v; saveOpts(o);
		});

		var groupPick = mkInlinePick(
			GROUP_OPTS, opts.groupBy||'none', function(v) {
			var o = loadOpts(); o.groupBy = v; saveOpts(o); runQuery();
		});

		var statusDiv = E('div', { 'style': 'display:none' });
		var statsDiv  = E('div', { 'style': 'margin:8px 0' + (opts.showStats===false?';display:none':'') });
		var connsDiv  = E('div', { 'style': opts.showConns===false?'display:none':'' });

		var BTN_BASE = 'padding:5px 14px;border-radius:3px;cursor:pointer;font-size:13px;min-width:140px;text-align:center;font-weight:500';
		var BTN_ORANGE = BTN_BASE + ';background:#c05621;color:#fff;border:1px solid #9c4221';
		var BTN_GREEN  = BTN_BASE + ';background:#276749;color:#fff;border:1px solid #22543d';

		var inetBtn = E('button', { 'class': 'cbi-button' }, '');
		var wifiBtn = E('button', { 'class': 'cbi-button', 'style': 'display:none' }, '');

		function updateInetBtn(blocked) {
			if (blocked) {
				inetBtn.textContent = '▶️ ' + _('Unblock Internet');
				inetBtn.style.cssText = BTN_GREEN;
				inetBtn._action = 'unblock';
			} else {
				inetBtn.textContent = '⏸️ ' + _('Block Internet');
				inetBtn.style.cssText = BTN_ORANGE;
				inetBtn._action = 'block';
			}
		}
		updateInetBtn(false);

		function updateWifiBtn(wifiBlocked, hasMac) {
			if (!hasMac) { wifiBtn.style.display = 'none'; return; }
			wifiBtn.style.display = '';
			wifiBtn.disabled = false;
			if (wifiBlocked) {
				wifiBtn.textContent = '📡✓ ' + _('Unblock WiFi');
				wifiBtn.style.cssText = BTN_GREEN;
				wifiBtn._wifiAction = 'unblock';
			} else {
				wifiBtn.textContent = '📡❌ ' + _('Block WiFi');
				wifiBtn.style.cssText = BTN_ORANGE;
				wifiBtn._wifiAction = 'block';
			}
		}

		var ratePick = mkInlinePick(RATE_PRESETS, '0', function(v) {
			var isCustom = v === 'custom';
			customInput.style.display = isCustom ? '' : 'none';
			customUnitPick.el.style.display = isCustom ? '' : 'none';
		});
		var customInput = E('input', { 'type':'number', 'min':'1', 'step':'1', 'placeholder': _('value'),
			'class':'cbi-input-text', 'style':'width:80px;display:none;font-size:12px;padding:2px 6px' });
		var customUnitPick = mkInlinePick([
			{v:'mbit',l:'Mbit/s'},{v:'kbit',l:'kbit/s'}
		], 'mbit', function() {});
		customUnitPick.el.style.display = 'none';
		var modePick = mkInlinePick([
			{v:'shaper',l:_('Shaper (queue)')},{v:'limiter',l:_('Limiter (drop)')}
		], 'shaper', function() {});
		var rateBtn = E('button', { 'class': 'cbi-button cbi-button-action', 'style': 'font-size:12px;padding:3px 12px' }, _('Apply'));

		var rateLimitRow = E('div', {
			'style': 'display:none;padding:10px 14px;border-radius:4px;margin-bottom:8px;' +
				'border:1px solid var(--tm-border);background:var(--tm-opts-bg)'
		}, [
			E('div', {'style':'font-size:11px;font-weight:600;color:var(--tm-text-mute);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px'}, _('Speed Limit')),
			E('div', {'style':'display:flex;align-items:center;gap:8px;flex-wrap:wrap'}, [
				mkLabel(_('Rate') + ':'), ratePick.el, customInput, customUnitPick.el,
				E('span',{'style':'border-left:1px solid var(--tm-border);height:18px;margin:0 4px'}),
				mkLabel(_('Mode') + ':'), modePick.el,
				rateBtn
			])
		]);

		function getRateKbit() {
			var v = ratePick.getValue();
			if (v !== 'custom') return v;
			var n = parseFloat(customInput.value);
			if (!n || n <= 0) return '0';
			if (customUnitPick.getValue() === 'mbit') return String(Math.round(n * 1000));
			return String(Math.round(n));
		}

		var actionRow = E('div', { 'style': 'display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:6px;margin-top:8px' },
			[inetBtn, wifiBtn]);

		function isAllMode() { return searchSelect.getValue() === '__all__'; }

		function updateModeUI() {
			var all = isAllMode();
			actionRow.style.display     = all ? 'none' : '';
			rateLimitRow.style.display  = all ? 'none' : '';
			rdnsCheck.style.display     = all ? 'none' : '';
			extStatsCheck.style.display = all ? 'none' : '';
		}

		function updateSpeedCells() {
			var globalMax = 0;
			Object.keys(self._speedHistory).forEach(function(ip) {
				var hist = self._speedHistory[ip];
				if (hist) hist.forEach(function(h) { if (h.speed > globalMax) globalMax = h.speed; });
			});

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
				cell.title = _('Avg')+': '+fmtSpeed(s.avg)+' / '+_('Max')+': '+fmtSpeed(s.max);

				var sparkCell = connsDiv.querySelector('td[data-spark-ip="'+ip+'"]');
				if (sparkCell) {
					while (sparkCell.firstChild) sparkCell.removeChild(sparkCell.firstChild);
					var svg = renderSparkline(self._speedHistory[ip], globalMax, 60, 20);
					if (svg) sparkCell.appendChild(svg);
				}
			});
		}

		function pollDrops() {
			if (document.hidden) return;
			callRatelimitStats().then(function(data) {
				if (!Array.isArray(data)) return;
				data.forEach(function(d) {
					self._dropMap[d.ip] = { packets: d.packets, bytes: d.bytes, rate_kbit: d.rate_kbit, pass_packets: d.pass_packets, pass_bytes: d.pass_bytes };
				});
				if (isAllMode()) {
					Object.keys(self._dropMap).forEach(function(ip) {
						var dp = self._dropMap[ip].packets || 0;
						var db = self._dropMap[ip].bytes   || 0;
						var cell = connsDiv.querySelector('td[data-drop-ip="'+ip+'"]');
						if (!cell) return;
						while (cell.firstChild) cell.removeChild(cell.firstChild);
						if (dp > 0) {
							cell.appendChild(E('span', {
								'style': 'color:'+C.dropFg+';font-weight:600',
								'title': fmtBytes(db) + ' ' + _('dropped')
							}, '🚫 ' + dp));
						} else {
							cell.appendChild(E('span', { 'style': 'color:'+C.textFaint }, '—'));
						}
					});
				}
				updateExtendedStats();
			}).catch(function(){});
		}

		function pollShapeStats() {
			if (document.hidden) return;
			callShapeStats().then(function(data) {
				if (!Array.isArray(data)) return;
				data.forEach(function(d) {
					self._shapeMap[d.ip] = {
						packets: d.packets, bytes: d.bytes, backlog: d.backlog, rate_kbit: d.rate_kbit,
						drops: d.drops, overlimits: d.overlimits, requeues: d.requeues,
						lended: d.lended, borrowed: d.borrowed, ecn_mark: d.ecn_mark,
						new_flows: d.new_flows, old_flows: d.old_flows,
						target_us: d.target_us, memory_used: d.memory_used
					};
				});
				if (isAllMode()) {
					Object.keys(self._shapeMap).forEach(function(ip) {
						var bl = self._shapeMap[ip].backlog || 0;
						var cell = connsDiv.querySelector('td[data-backlog-ip="'+ip+'"]');
						if (!cell) return;
						while (cell.firstChild) cell.removeChild(cell.firstChild);
						if (bl > 0) {
							cell.appendChild(E('span', { 'style': 'color:'+C.shapeFg+';font-weight:600', 'title': _('Bytes queued in tc') }, fmtBytes(bl)));
						} else {
							cell.appendChild(E('span', { 'style': 'color:'+C.textFaint }, '—'));
						}
					});
				}
				updateExtendedStats();
			}).catch(function(){});
		}

		function pollBytes() {
			if (document.hidden) return;
			if (!isAllMode()) return;
			callBytes().then(function(data) {
				if (!Array.isArray(data)) return;
				var now = Date.now();
				var o = loadOpts();
				var pollInterval = o.pollInterval || 2;
				var avgWindow = o.avgWindow || 15;
				var avgMethod = o.avgMethod || 'simple';
				var maxSamples = Math.max(2, Math.round(avgWindow / (pollInterval || 2)));

				var activeIps = {};
				data.forEach(function(d) { activeIps[d.ip] = true; });
				Object.keys(self._speedHistory).forEach(function(ip) {
					if (!activeIps[ip]) {
						delete self._speedHistory[ip];
						delete self._speedMap[ip];
						delete self._speedEwma[ip];
						delete self._bytesHistory[ip];
					}
				});

				data.forEach(function(d) {
					var prev = self._bytesHistory[d.ip];
					if (prev) {
						var dt = (now - prev.time) / 1000;
						if (dt < 0.5) return;
						var dIn = d.bytes_in - prev.bytes_in;
						if (dIn < 0) dIn = 0;
						var speed = dIn / dt;

						if (avgMethod === 'ewma') {
							var alpha = 2 / (maxSamples + 1);
							var prevEwma = self._speedEwma[d.ip] || 0;
							var ewma = alpha * speed + (1 - alpha) * prevEwma;
							self._speedEwma[d.ip] = ewma;
							if (!self._speedHistory[d.ip]) self._speedHistory[d.ip] = [];
							self._speedHistory[d.ip].push({speed: speed, time: now});
							if (self._speedHistory[d.ip].length > maxSamples) self._speedHistory[d.ip].shift();
							var max = 0;
							self._speedHistory[d.ip].forEach(function(h){ if (h.speed > max) max = h.speed; });
							self._speedMap[d.ip] = {
								current: speed,
								avg: ewma,
								max: max
							};
						} else {
							if (!self._speedHistory[d.ip]) self._speedHistory[d.ip] = [];
							self._speedHistory[d.ip].push({speed: speed, time: now});
							if (self._speedHistory[d.ip].length > maxSamples) self._speedHistory[d.ip].shift();
							var hist = self._speedHistory[d.ip];
							var sum = 0, sMax = 0;
							hist.forEach(function(h){ sum += h.speed; if (h.speed > sMax) sMax = h.speed; });
							self._speedMap[d.ip] = {
								current: speed,
								avg: sum / hist.length,
								max: sMax
							};
						}
					}
					self._bytesHistory[d.ip] = {
						bytes_in: d.bytes_in,
						bytes_out: d.bytes_out,
						time: now
					};
				});
				if (self._sumCol === '_speed') {
					runAll();
				} else {
					updateSpeedCells();
				}
			}).catch(function(){});
		}

		function runSingle(ip) {
			var o = loadOpts();
			var proto = (o.proto && o.proto !== 'all') ? o.proto : '';
			self._queryGen++;
			var gen = self._queryGen;

			setStatus(statusDiv, 'loading', _('Running…'));

			callDevice(ip, proto).then(function(data) {
				if (!data || data.error) {
					setStatus(statusDiv, 'error', (data && data.error) || _('Unknown error'));
					return;
				}

				if (opts.showStats !== false) {
					var parts = [_('Connections') + ': <b>'+data.total+'</b>'];
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
						parts.push(_('Shaped') + ': <b style="color:'+C.shapeFg+'">🌊 '+fmtRate(data.shape_kbit)+'</b>');
						var sm = self._shapeMap[data.ip || searchSelect.getValue()] || {};
						if ((sm.backlog||0) > 0) parts.push(_('Queued') + ': <b style="color:'+C.shapeFg+'">'+fmtBytes(sm.backlog)+'</b>');
						if ((sm.bytes||0) > 0) parts.push(_('Passed') + ': <b>'+fmtBytes(sm.bytes)+'</b>');
					} else if ((data.rate_limit_kbit || 0) > 0) {
						parts.push(_('Speed limit') + ': <b style="color:'+C.rateFg+'">⚡ '+fmtRate(data.rate_limit_kbit)+'</b>');
						var dm = self._dropMap[data.ip || searchSelect.getValue()] || {};
						if ((dm.packets||0) > 0) {
							parts.push(_('Dropped') + ': <b style="color:'+C.dropFg+'">🚫 '+dm.packets+' pkts / '+fmtBytes(dm.bytes||0)+'</b>');
						}
					}
					var wifiPart = data.wifi_blocked
						? ' &nbsp;|&nbsp; <b style="color:'+C.stateWait+'">📵 ' + _('WiFi blocked') + '</b> ('+escHtml(data.mac||'') + ')'
						: (data.mac ? ' &nbsp;|&nbsp; <span style="color:'+C.textFaint+'">MAC: '+escHtml(data.mac)+'</span>' : '');
					statsDiv.style.cssText = 'padding:8px 14px;border-radius:4px;font-size:13px;margin-bottom:8px;' +
						(data.blocked ? 'background:'+C.blockedBg+';border:1px solid '+C.blockedBorder+';color:'+C.blockedFg
						             : 'background:'+C.infoBg   +';border:1px solid '+C.infoBorder+';color:'+C.infoFg);
					statsDiv.innerHTML = (data.blocked
						? '<b>⛔ ' + _('BLOCKED') + '</b> — '+data.block_packets+' pkts, '+fmtBytes(data.block_bytes)+' ' + _('dropped') + ' &nbsp;|&nbsp; '
						: '') + parts.join(' &nbsp;|&nbsp; ') + wifiPart;
				}

				updateInetBtn(data.blocked);
				updateWifiBtn(data.wifi_blocked, !!data.mac);

				var curShapeRate = data.shape_kbit || 0;
				var curLimitRate = data.rate_limit_kbit || 0;
				var curRate = curShapeRate > 0 ? curShapeRate : curLimitRate;
				modePick.setValue(curShapeRate > 0 ? 'shaper' : 'limiter');

				var curRateStr = String(curRate);
				var matched = RATE_PRESETS.some(function(p) { return p.v === curRateStr; });
				if (matched) {
					ratePick.setValue(curRateStr);
					customInput.style.display = 'none';
					customUnitPick.el.style.display = 'none';
				} else if (curRate > 0) {
					ratePick.setValue('custom');
					customInput.value = curRate;
					customUnitPick.setValue('kbit');
					customInput.style.display = '';
					customUnitPick.el.style.display = '';
				} else {
					ratePick.setValue('0');
					customInput.style.display = 'none';
					customUnitPick.el.style.display = 'none';
				}

				while (connsDiv.firstChild) connsDiv.removeChild(connsDiv.firstChild);
				if (!data.connections || data.connections.length === 0) {
					connsDiv.appendChild(E('p', {'style':'color:'+C.textMute+';padding:12px 0'}, _('No active connections.')));
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
							groups.length + ' ' + _('groups from') + ' ' + data.connections.length + ' ' + _('connections') + '. ' + _('Click header to sort.')));
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
							data.connections.length + ' ' + _('connections') + '. ' + _('Click header to sort.')));

						if (o.rdns) {
							var seen = {};
							data.connections.forEach(function(c) {
								var dst = c.dst || '';
								if (!dst || seen[dst]) return;
								if (PRIVATE_RE.test(dst)) return;
								seen[dst] = true;
								callRdns(dst).then(function(res) {
									if (gen !== self._queryGen) return;
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
								}).catch(function() {
									if (gen !== self._queryGen) return;
									Array.prototype.forEach.call(
										connsDiv.querySelectorAll('td[data-dst="'+dst+'"]'),
										function(cell) { cell.innerHTML = '<span style="color:'+C.textFaint+'">—</span>'; }
									);
								});
							});
						}
					}
				}
				setStatus(statusDiv, 'ok', '✓ ' + _('Done'));
			})
			.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); });
		}

		self._tableFilter = null;
		self._lastRows = [];

		function applyTableFilter(rows) {
			var f = self._tableFilter;
			if (!f) return rows;
			if (f === 'blocked') return rows.filter(function(r) { return r.blocked; });
			if (f === 'wifi_blocked') return rows.filter(function(r) { return r.wifi_blocked; });
			if (f === 'limited') return rows.filter(function(r) { return (r.rate_limit_kbit||0) > 0; });
			if (f === 'shaped') return rows.filter(function(r) { return (r.shape_kbit||0) > 0; });
			return rows;
		}

		function setTableFilter(f) {
			self._tableFilter = (self._tableFilter === f) ? null : f;
			renderSummary(self._lastRows);
		}

		function renderSummary(rows) {
			self._lastRows = rows;
			var limited = rows.filter(function(r){return (r.rate_limit_kbit||0) > 0;}).length;
			var shaped  = rows.filter(function(r){return (r.shape_kbit||0) > 0;}).length;
			var blocked = rows.filter(function(r){return r.blocked;}).length;
			var wifiBlk = rows.filter(function(r){return r.wifi_blocked;}).length;
			var totalDropPkts = Object.keys(self._dropMap).reduce(function(s, ip) { return s + (self._dropMap[ip].packets||0); }, 0);

			var lnk = 'cursor:pointer;text-decoration:underline;text-decoration-style:dashed';
			var activeFilter = self._tableFilter;

			statsDiv.style.cssText = 'padding:8px 14px;border-radius:4px;font-size:13px;margin-bottom:8px;background:'+C.infoBg+';border:1px solid '+C.infoBorder+';color:'+C.infoFg;
			while (statsDiv.firstChild) statsDiv.removeChild(statsDiv.firstChild);

			function mkFilterVal(filter, color, text) {
				var active = activeFilter === filter;
				var b = E('b', {'style': lnk+';color:'+color+(active?';font-weight:700':''), 'data-filter': filter}, text);
				return b;
			}

			var parts = [];
			parts.push(E('span', {}, [document.createTextNode(_('Active') + ': '), E('b', {}, String(rows.length))]));
			parts.push(E('span', {}, [document.createTextNode(_('Blocked') + ': '), mkFilterVal('blocked', C.blockedFg, String(blocked))]));
			parts.push(E('span', {}, [document.createTextNode(_('WiFi') + ': '), mkFilterVal('wifi_blocked', C.stateWait, String(wifiBlk))]));
			if (limited > 0) parts.push(E('span', {}, [document.createTextNode(_('Limited') + ': '), mkFilterVal('limited', C.rateFg, '⚡' + limited)]));
			if (shaped > 0) parts.push(E('span', {}, [document.createTextNode(_('Shaped') + ': '), mkFilterVal('shaped', C.shapeFg, '🌊' + shaped)]));
			if (totalDropPkts > 0) parts.push(E('span', {}, [
				document.createTextNode(_('Dropped') + ': '), E('b', {'style':'color:'+C.dropFg}, '🚫' + totalDropPkts)
			]));

			parts.forEach(function(el, i) {
				if (i > 0) statsDiv.appendChild(E('span', {'style':'margin:0 6px;color:'+C.textFaint}, '|'));
				statsDiv.appendChild(el);
				var filterEl = el.querySelector('[data-filter]');
				if (filterEl) {
					filterEl.addEventListener('click', function() { setTableFilter(filterEl.getAttribute('data-filter')); });
				}
			});

			if (activeFilter) {
				statsDiv.appendChild(E('span', {'style':'margin-left:10px;cursor:pointer;color:'+C.textMute+';font-size:11px'}, '✕ ' + _('clear filter')));
				statsDiv.lastChild.addEventListener('click', function() { self._tableFilter = null; renderSummary(rows); });
			}

			var filtered = applyTableFilter(rows);
			while (connsDiv.firstChild) connsDiv.removeChild(connsDiv.firstChild);
			if (filtered.length === 0) {
				connsDiv.appendChild(E('p',{'style':'color:'+C.textMute+';padding:12px 0'}, _('No devices match filter.')));
			} else {
				var tbl = buildSummaryTable(
					filtered,
					self._sumCol,
					self._sumDir,
					function(key, isNum) {
						if (self._sumCol === key) {
							self._sumDir = self._sumDir === 'asc' ? 'desc' : 'asc';
						} else {
							self._sumCol = key;
							self._sumDir = isNum ? 'desc' : 'asc';
						}
						renderSummary(rows);
					},
					function(ip) {
						var dev = rows.filter(function(r) { return r.ip === ip; })[0];
						var lbl = dev && dev.name && dev.name !== '*' ? dev.name + '  —  ' + ip : ip;
						searchSelect.setValue(ip, lbl);
						var o = loadOpts(); o.lastIp = ip; saveOpts(o); updateUrlParams(o);
						updateModeUI();
						runQuery();
					},
					self._speedMap,
					self._dropMap,
					self._shapeMap,
					self._speedHistory,
					self._hiddenCols
				);
				connsDiv.appendChild(E('div',{'style':'overflow-x:auto'},[tbl]));
				connsDiv.appendChild(E('p',{'style':'color:'+C.textFaint+';font-size:11px;margin-top:6px'},
					_('Click a row to inspect that device. Download speed updates every 2 seconds.')));
			}
		}

		function runAll() {
			setStatus(statusDiv, 'loading', _('Scanning all devices…'));

			callTrafficctl().then(function(rows) {
				if (!Array.isArray(rows)) rows = [];
				renderSummary(rows);
				setStatus(statusDiv, 'ok', '✓ ' + _('Done'));
				self._startBytesPoll();
			})
			.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); });
		}

		function updateExtendedStats() {
			var o = loadOpts();
			if (!o.extendedStats) return;
			while (extStatsDiv.firstChild) extStatsDiv.removeChild(extStatsDiv.firstChild);
			var ip = searchSelect.getValue();
			if (ip === '__all__') {
				extStatsDiv.appendChild(buildExtendedStatsLegend(self._shapeMap, self._dropMap));
			} else {
				extStatsDiv.appendChild(buildExtendedStatsPanel(ip, self._shapeMap, self._dropMap, self._speedMap));
			}
		}

		function runQuery() {
			var ip = searchSelect.getValue();
			var o = loadOpts(); o.lastIp = ip; saveOpts(o);
			updateUrlParams(o);
			updateModeUI();
			if (ip === '__all__') {
				runAll();
			} else {
				self._stopBytesPoll();
				pollDrops();
				runSingle(ip);
			}
			updateExtendedStats();
		}

		rateBtn.addEventListener('click', function() {
			var ip   = searchSelect.getValue();
			var name = '';
			var kbit = getRateKbit();
			var mode = modePick.getValue();
			rateBtn.disabled = true;

			if (kbit === '0') {
				setStatus(statusDiv, 'loading', _('Removing throttle for') + ' ' + name + '…');
				Promise.all([
					callRatelimit(ip, 0, name),
					callShapeRemove(ip, name)
				]).then(function(results) {
					var res = results[0] || {};
					setStatus(statusDiv, 'ok', res.msg || _('Throttle removed'));
					runQuery();
				}).catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
				  .then(function() { rateBtn.disabled = false; });
			} else if (mode === 'shaper') {
				setStatus(statusDiv, 'loading', _('Shaping') + ' ' + name + ' → ' + fmtRate(parseInt(kbit)) + '…');
				callRatelimit(ip, 0, name)
					.then(function() {
						return callShapeAdd(ip, parseInt(kbit), name);
					})
					.then(function(res) {
						setStatus(statusDiv, (res && res.ok) ? 'action' : 'error', (res && res.msg) || '?');
						runQuery();
					})
					.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
					.then(function() { rateBtn.disabled = false; });
			} else {
				setStatus(statusDiv, 'loading', _('Limiting') + ' ' + name + ' → ' + fmtRate(parseInt(kbit)) + '…');
				callShapeRemove(ip, name)
					.then(function() {
						return callRatelimit(ip, parseInt(kbit), name);
					})
					.then(function(res) {
						setStatus(statusDiv, (res && res.ok) ? 'action' : 'error', (res && res.msg) || '?');
						runQuery();
					})
					.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
					.then(function() { rateBtn.disabled = false; });
			}
		});

		wifiBtn.addEventListener('click', function() {
			var ip   = searchSelect.getValue();
			var action = wifiBtn._wifiAction;
			wifiBtn.disabled = true;
			var name = '';
			setStatus(statusDiv, 'loading', (action==='block' ? _('Adding to') : _('Removing from')) + ' ' + _('WiFi deny list') + ': ' + name + '…');
			var fn = action === 'block' ? callMacfilterAdd : callMacfilterRemove;
			fn(ip).then(function(res) {
				setStatus(statusDiv, (res && res.ok) ? (action==='block'?'action':'ok') : 'error', (res && res.msg) || '?');
				runQuery();
			});
		});

		inetBtn.addEventListener('click', function() {
			var ip = searchSelect.getValue();
			if (!ip || ip === '__all__') return;
			inetBtn.disabled = true;
			var action = inetBtn._action;
			var fn = action === 'block' ? callBlock : callUnblock;
			fn(ip, '').then(function() {
				runQuery();
			}).catch(function(e) {
				setStatus(statusDiv, 'error', e.message);
			}).then(function() {
				inetBtn.disabled = false;
			});
		});

		this._setupTimer = function() {
			if (self._timer) { clearInterval(self._timer); self._timer = null; }
			var iv = parseInt(loadOpts().refresh||0);
			if (iv > 0) self._timer = setInterval(runQuery, iv*1000);
		};

		this._startBytesPoll = function() {
			if (self._bytesTimer) return;
			var o = loadOpts();
			var pollMs = (o.pollInterval || 0) * 1000;
			if (pollMs <= 0) return;
			pollBytes();
			self._bytesTimer = setInterval(pollBytes, pollMs);
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
		this._restartBytesPoll = function() {
			self._stopBytesPoll();
			if (isAllMode()) self._startBytesPoll();
		};

		this._setupTimer();
		setTimeout(function() { runQuery(); }, 0);

		var savedHidden = opts.hiddenCols || {};
		self._hiddenCols = savedHidden;

		var colChipDefs = [
			{key:'name', label:_('Device')}, {key:'ip', label:'IP'}, {key:'mac', label:'MAC'},
			{key:'_speed', label:_('Speed')}, {key:'_spark', label:_('Graph')},
			{key:'conns', label:_('Conns')}, {key:'total', label:_('Bytes')},
			{key:'tcp', label:'TCP'}, {key:'udp', label:'UDP'},
			{key:'blocked', label:_('Inet')}, {key:'conn_type', label:_('Link')},
			{key:'_throttle_kbit', label:_('Speed Limit')},
			{key:'_drop_packets', label:_('Drops')}, {key:'_backlog', label:_('Queue')}
		];
		var chipBase = 'display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;cursor:pointer;user-select:none;margin:2px;transition:all .15s;font-weight:500';
		var chipOn = chipBase + ';background:var(--tm-proto);color:#fff;border:1px solid var(--tm-proto)';
		var chipOff = chipBase + ';background:var(--tm-bg);color:var(--tm-text-mute);border:1px solid var(--tm-border)';

		var colChipsContainer = E('div', {'style':'display:flex;flex-wrap:wrap;align-items:center;gap:0'});
		colChipDefs.forEach(function(ct) {
			var chip = E('span', {
				'style': savedHidden[ct.key] ? chipOff : chipOn,
				'title': _('Click to toggle column visibility')
			}, ct.label);
			chip.addEventListener('click', function() {
				if (self._hiddenCols[ct.key]) { delete self._hiddenCols[ct.key]; chip.style.cssText = chipOn; }
				else { self._hiddenCols[ct.key] = true; chip.style.cssText = chipOff; }
				var o = loadOpts(); o.hiddenCols = self._hiddenCols; saveOpts(o);
				if (isAllMode()) runAll();
			});
			colChipsContainer.appendChild(chip);
		});

		var ob = 'border:1px solid '+C.optsBorder+';background:'+C.optsBg;
		var sep = function() { return E('span',{'style':'border-left:1px solid '+C.border+';height:18px;margin:0 4px'}); };
		var sectionLabel = function(t) { return E('div', {'style':'font-size:11px;font-weight:600;color:var(--tm-text-mute);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;margin-top:8px'}, t); };

		var settingsBody = E('div', {'style':'padding:0 14px 10px'});
		var settingsCollapsed = false;
		var settingsToggle = E('div', {
			'style': 'padding:8px 14px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--tm-text-mute)'
		}, [E('span', {'class':'tm-settings-arrow'}, '▾'), E('span', {}, _('Settings'))]);

		settingsToggle.addEventListener('click', function() {
			settingsCollapsed = !settingsCollapsed;
			settingsBody.style.display = settingsCollapsed ? 'none' : '';
			settingsToggle.firstChild.textContent = settingsCollapsed ? '▸' : '▾';
		});

		settingsBody.appendChild(E('div', {}, [
			sectionLabel(_('Display')),
			E('div', {'style':'display:flex;flex-wrap:wrap;align-items:center;gap:6px'}, [
				showStats, showConns, extStatsCheck, rdnsCheck
			])
		]));

		settingsBody.appendChild(E('div', {}, [
			sectionLabel(_('Speed Monitoring')),
			E('div', {'style':'display:flex;flex-wrap:wrap;align-items:center;gap:6px'}, [
				E('span', {'title':_('Auto-refresh interval for summary table')}, [mkLabel(_('Refresh')+':'), refreshPick.el]),
				sep(),
				E('span', {'title':_('Polling interval for speed measurements')}, [mkLabel(_('Poll')+':'), pollIntervalPick.el]),
				sep(),
				E('span', {'title':_('Time window for speed averaging')}, [mkLabel(_('Window')+':'), avgWindowPick.el]),
				sep(),
				E('span', {'title':_('Simple = arithmetic mean, EWMA = exponential weighted moving average')}, [mkLabel(_('Method')+':'), avgMethodPick.el])
			])
		]));

		settingsBody.appendChild(E('div', {}, [
			sectionLabel(_('Table Filters')),
			E('div', {'style':'display:flex;flex-wrap:wrap;align-items:center;gap:6px'}, [
				E('span', {'title':_('Filter connections by protocol')}, [mkLabel(_('Proto')+':'), protoPick.el]),
				sep(),
				E('span', {'title':_('Group connections table rows')}, [mkLabel(_('Group')+':'), groupPick.el])
			])
		]));

		settingsBody.appendChild(E('div', {}, [
			sectionLabel(_('Table Columns')),
			colChipsContainer
		]));

		// ── Telegram Bot section (lazy-loaded) ─────────────────────────────
		var tgBody = E('div', {'style':'display:none;padding-top:6px'});
		var tgLoaded = false;
		var tgLabel = sectionLabel(_('Telegram Bot'));
		var tgArrow = E('span', {'style':'cursor:pointer;font-size:11px;color:'+C.textMute}, ' ▸');
		tgLabel.style.cursor = 'pointer';
		tgLabel.appendChild(tgArrow);
		tgLabel.addEventListener('click', function() {
			var open = tgBody.style.display !== 'none';
			tgBody.style.display = open ? 'none' : '';
			tgArrow.textContent = open ? ' ▸' : ' ▾';
			if (!open && !tgLoaded) {
				tgLoaded = true;
				loadTelegramUI(tgBody);
			}
		});

		function loadTelegramUI(container) {
			var statusSpan = E('span', {'style':'font-size:12px;margin-left:8px;color:'+C.textMute}, _('Loading…'));
			container.appendChild(statusSpan);

			callTelegramGet().then(function(cfg) {
				while (container.firstChild) container.removeChild(container.firstChild);

				var tokenInput = E('input', {
					'type': 'password',
					'value': cfg.bot_token || '',
					'placeholder': cfg.bot_token_set ? '••••••••' : _('Paste bot token'),
					'style': 'font-size:12px;padding:3px 6px;width:260px;background:var(--tm-bg);color:var(--tm-text);border:1px solid var(--tm-border);border-radius:3px'
				});
				var eyeBtn = E('span', {
					'style': 'cursor:pointer;font-size:14px;margin-left:4px;user-select:none',
					'title': _('Show/hide token')
				}, '👁');
				eyeBtn.addEventListener('click', function() {
					tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
				});

				var chatInput = E('input', {
					'type': 'text',
					'value': cfg.chat_id || '',
					'placeholder': _('Chat ID'),
					'style': 'font-size:12px;padding:3px 6px;width:120px;background:var(--tm-bg);color:var(--tm-text);border:1px solid var(--tm-border);border-radius:3px'
				});

				var testResult = E('span', {'style':'font-size:12px;margin-left:8px'});
				var testBtn = E('button', {
					'class': 'cbi-button',
					'style': 'font-size:11px;padding:2px 10px'
				}, _('Test'));
				testBtn.addEventListener('click', function() {
					testBtn.disabled = true;
					testResult.textContent = _('Sending…');
					testResult.style.color = C.textMute;
					var tk = tokenInput.value || '***';
					callTelegramTest(tk, chatInput.value).then(function(res) {
						testResult.textContent = (res && res.ok) ? '✓ ' + (res.msg || 'OK') : '✗ ' + (res && res.msg || 'error');
						testResult.style.color = (res && res.ok) ? 'var(--tm-state-ok)' : 'var(--tm-blocked-fg)';
					}).catch(function(e) {
						testResult.textContent = '✗ ' + e.message;
						testResult.style.color = 'var(--tm-blocked-fg)';
					}).then(function() { testBtn.disabled = false; });
				});

				var tgEnabled = mkToggle('tm-tg-enabled', _('Enabled'), cfg.enabled, function() {});
				var notifyNew = mkToggle('tm-tg-new', _('New devices'), cfg.notify_new_device, function() {});
				var notifyKnown = mkToggle('tm-tg-known', _('Known devices'), cfg.notify_known_device, function() {});
				var btnInet = mkToggle('tm-tg-inet', _('Block Internet'), cfg.btn_block_inet, function() {});
				var btnWifi = mkToggle('tm-tg-wifi', _('Block WiFi'), cfg.btn_block_wifi, function() {});
				var btnLimit = mkToggle('tm-tg-limit', _('Limiter'), cfg.btn_limiter, function() {});
				var btnShape = mkToggle('tm-tg-shape', _('Shaper'), cfg.btn_shaper, function() {});

				var saveResult = E('span', {'style':'font-size:12px;margin-left:8px'});
				var saveBtn = E('button', {
					'class': 'cbi-button cbi-button-action',
					'style': 'font-size:12px;padding:3px 12px'
				}, _('Save'));
				saveBtn.addEventListener('click', function() {
					saveBtn.disabled = true;
					saveResult.textContent = _('Saving…');
					saveResult.style.color = C.textMute;
					var tk = tokenInput.value;
					if (tk === '' && cfg.bot_token_set) tk = '***';
					callTelegramSet(
						container.querySelector('#tm-tg-enabled').checked,
						tk,
						chatInput.value,
						parseInt(cfg.poll_interval) || 3,
						container.querySelector('#tm-tg-new').checked,
						container.querySelector('#tm-tg-known').checked,
						container.querySelector('#tm-tg-inet').checked,
						container.querySelector('#tm-tg-wifi').checked,
						container.querySelector('#tm-tg-limit').checked,
						container.querySelector('#tm-tg-shape').checked
					).then(function(res) {
						saveResult.textContent = (res && res.ok) ? '✓ Saved' : '✗ ' + (res && res.msg || 'error');
						saveResult.style.color = (res && res.ok) ? 'var(--tm-state-ok)' : 'var(--tm-blocked-fg)';
						if (res && res.ok) {
							cfg.bot_token_set = !!(tk && tk !== '***') || cfg.bot_token_set;
							if (tk && tk !== '***') {
								tokenInput.value = '***';
								tokenInput.type = 'password';
							}
						}
					}).catch(function(e) {
						saveResult.textContent = '✗ ' + e.message;
						saveResult.style.color = 'var(--tm-blocked-fg)';
					}).then(function() { saveBtn.disabled = false; });
				});

				var gap = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px';

				container.appendChild(E('div', {'style':gap}, [tgEnabled]));
				container.appendChild(E('div', {'style':gap+';margin-top:6px'}, [
					mkLabel(_('Token:')), tokenInput, eyeBtn,
					E('span', {'style':'margin-left:8px'}),
					mkLabel(_('Chat ID:')), chatInput,
					testBtn, testResult
				]));
				container.appendChild(E('div', {'style':'margin-top:8px'}, [
					E('div', {'style':'font-size:11px;color:'+C.textMute+';margin-bottom:4px'}, _('Notifications')),
					E('div', {'style':gap}, [notifyNew, notifyKnown])
				]));
				container.appendChild(E('div', {'style':'margin-top:6px'}, [
					E('div', {'style':'font-size:11px;color:'+C.textMute+';margin-bottom:4px'}, _('Action buttons in bot')),
					E('div', {'style':gap}, [btnInet, btnWifi, btnLimit, btnShape])
				]));
				container.appendChild(E('div', {'style':'margin-top:8px'}, [saveBtn, saveResult]));
			}).catch(function(e) {
				statusSpan.textContent = '✗ ' + e.message;
				statusSpan.style.color = 'var(--tm-blocked-fg)';
			});
		}

		settingsBody.appendChild(E('div', {}, [tgLabel, tgBody]));

		var settingsPanel = E('div', {'style':'border-radius:4px;margin-bottom:10px;'+ob}, [
			settingsToggle, settingsBody
		]);

		return E('div', {'class':'cbi-map', 'style':'color:'+C.hostname}, [
			E('h2', {'style':'color:'+C.hostname}, _('Traffic Control')),
			E('div', {'class':'cbi-section'}, [
				E('div', {'style':'margin-bottom:10px'}, [searchSelect.el]),
				actionRow,
				rateLimitRow,
				statusDiv,
				statsDiv,
				extStatsDiv,
				settingsPanel,
				connsDiv
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null,

	handleTeardown: function() {
		if (this._timer) { clearInterval(this._timer); this._timer = null; }
		this._stopBytesPoll && this._stopBytesPoll();
	}
});
