"""Deployment guards for docker-compose.yml.

The simulator's resilience story has two halves, and both live in the compose
file: `restart: unless-stopped` catches the process exiting (which main() does
deliberately after MAX_CONSECUTIVE_TICK_ERRORS), and the healthcheck catches
the other failure — a loop that is still alive but no longer ticking, which
/health reports as 503 once its telemetry goes stale. Losing either one is
silent, so they are asserted here.
"""
import re
from pathlib import Path

import pytest
import yaml

COMPOSE = Path(__file__).resolve().parent.parent / "docker-compose.yml"

# An exact pin names a patch release (2.7.12, 1.31.1-alpine, 2026.5.3,
# v1.104.7) or carries a digest. A tag like "2" or "alpine" moves under you, so
# one `docker compose pull` can cross releases and their breaking changes
# unannounced — which is the whole reason the rest of these are pinned.
_EXACT_TAG = re.compile(r":[^:/]*\d+\.\d+\.\d+|@sha256:[0-9a-f]{64}")

# The one service that cannot be pinned yet, with the reason in the compose
# file beside it: the deployed image reports 2.1.2 and Docker Hub publishes no
# 2.1.x tag, so there is no exact tag to name and 2.0.22 would be a downgrade.
UNPINNABLE = {"mosquitto"}


@pytest.fixture(scope="module")
def simulator_service() -> dict:
    compose: dict = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    services: dict = compose["services"]
    assert "ems-simulator" in services, sorted(services)
    service: dict = services["ems-simulator"]
    return service


def test_the_simulator_is_restarted_when_it_exits(simulator_service):
    assert simulator_service.get("restart") == "unless-stopped"


def test_the_simulator_has_a_healthcheck(simulator_service):
    """Without one, a wedged-but-running simulator is never even reported."""
    assert "healthcheck" in simulator_service


def test_the_healthcheck_polls_the_health_endpoint(simulator_service):
    """It has to hit /health specifically: that is the endpoint that knows the
    telemetry has gone stale, and the only one reachable without a token."""
    probe = " ".join(simulator_service["healthcheck"]["test"])
    assert "/health" in probe
    assert "8088" in probe          # HEALTH_PORT's default, as published above


def test_the_healthcheck_gives_the_simulator_time_to_start(simulator_service):
    """fit_all() and the InfluxDB event replay run before the first tick, so a
    probe that starts immediately would mark a healthy boot as failing."""
    assert simulator_service["healthcheck"].get("start_period")


# ── image pinning ────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def services() -> dict:
    compose: dict = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    loaded: dict = compose["services"]
    return loaded


def test_every_image_is_pinned_to_an_exact_version(services):
    floating = sorted(
        name for name, svc in services.items()
        if svc.get("image") and not _EXACT_TAG.search(svc["image"])
    )
    assert floating == sorted(UNPINNABLE), (
        "a floating tag crossed a release unannounced the last time this "
        "drifted; pin it, or add it to UNPINNABLE with the reason in the "
        "compose file"
    )


def test_the_unpinnable_service_explains_itself_in_the_file():
    """An exception is only acceptable while the reason is written down."""
    text = COMPOSE.read_text(encoding="utf-8")
    assert "Deliberately NOT pinned" in text
    assert "2.1.2" in text        # the version that has no published tag
