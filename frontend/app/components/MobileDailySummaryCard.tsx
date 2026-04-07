import type { LucideIcon } from "lucide-react";
import { LocateFixed } from "lucide-react";

import ShinyText from "./ShinyText";

type SensorLocationOption = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

type MobileDailySummaryCardProps = {
  CurrentLocationWeatherIcon: LucideIcon;
  displayLocationLabel: string;
  error: string | null;
  errorClasses: string;
  feelsLikeLabel: string;
  isLoading: boolean;
  locationMessage: string | null;
  locationMode: "gps" | "manual";
  locationOptions: SensorLocationOption[];
  next6hPrecipLabel: string;
  next6hPrecipSumLabel: string;
  onClosePicker: () => void;
  onEnableGps: () => void;
  onSelectManualArea: (nextArea: SensorLocationOption | null) => void;
  onSelectManualMode: () => void;
  onTogglePicker: () => void;
  pickerOpen: boolean;
  selectedLocationLabel: string;
  shouldToneDownMotion: boolean;
  temperatureLabel: string;
  todayHighLowLabel: string;
  weatherLabel: string;
  windLabel: string;
};

export function MobileDailySummaryCard({
  CurrentLocationWeatherIcon,
  displayLocationLabel,
  error,
  errorClasses,
  feelsLikeLabel,
  isLoading,
  locationMessage,
  locationMode,
  locationOptions,
  next6hPrecipLabel,
  next6hPrecipSumLabel,
  onClosePicker,
  onEnableGps,
  onSelectManualArea,
  onSelectManualMode,
  onTogglePicker,
  pickerOpen,
  selectedLocationLabel,
  shouldToneDownMotion,
  temperatureLabel,
  todayHighLowLabel,
  weatherLabel,
  windLabel,
}: MobileDailySummaryCardProps) {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden px-1 pt-0.5 text-center">
        <ShinyText
          text="Stop guessing. Start seeing."
          speed={3}
          delay={0.55}
          color="#59aaf7"
          shineColor="#b8ddff"
          spread={100}
          direction="left"
          yoyo={false}
          pauseOnHover={false}
          disabled={shouldToneDownMotion}
          className="mx-auto block max-w-full overflow-visible whitespace-nowrap pb-[0.04em] text-center text-[clamp(1.28rem,5.6vw,2.35rem)] font-semibold leading-none tracking-[-0.08em]"
        />
      </div>

      {locationMessage ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-xs text-slate-600">
          {locationMessage}
        </div>
      ) : null}

      <div className="rounded-[1.7rem] border border-[var(--ws-border-subtle)] bg-white/86 p-3 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Nearby Risk Snapshot
            </p>
            <p className="mt-1 truncate text-[1.55rem] font-semibold tracking-tight text-slate-900 sm:text-[1.75rem]">
              {displayLocationLabel}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePicker}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--ws-border-subtle)] bg-white/86 text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition-colors hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              aria-label="Change location source"
            >
              <LocateFixed className="h-4 w-4" />
            </button>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              <CurrentLocationWeatherIcon className="h-5 w-5" />
            </span>
          </div>
        </div>

        {pickerOpen ? (
          <div className="mt-3 rounded-[1.2rem] border border-[var(--ws-border-subtle)] bg-white/82 p-3 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
            <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] text-xs">
              <button
                type="button"
                onClick={onEnableGps}
                className={[
                  "inline-flex items-center justify-center gap-2 py-2 text-center font-medium transition-colors",
                  locationMode === "gps"
                    ? "bg-sky-600 text-white shadow-inner"
                    : "text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                <LocateFixed className="h-3.5 w-3.5" />
                Auto
              </button>
              <button
                type="button"
                onClick={onSelectManualMode}
                className={[
                  "py-2 text-center font-medium transition-colors",
                  locationMode === "manual"
                    ? "bg-sky-600 text-white shadow-inner"
                    : "text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                Choose
              </button>
            </div>

            {locationMode === "manual" ? (
              <div className="mt-2.5 flex items-center gap-2">
                <select
                  value={selectedLocationLabel}
                  onChange={(event) => {
                    const nextArea =
                      locationOptions.find(
                        (option) => option.label === event.target.value
                      ) ?? null;
                    onSelectManualArea(nextArea);
                  }}
                  className="min-w-0 flex-1 rounded-2xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  <option value="">Select a nearby area…</option>
                  {locationOptions.map((option) => (
                    <option key={option.id} value={option.label}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onClosePicker}
                  className="rounded-2xl border border-[var(--ws-border-subtle)] px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  Done
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-4 space-y-3">
            <div className="ws-skeleton h-10 w-32 rounded-2xl" />
            <div className="grid grid-cols-2 gap-2">
              <div className="ws-skeleton h-16 rounded-2xl" />
              <div className="ws-skeleton h-16 rounded-2xl" />
              <div className="ws-skeleton col-span-2 h-16 rounded-2xl" />
            </div>
          </div>
        ) : error ? (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${errorClasses}`}>
            {error}
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[2.35rem] font-semibold leading-none tracking-tight text-slate-950">
                  {temperatureLabel}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Feels like {feelsLikeLabel}
                </p>
              </div>

              <div className="text-right">
                <p className="text-[15px] font-medium text-slate-700">
                  {weatherLabel}
                </p>
                <p className="mt-1 text-[15px] text-slate-500">
                  Wind {windLabel}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-[1.2rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                <p className="text-slate-500">Next 6h precip</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {next6hPrecipLabel}
                </p>
              </div>

              <div className="rounded-[1.2rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                <p className="text-slate-500">Today high / low</p>
                <p className="mt-1 text-[15px] font-semibold text-slate-900">
                  {todayHighLowLabel}
                </p>
              </div>

              <div className="col-span-2 rounded-[1.2rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                <p className="text-slate-500">Next 6h precip sum</p>
                <p className="mt-1 text-[15px] font-semibold text-slate-900">
                  {next6hPrecipSumLabel}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
