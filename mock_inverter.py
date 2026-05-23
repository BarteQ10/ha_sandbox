import time
import random
from pyModbusTCP.server import ModbusServer

server = ModbusServer("0.0.0.0", port=5020, no_block=True)
server.start()

print("==================================================")
print("  WIRTUALNY INWERTER EMS v3 (DYNAMICZNY BILANS)")
print("  Adres: localhost:5020")
print("  [R] Rejestr 0 (40001): Produkcja PV (W)")
print("  [R] Rejestr 1 (40002): Stan baterii SoC (%)")
print("  [W] Rejestr 2 (40003): Force Charge (0=Auto, 1=Wymuszone)")
print("  [W] Rejestr 3 (40004): Status Bojlera (0=Off, 1=On - pobór 3000W)")
print("==================================================")

# Inicjalizacja: PV=0, SoC=100 (zaczynamy od pełnej baterii), Force=0, Bojler=0
server.data_bank.set_holding_registers(0, [0, 100, 0, 0])

# Prosty licznik kroków do symulacji cyklu dnia i nocy (24 kroki = 1 doba)
krok_doby = 0

try:
    while True:
        words = server.data_bank.get_holding_registers(0, 4)
        if not words:
            time.sleep(5)
            continue
            
        current_soc = words[1]
        force_charge_status = words[2]
        bojler_status = words[3]
        
        # 1. Symulacja cyklu dnia i nocy dla PV
        krok_doby = (krok_doby + 1) % 24
        if 6 <= krok_doby <= 18:  # Godziny dzienne
            # Generujemy ładne słońce w szczycie dnia
            base_pv = 3500 if 10 <= krok_doby <= 14 else 1500
            new_pv = random.randint(base_pv - 300, base_pv + 300)
        else:                     # Noc
            new_pv = 0
            
        # 2. Wyliczanie zużycia domu
        # Bazowe zużycie (lodówka, komputery, światło)
        dom_consumption = random.randint(400, 600) 
        
        # Jeśli Home Assistant włączył wirtualny bojler, dodajemy 3000W obciążenia!
        if bojler_status == 1:
            dom_consumption += 3000
            
        # 3. BILANS ENERGETYCZNY (Netto)
        bilans = new_pv - dom_consumption
        
        # 4. WPŁYW NA BATERIĘ (SoC)
        if force_charge_status == 1:
            # Wymuszone ładowanie z sieci (ignorujemy bilans, ładujemy na maksa)
            new_soc = min(100, current_soc + 5)
            print(f"[EMS] FORCE CHARGE z sieci! SoC: {new_soc}%")
        else:
            # Tryb automatyczny - zależny od bilansu słońca i domu
            if bilans > 0:
                # Mamy nadwyżkę energii! Ładujemy baterię
                if current_soc < 100:
                    new_soc = min(100, current_soc + 1)
                    print(f"[PV] Nadwyżka: +{bilans}W. Ładowanie baterii -> SoC: {new_soc}%")
                else:
                    new_soc = 100
                    print(f"[SŁOŃCE] Bateria pełna (100%). Nadwyżka {bilans}W oddawana do sieci!")
            else:
                # Mamy deficyt prądu! Dom zużywa więcej niż daje PV
                if current_soc > 0:
                    # Bateria rozładowuje się, pokrywając zapotrzebowanie domu
                    # Jeśli włączony jest duży odbiór (bojler), spada szybciej (-3% zamiast -1%)
                    spadek = 3 if bojler_status == 1 else 1
                    new_soc = max(0, current_soc - spadek)
                    print(f"[BAT] Deficyt: {bilans}W. Rozładowywanie baterii -> SoC: {new_soc}%")
                else:
                    new_soc = 0
                    print(f"[SIEĆ] Bateria pusta (0%)! Pobierasz {-bilans}W z sieci handlowej PGE!")

        # Zapis stanu do rejestrów (zachowując flagi zapisu z HA)
        server.data_bank.set_holding_registers(0, [new_pv, new_soc, force_charge_status, bojler_status])
        
        time.sleep(5)

except KeyboardInterrupt:
    server.stop()