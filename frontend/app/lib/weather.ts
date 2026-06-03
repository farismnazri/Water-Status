import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSun,
  Moon,
  Snowflake,
  Sun,
  type LucideIcon,
} from "lucide-react";

import { API_BASE } from "./api";

const LOCATION_CONTEXT_BACKEND_TIMEOUT_MS = 10_000;
const LOCATION_CONTEXT_CLIENT_OPEN_METEO_TIMEOUT_MS = 10_000;
const LOCATION_CONTEXT_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const CLIENT_OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const CLIENT_OPEN_METEO_TIMEZONE = "Asia/Kuala_Lumpur";
const LOCATION_CONTEXT_IN_FLIGHT_REQUESTS = new Map<
  string,
  Promise<WeatherLocationContext>
>();
const LOCATION_CONTEXT_RATE_LIMIT_COOLDOWNS = new Map<string, number>();
const CLIENT_OPEN_METEO_CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
  "is_day",
] as const;
const CLIENT_OPEN_METEO_HOURLY_FIELDS = [
  "temperature_2m",
  "precipitation_probability",
  "precipitation",
  "rain",
  "weather_code",
  "wind_speed_10m",
] as const;
const CLIENT_OPEN_METEO_DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "rain_sum",
] as const;
const CLIENT_OPEN_METEO_MINUTELY_15_FIELDS = [
  "temperature_2m",
  "precipitation_probability",
  "precipitation",
  "rain",
] as const;
const CLIENT_OPEN_METEO_MAP_FRAME_COUNT = 6;

