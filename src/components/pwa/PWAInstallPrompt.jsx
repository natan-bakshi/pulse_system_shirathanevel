import React, { useState, useEffect, useCallback } from "react";
import { X, Download, Share, MoreVertical, Plus, ArrowUp, Monitor, Smartphone, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "pwa_install_dismissed";
const DISMISS_DAYS = 7; // Show again after 7 days if dismissed

function isRunningAsPWA() {
  // Check display-mode standalone (installed PWA)
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS standalone mode
  if (window.navigator.standalone === true) return true;
  // TWA (Trusted Web Activity)
  if (document.referrer.includes("android-app://")) return true;
  return false;
}

function isDismissed() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return false;
    const { timestamp } = JSON.parse(data);
    const daysPassed = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
    return daysPassed < DISMISS_DAYS;
  } catch {
    return false;
  }
}

function saveDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timestamp: Date.now() }));
  } catch {}
}

function getDeviceInfo() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|Chrome/.test(ua);
  const isChromeiOS = /CriOS/.test(ua);
  const isFirefoxiOS = /FxiOS/.test(ua);
  const isSamsungBrowser = /SamsungBrowser/.test(ua);
  const isWindows = /Windows/.test(ua);
  const isMac = /Macintosh|MacIntel/.test(ua) && !isIOS;

  return { isIOS, isAndroid, isSafari, isChromeiOS, isFirefoxiOS, isSamsungBrowser, isWindows, isMac };
}

export default function PWAInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [deviceInfo] = useState(() => getDeviceInfo());

  // Listen for beforeinstallprompt (Chrome/Edge/Samsung on Android & Desktop)
  useEffect(() => {
    if (isRunningAsPWA() || isDismissed()) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // If no prompt fires within 2 seconds and we're on a device that needs manual guide
    const timer = setTimeout(() => {
      if (!deferredPrompt) {
        // On iOS or browsers without native prompt - show guide
        if (deviceInfo.isIOS || (!deviceInfo.isAndroid && !deviceInfo.isWindows)) {
          setVisible(true);
        }
      }
    }, 2000);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      clearTimeout(timer);
    };
  }, []);

  // Also show for iOS/manual devices even if prompt never fires
  useEffect(() => {
    if (isRunningAsPWA() || isDismissed()) return;
    // For iOS - always show since beforeinstallprompt won't fire
    if (deviceInfo.isIOS) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [deviceInfo.isIOS]);

  const handleInstallClick = useCallback(async () => {
    if (deferredPrompt) {
      // Native install prompt available
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === "accepted") {
        setVisible(false);
        saveDismissed();
      }
      setDeferredPrompt(null);
    } else {
      // Show manual guide
      setShowGuide(true);
      setGuideStep(0);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setShowGuide(false);
    saveDismissed();
  }, []);

  if (!visible) return null;

  // If showing the manual installation guide
  if (showGuide) {
    return (
      <ManualInstallGuide
        deviceInfo={deviceInfo}
        step={guideStep}
        setStep={setGuideStep}
        onClose={handleDismiss}
      />
    );
  }

  // Banner prompt
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-3 sm:p-4 animate-slide-up">
      <div
        dir="rtl"
        className="mx-auto max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 flex items-start gap-3"
        style={{ backdropFilter: "blur(12px)" }}
      >
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-700 to-red-900 flex items-center justify-center shrink-0">
          <Download className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-sm sm:text-base">התקן את האפליקציה</h3>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            {deferredPrompt
              ? "התקן את האפליקציה למסך הבית לגישה מהירה"
              : "הוסף את האפליקציה למסך הבית לחוויה מלאה"}
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              onClick={handleInstallClick}
              className="bg-red-800 hover:bg-red-900 text-white text-xs sm:text-sm"
            >
              <Download className="h-3.5 w-3.5 ml-1" />
              {deferredPrompt ? "התקן עכשיו" : "ראה הדרכה"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="text-gray-500 text-xs sm:text-sm"
            >
              לא עכשיו
            </Button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-gray-400 hover:text-gray-600 p-1 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}

