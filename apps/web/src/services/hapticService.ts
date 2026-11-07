/**
 * Native Android Tactile / Haptic Feedback Service
 * Bridges directly into Android's native Vibrator service via window.AndroidBridge
 * with ultra-short, non-blocking impulses for a crisp native Android app feel.
 */

interface AndroidHapticBridge {
  vibrate?: (durationMs: number) => void;
  isNativeAndroid?: () => boolean;
}

export function isNativeAndroidApp(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = (window as unknown as { AndroidBridge?: AndroidHapticBridge }).AndroidBridge;
  if (bridge) return true;
  return /AI_NetController_Android/i.test(navigator.userAgent || '');
}

export function triggerHapticFeedback(
  type: 'light' | 'medium' | 'heavy' | 'warning' | 'selection' = 'light'
): void {
  if (typeof window === 'undefined') return;
  try {
    const bridge = (window as unknown as { AndroidBridge?: AndroidHapticBridge }).AndroidBridge;
    const durationMap: Record<string, number> = {
      selection: 8,
      light: 10,
      medium: 18,
      heavy: 28,
      warning: 35,
    };
    const ms = durationMap[type] ?? 10;
    if (bridge && typeof bridge.vibrate === 'function') {
      bridge.vibrate(ms);
    }
  } catch {
    // Ignore on unsupported environments
  }
}
