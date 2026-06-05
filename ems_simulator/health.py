"""Health & metrics HTTP endpoint (2.4).

Starts a lightweight HTTP server in a daemon thread on HEALTH_PORT (default 8088).
Two endpoints:
    GET /health  — {"status": "ok"|"degraded", "uptime_s", "ticks", "influx_ok", ...}
    GET /metrics — current simulation snapshot (PV, SoC, load, price, battery, MPC, etc.)

The main loop calls update() every tick to push the latest values.
"""

import json
import logging
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

log = logging.getLogger(__name__)

HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "8088"))
# Floor-plan layout persistence (POST to save, GET to load) — survives across
# browsers/devices. Put it on a mounted volume so it survives container rebuilds.
_FLOORPLAN_PATH = os.environ.get("FLOORPLAN_PATH", "/data/floorplan.json")

# Shared state — written by the main loop, read by the HTTP handler.
_metrics: dict = {}
_started_at: float = time.monotonic()
_lock = threading.Lock()

# Optional callback to manually trigger a device safety alarm (smoke/co/leak),
# wired from main() to HomeDevices.trigger_alarm. Used by the /test-alarm endpoint.
_alarm_trigger = None


def set_alarm_trigger(fn) -> None:
    global _alarm_trigger
    _alarm_trigger = fn


# Latest 24h advisor forecast {"hours": [...], "now_hour": int}, set from main().
_advisor: dict | None = None


def set_advisor(data: dict) -> None:
    global _advisor
    _advisor = data


def update(
    *,
    tick: int,
    pv_w: float,
    soc_pct: float,
    load_w: float,
    price_gr: float,
    balance_w: float,
    t_house: float,
    battery_soh: float,
    running_cost_pln: float,
    influx_ok: bool,
    mpc_action: int = 0,
    forecast_pv_kwh: float = 0.0,
    forecast_load_kwh: float = 0.0,
    rl_enabled: bool = False,
    rl_action: int = 0,
    rl_epsilon: float = 0.0,
    rl_ticks: int = 0,
    presence_mode: int = 0,
    presence_label: str = "home",
    media_state: str = "idle",
    light_brightness: float = 0.0,
    light_color_temp_k: float = 2700.0,
    motion_outdoor: bool = False,
    motion_indoor: bool = False,
    standby_load_w: int = 0,
    light_load_w: int = 0,
    notify_enabled: bool = False,
    notify_webhook: bool = False,
    notify_telegram: bool = False,
):
    """Update the shared metrics snapshot (called from the main loop)."""
    with _lock:
        _metrics.update(
            tick=tick,
            pv_w=round(pv_w),
            soc_pct=round(soc_pct, 1),
            load_w=round(load_w),
            price_gr=round(price_gr, 1),
            balance_w=round(balance_w),
            t_house=round(t_house, 1),
            battery_soh=round(battery_soh, 3),
            running_cost_pln=round(running_cost_pln, 2),
            influx_ok=influx_ok,
            mpc_action=mpc_action,
            forecast_pv_kwh=forecast_pv_kwh,
            forecast_load_kwh=forecast_load_kwh,
            rl_enabled=rl_enabled,
            rl_action=rl_action,
            rl_epsilon=round(rl_epsilon, 4),
            rl_ticks=rl_ticks,
            presence_mode=presence_mode,
            presence_label=presence_label,
            media_state=media_state,
            light_brightness=round(light_brightness, 1),
            light_color_temp_k=round(light_color_temp_k),
            motion_outdoor=motion_outdoor,
            motion_indoor=motion_indoor,
            standby_load_w=standby_load_w,
            light_load_w=light_load_w,
            notify_enabled=notify_enabled,
            notify_webhook=notify_webhook,
            notify_telegram=notify_telegram,
            updated_at=time.time(),
        )


