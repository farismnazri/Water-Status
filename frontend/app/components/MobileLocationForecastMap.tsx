import { lazy, Suspense, useMemo, useState } from "react";
import { CloudRain, MapPin, Pause, Play, ThermometerSun } from "lucide-react";
import type {
  WeatherLocationMapFrame,
  WeatherLocationMapSample,
} from "../lib/weather";
import {
  LOCAL_MAP_SCALE_BAR_KM,
  MOBILE_LOCATION_FORECAST_LAYER_VISUALS,
  formatLegendValue,
  getLegendValueDigits,
  getStableMapValueDomain,
} from "./mobileLocationForecastMapVisuals";

const LazyMobileLocationForecastLeafletMap = lazy(() =>
  import("./MobileLocationForecastLeafletMap").then((module) => ({
    default: module.MobileLocationForecastLeafletMap,
  }))
);
const MAP_OVERLAY_UI_Z_INDEX = 780;

export function MobileLocationForecastMap({
  center,
  radiusKm,
  samples,
  frames,
  frame,
  layer,
  isClient,
  loading,
  error,
  staticFallback = false,
  paused = false,
  onPausedChange,
  onLayerChange,
  onInteract,
}: {
  center: { latitude: number; longitude: number };
  radiusKm: number;
  samples: WeatherLocationMapSample[];
  frames: WeatherLocationMapFrame[];
  frame: WeatherLocationMapFrame | null;
  layer: "precipitation" | "temperature";
  isClient: boolean;
  loading: boolean;
  error: string | null;
  staticFallback?: boolean;
  paused?: boolean;
  onPausedChange?: (paused: boolean) => void;
  onLayerChange?: (layer: "precipitation" | "temperature") => void;
  onInteract?: () => void;
}) {
  const hasMap = staticFallback || Boolean(frame && samples.length > 0);
  const [scaleWidthPx, setScaleWidthPx] = useState(56);
  const legendRange = useMemo(
    () => (staticFallback ? null : getStableMapValueDomain(frames, layer)),
    [frames, layer, staticFallback]
  );
  const legendDigits = legendRange ? getLegendValueDigits(layer, legendRange) : 0;
  const layerVisuals = MOBILE_LOCATION_FORECAST_LAYER_VISUALS[layer];
  const legendValueStyle = {
    textShadow: layerVisuals.legendLabelShadow,
  } as const;

  return (
    <div
      className="relative z-0 overflow-hidden rounded-[1.6rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(240,249,255,0.78),rgba(226,232,240,0.5))]"
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

      <div className="relative h-[15.5rem] overflow-hidden bg-white/45">
        {isClient && hasMap ? (
          <Suspense fallback={null}>
            <LazyMobileLocationForecastLeafletMap
              preventModeSwipe
              center={center}
              radiusKm={radiusKm}
              samples={samples}
              frame={frame}
              layer={layer}
              valueDomain={legendRange}
              staticFallback={staticFallback}
              onMetricsChange={({ scaleWidthPx: nextScaleWidthPx }) =>
                setScaleWidthPx((currentScaleWidthPx) =>
                  Math.abs(currentScaleWidthPx - nextScaleWidthPx) > 0.25
                    ? nextScaleWidthPx
                    : currentScaleWidthPx
                )
              }
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

        {hasMap ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ zIndex: MAP_OVERLAY_UI_Z_INDEX }}
          >
            {!staticFallback ? (
              <div className="absolute left-4 top-4">
                <div
                  className="pointer-events-auto inline-flex items-center gap-1 overflow-hidden rounded-full border border-white/70 bg-white/84 p-1 shadow-[0_10px_22px_rgba(15,23,42,0.12)] backdrop-blur-md"
                  onPointerDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onLayerChange?.("precipitation")}
                    className={[
                      "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                      layer === "precipitation"
                        ? "bg-sky-600 text-white shadow-[0_8px_16px_rgba(2,132,199,0.24)]"
                        : "text-slate-500 hover:bg-white/70 hover:text-slate-900",
                    ].join(" ")}
                    aria-pressed={layer === "precipitation"}
                    aria-label="Show precipitation layer"
                  >
                    <CloudRain className="h-[18px] w-[18px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onLayerChange?.("temperature")}
                    className={[
                      "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                      layer === "temperature"
                        ? "bg-orange-500 text-white shadow-[0_8px_16px_rgba(249,115,22,0.26)]"
                        : "text-slate-500 hover:bg-white/70 hover:text-slate-900",
                    ].join(" ")}
                    aria-pressed={layer === "temperature"}
                    aria-label="Show temperature layer"
                  >
                    <ThermometerSun className="h-[18px] w-[18px]" />
                  </button>
                </div>
              </div>
            ) : null}

            {legendRange ? (
              <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2.5">
                <span
                  className="text-[11px] font-semibold text-slate-950"
                  style={legendValueStyle}
                >
                  {formatLegendValue(legendRange.max, layer, legendDigits)}
                </span>
                <div
                  className="h-28 w-3 rounded-full border border-white/55 shadow-[0_10px_22px_rgba(15,23,42,0.18)]"
                  style={{ backgroundImage: layerVisuals.legendGradient }}
                />
                <span
                  className="text-[11px] font-semibold text-slate-950"
                  style={legendValueStyle}
                >
                  {formatLegendValue(legendRange.min, layer, legendDigits)}
                </span>
              </div>
            ) : null}

            <div className="absolute bottom-3 left-4 flex items-center gap-2">
              {!staticFallback ? (
                <div
                  className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/88 p-1 shadow-[0_10px_22px_rgba(15,23,42,0.1)] backdrop-blur-md"
                  onPointerDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onPausedChange?.(false)}
                    className={[
                      "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                      !paused
                        ? "bg-sky-600 text-white shadow-[0_8px_16px_rgba(2,132,199,0.24)]"
                        : "text-slate-400 hover:bg-white/70 hover:text-slate-700",
                    ].join(" ")}
                    aria-pressed={!paused}
                    aria-label="Play map animation"
                  >
                    <Play className="h-4 w-4 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onPausedChange?.(true)}
                    className={[
                      "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                      paused
                        ? "bg-sky-600 text-white shadow-[0_8px_16px_rgba(2,132,199,0.24)]"
                        : "text-slate-400 hover:bg-white/70 hover:text-slate-700",
                    ].join(" ")}
                    aria-pressed={paused}
                    aria-label="Pause map animation"
                  >
                    <Pause className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              <div className="rounded-full border border-white/65 bg-white/84 px-3 py-2 shadow-[0_10px_22px_rgba(15,23,42,0.1)] backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <div
                    className="relative h-2"
                    style={{ width: `${Math.max(scaleWidthPx, 24)}px` }}
                  >
                    <span className="absolute left-0 top-0 h-2 w-px rounded-full bg-slate-500/80" />
                    <span
                      className="absolute left-0 top-[3px] h-[2px] rounded-full bg-slate-600/80"
                      style={{ width: `${Math.max(scaleWidthPx, 24)}px` }}
                    />
                    <span className="absolute right-0 top-0 h-2 w-px rounded-full bg-slate-500/80" />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-700">
                    {LOCAL_MAP_SCALE_BAR_KM} km
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-white/74 via-white/24 to-transparent" />
      </div>
    </div>
  );
}
