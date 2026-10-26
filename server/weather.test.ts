import { describe, expect, it, vi } from "vitest";
import { getCachedWeatherForecast, getWeatherForecast } from "./weather";

describe("weather provider fallback", () => {
  it("returns forecast data from a successful provider response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ current: { temperature_2m: 18 } }), { status: 200 }));
    const result = await getWeatherForecast(37.7, -122.4, fetcher);
    expect(result).toMatchObject({ status: 200, data: { current: { temperature_2m: 18 } } });
    expect(getCachedWeatherForecast()).toMatchObject({ current: { temperature_2m: 18 } });
    expect(getCachedWeatherForecast(Date.now() + 60 * 60_000 + 1)).toBeNull();
  });

  it("handles provider rate limits and network failures", async () => {
    const rateLimited = await getWeatherForecast(37.7, -122.4, async () => new Response("rate limited", { status: 429 }));
    const offline = await getWeatherForecast(37.7, -122.4, async () => { throw new Error("offline"); });
    expect(rateLimited).toMatchObject({ status: 502, error: expect.stringContaining("429") });
    expect(offline).toMatchObject({ status: 502, error: expect.stringContaining("unavailable") });
  });
});