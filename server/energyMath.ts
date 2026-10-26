export type TimedPower = { timestamp: number; watts: number | null };

export function calculatePower(voltageV: number | null, currentA: number | null): number | null {
  if (!Number.isFinite(voltageV) || !Number.isFinite(currentA)) return null;
  return (voltageV as number) * (currentA as number);
}

export function integratePower(samples: TimedPower[], maxGapHours = 0.5): number | null {
  let wattHours = 0;
  let intervals = 0;
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const elapsedHours = (current.timestamp - previous.timestamp) / 3_600_000;
    if (elapsedHours <= 0 || elapsedHours > maxGapHours || !Number.isFinite(previous.watts) || !Number.isFinite(current.watts)) continue;
    wattHours += ((previous.watts as number) + (current.watts as number)) / 2 * elapsedHours;
    intervals += 1;
  }
  return intervals ? wattHours : null;
}

export function integratePowerWithinRange(
  samples: TimedPower[],
  start: number,
  end: number,
  maxGapHours = 0.5,
): number | null {
  let wattHours = 0;
  let intervals = 0;
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    const elapsedHours = (current.timestamp - previous.timestamp) / 3_600_000;
    if (
      elapsedHours <= 0 ||
      elapsedHours > maxGapHours ||
      !Number.isFinite(previous.watts) ||
      !Number.isFinite(current.watts)
    ) continue;
    const intervalStart = Math.max(start, previous.timestamp);
    const intervalEnd = Math.min(end, current.timestamp);
    if (intervalEnd <= intervalStart) continue;
    const interpolate = (timestamp: number) => {
      const fraction = (timestamp - previous.timestamp) / (current.timestamp - previous.timestamp);
      return previous.watts! + (current.watts! - previous.watts!) * fraction;
    };
    const startWatts = interpolate(intervalStart);
    const endWatts = interpolate(intervalEnd);
    wattHours += ((startWatts + endWatts) / 2) * ((intervalEnd - intervalStart) / 3_600_000);
    intervals += 1;
  }
  return intervals ? wattHours : null;
}

export function estimateRuntimeHours(usableEnergyWh: number | null, averageLoadW: number | null): number | null {
  if (!Number.isFinite(usableEnergyWh) || !Number.isFinite(averageLoadW) || (usableEnergyWh as number) <= 0 || (averageLoadW as number) <= 0) return null;
  return (usableEnergyWh as number) / (averageLoadW as number);
}

export function wattHoursToKilowattHours(wattHours: number | null): number | null {
  return Number.isFinite(wattHours) ? (wattHours as number) / 1000 : null;
}

export function evaluateForecast(actual: number[], predicted: number[]): { mae: number; rmse: number; sampleCount: number } | null {
  const pairs = actual.map((value, index) => [value, predicted[index]] as const).filter(([observed, estimate]) => Number.isFinite(observed) && Number.isFinite(estimate));
  if (!pairs.length) return null;
  const absoluteErrors = pairs.map(([observed, estimate]) => Math.abs(observed - estimate));
  const squaredErrors = pairs.map(([observed, estimate]) => (observed - estimate) ** 2);
  return {
    mae: absoluteErrors.reduce((sum, error) => sum + error, 0) / pairs.length,
    rmse: Math.sqrt(squaredErrors.reduce((sum, error) => sum + error, 0) / pairs.length),
    sampleCount: pairs.length,
  };
}
