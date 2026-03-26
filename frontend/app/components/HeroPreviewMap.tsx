import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MapPin } from "lucide-react";

type SensorType = "rain" | "water_level" | "temperature";

type PreviewItem = {
  id: string;
  type: SensorType;
  latitude: number;
  longitude: number;
};

const LazyHeroPreviewLeafletMap = lazy(() =>
  import("./HeroPreviewLeafletMap").then((module) => ({
    default: module.HeroPreviewLeafletMap,
  }))
);

function OrbitingPreviewGlobe({
  loading,
  error,
  hasPreviewItems,
}: {
  loading: boolean;
  error: string | null;
  hasPreviewItems: boolean;
}) {
  const { title, description } = useMemo(() => {
    if (loading) {
      return {
        title: "Loading live map",
        description:
          "Orbiting the region while the latest sensor preview comes online.",
      };
    }

    if (error) {
      return {
        title: "Live map delayed",
        description: error,
      };
    }

    if (hasPreviewItems) {
      return {
        title: "Awaiting map coordinates",
        description:
          "Sensor values are ready. The preview map will appear as soon as mapped stations are available.",
      };
    }

    return {
      title: "Awaiting live readings",
      description:
        "We are still waiting for stations to report. The live map will fade in automatically.",
    };
  }, [error, hasPreviewItems, loading]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.9),rgba(219,234,254,0.55)_38%,rgba(226,232,240,0.32)_78%)]">
      <div className="ws-orbit-atmosphere absolute left-1/2 top-1/2 h-[22rem] w-[22rem] -translate-x-1/2 -translate-y-[57%] rounded-full" />
      <div className="ws-orbit-ring ws-orbit-ring--outer" />
      <div className="ws-orbit-ring ws-orbit-ring--mid" />
      <div className="ws-orbit-ring ws-orbit-ring--inner" />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="ws-orbit-globe">
          <div className="ws-orbit-globe-shadow" />
          <div className="ws-orbit-grid ws-orbit-grid--lat" />
          <div className="ws-orbit-grid ws-orbit-grid--lon" />
          <div className="ws-orbit-highlight" />
          <div className="ws-orbit-scan" />
          <div className="ws-orbit-focus">
            <span className="ws-orbit-focus-dot" />
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white/85 to-transparent" />

      <div className="absolute inset-x-6 bottom-5">
        <div className="rounded-2xl border border-slate-200/70 bg-white/78 px-4 py-3 text-center shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {title}
          </p>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function HeroPreviewMap({
  items,
  hoveredPreviewId,
  isClient,
  loading,
  error,
  hasPreviewItems,
  isFallbackPreview,
}: {
  items: PreviewItem[];
  hoveredPreviewId: string | null;
  isClient: boolean;
  loading: boolean;
  error: string | null;
  hasPreviewItems: boolean;
  isFallbackPreview: boolean;
}) {
  const [isLiveMapMounted, setIsLiveMapMounted] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const shouldShowLiveMap = isClient && items.length > 0;
  const orbitTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.45, ease: "easeInOut" as const };
  const mapTransition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.5, ease: "easeOut" as const };

  useEffect(() => {
    if (!shouldShowLiveMap) {
      setIsLiveMapMounted(false);
    }
  }, [shouldShowLiveMap]);

  const counterLabel = isFallbackPreview
    ? "Fallback"
    : shouldShowLiveMap
      ? `${items.length} shown`
      : loading
        ? "Syncing"
        : hasPreviewItems
          ? "Map pending"
          : error
            ? "Delayed"
            : "Waiting";

  return (
    <div className="ws-hero-glow rounded-[1.5rem]">
      <div className="ws-hero-glass-card overflow-hidden rounded-[1.5rem]">
        <div className="ws-hero-glass-divider flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-[var(--ws-accent)]" />
              <span>Sensor preview across Klang Valley</span>
            </div>
          </div>

          <span className="rounded-full border border-slate-200/65 bg-white/72 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {counterLabel}
          </span>
        </div>

        <div className="relative h-56 overflow-hidden bg-[linear-gradient(180deg,rgba(240,249,255,0.65),rgba(226,232,240,0.4))] sm:h-[16.75rem]">
          <motion.div
            className="absolute inset-0"
            initial={false}
            animate={{ opacity: shouldShowLiveMap && isLiveMapMounted ? 0 : 1 }}
            transition={orbitTransition}
          >
            <OrbitingPreviewGlobe
              loading={loading}
              error={error}
              hasPreviewItems={hasPreviewItems}
            />
          </motion.div>

          <motion.div
            className="absolute inset-0"
            initial={false}
            animate={{ opacity: shouldShowLiveMap && isLiveMapMounted ? 1 : 0 }}
            transition={mapTransition}
          >
            {shouldShowLiveMap ? (
              <>
                <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_55%)]" />

                <div className="pointer-events-none h-full w-full">
                  <Suspense fallback={null}>
                    <LazyHeroPreviewLeafletMap
                      items={items}
                      hoveredPreviewId={hoveredPreviewId}
                      onReady={() => setIsLiveMapMounted(true)}
                    />
                  </Suspense>
                </div>

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white/85 to-transparent" />
              </>
            ) : null}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
