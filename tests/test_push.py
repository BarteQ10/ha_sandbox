import ems_simulator.push as push


def test_disabled_without_keys(monkeypatch):
    monkeypatch.setattr(push, "VAPID_PRIVATE", "")
    monkeypatch.setattr(push, "VAPID_PUBLIC", "")
    assert push.enabled() is False
    assert push.send("t", "b") == 0


def test_enabled_with_keys(monkeypatch):
    monkeypatch.setattr(push, "VAPID_PRIVATE", "priv")
    monkeypatch.setattr(push, "VAPID_PUBLIC", "pub")
    assert push.enabled() is True


def test_add_subscription_dedupes(monkeypatch, tmp_path):
    monkeypatch.setattr(push, "SUBS_PATH", str(tmp_path / "subs.json"))
    monkeypatch.setattr(push, "_subs", [])
    assert push.add_subscription({"endpoint": "https://a"}) == 1
    assert push.add_subscription({"endpoint": "https://a"}) == 1   # duplicate ignored
    assert push.add_subscription({"endpoint": "https://b"}) == 2
    assert push.add_subscription({"no": "endpoint"}) == 2          # invalid ignored


def test_add_subscription_caps_the_list(monkeypatch, tmp_path):
    """POST /push/subscribe is remotely reachable, so the list must stay bounded."""
    monkeypatch.setattr(push, "SUBS_PATH", str(tmp_path / "subs.json"))
    monkeypatch.setattr(push, "PUSH_MAX_SUBSCRIPTIONS", 3)
    monkeypatch.setattr(push, "_subs", [])
    for i in range(5):
        push.add_subscription({"endpoint": f"https://e{i}"})
    assert len(push._subs) == 3                                     # extras dropped
    assert push.add_subscription({"endpoint": "https://e0"}) == 3    # known ones still fine


def test_subscriptions_persist(monkeypatch, tmp_path):
    path = str(tmp_path / "subs.json")
    monkeypatch.setattr(push, "SUBS_PATH", path)
    monkeypatch.setattr(push, "_subs", [])
    push.add_subscription({"endpoint": "https://x"})
    monkeypatch.setattr(push, "_subs", [])
    push._load()
    assert push._subs == [{"endpoint": "https://x"}]


def test_send_noop_without_subscriptions(monkeypatch):
    monkeypatch.setattr(push, "VAPID_PRIVATE", "priv")
    monkeypatch.setattr(push, "VAPID_PUBLIC", "pub")
    monkeypatch.setattr(push, "_subs", [])
    assert push.send("t", "b") == 0
