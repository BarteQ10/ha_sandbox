#!/usr/bin/env python3
"""EMS Simulator — entry point.

Usage:
    python run.py
"""
import os
import sys

# Load .env if present (python-dotenv optional — falls back to env vars or defaults).
# A .env that exists but cannot be loaded is worse than no .env at all: every
# secret and setting in it is silently ignored, and the simulator then runs on
# defaults while looking configured. So say it loudly instead of passing.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")):
        print("[WARN] .env exists but python-dotenv is not installed — NOTHING in it "
              "is being loaded (HEALTH_TOKEN, INFLUX_TOKEN, VAPID keys, ...).\n"
              "       Fix: pip install -r requirements.txt",
              file=sys.stderr)

from ems_simulator.main import main

if __name__ == "__main__":
    main()
