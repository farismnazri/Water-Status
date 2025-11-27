// app/routes/posts.tsx
// @ts-nocheck
import { useEffect, useState } from "react";
import { Trash2, Heart } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

function getCurrentSourceName(): string {
  if (typeof window === "undefined") return "Guest";

  try {
    const raw = window.localStorage.getItem("wsActiveUser");
    if (!raw) return "Guest";

    const saved = JSON.parse(raw);
    return saved?.name || "Guest";
  } catch {
    return "Guest";
  }
}

const API_BASE = "http://127.0.0.1:8000";

type ActiveUser = {
  id: string;
  name: string;
  email?: string;
  plan?: "free" | "plus" | "ultra";
};

type Sensor = {
  id: string;           // Mongo _id
  name: string;
  type: string;
  location?: string;
  unit?: string;
};

type UserReport = {
  id: string;
  sensor_id: string;
  sensor_name?: string;
  location?: string;
  type: string;
  value: number;
  unit: string;
  timestamp?: string;
  user_id?: string;
  source?: string;
  comment?: string;
  likes?: number;
  liked_by_me?: boolean;
};

type SensorReading = {
  id: string;
  sensor_id?: string;
  sensor_name?: string;
  location?: string;
  type: string;
  value: number;
  unit?: string;
  timestamp?: string;
};

