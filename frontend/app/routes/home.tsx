import {
  lazy,
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { Link } from "react-router";
import {
  Waves,
  CloudRain,
  ThermometerSun,
  ArrowRight,
  Info,
  LocateFixed,
} from "lucide-react";
import { API_BASE } from "../lib/api";
import { HeroPreviewMap } from "../components/HeroPreviewMap";
import { MobileDailySummaryCard } from "../components/MobileDailySummaryCard";
import { MobileLocationForecastMap } from "../components/MobileLocationForecastMap";
import ShinyText from "../components/ShinyText";
import {
  fetchLocationForecastContext,
  formatPercent,
  formatPrecipAmount,
  formatShortDate,
  formatTemperature,
  formatWind,
  getWeatherCodeMeta,
  isForecastRateLimitError,
  type WeatherLocationContext,
} from "../lib/weather";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Water Status" },
    {
      name: "description",
      content:
        "Check nearby water, rainfall, and temperature conditions from local sensors and forecast views.",
    },
  ];
}

type SensorType = "rain" | "water_level" | "temperature";

type HomePreviewItem = {
  id: string;
  name: string;
  location: string;
  type: SensorType;
  unit: string;
  latitude: number | null;
  longitude: number | null;
  value: number | null;
  timestamp?: string | null;
  source?: string;
};

type PreviewItem = {
  id: string;
  name: string;
  location: string;
  type: SensorType;
  display: string;
  value: number | null;
  latitude: number | null;
  longitude: number | null;
};

type PreviewByType = Record<SensorType, PreviewItem[]>;

type SensorLocationOption = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

type MobileHomeTab = "forecast" | "map";

const previewSections = [
  {
    type: "rain" as const,
    label: "Precip",
    icon: CloudRain,
    shellClass: "bg-sky-100",
    iconClass: "text-sky-500",
    activeItemClass: "border-sky-200/90 bg-sky-50/82",
  },
  {
    type: "water_level" as const,
    label: "Water levels",
    icon: Waves,
    shellClass: "bg-emerald-100",
    iconClass: "text-emerald-500",
    activeItemClass: "border-emerald-200/90 bg-emerald-50/82",
  },
  {
    type: "temperature" as const,
    label: "Heat",
    icon: ThermometerSun,
    shellClass: "bg-rose-100",
    iconClass: "text-rose-500",
    activeItemClass: "border-rose-200/90 bg-rose-50/82",
  },
];

const PREVIEW_REQUEST_TIMEOUT_MS = 10_000;
const LOCATION_CONTEXT_SUCCESS_REFRESH_INTERVAL_MS = 120_000;
const LOCATION_CONTEXT_RETRY_INTERVAL_MS = 30_000;
const MOBILE_HOME_TAB_STORAGE_KEY = "wsMobileHomeTab";
const MOBILE_HOME_LOCATION_MODE_STORAGE_KEY = "wsMobileHomeLocationMode";
const MOBILE_HOME_PREFERRED_AREA_STORAGE_KEY = "wsMobileHomePreferredArea";
const LEGACY_MOBILE_HOME_MANUAL_AREA_STORAGE_KEY = "wsMobileHomeManualArea";
const MOBILE_TAB_SWIPE_THRESHOLD_PX = 72;
const MOBILE_TAB_SWIPE_INTENT_PX = 16;
const MOBILE_TAB_SWIPE_INTENT_RATIO = 1.2;
const MOBILE_TAB_EDGE_DAMPING = 0.35;
const MOBILE_TAB_PANEL_GAP_PX = 10;
const HOME_PREVIEW_CACHE_STORAGE_KEY = "wsHomePreviewCacheV1";
const HOME_PREVIEW_CACHE_MAX_AGE_MS = 20 * 60_000;
const LOCATION_CONTEXT_CACHE_STORAGE_KEY = "wsHomeLocationContextCacheV1";
const LOCATION_CONTEXT_CACHE_MAX_AGE_MS = 45 * 60_000;
const LOCATION_CONTEXT_CACHE_MAX_ENTRIES = 8;
const GEOLOCATION_TIMEOUT_MS = 10_000;
const POOR_GPS_ACCURACY_THRESHOLD_METERS = 1000;

type LocationContextCacheValue = {
  context: WeatherLocationContext;
  savedAt: number;
};

type LocationContextCacheStorageEntry = LocationContextCacheValue & {
  key: string;
};

const LazyForecastTimelineCard = lazy(() =>
  import("../components/ForecastTimelineCard").then((module) => ({
    default: module.ForecastTimelineCard,
  }))
);

const fallbackPreviewItems: HomePreviewItem[] = [
  {
    id: "demo-rain-1",
    name: "KLCC Precip Gauge",
    location: "Kuala Lumpur City Centre",
    type: "rain",
    unit: "mm/h",
    value: 1.2,
    latitude: 3.1563,
    longitude: 101.7117,
  },
  {
    id: "demo-rain-2",
    name: "Batu Caves Precip Gauge",
    location: "Batu Caves",
    type: "rain",
    unit: "mm/h",
    value: 4.8,
    latitude: 3.2379,
    longitude: 101.6843,
  },
  {
    id: "demo-rain-3",
    name: "Putrajaya Precip Gauge",
    location: "Presint 9, Putrajaya",
    type: "rain",
    unit: "mm/h",
    value: 0,
    latitude: 2.9264,
    longitude: 101.6964,
  },
  {
    id: "demo-water-1",
    name: "Sungai Klang Watch",
    location: "Masjid Jamek",
    type: "water_level",
    unit: "m",
    value: 2.4,
    latitude: 3.149,
    longitude: 101.695,
  },
  {
    id: "demo-water-2",
    name: "Sungai Gombak Watch",
    location: "Jalan Tun Razak",
    type: "water_level",
    unit: "m",
    value: 1.8,
    latitude: 3.166,
    longitude: 101.72,
  },
  {
    id: "demo-water-3",
    name: "Ampang Spillway",
    location: "Ampang",
    type: "water_level",
    unit: "m",
    value: 1.3,
    latitude: 3.1498,
    longitude: 101.7611,
  },
  {
    id: "demo-temp-1",
    name: "Subang Weather Mast",
    location: "Subang Jaya",
    type: "temperature",
    unit: "C",
    value: 31.6,
    latitude: 3.081,
    longitude: 101.585,
  },
  {
    id: "demo-temp-2",
    name: "Cyberjaya Weather Mast",
    location: "Cyberjaya",
    type: "temperature",
    unit: "C",
    value: 30.9,
    latitude: 2.9225,
    longitude: 101.6501,
  },
  {
    id: "demo-temp-3",
    name: "Genting Weather Mast",
    location: "Genting Highlands",
    type: "temperature",
    unit: "C",
    value: 23.4,
    latitude: 3.4238,
    longitude: 101.7932,
  },
];

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSensorType(value: unknown): value is SensorType {
  return value === "rain" || value === "water_level" || value === "temperature";
}

function isWeatherLocationContextValue(
  value: unknown
): value is WeatherLocationContext {
  if (!isObjectRecord(value)) return false;
  if (
    value.status !== "ok" &&
    value.status !== "unavailable" &&
    value.status !== "error"
  ) {
    return false;
  }

  const location = value.location;
  if (!isObjectRecord(location)) return false;
  if (typeof location.label !== "string" || !location.label.trim()) return false;
  if (!isFiniteNumber(location.latitude) || !isFiniteNumber(location.longitude)) {
    return false;
  }

  return true;
}

function normalizePreviewCacheItems(value: unknown): HomePreviewItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isObjectRecord(item)) return [];
    if (typeof item.id !== "string" || !item.id.trim()) return [];
    if (typeof item.name !== "string" || !item.name.trim()) return [];
    if (typeof item.location !== "string" || !item.location.trim()) return [];
    if (!isSensorType(item.type)) return [];
    if (typeof item.unit !== "string") return [];

    const nextItem: HomePreviewItem = {
      id: item.id,
      name: item.name,
      location: item.location,
      type: item.type,
      unit: item.unit,
      latitude: isFiniteNumber(item.latitude) ? item.latitude : null,
      longitude: isFiniteNumber(item.longitude) ? item.longitude : null,
      value: isFiniteNumber(item.value) ? item.value : null,
      timestamp: typeof item.timestamp === "string" ? item.timestamp : null,
      source: typeof item.source === "string" ? item.source : undefined,
    };

    return [nextItem];
  });
}

