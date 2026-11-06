import { create } from 'zustand';
import { NavTab } from '../components/layout/FloatingPillNav';
import { Language } from '../i18n/translations';

export type ModalType = 'none' | 'wol' | 'screen' | 'memory' | 'code' | 'wsConfig' | 'update' | 'hitl' | 'hostDetails' | 'addHost' | 'pcDaemonGui' | 'quickSetup' | 'shortcuts' | 'onboarding';

export interface UIState {
  activeTab: NavTab;
  activeModal: ModalType;
  modalPayload: any | null;
  isOmnibarOpen: boolean;
  language: Language;
  selectedModel: string;
  pendingChatPrompt: string | null;
  hasCompletedOnboarding: boolean;

  setActiveTab: (tab: NavTab) => void;
  openModal: (type: ModalType, payload?: any) => void;
  closeModal: () => void;
  toggleOmnibar: () => void;
  setOmnibarOpen: (isOpen: boolean) => void;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  setSelectedModel: (model: string) => void;
  setPendingChatPrompt: (prompt: string | null) => void;
  setCompletedOnboarding: () => void;
}

const getInitialOnboardingStatus = (): boolean => {
  try {
    return localStorage.getItem('cst_onboarding_completed') === 'true';
  } catch {
    return false;
  }
};

const getInitialLanguage = (): Language => {
  try {
    const saved = localStorage.getItem('wakeflow_language');
    if (saved === 'bg' || saved === 'en') return saved;
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('bg')) {
      return 'bg';
    }
  } catch {}
  return 'bg';
};

const getInitialModel = (): string => {
  try {
    const saved = localStorage.getItem('wakeflow_selected_model');
    if (saved) {
      if (
        saved === 'gemini-1.5-flash' ||
        saved === 'gemini-1.5-pro' ||
        saved === 'gemini-2.0-flash' ||
        saved === 'gemini-2.5-flash'
      ) {
        return 'gemini-3.8-flash';
      }
      return saved;
    }
  } catch {}
  return 'gemini-3.8-flash';
};

export const useUIStore = create<UIState>((set) => ({
  activeTab: 'fleet',
  activeModal: 'none',
  modalPayload: null,
  isOmnibarOpen: false,
  language: getInitialLanguage(),
  selectedModel: getInitialModel(),
  pendingChatPrompt: null,
  hasCompletedOnboarding: getInitialOnboardingStatus(),

  setActiveTab: (tab) => set({ activeTab: tab }),
  openModal: (type, payload = null) => set({ activeModal: type, modalPayload: payload }),
  closeModal: () => set({ activeModal: 'none', modalPayload: null }),
  toggleOmnibar: () => set((state) => ({ isOmnibarOpen: !state.isOmnibarOpen })),
  setOmnibarOpen: (isOpen) => set({ isOmnibarOpen: isOpen }),
  setCompletedOnboarding: () => {
    try {
      localStorage.setItem('cst_onboarding_completed', 'true');
      localStorage.setItem('cst_onboarding_banner_dismissed', 'true');
    } catch {}
    set({ hasCompletedOnboarding: true });
  },
  setLanguage: (lang) => {
    try {
      localStorage.setItem('wakeflow_language', lang);
    } catch {}
    set({ language: lang });
  },
  toggleLanguage: () =>
    set((state) => {
      const nextLang: Language = state.language === 'bg' ? 'en' : 'bg';
      try {
        localStorage.setItem('wakeflow_language', nextLang);
      } catch {}
      return { language: nextLang };
    }),
  setSelectedModel: (model) => {
    try {
      localStorage.setItem('wakeflow_selected_model', model);
    } catch {}
    set({ selectedModel: model });
  },
  setPendingChatPrompt: (prompt) => set({ pendingChatPrompt: prompt }),
}));
