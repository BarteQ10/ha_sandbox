import pytest

import ems_simulator.http_util as http_util


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_get_json_retries_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def fake_get(url, params=None, timeout=None):
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("boom")
        return _Resp({"ok": True})

    monkeypatch.setattr(http_util.requests, "get", fake_get)
    monkeypatch.setattr(http_util.time, "sleep", lambda s: None)  # no real waiting

    assert http_util.get_json("http://x", retries=3) == {"ok": True}
    assert calls["n"] == 3


def test_get_json_raises_after_exhausting_retries(monkeypatch):
    def always_fail(url, params=None, timeout=None):
        raise ConnectionError("down")

    monkeypatch.setattr(http_util.requests, "get", always_fail)
    monkeypatch.setattr(http_util.time, "sleep", lambda s: None)

    with pytest.raises(ConnectionError):
        http_util.get_json("http://x", retries=2)


def test_get_json_with_no_retries_raises_something_meaningful(monkeypatch):
    """retries<1 skips the loop entirely. The last exception was seeded with None,
    so this used to come out as `TypeError: exceptions must derive from
    BaseException` instead of saying what went wrong."""
    def never_called(url, params=None, timeout=None):
        raise AssertionError("requests.get must not be reached")

    monkeypatch.setattr(http_util.requests, "get", never_called)

    with pytest.raises(RuntimeError, match="no attempt made"):
        http_util.get_json("http://x", retries=0)
