// app/routes/posts.tsx
// @ts-nocheck
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
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


  // ---- load existing user reports ----
  useEffect(() => {
    async function loadReports() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/user-reports`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setReports(data.reports ?? data);
      } catch (err: any) {
        console.error(err);
        setError("Could not load user reports.");
      } finally {
        setLoading(false);
      }
    }
    loadReports();
  }, []);

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

    const isoTimestamp = observedAt
      ? new Date(observedAt).toISOString()
      : undefined;

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
  const selectedChartSensor = sensors.find((s) => s.id === chartSensorId) || null;

  async function handleLoadChart() {
    if (!chartSensorId) {
      setChartData([]);
      return;
    }

    try {
      setChartError(null);
      setChartLoading(true);
      const res = await fetch(
        `${API_BASE}/sensors/${chartSensorId}/readings?hours=${chartHours}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = data.readings ?? [];
      if (Array.isArray(list)) {
        setChartData(list);
      } else {
        setChartData([]);
      }
    } catch (err: any) {
      console.error(err);
      setChartError(err.message || "Could not load chart data.");
      setChartData([]);
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
              <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight">
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
                      />
                      <YAxis />
                      <Tooltip
                        labelFormatter={(value) =>
                          new Date(value as string).toLocaleString()
                        }
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="value"
                        dot={false}
                        name={
                          selectedChartSensor
                            ? `${selectedChartSensor.name} (${selectedChartSensor.unit ?? ""})`
                            : "value"
                        }
                      />
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