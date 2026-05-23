from ems_simulator.config import SOC_DELTA_DENOM

def delta(balance_w, force_charge):
    if force_charge == 1:
        return 5000.0 / SOC_DELTA_DENOM
    return balance_w / SOC_DELTA_DENOM

def clamp(soc):
    return max(0.0, min(100.0, soc))