// =============================================
// Manual Installation Guide Component
// =============================================
function ManualInstallGuide({ deviceInfo, step, setStep, onClose }) {
  const steps = getGuideSteps(deviceInfo);

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Guide Card */}
      <div
        dir="rtl"
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-red-800 to-red-700 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {deviceInfo.isIOS ? (
              <Smartphone className="h-5 w-5" />
            ) : (
              <Monitor className="h-5 w-5" />
            )}
            <h2 className="font-bold text-base">התקנת האפליקציה</h2>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Browser indicator */}
        <div className="bg-gray-50 px-4 py-2 text-xs text-gray-500 border-b">
          {getBrowserName(deviceInfo)}
        </div>

        {/* Step content */}
        <div className="p-5 min-h-[200px]">
          <div className="flex items-center gap-2 mb-4">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  idx <= step ? "bg-red-800" : "bg-gray-200"
                }`}
              />
            ))}
          </div>

          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 flex items-center justify-center">
              {steps[step]?.icon}
            </div>
            <h3 className="font-bold text-gray-900 text-lg mb-2">
              שלב {step + 1}: {steps[step]?.title}
            </h3>
            <p className="text-gray-600 text-sm leading-relaxed">
              {steps[step]?.description}
            </p>
          </div>
        </div>

        {/* Navigation */}
        <div className="border-t p-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="text-gray-500"
          >
            <ChevronRight className="h-4 w-4 ml-1" />
            הקודם
          </Button>

          <span className="text-xs text-gray-400">
            {step + 1} / {steps.length}
          </span>

          {step < steps.length - 1 ? (
            <Button
              size="sm"
              onClick={() => setStep(step + 1)}
              className="bg-red-800 hover:bg-red-900 text-white"
            >
              הבא
              <ChevronLeft className="h-4 w-4 mr-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onClose}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              הבנתי, תודה!
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================
// Guide Steps per Device/Browser
// =============================================
function getGuideSteps(deviceInfo) {
  const { isIOS, isSafari, isChromeiOS } = deviceInfo;

  if (isIOS && isSafari) {
    return [
      {
        title: 'לחץ על כפתור השיתוף',
        description: 'לחץ על כפתור השיתוף (הריבוע עם החץ למעלה) בתחתית המסך בדפדפן Safari.',
        icon: <ArrowUp className="h-8 w-8 text-blue-600" />,
      },
      {
        title: 'גלול ומצא "הוסף למסך הבית"',
        description: 'גלול למטה בתפריט השיתוף ולחץ על "הוסף למסך הבית" (Add to Home Screen).',
        icon: <Plus className="h-8 w-8 text-gray-700" />,
      },
      {
        title: 'לחץ "הוסף"',
        description: 'לחץ על "הוסף" בפינה הימנית העליונה. האפליקציה תופיע במסך הבית שלך!',
        icon: <Download className="h-8 w-8 text-green-600" />,
      },
    ];
  }

  if (isIOS && isChromeiOS) {
    return [
      {
        title: 'לחץ על כפתור השיתוף',
        description: 'לחץ על כפתור השיתוף (הריבוע עם החץ למעלה) בשורת הכלים של Chrome.',
        icon: <ArrowUp className="h-8 w-8 text-blue-600" />,
      },
      {
        title: 'בחר "הוסף למסך הבית"',
        description: 'בתפריט שנפתח, בחר באפשרות "הוסף למסך הבית" (Add to Home Screen).',
        icon: <Plus className="h-8 w-8 text-gray-700" />,
      },
      {
        title: 'אשר את ההתקנה',
        description: 'לחץ "הוסף" כדי לאשר. האפליקציה תופיע כאייקון במסך הבית שלך!',
        icon: <Download className="h-8 w-8 text-green-600" />,
      },
    ];
  }

  // iOS with other browsers (Firefox etc.)
  if (isIOS) {
    return [
      {
        title: 'לחץ על תפריט הדפדפן',
        description: 'לחץ על כפתור התפריט (שלוש נקודות או כפתור השיתוף) בדפדפן.',
        icon: <MoreVertical className="h-8 w-8 text-gray-700" />,
      },
      {
        title: 'בחר "הוסף למסך הבית"',
        description: 'חפש את האפשרות "הוסף למסך הבית" (Add to Home Screen) בתפריט.',
        icon: <Plus className="h-8 w-8 text-gray-700" />,
      },
      {
        title: 'אשר את ההתקנה',
        description: 'לחץ "הוסף" כדי לאשר. האפליקציה תופיע במסך הבית שלך!',
        icon: <Download className="h-8 w-8 text-green-600" />,
      },
    ];
  }

  // Android / Desktop fallback (shouldn't normally reach here if beforeinstallprompt works)
  return [
    {
      title: 'פתח את תפריט הדפדפן',
      description: 'לחץ על שלוש הנקודות (⋮) בפינה העליונה של הדפדפן.',
      icon: <MoreVertical className="h-8 w-8 text-gray-700" />,
    },
    {
      title: 'בחר "התקן אפליקציה"',
      description: 'חפש בתפריט את האפשרות "התקן אפליקציה" (Install App) או "הוסף למסך הבית".',
      icon: <Download className="h-8 w-8 text-blue-600" />,
    },
    {
      title: 'אשר את ההתקנה',
      description: 'לחץ "התקן" בחלון שנפתח. האפליקציה תותקן ותופיע במסך הבית או בשולחן העבודה!',
      icon: <Download className="h-8 w-8 text-green-600" />,
    },
  ];
}

function getBrowserName(deviceInfo) {
  if (deviceInfo.isIOS && deviceInfo.isSafari) return "Safari באייפון/אייפד";
  if (deviceInfo.isIOS && deviceInfo.isChromeiOS) return "Chrome באייפון/אייפד";
  if (deviceInfo.isIOS && deviceInfo.isFirefoxiOS) return "Firefox באייפון/אייפד";
  if (deviceInfo.isIOS) return "דפדפן באייפון/אייפד";
  if (deviceInfo.isAndroid && deviceInfo.isSamsungBrowser) return "Samsung Internet באנדרואיד";
  if (deviceInfo.isAndroid) return "דפדפן באנדרואיד";
  if (deviceInfo.isWindows) return "דפדפן ב-Windows";
  if (deviceInfo.isMac) return "דפדפן ב-Mac";
  return "דפדפן";
}