// @ts-nocheck
// app/routes/sensors.tsx

import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  CloudRain,
  Droplets,
  Waves,
  ThermometerSun,
  MapPin,
  AlertCircle,
} from "lucide-react";
import type { Route } from "./+types/sensors";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Polyline,
  Circle,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { API_BASE } from "../lib/api";
import {
  fetchForecastSummaries,
  formatPercent,
  formatPrecipAmount,
  formatShortDate,
  formatTemperature,
  formatWind,
  getWeatherCodeMeta,
  OPEN_METEO_ATTRIBUTION_LABEL,
  OPEN_METEO_ATTRIBUTION_URL,
} from "../lib/weather";


export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stations · Water Status" },
    {
      name: "description",
      content:
        "See precipitation, river level and temperature station updates around Klang Valley.",
    },
  ];
}

type Sensor = {
  id: string;
  name: string;
  type: "rain" | "water_level" | "temperature";
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
  timestamp: string;
  source?: string;
};

type FilterKey = "all" | "rain" | "water_level" | "temperature";

const STATIONS_REQUEST_TIMEOUT_MS = 4500;

const fallbackSensors: Sensor[] = [
  {
    id: "demo-rain-1",
    name: "KLCC Precip Gauge",
    type: "rain",
    location: "Kuala Lumpur City Centre",
    unit: "mm/h",
    latitude: 3.1563,
    longitude: 101.7117,
    is_active: true,
  },
  {
    id: "demo-rain-2",
    name: "Batu Caves Precip Gauge",
    type: "rain",
    location: "Batu Caves",
    unit: "mm/h",
    latitude: 3.2379,
    longitude: 101.6843,
    is_active: true,
  },
  {
    id: "demo-rain-3",
    name: "Putrajaya Precip Gauge",
    type: "rain",
    location: "Presint 9, Putrajaya",
    unit: "mm/h",
    latitude: 2.9264,
    longitude: 101.6964,
    is_active: true,
  },
  {
    id: "demo-water-1",
    name: "Sungai Klang Watch",
    type: "water_level",
    location: "Masjid Jamek",
    unit: "m",
    latitude: 3.149,
    longitude: 101.695,
    is_active: true,
  },
  {
    id: "demo-water-2",
    name: "Sungai Gombak Watch",
    type: "water_level",
    location: "Jalan Tun Razak",
    unit: "m",
    latitude: 3.166,
    longitude: 101.72,
    is_active: true,
  },
  {
    id: "demo-water-3",
    name: "Ampang Spillway",
    type: "water_level",
    location: "Ampang",
    unit: "m",
    latitude: 3.1498,
    longitude: 101.7611,
    is_active: true,
  },
  {
    id: "demo-temp-1",
    name: "Subang Weather Mast",
    type: "temperature",
    location: "Subang Jaya",
    unit: "C",
    latitude: 3.081,
    longitude: 101.585,
    is_active: true,
  },
  {
    id: "demo-temp-2",
    name: "Cyberjaya Weather Mast",
    type: "temperature",
    location: "Cyberjaya",
    unit: "C",
    latitude: 2.9225,
    longitude: 101.6501,
    is_active: true,
  },
  {
    id: "demo-temp-3",
    name: "Genting Weather Mast",
    type: "temperature",
    location: "Genting Highlands",
    unit: "C",
    latitude: 3.4238,
    longitude: 101.7932,
    is_active: true,
  },
];

function fallbackTimestamp(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function buildFallbackLatestReadings(): Record<string, LatestReading> {
  const rows: LatestReading[] = [
    {
      sensor_id: "demo-rain-1",
      value: 1.2,
      unit: "mm/h",
      timestamp: fallbackTimestamp(6),
      source: "fallback",
    },
    {
      sensor_id: "demo-rain-2",
      value: 4.8,
      unit: "mm/h",
      timestamp: fallbackTimestamp(9),
      source: "fallback",
    },
    {
      sensor_id: "demo-rain-3",
      value: 0,
      unit: "mm/h",
      timestamp: fallbackTimestamp(12),
      source: "fallback",
    },
    {
      sensor_id: "demo-water-1",
      value: 2.4,
      unit: "m",
      timestamp: fallbackTimestamp(5),
      source: "fallback",
    },
    {
      sensor_id: "demo-water-2",
      value: 1.8,
      unit: "m",
      timestamp: fallbackTimestamp(8),
      source: "fallback",
    },
    {
      sensor_id: "demo-water-3",
      value: 1.3,
      unit: "m",
      timestamp: fallbackTimestamp(11),
      source: "fallback",
    },
    {
      sensor_id: "demo-temp-1",
      value: 31.6,
      unit: "C",
      timestamp: fallbackTimestamp(4),
      source: "fallback",
    },
    {
      sensor_id: "demo-temp-2",
      value: 30.9,
      unit: "C",
      timestamp: fallbackTimestamp(7),
      source: "fallback",
    },
    {
      sensor_id: "demo-temp-3",
      value: 23.4,
      unit: "C",
      timestamp: fallbackTimestamp(14),
      source: "fallback",
    },
  ];

  return rows.reduce((acc: Record<string, LatestReading>, row) => {
    acc[row.sensor_id] = row;
    return acc;
  }, {});
}

function markerColorForType(type: Sensor["type"]): string {
  if (type === "rain") return "#0ea5e9";         // sky blue
  if (type === "water_level") return "#22c55e";  // green
  return "#f97373";                              // soft red
}

function rainIntensityLevel(value: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(value) || value <= 0.1) return 0;
  if (value < 2) return 1;
  if (value < 7.5) return 2;
  if (value < 15) return 3;
  if (value < 30) return 4;
  return 5;
}

