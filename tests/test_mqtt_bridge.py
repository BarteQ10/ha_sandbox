"""Virtual-device groups: which simulated devices reach Home Assistant.

The simulator publishes ~37 devices over MQTT autodiscovery, and every config it
publishes is RETAINED by the broker. So switching a virtual device off is not
enough — HA keeps the entity forever as "unavailable" unless it is explicitly
un-announced with an empty payload on the same discovery topic. That is the part
these tests guard, because it is the difference between retiring a dummy device
and leaving a ghost behind.

The bridge is driven with a fake client, so these run with no broker and without
paho-mqtt installed.
"""
import json
import subprocess
import sys

import pytest

import ems_simulator.mqtt_bridge as bridge

TABLES: list[tuple[str, list]] = [
    ("sensor", bridge._SENSORS),
    ("binary_sensor", bridge._BINARY_SENSORS),
    ("switch", bridge._SWITCHES),
    ("select", bridge._SELECTS),
    ("cover", bridge._COVERS),
    ("lock", bridge._LOCKS),
    ("climate", bridge._CLIMATES),
    ("switch", bridge._AUX_SWITCHES),
    ("fan", bridge._FANS),
    ("vacuum", bridge._VACUUMS),
]
ALL_IDS = [row[0] for _component, table in TABLES for row in table]


class _FakeClient:
    def __init__(self):
        self.published: list[tuple[str, object, bool]] = []
        self.subscribed: list[str] = []

    def publish(self, topic, payload=None, retain=False):
        self.published.append((topic, payload, retain))

    def subscribe(self, topic):
        self.subscribed.append(topic)

    # helpers
    def payload_for(self, topic):
        return next(p for t, p, _ in self.published if t == topic)

    def topics(self):
        return [t for t, _, _ in self.published]


def _bridge(enabled_ids):
    b = bridge.MQTTBridge(write_register_fn=lambda *a: None, command_fn=lambda *a: None)
    b._on = set(enabled_ids)
    return b


# ── the group map must stay honest as entities are added ──────────────────────

def test_every_entity_belongs_to_exactly_one_group():
    """A new entity that nobody put in a group would silently never publish."""
    for obj_id in ALL_IDS:
        owning = [g for g, ids in bridge._GROUPS.items() if obj_id in ids]
        assert len(owning) == 1, f"{obj_id} is in groups {owning}, expected exactly one"


def test_no_group_lists_an_entity_that_does_not_exist():
    """The other direction: a renamed entity must not leave a stale id behind."""
    known = set(ALL_IDS)
    for group, ids in bridge._GROUPS.items():
        unknown = sorted(ids - known)
        assert not unknown, f"group {group!r} lists unknown entities {unknown}"


def test_all_groups_are_on_by_default():
    assert bridge.enabled_ids() == set(ALL_IDS)


def test_an_unknown_entry_is_ignored_rather_than_crashing(monkeypatch, caplog):
    monkeypatch.setattr(bridge, "SIM_DEVICES", ["energy", "typo"])
    with caplog.at_level("WARNING"):
        ids = bridge.enabled_ids()
    assert ids == bridge._GROUPS["energy"]
    assert "typo" in caplog.text


# ── groups, single devices, and taking them back out ──────────────────────────

def test_a_single_device_id_works_as_an_entry(monkeypatch):
    monkeypatch.setattr(bridge, "SIM_DEVICES", ["energy", "trv_living"])
    assert bridge.enabled_ids() == bridge._GROUPS["energy"] | {"trv_living"}


def test_a_group_minus_one_device(monkeypatch):
    monkeypatch.setattr(bridge, "SIM_DEVICES", ["security", "-smoke"])
    ids = bridge.enabled_ids()
    assert "smoke" in bridge._GROUPS["security"]      # it really is in there
    assert ids == bridge._GROUPS["security"] - {"smoke"}


def test_only_exclusions_start_from_everything(monkeypatch):
    """`-smoke,-co` plainly means "the fakes except those two" — which is what
    you write the day two real detectors arrive."""
    monkeypatch.setattr(bridge, "SIM_DEVICES", ["-smoke", "-co"])
    assert bridge.enabled_ids() == set(ALL_IDS) - {"smoke", "co"}


def test_a_removal_wins_whatever_the_order(monkeypatch):
    for entries in (["security", "-smoke"], ["-smoke", "security"]):
        monkeypatch.setattr(bridge, "SIM_DEVICES", entries)
        assert "smoke" not in bridge.enabled_ids()


def test_excluding_a_whole_group(monkeypatch):
    monkeypatch.setattr(bridge, "SIM_DEVICES", ["-air", "-meters"])
    ids = bridge.enabled_ids()
    assert not (ids & (bridge._GROUPS["air"] | bridge._GROUPS["meters"]))
    assert bridge._GROUPS["energy"] <= ids


