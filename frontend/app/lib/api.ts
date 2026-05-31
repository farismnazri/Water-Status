function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function normalizeEnvBase(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Allow quoted dotenv values like "https://api.example.com"
  const unquoted = trimmed.replace(/^["']|["']$/g, "");
  return unquoted.trim() ? stripTrailingSlash(unquoted.trim()) : null;
}

type ApiBaseResolution = {
  base: string;
  source:
    | "VITE_API_BASE_URL"
    | "VITE_API_BASE"
    | "window-origin"
    | "localhost-fallback"
    | "server-fallback";
  envUrl: string | null;
  envLegacy: string | null;
};

function detectApiBase(): ApiBaseResolution {
  const env = import.meta.env as ImportMetaEnv & {
    VITE_API_BASE_URL?: string;
    VITE_API_BASE?: string;
  };

  // Priority: VITE_API_BASE_URL (preferred) -> VITE_API_BASE (legacy alias)
  const envUrl = normalizeEnvBase(env?.VITE_API_BASE_URL);
  const envLegacy = normalizeEnvBase(env?.VITE_API_BASE);
  if (envUrl) {
    return {
      base: envUrl,
      source: "VITE_API_BASE_URL",
      envUrl,
      envLegacy,
    };
  }
  if (envLegacy) {
    return {
      base: envLegacy,
      source: "VITE_API_BASE",
      envUrl,
      envLegacy,
    };
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    if (isLocalHost) {
      return {
        base: "http://127.0.0.1:8000",
        source: "localhost-fallback",
        envUrl,
        envLegacy,
      };
    }
    return {
      base: stripTrailingSlash(window.location.origin),
      source: "window-origin",
      envUrl,
      envLegacy,
    };
  }

  return {
    base: "http://127.0.0.1:8000",
    source: "server-fallback",
    envUrl,
    envLegacy,
  };
}

const apiBaseResolution = detectApiBase();

if (import.meta.env.DEV && typeof window !== "undefined") {
  const globalKey = "__WS_API_BASE_DEBUG_LOGGED__";
  const globalContext = window as unknown as Record<string, unknown>;
  if (!globalContext[globalKey]) {
    globalContext[globalKey] = true;
    console.info(
      `[api] API base resolved to ${apiBaseResolution.base} (source: ${apiBaseResolution.source})`,
      {
        VITE_API_BASE_URL: apiBaseResolution.envUrl,
        VITE_API_BASE: apiBaseResolution.envLegacy,
      }
    );
  }
}

export const API_BASE = apiBaseResolution.base;
