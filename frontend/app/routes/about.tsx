// app/routes/about.tsx
// @ts-nocheck
import { useEffect, useState, useRef } from "react";
import type { Route } from "./+types/about";
import { RevealSection } from "../components/RevealSection";


// import flood images from /public/images
import FloodOneImg from "/images/floodone.png";
import FloodTwoImg from "/images/floodtwo.png";
import FloodThreeImg from "/images/floodthree.png";
import PhoneWarningImg from "/images/phone_warning.png";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "About · Water Status" },
    { name: "description", content: "Learn more about Water Status." },
  ];
}

function RotatingPhone() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={
    "w-full max-w-sm sm:max-w-md mx-auto lg:mx-0 origin-bottom " +
    "transition-transform transition-opacity duration-700 ease-out " +
        (visible
          ? "opacity-100 translate-y-0 rotate-0"
          : "opacity-0 translate-y-6 -rotate-90")
      }
    >
      <img
        src={PhoneWarningImg}
        alt="Water Status early warning screen on a phone"
        className="w-full h-auto object-contain drop-shadow-xl"
      />
    </div>
  );
}

export default function AboutPage() {
  const rotatingPhrases = [
    "small rivers.",
    "towns.",
    "farms.",
  ];

  const [headlineIndex, setHeadlineIndex] = useState(0);

useEffect(() => {
  const id = setInterval(() => {
    setHeadlineIndex((prev) => (prev + 1) % rotatingPhrases.length);
  }, 1400); // ~1s pause + 0.4s slide

  return () => clearInterval(id);
}, []);

 const step = 100 / rotatingPhrases.length;

  return (
    <main className="min-h-screen">
<section className="max-w-5xl mx-auto px-4 py-12 space-y-20">
  {/* HERO */}
<RevealSection className="space-y-6 min-h-[70vh] flex flex-col items-center justify-center text-center">
  <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
    <span className="block">
      A community-first early warning system for
    </span>

    {/* Rotating line */}
<span className="mt-1 inline-block relative h-[1.2em] overflow-hidden align-baseline">
  <span
    className="flex flex-col transition-transform duration-400 ease-out"
    style={{ transform: `translateY(-${headlineIndex * step}%)` }}
  >
    {rotatingPhrases.map((phrase) => (
      <span key={phrase} className="block">
        {phrase}
      </span>
    ))}
  </span>
</span>
  </h1>

  <div className="w-full max-w-2xl">
    <div className="rounded-3xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 shadow-sm px-6 py-4 sm:px-8 sm:py-5">
      <p className="text-sm text-slate-600 leading-relaxed">
        Water Status combines low-cost IoT sensors, a simple web dashboard
        and community reports so neighbours can see water levels, act early
        and protect their homes, farms and small businesses.
      </p>
    </div>
  </div>
</RevealSection>

{/* FLOOD IMAGES STRIP */}
<section className="pt-24 sm:pt-32 space-y-6">
  <div className="space-y-3 text-center max-w-3xl mx-auto">
    <h2 className="text-xl sm:text-5xl font-semibold text-slate-900 leading-snug">
      When disaster strikes,{" "}
      <span className="inline-block rounded-md bg-blue-900 px-2 py-0.5 text-white">
        small communities
      </span>{" "}
      feel it first.
    </h2>
    <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed">
      These are the kinds of floods that rarely appear on big-city dashboards,
      but they decide whether a neighbour can reach home, whether a small shop
      loses stock, or whether a farmer loses a harvest.
    </p>
  </div>

  <div className="grid gap-5 sm:grid-cols-3">
    {/* Flood 1 */}
    <RevealSection className="h-full" delayMs={0} initialOffset={50}>
      <article className="relative flex flex-col h-full rounded-3xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 shadow-sm hover:shadow-md transition-shadow">
        <span className="absolute left-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-900 text-[11px] font-semibold text-white shadow-sm">
          1
        </span>
        <img
          src={FloodOneImg}
          alt="Street and houses affected by local flooding"
          className="h-40 w-full object-cover rounded-t-3xl"
        />
        <div className="px-4 py-3 space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-900">
            Everyday routes suddenly cut off.
          </h3>
          <p className="text-[11px] leading-relaxed text-slate-600">
            Sudden street flooding that turns a normal walk home into a
            risky detour.
          </p>
        </div>
      </article>
    </RevealSection>

    {/* Flood 2 */}
    <RevealSection className="h-full" delayMs={150} initialOffset={100}>
      <article className="relative flex flex-col h-full rounded-3xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 shadow-sm hover:shadow-md transition-shadow">
        <span className="absolute left-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-900 text-[11px] font-semibold text-white shadow-sm">
          2
        </span>
        <img
          src={FloodTwoImg}
          alt="Flooded neighbourhood near a small river"
          className="h-40 w-full object-cover rounded-t-3xl"
        />
        <div className="px-4 py-3 space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-900">
            Neighbourhoods next to small rivers.
          </h3>
          <p className="text-[11px] leading-relaxed text-slate-600">
            Streets and homes that rarely appear on official dashboards
            but flood again and again.
          </p>
        </div>
      </article>
    </RevealSection>

    {/* Flood 3 */}
    <RevealSection className="h-full" delayMs={300} initialOffset={150}>
      <article className="relative flex flex-col h-full rounded-3xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 shadow-sm hover:shadow-md transition-shadow">
        <span className="absolute left-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-900 text-[11px] font-semibold text-white shadow-sm">
          3
        </span>
        <img
          src={FloodThreeImg}
          alt="Shops and small businesses standing in floodwater"
          className="h-40 w-full object-cover rounded-t-3xl"
        />
        <div className="px-4 py-3 space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-900">
            Small businesses absorbing the shock.
          </h3>
          <p className="text-[11px] leading-relaxed text-slate-600">
            Warungs, farms and workshops that lose stock and income each
            time the water comes up.
          </p>
        </div>
      </article>
    </RevealSection>
  </div>
</section>

{/* SOLUTION: HOW WATER STATUS HELPS */}
<section className="pt-20 space-y-8">
  <div className="text-center max-w-3xl mx-auto space-y-3">
    <h2 className="text-xl sm:text-3xl font-semibold text-slate-900 leading-snug">
      Our solution? Connect sensors to simple, local alerts.
    </h2>
    <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed">
      Water Status brings together sensors in the river, a lightweight cloud
      backend, and clear notifications so neighbours don&apos;t have to wait
      for the news — they see when the water is rising, in time to act.
    </p>
  </div>

  <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-center">
    {/* Flow cards: sensor → cloud → phone */}
    <div className="flex flex-col sm:flex-row items-stretch gap-4">
      {/* 1. Sensors in the river */}
      <RevealSection className="flex-1" delayMs={0}>
        <article className="flex flex-col h-full rounded-3xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 shadow-sm px-4 py-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-sky-700 font-semibold">
            1 · Sensors all over Malaysia
          </p>
          <h3 className="text-sm font-semibold text-slate-900">
            Low‑cost IoT water‑level sensors.
          </h3>
          <p className="text-[11px] leading-relaxed text-slate-600">
            Simple hardware measuring water level in real time at the spots
            neighbours care about most: small rivers, drains, and culverts.
          </p>
        </article>
      </RevealSection>

      <div className="hidden sm:flex items-center text-slate-400 text-lg font-semibold">
        <span>→</span>
      </div>

      {/* 2. Cloud + dashboard */}
      <RevealSection className="flex-1" delayMs={300}>
        <article className="flex flex-col h-full rounded-3xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 shadow-sm px-4 py-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-sky-700 font-semibold">
            2 · Cloud + neighbourhood dashboard
          </p>
          <h3 className="text-sm font-semibold text-slate-900">
            A clear view of what&apos;s happening now.
          </h3>
          <p className="text-[11px] leading-relaxed text-slate-600">
            A lightweight backend and web dashboard that show current levels,
            recent trends, and simple thresholds that trigger alerts.
          </p>
        </article>
      </RevealSection>

      <div className="hidden sm:flex items-center text-slate-400 text-lg font-semibold">
        <span>→</span>
      </div>

      {/* 3. Alerts on the phone */}
      <RevealSection className="flex-1" delayMs={600}>
        <article className="flex flex-col h-full rounded-3xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)]/95 shadow-sm px-4 py-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-sky-700 font-semibold">
            3 · Alerts on the phone
          </p>
          <h3 className="text-sm font-semibold text-slate-900">
            Simple warnings neighbours can act on.
          </h3>
          <p className="text-[11px] leading-relaxed text-slate-600">
            Clear, timely notifications that tell people when water is rising
            near their home or shop, so they can move cars, protect stock,
            or warn neighbours.
          </p>
        </article>
      </RevealSection>
    </div>

    {/* Phone mockup on the right with playful rotate‑in */}
    <RotatingPhone />
  </div>
</section>

{/* CTA: jump to stations page */}
<section className="pt-16 pb-10">
  <div className="max-w-3xl mx-auto text-center space-y-3">
    <p className="text-sm sm:text-[15px] text-slate-600 leading-relaxed">
      Ready to see how Water Status looks on the live dashboard?
    </p>
    <a
      href="/sensors"
      className="ws-button-primary inline-flex items-center gap-2 mt-1"
    >
      Let&apos;s dive in
    </a>
  </div>
</section>
      </section>
    </main>
  );
}