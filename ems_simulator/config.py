
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
PV_PEAK_KW = 5.0        # total installed peak (sum of all strings)
INVERTER_MAX_W = 5000   # Max AC output of inverter (clipping)

# Multiple PV strings — each entry: (name, peak_kw, tilt_deg, azimuth_deg)
# azimuth_deg: 0=North, 90=East, 180=South, 270=West
# Set to None to use the legacy single-string model (PV_PEAK_KW, south-facing).
PV_STRINGS = [
    ("South",  3.0, 35, 180),  # 3 kW south-facing, 35° tilt
    ("West",   2.0, 30, 270),  # 2 kW west-facing, 30° tilt — extends afternoon output
]

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
# (name, power_w, duration_h, window_start_h, window_end_h, price_threshold_gr)
# price_threshold_gr: appliance waits for price <= threshold before starting;
#                     0 = start as soon as window opens (legacy behaviour).
#                     If < 2 h remain in window the appliance starts regardless.
SCHEDULED_APPLIANCES = [
    ("Washer",       2000, 1.5,  8, 22, 45),   # waits for cheap daytime slot
    ("Dishwasher",   1500, 1.0, 22,  6, 30),   # night cheap window
    ("Tumble Dryer", 2500, 1.0,  8, 22, 40),   # price-sensitive daytime
    ("Water Heater", 2000, 0.5,  0,  6, 25),   # cheap overnight top-up
    ("EV Preheat",   1500, 0.5,  5,  7,  0),   # fixed early-morning (departs 07:00)
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

# House thermal model (RC)
HOUSE_THERMAL_MASS_KWH_PER_C = 8.0   # kWh/°C — thermal mass (masonry, 150 m²)
HOUSE_UA_W_PER_C = 80.0              # W/°C — total heat loss coefficient (well-insulated)
HOUSE_SETPOINT_C = 20.0              # thermostat target temperature
HOUSE_DEAD_BAND_C = 0.5             # HP turns on at setpoint-deadband, off at setpoint+deadband
HOUSE_INITIAL_TEMP_C = 20.0

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
