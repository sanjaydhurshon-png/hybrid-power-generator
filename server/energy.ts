import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { energyStore } from "./energyStore";
import { validateHardwarePayload, type HardwareReading } from "./deviceProtocol";
import { evaluateForecast, integratePower, integratePowerWithinRange } from "./energyMath";
import { getCachedWeatherForecast, getWeatherForecast } from "./weather";
import { AssistantModelError, generateAssistantReply, getAssistantModelStatus } from "./assistantModel";

type Mode = "simulator" | "hardware";
type BatteryState = "CHARGING" | "DISCHARGING" | "FULL" | "LOW" | "CRITICAL" | "IDLE" | "UNAVAILABLE";
type SystemState = "SURPLUS" | "DEFICIT" | "BALANCED" | "UNAVAILABLE";

type Reading = {
  timestamp: number;
  deviceId: string;
  mode: Mode;
  solarPower: number | null;
  windPower: number | null;
  totalGeneration: number | null;
  loadPower: number | null;
  batteryLevel: number | null;
  batteryVoltage: number | null;
  batteryCurrent: number | null;
  batteryTemperature: number | null;
  solarVoltage: number | null;
  solarCurrent: number | null;
  windVoltage: number | null;
  windCurrent: number | null;
  loadVoltage: number | null;
  loadCurrent: number | null;
  netPower: number | null;
  efficiency: null;
  generationCoverage: number | null;
  batteryState: BatteryState;
  systemState: SystemState;
  sensorStatus: Record<string, boolean>;
  firmwareVersion: string | null;
};

