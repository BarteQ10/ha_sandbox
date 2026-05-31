"""Security event simulation — motion detection while away from home."""
import logging
import random

log = logging.getLogger(__name__)

_P_OUTDOOR_DAY   = 0.012   # per tick: postman, neighbours, wildlife during day
_P_OUTDOOR_NIGHT = 0.003   # lower at night
_P_INDOOR_AWAY   = 0.0004  # rare indoor event when away (pet or intruder scenario)
_MIN_TICKS = 1
_MAX_TICKS = 3


class MotionSimulator:
    """Simulates PIR motion sensors — outdoor always active, indoor only when away."""

    def __init__(self) -> None:
        self._outdoor_remaining = 0
        self._indoor_remaining  = 0

    def tick(self, hour: float, presence_mode: int) -> dict[str, bool]:
        from ems_simulator.presence import PRESENCE_AWAY, PRESENCE_VACATION

        away    = presence_mode in (PRESENCE_AWAY, PRESENCE_VACATION)
        daytime = 7.0 <= hour < 22.0

        # Outdoor motion — possible regardless of occupancy
        if self._outdoor_remaining > 0:
            self._outdoor_remaining -= 1
            outdoor = True
        else:
            p = _P_OUTDOOR_DAY if daytime else _P_OUTDOOR_NIGHT
            if random.random() < p:
                self._outdoor_remaining = random.randint(_MIN_TICKS, _MAX_TICKS)
                outdoor = True
                if away:
                    log.info("[SECURITY] Outdoor motion detected (nobody home)")
            else:
                outdoor = False

        # Indoor motion — only simulated when away
        if not away:
            indoor = False
            self._indoor_remaining = 0
        elif self._indoor_remaining > 0:
            self._indoor_remaining -= 1
            indoor = True
        else:
            if random.random() < _P_INDOOR_AWAY:
                self._indoor_remaining = random.randint(_MIN_TICKS, _MAX_TICKS)
                indoor = True
                log.warning("[SECURITY] Indoor motion detected while nobody is home!")
            else:
                indoor = False

        return {"outdoor": outdoor, "indoor": indoor}
