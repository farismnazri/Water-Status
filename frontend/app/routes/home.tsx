import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Waves,
  CloudRain,
  ThermometerSun,
  ArrowRight,
} from "lucide-react";
import { API_BASE } from "../lib/api";
import { HeroPreviewMap } from "../components/HeroPreviewMap";
import ShinyText from "../components/ShinyText";
import {
  fetchForecastSummaries,
  formatPercent,
  formatRainAmount,
  formatShortDate,
  formatTemperature,
  formatWind,
  getWeatherCodeMeta,
  OPEN_METEO_ATTRIBUTION_LABEL,
  OPEN_METEO_ATTRIBUTION_URL,
  type WeatherForecastSummary,
} from "../lib/weather";

type SensorType = "rain" | "water_level" | "temperature";

type HomePreviewItem = {
  id: string;
  name: string;
  location: string;
  type: SensorType;
  unit: string;
  latitude: number | null;
  longitude: number | null;
  value: number | null;
  timestamp?: string | null;
  source?: string;
};

type PreviewItem = {
  id: string;
  name: string;
  location: string;
  type: SensorType;
  display: string;
  value: number | null;
  latitude: number | null;
  longitude: number | null;
};

type PreviewByType = Record<SensorType, PreviewItem[]>;

const previewSections = [
  {
    type: "rain" as const,
    label: "Rain",
    icon: CloudRain,
    shellClass: "bg-sky-100",
    iconClass: "text-sky-500",
    activeItemClass: "border-sky-200/90 bg-sky-50/82",
  },
  {
    type: "water_level" as const,
    label: "Water levels",
    icon: Waves,
    shellClass: "bg-emerald-100",
    iconClass: "text-emerald-500",
    activeItemClass: "border-emerald-200/90 bg-emerald-50/82",
  },
  {
    type: "temperature" as const,
    label: "Heat",
    icon: ThermometerSun,
    shellClass: "bg-rose-100",
    iconClass: "text-rose-500",
    activeItemClass: "border-rose-200/90 bg-rose-50/82",
  },
];

const PREVIEW_REQUEST_TIMEOUT_MS = 4500;
const FORECAST_REFRESH_INTERVAL_MS = 10_000;

const fallbackPreviewItems: HomePreviewItem[] = [
  {
    id: "demo-rain-1",
    name: "KLCC Rain Gauge",
    location: "Kuala Lumpur City Centre",
    type: "rain",
    unit: "mm/h",
    value: 1.2,
    latitude: 3.1563,
    longitude: 101.7117,
  },
  {
    id: "demo-rain-2",
    name: "Batu Caves Rain Gauge",
    location: "Batu Caves",
    type: "rain",
    unit: "mm/h",
    value: 4.8,
    latitude: 3.2379,
    longitude: 101.6843,
  },
  {
    id: "demo-rain-3",
    name: "Putrajaya Rain Gauge",
    location: "Presint 9, Putrajaya",
    type: "rain",
    unit: "mm/h",
    value: 0,
    latitude: 2.9264,
    longitude: 101.6964,
  },
  {
    id: "demo-water-1",
    name: "Sungai Klang Watch",
    location: "Masjid Jamek",
    type: "water_level",
    unit: "m",
    value: 2.4,
    latitude: 3.149,
    longitude: 101.695,
  },
  {
    id: "demo-water-2",
    name: "Sungai Gombak Watch",
    location: "Jalan Tun Razak",
    type: "water_level",
    unit: "m",
    value: 1.8,
    latitude: 3.166,
    longitude: 101.72,
  },
  {
    id: "demo-water-3",
    name: "Ampang Spillway",
    location: "Ampang",
    type: "water_level",
    unit: "m",
    value: 1.3,
    latitude: 3.1498,
    longitude: 101.7611,
  },
  {
    id: "demo-temp-1",
    name: "Subang Weather Mast",
    location: "Subang Jaya",
    type: "temperature",
    unit: "C",
    value: 31.6,
    latitude: 3.081,
    longitude: 101.585,
  },
  {
    id: "demo-temp-2",
    name: "Cyberjaya Weather Mast",
    location: "Cyberjaya",
    type: "temperature",
    unit: "C",
    value: 30.9,
    latitude: 2.9225,
    longitude: 101.6501,
  },
  {
    id: "demo-temp-3",
    name: "Genting Weather Mast",
    location: "Genting Highlands",
    type: "temperature",
    unit: "C",
    value: 23.4,
    latitude: 3.4238,
    longitude: 101.7932,
  },
];

function formatReadingValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(1).replace(/\.0$/, "");
}

function normalizeUnit(unit?: string): string {
  if (!unit) return "";
  if (unit === "C") return "°C";
  return unit;
}

function rainLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0.1) return "No rain";
  if (value < 2) return "Light rain";
  if (value < 7.5) return "Moderate rain";
  if (value < 15) return "Steady rain";
  if (value < 30) return "Heavy rain";
  return "Very heavy rain";
}

function hasCoordinates(
  item: PreviewItem
): item is PreviewItem & {
  latitude: number;
  longitude: number;
} {
  return (
    typeof item.latitude === "number" &&
    Number.isFinite(item.latitude) &&
    typeof item.longitude === "number" &&
    Number.isFinite(item.longitude)
  );
}

function formatPreviewDisplay(item: HomePreviewItem): {
  value: number | null;
  display: string;
} {
  if (item.value === null || item.value === undefined) {
    return { value: null, display: "Waiting data" };
  }

  const value = Number(item.value);
  const unit = normalizeUnit(item.unit);

  if (item.type === "rain") {
    const label = rainLabel(value);
    const numeric = unit ? `${formatReadingValue(value)} ${unit}` : formatReadingValue(value);
    return {
      value,
      display: label === "No rain" ? label : `${label} · ${numeric}`,
    };
  }

  return {
    value,
    display: unit ? `${formatReadingValue(value)} ${unit}` : formatReadingValue(value),
  };
}

function getRotatingPair<T>(items: T[], step: number): T[] {
  if (items.length <= 2) return items;

  const start = (step * 2) % items.length;
  const pair = items.slice(start, start + 2);

  if (pair.length < 2) {
    pair.push(...items.slice(0, 2 - pair.length));
  }

  return pair;
}