class HttpStatusError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(
    status: number,
    options: { message?: string | null; retryAfterSeconds?: number | null } = {}
  ) {
    super(options.message ?? `HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

class BackendPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendPayloadError";
  }
}

class ForecastRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Forecast is temporarily rate-limited. Try again shortly.");
    this.name = "ForecastRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type WeatherForecastCurrent = {
  time?: string | null;
  temperature_2m?: number | null;
  apparent_temperature?: number | null;
  relative_humidity_2m?: number | null;
  weather_code?: number | null;
  wind_speed_10m?: number | null;
  is_day?: boolean | null;
};

export type WeatherForecastWindow = {
  hours?: number | null;
  max_precipitation_probability?: number | null;
  rain_sum?: number | null;
  max_wind_speed_10m?: number | null;
};

export type WeatherForecastDay = {
  date?: string | null;
  weather_code?: number | null;
  temperature_2m_max?: number | null;
  temperature_2m_min?: number | null;
  precipitation_probability_max?: number | null;
  rain_sum?: number | null;
};

export type WeatherForecastSummary = {
  sensor_id: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: "ok" | "unavailable" | "error";
  source?: string;
  generated_at?: string | null;
  current?: WeatherForecastCurrent | null;
  next_6h?: WeatherForecastWindow | null;
  next_12h?: WeatherForecastWindow | null;
  daily: WeatherForecastDay[];
};

export type WeatherLocationBucket = {
  start?: string | null;
  end?: string | null;
  rain_amount?: number | null;
  precipitation_probability?: number | null;
};

export type WeatherLocationHourlyPoint = {
  time?: string | null;
  offset_hours: number;
  rain_amount?: number | null;
  precipitation_amount?: number | null;
  precipitation_probability?: number | null;
  temperature_2m?: number | null;
};

export type WeatherLocationMapSample = {
  id: string;
  latitude: number;
  longitude: number;
};

export type WeatherLocationMapFrameSample = {
  sample_id: string;
  precipitation_amount?: number | null;
  temperature_2m?: number | null;
};

export type WeatherLocationMapFrame = {
  label: string;
  time?: string | null;
  samples: WeatherLocationMapFrameSample[];
};

export type WeatherLocationContext = {
  status: "ok" | "unavailable" | "error";
  source?: string;
  generated_at?: string | null;
  location: {
    label: string;
    latitude: number;
    longitude: number;
    mode: "gps" | "manual";
  };
  current?: WeatherForecastCurrent | null;
  next_6h?: WeatherForecastWindow | null;
  daily: WeatherForecastDay[];
  next_hour_30m: WeatherLocationBucket[];
  hourly_timeline: WeatherLocationHourlyPoint[];
  map: {
    radius_km: number;
    samples: WeatherLocationMapSample[];
    frames: WeatherLocationMapFrame[];
  };
};

export const OPEN_METEO_ATTRIBUTION_LABEL = "Weather data by Open-Meteo.com";
export const OPEN_METEO_ATTRIBUTION_URL = "https://open-meteo.com/";

const ENABLE_CLIENT_OPEN_METEO_FALLBACK = (() => {
  const env = import.meta.env as ImportMetaEnv & {
    VITE_ENABLE_CLIENT_OPEN_METEO_FALLBACK?: string;
  };
  const raw = env?.VITE_ENABLE_CLIENT_OPEN_METEO_FALLBACK?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
})();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readRetryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readRetryAfterSecondsFromPayload(payload: unknown): number | null {
  if (!isRecord(payload)) return null;

  const detail = isRecord(payload.detail) ? payload.detail : payload;
  const retryAfterSeconds = detail.retry_after_seconds;

  return typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
    ? Math.max(1, Math.ceil(retryAfterSeconds))
    : null;
}

function readHttpErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const detail = isRecord(payload.detail) ? payload.detail : payload;
  return toStringValue(detail.message) ?? toStringValue(payload.detail);
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return null;
}

function serializeTimestamp(value: Date): string {
  return value.toISOString();
}

function buildClientOpenMeteoUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(5),
    longitude: longitude.toFixed(5),
    timezone: CLIENT_OPEN_METEO_TIMEZONE,
    cell_selection: "land",
    current: CLIENT_OPEN_METEO_CURRENT_FIELDS.join(","),
    hourly: CLIENT_OPEN_METEO_HOURLY_FIELDS.join(","),
    daily: CLIENT_OPEN_METEO_DAILY_FIELDS.join(","),
    minutely_15: CLIENT_OPEN_METEO_MINUTELY_15_FIELDS.join(","),
    forecast_minutely_15: "4",
    forecast_hours: "12",
    past_hours: "6",
    forecast_days: "3",
  });
  return `${CLIENT_OPEN_METEO_FORECAST_URL}?${params.toString()}`;
}

function findSeriesStartIndex(times: unknown, currentTime: string | null): number {
  if (!Array.isArray(times) || times.length === 0) return 0;
  if (!currentTime) return 0;

  for (let index = 0; index < times.length; index += 1) {
    if (typeof times[index] === "string" && times[index] >= currentTime) {
      return index;
    }
  }

  return 0;
}

function summarizeHourWindow(
  hourly: Record<string, unknown>,
  currentTime: string | null,
  hours: number
): WeatherForecastWindow | null {
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  if (times.length === 0) return null;

  const startIndex = findSeriesStartIndex(times, currentTime);
  const endIndex = Math.min(times.length, startIndex + hours);
  const rainProbabilities = Array.isArray(hourly.precipitation_probability)
    ? hourly.precipitation_probability
    : [];
  const rainAmounts = Array.isArray(hourly.rain) ? hourly.rain : [];
  const windSpeeds = Array.isArray(hourly.wind_speed_10m) ? hourly.wind_speed_10m : [];

  const probabilityValues = rainProbabilities
    .slice(startIndex, endIndex)
    .map(toNumber)
    .filter((value): value is number => value !== null);
  const rainValues = rainAmounts
    .slice(startIndex, endIndex)
    .map(toNumber)
    .filter((value): value is number => value !== null);
  const windValues = windSpeeds
    .slice(startIndex, endIndex)
    .map(toNumber)
    .filter((value): value is number => value !== null);

  return {
    hours,
    max_precipitation_probability:
      probabilityValues.length > 0 ? Math.max(...probabilityValues) : null,
    rain_sum:
      rainValues.length > 0
        ? Math.round(rainValues.reduce((sum, value) => sum + value, 0) * 10) / 10
        : 0,
    max_wind_speed_10m: windValues.length > 0 ? Math.max(...windValues) : null,
  };
}

function buildDailyForecast(daily: Record<string, unknown>): WeatherForecastDay[] {
  const times = Array.isArray(daily.time) ? daily.time : [];
  const weatherCodes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
  const maxTemps = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
  const minTemps = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
  const precipitationMax = Array.isArray(daily.precipitation_probability_max)
    ? daily.precipitation_probability_max
    : [];
  const rainSums = Array.isArray(daily.rain_sum) ? daily.rain_sum : [];

  return times.slice(0, 3).map((date, index) => ({
    date: typeof date === "string" ? date : null,
    weather_code: toInteger(weatherCodes[index]),
    temperature_2m_max: toNumber(maxTemps[index]),
    temperature_2m_min: toNumber(minTemps[index]),
    precipitation_probability_max: toNumber(precipitationMax[index]),
    rain_sum: toNumber(rainSums[index]),
  }));
}

function buildNextHourBuckets(
  minutely15: Record<string, unknown>,
  currentTime: string | null
): WeatherLocationBucket[] {
  const times = Array.isArray(minutely15.time) ? minutely15.time : [];
  if (times.length === 0) return [];

  const probabilities = Array.isArray(minutely15.precipitation_probability)
    ? minutely15.precipitation_probability
    : [];
  const rainAmounts = Array.isArray(minutely15.rain) ? minutely15.rain : [];
  const startIndex = findSeriesStartIndex(times, currentTime);
  const selectedTimes = times.slice(startIndex, startIndex + 4);
  const buckets: WeatherLocationBucket[] = [];

  for (let index = 0; index < selectedTimes.length; index += 2) {
    const bucketTimes = selectedTimes.slice(index, index + 2);
    if (bucketTimes.length === 0) continue;

    const probabilityValues = probabilities
      .slice(startIndex + index, startIndex + index + 2)
      .map(toNumber)
      .filter((value): value is number => value !== null);
    const rainValues = rainAmounts
      .slice(startIndex + index, startIndex + index + 2)
      .map(toNumber)
      .filter((value): value is number => value !== null);

    const averageProbability =
      probabilityValues.length > 0
        ? probabilityValues.reduce((sum, value) => sum + value, 0) / probabilityValues.length
        : null;

    buckets.push({
      start: typeof bucketTimes[0] === "string" ? bucketTimes[0] : null,
      end:
        typeof bucketTimes[bucketTimes.length - 1] === "string"
          ? bucketTimes[bucketTimes.length - 1]
          : null,
      rain_amount:
        rainValues.length > 0
          ? Math.round(rainValues.reduce((sum, value) => sum + value, 0) * 100) / 100
          : 0,
      precipitation_probability:
        averageProbability !== null ? Math.round(averageProbability) : null,
    });
  }

  return buckets;
}

function buildHourlyTimeline(
  hourly: Record<string, unknown>,
  currentTime: string | null
): WeatherLocationHourlyPoint[] {
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  if (times.length === 0) return [];

  const startIndex = findSeriesStartIndex(times, currentTime);
  const fromIndex = Math.max(0, startIndex - 6);
  const toIndex = Math.min(times.length, startIndex + 7);
  const rainAmounts = Array.isArray(hourly.rain) ? hourly.rain : [];
  const precipitationAmounts = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
  const probabilities = Array.isArray(hourly.precipitation_probability)
    ? hourly.precipitation_probability
    : [];
  const temperatures = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];

  return times.slice(fromIndex, toIndex).map((time, index) => {
    const absoluteIndex = fromIndex + index;
    return {
      time: typeof time === "string" ? time : null,
      offset_hours: absoluteIndex - startIndex,
      rain_amount: toNumber(rainAmounts[absoluteIndex]),
      precipitation_amount: toNumber(precipitationAmounts[absoluteIndex]),
      precipitation_probability: toNumber(probabilities[absoluteIndex]),
      temperature_2m: toNumber(temperatures[absoluteIndex]),
    };
  });
}

function buildFallbackMapFrames(
  hourlyTimeline: WeatherLocationHourlyPoint[]
): WeatherLocationMapFrame[] {
  return hourlyTimeline
    .filter((point) => point.offset_hours >= 0)
    .slice(0, CLIENT_OPEN_METEO_MAP_FRAME_COUNT)
    .map((point) => ({
      label: point.offset_hours === 0 ? "Now" : `+${point.offset_hours}h`,
      time: point.time ?? null,
      samples: [
        {
          sample_id: "center",
          precipitation_amount: point.precipitation_amount ?? point.rain_amount ?? null,
          temperature_2m: point.temperature_2m ?? null,
        },
      ],
    }));
}

function isUsableLocationForecastContext(context: WeatherLocationContext): boolean {
  return !(
    context.status === "error" ||
    context.current == null ||
    context.daily.length === 0 ||
    context.hourly_timeline.length === 0
  );
}

async function fetchClientLocationForecastContext({
  latitude,
  longitude,
  radiusKm = 8,
  label,
  mode,
}: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  label?: string;
  mode: "gps" | "manual";
}): Promise<WeatherLocationContext> {
  const response = await fetchJsonWithTimeout(
    buildClientOpenMeteoUrl(latitude, longitude),
    LOCATION_CONTEXT_CLIENT_OPEN_METEO_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new HttpStatusError(response.status);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (!isRecord(payload)) {
    throw new BackendPayloadError("Invalid client Open-Meteo forecast payload");
  }

  const current = isRecord(payload.current) ? payload.current : {};
  const currentTime = toStringValue(current.time);
  const hourly = isRecord(payload.hourly) ? payload.hourly : {};
  const daily = isRecord(payload.daily) ? payload.daily : {};
  const minutely15 = isRecord(payload.minutely_15) ? payload.minutely_15 : {};
  const hourlyTimeline = buildHourlyTimeline(hourly, currentTime);
  const context: WeatherLocationContext = {
    status: "ok",
    source: "open-meteo.client-fallback",
    generated_at: serializeTimestamp(new Date()),
    location: {
      label: label?.trim() || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
      latitude,
      longitude,
      mode,
    },
    current: {
      time: currentTime,
      temperature_2m: toNumber(current.temperature_2m),
      apparent_temperature: toNumber(current.apparent_temperature),
      relative_humidity_2m: toNumber(current.relative_humidity_2m),
      weather_code: toInteger(current.weather_code),
      wind_speed_10m: toNumber(current.wind_speed_10m),
      is_day: toBoolean(current.is_day),
    },
    next_6h: summarizeHourWindow(hourly, currentTime, 6),
    daily: buildDailyForecast(daily),
    next_hour_30m: buildNextHourBuckets(minutely15, currentTime),
    hourly_timeline: hourlyTimeline,
    map: {
      radius_km: radiusKm,
      samples: [
        {
          id: "center",
          latitude,
          longitude,
        },
      ],
      frames: buildFallbackMapFrames(hourlyTimeline),
    },
  };

  if (!isUsableLocationForecastContext(context)) {
    throw new BackendPayloadError("Unusable client Open-Meteo forecast payload");
  }

  return context;
}

function buildLocationContextRequestKey({
  latitude,
  longitude,
  radiusKm,
  label,
  mode,
}: {
  latitude: number;
  longitude: number;
  radiusKm: number;
  label?: string;
  mode: "gps" | "manual";
}) {
  return [
    latitude.toFixed(5),
    longitude.toFixed(5),
    radiusKm.toFixed(2),
    mode,
    label?.trim().toLowerCase() ?? "",
  ].join("|");
}

function getActiveRateLimitCooldownSeconds(requestKey: string): number | null {
  const cooldownExpiresAt = LOCATION_CONTEXT_RATE_LIMIT_COOLDOWNS.get(requestKey);
  if (!cooldownExpiresAt) return null;

  const remainingMs = cooldownExpiresAt - Date.now();
  if (remainingMs <= 0) {
    LOCATION_CONTEXT_RATE_LIMIT_COOLDOWNS.delete(requestKey);
    return null;
  }

  return Math.max(1, Math.ceil(remainingMs / 1000));
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort(new DOMException("Forecast request timed out.", "AbortError"));
  }, timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function fetchBackendLocationForecastContext(
  url: string
): Promise<WeatherLocationContext> {
  const response = await fetchJsonWithTimeout(url, LOCATION_CONTEXT_BACKEND_TIMEOUT_MS);
  if (!response.ok) {
    let errorPayload: unknown = null;

    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = null;
    }

    throw new HttpStatusError(response.status, {
      message: readHttpErrorMessage(errorPayload),
      retryAfterSeconds:
        readRetryAfterSeconds(response.headers.get("Retry-After")) ??
        readRetryAfterSecondsFromPayload(errorPayload),
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BackendPayloadError("Invalid backend forecast payload");
  }

  if (!isRecord(payload)) {
    throw new BackendPayloadError("Invalid backend forecast payload");
  }

  if (
    payload.status !== "ok" &&
    payload.status !== "error" &&
    payload.status !== "unavailable"
  ) {
    throw new BackendPayloadError("Invalid backend forecast payload");
  }

  return payload as WeatherLocationContext;
}

export function isForecastRateLimitError(error: unknown): error is ForecastRateLimitError {
  return error instanceof ForecastRateLimitError;
}

export async function fetchForecastSummaries(
  sensorIds: string[]
): Promise<WeatherForecastSummary[]> {
  const cleanedIds = sensorIds
    .map((sensorId) => sensorId.trim())
    .filter(Boolean);

  if (cleanedIds.length === 0) return [];

  const params = new URLSearchParams({
    sensor_ids: cleanedIds.join(","),
  });
  const response = await fetch(
    `${API_BASE}/weather/forecast-summaries?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.summaries) ? payload.summaries : [];
}

