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
# (object_id, friendly_name, position_metrics_key)
_COVERS = [
    ("gate", "Driveway Gate", "gate_position"),
]
# (object_id, friendly_name, state_metrics_key)  → "LOCKED" / "UNLOCKED"
_LOCKS = [
    ("lock_entrance", "Entrance Lock", "lock_entrance"),
]
# (object_id, friendly_name, current_key, target_key, mode_key, min_t, max_t)
_CLIMATES = [
    ("trv_living", "Living Room TRV", "trv_current", "trv_target", "trv_mode", 7, 30),
]


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
        for obj_id, *_ in _COVERS:
            if topic == _cmd_topic("cover", obj_id):
                self._command_fn("gate", obj_id, payload)
                return
            if topic == _sub_topic("cover", obj_id, "set_position"):
                self._command_fn("gate_position", obj_id, payload)
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

    # ── autodiscovery ─────────────────────────────────────────────────────────

    def _publish_discovery(self, client) -> None:
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
            client.publish(_disc_topic("sensor", obj_id), json.dumps(cfg), retain=True)

        for obj_id, name, dc, _ in _BINARY_SENSORS:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "state_topic": _state_topic("binary_sensor", obj_id),
                "payload_on": "ON", "payload_off": "OFF",
                "device_class": dc,
                "device": _DEVICE,
            }
            client.publish(_disc_topic("binary_sensor", obj_id), json.dumps(cfg), retain=True)

        for obj_id, name, icon, _ in _SWITCHES:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "state_topic":   _state_topic("switch", obj_id),
                "command_topic": _cmd_topic("switch", obj_id),
                "icon": icon,
                "device": _DEVICE,
            }
            client.publish(_disc_topic("switch", obj_id), json.dumps(cfg), retain=True)

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
            client.publish(_disc_topic("select", obj_id), json.dumps(cfg), retain=True)

        for obj_id, name, _ in _COVERS:
            cfg = {
                "name": name,
                "unique_id": f"{_DEVICE_ID}_{obj_id}",
                "command_topic":      _cmd_topic("cover", obj_id),
                "position_topic":     _sub_topic("cover", obj_id, "position"),
                "set_position_topic": _sub_topic("cover", obj_id, "set_position"),
                "payload_open": "OPEN", "payload_close": "CLOSE", "payload_stop": "STOP",
                "position_open": 100, "position_closed": 0,
                "device_class": "gate",
                "device": _DEVICE,
            }
            client.publish(_disc_topic("cover", obj_id), json.dumps(cfg), retain=True)

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
            client.publish(_disc_topic("lock", obj_id), json.dumps(cfg), retain=True)

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
            client.publish(_disc_topic("climate", obj_id), json.dumps(cfg), retain=True)

        log.info(
            "[MQTT] Autodiscovery published (%d sensors, %d binary, %d switches, "
            "%d selects, %d covers, %d locks, %d climates)",
            len(_SENSORS), len(_BINARY_SENSORS), len(_SWITCHES), len(_SELECTS),
            len(_COVERS), len(_LOCKS), len(_CLIMATES),
        )

    def _subscribe_commands(self, client) -> None:
        for obj_id, *_ in _SWITCHES:
            client.subscribe(_cmd_topic("switch", obj_id))
        for obj_id, *_ in _SELECTS:
            client.subscribe(_cmd_topic("select", obj_id))
        for obj_id, *_ in _COVERS:
            client.subscribe(_cmd_topic("cover", obj_id))
            client.subscribe(_sub_topic("cover", obj_id, "set_position"))
        for obj_id, *_ in _LOCKS:
            client.subscribe(_cmd_topic("lock", obj_id))
        for obj_id, *_ in _CLIMATES:
            client.subscribe(_sub_topic("climate", obj_id, "temp/set"))
            client.subscribe(_sub_topic("climate", obj_id, "mode/set"))

    # ── state publication ─────────────────────────────────────────────────────

    def _publish_states(self, m: dict) -> None:
        c = self._client
        for obj_id, *_, key in _SENSORS:
            val = m.get(key)
            if val is not None:
                c.publish(_state_topic("sensor", obj_id), str(val))

        for obj_id, *_, key in _BINARY_SENSORS:
            val = m.get(key)
            if val is not None:
                c.publish(_state_topic("binary_sensor", obj_id), "ON" if val else "OFF")

        # Mirror switch/select current state (reflects Modbus register)
        for obj_id, *_ in _SWITCHES:
            state = "ON" if self._switch_state.get(obj_id) else "OFF"
            c.publish(_state_topic("switch", obj_id), state)

        for obj_id, *_ in _SELECTS:
            state = self._select_state.get(obj_id, "W domu")
            c.publish(_state_topic("select", obj_id), state)

        # Auxiliary controllable devices — publish current state from metrics
        for obj_id, _name, pos_key in _COVERS:
            val = m.get(pos_key)
            if val is not None:
                c.publish(_sub_topic("cover", obj_id, "position"), str(int(val)))

        for obj_id, _name, state_key in _LOCKS:
            val = m.get(state_key)
            if val is not None:
                c.publish(_state_topic("lock", obj_id), str(val))

        for obj_id, _name, cur_key, tgt_key, mode_key, *_ in _CLIMATES:
            if (cur := m.get(cur_key)) is not None:
                c.publish(_sub_topic("climate", obj_id, "current"), str(cur))
            if (tgt := m.get(tgt_key)) is not None:
                c.publish(_sub_topic("climate", obj_id, "temp/state"), str(tgt))
            if (mode := m.get(mode_key)) is not None:
                c.publish(_sub_topic("climate", obj_id, "mode/state"), str(mode))


def enabled() -> bool:
    return _PAHO_OK and bool(MQTT_HOST)
