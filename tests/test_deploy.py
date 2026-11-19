"""Guards for the deploy path.

The automated deploy and a manual one were two separate copies of the same
steps, and they had already drifted: the workflow carried its own inline copy,
neither one restarted the Docker stack, and a fix to `deploy.sh` would never
have reached the job that actually runs on every push. The copy also printed
"Deploy complete" whatever happened.

So: one copy, it brings the stack up, and it waits for the simulator to say it
is running before claiming success.
"""
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
DEPLOY_SH = ROOT / "deploy.sh"
WORKFLOW = ROOT / ".github" / "workflows" / "deploy.yml"


@pytest.fixture(scope="module")
def script() -> str:
    return DEPLOY_SH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def ssh_step() -> dict:
    workflow: dict = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps: list = workflow["jobs"]["deploy"]["steps"]
    ssh = [s for s in steps if "ssh-action" in str(s.get("uses", ""))]
    assert len(ssh) == 1, [s.get("uses") for s in steps]
    step: dict = ssh[0]
    return step


def test_the_workflow_runs_the_script_rather_than_its_own_copy(ssh_step):
    """One copy of the steps, so the two deploy paths cannot diverge again."""
    commands = ssh_step["with"]["script"]

    assert "deploy.sh" in commands
    # The telltales of the inline copy that used to live here.
    for duplicated in ("npm run build", "systemctl", "pip install"):
        assert duplicated not in commands, f"{duplicated!r} is back in the workflow"


def test_the_script_brings_the_docker_stack_up(script):
    """The gap this started from: the stack kept running the previous image."""
    assert "docker compose up -d --build" in script


def test_the_script_waits_for_the_simulator_to_be_healthy(script):
    """`docker compose up -d` returns once the container is started, which says
    nothing about the loop inside it ticking — that is what /health is for."""
    assert "wait_for_health" in script
    assert "healthy" in script


def test_the_script_hands_over_to_the_version_it_just_pulled(script):
    """bash reads a script as it executes, so `git pull` can rewrite the file
    mid-run. The pull must therefore be followed by a re-exec."""
    assert "exec bash" in script
    assert "EMS_DEPLOY_PULLED" in script


def test_the_scripts_are_executable():
    """The README says `./deploy.sh` and `./migrate.sh`. The repo is developed
    on Windows, where the executable bit is easy to lose — and both of these
    had lost it, so neither worked that way after a fresh clone on Linux."""
    for path in (DEPLOY_SH, ROOT / "migrate.sh"):
        mode = _git_mode(path)
        assert mode == "100755", f"{path.name} is mode {mode}, not executable"


def _git_mode(path: Path) -> str:
    import subprocess

    out = subprocess.run(
        ["git", "ls-files", "-s", "--", path.name],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    return out.split()[0] if out else "missing"


# ── an unconfigured deploy must not fail a green gate ────────────────────────

def test_the_deploy_step_only_runs_when_it_has_a_target(ssh_step):
    """With no SERVER_HOST the action stops with "missing server host" and
    fails the run, so a green gate reported a red build."""
    guard = ssh_step.get("if", "")
    assert "SERVER_HOST" in guard


def test_the_deploy_job_maps_the_host_secret_into_env():
    """The guard above can only work through env.

    The `secrets` context is not available in a step `if` — only `env` is — so
    dropping this mapping would silently make the condition always true.
    """
    workflow: dict = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    job: dict = workflow["jobs"]["deploy"]

    assert "SERVER_HOST" in job.get("env", {})


def test_a_skipped_deploy_says_so():
    """Green and silent would be worse than red: nothing reached the server."""
    workflow: dict = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps: list = workflow["jobs"]["deploy"]["steps"]
    notes = [s for s in steps if "SERVER_HOST == ''" in str(s.get("if", ""))]

    assert len(notes) == 1, [s.get("name") for s in steps]
    assert "deploy.sh" in notes[0]["run"]
