"""MQTT bridge — Home Assistant device autodiscovery for the EMS Simulator (8.9).

Publishes sensor/binary_sensor/switch/select entities via the HA MQTT
integration discovery protocol.  Requires paho-mqtt and a running MQTT broker
(Mosquitto is included in docker-compose.yml).

Configuration (environment variables):
    MQTT_HOST  — broker hostname (default: mosquitto; set empty to disable)
    MQTT_PORT  — broker port (default: 1883)
    MQTT_USER  — username (optional)
    MQTT_PASS  — password (optional)

State is pushed by calling MQTTBridge.push(metrics_dict) every N ticks from
the main loop.  Writable entities (switch, select) write back to Modbus via
the write_register_fn callback passed to the constructor.
"""
import json
import logging
import os
import threading

from ems_simulator.config import SIM_DEVICES

log = logging.getLogger(__name__)

try:
    import paho.mqtt.client as mqtt
    _PAHO_OK = True
except ImportError:
    _PAHO_OK = False

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER", "")
MQTT_PASS = os.environ.get("MQTT_PASS", "")

_DEVICE_ID = "ems_simulator"
_DEVICE = {
    "identifiers": [_DEVICE_ID],
    "name": "EMS Simulator",
    "model": "Virtual EMS v8",
    "manufacturer": "ha-sandbox",
}
_STATE_PREFIX = f"ems/{_DEVICE_ID}"
_DISC_PREFIX  = "homeassistant"

# ── entity tables ─────────────────────────────────────────────────────────────

# (object_id, friendly_name, unit, device_class, state_class, metrics_key)
_SENSORS = [
    ("pv_w",            "PV Production",        "W",       "power",       "measurement", "pv_w"),
    ("soc_pct",         "Battery SoC",          "%",       "battery",     "measurement", "soc_pct"),
    ("load_w",          "Home Load",            "W",       "power",       "measurement", "load_w"),
    ("price_gr",        "Energy Price",         "gr/kWh",  None,          "measurement", "price_gr"),
    ("balance_w",       "Net Balance",          "W",       "power",       "measurement", "balance_w"),
    ("t_house",         "House Temperature",    "°C",      "temperature", "measurement", "t_house"),
    ("standby_load_w",  "Standby Load",         "W",       "power",       "measurement", "standby_load_w"),
    ("light_brightness","Circadian Brightness", "%",       None,          "measurement", "light_brightness"),
    ("light_color_temp_k", "Circadian CT",      "K",       None,          "measurement", "light_color_temp_k"),
    ("media_state",     "Media State",          None,      None,          None,          "media_state"),
    ("presence_label",  "Presence Mode",        None,      None,          None,          "presence_label"),
    ("mpc_action",      "MPC Action",           None,      None,          None,          "mpc_action"),
    # auxiliary home devices (read-only)
    ("humidity_pct",    "Humidity",             "%",       "humidity",    "measurement",      "humidity_pct"),
    ("water_m3",        "Water Meter",          "m³",      "water",       "total_increasing", "water_m3"),
    ("gas_m3",          "Gas Meter",            "m³",      "gas",         "total_increasing", "gas_m3"),
    ("co2_ppm",         "CO2",                  "ppm",     "carbon_dioxide", "measurement",   "co2_ppm"),
    ("pm25",            "PM2.5",                "µg/m³",   "pm25",        "measurement",      "pm25"),
    ("voc_index",       "VOC Index",            None,      "aqi",         "measurement",      "voc_index"),
    ("vacuum_battery",  "Vacuum Battery",       "%",       "battery",     "measurement",      "vacuum_battery"),
]

# (object_id, friendly_name, device_class, metrics_key)
_BINARY_SENSORS = [
    ("motion_outdoor", "Motion Outdoor", "motion", "motion_outdoor"),
    ("motion_indoor",  "Motion Indoor",  "motion", "motion_indoor"),
    # auxiliary home devices (read-only)
    ("window_living",  "Living Window",  "window",          "window_living"),
    ("door_entrance",  "Entrance Door",  "door",            "door_entrance"),
    ("leak_kitchen",   "Kitchen Leak",   "moisture",        "leak_kitchen"),
    ("smoke",          "Smoke Detector", "smoke",           "smoke"),
    ("co",             "CO Detector",    "carbon_monoxide", "co"),
    ("air_quality",    "Air Quality Alert", "problem",      "air_quality_alert"),
    ("doorbell",       "Doorbell",       "occupancy",       "doorbell"),
]