type SimulatorConfig = {
  solarIrradiance: number;
  windSpeed: number;
  loadDemand: number;
  batteryLevel: number;
  weatherScenario: "clear" | "cloudy" | "stormy" | "calm";
  faultInjection: "none" | "solar" | "wind" | "battery" | "load" | "all";
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

const simulator: SimulatorConfig = {
  solarIrradiance: 720,
  windSpeed: 8.2,
  loadDemand: 2.4,
  batteryLevel: 68,
  weatherScenario: "clear",
  faultInjection: "none",
};

let simulatorRunning = true;
let mode: Mode = "simulator";
let deviceId = "SIM-01";
let lastHeartbeat = Date.now();
let current: Reading;
const history: Reading[] = [];

function stateForBattery(level: number, net: number | null): BatteryState {
  if (level <= 10) return "CRITICAL";
  if (level <= 20) return "LOW";
  if (level >= 99) return "FULL";
  if (net !== null && net > 0.5) return "CHARGING";
  if (net !== null && net < -0.5) return "DISCHARGING";
  return "IDLE";
}

function buildReading(input: Partial<Reading>, readingMode: Mode): Reading {
  const solarPower = finite(input.solarPower) ? round(input.solarPower) : null;
  const windPower = finite(input.windPower) ? round(input.windPower) : null;
  const loadPower = finite(input.loadPower) ? round(input.loadPower) : null;
  const totalGeneration = solarPower !== null && windPower !== null ? round(solarPower + windPower) : null;
  const netPower = totalGeneration !== null && loadPower !== null ? round(totalGeneration - loadPower) : null;
  const batteryLevel = finite(input.batteryLevel) ? round(clamp(input.batteryLevel, 0, 100)) : null;
  const generationCoverage = loadPower !== null && loadPower > 0 && totalGeneration !== null ? round(clamp((totalGeneration / loadPower) * 100, 0, 100)) : null;
  const batteryState = readingMode === "simulator"
    ? batteryLevel === null ? "UNAVAILABLE" : stateForBattery(batteryLevel, netPower)
    : batteryLevel === null ? "UNAVAILABLE" : batteryLevel <= 10 ? "CRITICAL" : batteryLevel < 30 ? "LOW" : batteryLevel >= 99 ? "FULL" : "IDLE";
  const systemState: SystemState = netPower === null ? "UNAVAILABLE" : netPower > 0.5 ? "SURPLUS" : netPower < -0.5 ? "DEFICIT" : "BALANCED";
  return {
    timestamp: input.timestamp ?? Date.now(),
    deviceId: input.deviceId ?? deviceId,
    mode: readingMode,
    solarPower,
    windPower,
    totalGeneration,
    loadPower,
    batteryLevel,
    batteryVoltage: input.batteryVoltage ?? null,
    batteryCurrent: input.batteryCurrent ?? null,
    batteryTemperature: input.batteryTemperature ?? null,
    solarVoltage: input.solarVoltage ?? null,
    solarCurrent: input.solarCurrent ?? null,
    windVoltage: input.windVoltage ?? null,
    windCurrent: input.windCurrent ?? null,
    loadVoltage: input.loadVoltage ?? null,
    loadCurrent: input.loadCurrent ?? null,
    netPower,
    efficiency: null,
    generationCoverage,
    batteryState,
    systemState,
    sensorStatus: input.sensorStatus ?? {},
    firmwareVersion: input.firmwareVersion ?? null,
  };
}

function simulatorReading(at: number, battery: number): Reading {
  const daylight = Math.max(0.08, Math.sin((at / 86_400_000) * Math.PI * 2 - 1.05) * 0.5 + 0.5);
  const weatherSolarFactor = { clear: 1, cloudy: 0.35, stormy: 0.1, calm: 1 }[simulator.weatherScenario];
  const weatherWindFactor = { clear: 1, cloudy: 1, stormy: 1.5, calm: 0.15 }[simulator.weatherScenario];
  const solarFault = simulator.faultInjection === "solar" || simulator.faultInjection === "all";
  const windFault = simulator.faultInjection === "wind" || simulator.faultInjection === "all";
  const batteryFault = simulator.faultInjection === "battery" || simulator.faultInjection === "all";
  const loadFault = simulator.faultInjection === "load" || simulator.faultInjection === "all";
  const solarPower = solarFault ? null : clamp(simulator.solarIrradiance * 0.004 * (0.35 + daylight * 0.65) * weatherSolarFactor, 0, 5);
  const windPower = windFault ? null : clamp(Math.pow(simulator.windSpeed, 3) * 0.004 * weatherWindFactor, 0, 2);
  const loadPower = loadFault ? null : simulator.loadDemand;
  return buildReading({
    timestamp: at,
    deviceId: "SIM-01",
    solarPower,
    windPower,
    loadPower,
    batteryLevel: batteryFault ? null : battery,
    batteryVoltage: batteryFault ? null : 3.2 + battery * 0.01,
    batteryCurrent: batteryFault || solarPower === null || windPower === null || loadPower === null ? null : (solarPower + windPower - loadPower) / 3.7,
    batteryTemperature: 27.4,
    solarVoltage: solarFault ? null : 5,
    solarCurrent: solarPower === null ? null : solarPower / 5,
    windVoltage: windFault ? null : 5,
    windCurrent: windPower === null ? null : windPower / 5,
    loadVoltage: loadFault ? null : 5,
    loadCurrent: loadPower === null ? null : loadPower / 5,
  }, "simulator");
}

function seedHistory() {
  let battery = simulator.batteryLevel - 9;
  for (let i = 47; i >= 0; i -= 1) {
    const timestamp = Date.now() - i * 15 * 60 * 1000;
    const point = simulatorReading(timestamp, battery);
    saveReading(point);
    battery = clamp(battery + (point.netPower ?? 0) * 0.25 / 8.88 * 100, 18, 96);
  }
}

function updateSimulator() {
  if (!simulatorRunning) return;
  const previous = current ?? simulatorReading(Date.now(), simulator.batteryLevel);
  const nextBattery = clamp((previous.batteryLevel ?? simulator.batteryLevel) + (previous.netPower ?? 0) * 3 / 3600 / 8.88 * 100, 0, 100);
  current = simulatorReading(Date.now(), nextBattery);
  simulator.batteryLevel = current.batteryLevel ?? simulator.batteryLevel;
  lastHeartbeat = Date.now();
  saveReading(current);
}

function saveReading(reading: Reading) {
  if (!energyStore.insert({ deviceId: reading.deviceId, timestamp: reading.timestamp, mode: reading.mode, payload: JSON.stringify(reading) })) return false;
  history.push(reading);
  if (history.length > 900) history.splice(0, history.length - 900);
  return true;
}

const restored = energyStore.latest(900);
for (const row of restored) {
  try { history.push(JSON.parse(row.payload) as Reading); } catch { /* Ignore corrupt persisted rows and continue with valid history. */ }
}
if (history.length === 0) seedHistory();
energyStore.pruneBefore(Date.now() - 90 * 86_400_000);
current = history[history.length - 1] as Reading;
mode = current.mode;
deviceId = current.deviceId;
if (mode === "hardware") {
  simulatorRunning = false;
  lastHeartbeat = current.timestamp;
}
setInterval(updateSimulator, 3000);

function deviceStatus() {
  const ageSeconds = Math.max(0, Math.round((Date.now() - lastHeartbeat) / 1000));
  const connection = mode === "simulator" ? "simulation" : ageSeconds > 15 ? "offline" : ageSeconds > 6 ? "delayed" : "connected";
  return {
    deviceId,
    connection,
    wifi: mode === "simulator" ? "not applicable" : connection === "offline" ? "offline" : "connected",
    backend: "connected",
    stream: mode === "simulator" ? (simulatorRunning ? "active" : "paused") : connection === "connected" ? "active" : "inactive",
    lastHeartbeat,
    ageSeconds,
    mode,
    label: mode === "simulator" ? "SIMULATOR DATA" : "REAL HARDWARE DATA",
  };
}

const ingestionWindows = new Map<string, { start: number; count: number }>();

function authorizeDevice(req: Request, res: Response) {
  const configuredToken = process.env.DEVICE_INGEST_TOKEN;
  if (!configuredToken || configuredToken.length < 32) {
    postJson(res, { error: "Live ingestion is disabled. Configure DEVICE_INGEST_TOKEN with at least 32 characters." }, 503);
    return false;
  }
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    postJson(res, { error: "Bearer device token required." }, 401);
    return false;
  }
  const expected = Buffer.from(configuredToken);
  const supplied = Buffer.from(token);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    postJson(res, { error: "Invalid device token." }, 401);
    return false;
  }
  const now = Date.now();
  const key = req.socket.remoteAddress || "unknown";
  const window = ingestionWindows.get(key);
  if (!window || now - window.start >= 60_000) ingestionWindows.set(key, { start: now, count: 1 });
  else if (window.count >= Number(process.env.DEVICE_INGEST_RATE_PER_MINUTE || 60)) {
    postJson(res, { error: "Device ingestion rate limit exceeded." }, 429);
    return false;
  } else window.count += 1;
  return true;
}

