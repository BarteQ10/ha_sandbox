from ems_simulator.config import SOC_DELTA_DENOM, INVERTER_EFFICIENCY

# Force mode constants shared with HA
MODE_AUTO = 0
MODE_FORCE_CHARGE = 1
MODE_FORCE_DISCHARGE = 2
FORCE_RATE_W = 5000  # 5 kW charge/discharge

def delta(balance_w, force_mode):
    if force_mode == MODE_FORCE_CHARGE:
        return (FORCE_RATE_W * INVERTER_EFFICIENCY) / SOC_DELTA_DENOM
    if force_mode == MODE_FORCE_DISCHARGE:
        return -(FORCE_RATE_W / INVERTER_EFFICIENCY) / SOC_DELTA_DENOM
    if balance_w > 0:
        return (balance_w * INVERTER_EFFICIENCY) / SOC_DELTA_DENOM
    return (balance_w / INVERTER_EFFICIENCY) / SOC_DELTA_DENOM

def clamp(soc):
    return max(0.0, min(100.0, soc))
