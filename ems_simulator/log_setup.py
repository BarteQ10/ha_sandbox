"""Central logging configuration for the simulator.

Call `setup()` once at process startup (run.py / ml_forecast.py). Modules just
do `log = logging.getLogger(__name__)` and log normally.

Level can be overridden with the LOG_LEVEL env var (e.g. LOG_LEVEL=DEBUG).
"""
import contextlib
import logging
import os
import sys


def _force_utf8_streams() -> None:
    """Make stdout/stderr tolerate non-ASCII output.

    A Windows console defaults to a legacy code page (cp1250 here), which
    cannot encode characters used in the register banner and in log messages.
    Without this, `print()` raises UnicodeEncodeError and kills the simulator
    before the loop starts. Streams that cannot be reconfigured (pytest
    capture, already-detached buffers) are left as they are.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        with contextlib.suppress(ValueError, OSError):
            reconfigure(encoding="utf-8", errors="replace")


def setup(level=None):
    _force_utf8_streams()
    level = level or os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
