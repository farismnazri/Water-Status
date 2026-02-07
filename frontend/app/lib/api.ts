function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function detectApiBase(): string {
  const envBase = (import.meta as any)?.env?.VITE_API_BASE_URL as string | undefined;
  if (envBase && envBase.trim()) {
    return stripTrailingSlash(envBase.trim());
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    if (isLocalHost) {
      return "http://127.0.0.1:8000";
    }
    return stripTrailingSlash(window.location.origin);
  }

  return "http://127.0.0.1:8000";
}

export const API_BASE = detectApiBase();
