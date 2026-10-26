export type WeatherResult = { status: 200; data: unknown } | { status: 502; error: string };
let cachedForecast: { savedAt: number; data: Record<string, any> } | null = null;

export async function getWeatherForecast(latitude: number, longitude: number, fetcher: typeof fetch = fetch): Promise<WeatherResult> {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,shortwave_radiation",
    hourly: "temperature_2m,cloud_cover,wind_speed_10m,precipitation_probability,shortwave_radiation",
    forecast_days: "2",
    timezone: "auto",
  });
  try {
    const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${query}`);
    if (!response.ok) return { status: 502, error: `Weather provider returned ${response.status}.` };
    const data = await response.json() as Record<string, any>;
    cachedForecast = { savedAt: Date.now(), data };
    return { status: 200, data };
  } catch {
    return { status: 502, error: "Weather provider is unavailable. Check network access and try again." };
  }
}

export function getCachedWeatherForecast(now = Date.now()) {
  return cachedForecast && now - cachedForecast.savedAt <= 60 * 60_000 ? cachedForecast.data : null;
}