def test_listing_a_device_twice_is_harmless(monkeypatch):
    monkeypatch.setattr(bridge, "SIM_DEVICES", ["security", "smoke", "security"])
    assert bridge.enabled_ids() == bridge._GROUPS["security"]


def test_the_real_door_and_window_sensors_case(monkeypatch):
    """The actual migration this exists for: real Zigbee contacts are installed,
    so those two fakes go, while the simulated smoke/CO/leak/motion stay."""
    monkeypatch.setattr(bridge, "SIM_DEVICES",
                        ["security", "-window_living", "-door_entrance"])

    ids = bridge.enabled_ids()

    assert ids == {"motion_outdoor", "motion_indoor", "leak_kitchen", "smoke",
                   "co", "doorbell", "lock_entrance"}


def test_nothing_enabled_when_the_list_is_empty(monkeypatch):
    monkeypatch.setattr(bridge, "SIM_DEVICES", [])
    assert bridge.enabled_ids() == set()


# ── retiring a device removes it from Home Assistant ──────────────────────────

def test_a_retired_device_is_un_announced_with_an_empty_payload():
    """An empty retained payload is how HA is told to forget an entity."""
    b = _bridge(bridge._GROUPS["energy"])          # only energy stays
    client = _FakeClient()

    b._publish_discovery(client)

    kept = bridge._disc_topic("sensor", "pv_w")             # energy
    retired = bridge._disc_topic("sensor", "co2_ppm")       # air
    assert json.loads(b and client.payload_for(kept))["name"] == "PV Production"
    assert client.payload_for(retired) == ""
    # both are retained: the removal has to stick as hard as the announcement did
    assert all(retain for topic, _, retain in client.published
               if topic in (kept, retired))


def test_every_entity_gets_a_discovery_topic_either_way():
    """Enabled or retired, each entity is addressed once — otherwise an old
    retained config would linger for whatever we simply skipped."""
    b = _bridge([])                                 # everything retired
    client = _FakeClient()

    b._publish_discovery(client)

    for component, table in TABLES:
        for row in table:
            assert bridge._disc_topic(component, row[0]) in client.topics()
    assert {p for _, p, _ in client.published} == {""}


def test_disabling_everything_retires_all_of_them():
    b = _bridge([])
    client = _FakeClient()
    b._publish_discovery(client)
    assert len(client.published) == len(ALL_IDS)


# ── retired devices go quiet ──────────────────────────────────────────────────

def test_a_retired_device_gets_no_state_updates():
    b = _bridge(bridge._GROUPS["energy"])
    client = _FakeClient()
    b._client = client

    b._publish_states({"pv_w": 1234, "co2_ppm": 800, "humidity_pct": 55})

    topics = client.topics()
    assert bridge._state_topic("sensor", "pv_w") in topics
    assert bridge._state_topic("sensor", "co2_ppm") not in topics
    assert bridge._state_topic("sensor", "humidity_pct") not in topics


def test_a_retired_device_is_not_subscribed_for_commands():
    """No point listening for commands to a device HA no longer shows."""
    b = _bridge(bridge._GROUPS["energy"])           # v2g_mode in, the rest out
    client = _FakeClient()

    b._subscribe_commands(client)

    assert bridge._cmd_topic("switch", "v2g_mode") in client.subscribed
    assert bridge._cmd_topic("cover", "gate") not in client.subscribed
    assert bridge._cmd_topic("lock", "lock_entrance") not in client.subscribed
    assert bridge._cmd_topic("vacuum", "vacuum") not in client.subscribed


def test_controllable_devices_are_subscribed_when_their_group_is_on():
    b = _bridge(bridge._GROUPS["appliances"] | bridge._GROUPS["security"])
    client = _FakeClient()

    b._subscribe_commands(client)

    for topic in (bridge._cmd_topic("cover", "gate"),
                  bridge._cmd_topic("cover", "garage"),
                  bridge._cmd_topic("lock", "lock_entrance"),
                  bridge._cmd_topic("fan", "fan_living"),
                  bridge._cmd_topic("vacuum", "vacuum"),
                  bridge._cmd_topic("switch", "irrigation")):
        assert topic in client.subscribed


# ── the env override, which is parsed at import time ──────────────────────────

@pytest.mark.parametrize("value,expected_groups", [
    ("", 6),                    # unset: everything
    ("energy,house", 2),
    ("energy, house ", 2),      # tolerates spacing
    ("none", 0),
    ("off", 0),
])
def test_the_env_override_selects_groups(value, expected_groups):
    """EMS_SIM_DEVICES is read when config is imported, so this needs a fresh
    interpreter rather than a monkeypatch."""
    code = "import ems_simulator.config as c; print(len(c.SIM_DEVICES))"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                         env={"EMS_SIM_DEVICES": value, "PYTHONPATH": "C:/ha_sandbox",
                              "PYTHONUTF8": "1", "SYSTEMROOT": "C:/Windows"},
                         cwd="C:/ha_sandbox", check=True)
    assert int(out.stdout.strip()) == expected_groups
