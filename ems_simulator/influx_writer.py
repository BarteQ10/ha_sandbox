import datetime
import logging
import os
import re
import time

from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

log = logging.getLogger(__name__)

URL = os.environ.get("INFLUX_URL", "http://localhost:8086")
TOKEN = os.environ.get("INFLUX_TOKEN", "ems-token")
ORG = os.environ.get("INFLUX_ORG", "home")
BUCKET = os.environ.get("INFLUX_BUCKET", "ems")

# How long (real seconds) to wait between reconnect attempts after a failure,
# so a down database is not hammered on every tick.
RECONNECT_COOLDOWN_S = 30

_SAFE_MEASUREMENT = re.compile(r'^[\w.]+$')

_client = None
_write = None
_failed = False
_last_attempt = 0.0  # monotonic time of the last (re)connect attempt


def _connect():
    """(Re)establish the client + write API. Returns True on success."""
    global _client, _write, _failed, _last_attempt
    _last_attempt = time.monotonic()
    try:
        if _client is not None:
            import contextlib
            with contextlib.suppress(Exception):
                _client.close()
        _client = InfluxDBClient(url=URL, token=TOKEN, org=ORG)
        _write = _client.write_api(write_options=SYNCHRONOUS)
        health = _client.health()
        log.info("[INFLUX] Connected (health: %s)", health.status)
        _failed = False
        return True
    except Exception as e:
        log.warning("[INFLUX] Connection failed: %s", e)
        _client = None
        _write = None
        _failed = True
        return False


def _ensure_connection():
    """Return True if connected. If failed, retry once the cooldown elapsed."""
    if not _failed and _write is not None:
        return True
    if time.monotonic() - _last_attempt < RECONNECT_COOLDOWN_S:
        return False
    log.info("[INFLUX] Attempting reconnect...")
    return _connect()


def start():
    _connect()


def write(pv, soc, load, price, balance, temp, cloud=None, ghi=None, peak_price=None, running_cost=None, curtail=None, chg_start=None, chg_duration=None, chg_pv_kwh=None, grid_status=None, anomaly=None, storm_safe=None, ev_energy_today=None, battery_soh=None, kwh_throughput=None, t_house=None):
    global _failed, _last_attempt
    if not _ensure_connection():
        return

    now = datetime.datetime.now(datetime.UTC)

    dt_h = 5.0 * 60.0 / 3600.0  # each tick = 5 simulated minutes = 1/12 h
    cost_pln = -balance * price * dt_h / (100.0 * 1000.0)

    try:
        points = [
            Point("sensor.sztuczna_produkcja_pv").time(now).field("value", float(pv)),
            Point("sensor.sztuczny_stan_baterii_soc").time(now).field("value", float(soc)),
            Point("sensor.ems_pobor_domu_bazowy").time(now).field("value", float(load)),
            Point("sensor.ems_biezaca_cena_energii").time(now).field("value", float(price)),
            Point("sensor.ems_moc_netto_bilans").time(now).field("value", float(balance)),
            Point("sensor.ems_koszt_chwilowy_pln").time(now).field("value", float(cost_pln)),
        ]
        if temp is not None:
            points.append(
                Point("sensor.current_temp").time(now).field("value", float(temp))
            )
        if cloud is not None:
            points.append(
                Point("sensor.cloud_cover").time(now).field("value", float(cloud))
            )
        if ghi is not None:
            points.append(
                Point("sensor.shortwave_radiation").time(now).field("value", float(ghi))
            )
        if peak_price is not None:
            points.append(
                Point("sensor.ems_szczyt_cena_dzis").time(now).field("value", float(peak_price))
            )
        if running_cost is not None:
            points.append(
                Point("sensor.ems_koszt_kumulatywny_dzis").time(now).field("value", float(running_cost))
            )
        if curtail is not None:
            points.append(
                Point("sensor.ems_ograniczenie_pv").time(now).field("value", float(curtail))
            )
        if chg_start is not None:
            points.append(
                Point("sensor.ems_charge_window_start").time(now).field("value", float(chg_start))
            )
        if chg_duration is not None:
            points.append(
                Point("sensor.ems_charge_window_duration").time(now).field("value", float(chg_duration))
            )
        if chg_pv_kwh is not None:
            points.append(
                Point("sensor.ems_pv_forecast_tomorrow_kwh").time(now).field("value", float(chg_pv_kwh))
            )
        if grid_status is not None:
            points.append(
                Point("sensor.ems_status_sieci").time(now).field("value", float(grid_status))
            )
        if anomaly is not None:
            points.append(
                Point("sensor.ems_symuluj_awarie_api").time(now).field("value", float(anomaly))
            )
        if storm_safe is not None:
            points.append(
                Point("sensor.ems_storm_safeguard").time(now).field("value", float(storm_safe))
            )
        if ev_energy_today is not None:
            points.append(
                Point("sensor.ems_ev_energy_today").time(now).field("value", float(ev_energy_today))
            )
        if battery_soh is not None:
            points.append(
                Point("sensor.ems_battery_soh").time(now).field("value", float(battery_soh))
            )
        if kwh_throughput is not None:
            points.append(
                Point("sensor.ems_battery_kwh_throughput").time(now).field("value", float(kwh_throughput))
            )
        if t_house is not None:
            points.append(
                Point("sensor.ems_t_house").time(now).field("value", float(t_house))
            )

        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] Write failed: %s", e)
        _failed = True
        _last_attempt = time.monotonic()  # start cooldown before reconnecting


