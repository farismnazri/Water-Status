import { Link } from "react-router";
import {
  Droplets,
  Waves,
  CloudRain,
  ThermometerSun,
  ArrowRight,
} from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen">
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        {/* Hero */}
<div
  className="
    ws-card ws-hero-glow
    rounded-3xl
    p-6 sm:p-8
  "
>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-[var(--ws-accent-soft)] px-3 py-1 text-xs text-[var(--ws-text-main)] border border-[var(--ws-border-subtle)]">
                <Droplets className="w-4 h-4 text-[var(--ws-accent)]" />
                <span>Hyperlocal water &amp; weather view</span>
              </div>

              <h1 className="text-3xl sm:text-4xl font-semibold leading-tight tracking-tight text-[var(--ws-text-main)]">
                “What&apos;s the weather like today?”
                <span className="block mt-1 text-[var(--ws-accent)]">
                  Stop guessing. Start seeing.
                </span>
              </h1>

              <p className="text-sm sm:text-base text-[var(--ws-text-muted)] max-w-xl leading-relaxed">
                We bring together{" "}
                <span className="font-semibold text-[var(--ws-text-main)]">
                  rain, river level and temperature
                </span>{" "}
                from stations around you, so you don&apos;t have to rely on
                generic forecasts or rumours in the group chat.
              </p>

              <p className="text-xs text-[var(--ws-text-muted)] max-w-lg">
                Designed for farmers, river neighbours and city users who need
                to know: is it actually raining here, is the river rising, and
                how hot does it feel today?
              </p>

              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  to="/sensors"
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--ws-accent)] px-4 py-2 text-sm font-medium text-slate-950 shadow-md hover:opacity-90 transition"
                >
                  View live stations
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="sm:w-1/3">
              <div className="rounded-2xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/90 p-4 space-y-3">
                <p className="text-xs uppercase tracking-wide text-[var(--ws-text-muted)]">
                  What you can do here
                </p>
                <ul className="text-xs space-y-2 text-[var(--ws-text-main)]">
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#5AB2FF]" />
                    See where it&apos;s raining in key locations around Klang
                    Valley.
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#A0DEFF]" />
                    Check river level stations for early flood and drainage
                    signals.
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#FACC15]" />
                    Explore temperature spots that will later link to heat
                    stress on farms and in the city.
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                    Coming soon: photos, community reports and
                    &quot;is it really raining here?&quot; confirmations.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

{/* Three feature cards – rain / river / heat */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* 🌧 Rain card → filters to type=rain */}
          <Link
            to="/sensors?type=rain"
            className="no-underline"
          >
            <div className="ws-card ws-card-anim ws-card-rain p-4 space-y-3 h-full cursor-pointer">
              <div className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-sky-100">
                <CloudRain className="w-5 h-5 text-sky-500" />
              </div>
              <h2 className="text-sm font-semibold">Rain around you</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Stations at KLCC, Batu Caves, Genting, Putrajaya, Subang and
                more. Perfect for that “do I need an umbrella or not?” decision.
              </p>
            </div>
          </Link>

          {/* 🟢 River card → filters to type=water_level */}
          <Link
            to="/sensors?type=water_level"
            className="no-underline"
          >
            <div className="ws-card ws-card-anim ws-card-river p-4 space-y-3 h-full cursor-pointer">
              <div className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-emerald-100">
                <Waves className="w-5 h-5 text-emerald-500" />
              </div>
              <h2 className="text-sm font-semibold">River status</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Virtual river gauges at Sungai Gombak and Sungai Klang. Think
                early warning for floods, drainage problems and river activities.
              </p>
            </div>
          </Link>

          {/* 🔴 Temp card → filters to type=temperature */}
          <Link
            to="/sensors?type=temperature"
            className="no-underline"
          >
            <div className="ws-card ws-card-anim ws-card-temp p-4 space-y-3 h-full cursor-pointer">
              <div className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-rose-100">
                <ThermometerSun className="w-5 h-5 text-rose-500" />
              </div>
              <h2 className="text-sm font-semibold">Heat & comfort</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Spots like Kampung Baru and Cheras help capture how the day feels
                on the street and in the field, not just on a generic forecast map.
              </p>
            </div>
          </Link>
        </div>

        {/* Footer */}
        <footer className="pt-2 border-t border-[var(--ws-border-subtle)] text-[11px] text-[var(--ws-text-muted)] flex flex-wrap gap-2 justify-between">
          <span>Water Status · early prototype</span>
          <span>Built for people who live with rain, rivers and heat.</span>
        </footer>
      </section>
    </main>
  );
}