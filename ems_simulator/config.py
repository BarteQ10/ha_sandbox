import datetime

# Modbus
MODBUS_HOST = "0.0.0.0"
MODBUS_PORT = 5020
NUM_REGISTERS = 18
TICK_S = 5

# Location (Open-Meteo, no API key)
LAT = 52.23
LON = 21.01
WEATHER_URL = (
    f"https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    f"&hourly=shortwave_radiation,temperature_2m,cloud_cover"
    f"&timezone=Europe/Warsaw&forecast_days=2"
)
# Same endpoint but with past_days for ML training data
WEATHER_ML_URL = (
    f"https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    f"&hourly=shortwave_radiation,temperature_2m,cloud_cover"
    f"&timezone=Europe/Warsaw&forecast_days=2&past_days={{days}}"
)

# PV system
PV_PEAK_KW = 5.0

# Battery (60x simulated-speed factor baked in)
BATTERY_KWH = 15.0
SOC_DELTA_DENOM = 1080.0
INVERTER_EFFICIENCY = 0.92  # Round-trip AC↔DC conversion loss (8%)

# Grid status
GRID_NORMAL = 0
GRID_BLACKOUT = 1
GRID_INSTABILITY = 2

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
