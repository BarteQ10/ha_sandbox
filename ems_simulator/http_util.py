"""Shared HTTP helper with bounded retries + exponential backoff.

Callers (weather.py, pricing.py) still wrap this in try/except and fall back to
synthetic data — the retries just give a transient network/API blip a few
chances before that fallback kicks in.
"""
import logging
import time

import requests

log = logging.getLogger(__name__)


def get_json(url, params=None, timeout=10, retries=3, backoff=1.0):
    """GET `url` and return parsed JSON, retrying on failure.

    Waits `backoff * 2**(attempt-1)` seconds between attempts. Raises the last
    exception if every attempt fails.
    """
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_exc = e
            if attempt < retries:
                wait = backoff * (2 ** (attempt - 1))
                log.warning("GET failed (attempt %d/%d): %s — retrying in %.1fs",
                            attempt, retries, e, wait)
                time.sleep(wait)
            else:
                log.error("GET failed after %d attempts: %s", retries, e)
    raise last_exc
