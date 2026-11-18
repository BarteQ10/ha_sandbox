"""Health & metrics HTTP endpoint (2.4).

Starts a lightweight HTTP server in a daemon thread on HEALTH_PORT (default 8088).
The main loop calls update() every tick to push the latest values.

Open, because an unauthenticated caller has to be able to reach them:
    GET  /health     status/uptime/ticks — the container healthcheck polls it
    GET  /push/key   VAPID public key (public by design)

Everything else needs HEALTH_TOKEN. The writes change state, spend the owner's
push/LLM quota or burn CPU; the reads say when the house is occupied
(presence_mode, motion_*, media_state) — neither belongs to every device on
the LAN/tailnet:
    POST /push/subscribe  POST /push/test  POST /assistant  POST /floorplan
    GET  /metrics  /events  /advisor  /floorplan  /backtest  /test-alarm

So both consumers have to carry the token: the dashboard (VITE_SIM_TOKEN) and
Home Assistant's REST sensor (configuration.yaml -> X-EMS-Token).
"""

import hmac
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

# CORS allow-list. The dashboard is cross-origin only in local dev (Vite on
# :5173); behind the nginx proxy it is same-origin (/sim) and needs no CORS at
# all. Restricting to an allow-list (instead of "*") stops an arbitrary web page
# the user happens to visit from reading /metrics or POSTing cross-origin.
# Override via HEALTH_CORS_ORIGINS (comma-separated); set it to "*" to restore
# the previous open behaviour.
_CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "HEALTH_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

# Shared secret guarding the state-changing and expensive endpoints. Set
# HEALTH_TOKEN and present it as `Authorization: Bearer <token>` (or X-EMS-Token).
#
# Left unset, those endpoints answer a loopback peer only. That keeps a plain
# `python run.py` + Vite dev setup working (the browser reaches 127.0.0.1
# directly) while refusing anything that arrives through the nginx/tailnet
# proxy, where the peer is the proxy — the exposure that matters: /test-alarm
# fires a real smoke/CO/leak alarm, /push/test and /assistant spend the owner's
# notification and LLM quota, POST /floorplan writes a file, /backtest burns
# CPU, and /metrics plus /events say whether anyone is home.
_TOKEN = os.environ.get("HEALTH_TOKEN", "").strip()
_LOOPBACK = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1"})

# The only GETs served without a credential. Everything else — including a path
# added later — goes through the gate, so the default is deny.
_OPEN_GET_PATHS = frozenset({"/health", "/push/key"})

# Request bodies here are small JSON documents. Anything larger is refused
# unread, so a bogus Content-Length cannot make the simulator buffer or persist
# an arbitrary amount of data.
_MAX_BODY_BYTES = 64 * 1024

# /backtest replays this many days of history; an unbounded `days` is a free CPU sink.
_MAX_BACKTEST_DAYS = 90


def _auth_ok(peer_ip: str, presented: str) -> bool:
    """Authorize a state-changing or expensive request (see _TOKEN above)."""
    if _TOKEN:
        return hmac.compare_digest(presented, _TOKEN)
    return peer_ip in _LOOPBACK


