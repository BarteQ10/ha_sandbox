"""Simulated media player — tracks playback state, dims lights when playing."""
import logging
import random

log = logging.getLogger(__name__)

_PLAYING_BRIGHTNESS = 25.0   # override lighting to 25% when media is playing
_P_START_EVENING    = 0.008  # probability per tick of starting in evening hours
_P_START_OTHER      = 0.002  # probability per tick at other times


class MediaPlayerSim:
    """Simulates a TV / streaming player that affects room lighting."""

    def __init__(self) -> None:
        self._state = "idle"  # "idle" | "playing" | "paused"
        self._ticks = 0

    def tick(self, hour: float, presence_mode: int) -> tuple[str, float | None]:
        """Advance one tick.  Returns (state, brightness_override_or_None)."""
        from ems_simulator.presence import PRESENCE_HOME

        if presence_mode != PRESENCE_HOME:
            if self._state != "idle":
                log.info("[MEDIA] Stopped — nobody home")
                self._state = "idle"
                self._ticks = 0
            return "idle", None

        if self._state == "playing":
            self._ticks -= 1
            if self._ticks <= 0:
                self._state = "idle"
                log.info("[MEDIA] Playback ended")
                return "idle", None
            if random.random() < 0.004:   # ~0.4% per tick → occasional pause
                self._state = "paused"
                self._ticks = random.randint(1, 8)
                log.info("[MEDIA] Paused")
            return self._state, _PLAYING_BRIGHTNESS if self._state == "playing" else None

        if self._state == "paused":
            self._ticks -= 1
            if self._ticks <= 0:
                self._state = "playing"
                self._ticks = random.randint(12, 48)
                log.info("[MEDIA] Resumed")
            return self._state, None   # paused → normal brightness

        # Idle — chance of starting playback
        is_evening = 17.0 <= hour < 23.0
        if random.random() < (_P_START_EVENING if is_evening else _P_START_OTHER):
            self._state = "playing"
            self._ticks = random.randint(24, 120)
            log.info("[MEDIA] Playback started (~%d sim-min)", self._ticks * 5)

        return self._state, None

    @property
    def state(self) -> str:
        return self._state

    @property
    def brightness_override(self) -> float | None:
        return _PLAYING_BRIGHTNESS if self._state == "playing" else None
