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
from http.server import BaseHTTPRequestHandler, HTTPServer

log = logging.getLogger(__name__)

HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "8088"))

# Shared state — written by the main loop, read by the HTTP handler.
_metrics: dict = {}
_started_at: float = time.monotonic()
_lock = threading.Lock()


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
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        uptime = round(time.monotonic() - _started_at)
        snap = _snapshot()

        if self.path in ("/health", "/health/"):
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

        elif self.path in ("/metrics", "/metrics/"):
            body = {"uptime_s": uptime, **snap}
            self._send_json(200, body)

        else:
            self._send_json(404, {"error": "not found", "paths": ["/health", "/metrics"]})


class _Server(threading.Thread):
    def __init__(self):
        super().__init__(name="health-http", daemon=True)
        self._httpd = HTTPServer(("0.0.0.0", HEALTH_PORT), _Handler)

    def run(self):
        log.info("[HEALTH] Listening on port %d  (GET /health  GET /metrics)", HEALTH_PORT)
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
