// @ts-nocheck
import { useEffect, useMemo, useRef } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Point } from "leaflet";
import type {
  WeatherLocationMapFrame,
  WeatherLocationMapSample,
} from "../lib/weather";
import {
  LOCAL_MAP_SCALE_BAR_KM,
  MOBILE_LOCATION_FORECAST_LAYER_VISUALS,
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

function getFrameValueDomain(
  values: number[],
  fallbackDomain: MobileLocationForecastValueDomain | null,
  layer: MobileLocationForecastLayer
): MobileLocationForecastValueDomain | null {
  if (values.length === 0) return fallbackDomain;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;

  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return fallbackDomain;
  }

  const mean = sum / values.length;
  const minSpread = layer === "temperature" ? 1.2 : 0.35;
  const spread = max - min;
  if (spread >= minSpread) {
    return { min, max };
  }

  const half = minSpread / 2;
  return { min: mean - half, max: mean + half };
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

function LocationMapResizeSync() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [map]);

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
  const renderDomain = useMemo(() => {
    const frameValues = renderableSamples.map((sample) => sample.value);
    return getFrameValueDomain(frameValues, valueDomain, layer);
  }, [layer, renderableSamples, valueDomain]);

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
      const scaleWidthPx = Math.max(0, Math.abs(scalePoint.x - centerPoint.x));

      if (
        lastScaleWidthRef.current === null ||
        Math.abs(lastScaleWidthRef.current - scaleWidthPx) > 0.25
      ) {
        lastScaleWidthRef.current = scaleWidthPx;
        onMetricsChangeRef.current?.({ scaleWidthPx });
      }

      if (!renderDomain || renderableSamples.length === 0) {
        return;
      }

      const projectedSamples = renderableSamples.map((sample) => ({
        point: map.latLngToContainerPoint([sample.latitude, sample.longitude]),
        value: sample.value,
      }));

      const smoothingPx =
        layer === "temperature"
          ? Math.max(scaleWidthPx * 0.2, 12)
          : Math.max(scaleWidthPx * 0.26, 16);
      const left = 0;
      const top = 0;
      const width = size.x;
      const height = size.y;

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

          const interpolatedValue = interpolateFieldValue(projectedSamples, x, y, smoothingPx);
          if (interpolatedValue === null) {
            continue;
          }

          const normalizedBase = normalizeValueToDomain(interpolatedValue, renderDomain);
          const normalized =
            layer === "temperature"
              ? Math.pow(normalizedBase, 0.82)
              : Math.pow(normalizedBase, 0.9);
          const [red, green, blue] = getGradientColorForLayer(layer, normalized);
          const colorStrength =
            layer === "temperature"
              ? 0.62 + normalized * 0.38
              : 0.42 + normalized * 0.58;
          const pixelIndex = (yIndex * offscreen.width + xIndex) * 4;

          data[pixelIndex] = red;
          data[pixelIndex + 1] = green;
          data[pixelIndex + 2] = blue;
          data[pixelIndex + 3] = Math.round(
            255 * layerVisuals.fieldAlpha * colorStrength
          );
        }
      }

      offscreenContext.putImageData(imageData, 0, 0);

      context.fillStyle =
        layer === "temperature"
          ? "rgba(255,244,238,0.03)"
          : "rgba(239,246,255,0.05)";
      context.fillRect(0, 0, size.x, size.y);
      context.imageSmoothingEnabled = true;
      context.drawImage(offscreen, 0, 0, size.x, size.y);
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
    renderDomain,
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

      <LocationMapResizeSync />
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
