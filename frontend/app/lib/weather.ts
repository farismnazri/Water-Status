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

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_TIMEZONE = "Asia/Kuala_Lumpur";
const LOCATION_CONTEXT_BACKEND_TIMEOUT_MS = 10_000;
const LOCATION_CONTEXT_FALLBACK_TIMEOUT_MS = 10_000;
const LOCATION_CONTEXT_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const OPEN_METEO_MAP_SAMPLE_GRID: Array<[string, number, number]> = [
  ["north-west", 1, -1],
  ["north", 1, 0],
  ["north-east", 1, 1],
  ["west", 0, -1],
  ["center", 0, 0],
  ["east", 0, 1],
  ["south-west", -1, -1],
  ["south", -1, 0],
  ["south-east", -1, 1],
];
const LOCATION_CONTEXT_IN_FLIGHT_REQUESTS = new Map<
  string,
  Promise<WeatherLocationContext>
>();
const LOCATION_CONTEXT_RATE_LIMIT_COOLDOWNS = new Map<string, number>();
const WEATHER_CLIENT_ENV = (import.meta as any)?.env as
  | {
      VITE_ENABLE_CLIENT_OPEN_METEO_FALLBACK?: string;
    }
  | undefined;
const LOCATION_CONTEXT_ENABLE_CLIENT_FALLBACK =
  (WEATHER_CLIENT_ENV?.VITE_ENABLE_CLIENT_OPEN_METEO_FALLBACK ?? "").trim() === "1";

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
export const CLIENT_FORECAST_FALLBACK_SOURCE = "open-meteo.client-fallback";

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

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function findSeriesStartIndex(times: string[], currentTime: string | null): number {
  if (!currentTime) return 0;

  const nextIndex = times.findIndex((candidate) => candidate >= currentTime);
  return nextIndex >= 0 ? nextIndex : 0;
}

