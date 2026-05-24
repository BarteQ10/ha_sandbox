from ems_simulator.config import SOC_DELTA_DENOM, INVERTER_EFFICIENCY

# Force mode constants shared with HA
MODE_AUTO = 0
MODE_FORCE_CHARGE = 1
MODE_FORCE_DISCHARGE = 2
FORCE_RATE_W = 5000  # 5 kW charge/discharge

def delta(balance_w, force_mode, aging_factor=1.0):
    denom = SOC_DELTA_DENOM * aging_factor
    if force_mode == MODE_FORCE_CHARGE:
        return (FORCE_RATE_W * INVERTER_EFFICIENCY) / denom
    if force_mode == MODE_FORCE_DISCHARGE:
        return -(FORCE_RATE_W / INVERTER_EFFICIENCY) / denom
    if balance_w > 0:
        return (balance_w * INVERTER_EFFICIENCY) / denom
    return (balance_w / INVERTER_EFFICIENCY) / denom

def clamp(soc):
    return max(0.0, min(100.0, soc))
