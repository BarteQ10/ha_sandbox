#!/usr/bin/env python3
"""EMS Simulator — entry point.

Usage:
    python run.py
"""
import os

# Load .env if present (python-dotenv optional — falls back to env vars or defaults)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from ems_simulator.main import main

if __name__ == "__main__":
    main()
