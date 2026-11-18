#!/bin/bash
# Starts the bridge with the stand's environment and ComfyUI venv (as previz does).
# Logs: $BRIDGE_DIR/bridge.log
set -euo pipefail
umask 007
HERE="$(cd "$(dirname "$0")" && pwd)"
STAND="${STAND:-/mnt/ml-data/stand}"
export BRIDGE_DIR="${BRIDGE_DIR:-/mnt/ml-data/ai-video-platform/h3-bridge}"
mkdir -p "$BRIDGE_DIR"
# shellcheck disable=SC1091
source "$STAND/env.sh"
exec "$STAND/venv-comfy/bin/python" -u "$HERE/h3_bridge.py" >> "$BRIDGE_DIR/bridge.log" 2>&1
