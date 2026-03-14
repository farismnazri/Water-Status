import { useEffect, useMemo, useState } from "react";
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

type SensorType = "rain" | "water_level" | "temperature";

type Sensor = {
  id: string;
  name: string;
  type: SensorType;
  location: string;
  unit: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
};

type LatestReading = {
  sensor_id: string;
  value: number;
  unit?: string;
  timestamp?: string;
};

type PreviewItem = {
  id: string;
  name: string;
  location: string;
  type: SensorType;
  display: string;
  value: number | null;
  latitude: number;
  longitude: number;
};

type PreviewByType = Record<SensorType, PreviewItem[]>;

const previewSections = [
  {
    type: "rain" as const,
    label: "Rain",
    icon: CloudRain,
    shellClass: "bg-sky-100",
    iconClass: "text-sky-500",
    markerColor: "#38bdf8",
    activeItemClass: "border-sky-200/90 bg-sky-50/82",
  },
  {
    type: "water_level" as const,
    label: "Water levels",
    icon: Waves,
    shellClass: "bg-emerald-100",
    iconClass: "text-emerald-500",
    markerColor: "#34d399",
    activeItemClass: "border-emerald-200/90 bg-emerald-50/82",
  },
  {
    type: "temperature" as const,
    label: "Heat",
    icon: ThermometerSun,
    shellClass: "bg-rose-100",
    iconClass: "text-rose-500",
    markerColor: "#fb7185",
    activeItemClass: "border-rose-200/90 bg-rose-50/82",
  },
];

const demoPreviewByType: PreviewByType = {
  rain: [
    {
      id: "demo-rain-1",
      name: "KLCC Rain Gauge",
      location: "Kuala Lumpur City Centre",
      type: "rain",
      display: "Light rain · 1.2 mm",
      value: 1.2,
      latitude: 3.1563,
      longitude: 101.7117,
    },
    {
      id: "demo-rain-2",
      name: "Batu Caves Rain Gauge",
      location: "Batu Caves",
      type: "rain",
      display: "Moderate rain · 4.8 mm",
      value: 4.8,
      latitude: 3.2379,
      longitude: 101.6843,
    },
    {
      id: "demo-rain-3",
      name: "Putrajaya Rain Gauge",
      location: "Presint 9, Putrajaya",
      type: "rain",
      display: "No rain",
      value: 0,
      latitude: 2.9264,
      longitude: 101.6964,
    },
  ],
  water_level: [
    {
      id: "demo-water-1",
      name: "Sungai Klang Watch",
      location: "Masjid Jamek",
      type: "water_level",
      display: "2.4 m",
      value: 2.4,
      latitude: 3.149,
      longitude: 101.695,
    },
    {
      id: "demo-water-2",
      name: "Sungai Gombak Watch",
      location: "Jalan Tun Razak",
      type: "water_level",
      display: "1.8 m",
      value: 1.8,
      latitude: 3.166,
      longitude: 101.72,
    },
    {
      id: "demo-water-3",
      name: "Ampang Spillway",
      location: "Ampang",
      type: "water_level",
      display: "1.3 m",
      value: 1.3,
      latitude: 3.1498,
      longitude: 101.7611,
    },
  ],
  temperature: [
    {
      id: "demo-temp-1",
      name: "Subang Weather Mast",
      location: "Subang Jaya",
      type: "temperature",
      display: "31.6 °C",
      value: 31.6,
      latitude: 3.081,
      longitude: 101.585,
    },
    {
      id: "demo-temp-2",
      name: "Cyberjaya Weather Mast",
      location: "Cyberjaya",
      type: "temperature",
      display: "30.9 °C",
      value: 30.9,
      latitude: 2.9225,
      longitude: 101.6501,
    },
    {
      id: "demo-temp-3",
      name: "Genting Weather Mast",
      location: "Genting Highlands",
      type: "temperature",
      display: "23.4 °C",
      value: 23.4,
      latitude: 3.4238,
      longitude: 101.7932,
    },
  ],
};

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
  sensor: Pick<Sensor, "latitude" | "longitude">
): sensor is Pick<Sensor, "latitude" | "longitude"> & {
  latitude: number;
  longitude: number;
} {
  return (
    typeof sensor.latitude === "number" &&
    Number.isFinite(sensor.latitude) &&
    typeof sensor.longitude === "number" &&
    Number.isFinite(sensor.longitude)
  );
}