function recommendation() {
  if (current.systemState === "UNAVAILABLE") return "Generation-demand balance is unavailable because one or more measurement paths are not configured.";
  if (current.systemState === "DEFICIT" && current.batteryLevel !== null && current.batteryLevel <= 20) return "Reduce non-essential loads to preserve battery reserve.";
  if (current.systemState === "DEFICIT") return "Current demand exceeds renewable generation. Consider reducing non-essential loads.";
  if (current.batteryState === "FULL") return "Battery is at capacity. Renewable surplus is available for additional flexible loads.";
  if (current.solarPower !== null && current.windPower !== null && current.solarPower > current.windPower * 1.25) return "Solar is currently the primary generation source.";
  if (current.solarPower !== null && current.windPower !== null && current.windPower > current.solarPower * 1.25) return "Wind is currently the primary generation source.";
  return "Renewable generation currently covers the load. Excess energy can be stored.";
}

function alerts() {
  const result: Array<{ level: string; message: string; source: string; timestamp: number }> = [];
  const device = deviceStatus();
  if (device.connection === "offline") result.push({ level: "CRITICAL", message: "Device offline — no recent heartbeat.", source: "ESP32", timestamp: Date.now() });
  if (mode === "simulator" && !simulatorRunning) result.push({ level: "INFO", message: "Simulation updates are paused.", source: "Simulator", timestamp: Date.now() });
  if (current.batteryLevel !== null && current.batteryLevel <= 10) result.push({ level: "CRITICAL", message: "Battery critically low.", source: "Battery monitor", timestamp: Date.now() });
  if (current.batteryLevel !== null && current.batteryLevel < 30) result.push({ level: "WARNING", message: "Battery below the default 30% advisory reserve.", source: "Battery monitor", timestamp: Date.now() });
  if (current.systemState === "DEFICIT" && current.netPower !== null) result.push({ level: "WARNING", message: `Generation is below load by ${Math.abs(current.netPower)} W.`, source: "Energy balance", timestamp: Date.now() });
  if (device.ageSeconds > 6) result.push({ level: "WARNING", message: "Data stream delayed.", source: "Data pipeline", timestamp: Date.now() });
  if (result.length === 0) result.push({ level: "INFO", message: current.systemState === "SURPLUS" ? "System operating with renewable surplus." : "System operating normally.", source: "System health", timestamp: Date.now() });
  return result;
}

function summary() {
  return {
    ...current,
    recommendation: recommendation(),
    alerts: alerts(),
    device: deviceStatus(),
    modeLabel: mode === "simulator" ? "SIMULATOR DATA" : "REAL HARDWARE DATA",
    sourceLabel: mode === "simulator" ? "SIMULATOR / DEMO MODE" : "REAL HARDWARE MODE",
  };
}

