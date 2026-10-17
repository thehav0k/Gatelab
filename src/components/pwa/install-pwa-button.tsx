"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share, Smartphone, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const emptySubscribe = () => () => {};

function getIsStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function subscribeStandalone(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", callback);
  window.addEventListener("appinstalled", callback);
  return () => {
    mq.removeEventListener("change", callback);
    window.removeEventListener("appinstalled", callback);
  };
}

function getIsIosSafari() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /safari/.test(ua) && !/chrome|crios|fxios|edgios/.test(ua);
  return isIos && isSafari;
}

export function InstallPwaButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const isStandalone = useSyncExternalStore(subscribeStandalone, getIsStandalone, () => false);
  const isIosSafari = useSyncExternalStore(emptySubscribe, getIsIosSafari, () => false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Register offline Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Ignore registration errors in dev mode
      });
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setJustInstalled(true);
      setDeferredPrompt(null);
      toast.success("GateLab installed! You can now launch it offline from your home screen.");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (isStandalone || justInstalled) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] text-emerald-400"
        title="GateLab PWA is installed and ready for offline use"
      >
        <CheckCircle2 className="size-3" />
        <span>Offline App</span>
      </span>
    );
  }

  if (!deferredPrompt && !isIosSafari) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
      }
      return;
    }

    if (isIosSafari) {
      setShowIosGuide((v) => !v);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={handleInstallClick}
        className="h-8 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
        title="Install GateLab as an offline app on your phone, tablet, or desktop"
      >
        <Download className="size-3.5" />
        <span className="hidden sm:inline">Install App</span>
      </Button>

      {showIosGuide && (
        <div className="absolute right-0 top-10 z-50 w-72 rounded-lg border bg-card p-3.5 shadow-xl text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1.5 text-foreground">
              <Smartphone className="size-4 text-primary" />
              Install on iPhone / iPad
            </span>
            <button
              type="button"
              onClick={() => setShowIosGuide(false)}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <ol className="list-decimal pl-4 space-y-1.5 text-muted-foreground">
            <li>
              Tap the Safari <strong className="text-foreground">Share</strong> button{" "}
              <Share className="inline size-3.5 text-sky-400" /> in your browser bar.
            </li>
            <li>
              Scroll down and tap <strong className="text-foreground">&ldquo;Add to Home Screen&rdquo;</strong>.
            </li>
            <li>
              Tap <strong className="text-foreground">Add</strong> to launch GateLab full-screen with offline support.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
