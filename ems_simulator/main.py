import datetime
import logging
import os
import random as _random
import signal
import time

import ems_simulator.events as events
import ems_simulator.health as health
import ems_simulator.notifications as notify
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
    MAX_CONSECUTIVE_TICK_ERRORS,
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
    make_standby_devices,
    pv_from_ghi,
    standby_load,
)
from ems_simulator.home_devices import HomeDevices
from ems_simulator.influx_writer import read_events as inf_read_events
from ems_simulator.influx_writer import read_last as inf_read_last
from ems_simulator.influx_writer import start as inf_start
from ems_simulator.influx_writer import stop as inf_stop
from ems_simulator.influx_writer import write as inf_write
from ems_simulator.influx_writer import write_anomalies as inf_write_anomalies
from ems_simulator.influx_writer import write_event as inf_write_event
from ems_simulator.influx_writer import write_forecast as inf_write_forecast
from ems_simulator.influx_writer import write_home_devices as inf_write_home_devices
from ems_simulator.influx_writer import write_lighting as inf_write_lighting
from ems_simulator.influx_writer import write_media_state as inf_write_media
from ems_simulator.influx_writer import write_motion as inf_write_motion
from ems_simulator.influx_writer import write_mpc as inf_write_mpc
from ems_simulator.influx_writer import write_presence as inf_write_presence
from ems_simulator.influx_writer import write_rules as inf_write_rules
from ems_simulator.influx_writer import write_standby as inf_write_standby
from ems_simulator.influx_writer import write_standby_cuts as inf_write_standby_cuts
from ems_simulator.lighting import CircadianModel
from ems_simulator.log_setup import setup as _setup_logging
from ems_simulator.loop_logic import (
    apply_instability,
    base_force,
    compute_balance,
    island_shed,
    resolve_force,
    self_consumption_shed,
    step_hours,
    tick_cost_pln,
)
from ems_simulator.media_sim import MediaPlayerSim
from ems_simulator.mpc_scheduler import solve as mpc_solve
from ems_simulator.mqtt_bridge import MQTTBridge
from ems_simulator.mqtt_bridge import enabled as mqtt_enabled
from ems_simulator.presence import PresenceManager
from ems_simulator.pricing import distribution_rate as p_dist_rate
from ems_simulator.pricing import fallback_price as p_fallback
from ems_simulator.pricing import fetch as p_fetch
from ems_simulator.pricing import get as p_get
from ems_simulator.pricing import max_today as p_max_today
from ems_simulator.pricing import needs_refresh as p_needs_refresh
from ems_simulator.rules import RuleEngine
from ems_simulator.security import MotionSimulator
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