def _clamp_days(raw, default: int = 7) -> int:
    """Parse and clamp the /backtest `days` query parameter."""
    try:
        days = int(raw)
    except (TypeError, ValueError):
        return default
    return max(1, min(days, _MAX_BACKTEST_DAYS))


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

    def _cors_origin(self):
        """Resolve the Access-Control-Allow-Origin value for this request.

        Echoes the request Origin when it is allow-listed (or "*" when the list
        is the wildcard); returns None otherwise, so no CORS header is sent.
        """
        if "*" in _CORS_ORIGINS:
            return "*"
        origin = self.headers.get("Origin")
        return origin if origin and origin in _CORS_ORIGINS else None

    def _send_cors(self):
        """Emit CORS headers for the resolved origin, if any."""
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            if origin != "*":
                # Responses vary by Origin — keep caches from reusing the header.
                self.send_header("Vary", "Origin")

    def _send_json(self, code, body):
        data = json.dumps(body, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):  # CORS preflight
        self.send_response(204)
        self._send_cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, Authorization, X-EMS-Token")
        # /metrics, /events and /advisor are polled and cross-origin in dev, and
        # the token header makes them non-simple requests. Without this the
        # browser would re-preflight every single poll.
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    # -- auth / body helpers ----------------------------------------------

    def _presented_token(self) -> str:
        auth = self.headers.get("Authorization", "")
        if auth[:7].lower() == "bearer ":
            return auth[7:].strip()
        return self.headers.get("X-EMS-Token", "")

    def _require_auth(self) -> bool:
        """True when the request may proceed, else answers 401 and returns False."""
        if _auth_ok(self.client_address[0], self._presented_token()):
            return True
        log.warning("[HEALTH] Refused %s %s from %s",
                    self.command, self.path, self.client_address[0])
        data = json.dumps({
            "error": "unauthorized",
            "hint": "set HEALTH_TOKEN and send Authorization: Bearer <token>",
        }, indent=2).encode()
        self.send_response(401)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("WWW-Authenticate", 'Bearer realm="ems"')
        self._send_cors()
        self.end_headers()
        self.wfile.write(data)
        return False

    def _read_body(self):
        """Request body as text, or None after answering 400/413."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError):
            length = -1
        if length < 0:
            self._send_json(400, {"error": "bad_content_length"})
            return None
        if length > _MAX_BODY_BYTES:
            self._send_json(413, {"error": "payload_too_large",
                                  "max_bytes": _MAX_BODY_BYTES})
            return None
        if not length:
            return ""
        return self.rfile.read(length).decode("utf-8", "replace")

    def _json_body(self):
        """Parsed JSON body, or None after answering 400/413."""
        body = self._read_body()
        if body is None:
            return None
        try:
            return json.loads(body) if body else {}
        except ValueError:
            self._send_json(400, {"error": "invalid_json"})
            return None

    # -- POST --------------------------------------------------------------

    def do_POST(self):
        """Every POST mutates something, so all of them pass the auth gate."""
        path = urlparse(self.path).path.rstrip("/") or "/"
        handler = {
            "/push/subscribe": self._post_push_subscribe,
            "/push/test": self._post_push_test,
            "/assistant": self._post_assistant,
            "/floorplan": self._post_floorplan,
        }.get(path)
        if handler is None:
            self._send_json(404, {"error": "not found"})
            return
        if not self._require_auth():
            return
        handler()

    def _post_push_subscribe(self):
        import ems_simulator.push as push
        sub = self._json_body()
        if sub is None:
            return
        if not isinstance(sub, dict) or not sub.get("endpoint"):
            self._send_json(400, {"error": "invalid_subscription"})
            return
        try:
            count = push.add_subscription(sub)
        except Exception as e:
            log.warning("[HEALTH] POST /push/subscribe failed: %s", e)
            self._send_json(500, {"error": "subscribe_failed"})
            return
        self._send_json(200, {"ok": True, "count": count})

    def _post_push_test(self):
        import ems_simulator.push as push
        try:
            sent = push.send("EMS", "Test notification ✅", tag="ems-test")
        except Exception as e:
            log.warning("[HEALTH] POST /push/test failed: %s", e)
            self._send_json(500, {"error": "push_failed"})
            return
        self._send_json(200, {"sent": sent, "enabled": push.enabled()})

    def _post_assistant(self):
        import ems_simulator.assistant_llm as assistant_llm
        data = self._json_body()
        if data is None:
            return
        text = data.get("text", "") if isinstance(data, dict) else ""
        try:
            result = assistant_llm.classify(text)
        except Exception as e:
            log.warning("[HEALTH] POST /assistant failed: %s", e)
            self._send_json(502, {"error": "classify_failed"})
            return
        result["enabled"] = assistant_llm.enabled()
        self._send_json(200, result)

    def _post_floorplan(self):
        data = self._json_body()
        if data is None:
            return
        if not (isinstance(data, dict) and isinstance(data.get("rooms"), list)
                and isinstance(data.get("devices"), list)):
            self._send_json(400, {"error": "invalid_layout"})
            return
        try:
            os.makedirs(os.path.dirname(_FLOORPLAN_PATH), exist_ok=True)
            with open(_FLOORPLAN_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except Exception as e:
            # The detail stays in the log: it carries a server filesystem path.
            log.warning("[HEALTH] POST /floorplan failed: %s", e)
            self._send_json(500, {"error": "save_failed"})
            return
        self._send_json(200, {"saved": True})

    def do_GET(self):
        uptime = round(time.monotonic() - _started_at)
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path not in _OPEN_GET_PATHS and not self._require_auth():
            return
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
            days = _clamp_days(parse_qs(parsed.query).get("days", ["7"])[0])
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
            self._send_json(404, {
                "error": "not found",
                "open": sorted(_OPEN_GET_PATHS),
                "token_required": ["/metrics", "/events", "/advisor", "/floorplan",
                                   "/backtest?days=N",
                                   "/test-alarm?type=smoke|co|leak",
                                   "/assistant (POST)", "/floorplan (POST)",
                                   "/push/subscribe (POST)", "/push/test (POST)"],
            })


class _Server(threading.Thread):
    def __init__(self):
        super().__init__(name="health-http", daemon=True)
        # Threading server so a slow /backtest does not block /health and /metrics.
        self._httpd = ThreadingHTTPServer(("0.0.0.0", HEALTH_PORT), _Handler)

    def run(self):
        log.info("[HEALTH] Listening on port %d  (GET /health  /metrics  /backtest)", HEALTH_PORT)
        if _TOKEN:
            log.info("[HEALTH] Token auth active on every endpoint except "
                     "/health and /push/key")
        else:
            log.warning("[HEALTH] HEALTH_TOKEN not set — every endpoint except /health "
                        "and /push/key answers loopback requests only, so HA's REST "
                        "sensor and a proxied dashboard will get 401")
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
