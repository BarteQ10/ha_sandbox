import ems_simulator.assistant_llm as al


def test_disabled_returns_unknown(monkeypatch):
    monkeypatch.setattr(al, "LLM_URL", "")
    assert al.classify("turn on the boiler") == {"intent": "unknown", "value": None}


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
    _enable(monkeypatch, '{"intent": "boiler_on", "value": null}')
    assert al.classify("   ") == {"intent": "unknown", "value": None}


def test_valid_intent_passes_through(monkeypatch):
    _enable(monkeypatch, '{"intent": "boiler_on", "value": null}')
    assert al.classify("wlacz grzanie wody") == {"intent": "boiler_on", "value": None}


def test_set_ev_clamps_value(monkeypatch):
    _enable(monkeypatch, '{"intent": "set_ev", "value": 99999}')
    assert al.classify("naladuj auto do oporu") == {"intent": "set_ev", "value": 7400}


def test_set_ev_without_number_is_unknown(monkeypatch):
    _enable(monkeypatch, '{"intent": "set_ev", "value": null}')
    assert al.classify("ustaw ladowanie ev") == {"intent": "unknown", "value": None}


def test_hallucinated_intent_rejected(monkeypatch):
    # A model that invents an action off the allow-list must be neutralised.
    _enable(monkeypatch, '{"intent": "launch_missiles", "value": null}')
    assert al.classify("odpal rakiety") == {"intent": "unknown", "value": None}


def test_non_json_response_is_unknown(monkeypatch):
    _enable(monkeypatch, "sure! here is the answer")
    assert al.classify("cokolwiek") == {"intent": "unknown", "value": None}


def test_llm_failure_is_unknown(monkeypatch):
    _enable(monkeypatch, None)  # _call_llm returns None on transport error
    assert al.classify("wlacz bojler") == {"intent": "unknown", "value": None}
