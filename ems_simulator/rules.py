"""Presence-aware rule engine — fires events when conditions are met."""
import logging
import random
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ems_simulator.generators import ScheduledAppliance

log = logging.getLogger(__name__)

ALL_RULE_KEYS: frozenset[str] = frozenset({"window_away", "laundry_done"})


@dataclass
class RuleEvent:
    key: str
    message: str
    severity: str  # "warning" | "info"


class RuleEngine:
    def __init__(self) -> None:
        self._active: dict[str, RuleEvent] = {}
        self._window_open = False
        self._window_ticks: int = 0

    # ── window simulation ─────────────────────────────────────────────────────

    def _sim_window(self, hour: float) -> bool:
        """Randomly open a window during daytime; close it at night."""
        if 8.0 <= hour < 20.0:
            if not self._window_open and random.random() < 0.0008:
                self._window_open = True
                self._window_ticks = random.randint(6, 48)
                log.info("[RULES] Simulated window opened (for ~%d ticks)", self._window_ticks)
            elif self._window_open:
                self._window_ticks -= 1
                if self._window_ticks <= 0:
                    self._window_open = False
                    log.info("[RULES] Simulated window closed")
        else:
            self._window_open = False
        return self._window_open

    # ── rule evaluation ───────────────────────────────────────────────────────

    def evaluate(
        self,
        hour: float,
        presence_mode: int,
        appliances: list["ScheduledAppliance"],
    ) -> list[RuleEvent]:
        from ems_simulator.presence import PRESENCE_AWAY, PRESENCE_VACATION

        away = presence_mode in (PRESENCE_AWAY, PRESENCE_VACATION)
        window_open = self._sim_window(hour)

        # Rule: window open while nobody is home
        if window_open and away:
            if "window_away" not in self._active:
                self._active["window_away"] = RuleEvent(
                    "window_away", "Window open while nobody is home!", "warning"
                )
                log.info("[RULES] window_away triggered")
        else:
            self._active.pop("window_away", None)

        # Rule: laundry done — Washer finished but nobody took out the clothes
        for appl in appliances:
            if appl.name == "Washer":
                if appl.state == "done" and "laundry_done" not in self._active:
                    self._active["laundry_done"] = RuleEvent(
                        "laundry_done", "Laundry done — please take out the clothes.", "info"
                    )
                    log.info("[RULES] laundry_done triggered")
                elif appl.state != "done":
                    self._active.pop("laundry_done", None)
                break

        return list(self._active.values())

    @property
    def active_keys(self) -> set[str]:
        return set(self._active.keys())
