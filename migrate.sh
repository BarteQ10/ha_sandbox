#!/usr/bin/env bash
set -euo pipefail

# Data migration for the EMS Simulator — move all persistent state between servers.
#
#   ./migrate.sh backup  [outdir]        # bundle every database + data dir into a .tgz
#   ./migrate.sh restore <bundle.tgz>    # restore that bundle on a fresh server
#
# What it moves:
#   - InfluxDB telemetry  (influx backup/restore — hot-safe, version-portable)
#   - Home Assistant DB   (config/home-assistant_v2.db* — SQLite recorder)
#   - Floor-plan layout   (simulator_data/)
#   - Web Push subs       (simulator_data/push_subs.json, if present)
#   - RL Q-table          (rl/qtable.npy, if present)
#   - Retained MQTT       (mosquitto/data/)
#
# Run from the project root on a host where `docker compose` is up (Influx needs
# its container running). Override defaults via env vars if you changed them:
INFLUX_CONTAINER="${INFLUX_CONTAINER:-influxdb_dev}"
INFLUX_TOKEN="${INFLUX_TOKEN:-ems-token}"
INFLUX_BUCKET="${INFLUX_BUCKET:-ems}"
INFLUX_ORG="${INFLUX_ORG:-home}"

log() { printf '[migrate] %s\n' "$*"; }
die() { printf '[migrate] ERROR: %s\n' "$*" >&2; exit 1; }

influx_up() {
  docker ps --format '{{.Names}}' | grep -qx "$INFLUX_CONTAINER" \
    || die "InfluxDB container '$INFLUX_CONTAINER' is not running. Start the stack: docker compose up -d"
}

backup() {
  local outdir="${1:-.}"
  mkdir -p "$outdir"
  local stamp work bundle
  stamp="$(date +%Y%m%d-%H%M%S)"
  work="$(mktemp -d)"
  bundle="$outdir/ems-migrate-$stamp.tgz"
  trap 'rm -rf "$work"' EXIT

  influx_up

  log "Backing up InfluxDB bucket '$INFLUX_BUCKET'..."
  docker exec "$INFLUX_CONTAINER" sh -c 'rm -rf /tmp/ibackup' || true
  docker exec "$INFLUX_CONTAINER" influx backup /tmp/ibackup \
    --bucket "$INFLUX_BUCKET" --token "$INFLUX_TOKEN" --org "$INFLUX_ORG"
  docker cp "$INFLUX_CONTAINER:/tmp/ibackup" "$work/influx"
  docker exec "$INFLUX_CONTAINER" sh -c 'rm -rf /tmp/ibackup' || true

  log "Copying Home Assistant recorder DB..."
  mkdir -p "$work/ha"
  # SQLite copy of a live DB can be torn — stop HA first for a guaranteed-clean copy.
  cp config/home-assistant_v2.db* "$work/ha/" 2>/dev/null \
    || log "  (no HA DB found — skipping)"

  log "Copying data directories..."
  [ -d simulator_data ] && cp -r simulator_data "$work/simulator_data" || true
  [ -d mosquitto/data ] && { mkdir -p "$work/mosquitto"; cp -r mosquitto/data "$work/mosquitto/data"; } || true
  [ -f rl/qtable.npy ]  && { mkdir -p "$work/rl"; cp rl/qtable.npy "$work/rl/"; } || true

  log "Creating bundle..."
  tar czf "$bundle" -C "$work" .
  log "Done → $bundle ($(du -h "$bundle" | cut -f1))"
  log "Copy it to the new server, then: ./migrate.sh restore $(basename "$bundle")"
}

restore() {
  local bundle="${1:-}"
  [ -n "$bundle" ] || die "Usage: ./migrate.sh restore <bundle.tgz>"
  [ -f "$bundle" ] || die "Bundle not found: $bundle"
  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT

  influx_up
  log "Extracting bundle..."
  tar xzf "$bundle" -C "$work"

  if [ -d "$work/influx" ]; then
    log "Restoring InfluxDB bucket '$INFLUX_BUCKET' (existing bucket will be replaced)..."
    docker exec "$INFLUX_CONTAINER" influx bucket delete \
      --name "$INFLUX_BUCKET" --org "$INFLUX_ORG" --token "$INFLUX_TOKEN" 2>/dev/null \
      && log "  removed existing '$INFLUX_BUCKET' bucket" || log "  no existing bucket to remove"
    docker exec "$INFLUX_CONTAINER" sh -c 'rm -rf /tmp/ibackup' || true
    docker cp "$work/influx" "$INFLUX_CONTAINER:/tmp/ibackup"
    docker exec "$INFLUX_CONTAINER" influx restore /tmp/ibackup \
      --bucket "$INFLUX_BUCKET" --token "$INFLUX_TOKEN" --org "$INFLUX_ORG"
    docker exec "$INFLUX_CONTAINER" sh -c 'rm -rf /tmp/ibackup' || true
  else
    log "No InfluxDB data in bundle — skipping."
  fi

  if compgen -G "$work/ha/home-assistant_v2.db*" > /dev/null; then
    log "Restoring Home Assistant DB (stop HA first for a clean swap)..."
    mkdir -p config
    cp "$work"/ha/home-assistant_v2.db* config/
  fi

  [ -d "$work/simulator_data" ]  && { rm -rf simulator_data; cp -r "$work/simulator_data" simulator_data; log "Restored simulator_data/"; } || true
  [ -d "$work/mosquitto/data" ]  && { mkdir -p mosquitto; rm -rf mosquitto/data; cp -r "$work/mosquitto/data" mosquitto/data; log "Restored mosquitto/data/"; } || true
  [ -f "$work/rl/qtable.npy" ]   && { mkdir -p rl; cp "$work/rl/qtable.npy" rl/; log "Restored rl/qtable.npy"; } || true

  log "Done. Restart the stack to pick everything up: docker compose restart"
}

case "${1:-}" in
  backup)  shift; backup "$@" ;;
  restore) shift; restore "$@" ;;
  *) cat >&2 <<EOF
Usage:
  ./migrate.sh backup  [outdir]       Bundle all databases + data into a .tgz
  ./migrate.sh restore <bundle.tgz>   Restore a bundle on a new server

Env overrides: INFLUX_CONTAINER ($INFLUX_CONTAINER), INFLUX_TOKEN, INFLUX_BUCKET ($INFLUX_BUCKET), INFLUX_ORG ($INFLUX_ORG)
EOF
    exit 1 ;;
esac
