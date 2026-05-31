import ems_simulator.events as events


def setup_function():
    events.clear()


def test_record_appends():
    events.record("anomaly", "warning", "test")
    snap = events.snapshot()
    assert len(snap) == 1
    assert snap[0]["category"] == "anomaly"
    assert snap[0]["message"] == "test"
    assert snap[0]["severity"] == "warning"


def test_snapshot_newest_first():
    events.record("rule", "info", "first")
    events.record("rule", "info", "second")
    snap = events.snapshot()
    assert snap[0]["message"] == "second"
    assert snap[1]["message"] == "first"


def test_record_edge_only_on_rising_edge():
    events.record_edge("k", "rule", "info", "fired", condition=False)  # no event
    assert len(events.snapshot()) == 0
    events.record_edge("k", "rule", "info", "fired", condition=True)   # rising
    assert len(events.snapshot()) == 1
    events.record_edge("k", "rule", "info", "fired", condition=True)   # sustained
    assert len(events.snapshot()) == 1


def test_record_edge_refires_after_reset():
    events.record_edge("k", "grid", "critical", "blackout", True)   # fire
    events.record_edge("k", "grid", "critical", "blackout", False)  # clear
    events.record_edge("k", "grid", "critical", "blackout", True)   # fire again
    assert len(events.snapshot()) == 2


def test_snapshot_category_filter():
    events.record("anomaly", "warning", "a")
    events.record("media", "info", "m")
    assert len(events.snapshot(category="anomaly")) == 1
    assert events.snapshot(category="anomaly")[0]["message"] == "a"
    assert len(events.snapshot(category="all")) == 2


def test_snapshot_limit():
    for i in range(10):
        events.record("rule", "info", f"e{i}")
    assert len(events.snapshot(limit=3)) == 3
    # newest first → last recorded
    assert events.snapshot(limit=3)[0]["message"] == "e9"


def test_snapshot_since_filter():
    import time
    events.record("rule", "info", "old")
    cutoff = time.time()
    time.sleep(0.01)
    events.record("rule", "info", "new")
    snap = events.snapshot(since=cutoff)
    assert len(snap) == 1
    assert snap[0]["message"] == "new"


def test_ring_buffer_caps_at_max():
    for i in range(events.MAX_EVENTS + 50):
        events.record("rule", "info", f"e{i}")
    assert len(events.snapshot(limit=events.MAX_EVENTS)) == events.MAX_EVENTS


def test_stats_counts_by_category():
    events.record("anomaly", "warning", "a")
    events.record("anomaly", "warning", "b")
    events.record("grid", "critical", "c")
    s = events.stats()
    assert s["total"] == 3
    assert s["by_category"]["anomaly"] == 2
    assert s["by_category"]["grid"] == 1
    assert s["by_category"]["media"] == 0


def test_ids_are_monotonic():
    events.record("rule", "info", "a")
    events.record("rule", "info", "b")
    snap = events.snapshot()
    assert snap[0]["id"] > snap[1]["id"]
