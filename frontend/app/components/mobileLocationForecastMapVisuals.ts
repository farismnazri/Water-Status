import type { WeatherLocationMapFrame } from "../lib/weather";

export type MobileLocationForecastLayer = "precipitation" | "temperature";

export type MobileLocationForecastValueDomain = {
  min: number;
  max: number;
};

type GradientStop = {
  stop: number;
  color: readonly [number, number, number];
};

export const LOCAL_MAP_FOCUS_RADIUS_KM = 6;
export const LOCAL_MAP_SCALE_BAR_KM = 5;

const TEMPERATURE_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0, color: [147, 197, 253] },
  { stop: 0.28, color: [125, 211, 252] },
  { stop: 0.56, color: [253, 224, 71] },
  { stop: 0.8, color: [251, 146, 60] },
  { stop: 1, color: [249, 115, 22] },
];

const PRECIPITATION_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0, color: [224, 242, 254] },
  { stop: 0.24, color: [125, 211, 252] },
  { stop: 0.52, color: [56, 189, 248] },
  { stop: 0.78, color: [14, 165, 233] },
  { stop: 1, color: [2, 132, 199] },
];

export const MOBILE_LOCATION_FORECAST_LAYER_VISUALS: Record<
  MobileLocationForecastLayer,
  {
    fieldAlpha: number;
    gradientStops: GradientStop[];
    legendGradient: string;
    legendLabelShadow: string;
    unitSuffix: string;
  }
> = {
  precipitation: {
    fieldAlpha: 0.88,
    gradientStops: PRECIPITATION_GRADIENT_STOPS,
    legendGradient:
      "linear-gradient(180deg,#0284c7 0%,#0ea5e9 38%,#38bdf8 68%,#e0f2fe 100%)",
    legendLabelShadow:
      "0 0 14px rgba(14,165,233,0.28), 0 0 4px rgba(255,255,255,0.9)",
    unitSuffix: " mm",
  },
  temperature: {
    fieldAlpha: 0.92,
    gradientStops: TEMPERATURE_GRADIENT_STOPS,
    legendGradient:
      "linear-gradient(180deg,#f97316 0%,#fb923c 38%,#fcd34d 68%,#93c5fd 100%)",
    legendLabelShadow:
      "0 0 14px rgba(249,115,22,0.28), 0 0 4px rgba(255,255,255,0.9)",
    unitSuffix: "°",
  },
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function mixColor(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  amount: number
) {
  return [
    Math.round(start[0] + (end[0] - start[0]) * amount),
    Math.round(start[1] + (end[1] - start[1]) * amount),
    Math.round(start[2] + (end[2] - start[2]) * amount),
  ] as const;
}

export function getGradientColorForLayer(
  layer: MobileLocationForecastLayer,
  normalizedValue: number
) {
  const clamped = clamp(normalizedValue, 0, 1);
  const stops = MOBILE_LOCATION_FORECAST_LAYER_VISUALS[layer].gradientStops;

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];

    if (clamped <= next.stop) {
      const segment =
        (clamped - previous.stop) / Math.max(next.stop - previous.stop, 0.0001);
      return mixColor(previous.color, next.color, segment);
    }
  }

  return stops[stops.length - 1]?.color ?? [255, 255, 255];
}

export function getStableMapValueDomain(
  frames: WeatherLocationMapFrame[],
  layer: MobileLocationForecastLayer
): MobileLocationForecastValueDomain | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const frame of frames) {
    for (const sample of frame.samples) {
      const value =
        layer === "temperature"
          ? sample.temperature_2m
          : sample.precipitation_amount;

      if (typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }

      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}

export function getLegendValueDigits(
  layer: MobileLocationForecastLayer,
  domain: MobileLocationForecastValueDomain
) {
  const spread = Math.abs(domain.max - domain.min);

  if (layer === "precipitation") {
    if (domain.max < 1 || spread < 0.6) return 2;
    if (domain.max < 10 || spread < 4) return 1;
    return 0;
  }

  return spread < 2 ? 1 : 0;
}

export function formatLegendValue(
  value: number,
  layer: MobileLocationForecastLayer,
  digits: number
) {
  return `${value.toFixed(digits)}${MOBILE_LOCATION_FORECAST_LAYER_VISUALS[layer].unitSuffix}`;
}

export function normalizeValueToDomain(
  value: number,
  domain: MobileLocationForecastValueDomain
) {
  if (domain.max === domain.min) {
    return 0.5;
  }

  return clamp((value - domain.min) / (domain.max - domain.min), 0, 1);
}
