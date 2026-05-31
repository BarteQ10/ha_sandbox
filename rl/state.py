"""State encoding and reward shaping for the EMS Q-learning agent."""
import numpy as np

# Bin counts for each state dimension
SOC_BINS   = 10   # 0-10%, 10-20%, …, 90-100%
HOUR_BINS  = 24   # one per simulated hour
PRICE_BINS = 5    # relative cheapness bands
PV_BINS    = 4    # PV production level

# Total Q-table shape: (10, 24, 5, 4, 3) = 14 400 cells
N_ACTIONS = 3     # 0 = auto, 1 = force charge, 2 = force discharge

# Price edges (gr/kWh) — band thresholds
_PRICE_EDGES = [0.0, 20.0, 35.0, 55.0, 75.0, 300.0]

# PV production edges (W)
_PV_EDGES = [0.0, 200.0, 1000.0, 3000.0, 6000.0]


def encode(soc: float, hour: float, price: float, pv: float) -> tuple[int, int, int, int]:
    """Map continuous state to discrete indices (all zero-based, clamped)."""
    soc_bin   = min(int(soc / 10.0), SOC_BINS - 1)
    hour_bin  = min(int(hour), HOUR_BINS - 1)
    price_bin = int(np.searchsorted(_PRICE_EDGES, price, side="right")) - 1
    pv_bin    = int(np.searchsorted(_PV_EDGES,    pv,    side="right")) - 1
    return (
        max(0, min(soc_bin,   SOC_BINS   - 1)),
        max(0, min(hour_bin,  HOUR_BINS  - 1)),
        max(0, min(price_bin, PRICE_BINS - 1)),
        max(0, min(pv_bin,    PV_BINS    - 1)),
    )


def compute_reward(cost_pln: float, soc: float, is_blackout: bool) -> float:
    """Scalar reward for one tick.

    Negative cost is the primary signal.  SoC extremes and blackout add penalties
    so the agent learns to keep the battery healthy.
    """
    r = -cost_pln * 100.0          # convert PLN → gr for a larger gradient signal
    if soc < 15.0:
        r -= (15.0 - soc) * 0.30  # drain penalty (escalating)
    if soc > 95.0:
        r -= (soc - 95.0) * 0.05  # overcharge penalty (mild)
    if is_blackout and soc < 5.0:
        r -= 5.0                   # blackout with empty battery is very bad
    return float(r)