export async function fetchLocationForecastContext({
  latitude,
  longitude,
  radiusKm = 8,
  label,
  mode,
}: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  label?: string;
  mode: "gps" | "manual";
}): Promise<WeatherLocationContext> {
  const requestKey = buildLocationContextRequestKey({
    latitude,
    longitude,
    radiusKm,
    label,
    mode,
  });
  const cooldownSeconds = getActiveRateLimitCooldownSeconds(requestKey);
  if (cooldownSeconds !== null) {
    throw new ForecastRateLimitError(cooldownSeconds);
  }

  const inFlightRequest = LOCATION_CONTEXT_IN_FLIGHT_REQUESTS.get(requestKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    radius_km: String(radiusKm),
    mode,
  });
  if (label?.trim()) {
    params.set("label", label.trim());
  }

  const backendUrl = `${API_BASE}/weather/location-context?${params.toString()}`;
  const requestPromise = (async () => {
    try {
      const backendContext = await fetchBackendLocationForecastContext(backendUrl);
      if (!ENABLE_CLIENT_OPEN_METEO_FALLBACK || isUsableLocationForecastContext(backendContext)) {
        return backendContext;
      }

      try {
        return await fetchClientLocationForecastContext({
          latitude,
          longitude,
          radiusKm,
          label,
          mode,
        });
      } catch {
        return backendContext;
      }
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 429) {
        LOCATION_CONTEXT_RATE_LIMIT_COOLDOWNS.set(
          requestKey,
          Date.now() + LOCATION_CONTEXT_RATE_LIMIT_COOLDOWN_MS
        );
        if (ENABLE_CLIENT_OPEN_METEO_FALLBACK) {
          try {
            return await fetchClientLocationForecastContext({
              latitude,
              longitude,
              radiusKm,
              label,
              mode,
            });
          } catch {
            // Fall through to the existing rate-limit error path.
          }
        }

        throw new ForecastRateLimitError(
          error.retryAfterSeconds ??
            Math.ceil(LOCATION_CONTEXT_RATE_LIMIT_COOLDOWN_MS / 1000)
        );
      }

      if (ENABLE_CLIENT_OPEN_METEO_FALLBACK) {
        try {
          return await fetchClientLocationForecastContext({
            latitude,
            longitude,
            radiusKm,
            label,
            mode,
          });
        } catch {
          // Preserve the original backend/network failure.
        }
      }

      throw error;
    } finally {
      LOCATION_CONTEXT_IN_FLIGHT_REQUESTS.delete(requestKey);
    }
  })();

  LOCATION_CONTEXT_IN_FLIGHT_REQUESTS.set(requestKey, requestPromise);
  return requestPromise;
}