function readCachedHomePreviewItems(): HomePreviewItem[] | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(HOME_PREVIEW_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed) || !isFiniteNumber(parsed.savedAt)) return null;
    if (Date.now() - parsed.savedAt > HOME_PREVIEW_CACHE_MAX_AGE_MS) return null;

    const items = normalizePreviewCacheItems(parsed.items);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function writeCachedHomePreviewItems(items: HomePreviewItem[]): void {
  if (typeof window === "undefined" || items.length === 0) return;

  try {
    window.localStorage.setItem(
      HOME_PREVIEW_CACHE_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        items,
      })
    );
  } catch {
    // Storage write failures should not block rendering.
  }
}

function readCachedLocationContextEntries(): LocationContextCacheStorageEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(LOCATION_CONTEXT_CACHE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed) || !Array.isArray(parsed.entries)) return [];

    const now = Date.now();
    const entries = parsed.entries
      .flatMap((entry): LocationContextCacheStorageEntry[] => {
        if (!isObjectRecord(entry)) return [];
        if (typeof entry.key !== "string" || !entry.key.trim()) return [];
        if (!isFiniteNumber(entry.savedAt)) return [];
        if (now - entry.savedAt > LOCATION_CONTEXT_CACHE_MAX_AGE_MS) return [];
        if (!isWeatherLocationContextValue(entry.context)) return [];

        return [
          {
            key: entry.key,
            savedAt: entry.savedAt,
            context: entry.context,
          },
        ];
      })
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, LOCATION_CONTEXT_CACHE_MAX_ENTRIES);

    return entries;
  } catch {
    return [];
  }
}

function writeCachedLocationContextEntries(
  entries: LocationContextCacheStorageEntry[]
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      LOCATION_CONTEXT_CACHE_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        entries,
      })
    );
  } catch {
    // Storage write failures should not block rendering.
  }
}

function getMostRecentLocationContextFromCache(
  cache: Map<string, LocationContextCacheValue>
): WeatherLocationContext | null {
  let latestContext: WeatherLocationContext | null = null;
  let latestSavedAt = Number.NEGATIVE_INFINITY;

  cache.forEach((entry) => {
    if (entry.savedAt > latestSavedAt) {
      latestSavedAt = entry.savedAt;
      latestContext = entry.context;
    }
  });

  return latestContext;
}

function formatReadingValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(1).replace(/\.0$/, "");
}

function normalizeUnit(unit?: string): string {
  if (!unit) return "";
  if (unit === "C") return "°C";
  return unit;
}

function precipitationLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0.1) return "No precip";
  if (value < 2) return "Light precip";
  if (value < 7.5) return "Moderate precip";
  if (value < 15) return "Steady precip";
  if (value < 30) return "Heavy precip";
  return "Very heavy precip";
}

function hasCoordinates(
  item: PreviewItem
): item is PreviewItem & {
  latitude: number;
  longitude: number;
} {
  return (
    typeof item.latitude === "number" &&
    Number.isFinite(item.latitude) &&
    typeof item.longitude === "number" &&
    Number.isFinite(item.longitude)
  );
}

function formatPreviewDisplay(item: HomePreviewItem): {
  value: number | null;
  display: string;
} {
  if (item.value === null || item.value === undefined) {
    return { value: null, display: "Waiting data" };
  }

  const value = Number(item.value);
  const unit = normalizeUnit(item.unit);

  if (item.type === "rain") {
    const label = precipitationLabel(value);
    const numeric = unit ? `${formatReadingValue(value)} ${unit}` : formatReadingValue(value);
    return {
      value,
      display: label === "No precip" ? label : `${label} · ${numeric}`,
    };
  }

  return {
    value,
    display: unit ? `${formatReadingValue(value)} ${unit}` : formatReadingValue(value),
  };
}

