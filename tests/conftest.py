"""Shared test preconditions.

Kept deliberately small: anything that is really about one module belongs in
that module's test file.
"""
import datetime

import pytest

import ems_simulator.pricing as pricing


@pytest.fixture(autouse=True)
def _prices_are_from_today(monkeypatch):
    """Treat whatever a test puts in pricing._price_cache as today's prices.

    The cache is only served for the day it was fetched for, so a test that
    seeds it has to say which day that is. Nearly every test means "today", and
    there are a dozen of them across test_charge_scheduler and test_forecasting,
    so the precondition lives here instead of in each one.

    This also removes an order dependency that predates the date stamp: a test
    calling pricing.fetch() left module state behind that later tests in the
    same session quietly relied on. Each test now starts from the same point.

    A test that is *about* the rollover (see test_pricing) patches _cache_date
    itself; monkeypatch unwinds in reverse, so its value wins for that test.
    """
    monkeypatch.setattr(pricing, "_cache_date", datetime.date.today())
