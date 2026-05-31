"""Circadian lighting model — brightness and colour temperature by time of day."""
import logging

log = logging.getLogger(__name__)

CT_WARM_K = 2700.0
CT_COOL_K = 6500.0
_ROOMS = 4
_W_PER_ROOM = 10  # watts per room at 100% brightness


def _curve(hour: float) -> tuple[float, float]:
    """Return (brightness_pct 0-100, color_temp_K) for the given simulated hour."""
    if hour < 5.0:
        return 0.0, CT_WARM_K
    if hour < 8.0:
        t = (hour - 5.0) / 3.0
        return t * 40.0, CT_WARM_K + t * (CT_COOL_K - CT_WARM_K) * 0.4
    if hour < 12.0:
        t = (hour - 8.0) / 4.0
        return 40.0 + t * 60.0, CT_WARM_K + t * (CT_COOL_K - CT_WARM_K)
    if hour < 15.0:
        return 100.0, CT_COOL_K
    if hour < 19.0:
        t = (hour - 15.0) / 4.0
        return 100.0 - t * 30.0, CT_COOL_K - t * (CT_COOL_K - 5000.0)
    if hour < 23.0:
        t = (hour - 19.0) / 4.0
        return max(10.0, 70.0 - t * 60.0), max(CT_WARM_K, 5000.0 - t * (5000.0 - CT_WARM_K))
    return 5.0, CT_WARM_K


class CircadianModel:
    def __init__(self) -> None:
        self._brightness = 0.0
        self._color_temp = CT_WARM_K
        self._load_w = 0

    def tick(
        self,
        hour: float,
        presence_mode: int,
        media_override: float | None = None,
    ) -> None:
        """Advance one tick.

        media_override: if not None, brightness is set to this value (e.g. 25 % when
        a media player is active), overriding the circadian curve.
        """
        from ems_simulator.presence import PRESENCE_AWAY, PRESENCE_VACATION

        brightness, ct = _curve(hour)

        if presence_mode == PRESENCE_AWAY:
            brightness = 0.0
        elif presence_mode == PRESENCE_VACATION:
            slot = int(hour * 2)
            if 18.0 <= hour < 23.0:
                brightness = 25.0 + abs(hash(slot)) % 25
            elif hour >= 23.0 or hour < 1.0:
                brightness = float(abs(hash(slot + 100)) % 10)
            else:
                brightness = 0.0

        # Media player dims the lights when actively playing
        if media_override is not None and brightness > 0.0:
            brightness = min(brightness, media_override)

        self._brightness = round(brightness, 1)
        self._color_temp = round(ct)
        self._load_w = int(_ROOMS * _W_PER_ROOM * brightness / 100.0)

        if log.isEnabledFor(logging.DEBUG):
            log.debug("[LIGHT] %.0fh → brightness=%.1f%% CT=%.0fK load=%dW",
                      hour, self._brightness, self._color_temp, self._load_w)

    @property
    def brightness(self) -> float:
        return self._brightness

    @property
    def color_temp_k(self) -> float:
        return self._color_temp

    @property
    def load_w(self) -> int:
        return self._load_w
