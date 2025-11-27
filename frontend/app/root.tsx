import {
  isRouteErrorResponse,
  Links,
  Link,
  NavLink,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { ShoppingCart } from "lucide-react";

import { useEffect, useState } from "react";

import type { Route } from "./+types/root";
import "./app.css";

// --- Cart helpers (client-side only) ---
const ACTIVE_USER_KEY = "wsActiveUser";

// same pattern as in cart.tsx / products.tsx
function getCartKeyForUser(userId: string | null) {
  return userId ? `wsCart:${userId}` : "wsCart:guest";
}

function getCartCountForActiveUser(): number {
  if (typeof window === "undefined") return 0;

  try {
    // 1) get active user
    const rawUser = window.localStorage.getItem(ACTIVE_USER_KEY);
    if (!rawUser) return 0;
    const active = JSON.parse(rawUser);
    const userId: string | null = active?.id ?? null;

    // 2) read that user's cart
    const key = getCartKeyForUser(userId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return 0;

    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return 0;

    // 3) sum quantities
    return arr.reduce(
      (sum: number, item: any) => sum + (item.quantity ?? 1),
      0
    );
  } catch {
    return 0;
  }
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const navItems = [
    { to: "/", label: "Home" },
    { to: "/about", label: "About us" },
    { to: "/sensors", label: "Stations" },
    { to: "/products", label: "Products" },
    { to: "/posts", label: "Posts" },
    { to: "/users", label: "Users" },
    ];

    const [cartCount, setCartCount] = useState(0);

const [activeUser, setActiveUser] = useState<{
  id: string | null;
  name: string;
  plan: string | null;
}>(() => {
  if (typeof window === "undefined") {
    return { id: null, name: "Guest", plan: null };
  }
  try {
    const raw = window.localStorage.getItem("wsActiveUser");
    if (!raw) return { id: null, name: "Guest", plan: null };
    const saved = JSON.parse(raw);
    return {
      id: saved?.id ?? null,
      name: saved?.name || "Guest",
      plan: saved?.plan ?? null,
    };
  } catch {
    return { id: null, name: "Guest", plan: null };
  }
});

  // listen for the custom event from UsersPage (active user)
useEffect(() => {
  function refreshFromStorage() {
    try {
      const raw = window.localStorage.getItem("wsActiveUser");
      if (!raw) {
        setActiveUser({ id: null, name: "Guest", plan: null });
        return;
      }
      const saved = JSON.parse(raw);
      setActiveUser({
        id: saved?.id ?? null,
        name: saved?.name || "Guest",
        plan: saved?.plan ?? null,
      });
    } catch {
      setActiveUser({ id: null, name: "Guest", plan: null });
    }
  }

  if (typeof window === "undefined") return;

  // first load
  refreshFromStorage();

  const handler = () => refreshFromStorage();
  window.addEventListener("ws-active-user-changed", handler);

  const storageHandler = (e: StorageEvent) => {
    if (e.key === "wsActiveUser") refreshFromStorage();
  };
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener("ws-active-user-changed", handler);
    window.removeEventListener("storage", storageHandler);
  };
}, []);

// 🛒 Keep cartCount in sync with per-user cart + active user
useEffect(() => {
  if (typeof window === "undefined") return;

  function refreshCart() {
    setCartCount(getCartCountForActiveUser());
  }

  // initial load
  refreshCart();

  // when cart content changes (CartPage / Products call window.dispatchEvent("ws-cart-updated"))
  const cartHandler = () => refreshCart();
  window.addEventListener("ws-cart-updated", cartHandler);

  // when ACTIVE USER changes (Users page fires ws-active-user-changed)
  const activeHandler = () => refreshCart();
  window.addEventListener("ws-active-user-changed", activeHandler);

const storageHandler = (e: StorageEvent) => {
  if (!e.key) return;
  if (
    e.key === ACTIVE_USER_KEY ||
    e.key === "wsCart:guest" ||
    e.key.startsWith("wsCart:")
  ) {
    refreshCart();
  }
};
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener("ws-cart-updated", cartHandler);
    window.removeEventListener("ws-active-user-changed", activeHandler);
    window.removeEventListener("storage", storageHandler);
  };
}, []);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-gradient-to-b from-[#6FA8DC] via-[#C7DEF3] to-[#FFFFFF] text-[var(--ws-text-main)]">
      {/* <body className="min-h-screen bg-gradient-to-b from-[#FFFBE3] via-[#FFF0B8] to-[#FFE08A] text-[var(--ws-text-main)]"> */}
        {/* Top nav */}
                <header className="border-b border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 backdrop-blur">
          <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
            {/* Left: logo */}
            <Link to="/" className="flex items-center gap-2">
              <span className="ws-logo-circle inline-flex h-7 w-7 items-center justify-center text-sm font-bold">
                W
              </span>
              <span className="text-sm font-semibold tracking-tight">
                Water Status
              </span>
            </Link>

            {/* Right: nav + cart + active user */}
            <div className="flex items-center gap-4">
              <nav className="flex gap-1 text-xs sm:text-sm">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      [
                        "px-3 py-1.5 rounded-full transition",
                        "text-[var(--ws-text-muted)] hover:text-[var(--ws-text-main)] hover:bg-[var(--ws-accent-alt)]/70",
                        isActive
                          ? "bg-[var(--ws-accent)] text-slate-950 border border-[var(--ws-accent-soft)] shadow-sm"
                          : "",
                      ].join(" ")
                    }
                    end={item.to === "/"}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>

              {/* Cart icon */}
<Link
  to="/cart"
  aria-label="View cart"
  className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] hover:bg-[var(--ws-accent-alt)]/70 transition"
>
  <ShoppingCart className="h-4 w-4 text-slate-700" />
  {cartCount > 0 && (
    <span className="absolute -top-1 -right-1 min-w-[1.1rem] px-1 rounded-full bg-emerald-500 text-[10px] font-semibold text-white text-center">
      {cartCount}
    </span>
  )}
</Link>

              {/* Active user pill */}
              <div className="flex flex-col items-end text-[11px] leading-tight">
                <span className="font-semibold text-slate-800">
                  {activeUser.name || "Guest"}
                </span>
                <span className="uppercase tracking-wide text-[10px] text-slate-500">
                  {activeUser.plan ? `${activeUser.plan} plan` : "Guest"}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="pt-1">
          {children}
        </div>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
