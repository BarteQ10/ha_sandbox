import datetime

from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

URL = "http://localhost:8086"
TOKEN = "ems-token"
ORG = "home"
BUCKET = "ems"

_client = None
_write = None
_failed = False


def start():
    global _client, _write, _failed
    try:
        _client = InfluxDBClient(url=URL, token=TOKEN, org=ORG)
        _write = _client.write_api(write_options=SYNCHRONOUS)
        health = _client.health()
        print(f"[INFLUX] Connected (health: {health.status})")
        _failed = False
    except Exception as e:
        print(f"[INFLUX] Connection failed: {e}")
        _failed = True


def write(pv, soc, load, price, balance, temp, cloud=None, ghi=None, peak_price=None, running_cost=None):
    global _failed
    if _failed or _write is None:
        return

    now = datetime.datetime.utcnow()

    dt_h = 5.0 * 60.0 / 3600.0  # each tick = 5 simulated minutes = 1/12 h
    cost_pln = -balance * price * dt_h / (100.0 * 1000.0)

    try:
        points = [
            Point("sensor.sztuczna_produkcja_pv").time(now).field("value", float(pv)),
            Point("sensor.sztuczny_stan_baterii_soc").time(now).field("value", float(soc)),
            Point("sensor.ems_pobor_domu_bazowy").time(now).field("value", float(load)),
            Point("sensor.ems_biezaca_cena_energii").time(now).field("value", float(price)),
            Point("sensor.ems_moc_netto_bilans").time(now).field("value", float(balance)),
            Point("sensor.ems_koszt_chwilowy_pln").time(now).field("value", float(cost_pln)),
        ]
        if temp is not None:
            points.append(
                Point("sensor.current_temp").time(now).field("value", float(temp))
            )
        if cloud is not None:
            points.append(
                Point("sensor.cloud_cover").time(now).field("value", float(cloud))
            )
        if ghi is not None:
            points.append(
                Point("sensor.shortwave_radiation").time(now).field("value", float(ghi))
            )
        if peak_price is not None:
            points.append(
                Point("sensor.ems_szczyt_cena_dzis").time(now).field("value", float(peak_price))
            )
        if running_cost is not None:
            points.append(
                Point("sensor.ems_koszt_kumulatywny_dzis").time(now).field("value", float(running_cost))
            )

        _write.write(bucket=BUCKET, record=points)
    except Exception as e:
        print(f"[INFLUX] Write failed: {e}")
        _failed = True


def read_last(measurement):
    if _failed or _client is None:
        return None
    try:
        q = _client.query_api()
        result = q.query(
            f'from(bucket:"{BUCKET}") '
            f'|> range(start: today()) '
            f'|> filter(fn: (r) => r._measurement == "{measurement}") '
            f'|> last() '
            f'|> keep(columns: ["_value"])'
        )
        if result and len(result) > 0 and len(result[0].records) > 0:
            return result[0].records[0].get_value()
    except Exception as e:
        print(f"[INFLUX] Read last failed: {e}")
    return None


def stop():
    global _client
    if _client:
        _client.close()
        print("[INFLUX] Closed")
