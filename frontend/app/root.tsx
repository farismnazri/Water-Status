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
    { to: "/subscriptions", label: "Subscriptions" },
  ];

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
          <Link to="/" className="flex items-center gap-2">
            <span className="ws-logo-circle inline-flex h-7 w-7 items-center justify-center text-sm font-bold">
              W
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Water Status
            </span>
          </Link>

            <nav className="flex gap-1 text-xs sm:text-sm">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "px-3 py-1.5 rounded-full transition",
                      // default state
                      "text-[var(--ws-text-muted)] hover:text-[var(--ws-text-main)] hover:bg-[var(--ws-accent-alt)]/70",
                      // active tab
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
