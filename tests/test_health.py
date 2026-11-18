"""Health-server HTTP surface: the auth gate, body limits and status codes.

POST /push/subscribe, POST /push/test, POST /assistant, POST /floorplan,
GET /backtest and GET /test-alarm change state, spend the owner's push/LLM
quota or burn CPU. They used to answer anything that could reach the port,
which behind the nginx/tailnet proxy is every device on the tailnet.

The tests drive the real _Handler over a loopback socket, so the status codes
and headers they assert are the ones a client actually gets.
"""
import json
import socket
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit

import pytest

import ems_simulator.health as health

TOKEN = "s3cret-token"
LAYOUT: dict = {"rooms": [], "devices": []}

# Everything that must not be reachable without a credential: the writes, the
# expensive replay, and the reads that give away whether anyone is home.
GUARDED = [
    ("POST", "/push/subscribe"),
    ("POST", "/push/test"),
    ("POST", "/assistant"),
    ("POST", "/floorplan"),
    ("GET", "/backtest"),
    ("GET", "/test-alarm?type=smoke"),
    ("GET", "/metrics"),
    ("GET", "/events"),
    ("GET", "/advisor"),
    ("GET", "/floorplan"),
]


@pytest.fixture
def server():
    """The real handler on an ephemeral loopback port; yields the base URL."""
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), health._Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


@pytest.fixture(autouse=True)
def _tmp_floorplan(monkeypatch, tmp_path):
    """Never let a test write to the real /data path."""
    monkeypatch.setattr(health, "_FLOORPLAN_PATH", str(tmp_path / "floorplan.json"))


def _call(url, *, method="GET", body=None, token=None, header=None):
    """Make a request and return (status_code, parsed_body)."""
    data = body.encode() if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if header:
        req.add_header(*header)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {}


# ── the auth decision itself ──────────────────────────────────────────────────

