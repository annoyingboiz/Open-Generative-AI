#!/bin/bash
# Keeps one bridge running (cron: every minute and @reboot).
#   ensure.sh          start it if it isn't running
#   ensure.sh restart  stop and start (after an update)
#   ensure.sh stop     stop it (and it stays stopped until "start": the cron line checks the off-switch)
#   ensure.sh start    clear the off-switch and start
set -uo pipefail
umask 007
HERE="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="${BRIDGE_DIR:-/mnt/ml-data/ai-video-platform/h3-bridge}"
mkdir -p "$BRIDGE_DIR"
PIDFILE="$BRIDGE_DIR/bridge.pid"
OFF="$BRIDGE_DIR/OFF"
# Only our bridge counts (a reused PID after a reboot is someone else's process).
running() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "h3_bridge.py"
}
stop() { if running; then kill "$(cat "$PIDFILE")"; for _ in $(seq 20); do running || break; sleep 0.5; done; fi; rm -f "$PIDFILE"; }
# 9>&-: the bridge must not keep ensure.lock open (status/stop/restart would never get it)
start() { running && return 0; nohup setsid "$HERE/run.sh" > /dev/null 2>&1 < /dev/null 9>&- & echo $! > "$PIDFILE"; }
exec 9> "$BRIDGE_DIR/ensure.lock"
flock -n 9 || exit 0
case "${1:-ensure}" in
  stop) touch "$OFF"; stop; echo stopped ;;
  start) rm -f "$OFF"; start; echo started ;;
  restart) stop; rm -f "$OFF"; start; echo restarted ;;
  status) running && echo "running (pid $(cat "$PIDFILE"))" || echo "not running" ;;
  *) [ -f "$OFF" ] || start ;;
esac