def read_last(measurement):
    if not _ensure_connection():
        return None
    if not _SAFE_MEASUREMENT.match(measurement):
        log.warning("[INFLUX] Unsafe measurement name rejected: %r", measurement)
        return None
    try:
        q = _client.query_api()
        result = q.query(
            f'from(bucket:"{BUCKET}") '
            f'|> range(start: today()) '
            f'|> filter(fn: (r) => r._measurement == "{measurement}") '
            f'|> last() '
            f'|> keep(columns: ["_value"])'
        )
        if result and len(result) > 0 and len(result[0].records) > 0:
            return result[0].records[0].get_value()
    except Exception as e:
        log.warning("[INFLUX] Read last failed: %s", e)
    return None


# ── event log persistence ───────────────────────────────────────────────────────

# Allowed Flux range tokens: relative duration (-7d) or RFC3339 UTC timestamp.
_FLUX_RANGE = re.compile(r'^(-\d+[smhdw]|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z)$')
_SAFE_TAG = re.compile(r'^[a-z_]+$')


def write_event(event: dict) -> None:
    """Persist a single event-log entry to InfluxDB (measurement 'ems_event')."""
    if not _ensure_connection():
        return
    try:
        ts = datetime.datetime.fromtimestamp(float(event["ts"]), datetime.UTC)
        point = (
            Point("ems_event")
            .time(ts)
            .tag("category", str(event["category"]))
            .tag("severity", str(event["severity"]))
            .field("message", str(event["message"]))
            .field("eid", int(event["id"]))
        )
        _write.write(bucket=BUCKET, record=point)
    except Exception as e:
        log.warning("[INFLUX] write_event failed: %s", e)


def read_events(start="-7d", stop=None, category=None, limit=500) -> list[dict]:
    """Query persisted events. Returns list of dicts (newest first).

    start/stop: Flux range tokens (relative like '-7d' or RFC3339 UTC). Anything
    not matching the allow-list is rejected (default start, no stop).
    """
    if not _ensure_connection():
        return []
    limit = max(1, min(int(limit), 5000))
    start = start if (start and _FLUX_RANGE.match(start)) else "-7d"
    stop_clause = ""
    if stop and _FLUX_RANGE.match(stop):
        stop_clause = f", stop: {stop}"
    cat_clause = ""
    if category and category != "all":
        if not _SAFE_TAG.match(category):
            return []
        cat_clause = f'|> filter(fn: (r) => r.category == "{category}")'

    q = (
        f'from(bucket: "{BUCKET}")'
        f' |> range(start: {start}{stop_clause})'
        f' |> filter(fn: (r) => r._measurement == "ems_event")'
        f' {cat_clause}'
        f' |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")'
        f' |> sort(columns: ["_time"], desc: true)'
        f' |> limit(n: {limit})'
    )
    out: list[dict] = []
    try:
        for table in _client.query_api().query(q):
            for r in table.records:
                v = r.values
                out.append({
                    "id": int(v.get("eid", 0) or 0),
                    "ts": r.get_time().timestamp(),
                    "category": v.get("category", ""),
                    "severity": v.get("severity", ""),
                    "message": v.get("message", ""),
                })
    except Exception as e:
        log.warning("[INFLUX] read_events failed: %s", e)
    return out


