import {
  isRouteErrorResponse,
  Links,
  Link,
  NavLink,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";

import { ShoppingCart } from "lucide-react";

import { useEffect, useRef, useState } from "react";

import type { Route } from "./+types/root";
import "./app.css";
import { IosInstallHint } from "./components/IosInstallHint";
import { HomeHydrationSkeleton } from "./components/HomeHydrationSkeleton";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { MobileNavDrawer } from "./components/MobileNavDrawer";
import { useMediaQuery } from "./lib/useMediaQuery";

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
  { rel: "icon", href: "/favicon.ico" },
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
  { rel: "manifest", href: "/site.webmanifest" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

function CartButton({ cartCount }: { cartCount: number }) {
  return (
    <Link
      to="/cart"
      aria-label="View cart"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] transition hover:bg-[var(--ws-accent-alt)]/70"
    >
      <ShoppingCart className="h-4 w-4 text-slate-700" />
      {cartCount > 0 && (
        <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-emerald-500 px-1 text-center text-[10px] font-semibold text-white">
          {cartCount}
        </span>
      )}
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const desktopNavItems = [
    { to: "/", label: "Home" },
    { to: "/about", label: "About us" },
    { to: "/sensors", label: "Stations" },
    { to: "/products", label: "Products" },
    { to: "/posts", label: "Posts" },
    { to: "/users", label: "Users" },
  ];
  const mobileMenuItems = [
    { to: "/posts", label: "Posts" },
    { to: "/products", label: "Products" },
    { to: "/cart", label: "Cart" },
    { to: "/users", label: "Users" },
    { to: "/about", label: "About" },
  ];
  const location = useLocation();
  const [cartCount, setCartCount] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const hasDesktopNav = useMediaQuery("(min-width: 1024px)");
  const lastScrollYRef = useRef(0);
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
  const isMenuActive =
    mobileNavOpen ||
    (location.pathname !== "/" && !location.pathname.startsWith("/sensors"));

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

    refreshFromStorage();

    const handler = () => refreshFromStorage();
    window.addEventListener("ws-active-user-changed", handler);

    const storageHandler = (event: StorageEvent) => {
      if (event.key === "wsActiveUser") refreshFromStorage();
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

    refreshCart();

    const cartHandler = () => refreshCart();
    window.addEventListener("ws-cart-updated", cartHandler);

    const activeHandler = () => refreshCart();
    window.addEventListener("ws-active-user-changed", activeHandler);

    const storageHandler = (event: StorageEvent) => {
      if (!event.key) return;
      if (
        event.key === ACTIVE_USER_KEY ||
        event.key === "wsCart:guest" ||
        event.key.startsWith("wsCart:")
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

  useEffect(() => {
    if (hasDesktopNav) {
      setMobileNavOpen(false);
    }
  }, [hasDesktopNav]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (hasDesktopNav || mobileNavOpen) {
      setMobileHeaderHidden(false);
      lastScrollYRef.current = window.scrollY;
      return;
    }

    let frameId = 0;

    const updateHeaderVisibility = () => {
      const nextScrollY = window.scrollY;
      const delta = nextScrollY - lastScrollYRef.current;

      if (nextScrollY <= 20) {
        setMobileHeaderHidden(false);
      } else if (delta > 10 && nextScrollY > 88) {
        setMobileHeaderHidden(true);
      } else if (delta < -8) {
        setMobileHeaderHidden(false);
      }

      lastScrollYRef.current = nextScrollY;
      frameId = 0;
    };

    lastScrollYRef.current = window.scrollY;

    const handleScroll = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(updateHeaderVisibility);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [hasDesktopNav, mobileNavOpen]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#eff6fd" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Water Status" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen text-[var(--ws-text-main)]">
        <div className="relative">
          {/* Top nav */}
          <header
            className="ws-mobile-header border-b border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 backdrop-blur"
            data-hidden={mobileHeaderHidden ? "true" : "false"}
          >
            <div className="ws-mobile-header-inner mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
              {/* Left: logo */}
              <Link to="/" className="flex min-w-0 items-center gap-2.5">
                <img
                  src="/WaterStatus_Icon.svg"
                  alt=""
                  width={44}
                  height={44}
                  className="h-10 w-10 shrink-0 rounded-[0.9rem] object-contain shadow-[0_8px_18px_rgba(89,170,247,0.18)]"
                />
                <span className="truncate text-[1.05rem] font-semibold tracking-tight text-slate-900">
                  Water Status
                </span>
              </Link>

              {/* Desktop nav */}
              <div className="hidden items-center gap-4 lg:flex">
                <nav className="flex gap-1 text-sm">
                  {desktopNavItems.map((item) => (
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

                <CartButton cartCount={cartCount} />

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

              {/* Mobile nav */}
              <div className="flex min-w-0 items-center gap-2 lg:hidden">
                <div className="flex flex-col items-end text-[9px] leading-[1.05]">
                  <span className="max-w-[8.5rem] truncate text-[0.92rem] font-semibold text-slate-800">
                    {activeUser.name || "Guest"}
                  </span>
                  <span className="uppercase tracking-[0.16em] text-slate-500">
                    {activeUser.plan ? `${activeUser.plan} plan` : "Mobile app"}
                  </span>
                </div>
              </div>
            </div>
          </header>

          {/* Page content */}
          <div className="ws-mobile-page-offset">
            <MobileNavDrawer
              activeUser={activeUser}
              cartCount={cartCount}
              navItems={mobileMenuItems}
              open={mobileNavOpen}
              setOpen={setMobileNavOpen}
              showTrigger={false}
            />
            <div>{children}</div>
          </div>
        </div>

        <IosInstallHint />
        <MobileBottomNav
          cartCount={cartCount}
          menuActive={isMenuActive}
          onOpenMenu={() => setMobileNavOpen(true)}
        />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function HydrateFallback() {
  return <HomeHydrationSkeleton />;
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
