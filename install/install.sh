#!/usr/bin/env bash
# Director — install or update on macOS / Linux, one command:
#   curl -fsSL https://raw.githubusercontent.com/annoyingboiz/Open-Generative-AI/dz/step-2-gateway/install/install.sh | bash
# Run it again to update (your data, keys and accounts stay).
# Options (env): DIRECTOR_DIR (default ~/Director), DIRECTOR_PORT (3300),
#                DIRECTOR_REPO, DIRECTOR_BRANCH.
set -euo pipefail

DIR="${DIRECTOR_DIR:-$HOME/Director}"
REPO="${DIRECTOR_REPO:-https://github.com/annoyingboiz/Open-Generative-AI}"
BRANCH="${DIRECTOR_BRANCH:-dz/step-2-gateway}"
PORT="${DIRECTOR_PORT:-3300}"
OS="$(uname -s)"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
open_url() { if [ "$OS" = Darwin ]; then open "$1"; elif command -v xdg-open >/dev/null; then xdg-open "$1" >/dev/null 2>&1 || true; fi; }
# Something already listens on this local port?
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
MARK=".director-install" # this folder is a Director install (safe to update)

say "Director — install / update into $DIR"

# 1. Docker (Docker Desktop, OrbStack or Docker Engine).
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker is not installed. Director runs in Docker."
  if [ "$OS" = Darwin ] && command -v brew >/dev/null 2>&1; then
    read -r -p "Install Docker Desktop with Homebrew now? [y/N] " a </dev/tty || a=n
    if [ "${a:-n}" = y ] || [ "${a:-n}" = Y ]; then brew install --cask docker; open -a Docker; else die "Install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, then run this again."; fi
  else
    open_url "https://www.docker.com/products/docker-desktop/"
    die "Install Docker (https://www.docker.com/products/docker-desktop/), start it, then run this again."
  fi
fi
if ! docker info >/dev/null 2>&1; then
  if [ "$OS" = Darwin ]; then
    say "Starting Docker…"
    open -a Docker 2>/dev/null || open -a OrbStack 2>/dev/null || true
  fi
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop and run this again."
fi
docker compose version >/dev/null 2>&1 || die "This Docker has no 'docker compose'. Update Docker Desktop."

# 2. The code: git if there is one, otherwise a download (data and settings are kept).
mkdir -p "$DIR"
others="$(find "$DIR" -mindepth 1 -maxdepth 1 ! -name data ! -name .env ! -name "$MARK" -print -quit)"
if [ -n "$others" ] && [ ! -f "$DIR/$MARK" ]; then
  die "$DIR already has other files and is not a Director install. Choose another folder: DIRECTOR_DIR=/path/to/folder"
fi
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" remote get-url origin 2>/dev/null | grep -qi 'open-generative-ai' || die "$DIR/.git is not the Director repository."
  say "Updating the code…"
  git -C "$DIR" fetch --depth 1 origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" FETCH_HEAD
elif command -v git >/dev/null 2>&1 && [ -z "$others" ]; then
  say "Downloading the code…"
  tmp="$(mktemp -d)"; git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$tmp/src"
  cp -R "$tmp/src/." "$DIR/"; rm -rf "$tmp"
else
  say "Downloading the code…"
  tmp="$(mktemp -d)"
  owner_repo="${REPO#https://github.com/}"
  curl -fsSL "https://codeload.github.com/${owner_repo}/tar.gz/refs/heads/${BRANCH}" | tar -xz -C "$tmp" --strip-components=1
  [ -f "$tmp/docker-compose.yml" ] || die "The download looks wrong (no docker-compose.yml)."
  # Keep data/ and .env; the old code goes, the new one comes in.
  find "$DIR" -mindepth 1 -maxdepth 1 ! -name data ! -name .env ! -name "$MARK" -exec rm -rf {} +
  (cd "$tmp" && tar -cf - .) | (cd "$DIR" && tar -xf -)
  rm -rf "$tmp"
fi
touch "$DIR/$MARK"
cd "$DIR"

# 3. Settings: a free port, data next to the code.
if [ ! -f .env ]; then
  while port_busy "$PORT"; do PORT=$((PORT + 1)); done
  cat > .env <<ENV
# Director on this computer. Keys go into Settings in the app (stored encrypted in data/).
PORT=$PORT
DATA_DIR=./data
ENV
fi
PORT="$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d ' ' || echo 3300)"; PORT="${PORT:-3300}"
mkdir -p data

# 4. Build and start (the first build takes a few minutes).
say "Building and starting Director (first time: 5–10 minutes)…"
# The ChatGPT sign-in comes back on 127.0.0.1:1455 — if that port is taken, run without it.
FILES=(-f docker-compose.yml -f deploy/compose.personal.yml)
if port_busy 1455 && ! docker compose ps -q gateway 2>/dev/null | grep -q .; then
  warn "Port 1455 is used by another program: ChatGPT sign-in will need the paste step (see Settings)."
  FILES=(-f docker-compose.yml)
fi
docker compose "${FILES[@]}" up -d --build

URL="http://localhost:$PORT"
say "Waiting for Director to start…"
for _ in $(seq 1 120); do curl -fsS "$URL/healthz" >/dev/null 2>&1 && break; sleep 3; done
curl -fsS "$URL/healthz" >/dev/null 2>&1 || die "Director did not start. See: cd \"$DIR\" && docker compose logs gateway"

if [ -f data/setup-code ]; then
  CODE="$(tr -d ' \n' < data/setup-code)"
  say "Ready. First start: create your admin account (the setup code is filled in)."
  open_url "$URL/setup#code=$CODE"
  echo "If the browser didn't open: $URL/setup   setup code: $CODE"
else
  say "Ready: $URL"
  open_url "$URL"
fi
cat <<TXT

  Open:    $URL
  Update:  run this installer again
  Stop:    cd "$DIR" && docker compose stop
  Start:   cd "$DIR" && docker compose -f docker-compose.yml -f deploy/compose.personal.yml up -d
  Logs:    cd "$DIR" && docker compose logs -f gateway
TXT
