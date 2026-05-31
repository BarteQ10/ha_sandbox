FROM python:3.12-slim

WORKDIR /app

# Install Python deps first so this layer is cached unless requirements change.
# numpy/pandas/scikit-learn/matplotlib all ship manylinux wheels, so no
# build toolchain is needed on python:3.12-slim.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code (runtime dirs and frontend are excluded via .dockerignore).
COPY run.py .
COPY backtest.py .
COPY ems_simulator/ ./ems_simulator/
COPY rl/ ./rl/

# Modbus TCP server (5020) + health/metrics HTTP (8088, serves /backtest)
EXPOSE 5020 8088

# Flush stdout/stderr immediately so `docker logs` shows output in real time.
ENV PYTHONUNBUFFERED=1

# run.py loads .env if present, then starts the simulator. SIGTERM from
# `docker stop` is handled in main() for a graceful shutdown.
CMD ["python", "run.py"]
