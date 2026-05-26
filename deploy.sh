#!/usr/bin/env bash
set -euo pipefail

# Deployment script for EMS Simulator
# Usage: ./deploy.sh [/path/to/project]
# If no path given, uses current directory.
# Designed for Linux server / Raspberry Pi.

PROJECT="${1:-$(pwd)}"
cd "$PROJECT"

echo "[deploy] Pulling latest changes..."
git pull

echo "[deploy] Installing Python deps..."
pip install -r requirements.txt 2>/dev/null || true

echo "[deploy] Building frontend..."
cd frontend
npm ci --omit=dev --ignore-scripts 2>/dev/null || npm ci 2>/dev/null || npm install
npm run build
cd ..

echo "[deploy] Restarting simulator..."
if systemctl is-active --quiet ems-simulator 2>/dev/null; then
  sudo systemctl restart ems-simulator
  echo "[deploy] ems-simulator restarted."
elif systemctl is-active --quiet hass 2>/dev/null; then
  echo "[deploy] HA container detected. Restart if needed: docker restart hass"
else
  echo "[deploy] No systemd service found. Start manually: python run.py &"
fi

echo "[deploy] Done at $(date)"
