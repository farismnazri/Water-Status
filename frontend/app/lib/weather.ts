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

export const OPEN_METEO_ATTRIBUTION_LABEL = "Weather data by Open-Meteo.com";
export const OPEN_METEO_ATTRIBUTION_URL = "https://open-meteo.com/";

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
    return { label: "Rain", Icon: CloudRain };
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

export function formatRainAmount(value: number | null | undefined): string {
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