function rainLayerStyle(value: number): {
  coreRadius: number;
  midRadius: number;
  outerRadius: number;
  coreOpacity: number;
  midOpacity: number;
  outerOpacity: number;
  color: string;
} | null {
  const level = rainIntensityLevel(value);
  if (level === 0) return null;

  if (level === 1) {
    return {
      coreRadius: 850,
      midRadius: 1450,
      outerRadius: 2300,
      coreOpacity: 0.22,
      midOpacity: 0.13,
      outerOpacity: 0.07,
      color: "#60a5fa",
    };
  }
  if (level === 2) {
    return {
      coreRadius: 1100,
      midRadius: 1900,
      outerRadius: 3000,
      coreOpacity: 0.3,
      midOpacity: 0.19,
      outerOpacity: 0.1,
      color: "#3b82f6",
    };
  }
  if (level === 3) {
    return {
      coreRadius: 1400,
      midRadius: 2400,
      outerRadius: 3600,
      coreOpacity: 0.38,
      midOpacity: 0.24,
      outerOpacity: 0.13,
      color: "#2563eb",
    };
  }
  if (level === 4) {
    return {
      coreRadius: 1700,
      midRadius: 2800,
      outerRadius: 4200,
      coreOpacity: 0.46,
      midOpacity: 0.29,
      outerOpacity: 0.16,
      color: "#1d4ed8",
    };
  }

  return {
    coreRadius: 2000,
    midRadius: 3300,
    outerRadius: 5000,
    coreOpacity: 0.54,
    midOpacity: 0.34,
    outerOpacity: 0.2,
    color: "#1e3a8a",
  };
}

