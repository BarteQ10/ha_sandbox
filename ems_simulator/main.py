import datetime
import logging
import random as _random
import signal
import time

import ems_simulator.health as health
from ems_simulator.anomaly import AnomalyDetector
from ems_simulator.battery import MODE_AUTO, MODE_FORCE_CHARGE, MODE_FORCE_DISCHARGE
from ems_simulator.battery import MODE_AUTO as _MODE_AUTO
from ems_simulator.battery import clamp as batt_clamp
from ems_simulator.battery import delta as batt_delta
from ems_simulator.battery import soh as batt_soh
from ems_simulator.charge_scheduler import compute_charge_window
from ems_simulator.config import (
    GRID_BLACKOUT,
    GRID_INSTABILITY,
    GRID_NORMAL,
    STEPS_PER_DAY,
    STEPS_PER_HOUR,
    TICK_S,
)
from ems_simulator.config_validator import validate as _validate_config
from ems_simulator.forecasting import ForecastEngine
from ems_simulator.generators import (
    DeviceTimer,
    EVProfile,
    SoilingState,
    SpikeState,
    base_load,
    controllable_load,
    hp_cop,
    make_scheduled_appliances,
    pv_from_ghi,
)
from ems_simulator.influx_writer import read_last as inf_read_last
from ems_simulator.influx_writer import start as inf_start
from ems_simulator.influx_writer import stop as inf_stop
from ems_simulator.influx_writer import write as inf_write
from ems_simulator.influx_writer import write_anomalies as inf_write_anomalies
from ems_simulator.influx_writer import write_forecast as inf_write_forecast
from ems_simulator.influx_writer import write_mpc as inf_write_mpc
from ems_simulator.log_setup import setup as _setup_logging
from ems_simulator.mpc_scheduler import solve as mpc_solve
from ems_simulator.pricing import _price_cache as p_cache
from ems_simulator.pricing import distribution_rate as p_dist_rate
from ems_simulator.pricing import fallback_price as p_fallback
from ems_simulator.pricing import fetch as p_fetch
from ems_simulator.pricing import get as p_get
from ems_simulator.pricing import max_today as p_max_today
from ems_simulator.pricing import needs_refresh as p_needs_refresh
from ems_simulator.server import banner as srv_banner
from ems_simulator.server import read as srv_read
from ems_simulator.server import set_register as srv_set_register
from ems_simulator.server import start as srv_start
from ems_simulator.server import stop as srv_stop
from ems_simulator.server import write as srv_write
from ems_simulator.thermal import ThermalModel
from ems_simulator.weather import fetch as w_fetch
from ems_simulator.weather import get as w_get
from ems_simulator.weather import needs_refresh as w_needs_refresh

log = logging.getLogger(__name__)


def _handle_sigterm(signum, frame):
    # Raise KeyboardInterrupt so the main loop's existing handler runs the same
    # clean shutdown (flush InfluxDB, stop Modbus) on `docker stop` / systemd stop.
    raise KeyboardInterrupt()


