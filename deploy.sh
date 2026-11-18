#!/usr/bin/env bash
set -euo pipefail

# Deployment script for EMS Simulator
# Usage: ./deploy.sh [/path/to/project]
# If no path given, uses current directory.
# Designed for Linux server / Raspberry Pi.
#
# .github/workflows/deploy.yml runs this same script over SSH. It used to carry
# its own copy of these steps, which is how the automated deploy came to differ
# from a manual one: neither restarted the Docker stack, and a fix to one would
# not have reached the other.

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
PROJECT="${1:-$(pwd)}"
cd "$PROJECT"

if [ "${EMS_DEPLOY_PULLED:-}" != "1" ]; then
  echo "[deploy] Pulling latest changes..."
  git pull
  # The pull may have rewritten this very script, and bash reads a script as it
  # executes rather than up front — so hand over to the new copy instead of
  # running the rest out of a file that changed underneath us.
  export EMS_DEPLOY_PULLED=1
  exec bash "$SELF" "$@"
fi

# Waits for the simulator to say it is actually running, not merely started.
# docker-compose.yml polls /health, which answers 503 once the loop stops
# ticking, so this turns "[deploy] Done" into a statement about the thing
# working instead of one about the commands having been typed.
wait_for_health() {
  local deadline=$((SECONDS + 180))
  local cid status
  cid="$(docker compose ps -q ems-simulator 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo "[deploy] WARNING: no ems-simulator container; skipping the health wait."
    return 0
  fi
  echo "[deploy] Waiting for ems-simulator to report healthy..."
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(docker inspect -f \
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$cid" 2>/dev/null || echo gone)"
    case "$status" in
      healthy)
        echo "[deploy] ems-simulator is healthy."
        return 0
        ;;
      none)
        echo "[deploy] Container has no healthcheck; skipping the wait."
        return 0
        ;;
      unhealthy)
        echo "[deploy] ERROR: ems-simulator reports unhealthy."
        docker compose logs --tail 40 ems-simulator || true
        return 1
        ;;
    esac
    sleep 3
  done
  echo "[deploy] ERROR: ems-simulator never became healthy (last status: ${status})."
  docker compose logs --tail 40 ems-simulator || true
  return 1
}

echo "[deploy] Installing Python deps..."
pip install -r requirements.txt 2>/dev/null || true

echo "[deploy] Building frontend..."
(
  cd frontend
  npm ci --omit=dev --ignore-scripts 2>/dev/null || npm ci 2>/dev/null || npm install
  npm run build
)

# nginx serves frontend/dist straight off a bind mount, so that build is live
# the moment it finishes. The simulator is different: docker-compose.yml builds
# it from this tree (`build: .`), so new Python code needs the image rebuilt,
# not just the container restarted.
if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then
  echo "[deploy] Docker stack detected — rebuilding and restarting..."
  # Non-fatal: every image here is pinned, so there is usually nothing to
  # fetch, and a network blip should not abort a deploy. `up -d` pulls whatever
  # it genuinely needs and fails loudly when it cannot.
  docker compose pull --quiet || echo "[deploy] WARNING: pull failed, using local images."
  docker compose up -d --build
  wait_for_health
elif systemctl is-active --quiet ems-simulator 2>/dev/null; then
  echo "[deploy] Restarting the systemd service..."
  sudo systemctl restart ems-simulator
  echo "[deploy] ems-simulator restarted."
else
  echo "[deploy] Neither a Docker stack nor the ems-simulator unit is here."
  echo "[deploy] Start it by hand:  docker compose up -d   (or: python run.py &)"
fi

echo "[deploy] Done at $(date)"
