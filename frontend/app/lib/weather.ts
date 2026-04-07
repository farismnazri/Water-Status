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
const LOCATION_CONTEXT_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const LOCATION_CONTEXT_IN_FLIGHT_REQUESTS = new Map<
  string,
  Promise<WeatherLocationContext>
>();
const LOCATION_CONTEXT_RATE_LIMIT_COOLDOWNS = new Map<string, number>();

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
      return await fetchBackendLocationForecastContext(backendUrl);
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
