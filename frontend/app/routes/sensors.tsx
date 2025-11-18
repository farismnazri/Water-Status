// @ts-nocheck
// app/routes/sensors.tsx

import React from "react";
import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  CloudRain,
  Waves,
  ThermometerSun,
  MapPin,
  AlertCircle,
} from "lucide-react";
import type { Route } from "./+types/sensors";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline } from "react-leaflet";


export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stations · Water Status" },
    {
      name: "description",
      content:
        "See simulated rain, river level and temperature stations around Klang Valley.",
    },
  ];
}

type Sensor = {
  id: string;
  name: string;
  type: "rain" | "water_level" | "temperature";
  location: string;
  unit: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
};

type FilterKey = "all" | "rain" | "water_level" | "temperature";

const API_BASE = "http://127.0.0.1:8000";

function markerColorForType(type: Sensor["type"]): string {
  if (type === "rain") return "#0ea5e9";         // sky blue
  if (type === "water_level") return "#22c55e";  // green
  return "#f97373";                              // soft red
}

export default function SensorsPage() {
  const isClient = typeof window !== "undefined";
  const [searchParams, setSearchParams] = useSearchParams();

  // Read ?type= from URL on first render
  const initialTypeFromUrl = (() => {
    const t = searchParams.get("type");
    if (t === "rain" || t === "water_level" || t === "temperature") {
      return t as FilterKey;
    }
    return "all";
  })();

  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>(initialTypeFromUrl);
  const [locationFilter, setLocationFilter] = useState<string>("all");

  useEffect(() => {
    async function loadSensors() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`${API_BASE}/sensors`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        setSensors(data.sensors ?? data);
      } catch (err) {
        console.error(err);
        setError("Could not load stations. Please try again in a moment.");
      } finally {
        setLoading(false);
      }
    }

    loadSensors();
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
    filtered.forEach((s) => {
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

  const filterChips: { key: FilterKey; label: string; count?: number }[] = [
    { key: "all", label: "All stations", count: sensors.length },
    { key: "rain", label: "Rain", count: counts.rain },
    { key: "water_level", label: "River level", count: counts.water_level },
    { key: "temperature", label: "Temperature", count: counts.temperature },
  ];

  const typeLabel = (t: Sensor["type"]) =>
    t === "rain" ? "Rain" : t === "water_level" ? "River level" : "Temperature";

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

  // 🔔 Temporary fake "last ping" generator
  // Later you can replace this with real latest-reading timestamps
  const getFakeLastPing = (sensor: Sensor, index: number): string => {
    if (!sensor.is_active) return "—";
    const minutesAgo = (index * 7) % 90; // 0–89 min
    if (minutesAgo === 0) return "Just now";
    if (minutesAgo < 60) return `${minutesAgo} min ago`;
    return "1+ hour ago";
  };

  // Helper for showing filter text
  const filterLabel = () => {
    const typeText =
      activeFilter === "all" ? "all types" : typeLabel(activeFilter);
    const locText =
      locationFilter === "all" ? "all locations" : locationFilter;
    return `${typeText} · ${locText}`;
  };

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {/* Hero / intro */}
        <div className="ws-card ws-hero-glow p-6 sm:p-7 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Stations · Klang Valley (simulated)
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight mt-1">
                Live-style view of{" "}
                <span className="text-sky-600">rain</span>,{" "}
                <span className="text-emerald-600">river</span> &{" "}
                <span className="text-rose-500">heat</span>.
              </h1>
              <p className="mt-2 text-sm text-slate-600 max-w-xl leading-relaxed">
                Each dot here is a{" "}
                <span className="font-medium">future sensor location</span>.
                For now, they stream{" "}
                <span className="text-sky-600 font-medium">
                  simulated readings
                </span>{" "}
                so we can test dashboards, filters and ideas before touching any
                real hardware.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-4 py-3 text-xs text-slate-600 shadow-sm min-w-[12rem]">
              <p className="font-semibold mb-1">Station summary</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                    Rain
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
                      : "bg-[var(--ws-bg-elevated)] text-slate-700 border-[var(--ws-border-subtle)] hover:bg-sky-50",
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

        {error && !loading && (
          <div className="ws-card p-4 text-sm text-rose-600 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Map + table of stations */}
        {!loading && !error && (
          <>
            {/* Map card */}
            <div className="ws-card overflow-hidden mb-4">
              <div className="px-4 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs sm:text-sm text-slate-600">
                  <p className="font-semibold">
                    Map view ({filtered.length} station{filtered.length === 1 ? "" : "s"})
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Markers follow your filters: type + location.
                  </p>
                </div>
              </div>

              <div className="h-72 sm:h-80">
                {isClient && (
                  <MapContainer
                    center={[3.14, 101.69]}
                    zoom={11}
                    scrollWheelZoom={false}
                    className="h-full w-full rounded-b-2xl"
                  >
                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors, OSM Humanitarian'
                    url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
                  />
                    {displayMarkers.map((marker) => (
                      <React.Fragment key={marker.sensor.id}>
                        {/* If offset, draw a tiny line back to the true location */}
                        {marker.isOffset && (
                          <Polyline
                            positions={[
                              [marker.originalLat, marker.originalLng],
                              [marker.lat, marker.lng],
                            ]}
                            pathOptions={{
                              color: "#94a3b8", // subtle grey-ish
                              weight: 1,
                              opacity: 0.8,
                              dashArray: "2,4",
                            }}
                          />
                        )}

                        <CircleMarker
                          center={[marker.lat, marker.lng]}
                          radius={7}
                          pathOptions={{
                            color: markerColorForType(marker.sensor.type),
                            fillColor: markerColorForType(marker.sensor.type),
                            fillOpacity: 0.9,
                            weight: 2,
                          }}
                        >
                          <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                            <div className="text-[11px]">
                              <div className="font-semibold">{marker.sensor.name}</div>
                              <div className="text-slate-600">{marker.sensor.location}</div>
                              <div className="text-slate-500">
                                {marker.sensor.type === "rain"
                                  ? "Rain station"
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

{/* Table card */}
<div className="ws-card overflow-hidden">
  {/* Header: summary + location dropdown */}
  <div className="px-4 pt-4 pb-2 flex flex-wrap gap-3 items-center justify-between">
    <p className="text-xs sm:text-sm text-slate-600">
      Showing{" "}
      <span className="font-semibold">{filtered.length}</span> of{" "}
      <span className="font-semibold">{sensors.length}</span> stations
      (filter: <span className="lowercase">{filterLabel()}</span>).
    </p>

    <div className="flex items-center gap-2 text-xs sm:text-sm">
      <span className="text-slate-500">Location:</span>
      <select
        value={locationFilter}
        onChange={(e) => setLocationFilter(e.target.value)}
        className="rounded-full border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-1 text-xs sm:text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
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

  {/* Actual table */}
  <div className="overflow-x-auto">
    <table className="min-w-full text-xs sm:text-sm border-t border-[var(--ws-border-subtle)]">
      <thead className="bg-[var(--ws-bg-elevated)]">
        <tr className="border-b border-[var(--ws-border-subtle)] text-slate-500">
          <th className="text-left px-4 py-2 font-medium">Station</th>
          <th className="text-left px-4 py-2 font-medium">Type</th>
          <th className="text-left px-4 py-2 font-medium">Location</th>
          <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">
            Lat / Lon
          </th>
          <th className="text-left px-4 py-2 font-medium">Unit</th>
          <th className="text-left px-4 py-2 font-medium">Last ping</th>
          <th className="text-left px-4 py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((sensor, i) => {
          const isEven = i % 2 === 0;
          const rowBg = isEven ? "bg-white" : "bg-[#fffdf0]";

          return (
            <tr
              key={sensor.id}
              className={[
                rowBg,
                "border-b border-[var(--ws-border-subtle)] hover:bg-sky-50/60 transition-colors",
              ].join(" ")}
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
                {sensor.latitude.toFixed(3)}, {sensor.longitude.toFixed(3)}
              </td>

              {/* Unit */}
              <td className="px-4 py-2 align-middle text-[11px] text-slate-600">
                {sensor.unit}
              </td>

              {/* Last ping (fake for now) */}
              <td className="px-4 py-2 align-middle text-[11px] text-slate-500">
                {getFakeLastPing(sensor, i)}
              </td>

              {/* Status */}
              <td className="px-4 py-2 align-middle text-[11px]">
                <span
                  className={[
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                    sensor.is_active
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-500 border-slate-200",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "h-1.5 w-1.5 rounded-full",
                      sensor.is_active ? "bg-emerald-500" : "bg-slate-400",
                    ].join(" ")}
                  />
                  {sensor.is_active ? "Active" : "Offline"}
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