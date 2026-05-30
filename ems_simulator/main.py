import time
import random as _random
import datetime
import logging
import signal

from ems_simulator.config import TICK_S, GRID_NORMAL, GRID_BLACKOUT, STEPS_PER_HOUR, STEPS_PER_DAY
from ems_simulator.weather import fetch as w_fetch, get as w_get, needs_refresh as w_needs_refresh
from ems_simulator.pricing import fetch as p_fetch, get as p_get, max_today as p_max_today, needs_refresh as p_needs_refresh, fallback_price as p_fallback, distribution_rate as p_dist_rate, _price_cache as p_cache
from ems_simulator.generators import pv_from_ghi, base_load, SpikeState, controllable_load, DeviceTimer, SoilingState, hp_cop, EVProfile, make_scheduled_appliances
from ems_simulator.charge_scheduler import compute_charge_window
from ems_simulator.battery import delta as batt_delta, clamp as batt_clamp, MODE_AUTO, MODE_FORCE_CHARGE, MODE_FORCE_DISCHARGE
from ems_simulator.server import start as srv_start, stop as srv_stop, read as srv_read, write as srv_write, banner as srv_banner
from ems_simulator.influx_writer import start as inf_start, write as inf_write, stop as inf_stop, read_last as inf_read_last
from ems_simulator.log_setup import setup as _setup_logging

log = logging.getLogger(__name__)


def _handle_sigterm(signum, frame):
    # Raise KeyboardInterrupt so the main loop's existing handler runs the same
    # clean shutdown (flush InfluxDB, stop Modbus) on `docker stop` / systemd stop.
    raise KeyboardInterrupt()


