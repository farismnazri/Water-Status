// app/routes/products.tsx
import { useState, useEffect } from "react";
import type { Route } from "./+types/products";

type Tab = "sensors" | "subscriptions";

type CartItem = {
  id: string;
  name: string;
  price: string;
  quantity?: number;
};

// // 🔹 Helper: read wsActiveUser and return its id (or null)
// function getActiveUserId(): string | null {
//   if (typeof window === "undefined") return null;
//   try {
//     const raw = window.localStorage.getItem("wsActiveUser");
//     if (!raw) return null;
//     const parsed = JSON.parse(raw);
//     return parsed?.id ?? null;
//   } catch {
//     return null;
//   }
// }

// 🔹 Helper: build the cart key for that user
function getCartKeyForUser(userId: string | null) {
  return userId ? `wsCart:${userId}` : "wsCart:guest";
}

// 🔹 Save cart for a specific user
function saveCart(nextItems: CartItem[], currentUserId?: string | null) {
  if (typeof window === "undefined") return;

  const key = currentUserId ? `wsCart:${currentUserId}` : "wsCart:guest";
  window.localStorage.setItem(key, JSON.stringify(nextItems));

  // notify header
  window.dispatchEvent(new Event("ws-cart-updated"));
}


export function meta({}: Route.MetaArgs) {
  return [
    { title: "Products · Water Status" },
    {
      name: "description",
      content:
        "Browse Water Status IoT sensors and subscription plans for real-time water monitoring.",
    },
  ];
}

