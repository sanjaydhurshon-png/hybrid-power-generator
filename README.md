# HYBRID POWER AI

**Intelligent Energy. Predictive Climate. Sustainable Tomorrow.**

A local-first renewable-energy monitoring project for a small solar + wind prototype. The React/TypeScript dashboard presents simulator or authenticated device data, Express provides validation and analytics, and SQLite persists timestamped readings. Every reading carries a source mode; simulated values are never described as physical sensor measurements.

## Quick start

Requirements: Node.js 22.13+ (built-in `node:sqlite`) and pnpm 10+.

```powershell
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The dashboard starts in **SIMULATION** mode and writes its demo history to `data/hybrid-power.sqlite`. The simulator sliders change irradiance, airflow, load, and simulated battery state. These values are synthetic and prototype-scaled.

The Energy Assistant uses the open [Qwen2.5-0.5B-Instruct ONNX model](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct) through Transformers.js. The first chat request downloads about 483 MB of model weights and needs an internet connection; later requests use the cached model in `~/.cache/hybrid-power-ai` (`%USERPROFILE%\.cache\hybrid-power-ai` on Windows) and run on this computer without an AI API key or hosted inference provider. Model inference needs available memory and CPU, so responses may be slower on lower-powered computers. Chat prompts and telemetry are not sent to the model host.

Optional device configuration: set a private `DEVICE_INGEST_TOKEN` of at least 32 characters. `ENERGY_DB_PATH` changes the SQLite file; `INA219_MAX_BUS_VOLTAGE_V` and `INA219_MAX_CURRENT_A` configure the software validation limits for the exact INA219 breakout/shunt in use. The default 26 V / 3.2 A values are common INA219 limits, not a substitute for checking your module.

## Main navigation

- **Dashboard:** shows only fresh Arduino/ESP32 solar output, wind output, and device-reported battery charge. It stays empty when hardware is disconnected; it never fills in simulator values.
- **Simulator:** clearly labeled synthetic data, scenario controls, and demonstration views. Simulation status never implies ESP32 or Wi-Fi connectivity; the Start control is shown when simulation updates are paused.
- **Climate & output predictor:** automatically requested Open-Meteo weather after browser location permission plus preliminary baseline generation estimates. Voltage cards show only the latest mapped measurement as a persistence reference; they do not invent future voltage.
- **Daily generation history:** measured and simulated histories are selectable separately, with daily Wh charts and CSV export.
- Opening the Climate & output predictor requests browser location access and automatically loads the local weather forecast. If location access is denied or unavailable, users can retry or enter coordinates manually. Approved coordinates are saved in browser local storage for the next visit.
- Light/dark themes, responsive mobile navigation, simulator controls, charts, and an on-device Energy Assistant that can answer general or project/energy questions and summarize the current measurement context.
- SQLite persistence with unique `(device_id, timestamp)` readings, timestamp indexes, paginated history, and automatic 90-day retention.
- Validated live payload ingestion with bearer-token authentication, timing-safe token comparison, per-client rate limit, duplicate rejection, and explicit null readings.
- Open-Meteo forecast proxy. The browser only requests weather after a user submits coordinates. See [Open-Meteo API](https://open-meteo.com/en/docs) and its [terms](https://open-meteo.com/en/terms); retain provider attribution when distributing or deploying.
- `firmware/esp32/hybrid_power_ai.ino` and `firmware/simulated-device.mjs` integration examples.

## Application areas

The sidebar is intentionally limited to four task-focused sections. Some estimates remain unavailable until the panel, turbine, and sensors have been calibrated; battery charge is displayed only if the device reports a value. The weather view is a short-term forecast, not a climate prediction.

The forecast is a transparent persistence/time-of-day baseline, not a trained AI model. The Energy Assistant uses Qwen2.5-0.5B-Instruct on-device; it can respond to general and project questions and use recent chat context. Current telemetry is provided to the model with clear simulated/live labeling and missing measurements preserved as unavailable. Response quality and speed are bounded by the compact model and the computer running it. The renewable coverage ratio is not system efficiency or measured renewable contribution to load.

## Data and safety constraints

- **SIMULATION** remains visually distinct from **LIVE HARDWARE**. Live mode starts only after a valid authenticated hardware payload is accepted.
- Missing channels use `null`, not zero. A power value is calculated from voltage × current only when both exist.
- Analytics integrate adjacent, timestamped samples with the trapezoidal rule, split intervals at UTC day boundaries for daily totals, and skip gaps over 30 minutes. Missing intervals are not treated as zero consumption.
- System efficiency, battery SOC from voltage, battery runtime, wind speed from generator voltage, and renewable energy delivered to load are not inferred without the required measurements/calibration.
- The INA219 measures only its wired electrical path. It does not measure wind speed or irradiance. Two modules do not provide four simultaneous paths.
- A 3.7 V, 2400 mAh cell has a theoretical nominal energy of 8.88 Wh; usable energy is lower and depends on the battery/protection design.
- A TP4056 is a single-cell charger, not a solar/wind charge controller. An MT3608 is a boost converter, not a charger or battery protection. Never connect unregulated solar/wind output directly to a lithium-ion cell. No charging, switching, or load control is performed by this app.
- Verify board ratings, shunt, polarity, isolation, fusing, protection, and the actual wiring before using a sensor mapping. Do not connect unsafe voltages to the ESP32.

## Device API

Live requests use `Authorization: Bearer <DEVICE_INGEST_TOKEN>`. The server returns `503` until a valid token is configured, `401` for missing/invalid authentication, `400` for invalid payloads, and `409` for duplicate `(device_id, timestamp)` records. Default request rate is 60 per minute per client IP.

`POST /api/energy/reading` accepts this extensible format (all four channel objects are required; unavailable fields are `null`):

```json
{
	"device_id": "hybrid-esp32-01",
	"timestamp": "2026-10-23T12:30:00Z",
	"mode": "live",
	"firmware_version": "1.0.0",
	"sensors": {
		"solar": { "voltage_v": null, "current_a": null, "power_w": null },
		"wind": { "voltage_v": null, "current_a": null, "power_w": null },
		"battery": { "voltage_v": 3.7, "current_a": null, "power_w": null, "soc_percent": null },
		"load": { "voltage_v": null, "current_a": null, "power_w": null }
	},
	"sensor_status": { "ina219_a": false, "ina219_b": false }
}
```

Example with PowerShell:

```powershell
$token = "the-same-private-token-from-.env"
$payload = Get-Content .\firmware\examples\sample-reading.json -Raw
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/energy/reading -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $payload
```

Endpoints:

| Method and path | Purpose |
| --- | --- |
| `GET /api/status` | Current reading, device, alerts, uptime |
| `GET /api/energy/current` | Current data and source label |
| `GET /api/energy/history?range=7d&limit=300&offset=0` | Paginated SQLite history for active mode (max page 500) |
| `GET /api/energy/analytics?range=today\|7d\|30d` | Integrated energy, peaks, averages, chart data |
| `GET /api/energy/daily?days=30&mode=hardware` | Per-day solar/wind/combined Wh, isolated by source mode |
| `GET /api/energy/prediction` | Baseline forecast and history sufficiency |
| `GET /api/climate/forecast?latitude=37.7&longitude=-122.4` | Backend Open-Meteo proxy |
| `GET /api/alerts` | Current advisory alerts |
| `POST /api/energy/reading` | Authenticated live ESP32 reading |
| `POST /api/device/heartbeat` | Authenticated live-device heartbeat |
| `POST /api/simulator/device-reading` | Explicitly synthetic device payload; no live token or live-mode switch |
| `POST /api/simulator/config` | Set `solarIrradiance` (0–1200 W/m²), `windSpeed` (0–20 m/s), `loadDemand` (0–8 W), or `batteryLevel` (0–100%) |
| `POST /api/simulator/start` / `stop` | Start or pause the built-in demo |
| `GET /api/chat/status` | Assistant model download and readiness status |
| `POST /api/chat` | On-device assistant; accepts `message` and optional recent `history` |

## ESP32 setup

1. Install Arduino libraries **Adafruit INA219** and **ArduinoJson** and select the ESP32 board package.
2. Copy `firmware/esp32/secrets.h.example` to `firmware/esp32/secrets.h`; set Wi-Fi name/password, device token, and the computer's LAN IP. Do not use `localhost` on the ESP32.
3. Keep `INA219_A_MAPPING` and `INA219_B_MAPPING` set to `unassigned` until you have verified the actual sensor wiring and address jumpers. Then assign each only to its real path: `solar`, `wind`, `battery`, or `load`.
4. Confirm each INA219 board's bus/current limits and the configured server limits. The two example I2C addresses (0x40 and 0x41) are assumptions to verify on your hardware.
5. Start the server with a token in `.env`, upload the sketch, and check the Serial Monitor. Only mapped and responding sensors send values; all other paths remain null.

The firmware uses plain HTTP for a **trusted local development LAN only**. Do not expose it to the internet. Remote deployment requires HTTPS, device-secret rotation, production identity/access controls, and a reviewed network configuration. No electrical wiring is claimed to be verified by this software project.

## Simulation and demo device

The built-in simulator is the easiest demonstration path. For a JSON-protocol sender, start the app and run:

```powershell
node .\firmware\simulated-device.mjs
```

It posts synthetic readings to `/api/simulator/device-reading` every five seconds. Stop with Ctrl+C. The demo sender deliberately cannot authenticate as live hardware.

## Tests and production build

```powershell
pnpm check
pnpm test
pnpm build
pnpm start
```

Tests cover math, missing/stale/out-of-range payloads, duplicate persistence, authenticated ingestion, simulator/live mode separation, and existing authentication behavior. SQLite currently uses Node's built-in experimental `node:sqlite`; Node may print an experimental-feature warning.

Create a consistent SQLite backup while the app is running with:

```powershell
node .\scripts\backup-db.mjs .\backups\hybrid-power-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite
```

CSV export is available in the dashboard for readings; SQLite backups preserve the indexed history database.

## Project structure

```text
client/src/pages/Home.tsx        Dashboard and functional application views
client/src/energy-overrides.css  Responsive and light-theme styling
server/energy.ts                 Routes, simulation, analytics, baseline forecasts
server/deviceProtocol.ts         ESP32 schema and INA219 range validation
server/energyMath.ts             Tested power, energy, runtime, and forecast metrics
server/energyStore.ts            SQLite persistence and retention support
firmware/esp32/                  ESP32 Arduino sketch and secret template
firmware/simulated-device.mjs    Explicit synthetic HTTP sender
data/hybrid-power.sqlite         Local runtime database (git-ignored)
scripts/backup-db.mjs           Consistent SQLite backup command
```

## Prototype limitations and next steps

This is a local engineering-project prototype, not a production energy controller. It has no user/account authentication, no externally deployed TLS endpoint, no hardware-verified wiring, no INA219 calibration wizard, no validated battery coulomb counter, no relay/control outputs, and no trained or evaluated ML model. Sensor mapping and panel specifications are currently browser-local documentation/configuration. Weather retrieval depends on network availability and provider service terms. Future work should add a reviewed per-device enrollment/key rotation flow, persistent user settings, migrations, back-up automation, calibrated sensor mappings, experiment logging, forecast evaluation on a time-based holdout, and deployment-grade authentication/TLS before exposing any endpoint remotely.