function rangeStart(range: string) {
  const duration = ({ "15m": 15 * 60_000, "1h": 60 * 60_000, "6h": 6 * 60 * 60_000, "24h": 86_400_000, today: 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as Record<string, number>)[range] ?? 86_400_000;
  return Date.now() - duration;
}

function rangeBounds(range: string, fromValue: unknown, toValue: unknown): { from: number; to: number } | { error: string } {
  const now = Date.now();
  if (range !== "custom" && !["15m", "1h", "6h", "24h", "today", "7d", "30d"].includes(range)) return { error: "Unsupported history range." };
  if (range !== "custom") return { from: rangeStart(range), to: now };
  if (typeof fromValue !== "string" || typeof toValue !== "string") return { error: "Custom range requires ISO-8601 from and to values." };
  const from = Date.parse(fromValue);
  const to = Date.parse(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to > now || from < now - 90 * 86_400_000) return { error: "Custom range must be ordered and within the retained 90-day window." };
  return { from, to };
}

function persistedReadings(timestamp: number, limit = 100_000, offset = 0, readingMode = mode) {
  return energyStore.listSince(timestamp, limit, offset, readingMode).flatMap(row => {
    try { return [JSON.parse(row.payload) as Reading]; } catch { return []; }
  });
}

function analytics(range = "today", start = rangeStart(range), end = Date.now()) {
  const safePoints = persistedReadings(start).filter(point => point.timestamp <= end);
  const energy = (field: "solarPower" | "windPower" | "loadPower") => integratePower(safePoints.map(point => ({ timestamp: point.timestamp, watts: point[field] })));
  const solarWh = energy("solarPower");
  const windWh = energy("windPower");
  const totalGenerationWh = solarWh !== null && windWh !== null ? round(solarWh + windWh) : null;
  const loadEnergyWh = energy("loadPower");
  const generationPoints = safePoints.filter(point => finite(point.totalGeneration)).map(point => point.totalGeneration as number);
  const solarPoints = safePoints.filter(point => finite(point.solarPower)).map(point => point.solarPower as number);
  const windPoints = safePoints.filter(point => finite(point.windPower)).map(point => point.windPower as number);
  const loadPoints = safePoints.filter(point => finite(point.loadPower)).map(point => point.loadPower as number);
  const average = (values: number[]) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const averageGeneration = average(generationPoints);
  const averageLoad = average(loadPoints);
  return {
    range,
    mode,
    sampleCount: safePoints.length,
    solarGenerationWh: solarWh,
    windGenerationWh: windWh,
    totalGenerationWh,
    loadEnergyWh,
    batteryUsageWh: null,
    solarContribution: totalGenerationWh ? round(((solarWh ?? 0) / totalGenerationWh) * 100) : null,
    windContribution: totalGenerationWh ? round(((windWh ?? 0) / totalGenerationWh) * 100) : null,
    efficiency: null,
    generationCoverage: averageLoad && averageGeneration !== null ? round(clamp((averageGeneration / averageLoad) * 100, 0, 100)) : null,
    averageGeneration,
    averageSolar: average(solarPoints),
    averageWind: average(windPoints),
    peakGeneration: generationPoints.length ? Math.max(...generationPoints) : null,
    minimumGeneration: generationPoints.length ? Math.min(...generationPoints) : null,
    peakLoad: loadPoints.length ? Math.max(...loadPoints) : null,
    averageLoad,
    chart: safePoints.slice(-300).map(point => ({
      timestamp: point.timestamp,
      label: new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      solar: point.solarPower,
      wind: point.windPower,
      generation: point.totalGeneration,
      load: point.loadPower,
      battery: point.batteryLevel,
    })),
  };
}

function dailyGeneration(days: number, dataMode: Mode) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const firstDay = new Date(today);
  firstDay.setUTCDate(firstDay.getUTCDate() - days + 1);
  const points = energyStore.listSince(firstDay.getTime(), 100_000, 0, dataMode).flatMap(row => {
    try { return [JSON.parse(row.payload) as Reading]; } catch { return []; }
  });
  const byDay = new Map<string, Reading[]>();
  for (const point of points) {
    const date = new Date(point.timestamp).toISOString().slice(0, 10);
    const values = byDay.get(date) ?? [];
    values.push(point);
    byDay.set(date, values);
  }
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(firstDay);
    day.setUTCDate(day.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    const energy = (field: "solarPower" | "windPower" | "totalGeneration") =>
      integratePowerWithinRange(
        points.map(point => ({ timestamp: point.timestamp, watts: point[field] })),
        day.getTime(),
        day.getTime() + 86_400_000,
      );
    return {
      date,
      mode: dataMode,
      solarWh: energy("solarPower"),
      windWh: energy("windPower"),
      totalGenerationWh: energy("totalGeneration"),
      sampleCount: (byDay.get(date) ?? []).length,
    };
  });
}

