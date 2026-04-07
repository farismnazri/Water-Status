import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatPercent,
  formatPrecipAmount,
  formatShortTime,
  formatTemperature,
  type WeatherLocationHourlyPoint,
} from "../lib/weather";

export type ForecastTimelinePoint = WeatherLocationHourlyPoint;

type ForecastTimelineCardProps = {
  data: ForecastTimelinePoint[];
  metric: "rain" | "temperature";
  onMetricChange: (metric: "rain" | "temperature") => void;
  variant?: "mobile" | "desktop";
};

function formatChartHourLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed
    .toLocaleTimeString([], {
      hour: "numeric",
    })
    .replace(/\s/g, "");
}

function formatRainTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return `${value}`;
  if (Math.abs(value) >= 1) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function buildAxisTicks(
  min: number,
  max: number,
  preferredTickCount: number,
  {
    allowFractional = false,
    clampAtZero = false,
  }: {
    allowFractional?: boolean;
    clampAtZero?: boolean;
  } = {}
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return [min, max].filter(Number.isFinite);
  }

  const safeMin = clampAtZero ? Math.max(0, min) : min;
  const span = max - safeMin;
  const rawStep = span / Math.max(1, preferredTickCount - 1);

  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return [safeMin, max];
  }

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const scaled = rawStep / magnitude;
  let niceStep = 1;

  if (allowFractional) {
    if (scaled <= 1) niceStep = 1;
    else if (scaled <= 2) niceStep = 2;
    else if (scaled <= 2.5) niceStep = 2.5;
    else if (scaled <= 5) niceStep = 5;
    else niceStep = 10;
  } else {
    if (scaled <= 1) niceStep = 1;
    else if (scaled <= 2) niceStep = 2;
    else if (scaled <= 5) niceStep = 5;
    else niceStep = 10;
  }

  const step = niceStep * magnitude;
  const tickStart = clampAtZero ? 0 : Math.ceil(safeMin / step) * step;
  const ticks: number[] = [];

  for (let value = tickStart; value <= max + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(2)));
  }

  if (ticks.length < 2) {
    return [safeMin, max].map((value) => Number(value.toFixed(2)));
  }

  return ticks;
}

