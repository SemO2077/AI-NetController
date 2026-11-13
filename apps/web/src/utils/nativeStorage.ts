interface AndroidPrefBridge {
  getPref?: (key: string) => string | null;
  setPref?: (key: string, value: string) => boolean;
  removePref?: (key: string) => boolean;
  setSystemTheme?: (accentHex: string, surfaceHex: string) => boolean;
}

function getAndroidBridge(): AndroidPrefBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { AndroidBridge?: AndroidPrefBridge }).AndroidBridge;
}

/**
 * Reads a persisted non-secret preference from WebView localStorage with
 * automatic fallback/backfill from Android native SharedPreferences.
 */
export function getPersistentItem(key: string): string | null {
  let localVal: string | null = null;
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      localVal = window.localStorage.getItem(key);
    } catch {
      localVal = null;
    }
  }
  if (localVal !== null) return localVal;

  const bridge = getAndroidBridge();
  if (bridge && typeof bridge.getPref === 'function') {
    try {
      const nativeVal = bridge.getPref(key);
      if (typeof nativeVal === 'string' && nativeVal.length > 0) {
        try {
          window.localStorage?.setItem(key, nativeVal);
        } catch {}
        return nativeVal;
      }
    } catch {}
  }
  return null;
}

/**
 * Writes a non-secret preference to both localStorage and Android native
 * SharedPreferences so customizations survive port changes or WebView resets.
 */
export function setPersistentItem(key: string, value: string): void {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  }
  const bridge = getAndroidBridge();
  if (bridge && typeof bridge.setPref === 'function') {
    try {
      bridge.setPref(key, value);
    } catch {}
  }
}

export function syncSystemThemeToAndroid(accentHex: string, surfaceHex = '#030712'): void {
  const bridge = getAndroidBridge();
  if (bridge && typeof bridge.setSystemTheme === 'function') {
    try {
      bridge.setSystemTheme(accentHex, surfaceHex);
    } catch {}
  }
}