function prediction() {
  const base = analytics("7d");
  const trend = (current.totalGeneration ?? base.averageGeneration ?? 1) / Math.max(1, base.averageGeneration ?? 1);
  const solarBaseline = current.solarPower ?? base.averageSolar;
  const windBaseline = current.windPower ?? base.averageWind;
  const loadBaseline = current.loadPower ?? base.averageLoad;
  const modeHistory = persistedReadings(rangeStart("30d"), 100_000, 0, mode);
  const generationHistory = modeHistory.filter(point => finite(point.totalGeneration));
  const modeHistoryCount = generationHistory.length;
  const actual: number[] = [];
  const predicted: number[] = [];
  const holdoutStart = Math.max(1, Math.floor(generationHistory.length * 0.8));
  for (let index = holdoutStart; index < generationHistory.length; index += 1) {
    const previous = generationHistory[index - 1]!;
    const point = generationHistory[index]!;
    const gap = point.timestamp - previous.timestamp;
    if (gap <= 0 || gap > 30 * 60_000) continue;
    actual.push(point.totalGeneration as number);
    predicted.push(previous.totalGeneration as number);
  }
  const evaluation = mode === "hardware" && actual.length >= 10 ? evaluateForecast(actual, predicted) : null;
  const historySpan = generationHistory.length > 1 ? generationHistory[generationHistory.length - 1]!.timestamp - generationHistory[0]!.timestamp : 0;
  const sufficientHistory = mode === "hardware" && modeHistoryCount >= 96 && historySpan >= 24 * 60 * 60_000;
  const weather = getCachedWeatherForecast();
  const currentHour = new Date().getHours();
  const forecast = Array.from({ length: 24 }, (_, hour) => {
    const targetHour = (currentHour + hour + 1) % 24;
    const daylight = Math.max(0, Math.sin(((targetHour - 6) / 12) * Math.PI));
    const weatherTimes = weather?.hourly?.time as string[] | undefined;
    const targetTimestamp = Date.now() + (hour + 1) * 60 * 60_000;
    const weatherIndex = weatherTimes?.findIndex(time => Math.abs(Date.parse(time) - targetTimestamp) < 30 * 60_000) ?? -1;
    const radiation = weatherIndex >= 0 ? weather?.hourly?.shortwave_radiation?.[weatherIndex] : null;
    const solarWeatherFactor = typeof radiation === "number" ? clamp(radiation / 800, 0, 1.2) : daylight;
    const solar = solarBaseline === null ? null : round(Math.max(0, solarBaseline * solarWeatherFactor * clamp(trend, 0.75, 1.25)));
    const wind = windBaseline === null ? null : round(Math.max(0, windBaseline));
    const load = loadBaseline === null ? null : round(Math.max(0, loadBaseline * (0.86 + 0.16 * Math.sin((targetHour / 24) * Math.PI * 2 + 1))));
    const generation = solar === null || wind === null ? null : solar + wind;
    return { hour: `${String(targetHour).padStart(2, "0")}:00`, solar, wind, generation, load };
  });
  return { method: weather ? "Persistence baseline + provider solar-radiation adjustment" : "Persistence baseline + time-of-day solar profile", sufficientHistory, sampleCount: modeHistoryCount, uncertainty: "Not calibrated; no accuracy claims; turbine output is not weather-calibrated", weatherSource: weather ? "Open-Meteo · cached up to 1 hour" : null, evaluation: evaluation && { ...evaluation, baseline: "Previous valid sample" }, forecast };
}

function postJson(res: Response, body: unknown, status = 200) {
  res.status(status).json(body);
}

function chatHistory(value: unknown): Array<{ role: "user" | "assistant"; content: string }> | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) return null;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      !("role" in item) ||
      !("content" in item) ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" ||
      item.content.length > 2000
    ) return null;
    messages.push({ role: item.role, content: item.content });
  }
  return messages;
}

