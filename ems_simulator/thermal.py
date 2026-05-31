"""House thermal model (3.1): RC model tracking indoor air/mass temperature.

Physics:
    dT/dt = (Q_in - Q_loss) / C
    Q_loss = UA * (T_house - T_outside)   [W]
    Q_in   = hp_thermal_w                 [W]  (heat delivered by heat pump)

Typical values for a 150 m^2 well-insulated house:
    C  = 8 kWh/K  (= 28.8 MJ/K)  — thermal mass (concrete + furnishings)
    UA = 80 W/K                   — total heat-loss coefficient
    -> time constant tau = C/UA = 100 h (slow cool-down, realistic for passive house)

The model uses simulated time (each EMS tick = 5 simulated minutes at 60x speed).
"""

import logging
from ems_simulator.config import (
    HOUSE_THERMAL_MASS_KWH_PER_C,
    HOUSE_UA_W_PER_C,
    HOUSE_SETPOINT_C,
    HOUSE_DEAD_BAND_C,
    HOUSE_INITIAL_TEMP_C,
    TICK_S,
)

log = logging.getLogger(__name__)

# Each real tick = 5 s; simulation speed = 60x → 300 sim seconds per tick
_DT_SIM_S = TICK_S * 60
_C_JOULES_PER_K = HOUSE_THERMAL_MASS_KWH_PER_C * 3.6e6  # J/K


class ThermalModel:
    """RC thermal model for a single-zone house.

    Attributes:
        t_house: current indoor temperature (°C).
        hp_hours_on: cumulative simulated hours the HP ran (for stats).
    """

    def __init__(self):
        self.t_house: float = HOUSE_INITIAL_TEMP_C
        self.hp_hours_on: float = 0.0
        self._ua = HOUSE_UA_W_PER_C
        self._setpoint = HOUSE_SETPOINT_C
        self._dead_band = HOUSE_DEAD_BAND_C

    # ── main update ───────────────────────────────────────────────────────────

    def tick(self, t_outside, hp_thermal_w):
        """Advance thermal state by one simulation tick.

        Args:
            t_outside:    outdoor temperature (°C).  If None, house stays constant.
            hp_thermal_w: heat delivered by heat pump this tick (W).
                          Pass 0 when HP is off.

        Returns:
            Updated indoor temperature (°C).
        """
        if t_outside is None:
            # No weather data: keep house temperature frozen
            return self.t_house

        q_loss = self._ua * (self.t_house - t_outside)   # W (positive = heat leaving)
        q_net = float(hp_thermal_w) - q_loss              # W
        delta_t = q_net * _DT_SIM_S / _C_JOULES_PER_K    # °C per tick

        self.t_house += delta_t

        if hp_thermal_w > 0:
            self.hp_hours_on += _DT_SIM_S / 3600.0

        return self.t_house

    # ── thermostat logic ──────────────────────────────────────────────────────

    def wants_heat(self):
        """True when house is cold enough to request HP heating."""
        return self.t_house < self._setpoint - self._dead_band

    def wants_idle(self):
        """True when house is warm enough to stop HP heating."""
        return self.t_house >= self._setpoint + self._dead_band

    # ── diagnostics ───────────────────────────────────────────────────────────

    def log_status(self, t_outside):
        out = f"{t_outside:.1f}" if t_outside is not None else "N/A"
        log.info("[THERMAL] T_house=%.1f°C  T_outside=%s°C  UA=%.0fW/K  HP_h=%.1fh",
                 self.t_house, out, self._ua, self.hp_hours_on)
