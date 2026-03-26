// @ts-nocheck
import { Fragment, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap } from "react-leaflet";

type SensorType = "rain" | "water_level" | "temperature";

type PreviewItem = {
  id: string;
  type: SensorType;
  latitude: number;
  longitude: number;
};

function markerColorForType(type: SensorType): string {
  if (type === "rain") return "#38bdf8";
  if (type === "water_level") return "#34d399";
  return "#fb7185";
}

function PreviewMapBounds({ items }: { items: PreviewItem[] }) {
  const map = useMap();

  useEffect(() => {
    if (items.length === 0) return;

    const positions = items.map(
      (item) => [item.latitude, item.longitude] as [number, number]
    );

    if (positions.length === 1) {
      map.setView(positions[0], 10, { animate: false });
      return;
    }

    map.fitBounds(positions, {
      padding: [28, 28],
      maxZoom: 10,
      animate: false,
    });
  }, [items, map]);

  return null;
}

export function HeroPreviewLeafletMap({
  items,
  hoveredPreviewId,
  onReady,
}: {
  items: PreviewItem[];
  hoveredPreviewId: string | null;
  onReady?: () => void;
}) {
  const mapCenter = items.length
    ? ([items[0].latitude, items[0].longitude] as [number, number])
    : ([3.14, 101.69] as [number, number]);

  useEffect(() => {
    onReady?.();
  }, []);

  return (
    <MapContainer
      center={mapCenter}
      zoom={9}
      scrollWheelZoom={false}
      dragging={false}
      touchZoom={false}
      doubleClickZoom={false}
      boxZoom={false}
      keyboard={false}
      zoomControl={false}
      attributionControl={false}
      className="h-full w-full"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors, OSM Humanitarian"
        url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
      />

      <PreviewMapBounds items={items} />

      {items.map((item) => {
        const markerColor = markerColorForType(item.type);
        const isHighlighted = hoveredPreviewId === item.id;

        return (
          <Fragment key={item.id}>
            {isHighlighted ? (
              <CircleMarker
                center={[item.latitude, item.longitude]}
                radius={15}
                interactive={false}
                pathOptions={{
                  stroke: false,
                  fillColor: markerColor,
                  fillOpacity: 0.16,
                }}
              />
            ) : null}

            <CircleMarker
              center={[item.latitude, item.longitude]}
              radius={isHighlighted ? 8.5 : 6.5}
              interactive={false}
              pathOptions={{
                color: markerColor,
                fillColor: markerColor,
                fillOpacity: 0.92,
                weight: isHighlighted ? 4 : 2,
              }}
            />
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
