// app/routes/products.tsx
import { useState } from "react";
import type { Route } from "./+types/products";

type Tab = "sensors" | "subscriptions";

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

  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="ws-card p-6 flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Products
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight">
            Choose your Water Status setup.
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-xl leading-relaxed">
            Combine{" "}
            <span className="font-medium">IoT sensor hardware</span> with the{" "}
            <span className="font-medium">right subscription plan</span> to
            monitor water levels and alerts in real time.
          </p>

          {/* Tabs */}
          <div className="mt-4 inline-flex rounded-full border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("sensors")}
              className={[
                "px-3 py-1.5 rounded-full transition",
                activeTab === "sensors"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              IoT sensors
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("subscriptions")}
              className={[
                "px-3 py-1.5 rounded-full transition",
                activeTab === "subscriptions"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100",
              ].join(" ")}
            >
              Subscription plans
            </button>
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "sensors" && <SensorsTab />}
        {activeTab === "subscriptions" && <SubscriptionsTab />}
      </section>
    </main>
  );
}

function SensorsTab() {
  return (
    <div className="ws-card p-6 space-y-4">
      <h2 className="text-sm font-semibold">IoT sensor bundles</h2>
      <p className="text-xs text-slate-600 max-w-xl">
        Pick the hardware kit that matches your site: small rivers, urban
        drains, or larger catchments.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Example cards – customise with your real products */}
        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <p className="text-sm font-semibold">Starter Kit</p>
          <p className="text-[11px] text-slate-600">
            1x level sensor + 1x gateway. Ideal for testing in a single
            location.
          </p>
          <p className="text-sm font-semibold mt-1">RM XXX</p>
          <button className="mt-2 ws-button-primary text-xs">
            View details
          </button>
        </div>

        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <p className="text-sm font-semibold">Neighbour Bundle</p>
          <p className="text-[11px] text-slate-600">
            3x sensors to monitor upstream, midstream, and downstream.
          </p>
          <p className="text-sm font-semibold mt-1">RM XXX</p>
          <button className="mt-2 ws-button-primary text-xs">
            View details
          </button>
        </div>

        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <p className="text-sm font-semibold">Community Pack</p>
          <p className="text-[11px] text-slate-600">
            For NGOs / local councils monitoring multiple hotspots.
          </p>
          <p className="text-sm font-semibold mt-1">RM XXX</p>
          <button className="mt-2 ws-button-primary text-xs">
            View details
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

      <div className="grid gap-4 sm:grid-cols-3">
        {/* You can copy the content from your current /subscriptions page here */}
        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <p className="text-sm font-semibold">Free</p>
          <p className="text-[11px] text-slate-600">
            1 device, basic dashboard, limited history.
          </p>
          <p className="text-sm font-semibold mt-1">RM 0 / month</p>
          <button className="mt-2 ws-button-primary text-xs">
            Get started
          </button>
        </div>

        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <p className="text-sm font-semibold">Plus</p>
          <p className="text-[11px] text-slate-600">
            Up to 5 devices, SMS alerts, 6-month history.
          </p>
          <p className="text-sm font-semibold mt-1">RM XX / month</p>
          <button className="mt-2 ws-button-primary text-xs">
            Choose Plus
          </button>
        </div>

        <div className="rounded-xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] p-4 text-xs flex flex-col gap-2">
          <p className="text-sm font-semibold">Ultra</p>
          <p className="text-[11px] text-slate-600">
            Unlimited devices, priority support, full history export.
          </p>
          <p className="text-sm font-semibold mt-1">RM XXX / month</p>
          <button className="mt-2 ws-button-primary text-xs">
            Talk to us
          </button>
        </div>
      </div>
    </div>
  );
}