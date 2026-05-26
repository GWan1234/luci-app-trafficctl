#!/bin/sh
# shellcheck shell=dash
# Telegram bot daemon for trafficctl.
# Runs under procd. Uses curl + jsonfilter to talk to Telegram Bot API.
# Only responds to the authorized chat_id configured in UCI.

SCRIPTS="/usr/local/bin"
KNOWN_FILE="/etc/trafficmon/telegram_known.json"
OFFSET_FILE="/tmp/trafficctl_tg_offset"
CACHE_FILE="/tmp/trafficctl_tg_devices.json"
CACHE_TTL=5

TG_ENABLED=0
TG_TOKEN=""
TG_CHAT_ID=""
TG_POLL=3
TG_NOTIFY_NEW=1
TG_NOTIFY_KNOWN=0
TG_BTN_INET=1
TG_BTN_WIFI=1
TG_BTN_LIMIT=1
TG_BTN_SHAPE=1

# ── config ──────────────────────────────────────────────────────────────────

load_config() {
	TG_ENABLED=$(uci -q get trafficctl.telegram.enabled || echo 0)
	TG_TOKEN=$(uci -q get trafficctl.telegram.bot_token)
	TG_CHAT_ID=$(uci -q get trafficctl.telegram.chat_id)
	TG_POLL=$(uci -q get trafficctl.telegram.poll_interval || echo 3)
	TG_NOTIFY_NEW=$(uci -q get trafficctl.telegram.notify_new_device || echo 1)
	TG_NOTIFY_KNOWN=$(uci -q get trafficctl.telegram.notify_known_device || echo 0)
	TG_BTN_INET=$(uci -q get trafficctl.telegram.btn_block_inet || echo 1)
	TG_BTN_WIFI=$(uci -q get trafficctl.telegram.btn_block_wifi || echo 1)
	TG_BTN_LIMIT=$(uci -q get trafficctl.telegram.btn_limiter || echo 1)
	TG_BTN_SHAPE=$(uci -q get trafficctl.telegram.btn_shaper || echo 1)
	[ "$TG_POLL" -ge 2 ] 2>/dev/null || TG_POLL=3
}

validate_config() {
	if [ "$TG_ENABLED" != "1" ]; then
		logger -t trafficctl-tg "Telegram bot disabled"
		exit 0
	fi
	if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
		logger -t trafficctl-tg "Missing bot_token or chat_id"
		exit 1
	fi
}

# ── telegram API ────────────────────────────────────────────────────────────

tg_api() {
	local method="$1" body="$2"
	curl -s -m 30 -X POST \
		"https://api.telegram.org/bot${TG_TOKEN}/${method}" \
		-H "Content-Type: application/json" \
		-d "$body" 2>/dev/null
}

tg_send() {
	local text="$1" markup="$2"
	local body
	text=$(printf '%s' "$text" | sed 's/\\/\\\\/g;s/"/\\"/g')
	if [ -n "$markup" ]; then
		body=$(printf '{"chat_id":"%s","text":"%s","parse_mode":"HTML","reply_markup":%s}' \
			"$TG_CHAT_ID" "$text" "$markup")
	else
		body=$(printf '{"chat_id":"%s","text":"%s","parse_mode":"HTML"}' \
			"$TG_CHAT_ID" "$text")
	fi
	tg_api "sendMessage" "$body" >/dev/null
}

tg_answer_cb() {
	local cb_id="$1" text="$2"
	text=$(printf '%s' "$text" | sed 's/\\/\\\\/g;s/"/\\"/g')
	tg_api "answerCallbackQuery" \
		"$(printf '{"callback_query_id":"%s","text":"%s"}' "$cb_id" "$text")" >/dev/null
}

tg_edit_msg() {
	local msg_id="$1" text="$2" markup="$3"
	text=$(printf '%s' "$text" | sed 's/\\/\\\\/g;s/"/\\"/g')
	local body
	if [ -n "$markup" ]; then
		body=$(printf '{"chat_id":"%s","message_id":%s,"text":"%s","parse_mode":"HTML","reply_markup":%s}' \
			"$TG_CHAT_ID" "$msg_id" "$text" "$markup")
	else
		body=$(printf '{"chat_id":"%s","message_id":%s,"text":"%s","parse_mode":"HTML"}' \
			"$TG_CHAT_ID" "$msg_id" "$text")
	fi
	tg_api "editMessageText" "$body" >/dev/null
}

# ── device helpers ──────────────────────────────────────────────────────────