def main():
    _setup_logging()
    # Treat SIGTERM like Ctrl+C (SIGINT) for a graceful shutdown in containers.
    signal.signal(signal.SIGTERM, _handle_sigterm)
    _random.seed()
    srv_banner()
    srv_start()
    inf_start()
    w_fetch()
    p_fetch()

    now_h = datetime.datetime.now().hour
    day_step = int(now_h * STEPS_PER_HOUR)
    current_temp = 15.0
    spike = SpikeState()
    soiling = SoilingState()
    timer_boiler = DeviceTimer()
    timer_hp = DeviceTimer()
    timer_ev = DeviceTimer()
    ev_profile = EVProfile()
    appliances = make_scheduled_appliances()

    running_cost_pln = 0.0
    _total_sim_days = 0.0  # for calendar aging
    cost_from_db = inf_read_last("sensor.ems_koszt_kumulatywny_dzis")
    if cost_from_db is not None:
        running_cost_pln = float(cost_from_db)
        log.info(f"[STATE] Restored running cost: {running_cost_pln:.2f} PLN from InfluxDB")

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

            soc          = regs[1]
            force        = regs[2]
            boiler       = regs[3]
            hp           = regs[4]
            ev           = regs[5]
            curtail      = regs[10] if len(regs) > 10 else 0
            grid_status  = regs[14] if len(regs) > 14 else 0
            anomaly      = regs[15] if len(regs) > 15 else 0
            storm_safe   = regs[16] if len(regs) > 16 else 0
            ev_override  = regs[17] if len(regs) > 17 else 0
            boiler_eff = timer_boiler.constrain(boiler)
            hp_eff = timer_hp.constrain(hp)
            ev_eff = timer_ev.constrain(ev)
            if boiler_eff != boiler or hp_eff != hp or ev_eff != ev:
                log.info(f"[TIMER] Constrained: boiler {boiler}->{boiler_eff}  HP {hp}->{hp_eff}  EV {ev}->{ev_eff}")
            if ev_override:
                if ev_eff != 7400:
                    log.info(f"[EV_OVR] Manual override — EV forced to 7400W")
                ev_eff = 7400

            day_step = (day_step + 1) % STEPS_PER_DAY
            if day_step == 0:
                running_cost_pln = 0.0
            hour = day_step / STEPS_PER_HOUR

            if anomaly:
                ghi, temp, cloud = None, current_temp, 0
                rce = None
                if day_step % (STEPS_PER_HOUR * 5) == 0:
                    log.info(f"[ANOMALY] API failure simulation active")
            else:
                if w_needs_refresh(hour, day_step):
                    w_fetch()
                if p_needs_refresh(hour, day_step):
                    p_fetch()

                ghi, temp, cloud = w_get(hour)
                if ghi is not None:
                    current_temp = temp

                rce = p_get(hour)

            soiling.tick(hour)
            pv = pv_from_ghi(ghi, hour, soiling)

            ev_plugged, ev_needed = ev_profile.tick(day_step, hour, ev_override)
            if ev_plugged and ev_needed > 1.0 and ev_eff == 0:
                ev_eff = 3700
            elif ev_plugged and ev_needed <= 1.0:
                ev_eff = 0
            if ev_eff > 0 and ev_plugged:
                tick_energy = ev_eff * TICK_S * 60.0 / (3600.0 * 1000.0)
                ev_profile.add_energy(tick_energy)
                if ev_needed < tick_energy:
                    ev_eff = 0

            cop = hp_cop(current_temp)
            ctrl_load, hp_thermal = controllable_load(boiler_eff, hp_eff, ev_eff, cop)
            load = base_load(hour, current_temp)
            if hp_eff > 0 and current_temp is not None and current_temp < 18:
                heat_demand = min(int((18 - current_temp) * 60), 2000)
                hp_thermal_w = int(hp_thermal)
                overlap = min(hp_thermal_w, heat_demand)
                if overlap > 200:
                    load -= int(overlap * 0.8)
                    if day_step % STEPS_PER_HOUR == 0:
                        log.info(f"[COP]  temp={current_temp:.0f}C  COP={cop:.1f}  "
                              f"HP_thermal={hp_thermal_w}W  heat_demand={heat_demand}W  saved={int(overlap*0.8)}W")
            load += ctrl_load

            price = int(rce) if rce is not None else p_fallback(hour)

            for app in appliances:
                app_load = app.tick(hour, price)
                if app_load > 0:
                    load += app_load

            sp = spike.tick()
            if sp > 0:
                load += sp
            if spike.just_started:
                log.info(f"[SPIKE] +{sp}W for {spike.remaining + 1}tics")
            if spike.just_ended:
                log.info(f"[SPIKE] Ended")

            if curtail == 1 and pv > load:
                old_pv = pv
                pv = int(load)
                log.info(f"[CURTAIL] PV {old_pv}W -> {pv}W (zero-export)")

            peak_today = int(round(p_max_today()))

            if not anomaly and _anomaly_prev:
                _last_chg_compute_h = -1
                log.info(f"[ANOMALY] API restored — scheduler re-enabled")

            if not anomaly and day_step % STEPS_PER_HOUR == 0 and day_step != _last_chg_compute_h:
                _last_chg_compute_h = day_step
                chg_start, chg_duration, chg_energy, chg_pv_kwh = compute_charge_window(
                    hour, soc, p_cache
                )
                log.info(f"[CHG] Window: start={chg_start}h  dur={chg_duration}h  "
                      f"need={chg_energy}kWh  PVtom={chg_pv_kwh}kWh")
            elif anomaly and day_step % (STEPS_PER_HOUR * 5) == 0:
                log.info(f"[ANOMALY] Charge scheduler paused (no API data)")

            balance = pv - load

            if grid_status == GRID_NORMAL and balance < 0 and soc < 20:
                shed_w = 0
                if ev_eff > 0:
                    shed_w += ev_eff
                    log.info(f"[PRIO] Shed EV {ev_eff}W (SoC={soc:.0f}%, balance={balance:.0f}W)")
                if shed_w == 0 and hp_eff > 0:
                    hp_save = {1: 1500, 2: 3000}.get(hp_eff, 0)
                    shed_w += hp_save
                    log.info(f"[PRIO] Shed HP {hp_save}W (SoC={soc:.0f}%)")
                if shed_w == 0 and boiler_eff > 0:
                    shed_w += 3000
                    log.info(f"[PRIO] Shed boiler 3000W (SoC={soc:.0f}%)")
                if shed_w > 0:
                    load -= shed_w
                    balance = pv - load

            # Island mode: load shed on critical SoC (bypasses timers — emergency)
            if grid_status == GRID_BLACKOUT and soc <= 5 and balance < 0:
                if boiler_eff > 0:
                    log.info(f"[ISLAND] Shed boiler (SoC={soc:.0f}%)")
                    load -= 3000
                    boiler_eff = 0
                    timer_boiler = DeviceTimer()
                if ev_eff > 0:
                    log.info(f"[ISLAND] Shed EV {ev_eff}W (SoC={soc:.0f}%)")
                    load -= ev_eff
                    ev_eff = 0
                    timer_ev = DeviceTimer()
                if hp_eff > 0:
                    hp_save = {1: 1500, 2: 3000}.get(hp_eff, 0)
                    log.info(f"[ISLAND] Shed HP {hp_save}W (SoC={soc:.0f}%)")
                    load -= hp_save
                    hp_eff = 0
                    timer_hp = DeviceTimer()
                balance = pv - load
                if balance < 0:
                    log.info(f"[ISLAND] After shed: still deficit {balance:.0f}W")

            dt_h = TICK_S * 60.0 / 3600.0
            if grid_status == GRID_BLACKOUT:
                pass  # no grid → no financial tracking
            else:
                effective_price = price
                if balance < 0:
                    effective_price = price + p_dist_rate(hour)
                running_cost_pln += -balance * effective_price * dt_h / (100.0 * 1000.0)

            actual_force = force
            if storm_safe:
                if actual_force != MODE_FORCE_CHARGE:
                    log.info(f"[STORM] Safeguard active — force charging to 100%")
                actual_force = MODE_FORCE_CHARGE
            if grid_status == GRID_BLACKOUT and actual_force == MODE_FORCE_CHARGE:
                actual_force = MODE_AUTO

            _total_sim_days += 1.0 / 288.0
            aging_factor = max(0.70, 1.0 - _total_sim_days * 0.02 / 365.0)
            if day_step % (STEPS_PER_HOUR * 5) == 0 and aging_factor < 0.995:
                log.info(f"[AGING] Battery capacity: {aging_factor*100:.1f}% of original "
                      f"(sim day {_total_sim_days:.0f})")
            delta = batt_delta(balance, actual_force, aging_factor)
            new_soc = batt_clamp(soc + delta)

            if day_step % (STEPS_PER_HOUR * 5) == 0:
                tag = "[ISLAND]" if grid_status == GRID_BLACKOUT else "[PEAK]"
                log.info(f"{tag} Peak today: {peak_today} gr/kWh, "
                      f"Current: {price} gr/kWh, Cost: {running_cost_pln:.2f} PLN")

            if storm_safe:
                log.info(f"[STORM]  Force charging  {soc:.0f} -> {new_soc:.0f}%")
            elif grid_status == GRID_BLACKOUT and actual_force == MODE_FORCE_CHARGE:
                log.info(f"[ISLAND] Force Charge ignored (no grid), running in Auto")
            elif actual_force == MODE_FORCE_CHARGE:
                log.info(f"[FORCE]  Charging  {soc:.0f} -> {new_soc:.0f}%")
            elif actual_force == MODE_FORCE_DISCHARGE:
                log.info(f"[FORCE]  Discharging  {soc:.0f} -> {new_soc:.0f}%")
            elif balance > 200 and new_soc > soc:
                log.info(f"[PV]     Surplus +{balance:+.0f}W  SoC {soc:.0f} -> {new_soc:.0f}%")
            elif balance > 0 and new_soc >= 100:
                log.info(f"[GRID]   Battery full, exporting {balance:.0f}W")
            elif balance < -200 and new_soc < soc:
                log.info(f"[BAT]    Deficit {balance:+.0f}W  SoC {soc:.0f} -> {new_soc:.0f}%")
            elif new_soc <= 0:
                label = "BLACKOUT" if grid_status == GRID_BLACKOUT else "GRID"
                log.info(f"[{label}] Battery empty, load shed {-balance:.0f}W")

            cost_int = int(round(running_cost_pln * 100))

            srv_write([
                int(pv),
                int(round(new_soc)),
                force,
                boiler_eff,
                hp_eff,
                ev_eff,
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
                storm_safe,
                ev_override,
            ])

            inf_write(pv, round(new_soc), load, price, balance, current_temp, cloud, ghi,
                      peak_today, round(running_cost_pln, 2), curtail,
                      chg_start, chg_duration, chg_pv_kwh, grid_status, anomaly, storm_safe)

            _anomaly_prev = anomaly
            time.sleep(TICK_S)

    except KeyboardInterrupt:
        inf_stop()
        srv_stop()
        log.info("\n[EMS] Stopped")


if __name__ == "__main__":
    main()
