// @ts-nocheck
import { useEffect, useState } from "react";
import type { Route } from "./+types/users";
import { AlertCircle, UserPlus, UserCircle2, Trash2 } from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";

type User = {
  id: string;
  name: string;
  email: string;
  plan: "free" | "plus" | "ultra";
};

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Users · Water Status" },
    {
      name: "description",
      content: "Create test users and pick an active user for Water Status.",
    },
  ];
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("@gmail.com");
  const [plan, setPlan] = useState<"free" | "plus" | "ultra">("free");

  // fake “logged in” user (frontend-only)
  const [activeUserId, setActiveUserId] = useState<string | null>(null);

  // ── Load users on mount ─────────────────────────────────
  useEffect(() => {
    async function loadUsers() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${API_BASE}/users`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const usersArray: User[] = data.users ?? data;
        setUsers(usersArray);

        // 🔁 Restore active user from localStorage if present
        if (typeof window !== "undefined") {
          try {
            const raw = window.localStorage.getItem("wsActiveUser");
            if (raw) {
              const saved = JSON.parse(raw) as User;
              if (
                saved &&
                saved.id &&
                usersArray.some((u) => u.id === saved.id)
              ) {
                setActiveUserId(saved.id);
              }
            }
          } catch (e) {
            console.warn("Could not read wsActiveUser from localStorage", e);
          }
        }
      } catch (err) {
        console.error(err);
        setError("Could not load users. Please try again in a moment.");
      } finally {
        setLoading(false);
      }
    }
    loadUsers();
  }, []);


  // ── Create user ─────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setError(null);
      const res = await fetch(`${API_BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          plan,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.detail || `HTTP ${res.status}`);
      }

      const created = await res.json();
      setUsers((prev) => [...prev, created]);

      // reset form a bit
      setName("");
      setEmail("@gmail.com");
      setPlan("free");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Could not create user.");
    }
  }

  // ── Delete user ─────────────────────────────────────────
  async function handleDelete(id: string) {
    const confirm = window.confirm("Delete this user?");
    if (!confirm) return;

    try {
      setError(null);
      const res = await fetch(`${API_BASE}/users/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.detail || `HTTP ${res.status}`);
      }

      setUsers((prev) => prev.filter((u) => u.id !== id));
      if (activeUserId === id) setActiveUserId(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Could not delete user.");
    }
  }
// ── Set active user + store in localStorage ───────────────
function handleSetActive(user: User) {
  setActiveUserId(user.id);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem("wsActiveUser", JSON.stringify(user));
      // tell the rest of the app that the active user changed
      window.dispatchEvent(new CustomEvent("ws-active-user-changed"));
    } catch (e) {
      console.warn("Could not save wsActiveUser to localStorage", e);
    }
  }
}

  const activeUser = users.find((u) => u.id === activeUserId) ?? null;

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="ws-card p-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Users · prototype
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight mt-1">
                Try Water Status with test users.
              </h1>
              <p className="mt-2 text-sm text-slate-600 max-w-xl leading-relaxed">
                This page is just for playing with{" "}
                <span className="font-medium">user CRUD</span>. You can create
                users, assign them a plan, and pick one as the{" "}
                <span className="font-medium">“active user”</span> (fake login).
              </p>
            </div>

            {activeUser && (
              <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-4 py-3 text-xs text-slate-600 shadow-sm min-w-[12rem]">
                <p className="font-semibold mb-1 flex items-center gap-1.5">
                  <UserCircle2 className="w-4 h-4 text-sky-500" />
                  Active user
                </p>
                <p className="text-sm font-medium text-slate-800">
                  {activeUser.name}
                </p>
                <p className="text-[11px] text-slate-500">{activeUser.email}</p>
                <p className="mt-1 text-[11px]">
                  Plan:{" "}
                  <span className="font-semibold uppercase">
                    {activeUser.plan}
                  </span>
                </p>
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-2 flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Form + list */}
<div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start">
  {/* Create user form */}
  <div className="ws-card p-5">
    <div className="flex items-center gap-2 mb-2">
      <UserPlus className="w-4 h-4 text-sky-500" />
      <h2 className="text-sm font-semibold">Create a user</h2>
    </div>

    {/* limit the form width so it doesn’t look like a huge bar */}
    <form className="space-y-3 max-w-md" onSubmit={handleCreate}>
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
          placeholder="e.g. River Neighbour A"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">
          Email
        </label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        <p className="text-[10px] text-slate-500">
          For now this is just stored in MongoDB, no real login emails
          will be sent.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">
          Plan
        </label>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as any)}
          className="w-full rounded-lg border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          <option value="free">Free</option>
          <option value="plus">Plus</option>
          <option value="ultra">Ultra</option>
        </select>
      </div>

      <button
        type="submit"
        className="ws-button-primary inline-flex items-center gap-2 mt-1"
      >
        <UserPlus className="w-4 h-4" />
        Create user
      </button>
    </form>
  </div>

  {/* User list */}
  <div className="ws-card p-5">
    <div className="flex items-center justify-between mb-2">
      <h2 className="text-sm font-semibold">Existing users</h2>
      <p className="text-[11px] text-slate-500">
        {loading
          ? "Loading…"
          : `${users.length} user${users.length === 1 ? "" : "s"}`}
      </p>
    </div>

    {loading && (
      <div className="text-xs text-slate-500 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
        Loading users from backend…
      </div>
    )}

    {!loading && users.length === 0 && (
      <p className="text-xs text-slate-500">
        No users yet. Create one using the form on the left.
      </p>
    )}

    {!loading && users.length > 0 && (
      <ul className="divide-y divide-[var(--ws-border-subtle)]">
        {users.map((u) => {
          const isActive = u.id === activeUserId;
          return (
            <li
              key={u.id}
              className="py-2 flex items-center justify-between gap-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {u.name}
                  {isActive && (
                    <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200">
                      active
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500">{u.email}</p>
                <p className="text-[11px] text-slate-500">
                  Plan:{" "}
                  <span className="font-semibold uppercase">
                    {u.plan}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSetActive(u)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100 transition"
                >
                  Set active
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(u.id)}
                  className="p-1.5 rounded-full border border-rose-200 text-rose-600 bg-rose-50 hover:bg-rose-100 transition"
                  title="Delete user"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
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