export default function SensorsPage() {
  const isClient = typeof window !== "undefined";
  const [searchParams, setSearchParams] = useSearchParams();
  const hasLoadedDataRef = useRef(false);
  const hasSuccessfulLiveDataRef = useRef(false);

  // Read ?type= from URL on first render
  const initialTypeFromUrl = (() => {
    const t = searchParams.get("type");
    if (t === "rain" || t === "water_level" || t === "temperature") {
      return t as FilterKey;
    }
    return "all";
  })();

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [latestReadingsBySensor, setLatestReadingsBySensor] = useState<
    Record<string, LatestReading>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFallbackData, setIsFallbackData] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>(initialTypeFromUrl);
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [showRainLayer, setShowRainLayer] = useState(true);
  const [selectedSensorId, setSelectedSensorId] = useState<string>("");
  const [selectedForecast, setSelectedForecast] = useState<any | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      const isInitialLoad = !hasLoadedDataRef.current;
      const sensorsController = new AbortController();
      const sensorsTimeout = window.setTimeout(
        () => sensorsController.abort(),
        STATIONS_REQUEST_TIMEOUT_MS
      );

      try {
        if (isInitialLoad) {
          setLoading(true);
        }
        setError(null);

        const sensorsRes = await fetch(`${API_BASE}/sensors`, {
          signal: sensorsController.signal,
        });
        if (!sensorsRes.ok) throw new Error(`HTTP ${sensorsRes.status}`);

        const sensorsData = await sensorsRes.json();
        const sensorsList = sensorsData.sensors ?? sensorsData;
        const nextSensors = Array.isArray(sensorsList) ? sensorsList : [];
        if (nextSensors.length === 0) {
          throw new Error("No stations returned");
        }

        // Load latest values second so station list can render immediately.
        let latestBySensor: Record<string, LatestReading> = {};
        const latestController = new AbortController();
        const latestTimeout = window.setTimeout(
          () => latestController.abort(),
          STATIONS_REQUEST_TIMEOUT_MS
        );

        try {
          const latestRes = await fetch(`${API_BASE}/sensor-readings/latest-by-sensor`, {
            signal: latestController.signal,
          });
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
        } catch (latestError) {
          console.error(latestError);
        } finally {
          window.clearTimeout(latestTimeout);
        }

        if (!isMounted) return;
        setSensors(nextSensors);
        setLatestReadingsBySensor(latestBySensor);
        setIsFallbackData(false);
        setError(null);
        hasSuccessfulLiveDataRef.current = true;
      } catch (err) {
        console.error(err);
        if (!isMounted) return;

        if (hasSuccessfulLiveDataRef.current) {
          setError(
            "Live refresh delayed. Showing the most recent station data already loaded."
          );
          return;
        }

        setSensors(fallbackSensors);
        setLatestReadingsBySensor(buildFallbackLatestReadings());
        setIsFallbackData(true);
        setError(null);
      } finally {
        window.clearTimeout(sensorsTimeout);
        if (!isMounted) return;
        hasLoadedDataRef.current = true;
        setLoading(false);
      }
    }

    loadData();

    const refresh = window.setInterval(loadData, 60_000);
    return () => {
      isMounted = false;
      window.clearInterval(refresh);
    };
  }, []);

  const counts = useMemo(() => {
    const base = { rain: 0, water_level: 0, temperature: 0 };
    for (const s of sensors) {
      if (s.type === "rain") base.rain += 1;
      else if (s.type === "water_level") base.water_level += 1;
      else if (s.type === "temperature") base.temperature += 1;
    }
    return base;
  }, [sensors]);

  // Unique sensor locations for dropdown (KLCC, Batu Caves, …)
  const uniqueLocations = useMemo(
    () => Array.from(new Set(sensors.map((s) => s.location))).sort(),
    [sensors]
  );

  // Apply BOTH: type filter + location filter
  const filtered = useMemo(() => {
    let base = sensors;

    if (activeFilter !== "all") {
      base = base.filter((s) => s.type === activeFilter);
    }

    if (locationFilter !== "all") {
      base = base.filter((s) => s.location === locationFilter);
    }

    return base;
  }, [sensors, activeFilter, locationFilter]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedSensorId("");
      return;
    }

    const stillVisible = filtered.some((sensor) => sensor.id === selectedSensorId);
    if (stillVisible) return;

    const preferred = filtered.find((sensor) => hasCoordinates(sensor)) ?? filtered[0];
    setSelectedSensorId(preferred?.id ?? "");
  }, [filtered, selectedSensorId]);

  const selectedSensor = useMemo(
    () =>
      filtered.find((sensor) => sensor.id === selectedSensorId) ??
      sensors.find((sensor) => sensor.id === selectedSensorId) ??
      null,
    [filtered, sensors, selectedSensorId]
  );

  useEffect(() => {
    let isMounted = true;

    if (!selectedSensorId || isFallbackData) {
      setSelectedForecast(null);
      setForecastLoading(false);
      return;
    }

    async function loadForecast() {
      try {
        setForecastLoading(true);
        setSelectedForecast(null);
        const summaries = await fetchForecastSummaries([selectedSensorId]);
        if (!isMounted) return;
        setSelectedForecast(summaries[0] ?? null);
      } catch (err) {
        console.error(err);
        if (!isMounted) return;
        setSelectedForecast(null);
      } finally {
        if (isMounted) setForecastLoading(false);
      }
    }

    loadForecast();

    return () => {
      isMounted = false;
    };
  }, [selectedSensorId, isFallbackData]);

  const hasCoordinates = (sensor: Sensor): boolean =>
    typeof sensor.latitude === "number" &&
    Number.isFinite(sensor.latitude) &&
    typeof sensor.longitude === "number" &&
    Number.isFinite(sensor.longitude);

    // Markers we actually draw on the map (may be offset from real position)
  type DisplayMarker = {
    sensor: Sensor;
    lat: number;
    lng: number;
    isOffset: boolean;
    originalLat: number;
    originalLng: number;
  };

  // Compute offset markers for overlapping stations
  const displayMarkers: DisplayMarker[] = useMemo(() => {
    const groups = new Map<string, Sensor[]>();

    // Group sensors by rounded coordinate (to catch "almost same" positions)
    filtered.filter(hasCoordinates).forEach((s) => {
      const key = `${s.latitude.toFixed(4)},${s.longitude.toFixed(4)}`;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    });

    const markers: DisplayMarker[] = [];
    const OFFSET_DEG = 0.003; // ~300m lat; tiny nudge on map

    for (const [, group] of groups.entries()) {
      if (group.length === 1) {
        const s = group[0];
        markers.push({
          sensor: s,
          lat: s.latitude,
          lng: s.longitude,
          isOffset: false,
          originalLat: s.latitude,
          originalLng: s.longitude,
        });
      } else {
        // Fan them out in a small circle around the true point
        const angleStep = (2 * Math.PI) / group.length;
        group.forEach((s, idx) => {
          const angle = idx * angleStep;
          const latOffset = OFFSET_DEG * Math.cos(angle);
          const lngOffset = OFFSET_DEG * Math.sin(angle);

          markers.push({
            sensor: s,
            lat: s.latitude + latOffset,
            lng: s.longitude + lngOffset,
            isOffset: true,
            originalLat: s.latitude,
            originalLng: s.longitude,
          });
        });
      }
    }

    return markers;
  }, [filtered]);

  const mapCenter = useMemo<[number, number]>(
    () =>
      displayMarkers.length > 0
        ? [displayMarkers[0].lat, displayMarkers[0].lng]
        : [3.14, 101.69],
    [displayMarkers]
  );

  const rainLayerCells = useMemo(() => {
    if (activeFilter !== "rain") return [];

    const bySpot = new Map<
      string,
      { key: string; lat: number; lng: number; value: number; stationName: string }
    >();

    filtered.forEach((sensor) => {
      if (sensor.type !== "rain" || !hasCoordinates(sensor)) return;

      const latest = latestReadingsBySensor[sensor.id];
      const rainValue = Number(latest?.value ?? 0);
      if (!Number.isFinite(rainValue) || rainValue <= 0.1) return;

      const key = `${sensor.latitude!.toFixed(3)},${sensor.longitude!.toFixed(3)}`;
      const existing = bySpot.get(key);
      if (!existing || rainValue > existing.value) {
        bySpot.set(key, {
          key,
          lat: sensor.latitude!,
          lng: sensor.longitude!,
          value: rainValue,
          stationName: sensor.name,
        });
      }
    });

    return Array.from(bySpot.values()).sort((a, b) => a.value - b.value);
  }, [activeFilter, filtered, latestReadingsBySensor]);

  const filterChips: { key: FilterKey; label: string; count?: number }[] = [
    { key: "all", label: "All stations", count: sensors.length },
    { key: "rain", label: "Precip", count: counts.rain },
    { key: "water_level", label: "River level", count: counts.water_level },
    { key: "temperature", label: "Temperature", count: counts.temperature },
  ];

  const typeLabel = (t: Sensor["type"]) =>
    t === "rain" ? "Precip" : t === "water_level" ? "River level" : "Temperature";

  const TypeIcon = ({ type }: { type: Sensor["type"] }) => {
    if (type === "rain")
      return (
        <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-100">
          <CloudRain className="w-4 h-4 text-sky-600" />
        </div>
      );
    if (type === "water_level")
      return (
        <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100">
          <Waves className="w-4 h-4 text-emerald-600" />
        </div>
      );
    return (
      <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-100">
        <ThermometerSun className="w-4 h-4 text-rose-500" />
      </div>
    );
  };

  const getLatestValue = (sensor: Sensor): string => {
    const latest = latestReadingsBySensor[sensor.id];
    if (!latest || latest.value === null || latest.value === undefined) return "—";
    const unit = latest.unit || sensor.unit || "";
    return `${latest.value} ${unit}`.trim();
  };

  const getLastPing = (sensor: Sensor): string => {
    const latest = latestReadingsBySensor[sensor.id];
    if (latest?.source === "fallback") return "Fallback sample";
    if (!sensor.is_active) return "Offline";
    if (!latest?.timestamp) return "Waiting first reading";

    const ts = new Date(latest.timestamp);
    if (Number.isNaN(ts.getTime())) return "—";

    const diffMs = Date.now() - ts.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin <= 0) return "Just now";
    if (diffMin < 60) return `${diffMin} min ago`;

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
    return ts.toLocaleString();
  };

  const getStatusMeta = (sensor: Sensor) => {
    const isFallbackRow =
      isFallbackData && latestReadingsBySensor[sensor.id]?.source === "fallback";

    if (isFallbackRow) {
      return {
        label: "Fallback",
        className: "bg-sky-50 text-sky-700 border-sky-200",
        dotClassName: "bg-sky-500",
      };
    }

    if (sensor.is_active) {
      return {
        label: "Active",
        className: "bg-emerald-50 text-emerald-700 border-emerald-200",
        dotClassName: "bg-emerald-500",
      };
    }

    return {
      label: "Offline",
      className: "bg-slate-100 text-slate-500 border-slate-200",
      dotClassName: "bg-slate-400",
    };
  };

  // Helper for showing filter text
  const filterLabel = () => {
    const typeText =
      activeFilter === "all" ? "all types" : typeLabel(activeFilter);
    const locText =
      locationFilter === "all" ? "all locations" : locationFilter;
    return `${typeText} · ${locText}`;
  };

  const isRainMode = activeFilter === "rain";
  const hasSensors = sensors.length > 0;

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-6 space-y-5 sm:py-10 sm:space-y-6">
        {/* Hero / intro */}
        <div className="ws-card ws-hero-glow flex flex-col gap-4 p-5 sm:p-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Stations · Klang Valley
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight mt-1">
                Live-style view of{" "}
                <span className="text-sky-600">precip</span>,{" "}
                <span className="text-emerald-600">river</span> &{" "}
                <span className="text-rose-500">heat</span>.
              </h1>
              <p className="mt-2 text-sm text-slate-600 max-w-xl leading-relaxed">
                Each dot here is a{" "}
                <span className="font-medium">future sensor location</span>.
                Data streams from live public feeds when available, with fallback
                simulation to keep the dashboard active.
              </p>
            </div>

            <div className="ws-card-panel w-full rounded-xl px-4 py-3 text-xs text-slate-600 sm:w-auto sm:min-w-[12rem]">
              <p className="font-semibold mb-1">Station summary</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                    Precip
                  </span>
                  <span className="font-medium">{counts.rain}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    River level
                  </span>
                  <span className="font-medium">{counts.water_level}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                    Temperature
                  </span>
                  <span className="font-medium">{counts.temperature}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2 pt-2">
            {filterChips.map((chip) => {
              const isActive = chip.key === activeFilter;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => {
                    setActiveFilter(chip.key);

                    if (chip.key === "all") {
                      // remove ?type= from URL
                      searchParams.delete("type");
                      setSearchParams(searchParams);
                    } else {
                      // set ?type=rain | water_level | temperature
                      searchParams.set("type", chip.key);
                      setSearchParams(searchParams);
                    }
                  }}
                  className={[
                    "inline-flex items-center gap-2 rounded-full border text-xs px-3 py-1.5 transition",
                    isActive
                      ? "bg-sky-500 text-white border-sky-500 shadow-sm"
                      : "ws-card-pill text-slate-700",
                  ].join(" ")}
                >
                  <span>{chip.label}</span>
                  {typeof chip.count === "number" && (
                    <span className="inline-flex h-4 min-w-[1.3rem] items-center justify-center rounded-full bg-white/80 text-[10px] text-slate-700">
                      {chip.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Error / loading states */}
        {loading && (
          <div className="ws-card p-4 text-sm text-slate-600 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
            <span>Loading stations…</span>
          </div>
        )}

        {isFallbackData && !loading && (
          <div className="ws-card flex items-start gap-2 border border-sky-200 bg-sky-50/85 p-4 text-sm text-sky-700">
            <AlertCircle className="w-4 h-4" />
            <span>
              Showing built-in station samples while the live server reconnects.
              Filters, map interactions and station selection still work.
            </span>
          </div>
        )}

        {error && !loading && (
          <div className="ws-card flex items-start gap-2 border border-amber-200 bg-amber-50/85 p-4 text-sm text-amber-700">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Map + table of stations */}
        {!loading && hasSensors && (
          <>
{/* Map card */}
<div className="ws-card overflow-hidden mb-4">
  <div className="px-4 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2">
    <div className="text-xs sm:text-sm text-slate-600">
      <p className="font-semibold">
        Map view ({displayMarkers.length} station{displayMarkers.length === 1 ? "" : "s"})
      </p>
      <p className="text-[11px] text-slate-500">
        Markers follow your filters: type + location. Overlapping stations are fanned out with a tiny line back to their real spot.
      </p>
    </div>
    {isRainMode && (
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setShowRainLayer((v) => !v)}
          className={[
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition",
            showRainLayer
              ? "bg-sky-100 text-sky-700 border-sky-300"
              : "ws-card-pill text-slate-600",
          ].join(" ")}
        >
          <Droplets className="h-3.5 w-3.5" />
          {showRainLayer ? "Precip layer on" : "Precip layer off"}
        </button>
        <span className="text-slate-500">Darker blue = heavier precip</span>
      </div>
    )}
  </div>

  <div className="h-72 sm:h-80">
    {isClient && (
      <MapContainer
        center={mapCenter}
        zoom={11}
        scrollWheelZoom={false}
        className="h-full w-full rounded-b-2xl"
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors, OSM Humanitarian'
          url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
        />

        {isRainMode &&
          showRainLayer &&
          rainLayerCells.map((cell) => {
            const style = rainLayerStyle(cell.value);
            if (!style) return null;
            return (
              <React.Fragment key={`rain-layer-${cell.key}`}>
                <Circle
                  center={[cell.lat, cell.lng]}
                  radius={style.outerRadius}
                  pathOptions={{
                    stroke: false,
                    fillColor: style.color,
                    fillOpacity: style.outerOpacity,
                  }}
                />
                <Circle
                  center={[cell.lat, cell.lng]}
                  radius={style.midRadius}
                  pathOptions={{
                    stroke: false,
                    fillColor: style.color,
                    fillOpacity: style.midOpacity,
                  }}
                />
                <Circle
                  center={[cell.lat, cell.lng]}
                  radius={style.coreRadius}
                  pathOptions={{
                    stroke: false,
                    fillColor: style.color,
                    fillOpacity: style.coreOpacity,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -2]} opacity={1}>
                    <div className="text-[11px]">
                      <div className="font-semibold">{cell.stationName}</div>
                      <div className="text-slate-600">Precip: {cell.value} mm/h</div>
                    </div>
                  </Tooltip>
                </Circle>
              </React.Fragment>
            );
          })}

        {displayMarkers.map((marker) => (
          <React.Fragment key={marker.sensor.id}>
            {/* If offset, draw a tiny dashed line back to the true location */}
            {marker.isOffset && (
              <Polyline
                positions={[
                  [marker.originalLat, marker.originalLng],
                  [marker.lat, marker.lng],
                ]}
                pathOptions={{
                  color: "#94a3b8", // subtle grey
                  weight: 1,
                  opacity: 0.8,
                  dashArray: "2,4",
                }}
              />
            )}

            {selectedSensorId === marker.sensor.id ? (
              <CircleMarker
                center={[marker.lat, marker.lng]}
                radius={14}
                interactive={false}
                pathOptions={{
                  stroke: false,
                  fillColor: markerColorForType(marker.sensor.type),
                  fillOpacity: 0.14,
                }}
              />
            ) : null}

            <CircleMarker
              center={[marker.lat, marker.lng]}
              radius={selectedSensorId === marker.sensor.id ? 9 : 7}
              eventHandlers={{
                click: () => setSelectedSensorId(marker.sensor.id),
              }}
              pathOptions={{
                color: markerColorForType(marker.sensor.type),
                fillColor: markerColorForType(marker.sensor.type),
                fillOpacity: 0.9,
                weight: selectedSensorId === marker.sensor.id ? 4 : 2,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                <div className="text-[11px]">
                  <div className="font-semibold">{marker.sensor.name}</div>
                  <div className="text-slate-600">{marker.sensor.location}</div>
                  <div className="text-slate-500">
                    {marker.sensor.type === "rain"
                      ? "Precip station"
                      : marker.sensor.type === "water_level"
                      ? "River level"
                      : "Temperature"}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          </React.Fragment>
        ))}
      </MapContainer>
    )}
  </div>
</div>

<div className="ws-card overflow-hidden p-4 sm:p-5">
  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Selected station forecast
      </p>
      {selectedSensor ? (
        <div className="mt-2 flex items-start gap-3">
          <TypeIcon type={selectedSensor.type} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-slate-800">
              {selectedSensor.name}
            </p>
            <p className="truncate text-sm text-slate-500">
              {selectedSensor.location} · {typeLabel(selectedSensor.type)}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">
          Choose a station to load its short-range forecast context.
        </p>
      )}
    </div>

    {!isFallbackData ? (
      <a
        href={OPEN_METEO_ATTRIBUTION_URL}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
      >
        {OPEN_METEO_ATTRIBUTION_LABEL}
      </a>
    ) : null}
  </div>

  {!selectedSensor ? null : isFallbackData ? (
    <div className="mt-4 rounded-2xl border border-sky-200/90 bg-sky-50/80 px-4 py-4 text-sm text-sky-700">
      Forecast context is paused in fallback mode. Live forecast details will
      return automatically when the station server reconnects.
    </div>
  ) : forecastLoading && !selectedForecast ? (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="ws-skeleton h-32 rounded-2xl" />
      <div className="ws-skeleton h-32 rounded-2xl" />
    </div>
  ) : selectedForecast?.status === "ok" ? (
    <>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="ws-card-panel rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Current conditions
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {getWeatherCodeMeta(
                  selectedForecast.current?.weather_code,
                  selectedForecast.current?.is_day
                ).label}
              </p>
            </div>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              {(() => {
                const Icon = getWeatherCodeMeta(
                  selectedForecast.current?.weather_code,
                  selectedForecast.current?.is_day
                ).Icon;
                return <Icon className="h-5 w-5" />;
              })()}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="ws-card-panel-soft rounded-xl px-3 py-3">
              <p className="text-[11px] text-slate-500">Temperature</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {formatTemperature(selectedForecast.current?.temperature_2m)}
              </p>
            </div>
            <div className="ws-card-panel-soft rounded-xl px-3 py-3">
              <p className="text-[11px] text-slate-500">Feels like</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatTemperature(selectedForecast.current?.apparent_temperature)}
              </p>
            </div>
            <div className="ws-card-panel-soft rounded-xl px-3 py-3">
              <p className="text-[11px] text-slate-500">Humidity</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatPercent(selectedForecast.current?.relative_humidity_2m)}
              </p>
            </div>
            <div className="ws-card-panel-soft rounded-xl px-3 py-3">
              <p className="text-[11px] text-slate-500">Wind</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatWind(selectedForecast.current?.wind_speed_10m)}
              </p>
            </div>
          </div>
        </div>

        <div className="ws-card-panel rounded-2xl p-4">
          <p className="text-sm font-semibold text-slate-800">Next 12 hours</p>
          <div className="mt-4 space-y-3 text-sm">
            <div className="ws-card-panel-soft flex items-center justify-between gap-3 rounded-xl px-3 py-3">
              <span className="text-slate-500">Max precip chance</span>
              <span className="font-semibold text-slate-900">
                {formatPercent(selectedForecast.next_12h?.max_precipitation_probability)}
              </span>
            </div>
            <div className="ws-card-panel-soft flex items-center justify-between gap-3 rounded-xl px-3 py-3">
              <span className="text-slate-500">Precip sum</span>
              <span className="font-semibold text-slate-900">
                {formatPrecipAmount(selectedForecast.next_12h?.rain_sum)}
              </span>
            </div>
            <div className="ws-card-panel-soft flex items-center justify-between gap-3 rounded-xl px-3 py-3">
              <span className="text-slate-500">Max wind</span>
              <span className="font-semibold text-slate-900">
                {formatWind(selectedForecast.next_12h?.max_wind_speed_10m)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-800">3-day outlook</p>
          <p className="text-[11px] text-slate-500">
            Updated {formatShortDate(selectedForecast.generated_at)}
          </p>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {(selectedForecast.daily ?? []).slice(0, 3).map((day: any) => {
            const meta = getWeatherCodeMeta(day?.weather_code, true);
            const DayIcon = meta.Icon;

            return (
              <div
                key={`${selectedSensor.id}-${day?.date ?? "day"}`}
                className="ws-card-panel rounded-2xl p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {formatShortDate(day?.date)}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">{meta.label}</p>
                  </div>
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                    <DayIcon className="h-4 w-4" />
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">High / low</span>
                    <span className="font-semibold text-slate-900">
                      {formatTemperature(day?.temperature_2m_max)} /{" "}
                      {formatTemperature(day?.temperature_2m_min)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Precip chance</span>
                    <span className="font-semibold text-slate-900">
                      {formatPercent(day?.precipitation_probability_max)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Precip sum</span>
                    <span className="font-semibold text-slate-900">
                      {formatPrecipAmount(day?.rain_sum)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  ) : (
    <div className="ws-card-panel-soft mt-4 rounded-2xl px-4 py-4 text-sm text-slate-500">
      Forecast context is unavailable for this station right now. The live sensor
      list still reflects your primary data sources.
    </div>
  )}
</div>

{/* Table card */}
<div className="ws-card overflow-hidden">
  {/* Header: summary + location dropdown */}
  <div className="flex flex-col gap-3 px-4 pb-2 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
    <p className="text-xs sm:text-sm text-slate-600">
      Showing{" "}
      <span className="font-semibold">{filtered.length}</span> of{" "}
      <span className="font-semibold">{sensors.length}</span> stations
      (filter: <span className="lowercase">{filterLabel()}</span>).
    </p>

    <div className="flex w-full items-center gap-2 text-xs sm:w-auto sm:text-sm">
      <span className="text-slate-500">Location:</span>
      <select
        value={locationFilter}
        onChange={(e) => setLocationFilter(e.target.value)}
        className="ws-card-control min-w-0 flex-1 rounded-full px-3 py-1 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 sm:flex-none sm:text-sm"
      >
        <option value="all">All locations</option>
        {uniqueLocations.map((loc) => (
          <option key={loc} value={loc}>
            {loc}
          </option>
        ))}
      </select>
    </div>
  </div>

  <div className="space-y-3 px-4 pb-4 pt-2 sm:hidden">
    {filtered.length > 0 ? (
      filtered.map((sensor) => {
        const status = getStatusMeta(sensor);

        return (
          <button
            key={`${sensor.id}-mobile-card`}
            type="button"
            onClick={() => setSelectedSensorId(sensor.id)}
            className={[
              "w-full rounded-[1.2rem] border px-4 py-4 text-left transition",
              selectedSensorId === sensor.id
                ? "border-sky-300 bg-sky-50/82 shadow-[0_12px_28px_rgba(14,165,233,0.12)]"
                : "ws-card-panel hover:bg-sky-50/40",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <TypeIcon type={sensor.type} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {sensor.name}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {typeLabel(sensor.type)}
                  </p>
                </div>
              </div>
              <span className="text-right text-sm font-semibold text-slate-900">
                {getLatestValue(sensor)}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-600">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              <span className="truncate">{sensor.location}</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="ws-card-panel-soft rounded-xl px-3 py-2">
                <p className="text-slate-500">Last ping</p>
                <p className="mt-1 font-medium text-slate-700">{getLastPing(sensor)}</p>
              </div>
              <div className="ws-card-panel-soft rounded-xl px-3 py-2">
                <p className="text-slate-500">Status</p>
                <span
                  className={[
                    "mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                    status.className,
                  ].join(" ")}
                >
                  <span className={["h-1.5 w-1.5 rounded-full", status.dotClassName].join(" ")} />
                  {status.label}
                </span>
              </div>
            </div>
          </button>
        );
      })
    ) : (
      <div className="ws-card-panel rounded-xl px-4 py-4 text-center text-xs text-slate-500">
        No stations in this category / location combination yet.
      </div>
    )}
  </div>

  {/* Actual table */}
  <div className="hidden overflow-x-auto sm:block">
    <table className="min-w-full text-xs sm:text-sm border-t border-[var(--ws-border-subtle)]">
      <thead className="ws-card-table-head">
        <tr className="border-b border-[var(--ws-border-subtle)] text-slate-500">
          <th className="text-left px-4 py-2 font-medium">Station</th>
          <th className="text-left px-4 py-2 font-medium">Type</th>
          <th className="text-left px-4 py-2 font-medium">Location</th>
          <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">
            Lat / Lon
          </th>
          <th className="text-left px-4 py-2 font-medium">Latest value</th>
          <th className="text-left px-4 py-2 font-medium">Last ping</th>
          <th className="text-left px-4 py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((sensor, i) => {
          const isEven = i % 2 === 0;
          const rowBg = isEven ? "bg-white" : "bg-[#fffdf0]";
          const status = getStatusMeta(sensor);

          return (
            <tr
              key={sensor.id}
              className={[
                rowBg,
                selectedSensorId === sensor.id
                  ? "bg-sky-100/80"
                  : rowBg,
                "cursor-pointer border-b border-[var(--ws-border-subtle)] hover:bg-sky-50/60 transition-colors",
              ].join(" ")}
              onClick={() => setSelectedSensorId(sensor.id)}
            >
              {/* Station name + icon */}
              <td className="px-4 py-2 align-middle">
                <div className="flex items-center gap-2">
                  <TypeIcon type={sensor.type} />
                  <div>
                    <div className="font-medium text-slate-800 text-xs sm:text-sm">
                      {sensor.name}
                    </div>
                    <div className="text-[10px] text-slate-500 sm:hidden">
                      {sensor.location}
                    </div>
                  </div>
                </div>
              </td>

              {/* Type */}
              <td className="px-4 py-2 align-middle text-[11px] text-slate-600">
                {typeLabel(sensor.type)}
              </td>

              {/* Location */}
              <td className="px-4 py-2 align-middle text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  {sensor.location}
                </span>
              </td>

              {/* Lat / Lon (hide on very small screens) */}
              <td className="px-4 py-2 align-middle text-[11px] text-slate-500 hidden sm:table-cell">
                {hasCoordinates(sensor)
                  ? `${sensor.latitude!.toFixed(3)}, ${sensor.longitude!.toFixed(3)}`
                  : "—"}
              </td>

              {/* Latest value */}
              <td className="px-4 py-2 align-middle text-[11px] text-slate-600">
                {getLatestValue(sensor)}
              </td>

              {/* Last ping */}
              <td className="px-4 py-2 align-middle text-[11px] text-slate-500">
                {getLastPing(sensor)}
              </td>

              {/* Status */}
              <td className="px-4 py-2 align-middle text-[11px]">
                <span
                  className={[
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                    status.className,
                  ].join(" ")}
                >
                  <span
                    className={["h-1.5 w-1.5 rounded-full", status.dotClassName].join(" ")}
                  />
                  {status.label}
                </span>
              </td>
            </tr>
          );
        })}

        {!filtered.length && (
          <tr>
            <td
              colSpan={7}
              className="px-4 py-4 text-center text-xs text-slate-500"
            >
              No stations in this category / location combination yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
</div>
          </>
        )}
      </section>
    </main>
  );
}
