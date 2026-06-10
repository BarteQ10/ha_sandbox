# Re-attach the Zigbee coordinator to Docker and start Zigbee2MQTT.
# Windows + Docker Desktop: the usbipd attach does NOT survive a reboot or a
# stick replug, and the docker-desktop WSL kernel does not auto-load cp210x.
# Run this after every Windows restart (the one-time `usbipd bind` persists).
#
# Find the BUSID with:  & "C:\Program Files\usbipd-win\usbipd.exe" list
# (it changes if you move the stick to a different USB port)
param([string]$BusId = "3-1")

$usbipd = "C:\Program Files\usbipd-win\usbipd.exe"
& $usbipd attach --wsl --busid $BusId
wsl -d docker-desktop modprobe cp210x
docker compose --profile zigbee up -d zigbee2mqtt
docker logs ems_zigbee2mqtt --tail 5