export default function Home() {
  const isClient = typeof window !== "undefined";
  const hasLoadedPreviewRef = useRef(false);
  const [previewItems, setPreviewItems] = useState<HomePreviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFallbackPreview, setIsFallbackPreview] = useState(false);
  const [rotationStep, setRotationStep] = useState(0);
  const [isPreviewPaused, setIsPreviewPaused] = useState(false);
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastBySensorId, setForecastBySensorId] = useState<
    Record<string, WeatherForecastSummary>
  >({});

  useEffect(() => {
    let isMounted = true;

    async function loadPreview() {
      const isInitialLoad = !hasLoadedPreviewRef.current;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PREVIEW_REQUEST_TIMEOUT_MS);

      try {
        if (isInitialLoad) {
          setPreviewLoading(true);
          setPreviewError(null);
        }

        const response = await fetch(`${API_BASE}/home-preview`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const nextItems = Array.isArray(data?.items) ? data.items : [];

        if (!isMounted) return;

        if (nextItems.length === 0) {
          setPreviewItems(fallbackPreviewItems);
          setIsFallbackPreview(true);
          setPreviewError(null);
          return;
        }

        setPreviewItems(nextItems);
        setIsFallbackPreview(false);
        setPreviewError(null);
      } catch (error) {
        console.error(error);
        if (!isMounted) return;

        setPreviewItems(fallbackPreviewItems);
        setIsFallbackPreview(true);
        setPreviewError(null);
      } finally {
        window.clearTimeout(timeout);
        if (!isMounted) return;
        hasLoadedPreviewRef.current = true;
        setPreviewLoading(false);
      }
    }

    loadPreview();

    const refresh = window.setInterval(loadPreview, 60_000);
    return () => {
      isMounted = false;
      window.clearInterval(refresh);
    };
  }, []);

  const previewByType = useMemo(() => {
    const grouped: PreviewByType = {
      rain: [],
      water_level: [],
      temperature: [],
    };

    previewItems.forEach((item) => {
      if (
        item.type !== "rain" &&
        item.type !== "water_level" &&
        item.type !== "temperature"
      ) {
        return;
      }

      const formatted = formatPreviewDisplay(item);
      grouped[item.type].push({
        id: item.id,
        name: item.name,
        location: item.location,
        type: item.type,
        display: formatted.display,
        value: formatted.value,
        latitude: item.latitude,
        longitude: item.longitude,
      });
    });

    (Object.keys(grouped) as SensorType[]).forEach((type) => {
      grouped[type].sort((a, b) => {
        const aValue = a.value ?? Number.NEGATIVE_INFINITY;
        const bValue = b.value ?? Number.NEGATIVE_INFINITY;
        if (bValue !== aValue) return bValue - aValue;
        return a.name.localeCompare(b.name);
      });
    });

    return grouped;
  }, [previewItems]);

  const hasAnyPreviewItems = useMemo(
    () => Object.values(previewByType).some((items) => items.length > 0),
    [previewByType]
  );

  const previewRotationEnabled = useMemo(
    () => previewSections.some((section) => previewByType[section.type].length > 2),
    [previewByType]
  );

  useEffect(() => {
    if (!previewRotationEnabled || isPreviewPaused) return;

    const rotation = window.setInterval(() => {
      setRotationStep((step) => step + 1);
    }, 5000);

    return () => window.clearInterval(rotation);
  }, [isPreviewPaused, previewRotationEnabled]);

  const visiblePreviewByType = useMemo(
    () =>
      ({
        rain: getRotatingPair(previewByType.rain, rotationStep),
        water_level: getRotatingPair(previewByType.water_level, rotationStep),
        temperature: getRotatingPair(previewByType.temperature, rotationStep),
      }) satisfies PreviewByType,
    [previewByType, rotationStep]
  );

  const visiblePreviewItems = useMemo(
    () => previewSections.flatMap((section) => visiblePreviewByType[section.type]),
    [visiblePreviewByType]
  );

  const visibleMapItems = useMemo(
    () => visiblePreviewItems.filter(hasCoordinates),
    [visiblePreviewItems]
  );

  const forecastTargets = useMemo(() => {
    const seenLocations = new Set<string>();
    const targets: PreviewItem[] = [];

    for (const item of visiblePreviewItems) {
      if (!hasCoordinates(item)) continue;

      const locationKey = item.location.trim().toLowerCase();
      if (seenLocations.has(locationKey)) continue;

      seenLocations.add(locationKey);
      targets.push(item);
      if (targets.length === 3) break;
    }

    return targets;
  }, [visiblePreviewItems]);

  const forecastTargetKey = useMemo(
    () => forecastTargets.map((item) => item.id).join(","),
    [forecastTargets]
  );

  useEffect(() => {
    let isMounted = true;
    let requestInFlight = false;
    const sensorIds = forecastTargets.map((item) => item.id);

    if (isFallbackPreview || sensorIds.length === 0) {
      setForecastBySensorId({});
      setForecastLoading(false);
      return;
    }

    async function loadForecasts() {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        setForecastLoading(true);
        const summaries = await fetchForecastSummaries(sensorIds);
        if (!isMounted) return;

        const nextBySensorId = summaries.reduce(
          (acc: Record<string, WeatherForecastSummary>, summary) => {
            if (summary?.sensor_id) {
              acc[summary.sensor_id] = summary;
            }
            return acc;
          },
          {}
        );

        setForecastBySensorId((current) => ({
          ...current,
          ...nextBySensorId,
        }));
      } catch (error) {
        console.error(error);
      } finally {
        if (isMounted) setForecastLoading(false);
        requestInFlight = false;
      }
    }

    loadForecasts();
    const refresh = window.setInterval(loadForecasts, FORECAST_REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(refresh);
    };
  }, [forecastTargetKey, isFallbackPreview]);

  const shouldShowForecastContext =
    !isFallbackPreview && forecastTargets.length > 0;

  return (
    <main className="min-h-screen">
      <section className="mx-auto max-w-5xl px-4 pb-12 pt-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute -left-12 top-0 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.82),rgba(255,255,255,0)_72%)] blur-3xl" />
            <div className="pointer-events-none absolute left-[4.5rem] top-[4.5rem] h-56 w-72 rounded-full bg-[radial-gradient(circle,rgba(89,170,247,0.18),rgba(89,170,247,0)_72%)] blur-3xl" />

            <div className="relative max-w-[40rem] space-y-5">
              <div className="space-y-3">
                <p className="text-base font-semibold tracking-tight text-slate-800/76 sm:text-lg">
                  “What&apos;s the weather like today?”
                </p>

                <h1 className="space-y-0 overflow-visible pb-2">
                  <ShinyText
                    text="Stop guessing."
                    speed={3}
                    delay={0.5}
                    color="#59aaf7"
                    shineColor="#b8ddff"
                    spread={100}
                    direction="left"
                    yoyo={false}
                    pauseOnHover={false}
                    disabled={false}
                    className="block overflow-visible pb-[0.08em] text-[3.4rem] font-semibold leading-[0.98] tracking-[-0.04em] sm:text-[4.7rem]"
                  />
                  <ShinyText
                    text="Start seeing."
                    speed={3}
                    delay={0.7}
                    color="#59aaf7"
                    shineColor="#b8ddff"
                    spread={100}
                    direction="left"
                    yoyo={false}
                    pauseOnHover={false}
                    disabled={false}
                    className="block -mt-[0.25em] overflow-visible pb-[0.08em] text-[3.4rem] font-semibold leading-[0.98] tracking-[-0.04em] sm:text-[4.7rem]"
                  />
                </h1>

                <p className="max-w-xl text-[15px] leading-7 text-slate-700/88 sm:text-base -mt-[0.8em]">
                  We bring together rain, river level and temperature from
                  stations around you, so you don&apos;t have to rely on generic
                  forecasts or rumours in the group chat.
                </p>
              </div>

              <HeroPreviewMap
                items={visibleMapItems}
                hoveredPreviewId={hoveredPreviewId}
                isClient={isClient}
                loading={previewLoading}
                error={previewError}
                hasPreviewItems={hasAnyPreviewItems}
                isFallbackPreview={isFallbackPreview}
              />
            </div>
          </div>

          <div className="lg:w-[34%]">
            <div
              className="ws-hero-glass-card relative flex h-full flex-col rounded-[1.75rem] p-4"
              onMouseEnter={() => setIsPreviewPaused(true)}
              onMouseLeave={() => {
                setIsPreviewPaused(false);
                setHoveredPreviewId(null);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                    </span>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ws-text-muted)]">
                      {isFallbackPreview ? "Fallback" : "Live"}
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {isFallbackPreview
                      ? "Showing built-in station samples while live data reconnects."
                      : "Updated recently"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex-1">
                {previewLoading ? (
                  <div className="space-y-3">
                    {previewSections.map((section) => {
                      const Icon = section.icon;

                      return (
                        <div key={section.type} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${section.shellClass}`}
                            >
                              <Icon className={`h-3.5 w-3.5 ${section.iconClass}`} />
                            </span>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {section.label}
                            </span>
                          </div>

                          <div className="space-y-2">
                            {Array.from({ length: 2 }).map((_, index) => (
                              <div
                                key={`${section.type}-${index}`}
                                className="ws-sensor-skeleton-card rounded-xl border px-3 py-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="ws-skeleton-text text-xs font-semibold uppercase tracking-[0.06em]">
                                      Loading
                                    </p>
                                    <p className="ws-skeleton-subtext mt-1 text-[10px] uppercase tracking-[0.08em]">
                                      Loading
                                    </p>
                                  </div>
                                  <p className="ws-skeleton-text shrink-0 text-right text-[10px] font-medium uppercase tracking-[0.08em]">
                                    Loading
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : previewError && !hasAnyPreviewItems ? (
                  <div className="rounded-xl border border-slate-200/75 bg-white/88 px-3 py-3 text-xs text-slate-600">
                    {previewError}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {previewSections.map((section) => {
                      const Icon = section.icon;
                      const items = visiblePreviewByType[section.type];

                      return (
                        <div key={section.type} className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${section.shellClass}`}
                            >
                              <Icon className={`h-3.5 w-3.5 ${section.iconClass}`} />
                            </span>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {section.label}
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            {items.length > 0 ? (
                              items.map((item) => {
                                const isHighlighted = hoveredPreviewId === item.id;

                                return (
                                  <div
                                    key={item.id}
                                    onMouseEnter={() => setHoveredPreviewId(item.id)}
                                    onMouseLeave={() =>
                                      setHoveredPreviewId((current) =>
                                        current === item.id ? null : current
                                      )
                                    }
                                    className={[
                                      "flex items-start justify-between gap-3 rounded-xl border px-3 py-2 transition duration-200",
                                      isHighlighted
                                        ? section.activeItemClass
                                        : "border-slate-200/75 bg-white/88",
                                    ].join(" ")}
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-semibold text-[var(--ws-text-main)]">
                                        {item.name}
                                      </p>
                                      <p className="truncate text-[10px] text-slate-500">
                                        {item.location}
                                      </p>
                                    </div>
                                    <p className="shrink-0 text-right text-[10px] font-medium text-slate-700">
                                      {item.display}
                                    </p>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="rounded-xl border border-slate-200/75 bg-white/88 px-3 py-2 text-[10px] text-slate-500">
                                No live {section.label.toLowerCase()} preview yet.
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <Link
                  to="/sensors"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--ws-accent)] px-4 py-3 text-sm font-medium text-slate-950 shadow-md transition hover:opacity-90"
                >
                  See live stations
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {shouldShowForecastContext ? (
          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Forecast Context
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Short-range weather context around the live stations already on screen.
                </p>
              </div>
              <a
                href={OPEN_METEO_ATTRIBUTION_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
              >
                {OPEN_METEO_ATTRIBUTION_LABEL}
              </a>
            </div>

            <div className="grid gap-3 md:auto-rows-fr md:grid-cols-3">
              {forecastTargets.map((item) => {
                const summary = forecastBySensorId[item.id];
                const current = summary?.current;
                const next6Hours = summary?.next_6h;
                const today = summary?.daily?.[0];
                const weatherMeta = getWeatherCodeMeta(
                  current?.weather_code,
                  current?.is_day
                );
                const WeatherIcon = weatherMeta.Icon;

                return (
                  <div
                    key={`forecast-${item.id}`}
                    className="ws-card ws-card-anim flex h-full min-h-[18.75rem] flex-col rounded-[1.4rem] border border-[var(--ws-border-subtle)] bg-white/72 p-4 shadow-[0_14px_28px_rgba(15,23,42,0.06)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {item.location}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {item.name}
                        </p>
                      </div>
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                        <WeatherIcon className="h-5 w-5" />
                      </span>
                    </div>

                    {forecastLoading && !summary ? (
                      <div className="mt-4 flex flex-1 flex-col">
                        <div className="flex items-end justify-between gap-3">
                          <div className="space-y-2">
                            <div className="ws-skeleton h-10 w-28 rounded-xl" />
                            <div className="ws-skeleton h-4 w-24 rounded-xl" />
                          </div>
                          <div className="space-y-2 text-right">
                            <div className="ws-skeleton ml-auto h-4 w-20 rounded-xl" />
                            <div className="ws-skeleton ml-auto h-4 w-16 rounded-xl" />
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
                          {Array.from({ length: 3 }).map((_, index) => (
                            <div
                              key={`forecast-skeleton-${item.id}-${index}`}
                              className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2"
                            >
                              <div className="ws-skeleton h-3 w-16 rounded-xl" />
                              <div className="mt-2 ws-skeleton h-6 w-full rounded-xl" />
                            </div>
                          ))}
                        </div>

                        <div className="mt-auto pt-3">
                          <div className="ws-skeleton h-3 w-24 rounded-xl" />
                        </div>
                      </div>
                    ) : summary?.status === "ok" ? (
                      <div className="mt-4 flex flex-1 flex-col">
                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <p className="text-3xl font-semibold tracking-tight text-slate-900">
                              {formatTemperature(current?.temperature_2m)}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              Feels like {formatTemperature(current?.apparent_temperature)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-slate-700">
                              {weatherMeta.label}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              Wind {formatWind(current?.wind_speed_10m)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
                          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                            <p className="text-slate-500">Next 6h rain</p>
                            <p className="mt-1 font-semibold text-slate-800">
                              {formatPercent(next6Hours?.max_precipitation_probability)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                            <p className="text-slate-500">Today high / low</p>
                            <p className="mt-1 font-semibold text-slate-800">
                              {formatTemperature(today?.temperature_2m_max)} /{" "}
                              {formatTemperature(today?.temperature_2m_min)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
                            <p className="text-slate-500">Next 6h rain sum</p>
                            <p className="mt-1 font-semibold text-slate-800">
                              {formatRainAmount(next6Hours?.rain_sum)}
                            </p>
                          </div>
                        </div>

                        <p className="mt-auto pt-3 text-[10px] text-slate-500">
                          Updated {formatShortDate(summary.generated_at || current?.time || null)}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-4 flex flex-1 flex-col">
                        <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-3 text-xs text-slate-500">
                          Forecast context is unavailable for this location right now.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
