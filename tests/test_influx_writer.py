"""Tests for the injection-safety regexes guarding read_events() Flux queries.

These are pure pattern checks — no InfluxDB connection needed.
"""
from ems_simulator.influx_writer import _FLUX_RANGE, _SAFE_TAG


def test_flux_range_accepts_relative_durations():
    for v in ["-7d", "-1h", "-30m", "-15s", "-2w", "-90d"]:
        assert _FLUX_RANGE.match(v), v


def test_flux_range_accepts_rfc3339_utc():
    for v in ["2026-05-31T00:00:00Z", "2026-01-01T23:59:59.123Z"]:
        assert _FLUX_RANGE.match(v), v


def test_flux_range_rejects_injection_and_junk():
    bad = [
        "-7d) |> drop()",          # flux injection attempt
        "2026-05-31",              # date without time → not RFC3339 here
        "now()",
        "; malicious",
        "",
        "7d",                      # missing leading minus
        "2026/05/31T00:00:00Z",    # wrong separators
    ]
    for v in bad:
        assert not _FLUX_RANGE.match(v), v


def test_safe_tag_accepts_categories():
    for v in ["anomaly", "rule", "security", "energy", "media", "grid"]:
        assert _SAFE_TAG.match(v), v


def test_safe_tag_rejects_injection():
    for v in ['grid" or "1"=="1', "grid;", "Grid", "grid1", "", "a b"]:
        assert not _SAFE_TAG.match(v), v