# (object_id, friendly_name, icon, modbus_reg)
_SWITCHES = [
    ("v2g_mode", "V2G Mode", "mdi:car-arrow-left", 18),
]

# (object_id, friendly_name, options_list, options_to_reg, icon, modbus_reg)
_SELECTS = [
    (
        "presence_mode",
        "Presence Mode",
        ["W domu", "Poza domem", "Urlop"],
        {"W domu": 0, "Poza domem": 1, "Urlop": 2},
        "mdi:home-account",
        19,
    ),
]


# Controllable auxiliary devices — commands route to a callback, not Modbus.
# (object_id, friendly_name, position_metrics_key, cmd_kind, pos_cmd_kind)
_COVERS = [
    ("gate",   "Driveway Gate", "gate_position",   "gate",   "gate_position"),
    ("garage", "Garage Door",   "garage_position", "garage", "garage_position"),
]
# (object_id, friendly_name, state_metrics_key)  → "LOCKED" / "UNLOCKED"
_LOCKS = [
    ("lock_entrance", "Entrance Lock", "lock_entrance"),
]
# (object_id, friendly_name, current_key, target_key, mode_key, min_t, max_t)
_CLIMATES = [
    ("trv_living", "Living Room TRV", "trv_current", "trv_target", "trv_mode", 7, 30),
]
# Aux switches (controllable, command → callback). (object_id, name, icon, state_key, cmd_kind)
_AUX_SWITCHES = [
    ("irrigation", "Garden Irrigation", "mdi:sprinkler", "irrigation", "irrigation"),
]
# Fans. (object_id, friendly_name, state_key, pct_key)
_FANS = [
    ("fan_living", "Living Room Fan", "fan_state", "fan_pct"),
]
# Vacuums. (object_id, friendly_name, state_key, battery_key)
_VACUUMS = [
    ("vacuum", "Robot Vacuum", "vacuum_state", "vacuum_battery"),
]


# ── which of the above are still wanted ──────────────────────────────────────
# Every object_id in the tables above belongs to exactly one group here
# (tests/test_mqtt_bridge.py fails if one is missing or listed twice). Groups are
# switched on and off through config.SIM_DEVICES / EMS_SIM_DEVICES, so a virtual
# device can be retired the day a real one replaces it.
_GROUPS: dict[str, set[str]] = {
    "energy": {
        "pv_w", "soc_pct", "load_w", "price_gr", "balance_w", "standby_load_w",
        "mpc_action", "v2g_mode",
    },
    "house": {
        "t_house", "presence_label", "presence_mode", "media_state",
        "light_brightness", "light_color_temp_k", "trv_living",
    },
    "security": {
        "motion_outdoor", "motion_indoor", "window_living", "door_entrance",
        "leak_kitchen", "smoke", "co", "doorbell", "lock_entrance",
    },
    "air": {"humidity_pct", "co2_ppm", "pm25", "voc_index", "air_quality"},
    "meters": {"water_m3", "gas_m3"},
    "appliances": {"gate", "garage", "irrigation", "fan_living", "vacuum",
                   "vacuum_battery"},
}


_KNOWN_IDS = {obj_id for ids in _GROUPS.values() for obj_id in ids}


def enabled_ids() -> set[str]:
    """Object ids whose virtual device should exist in Home Assistant.

    Each entry of config.SIM_DEVICES is a group name, a single device id, or
    either prefixed with "-" to take it back out. Removals are applied after
    additions, so `security,-smoke` is the security group without the smoke
    detector. A list of only removals starts from everything, because
    `-smoke,-co` plainly means "the fakes except those two" — which is what you
    write the day two real detectors arrive, one token per device retired.
    """
    additions: set[str] = set()
    removals: set[str] = set()
    unknown: list[str] = []

    for entry in SIM_DEVICES:
        token = entry.strip()
        dropping = token.startswith("-")
        name = token.lstrip("-").strip()
        if not name:
            continue
        if name in _GROUPS:
            target = set(_GROUPS[name])
        elif name in _KNOWN_IDS:
            target = {name}
        else:
            unknown.append(token)
            continue
        (removals if dropping else additions).update(target)

    if unknown:
        log.warning("[MQTT] Unknown entries in EMS_SIM_DEVICES: %s — groups: %s",
                    unknown, sorted(_GROUPS))

    if not additions and removals:
        additions = set(_KNOWN_IDS)

    return additions - removals