get_devices() {
	local now mtime age
	now=$(date +%s)
	if [ -f "$CACHE_FILE" ]; then
		mtime=$(date -r "$CACHE_FILE" +%s 2>/dev/null || echo 0)
		age=$((now - mtime))
		if [ "$age" -lt "$CACHE_TTL" ]; then
			cat "$CACHE_FILE"
			return
		fi
	fi
	"$SCRIPTS/trafficctl-summary.sh" > "$CACHE_FILE" 2>/dev/null
	cat "$CACHE_FILE"
}

invalidate_cache() { rm -f "$CACHE_FILE"; }

get_device_field() {
	local json="$1" ip="$2" field="$3"
	echo "$json" | jsonfilter -e "@[@.ip='$ip'].$field" 2>/dev/null
}

# ── known devices ───────────────────────────────────────────────────────────

load_known() {
	if [ ! -f "$KNOWN_FILE" ]; then
		mkdir -p "$(dirname "$KNOWN_FILE")"
		echo '[]' > "$KNOWN_FILE"
	fi
}

is_known_mac() {
	grep -q "\"$1\"" "$KNOWN_FILE" 2>/dev/null
}

add_known_mac() {
	local mac="$1" name="$2" ip="$3"
	local now
	now=$(date +%s)
	local tmp="${KNOWN_FILE}.tmp"
	if [ "$(cat "$KNOWN_FILE" 2>/dev/null)" = "[]" ]; then
		printf '[{"mac":"%s","name":"%s","ip":"%s","first_seen":%d}]' \
			"$mac" "$name" "$ip" "$now" > "$tmp"
	else
		sed "s/\]$/,{\"mac\":\"$mac\",\"name\":\"$name\",\"ip\":\"$ip\",\"first_seen\":$now}]/" \
			"$KNOWN_FILE" > "$tmp"
	fi
	mv "$tmp" "$KNOWN_FILE"
}

check_new_devices() {
	local devices mac name ip conn_type
	devices=$(get_devices)
	[ -z "$devices" ] || [ "$devices" = "[]" ] && return

	for mac in $(echo "$devices" | jsonfilter -e '@[*].mac' 2>/dev/null); do
		[ -z "$mac" ] && continue
		name=$(echo "$devices" | jsonfilter -e "@[@.mac='$mac'].name" 2>/dev/null)
		ip=$(echo "$devices" | jsonfilter -e "@[@.mac='$mac'].ip" 2>/dev/null)
		conn_type=$(echo "$devices" | jsonfilter -e "@[@.mac='$mac'].conn_type" 2>/dev/null)
		if ! is_known_mac "$mac"; then
			add_known_mac "$mac" "${name:-unknown}" "${ip:-?}"
			if [ "$TG_NOTIFY_NEW" = "1" ]; then
				tg_send "$(printf '🆕 <b>New device</b>\n%s (%s)\nMAC: %s\nLink: %s' \
					"${name:-unknown}" "${ip:-?}" "$mac" "${conn_type:-?}")"
			fi
		elif [ "$TG_NOTIFY_KNOWN" = "1" ]; then
			tg_send "$(printf '📱 <b>Device online</b>\n%s (%s)\nLink: %s' \
				"${name:-unknown}" "${ip:-?}" "${conn_type:-?}")"
		fi
	done
}

# ── keyboard builders ───────────────────────────────────────────────────────

build_device_keyboard() {
	local devices="$1"
	local tmpkb="/tmp/trafficctl_tg_kb.tmp"
	local ip name btn col=0 first=1

	printf '{"inline_keyboard":[' > "$tmpkb"

	for ip in $(echo "$devices" | jsonfilter -e '@[*].ip' 2>/dev/null); do
		name=$(echo "$devices" | jsonfilter -e "@[@.ip='$ip'].name" 2>/dev/null)
		btn=$(printf '{"text":"%.12s %s","callback_data":"act:menu:%s"}' \
			"${name:-$ip}" "$ip" "$ip")
		if [ "$col" -eq 0 ]; then
			if [ "$first" -eq 1 ]; then
				first=0
			else
				printf '],' >> "$tmpkb"
			fi
			printf '[%s' "$btn" >> "$tmpkb"
			col=1
		else
			printf ',%s' "$btn" >> "$tmpkb"
			col=0
		fi
	done

	printf ']]}' >> "$tmpkb"
	cat "$tmpkb"
	rm -f "$tmpkb"
}

