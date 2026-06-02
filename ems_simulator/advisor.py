"""'Best time to run' advisor — picks the cheapest/greenest window to run a
deferrable appliance from the next-24h hourly price (RCE) + PV forecast.

Pure functions (no I/O); fed an hourly forecast and asked to recommend start
times. Exposed to the dashboard via the health server's /advisor endpoint.
"""

# (name, power W, run duration in whole hours)
DEFAULT_APPLIANCES = [
    {"name": "washer",     "power_w": 2000, "duration_h": 2},
    {"name": "dishwasher", "power_w": 1500, "duration_h": 1},
    {"name": "ev",         "power_w": 7400, "duration_h": 3},
]


def _window_cost(hours: list[dict], start: int, dur: int, power_w: float) -> float:
    """Grosze paid for running `power_w` for `dur` hours starting at index `start`
    (circular over the day). PV available in an hour offsets the grid import."""
    n = len(hours)
    cost = 0.0
    for k in range(dur):
        hr = hours[(start + k) % n]
        grid_w = max(0.0, power_w - float(hr.get("pv_w", 0)))
        cost += grid_w / 1000.0 * float(hr.get("price_gr", 0))   # kWh × gr/kWh
    return cost


def recommend(hours: list[dict], appliances: list[dict], now_hour: int) -> list[dict]:
    """For each appliance, the cheapest start hour vs starting now.

    `hours` is 24 dicts {hour, price_gr, pv_w} sorted by hour 0..23.
    """
    n = len(hours)
    if n == 0:
        return []
    pos = {int(h["hour"]): i for i, h in enumerate(hours)}
    now_idx = pos.get(int(now_hour) % 24, 0)

    out = []
    for app in appliances:
        dur = max(1, int(app["duration_h"]))
        power = float(app["power_w"])
        best_idx, best_cost = 0, None
        for i in range(n):
            c = _window_cost(hours, i, dur, power)
            if best_cost is None or c < best_cost:
                best_cost, best_idx = c, i
        cost_now = _window_cost(hours, now_idx, dur, power)
        out.append({
            "name": app["name"],
            "power_w": app["power_w"],
            "duration_h": dur,
            "best_hour": int(hours[best_idx]["hour"]),
            "cost_gr": round(best_cost or 0),
            "cost_now_gr": round(cost_now),
            "saving_gr": round(max(0.0, cost_now - (best_cost or 0))),
        })
    return out
