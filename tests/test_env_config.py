"""Environment variables: one owner each, and every one of them documented.

Two kinds of drift this pins down, both of which had already happened:

* The four INFLUX_* settings were read in influx_writer.py, forecasting.py and
  backtest.py, each with its own copy of the defaults. backtest.py's comment
  claimed it "matches influx_writer.py" — nothing enforced that, so a changed
  default would have silently disagreed between the writer, the forecaster and
  the backtest.
* Five variables the code reads were missing from the README env table, so the
  only way to discover them was to grep the source.

Both only surface when something quietly behaves differently, which is exactly
what a cheap lint test is for.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# Production code only. Tests may read whatever they like.
SOURCES = sorted(
    set(ROOT.glob("ems_simulator/*.py")) | set(ROOT.glob("rl/*.py")) | set(ROOT.glob("*.py"))
)

_READ = re.compile(r"os\.(?:environ\.get|getenv)\(\s*[\"']([A-Z_][A-Z0-9_]*)[\"']")
_BACKTICKED = re.compile(r"`([A-Z_][A-Z0-9_]*)`")


def _env_reads() -> dict[str, list[str]]:
    """{VAR: [module, ...]} for every environment variable the code reads."""
    reads: dict[str, set[str]] = {}
    for path in SOURCES:
        for var in _READ.findall(path.read_text(encoding="utf-8")):
            reads.setdefault(var, set()).add(path.relative_to(ROOT).as_posix())
    return {var: sorted(mods) for var, mods in reads.items()}


def _documented() -> set[str]:
    """Every `VAR_NAME` appearing in a README markdown table row."""
    rows = [
        line for line in (ROOT / "README.md").read_text(encoding="utf-8").splitlines()
        if line.startswith("|")
    ]
    return set(_BACKTICKED.findall("\n".join(rows)))


READS = _env_reads()


def test_the_scan_actually_finds_variables():
    """Guards the regex: a silently empty scan would make everything below vacuous."""
    assert len(READS) > 15, f"only found {sorted(READS)} — did the scan pattern rot?"
    assert "HEALTH_TOKEN" in READS
    assert "INFLUX_URL" in READS


@pytest.mark.parametrize("var", sorted(READS))
def test_each_variable_is_read_in_exactly_one_module(var):
    modules = READS[var]
    assert len(modules) == 1, (
        f"{var} is read in {modules}. Give it one owner — put it in "
        f"ems_simulator/config.py and import it from there — so the default "
        f"cannot diverge between modules."
    )


@pytest.mark.parametrize("var", sorted(READS))
def test_each_variable_is_in_the_readme_env_table(var):
    assert var in _documented(), (
        f"{var} is read by the code but is in no README table row. Add it to the "
        f"environment-variable table with its default, or nobody will know it exists."
    )


def test_influx_settings_come_from_config():
    """The specific regression: three modules, three copies of four defaults."""
    import backtest
    import ems_simulator.config as config
    import ems_simulator.forecasting as forecasting
    import ems_simulator.influx_writer as influx_writer

    assert (influx_writer.URL, influx_writer.TOKEN, influx_writer.ORG, influx_writer.BUCKET) == (
        config.INFLUX_URL, config.INFLUX_TOKEN, config.INFLUX_ORG, config.INFLUX_BUCKET)
    assert (forecasting._URL, forecasting._TOKEN, forecasting._ORG, forecasting._BUCKET) == (
        config.INFLUX_URL, config.INFLUX_TOKEN, config.INFLUX_ORG, config.INFLUX_BUCKET)
    assert (backtest.URL, backtest.TOKEN, backtest.ORG, backtest.BUCKET) == (
        config.INFLUX_URL, config.INFLUX_TOKEN, config.INFLUX_ORG, config.INFLUX_BUCKET)


def test_backtest_uses_the_simulated_battery():
    """A backtest run on a different battery than the simulator reports savings
    for a system that does not exist."""
    import backtest
    import ems_simulator.config as config

    assert backtest.BATTERY_KWH == config.BATTERY_KWH
    assert backtest.EFFICIENCY == config.INVERTER_EFFICIENCY
