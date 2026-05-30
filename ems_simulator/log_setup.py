"""Central logging configuration for the simulator.

Call `setup()` once at process startup (run.py / ml_forecast.py). Modules just
do `log = logging.getLogger(__name__)` and log normally.

Level can be overridden with the LOG_LEVEL env var (e.g. LOG_LEVEL=DEBUG).
"""
import logging
import os


def setup(level=None):
    level = level or os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
