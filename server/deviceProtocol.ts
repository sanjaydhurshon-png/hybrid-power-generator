export type ElectricalChannel = {
  voltage_v: number | null;
  current_a: number | null;
  power_w: number | null;
};

export type HardwareReading = {
  deviceId: string;
  timestamp: number;
  solar: ElectricalChannel;
  wind: ElectricalChannel;
  battery: ElectricalChannel & { socPercent: number | null };
  load: ElectricalChannel;
  sensorStatus: Record<string, boolean>;
  firmwareVersion: string | null;
};

const finiteOrNull = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value));
const channelNames = ["solar", "wind", "battery", "load"] as const;

export function validateHardwarePayload(body: unknown, now = Date.now(), expectedMode: "live" | "simulation" = "live"): { reading: HardwareReading } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Payload must be a JSON object." };
  const payload = body as Record<string, unknown>;
  if (payload.mode !== expectedMode) return { error: `Payload mode must be '${expectedMode}'.` };
  if (typeof payload.device_id !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(payload.device_id)) return { error: "device_id must be 1-64 letters, numbers, dots, underscores, or hyphens." };
  if (typeof payload.timestamp !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(payload.timestamp)) return { error: "timestamp must be an ISO-8601 timestamp with timezone." };
  const timestamp = Date.parse(payload.timestamp);
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000) return { error: "timestamp is invalid or more than five minutes in the future." };
  if (timestamp < now - 7 * 86_400_000) return { error: "timestamp is older than the accepted seven-day ingestion window." };
  if (!payload.sensors || typeof payload.sensors !== "object" || Array.isArray(payload.sensors)) return { error: "sensors must be an object." };
  const sensors = payload.sensors as Record<string, unknown>;
  const configuredLimit = (name: string, fallback: number) => {
    const value = process.env[name]?.trim();
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const maxVoltage = configuredLimit("INA219_MAX_BUS_VOLTAGE_V", 26);
  const maxCurrent = configuredLimit("INA219_MAX_CURRENT_A", 3.2);
  if (maxVoltage === null || maxCurrent === null) return { error: "INA219 range configuration must contain positive finite limits." };
  const mapped = {} as Record<(typeof channelNames)[number], ElectricalChannel>;

  for (const name of channelNames) {
    const raw = sensors[name];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `sensors.${name} must be an object; use null fields for unavailable values.` };
    const channel = raw as Record<string, unknown>;
    const voltage = channel.voltage_v === undefined ? null : channel.voltage_v;
    const current = channel.current_a === undefined ? null : channel.current_a;
    const power = channel.power_w === undefined ? null : channel.power_w;
    if (!finiteOrNull(voltage) || !finiteOrNull(current) || !finiteOrNull(power)) return { error: `sensors.${name} electrical values must be finite numbers or null.` };
    if (voltage !== null && (voltage < 0 || voltage > maxVoltage)) return { error: `sensors.${name}.voltage_v is outside the configured INA219 bus range (0-${maxVoltage} V).` };
    if (current !== null && Math.abs(current) > maxCurrent) return { error: `sensors.${name}.current_a is outside the configured INA219 current range (±${maxCurrent} A).` };
    if (power !== null && Math.abs(power) > maxVoltage * maxCurrent) return { error: `sensors.${name}.power_w is outside the configured INA219 measurement range.` };
    const derivedPower = voltage !== null && current !== null ? voltage * current : null;
    if (power !== null && derivedPower !== null && Math.abs(power - derivedPower) > Math.max(0.05, Math.abs(derivedPower) * 0.1)) return { error: `sensors.${name}.power_w conflicts with voltage_v × current_a.` };
    mapped[name] = { voltage_v: voltage, current_a: current, power_w: derivedPower ?? power };
  }

  const battery = sensors.battery as Record<string, unknown>;
  const socPercent = battery.soc_percent === undefined ? null : battery.soc_percent;
  if (!finiteOrNull(socPercent) || (socPercent !== null && (socPercent < 0 || socPercent > 100))) return { error: "sensors.battery.soc_percent must be null or between 0 and 100." };
  const status = payload.sensor_status;
  if (status !== undefined && (!status || typeof status !== "object" || Array.isArray(status) || Object.values(status).some((value) => typeof value !== "boolean"))) return { error: "sensor_status must contain boolean values." };
  const firmwareVersion = payload.firmware_version === undefined ? null : payload.firmware_version;
  if (firmwareVersion !== null && (typeof firmwareVersion !== "string" || firmwareVersion.length > 64)) return { error: "firmware_version must be a string of at most 64 characters." };

  return {
    reading: {
      deviceId: payload.device_id,
      timestamp,
      solar: mapped.solar,
      wind: mapped.wind,
      battery: { ...mapped.battery, socPercent },
      load: mapped.load,
      sensorStatus: status as Record<string, boolean> | undefined ?? {},
      firmwareVersion,
    },
  };
}