export function ForecastTimelineCard({
  data,
  metric,
  onMetricChange,
  variant = "mobile",
}: ForecastTimelineCardProps) {
  const isCompact = variant === "mobile";
  const chartData = useMemo(
    () =>
      data.map((point) => ({
        ...point,
        precip_value:
          point.precipitation_amount ?? point.rain_amount ?? null,
        display_label:
          point.offset_hours === 0 ? "Now" : formatChartHourLabel(point.time || null),
      })),
    [data]
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const chartTickIndexes = useMemo(() => {
    if (chartData.length === 0) return new Set<number>();

    const nowIndex = chartData.findIndex((point) => point.offset_hours === 0);
    const lastIndex = chartData.length - 1;
    const rawIndexes = [
      0,
      nowIndex >= 0 ? nowIndex - 3 : 3,
      nowIndex >= 0 ? nowIndex : Math.floor(lastIndex / 2),
      nowIndex >= 0 ? nowIndex + 3 : Math.max(lastIndex - 3, 0),
      lastIndex,
    ];

    return new Set(
      rawIndexes.filter((index) => index >= 0 && index <= lastIndex)
    );
  }, [chartData]);

  const defaultActiveIndex = useMemo(() => {
    if (chartData.length === 0) return null;
    const nowIndex = chartData.findIndex((point) => point.offset_hours === 0);
    return nowIndex >= 0 ? nowIndex : 0;
  }, [chartData]);

  const hasRainSeries = chartData.some(
    (point) =>
      Number.isFinite(point.precip_value ?? Number.NaN) ||
      Number.isFinite(point.precipitation_probability ?? Number.NaN)
  );
  const hasTemperatureSeries = chartData.some((point) =>
    Number.isFinite(point.temperature_2m ?? Number.NaN)
  );
  const activePoint =
    activeIndex !== null ? chartData[activeIndex] ?? null : null;
  const readout = useMemo(() => {
    if (!activePoint) return null;

    const timeLabel =
      activePoint.offset_hours === 0
        ? "Now"
        : formatShortTime(activePoint.time || null);

    if (metric === "temperature") {
      return [timeLabel, formatTemperature(activePoint.temperature_2m)].join(" • ");
    }

    return [
      timeLabel,
      formatPrecipAmount(activePoint.precipitation_amount),
      formatPercent(activePoint.precipitation_probability),
    ].join(" • ");
  }, [activePoint, metric]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (defaultActiveIndex === null) return null;
      if (current !== null && current >= 0 && current < chartData.length) {
        return current;
      }
      return defaultActiveIndex;
    });
  }, [chartData.length, defaultActiveIndex]);

  const rainDomainMax = useMemo(() => {
    const maxValue = chartData.reduce((highest, point) => {
      const value = point.precip_value;
      return Number.isFinite(value ?? Number.NaN) && (value ?? 0) > highest
        ? (value ?? 0)
        : highest;
    }, 0);

    if (maxValue <= 0.3) return 0.3;
    if (maxValue <= 1) return 1;
    if (maxValue <= 5) return Number((Math.ceil(maxValue * 2) / 2).toFixed(1));
    return Math.ceil(maxValue * 1.15);
  }, [chartData]);

  const temperatureDomain = useMemo<[number, number]>(() => {
    const values = chartData
      .map((point) => point.temperature_2m)
      .filter((value): value is number => Number.isFinite(value ?? Number.NaN));

    if (values.length === 0) return [22, 34];

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const lowerBound = Math.floor((minValue - 1.5) / 6) * 6;
    const upperBound = Math.ceil((maxValue + 1.5) / 6) * 6;

    if (upperBound <= lowerBound) {
      return [lowerBound, lowerBound + 6];
    }

    return [lowerBound, upperBound];
  }, [chartData]);

  const rainTicks = useMemo(
    () => buildAxisTicks(0, rainDomainMax, 4, { allowFractional: true, clampAtZero: true }),
    [rainDomainMax]
  );
  const temperatureTicks = useMemo(
    () => {
      const ticks: number[] = [];
      for (let value = temperatureDomain[0]; value <= temperatureDomain[1]; value += 6) {
        ticks.push(value);
      }

      return ticks.length > 1 ? ticks : [temperatureDomain[0], temperatureDomain[1]];
    },
    [temperatureDomain]
  );

  function updateActiveIndex(
    nextState: { activeTooltipIndex?: number | string | null } | undefined
  ) {
    const nextIndex = nextState?.activeTooltipIndex;
    const normalizedIndex =
      typeof nextIndex === "number"
        ? nextIndex
        : typeof nextIndex === "string"
          ? Number(nextIndex)
          : Number.NaN;

    if (Number.isInteger(normalizedIndex) && normalizedIndex >= 0) {
      setActiveIndex(normalizedIndex);
    }
  }

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-3 py-4 text-xs text-slate-500">
        Timeline data is unavailable right now.
      </div>
    );
  }

  return (
    <div
      className={[
        "rounded-[1.25rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(240,249,255,0.7),rgba(255,255,255,0.8))]",
        isCompact ? "px-3 py-2.5" : "px-3.5 py-1",
      ].join(" ")}
    >
      <div className={`flex items-center justify-between ${isCompact ? "gap-2.5" : "gap-3"}`}>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {metric === "rain" ? "Precip 12h" : "Temp 12h"}
          </p>
          <p className={`${isCompact ? "mt-0.5" : "mt-1"} text-[11px] text-slate-500`}>
            6h back and 6h ahead, in 1-hour steps.
          </p>
        </div>

        <div className="grid grid-cols-2 overflow-hidden rounded-full border border-[var(--ws-border-subtle)] bg-white/82 text-[11px]">
          <button
            type="button"
            onClick={() => onMetricChange("rain")}
            className={[
              "px-3 py-1.25 font-medium transition-colors",
              metric === "rain" ? "bg-sky-600 text-white" : "text-slate-600",
            ].join(" ")}
          >
            Precip
          </button>
          <button
            type="button"
            onClick={() => onMetricChange("temperature")}
            className={[
              "px-3 py-1.25 font-medium transition-colors",
              metric === "temperature" ? "bg-sky-600 text-white" : "text-slate-600",
            ].join(" ")}
          >
            Temp
          </button>
        </div>
      </div>

      <div className={isCompact ? "mt-2 space-y-2" : "mt-2.5 space-y-2.5"}>
        <div
          className={[
            "inline-flex items-center rounded-full border border-slate-200/80 bg-white/88 text-[11px] font-medium text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] tabular-nums",
            isCompact ? "min-h-7 px-2.5 py-1.25" : "min-h-8 px-3 py-1.5",
          ].join(" ")}
        >
          {readout}
        </div>

        <div className={isCompact ? "h-48" : "h-40"}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{
                top: isCompact ? 6 : 8,
                right: metric === "rain" ? 10 : 4,
                left: metric === "temperature" ? (isCompact ? 18 : 20) : isCompact ? 6 : 10,
                bottom: isCompact ? 10 : 14,
              }}
              onMouseMove={updateActiveIndex}
              onMouseLeave={() => setActiveIndex(defaultActiveIndex)}
              onTouchStart={updateActiveIndex}
              onTouchMove={updateActiveIndex}
              onClick={updateActiveIndex}
            >
              <CartesianGrid
                stroke="rgba(148,163,184,0.16)"
                vertical={false}
              />
              <XAxis
                dataKey="display_label"
                axisLine={
                  metric === "temperature"
                    ? { stroke: "rgba(148,163,184,0.32)" }
                    : false
                }
                tickLine={false}
                interval={0}
                height={isCompact ? 30 : 34}
                padding={{ left: 8, right: 8 }}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickMargin={isCompact ? 8 : 10}
                tickFormatter={(value, index) =>
                  chartTickIndexes.has(index) ? value : ""
                }
              />
              <Tooltip
                cursor={{ stroke: "rgba(14,165,233,0.24)", strokeWidth: 1 }}
                content={() => null}
              />
              <YAxis
                yAxisId="rain"
                width={42}
                axisLine={false}
                tickLine={false}
                tick={metric === "rain" ? { fill: "#64748b", fontSize: 11 } : false}
                tickMargin={6}
                hide={metric !== "rain"}
                allowDecimals
                domain={[0, rainDomainMax]}
                ticks={rainTicks}
                tickFormatter={(value) => formatRainTick(value)}
              />
              <YAxis
                yAxisId="probability"
                orientation="right"
                width={42}
                axisLine={false}
                tickLine={false}
                tick={metric === "rain" ? { fill: "#64748b", fontSize: 11 } : false}
                tickMargin={6}
                hide={metric !== "rain"}
                domain={[0, 100]}
                tickFormatter={(value) => `${Math.round(value)}%`}
              />
              <YAxis
                yAxisId="temperature"
                width={54}
                axisLine={
                  metric === "temperature"
                    ? { stroke: "rgba(148,163,184,0.32)" }
                    : false
                }
                tickLine={
                  metric === "temperature"
                    ? { stroke: "rgba(148,163,184,0.32)" }
                    : false
                }
                tick={
                  metric === "temperature" ? { fill: "#64748b", fontSize: 11 } : false
                }
                tickMargin={6}
                hide={metric !== "temperature"}
                interval={0}
                allowDecimals={false}
                domain={temperatureDomain}
                ticks={temperatureTicks}
                tickFormatter={(value) => `${Math.round(value)}°`}
              />
              <ReferenceLine
                x="Now"
                stroke="rgba(14,165,233,0.42)"
                strokeDasharray="4 4"
              />
              {activePoint ? (
                <ReferenceLine
                  x={activePoint.display_label}
                  stroke="rgba(15,23,42,0.18)"
                  strokeDasharray="3 4"
                />
              ) : null}

              {metric === "rain" ? (
                <>
                  <Bar
                    yAxisId="rain"
                    dataKey="precip_value"
                    name="Precip amount"
                    fill="#38bdf8"
                    radius={[8, 8, 0, 0]}
                    minPointSize={6}
                    barSize={isCompact ? 13 : 15}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="probability"
                    dataKey="precipitation_probability"
                    name="Precip chance"
                    type="monotone"
                    stroke="#0f172a"
                    strokeWidth={2}
                    dot={{ r: 3.5, fill: "#0f172a" }}
                    activeDot={{ r: 5, fill: "#0f172a" }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </>
              ) : (
                <Line
                  yAxisId="temperature"
                  dataKey="temperature_2m"
                  name="Temperature"
                  type="monotone"
                  stroke="#f97316"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, fill: "#f97316" }}
                  activeDot={{ r: 5.5, fill: "#f97316" }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {metric === "rain" && !hasRainSeries ? (
        <p className="mt-2 text-[11px] text-slate-500">
          No precipitation is expected across this 12-hour window.
        </p>
      ) : null}
      {metric === "temperature" && !hasTemperatureSeries ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Temperature forecast is unavailable for this 12-hour window.
        </p>
      ) : null}
    </div>
  );
}