export default function ProductsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("sensors");

  // track current user id for per-user cart
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // load active user id from localStorage (same as header)
  useEffect(() => {
    if (typeof window === "undefined") return;

    function refreshActiveUser() {
      try {
        const raw = window.localStorage.getItem("wsActiveUser");
        if (!raw) {
          setCurrentUserId(null);
          return;
        }
        const saved = JSON.parse(raw);
        setCurrentUserId(saved?.id ?? null);
      } catch {
        setCurrentUserId(null);
      }
    }

    // first load
    refreshActiveUser();

    // listen to the same custom event used in root.tsx
    const handler = () => refreshActiveUser();
    window.addEventListener("ws-active-user-changed", handler);

    const storageHandler = (e: StorageEvent) => {
      if (e.key === "wsActiveUser") refreshActiveUser();
    };
    window.addEventListener("storage", storageHandler);

    return () => {
      window.removeEventListener("ws-active-user-changed", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

// 🛒 per-user cart writer – uses currentUserId
function handleAddToCart(item: CartItem) {
  if (typeof window === "undefined") return;

  try {
    const key = getCartKeyForUser(currentUserId);
    const raw = window.localStorage.getItem(key);
    const current: CartItem[] = raw ? JSON.parse(raw) : [];

    const existingIndex = current.findIndex((it) => it.id === item.id);

    let next: CartItem[];
    if (existingIndex >= 0) {
      next = [...current];
      const existing = next[existingIndex];
      next[existingIndex] = {
        ...existing,
        quantity: (existing.quantity ?? 1) + 1,
      };
    } else {
      next = [...current, { ...item, quantity: 1 }];
    }

    // now matches the new saveCart signature
    saveCart(next, currentUserId);
  } catch (e) {
    console.warn("Could not update cart", e);
  }
}

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Header (floating, no card) */}
        <div className="flex flex-col gap-2">
          {/* <p className="text-xs uppercase tracking-wide text-slate-500">
            Products
          </p> */}
          <h1 className="text-2xl sm:text-5xl font-bold leading-tight tracking-tight">
            Choose your Water Status setup.
          </h1>
          <p className="mt-1 text-sm:text-3xl text-slate-600 max-w-xl leading-relaxed">
            Combine IoT sensor hardware with thte right subscription plan to monitor water levels and alerts in real time.
          </p>
        </div>

        {/* Tabs as a 2-column segmented control, sitting above the content card */}
        <div className="mt-3 grid grid-cols-2 rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] text-xs overflow-hidden">
          <button
            type="button"
            onClick={() => setActiveTab("sensors")}
            className={[
              "py-2.5 text-center font-medium transition",
              activeTab === "sensors"
                ? "bg-sky-600 text-white shadow-inner"
                : "text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            IoT sensors
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("subscriptions")}
            className={[
              "py-2.5 text-center font-medium transition",
              activeTab === "subscriptions"
                ? "bg-sky-600 text-white shadow-inner"
                : "text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            Subscription plans
          </button>
        </div>

        {/* Tab content */}
        {activeTab === "sensors" && (
          <SensorsTab onAddToCart={handleAddToCart} />
        )}
        {activeTab === "subscriptions" && <SubscriptionsTab />}
      </section>
    </main>
  );
}



function SensorsTab({ onAddToCart }: { onAddToCart: (item: CartItem) => void }) {
  return (
    <div className="ws-card p-6 space-y-4">
      <h2 className="text-sm font-semibold">IoT sensor bundles</h2>
      <p className="text-xs text-slate-600 max-w-xl">
        Pick the hardware kit that matches your site: small rivers, urban
        drains, or larger catchments.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Starter Kit */}
        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <img
            src="/images/basic.png"
            alt="Water Status starter kit"
            className="mb-3 h-full w-full object-contain"
          />
          <p className="text-sm font-semibold">Starter Kit</p>
          <p className="text-[11px] text-slate-600">
            1x level sensor + 1x gateway. Ideal for testing in a single
            location.
          </p>
          <p className="text-sm font-semibold mt-1">RM 9.99</p>
          <button
            className="mt-2 ws-button-primary text-xs"
            onClick={() =>
              onAddToCart({
                id: "starter-kit",
                name: "Starter Kit",
                price: "RM 9.99",
              })
            }
          >
            Add to cart
          </button>
        </div>

        {/* Neighbour Bundle */}
        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <img
            src="/images/bundle.png"
            alt="Water Status neighbour bundle"
            className="mb-3 h-full w-full object-contain"
          />
          <p className="text-sm font-semibold">Neighbour Bundle</p>
          <p className="text-[11px] text-slate-600">
            3x sensors to monitor upstream, midstream, and downstream.
          </p>
          <p className="text-sm font-semibold mt-1">RM 19.99</p>
          <button
            className="mt-2 ws-button-primary text-xs"
            onClick={() =>
              onAddToCart({
                id: "neighbour-bundle",
                name: "Neighbour Bundle",
                price: "RM 19.99",
              })
            }
          >
            Add to cart
          </button>
        </div>

        {/* Community Pack */}
        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <img
            src="/images/superbundle.png"
            alt="Water Status community pack"
            className="mb-3 h-full w-full object-contain"
          />
          <p className="text-sm font-semibold">Community Pack</p>
          <p className="text-[11px] text-slate-600">
            For NGOs / local councils monitoring multiple hotspots.
          </p>
          <p className="text-sm font-semibold mt-1">RM 24.99</p>
          <button
            className="mt-2 ws-button-primary text-xs"
            onClick={() =>
              onAddToCart({
                id: "community-pack",
                name: "Community Pack",
                price: "RM 24.99",
              })
            }
          >
            Add to cart
          </button>
        </div>
      </div>
    </div>
  );
}

function SubscriptionsTab() {
  return (
    <div className="ws-card p-6 space-y-4">
      <h2 className="text-sm font-semibold">Subscription plans</h2>
      <p className="text-xs text-slate-600 max-w-xl">
        Pick a plan to unlock dashboards, alerts, and data history for your
        devices.
      </p>

      <div className="grid gap-4 sm:grid-cols-3 items-start">
        {/* Free */}
        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <p className="text-sm font-semibold">Free</p>
          <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
            <li>1 device</li>
            {/* <li>Basic dashboard</li> */}
            <li>Limited history</li>
          </ul>
          <p className="text-sm font-semibold mt-1">RM 0 / month</p>
          <button className="mt-2 ws-button-primary text-xs">
            Get started
          </button>
        </div>

        {/* Plus */}
        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <p className="text-sm font-semibold">Plus</p>
          <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
            <li>Up to 5 devices</li>
            <li>SMS alerts</li>
            <li>6-month history</li>
          </ul>
          <p className="text-sm font-semibold mt-1">RM 9.99 / month</p>
          <button className="mt-2 ws-button-primary text-xs">
            Choose Plus
          </button>
        </div>

        {/* Ultra with glow */}
        <div className="rounded-xl border border-emerald-400 bg-emerald-600/95 p-4 text-xs flex flex-col gap-2 text-emerald-50 shadow-lg shadow-emerald-500/60 ring-2 ring-emerald-300/70">
          <p className="text-sm font-semibold">Ultra</p>
          <img
            src="/images/satellite-iot-energy-agriculture.jpg"
            alt="Water Status community pack"
            className="mb-3 h-24 w-full object-cover rounded-lg border-4 border-white/80 bg-white"
          />
          <ul className="text-[11px] text-emerald-100 list-disc pl-4 space-y-0.5">
            <li>Unlimited devices</li>
            <li>Priority support</li>
            <li>Full history export</li>
          </ul>
          <p className="text-sm font-semibold mt-1">RM 19.99 / month</p>
          <button
            className="mt-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 transition"
          >
            Talk to us for a more tailored plan
          </button>
        </div>
      </div>
    </div>
  );
}