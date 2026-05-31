"""Q-table RL agent for EMS battery control.

Enable with environment variable:  EMS_RL_ENABLED=1
The Q-table is persisted to rl/qtable.npy and loaded on startup so learning
accumulates across restarts.

State space:  (soc_bin, hour_bin, price_bin, pv_bin) → 10×24×5×4 = 4 800 states
Action space: 3 actions  (0 = auto, 1 = force_charge, 2 = force_discharge)
Algorithm:    tabular ε-greedy Q-learning (online, one-step)
"""
import logging
from pathlib import Path

import numpy as np

from rl.state import HOUR_BINS, N_ACTIONS, PRICE_BINS, PV_BINS, SOC_BINS, compute_reward, encode

log = logging.getLogger(__name__)

_QTABLE_PATH = Path("rl/qtable.npy")

_ALPHA    = 0.10     # learning rate
_GAMMA    = 0.95     # discount factor
_EPS_INIT = 0.80     # initial exploration probability
_EPS_MIN  = 0.05     # floor for exploration
_EPS_DECAY = 0.9998  # per-tick multiplicative decay


class QLearningAgent:
    """Online Q-learning agent that recommends a battery control action each tick."""

    def __init__(self) -> None:
        self._q = np.zeros(
            (SOC_BINS, HOUR_BINS, PRICE_BINS, PV_BINS, N_ACTIONS), dtype=np.float32
        )
        self._eps        = _EPS_INIT
        self._total_ticks = 0
        self._last_state: tuple[int, int, int, int] | None = None
        self._last_action: int = 0
        self._load()

    # ── persistence ───────────────────────────────────────────────────────────

    def _load(self) -> None:
        if _QTABLE_PATH.exists():
            try:
                data = np.load(_QTABLE_PATH)
                if data.shape == self._q.shape:
                    self._q = data
                    log.info("[RL] Q-table loaded from %s", _QTABLE_PATH)
                else:
                    log.warning("[RL] Q-table shape mismatch — starting fresh")
            except Exception as e:
                log.warning("[RL] Failed to load Q-table: %s", e)

    def save(self) -> None:
        try:
            _QTABLE_PATH.parent.mkdir(parents=True, exist_ok=True)
            np.save(_QTABLE_PATH, self._q)
            log.info("[RL] Q-table saved (%d ticks, ε=%.3f)", self._total_ticks, self._eps)
        except Exception as e:
            log.warning("[RL] Failed to save Q-table: %s", e)

    # ── inference ─────────────────────────────────────────────────────────────

    def act(self, soc: float, hour: float, price: float, pv: float) -> int:
        """Return action index for the current state (ε-greedy)."""
        state = encode(soc, hour, price, pv)
        if np.random.random() < self._eps:
            action = int(np.random.randint(N_ACTIONS))
        else:
            action = int(np.argmax(self._q[state]))
        self._last_state  = state
        self._last_action = action
        return action

    # ── learning ──────────────────────────────────────────────────────────────

    def update(
        self,
        next_soc: float, next_hour: float, next_price: float, next_pv: float,
        cost_pln: float, is_blackout: bool,
    ) -> None:
        """One-step Q-update after observing the outcome of the last action."""
        if self._last_state is None:
            return
        r          = compute_reward(cost_pln, next_soc, is_blackout)
        next_state = encode(next_soc, next_hour, next_price, next_pv)
        s, a       = self._last_state, self._last_action
        q_next     = float(np.max(self._q[next_state]))
        self._q[s][a] += _ALPHA * (r + _GAMMA * q_next - self._q[s][a])
        self._eps       = max(_EPS_MIN, self._eps * _EPS_DECAY)
        self._total_ticks += 1

    # ── diagnostics ───────────────────────────────────────────────────────────

    @property
    def epsilon(self) -> float:
        return self._eps

    @property
    def ticks(self) -> int:
        return self._total_ticks