function dedupeLocationOptions(
  items: Array<{
    id?: string;
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }>
): SensorLocationOption[] {
  const byLabel = new Map<string, SensorLocationOption>();

  items.forEach((item) => {
    const label = String(item.location || "").trim();
    const latitude = item.latitude;
    const longitude = item.longitude;
    if (!label) return;
    if (typeof latitude !== "number" || !Number.isFinite(latitude)) return;
    if (typeof longitude !== "number" || !Number.isFinite(longitude)) return;

    const key = label.toLowerCase();
    if (byLabel.has(key)) return;

    byLabel.set(key, {
      id: item.id || key,
      label,
      latitude,
      longitude,
    });
  });

  return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function haversineDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestLocationLabel(
  latitude: number,
  longitude: number,
  options: SensorLocationOption[]
): string {
  if (options.length === 0) return "Current area";

  let closest = options[0];
  let closestDistance = haversineDistanceKm(
    latitude,
    longitude,
    closest.latitude,
    closest.longitude
  );

  options.slice(1).forEach((option) => {
    const distance = haversineDistanceKm(
      latitude,
      longitude,
      option.latitude,
      option.longitude
    );
    if (distance < closestDistance) {
      closest = option;
      closestDistance = distance;
    }
  });

  return closest.label;
}

function readStoredMobileHomeTab(): MobileHomeTab {
  if (typeof window === "undefined") return "forecast";
  const raw = window.localStorage.getItem(MOBILE_HOME_TAB_STORAGE_KEY);
  return raw === "map" ? "map" : "forecast";
}

function readStoredManualArea(): SensorLocationOption | null {
  if (typeof window === "undefined") return null;

  try {
    const raw =
      window.localStorage.getItem(MOBILE_HOME_PREFERRED_AREA_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_MOBILE_HOME_MANUAL_AREA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.label !== "string" ||
      typeof parsed?.latitude !== "number" ||
      typeof parsed?.longitude !== "number"
    ) {
      return null;
    }

    return {
      id: parsed.id || parsed.label.toLowerCase(),
      label: parsed.label,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
    };
  } catch {
    return null;
  }
}

function readStoredLocationMode(
  hasStoredManualArea: boolean
): "gps" | "manual" {
  if (typeof window === "undefined") {
    return hasStoredManualArea ? "manual" : "gps";
  }

  const raw = window.localStorage.getItem(MOBILE_HOME_LOCATION_MODE_STORAGE_KEY);
  if (raw === "manual" && hasStoredManualArea) return "manual";
  return "gps";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function buildForecastTargetKey(target: {
  latitude: number;
  longitude: number;
  label: string;
  mode: "gps" | "manual";
}): string {
  return [
    target.latitude.toFixed(3),
    target.longitude.toFixed(3),
    target.mode,
    target.label.trim().toLowerCase(),
  ].join("|");
}

function shouldLogHomeDataError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (!(error instanceof Error)) return true;

  return (
    error.name !== "BackendPayloadError" && error.name !== "ForecastRateLimitError"
  );
}

function logHomeDataError(error: unknown): void {
  if (shouldLogHomeDataError(error)) {
    console.error(error);
  }
}

export default function Home() {
  const isClient = typeof window !== "undefined";
  const hasLoadedPreviewRef = useRef(false);
  const hasHydratedLocalCachesRef = useRef(false);
  const mapPauseTimeoutRef = useRef<number | null>(null);
  const mobileTabSwipeRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    tracking: boolean;
    horizontalIntent: boolean;
  }>({
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    tracking: false,
    horizontalIntent: false,
  });
  const [mobileTabDragOffsetPx, setMobileTabDragOffsetPx] = useState(0);
  const [mobileTabIsDragging, setMobileTabIsDragging] = useState(false);
  const [previewItems, setPreviewItems] = useState<HomePreviewItem[]>([]);
  const previewItemsRef = useRef<HomePreviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFallbackPreview, setIsFallbackPreview] = useState(false);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null);
  const [desktopGpsCoords, setDesktopGpsCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [desktopGpsAccuracyMeters, setDesktopGpsAccuracyMeters] = useState<number | null>(
    null
  );
  const [desktopLocationState, setDesktopLocationState] = useState<
    "idle" | "locating" | "ready" | "unavailable"
  >("idle");
  const [desktopLocationMessage, setDesktopLocationMessage] = useState<string | null>(
    null
  );
  const [desktopLocationRequestKey, setDesktopLocationRequestKey] = useState(0);
  const [locationOptions, setLocationOptions] = useState<SensorLocationOption[]>(
    dedupeLocationOptions(fallbackPreviewItems)
  );
  const [mobileTab, setMobileTab] = useState<MobileHomeTab>(() =>
    readStoredMobileHomeTab()
  );
  const [manualArea, setManualArea] = useState<SensorLocationOption | null>(() =>
    readStoredManualArea()
  );
  const [manualAreaPickerOpen, setManualAreaPickerOpen] = useState(false);
  const [locationMode, setLocationMode] = useState<"gps" | "manual">(
    readStoredLocationMode(Boolean(readStoredManualArea()))
  );
  const [gpsCoords, setGpsCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [locationState, setLocationState] = useState<
    "idle" | "locating" | "ready" | "needs_manual"
  >(
    readStoredLocationMode(Boolean(readStoredManualArea())) === "manual" &&
      readStoredManualArea()
      ? "ready"
      : "idle"
  );
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationRequestKey, setLocationRequestKey] = useState(0);
  const [locationContext, setLocationContext] = useState<WeatherLocationContext | null>(
    null
  );
  const locationContextStateRef = useRef<WeatherLocationContext | null>(null);
  const locationContextCacheRef = useRef<Map<string, LocationContextCacheValue>>(
    new Map()
  );
  const [locationContextLoading, setLocationContextLoading] = useState(false);
  const [locationContextError, setLocationContextError] = useState<string | null>(null);
  const [locationContextNotice, setLocationContextNotice] = useState<string | null>(
    null
  );
  const [locationContextErrorTone, setLocationContextErrorTone] = useState<
    "warning" | "neutral"
  >("neutral");
  const [mobileForecastMetric, setMobileForecastMetric] = useState<"rain" | "temperature">(
    "rain"
  );
  const [mobileMapLayer, setMobileMapLayer] = useState<
    "precipitation" | "temperature"
  >("precipitation");
  const [mobileMapFrameIndex, setMobileMapFrameIndex] = useState(0);
  const [mobileMapPaused, setMobileMapPaused] = useState(false);
  const isSmallViewport = useMediaQuery("(max-width: 639px)");
  const isCoarsePointer = useMediaQuery("(pointer: coarse), (hover: none)");
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const prefersStablePreview = isCoarsePointer || isSmallViewport;
  const shouldToneDownMotion = prefersReducedMotion || prefersStablePreview;
  const isMobileHome = isSmallViewport || isCoarsePointer;
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );

  function requestCurrentLocation() {
    if (!isClient) return;

    if (!navigator.geolocation) {
      setLocationMode("manual");
      setLocationState(manualArea ? "ready" : "needs_manual");
      setManualAreaPickerOpen(!manualArea);
      setLocationMessage(
        manualArea
          ? "Location access isn’t available here. Showing your saved area instead."
          : "Location access isn’t available here. Choose an area instead."
      );
      return;
    }

    setLocationState("locating");
    setLocationMessage(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setGpsAccuracyMeters(
          Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null
        );
        setLocationMode("gps");
        setLocationState("ready");
        setManualAreaPickerOpen(false);
        setLocationContextError(null);
      },
      (error) => {
        logHomeDataError(error);
        setGpsAccuracyMeters(null);
        setLocationMode("manual");
        setLocationState(manualArea ? "ready" : "needs_manual");
        setManualAreaPickerOpen(!manualArea);
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? manualArea
              ? "Location access is off. Showing your saved area instead."
              : "Location access is off. Choose an area to keep the forecast local."
            : manualArea
              ? "We couldn’t confirm your current location. Showing your saved area instead."
              : "We couldn’t confirm your current location. Choose an area below."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: 0,
      }
    );
  }

  function requestDesktopLocation() {
    if (!isClient) return;

    if (!navigator.geolocation) {
      setDesktopGpsCoords(null);
      setDesktopLocationState("unavailable");
      setDesktopLocationMessage(
        "Current-location access isn’t available here. Click a live station to pin its forecast."
      );
      return;
    }

    setDesktopLocationState("locating");
    setDesktopLocationMessage(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDesktopGpsCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setDesktopGpsAccuracyMeters(
          Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null
        );
        setDesktopLocationState("ready");
        setDesktopLocationMessage(null);
        setLocationContextError(null);
      },
      (error) => {
        logHomeDataError(error);
        setDesktopGpsCoords(null);
        setDesktopGpsAccuracyMeters(null);
        setDesktopLocationState("unavailable");
        setDesktopLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location access is off. Allow it to keep the forecast centered on you, or click a live station below."
            : "We couldn’t confirm your current location. Click a live station below to pin its forecast."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: 0,
      }
    );
  }

  function handleMapInteraction() {
    if (!isClient) return;
    setMobileMapPaused(true);
    if (mapPauseTimeoutRef.current !== null) {
      window.clearTimeout(mapPauseTimeoutRef.current);
    }
    mapPauseTimeoutRef.current = window.setTimeout(() => {
      setMobileMapPaused(false);
    }, 5000);
  }

  function commitMobileTab(nextTab: MobileHomeTab) {
    setMobileTabIsDragging(false);
    setMobileTabDragOffsetPx(0);
    startTransition(() => {
      setMobileTab((current) => (current === nextTab ? current : nextTab));
    });
  }

  function resetMobileTabTrack() {
    setMobileTabIsDragging(false);
    setMobileTabDragOffsetPx(0);
  }

  function resetMobileTabSwipe() {
    mobileTabSwipeRef.current = {
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      tracking: false,
      horizontalIntent: false,
    };
  }

  function handleMobileModeSwipeStart(event: ReactTouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (!touch) return;

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        '[data-no-mode-swipe="true"], button, a, input, select, textarea, [role="button"]'
      )
    ) {
      resetMobileTabSwipe();
      return;
    }

    mobileTabSwipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      tracking: true,
      horizontalIntent: false,
    };
  }

  function handleMobileModeSwipeMove(event: ReactTouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    const swipe = mobileTabSwipeRef.current;
    if (!touch || !swipe.tracking) return;

    swipe.lastX = touch.clientX;
    swipe.lastY = touch.clientY;

    const deltaX = swipe.lastX - swipe.startX;
    const deltaY = swipe.lastY - swipe.startY;
    const absoluteDeltaX = Math.abs(deltaX);
    const absoluteDeltaY = Math.abs(deltaY);

    if (!swipe.horizontalIntent) {
      if (
        absoluteDeltaY >= MOBILE_TAB_SWIPE_INTENT_PX &&
        absoluteDeltaY > absoluteDeltaX * MOBILE_TAB_SWIPE_INTENT_RATIO
      ) {
        resetMobileTabSwipe();
        return;
      }

      if (
        absoluteDeltaX >= MOBILE_TAB_SWIPE_INTENT_PX &&
        absoluteDeltaX > absoluteDeltaY * MOBILE_TAB_SWIPE_INTENT_RATIO
      ) {
        swipe.horizontalIntent = true;
        setMobileTabIsDragging(true);
      }
    }

    if (swipe.horizontalIntent) {
      let nextDragOffsetPx = deltaX;
      if (
        (mobileTab === "forecast" && nextDragOffsetPx > 0) ||
        (mobileTab === "map" && nextDragOffsetPx < 0)
      ) {
        nextDragOffsetPx *= MOBILE_TAB_EDGE_DAMPING;
      }

      setMobileTabDragOffsetPx(nextDragOffsetPx);
    }

    if (swipe.horizontalIntent && event.cancelable) {
      event.preventDefault();
    }
  }

  function handleMobileModeSwipeEnd() {
    const swipe = mobileTabSwipeRef.current;
    if (!swipe.tracking || !swipe.horizontalIntent) {
      resetMobileTabTrack();
      resetMobileTabSwipe();
      return;
    }

    const deltaX = swipe.lastX - swipe.startX;
    const deltaY = swipe.lastY - swipe.startY;
    const absoluteDeltaX = Math.abs(deltaX);
    const absoluteDeltaY = Math.abs(deltaY);

    if (
      absoluteDeltaX >= MOBILE_TAB_SWIPE_THRESHOLD_PX &&
      absoluteDeltaX > absoluteDeltaY * MOBILE_TAB_SWIPE_INTENT_RATIO
    ) {
      if (deltaX < 0 && mobileTab !== "map") {
        commitMobileTab("map");
      } else if (deltaX > 0 && mobileTab !== "forecast") {
        commitMobileTab("forecast");
      } else {
        resetMobileTabTrack();
      }
    } else {
      resetMobileTabTrack();
    }

    resetMobileTabSwipe();
  }

  useEffect(() => {
    if (!isClient) return;
    window.localStorage.setItem(MOBILE_HOME_TAB_STORAGE_KEY, mobileTab);
  }, [isClient, mobileTab]);

  useEffect(() => {
    if (!isClient) return;
    window.localStorage.setItem(MOBILE_HOME_LOCATION_MODE_STORAGE_KEY, locationMode);
  }, [isClient, locationMode]);

  useEffect(() => {
    if (!isClient) return;

    if (manualArea) {
      window.localStorage.setItem(
        MOBILE_HOME_PREFERRED_AREA_STORAGE_KEY,
        JSON.stringify(manualArea)
      );
      window.localStorage.removeItem(LEGACY_MOBILE_HOME_MANUAL_AREA_STORAGE_KEY);
      return;
    }

    window.localStorage.removeItem(MOBILE_HOME_PREFERRED_AREA_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_MOBILE_HOME_MANUAL_AREA_STORAGE_KEY);
  }, [isClient, manualArea]);

  useEffect(() => {
    previewItemsRef.current = previewItems;
  }, [previewItems]);

  useEffect(() => {
    locationContextStateRef.current = locationContext;
  }, [locationContext]);

  useEffect(() => {
    if (!isClient || hasHydratedLocalCachesRef.current) return;
    hasHydratedLocalCachesRef.current = true;

    const cachedPreviewItems = readCachedHomePreviewItems();
    if (cachedPreviewItems && cachedPreviewItems.length > 0) {
      setPreviewItems(cachedPreviewItems);
      setPreviewLoading(false);
      setPreviewError(null);
      setIsFallbackPreview(false);
    }

    const cachedLocationContextEntries = readCachedLocationContextEntries();
    if (cachedLocationContextEntries.length === 0) return;

    locationContextCacheRef.current = new Map(
      cachedLocationContextEntries.map((entry) => [
        entry.key,
        { context: entry.context, savedAt: entry.savedAt },
      ])
    );

    const latestCachedContext = cachedLocationContextEntries[0]?.context;
    if (!latestCachedContext) return;

    setLocationContext((current) => current ?? latestCachedContext);
    setLocationContextNotice(
      (current) => current ?? "Showing a recent forecast snapshot while live data loads."
    );
    setLocationContextError(null);
    setLocationContextErrorTone("neutral");
  }, [isClient]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function loadLocationOptions() {
      try {
        const response = await fetch(`${API_BASE}/sensors`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const nextOptions = dedupeLocationOptions(
          Array.isArray(data?.sensors) ? data.sensors : []
        );
        if (!isMounted || nextOptions.length === 0) return;
        setLocationOptions(nextOptions);
      } catch (error) {
        logHomeDataError(error);
      }
    }

    loadLocationOptions();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!isMobileHome) return;

    if (locationMode === "manual") {
      setLocationState(manualArea ? "ready" : "needs_manual");
      setManualAreaPickerOpen(!manualArea);
      return;
    }

    requestCurrentLocation();
  }, [isMobileHome, locationMode, locationRequestKey, manualArea]);

  useEffect(() => {
    if (isMobileHome) return;
    requestDesktopLocation();
  }, [desktopLocationRequestKey, isMobileHome]);

  useEffect(() => {
    if (isMobileHome) {
      setPreviewItems([]);
      setPreviewLoading(false);
      setPreviewError(null);
      setIsFallbackPreview(false);
      return;
    }

    let isMounted = true;
    let refreshTimer: number | null = null;
    let isRequestInFlight = false;

    const scheduleNextRefresh = () => {
      if (!isMounted) return;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        void loadPreview(false);
      }, 60_000);
    };

    async function loadPreview(isInitialLoad: boolean) {
      if (!isMounted || isRequestInFlight) return;
      isRequestInFlight = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => {
        controller.abort(new DOMException("Home preview request timed out.", "AbortError"));
      }, PREVIEW_REQUEST_TIMEOUT_MS);

      try {
        if (isInitialLoad && previewItemsRef.current.length === 0) {
          const cachedPreviewItems = readCachedHomePreviewItems();
          if (cachedPreviewItems && cachedPreviewItems.length > 0) {
            setPreviewItems(cachedPreviewItems);
            setIsFallbackPreview(false);
            setPreviewLoading(false);
          } else {
            setPreviewLoading(true);
          }
          setPreviewError(null);
        }

        const response = await fetch(`${API_BASE}/home-preview`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const nextItems = Array.isArray(data?.items) ? data.items : [];

        if (!isMounted) return;

        if (nextItems.length === 0) {
          if (previewItemsRef.current.length === 0) {
            setPreviewItems(fallbackPreviewItems);
            setIsFallbackPreview(true);
          }
          setPreviewError(null);
          return;
        }

        setPreviewItems(nextItems);
        setIsFallbackPreview(false);
        setPreviewError(null);
        writeCachedHomePreviewItems(nextItems);
      } catch (error) {
        logHomeDataError(error);
        if (!isMounted) return;

        if (previewItemsRef.current.length === 0) {
          const cachedPreviewItems = readCachedHomePreviewItems();
          if (cachedPreviewItems && cachedPreviewItems.length > 0) {
            setPreviewItems(cachedPreviewItems);
            setIsFallbackPreview(false);
          } else {
            setPreviewItems(fallbackPreviewItems);
            setIsFallbackPreview(true);
          }
        }
        setPreviewError(null);
      } finally {
        window.clearTimeout(timeout);
        isRequestInFlight = false;
        if (!isMounted) return;
        hasLoadedPreviewRef.current = true;
        setPreviewLoading(false);
        scheduleNextRefresh();
      }
    }

    void loadPreview(!hasLoadedPreviewRef.current);
    return () => {
      isMounted = false;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [isMobileHome]);

  const previewByType = useMemo(() => {
    const grouped: PreviewByType = {
      rain: [],
      water_level: [],
      temperature: [],
    };

    previewItems.forEach((item) => {
      if (
        item.type !== "rain" &&
        item.type !== "water_level" &&
        item.type !== "temperature"
      ) {
        return;
      }

      const formatted = formatPreviewDisplay(item);
      grouped[item.type].push({
        id: item.id,
        name: item.name,
        location: item.location,
        type: item.type,
        display: formatted.display,
        value: formatted.value,
        latitude: item.latitude,
        longitude: item.longitude,
      });
    });

    (Object.keys(grouped) as SensorType[]).forEach((type) => {
      grouped[type].sort((a, b) => {
        const aValue = a.value ?? Number.NEGATIVE_INFINITY;
        const bValue = b.value ?? Number.NEGATIVE_INFINITY;
        if (bValue !== aValue) return bValue - aValue;
        return a.name.localeCompare(b.name);
      });
    });

    return grouped;
  }, [previewItems]);

  const hasAnyPreviewItems = useMemo(
    () => Object.values(previewByType).some((items) => items.length > 0),
    [previewByType]
  );

  const desktopPreviewByType = useMemo(
    () =>
      ({
        rain: previewByType.rain.slice(0, 2),
        water_level: previewByType.water_level.slice(0, 2),
        temperature: previewByType.temperature.slice(0, 2),
      }) satisfies PreviewByType,
    [previewByType]
  );

  const desktopPreviewItems = useMemo(
    () => previewSections.flatMap((section) => desktopPreviewByType[section.type]),
    [desktopPreviewByType]
  );

  const activePreviewId = hoveredPreviewId ?? selectedPreviewId;

  useEffect(() => {
    if (desktopPreviewItems.length === 0) {
      setSelectedPreviewId(null);
      return;
    }

    setSelectedPreviewId((current) =>
      current && desktopPreviewItems.some((item) => item.id === current)
        ? current
        : null
    );
  }, [desktopPreviewItems]);

  useEffect(() => {
    if (prefersStablePreview) {
      setHoveredPreviewId(null);
    }
  }, [prefersStablePreview]);

  const desktopMapItems = useMemo(
    () => desktopPreviewItems.filter(hasCoordinates),
    [desktopPreviewItems]
  );

  const desktopPinnedPreview = useMemo(() => {
    const selectedPreview =
      selectedPreviewId !== null
        ? desktopPreviewItems.find((item) => item.id === selectedPreviewId) ?? null
        : null;

    if (selectedPreview && hasCoordinates(selectedPreview)) {
      return selectedPreview;
    }

    return null;
  }, [desktopPreviewItems, selectedPreviewId]);

  const desktopGpsLabel = useMemo(() => {
    if (!desktopGpsCoords) return "Current area";
    return findNearestLocationLabel(
      desktopGpsCoords.latitude,
      desktopGpsCoords.longitude,
      locationOptions
    );
  }, [desktopGpsCoords, locationOptions]);

  const gpsLabel = useMemo(() => {
    if (!gpsCoords) return "Current area";
    return findNearestLocationLabel(
      gpsCoords.latitude,
      gpsCoords.longitude,
      locationOptions
    );
  }, [gpsCoords, locationOptions]);

  const mobileLocationTarget = useMemo(() => {
    if (!isMobileHome) return null;

    if (locationMode === "gps" && gpsCoords) {
      return {
        latitude: gpsCoords.latitude,
        longitude: gpsCoords.longitude,
        label: gpsLabel,
        mode: "gps" as const,
      };
    }

    if (manualArea) {
      return {
        latitude: manualArea.latitude,
        longitude: manualArea.longitude,
        label: manualArea.label,
        mode: "manual" as const,
      };
    }

    return null;
  }, [gpsCoords, gpsLabel, isMobileHome, locationMode, manualArea]);

  const desktopForecastTarget = useMemo(() => {
    if (isMobileHome) {
      return null;
    }

    if (desktopPinnedPreview) {
      return {
        latitude: desktopPinnedPreview.latitude,
        longitude: desktopPinnedPreview.longitude,
        label: desktopPinnedPreview.location,
        mode: "manual" as const,
      };
    }

    if (desktopGpsCoords) {
      return {
        latitude: desktopGpsCoords.latitude,
        longitude: desktopGpsCoords.longitude,
        label: desktopGpsLabel,
        mode: "gps" as const,
      };
    }

    return null;
  }, [desktopGpsCoords, desktopGpsLabel, desktopPinnedPreview, isMobileHome]);

  const activeForecastTarget = isMobileHome
    ? mobileLocationTarget
    : desktopForecastTarget;

  useEffect(() => {
    if (!isClient) return;

    const syncVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };

    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, [isClient]);

  useEffect(() => {
    if (!activeForecastTarget) {
      setLocationContextLoading(false);
      if (!locationContextStateRef.current) {
        setLocationContextError(null);
        setLocationContextNotice(null);
        setLocationContextErrorTone("neutral");
      }
      return;
    }

    if (!isPageVisible) {
      setLocationContextLoading(false);
      return;
    }

    let isMounted = true;
    const target = activeForecastTarget;
    const targetKey = buildForecastTargetKey(target);
    let refreshTimer: number | null = null;
    let isRequestInFlight = false;

    const persistLocationContextCache = () => {
      const entries = Array.from(locationContextCacheRef.current.entries())
        .map(([key, value]) => ({
          key,
          savedAt: value.savedAt,
          context: value.context,
        }))
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(0, LOCATION_CONTEXT_CACHE_MAX_ENTRIES);

      locationContextCacheRef.current = new Map(
        entries.map((entry) => [
          entry.key,
          { context: entry.context, savedAt: entry.savedAt },
        ])
      );
      writeCachedLocationContextEntries(entries);
    };

    const readCachedContextForTarget = () =>
      locationContextCacheRef.current.get(targetKey)?.context ?? null;
    const readBestCachedContext = () =>
      readCachedContextForTarget() ??
      getMostRecentLocationContextFromCache(locationContextCacheRef.current);
    const cacheFreshLocationContext = (context: WeatherLocationContext) => {
      locationContextCacheRef.current.set(targetKey, {
        context,
        savedAt: Date.now(),
      });
      persistLocationContextCache();
    };

    const scheduleNextRefresh = (delayMs: number) => {
      if (!isMounted) return;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        void loadLocationContext();
      }, delayMs);
    };

    const cachedContextForTarget = readCachedContextForTarget();
    if (cachedContextForTarget) {
      setLocationContext(cachedContextForTarget);
      setLocationContextError(null);
      setLocationContextNotice(null);
      setLocationContextErrorTone("neutral");
    } else {
      const fallbackCachedContext = getMostRecentLocationContextFromCache(
        locationContextCacheRef.current
      );
      if (fallbackCachedContext) {
        setLocationContext((current) => current ?? fallbackCachedContext);
        setLocationContextError(null);
        setLocationContextNotice(
          "Showing the latest available forecast while refresh catches up."
        );
        setLocationContextErrorTone("neutral");
      } else {
        setLocationContext(null);
        setLocationContextError(null);
        setLocationContextNotice(null);
        setLocationContextErrorTone("neutral");
      }
    }

    async function loadLocationContext() {
      if (!isMounted || isRequestInFlight) return;
      isRequestInFlight = true;
      const hasCachedContext = Boolean(readBestCachedContext());

      try {
        if (!hasCachedContext) {
          setLocationContextLoading(true);
          setLocationContextError(null);
        }
        const nextContext = await fetchLocationForecastContext({
          latitude: target.latitude,
          longitude: target.longitude,
          radiusKm: 8,
          label: target.label,
          mode: target.mode,
        });
        if (!isMounted) return;
        if (nextContext.status === "ok") {
          cacheFreshLocationContext(nextContext);
          setLocationContext(nextContext);
          setLocationContextError(null);
          setLocationContextNotice(null);
          setLocationContextErrorTone("neutral");
          scheduleNextRefresh(LOCATION_CONTEXT_SUCCESS_REFRESH_INTERVAL_MS);
          return;
        }

        const cached = readBestCachedContext();
        if (cached) {
          setLocationContext(cached);
          setLocationContextError(null);
          setLocationContextNotice(
            "Showing the latest available forecast while refresh catches up."
          );
          setLocationContextErrorTone("neutral");
          scheduleNextRefresh(LOCATION_CONTEXT_SUCCESS_REFRESH_INTERVAL_MS);
          return;
        }

        setLocationContext(null);
        setLocationContextNotice(null);
        setLocationContextError("Forecast is temporarily unavailable.");
        setLocationContextErrorTone("neutral");
        scheduleNextRefresh(LOCATION_CONTEXT_RETRY_INTERVAL_MS);
      } catch (error) {
        logHomeDataError(error);
        if (!isMounted) return;
        const cached = readBestCachedContext();
        if (cached) {
          setLocationContext(cached);
          setLocationContextError(null);
          if (isForecastRateLimitError(error)) {
            setLocationContextNotice(
              `Showing the latest available forecast while refresh is rate-limited (${error.retryAfterSeconds}s).`
            );
            setLocationContextErrorTone("warning");
            scheduleNextRefresh(
              Math.max(
                LOCATION_CONTEXT_SUCCESS_REFRESH_INTERVAL_MS,
                error.retryAfterSeconds * 1000
              )
            );
          } else if (isAbortError(error)) {
            setLocationContextNotice(
              "Showing the latest available forecast while refresh is taking longer than expected."
            );
            setLocationContextErrorTone("neutral");
            scheduleNextRefresh(LOCATION_CONTEXT_SUCCESS_REFRESH_INTERVAL_MS);
          } else {
            setLocationContextNotice(
              "Showing the latest available forecast while refresh catches up."
            );
            setLocationContextErrorTone("neutral");
            scheduleNextRefresh(LOCATION_CONTEXT_SUCCESS_REFRESH_INTERVAL_MS);
          }
          return;
        }

        setLocationContextNotice(null);
        if (isForecastRateLimitError(error)) {
          setLocationContextError("Forecast is temporarily rate-limited. Try again shortly.");
          setLocationContextErrorTone("warning");
          scheduleNextRefresh(
            Math.max(LOCATION_CONTEXT_RETRY_INTERVAL_MS, error.retryAfterSeconds * 1000)
          );
          return;
        }

        setLocationContextError("Forecast is temporarily unavailable.");
        setLocationContextErrorTone("neutral");
        scheduleNextRefresh(LOCATION_CONTEXT_RETRY_INTERVAL_MS);
      } finally {
        isRequestInFlight = false;
        if (isMounted) setLocationContextLoading(false);
      }
    }

    void loadLocationContext();

    return () => {
      isMounted = false;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [activeForecastTarget, isPageVisible]);

  useEffect(() => {
    const frameCount = locationContext?.map?.frames.length ?? 0;
    setMobileMapFrameIndex((current) =>
      frameCount === 0 ? 0 : Math.min(current, frameCount - 1)
    );
  }, [locationContext]);

  useEffect(() => {
    const frameCount = locationContext?.map?.frames.length ?? 0;
    if (
      !isMobileHome ||
      mobileTab !== "map" ||
      mobileMapPaused ||
      prefersReducedMotion ||
      frameCount < 2
    ) {
      return;
    }

    const rotation = window.setInterval(() => {
      setMobileMapFrameIndex((current) => (current + 1) % frameCount);
    }, 1400);

    return () => window.clearInterval(rotation);
  }, [
    isMobileHome,
    locationContext,
    mobileMapPaused,
    mobileTab,
    prefersReducedMotion,
  ]);

  useEffect(() => {
    return () => {
      if (!isClient) return;
      if (mapPauseTimeoutRef.current !== null) {
        window.clearTimeout(mapPauseTimeoutRef.current);
      }
    };
  }, [isClient]);

  const currentLocationSummary = locationContext?.current;
  const currentLocationDaily = locationContext?.daily?.[0];
  const currentLocationNext6h = locationContext?.next_6h;
  const currentLocationWeatherMeta = getWeatherCodeMeta(
    currentLocationSummary?.weather_code,
    currentLocationSummary?.is_day
  );
  const CurrentLocationWeatherIcon = currentLocationWeatherMeta.Icon;
  const currentLocationFrame =
    locationContext?.map?.frames?.[mobileMapFrameIndex] ?? null;
  const shouldShowManualAreaPicker =
    manualAreaPickerOpen || (locationMode === "manual" && !mobileLocationTarget);
  const locationContextErrorClasses =
    locationContextErrorTone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-slate-200/80 bg-white/82 text-slate-600";
  const hasUsableLocationContext = locationContext?.status === "ok";
  const blockingLocationContextError = hasUsableLocationContext
    ? null
    : locationContextError;
  const mobileLocationDisplayLabel =
    mobileLocationTarget?.label ||
    manualArea?.label ||
    locationContext?.location.label ||
    "Choose an area";
  const selectedManualAreaLabel = manualArea?.label ?? "";
  const desktopForecastTitle =
    desktopForecastTarget?.label || locationContext?.location.label || "Current location";
  const desktopForecastCaption = desktopPinnedPreview
    ? `${desktopPinnedPreview.name} pinned from the live sensor board.`
    : desktopForecastTarget
      ? "Using your current location."
      : desktopLocationMessage ||
        "Allow location access or click a live station below to pin its forecast.";
  const mobileGpsAccuracyText =
    locationMode === "gps" && gpsAccuracyMeters !== null
      ? `GPS accuracy: ±${Math.round(gpsAccuracyMeters)} m`
      : null;
  const mobileGpsCoordinatesText =
    locationMode === "gps" && gpsCoords
      ? `Lat/Lng: ${gpsCoords.latitude.toFixed(5)}, ${gpsCoords.longitude.toFixed(5)}`
      : null;
  const mobileShowPoorGpsAccuracyWarning =
    locationMode === "gps" &&
    gpsAccuracyMeters !== null &&
    gpsAccuracyMeters > POOR_GPS_ACCURACY_THRESHOLD_METERS;
  const desktopGpsAccuracyText =
    !desktopPinnedPreview && desktopGpsAccuracyMeters !== null
      ? `GPS accuracy: ±${Math.round(desktopGpsAccuracyMeters)} m`
      : null;
  const desktopGpsCoordinatesText =
    !desktopPinnedPreview && desktopGpsCoords
      ? `Lat/Lng: ${desktopGpsCoords.latitude.toFixed(5)}, ${desktopGpsCoords.longitude.toFixed(5)}`
      : null;
  const desktopShowPoorGpsAccuracyWarning =
    !desktopPinnedPreview &&
    desktopGpsAccuracyMeters !== null &&
    desktopGpsAccuracyMeters > POOR_GPS_ACCURACY_THRESHOLD_METERS;
  const mobileTabTrackBaseTranslate = mobileTab === "forecast" ? "0%" : "-50%";
  const mobileTabTrackTransform = mobileTabIsDragging
    ? `translateX(calc(${mobileTabTrackBaseTranslate} + ${mobileTabDragOffsetPx}px))`
    : `translateX(${mobileTabTrackBaseTranslate})`;
  const mobileTabTrackTransition = mobileTabIsDragging || prefersReducedMotion
    ? "none"
    : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)";
  const mobileSummaryLoading = locationContextLoading && !locationContext;
  const showMobileTargetPendingMessage =
    !locationContext &&
    !blockingLocationContextError &&
    ((!mobileLocationTarget && isMobileHome) ||
      (locationMode === "gps" && locationState === "locating"));
  const mobileForecastPanel = locationContextLoading && !locationContext ? (
    <div className="space-y-3 rounded-[1.7rem] border border-[var(--ws-border-subtle)] bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <div className="ws-skeleton h-5 w-28 rounded-full" />
      <div className="ws-skeleton h-4 w-44 rounded-full" />
      <div className="ws-skeleton h-52 rounded-[1.3rem]" />
    </div>
  ) : showMobileTargetPendingMessage ? (
    <div className="rounded-[1.7rem] border border-slate-200/80 bg-white/82 px-4 py-4 text-sm text-slate-600 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      We&apos;re preparing your nearby forecast view.
    </div>
  ) : blockingLocationContextError ? (
    <div
      className={`rounded-[1.7rem] border px-4 py-4 text-sm shadow-[0_18px_40px_rgba(15,23,42,0.08)] ${locationContextErrorClasses}`}
    >
      {blockingLocationContextError}
    </div>
  ) : (
    <div className="space-y-3">
      {locationContextNotice ? (
        <div
          className={`rounded-[1.25rem] border px-3.5 py-2.5 text-xs ${locationContextErrorClasses}`}
        >
          {locationContextNotice}
        </div>
      ) : null}
      <Suspense
        fallback={
          <div className="space-y-3 rounded-[1.7rem] border border-[var(--ws-border-subtle)] bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <div className="ws-skeleton h-5 w-28 rounded-full" />
            <div className="ws-skeleton h-4 w-44 rounded-full" />
            <div className="ws-skeleton h-52 rounded-[1.3rem]" />
          </div>
        }
      >
        <LazyForecastTimelineCard
          data={locationContext?.hourly_timeline ?? []}
          metric={mobileForecastMetric}
          onMetricChange={setMobileForecastMetric}
          variant="mobile"
        />
      </Suspense>

    </div>
  );
  const mobileMapPanel = (
    <MobileLocationForecastMap
      center={{
        latitude: mobileLocationTarget?.latitude ?? 3.1563,
        longitude: mobileLocationTarget?.longitude ?? 101.7117,
      }}
      radiusKm={locationContext?.map?.radius_km ?? 8}
      samples={locationContext?.map?.samples ?? []}
      frames={locationContext?.map?.frames ?? []}
      frame={currentLocationFrame}
      layer={mobileMapLayer}
      isClient={isClient}
      loading={locationContextLoading && !locationContext}
      error={blockingLocationContextError}
      paused={mobileMapPaused}
      onPausedChange={setMobileMapPaused}
      onLayerChange={setMobileMapLayer}
      onInteract={handleMapInteraction}
    />
  );

  function resetDesktopForecastToCurrentLocation() {
    setSelectedPreviewId(null);
    if (desktopGpsCoords) {
      setDesktopLocationState("ready");
      setDesktopLocationMessage(null);
      return;
    }

    setDesktopLocationRequestKey((current) => current + 1);
  }

  if (isMobileHome) {
    return (
      <main className="min-h-screen">
        <section className="mx-auto max-w-5xl px-4 pb-6 pt-2">
          <div className="space-y-3">
            <MobileDailySummaryCard
              CurrentLocationWeatherIcon={CurrentLocationWeatherIcon}
              displayLocationLabel={mobileLocationDisplayLabel}
              detectedAreaLabel={mobileLocationDisplayLabel}
              error={null}
              errorClasses={locationContextErrorClasses}
              feelsLikeLabel={formatTemperature(
                currentLocationSummary?.apparent_temperature
              )}
              gpsAccuracyText={mobileGpsAccuracyText}
              gpsCoordinatesText={mobileGpsCoordinatesText}
              isLoading={mobileSummaryLoading && !blockingLocationContextError}
              locationMessage={locationMessage}
              locationMode={locationMode}
              locationOptions={locationOptions}
              next6hPrecipLabel={formatPercent(
                currentLocationNext6h?.max_precipitation_probability
              )}
              next6hPrecipSumLabel={formatPrecipAmount(currentLocationNext6h?.rain_sum)}
              onClosePicker={() => setManualAreaPickerOpen(false)}
              onEnableGps={() => {
                setLocationMode("gps");
                setManualAreaPickerOpen(false);
                setLocationRequestKey((current) => current + 1);
              }}
              onSelectManualArea={(nextArea) => {
                setManualArea(nextArea);
                setLocationMode("manual");
                setLocationState(nextArea ? "ready" : "needs_manual");
                setLocationMessage(null);
                if (nextArea) {
                  setManualAreaPickerOpen(false);
                }
              }}
              onSelectManualMode={() => {
                setLocationMode("manual");
                setLocationState(manualArea ? "ready" : "needs_manual");
                setLocationMessage(null);
              }}
              onTogglePicker={() => setManualAreaPickerOpen((current) => !current)}
              pickerOpen={shouldShowManualAreaPicker}
              selectedLocationLabel={selectedManualAreaLabel}
              shouldToneDownMotion={shouldToneDownMotion}
              showPoorGpsAccuracyWarning={mobileShowPoorGpsAccuracyWarning}
              temperatureLabel={formatTemperature(currentLocationSummary?.temperature_2m)}
              todayHighLowLabel={`${formatTemperature(
                currentLocationDaily?.temperature_2m_max
              )} / ${formatTemperature(currentLocationDaily?.temperature_2m_min)}`}
              weatherLabel={currentLocationWeatherMeta.label}
              windLabel={formatWind(currentLocationSummary?.wind_speed_10m)}
            />

            <div
              className="space-y-3"
              style={{ touchAction: "pan-y" }}
            >
              <div
                className="overflow-hidden"
                style={{ touchAction: "pan-y" }}
                onTouchStart={handleMobileModeSwipeStart}
                onTouchMove={handleMobileModeSwipeMove}
                onTouchEnd={handleMobileModeSwipeEnd}
                onTouchCancel={() => {
                  resetMobileTabTrack();
                  resetMobileTabSwipe();
                }}
              >
                <div
                  className="flex w-[200%] will-change-transform"
                  style={{
                    transform: mobileTabTrackTransform,
                    transition: mobileTabTrackTransition,
                  }}
                >
                  <div
                    className="w-1/2 shrink-0"
                    style={{ paddingRight: MOBILE_TAB_PANEL_GAP_PX / 2 }}
                  >
                    {mobileForecastPanel}
                  </div>
                  <div
                    className="w-1/2 shrink-0"
                    style={{ paddingLeft: MOBILE_TAB_PANEL_GAP_PX / 2 }}
                  >
                    {mobileMapPanel}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] text-xs">
                <button
                  type="button"
                  onClick={() => commitMobileTab("forecast")}
                  className={[
                    "py-2.5 text-center font-medium transition-colors",
                    mobileTab === "forecast"
                      ? "bg-sky-600 text-white shadow-inner"
                      : "text-slate-600 hover:bg-slate-100",
                  ].join(" ")}
                >
                  Forecast
                </button>
                <button
                  type="button"
                  onClick={() => commitMobileTab("map")}
                  className={[
                    "py-2.5 text-center font-medium transition-colors",
                    mobileTab === "map"
                      ? "bg-sky-600 text-white shadow-inner"
                      : "text-slate-600 hover:bg-slate-100",
                  ].join(" ")}
                >
                  Local map
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <section className="mx-auto max-w-5xl px-4 pb-10 pt-3 sm:pb-12 sm:pt-8">
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(21rem,0.95fr)] lg:items-start">
          <div className="relative overflow-hidden lg:overflow-visible">
            <div className="pointer-events-none absolute left-0 top-4 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.84),rgba(255,255,255,0)_72%)] blur-3xl sm:-left-12 sm:top-0 sm:h-44 sm:w-44" />
            <div className="pointer-events-none absolute left-14 top-14 h-40 w-52 rounded-full bg-[radial-gradient(circle,rgba(89,170,247,0.14),rgba(89,170,247,0)_72%)] blur-3xl sm:left-[4.5rem] sm:top-[4.5rem] sm:h-56 sm:w-72 sm:bg-[radial-gradient(circle,rgba(89,170,247,0.18),rgba(89,170,247,0)_72%)]" />

            <div className="relative max-w-[42rem] space-y-5 sm:space-y-6">
              <div className="max-w-[34rem] space-y-3 sm:space-y-4">
                <p className="text-[13px] font-semibold tracking-tight text-slate-800/76 sm:text-lg">
                  “What&apos;s the weather like today?”
                </p>

                <h1 className="space-y-0 overflow-visible pb-2">
                  <ShinyText
                    text="Stop guessing."
                    speed={3}
                    delay={0.5}
                    color="#59aaf7"
                    shineColor="#b8ddff"
                    spread={100}
                    direction="left"
                    yoyo={false}
                    pauseOnHover={false}
                    disabled={shouldToneDownMotion}
                    className="block overflow-visible pb-[0.08em] text-[2.85rem] font-semibold leading-[0.96] tracking-[-0.05em] sm:text-[4.7rem] sm:leading-[0.98] sm:tracking-[-0.04em]"
                  />
                  <ShinyText
                    text="Start seeing."
                    speed={3}
                    delay={0.7}
                    color="#59aaf7"
                    shineColor="#b8ddff"
                    spread={100}
                    direction="left"
                    yoyo={false}
                    pauseOnHover={false}
                    disabled={shouldToneDownMotion}
                    className="block -mt-[0.18em] overflow-visible pb-[0.08em] text-[2.85rem] font-semibold leading-[0.96] tracking-[-0.05em] sm:-mt-[0.25em] sm:text-[4.7rem] sm:leading-[0.98] sm:tracking-[-0.04em]"
                  />
                </h1>

                <p className="max-w-[31rem] text-[13px] leading-5 text-slate-700/82 sm:max-w-[33rem]">
                  Precipitation, river levels and temperature from nearby stations,
                  so you can skip generic forecasts and group-chat rumours.
                </p>
              </div>

              <HeroPreviewMap
                items={desktopMapItems}
                activePreviewId={activePreviewId}
                isClient={isClient}
                loading={previewLoading}
                error={previewError}
                hasPreviewItems={hasAnyPreviewItems}
                isFallbackPreview={isFallbackPreview}
                footerAction={
                  <Link
                    to="/sensors"
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--ws-accent)] px-4 py-2.5 text-sm font-medium text-slate-950 shadow-[0_12px_26px_rgba(89,170,247,0.24)] transition hover:opacity-90"
                  >
                    See live stations
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                }
              />
            </div>
          </div>

          <div className="ws-hero-glass-card relative flex h-full flex-col rounded-[1.65rem] p-[0.92rem] sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Pinned forecast
                </p>
                <p className="mt-1.5 truncate text-[1.95rem] font-semibold tracking-tight text-slate-950">
                  {desktopForecastTitle}
                </p>
                <p className="mt-1 truncate text-[13px] text-slate-500">
                  {desktopForecastCaption}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {desktopGpsAccuracyText ? (
                  <details className="relative">
                    <summary className="inline-flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
                      <Info className="h-3.5 w-3.5" />
                    </summary>
                    <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-[11px] text-slate-600 shadow-[0_12px_24px_rgba(15,23,42,0.12)]">
                      <p>Detected area: {desktopForecastTitle}</p>
                      <p>{desktopGpsAccuracyText}</p>
                      {desktopGpsCoordinatesText ? <p>{desktopGpsCoordinatesText}</p> : null}
                      {desktopShowPoorGpsAccuracyWarning ? (
                        <p>Location may be approximate.</p>
                      ) : null}
                    </div>
                  </details>
                ) : null}
                <button
                  type="button"
                  onClick={resetDesktopForecastToCurrentLocation}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--ws-border-subtle)] bg-white/86 text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
                  aria-label="Use my current location"
                >
                  <LocateFixed className="h-4.5 w-4.5" />
                </button>
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                  <CurrentLocationWeatherIcon className="h-5 w-5" />
                </span>
              </div>
            </div>

            {desktopLocationState === "locating" && !desktopForecastTarget ? (
              <div className="mt-4 rounded-[1.25rem] border border-slate-200/80 bg-white/82 px-4 py-4 text-sm text-slate-600">
                Requesting your current location…
              </div>
            ) : locationContextLoading && !locationContext ? (
              <div className="mt-4 space-y-3.5">
                <div className="ws-skeleton h-11 w-36 rounded-2xl" />
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="ws-skeleton h-[4.5rem] rounded-[1.2rem]" />
                  <div className="ws-skeleton h-[4.5rem] rounded-[1.2rem]" />
                  <div className="ws-skeleton col-span-2 h-[4.5rem] rounded-[1.2rem]" />
                </div>
                <div className="ws-skeleton h-56 rounded-[1.25rem]" />
              </div>
            ) : !desktopForecastTarget ? (
              <div className="mt-4 rounded-[1.25rem] border border-slate-200/80 bg-white/82 px-4 py-4 text-sm text-slate-600">
                {desktopLocationMessage ||
                  "Allow location access or click a live station below to pin its forecast."}
              </div>
            ) : blockingLocationContextError ? (
              <div
                className={`mt-4 rounded-[1.25rem] border px-4 py-3 text-sm ${locationContextErrorClasses}`}
              >
                {blockingLocationContextError}
              </div>
            ) : (
              <>
                {locationContextNotice ? (
                  <div
                    className={`mt-4 rounded-[1.25rem] border px-4 py-3 text-sm ${locationContextErrorClasses}`}
                  >
                    {locationContextNotice}
                  </div>
                ) : null}
                <div className="mt-1 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[2.35rem] font-semibold leading-none tracking-tight text-slate-950">
                      {formatTemperature(currentLocationSummary?.temperature_2m)}
                    </p>
                    <p className="mt-1 text-[13px] text-slate-500">
                      Feels like {formatTemperature(currentLocationSummary?.apparent_temperature)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-[1.05rem] font-medium text-slate-700">
                      {currentLocationWeatherMeta.label}
                    </p>
                    <p className="mt-1 text-[15px] text-slate-500">
                      Wind {formatWind(currentLocationSummary?.wind_speed_10m)}
                    </p>
                  </div>
                </div>

                <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-[1.1rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                    <p className="text-slate-500">Next 6h precip</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {formatPercent(currentLocationNext6h?.max_precipitation_probability)}
                    </p>
                  </div>

                  <div className="rounded-[1.1rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                    <p className="text-slate-500">Today high / low</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {formatTemperature(currentLocationDaily?.temperature_2m_max)} /{" "}
                      {formatTemperature(currentLocationDaily?.temperature_2m_min)}
                    </p>
                  </div>

                  <div className="col-span-2 rounded-[1.1rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                    <p className="text-slate-500">Next 6h precip sum</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {formatPrecipAmount(currentLocationNext6h?.rain_sum)}
                    </p>
                  </div>
                </div>

                <div className="mt-9">
                  <Suspense
                    fallback={
                      <div className="space-y-3 rounded-[1.25rem] border border-[var(--ws-border-subtle)] bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                        <div className="ws-skeleton h-5 w-28 rounded-full" />
                        <div className="ws-skeleton h-4 w-44 rounded-full" />
                        <div className="ws-skeleton h-40 rounded-[1.3rem]" />
                      </div>
                    }
                  >
                    <LazyForecastTimelineCard
                      data={locationContext?.hourly_timeline ?? []}
                      metric={mobileForecastMetric}
                      onMetricChange={setMobileForecastMetric}
                      variant="desktop"
                    />
                  </Suspense>
                </div>

                <p className="mt-2.5 text-[11px] text-slate-500">
                  Updated{" "}
                  {formatShortDate(
                    locationContext?.generated_at || currentLocationSummary?.time || null
                  )}{" "}
                  {locationContextNotice ? "(stale)" : ""}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 ws-hero-glass-card rounded-[1.75rem] p-4 sm:mt-6 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Live sensor board
              </p>
              <p className="mt-1 max-w-2xl text-[13px] leading-5 text-slate-600">
                Hover to highlight a station on the preview map, then click to keep
                the forecast pinned on the right.
              </p>
            </div>

            <p className="text-[11px] text-slate-500">
              {isFallbackPreview
                ? "Showing built-in station samples while live data reconnects."
                : "Updated recently"}
            </p>
          </div>

          <div className="mt-4">
            {previewLoading ? (
              <div className="grid gap-4 lg:grid-cols-3">
                {previewSections.map((section) => {
                  const Icon = section.icon;

                  return (
                    <div key={section.type} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${section.shellClass}`}
                        >
                          <Icon className={`h-4 w-4 ${section.iconClass}`} />
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {section.label}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {Array.from({ length: 2 }).map((_, index) => (
                          <div
                            key={`${section.type}-${index}`}
                            className="ws-sensor-skeleton-card rounded-xl border px-3 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="ws-skeleton-text text-xs font-semibold uppercase tracking-[0.06em]">
                                  Loading
                                </p>
                                <p className="ws-skeleton-subtext mt-1 text-[10px] uppercase tracking-[0.08em]">
                                  Loading
                                </p>
                              </div>
                              <p className="ws-skeleton-text shrink-0 text-right text-[10px] font-medium uppercase tracking-[0.08em]">
                                Loading
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : previewError && !hasAnyPreviewItems ? (
              <div className="rounded-xl border border-slate-200/75 bg-white/88 px-3 py-3 text-xs text-slate-600">
                {previewError}
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                {previewSections.map((section) => {
                  const Icon = section.icon;
                  const items = desktopPreviewByType[section.type];

                  return (
                    <div key={section.type} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${section.shellClass}`}
                        >
                          <Icon className={`h-4 w-4 ${section.iconClass}`} />
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {section.label}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {items.length > 0 ? (
                          items.map((item) => {
                            const isHighlighted = activePreviewId === item.id;

                            return (
                              <button
                                key={item.id}
                                type="button"
                                aria-pressed={isHighlighted}
                                onClick={() => setSelectedPreviewId(item.id)}
                                onMouseEnter={
                                  prefersStablePreview
                                    ? undefined
                                    : () => setHoveredPreviewId(item.id)
                                }
                                onMouseLeave={
                                  prefersStablePreview
                                    ? undefined
                                    : () =>
                                        setHoveredPreviewId((current) =>
                                          current === item.id ? null : current
                                        )
                                }
                                className={[
                                  "flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition duration-200",
                                  isHighlighted
                                    ? section.activeItemClass
                                    : "border-slate-200/75 bg-white/88",
                                ].join(" ")}
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-[var(--ws-text-main)]">
                                    {item.name}
                                  </p>
                                  <p className="truncate text-[11px] text-slate-500">
                                    {item.location}
                                  </p>
                                </div>
                                <p className="max-w-[7.5rem] shrink-0 text-right text-[11px] leading-4 font-medium text-slate-700 sm:max-w-none sm:leading-normal">
                                  {item.display}
                                </p>
                              </button>
                            );
                          })
                        ) : (
                          <div className="rounded-xl border border-slate-200/75 bg-white/88 px-3 py-2.5 text-[11px] text-slate-500">
                            No live {section.label.toLowerCase()} preview yet.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