def _state_topic(component: str, obj_id: str) -> str:
    return f"{_STATE_PREFIX}/{component}/{obj_id}/state"


def _cmd_topic(component: str, obj_id: str) -> str:
    return f"{_STATE_PREFIX}/{component}/{obj_id}/set"


def _sub_topic(component: str, obj_id: str, leaf: str) -> str:
    """Extra per-entity topic (e.g. cover position, climate mode)."""
    return f"{_STATE_PREFIX}/{component}/{obj_id}/{leaf}"


def _disc_topic(component: str, obj_id: str) -> str:
    return f"{_DISC_PREFIX}/{component}/{_DEVICE_ID}_{obj_id}/config"


class MQTTBridge:
    """Thread-safe MQTT bridge — connects once, auto-reconnects."""

    def __init__(self, write_register_fn, command_fn=None) -> None:
        self._write_reg = write_register_fn
        # command_fn(kind, obj_id, payload) handles auxiliary device commands
        # (gate / gate_position / lock / climate_temp / climate_mode).
        self._command_fn = command_fn or (lambda *a: None)
        self._client: mqtt.Client | None = None
        self._connected = False
        self._lock = threading.Lock()
        self._switch_state: dict[str, bool] = {s[0]: False for s in _SWITCHES}
        self._select_state: dict[str, str]  = {s[0]: s[2][0] for s in _SELECTS}
        # Resolved on connect, so a config change is picked up by a restart.
        self._on: set[str] = set()

    # ── lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        if not _PAHO_OK:
            log.warning("[MQTT] paho-mqtt not installed — bridge disabled")
            return
        if not MQTT_HOST:
            log.info("[MQTT] MQTT_HOST not set — bridge disabled")
            return
        c = mqtt.Client(client_id=_DEVICE_ID, clean_session=True)
        c.on_connect    = self._on_connect
        c.on_disconnect = self._on_disconnect
        c.on_message    = self._on_message
        if MQTT_USER:
            c.username_pw_set(MQTT_USER, MQTT_PASS)
        c.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
        c.loop_start()
        self._client = c
        log.info("[MQTT] Connecting to %s:%d", MQTT_HOST, MQTT_PORT)

    def stop(self) -> None:
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()
            log.info("[MQTT] Disconnected")

    # ── state push (called from main loop) ────────────────────────────────────

    def push(self, metrics: dict) -> None:
        if not self._connected or not self._client:
            return
        try:
            self._publish_states(metrics)
        except Exception as e:
            log.warning("[MQTT] push failed: %s", e)

    # ── MQTT callbacks ────────────────────────────────────────────────────────

    def _on_connect(self, client, userdata, flags, rc) -> None:
        if rc != 0:
            log.warning("[MQTT] Connection refused (rc=%d)", rc)
            return
        log.info("[MQTT] Connected to %s:%d", MQTT_HOST, MQTT_PORT)
        self._connected = True
        # Resolve the device selection once per connection — both calls below read
        # it, so neither depends on the other having run first.
        self._on = enabled_ids()
        self._publish_discovery(client)
        self._subscribe_commands(client)

    def _on_disconnect(self, client, userdata, rc) -> None:
        self._connected = False
        if rc != 0:
            log.warning("[MQTT] Unexpected disconnect (rc=%d) — will auto-reconnect", rc)

    def _on_message(self, client, userdata, msg) -> None:
        payload = msg.payload.decode(errors="replace").strip()
        topic   = msg.topic
        for obj_id, _, _, reg in _SWITCHES:
            if topic == _cmd_topic("switch", obj_id):
                val = 1 if payload.upper() == "ON" else 0
                self._switch_state[obj_id] = bool(val)
                self._write_reg(reg, val)
                client.publish(_state_topic("switch", obj_id), "ON" if val else "OFF", retain=True)
                log.info("[MQTT] switch %s → %d (reg %d)", obj_id, val, reg)
                return
        for obj_id, _, _options, opt_map, _, reg in _SELECTS:
            if topic == _cmd_topic("select", obj_id):
                if payload in opt_map:
                    self._select_state[obj_id] = payload
                    self._write_reg(reg, opt_map[payload])
                    client.publish(_state_topic("select", obj_id), payload, retain=True)
                    log.info("[MQTT] select %s → %r (reg %d)", obj_id, payload, reg)
                return
        # ── auxiliary controllable devices (route to command callback) ──────────
        for obj_id, _name, _pos, cmd_kind, pos_kind in _COVERS:
            if topic == _cmd_topic("cover", obj_id):
                self._command_fn(cmd_kind, obj_id, payload)
                return
            if topic == _sub_topic("cover", obj_id, "set_position"):
                self._command_fn(pos_kind, obj_id, payload)
                return
        for obj_id, *_ in _LOCKS:
            if topic == _cmd_topic("lock", obj_id):
                self._command_fn("lock", obj_id, payload)
                return
        for obj_id, *_ in _CLIMATES:
            if topic == _sub_topic("climate", obj_id, "temp/set"):
                self._command_fn("climate_temp", obj_id, payload)
                return
            if topic == _sub_topic("climate", obj_id, "mode/set"):
                self._command_fn("climate_mode", obj_id, payload)
                return
        for obj_id, _name, _icon, _state, cmd_kind in _AUX_SWITCHES:
            if topic == _cmd_topic("switch", obj_id):
                self._command_fn(cmd_kind, obj_id, payload)
                return
        for obj_id, *_ in _FANS:
            if topic == _cmd_topic("fan", obj_id):
                self._command_fn("fan", obj_id, payload)
                return
            if topic == _sub_topic("fan", obj_id, "pct/set"):
                self._command_fn("fan_pct", obj_id, payload)
                return
        for obj_id, *_ in _VACUUMS:
            if topic == _cmd_topic("vacuum", obj_id):
                self._command_fn("vacuum", obj_id, payload)
                return

    # ── autodiscovery ─────────────────────────────────────────────────────────

    def _publish_disc(self, client, component: str, obj_id: str, cfg: dict) -> None:
        """Publish one discovery config — or clear it when the device is off.

        An EMPTY retained payload on a discovery topic is how Home Assistant is
        told to forget an entity. It matters because every config we publish is
        retained by the broker: without this, turning a virtual device off would
        leave a permanently unavailable ghost behind in HA.
        """
        if obj_id in self._on:
            client.publish(_disc_topic(component, obj_id), json.dumps(cfg), retain=True)
        else:
            client.publish(_disc_topic(component, obj_id), "", retain=True)

    def _publish_discovery(self, client) -> None:
        """Announce the enabled devices and un-announce the retired ones.

        Reads self._on, which _on_connect resolves for the connection.
        """
        for obj_id, name, unit, dc, sc, _ in _SENSORS:
            cfg: dict = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "state_topic": _state_topic("sensor", obj_id),
                "device": _DEVICE,
            }
            if unit:
                cfg["unit_of_measurement"] = unit
            if dc:
                cfg["device_class"] = dc
            if sc:
                cfg["state_class"] = sc
            self._publish_disc(client, "sensor", obj_id, cfg)

        for obj_id, name, dc, _ in _BINARY_SENSORS:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "state_topic": _state_topic("binary_sensor", obj_id),
                "payload_on": "ON", "payload_off": "OFF",
                "device_class": dc,
                "device": _DEVICE,
            }
            self._publish_disc(client, "binary_sensor", obj_id, cfg)

        for obj_id, name, icon, _ in _SWITCHES:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "state_topic":   _state_topic("switch", obj_id),
                "command_topic": _cmd_topic("switch", obj_id),
                "icon": icon,
                "device": _DEVICE,
            }
            self._publish_disc(client, "switch", obj_id, cfg)

        for obj_id, name, options, _, icon, _ in _SELECTS:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "state_topic":   _state_topic("select", obj_id),
                "command_topic": _cmd_topic("select", obj_id),
                "options": options,
                "icon": icon,
                "device": _DEVICE,
            }
            self._publish_disc(client, "select", obj_id, cfg)

        for obj_id, name, _pos, _ck, _pk in _COVERS:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "command_topic":      _cmd_topic("cover", obj_id),
                "position_topic":     _sub_topic("cover", obj_id, "position"),
                "set_position_topic": _sub_topic("cover", obj_id, "set_position"),
                "payload_open": "OPEN", "payload_close": "CLOSE", "payload_stop": "STOP",
                "position_open": 100, "position_closed": 0,
                "device_class": "garage" if obj_id == "garage" else "gate",
                "device": _DEVICE,
            }
            self._publish_disc(client, "cover", obj_id, cfg)

        for obj_id, name, _ in _LOCKS:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "command_topic": _cmd_topic("lock", obj_id),
                "state_topic":   _state_topic("lock", obj_id),
                "payload_lock": "LOCK", "payload_unlock": "UNLOCK",
                "state_locked": "LOCKED", "state_unlocked": "UNLOCKED",
                "device": _DEVICE,
            }
            self._publish_disc(client, "lock", obj_id, cfg)

        for obj_id, name, _cur, _tgt, _mode, min_t, max_t in _CLIMATES:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "modes": ["off", "heat"],
                "mode_command_topic":        _sub_topic("climate", obj_id, "mode/set"),
                "mode_state_topic":          _sub_topic("climate", obj_id, "mode/state"),
                "temperature_command_topic": _sub_topic("climate", obj_id, "temp/set"),
                "temperature_state_topic":   _sub_topic("climate", obj_id, "temp/state"),
                "current_temperature_topic": _sub_topic("climate", obj_id, "current"),
                "min_temp": min_t, "max_temp": max_t, "temp_step": 0.5,
                "temperature_unit": "C",
                "device": _DEVICE,
            }
            self._publish_disc(client, "climate", obj_id, cfg)

        for obj_id, name, icon, _state, _ck in _AUX_SWITCHES:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "state_topic":   _state_topic("switch", obj_id),
                "command_topic": _cmd_topic("switch", obj_id),
                "icon": icon,
                "device": _DEVICE,
            }
            self._publish_disc(client, "switch", obj_id, cfg)

        for obj_id, name, _state, _pct in _FANS:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "state_topic":   _state_topic("fan", obj_id),
                "command_topic": _cmd_topic("fan", obj_id),
                "percentage_state_topic":   _sub_topic("fan", obj_id, "pct"),
                "percentage_command_topic": _sub_topic("fan", obj_id, "pct/set"),
                "device": _DEVICE,
            }
            self._publish_disc(client, "fan", obj_id, cfg)

        for obj_id, name, _state, _batt in _VACUUMS:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "schema": "state",
                "command_topic": _cmd_topic("vacuum", obj_id),
                "state_topic":   _state_topic("vacuum", obj_id),
                "supported_features": ["start", "stop", "pause", "return_home", "status"],
                "device": _DEVICE,
            }
            self._publish_disc(client, "vacuum", obj_id, cfg)

        total = sum(len(ids) for ids in _GROUPS.values())
        if self._on:
            log.info("[MQTT] Autodiscovery: %d/%d virtual devices published, "
                     "%d removed from HA (groups: %s)",
                     len(self._on), total, total - len(self._on),
                     ", ".join(SIM_DEVICES))
        else:
            log.warning("[MQTT] All %d virtual devices retired and removed from "
                        "Home Assistant (EMS_SIM_DEVICES is empty). The Modbus "
                        "entities in configuration.yaml are separate and stay.",
                        total)

    def _subscribe_commands(self, client) -> None:
        # No point listening for commands to a device HA no longer knows about.
        def _off(obj_id: str) -> bool:
            return obj_id not in self._on

        for obj_id, *_ in _SWITCHES:
            if _off(obj_id):
                continue
            client.subscribe(_cmd_topic("switch", obj_id))
        for obj_id, *_ in _SELECTS:
            if _off(obj_id):
                continue
            client.subscribe(_cmd_topic("select", obj_id))
        for obj_id, *_ in _COVERS:
            if _off(obj_id):
                continue
            client.subscribe(_cmd_topic("cover", obj_id))
            client.subscribe(_sub_topic("cover", obj_id, "set_position"))
        for obj_id, *_ in _LOCKS:
            if _off(obj_id):
                continue
            client.subscribe(_cmd_topic("lock", obj_id))
        for obj_id, *_ in _CLIMATES:
            if _off(obj_id):
                continue
            client.subscribe(_sub_topic("climate", obj_id, "temp/set"))
            client.subscribe(_sub_topic("climate", obj_id, "mode/set"))
        for obj_id, *_ in _AUX_SWITCHES:
            if _off(obj_id):
                continue
            client.subscribe(_cmd_topic("switch", obj_id))
        for obj_id, *_ in _FANS:
            if _off(obj_id):
                continue
            client.subscribe(_cmd_topic("fan", obj_id))
            client.subscribe(_sub_topic("fan", obj_id, "pct/set"))
        for obj_id, *_ in _VACUUMS:
            if _off(obj_id):
                continue
            client.subscribe(_cmd_topic("vacuum", obj_id))

    # ── state publication ─────────────────────────────────────────────────────

    def _publish_states(self, m: dict) -> None:
        c = self._client
        if c is None:
            return
        on = self._on
        for obj_id, *_, key in _SENSORS:
            if obj_id not in on:
                continue
            val = m.get(key)
            if val is not None:
                c.publish(_state_topic("sensor", obj_id), str(val))

        for obj_id, *_, key in _BINARY_SENSORS:
            if obj_id not in on:
                continue
            val = m.get(key)
            if val is not None:
                c.publish(_state_topic("binary_sensor", obj_id), "ON" if val else "OFF")

        # Mirror switch/select current state (reflects Modbus register)
        for obj_id, *_ in _SWITCHES:
            if obj_id not in on:
                continue
            state = "ON" if self._switch_state.get(obj_id) else "OFF"
            c.publish(_state_topic("switch", obj_id), state)

        for obj_id, *_ in _SELECTS:
            if obj_id not in on:
                continue
            state = self._select_state.get(obj_id, "W domu")
            c.publish(_state_topic("select", obj_id), state)

        # Auxiliary controllable devices — publish current state from metrics
        for obj_id, _name, pos_key, *_ in _COVERS:
            if obj_id not in on:
                continue
            val = m.get(pos_key)
            if val is not None:
                c.publish(_sub_topic("cover", obj_id, "position"), str(int(val)))

        for obj_id, _name, state_key in _LOCKS:
            if obj_id not in on:
                continue
            val = m.get(state_key)
            if val is not None:
                c.publish(_state_topic("lock", obj_id), str(val))

        for obj_id, _name, cur_key, tgt_key, mode_key, *_ in _CLIMATES:
            if obj_id not in on:
                continue
            if (cur := m.get(cur_key)) is not None:
                c.publish(_sub_topic("climate", obj_id, "current"), str(cur))
            if (tgt := m.get(tgt_key)) is not None:
                c.publish(_sub_topic("climate", obj_id, "temp/state"), str(tgt))
            if (mode := m.get(mode_key)) is not None:
                c.publish(_sub_topic("climate", obj_id, "mode/state"), str(mode))

        for obj_id, _name, _icon, state_key, _ck in _AUX_SWITCHES:
            if obj_id not in on:
                continue
            if (val := m.get(state_key)) is not None:
                c.publish(_state_topic("switch", obj_id), str(val))

        for obj_id, _name, state_key, pct_key in _FANS:
            if obj_id not in on:
                continue
            if (val := m.get(state_key)) is not None:
                c.publish(_state_topic("fan", obj_id), str(val))
            if (pct := m.get(pct_key)) is not None:
                c.publish(_sub_topic("fan", obj_id, "pct"), str(int(pct)))

        for obj_id, _name, state_key, batt_key in _VACUUMS:
            if obj_id not in on:
                continue
            st = m.get(state_key)
            batt = m.get(batt_key)
            if st is not None:
                c.publish(_state_topic("vacuum", obj_id),
                          json.dumps({"state": st, "battery_level": int(batt or 0)}))


def enabled() -> bool:
    return _PAHO_OK and bool(MQTT_HOST)
