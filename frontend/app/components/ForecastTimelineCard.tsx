import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
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
const TIMELINE_X_TICKS = [-6, -4, -2, 0, 2, 4, 6] as const;
const TIMELINE_X_DOMAIN_TEMPERATURE: [number, number] = [-6.2, 6.2];
const TIMELINE_X_DOMAIN_RAIN: [number, number] = [-6, 6];
const RAIN_AXIS_LEVEL_COUNT = 5;

type ForecastTimelineCardProps = {
  data: ForecastTimelinePoint[];
  metric: "rain" | "temperature";
  onMetricChange: (metric: "rain" | "temperature") => void;
  variant?: "mobile" | "desktop";
  className?: string;
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

function formatChartHourTick(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    hour12: false,
  });
}

function formatRainTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return `${value}`;
  if (Math.abs(value) >= 1) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function ForecastTimelineCard({
  data,
  metric,
  onMetricChange,
  variant = "mobile",
  className = "",
}: ForecastTimelineCardProps) {
  const isCompact = variant === "mobile";
  const chartViewportRef = useRef<HTMLDivElement | null>(null);
  const chartData = useMemo(
    () =>
      [...data]
        .sort((pointA, pointB) => pointA.offset_hours - pointB.offset_hours)
        .map((point) => ({
        ...point,
        precip_value:
          point.precipitation_amount ?? point.rain_amount ?? null,
        display_label:
          point.offset_hours === 0 ? "Now" : formatChartHourLabel(point.time || null),
      })),
    [data]
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartViewportSize, setChartViewportSize] = useState({
    width: 0,
    height: 0,
  });
  const hasChartViewport = chartViewportSize.width > 0 && chartViewportSize.height > 0;

  const axisTickLabelByOffset = useMemo(() => {
    const labels = new Map<number, string>();
    chartData.forEach((point) => {
      if (!Number.isFinite(point.offset_hours)) return;
      const roundedOffset = Math.round(point.offset_hours);
      if (roundedOffset === 0) {
        labels.set(0, "Now");
        return;
      }

      labels.set(roundedOffset, formatChartHourTick(point.time || null));
    });
    return labels;
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

  useEffect(() => {
    const node = chartViewportRef.current;
    if (!node) return;

    const updateViewportState = () => {
      const { width, height } = node.getBoundingClientRect();
      setChartViewportSize({
        width: Math.max(0, Math.floor(width)),
        height: Math.max(0, Math.floor(height)),
      });
    };

    updateViewportState();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateViewportState();
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [isCompact]);

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
  const rainStep = useMemo(
    () => rainDomainMax / (RAIN_AXIS_LEVEL_COUNT - 1),
    [rainDomainMax]
  );
  const rainTicks = useMemo(
    () =>
      Array.from({ length: RAIN_AXIS_LEVEL_COUNT }, (_, index) =>
        Number((index * rainStep).toFixed(2))
      ),
    [rainStep]
  );
  const probabilityTicks = useMemo(
    () =>
      Array.from({ length: RAIN_AXIS_LEVEL_COUNT }, (_, index) =>
        Math.round((index * 100) / (RAIN_AXIS_LEVEL_COUNT - 1))
      ),
    []
  );

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
        isCompact
          ? "rounded-[1.6rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(240,249,255,0.7),rgba(255,255,255,0.8))]"
          : "rounded-[1.25rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(240,249,255,0.7),rgba(255,255,255,0.8))]",
        isCompact ? "px-2.5 py-2" : "px-3.5 py-1",
        className,
      ].join(" ")}
    >
      <div className={`flex items-center justify-between ${isCompact ? "gap-2" : "gap-3"}`}>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {metric === "rain" ? "Precip 12h" : "Temperature (°C)"}
          </p>
          <p className={`${isCompact ? "mt-0 leading-snug" : "mt-1"} text-[11px] text-slate-500`}>
            6h back and 6h ahead, in 1-hour steps.
          </p>
        </div>

        <div className="grid grid-cols-2 overflow-hidden rounded-full border border-[var(--ws-border-subtle)] bg-white/82 text-[11px]">
          <button
            type="button"
            onClick={() => onMetricChange("rain")}
            className={[
              `${isCompact ? "px-2.5 py-1" : "px-3 py-1.25"} font-medium transition-colors`,
              metric === "rain" ? "bg-sky-600 text-white" : "text-slate-600",
            ].join(" ")}
          >
            Precip
          </button>
          <button
            type="button"
            onClick={() => onMetricChange("temperature")}
            className={[
              `${isCompact ? "px-2.5 py-1" : "px-3 py-1.25"} font-medium transition-colors`,
              metric === "temperature" ? "bg-sky-600 text-white" : "text-slate-600",
            ].join(" ")}
          >
            Temp
          </button>
        </div>
      </div>

      <div className={isCompact ? "mt-1.5 space-y-1.5" : "mt-2.5 space-y-2.5"}>
        <div
          className={[
            "inline-flex items-center rounded-full border border-slate-200/80 bg-white/88 text-[11px] font-medium text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] tabular-nums",
            isCompact ? "min-h-6 px-2.5 py-1" : "min-h-8 px-3 py-1.5",
          ].join(" ")}
        >
          {readout}
        </div>

        <div
          ref={chartViewportRef}
          className={isCompact ? "h-44 min-h-[11rem]" : "h-40 min-h-[10rem]"}
        >
          {hasChartViewport ? (
            <ComposedChart
              width={chartViewportSize.width}
              height={chartViewportSize.height}
              data={chartData}
              margin={{
                top: isCompact ? 6 : 8,
                right: metric === "rain" ? 10 : 8,
                left: metric === "temperature" ? (isCompact ? 2 : 4) : isCompact ? 6 : 10,
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
                type="number"
                dataKey="offset_hours"
                domain={
                  metric === "temperature"
                    ? TIMELINE_X_DOMAIN_TEMPERATURE
                    : TIMELINE_X_DOMAIN_RAIN
                }
                ticks={TIMELINE_X_TICKS as unknown as number[]}
                axisLine={
                  metric === "temperature"
                    ? { stroke: "rgba(148,163,184,0.32)" }
                    : false
                }
                tickLine={false}
                interval={0}
                height={isCompact ? 30 : 34}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickMargin={isCompact ? 8 : 10}
                tickFormatter={(value) => {
                  const numericValue =
                    typeof value === "number" ? value : Number(value);
                  const roundedOffset = Number.isFinite(numericValue)
                    ? Math.round(numericValue)
                    : Number.NaN;
                  if (!Number.isFinite(roundedOffset)) return "";
                  if (roundedOffset === 0) return "Now";

                  const timeLabel = axisTickLabelByOffset.get(roundedOffset);
                  if (timeLabel && timeLabel !== "—") return timeLabel;

                  return `${roundedOffset > 0 ? "+" : ""}${roundedOffset}h`;
                }}
              />
              <Tooltip
                cursor={{ stroke: "rgba(14,165,233,0.24)", strokeWidth: 1 }}
                content={() => null}
              />
              {metric === "rain" ? (
                <>
                  <YAxis
                    yAxisId="rain"
                    width={42}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickMargin={6}
                    allowDecimals
                    domain={[0, rainDomainMax]}
                    ticks={rainTicks}
                    interval={0}
                    tickFormatter={(value) => formatRainTick(value)}
                  />
                  <YAxis
                    yAxisId="probability"
                    orientation="right"
                    width={42}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    tickMargin={6}
                    domain={[0, 100]}
                    ticks={probabilityTicks}
                    interval={0}
                    tickFormatter={(value) => `${Math.round(value)}%`}
                  />
                </>
              ) : (
                <YAxis
                  yAxisId="temperature"
                  width={46}
                  axisLine={{ stroke: "rgba(148,163,184,0.32)" }}
                  tickLine={{ stroke: "rgba(148,163,184,0.32)" }}
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  tickMargin={6}
                  interval={0}
                  allowDecimals={false}
                  domain={temperatureDomain}
                  ticks={temperatureTicks}
                  tickFormatter={(value) => `${Math.round(value)}°C`}
                />
              )}
              <ReferenceLine
                x={0}
                stroke="rgba(14,165,233,0.42)"
                strokeDasharray="4 4"
              />
              {activePoint ? (
                <ReferenceLine
                  x={activePoint.offset_hours}
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
          ) : (
            <div className="ws-skeleton h-full rounded-[1.1rem]" />
          )}
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
