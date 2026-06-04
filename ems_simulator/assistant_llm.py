"""Local-LLM intent classifier (9.E, layer 2).

Optional fallback for the frontend's rule-based command parser: when a phrase
isn't matched by the regex rules, the dashboard POSTs it to /assistant and this
module asks a *locally hosted* LLM (LM Studio / Ollama — OpenAI-compatible API)
to classify it into one of a fixed allow-list of intents, with a constrained
JSON schema so the model can't invent actions.

Disabled unless EMS_LLM_URL is set, mirroring the other optional integrations
(MQTT, Telegram, RL). No API keys — the model runs on the user's own machine.

  EMS_LLM_URL     base URL incl. /v1 (e.g. http://localhost:1234/v1)
  EMS_LLM_MODEL   model id (default: bielik-11b-v3.0-instruct)
  EMS_LLM_TIMEOUT request timeout in seconds (default: 20)
"""
import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

LLM_URL = os.environ.get("EMS_LLM_URL", "").rstrip("/")
LLM_MODEL = os.environ.get("EMS_LLM_MODEL", "bielik-11b-v3.0-instruct")
LLM_TIMEOUT = float(os.environ.get("EMS_LLM_TIMEOUT", "20"))

# The single source of truth for what the assistant may do. The frontend maps
# each intent to a concrete HA service call (lib/assistant.ts:intentToCommand).
INTENTS = (
    "boiler_on", "boiler_off",
    "light_on", "light_off",
    "inverter_auto", "inverter_charge", "inverter_discharge",
    "presence_home", "presence_away", "presence_vacation",
    "storm_on", "storm_off",
    "set_ev",
    "unknown",
)

EV_MIN_W, EV_MAX_W = 0, 7400

SYSTEM_PROMPT = (
    "Jestes klasyfikatorem intencji dla systemu EMS smart home. Zmapuj polecenie "
    "uzytkownika na DOKLADNIE jedna intencje i wartosc liczbowa (value).\n"
    "Znaczenie intencji:\n"
    "- boiler_on/boiler_off: bojler, grzalka, podgrzewanie/grzanie wody\n"
    "- light_on/light_off: swiatlo lub lampa w salonie\n"
    "- inverter_auto/inverter_charge/inverter_discharge: tryb falownika/inwertera "
    "(auto / wymuszone ladowanie / wymuszone rozladowanie baterii)\n"
    "- presence_home/presence_away/presence_vacation: tryb obecnosci "
    "(w domu / poza domem / urlop)\n"
    "- storm_on/storm_off: zabezpieczenie sztormowe (burzowe) baterii\n"
    "- set_ev: ustaw limit mocy ladowania samochodu elektrycznego; value = waty (0-7400)\n"
    "- unknown: nic nie pasuje\n"
    "value = liczba watow tylko dla set_ev, w innym wypadku null. Odpowiedz wylacznie JSON."
)

_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "ems_intent",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "intent": {"type": "string", "enum": list(INTENTS)},
                "value": {"type": ["integer", "null"]},
            },
            "required": ["intent", "value"],
            "additionalProperties": False,
        },
    },
}


def enabled() -> bool:
    """True when a local LLM endpoint is configured."""
    return bool(LLM_URL)


def _call_llm(text: str) -> str | None:
    """POST the chat request to the local OpenAI-compatible server; return the raw
    message content string, or None on any transport/HTTP error."""
    payload = {
        "model": LLM_MODEL,
        "temperature": 0,
        "max_tokens": 60,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "response_format": _SCHEMA,
    }
    req = urllib.request.Request(
        f"{LLM_URL}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"]["content"]
        return content if isinstance(content, str) else None
    except (urllib.error.URLError, OSError, KeyError, IndexError, ValueError) as e:
        log.warning("[ASSISTANT] LLM call failed: %s", e)
        return None


def classify(text: str) -> dict:
    """Classify free text into a validated {intent, value} dict.

    Always returns a dict; falls back to {"intent": "unknown", "value": None} when
    the LLM is disabled, unreachable, or returns anything off the allow-list.
    """
    text = (text or "").strip()
    if not text or not enabled():
        return {"intent": "unknown", "value": None}

    raw = _call_llm(text)
    if not raw:
        return {"intent": "unknown", "value": None}

    try:
        parsed = json.loads(raw)
    except ValueError:
        log.warning("[ASSISTANT] LLM returned non-JSON: %r", raw[:120])
        return {"intent": "unknown", "value": None}

    intent = parsed.get("intent")
    if intent not in INTENTS:
        return {"intent": "unknown", "value": None}

    value = None
    if intent == "set_ev":
        try:
            value = max(EV_MIN_W, min(EV_MAX_W, int(parsed.get("value"))))
        except (TypeError, ValueError):
            # set_ev without a usable number is not actionable.
            return {"intent": "unknown", "value": None}

    return {"intent": intent, "value": value}
