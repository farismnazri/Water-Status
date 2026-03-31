import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Waves,
  CloudRain,
  ThermometerSun,
  ArrowRight,
  LocateFixed,
} from "lucide-react";
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
import { API_BASE } from "../lib/api";
import { HeroPreviewMap } from "../components/HeroPreviewMap";
import { MobileLocationForecastMap } from "../components/MobileLocationForecastMap";
import ShinyText from "../components/ShinyText";
import {
  fetchLocationForecastContext,
  formatPercent,
  formatPrecipAmount,
  formatShortDate,
  formatShortTime,
  formatTemperature,
  formatWind,
  getWeatherCodeMeta,
  isForecastRateLimitError,
  isClientForecastFallbackSource,
  type WeatherLocationContext,
} from "../lib/weather";
import { useMediaQuery } from "../lib/useMediaQuery";

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

const PREVIEW_REQUEST_TIMEOUT_MS = 4500;
const LOCATION_CONTEXT_REFRESH_INTERVAL_MS = 60_000;
const MOBILE_HOME_TAB_STORAGE_KEY = "wsMobileHomeTab";
const MOBILE_HOME_MANUAL_AREA_STORAGE_KEY = "wsMobileHomeManualArea";

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
    const raw = window.localStorage.getItem(MOBILE_HOME_MANUAL_AREA_STORAGE_KEY);
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