function assistantMessages(message: string, history: Array<{ role: "user" | "assistant"; content: string }>) {
  const source = current.mode === "simulator" ? "SIMULATED demo data" : "LIVE HARDWARE";
  const device = deviceStatus();
  const telemetry = {
    source,
    device: {
      connection: device.connection,
      mode: device.mode,
      label: device.label,
      ageSeconds: device.ageSeconds,
    },
    timestamp: new Date(current.timestamp).toISOString(),
    freshness: Date.now() - current.timestamp <= 15_000 ? "fresh" : "stale",
    readings: {
      solarPowerW: current.solarPower,
      windPowerW: current.windPower,
      totalGenerationW: current.totalGeneration,
      loadPowerW: current.loadPower,
      batteryLevelPercent: current.batteryLevel,
      batteryVoltageV: current.batteryVoltage,
      netPowerW: current.netPower,
      systemState: current.systemState,
    },
  };
  const systemPrompt = [
    "You are the conversational assistant in a hybrid renewable-energy dashboard.",
    "Answer questions on any topic, including unrelated general questions. Be natural, helpful, and responsive to follow-up questions; do not repeat a fixed greeting or template.",
    "Keep replies clear and concise by default, using plain language and adding detail when it helps or is requested.",
    "Do not volunteer details about the model or where it runs. If asked directly what you are, say that you are an AI assistant.",
    "Use the recent conversation for context. If you are unsure, say so rather than inventing facts.",
    "For questions about this dashboard or current energy measurements, treat the supplied telemetry as the only source of current values. Preserve null as unavailable, never invent readings, and clearly distinguish SIMULATED data from LIVE HARDWARE data. A running simulator does not mean the ESP32 is connected. Never claim the ESP32 is connected unless mode is LIVE HARDWARE and the device connection is connected.",
    "If the user corrects a previous claim, acknowledge the correction, apologize briefly, and do not repeat the claim.",
    "The dashboard forecast is a preliminary baseline, not a trained AI prediction. Do not claim the app controls hardware.",
    "For electrical and battery topics, prioritize safe, cautious guidance and do not recommend bypassing protection or connecting unregulated sources directly to batteries.",
    `Current dashboard telemetry: ${JSON.stringify(telemetry)}`,
  ].join(" ");
  return [
    { role: "system" as const, content: systemPrompt },
    ...history,
    { role: "user" as const, content: message },
  ];
}

function deviceConnectionAnswer(message: string, history: Array<{ role: "user" | "assistant"; content: string }>): string | null {
  const normalized = message.toLowerCase();
  const asksConnection =
    /\b(?:is|are|has|have|do|does)\b.*\b(?:connected|online|connection|communicating)\b/.test(normalized) ||
    /\b(?:connected|online|connection|communicating)\b.*\?/.test(normalized);
  const mentionsDevice = /\b(?:esp(?:32)?|device|hardware)\b/.test(normalized);
  const saysDisconnected =
    normalized.includes("not connected") ||
    normalized.includes("isn't connected") ||
    normalized.includes("offline");
  const followsAssistantReply = history.at(-1)?.role === "assistant";
  const correctsPreviousClaim = saysDisconnected && (mentionsDevice || followsAssistantReply);

  if (!asksConnection && !correctsPreviousClaim) return null;

  const correction = correctsPreviousClaim ? "You're right—I shouldn't have claimed it was connected. " : "";
  if (current.mode === "simulator") {
    return `${correction}The dashboard is in SIMULATION mode, so it has not confirmed a connection to the ESP32 hardware.`;
  }

  const device = deviceStatus();
  if (device.connection === "connected") {
    return `${correction}The dashboard currently reports a recent connection from ESP32 device ${device.deviceId}.`;
  }
  if (device.connection === "delayed") {
    return `${correction}The ESP32 is not currently reporting fresh data. Its last heartbeat was ${device.ageSeconds} seconds ago.`;
  }
  return `${correction}The dashboard reports ESP32 device ${device.deviceId} as offline.`;
}

function normalizeDeviceReading(payload: HardwareReading, readingMode: Mode): Reading {
  return buildReading({
    timestamp: payload.timestamp,
    deviceId: payload.deviceId,
    solarPower: payload.solar.power_w,
    windPower: payload.wind.power_w,
    loadPower: payload.load.power_w,
    batteryLevel: payload.battery.socPercent,
    batteryVoltage: payload.battery.voltage_v,
    batteryCurrent: payload.battery.current_a,
    solarVoltage: payload.solar.voltage_v,
    solarCurrent: payload.solar.current_a,
    windVoltage: payload.wind.voltage_v,
    windCurrent: payload.wind.current_a,
    loadVoltage: payload.load.voltage_v,
    loadCurrent: payload.load.current_a,
    sensorStatus: payload.sensorStatus,
    firmwareVersion: payload.firmwareVersion,
  }, readingMode);
}

