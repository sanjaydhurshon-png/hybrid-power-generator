import { describe, expect, it } from "vitest";
import { calculatePower, estimateRuntimeHours, evaluateForecast, integratePower, integratePowerWithinRange, wattHoursToKilowattHours } from "./energyMath";

describe("energy calculations", () => {
  it("calculates DC power only when voltage and current exist", () => {
    expect(calculatePower(3.7, 0.5)).toBeCloseTo(1.85);
    expect(calculatePower(3.7, null)).toBeNull();
  });

  it("integrates trapezoids using elapsed timestamps and skips long gaps", () => {
    expect(integratePower([{ timestamp: 0, watts: 10 }, { timestamp: 1_800_000, watts: 20 }])).toBeCloseTo(7.5);
    expect(integratePower([{ timestamp: 0, watts: 10 }, { timestamp: 2_000_000, watts: null }])).toBeNull();
  });

  it("splits an interval across daily range boundaries without losing energy", () => {
    const noon = Date.UTC(2026, 0, 1, 12);
    const samples = [
      { timestamp: noon - 10 * 60_000, watts: 10 },
      { timestamp: noon + 10 * 60_000, watts: 10 },
    ];
    const firstHalf = integratePowerWithinRange(samples, noon - 20 * 60_000, noon);
    const secondHalf = integratePowerWithinRange(samples, noon, noon + 20 * 60_000);
    expect(firstHalf).toBeCloseTo(10 / 6);
    expect(secondHalf).toBeCloseTo(10 / 6);
    expect(firstHalf! + secondHalf!).toBeCloseTo(integratePower(samples)!);
  });

  it("returns runtime only for positive known energy and load", () => {
    expect(estimateRuntimeHours(8.88, 2)).toBeCloseTo(4.44);
    expect(estimateRuntimeHours(8.88, 0)).toBeNull();
    expect(estimateRuntimeHours(null, 2)).toBeNull();
  });

  it("converts Wh and evaluates only finite forecast pairs", () => {
    expect(wattHoursToKilowattHours(1500)).toBe(1.5);
    expect(evaluateForecast([2, 4, Number.NaN], [1, 6, 9])).toEqual({ mae: 1.5, rmse: Math.sqrt(2.5), sampleCount: 2 });
    expect(evaluateForecast([], [])).toBeNull();
  });
});