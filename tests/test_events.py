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


# ── persistence backends ──────────────────────────────────────────────────────

def test_sink_called_on_record():
    written: list = []
    events.set_backends(sink=written.append)
    events.record("grid", "critical", "blackout")
    assert len(written) == 1
    assert written[0]["message"] == "blackout"


def test_sink_failure_does_not_break_record():
    def bad_sink(_e):
        raise RuntimeError("influx down")
    events.set_backends(sink=bad_sink)
    events.record("grid", "critical", "blackout")  # must not raise
    assert len(events.snapshot()) == 1


def test_no_sink_is_fine():
    events.record("rule", "info", "x")  # no backends registered
    assert len(events.snapshot()) == 1


def test_seed_loads_history_newest_first():
    items = [
        {"id": 12, "ts": 200.0, "category": "grid", "severity": "critical", "message": "newer"},
        {"id": 11, "ts": 100.0, "category": "rule", "severity": "info", "message": "older"},
    ]
    events.seed(items)
    snap = events.snapshot()
    assert [e["message"] for e in snap] == ["newer", "older"]


def test_seed_advances_id_sequence():
    events.seed([{"id": 50, "ts": 1.0, "category": "rule", "severity": "info", "message": "h"}])
    events.record("rule", "info", "next")
    # new event id must be > seeded max (51)
    assert events.snapshot()[0]["id"] == 51


def test_seed_does_not_repersist():
    written: list = []
    events.set_backends(sink=written.append)
    events.seed([{"id": 1, "ts": 1.0, "category": "rule", "severity": "info", "message": "h"}])
    assert written == []  # seeding must not call the sink


def test_history_delegates_to_reader():
    events.set_backends(reader=lambda start, stop, cat, limit: [
        {"id": 1, "ts": 1.0, "category": cat or "all", "severity": "info", "message": f"{start}->{limit}"},
    ])
    out = events.history(start="-3d", limit=42)
    assert out[0]["message"] == "-3d->42"


def test_history_empty_without_reader():
    assert events.history() == []


def test_history_swallows_reader_errors():
    def bad_reader(*a):
        raise RuntimeError("query failed")
    events.set_backends(reader=bad_reader)
    assert events.history() == []
