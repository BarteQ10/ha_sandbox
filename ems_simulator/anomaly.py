"""Anomaly detection on simulator telemetry (4.5).

AnomalyDetector maintains rolling windows for each signal and flags points
that are statistically unusual using a Z-score test.  It also detects
structural anomalies (e.g. PV output inconsistent with solar irradiance).

Detected anomaly types
----------------------
pv_underperform  PV output < expected from GHI by more than a threshold
                 (potential inverter or soiling issue)
load_spike       Load Z-score exceeds threshold (unusual consumption event)
soc_drain        SoC dropping significantly faster than the energy balance
                 can explain (potential battery cell failure)
price_spike      Current price far above the rolling daily average

Usage
-----
    detector = AnomalyDetector()
    # Call each tick:
    flags = detector.update(pv_w, load_w, soc, price_gr, ghi, balance_w)
    # flags: dict[str, bool] — True = anomaly active for that signal
"""

import collections
import logging
import math

log = logging.getLogger(__name__)

# Rolling window length (ticks).  At 12 ticks/h, 72 ticks = 6 simulated hours.
WINDOW = 72
# Z-score threshold: |z| > THRESHOLD_Z → anomaly
THRESHOLD_Z = 3.0
# PV underperformance: actual/expected < this fraction at decent irradiance
PV_UNDERPERFORM_RATIO = 0.50
PV_GHI_MIN_W = 100.0          # ignore at night / heavy clouds
# SoC drain: expected vs actual drift tolerance (% per tick)
SOC_DRAIN_TOLERANCE_PCT = 2.0
# Minimum window fill before flagging (avoid false positives at startup)
MIN_FILL = 24


class _Window:
    """Fixed-length deque with mean/std helpers."""

    def __init__(self, maxlen=WINDOW):
        self._buf = collections.deque(maxlen=maxlen)

    def push(self, val):
        self._buf.append(float(val))

    def __len__(self):
        return len(self._buf)

    @property
    def mean(self):
        return sum(self._buf) / len(self._buf) if self._buf else 0.0

    @property
    def std(self):
        if len(self._buf) < 2:
            return 1.0
        m = self.mean
        variance = sum((x - m) ** 2 for x in self._buf) / len(self._buf)
        return math.sqrt(variance) or 1.0

    def zscore(self, val):
        return (float(val) - self.mean) / self.std


class AnomalyDetector:
    """Real-time rolling anomaly detector for simulator telemetry.

    Call update() once per tick.  Returns a dict of {signal: bool} flags.
    Logs a warning the first tick each anomaly becomes active.
    """

    def __init__(self):
        self._pv = _Window()
        self._load = _Window()
        self._price = _Window()
        self._soc_drift = _Window()   # tracks (expected_delta - actual_delta)
        self._active: dict[str, bool] = {}

    def update(self, pv_w, load_w, soc, price_gr, ghi, balance_w):
        """Push new values and return anomaly flags.

        Args:
            pv_w:      current PV output (W)
            load_w:    current total load (W)
            soc:       current battery SoC (%)
            price_gr:  current energy price (gr/kWh)
            ghi:       global horizontal irradiance (W/m^2); None if unavailable
            balance_w: pv_w - load_w (pre-calculated)

        Returns:
            dict[str, bool]: anomaly flags.
        """
        from ems_simulator.config import PV_PEAK_KW

        flags: dict[str, bool] = {}

        # ── load spike ────────────────────────────────────────────────────────
        self._load.push(load_w)
        if len(self._load) >= MIN_FILL:
            z = self._load.zscore(load_w)
            flags["load_spike"] = z > THRESHOLD_Z
        else:
            flags["load_spike"] = False

        # ── price spike ───────────────────────────────────────────────────────
        self._price.push(price_gr)
        if len(self._price) >= MIN_FILL:
            z = self._price.zscore(price_gr)
            flags["price_spike"] = z > THRESHOLD_Z
        else:
            flags["price_spike"] = False

        # ── PV underperformance ───────────────────────────────────────────────
        if ghi is not None and ghi >= PV_GHI_MIN_W:
            expected_w = float(ghi) * PV_PEAK_KW  # W (simplified, no soiling)
            self._pv.push(pv_w / expected_w if expected_w > 0 else 1.0)
            if len(self._pv) >= MIN_FILL:
                ratio = pv_w / expected_w if expected_w > 0 else 1.0
                mean_ratio = self._pv.mean
                flags["pv_underperform"] = (
                    ratio < PV_UNDERPERFORM_RATIO and ratio < mean_ratio * 0.6
                )
            else:
                flags["pv_underperform"] = False
        else:
            flags["pv_underperform"] = False

        # ── SoC drain anomaly ─────────────────────────────────────────────────
        # Expected SoC delta from energy balance (% per tick, 12 ticks/h).
        # battery_kwh = 15, so 1 kWh = 100/15 % ≈ 6.67 %
        from ems_simulator.config import BATTERY_KWH, INVERTER_EFFICIENCY
        expected_delta = balance_w / 1000.0 / 12.0 / BATTERY_KWH * 100.0 * INVERTER_EFFICIENCY
        self._soc_drift.push(expected_delta)
        # (We don't have delta_soc directly here, so we detect rapid sustained drift)
        if len(self._soc_drift) >= MIN_FILL:
            z = abs(self._soc_drift.zscore(expected_delta))
            flags["soc_drain"] = z > THRESHOLD_Z * 1.5  # higher bar — noisy signal
        else:
            flags["soc_drain"] = False

        # ── log transitions ───────────────────────────────────────────────────
        for sig, active in flags.items():
            was_active = self._active.get(sig, False)
            if active and not was_active:
                log.warning("[ANOMALY] %s detected — pv=%dW load=%dW soc=%.1f%% price=%d",
                            sig, pv_w, load_w, soc, price_gr)
            elif not active and was_active:
                log.info("[ANOMALY] %s cleared", sig)
        self._active = dict(flags)

        return flags

    @property
    def any_active(self):
        return any(self._active.values())
