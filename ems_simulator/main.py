import time
import random as _random

from ems_simulator.config import TICK_S
from ems_simulator.weather import fetch as w_fetch, get as w_get, needs_refresh as w_needs_refresh
from ems_simulator.pricing import fetch as p_fetch, get as p_get, needs_refresh as p_needs_refresh, fallback_price as p_fallback
from ems_simulator.generators import pv_from_ghi, base_load, SpikeState, controllable_load
from ems_simulator.battery import delta as batt_delta, clamp as batt_clamp
from ems_simulator.server import start as srv_start, stop as srv_stop, read as srv_read, write as srv_write, banner as srv_banner
from ems_simulator.influx_writer import start as inf_start, write as inf_write, stop as inf_stop


def main():
    _random.seed()
    srv_banner()
    srv_start()
    inf_start()
    w_fetch()
    p_fetch()

    day_step = 0
    current_temp = 15.0
    spike = SpikeState()

    try:
        while True:
            regs = srv_read()
            if not regs:
                time.sleep(TICK_S)
                continue

            soc       = regs[1]
            force     = regs[2]
            boiler    = regs[3]
            hp        = regs[4]
            ev        = regs[5]

            day_step = (day_step + 1) % 288
            hour = day_step / 12.0

            if w_needs_refresh(hour, day_step):
                w_fetch()
            if p_needs_refresh(hour, day_step):
                p_fetch()

            ghi, temp, cloud = w_get(hour)
            if ghi is not None:
                current_temp = temp

            pv = pv_from_ghi(ghi, hour)

            load = base_load(hour, current_temp)
            load += controllable_load(boiler, hp, ev)

            sp = spike.tick()
            if sp > 0:
                load += sp
            if spike.just_started:
                print(f"[SPIKE] +{sp}W for {spike.remaining + 1}tics")
            if spike.just_ended:
                print(f"[SPIKE] Ended")

            rce = p_get(hour)
            price = int(rce) if rce is not None else p_fallback(hour)

            balance = pv - load
            delta = batt_delta(balance, force)
            new_soc = batt_clamp(soc + delta)

            if force == 1:
                print(f"[FORCE]  Charging  {soc:.0f} -> {new_soc:.0f}%")
            elif balance > 200 and new_soc > soc:
                print(f"[PV]     Surplus +{balance:+.0f}W  SoC {soc:.0f} -> {new_soc:.0f}%")
            elif balance > 0 and new_soc >= 100:
                print(f"[GRID]   Battery full, exporting {balance:.0f}W")
            elif balance < -200 and new_soc < soc:
                print(f"[BAT]    Deficit {balance:+.0f}W  SoC {soc:.0f} -> {new_soc:.0f}%")
            elif new_soc <= 0:
                print(f"[GRID]   Battery empty, draw {-balance:.0f}W at {price}gr/kWh")

            srv_write([
                int(pv),
                int(round(new_soc)),
                force,
                boiler,
                hp,
                ev,
                int(load),
                price,
            ])

            inf_write(pv, round(new_soc), load, price, balance, current_temp, cloud, ghi)

            time.sleep(TICK_S)

    except KeyboardInterrupt:
        inf_stop()
        srv_stop()
        print("\n[EMS] Stopped")


if __name__ == "__main__":
    main()