build_action_keyboard() {
	local ip="$1" devices="$2"
	local blocked wifi_blocked rl_kbit shape_kbit
	blocked=$(get_device_field "$devices" "$ip" "blocked")
	wifi_blocked=$(get_device_field "$devices" "$ip" "wifi_blocked")
	rl_kbit=$(get_device_field "$devices" "$ip" "rate_limit_kbit")
	shape_kbit=$(get_device_field "$devices" "$ip" "shape_kbit")
	conn_type=$(get_device_field "$devices" "$ip" "conn_type")

	local kb='{"inline_keyboard":['
	local rows=""

	# internet block/unblock
	if [ "$TG_BTN_INET" = "1" ]; then
		if [ "$blocked" = "true" ] || [ "$blocked" = "1" ]; then
			rows="${rows}[{\"text\":\"▶️ Unblock Internet\",\"callback_data\":\"act:unblock:${ip}\"}],"
		else
			rows="${rows}[{\"text\":\"⏸ Block Internet\",\"callback_data\":\"act:block:${ip}\"}],"
		fi
	fi

	# wifi block/unblock (only for wifi devices)
	if [ "$TG_BTN_WIFI" = "1" ]; then
		case "$conn_type" in
			*wifi*|*2.4G*|*5G*|*6G*|*WiFi*)
				if [ "$wifi_blocked" = "true" ] || [ "$wifi_blocked" = "1" ]; then
					rows="${rows}[{\"text\":\"📶 Unblock WiFi\",\"callback_data\":\"act:wunblock:${ip}\"}],"
				else
					rows="${rows}[{\"text\":\"📵 Block WiFi\",\"callback_data\":\"act:wblock:${ip}\"}],"
				fi
				;;
		esac
	fi

	# limiter
	if [ "$TG_BTN_LIMIT" = "1" ]; then
		if [ "${rl_kbit:-0}" -gt 0 ] 2>/dev/null; then
			rows="${rows}[{\"text\":\"⚡ Limit: ${rl_kbit} kbit/s — Remove\",\"callback_data\":\"act:unlimit:${ip}\"}],"
		else
			rows="${rows}[{\"text\":\"⚡ 5M\",\"callback_data\":\"act:limit:${ip}:5000\"},{\"text\":\"⚡ 10M\",\"callback_data\":\"act:limit:${ip}:10000\"},{\"text\":\"⚡ 50M\",\"callback_data\":\"act:limit:${ip}:50000\"}],"
		fi
	fi

	# shaper
	if [ "$TG_BTN_SHAPE" = "1" ]; then
		if [ "${shape_kbit:-0}" -gt 0 ] 2>/dev/null; then
			rows="${rows}[{\"text\":\"🔧 Shape: ${shape_kbit} kbit/s — Remove\",\"callback_data\":\"act:unshape:${ip}\"}],"
		else
			rows="${rows}[{\"text\":\"🔧 5M\",\"callback_data\":\"act:shape:${ip}:5000\"},{\"text\":\"🔧 10M\",\"callback_data\":\"act:shape:${ip}:10000\"},{\"text\":\"🔧 50M\",\"callback_data\":\"act:shape:${ip}:50000\"}],"
		fi
	fi

	# back button
	rows="${rows}[{\"text\":\"⬅️ Back\",\"callback_data\":\"act:back\"}]"

	printf '%s%s]}' "$kb" "$rows"
}

# ── command handlers ────────────────────────────────────────────────────────

handle_help() {
	tg_send "$(printf '<b>TrafficCtl Bot</b>\n\n/devices — active devices list\n/status — blocked/limited summary\n/help — this message')"
}

handle_devices() {
	local devices
	devices=$(get_devices)
	if [ -z "$devices" ] || [ "$devices" = "[]" ]; then
		tg_send "No active devices"
		return
	fi
	local count
	count=$(echo "$devices" | jsonfilter -e '@[*].ip' 2>/dev/null | wc -l)
	local kb
	kb=$(build_device_keyboard "$devices")
	tg_send "$(printf '<b>Active devices: %d</b>\nSelect a device:' "$count")" "$kb"
}

handle_devices_edit() {
	local msg_id="$1"
	invalidate_cache
	local devices
	devices=$(get_devices)
	local count
	count=$(echo "$devices" | jsonfilter -e '@[*].ip' 2>/dev/null | wc -l)
	local kb
	kb=$(build_device_keyboard "$devices")
	tg_edit_msg "$msg_id" "$(printf '<b>Active devices: %d</b>\nSelect a device:' "$count")" "$kb"
}

