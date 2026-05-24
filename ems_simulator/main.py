import time
import random as _random
import datetime

from ems_simulator.config import TICK_S, GRID_NORMAL, GRID_BLACKOUT
from ems_simulator.weather import fetch as w_fetch, get as w_get, needs_refresh as w_needs_refresh
from ems_simulator.pricing import fetch as p_fetch, get as p_get, max_today as p_max_today, needs_refresh as p_needs_refresh, fallback_price as p_fallback, _price_cache as p_cache
from ems_simulator.generators import pv_from_ghi, base_load, SpikeState, controllable_load
from ems_simulator.charge_scheduler import compute_charge_window
from ems_simulator.battery import delta as batt_delta, clamp as batt_clamp, MODE_AUTO, MODE_FORCE_CHARGE, MODE_FORCE_DISCHARGE
from ems_simulator.server import start as srv_start, stop as srv_stop, read as srv_read, write as srv_write, banner as srv_banner
from ems_simulator.influx_writer import start as inf_start, write as inf_write, stop as inf_stop, read_last as inf_read_last


def main():
    _random.seed()
    srv_banner()
    srv_start()
    inf_start()
    w_fetch()
    p_fetch()

    now_h = datetime.datetime.now().hour
    day_step = int(now_h * 12)
    current_temp = 15.0
    spike = SpikeState()

    running_cost_pln = 0.0
    cost_from_db = inf_read_last("sensor.ems_koszt_kumulatywny_dzis")
    if cost_from_db is not None:
        running_cost_pln = float(cost_from_db)
        print(f"[STATE] Restored running cost: {running_cost_pln:.2f} PLN from InfluxDB")

    chg_start = None
    chg_duration = 0
    chg_pv_kwh = 0.0
    _last_chg_compute_h = -1
    _anomaly_prev = 0

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
            curtail   = regs[10] if len(regs) > 10 else 0
            grid_status = regs[14] if len(regs) > 14 else 0
            anomaly = regs[15] if len(regs) > 15 else 0

            day_step = (day_step + 1) % 288
            if day_step == 0:
                running_cost_pln = 0.0
            hour = day_step / 12.0

            if anomaly:
                ghi, temp, cloud = None, current_temp, 0
                rce = None
                if day_step % 60 == 0:
                    print(f"[ANOMALY] API failure simulation active")
            else:
                if w_needs_refresh(hour, day_step):
                    w_fetch()
                if p_needs_refresh(hour, day_step):
                    p_fetch()

                ghi, temp, cloud = w_get(hour)
                if ghi is not None:
                    current_temp = temp

                rce = p_get(hour)

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

            if curtail == 1 and pv > load:
                old_pv = pv
                pv = int(load)
                print(f"[CURTAIL] PV {old_pv}W -> {pv}W (zero-export)")

            price = int(rce) if rce is not None else p_fallback(hour)
            peak_today = int(round(p_max_today()))

            if not anomaly and _anomaly_prev:
                _last_chg_compute_h = -1
                print(f"[ANOMALY] API restored — scheduler re-enabled")

            if not anomaly and day_step % 12 == 0 and day_step != _last_chg_compute_h:
                _last_chg_compute_h = day_step
                chg_start, chg_duration, chg_energy, chg_pv_kwh = compute_charge_window(
                    hour, soc, p_cache
                )
                print(f"[CHG] Window: start={chg_start}h  dur={chg_duration}h  "
                      f"need={chg_energy}kWh  PVtom={chg_pv_kwh}kWh")
            elif anomaly and day_step % 60 == 0:
                print(f"[ANOMALY] Charge scheduler paused (no API data)")

            balance = pv - load

            # Island mode: load shed on critical SoC
            if grid_status == GRID_BLACKOUT and soc <= 5 and balance < 0:
                if boiler > 0:
                    print(f"[ISLAND] Shed boiler (SoC={soc:.0f}%)")
                    load -= 3000
                    boiler = 0
                if ev > 0:
                    print(f"[ISLAND] Shed EV {ev}W (SoC={soc:.0f}%)")
                    load -= ev
                    ev = 0
                if hp > 0:
                    hp_save = {1: 1500, 2: 3000}.get(hp, 0)
                    print(f"[ISLAND] Shed HP {hp_save}W (SoC={soc:.0f}%)")
                    load -= hp_save
                    hp = 0
                balance = pv - load
                if balance < 0:
                    print(f"[ISLAND] After shed: still deficit {balance:.0f}W")

            dt_h = TICK_S * 60.0 / 3600.0
            if grid_status == GRID_BLACKOUT:
                pass  # no grid → no financial tracking
            else:
                running_cost_pln += -balance * price * dt_h / (100.0 * 1000.0)

            actual_force = force
            if grid_status == GRID_BLACKOUT and force == MODE_FORCE_CHARGE:
                actual_force = MODE_AUTO

            delta = batt_delta(balance, actual_force)
            new_soc = batt_clamp(soc + delta)

            if day_step % 60 == 0:
                tag = "[ISLAND]" if grid_status == GRID_BLACKOUT else "[PEAK]"
                print(f"{tag} Peak today: {peak_today} gr/kWh, "
                      f"Current: {price} gr/kWh, Cost: {running_cost_pln:.2f} PLN")

            if grid_status == GRID_BLACKOUT and force == MODE_FORCE_CHARGE:
                print(f"[ISLAND] Force Charge ignored (no grid), running in Auto")
            elif force == MODE_FORCE_CHARGE:
                print(f"[FORCE]  Charging  {soc:.0f} -> {new_soc:.0f}%")
            elif force == MODE_FORCE_DISCHARGE:
                print(f"[FORCE]  Discharging  {soc:.0f} -> {new_soc:.0f}%")
            elif balance > 200 and new_soc > soc:
                print(f"[PV]     Surplus +{balance:+.0f}W  SoC {soc:.0f} -> {new_soc:.0f}%")
            elif balance > 0 and new_soc >= 100:
                print(f"[GRID]   Battery full, exporting {balance:.0f}W")
            elif balance < -200 and new_soc < soc:
                print(f"[BAT]    Deficit {balance:+.0f}W  SoC {soc:.0f} -> {new_soc:.0f}%")
            elif new_soc <= 0:
                label = "BLACKOUT" if grid_status == GRID_BLACKOUT else "GRID"
                print(f"[{label}] Battery empty, load shed {-balance:.0f}W")

            cost_int = int(round(running_cost_pln * 100))

            srv_write([
                int(pv),
                int(round(new_soc)),
                force,
                boiler,
                hp,
                ev,
                int(load),
                price,
                peak_today,
                cost_int,
                curtail,
                chg_start if chg_start is not None else 24,
                int(round(chg_duration * 10)),
                int(round(chg_pv_kwh * 10)),
                grid_status,
                anomaly,
            ])

            inf_write(pv, round(new_soc), load, price, balance, current_temp, cloud, ghi,
                      peak_today, round(running_cost_pln, 2), curtail,
                      chg_start, chg_duration, chg_pv_kwh, grid_status, anomaly)

            _anomaly_prev = anomaly
            time.sleep(TICK_S)

    except KeyboardInterrupt:
        inf_stop()
        srv_stop()
        print("\n[EMS] Stopped")


if __name__ == "__main__":
    main()
