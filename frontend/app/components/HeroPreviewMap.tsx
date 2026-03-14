// @ts-nocheck
import { Fragment, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap } from "react-leaflet";
import { MapPin } from "lucide-react";

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

export function HeroPreviewMap({
  items,
  hoveredPreviewId,
  isClient,
  loading,
}: {
  items: PreviewItem[];
  hoveredPreviewId: string | null;
  isClient: boolean;
  loading: boolean;
}) {
  const mapCenter = items.length
    ? ([items[0].latitude, items[0].longitude] as [number, number])
    : ([3.14, 101.69] as [number, number]);

  return (
    <div className="ws-hero-glow rounded-[1.5rem]">
      <div className="ws-hero-glass-card overflow-hidden rounded-[1.5rem]">
        <div className="ws-hero-glass-divider flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-[var(--ws-accent)]" />
              <span>Live sensors across Klang Valley</span>
            </div>
          </div>

          <span className="rounded-full border border-slate-200/65 bg-white/72 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {items.length} shown
          </span>
        </div>

        <div className="relative h-56 overflow-hidden bg-[linear-gradient(180deg,rgba(240,249,255,0.65),rgba(226,232,240,0.4))] sm:h-[16.75rem]">
          {isClient && items.length > 0 ? (
            <>
              <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_55%)]" />

              <div className="pointer-events-none h-full w-full">
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
                    attribution='&copy; OpenStreetMap contributors, OSM Humanitarian'
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
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white/85 to-transparent" />
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="rounded-2xl border border-slate-200/60 bg-white/78 px-4 py-3 text-center shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {loading ? "Loading preview map" : "Map preview unavailable"}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {loading
                    ? "Pulling station coordinates for the current preview."
                    : "Waiting for station coordinates to render the preview."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
