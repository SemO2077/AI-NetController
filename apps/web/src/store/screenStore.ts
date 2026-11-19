import { create } from 'zustand';

interface ScreenState {
  screenBase64: string | null;
  setScreenBase64: (url: string | null) => void;
}

function scheduleBlobRevoke(url: string | null) {
  if (
    url &&
    url.startsWith('blob:') &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    // Delay revocation slightly so in-flight <img> paints complete without ERR_FILE_NOT_FOUND
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 1000);
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
  useScreenStore.getState().setScreenBase64(null);
}