function addMinutes(value: string | null, minutes: number): string | null {
  if (!value) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setMinutes(parsed.getMinutes() + minutes);
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  const hours = `${parsed.getHours()}`.padStart(2, "0");
  const mins = `${parsed.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

function summarizeHourWindow(
  hourly: Record<string, unknown>,
  currentTime: string | null,
  hours: number
): WeatherForecastWindow | null {
  const times = Array.isArray(hourly.time)
    ? hourly.time.filter((item): item is string => typeof item === "string")
    : [];
  if (times.length === 0) return null;

  const startIndex = findSeriesStartIndex(times, currentTime);
  const endIndex = Math.min(times.length, startIndex + hours);
  const precipitationProbabilities = Array.isArray(hourly.precipitation_probability)
    ? hourly.precipitation_probability
    : [];
  const rainValues = Array.isArray(hourly.rain) ? hourly.rain : [];
  const windValues = Array.isArray(hourly.wind_speed_10m) ? hourly.wind_speed_10m : [];

  const probabilityWindow = precipitationProbabilities
    .slice(startIndex, endIndex)
    .map(toNumber)
    .filter((value): value is number => value !== null);
  const rainWindow = rainValues
    .slice(startIndex, endIndex)
    .map(toNumber)
    .filter((value): value is number => value !== null);
  const windWindow = windValues
    .slice(startIndex, endIndex)
    .map(toNumber)
    .filter((value): value is number => value !== null);

  return {
    hours,
    max_precipitation_probability:
      probabilityWindow.length > 0 ? Math.max(...probabilityWindow) : null,
    rain_sum:
      rainWindow.length > 0
        ? Number(rainWindow.reduce((sum, value) => sum + value, 0).toFixed(1))
        : 0,
    max_wind_speed_10m: windWindow.length > 0 ? Math.max(...windWindow) : null,
  };
}

function summarizeDaily(payload: Record<string, unknown>): WeatherForecastDay[] {
  const daily = isRecord(payload.daily) ? payload.daily : {};
  const times = Array.isArray(daily.time)
    ? daily.time.filter((item): item is string => typeof item === "string")
    : [];
  const weatherCodes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
  const maxTemps = Array.isArray(daily.temperature_2m_max)
    ? daily.temperature_2m_max
    : [];
  const minTemps = Array.isArray(daily.temperature_2m_min)
    ? daily.temperature_2m_min
    : [];
  const precipitationMax = Array.isArray(daily.precipitation_probability_max)
    ? daily.precipitation_probability_max
    : [];
  const rainSums = Array.isArray(daily.rain_sum) ? daily.rain_sum : [];

  return times.slice(0, 3).map((date, index) => ({
    date,
    weather_code: toInteger(weatherCodes[index]),
    temperature_2m_max: toNumber(maxTemps[index]),
    temperature_2m_min: toNumber(minTemps[index]),
    precipitation_probability_max: toNumber(precipitationMax[index]),
    rain_sum: toNumber(rainSums[index]),
  }));
}

function buildHourlyTimeline(
  payload: Record<string, unknown>,
  pastHours = 6,
  futureHours = 6
): WeatherLocationHourlyPoint[] {
  const current = isRecord(payload.current) ? payload.current : {};
  const currentTime = toStringValue(current.time);
  const hourly = isRecord(payload.hourly) ? payload.hourly : {};
  const times = Array.isArray(hourly.time)
    ? hourly.time.filter((item): item is string => typeof item === "string")
    : [];
  if (times.length === 0) return [];

  const startIndex = findSeriesStartIndex(times, currentTime);
  const fromIndex = Math.max(0, startIndex - pastHours);
  const toIndex = Math.min(times.length, startIndex + futureHours + 1);
  const rainValues = Array.isArray(hourly.rain) ? hourly.rain : [];
  const precipitationValues = Array.isArray(hourly.precipitation) ? hourly.precipitation : [];
  const precipitationProbabilities = Array.isArray(hourly.precipitation_probability)
    ? hourly.precipitation_probability
    : [];
  const temperatureValues = Array.isArray(hourly.temperature_2m)
    ? hourly.temperature_2m
    : [];

  return times.slice(fromIndex, toIndex).map((time, offsetIndex) => {
    const absoluteIndex = fromIndex + offsetIndex;
    return {
      time,
      offset_hours: absoluteIndex - startIndex,
      rain_amount: toNumber(rainValues[absoluteIndex]),
      precipitation_amount: toNumber(precipitationValues[absoluteIndex]),
      precipitation_probability: toNumber(precipitationProbabilities[absoluteIndex]),
      temperature_2m: toNumber(temperatureValues[absoluteIndex]),
    };
  });
}

function buildNextHour30m(payload: Record<string, unknown>): WeatherLocationBucket[] {
  const current = isRecord(payload.current) ? payload.current : {};
  const currentTime = toStringValue(current.time);
  const minutely = isRecord(payload.minutely_15) ? payload.minutely_15 : {};
  const times = Array.isArray(minutely.time)
    ? minutely.time.filter((item): item is string => typeof item === "string")
    : [];
  if (times.length === 0) return [];

  const startIndex = findSeriesStartIndex(times, currentTime);
  const precipitationProbabilities = Array.isArray(minutely.precipitation_probability)
    ? minutely.precipitation_probability
    : [];
  const rainValues = Array.isArray(minutely.rain) ? minutely.rain : [];
  const buckets: WeatherLocationBucket[] = [];

  for (let index = startIndex; index < Math.min(times.length, startIndex + 4); index += 2) {
    const bucketTimes = times.slice(index, index + 2);
    if (bucketTimes.length === 0) continue;

    const probabilityValues = precipitationProbabilities
      .slice(index, index + 2)
      .map(toNumber)
      .filter((value): value is number => value !== null);
    const bucketRainValues = rainValues
      .slice(index, index + 2)
      .map(toNumber)
      .filter((value): value is number => value !== null);
    const averageProbability = average(probabilityValues);

    buckets.push({
      start: bucketTimes[0] ?? null,
      end: addMinutes(bucketTimes[bucketTimes.length - 1] ?? null, 15),
      rain_amount:
        bucketRainValues.length > 0
          ? Number(bucketRainValues.reduce((sum, value) => sum + value, 0).toFixed(2))
          : 0,
      precipitation_probability:
        averageProbability === null ? null : Math.round(averageProbability),
    });
  }

  return buckets;
}

function radiusKmToDeltas(latitude: number, radiusKm: number) {
  const stepKm = Math.max(radiusKm / 2, 0.1);
  const latDelta = stepKm / 111;
  const lonDelta =
    stepKm / (111 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2));
  return { latDelta, lonDelta };
}

function buildLocationSamples(
  latitude: number,
  longitude: number,
  radiusKm: number
): WeatherLocationMapSample[] {
  const { latDelta, lonDelta } = radiusKmToDeltas(latitude, radiusKm);

  return OPEN_METEO_MAP_SAMPLE_GRID.map(([id, rowOffset, colOffset]) => ({
    id,
    latitude: Number((latitude + latDelta * rowOffset).toFixed(5)),
    longitude: Number((longitude + lonDelta * colOffset).toFixed(5)),
  }));
}

function buildBaseLocationSummary(payload: Record<string, unknown>) {
  const current = isRecord(payload.current) ? payload.current : {};
  const currentTime = toStringValue(current.time);

  return {
    status: "ok" as const,
    generated_at: new Date().toISOString(),
    current: {
      time: currentTime,
      temperature_2m: toNumber(current.temperature_2m),
      apparent_temperature: toNumber(current.apparent_temperature),
      relative_humidity_2m: toNumber(current.relative_humidity_2m),
      weather_code: toInteger(current.weather_code),
      wind_speed_10m: toNumber(current.wind_speed_10m),
      is_day:
        typeof current.is_day === "number"
          ? current.is_day === 1
          : typeof current.is_day === "boolean"
            ? current.is_day
            : null,
    },
    next_6h: summarizeHourWindow(
      isRecord(payload.hourly) ? payload.hourly : {},
      currentTime,
      6
    ),
    daily: summarizeDaily(payload),
  };
}

function buildOpenMeteoLocationContext({
  payload,
  latitude,
  longitude,
  radiusKm,
  label,
  mode,
}: {
  payload: Record<string, unknown>;
  latitude: number;
  longitude: number;
  radiusKm: number;
  label?: string;
  mode: "gps" | "manual";
}): WeatherLocationContext {
  const summary = buildBaseLocationSummary(payload);

  return {
    status: summary.status,
    source: CLIENT_FORECAST_FALLBACK_SOURCE,
    generated_at: summary.generated_at,
    location: {
      label: label?.trim() || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
      latitude,
      longitude,
      mode,
    },
    current: summary.current,
    next_6h: summary.next_6h,
    daily: summary.daily,
    next_hour_30m: buildNextHour30m(payload),
    hourly_timeline: buildHourlyTimeline(payload),
    map: {
      radius_km: radiusKm,
      samples: buildLocationSamples(latitude, longitude, radiusKm),
      frames: [],
    },
  };
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

function shouldFallbackToClientForecast(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status === 404 || error.status >= 500;
  }

  if (error instanceof BackendPayloadError) {
    return true;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  return false;
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

async function fetchOpenMeteoLocationForecastContext({
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
}): Promise<WeatherLocationContext> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone: OPEN_METEO_TIMEZONE,
    cell_selection: "land",
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m",
      "is_day",
    ].join(","),
    hourly: [
      "temperature_2m",
      "precipitation_probability",
      "precipitation",
      "rain",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "rain_sum",
    ].join(","),
    forecast_hours: "12",
    past_hours: "6",
    forecast_days: "3",
    minutely_15: [
      "temperature_2m",
      "precipitation_probability",
      "precipitation",
      "rain",
    ].join(","),
    forecast_minutely_15: "4",
  });

  const response = await fetchJsonWithTimeout(
    `${OPEN_METEO_FORECAST_URL}?${params.toString()}`,
    LOCATION_CONTEXT_FALLBACK_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new HttpStatusError(response.status);
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    throw new BackendPayloadError("Invalid Open-Meteo forecast payload");
  }

  return buildOpenMeteoLocationContext({
    payload,
    latitude,
    longitude,
    radiusKm,
    label,
    mode,
  });
}

export function isClientForecastFallbackSource(source: string | null | undefined): boolean {
  return source === CLIENT_FORECAST_FALLBACK_SOURCE;
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
      if (backendContext.status === "ok") {
        return backendContext;
      }

      if (LOCATION_CONTEXT_ENABLE_CLIENT_FALLBACK) {
        try {
          return await fetchOpenMeteoLocationForecastContext({
            latitude,
            longitude,
            radiusKm,
            label,
            mode,
          });
        } catch {
          return backendContext;
        }
      }

      return backendContext;
    } catch (error) {
      if (error instanceof HttpStatusError && error.status === 429) {
        LOCATION_CONTEXT_RATE_LIMIT_COOLDOWNS.set(
          requestKey,
          Date.now() + LOCATION_CONTEXT_RATE_LIMIT_COOLDOWN_MS
        );
        throw new ForecastRateLimitError(
          error.retryAfterSeconds ??
            Math.ceil(LOCATION_CONTEXT_RATE_LIMIT_COOLDOWN_MS / 1000)
        );
      }

      if (
        LOCATION_CONTEXT_ENABLE_CLIENT_FALLBACK &&
        shouldFallbackToClientForecast(error)
      ) {
        return fetchOpenMeteoLocationForecastContext({
          latitude,
          longitude,
          radiusKm,
          label,
          mode,
        });
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
