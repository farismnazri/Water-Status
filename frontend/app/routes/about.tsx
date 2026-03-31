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
      <section className="max-w-6xl mx-auto px-4 py-6 sm:py-14 space-y-12 sm:space-y-24">
        {/* HERO */}
        <RevealSection className="relative overflow-hidden rounded-[1.75rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(140deg,rgba(255,255,255,0.62),rgba(228,242,252,0.9))] px-5 py-10 text-center sm:rounded-[2rem] sm:px-10 sm:py-16">
          <div className="mx-auto max-w-4xl space-y-5 sm:space-y-6">
            <p className="text-xs sm:text-sm uppercase tracking-[0.2em] text-slate-500">
              About Water Status
            </p>

            <h1 className="text-3xl sm:text-6xl font-semibold tracking-tight leading-[1.05]">
              <span className="block">A community-first early warning system for</span>
              <span className="mt-2 inline-block relative h-[1.12em] overflow-hidden align-baseline text-sky-800">
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

            <div className="ws-card-panel mx-auto max-w-3xl rounded-3xl px-5 py-4 sm:px-8 sm:py-6">
              <p className="text-sm sm:text-lg text-slate-700 leading-relaxed">
                Water Status combines low-cost IoT sensors, a simple web dashboard
                and community reports so neighbours can see water levels, act early
                and protect their homes, farms and small businesses.
              </p>
            </div>
          </div>
        </RevealSection>

        {/* FLOOD IMPACTS */}
        <section className="space-y-6 sm:space-y-8">
          <div className="space-y-4 text-center max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-5xl font-semibold text-slate-900 leading-tight">
              When disaster strikes,{" "}
              <span className="inline-block rounded-md bg-blue-900 px-2.5 py-1 text-white">
                small communities
              </span>{" "}
              feel it first.
            </h2>
            <p className="text-base sm:text-lg text-slate-700 leading-relaxed">
              These are the kinds of floods that rarely appear on big-city dashboards,
              but they decide whether a neighbour can reach home, whether a small shop
              loses stock, or whether a farmer loses a harvest.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <RevealSection className="h-full" delayMs={0} initialOffset={40}>
              <article className="ws-card-panel relative flex h-full flex-col overflow-hidden rounded-3xl transition-transform duration-200 hover:-translate-y-1">
                <span className="absolute left-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-900 text-xs font-semibold text-white shadow-sm">
                  1
                </span>
                <img
                  src={FloodOneImg}
                  alt="Street and houses affected by local flooding"
                  className="h-44 w-full object-cover sm:h-52"
                />
                <div className="px-5 py-5 space-y-2">
                  <h3 className="text-xl font-semibold text-slate-900">
                    Everyday routes suddenly cut off.
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Sudden street flooding that turns a normal walk home into a
                    risky detour.
                  </p>
                </div>
              </article>
            </RevealSection>

            <RevealSection className="h-full" delayMs={140} initialOffset={80}>
              <article className="ws-card-panel relative flex h-full flex-col overflow-hidden rounded-3xl transition-transform duration-200 hover:-translate-y-1">
                <span className="absolute left-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-900 text-xs font-semibold text-white shadow-sm">
                  2
                </span>
                <img
                  src={FloodTwoImg}
                  alt="Flooded neighbourhood near a small river"
                  className="h-44 w-full object-cover sm:h-52"
                />
                <div className="px-5 py-5 space-y-2">
                  <h3 className="text-xl font-semibold text-slate-900">
                    Neighbourhoods next to small rivers.
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Streets and homes that rarely appear on official dashboards
                    but flood again and again.
                  </p>
                </div>
              </article>
            </RevealSection>

            <RevealSection className="h-full" delayMs={280} initialOffset={120}>
              <article className="ws-card-panel relative flex h-full flex-col overflow-hidden rounded-3xl transition-transform duration-200 hover:-translate-y-1">
                <span className="absolute left-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-900 text-xs font-semibold text-white shadow-sm">
                  3
                </span>
                <img
                  src={FloodThreeImg}
                  alt="Shops and small businesses standing in floodwater"
                  className="h-44 w-full object-cover sm:h-52"
                />
                <div className="px-5 py-5 space-y-2">
                  <h3 className="text-xl font-semibold text-slate-900">
                    Small businesses absorbing the shock.
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Warungs, farms and workshops that lose stock and income each
                    time the water comes up.
                  </p>
                </div>
              </article>
            </RevealSection>
          </div>
        </section>

        {/* SOLUTION FLOW */}
        <section className="space-y-6 sm:space-y-8">
          <div className="text-center max-w-4xl mx-auto space-y-4">
            <h2 className="text-2xl sm:text-5xl font-semibold text-slate-900 leading-tight">
              Our solution? Connect sensors to simple, local alerts.
            </h2>
            <p className="text-base sm:text-lg text-slate-700 leading-relaxed">
              Water Status brings together sensors in the river, a lightweight cloud
              backend, and clear notifications so neighbours don&apos;t have to wait
              for the news — they see when the water is rising, in time to act.
            </p>
          </div>

          <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start">
            <div className="space-y-4">
              <RevealSection delayMs={0}>
                <article className="ws-card-panel rounded-3xl px-6 py-6 space-y-3">
                  <p className="text-xs uppercase tracking-wide text-sky-700 font-semibold">
                    1 · Sensors all over Malaysia
                  </p>
                  <h3 className="text-2xl font-semibold text-slate-900">
                    Low-cost IoT water-level sensors.
                  </h3>
                  <p className="text-sm sm:text-base leading-relaxed text-slate-600">
                    Simple hardware measuring water level in real time at the spots
                    neighbours care about most: small rivers, drains, and culverts.
                  </p>
                </article>
              </RevealSection>

              <div className="flex justify-center text-slate-400 text-xl font-semibold">↓</div>

              <RevealSection delayMs={200}>
                <article className="ws-card-panel rounded-3xl px-6 py-6 space-y-3">
                  <p className="text-xs uppercase tracking-wide text-sky-700 font-semibold">
                    2 · Cloud + neighbourhood dashboard
                  </p>
                  <h3 className="text-2xl font-semibold text-slate-900">
                    A clear view of what&apos;s happening now.
                  </h3>
                  <p className="text-sm sm:text-base leading-relaxed text-slate-600">
                    A lightweight backend and web dashboard that show current levels,
                    recent trends, and simple thresholds that trigger alerts.
                  </p>
                </article>
              </RevealSection>

              <div className="flex justify-center text-slate-400 text-xl font-semibold">↓</div>

              <RevealSection delayMs={400}>
                <article className="ws-card-panel rounded-3xl px-6 py-6 space-y-3">
                  <p className="text-xs uppercase tracking-wide text-sky-700 font-semibold">
                    3 · Alerts on the phone
                  </p>
                  <h3 className="text-2xl font-semibold text-slate-900">
                    Simple warnings neighbours can act on.
                  </h3>
                  <p className="text-sm sm:text-base leading-relaxed text-slate-600">
                    Clear, timely notifications that tell people when water is rising
                    near their home or shop, so they can move cars, protect stock,
                    or warn neighbours.
                  </p>
                </article>
              </RevealSection>
            </div>

            <RevealSection delayMs={120}>
              <div className="ws-card-panel rounded-[2rem] p-4 sm:p-6">
                <RotatingPhone />
              </div>
            </RevealSection>
          </div>
        </section>

        {/* CTA */}
        <section className="pb-8">
          <RevealSection>
            <div className="max-w-4xl mx-auto rounded-[1.75rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(140deg,rgba(210,237,255,0.7),rgba(241,241,241,0.96))] px-5 py-8 text-center space-y-4 shadow-sm sm:rounded-[2rem] sm:px-12 sm:py-14 sm:space-y-5">
              <p className="text-xl sm:text-4xl font-semibold text-slate-900 leading-tight">
                Ready to see how Water Status looks on the live dashboard?
              </p>
              <a
                href="/sensors"
                className="ws-button-primary inline-flex items-center gap-2 mt-1 text-base sm:text-lg px-7 py-3"
              >
                Let&apos;s dive in
              </a>
            </div>
          </RevealSection>
        </section>
      </section>
    </main>
  );
}