handle_status() {
	local devices ip name rl_kbit shape_kbit blocked wifi_blocked
	local result=""
	devices=$(get_devices)
	[ -z "$devices" ] || [ "$devices" = "[]" ] && { tg_send "No active devices"; return; }

	for ip in $(echo "$devices" | jsonfilter -e '@[*].ip' 2>/dev/null); do
		blocked=$(get_device_field "$devices" "$ip" "blocked")
		wifi_blocked=$(get_device_field "$devices" "$ip" "wifi_blocked")
		rl_kbit=$(get_device_field "$devices" "$ip" "rate_limit_kbit")
		shape_kbit=$(get_device_field "$devices" "$ip" "shape_kbit")
		name=$(get_device_field "$devices" "$ip" "name")

		local flags=""
		[ "$blocked" = "true" ] || [ "$blocked" = "1" ] && flags="${flags} 🚫inet"
		[ "$wifi_blocked" = "true" ] || [ "$wifi_blocked" = "1" ] && flags="${flags} 📵wifi"
		[ "${rl_kbit:-0}" -gt 0 ] 2>/dev/null && flags="${flags} ⚡${rl_kbit}k"
		[ "${shape_kbit:-0}" -gt 0 ] 2>/dev/null && flags="${flags} 🔧${shape_kbit}k"

		[ -n "$flags" ] && result="${result}${name:-?} (${ip}):${flags}\n"
	done

	if [ -z "$result" ]; then
		tg_send "All devices are clean — no blocks or limits"
	else
		tg_send "$(printf '<b>Active restrictions:</b>\n%b' "$result")"
	fi
}

# ── callback handler ────────────────────────────────────────────────────────

handle_callback() {
	local cb_id="$1" data="$2" msg_id="$3"
	local verb ip param result msg devices name

	verb=$(echo "$data" | cut -d: -f2)
	ip=$(echo "$data" | cut -d: -f3)
	param=$(echo "$data" | cut -d: -f4)

	case "$verb" in
	menu)
		invalidate_cache
		devices=$(get_devices)
		name=$(get_device_field "$devices" "$ip" "name")
		local blocked wifi_blocked rl_kbit shape_kbit
		blocked=$(get_device_field "$devices" "$ip" "blocked")
		wifi_blocked=$(get_device_field "$devices" "$ip" "wifi_blocked")
		rl_kbit=$(get_device_field "$devices" "$ip" "rate_limit_kbit")
		shape_kbit=$(get_device_field "$devices" "$ip" "shape_kbit")

		local status_line=""
		[ "$blocked" = "true" ] || [ "$blocked" = "1" ] && status_line="${status_line}🚫 Internet blocked\n"
		[ "$wifi_blocked" = "true" ] || [ "$wifi_blocked" = "1" ] && status_line="${status_line}📵 WiFi blocked\n"
		[ "${rl_kbit:-0}" -gt 0 ] 2>/dev/null && status_line="${status_line}⚡ Limiter: ${rl_kbit} kbit/s\n"
		[ "${shape_kbit:-0}" -gt 0 ] 2>/dev/null && status_line="${status_line}🔧 Shaper: ${shape_kbit} kbit/s\n"
		[ -z "$status_line" ] && status_line="✅ No restrictions\n"

		local text
		text=$(printf '<b>%s</b> (%s)\n%b' "${name:-?}" "$ip" "$status_line")
		local kb
		kb=$(build_action_keyboard "$ip" "$devices")
		tg_edit_msg "$msg_id" "$text" "$kb"
		tg_answer_cb "$cb_id" ""
		;;
	block)
		result=$("$SCRIPTS/trafficctl-block.sh" "$ip" "tg")
		msg=$(echo "$result" | jsonfilter -e '@.msg' 2>/dev/null)
		tg_answer_cb "$cb_id" "${msg:-done}"
		invalidate_cache
		handle_callback "$cb_id" "act:menu:$ip" "$msg_id"
		;;
	unblock)
		result=$("$SCRIPTS/trafficctl-unblock.sh" "$ip" "tg")
		msg=$(echo "$result" | jsonfilter -e '@.msg' 2>/dev/null)
		tg_answer_cb "$cb_id" "${msg:-done}"
		invalidate_cache
		handle_callback "$cb_id" "act:menu:$ip" "$msg_id"
		;;
	wblock)
		result=$("$SCRIPTS/trafficctl-macfilter-add.sh" "$ip")
		msg=$(echo "$result" | jsonfilter -e '@.msg' 2>/dev/null)
		tg_answer_cb "$cb_id" "${msg:-done}"
		invalidate_cache
		handle_callback "$cb_id" "act:menu:$ip" "$msg_id"
		;;
	wunblock)
		result=$("$SCRIPTS/trafficctl-macfilter-remove.sh" "$ip")
		msg=$(echo "$result" | jsonfilter -e '@.msg' 2>/dev/null)
		tg_answer_cb "$cb_id" "${msg:-done}"
		invalidate_cache
		handle_callback "$cb_id" "act:menu:$ip" "$msg_id"
		;;
	limit)
		result=$("$SCRIPTS/trafficctl-ratelimit.sh" "$ip" "$param" "tg")
		msg=$(echo "$result" | jsonfilter -e '@.msg' 2>/dev/null)
		tg_answer_cb "$cb_id" "${msg:-done}"
		invalidate_cache
		handle_callback "$cb_id" "act:menu:$ip" "$msg_id"
		;;
	unlimit)
		result=$("$SCRIPTS/trafficctl-ratelimit.sh" "$ip" "0" "tg")
		msg=$(echo "$result" | jsonfilter -e '@.msg' 2>/dev/null)
		tg_answer_cb "$cb_id" "${msg:-done}"
		invalidate_cache
		handle_callback "$cb_id" "act:menu:$ip" "$msg_id"
		;;
	shape)
		result=$("$SCRIPTS/trafficctl-shape.sh" add "$ip" "$param" "tg")
		msg=$(echo "$result" | jsonfilter -e '@.msg' 2>/dev/null)
		tg_answer_cb "$cb_id" "${msg:-done}"
		invalidate_cache
		handle_callback "$cb_id" "act:menu:$ip" "$msg_id"
		;;
	unshape)
		result=$("$SCRIPTS/trafficctl-shape.sh" remove "$ip")
		msg=$(echo "$result" | jsonfilter -e '@.msg' 2>/dev/null)
		tg_answer_cb "$cb_id" "${msg:-done}"
		invalidate_cache
		handle_callback "$cb_id" "act:menu:$ip" "$msg_id"
		;;
	back)
		handle_devices_edit "$msg_id"
		tg_answer_cb "$cb_id" ""
		;;
	*)
		tg_answer_cb "$cb_id" "Unknown action"
		;;
	esac
}

