import { lazy, Suspense } from "react";
import { MapPin } from "lucide-react";
import type {
  WeatherLocationMapFrame,
  WeatherLocationMapSample,
} from "../lib/weather";

const LazyMobileLocationForecastLeafletMap = lazy(() =>
  import("./MobileLocationForecastLeafletMap").then((module) => ({
    default: module.MobileLocationForecastLeafletMap,
  }))
);

export function MobileLocationForecastMap({
  center,
  radiusKm,
  samples,
  frame,
  layer,
  isClient,
  loading,
  error,
  staticFallback = false,
  onInteract,
}: {
  center: { latitude: number; longitude: number };
  radiusKm: number;
  samples: WeatherLocationMapSample[];
  frame: WeatherLocationMapFrame | null;
  layer: "precipitation" | "temperature";
  isClient: boolean;
  loading: boolean;
  error: string | null;
  staticFallback?: boolean;
  onInteract?: () => void;
}) {
  const hasMap = staticFallback || Boolean(frame && samples.length > 0);

  return (
    <div
      className="relative overflow-hidden rounded-[1.6rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(240,249,255,0.78),rgba(226,232,240,0.5))]"
      onPointerDown={onInteract}
      onTouchStart={onInteract}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--ws-border-subtle)] px-4 py-3">
        <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <MapPin className="h-3.5 w-3.5 text-[var(--ws-accent)]" />
          <span>
            {staticFallback
              ? "Local area map"
              : `Local ${layer === "precipitation" ? "precipitation" : "temperature"} map`}
          </span>
        </div>

        {staticFallback ? (
          <span className="rounded-full border border-sky-200/80 bg-sky-50/80 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-sky-700">
            Static map
          </span>
        ) : frame ? (
          <span className="rounded-full border border-slate-200/70 bg-white/75 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {frame.label}
          </span>
        ) : null}
      </div>

      <div className="relative h-[18rem] bg-white/45">
        {isClient && hasMap ? (
          <Suspense fallback={null}>
            <LazyMobileLocationForecastLeafletMap
              center={center}
              radiusKm={radiusKm}
              samples={samples}
              frame={frame}
              layer={layer}
              staticFallback={staticFallback}
            />
          </Suspense>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="space-y-2 rounded-2xl border border-slate-200/75 bg-white/78 px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {loading ? "Loading local map" : error ? "Map delayed" : "Map readying"}
              </p>
              <p className="text-xs text-slate-600">
                {error
                  ? error
                  : staticFallback
                    ? "We’re preparing a static local map around your selected area."
                    : "We’re preparing a wider local forecast field around your selected area."}
              </p>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white/80 to-transparent" />
      </div>
    </div>
  );
}
