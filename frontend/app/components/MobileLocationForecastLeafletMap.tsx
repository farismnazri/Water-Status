// @ts-nocheck
import { useEffect, useMemo, useRef } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Point } from "leaflet";
import type {
  WeatherLocationMapFrame,
  WeatherLocationMapSample,
} from "../lib/weather";
import {
  LOCAL_MAP_FOCUS_RADIUS_KM,
  LOCAL_MAP_SCALE_BAR_KM,
  MOBILE_LOCATION_FORECAST_LAYER_VISUALS,
  clamp,
  getGradientColorForLayer,
  normalizeValueToDomain,
  type MobileLocationForecastLayer,
  type MobileLocationForecastValueDomain,
} from "./mobileLocationForecastMapVisuals";

const FORECAST_FIELD_PANE_NAME = "ws-local-map-field-pane";
const FORECAST_FIELD_Z_INDEX = 340;

type MapOverlayMetrics = {
  scaleWidthPx: number;
};

function radiusToDeltas(latitude: number, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2));
  return { latDelta, lonDelta };
}

function longitudeDeltaForKm(latitude: number, distanceKm: number) {
  return distanceKm / (111 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2));
}

function interpolateFieldValue(
  projectedSamples: Array<{ point: Point; value: number }>,
  x: number,
  y: number,
  smoothingPx: number
) {
  const smoothingSq = smoothingPx * smoothingPx;
  let weightedSum = 0;
  let totalWeight = 0;

  for (const sample of projectedSamples) {
    const dx = x - sample.point.x;
    const dy = y - sample.point.y;
    const distanceSq = dx * dx + dy * dy;
    const weight = 1 / (distanceSq + smoothingSq);

    weightedSum += sample.value * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function LocationMapBounds({
  center,
  radiusKm,
}: {
  center: { latitude: number; longitude: number };
  radiusKm: number;
}) {
  const map = useMap();

  useEffect(() => {
    const { latDelta, lonDelta } = radiusToDeltas(center.latitude, radiusKm);
    map.fitBounds(
      [
        [center.latitude - latDelta, center.longitude - lonDelta],
        [center.latitude + latDelta, center.longitude + lonDelta],
      ],
      {
        padding: [20, 20],
        animate: false,
      }
    );
  }, [center.latitude, center.longitude, map, radiusKm]);

  return null;
}

function ForecastFieldOverlay({
  center,
  samples,
  frameValuesById,
  layer,
  valueDomain,
  onMetricsChange,
}: {
  center: { latitude: number; longitude: number };
  samples: WeatherLocationMapSample[];
  frameValuesById: Map<string, number | null>;
  layer: MobileLocationForecastLayer;
  valueDomain: MobileLocationForecastValueDomain | null;
  onMetricsChange?: (metrics: MapOverlayMetrics) => void;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onMetricsChangeRef = useRef(onMetricsChange);
  const lastScaleWidthRef = useRef<number | null>(null);

  const renderableSamples = useMemo(
    () =>
      samples.flatMap((sample) => {
        const value = frameValuesById.get(sample.id);
        return typeof value === "number" && Number.isFinite(value)
          ? [{ ...sample, value }]
          : [];
      }),
    [frameValuesById, samples]
  );

  useEffect(() => {
    onMetricsChangeRef.current = onMetricsChange;
  }, [onMetricsChange]);

  useEffect(() => {
    const pane = map.getPane(FORECAST_FIELD_PANE_NAME) ?? map.createPane(FORECAST_FIELD_PANE_NAME);
    pane.style.zIndex = `${FORECAST_FIELD_Z_INDEX}`;
    pane.style.pointerEvents = "none";

    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    canvas.dataset.wsForecastField = "true";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";
    canvas.style.opacity = "1";

    if (canvas.parentElement !== pane) {
      pane.appendChild(canvas);
    }

    return () => {
      if (canvas.parentElement === pane) {
        pane.removeChild(canvas);
      }
    };
  }, [map]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frameId = 0;

    const resizeCanvasContext = () => {
      const size = map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext("2d");
      if (!context || size.x <= 0 || size.y <= 0) {
        return { context: null, size, dpr };
      }

      const width = Math.max(1, Math.round(size.x * dpr));
      const height = Math.max(1, Math.round(size.y * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size.x, size.y);

      return { context, size, dpr };
    };

    const drawField = () => {
      const { context, size } = resizeCanvasContext();
      if (!context || size.x <= 0 || size.y <= 0) {
        return;
      }

      const centerPoint = map.latLngToContainerPoint([center.latitude, center.longitude]);
      const scalePoint = map.latLngToContainerPoint([
        center.latitude,
        center.longitude + longitudeDeltaForKm(center.latitude, LOCAL_MAP_SCALE_BAR_KM),
      ]);
      const focusPoint = map.latLngToContainerPoint([
        center.latitude,
        center.longitude + longitudeDeltaForKm(center.latitude, LOCAL_MAP_FOCUS_RADIUS_KM),
      ]);
      const scaleWidthPx = Math.max(0, Math.abs(scalePoint.x - centerPoint.x));
      const focusRadiusPx = Math.max(12, Math.abs(focusPoint.x - centerPoint.x));

      if (
        lastScaleWidthRef.current === null ||
        Math.abs(lastScaleWidthRef.current - scaleWidthPx) > 0.25
      ) {
        lastScaleWidthRef.current = scaleWidthPx;
        onMetricsChangeRef.current?.({ scaleWidthPx });
      }

      if (!valueDomain || renderableSamples.length === 0) {
        return;
      }

      const projectedSamples = renderableSamples.map((sample) => ({
        point: map.latLngToContainerPoint([sample.latitude, sample.longitude]),
        value: sample.value,
      }));

      const edgeSoftnessPx = Math.max(10, focusRadiusPx * 0.16);
      const smoothingPx = Math.max(scaleWidthPx * 0.34, focusRadiusPx * 0.2, 18);
      const rasterPadding = Math.max(20, focusRadiusPx * 0.34);
      const left = Math.max(0, Math.floor(centerPoint.x - focusRadiusPx - rasterPadding));
      const top = Math.max(0, Math.floor(centerPoint.y - focusRadiusPx - rasterPadding));
      const width = Math.min(size.x - left, Math.ceil((focusRadiusPx + rasterPadding) * 2));
      const height = Math.min(size.y - top, Math.ceil((focusRadiusPx + rasterPadding) * 2));

      if (width <= 0 || height <= 0) {
        return;
      }

      const offscreen = offscreenCanvasRef.current ?? document.createElement("canvas");
      offscreenCanvasRef.current = offscreen;
      offscreen.width = Math.max(48, Math.ceil(width / 2));
      offscreen.height = Math.max(48, Math.ceil(height / 2));

      const offscreenContext = offscreen.getContext("2d");
      if (!offscreenContext) {
        return;
      }

      const imageData = offscreenContext.createImageData(offscreen.width, offscreen.height);
      const { data } = imageData;
      const layerVisuals = MOBILE_LOCATION_FORECAST_LAYER_VISUALS[layer];

      for (let yIndex = 0; yIndex < offscreen.height; yIndex += 1) {
        const y = top + ((yIndex + 0.5) / offscreen.height) * height;

        for (let xIndex = 0; xIndex < offscreen.width; xIndex += 1) {
          const x = left + ((xIndex + 0.5) / offscreen.width) * width;
          const dx = x - centerPoint.x;
          const dy = y - centerPoint.y;
          const distanceFromCenter = Math.hypot(dx, dy);

          if (distanceFromCenter > focusRadiusPx) {
            continue;
          }

          const interpolatedValue = interpolateFieldValue(projectedSamples, x, y, smoothingPx);
          if (interpolatedValue === null) {
            continue;
          }

          const normalized = normalizeValueToDomain(interpolatedValue, valueDomain);
          const [red, green, blue] = getGradientColorForLayer(layer, normalized);
          const edgeFade =
            distanceFromCenter <= focusRadiusPx - edgeSoftnessPx
              ? 1
              : clamp(
                  (focusRadiusPx - distanceFromCenter) / Math.max(edgeSoftnessPx, 0.0001),
                  0,
                  1
                );
          const colorStrength =
            layer === "temperature"
              ? 0.55 + normalized * 0.45
              : 0.34 + normalized * 0.66;
          const pixelIndex = (yIndex * offscreen.width + xIndex) * 4;

          data[pixelIndex] = red;
          data[pixelIndex + 1] = green;
          data[pixelIndex + 2] = blue;
          data[pixelIndex + 3] = Math.round(
            255 * layerVisuals.fieldAlpha * colorStrength * edgeFade
          );
        }
      }

      offscreenContext.putImageData(imageData, 0, 0);

      context.save();
      context.beginPath();
      context.arc(centerPoint.x, centerPoint.y, focusRadiusPx, 0, Math.PI * 2);
      context.clip();
      context.fillStyle =
        layer === "temperature"
          ? "rgba(255,244,238,0.08)"
          : "rgba(239,246,255,0.1)";
      context.fillRect(left, top, width, height);
      context.imageSmoothingEnabled = true;
      context.drawImage(offscreen, left, top, width, height);
      context.restore();
    };

    const scheduleDraw = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        drawField();
      });
    };

    scheduleDraw();

    const handleMapChange = () => scheduleDraw();

    map.on({
      load: handleMapChange,
      move: handleMapChange,
      moveend: handleMapChange,
      viewreset: handleMapChange,
      zoom: handleMapChange,
      zoomend: handleMapChange,
      resize: handleMapChange,
    });

    return () => {
      map.off({
        load: handleMapChange,
        move: handleMapChange,
        moveend: handleMapChange,
        viewreset: handleMapChange,
        zoom: handleMapChange,
        zoomend: handleMapChange,
        resize: handleMapChange,
      });

      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    center.latitude,
    center.longitude,
    layer,
    map,
    renderableSamples,
    valueDomain,
  ]);

  return null;
}

export function MobileLocationForecastLeafletMap({
  preventModeSwipe = false,
  center,
  radiusKm,
  samples,
  frame,
  layer,
  valueDomain,
  staticFallback = false,
  onMetricsChange,
}: {
  preventModeSwipe?: boolean;
  center: { latitude: number; longitude: number };
  radiusKm: number;
  samples: WeatherLocationMapSample[];
  frame: WeatherLocationMapFrame | null;
  layer: MobileLocationForecastLayer;
  valueDomain: MobileLocationForecastValueDomain | null;
  staticFallback?: boolean;
  onMetricsChange?: (metrics: MapOverlayMetrics) => void;
}) {
  const frameValuesById = useMemo(
    () =>
      new Map(
        (frame?.samples ?? []).map((sample) => [
          sample.sample_id,
          layer === "precipitation"
            ? sample.precipitation_amount ?? null
            : sample.temperature_2m ?? null,
        ])
      ),
    [frame?.samples, layer]
  );

  const focusRadiusMeters = Math.min(LOCAL_MAP_FOCUS_RADIUS_KM * 1000, radiusKm * 1000);
  const shouldRenderField =
    !staticFallback &&
    Boolean(valueDomain) &&
    samples.some((sample) => typeof frameValuesById.get(sample.id) === "number");

  return (
    <MapContainer
      data-no-mode-swipe={preventModeSwipe ? "true" : undefined}
      center={[center.latitude, center.longitude]}
      zoom={12}
      scrollWheelZoom={false}
      zoomControl={false}
      attributionControl={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors, OSM Humanitarian"
        url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
      />

      <LocationMapBounds center={center} radiusKm={radiusKm} />

      {shouldRenderField ? (
        <ForecastFieldOverlay
          center={center}
          samples={samples}
          frameValuesById={frameValuesById}
          layer={layer}
          valueDomain={valueDomain}
          onMetricsChange={onMetricsChange}
        />
      ) : null}

      {staticFallback ? (
        <Circle
          center={[center.latitude, center.longitude]}
          radius={Math.max(1200, radiusKm * 1000)}
          pathOptions={{
            color: "#0ea5e9",
            fillColor: "#7dd3fc",
            fillOpacity: 0.08,
            weight: 2,
            dashArray: "6 6",
          }}
        />
      ) : null}

      <Circle
        center={[center.latitude, center.longitude]}
        radius={focusRadiusMeters}
        pathOptions={{
          color: layer === "temperature" ? "#fb923c" : "#38bdf8",
          weight: 8,
          opacity: 0.11,
          fill: false,
        }}
      />

      <Circle
        center={[center.latitude, center.longitude]}
        radius={focusRadiusMeters}
        pathOptions={{
          color: layer === "temperature" ? "#0f172a" : "#0b4a6f",
          weight: 2,
          opacity: layer === "temperature" ? 0.4 : 0.36,
          fillColor: "#ffffff",
          fillOpacity: layer === "temperature" ? 0.018 : 0.014,
          dashArray: layer === "temperature" ? undefined : "5 5",
        }}
      />

      <CircleMarker
        center={[center.latitude, center.longitude]}
        radius={8}
        interactive={false}
        pathOptions={{
          color: "#0f172a",
          fillColor: "#ffffff",
          fillOpacity: 1,
          weight: 3,
        }}
      />
    </MapContainer>
  );
}