def test_without_a_token_only_loopback_is_allowed(monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", "")
    assert health._auth_ok("127.0.0.1", "") is True
    assert health._auth_ok("::1", "") is True
    assert health._auth_ok("172.18.0.5", "") is False    # the nginx container
    assert health._auth_ok("100.64.0.7", "") is False    # a tailnet peer
    assert health._auth_ok("192.168.0.42", "") is False  # anything on the LAN


def test_with_a_token_the_peer_address_is_no_longer_a_free_pass(monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    assert health._auth_ok("127.0.0.1", "") is False
    assert health._auth_ok("127.0.0.1", "wrong") is False
    assert health._auth_ok("127.0.0.1", TOKEN[:-1]) is False
    assert health._auth_ok("100.64.0.7", TOKEN) is True


@pytest.mark.parametrize("raw,expected", [
    ("7", 7), ("1", 1), ("30", 30),
    ("0", 1), ("-5", 1),            # clamped up
    ("9999", 90), ("1e9", 7),       # clamped down / unparseable
    ("abc", 7), ("", 7), (None, 7),
])
def test_backtest_days_are_parsed_and_clamped(raw, expected):
    assert health._clamp_days(raw) == expected


# ── over HTTP ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path", GUARDED)
def test_guarded_endpoints_refuse_a_request_with_no_token(server, monkeypatch, method, path):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, body = _call(f"{server}{path}", method=method,
                       body=json.dumps(LAYOUT) if method == "POST" else None)
    assert code == 401
    assert body["error"] == "unauthorized"


@pytest.mark.parametrize("method,path", GUARDED)
def test_guarded_endpoints_refuse_a_wrong_token(server, monkeypatch, method, path):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, _ = _call(f"{server}{path}", method=method, token="not-the-token",
                    body=json.dumps(LAYOUT) if method == "POST" else None)
    assert code == 401


def test_health_stays_open_so_the_container_probe_keeps_working(server, monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, body = _call(f"{server}/health")
    assert code != 401
    assert "status" in body


def test_push_key_stays_open(server, monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, body = _call(f"{server}/push/key")
    assert code == 200
    assert "publicKey" in body


@pytest.mark.parametrize("path", ["/metrics", "/events", "/advisor"])
def test_the_reads_still_work_once_the_token_is_presented(server, monkeypatch, path):
    """Closing them must not break them for the dashboard and HA's REST sensor."""
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, _ = _call(f"{server}{path}", token=TOKEN)
    assert code == 200


def test_reading_the_floorplan_is_authorized_even_when_none_is_saved(server, monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, body = _call(f"{server}/floorplan", token=TOKEN)
    assert (code, body["error"]) == (404, "no_layout")   # past the gate, just no layout


def test_an_unknown_get_path_needs_the_token_too(server, monkeypatch):
    """The GET gate is an allow-list, so a path added later is guarded by default."""
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    assert _call(f"{server}/nope")[0] == 401
    assert _call(f"{server}/nope", token=TOKEN)[0] == 404


def test_the_right_token_is_accepted(server, monkeypatch, tmp_path):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, body = _call(f"{server}/floorplan", method="POST",
                       body=json.dumps(LAYOUT), token=TOKEN)
    assert (code, body) == (200, {"saved": True})
    assert json.loads((tmp_path / "floorplan.json").read_text(encoding="utf-8")) == LAYOUT


def test_the_token_may_also_arrive_as_x_ems_token(server, monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, _ = _call(f"{server}/floorplan", method="POST", body=json.dumps(LAYOUT),
                    header=("X-EMS-Token", TOKEN))
    assert code == 200


def test_loopback_still_works_with_no_token_configured(server, monkeypatch):
    """A plain `python run.py` + Vite dev setup must need no configuration."""
    monkeypatch.setattr(health, "_TOKEN", "")
    code, _ = _call(f"{server}/floorplan", method="POST", body=json.dumps(LAYOUT))
    assert code == 200


# ── body handling and status codes ────────────────────────────────────────────

def test_a_bogus_content_length_is_refused_unread(server, monkeypatch):
    """Content-Length is attacker-controlled, so the cap must apply before the read."""
    monkeypatch.setattr(health, "_TOKEN", "")
    url = urlsplit(server)
    with socket.create_connection((url.hostname, url.port), timeout=10) as s:
        s.sendall(
            b"POST /floorplan HTTP/1.0\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: 99999999\r\n"
            b"\r\n"
            b"{}"                      # nowhere near the declared length
        )
        chunks = []
        while True:                    # HTTP/1.0: read until the server closes
            chunk = s.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
        raw = b"".join(chunks).decode()
    assert "413" in raw.splitlines()[0]
    assert "payload_too_large" in raw


# A companion test that sent a genuinely oversized body over urllib used to live
# here. It was racy by construction: the server refuses on the declared length
# without ever draining the socket, so whether the client manages to read the 413
# before the connection resets depends on buffer sizes. It also tested nothing
# extra — an oversized real body takes the identical code path as the bogus
# length above, since neither is ever read. The deterministic test stays.


def test_malformed_json_is_a_400(server, monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", "")
    code, body = _call(f"{server}/floorplan", method="POST", body="{not json")
    assert (code, body["error"]) == (400, "invalid_json")


def test_a_layout_without_rooms_and_devices_is_a_400(server, monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", "")
    code, body = _call(f"{server}/floorplan", method="POST",
                       body=json.dumps({"rooms": "not a list"}))
    assert (code, body["error"]) == (400, "invalid_layout")


def test_a_subscription_without_an_endpoint_is_a_400(server, monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", "")
    code, body = _call(f"{server}/push/subscribe", method="POST", body=json.dumps({"a": 1}))
    assert (code, body["error"]) == (400, "invalid_subscription")


def test_a_save_failure_is_not_reported_as_success(server, monkeypatch, tmp_path):
    """POST /floorplan used to answer 200 with the server path in the body."""
    monkeypatch.setattr(health, "_TOKEN", "")
    monkeypatch.setattr(health, "_FLOORPLAN_PATH", str(tmp_path / "nope" / "x.json"))

    def _boom(*a, **k):
        raise OSError("read-only file system")

    monkeypatch.setattr(health.os, "makedirs", _boom)

    code, body = _call(f"{server}/floorplan", method="POST", body=json.dumps(LAYOUT))

    assert (code, body["error"]) == (500, "save_failed")
    assert "detail" not in body          # no server path handed to the client


def test_an_unknown_post_path_is_a_404(server, monkeypatch):
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    code, _ = _call(f"{server}/nope", method="POST", body="{}")
    assert code == 404


def test_the_preflight_allows_the_auth_header_and_is_cacheable(server, monkeypatch):
    """Without the allowed header the browser would never send Authorization
    cross-origin; without Max-Age it would re-preflight every /metrics poll."""
    monkeypatch.setattr(health, "_TOKEN", TOKEN)
    req = urllib.request.Request(f"{server}/floorplan", method="OPTIONS")
    req.add_header("Origin", "http://localhost:5173")
    with urllib.request.urlopen(req, timeout=10) as res:
        headers = res.headers
    assert "Authorization" in headers.get("Access-Control-Allow-Headers", "")
    assert int(headers.get("Access-Control-Max-Age", "0")) > 0