# ── main loop ───────────────────────────────────────────────────────────────

main() {
	load_config
	validate_config
	load_known

	logger -t trafficctl-tg "Bot started, chat_id=$TG_CHAT_ID"

	local offset response ok update_count i
	local update update_id msg_chat_id msg_text cb_id cb_data cb_msg_id
	local config_reload_at
	config_reload_at=$(($(date +%s) + 60))

	offset=$(cat "$OFFSET_FILE" 2>/dev/null || echo "0")

	while true; do
		check_new_devices

		response=$(tg_api "getUpdates" \
			"$(printf '{"offset":%s,"timeout":%d,"allowed_updates":["message","callback_query"]}' \
				"$offset" "$TG_POLL")")

		ok=$(echo "$response" | jsonfilter -e '@.ok' 2>/dev/null)
		[ "$ok" = "true" ] || { sleep 5; continue; }

		update_count=$(echo "$response" | jsonfilter -l '@.result' 2>/dev/null || echo 0)
		i=0
		while [ "$i" -lt "$update_count" ]; do
			update=$(echo "$response" | jsonfilter -e "@.result[$i]" 2>/dev/null)
			update_id=$(echo "$update" | jsonfilter -e '@.update_id' 2>/dev/null)
			[ -n "$update_id" ] && offset=$((update_id + 1))
			echo "$offset" > "$OFFSET_FILE"

			# try message first
			msg_chat_id=$(echo "$update" | jsonfilter -e '@.message.chat.id' 2>/dev/null)
			if [ -n "$msg_chat_id" ]; then
				if [ "$msg_chat_id" = "$TG_CHAT_ID" ]; then
					msg_text=$(echo "$update" | jsonfilter -e '@.message.text' 2>/dev/null)
					case "$msg_text" in
						/start*|/help*) handle_help ;;
						/devices*)      handle_devices ;;
						/status*)       handle_status ;;
					esac
				fi
				i=$((i + 1))
				continue
			fi

			# try callback_query
			cb_id=$(echo "$update" | jsonfilter -e '@.callback_query.id' 2>/dev/null)
			if [ -n "$cb_id" ]; then
				msg_chat_id=$(echo "$update" | jsonfilter -e '@.callback_query.message.chat.id' 2>/dev/null)
				if [ "$msg_chat_id" = "$TG_CHAT_ID" ]; then
					cb_data=$(echo "$update" | jsonfilter -e '@.callback_query.data' 2>/dev/null)
					cb_msg_id=$(echo "$update" | jsonfilter -e '@.callback_query.message.message_id' 2>/dev/null)
					handle_callback "$cb_id" "$cb_data" "$cb_msg_id"
				fi
			fi

			i=$((i + 1))
		done

		# reload config periodically
		if [ "$(date +%s)" -ge "$config_reload_at" ]; then
			load_config
			config_reload_at=$(($(date +%s) + 60))
		fi
	done
}

main
