// app/routes/posts.tsx
// @ts-nocheck
import { useEffect, useState } from "react";

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

export default function PostsPage() {
  // ---- state ----
  const [activeUser, setActiveUser] = useState<ActiveUser | null>(null);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [reports, setReports] = useState<UserReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [sensorId, setSensorId] = useState("");
  const [type, setType] = useState<"rain" | "water_level" | "temperature">("rain");
  const [value, setValue] = useState("");
  const [comment, setComment] = useState("");
  const [observedAt, setObservedAt] = useState(""); // datetime-local string

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

      const payload = {
        user_id: activeUser.id, // Mongo user ID
        sensor_id: sensorId,    // Mongo sensor ID
        type,                   // "rain" | "water_level" | "temperature"
        value: Number(value),
        unit,
        timestamp: isoTimestamp,
        comment,
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

      // Optionally reload list from backend, but for now just append a shallow version
      const sensor = sensors.find((s) => s.id === sensorId);
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
          source: "user",
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

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="ws-card p-6 space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            User reports · prototype
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight">
            Neighbour reports aligned with sensor data.
          </h1>
          <p className="text-sm text-slate-600 max-w-xl leading-relaxed">
            Each report is saved in <code>user_reports</code> with the same
            shape as your sensor readings, so you can compare{" "}
            <span className="font-medium">user vs sensor</span> later.
          </p>

          <div className="mt-2 text-xs">
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

          {error && (
            <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Form + list */}
        <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start">
          {/* create report form */}
          <div className="ws-card p-5">
            <h2 className="text-sm font-semibold mb-2">Create a report</h2>
            <form className="space-y-3" onSubmit={handleSubmit}>
              {/* sensor name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">
                  Sensor
                </label>
                <select
                  value={sensorId}
                  onChange={(e) => setSensorId(e.target.value)}
                  className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  disabled={!activeUser}
                >
                  <option value="">Select a sensor…</option>
                  {sensors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.location ? `· ${s.location}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* type of data */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">
                  Type of data
                </label>
                <select
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as "rain" | "water_level" | "temperature")
                  }
                  className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
                  disabled={!activeUser}
                >
                  <option value="rain">Rain (mm/h)</option>
                  <option value="water_level">Water level (m)</option>
                  <option value="temperature">Temperature (°C)</option>
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
                {reports.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-800">
                        {r.sensor_name || r.sensor_id}{" "}
                        {r.location ? `· ${r.location}` : ""}
                      </p>
                      <span className="text-[11px] font-semibold">
                        {r.value} {r.unit} ({r.type})
                      </span>
                    </div>
                    {r.comment && (
                      <p className="mt-1 text-[11px] text-slate-700 whitespace-pre-line">
                        {r.comment}
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                      <span>source: {r.source || "user"}</span>
                      <span>
                        {r.timestamp
                          ? new Date(r.timestamp).toLocaleString()
                          : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}