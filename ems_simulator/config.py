import datetime

# Modbus
MODBUS_HOST = "0.0.0.0"
MODBUS_PORT = 5020
NUM_REGISTERS = 18
TICK_S = 5

# Derived timing constants (60× simulated speed, TICK_S=5s → 5 simulated minutes per tick)
STEPS_PER_HOUR = 12    # ticks per simulated hour
STEPS_PER_DAY = 288    # ticks per simulated day

# Location (Open-Meteo, no API key)
LAT = 52.23
LON = 21.01
WEATHER_URL = (
    f"https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    f"&hourly=shortwave_radiation,temperature_2m,cloud_cover"
    f"&timezone=Europe/Warsaw&forecast_days=2"
)
# Same endpoint but with past_days for ML training data — call .format(days=N) to fill in
WEATHER_ML_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    "&hourly=shortwave_radiation,temperature_2m,cloud_cover"
    "&timezone=Europe/Warsaw&forecast_days=2&past_days={days}"
)

# PV system
PV_PEAK_KW = 5.0
INVERTER_MAX_W = 5000  # Max AC output of inverter (clipping)

# PV soiling / snow (seasonal loss factor)
SOILING_BASE_SUMMER = 0.96  # 4% loss in summer (dust)
SOILING_BASE_WINTER = 0.88  # 12% loss in winter (snow, dirt)
SNOW_EVENT_CHANCE = 0.002   # ~2% of winter ticks get snow cover
SNOW_RECOVERY_TICKS = 24    # 24 ticks = 2h simulated to recover from snow

# Battery (60x simulated-speed factor baked in)
BATTERY_KWH = 15.0
SOC_DELTA_DENOM = 1080.0
INVERTER_EFFICIENCY = 0.92  # Round-trip AC↔DC conversion loss (8%)
CALENDAR_AGING_PCT_PER_YEAR = 2.0  # capacity loss per year (calendar, not cycle)
BATTERY_CYCLE_LIFE = 6000  # equivalent full cycles to 80% SoH (LiFePO4 typical)

# HP COP (Coefficient of Performance) as function of outdoor temperature
# (temp_celsius, cop)
HP_COP_CURVE = [
    (-15, 1.5),
    (-10, 2.0),
    (-5, 2.5),
    (0, 3.0),
    (5, 3.5),
    (10, 4.0),
    (15, 4.5),
    (20, 5.0),
]

# Grid status
GRID_NORMAL = 0
GRID_BLACKOUT = 1
GRID_INSTABILITY = 2

# EV profile
EV_ARRIVAL_HOUR = 17
EV_DEPARTURE_HOUR = 7
EV_DAILY_KWH_NEEDED = 15.0  # kWh needed to fill the car each day
EV_CHARGE_MAX_W = 7400  # max charging power

# Scheduled deferrable appliances
# (name, power_w, duration_h, window_start_h, window_end_h)
SCHEDULED_APPLIANCES = [
    ("Washer", 2000, 1.5, 8, 22),
    ("Dishwasher", 1500, 1.0, 22, 6),
]

# Self-consumption priority (order to shed loads when grid import exceeds limit)
# Base load cannot be shed
PRIORITY_ORDER = ["EV", "HP", "Boiler"]

# Device minimum on/off times (simulated minutes) — anti-chattering
DEVICE_MIN_ON_SIM_MIN = 60
DEVICE_MIN_OFF_SIM_MIN = 60

# Load spikes
SPIKE_CHANCE = 0.03
SPIKE_WATTS = [2000, 2500, 3000, 5000, 7000]
SPIKE_MAX_TICKS = 4

# Distribution tariff (gr/kWh) — applies on import only
# Peak hours: higher rate, off-peak: lower rate
DISTRIBUTION_LOW = 12
DISTRIBUTION_HIGH = 28
# (hour_start, hour_end, rate_gr) — distribution rate applies when start <= hour < end
DISTRIBUTION_ZONES = [
    (0, 6, 12),
    (6, 13, 28),
    (13, 15, 12),
    (15, 22, 28),
    (22, 24, 12),
]

# Price bands: (hour_start, hour_end, min_gr, max_gr)
PRICE_BANDS = [
    (2, 5, 15, 25),
    (5, 8, 25, 40),
    (8, 13, 35, 55),
    (13, 16, 20, 35),
    (16, 22, 50, 80),
    (22, 24, 20, 35),
    (0, 2, 20, 35),
]