def write_anomalies(flags):
    """Write anomaly detector flags (called each tick or every N ticks)."""
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        points = [
            Point(f"sensor.ems_anom_{sig}").time(now).field("value", 1.0 if active else 0.0)
            for sig, active in flags.items()
        ]
        if points:
            _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_anomalies failed: %s", e)


def write_mpc(action, cost_estimate, naive_cost, savings):
    """Write MPC optimizer metrics (called once per simulated hour)."""
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        points = [
            Point("sensor.ems_mpc_action").time(now).field("value", float(action)),
            Point("sensor.ems_mpc_cost_estimate").time(now).field("value", float(cost_estimate)),
            Point("sensor.ems_mpc_naive_cost").time(now).field("value", float(naive_cost)),
            Point("sensor.ems_mpc_savings").time(now).field("value", float(savings)),
        ]
        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_mpc failed: %s", e)


def write_forecast(pv_day_kwh, load_day_kwh, price_avg, price_peak):
    """Write 24-hour forecast summary metrics (called once per simulated hour)."""
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        points = [
            Point("sensor.ems_forecast_pv_day_kwh").time(now).field("value", float(pv_day_kwh)),
            Point("sensor.ems_forecast_load_day_kwh").time(now).field("value", float(load_day_kwh)),
            Point("sensor.ems_forecast_price_avg").time(now).field("value", float(price_avg)),
            Point("sensor.ems_forecast_price_peak").time(now).field("value", float(price_peak)),
        ]
        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_forecast failed: %s", e)


def write_presence(mode: int, label: str) -> None:
    """Write presence mode sensor (called each tick)."""
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        points = [
            Point("sensor.ems_presence_mode").time(now).field("value", float(mode)),
            Point("sensor.ems_presence_label").time(now).field("value", label),
        ]
        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_presence failed: %s", e)


def write_lighting(brightness: float, color_temp_k: float, load_w: int) -> None:
    """Write circadian lighting model sensors (called each tick)."""
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        points = [
            Point("sensor.ems_light_brightness").time(now).field("value", float(brightness)),
            Point("sensor.ems_light_color_temp_k").time(now).field("value", float(color_temp_k)),
            Point("sensor.ems_light_load_w").time(now).field("value", float(load_w)),
        ]
        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_lighting failed: %s", e)


def write_standby(total_w: int) -> None:
    """Write aggregated standby device load (informational, called each tick)."""
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        _write.write(bucket=BUCKET, record=[
            Point("sensor.ems_standby_load_w").time(now).field("value", float(total_w))
        ])
    except Exception as e:
        log.warning("[INFLUX] write_standby failed: %s", e)


def write_standby_cuts(cut_names: set) -> None:
    """Write smart-socket cut events (called when a device is cut this tick)."""
    if not cut_names or not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        points = [
            Point(f"sensor.ems_standby_cut_{name.lower()}").time(now).field("value", 1.0)
            for name in cut_names
        ]
        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_standby_cuts failed: %s", e)


def write_media_state(state: str, brightness_override: float | None) -> None:
    """Write media player state sensor (called each tick)."""
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    state_int = {"idle": 0, "playing": 1, "paused": 2}.get(state, 0)
    try:
        points = [
            Point("sensor.ems_media_state").time(now).field("value", float(state_int)),
        ]
        if brightness_override is not None:
            points.append(
                Point("sensor.ems_media_brightness_override").time(now).field("value", float(brightness_override))
            )
        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_media_state failed: %s", e)


def write_motion(outdoor: bool, indoor: bool) -> None:
    """Write motion sensor states (called every N ticks)."""
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        points = [
            Point("sensor.ems_motion_outdoor").time(now).field("value", 1.0 if outdoor else 0.0),
            Point("sensor.ems_motion_indoor").time(now).field("value", 1.0 if indoor else 0.0),
        ]
        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_motion failed: %s", e)


def write_rules(active_keys: set) -> None:
    """Write rule engine event flags (called every N ticks)."""
    from ems_simulator.rules import ALL_RULE_KEYS
    if not _ensure_connection():
        return
    now = datetime.datetime.now(datetime.UTC)
    try:
        points = [
            Point(f"sensor.ems_rule_{key}").time(now).field(
                "value", 1.0 if key in active_keys else 0.0
            )
            for key in ALL_RULE_KEYS
        ]
        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        log.warning("[INFLUX] write_rules failed: %s", e)


def stop():
    global _client
    if _client:
        _client.close()
        log.info("[INFLUX] Closed")
