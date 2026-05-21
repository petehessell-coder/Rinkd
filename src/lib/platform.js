// Shared PWA platform detection. The same logic lives inline in
// InstallButton.js and DownloadCTA.js (left as-is to avoid churning working
// install flows); new code should import from here so there's one canonical
// source going forward.

export function detectStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator && window.navigator.standalone === true) return true;
  return false;
}

export function detectPlatform() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isIPadOS = /Mac/.test(ua) && navigator.maxTouchPoints > 1;
  const isIos = isIOSDevice || isIPadOS;
  const isAndroid = /Android/.test(ua);
  const isInApp = /FBAN|FBAV|Instagram|Line|TikTok|Snapchat/.test(ua);
  const isIosChrome = isIos && /CriOS/.test(ua);
  const isIosFirefox = isIos && /FxiOS/.test(ua);
  const isIosSafari = isIos && /Safari/.test(ua) && !isIosChrome && !isIosFirefox && !isInApp;
  const isAndroidChrome = isAndroid && /Chrome/.test(ua) && !/EdgA|OPR/.test(ua);
  const isDesktopChrome = !isIos && !isAndroid && /Chrome/.test(ua) && !/Edg|OPR/.test(ua);
  const isDesktopEdge = !isIos && !isAndroid && /Edg/.test(ua);
  if (isIosSafari) return 'ios-safari';
  if (isIos)        return 'ios-other';     // Chrome/Firefox on iOS — can't install
  if (isAndroidChrome) return 'android-chrome';
  if (isAndroid)    return 'android-other';
  if (isDesktopChrome || isDesktopEdge) return 'desktop-chrome';
  return 'other';
}

// The one context where the "Add to Home Screen" install step is both
// available AND currently the thing blocking web push: iOS Safari that hasn't
// been installed to the home screen. (iOS Chrome/Firefox can't install at all,
// so they're deliberately excluded — pointing them at the share sheet would be
// wrong.)
export function iosCanInstallButHasnt() {
  return detectPlatform() === 'ios-safari' && !detectStandalone();
}