export default function Home() {
  const isClient = typeof window !== "undefined";
  const hasLoadedPreviewRef = useRef(false);
  const mapPauseTimeoutRef = useRef<number | null>(null);
  const [previewItems, setPreviewItems] = useState<HomePreviewItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFallbackPreview, setIsFallbackPreview] = useState(false);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null);
  const [desktopGpsCoords, setDesktopGpsCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
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
    manualArea ? "manual" : "gps"
  );
  const [gpsCoords, setGpsCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationState, setLocationState] = useState<
    "idle" | "locating" | "ready" | "needs_manual"
  >(manualArea ? "ready" : "idle");
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationRequestKey, setLocationRequestKey] = useState(0);
  const [locationContext, setLocationContext] = useState<WeatherLocationContext | null>(
    null
  );
  const [locationContextLoading, setLocationContextLoading] = useState(false);
  const [locationContextError, setLocationContextError] = useState<string | null>(null);
  const [locationContextErrorTone, setLocationContextErrorTone] = useState<
    "warning" | "neutral"
  >("neutral");
  const [mobileForecastMetric, setMobileForecastMetric] = useState<"rain" | "temperature">(
    "rain"
  );
  const [mobileChartActiveIndex, setMobileChartActiveIndex] = useState<number | null>(null);
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
      setManualAreaPickerOpen(true);
      setLocationMessage("Location access isn’t available here. Choose an area instead.");
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
        setLocationMode("gps");
        setLocationState("ready");
        setManualAreaPickerOpen(false);
        setLocationContextError(null);
      },
      (error) => {
        console.error(error);
        setLocationMode("manual");
        setLocationState(manualArea ? "ready" : "needs_manual");
        setManualAreaPickerOpen(true);
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location access is off. Choose an area to keep the forecast local."
            : "We couldn’t confirm your current location. Choose an area below."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000,
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
        setDesktopLocationState("ready");
        setDesktopLocationMessage(null);
        setLocationContextError(null);
      },
      (error) => {
        console.error(error);
        setDesktopGpsCoords(null);
        setDesktopLocationState("unavailable");
        setDesktopLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location access is off. Allow it to keep the forecast centered on you, or click a live station below."
            : "We couldn’t confirm your current location. Click a live station below to pin its forecast."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000,
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

  useEffect(() => {
    if (!isClient) return;
    window.localStorage.setItem(MOBILE_HOME_TAB_STORAGE_KEY, mobileTab);
  }, [isClient, mobileTab]);

  useEffect(() => {
    if (!isClient) return;

    if (manualArea) {
      window.localStorage.setItem(
        MOBILE_HOME_MANUAL_AREA_STORAGE_KEY,
        JSON.stringify(manualArea)
      );
      return;
    }

    window.localStorage.removeItem(MOBILE_HOME_MANUAL_AREA_STORAGE_KEY);
  }, [isClient, manualArea]);

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
        console.error(error);
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

    if (locationMode === "manual" && manualArea) {
      setLocationState("ready");
      return;
    }

    requestCurrentLocation();
  }, [isMobileHome, locationRequestKey]);

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

    async function loadPreview() {
      const isInitialLoad = !hasLoadedPreviewRef.current;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PREVIEW_REQUEST_TIMEOUT_MS);

      try {
        if (isInitialLoad) {
          setPreviewLoading(true);
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
          setPreviewItems(fallbackPreviewItems);
          setIsFallbackPreview(true);
          setPreviewError(null);
          return;
        }

        setPreviewItems(nextItems);
        setIsFallbackPreview(false);
        setPreviewError(null);
      } catch (error) {
        console.error(error);
        if (!isMounted) return;

        setPreviewItems(fallbackPreviewItems);
        setIsFallbackPreview(true);
        setPreviewError(null);
      } finally {
        window.clearTimeout(timeout);
        if (!isMounted) return;
        hasLoadedPreviewRef.current = true;
        setPreviewLoading(false);
      }
    }

    loadPreview();

    const refresh = window.setInterval(loadPreview, 60_000);
    return () => {
      isMounted = false;
      window.clearInterval(refresh);
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
      setLocationContext(null);
      setLocationContextLoading(false);
      setLocationContextError(null);
      setLocationContextErrorTone("neutral");
      return;
    }

    if (!isPageVisible) {
      setLocationContextLoading(false);
      return;
    }

    let isMounted = true;
    const target = activeForecastTarget;

    async function loadLocationContext() {
      try {
        setLocationContextLoading(true);
        setLocationContextError(null);
        setLocationContextErrorTone("neutral");
        const nextContext = await fetchLocationForecastContext({
          latitude: target.latitude,
          longitude: target.longitude,
          radiusKm: 8,
          label: target.label,
          mode: target.mode,
        });
        if (!isMounted) return;
        setLocationContext(nextContext);
      } catch (error) {
        console.error(error);
        if (!isMounted) return;
        if (isForecastRateLimitError(error)) {
          setLocationContextError("Forecast is temporarily rate-limited. Try again shortly.");
          setLocationContextErrorTone("warning");
          return;
        }

        setLocationContextError("Forecast is temporarily unavailable.");
        setLocationContextErrorTone("neutral");
      } finally {
        if (isMounted) setLocationContextLoading(false);
      }
    }

    loadLocationContext();
    const refresh = window.setInterval(
      loadLocationContext,
      LOCATION_CONTEXT_REFRESH_INTERVAL_MS
    );

    return () => {
      isMounted = false;
      window.clearInterval(refresh);
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
      isClientForecastFallbackSource(locationContext?.source) ||
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
  const usesClientForecastFallback = isClientForecastFallbackSource(
    locationContext?.source
  );
  const forecastSourceNotice = usesClientForecastFallback
    ? "Client fallback is active for local testing. Live map animation is paused."
    : null;
  const locationContextErrorClasses =
    locationContextErrorTone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-slate-200/80 bg-white/82 text-slate-600";
  const desktopForecastTitle =
    desktopForecastTarget?.label || locationContext?.location.label || "Current location";
  const desktopForecastCaption = desktopPinnedPreview
    ? `${desktopPinnedPreview.name} pinned from the live sensor board.`
    : desktopForecastTarget
      ? "Using your current location."
      : desktopLocationMessage ||
        "Allow location access or click a live station below to pin its forecast.";
  const mobileHourlyChartData = useMemo(
    () =>
      (locationContext?.hourly_timeline ?? []).map((point) => ({
        ...point,
        display_label:
          point.offset_hours === 0 ? "Now" : formatChartHourLabel(point.time || null),
      })),
    [locationContext]
  );
  const mobileChartTickIndexes = useMemo(() => {
    if (mobileHourlyChartData.length === 0) return new Set<number>();

    const nowIndex = mobileHourlyChartData.findIndex((point) => point.offset_hours === 0);
    const lastIndex = mobileHourlyChartData.length - 1;
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
  }, [mobileHourlyChartData]);
  const defaultMobileChartIndex = useMemo(() => {
    if (mobileHourlyChartData.length === 0) return null;
    const nowIndex = mobileHourlyChartData.findIndex((point) => point.offset_hours === 0);
    return nowIndex >= 0 ? nowIndex : 0;
  }, [mobileHourlyChartData]);
  const hasHourlyTimeline = mobileHourlyChartData.length > 0;
  const hasRainSeries = mobileHourlyChartData.some(
    (point) =>
      Number.isFinite(point.precipitation_amount ?? Number.NaN) ||
      Number.isFinite(point.precipitation_probability ?? Number.NaN)
  );
  const hasTemperatureSeries = mobileHourlyChartData.some((point) =>
    Number.isFinite(point.temperature_2m ?? Number.NaN)
  );
  const mobileActiveChartPoint =
    mobileChartActiveIndex !== null
      ? mobileHourlyChartData[mobileChartActiveIndex] ?? null
      : null;
  const mobileChartReadout = useMemo(() => {
    if (!mobileActiveChartPoint) return null;

    const timeLabel =
      mobileActiveChartPoint.offset_hours === 0
        ? "Now"
        : formatShortTime(mobileActiveChartPoint.time || null);

    if (mobileForecastMetric === "temperature") {
      return [
        timeLabel,
        formatTemperature(mobileActiveChartPoint.temperature_2m),
      ].join(" • ");
    }

    return [
      timeLabel,
      formatPrecipAmount(mobileActiveChartPoint.precipitation_amount),
      formatPercent(mobileActiveChartPoint.precipitation_probability),
    ].join(" • ");
  }, [mobileActiveChartPoint, mobileForecastMetric]);

  useEffect(() => {
    setMobileChartActiveIndex((current) => {
      if (!hasHourlyTimeline || defaultMobileChartIndex === null) {
        return null;
      }
      if (current !== null && current >= 0 && current < mobileHourlyChartData.length) {
        return current;
      }
      return defaultMobileChartIndex;
    });
  }, [defaultMobileChartIndex, hasHourlyTimeline, mobileHourlyChartData.length]);

  function updateMobileChartActiveIndex(
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
      setMobileChartActiveIndex(normalizedIndex);
    }
  }

  function resetMobileChartActiveIndex() {
    setMobileChartActiveIndex(defaultMobileChartIndex);
  }

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
            <div className="overflow-hidden">
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
                className="block overflow-visible whitespace-nowrap pb-[0.04em] text-[1.58rem] font-semibold leading-none tracking-[-0.06em] sm:text-[1.72rem]"
              />
            </div>

            {locationMessage ? (
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-xs text-slate-600">
                {locationMessage}
              </div>
            ) : null}

            {mobileTab === "forecast" ? (
              <div className="rounded-[1.7rem] border border-[var(--ws-border-subtle)] bg-white/86 p-3 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[1.55rem] font-semibold tracking-tight text-slate-900 sm:text-[1.75rem]">
                      {mobileLocationTarget?.label || "Choose an area"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setManualAreaPickerOpen((current) => !current)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--ws-border-subtle)] bg-white/86 text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
                      aria-label="Change location source"
                    >
                      <LocateFixed className="h-4 w-4" />
                    </button>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                      <CurrentLocationWeatherIcon className="h-5 w-5" />
                    </span>
                  </div>
                </div>

                {shouldShowManualAreaPicker ? (
                  <div className="mt-3 rounded-[1.2rem] border border-[var(--ws-border-subtle)] bg-white/82 p-3 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
                    <div className="grid grid-cols-2 rounded-2xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] text-xs overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setLocationMode("gps");
                          setManualAreaPickerOpen(false);
                          setLocationRequestKey((current) => current + 1);
                        }}
                        className={[
                          "inline-flex items-center justify-center gap-2 py-2 text-center font-medium transition",
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
                        onClick={() => {
                          setLocationMode("manual");
                          setLocationMessage(null);
                        }}
                        className={[
                          "py-2 text-center font-medium transition",
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
                          value={manualArea?.label ?? ""}
                          onChange={(event) => {
                            const nextArea =
                              locationOptions.find((option) => option.label === event.target.value) ??
                              null;
                            setManualArea(nextArea);
                            setLocationMode("manual");
                            setLocationState(nextArea ? "ready" : "needs_manual");
                            setLocationMessage(null);
                            if (nextArea) {
                              setManualAreaPickerOpen(false);
                            }
                          }}
                          className="min-w-0 flex-1 rounded-2xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
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
                          onClick={() => setManualAreaPickerOpen(false)}
                          className="rounded-2xl border border-[var(--ws-border-subtle)] px-3 py-2 text-xs font-medium text-slate-600"
                        >
                          Done
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {locationContextLoading && !locationContext ? (
                  <div className="mt-4 space-y-3">
                    <div className="ws-skeleton h-10 w-32 rounded-2xl" />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="ws-skeleton h-16 rounded-2xl" />
                      <div className="ws-skeleton h-16 rounded-2xl" />
                      <div className="ws-skeleton col-span-2 h-16 rounded-2xl" />
                    </div>
                    <div className="ws-skeleton h-28 rounded-2xl" />
                  </div>
                ) : locationContextError ? (
                  <div
                    className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${locationContextErrorClasses}`}
                  >
                    {locationContextError}
                  </div>
                ) : (
                  <>
                    {forecastSourceNotice ? (
                      <div className="mt-3 rounded-2xl border border-sky-200/80 bg-sky-50/80 px-4 py-3 text-xs text-sky-700">
                        {forecastSourceNotice}
                      </div>
                    ) : null}

                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[2.35rem] font-semibold leading-none tracking-tight text-slate-950">
                          {formatTemperature(currentLocationSummary?.temperature_2m)}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          Feels like {formatTemperature(currentLocationSummary?.apparent_temperature)}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-[15px] font-medium text-slate-700">
                          {currentLocationWeatherMeta.label}
                        </p>
                        <p className="mt-1 text-[15px] text-slate-500">
                          Wind {formatWind(currentLocationSummary?.wind_speed_10m)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-[1.2rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                        <p className="text-slate-500">Next 6h precip</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">
                          {formatPercent(currentLocationNext6h?.max_precipitation_probability)}
                        </p>
                      </div>

                      <div className="rounded-[1.2rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                        <p className="text-slate-500">Today high / low</p>
                        <p className="mt-1 text-[15px] font-semibold text-slate-900">
                          {formatTemperature(currentLocationDaily?.temperature_2m_max)} /{" "}
                          {formatTemperature(currentLocationDaily?.temperature_2m_min)}
                        </p>
                      </div>

                      <div className="col-span-2 rounded-[1.2rem] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                        <p className="text-slate-500">Next 6h precip sum</p>
                        <p className="mt-1 text-[15px] font-semibold text-slate-900">
                          {formatPrecipAmount(currentLocationNext6h?.rain_sum)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-[1.2rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(240,249,255,0.7),rgba(255,255,255,0.78))] px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {mobileForecastMetric === "rain" ? "Precip 12h" : "Temp 12h"}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            6h back and 6h ahead, in 1-hour steps.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 rounded-full border border-[var(--ws-border-subtle)] bg-white/80 text-[11px] overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setMobileForecastMetric("rain")}
                            className={[
                              "px-3 py-1.5 font-medium transition",
                              mobileForecastMetric === "rain"
                                ? "bg-sky-600 text-white"
                                : "text-slate-600",
                            ].join(" ")}
                          >
                            Precip
                          </button>
                          <button
                            type="button"
                            onClick={() => setMobileForecastMetric("temperature")}
                            className={[
                              "px-3 py-1.5 font-medium transition",
                              mobileForecastMetric === "temperature"
                                ? "bg-sky-600 text-white"
                                : "text-slate-600",
                            ].join(" ")}
                          >
                            Temp
                          </button>
                        </div>
                      </div>

                      <div className="mt-3">
                        {hasHourlyTimeline ? (
                          <div className="space-y-2">
                            <div className="inline-flex min-h-8 items-center rounded-full border border-slate-200/80 bg-white/88 px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] tabular-nums">
                              {mobileChartReadout}
                            </div>

                            <div className="h-36">
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart
                                data={mobileHourlyChartData}
                                margin={{ top: 12, right: 2, left: -10, bottom: 20 }}
                                onMouseMove={updateMobileChartActiveIndex}
                                onMouseLeave={resetMobileChartActiveIndex}
                                onTouchStart={updateMobileChartActiveIndex}
                                onTouchMove={updateMobileChartActiveIndex}
                                onClick={updateMobileChartActiveIndex}
                              >
                                <CartesianGrid
                                  stroke="#dbeafe"
                                  strokeDasharray="3 3"
                                  vertical={false}
                                />
                                <XAxis
                                  dataKey="display_label"
                                  tickLine
                                  axisLine
                                  fontSize={10}
                                  tick={{ fill: "#64748b" }}
                                  tickMargin={8}
                                  interval={0}
                                  height={38}
                                  tickFormatter={(value, index) =>
                                    mobileChartTickIndexes.has(index) ? value : ""
                                  }
                                  label={{
                                    value: "Time",
                                    position: "insideBottom",
                                    offset: -12,
                                    fill: "#64748b",
                                    fontSize: 11,
                                  }}
                                />
                                <YAxis
                                  yAxisId="left"
                                  tickLine
                                  axisLine
                                  width={34}
                                  fontSize={10}
                                  tick={{ fill: "#64748b" }}
                                  tickFormatter={(value) =>
                                    mobileForecastMetric === "rain" ? `${value}` : `${value}°`
                                  }
                                  domain={
                                    mobileForecastMetric === "rain"
                                      ? [0, (dataMax: number) => Math.max(1, Math.ceil(dataMax || 0))]
                                      : ["auto", "auto"]
                                  }
                                  label={{
                                    value: mobileForecastMetric === "rain" ? "mm/h" : "°C",
                                    angle: -90,
                                    position: "insideLeft",
                                    fill: "#64748b",
                                    fontSize: 11,
                                    dx: -2,
                                  }}
                                />
                                <YAxis
                                  yAxisId="probability"
                                  orientation="right"
                                  domain={[0, 100]}
                                  tickFormatter={(value) => `${value}%`}
                                  tickLine={mobileForecastMetric === "rain"}
                                  axisLine={mobileForecastMetric === "rain"}
                                  tick={mobileForecastMetric === "rain" ? { fill: "#64748b" } : false}
                                  hide={mobileForecastMetric !== "rain"}
                                  width={38}
                                  fontSize={10}
                                  label={
                                    mobileForecastMetric === "rain"
                                      ? {
                                          value: "%",
                                          angle: 90,
                                          position: "insideRight",
                                          fill: "#64748b",
                                          fontSize: 11,
                                          dx: 2,
                                        }
                                      : undefined
                                  }
                                />
                                <ReferenceLine
                                  x="Now"
                                  stroke="#0ea5e9"
                                  strokeDasharray="4 3"
                                  ifOverflow="extendDomain"
                                  label={{
                                    value: "Now",
                                    position: "insideTopRight",
                                    fill: "#0369a1",
                                    fontSize: 10,
                                  }}
                                />
                                {mobileActiveChartPoint ? (
                                  <ReferenceLine
                                    x={mobileActiveChartPoint.display_label}
                                    stroke="#94a3b8"
                                    strokeWidth={1}
                                    ifOverflow="extendDomain"
                                  />
                                ) : null}
                                <Tooltip
                                  content={() => null}
                                  cursor={false}
                                />
                                {mobileForecastMetric === "rain" ? (
                                  <>
                                    <Bar
                                      yAxisId="left"
                                      dataKey="precipitation_amount"
                                      name="Precip amount"
                                      fill="#38bdf8"
                                      radius={[10, 10, 0, 0]}
                                      barSize={12}
                                      minPointSize={4}
                                      activeBar={{
                                        fill: "#0ea5e9",
                                        stroke: "#0369a1",
                                        strokeWidth: 1,
                                      }}
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
                                    yAxisId="left"
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
                        ) : (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-3 py-4 text-xs text-slate-500">
                            Timeline data is unavailable right now.
                          </div>
                        )}
                      </div>

                      {hasHourlyTimeline &&
                      mobileForecastMetric === "rain" &&
                      !hasRainSeries ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          No precipitation is expected across this 12-hour window.
                        </p>
                      ) : null}
                      {hasHourlyTimeline &&
                      mobileForecastMetric === "temperature" &&
                      !hasTemperatureSeries ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Temperature forecast is unavailable for this 12-hour window.
                        </p>
                      ) : null}
                    </div>

                    <p className="mt-3 text-[11px] text-slate-500">
                      Updated {formatShortDate(locationContext?.generated_at || currentLocationSummary?.time || null)}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3 rounded-[1.8rem] border border-[var(--ws-border-subtle)] bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {usesClientForecastFallback ? "Static local map" : "Animated local map"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {usesClientForecastFallback
                        ? `Static radius around ${mobileLocationTarget?.label || "your area"} while live forecast fields are unavailable.`
                        : `Wider 8km forecast field around ${mobileLocationTarget?.label || "your area"}.`}
                    </p>
                  </div>
                  {usesClientForecastFallback ? (
                    <span className="rounded-full border border-sky-200/80 bg-sky-50/80 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-sky-700">
                      Static
                    </span>
                  ) : (
                    <span className="rounded-full border border-slate-200/70 bg-white/75 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      {currentLocationFrame?.label ?? "Waiting"}
                    </span>
                  )}
                </div>

                {forecastSourceNotice ? (
                  <div className="rounded-2xl border border-sky-200/80 bg-sky-50/80 px-4 py-3 text-xs text-sky-700">
                    {forecastSourceNotice}
                  </div>
                ) : null}

                {usesClientForecastFallback ? null : (
                  <div className="grid grid-cols-2 rounded-2xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] text-xs overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setMobileMapLayer("precipitation")}
                      className={[
                        "py-2.5 text-center font-medium transition",
                        mobileMapLayer === "precipitation"
                          ? "bg-sky-600 text-white shadow-inner"
                          : "text-slate-600 hover:bg-slate-100",
                      ].join(" ")}
                    >
                      Precip
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileMapLayer("temperature")}
                      className={[
                        "py-2.5 text-center font-medium transition",
                        mobileMapLayer === "temperature"
                          ? "bg-sky-600 text-white shadow-inner"
                          : "text-slate-600 hover:bg-slate-100",
                      ].join(" ")}
                    >
                      Temperature
                    </button>
                  </div>
                )}

                <MobileLocationForecastMap
                  center={{
                    latitude: mobileLocationTarget?.latitude ?? 3.1563,
                    longitude: mobileLocationTarget?.longitude ?? 101.7117,
                  }}
                  radiusKm={locationContext?.map?.radius_km ?? 8}
                  samples={locationContext?.map?.samples ?? []}
                  frame={currentLocationFrame}
                  layer={mobileMapLayer}
                  isClient={isClient}
                  loading={locationContextLoading}
                  error={locationContextError}
                  staticFallback={usesClientForecastFallback}
                  onInteract={usesClientForecastFallback ? undefined : handleMapInteraction}
                />

                {usesClientForecastFallback ? (
                  <div className="rounded-2xl border border-slate-200/75 bg-slate-50/75 px-4 py-3 text-xs text-slate-600">
                    Static local map while live forecast frames are unavailable.
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/75 bg-slate-50/75 px-4 py-3 text-xs text-slate-600">
                    <span>
                      {mobileMapPaused
                        ? "Animation paused after interaction."
                        : "Animation loops through the next 6 hours."}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMobileMapPaused((current) => !current)}
                      className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2"
                    >
                      {mobileMapPaused ? "Resume" : "Pause"}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 rounded-2xl border border-[var(--ws-border-subtle)] bg-[var(--ws-bg-elevated)] text-xs overflow-hidden">
              <button
                type="button"
                onClick={() => setMobileTab("forecast")}
                className={[
                  "py-2.5 text-center font-medium transition",
                  mobileTab === "forecast"
                    ? "bg-sky-600 text-white shadow-inner"
                    : "text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                Forecast
              </button>
              <button
                type="button"
                onClick={() => setMobileTab("map")}
                className={[
                  "py-2.5 text-center font-medium transition",
                  mobileTab === "map"
                    ? "bg-sky-600 text-white shadow-inner"
                    : "text-slate-600 hover:bg-slate-100",
                ].join(" ")}
              >
                Local map
              </button>
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
            ) : locationContextError ? (
              <div
                className={`mt-4 rounded-[1.25rem] border px-4 py-3 text-sm ${locationContextErrorClasses}`}
              >
                {locationContextError}
              </div>
            ) : (
              <>
                {forecastSourceNotice ? (
                  <div className="mt-4 rounded-[1.25rem] border border-sky-200/80 bg-sky-50/80 px-4 py-3 text-xs text-sky-700">
                    {forecastSourceNotice}
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

                <div className="mt-9 rounded-[1.25rem] border border-[var(--ws-border-subtle)] bg-[linear-gradient(180deg,rgba(240,249,255,0.7),rgba(255,255,255,0.8))] px-3.5 py-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {mobileForecastMetric === "rain" ? "Precip 12h" : "Temp 12h"}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        6h back and 6h ahead, in 1-hour steps.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 overflow-hidden rounded-full border border-[var(--ws-border-subtle)] bg-white/82 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setMobileForecastMetric("rain")}
                        className={[
                          "px-3 py-1.25 font-medium transition",
                          mobileForecastMetric === "rain"
                            ? "bg-sky-600 text-white"
                            : "text-slate-600",
                        ].join(" ")}
                      >
                        Precip
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobileForecastMetric("temperature")}
                        className={[
                          "px-3 py-1.25 font-medium transition",
                          mobileForecastMetric === "temperature"
                            ? "bg-sky-600 text-white"
                            : "text-slate-600",
                        ].join(" ")}
                      >
                        Temp
                      </button>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    {hasHourlyTimeline ? (
                      <div className="space-y-2.5">
                        <div className="inline-flex min-h-8 items-center rounded-full border border-slate-200/80 bg-white/88 px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] tabular-nums">
                          {mobileChartReadout}
                        </div>

                        <div className="h-40">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart
                              data={mobileHourlyChartData}
                              margin={{ top: 12, right: 2, left: -8, bottom: 20 }}
                              onMouseMove={updateMobileChartActiveIndex}
                              onMouseLeave={resetMobileChartActiveIndex}
                              onTouchStart={updateMobileChartActiveIndex}
                              onTouchMove={updateMobileChartActiveIndex}
                              onClick={updateMobileChartActiveIndex}
                            >
                              <CartesianGrid
                                stroke="#dbeafe"
                                strokeDasharray="3 3"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="display_label"
                                tickLine
                                axisLine
                                fontSize={10}
                                tick={{ fill: "#64748b" }}
                                tickMargin={8}
                                interval={0}
                                height={38}
                                tickFormatter={(value, index) =>
                                  mobileChartTickIndexes.has(index) ? value : ""
                                }
                                label={{
                                  value: "Time",
                                  position: "insideBottom",
                                  offset: -12,
                                  fill: "#64748b",
                                  fontSize: 11,
                                }}
                              />
                              <YAxis
                                yAxisId="left"
                                tickLine
                                axisLine
                                width={34}
                                fontSize={10}
                                tick={{ fill: "#64748b" }}
                                tickFormatter={(value) =>
                                  mobileForecastMetric === "rain" ? `${value}` : `${value}°`
                                }
                                domain={
                                  mobileForecastMetric === "rain"
                                    ? [0, (dataMax: number) => Math.max(1, Math.ceil(dataMax || 0))]
                                    : ["auto", "auto"]
                                }
                                label={{
                                  value: mobileForecastMetric === "rain" ? "mm/h" : "°C",
                                  angle: -90,
                                  position: "insideLeft",
                                  fill: "#64748b",
                                  fontSize: 11,
                                  dx: -2,
                                }}
                              />
                              <YAxis
                                yAxisId="probability"
                                orientation="right"
                                domain={[0, 100]}
                                tickFormatter={(value) => `${value}%`}
                                tickLine={mobileForecastMetric === "rain"}
                                axisLine={mobileForecastMetric === "rain"}
                                tick={
                                  mobileForecastMetric === "rain"
                                    ? { fill: "#64748b" }
                                    : false
                                }
                                hide={mobileForecastMetric !== "rain"}
                                width={38}
                                fontSize={10}
                                label={
                                  mobileForecastMetric === "rain"
                                    ? {
                                        value: "%",
                                        angle: 90,
                                        position: "insideRight",
                                        fill: "#64748b",
                                        fontSize: 11,
                                        dx: 2,
                                      }
                                    : undefined
                                }
                              />
                              <ReferenceLine
                                x="Now"
                                stroke="#0ea5e9"
                                strokeDasharray="4 3"
                                ifOverflow="extendDomain"
                                label={{
                                  value: "Now",
                                  position: "insideTopRight",
                                  fill: "#0369a1",
                                  fontSize: 10,
                                }}
                              />
                              {mobileActiveChartPoint ? (
                                <ReferenceLine
                                  x={mobileActiveChartPoint.display_label}
                                  stroke="#94a3b8"
                                  strokeWidth={1}
                                  ifOverflow="extendDomain"
                                />
                              ) : null}
                              <Tooltip content={() => null} cursor={false} />
                              {mobileForecastMetric === "rain" ? (
                                <>
                                  <Bar
                                    yAxisId="left"
                                    dataKey="precipitation_amount"
                                    name="Precip amount"
                                    fill="#38bdf8"
                                    radius={[10, 10, 0, 0]}
                                    barSize={14}
                                    minPointSize={4}
                                    activeBar={{
                                      fill: "#0ea5e9",
                                      stroke: "#0369a1",
                                      strokeWidth: 1,
                                    }}
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
                                  yAxisId="left"
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
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-3 py-4 text-xs text-slate-500">
                        Timeline data is unavailable right now.
                      </div>
                    )}
                  </div>

                  {hasHourlyTimeline &&
                  mobileForecastMetric === "rain" &&
                  !hasRainSeries ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      No precipitation is expected across this 12-hour window.
                    </p>
                  ) : null}
                  {hasHourlyTimeline &&
                  mobileForecastMetric === "temperature" &&
                  !hasTemperatureSeries ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Temperature forecast is unavailable for this 12-hour window.
                    </p>
                  ) : null}
                </div>

                <p className="mt-2.5 text-[11px] text-slate-500">
                  Updated{" "}
                  {formatShortDate(
                    locationContext?.generated_at || currentLocationSummary?.time || null
                  )}
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
