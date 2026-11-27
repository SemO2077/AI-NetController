import { create } from 'zustand';

interface ScreenState {
  screenBase64: string | null;
  setScreenBase64: (url: string | null) => void;
}

const pendingRevokeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function revokeBlobNow(url: string) {
  const existing = pendingRevokeTimers.get(url);
  if (existing) {
    clearTimeout(existing);
    pendingRevokeTimers.delete(url);
  }
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}

function scheduleBlobRevoke(url: string | null) {
  if (
    url &&
    url.startsWith('blob:') &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    if (pendingRevokeTimers.has(url)) return;
    // Delay revocation slightly so in-flight <img> paints complete without ERR_FILE_NOT_FOUND
    const timer = setTimeout(() => {
      pendingRevokeTimers.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 1000);
    pendingRevokeTimers.set(url, timer);
  }
}

export const useScreenStore = create<ScreenState>((set) => ({
  screenBase64: null,
  setScreenBase64: (url) =>
    set((state) => {
      if (state.screenBase64 && state.screenBase64 !== url) {
        scheduleBlobRevoke(state.screenBase64);
      }
      return { screenBase64: url };
    }),
}));

// High-frequency off-React binary JPEG frame pub/sub for 60 FPS canvas rendering
let latestFrameBuffer: ArrayBuffer | null = null;
const frameSubscribers = new Set<(bytes: ArrayBuffer) => void>();

export function publishScreenFrame(bytes: ArrayBuffer): void {
  latestFrameBuffer = bytes;
  for (const listener of frameSubscribers) {
    try {
      listener(bytes);
    } catch {
      // ignore subscriber failure
    }
  }
}

export function subscribeScreenFrames(listener: (bytes: ArrayBuffer) => void): () => void {
  frameSubscribers.add(listener);
  return () => {
    frameSubscribers.delete(listener);
  };
}

export function getLatestScreenFrame(): ArrayBuffer | null {
  return latestFrameBuffer;
}

export function clearScreenFrames(): void {
  latestFrameBuffer = null;
  const current = useScreenStore.getState().screenBase64;
  useScreenStore.getState().setScreenBase64(null);
  if (current && current.startsWith('blob:')) {
    revokeBlobNow(current);
  }
  for (const url of Array.from(pendingRevokeTimers.keys())) {
    revokeBlobNow(url);
  }
}