FROM python:3.12-slim

WORKDIR /app

# Install Python deps first so this layer is cached unless requirements change.
# numpy/pandas/scikit-learn/matplotlib all ship manylinux wheels, so no
# build toolchain is needed on python:3.12-slim.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code (runtime dirs and frontend are excluded via .dockerignore).
COPY run.py .
COPY ems_simulator/ ./ems_simulator/

# Modbus TCP server (MODBUS_PORT in ems_simulator/config.py)
EXPOSE 5020

# Flush stdout/stderr immediately so `docker logs` shows output in real time.
ENV PYTHONUNBUFFERED=1

# run.py loads .env if present, then starts the simulator. SIGTERM from
# `docker stop` is handled in main() for a graceful shutdown.
CMD ["python", "run.py"]