export default function PostsPage() {
  // ---- state ----
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [reports, setReports] = useState<UserReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentReadings, setRecentReadings] = useState<SensorReading[]>([]);
  const [readingsLoading, setReadingsLoading] = useState(false);

  // Header tabs + chart state
  const [headerTab, setHeaderTab] = useState<"snapshot" | "chart">("snapshot");
  const [chartSensorId, setChartSensorId] = useState<string>("");
  const [chartHours, setChartHours] = useState<number>(24);
  const [chartData, setChartData] = useState<SensorReading[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [chartSeriesType, setChartSeriesType] = useState<
    "rain" | "water_level" | "temperature" | null
  >(null);
  const [chartSeriesLabel, setChartSeriesLabel] = useState<string>("value");
  const [chartCompareSensorId, setChartCompareSensorId] = useState<string>("");
  const [chartCompareLabel, setChartCompareLabel] = useState<string>("");
  const [chartCompareType, setChartCompareType] = useState<
  "rain" | "water_level" | "temperature" | null
  >(null);

  // form state
  const [sensorId, setSensorId] = useState("");
  const [type, setType] = useState<"rain" | "water_level" | "temperature">("rain");
  const [value, setValue] = useState("");
  const [comment, setComment] = useState("");
  const [observedAt, setObservedAt] = useState(""); // datetime-local string

// edit state
const [editingId, setEditingId] = useState<string | null>(null);
const [editValue, setEditValue] = useState("");
const [editComment, setEditComment] = useState("");
const [editType, setEditType] =
  useState<"rain" | "water_level" | "temperature">("rain");
const [editSensorId, setEditSensorId] = useState<string>("");

// Only show sensors that match the currently selected type
const filteredSensors = sensors.filter((s) => s.type === type);
const editFilteredSensors = sensors.filter((s) => s.type === editType);

  // unit derived from type
  const unit =
    type === "rain"
      ? "mm/h"
      : type === "water_level"
      ? "m"
      : "°C";

  // ---- load active user from localStorage ----
  useEffect(() => {
    function refreshActiveUser() {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem("wsActiveUser");
        if (!raw) {
          setActiveUser(null);
          return;
        }
        const saved = JSON.parse(raw);
        if (!saved?.id) {
          setActiveUser(null);
          return;
        }
        setActiveUser(saved);
      } catch {
        setActiveUser(null);
      }
    }

    refreshActiveUser();

    if (typeof window !== "undefined") {
      const handler = () => refreshActiveUser();
      window.addEventListener("ws-active-user-changed", handler);
      window.addEventListener("storage", (e) => {
        if (e.key === "wsActiveUser") refreshActiveUser();
      });
      return () => {
        window.removeEventListener("ws-active-user-changed", handler);
      };
    }
  }, []);

  // ---- load sensors for dropdown ----
  useEffect(() => {
    async function loadSensors() {
      try {
        const res = await fetch(`${API_BASE}/sensors`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSensors(data.sensors ?? data);
      } catch (err: any) {
        console.error(err);
        setError("Could not load sensors.");
      }
    }
    loadSensors();
  }, []);

    // ---- load latest sensor readings for header time-series ----
  useEffect(() => {
    async function loadAllReadings() {
      try {
        setReadingsLoading(true);
        const res = await fetch(`${API_BASE}/sensor-readings`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = data.readings ?? data;
        if (Array.isArray(list)) {
          // take only the first few newest points for a compact header
          setRecentReadings(list.slice(0, 6));
        } else {
          setRecentReadings([]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setReadingsLoading(false);
      }
    }
    loadAllReadings();
  }, []);


  // ---- load existing user reports (with liked_by_me) ----
  useEffect(() => {
    async function loadReports() {
      try {
        setLoading(true);
        setError(null);

        const baseUrl = `${API_BASE}/user-reports?limit=100`;
        const url =
          activeUser && activeUser.id
            ? `${baseUrl}&current_user_id=${encodeURIComponent(activeUser.id)}`
            : baseUrl;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const reportsArray: UserReport[] = data.reports ?? data;
        setReports(reportsArray);
      } catch (err: any) {
        console.error(err);
        setError("Could not load user reports.");
      } finally {
        setLoading(false);
      }
    }

    loadReports();
  }, [activeUser?.id]);

// ---- delete a user report ----
async function handleDeleteReport(id: string, ownerUserId?: string) {
  if (!activeUser) {
    setError("No active user selected.");
    return;
  }

  // Extra safety: only allow deleting own reports
  if (!ownerUserId || ownerUserId !== activeUser.id) {
    setError("You can only delete your own reports.");
    return;
  }

  const ok = window.confirm("Delete this report?");
  if (!ok) return;

  try {
    setError(null);
    const res = await fetch(
      `${API_BASE}/user-reports/${id}?user_id=${encodeURIComponent(activeUser.id)}`,
      {
        method: "DELETE",
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || `HTTP ${res.status}`);
    }

    setReports((prev) => prev.filter((r) => r.id !== id));
  } catch (err: any) {
    console.error(err);
    setError(err.message || "Could not delete report.");
  }
}

// ---- start editing a report ----
function handleStartEdit(report: UserReport) {
  if (!activeUser) {
    setError("No active user selected.");
    return;
  }
  if (!report.user_id || report.user_id !== activeUser.id) {
    setError("You can only edit your own reports.");
    return;
  }

  setEditingId(report.id);
  setEditValue(String(report.value));
  setEditComment(report.comment ?? "");
  setEditType(report.type as "rain" | "water_level" | "temperature");
  setEditSensorId(report.sensor_id);  
}

function handleCancelEdit() {
  setEditingId(null);
  setEditValue("");
  setEditComment("");
}

// ---- save edited report ----
async function handleSaveEdit(id: string, ownerUserId?: string) {
  if (!activeUser) {
    setError("No active user selected.");
    return;
  }

  if (!ownerUserId || ownerUserId !== activeUser.id) {
    setError("You can only edit your own reports.");
    return;
  }

  if (editValue.trim() === "" && (editComment ?? "").trim() === "") {
    setError("Nothing to update.");
    return;
  }

  try {
    setError(null);

    const payload: any = {
      user_id: activeUser.id,
    };

    if (editValue.trim() !== "") {
      payload.value = Number(editValue);
    }
    if (editComment !== null && editComment !== undefined) {
      payload.comment = editComment;
    }

    // ⭐ also include type + station if chosen
    if (editType) {
      payload.type = editType;
    }
    if (editSensorId) {
      payload.sensor_id = editSensorId;
    }

    const res = await fetch(`${API_BASE}/user-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || `HTTP ${res.status}`);
    }

    const updated = await res.json();

    setReports((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updated } : r))
    );

    setEditingId(null);
    setEditValue("");
    setEditComment("");
    setEditType("rain");
    setEditSensorId("");
  } catch (err: any) {
    console.error(err);
    setError(err.message || "Could not update report.");
  }
}

// ---- toggle like on a report ----
async function handleToggleLike(report: UserReport) {
  if (!activeUser) {
    setError("No active user selected.");
    return;
  }

  try {
    setError(null);
    const res = await fetch(
      `${API_BASE}/user-reports/${report.id}/like`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: activeUser.id }),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || `HTTP ${res.status}`);
    }

    const result = await res.json(); // { id, likes, liked }

    setReports((prev) =>
      prev.map((r) =>
        r.id === report.id
          ? { ...r, likes: result.likes, liked_by_me: result.liked }
          : r
      )
    );
  } catch (err: any) {
    console.error(err);
    setError(err.message || "Could not update likes.");
  }
}

  // ---- submit user report ----
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  if (!activeUser) {
    setError("No active user selected.");
    return;
  }
  if (!sensorId || !value) {
    setError("Please choose a sensor and enter a value.");
    return;
  }

  try {
    setError(null);

    const isoTimestamp = observedAt || undefined;

    // ⭐ who is posting?
    const sourceName = getCurrentSourceName();

    const payload = {
      user_id: activeUser.id, // Mongo user ID
      sensor_id: sensorId,    // Mongo sensor ID
      type,                   // "rain" | "water_level" | "temperature"
      value: Number(value),
      unit,
      timestamp: isoTimestamp,
      comment,
      source: sourceName,     // ⭐ send to backend
    };

    const res = await fetch(`${API_BASE}/user-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail || `HTTP ${res.status}`);
    }

    const { id } = await res.json();

    const sensor = sensors.find((s) => s.id === sensorId);

    // ⭐ store sourceName in local state too
    setReports((prev) => [
      {
        id,
        sensor_id: sensorId,
        sensor_name: sensor?.name,
        location: sensor?.location,
        type,
        value: Number(value),
        unit,
        timestamp: isoTimestamp,
        user_id: activeUser.id,
        source: sourceName,
        comment,
      },
      ...prev,
    ]);

    // reset form
    setSensorId("");
    setType("rain");
    setValue("");
    setComment("");
    setObservedAt("");
  } catch (err: any) {
    console.error(err);
    setError(err.message || "Could not submit report.");
  }
}

// --- chart helpers ---
const selectedChartSensor =
  sensors.find((s) => s.id === chartSensorId) || null;

const compareSensorOptions = selectedChartSensor
  ? sensors.filter((s) => s.id !== chartSensorId)
  : [];

function getColorForType(
  t: "rain" | "water_level" | "temperature" | null
): string {
  if (t === "rain") return "#0ea5e9"; // blue
  if (t === "water_level") return "#22c55e"; // green
  if (t === "temperature") return "#f97373"; // red
  return "#0f172a"; // default
}

function getAxisLabelForType(
  t: "rain" | "water_level" | "temperature" | null
): string {
  if (t === "rain") return "Rainfall (mm/h)";
  if (t === "water_level") return "Water level (m)";
  if (t === "temperature") return "Temperature (°C)";
  return "Value";
}

const mainLineColor = getColorForType(chartSeriesType);
const compareLineColor = getColorForType(chartCompareType);
const userSeriesColor = "#6366f1"; // purple for user reports

async function handleLoadChart() {
  if (!chartSensorId) {
    setChartData([]);
    setChartSeriesType(null);
    setChartSeriesLabel("value");
    setChartCompareLabel("");
    setChartCompareType(null);
    return;
  }

  try {
    setChartError(null);
    setChartLoading(true);

    // Load primary sensor readings
    const resMain = await fetch(
      `${API_BASE}/sensors/${chartSensorId}/readings?hours=${chartHours}`
    );
    if (!resMain.ok) throw new Error(`HTTP ${resMain.status}`);
    const dataMain = await resMain.json();
    const mainList: SensorReading[] = dataMain.readings ?? [];

    // Optionally load compare sensor readings (same type only, ensured by options list)
    let compareList: SensorReading[] = [];
    if (chartCompareSensorId) {
      const resCompare = await fetch(
        `${API_BASE}/sensors/${chartCompareSensorId}/readings?hours=${chartHours}`
      );
      if (!resCompare.ok) throw new Error(`HTTP ${resCompare.status}`);
      const dataCompare = await resCompare.json();
      compareList = dataCompare.readings ?? [];
    }

    if (!Array.isArray(mainList) || mainList.length === 0) {
      setChartData([]);
      setChartSeriesType(null);
      setChartSeriesLabel("value");
      setChartCompareLabel("");
      setChartCompareType(null);
      return;
    }

    // Determine main type from the first reading, so we can overlay matching user reports
    const mainType =
      (mainList[0]?.type as "rain" | "water_level" | "temperature" | undefined) ??
      null;

    // Filter user reports for this sensor (and same type, if known) within the selected window
    let userReportsForSensor: UserReport[] = [];
    if (mainType) {
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - chartHours);

      userReportsForSensor = reports.filter((r) => {
        if (r.sensor_id !== chartSensorId) return false;
        if (r.type !== mainType) return false;
        if (!r.timestamp) return false;
        const tsDate = new Date(r.timestamp);
        return tsDate >= cutoff;
      });
    }

    // Merge time‑series by timestamp into a single array with:
    //   series0  -> main sensor readings
    //   series1  -> compare sensor readings (optional)
    //   userSeries -> user‑reported values (optional)
    const merged = new Map<string, any>();

    function addSeries(list: SensorReading[], key: "series0" | "series1") {
      list.forEach((r) => {
        if (!r.timestamp) return;
        const ts = r.timestamp;
        if (!merged.has(ts)) {
          merged.set(ts, { timestamp: ts });
        }
        const obj = merged.get(ts);
        obj[key] = r.value;
      });
    }

function addUserSeries(list: UserReport[], mainList: SensorReading[]) {
  // Precompute main timestamps (as numbers) so we can find the nearest one
  const mainTimes = mainList
    .filter((r) => r.timestamp)
    .map((r) => ({
      ts: r.timestamp as string,
      t: new Date(r.timestamp as string).getTime(),
    }));

  if (mainTimes.length === 0) return;

  list.forEach((r) => {
    if (!r.timestamp) return;

    const tUser = new Date(r.timestamp).getTime();

    // Find nearest main timestamp to this user report
    let best = mainTimes[0];
    let bestDiff = Math.abs(tUser - best.t);

    for (let i = 1; i < mainTimes.length; i++) {
      const diff = Math.abs(tUser - mainTimes[i].t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = mainTimes[i];
      }
    }

    const snapTs = best.ts;

    // Attach the point to that existing merged row
    const obj = merged.get(snapTs);
    if (!obj) return;

    // If multiple user points snap to the same reading, keep the first one
    if (obj.userSeries === undefined) {
      obj.userSeries = r.value;
      obj.userSeriesSource = r.source || "User";
    }
  });
}

    addSeries(mainList, "series0");
    if (compareList.length > 0) {
      addSeries(compareList, "series1");
    }
    if (userReportsForSensor.length > 0) {
      addUserSeries(userReportsForSensor, mainList);
    }

    const mergedArray = Array.from(merged.values()).sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    setChartData(mergedArray as any);

    const mainSensor = selectedChartSensor;
    const compareSensor = sensors.find((s) => s.id === chartCompareSensorId) || null;

    if (mainSensor) {
      const t = mainSensor.type as "rain" | "water_level" | "temperature";
      setChartSeriesType(t);
      setChartSeriesLabel(getAxisLabelForType(t));
    } else {
      setChartSeriesType(null);
      setChartSeriesLabel("Value");
    }

    if (compareSensor && compareList.length > 0) {
      const ct = compareSensor.type as "rain" | "water_level" | "temperature";
      setChartCompareType(ct);
      setChartCompareLabel(getAxisLabelForType(ct));
    } else {
      setChartCompareLabel("");
      setChartCompareType(null);
    }
  } catch (err: any) {
    console.error(err);
    setChartError(err.message || "Could not load chart data.");
    setChartData([]);
    setChartSeriesType(null);
    setChartSeriesLabel("value");
    setChartCompareLabel("");
    setChartCompareType(null);
  } finally {
    setChartLoading(false);
  }
}

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="ws-card p-6 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Sensor data · prototype
              </p>
              <h1 className="text-2xl sm:text-1xl font-semibold leading-tight tracking-tight">
                Time‑series snapshot from your stations.
              </h1>
              <p className="mt-1 text-sm text-slate-600 max-w-xl leading-relaxed">
                Quickly scan the latest station values, or switch to the chart
                view to explore a time‑series for any station.
              </p>
            </div>
            <p className="text-[11px] text-slate-500 whitespace-nowrap">
              {readingsLoading
                ? "Loading readings…"
                : `${recentReadings.length} latest point${
                    recentReadings.length === 1 ? "" : "s"
                  }`}
            </p>
          </div>

          {/* Tabs */}
          <div className="mt-3 flex text-[11px] border-b border-[var(--ws-border-subtle)]">
            <button
              type="button"
              onClick={() => setHeaderTab("snapshot")}
              className={
                "px-3 py-1 -mb-px border-b-2 " +
                (headerTab === "snapshot"
                  ? "border-sky-500 font-semibold text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700")
              }
            >
              Snapshot list
            </button>
            <button
              type="button"
              onClick={() => setHeaderTab("chart")}
              className={
                "px-3 py-1 -mb-px border-b-2 " +
                (headerTab === "chart"
                  ? "border-sky-500 font-semibold text-sky-700"
                  : "border-transparent text-slate-500 hover:text-slate-700")
              }
            >
              Time‑series chart
            </button>
          </div>

          {headerTab === "snapshot" ? (
            <div className="mt-3 text-xs text-slate-600">
              {readingsLoading && recentReadings.length === 0 && (
                <p>Loading fake time‑series data…</p>
              )}

              {!readingsLoading && recentReadings.length === 0 && (
                <p>
                  No sensor readings yet. Once data comes in, it will appear here.
                </p>
              )}

              {recentReadings.length > 0 && (
                <ul className="space-y-1">
                  {recentReadings.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 border border-[var(--ws-border-subtle)] rounded-md px-2 py-1 bg-[var(--ws-bg-elevated)]/70"
                    >
                      <div className="min-w-0">
                        <p className="truncate">
                          <span className="font-semibold text-slate-800">
                            {r.sensor_name || r.type}
                          </span>
                          {r.location && (
                            <span className="text-slate-500">
                              {" "}
                              · {r.location}
                            </span>
                          )}
                        </p>
                        {r.timestamp && (
                          <p className="text-[10px] text-slate-500">
                            {new Date(r.timestamp).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] font-semibold text-slate-800">
                          {r.value} {r.unit}
                        </p>
                        <p className="text-[10px] text-slate-500">{r.type}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-3 text-xs text-slate-600 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Station:</span>
                  <select
                    value={chartSensorId}
                    onChange={(e) => setChartSensorId(e.target.value)}
                    className="rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-300"
                  >
                    <option value="">Choose a station…</option>
                    {sensors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.location ? `· ${s.location}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Compare with:</span>
                  <select
                    value={chartCompareSensorId}
                    onChange={(e) => setChartCompareSensorId(e.target.value)}
                    className="rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-300"
                    disabled={!chartSensorId || compareSensorOptions.length === 0}
                  >
                    <option value="">(none)</option>
                    {compareSensorOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.location ? `· ${s.location}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Window:</span>
                  <select
                    value={String(chartHours)}
                    onChange={(e) => setChartHours(Number(e.target.value))}
                    className="rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-300"
                  >
                    <option value="6">Last 6 hours</option>
                    <option value="12">Last 12 hours</option>
                    <option value="24">Last 24 hours</option>
                    <option value="48">Last 48 hours</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleLoadChart}
                  className="ml-auto text-[11px] px-3 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition"
                >
                  Load chart
                </button>
              </div>

              {chartError && (
                <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1">
                  {chartError}
                </div>
              )}

              {!chartSensorId && !chartLoading && (
                <p className="text-[11px] text-slate-500">
                  Please choose a station and click "Load chart" to see its
                  time‑series.
                </p>
              )}

              {chartSensorId && chartLoading && (
                <p className="text-[11px] text-slate-500">Loading chart…</p>
              )}

              {chartSensorId && !chartLoading && chartData.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  No readings in the last {chartHours} hours for this station.
                </p>
              )}

              {chartSensorId && chartData.length > 0 && (
                <div className="w-full h-64">
                  <ResponsiveContainer width="100%" height="100%">
<LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
  <CartesianGrid strokeDasharray="3 3" />
  <XAxis
    dataKey="timestamp"
    tickFormatter={(value) =>
      new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    }
    minTickGap={20}
    label={{
      value: "Time",
      position: "insideBottomLeft",
      offset: -5,
      style: { fontSize: 10, fill: "#64748b" },
    }}
  />
  {/* Left Y-axis for main series */}
  <YAxis
    yAxisId="left"
    label={{
      value: chartSeriesLabel || "Value",
      angle: -90,
      position: "insideLeft",
      style: { fontSize: 10, fill: "#64748b" },
    }}
  />
  {/* Right Y-axis only when comparing a second sensor (e.g. rain vs water level) */}
  {chartCompareSensorId && chartCompareType && (
    <YAxis
      yAxisId="right"
      orientation="right"
      label={{
        value: chartCompareLabel || "Compare",
        angle: -90,
        position: "insideRight",
        style: { fontSize: 10, fill: "#64748b" },
      }}
    />
  )}
  <Tooltip
    labelFormatter={(value) =>
      new Date(value as string).toLocaleString()
    }
    formatter={(value, name, props) => {
      if (name === "User reports (points)" && props && props.payload) {
        const src = props.payload.userSeriesSource || "User";
        return [`${value} (${src})`, name];
      }
      return [value, name];
    }}
  />
  <Legend />
  <Line
    type="monotone"
    dataKey="series0"
    dot={false}
    stroke={mainLineColor}
    activeDot={{ r: 3 }}
    yAxisId="left"
    name={`${chartSeriesLabel} — main (solid)`}
  />
  {chartCompareSensorId && chartCompareLabel && (
    <Line
      type="monotone"
      dataKey="series1"
      dot={false}
      stroke={compareLineColor}
      strokeDasharray="4 2"
      activeDot={{ r: 3 }}
      yAxisId="right"
      name={`${chartCompareLabel} — compare (dashed)`}
    />
  )}
  {/* User-reported values overlaid on the main axis (e.g. manual water‑level readings) */}
  {chartSensorId &&
    chartData.some((d: any) => d.userSeries !== undefined && d.userSeries !== null) && (
      <Line
        type="monotone"
        dataKey="userSeries"
        stroke="none"
        dot={{ r: 4, stroke: userSeriesColor, strokeWidth: 1, fill: userSeriesColor }}
        yAxisId="left"
        name="User reports (points)"
      />
  )}
</LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Form + list */}
        <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start">
          {/* create report form */}
          <div className="ws-card p-5">
                        <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Create a report</h2>
              <div className="text-[11px] text-right">
                {activeUser ? (
                  <p className="text-slate-600">
                    Reporting as{" "}
                    <span className="font-semibold">{activeUser.name}</span>{" "}
                    <span className="text-[11px] text-slate-500">
                      ({activeUser.plan ?? "free"} plan)
                    </span>
                  </p>
                ) : (
                  <p className="text-rose-600">
                    No active user. Go to the Users page and set one first.
                  </p>
                )}
              </div>
            </div>
<form className="space-y-3" onSubmit={handleSubmit}>
  {/* type of data FIRST */}
  <div className="space-y-1">
    <label className="text-xs font-medium text-slate-600">
      Type of data
    </label>
    <select
      value={type}
      onChange={(e) => {
        const newType = e.target.value as "rain" | "water_level" | "temperature";
        setType(newType);
        setSensorId("");        // 🔹 reset sensor when type changes
      }}
      className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
      disabled={!activeUser}
    >
      <option value="rain">Rain (mm/h)</option>
      <option value="water_level">Water level (m)</option>
      <option value="temperature">Temperature (°C)</option>
    </select>
  </div>

  {/* sensor (filtered by type) SECOND */}
  <div className="space-y-1">
    <label className="text-xs font-medium text-slate-600">
      Sensor / location
    </label>
    <select
      value={sensorId}
      onChange={(e) => setSensorId(e.target.value)}
      className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
      disabled={!activeUser || filteredSensors.length === 0}
    >
      <option value="">
        {filteredSensors.length
          ? "Select a station…"
          : "No stations for this data type"}
      </option>
      {filteredSensors.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} {s.location ? `· ${s.location}` : ""}
        </option>
      ))}
    </select>
  </div>

              {/* value */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">
                  Value ({unit})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  placeholder={
                    type === "rain"
                      ? "e.g. 35.6"
                      : type === "water_level"
                      ? "e.g. 1.20"
                      : "e.g. 28.5"
                  }
                  disabled={!activeUser}
                />
              </div>

              {/* personalised post */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">
                  Personalised note (not used for data)
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"
                  placeholder="e.g. Rained heavily for 30 minutes, drains almost full."
                  disabled={!activeUser}
                />
              </div>

              {/* time */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">
                  When did it happen?
                </label>
                <input
                  type="datetime-local"
                  value={observedAt}
                  onChange={(e) => setObservedAt(e.target.value)}
                  className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  disabled={!activeUser}
                />
                <p className="text-[10px] text-slate-500">
                  If left empty, backend will use the current time.
                </p>
              </div>

              <button
                type="submit"
                className="ws-button-primary inline-flex items-center gap-2 mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={!activeUser}
              >
                Submit report
              </button>
            </form>
          </div>

          {/* reports list */}
          <div className="ws-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">User reports</h2>
              <p className="text-[11px] text-slate-500">
                {loading
                  ? "Loading…"
                  : `${reports.length} report${reports.length === 1 ? "" : "s"}`}
              </p>
            </div>

            {!loading && reports.length === 0 && (
              <p className="text-xs text-slate-500">
                No user reports yet. Create the first one using the form.
              </p>
            )}

            {!loading && reports.length > 0 && (
              <ul className="space-y-3">
                {reports.map((r) => {
                  const canEdit = activeUser && r.user_id === activeUser.id;
                  return (
<li
  key={r.id}
  className="rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-xs"
>
  <div className="flex items-start justify-between gap-2">
    <div>
      <p className="font-semibold text-slate-800">
        {r.sensor_name || r.sensor_id}{" "}
        {r.location ? `· ${r.location}` : ""}
      </p>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold whitespace-nowrap">
        {r.value} {r.unit} ({r.type})
      </span>

      {/* Like button, visible for everyone */}
      <button
        type="button"
        onClick={() => handleToggleLike(r)}
        className={
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition " +
          (r.liked_by_me
            ? "bg-rose-50 border-rose-200 text-rose-600"
            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100")
        }
      >
        <Heart
          className={
            "w-3 h-3 " +
            (r.liked_by_me
              ? "fill-rose-500 text-rose-500"
              : "text-slate-500")
          }
        />
        <span>{r.likes ?? 0}</span>
      </button>

      {/* Edit/Delete only for the owner */}
      {canEdit && (
        <>
          {editingId === r.id ? (
            <>
              <button
                type="button"
                onClick={() => handleSaveEdit(r.id, r.user_id)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleStartEdit(r)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDeleteReport(r.id, r.user_id)}
                className="p-1 rounded-full border border-rose-200 text-rose-600 bg-rose-50 hover:bg-rose-100 transition"
                title="Delete report"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </>
      )}
    </div>
  </div>

  {/* Comment area: show editable inputs when in edit mode */}
  {editingId === r.id && canEdit ? (
    <div className="mt-2 space-y-2">
      {/* Edit type */}
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-slate-600">
          Type of data
        </label>
        <select
          value={editType}
          onChange={(e) => {
            const newType =
              e.target.value as "rain" | "water_level" | "temperature";
            setEditType(newType);
            setEditSensorId(""); // reset station when type changes
          }}
          className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-300"
        >
          <option value="rain">Rain (mm/h)</option>
          <option value="water_level">Water level (m)</option>
          <option value="temperature">Temperature (°C)</option>
        </select>
      </div>

      {/* Edit station */}
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-slate-600">
          Station / location
        </label>
        <select
          value={editSensorId}
          onChange={(e) => setEditSensorId(e.target.value)}
          className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-300"
        >
          <option value="">
            {editFilteredSensors.length
              ? "Select a station…"
              : "No stations for this type"}
          </option>
          {editFilteredSensors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.location ? `· ${s.location}` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Edit value */}
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-slate-600">
          Value ({r.unit})
        </label>
        <input
          type="number"
          step="0.01"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-300"
        />
      </div>

      {/* Edit note */}
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-slate-600">
          Personalised note
        </label>
        <textarea
          rows={2}
          value={editComment}
          onChange={(e) => setEditComment(e.target.value)}
          className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-300 resize-none"
        />
      </div>
    </div>
  ) : (
    r.comment && (
      <p className="mt-1 text-[11px] text-slate-700 whitespace-pre-line">
        {r.comment}
      </p>
    )
  )}

  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
    <span>source: {r.source || "User"}</span>
    <span>
      {r.timestamp ? new Date(r.timestamp).toLocaleString() : ""}
    </span>
  </div>
</li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}