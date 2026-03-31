// @ts-nocheck
import { useEffect, useMemo } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import type {
  WeatherLocationMapFrame,
  WeatherLocationMapSample,
} from "../lib/weather";

function radiusToDeltas(latitude: number, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2));
  return { latDelta, lonDelta };
}

function mapPrecipitationColor(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return "rgba(191,219,254,0.18)";
  }
  if (value < 0.2) return "#bae6fd";
  if (value < 0.8) return "#7dd3fc";
  if (value < 1.5) return "#38bdf8";
  return "#0284c7";
}

function mapTemperatureColor(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "rgba(254,226,226,0.18)";
  }
  if (value < 25) return "#93c5fd";
  if (value < 28) return "#fcd34d";
  if (value < 31) return "#fb923c";
  return "#f97316";
}

function sampleOpacity(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0.12;
  return 0.22 + Math.min(Math.abs(Number(value)) * 0.08, 0.34);
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

export function MobileLocationForecastLeafletMap({
  center,
  radiusKm,
  samples,
  frame,
  layer,
  staticFallback = false,
}: {
  center: { latitude: number; longitude: number };
  radiusKm: number;
  samples: WeatherLocationMapSample[];
  frame: WeatherLocationMapFrame | null;
  layer: "precipitation" | "temperature";
  staticFallback?: boolean;
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

  const overlayRadius = Math.max(1800, radiusKm * 450);

  return (
    <MapContainer
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
      ) : (
        samples.map((sample) => {
          const value = frameValuesById.get(sample.id);
          const color =
            layer === "precipitation"
              ? mapPrecipitationColor(value)
              : mapTemperatureColor(value);

          return (
            <Circle
              key={`${frame?.label ?? "frame"}-${sample.id}`}
              center={[sample.latitude, sample.longitude]}
              radius={overlayRadius}
              pathOptions={{
                stroke: false,
                fillColor: color,
                fillOpacity: sampleOpacity(value),
              }}
            />
          );
        })
      )}

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
