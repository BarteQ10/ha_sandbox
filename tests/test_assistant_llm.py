import ems_simulator.assistant_llm as al


def test_disabled_returns_unknown(monkeypatch):
    monkeypatch.setattr(al, "LLM_URL", "")
    assert al.classify("turn on the boiler") == {"intent": "unknown", "value": None, "room": None}


def test_enabled_reflects_url(monkeypatch):
    monkeypatch.setattr(al, "LLM_URL", "")
    assert al.enabled() is False
    monkeypatch.setattr(al, "LLM_URL", "http://localhost:1234/v1")
    assert al.enabled() is True


def _enable(monkeypatch, raw):
    """Enable the LLM and stub the network call to return `raw`."""
    monkeypatch.setattr(al, "LLM_URL", "http://localhost:1234/v1")
    monkeypatch.setattr(al, "_call_llm", lambda _text: raw)


def test_empty_text_short_circuits(monkeypatch):
    _enable(monkeypatch, '{"intent": "boiler_on", "value": null, "room": null}')
    assert al.classify("   ") == {"intent": "unknown", "value": None, "room": None}


def test_valid_intent_passes_through(monkeypatch):
    _enable(monkeypatch, '{"intent": "boiler_on", "value": null, "room": null}')
    assert al.classify("wlacz grzanie wody") == {"intent": "boiler_on", "value": None, "room": None}


def test_set_ev_clamps_value(monkeypatch):
    _enable(monkeypatch, '{"intent": "set_ev", "value": 99999, "room": null}')
    assert al.classify("naladuj auto do oporu") == {"intent": "set_ev", "value": 7400, "room": None}


def test_set_ev_without_number_is_unknown(monkeypatch):
    _enable(monkeypatch, '{"intent": "set_ev", "value": null, "room": null}')
    assert al.classify("ustaw ladowanie ev") == {"intent": "unknown", "value": None, "room": None}


def test_set_temp_clamps_to_range(monkeypatch):
    _enable(monkeypatch, '{"intent": "set_temp", "value": 99, "room": null}')
    assert al.classify("ustaw 99 stopni") == {"intent": "set_temp", "value": 30, "room": None}


def test_relative_temp_has_no_value(monkeypatch):
    _enable(monkeypatch, '{"intent": "temp_up", "value": null, "room": null}')
    assert al.classify("zrob cieplej") == {"intent": "temp_up", "value": None, "room": None}


def test_light_carries_the_room(monkeypatch):
    _enable(monkeypatch, '{"intent": "light_on", "value": null, "room": "kuchnia"}')
    assert al.classify("zapal swiatlo w kuchni") == {
        "intent": "light_on", "value": None, "room": "kuchnia",
    }


def test_light_with_invalid_room_falls_back_to_salon(monkeypatch):
    _enable(monkeypatch, '{"intent": "light_on", "value": null, "room": "garaz"}')
    assert al.classify("zapal swiatlo gdzies") == {
        "intent": "light_on", "value": None, "room": "salon",
    }


def test_blinds_carry_the_room(monkeypatch):
    _enable(monkeypatch, '{"intent": "blinds_close", "value": null, "room": "sypialnia"}')
    assert al.classify("zamknij rolety w sypialni") == {
        "intent": "blinds_close", "value": None, "room": "sypialnia",
    }


def test_heat_pump_intent_passes_through(monkeypatch):
    _enable(monkeypatch, '{"intent": "hp_boost", "value": null, "room": null}')
    assert al.classify("pompa na maksa") == {"intent": "hp_boost", "value": None, "room": None}


def test_grid_intent_passes_through(monkeypatch):
    _enable(monkeypatch, '{"intent": "grid_blackout", "value": null, "room": null}')
    assert al.classify("odlacz siec") == {"intent": "grid_blackout", "value": None, "room": None}


def test_media_intent_passes_through(monkeypatch):
    _enable(monkeypatch, '{"intent": "media_pause", "value": null, "room": null}')
    assert al.classify("wstrzymaj muzyke") == {"intent": "media_pause", "value": None, "room": None}


def test_media_volume_clamps(monkeypatch):
    _enable(monkeypatch, '{"intent": "media_set_volume", "value": 250, "room": null}')
    assert al.classify("ustaw glosnosc maksymalnie") == {
        "intent": "media_set_volume", "value": 100, "room": None,
    }


def test_hallucinated_intent_rejected(monkeypatch):
    # A model that invents an action off the allow-list must be neutralised.
    _enable(monkeypatch, '{"intent": "launch_missiles", "value": null, "room": null}')
    assert al.classify("odpal rakiety") == {"intent": "unknown", "value": None, "room": None}


def test_non_json_response_is_unknown(monkeypatch):
    _enable(monkeypatch, "sure! here is the answer")
    assert al.classify("cokolwiek") == {"intent": "unknown", "value": None, "room": None}


def test_llm_failure_is_unknown(monkeypatch):
    _enable(monkeypatch, None)  # _call_llm returns None on transport error
    assert al.classify("wlacz bojler") == {"intent": "unknown", "value": None, "room": None}