export function registerHybridEnergyRoutes(app: Express) {
  app.get("/api/status", (_req, res) => postJson(res, { ...summary(), uptime: process.uptime() }));
  app.get("/api/device/status", (_req, res) => postJson(res, deviceStatus()));
  app.get("/api/energy/current", (_req, res) => postJson(res, summary()));
  app.get("/api/energy/history", (req, res) => {
    const range = typeof req.query.range === "string" ? req.query.range : "today";
    const bounds = rangeBounds(range, req.query.from, req.query.to);
    if ("error" in bounds) return postJson(res, { error: bounds.error }, 400);
    const requestedLimit = Number(req.query.limit ?? 300);
    const requestedOffset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || !Number.isInteger(requestedOffset) || requestedOffset < 0) return postJson(res, { error: "limit and offset must be non-negative integers." }, 400);
    const limit = Math.min(requestedLimit, 500);
    const points = persistedReadings(bounds.from, limit, requestedOffset).filter(point => point.timestamp <= bounds.to);
    postJson(res, { range, limit, offset: requestedOffset, mode, truncated: points.length === limit, modeLabel: mode === "simulator" ? "SIMULATOR DATA" : "LIVE HARDWARE DATA", history: points });
  });
  app.get("/api/energy/analytics", (req, res) => {
    const range = typeof req.query.range === "string" ? req.query.range : "today";
    const bounds = rangeBounds(range, req.query.from, req.query.to);
    if ("error" in bounds) return postJson(res, { error: bounds.error }, 400);
    postJson(res, analytics(range, bounds.from, bounds.to));
  });
  app.get("/api/energy/daily", (req, res) => {
    const days = Number(req.query.days ?? 30);
    const requestedMode = req.query.mode ?? mode;
    if (!Number.isInteger(days) || days < 1 || days > 90) return postJson(res, { error: "days must be an integer between 1 and 90." }, 400);
    if (requestedMode !== "hardware" && requestedMode !== "simulator") return postJson(res, { error: "mode must be hardware or simulator." }, 400);
    postJson(res, {
      days,
      mode: requestedMode,
      label: requestedMode === "hardware" ? "LIVE HARDWARE DATA" : "SIMULATED DATA",
      daily: dailyGeneration(days, requestedMode),
    });
  });
  app.get("/api/energy/prediction", (_req, res) => postJson(res, prediction()));
  app.get("/api/alerts", (_req, res) => postJson(res, { alerts: alerts(), modeLabel: mode === "simulator" ? "SIMULATOR DATA" : "REAL HARDWARE DATA" }));
  app.get("/api/chat/status", (_req, res) => postJson(res, getAssistantModelStatus()));
  app.get("/api/climate/forecast", async (req, res) => {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return postJson(res, { error: "Valid latitude and longitude are required." }, 400);
    const result = await getWeatherForecast(latitude, longitude);
    if (result.status === 502) return postJson(res, { error: result.error }, result.status);
    postJson(res, result.data);
  });

  app.post("/api/simulator/start", (_req, res) => {
    mode = "simulator";
    deviceId = "SIM-01";
    simulatorRunning = true;
    lastHeartbeat = Date.now();
    updateSimulator();
    postJson(res, summary());
  });
  app.post("/api/simulator/stop", (_req, res) => {
    simulatorRunning = false;
    lastHeartbeat = Date.now() - 7000;
    postJson(res, summary());
  });
  app.post("/api/simulator/config", (req, res) => {
    const next = req.body as Record<string, unknown> | null;
    if (!next || typeof next !== "object" || Array.isArray(next)) return postJson(res, { error: "Configuration must be a JSON object." }, 400);
    const ranges = { solarIrradiance: [0, 1200], windSpeed: [0, 20], loadDemand: [0, 8], batteryLevel: [0, 100] } as const;
    for (const [key, [min, max]] of Object.entries(ranges)) {
      if (next[key] !== undefined && (!finite(next[key]) || next[key] < min || next[key] > max)) return postJson(res, { error: `${key} must be between ${min} and ${max}.` }, 400);
    }
    if (next.weatherScenario !== undefined && !(["clear", "cloudy", "stormy", "calm"] as unknown[]).includes(next.weatherScenario)) return postJson(res, { error: "weatherScenario is not supported." }, 400);
    if (next.faultInjection !== undefined && !(["none", "solar", "wind", "battery", "load", "all"] as unknown[]).includes(next.faultInjection)) return postJson(res, { error: "faultInjection is not supported." }, 400);
    if (finite(next.solarIrradiance)) simulator.solarIrradiance = next.solarIrradiance;
    if (finite(next.windSpeed)) simulator.windSpeed = next.windSpeed;
    if (finite(next.loadDemand)) simulator.loadDemand = next.loadDemand;
    if (finite(next.batteryLevel)) simulator.batteryLevel = next.batteryLevel;
    if (next.weatherScenario !== undefined) simulator.weatherScenario = next.weatherScenario as SimulatorConfig["weatherScenario"];
    if (next.faultInjection !== undefined) simulator.faultInjection = next.faultInjection as SimulatorConfig["faultInjection"];
    mode = "simulator";
    simulatorRunning = true;
    updateSimulator();
    postJson(res, { config: simulator, ...summary() });
  });

  app.post("/api/device/connect", (req, res) => {
    if (!authorizeDevice(req, res)) return;
    const requestedId = typeof req.body?.device_id === "string" ? req.body.device_id : "ESP32-01";
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(requestedId)) return postJson(res, { error: "Invalid device_id." }, 400);
    postJson(res, { registered: true, deviceId: requestedId, liveMode: mode === "hardware", awaitingAuthenticatedReading: mode !== "hardware" });
  });
  app.post("/api/device/heartbeat", (req, res) => {
    if (!authorizeDevice(req, res)) return;
    if (typeof req.body?.device_id !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(req.body.device_id)) return postJson(res, { error: "Valid device_id required." }, 400);
    if (mode === "hardware" && req.body.device_id !== deviceId) return postJson(res, { error: "Device is not registered for the active live session." }, 403);
    if (mode === "hardware") deviceId = req.body.device_id;
    lastHeartbeat = Date.now();
    postJson(res, deviceStatus());
  });
  app.post("/api/device/disconnect", (_req, res) => {
    if (!authorizeDevice(_req, res)) return;
    lastHeartbeat = Date.now() - 20_000;
    postJson(res, deviceStatus());
  });
  app.post("/api/simulator/device-reading", (req, res) => {
    const result = validateHardwarePayload(req.body, Date.now(), "simulation");
    if ("error" in result) return postJson(res, { error: result.error }, 400);
    const simulated = normalizeDeviceReading(result.reading, "simulator");
    if (!saveReading(simulated)) return postJson(res, { error: "Duplicate simulated reading for this timestamp." }, 409);
    mode = "simulator";
    simulatorRunning = false;
    deviceId = simulated.deviceId;
    lastHeartbeat = Date.now();
    current = simulated;
    return postJson(res, summary());
  });
  app.post("/api/energy/reading", (req, res) => {
    if (!authorizeDevice(req, res)) return;
    const result = validateHardwarePayload(req.body);
    if ("error" in result) return postJson(res, { error: result.error }, 400);
    const payload = result.reading;
    const hardware = normalizeDeviceReading(payload, "hardware");
    if (!energyStore.insert({ deviceId: payload.deviceId, timestamp: payload.timestamp, mode: "hardware", payload: JSON.stringify(hardware) })) return postJson(res, { error: "Duplicate device reading for this timestamp." }, 409);
    mode = "hardware";
    simulatorRunning = false;
    deviceId = payload.deviceId;
    lastHeartbeat = payload.timestamp;
    current = hardware;
    history.push(current);
    if (history.length > 900) history.splice(0, history.length - 900);
    return postJson(res, summary());
  });
  app.post("/api/chat", async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const history = chatHistory(req.body?.history);
    if (!message || message.length > 2000) return postJson(res, { error: "Enter a message of 1-2000 characters." }, 400);
    if (history === null) return postJson(res, { error: "Chat history must contain at most 12 user/assistant messages of up to 2000 characters each." }, 400);
    const connectionAnswer = deviceConnectionAnswer(message, history);
    if (connectionAnswer) {
      return postJson(res, {
        answer: connectionAnswer,
        source: current.mode === "simulator" ? "SIMULATED demo data" : "LIVE HARDWARE",
      });
    }
    try {
      const answer = await generateAssistantReply(assistantMessages(message, history));
      return postJson(res, {
        answer,
        source: current.mode === "simulator" ? "SIMULATED demo data" : "LIVE HARDWARE",
      });
    } catch (error) {
      if (error instanceof AssistantModelError) {
        const status = error.message.includes("download or load") ? 503 : 500;
        return postJson(res, { error: error.message }, status);
      }
      return postJson(res, { error: "The assistant encountered an unexpected error. Check the server logs and try again." }, 500);
    }
  });
}

export const __test = { analytics, prediction, buildReading, simulatorReading, deviceConnectionAnswer };
