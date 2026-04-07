// @ts-nocheck
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/users";
import {
  AlertCircle,
  BarChart3,
  Heart,
  Lock,
  Pencil,
  Shield,
  User,
  UserPlus,
  Trash2,
} from "lucide-react";
import { API_BASE } from "../lib/api";

type Plan = "free" | "plus" | "ultra";

type AuthUser = {
  id: string;
  username: string;
  name?: string;
  email: string;
  plan?: Plan;
};

type AdminUser = {
  id: string;
  username: string;
  email: string;
};

type LoginResult = {
  token: string;
  role: "user" | "admin";
  user?: AuthUser;
};

type UserReportLite = {
  user_id?: string;
  likes?: number;
};

const ADMIN_SESSION_KEY = "wsAdminSession";
const ACTIVE_USER_KEY = "wsActiveUser";

function sanitizeUsernameInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 32);
}

function sanitizeEmailInput(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "").slice(0, 254);
}

function sanitizeGmailEmailInput(raw: string): string {
  const cleaned = sanitizeEmailInput(raw);
  const localPart = cleaned.split("@")[0] ?? "";
  return `${localPart}@gmail.com`;
}

function sanitizePasswordInput(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 128);
}

function sanitizePlanConfirmationInput(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 24);
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizePlan(raw: unknown): Plan {
  return raw === "plus" || raw === "ultra" ? raw : "free";
}

function normalizeStoredUser(raw: any): AuthUser | null {
  if (!raw?.id) return null;
  const normalizedUsername = sanitizeUsernameInput(
    raw?.username || raw?.name || "user"
  );
  const username = normalizedUsername || "user";
  return {
    id: String(raw.id),
    username,
    name: raw?.name || username,
    email: sanitizeGmailEmailInput(raw?.email || "@gmail.com"),
    plan: normalizePlan(raw?.plan),
  };
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Users Login · Water Status" },
    {
      name: "description",
      content: "Sign in with username/password or manage users as admin.",
    },
  ];
}