def main():
    _setup_logging()
    # Treat SIGTERM like Ctrl+C (SIGINT) for a graceful shutdown in containers.
    signal.signal(signal.SIGTERM, _handle_sigterm)
    _validate_config()
    _random.seed()
    srv_banner()
    srv_start()
    inf_start()
    w_fetch()
    p_fetch()

    forecast_engine = ForecastEngine()
    forecast_engine.fit_all()  # best-effort: may skip models if InfluxDB has no history yet
    _forecast = forecast_engine.predict_next_24h()
    thermal = ThermalModel()
    health.start()
    anomaly_detector = AnomalyDetector()

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
    _kwh_throughput = 0.0  # cumulative kWh through battery (for cycle SoH)

    # ── Restore persistent state from InfluxDB ────────────────────────────────
    cost_from_db = inf_read_last("sensor.ems_koszt_kumulatywny_dzis")
    if cost_from_db is not None:
        running_cost_pln = float(cost_from_db)
        log.info("[STATE] Restored running cost: %.2f PLN", running_cost_pln)

    soc_from_db = inf_read_last("sensor.sztuczny_stan_baterii_soc")
    if soc_from_db is not None:
        srv_set_register(1, int(round(float(soc_from_db))))
        log.info("[STATE] Restored SoC: %d%%", int(round(float(soc_from_db))))

    ev_energy_from_db = inf_read_last("sensor.ems_ev_energy_today")
    if ev_energy_from_db is not None:
        ev_profile.restore_energy(float(ev_energy_from_db))
        log.info("[STATE] Restored EV energy today: %.2f kWh", float(ev_energy_from_db))

    kwh_tp_from_db = inf_read_last("sensor.ems_battery_kwh_throughput")
    if kwh_tp_from_db is not None:
        _kwh_throughput = float(kwh_tp_from_db)
        log.info("[STATE] Restored battery kWh throughput: %.1f kWh (%.1f eq. cycles)",
                 _kwh_throughput, _kwh_throughput / (2 * 15.0))

    # Mark same-day appliances done if their time window has already passed
    for _appl in appliances:
        if _appl.window_start < _appl.window_end and now_h >= _appl.window_end:
            _appl.state = "done"
            log.info("[STATE] Appliance '%s' marked done (window %d-%dh already passed)",
                     _appl.name, _appl.window_start, _appl.window_end)
    # ─────────────────────────────────────────────────────────────────────────

    chg_start = None
    chg_duration = 0
    chg_pv_kwh = 0.0
    _last_chg_compute_h = -1
    _anomaly_prev = 0
    _fc_summary = forecast_engine.summary(_forecast)
    _mpc_action = _MODE_AUTO  # MPC recommended action for current hour

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
                    log.info("[EV_OVR] Manual override — EV forced to 7400W")
                ev_eff = 7400

            day_step = (day_step + 1) % STEPS_PER_DAY
            if day_step == 0:
                running_cost_pln = 0.0
                if forecast_engine.needs_refit():
                    forecast_engine.fit_all()
            hour = day_step / STEPS_PER_HOUR

            if anomaly:
                ghi, temp, cloud = None, current_temp, 0
                rce = None
                if day_step % (STEPS_PER_HOUR * 5) == 0:
                    log.info("[ANOMALY] API failure simulation active")
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
            load += ctrl_load

            # RC thermal model: advance house temperature, log periodically
            t_house = thermal.tick(current_temp if ghi is not None else None, hp_thermal)
            if day_step % (STEPS_PER_HOUR * 6) == 0:
                thermal.log_status(current_temp)
                if hp_eff > 0:
                    log.info("[COP]  T_house=%.1f°C  T_out=%.1f°C  COP=%.1f  HP_thermal=%.0fW",
                             t_house, current_temp if current_temp else 0, cop, hp_thermal)

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
                log.info("[SPIKE] Ended")

            # Grid instability: random voltage/frequency deviations → PV inverter
            # curtails output, load fluctuates, effective import price spikes.
            if grid_status == GRID_INSTABILITY:
                if _random.random() < 0.3:          # 30% of ticks: PV derates
                    curtail_factor = _random.uniform(0.4, 0.9)
                    pv = int(pv * curtail_factor)
                if _random.random() < 0.2:          # 20% of ticks: load surge/drop
                    load = int(load * _random.uniform(0.85, 1.3))
                price = int(price * _random.uniform(1.0, 2.5))  # price volatility
                if day_step % (STEPS_PER_HOUR * 2) == 0:
                    log.info("[INSTAB] Grid instability — PV=%dW load=%dW price=%d gr/kWh",
                             pv, load, price)

            if curtail == 1 and pv > load:
                old_pv = pv
                pv = int(load)
                log.info(f"[CURTAIL] PV {old_pv}W -> {pv}W (zero-export)")

            peak_today = int(round(p_max_today()))

            if not anomaly and _anomaly_prev:
                _last_chg_compute_h = -1
                log.info("[ANOMALY] API restored — scheduler re-enabled")

            if not anomaly and day_step % STEPS_PER_HOUR == 0 and day_step != _last_chg_compute_h:
                _last_chg_compute_h = day_step
                _forecast = forecast_engine.predict_next_24h()
                _fc_summary = forecast_engine.summary(_forecast)
                chg_start, chg_duration, chg_energy, chg_pv_kwh = compute_charge_window(
                    hour, soc, p_cache, forecast=_forecast
                )
                log.info(f"[CHG] Window: start={chg_start}h  dur={chg_duration}h  "
                      f"need={chg_energy}kWh  PVtom={chg_pv_kwh}kWh")
                log.info("[FCST] PV=%.1fkWh  Load=%.1fkWh  PriceAvg=%.1f  PricePeak=%.1f gr/kWh",
                         _fc_summary["pv_day_kwh"], _fc_summary["load_day_kwh"],
                         _fc_summary["price_avg"], _fc_summary["price_peak"])
                inf_write_forecast(**_fc_summary)
                _mpc_result = mpc_solve(soc, _forecast, current_hour=int(hour))
                _mpc_action = _mpc_result.current_action
                inf_write_mpc(_mpc_action, _mpc_result.cost_estimate,
                              _mpc_result.naive_cost, _mpc_result.savings)
            elif anomaly and day_step % (STEPS_PER_HOUR * 5) == 0:
                log.info("[ANOMALY] Charge scheduler paused (no API data)")

            balance = pv - load

            _anom_flags = anomaly_detector.update(pv, load, soc, price, ghi, balance)

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
            # Apply MPC recommendation when user has not set a manual override
            if actual_force == MODE_AUTO and _mpc_action != MODE_AUTO:
                actual_force = _mpc_action
            if storm_safe:
                if actual_force != MODE_FORCE_CHARGE:
                    log.info("[STORM] Safeguard active — force charging to 100%")
                actual_force = MODE_FORCE_CHARGE
            if grid_status == GRID_BLACKOUT and actual_force == MODE_FORCE_CHARGE:
                actual_force = MODE_AUTO

            _total_sim_days += 1.0 / 288.0
            aging_factor = batt_soh(_total_sim_days, _kwh_throughput)
            batt_delta_val = batt_delta(balance, actual_force, aging_factor)
            # Accumulate throughput: SoC-% change → kWh (BATTERY_KWH / 100 per %)
            _kwh_throughput += abs(batt_delta_val) * 15.0 / 100.0
            if day_step % (STEPS_PER_HOUR * 5) == 0 and aging_factor < 0.995:
                log.info("[SOH] Battery SoH: %.1f%%  calendar: %.1fd  cycles: %.1f eq.",
                         aging_factor * 100, _total_sim_days,
                         _kwh_throughput / (2 * 15.0))
            delta = batt_delta_val
            new_soc = batt_clamp(soc + delta)

            if day_step % (STEPS_PER_HOUR * 5) == 0:
                tag = "[ISLAND]" if grid_status == GRID_BLACKOUT else "[PEAK]"
                log.info(f"{tag} Peak today: {peak_today} gr/kWh, "
                      f"Current: {price} gr/kWh, Cost: {running_cost_pln:.2f} PLN")

            if storm_safe:
                log.info(f"[STORM]  Force charging  {soc:.0f} -> {new_soc:.0f}%")
            elif grid_status == GRID_BLACKOUT and actual_force == MODE_FORCE_CHARGE:
                log.info("[ISLAND] Force Charge ignored (no grid), running in Auto")
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
                      chg_start, chg_duration, chg_pv_kwh, grid_status, anomaly, storm_safe,
                      ev_energy_today=ev_profile.energy_delivered_today,
                      battery_soh=round(aging_factor, 4),
                      kwh_throughput=round(_kwh_throughput, 2),
                      t_house=round(thermal.t_house, 2))

            health.update(
                tick=day_step,
                pv_w=pv,
                soc_pct=new_soc,
                load_w=load,
                price_gr=price,
                balance_w=balance,
                t_house=thermal.t_house,
                battery_soh=aging_factor,
                running_cost_pln=running_cost_pln,
                influx_ok=not anomaly,
                mpc_action=_mpc_action,
                forecast_pv_kwh=_fc_summary.get("pv_day_kwh", 0.0),
                forecast_load_kwh=_fc_summary.get("load_day_kwh", 0.0),
            )

            if day_step % 6 == 0:  # write anomaly flags every 6 ticks (30 sim min)
                inf_write_anomalies(_anom_flags)

            _anomaly_prev = anomaly
            time.sleep(TICK_S)

    except KeyboardInterrupt:
        health.stop()
        inf_stop()
        srv_stop()
        log.info("\n[EMS] Stopped")


if __name__ == "__main__":
    main()
