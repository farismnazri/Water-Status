// app/routes/products.tsx
import { Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/products";

type Tab = "sensors" | "subscriptions";

type CartItem = {
  id: string;
  name: string;
  price: string;
  image?: string;
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
      <section className="max-w-5xl mx-auto px-4 py-6 space-y-4 sm:py-8">
        {/* Header (floating, no card) */}
        <div className="flex flex-col gap-2.5">
          {/* <p className="text-xs uppercase tracking-wide text-slate-500">
            Products
          </p> */}
          <h1 className="text-2xl sm:text-5xl font-bold leading-tight tracking-tight">
            Choose your Water Status setup.
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-relaxed">
            Combine IoT sensor hardware with the future support tools we&apos;re
            building to monitor water levels and alerts in real time.
          </p>
        </div>

        {/* Tabs as a 2-column segmented control, sitting above the content card */}
        <div className="ws-card-segmented mt-3 grid grid-cols-2 overflow-hidden rounded-xl text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("sensors")}
            className={[
              "py-2.5 text-center font-medium transition-colors",
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
              "py-2.5 text-center font-medium transition-colors",
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
    <div className="ws-card p-5 space-y-4 sm:p-6">
      <h2 className="text-sm font-semibold">IoT sensor bundles</h2>
      <p className="text-xs text-slate-600 max-w-xl">
        Pick the hardware kit that matches your site: small rivers, urban
        drains, or larger catchments.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Starter Kit */}
        <div className="ws-card-panel rounded-[1.4rem] p-4 text-xs flex flex-col gap-2 transition-transform duration-200 hover:-translate-y-1">
          <img
            src="/images/basic.png"
            alt="Water Status starter kit"
            width={1024}
            height={1536}
            decoding="async"
            className="ws-card-panel-soft mb-3 aspect-[4/3] w-full rounded-xl object-contain p-3"
          />
          <p className="text-sm font-semibold">Starter Kit</p>
          <p className="text-[11px] text-slate-600">
            1x level sensor + 1x gateway. Ideal for testing in a single
            location.
          </p>
          <p className="text-sm font-semibold mt-1">RM 9.99</p>
          <button
            className="mt-2 inline-flex w-full items-center justify-center ws-button-primary text-xs"
            onClick={() =>
              onAddToCart({
                id: "starter-kit",
                name: "Starter Kit",
                price: "RM 9.99",
                image: "/images/basic.png",
              })
            }
          >
            Add to cart
          </button>
        </div>

        {/* Neighbour Bundle */}
        <div className="ws-card-panel rounded-[1.4rem] p-4 text-xs flex flex-col gap-2 transition-transform duration-200 hover:-translate-y-1">
          <img
            src="/images/bundle.png"
            alt="Water Status neighbour bundle"
            width={1457}
            height={1457}
            decoding="async"
            className="ws-card-panel-soft mb-3 aspect-[4/3] w-full rounded-xl object-contain p-3"
          />
          <p className="text-sm font-semibold">Neighbour Bundle</p>
          <p className="text-[11px] text-slate-600">
            3x sensors to monitor upstream, midstream, and downstream.
          </p>
          <p className="text-sm font-semibold mt-1">RM 19.99</p>
          <button
            className="mt-2 inline-flex w-full items-center justify-center ws-button-primary text-xs"
            onClick={() =>
              onAddToCart({
                id: "neighbour-bundle",
                name: "Neighbour Bundle",
                price: "RM 19.99",
                image: "/images/bundle.png",
              })
            }
          >
            Add to cart
          </button>
        </div>

        {/* Community Pack */}
        <div className="ws-card-panel rounded-[1.4rem] p-4 text-xs flex flex-col gap-2 transition-transform duration-200 hover:-translate-y-1">
          <img
            src="/images/superbundle.png"
            alt="Water Status community pack"
            width={1457}
            height={1457}
            decoding="async"
            className="ws-card-panel-soft mb-3 aspect-[4/3] w-full rounded-xl object-contain p-3"
          />
          <p className="text-sm font-semibold">Community Pack</p>
          <p className="text-[11px] text-slate-600">
            For NGOs / local councils monitoring multiple hotspots.
          </p>
          <p className="text-sm font-semibold mt-1">RM 24.99</p>
          <button
            className="mt-2 inline-flex w-full items-center justify-center ws-button-primary text-xs"
            onClick={() =>
              onAddToCart({
                id: "community-pack",
                name: "Community Pack",
                price: "RM 24.99",
                image: "/images/superbundle.png",
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
    <div className="ws-card p-5 space-y-4 sm:p-6">
      <h2 className="text-sm font-semibold">Subscription plans</h2>

      <div className="ws-card-panel rounded-xl p-4 sm:p-5 space-y-3">
        <p className="text-sm font-semibold text-slate-800">
          This could all be yours if we build it together.
        </p>
        <p className="text-xs text-slate-700 max-w-3xl leading-relaxed">
          These features are part of the future we imagine for Water Status.
          Support the mission and help us bring them to life.
        </p>
        <Link to="/about" className="inline-flex w-full items-center justify-center ws-button-primary text-xs sm:w-auto">
          Help us build this
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 items-start">
        {/* Free */}
        <div className="ws-card-panel rounded-xl p-4 text-xs flex flex-col gap-2">
          <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            Future dream
          </span>
          <p className="text-sm font-semibold">Free</p>
          <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
            <li>1 device</li>
            {/* <li>Basic dashboard</li> */}
            <li>Limited history</li>
          </ul>
          <p className="text-sm font-semibold mt-1">RM 0 / month</p>
          <p className="mt-2 text-[11px] font-medium text-slate-500">
            Planned to keep essential access open to more communities.
          </p>
        </div>

        {/* Plus */}
        <div className="ws-card-panel rounded-xl p-4 text-xs flex flex-col gap-2">
          <span className="inline-flex w-fit rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
            Build-it-together
          </span>
          <p className="text-sm font-semibold">Plus</p>
          <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
            <li>Up to 5 devices</li>
            <li>SMS alerts</li>
            <li>6-month history</li>
          </ul>
          <p className="text-sm font-semibold mt-1">RM 9.99 / month</p>
          <p className="mt-2 text-[11px] font-medium text-slate-500">
            A shared-alert toolkit we can build with local support.
          </p>
        </div>

        {/* Ultra with glow */}
        <div className="ws-card-panel rounded-xl border-emerald-200/90 p-4 text-xs flex flex-col gap-2 shadow-[0_16px_32px_rgba(16,185,129,0.08)]">
          <span className="inline-flex w-fit rounded-full border border-emerald-200/80 bg-emerald-50/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            Next chapter
          </span>
          <p className="text-sm font-semibold text-slate-900">Ultra</p>
          <img
            src="/images/satellite-iot-energy-agriculture.jpg"
            alt="Water Status community pack"
            width={1200}
            height={675}
            loading="lazy"
            decoding="async"
            className="ws-card-panel-soft mb-3 h-24 w-full rounded-lg object-cover"
          />
          <ul className="text-[11px] text-slate-600 list-disc pl-4 space-y-0.5">
            <li>Unlimited devices</li>
            <li>Priority support</li>
            <li>Full history export</li>
          </ul>
          <p className="text-sm font-semibold mt-1 text-slate-900">RM 19.99 / month</p>
          <p className="mt-2 text-[11px] font-medium text-slate-500">
            A partner-ready next chapter for wider flood resilience work.
          </p>
        </div>
      </div>
    </div>
  );
}