function formatPreviewDisplay(sensor: Sensor, latest?: LatestReading): {
  value: number | null;
  display: string;
} {
  if (!latest || latest.value === null || latest.value === undefined) {
    return { value: null, display: "Waiting data" };
  }

  const value = Number(latest.value);
  const unit = normalizeUnit(latest.unit || sensor.unit);

  if (sensor.type === "rain") {
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
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [latestReadingsBySensor, setLatestReadingsBySensor] = useState<
    Record<string, LatestReading>
  >({});
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rotationStep, setRotationStep] = useState(0);
  const [isPreviewPaused, setIsPreviewPaused] = useState(false);
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadPreview() {
      try {
        setPreviewLoading(true);
        setPreviewError(null);

        const sensorsRes = await fetch(`${API_BASE}/sensors`);
        if (!sensorsRes.ok) throw new Error(`HTTP ${sensorsRes.status}`);

        const sensorsData = await sensorsRes.json();
        const sensorsList = sensorsData.sensors ?? sensorsData;
        const parsedSensors = Array.isArray(sensorsList) ? sensorsList : [];

        const latestRes = await fetch(`${API_BASE}/sensor-readings/latest-by-sensor`);
        let latestBySensor: Record<string, LatestReading> = {};

        if (latestRes.ok) {
          const latestData = await latestRes.json();
          const latestRows = latestData.latest_readings ?? [];
          latestBySensor = latestRows.reduce(
            (acc: Record<string, LatestReading>, row: LatestReading) => {
              if (row?.sensor_id) acc[row.sensor_id] = row;
              return acc;
            },
            {}
          );
        }

        if (!isMounted) return;

        setSensors(parsedSensors);
        setLatestReadingsBySensor(latestBySensor);
      } catch (error) {
        console.error(error);
        if (!isMounted) return;
        setPreviewError("Could not load live station previews right now.");
      } finally {
        if (isMounted) setPreviewLoading(false);
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

    sensors.forEach((sensor) => {
      if (!sensor.is_active || !hasCoordinates(sensor)) {
        return;
      }

      if (
        sensor.type !== "rain" &&
        sensor.type !== "water_level" &&
        sensor.type !== "temperature"
      ) {
        return;
      }

      const latest = latestReadingsBySensor[sensor.id];
      const formatted = formatPreviewDisplay(sensor, latest);

      grouped[sensor.type].push({
        id: sensor.id,
        name: sensor.name,
        location: sensor.location,
        type: sensor.type,
        display: formatted.display,
        value: formatted.value,
        latitude: sensor.latitude,
        longitude: sensor.longitude,
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
  }, [latestReadingsBySensor, sensors]);

  const hasLivePreviewItems = useMemo(
    () => Object.values(previewByType).some((items) => items.length > 0),
    [previewByType]
  );

  const isLocalPreviewHost =
    import.meta.env.DEV ||
    (typeof window !== "undefined" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname));
  const showDemoPreview =
    isLocalPreviewHost && !previewLoading && (!!previewError || !hasLivePreviewItems);
  const activePreviewByType = showDemoPreview ? demoPreviewByType : previewByType;

  const previewRotationEnabled = useMemo(
    () => previewSections.some((section) => activePreviewByType[section.type].length > 2),
    [activePreviewByType]
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
        rain: getRotatingPair(activePreviewByType.rain, rotationStep),
        water_level: getRotatingPair(activePreviewByType.water_level, rotationStep),
        temperature: getRotatingPair(activePreviewByType.temperature, rotationStep),
      }) satisfies PreviewByType,
    [activePreviewByType, rotationStep]
  );

  const visiblePreviewItems = useMemo(
    () => previewSections.flatMap((section) => visiblePreviewByType[section.type]),
    [visiblePreviewByType]
  );

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
                items={visiblePreviewItems}
                hoveredPreviewId={hoveredPreviewId}
                isClient={isClient}
                loading={previewLoading}
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
                      Live
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-500">Updated recently</p>
                </div>
              </div>

              <div className="mt-4 flex-1">
                {previewLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div
                        key={index}
                        className="rounded-xl border border-slate-200/75 bg-white/88 px-3 py-3"
                      >
                        <div className="h-2.5 w-20 rounded-full bg-sky-100" />
                        <div className="mt-2 space-y-2">
                          <div className="h-3 w-full rounded-full bg-slate-100" />
                          <div className="h-3 w-4/5 rounded-full bg-slate-100" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : previewError && !showDemoPreview ? (
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
      </section>
    </main>
  );
}
