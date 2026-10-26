import { describe, expect, it } from "vitest";
import { validateHardwarePayload } from "./deviceProtocol";

function payload() {
  return {
    device_id: "hybrid-esp32-01",
    timestamp: new Date().toISOString(),
    mode: "live",
    sensors: {
      solar: { voltage_v: 5, current_a: 0.2, power_w: null },
      wind: { voltage_v: null, current_a: null, power_w: null },
      battery: { voltage_v: 3.7, current_a: null, power_w: null, soc_percent: null },
      load: { voltage_v: null, current_a: null, power_w: null },
    },
    sensor_status: { ina219_a: true, ina219_b: false },
    firmware_version: "1.0.0",
  };
}

describe("ESP32 reading protocol", () => {
  it("derives power only from valid voltage and current while preserving nulls", () => {
    const result = validateHardwarePayload(payload());
    expect("reading" in result).toBe(true);
    if ("reading" in result) {
      expect(result.reading.solar.power_w).toBe(1);
      expect(result.reading.wind.power_w).toBeNull();
      expect(result.reading.battery.socPercent).toBeNull();
    }
  });

  it("rejects malformed, out-of-range, and future measurements", () => {
    const invalidVoltage = payload();
    invalidVoltage.sensors.solar.voltage_v = 30;
    expect(validateHardwarePayload(invalidVoltage)).toMatchObject({ error: expect.stringContaining("bus range") });

    const future = payload();
    future.timestamp = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(validateHardwarePayload(future)).toMatchObject({ error: expect.stringContaining("future") });
    expect(validateHardwarePayload(null)).toMatchObject({ error: expect.any(String) });

    const inconsistentPower = payload();
    inconsistentPower.sensors.solar.power_w = 4;
    expect(validateHardwarePayload(inconsistentPower)).toMatchObject({ error: expect.stringContaining("conflicts") });
  });

  it("rejects invalid INA219 range configuration instead of disabling range checks", () => {
    const original = process.env.INA219_MAX_BUS_VOLTAGE_V;
    process.env.INA219_MAX_BUS_VOLTAGE_V = "not-a-number";
    try {
      expect(validateHardwarePayload(payload())).toMatchObject({
        error: expect.stringContaining("range configuration"),
      });
    } finally {
      if (original === undefined) delete process.env.INA219_MAX_BUS_VOLTAGE_V;
      else process.env.INA219_MAX_BUS_VOLTAGE_V = original;
    }
  });
});