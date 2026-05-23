# KONTEKST PROJEKTU: Inteligentny Dom & System EMS (Polska)

## 1. Profil i Cele Użytkownika
- **Rola:** Zaawansowany technicznie programista, potrafi budować własne integracje, pisać skrypty (Python) i obsługiwać API.
- **Lokalizacja:** Polska (Operator sieci/sprzedawca: PGE).
- **Status:** Przyszły prosument z instalacją PV o mocy 5–15 kWp oraz dedykowanym magazynem energii LiFePO4 (optymalnie 15–20 kWh dla pełnego arbitrażu).
- **Cel Główny:** Maksymalizacja autokonsumpcji oraz aktywny arbitraż cenowy (kupowanie w dolinach cenowych/cenach ujemnych, sprzedaż w szczytach wieczornych) w realiach rynkowych cen godzinowych (RCEe / Net-billing) i taryf dynamicznych.
- **Ekosystem:** Serce systemu stanowi lokalny Home Assistant (HA).

## 2. Architektura Techniczna & Sterowanie Urządzeniami
- **Komunikacja:** System opiera się na modelu zdarzeń (Event-Driven Architecture). Komponenty komunikują się wyłącznie poprzez broker MQTT (`mosquitto_config_mosquitto.conf` definiuje schemat tematów/topics), który jest orkiestrowany przez `docker-compose.yml`.
- **Logika Centralna:** Skrypty Pythona (np. `mock_inverter.py`) są odpowiedzialne za implementację logiki biznesowej, subskrybują tematy MQTT i publikują aktualizacje stanu (SoC, produkcja) w sposób zgodny z definicjami tematycznymi.
- **Kontekst Stanu:** Folder `config/` zawiera całą bazę wiedzy systemu: pliki konfiguracyjne HA oraz dane historyczne/parametry kalibracyjne dla skryptów.
- **Zasoby sprzętowe do wdrożenia:**
  - Licznik główny: Shelly Pro 3EM (Ethernet/Wi-Fi) lub Eastron SDM630 via Modbus dla próbkowania danych w czasie rzeczywistym.
  - Wykonawcze: Shelly Pro 1PM/2PM na szynie DIN (ogrzewanie, bojler/CWU ze stycznikiem 16A, pralka, zmywarka).
  - Pompa ciepła / Klimatyzacja: Sterowanie przez styki SG Ready (Smart Grid) lub dedykowane integracje lokalne.

## 3. Strategia Automatyzacji, ML i LLM (EMS)
- **Warstwa Matematyczna/ML (Prognozowanie & Optymalizacja):** Framework **EMHASS** (w Dockerze) uruchamiany co dobę po 14:00. Pobiera prognozy PV (Solcast API), prognozy cen (PSE API / ENTSO-E dla strefy PL) oraz historyczny profil zużycia domu, generując optymalny 24-godzinny plan ładowania/rozładowania baterii.
- **Warstwa Semantyczna/LLM (Zarządzanie Kontekstem):** Lokalna **Ollama** (Llama 3 / Mistral) spięta z HA. LLM analizuje plany domowników (np. wpisy z Kalendarza Google jak "Wyjazd", "Goście") i dynamicznie modyfikuje tryby pracy domu (`input_select.house_mode`), wpływając na parametry wejściowe algorytmu ML (np. obniżenie Target SoC baterii przy pustym domu).

## 4. Środowisko Deweloperskie (Staging / Piaskownica)
Projekt jest rozwijany i testowany w 100% lokalnie na PC przy użyciu:
- **Docker Compose:** Kontenery Home Assistant Core, MQTT Broker (Mosquitto), EMHASS i Ollama w jednej sieci.
- **Mockowanie Hardware:** Skrypt w Pythonie (`pyModbusTCP`) symulujący fizyczny inwerter i stany rejestrów (SoC, produkcja, eksport) oraz wtryskiwanie danych profilowych z plików CSV do wirtualnych sensorów typu Template w HA.