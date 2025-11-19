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

import { useEffect, useState } from "react";

import type { Route } from "./+types/root";
import "./app.css";

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

  const [activeUser, setActiveUser] = useState<{
    name: string;
    plan: string | null;
  }>(() => {
    if (typeof window === "undefined") {
      return { name: "Guest", plan: null };
    }
    try {
      const raw = window.localStorage.getItem("wsActiveUser");
      if (!raw) return { name: "Guest", plan: null };
      const saved = JSON.parse(raw);
      return {
        name: saved?.name || "Guest",
        plan: saved?.plan ?? null,
      };
    } catch {
      return { name: "Guest", plan: null };
    }
  });

  // listen for the custom event from UsersPage
  useEffect(() => {
    function refreshFromStorage() {
      try {
        const raw = window.localStorage.getItem("wsActiveUser");
        if (!raw) {
          setActiveUser({ name: "Guest", plan: null });
          return;
        }
        const saved = JSON.parse(raw);
        setActiveUser({
          name: saved?.name || "Guest",
          plan: saved?.plan ?? null,
        });
      } catch {
        setActiveUser({ name: "Guest", plan: null });
      }
    }

    // our custom event
    window.addEventListener("ws-active-user-changed", refreshFromStorage);
    // also react if another tab changes it
    window.addEventListener("storage", (e) => {
      if (e.key === "wsActiveUser") refreshFromStorage();
    });

    return () => {
      window.removeEventListener("ws-active-user-changed", refreshFromStorage);
      window.removeEventListener("storage", refreshFromStorage as any);
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
      <body className="min-h-screen bg-[var(--ws-bg)] text-[var(--ws-text-main)]">
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

            {/* Right: nav + active user */}
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