export function getWeatherCodeMeta(
  weatherCode: number | null | undefined,
  isDay: boolean | null | undefined
): {
  label: string;
  Icon: LucideIcon;
} {
  const day = isDay !== false;

  if (weatherCode === 0) {
    return {
      label: day ? "Clear sky" : "Clear night",
      Icon: day ? Sun : Moon,
    };
  }

  if (weatherCode === 1 || weatherCode === 2) {
    return {
      label: day ? "Partly cloudy" : "Partly cloudy night",
      Icon: day ? CloudSun : CloudMoon,
    };
  }

  if (weatherCode === 3) {
    return { label: "Cloudy", Icon: Cloud };
  }

  if (weatherCode === 45 || weatherCode === 48) {
    return { label: "Fog", Icon: CloudFog };
  }

  if (
    weatherCode === 51 ||
    weatherCode === 53 ||
    weatherCode === 55 ||
    weatherCode === 56 ||
    weatherCode === 57
  ) {
    return { label: "Drizzle", Icon: CloudDrizzle };
  }

  if (
    weatherCode === 61 ||
    weatherCode === 63 ||
    weatherCode === 65 ||
    weatherCode === 66 ||
    weatherCode === 67 ||
    weatherCode === 80 ||
    weatherCode === 81 ||
    weatherCode === 82
  ) {
    return { label: "Precipitation", Icon: CloudRain };
  }

  if (
    weatherCode === 71 ||
    weatherCode === 73 ||
    weatherCode === 75 ||
    weatherCode === 77 ||
    weatherCode === 85 ||
    weatherCode === 86
  ) {
    return { label: "Snow", Icon: Snowflake };
  }

  if (weatherCode === 95 || weatherCode === 96 || weatherCode === 99) {
    return { label: "Thunderstorm", Icon: CloudLightning };
  }

  return { label: "Weather update", Icon: Cloud };
}

export function formatTemperature(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(1).replace(/\.0$/, "")}°C`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(Number(value))}%`;
}

export function formatWind(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(Number(value))} km/h`;
}

export function formatPrecipAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(1).replace(/\.0$/, "")} mm`;
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatShortTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