export default function UsersPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<"guest" | "user" | "admin">("guest");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("@gmail.com");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registrationPlan, setRegistrationPlan] = useState<Plan>("free");
  const [planConfirmation, setPlanConfirmation] = useState("");

  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteHandshake, setDeleteHandshake] = useState("");

  const [userStatsLoading, setUserStatsLoading] = useState(false);
  const [userPostsCount, setUserPostsCount] = useState(0);
  const [userLikesCount, setUserLikesCount] = useState(0);

  const [editingProfile, setEditingProfile] = useState(false);
  const [profileSaveLoading, setProfileSaveLoading] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [profileEmail, setProfileEmail] = useState("@gmail.com");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const adminSession = safeJsonParse<{ token: string }>(
      window.localStorage.getItem(ADMIN_SESSION_KEY)
    );

    if (adminSession?.token) {
      setRole("admin");
      setAdminToken(adminSession.token);
      return;
    }

    const active = safeJsonParse<{ id?: string }>(
      window.localStorage.getItem(ACTIVE_USER_KEY)
    );
    const restoredUser = normalizeStoredUser(active);
    if (restoredUser?.id) {
      setRole("user");
      setCurrentUser(restoredUser);
      setProfileUsername(restoredUser.username);
      setProfileEmail(restoredUser.email);
    } else {
      setRole("guest");
    }
  }, []);

  async function loadAdminUsers(token: string) {
    try {
      setAdminLoading(true);
      const res = await fetch(`${API_BASE}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setAdminUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (err: any) {
      const message = err?.message || "Could not load admin users.";
      setError(message);

      if (message.toLowerCase().includes("token") || message.includes("401")) {
        handleLogout();
      }
    } finally {
      setAdminLoading(false);
    }
  }

  useEffect(() => {
    if (role === "admin" && adminToken) {
      loadAdminUsers(adminToken);
    }
  }, [role, adminToken]);

  function persistActiveUser(user: AuthUser) {
    if (typeof window === "undefined") return;

    const normalizedUser: AuthUser = {
      id: String(user.id),
      username: sanitizeUsernameInput(user.username || user.name || "user") || "user",
      name: user.name || user.username || "User",
      email: sanitizeGmailEmailInput(user.email || "@gmail.com"),
      plan: normalizePlan(user.plan),
    };

    const activeUser = {
      id: normalizedUser.id,
      name: normalizedUser.username || normalizedUser.name || "User",
      email: normalizedUser.email,
      plan: normalizedUser.plan || "free",
      username: normalizedUser.username,
    };

    window.localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(activeUser));
    window.localStorage.removeItem(ADMIN_SESSION_KEY);
    window.dispatchEvent(new CustomEvent("ws-active-user-changed"));

    setCurrentUser(normalizedUser);
    setProfileUsername(normalizedUser.username);
    setProfileEmail(normalizedUser.email);
    setRole("user");
    setAdminToken(null);
    setAdminUsers([]);
    setEditingProfile(false);
  }

  function persistAdminSession(token: string) {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ token }));
    window.localStorage.removeItem(ACTIVE_USER_KEY);
    window.dispatchEvent(new CustomEvent("ws-active-user-changed"));

    setRole("admin");
    setAdminToken(token);
  }

  function handleLogout() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ACTIVE_USER_KEY);
      window.localStorage.removeItem(ADMIN_SESSION_KEY);
      window.dispatchEvent(new CustomEvent("ws-active-user-changed"));
    }

    setRole("guest");
    setCurrentUser(null);
    setAdminToken(null);
    setAdminUsers([]);
    setConfirmingDeleteId(null);
    setDeleteHandshake("");
    setUserPostsCount(0);
    setUserLikesCount(0);
    setEditingProfile(false);
    setInfo("Logged out.");
  }

  useEffect(() => {
    async function loadUserDashboard(userId: string) {
      try {
        setUserStatsLoading(true);

        const [profileRes, reportsRes] = await Promise.all([
          fetch(`${API_BASE}/users/${userId}`),
          fetch(`${API_BASE}/user-reports?limit=2000`),
        ]);

        if (profileRes.ok) {
          const profile = await profileRes.json();
          const normalizedProfile: AuthUser = {
            id: String(profile?.id || userId),
            username: sanitizeUsernameInput(profile?.username || profile?.name || "user") || "user",
            name: profile?.name || profile?.username || "User",
            email: sanitizeGmailEmailInput(profile?.email || "@gmail.com"),
            plan: normalizePlan(profile?.plan),
          };
          setCurrentUser(normalizedProfile);
          setProfileUsername(normalizedProfile.username);
          setProfileEmail(normalizedProfile.email);

          if (typeof window !== "undefined") {
            window.localStorage.setItem(
              ACTIVE_USER_KEY,
              JSON.stringify({
                id: normalizedProfile.id,
                name: normalizedProfile.username || normalizedProfile.name || "User",
                email: normalizedProfile.email,
                plan: normalizedProfile.plan || "free",
                username: normalizedProfile.username,
              })
            );
            window.dispatchEvent(new CustomEvent("ws-active-user-changed"));
          }
        }

        if (reportsRes.ok) {
          const reportsData = await reportsRes.json();
          const reports: UserReportLite[] = reportsData?.reports ?? reportsData ?? [];
          const ownReports = Array.isArray(reports)
            ? reports.filter((r) => String(r?.user_id || "") === String(userId))
            : [];
          setUserPostsCount(ownReports.length);
          setUserLikesCount(
            ownReports.reduce(
              (sum, report) => sum + (Number.isFinite(Number(report?.likes)) ? Number(report.likes) : 0),
              0
            )
          );
        }
      } catch (err) {
        console.error(err);
      } finally {
        setUserStatsLoading(false);
      }
    }

    if (role === "user" && currentUser?.id) {
      loadUserDashboard(currentUser.id);
    }
  }, [role, currentUser?.id]);

  function startEditingProfile() {
    if (!currentUser) return;
    setProfileUsername(currentUser.username || currentUser.name || "user");
    setProfileEmail(currentUser.email || "@gmail.com");
    setEditingProfile(true);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser?.id) return;

    const cleanUsername = sanitizeUsernameInput(profileUsername);
    const cleanEmail = sanitizeGmailEmailInput(profileEmail);

    if (!cleanUsername || !cleanEmail) {
      setError("Username and email are required.");
      return;
    }

    try {
      setError(null);
      setProfileSaveLoading(true);
      const res = await fetch(`${API_BASE}/users/${currentUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cleanUsername,
          name: cleanUsername,
          email: cleanEmail,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || `HTTP ${res.status}`);
      }

      const updatedUser: AuthUser = {
        id: String(data?.id || currentUser.id),
        username: sanitizeUsernameInput(data?.username || cleanUsername) || cleanUsername,
        name: data?.name || cleanUsername,
        email: sanitizeGmailEmailInput(data?.email || cleanEmail),
        plan: normalizePlan(data?.plan || currentUser.plan),
      };

      persistActiveUser(updatedUser);
      setEditingProfile(false);
      setInfo(`Logged in as ${updatedUser.username}.`);
    } catch (err: any) {
      setError(err?.message || "Could not update your profile.");
    } finally {
      setProfileSaveLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleanUsername = sanitizeUsernameInput(username);
    const cleanPassword = sanitizePasswordInput(password);

    if (!cleanUsername || !cleanPassword) {
      setError("Username and password are required.");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cleanUsername,
          password: cleanPassword,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || `HTTP ${res.status}`);
      }

      const result = data as LoginResult;
      if (result.role === "admin") {
        persistAdminSession(result.token);
        setInfo("Admin login successful.");
      } else if (result.role === "user" && result.user?.id) {
        persistActiveUser(result.user);
        setInfo(`Logged in as ${result.user.username || result.user.name}.`);
      } else {
        throw new Error("Invalid login response.");
      }

      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err?.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleanUsername = sanitizeUsernameInput(username);
    const cleanEmail = sanitizeGmailEmailInput(email);
    const cleanPassword = sanitizePasswordInput(password);
    const cleanConfirm = sanitizePasswordInput(confirmPassword);
    const cleanPlanConfirmation = sanitizePlanConfirmationInput(planConfirmation).trim();
    const expectedPlanConfirmation =
      registrationPlan === "plus"
        ? "Plus"
        : registrationPlan === "ultra"
        ? "Ultra"
        : "";

    if (!cleanUsername || !cleanEmail || !cleanPassword) {
      setError("Username, email, and password are required.");
      return;
    }

    if (cleanPassword !== cleanConfirm) {
      setError("Passwords do not match.");
      return;
    }

    if (registrationPlan !== "free" && cleanPlanConfirmation !== expectedPlanConfirmation) {
      setError("Invalid plan access key.");
      return;
    }

    try {
      setLoading(true);

      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cleanUsername,
          email: cleanEmail,
          password: cleanPassword,
          plan: registrationPlan,
          plan_confirmation: cleanPlanConfirmation || undefined,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || `HTTP ${res.status}`);
      }

      const result = data as LoginResult;
      if (!result.user?.id) {
        throw new Error("Invalid registration response.");
      }

      persistActiveUser(result.user);
      setInfo(`Account created. Logged in as ${result.user.username}.`);

      setPassword("");
      setConfirmPassword("");
      setEmail("@gmail.com");
      setPlanConfirmation("");
    } catch (err: any) {
      setError(err?.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminDelete(user: AdminUser) {
    if (!adminToken) {
      setError("Missing admin session.");
      return;
    }

    if (sanitizeUsernameInput(deleteHandshake) !== user.username) {
      setError("Type the exact username to confirm deletion.");
      return;
    }

    try {
      setError(null);
      const res = await fetch(`${API_BASE}/admin/users/${user.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          confirm_username: sanitizeUsernameInput(deleteHandshake),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || `HTTP ${res.status}`);
      }

      setInfo(`Deleted user ${user.username}.`);
      setConfirmingDeleteId(null);
      setDeleteHandshake("");
      await loadAdminUsers(adminToken);
    } catch (err: any) {
      setError(err?.message || "Could not delete user.");
    }
  }

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        <div className="ws-card p-6 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight mt-1">
                User Login
              </h1>
              <p className="mt-2 text-sm text-slate-600 max-w-xl leading-relaxed">
                Sign in with username and password. Passwords are hashed server-side and never returned by the API.
              </p>
            </div>

            {role !== "guest" && (
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                Log out
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {info}
            </div>
          )}
        </div>

        {role === "guest" && (
          <div className="grid gap-5 items-start">
            <div className="ws-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Lock className="w-4 h-4 text-sky-500" />
                <h2 className="text-sm font-semibold">Access account</h2>
              </div>

              <div className="ws-card-segmented mb-4 inline-flex rounded-full p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-full font-semibold transition ${
                    mode === "login"
                      ? "bg-sky-500 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError(null);
                  }}
                  className={`px-3 py-1.5 text-xs rounded-full font-semibold transition ${
                    mode === "register"
                      ? "bg-sky-500 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Register
                </button>
              </div>

              {mode === "login" ? (
                <form className="space-y-3 max-w-md" onSubmit={handleLogin}>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Username</label>
                    <input
                      value={username}
                      onChange={(e) => setUsername(sanitizeUsernameInput(e.target.value))}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      placeholder="username"
                      autoComplete="username"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(sanitizePasswordInput(e.target.value))}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      autoComplete="current-password"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="ws-button-primary inline-flex items-center gap-2 mt-1 disabled:opacity-70"
                  >
                    <User className="w-4 h-4" />
                    {loading ? "Signing in..." : "Sign in"}
                  </button>
                </form>
              ) : (
                <form className="space-y-3 max-w-md" onSubmit={handleRegister}>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Username</label>
                    <input
                      value={username}
                      onChange={(e) => setUsername(sanitizeUsernameInput(e.target.value))}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      placeholder="new username"
                      autoComplete="username"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(sanitizeGmailEmailInput(e.target.value))}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      autoComplete="email"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(sanitizePasswordInput(e.target.value))}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      autoComplete="new-password"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Confirm password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(sanitizePasswordInput(e.target.value))}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      autoComplete="new-password"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Plan</label>
                    <select
                      value={registrationPlan}
                      onChange={(e) => {
                        setRegistrationPlan(e.target.value as Plan);
                        setPlanConfirmation("");
                      }}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    >
                      <option value="free">Free</option>
                      <option value="plus">Plus</option>
                      <option value="ultra">Ultra</option>
                    </select>
                  </div>

                  {registrationPlan !== "free" && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">
                        Plan access key
                      </label>
                      <input
                        value={planConfirmation}
                        onChange={(e) =>
                          setPlanConfirmation(sanitizePlanConfirmationInput(e.target.value))
                        }
                        className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                        placeholder="Enter access key"
                        required
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="ws-button-primary inline-flex items-center gap-2 mt-1 disabled:opacity-70"
                  >
                    <UserPlus className="w-4 h-4" />
                    {loading ? "Creating..." : "Create account"}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {role === "user" && (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-start">
            <div className="ws-card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Account</p>
                  <h2 className="text-xl font-semibold mt-1">
                    Logged in as{" "}
                    <span className="text-sky-700">
                      {currentUser?.username || currentUser?.name || "user"}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-2">
                    Plan:{" "}
                    <span className="uppercase font-semibold text-slate-700">
                      {currentUser?.plan || "free"}
                    </span>
                  </p>
                </div>

                {!editingProfile && (
                  <button
                    type="button"
                    onClick={startEditingProfile}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit profile
                  </button>
                )}
              </div>

              {!editingProfile && (
                <div className="ws-card-panel rounded-xl px-4 py-3 text-sm text-slate-700">
                  <p>
                    Username:{" "}
                    <span className="font-semibold">{currentUser?.username || "-"}</span>
                  </p>
                  <p className="mt-1">
                    Email:{" "}
                    <span className="font-medium">{currentUser?.email || "@gmail.com"}</span>
                  </p>
                </div>
              )}

              {editingProfile && (
                <form onSubmit={handleSaveProfile} className="space-y-3 max-w-md">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Username</label>
                    <input
                      value={profileUsername}
                      onChange={(e) => setProfileUsername(sanitizeUsernameInput(e.target.value))}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Email</label>
                    <input
                      type="email"
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(sanitizeGmailEmailInput(e.target.value))}
                      className="ws-card-control w-full rounded-lg px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      required
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={profileSaveLoading}
                      className="ws-button-primary inline-flex items-center gap-2 disabled:opacity-70"
                    >
                      {profileSaveLoading ? "Saving..." : "Save changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingProfile(false)}
                      className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="space-y-5">
              <div className="ws-card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="w-4 h-4 text-sky-600" />
                  <h3 className="text-sm font-semibold">Your activity</h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="ws-card-panel-soft rounded-xl px-3 py-3">
                    <p className="text-[11px] text-slate-500">Posts made</p>
                    <p className="text-lg font-semibold text-slate-800 mt-1">
                      {userStatsLoading ? "..." : userPostsCount}
                    </p>
                  </div>
                  <div className="ws-card-panel-soft rounded-xl px-3 py-3">
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5 text-rose-500" />
                      Likes accumulated
                    </p>
                    <p className="text-lg font-semibold text-slate-800 mt-1">
                      {userStatsLoading ? "..." : userLikesCount}
                    </p>
                  </div>
                </div>
              </div>

              <div className="ws-card p-5 space-y-3">
                <h3 className="text-sm font-semibold">Quick actions</h3>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/posts"
                    className="ws-card-pill rounded-full px-3 py-1.5 text-xs font-medium text-slate-700 transition"
                  >
                    Go to Posts
                  </Link>
                  <Link
                    to="/sensors"
                    className="ws-card-pill rounded-full px-3 py-1.5 text-xs font-medium text-slate-700 transition"
                  >
                    Browse Stations
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {role === "admin" && (
          <div className="ws-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-semibold">Admin user management</h2>
              </div>
              <button
                type="button"
                onClick={() => adminToken && loadAdminUsers(adminToken)}
                className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-700 hover:bg-slate-100 transition"
              >
                Refresh
              </button>
            </div>

            <p className="text-[11px] text-slate-500">
              {adminLoading
                ? "Loading users..."
                : `${adminUsers.length} user${adminUsers.length === 1 ? "" : "s"}`}
            </p>

            {!adminLoading && adminUsers.length === 0 && (
              <p className="text-xs text-slate-500">No users found.</p>
            )}

            {!adminLoading && adminUsers.length > 0 && (
              <ul className="divide-y divide-[var(--ws-border-subtle)]">
                {adminUsers.map((u) => {
                  const isConfirming = confirmingDeleteId === u.id;
                  const handshakeOk = sanitizeUsernameInput(deleteHandshake) === u.username;

                  return (
                    <li key={u.id} className="py-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{u.username}</p>
                          <p className="text-xs text-slate-500">{u.email}</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setConfirmingDeleteId(u.id);
                            setDeleteHandshake("");
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 transition text-xs"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      </div>

                      {isConfirming && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
                          <p className="text-xs text-amber-800">
                            Type <span className="font-semibold">{u.username}</span> to confirm delete.
                          </p>
                          <input
                            value={deleteHandshake}
                            onChange={(e) => setDeleteHandshake(sanitizeUsernameInput(e.target.value))}
                            className="w-full max-w-sm rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                            placeholder="type username"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!handshakeOk}
                              onClick={() => handleAdminDelete(u)}
                              className="px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-semibold disabled:opacity-50"
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmingDeleteId(null);
                                setDeleteHandshake("");
                              }}
                              className="px-3 py-1.5 rounded-full border border-slate-300 bg-white text-xs text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
