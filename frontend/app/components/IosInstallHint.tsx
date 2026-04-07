import { PlusSquare, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

const IOS_INSTALL_HINT_DISMISSED_KEY = "wsIosInstallHintDismissed";

function isIosSafari() {
  if (typeof window === "undefined") return false;

  const userAgent = window.navigator.userAgent;
  const vendor = window.navigator.vendor;
  const isIosDevice =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isSafariEngine =
    /Safari/.test(userAgent) &&
    /Apple/.test(vendor) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(userAgent);

  return isIosDevice && isSafariEngine;
}

function isStandaloneMode() {
  if (typeof window === "undefined") return false;

  const standaloneNavigator = window.navigator as Navigator & {
    standalone?: boolean;
  };

  return (
    standaloneNavigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export function IosInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const dismissed =
      window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY) === "1";

    if (dismissed || !isIosSafari() || isStandaloneMode()) {
      setVisible(false);
      return;
    }

    setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="ws-install-hint ws-safe-bottom lg:hidden">
      <div className="rounded-[1.35rem] border border-slate-200/80 bg-white/96 px-4 py-3 shadow-[0_18px_44px_rgba(15,23,42,0.16)] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Add To Home Screen
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              Open Water Status like an app on your iPhone.
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Tap <Share className="mx-0.5 inline h-3.5 w-3.5 align-[-0.15em]" /> Share,
              then{" "}
              <span className="font-medium text-slate-800">
                Add to Home Screen
              </span>{" "}
              <PlusSquare className="mx-0.5 inline h-3.5 w-3.5 align-[-0.15em]" />.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, "1");
              setVisible(false);
            }}
            aria-label="Dismiss install hint"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-slate-50/90 text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
