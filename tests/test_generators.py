from ems_simulator.generators import hp_cop, DeviceTimer, controllable_load
from ems_simulator.config import EV_CHARGE_MAX_W, HP_COP_CURVE


def test_hp_cop_none_and_clamps():
    assert hp_cop(None) == 3.0
    assert hp_cop(-50) == HP_COP_CURVE[0][1]   # below curve -> first
    assert hp_cop(100) == HP_COP_CURVE[-1][1]  # above curve -> last


def test_hp_cop_exact_and_interpolated():
    assert hp_cop(5) == 3.5            # exact knot
    assert hp_cop(2.5) == 3.25         # halfway between (0,3.0) and (5,3.5)


def test_controllable_load_devices():
    assert controllable_load(1, 0, 0) == (3000, 0)
    assert controllable_load(0, 1, 0, 3.0) == (1500, 4500)
    assert controllable_load(0, 2, 0, 3.0) == (3000, 9000)


def test_controllable_load_ev_capped():
    total, _ = controllable_load(0, 0, 99999)
    assert total == EV_CHARGE_MAX_W


def test_device_timer_enforces_min_on_then_min_off():
    t = DeviceTimer(min_on_sim_min=10, min_off_sim_min=10)  # 2 ticks each
    assert t.constrain(1) == 1   # turn on
    assert t.constrain(0) == 1   # min-on not met -> stays on
    assert t.constrain(1) == 1   # sustain (decrement timer)
    assert t.constrain(1) == 1   # sustain (timer now elapsed)
    assert t.constrain(0) == 0   # allowed off
    assert t.constrain(1) == 0   # min-off not met -> stays off
