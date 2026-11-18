"""Deployment guards for docker-compose.yml.

The simulator's resilience story has two halves, and both live in the compose
file: `restart: unless-stopped` catches the process exiting (which main() does
deliberately after MAX_CONSECUTIVE_TICK_ERRORS), and the healthcheck catches
the other failure — a loop that is still alive but no longer ticking, which
/health reports as 503 once its telemetry goes stale. Losing either one is
silent, so they are asserted here.
"""
from pathlib import Path

import pytest
import yaml

COMPOSE = Path(__file__).resolve().parent.parent / "docker-compose.yml"


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
