import { create } from 'zustand';

interface ScreenState {
  screenBase64: string | null;
  setScreenBase64: (url: string | null) => void;
}

export const useScreenStore = create<ScreenState>((set) => ({
  screenBase64: null,
  setScreenBase64: (url) =>
    set((state) => {
      if (
        state.screenBase64 &&
        state.screenBase64.startsWith('blob:') &&
        state.screenBase64 !== url &&
        typeof URL !== 'undefined' &&
        typeof URL.revokeObjectURL === 'function'
      ) {
        try {
          URL.revokeObjectURL(state.screenBase64);
        } catch {}
      }
      return { screenBase64: url };
    }),
}));