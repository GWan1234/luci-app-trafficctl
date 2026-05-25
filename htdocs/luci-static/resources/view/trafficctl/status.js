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
	expect: { '': [] }
});

var callDevice = rpc.declare({
	object: 'luci.trafficctl',
	method: 'device',
	params: ['ip', 'proto']
});

var callBytes = rpc.declare({
	object: 'luci.trafficctl',
	method: 'bytes',
	expect: { '': [] }
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
	expect: { '': [] }
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
	expect: { '': [] }
});

var callRdns = rpc.declare({
	object: 'luci.trafficctl',
	method: 'rdns',
	params: ['ip']
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

function buildSummaryTable(rows, sortCol, sortDir, onSort, onSelect, speedMap, dropMap, shapeMap) {
	var cols = [
		{ key:'name',             label: _('Device'),   num:false },
		{ key:'ip',               label:'IP',           num:false },
		{ key:'mac',              label:'MAC',          num:false },
		{ key:'_speed',           label: _('DL Speed'), num:true  },
		{ key:'total',            label: _('Conns'),    num:true  },
		{ key:'tcp',              label:'TCP',          num:true  },
		{ key:'udp',              label:'UDP',          num:true  },
		{ key:'blocked',          label: _('Inet'),     num:false },
		{ key:'wifi_blocked',     label: _('WiFi'),     num:false },
		{ key:'_throttle_kbit',   label: _('Throttle'), num:true  },
		{ key:'_drop_packets',    label: _('Dropped'),  num:true  },
		{ key:'_backlog',         label: _('Queued'),   num:true  }
	];

	function ipToInt(s) {
		var p = String(s||'').split('.');
		if (p.length !== 4) return 0;
		return ((parseInt(p[0])||0)*16777216 + (parseInt(p[1])||0)*65536 + (parseInt(p[2])||0)*256 + (parseInt(p[3])||0));
	}

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
			? E('span', { 'style': 'color:'+C.blockedFg+';font-weight:600' }, '⛔ ' + _('blocked'))
			: E('span', { 'style': 'color:'+C.stateOk }, '✓ ' + _('ok'));
		var wifiBadge = r.wifi_blocked
			? E('span', { 'style': 'color:'+C.stateWait+';font-weight:600' }, '📵 ' + _('blocked'))
			: E('span', { 'style': 'color:'+C.textFaint }, '—');
		var throttleBadge;
		if (r._throttle_mode === 'shaper') {
			throttleBadge = E('span', { 'style': 'color:'+C.shapeFg+';font-weight:600', 'title': _('Shaper (tc/HTB queue)') }, '🌊 ' + fmtRate(r._throttle_kbit));
		} else if (r._throttle_mode === 'limiter') {
			throttleBadge = E('span', { 'style': 'color:'+C.rateFg+';font-weight:600', 'title': _('Limiter (nft drop)') }, '⚡ ' + fmtRate(r._throttle_kbit));
		} else {
			throttleBadge = E('span', { 'style': 'color:'+C.textFaint }, '—');
		}

		var dp = r._drop_packets || 0;
		var dropBadge = dp > 0
			? E('span', {
				'style': 'color:'+C.dropFg+';font-weight:600',
				'title': fmtBytes(r._drop_bytes || 0) + ' ' + _('dropped')
			}, '🚫 ' + dp)
			: E('span', { 'style': 'color:'+C.textFaint }, '—');

		var bl = r._backlog || 0;
		var backlogBadge = bl > 0
			? E('span', { 'style': 'color:'+C.shapeFg+';font-weight:600', 'title': _('Bytes queued in tc') }, fmtBytes(bl))
			: E('span', { 'style': 'color:'+C.textFaint }, '—');

		var macEl = r.mac
			? E('a', {
				'href': '/cgi-bin/luci/admin/network/dhcp',
				'target': '_blank',
				'rel': 'noopener',
				'class': 'tm-link',
				'title': _('Open DHCP/DNS bindings'),
				'onclick': 'event.stopPropagation()'
			}, r.mac)
			: '';

		var sd = speedMap[r.ip];
		var speedCell = E('td', {
			'style': td+';text-align:right;font-family:monospace',
			'data-speed-ip': r.ip,
			'title': sd ? (_('Avg')+': '+fmtSpeed(sd.avg)+' / '+_('Max')+': '+fmtSpeed(sd.max)) : _('Calculating…')
		});
		if (sd && sd.current > 1024) {
			speedCell.className = 'tm-speed-active';
			speedCell.textContent = fmtSpeed(sd.current);
		} else {
			speedCell.className = 'tm-speed-idle';
			speedCell.textContent = sd ? fmtSpeed(sd.current) : '—';
		}

		var row = E('tr', { 'class': 'tm-row', 'title': _('Click to inspect') + ' ' + r.name }, [
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

function updateUrlParams(opts) {
	var params = new URLSearchParams();
	if (opts.lastIp && opts.lastIp !== '__all__') params.set('ip', opts.lastIp);
	if (opts.refresh && opts.refresh > 0) params.set('refresh', String(opts.refresh));
	if (opts.pollInterval && opts.pollInterval !== 2) params.set('poll', String(opts.pollInterval));
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
	if (paramPoll) opts.pollInterval = parseInt(paramPoll) || 2;
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

	var panelStyle = 'background:var(--tm-bg-subtle);border:1px solid var(--tm-border);border-radius:4px;padding:10px 14px;font-size:12px;font-family:monospace;margin:8px 0';
	var lines = [];

	if (sm && sm.rate_kbit > 0) {
		if (sm.drops != null) lines.push(_('Drops') + ': ' + sm.drops);
		if (sm.overlimits != null) lines.push(_('Overlimits') + ': ' + sm.overlimits);
		if (sm.ecn_mark != null) lines.push(_('ECN marks') + ': ' + sm.ecn_mark);
		if (sm.new_flows != null || sm.old_flows != null) {
			lines.push(_('Flows') + ': ' + (sm.new_flows || 0) + ' ' + _('new') + ' / ' + (sm.old_flows || 0) + ' ' + _('old'));
		}
		if (sm.memory_used != null) lines.push(_('Queue memory') + ': ' + fmtBytes(sm.memory_used));
		if (sm.lended != null || sm.borrowed != null) {
			lines.push(_('Lended') + ': ' + (sm.lended || 0) + ' / ' + _('Borrowed') + ': ' + (sm.borrowed || 0));
		}
		if (spd && sm.rate_kbit > 0) {
			var currentBps = spd.current || 0;
			var rateBytes = (sm.rate_kbit * 1000) / 8;
			var util = rateBytes > 0 ? ((currentBps / rateBytes) * 100) : 0;
			lines.push(_('Utilization') + ': ' + util.toFixed(1) + '%');
		}
	} else if (dm && dm.rate_kbit > 0) {
		lines.push(_('Packets dropped') + ': ' + (dm.packets || 0));
		lines.push(_('Bytes dropped') + ': ' + fmtBytes(dm.bytes || 0));
		var dropBytes = dm.bytes || 0;
		var passBytes = dm.pass_bytes || 0;
		var totalBytes = dropBytes + passBytes;
		var dropRatio = totalBytes > 0 ? ((dropBytes / totalBytes) * 100) : 0;
		lines.push(_('Drop ratio') + ': ' + dropRatio.toFixed(1) + '%');
	}

	if (lines.length === 0) {
		lines.push(_('No extended stats available for this device.'));
	}

	var content = E('div', { 'style': panelStyle }, [
		E('div', { 'style': 'margin-bottom:6px;font-weight:600;font-family:sans-serif' }, _('Extended Statistics')),
		E('div', {}, lines.map(function(l) {
			return E('div', { 'style': 'padding:2px 0' }, l);
		})),
		E('details', { 'style': 'margin-top:8px;font-family:sans-serif;font-size:11px;color:var(--tm-text-mute)' }, [
			E('summary', { 'style': 'cursor:pointer;font-weight:500' }, _('What do these stats mean?')),
			E('div', { 'style': 'padding:6px 0 2px 0;line-height:1.6' }, [
				E('div', {}, _('Drops') + ': ' + _('packets dropped by queue overflow')),
				E('div', {}, _('Overlimits') + ': ' + _('rate exceeded events')),
				E('div', {}, _('ECN marks') + ': ' + _('congestion signals without drop')),
				E('div', {}, _('Flows') + ': ' + _('active concurrent connections in queue')),
				E('div', {}, _('Queue memory') + ': ' + _('bytes allocated by the queue discipline')),
				E('div', {}, _('Lended') + '/' + _('Borrowed') + ': ' + _('own-rate vs parent-rate packets')),
				E('div', {}, _('Utilization') + ': ' + _('current speed as percentage of rate limit')),
				E('div', {}, _('Packets dropped') + '/' + _('Bytes dropped') + ': ' + _('traffic discarded by nft policer')),
				E('div', {}, _('Drop ratio') + ': ' + _('percentage of total traffic that was dropped'))
			])
		])
	]);

	return content;
}

function buildExtendedStatsLegend(shapeMap, dropMap, speedMap) {
	var panelStyle = 'position:sticky;top:0;background:var(--tm-bg-subtle);border:1px solid var(--tm-border);border-radius:4px;padding:10px 14px;font-size:12px;font-family:monospace;margin:8px 0';
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

	var lines = [];
	if (shapedCount > 0) {
		lines.push(_('Shaped devices') + ': ' + shapedCount);
		lines.push(_('Total drops') + ': ' + totalDrops + ' | ' + _('Overlimits') + ': ' + totalOverlimits + ' | ' + _('ECN marks') + ': ' + totalEcn);
		lines.push(_('Total queue memory') + ': ' + fmtBytes(totalMemory));
	}
	if (limitedCount > 0) {
		lines.push(_('Limited devices') + ': ' + limitedCount);
		lines.push(_('Total dropped') + ': ' + totalDropPkts + ' ' + _('pkts') + ' / ' + fmtBytes(totalDropBytes));
	}
	if (lines.length === 0) {
		lines.push(_('No extended stats available.'));
	}

	return E('div', { 'style': panelStyle }, [
		E('div', { 'style': 'margin-bottom:6px;font-weight:600;font-family:sans-serif' }, _('Extended Statistics') + ' (' + _('all devices') + ')'),
		E('div', {}, lines.map(function(l) {
			return E('div', { 'style': 'padding:2px 0' }, l);
		}))
	]);
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
				devices.push({ ip: p[2], name: p[3] });
			}
		});
		devices.sort(function(a, b) { return a.name.localeCompare(b.name); });

		var select = E('select', { 'class': 'cbi-input-select', 'style': 'min-width:280px' },
			[E('option', { 'value': '__all__' }, '— ' + _('All active devices') + ' —')]
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

		var showStats = mkCheck('tm-stats', _('Stats'), opts.showStats !== false, function() {
			var o = loadOpts(); o.showStats = this.checked; saveOpts(o); updateUrlParams(o);
			statsDiv.style.display = this.checked ? '' : 'none';
		});
		var showConns = mkCheck('tm-conns', _('Connections'), opts.showConns !== false, function() {
			var o = loadOpts(); o.showConns = this.checked; saveOpts(o); updateUrlParams(o);
			connsDiv.style.display = this.checked ? '' : 'none';
		});
		var rdnsCheck = mkCheck('tm-rdns', _('Reverse DNS'), opts.rdns, function() {
			var o = loadOpts(); o.rdns = this.checked; saveOpts(o); updateUrlParams(o);
		});
		var extStatsCheck = mkCheck('tm-extended', _('Extended stats'), opts.extendedStats, function() {
			var o = loadOpts(); o.extendedStats = this.checked; saveOpts(o); updateUrlParams(o);
			extStatsDiv.style.display = this.checked ? '' : 'none';
			if (this.checked) updateExtendedStats();
		});

		var extStatsDiv = E('div', { 'style': opts.extendedStats ? '' : 'display:none' });

		var refreshSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option',{'value':'0'}, _('Off')), E('option',{'value':'5'},'5s'),
			E('option',{'value':'10'},'10s'), E('option',{'value':'30'},'30s'),
			E('option',{'value':'60'},'60s')
		]);
		Array.prototype.forEach.call(refreshSel.options, function(o) {
			if (o.value === String(opts.refresh||0)) o.selected = true;
		});
		refreshSel.addEventListener('change', function() {
			var o = loadOpts(); o.refresh = parseInt(this.value); saveOpts(o); updateUrlParams(o); self._setupTimer();
		});

		var pollIntervalSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option',{'value':'1'},'1s'),
			E('option',{'value':'2'},'2s'),
			E('option',{'value':'5'},'5s')
		]);
		Array.prototype.forEach.call(pollIntervalSel.options, function(o) {
			if (o.value === String(opts.pollInterval || 2)) o.selected = true;
		});
		pollIntervalSel.addEventListener('change', function() {
			var o = loadOpts(); o.pollInterval = parseInt(this.value); saveOpts(o); updateUrlParams(o);
			self._restartBytesPoll();
		});

		var avgWindowSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option',{'value':'5'},'5s'),
			E('option',{'value':'15'},'15s'),
			E('option',{'value':'30'},'30s'),
			E('option',{'value':'60'},'60s')
		]);
		Array.prototype.forEach.call(avgWindowSel.options, function(o) {
			if (o.value === String(opts.avgWindow || 15)) o.selected = true;
		});
		avgWindowSel.addEventListener('change', function() {
			var o = loadOpts(); o.avgWindow = parseInt(this.value); saveOpts(o); updateUrlParams(o);
		});

		var avgMethodSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option',{'value':'simple'}, _('Simple')),
			E('option',{'value':'ewma'}, _('EWMA'))
		]);
		Array.prototype.forEach.call(avgMethodSel.options, function(o) {
			if (o.value === (opts.avgMethod || 'simple')) o.selected = true;
		});
		avgMethodSel.addEventListener('change', function() {
			var o = loadOpts(); o.avgMethod = this.value; saveOpts(o); updateUrlParams(o);
		});

		var protoSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option',{'value':'all'}, _('All')), E('option',{'value':'tcp'},'TCP'), E('option',{'value':'udp'},'UDP')
		]);
		Array.prototype.forEach.call(protoSel.options, function(o) {
			if (o.value === (opts.proto||'all')) o.selected = true;
		});
		protoSel.addEventListener('change', function() {
			var o = loadOpts(); o.proto = this.value; saveOpts(o);
		});

		var groupSel = E('select', { 'class': 'cbi-input-select' },
			GROUP_OPTS.map(function(g){ return E('option', {'value': g.v}, g.l); })
		);
		Array.prototype.forEach.call(groupSel.options, function(o) {
			if (o.value === (opts.groupBy||'none')) o.selected = true;
		});
		groupSel.addEventListener('change', function() {
			var o = loadOpts(); o.groupBy = this.value; saveOpts(o); runQuery();
		});

		var statusDiv = E('div', { 'style': 'display:none' });
		var statsDiv  = E('div', { 'style': 'margin:8px 0' + (opts.showStats===false?';display:none':'') });
		var connsDiv  = E('div', { 'style': opts.showConns===false?'display:none':'' });

		var blockBtn   = E('button', { 'class': 'cbi-button cbi-button-negative' }, '⛔ ' + _('Block'));
		var unblockBtn = E('button', { 'class': 'cbi-button cbi-button-action'   }, '✅ ' + _('Unblock'));
		var wifiBtn = E('button', { 'class': 'cbi-button', 'style': 'display:none' }, '');

		function updateWifiBtn(wifiBlocked, hasMac) {
			if (!hasMac) { wifiBtn.style.display = 'none'; return; }
			wifiBtn.style.display = '';
			wifiBtn.disabled = false;
			if (wifiBlocked) {
				wifiBtn.textContent = '📶 ' + _('WiFi Unblock');
				wifiBtn.style.cssText = 'background:#22c55e;color:#fff;border:1px solid #16a34a;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:13px';
				wifiBtn._wifiAction = 'unblock';
			} else {
				wifiBtn.textContent = '📵 ' + _('WiFi Block');
				wifiBtn.style.cssText = 'background:#f97316;color:#fff;border:1px solid #ea580c;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:13px';
				wifiBtn._wifiAction = 'block';
			}
		}

		var rateSel = E('select', { 'class': 'cbi-input-select' },
			RATE_PRESETS.map(function(p) { return E('option', { 'value': p.v }, p.l); })
		);
		var customInput = E('input', { 'type':'number', 'min':'1', 'step':'1', 'placeholder': _('value'),
			'class':'cbi-input-text', 'style':'width:90px;display:none' });
		var customUnit = E('select', { 'class':'cbi-input-select', 'style':'display:none' }, [
			E('option', {'value':'mbit'}, 'Mbit/s'),
			E('option', {'value':'kbit'}, 'kbit/s')
		]);
		var modeSel = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'limiter' }, _('Limiter (drop)')),
			E('option', { 'value': 'shaper'  }, _('Shaper (queue)'))
		]);
		var rateBtn = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Apply'));

		rateSel.addEventListener('change', function() {
			var isCustom = this.value === 'custom';
			customInput.style.display = isCustom ? '' : 'none';
			customUnit.style.display  = isCustom ? '' : 'none';
		});

		var rateLimitRow = E('div', {
			'style': 'display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap'
		}, [mkLabel(_('Speed Limit') + ':'), rateSel, customInput, customUnit, mkLabel(_('Mode') + ':'), modeSel, rateBtn]);

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
		var perDeviceOpts = E('span', {}, [mkLabel(_('Proto') + ':'), protoSel,
			E('span',{'style':'display:inline-block;width:8px'}),
			mkLabel(_('Group by') + ':'), groupSel,
			E('span',{'style':'display:inline-block;width:8px'}),
			rdnsCheck]);

		function isAllMode() { return select.value === '__all__'; }

		function updateModeUI() {
			var all = isAllMode();
			actionRow.style.display     = all ? 'none' : '';
			rateLimitRow.style.display  = all ? 'none' : '';
			perDeviceOpts.style.display = all ? 'none' : '';
		}

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
				cell.title = _('Avg')+': '+fmtSpeed(s.avg)+' / '+_('Max')+': '+fmtSpeed(s.max);
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
				var maxSamples = Math.max(2, Math.round(avgWindow / pollInterval));

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
				updateSpeedCells();
			}).catch(function(){});
		}

		function runSingle(ip) {
			var o = loadOpts();
			var proto = (o.proto && o.proto !== 'all') ? o.proto : '';

			runBtn.disabled = true;
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
						var sm = self._shapeMap[data.ip || select.value] || {};
						if ((sm.backlog||0) > 0) parts.push(_('Queued') + ': <b style="color:'+C.shapeFg+'">'+fmtBytes(sm.backlog)+'</b>');
						if ((sm.bytes||0) > 0) parts.push(_('Passed') + ': <b>'+fmtBytes(sm.bytes)+'</b>');
					} else if ((data.rate_limit_kbit || 0) > 0) {
						parts.push(_('Speed limit') + ': <b style="color:'+C.rateFg+'">⚡ '+fmtRate(data.rate_limit_kbit)+'</b>');
						var dm = self._dropMap[data.ip || select.value] || {};
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
						: '') + parts.join(' &nbsp;|&nbsp; ') + wifiPart +
						' &nbsp;<span style="color:'+C.textFaint+';font-size:11px">'+escHtml(data.timestamp)+'</span>';
				}

				blockBtn.disabled   = data.blocked;
				unblockBtn.disabled = !data.blocked;
				updateWifiBtn(data.wifi_blocked, !!data.mac);

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
					customInput.value = curRate;
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

		function runAll() {
			runBtn.disabled = true;
			setStatus(statusDiv, 'loading', _('Scanning all devices…'));

			callTrafficctl().then(function(rows) {
				if (!Array.isArray(rows)) rows = [];
				var limited = rows.filter(function(r){return (r.rate_limit_kbit||0) > 0;}).length;
				var shaped  = rows.filter(function(r){return (r.shape_kbit||0) > 0;}).length;
				var totalDropPkts = Object.keys(self._dropMap).reduce(function(s, ip) { return s + (self._dropMap[ip].packets||0); }, 0);
				statsDiv.style.cssText = 'padding:8px 14px;border-radius:4px;font-size:13px;margin-bottom:8px;background:'+C.infoBg+';border:1px solid '+C.infoBorder+';color:'+C.infoFg;
				statsDiv.innerHTML = _('Active devices') + ': <b>'+rows.length+'</b>'
					+ ' &nbsp;|&nbsp; ' + _('Blocked') + ': <b style="color:'+C.blockedFg+'">'
					+ rows.filter(function(r){return r.blocked;}).length+'</b>'
					+ ' &nbsp;|&nbsp; ' + _('WiFi blocked') + ': <b style="color:'+C.stateWait+'">'
					+ rows.filter(function(r){return r.wifi_blocked;}).length+'</b>'
					+ (limited > 0 ? ' &nbsp;|&nbsp; ' + _('Limited') + ': <b style="color:'+C.rateFg+'">⚡ '+limited+'</b>' : '')
					+ (shaped > 0 ? ' &nbsp;|&nbsp; ' + _('Shaped') + ': <b style="color:'+C.shapeFg+'">🌊 '+shaped+'</b>' : '')
					+ (totalDropPkts > 0 ? ' &nbsp;|&nbsp; ' + _('Dropped') + ': <b style="color:'+C.dropFg+'">🚫 '+totalDropPkts+' pkts</b>' : '')
					+ ' &nbsp;<span style="color:'+C.textFaint+';font-size:11px">'+new Date().toLocaleTimeString()+'</span>';

				while (connsDiv.firstChild) connsDiv.removeChild(connsDiv.firstChild);
				if (rows.length === 0) {
					connsDiv.appendChild(E('p',{'style':'color:'+C.textMute+';padding:12px 0'}, _('No active devices.')));
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
							var o = loadOpts(); o.lastIp = ip; saveOpts(o); updateUrlParams(o);
							updateModeUI();
							runQuery();
						},
						self._speedMap,
						self._dropMap,
						self._shapeMap
					);
					connsDiv.appendChild(E('div',{'style':'overflow-x:auto'},[tbl]));
					connsDiv.appendChild(E('p',{'style':'color:'+C.textFaint+';font-size:11px;margin-top:6px'},
						_('Click a row to inspect that device. Download speed updates every 2 seconds.')));
				}
				setStatus(statusDiv, 'ok', '✓ '+new Date().toLocaleTimeString());
				self._startBytesPoll();
			})
			.catch(function(e) { setStatus(statusDiv, 'error', '✗ '+e.message); })
			.then(function() { runBtn.disabled = false; });
		}

		function updateExtendedStats() {
			var o = loadOpts();
			if (!o.extendedStats) return;
			while (extStatsDiv.firstChild) extStatsDiv.removeChild(extStatsDiv.firstChild);
			var ip = select.value;
			if (ip === '__all__') {
				extStatsDiv.appendChild(buildExtendedStatsLegend(self._shapeMap, self._dropMap, self._speedMap));
			} else {
				extStatsDiv.appendChild(buildExtendedStatsPanel(ip, self._shapeMap, self._dropMap, self._speedMap));
			}
		}

		function runQuery() {
			var ip = select.value;
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
			var ip   = select.value;
			var name = select.options[select.selectedIndex].text.split('  —  ')[0].trim();
			var kbit = getRateKbit();
			var mode = modeSel.value;
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
			var ip   = select.value;
			var action = wifiBtn._wifiAction;
			wifiBtn.disabled = true;
			var name = select.options[select.selectedIndex].text.split('  —  ')[0].trim();
			setStatus(statusDiv, 'loading', (action==='block' ? _('Adding to') : _('Removing from')) + ' ' + _('WiFi deny list') + ': ' + name + '…');
			var fn = action === 'block' ? callMacfilterAdd : callMacfilterRemove;
			fn(ip).then(function(res) {
				setStatus(statusDiv, (res && res.ok) ? (action==='block'?'action':'ok') : 'error', (res && res.msg) || '?');
				runQuery();
			});
		});

		blockBtn.addEventListener('click', function() {
			var ip   = select.value;
			var name = select.options[select.selectedIndex].text.split('  —  ')[0].trim();
			blockBtn.disabled = true;
			setStatus(statusDiv, 'loading', _('Blocking') + ' ' + name + '…');
			callBlock(ip, name).then(function(res) {
				setStatus(statusDiv, (res && res.ok) ? 'action' : 'error', (res && res.msg) || '?');
				runQuery();
			});
		});
		unblockBtn.addEventListener('click', function() {
			var ip   = select.value;
			var name = select.options[select.selectedIndex].text.split('  —  ')[0].trim();
			unblockBtn.disabled = true;
			setStatus(statusDiv, 'loading', _('Unblocking') + ' ' + name + '…');
			callUnblock(ip, name).then(function(res) {
				setStatus(statusDiv, (res && res.ok) ? 'ok' : 'error', (res && res.msg) || '?');
				runQuery();
			});
		});

		var runBtn = E('button', {
			'class': 'cbi-button cbi-button-action important',
			'click': function() { runQuery(); }
		}, '▶ ' + _('Run'));

		this._setupTimer = function() {
			if (self._timer) { clearInterval(self._timer); self._timer = null; }
			var iv = parseInt(loadOpts().refresh||0);
			if (iv > 0) self._timer = setInterval(runQuery, iv*1000);
		};

		this._startBytesPoll = function() {
			if (self._bytesTimer) return;
			var o = loadOpts();
			var pollMs = (o.pollInterval || 2) * 1000;
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
		select.addEventListener('change', function() { runQuery(); });
		setTimeout(function() { runQuery(); }, 0);

		var ob = 'border:1px solid '+C.optsBorder+';background:'+C.optsBg;
		return E('div', {'class':'cbi-map', 'style':'color:'+C.hostname}, [
			E('h2', {'style':'color:'+C.hostname}, _('Traffic Control')),
			E('div', {'class':'cbi-section'}, [
				E('div', {'style':'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px'},
					[select, runBtn]),
				actionRow,
				rateLimitRow,
				statusDiv,
				E('div', {'style':'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px;padding:8px 12px;border-radius:4px;'+ob}, [
					mkLabel(_('Show') + ':'), showStats, showConns, extStatsCheck,
					E('span',{'style':'border-left:1px solid '+C.border+';height:18px;margin:0 8px'}),
					mkLabel(_('Refresh') + ':'), refreshSel,
					E('span',{'style':'border-left:1px solid '+C.border+';height:18px;margin:0 8px'}),
					mkLabel(_('Poll') + ':'), pollIntervalSel,
					E('span',{'style':'border-left:1px solid '+C.border+';height:18px;margin:0 8px'}),
					mkLabel(_('Avg window') + ':'), avgWindowSel,
					mkLabel(_('Method') + ':'), avgMethodSel,
					E('span',{'style':'border-left:1px solid '+C.border+';height:18px;margin:0 8px'}),
					perDeviceOpts
				]),
				statsDiv,
				extStatsDiv,
				connsDiv
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
