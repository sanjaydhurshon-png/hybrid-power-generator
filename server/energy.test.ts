import { describe, expect, it } from "vitest";
import { __test } from "./energy";

describe("energy measurement semantics", () => {
  it("does not label generation-to-load coverage as system efficiency", () => {
    const reading = __test.buildReading({
      solarPower: 4,
      windPower: 1,
      loadPower: 2,
      batteryLevel: 50,
    }, "hardware");

    expect(reading.efficiency).toBeNull();
    expect(reading.generationCoverage).toBe(100);
  });

  it("keeps simulated readings within prototype-scale single-cell ranges", () => {
    const reading = __test.simulatorReading(Date.now(), 50);

    expect(reading.mode).toBe("simulator");
    expect(reading.solarPower).toBeGreaterThanOrEqual(0);
    expect(reading.solarPower).toBeLessThanOrEqual(5);
    expect(reading.windPower).toBeGreaterThanOrEqual(0);
    expect(reading.windPower).toBeLessThanOrEqual(2);
    expect(reading.batteryVoltage).toBeGreaterThanOrEqual(3.2);
    expect(reading.batteryVoltage).toBeLessThanOrEqual(4.2);
  });
});