def _build_advisor(now_hour: int, forecast: dict | None) -> dict:
    """24h hourly {hour, price_gr (RCE), pv_w (forecast)} for the /advisor endpoint."""
    pv = forecast.get("pv", []) if isinstance(forecast, dict) else []
    # The forecast may be hourly or quarter-hourly; fold it back to one value per
    # hour so the advisor's 24 rows mean the same thing either way. Indexing it
    # straight by hour would have kept only the last quarter of each hour.
    per_hour = max(1, round(1.0 / step_hours(pv))) if pv else 1
    pv_by_hour = {
        (now_hour + i // per_hour) % 24: sum(pv[i:i + per_hour]) / len(pv[i:i + per_hour])
        for i in range(0, len(pv), per_hour)
    }
    hours = []
    for h in range(24):
        pr = p_get(h)
        if pr is None:
            pr = p_fallback(h)
        hours.append({"hour": h, "price_gr": round(pr), "pv_w": round(pv_by_hour.get(h, 0))})
    return {"hours": hours, "now_hour": now_hour}


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

    # Persist events to InfluxDB and hydrate the in-memory buffer from history,
    # so the event log survives restarts.
    events.set_backends(sink=inf_write_event, reader=inf_read_events)
    _seed_events = inf_read_events(start="-7d", limit=events.MAX_EVENTS)
    if _seed_events:
        events.seed(_seed_events)
        log.info("[EVENTS] Restored %d events from InfluxDB", len(_seed_events))

    forecast_engine = ForecastEngine()
    forecast_engine.fit_all()  # best-effort: may skip models if InfluxDB has no history yet
    _forecast = forecast_engine.predict_next_24h()
    health.set_advisor(_build_advisor(datetime.datetime.now().hour, _forecast))
    thermal = ThermalModel()
    health.start()
    anomaly_detector = AnomalyDetector()
    presence = PresenceManager()
    lighting = CircadianModel()
    rule_engine = RuleEngine()
    standby_devices = make_standby_devices()
    media_player = MediaPlayerSim()
    motion_sim = MotionSimulator()
    home_devices = HomeDevices()
    health.set_alarm_trigger(home_devices.trigger_alarm)  # /test-alarm endpoint

    # RL agent (optional — enable with EMS_RL_ENABLED=1)
    _rl_enabled = os.environ.get("EMS_RL_ENABLED", "0") == "1"
    _rl_agent = None
    if _rl_enabled:
        from rl.agent import QLearningAgent
        _rl_agent = QLearningAgent()
        log.info("[RL] Agent enabled (ε=%.3f)", _rl_agent.epsilon)
    _rl_action = _MODE_AUTO
    _rl_prev_cost = 0.0

    if notify.enabled():
        log.info("[NOTIFY] Notification bridge active")

    def _device_command(kind: str, _obj_id: str, payload: str) -> None:
        """Route MQTT commands for auxiliary devices to the HomeDevices model."""
        if kind == "gate":
            home_devices.cmd_gate(payload)
        elif kind == "gate_position":
            home_devices.cmd_gate_position(float(payload))
        elif kind == "lock":
            home_devices.cmd_lock(payload)
        elif kind == "climate_temp":
            home_devices.cmd_climate_temp(float(payload))
        elif kind == "climate_mode":
            home_devices.cmd_climate_mode(payload)
        elif kind == "garage":
            home_devices.cmd_garage(payload)
        elif kind == "garage_position":
            home_devices.cmd_garage_position(float(payload))
        elif kind == "vacuum":
            home_devices.cmd_vacuum(payload)
        elif kind == "irrigation":
            home_devices.cmd_irrigation(payload)
        elif kind == "fan":
            home_devices.cmd_fan(payload)
        elif kind == "fan_pct":
            home_devices.cmd_fan_percentage(float(payload))

    mqtt_bridge = MQTTBridge(write_register_fn=srv_set_register, command_fn=_device_command)
    if mqtt_enabled():
        mqtt_bridge.start()

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
    _prev_media_state = "idle"  # for media-transition event logging
    _tick_errors = 0  # consecutive failed ticks, reset by every clean tick

    try:
        while True:
            try:
                regs = srv_read()
                if not regs:
                    _tick_errors = 0
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
                ev_override   = regs[17] if len(regs) > 17 else 0
                v2g_mode      = regs[18] if len(regs) > 18 else 0
                presence_mode = regs[19] if len(regs) > 19 else 0
                notify_enabled = regs[20] if len(regs) > 20 else 1
                notify_test    = regs[21] if len(regs) > 21 else 0
                notify_muted   = regs[22] if len(regs) > 22 else 0
                presence.update(presence_mode)
                notify.set_enabled(bool(notify_enabled))
                notify.set_muted(notify_muted)
                if notify_test:
                    notify.send_test()
                    srv_set_register(21, 0)  # auto-reset the momentary trigger
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
                    _rl_prev_cost = 0.0
                    if _rl_enabled and _rl_agent is not None:
                        _rl_agent.save()
                    if forecast_engine.needs_refit():
                        forecast_engine.fit_all()
                hour = day_step / STEPS_PER_HOUR
                if day_step % STEPS_PER_HOUR == 0:
                    health.set_advisor(_build_advisor(int(hour), _forecast))

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

                # V2G: EV discharges to house when plugged, V2G mode active, and balance negative
                v2g_power = 0
                if v2g_mode and ev_plugged and not ev_eff:
                    v2g_power = ev_profile.v2g_tick()
                    if v2g_power and day_step % STEPS_PER_HOUR == 0:
                        log.info("[V2G] EV discharging %dW  EV SoC=%.0f%%", v2g_power, ev_profile.ev_soc_pct)

                cop = hp_cop(current_temp)
                ctrl_load, hp_thermal = controllable_load(boiler_eff, hp_eff, ev_eff, cop)
                # Apply presence multiplier: reduced occupancy → reduced base load
                load = int(base_load(hour, current_temp) * presence.load_multiplier())
                load += ctrl_load

                # Media player: dims lights when playing
                _media_state, _media_override = media_player.tick(hour, presence.mode)
                if _media_state != _prev_media_state:
                    events.record("media", "info", f"Media player: {_media_state}")
                    _prev_media_state = _media_state

                # Circadian lighting (with optional media override) + additive load
                lighting.tick(hour, presence.mode, _media_override)
                load += lighting.load_w

                # Standby devices: tracked for telemetry only (not added to simulation)
                _standby_w, _standby_cuts = standby_load(standby_devices, hour, presence.mode)
                for _cut_name in _standby_cuts:
                    events.record("energy", "info", f"{_cut_name} socket cut by smart plug (standby, away)")

                # Motion simulation
                _motion = motion_sim.tick(hour, presence.mode)
                events.record_edge("motion_indoor", "security", "warning",
                                   "Indoor motion detected while away", _motion["indoor"])
                events.record_edge("motion_outdoor_away", "security", "info",
                                   "Outdoor motion detected (nobody home)",
                                   _motion["outdoor"] and presence.mode != 0)

                # RC thermal model: advance house temperature, log periodically
                t_house = thermal.tick(current_temp if ghi is not None else None, hp_thermal)
                # Auxiliary smart-home devices (humidity, meters, contacts, gate, lock, TRV)
                home_devices.tick(hour, presence_mode, t_house)
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
                    pv, load, price = apply_instability(pv, load, price, _random)
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
                        hour, soc, forecast=_forecast
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

                balance = compute_balance(pv, v2g_power, load)

                _anom_flags = anomaly_detector.update(pv, load, soc, price, ghi, balance)
                _rule_events = rule_engine.evaluate(hour, presence.mode, appliances)

                # ── Event log: anomalies, rules, grid (edge-triggered) ───────────────
                _ANOM_MSG = {
                    "pv_underperform": "PV underperforming vs expected",
                    "load_spike": "Unusual load spike detected",
                    "price_spike": "Energy price spike detected",
                    "soc_drain": "Battery draining unusually fast",
                }
                for _sig, _active in _anom_flags.items():
                    events.record_edge(f"anom_{_sig}", "anomaly", "warning",
                                       _ANOM_MSG.get(_sig, f"Anomaly: {_sig}"), bool(_active))
                _RULE_MSG = {
                    "window_away": ("security", "warning", "Window open while nobody is home"),
                    "laundry_done": ("rule", "info", "Laundry finished — take out the clothes"),
                }
                for _key in ("window_away", "laundry_done"):
                    _cat, _sev, _msg = _RULE_MSG[_key]
                    events.record_edge(f"rule_{_key}", _cat, _sev, _msg,
                                       _key in rule_engine.active_keys)
                events.record_edge("grid_blackout", "grid", "critical",
                                   "Grid blackout — island mode active", grid_status == GRID_BLACKOUT)
                events.record_edge("grid_instability", "grid", "warning",
                                   "Grid instability (fluctuations)", grid_status == GRID_INSTABILITY)

                # Edge-triggered notifications (only sent when condition turns True).
                # Each alert is tagged with a category the user can mute from the UI.
                notify.send_if_changed("blackout",   "BLACKOUT — island mode active.",   grid_status == GRID_BLACKOUT, severity="critical", category="grid")
                notify.send_if_changed("soc_critical", f"Battery critical: {int(soc)}%", soc <= 10,                   severity="critical", category="battery")
                notify.send_if_changed("window_away",  "Window open while nobody home!", "window_away" in rule_engine.active_keys, severity="warning", category="rules")
                notify.send_if_changed("laundry_done", "Laundry done — take out clothes.", "laundry_done" in rule_engine.active_keys, severity="info", category="rules")
                if _motion["indoor"]:
                    notify.send_if_changed("indoor_motion", "Indoor motion detected while away!", True, severity="warning", category="security")
                else:
                    notify.send_if_changed("indoor_motion", "", False, severity="warning", category="security")

                load, balance, _prio_shed = self_consumption_shed(
                    load, balance, soc, grid_status, ev_eff, hp_eff, boiler_eff, pv, v2g_power)
                if _prio_shed is not None:
                    log.info(f"[PRIO] Shed {_prio_shed[0]} {_prio_shed[1]}W "
                             f"(SoC={soc:.0f}%, balance={balance:.0f}W)")

                # Island mode: load shed on critical SoC (bypasses timers — emergency)
                boiler_eff, hp_eff, ev_eff, load, balance, _island_shed = island_shed(
                    boiler_eff, hp_eff, ev_eff, load, balance, soc, grid_status, pv, v2g_power)
                for _dev, _w in _island_shed:
                    log.info(f"[ISLAND] Shed {_dev} {_w}W (SoC={soc:.0f}%)")
                    if _dev == "boiler":
                        timer_boiler = DeviceTimer()
                    elif _dev == "EV":
                        timer_ev = DeviceTimer()
                    elif _dev == "HP":
                        timer_hp = DeviceTimer()
                if _island_shed and balance < 0:
                    log.info(f"[ISLAND] After shed: still deficit {balance:.0f}W")

                dt_h = TICK_S * 60.0 / 3600.0
                running_cost_pln += tick_cost_pln(balance, price, p_dist_rate(hour), dt_h, grid_status)

                # RL agent: act + update
                if _rl_enabled and _rl_agent is not None:
                    _rl_action_idx = _rl_agent.act(soc, hour, price, pv)
                    _rl_action = [MODE_AUTO, MODE_FORCE_CHARGE, MODE_FORCE_DISCHARGE][_rl_action_idx]
                    _tick_cost = running_cost_pln - _rl_prev_cost
                    _rl_agent.update(soc, hour, price, pv, _tick_cost, grid_status == GRID_BLACKOUT)
                    _rl_prev_cost = running_cost_pln

                # RL takes priority over MPC when RL is enabled and suggests an override
                if storm_safe and base_force(force, _rl_action, _mpc_action) != MODE_FORCE_CHARGE:
                    log.info("[STORM] Safeguard active — force charging to 100%")
                actual_force = resolve_force(force, _rl_action, _mpc_action,
                                             bool(storm_safe), grid_status)

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
                    v2g_mode,
                    presence_mode,
                    notify_enabled,
                    0,  # reg 21 notify_test_trigger — always reset (momentary)
                    notify_muted,  # reg 22 notify category mute mask (HA-written)
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
                    rl_enabled=_rl_enabled,
                    rl_action=_rl_action,
                    rl_epsilon=_rl_agent.epsilon if _rl_agent is not None else 0.0,
                    rl_ticks=_rl_agent.ticks if _rl_agent is not None else 0,
                    presence_mode=presence.mode,
                    presence_label=presence.label,
                    media_state=media_player.state,
                    light_brightness=lighting.brightness,
                    light_color_temp_k=lighting.color_temp_k,
                    motion_outdoor=_motion["outdoor"],
                    motion_indoor=_motion["indoor"],
                    standby_load_w=_standby_w,
                    light_load_w=lighting.load_w,
                    notify_enabled=notify.is_enabled(),
                    notify_webhook=notify.webhook_configured(),
                    notify_telegram=notify.telegram_configured(),
                )

                inf_write_presence(presence.mode, presence.label)
                inf_write_lighting(lighting.brightness, lighting.color_temp_k, lighting.load_w)
                inf_write_standby(_standby_w)
                inf_write_media(_media_state, _media_override)
                if _standby_cuts:
                    inf_write_standby_cuts(_standby_cuts)

                if day_step % 6 == 0:  # write anomaly flags + rule events + motion every 6 ticks
                    inf_write_anomalies(_anom_flags)
                    inf_write_rules(rule_engine.active_keys)
                    inf_write_motion(_motion["outdoor"], _motion["indoor"])
                    inf_write_home_devices(home_devices.metrics())

                if day_step % 2 == 0:  # MQTT push every 2 ticks (10 sim-min = ~10 real-sec)
                    mqtt_bridge.push({
                        "pv_w": pv, "soc_pct": new_soc, "load_w": load, "price_gr": price,
                        "balance_w": balance, "t_house": round(thermal.t_house, 1),
                        "standby_load_w": _standby_w, "media_state": _media_state,
                        "presence_label": presence.label, "mpc_action": _mpc_action,
                        "light_brightness": lighting.brightness,
                        "light_color_temp_k": lighting.color_temp_k,
                        "motion_outdoor": _motion["outdoor"],
                        "motion_indoor":  _motion["indoor"],
                        **home_devices.metrics(),
                    })

                _anomaly_prev = anomaly
            except Exception:
                # One bad tick must not take the whole simulator down: log it and
                # keep ticking. State for this tick may be left half-updated, so
                # give up once every tick in a row fails and let the supervisor
                # restart us from a clean slate.
                _tick_errors += 1
                log.exception("[EMS] Tick failed (%d/%d consecutive)",
                              _tick_errors, MAX_CONSECUTIVE_TICK_ERRORS)
                if _tick_errors >= MAX_CONSECUTIVE_TICK_ERRORS:
                    log.error("[EMS] Giving up after %d consecutive failed ticks",
                              _tick_errors)
                    raise
            else:
                _tick_errors = 0

            time.sleep(TICK_S)

    except KeyboardInterrupt:
        log.info("[EMS] Shutdown requested")
    finally:
        # Runs for Ctrl+C, SIGTERM and the give-up path alike, so the Modbus
        # socket, MQTT bridge and InfluxDB buffer are always released.
        if _rl_enabled and _rl_agent is not None:
            _rl_agent.save()
        mqtt_bridge.stop()
        health.stop()
        inf_stop()
        srv_stop()
        log.info("[EMS] Stopped")


if __name__ == "__main__":
    main()