def _snapshot():
    with _lock:
        return dict(_metrics)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silence access log
        pass

    def _send_json(self, code, body):
        data = json.dumps(body, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        # CORS — allow the React dev/prod app (separate origin) to read these.
        # Dev tool on a trusted home network; see README security note.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):  # CORS preflight
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path in ("/push/subscribe", "/push/test"):
            try:
                import ems_simulator.push as push
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length).decode("utf-8") if length else ""
                if path == "/push/test":
                    sent = push.send("EMS", "Test notification ✅", tag="ems-test")
                    self._send_json(200, {"sent": sent, "enabled": push.enabled()})
                else:
                    sub = json.loads(body) if body else {}
                    count = push.add_subscription(sub)
                    self._send_json(200, {"ok": True, "count": count})
            except Exception as e:
                log.warning("[HEALTH] POST %s failed: %s", path, e)
                self._send_json(200, {"ok": False})
            return
        if path == "/assistant":
            try:
                import ems_simulator.assistant_llm as assistant_llm
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length).decode("utf-8")
                text = json.loads(body).get("text", "") if body else ""
                result = assistant_llm.classify(text)
                result["enabled"] = assistant_llm.enabled()
                self._send_json(200, result)
            except Exception as e:
                log.warning("[HEALTH] POST /assistant failed: %s", e)
                self._send_json(200, {"intent": "unknown", "value": None, "enabled": False})
            return
        if path == "/floorplan":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length).decode("utf-8")
                data = json.loads(body)
                if not (isinstance(data, dict) and isinstance(data.get("rooms"), list)
                        and isinstance(data.get("devices"), list)):
                    self._send_json(400, {"error": "invalid_layout"})
                    return
                os.makedirs(os.path.dirname(_FLOORPLAN_PATH), exist_ok=True)
                with open(_FLOORPLAN_PATH, "w", encoding="utf-8") as f:
                    json.dump(data, f)
                self._send_json(200, {"saved": True})
            except Exception as e:
                log.warning("[HEALTH] POST /floorplan failed: %s", e)
                self._send_json(500, {"error": "save_failed", "detail": str(e)})
        else:
            self._send_json(404, {"error": "not found"})

    def do_GET(self):
        uptime = round(time.monotonic() - _started_at)
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        snap = _snapshot()

        if path == "/health":
            stale = snap and (time.time() - snap.get("updated_at", 0)) > 30
            status = "degraded" if (not snap or stale) else "ok"
            body = {
                "status": status,
                "uptime_s": uptime,
                "ticks": snap.get("tick", 0),
                "influx_ok": snap.get("influx_ok", False),
                "stale": bool(stale),
            }
            self._send_json(200 if status == "ok" else 503, body)

        elif path == "/metrics":
            body = {"uptime_s": uptime, **snap}
            self._send_json(200, body)

        elif path == "/backtest":
            days = 7
            try:
                q = parse_qs(parsed.query)
                days = int(q.get("days", ["7"])[0])
            except (ValueError, TypeError):
                days = 7
            try:
                from backtest import run_backtest
                result = run_backtest(days)
                code = 200 if "error" not in result else 503
                self._send_json(code, result)
            except Exception as e:
                log.warning("[HEALTH] /backtest failed: %s", e)
                self._send_json(500, {"error": "backtest_failed", "detail": str(e)})

        elif path == "/events":
            import ems_simulator.events as events
            q = parse_qs(parsed.query)
            try:
                limit = int(q.get("limit", ["100"])[0])
            except (ValueError, TypeError):
                limit = 100
            category = q.get("category", [None])[0]
            frm = q.get("from", [None])[0]
            to = q.get("to", [None])[0]
            if frm:
                # Historical query from InfluxDB over a date range
                evs = events.history(start=frm, stop=to, category=category, limit=limit)
            else:
                # Recent events from the in-memory buffer
                since = None
                if "since" in q:
                    try:
                        since = float(q["since"][0])
                    except (ValueError, TypeError):
                        since = None
                evs = events.snapshot(limit=limit, category=category, since=since)
            self._send_json(200, {
                "events": evs,
                "stats": events.stats(),
                "categories": list(events.CATEGORIES),
                "mode": "history" if frm else "live",
            })

        elif path == "/advisor":
            from ems_simulator import advisor
            data = _advisor or {"hours": [], "now_hour": 0}
            recs = advisor.recommend(data.get("hours", []), advisor.DEFAULT_APPLIANCES,
                                     data.get("now_hour", 0))
            self._send_json(200, {"hours": data.get("hours", []), "recommendations": recs})

        elif path == "/floorplan":
            try:
                with open(_FLOORPLAN_PATH, encoding="utf-8") as f:
                    self._send_json(200, json.load(f))
            except FileNotFoundError:
                self._send_json(404, {"error": "no_layout"})
            except Exception as e:
                log.warning("[HEALTH] GET /floorplan failed: %s", e)
                self._send_json(500, {"error": "read_failed"})

        elif path == "/test-alarm":
            q = parse_qs(parsed.query)
            kind = q.get("type", [""])[0]
            ok = False
            if _alarm_trigger is not None:
                try:
                    ok = bool(_alarm_trigger(kind))
                except Exception as e:
                    log.warning("[HEALTH] /test-alarm failed: %s", e)
            self._send_json(200 if ok else 400, {
                "triggered": ok, "type": kind,
                "valid": ["smoke", "co", "leak"],
            })

        elif path == "/push/key":
            import ems_simulator.push as push
            self._send_json(200, {"publicKey": push.VAPID_PUBLIC, "enabled": push.enabled()})

        else:
            self._send_json(404, {"error": "not found",
                                  "paths": ["/health", "/metrics", "/backtest?days=N",
                                            "/events", "/test-alarm?type=smoke|co|leak",
                                            "/floorplan (GET/POST)", "/advisor",
                                            "/assistant (POST)"]})


class _Server(threading.Thread):
    def __init__(self):
        super().__init__(name="health-http", daemon=True)
        # Threading server so a slow /backtest does not block /health and /metrics.
        self._httpd = ThreadingHTTPServer(("0.0.0.0", HEALTH_PORT), _Handler)

    def run(self):
        log.info("[HEALTH] Listening on port %d  (GET /health  /metrics  /backtest)", HEALTH_PORT)
        self._httpd.serve_forever()

    def stop(self):
        self._httpd.shutdown()


_server: _Server | None = None


def start():
    global _server
    _server = _Server()
    _server.start()


def stop():
    global _server
    if _server:
        _server.stop()
        _server = None
        log.info("[HEALTH] Stopped")
