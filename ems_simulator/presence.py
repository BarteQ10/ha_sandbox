"""Presence zone simulation — tracks home/away/vacation state."""
import logging

log = logging.getLogger(__name__)

PRESENCE_HOME     = 0
PRESENCE_AWAY     = 1
PRESENCE_VACATION = 2

_LABELS = {
    PRESENCE_HOME:     "home",
    PRESENCE_AWAY:     "away",
    PRESENCE_VACATION: "vacation",
}

# Base-load multipliers when occupancy changes
_LOAD_MULTIPLIERS = {
    PRESENCE_HOME:     1.0,
    PRESENCE_AWAY:     0.35,   # standby-only: no cooking, activity, etc.
    PRESENCE_VACATION: 0.15,   # fridge + security baseline
}


class PresenceManager:
    def __init__(self) -> None:
        self._mode = PRESENCE_HOME

    def update(self, mode: int) -> None:
        if mode not in _LABELS:
            mode = PRESENCE_HOME
        if mode != self._mode:
            log.info("[PRESENCE] %s → %s", _LABELS[self._mode], _LABELS[mode])
            self._mode = mode

    @property
    def mode(self) -> int:
        return self._mode

    @property
    def label(self) -> str:
        return _LABELS.get(self._mode, "home")

    def load_multiplier(self) -> float:
        return _LOAD_MULTIPLIERS.get(self._mode, 1.0)
