import { create } from 'zustand';
import { getPersistentItem, setPersistentItem, syncSystemThemeToAndroid } from '../utils/nativeStorage';
import { NavTab } from '../components/layout/FloatingPillNav';
import { Language } from '../i18n/translations';

export type ModalType =
  | 'none'
  | 'wol'
  | 'screen'
  | 'memory'
  | 'code'
  | 'wsConfig'
  | 'update'
  | 'hitl'
  | 'hostDetails'
  | 'addHost'
  | 'pcDaemonGui'
  | 'quickSetup'
  | 'shortcuts'
  | 'onboarding';

export type AccentColorPreset = 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber' | 'cobalt';
export type FontFamilyPreset = 'geometric' | 'jakarta' | 'system' | 'mono';
export type GlassIntensityPreset = 'clear' | 'balanced' | 'frosted';
export type AmbientModePreset = 'fluid' | 'aurora' | 'cyber' | 'minimal';

export interface UIState {
  activeTab: NavTab;
  activeModal: ModalType;
  modalPayload: any | null;
  isOmnibarOpen: boolean;
  language: Language;
  selectedModel: string;
  pendingChatPrompt: string | null;
  hasCompletedOnboarding: boolean;

  // Liquid Glass, Fluid Motion & Appearance Customization
  accentColor: AccentColorPreset;
  fontFamily: FontFamilyPreset;
  glassIntensity: GlassIntensityPreset;
  ambientMode: AmbientModePreset;
  isCustomizationOpen: boolean;

  isAutoDiscovery: boolean;
  isHitlEnabled: boolean;
  isBiometricEnabled: boolean;
  isCommandConfirmations: boolean;
  isSystemStateAlerts: boolean;

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

  setAccentColor: (color: AccentColorPreset) => void;
  setFontFamily: (font: FontFamilyPreset) => void;
  setGlassIntensity: (glass: GlassIntensityPreset) => void;
  setAmbientMode: (mode: AmbientModePreset) => void;
  setCustomizationOpen: (open: boolean) => void;
  toggleCustomizationOpen: () => void;
  resetAppearance: () => void;
  setAutoDiscovery: (val: boolean) => void;
  setHitlEnabled: (val: boolean) => void;
  setBiometricEnabled: (val: boolean) => void;
  setCommandConfirmations: (val: boolean) => void;
  setSystemStateAlerts: (val: boolean) => void;
  hydrateSecuritySettings: (
    settings: Partial<{
      isAutoDiscovery: boolean;
      isHitlEnabled: boolean;
      isBiometricEnabled: boolean;
      isCommandConfirmations: boolean;
      isSystemStateAlerts: boolean;
    }>
  ) => void;
}

const VALID_ACCENTS: AccentColorPreset[] = ['cyan', 'violet', 'emerald', 'rose', 'amber', 'cobalt'];
const ACCENT_HEX_MAP: Record<AccentColorPreset, string> = {
  cyan: '#22d3ee',
  violet: '#c084fc',
  emerald: '#34d399',
  rose: '#fb7185',
  amber: '#fbbf24',
  cobalt: '#60a5fa',
};
const VALID_FONTS: FontFamilyPreset[] = ['geometric', 'jakarta', 'system', 'mono'];
const VALID_GLASS: GlassIntensityPreset[] = ['clear', 'balanced', 'frosted'];
const VALID_AMBIENT: AmbientModePreset[] = ['fluid', 'aurora', 'cyber', 'minimal'];

export const applyAppearanceToDocument = (prefs: {
  accentColor: AccentColorPreset;
  fontFamily: FontFamilyPreset;
  glassIntensity: GlassIntensityPreset;
  ambientMode: AmbientModePreset;
}) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-accent', prefs.accentColor);
  root.setAttribute('data-font', prefs.fontFamily);
  root.setAttribute('data-glass', prefs.glassIntensity);
  root.setAttribute('data-ambient', prefs.ambientMode);
  syncSystemThemeToAndroid(ACCENT_HEX_MAP[prefs.accentColor] || '#22d3ee', '#030712');
};

const getInitialOnboardingStatus = (): boolean => {
  try {
    return (
      getPersistentItem('ai_netcontroller_onboarding_completed') === 'true' ||
      getPersistentItem('cst_onboarding_completed') === 'true'
    );
  } catch {
    return false;
  }
};

const getInitialLanguage = (): Language => {
  try {
    const saved = getPersistentItem('wakeflow_language');
    if (saved === 'bg' || saved === 'en') return saved;
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('bg')) {
      return 'bg';
    }
  } catch {}
  return 'en';
};

const getInitialModel = (): string => {
  try {
    const saved = getPersistentItem('wakeflow_selected_model');
    if (saved) {
      if (/^gemini-(?:1\.[05]|3\.\d)/i.test(saved)) {
        return 'gemini-2.5-flash';
      }
      return saved;
    }
  } catch {}
  return 'gemini-2.5-flash';
};

const getInitialAccent = (): AccentColorPreset => {
  try {
    const saved = getPersistentItem('ai_netcontroller_accent') as AccentColorPreset;
    if (saved && VALID_ACCENTS.includes(saved)) return saved;
  } catch {}
  return 'cyan';
};

const getInitialFont = (): FontFamilyPreset => {
  try {
    const saved = getPersistentItem('ai_netcontroller_font') as FontFamilyPreset;
    if (saved && VALID_FONTS.includes(saved)) return saved;
  } catch {}
  return 'geometric';
};

const getInitialGlass = (): GlassIntensityPreset => {
  try {
    const saved = getPersistentItem('ai_netcontroller_glass') as GlassIntensityPreset;
    if (saved && VALID_GLASS.includes(saved)) return saved;
  } catch {}
  return 'balanced';
};

const getInitialAmbient = (): AmbientModePreset => {
  try {
    const saved = getPersistentItem('ai_netcontroller_ambient');
    if (saved === 'vibrant') return 'fluid';
    if (saved === 'subtle') return 'aurora';
    if (saved && VALID_AMBIENT.includes(saved as AmbientModePreset)) {
      return saved as AmbientModePreset;
    }
  } catch {}
  return 'fluid';
};

const getInitialCustomizationOpen = (): boolean => {
  try {
    const saved = getPersistentItem('ai_netcontroller_customization_open');
    if (saved !== null) return saved === 'true';
  } catch {}
  return true;
};

const initialAppearance = {
  accentColor: getInitialAccent(),
  fontFamily: getInitialFont(),
  glassIntensity: getInitialGlass(),
  ambientMode: getInitialAmbient(),
};

const INITIAL_SECURITY_SETTINGS = {
  isAutoDiscovery: true,
  isHitlEnabled: true,
  isBiometricEnabled: false,
  isCommandConfirmations: true,
  isSystemStateAlerts: true,
};

type SecuritySettingsKey = keyof typeof INITIAL_SECURITY_SETTINGS;

const getInitialSecuritySettings = () => {
  try {
    const raw = getPersistentItem('ai_net_ui_settings_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          isAutoDiscovery:
            typeof parsed.isAutoDiscovery === 'boolean'
              ? parsed.isAutoDiscovery
              : INITIAL_SECURITY_SETTINGS.isAutoDiscovery,
          isHitlEnabled:
            typeof parsed.isHitlEnabled === 'boolean'
              ? parsed.isHitlEnabled
              : INITIAL_SECURITY_SETTINGS.isHitlEnabled,
          isBiometricEnabled:
            typeof parsed.isBiometricEnabled === 'boolean'
              ? parsed.isBiometricEnabled
              : INITIAL_SECURITY_SETTINGS.isBiometricEnabled,
          isCommandConfirmations:
            typeof parsed.isCommandConfirmations === 'boolean'
              ? parsed.isCommandConfirmations
              : INITIAL_SECURITY_SETTINGS.isCommandConfirmations,
          isSystemStateAlerts:
            typeof parsed.isSystemStateAlerts === 'boolean'
              ? parsed.isSystemStateAlerts
              : INITIAL_SECURITY_SETTINGS.isSystemStateAlerts,
        };
      }
    }
  } catch {}
  return { ...INITIAL_SECURITY_SETTINGS };
};

const initialSecuritySettings = getInitialSecuritySettings();

const persistSecuritySetting = (patch: Partial<Record<SecuritySettingsKey, boolean>>) => {
  try {
    const current = getInitialSecuritySettings();
    setPersistentItem('ai_net_ui_settings_v1', JSON.stringify({ ...current, ...patch }));
  } catch {}
};

applyAppearanceToDocument(initialAppearance);

export const useUIStore = create<UIState>((set, get) => ({
  activeTab: 'fleet',
  activeModal: 'none',
  modalPayload: null,
  isOmnibarOpen: false,
  language: getInitialLanguage(),
  selectedModel: getInitialModel(),
  pendingChatPrompt: null,
  hasCompletedOnboarding: getInitialOnboardingStatus(),

  accentColor: initialAppearance.accentColor,
  fontFamily: initialAppearance.fontFamily,
  glassIntensity: initialAppearance.glassIntensity,
  ambientMode: initialAppearance.ambientMode,
  isCustomizationOpen: getInitialCustomizationOpen(),

  isAutoDiscovery: initialSecuritySettings.isAutoDiscovery,
  isHitlEnabled: initialSecuritySettings.isHitlEnabled,
  isBiometricEnabled: initialSecuritySettings.isBiometricEnabled,
  isCommandConfirmations: initialSecuritySettings.isCommandConfirmations,
  isSystemStateAlerts: initialSecuritySettings.isSystemStateAlerts,

  setActiveTab: (tab) => set({ activeTab: tab }),
  openModal: (type, payload = null) => set({ activeModal: type, modalPayload: payload }),
  closeModal: () => set({ activeModal: 'none', modalPayload: null }),
  toggleOmnibar: () => set((state) => ({ isOmnibarOpen: !state.isOmnibarOpen })),
  setOmnibarOpen: (isOpen) => set({ isOmnibarOpen: isOpen }),
  setCompletedOnboarding: () => {
    try {
      setPersistentItem('ai_netcontroller_onboarding_completed', 'true');
      setPersistentItem('cst_onboarding_completed', 'true');
      setPersistentItem('ai_netcontroller_onboarding_banner_dismissed', 'true');
      setPersistentItem('cst_onboarding_banner_dismissed', 'true');
    } catch {}
    set({ hasCompletedOnboarding: true });
  },
  setLanguage: (lang) => {
    try {
      setPersistentItem('wakeflow_language', lang);
    } catch {}
    set({ language: lang });
  },
  toggleLanguage: () =>
    set((state) => {
      const nextLang: Language = state.language === 'bg' ? 'en' : 'bg';
      try {
        setPersistentItem('wakeflow_language', nextLang);
      } catch {}
      return { language: nextLang };
    }),
  setSelectedModel: (model) => {
    try {
      setPersistentItem('wakeflow_selected_model', model);
    } catch {}
    set({ selectedModel: model });
  },
  setPendingChatPrompt: (prompt) => set({ pendingChatPrompt: prompt }),

  setAccentColor: (accentColor) => {
    try {
      setPersistentItem('ai_netcontroller_accent', accentColor);
    } catch {}
    const s = get();
    applyAppearanceToDocument({
      accentColor,
      fontFamily: s.fontFamily,
      glassIntensity: s.glassIntensity,
      ambientMode: s.ambientMode,
    });
    set({ accentColor });
  },

  setFontFamily: (fontFamily) => {
    try {
      setPersistentItem('ai_netcontroller_font', fontFamily);
    } catch {}
    const s = get();
    applyAppearanceToDocument({
      accentColor: s.accentColor,
      fontFamily,
      glassIntensity: s.glassIntensity,
      ambientMode: s.ambientMode,
    });
    set({ fontFamily });
  },

  setGlassIntensity: (glassIntensity) => {
    try {
      setPersistentItem('ai_netcontroller_glass', glassIntensity);
    } catch {}
    const s = get();
    applyAppearanceToDocument({
      accentColor: s.accentColor,
      fontFamily: s.fontFamily,
      glassIntensity,
      ambientMode: s.ambientMode,
    });
    set({ glassIntensity });
  },

  setAmbientMode: (ambientMode) => {
    try {
      setPersistentItem('ai_netcontroller_ambient', ambientMode);
    } catch {}
    const s = get();
    applyAppearanceToDocument({
      accentColor: s.accentColor,
      fontFamily: s.fontFamily,
      glassIntensity: s.glassIntensity,
      ambientMode,
    });
    set({ ambientMode });
  },

  setCustomizationOpen: (open) => {
    try {
      setPersistentItem('ai_netcontroller_customization_open', String(open));
    } catch {}
    set({ isCustomizationOpen: open });
  },

  toggleCustomizationOpen: () =>
    set((state) => {
      const next = !state.isCustomizationOpen;
      try {
        setPersistentItem('ai_netcontroller_customization_open', String(next));
      } catch {}
      return { isCustomizationOpen: next };
    }),

  resetAppearance: () => {
    const defaults = {
      accentColor: 'cyan' as AccentColorPreset,
      fontFamily: 'geometric' as FontFamilyPreset,
      glassIntensity: 'balanced' as GlassIntensityPreset,
      ambientMode: 'fluid' as AmbientModePreset,
    };
    try {
      setPersistentItem('ai_netcontroller_accent', defaults.accentColor);
      setPersistentItem('ai_netcontroller_font', defaults.fontFamily);
      setPersistentItem('ai_netcontroller_glass', defaults.glassIntensity);
      setPersistentItem('ai_netcontroller_ambient', defaults.ambientMode);
    } catch {}
    applyAppearanceToDocument(defaults);
    set(defaults);
  },

  setAutoDiscovery: (val) => {
    persistSecuritySetting({ isAutoDiscovery: val });
    set({ isAutoDiscovery: val });
  },

  setHitlEnabled: (val) => {
    persistSecuritySetting({ isHitlEnabled: val });
    set({ isHitlEnabled: val });
  },

  setBiometricEnabled: (val) => {
    persistSecuritySetting({ isBiometricEnabled: val });
    set({ isBiometricEnabled: val });
  },

  setCommandConfirmations: (val) => {
    persistSecuritySetting({ isCommandConfirmations: val });
    set({ isCommandConfirmations: val });
  },

  setSystemStateAlerts: (val) => {
    persistSecuritySetting({ isSystemStateAlerts: val });
    set({ isSystemStateAlerts: val });
  },

  hydrateSecuritySettings: (settings) => {
    const cleanPatch: Partial<Record<SecuritySettingsKey, boolean>> = {};
    if (typeof settings.isAutoDiscovery === 'boolean') {
      cleanPatch.isAutoDiscovery = settings.isAutoDiscovery;
    }
    if (typeof settings.isHitlEnabled === 'boolean') {
      cleanPatch.isHitlEnabled = settings.isHitlEnabled;
    }
    if (typeof settings.isBiometricEnabled === 'boolean') {
      cleanPatch.isBiometricEnabled = settings.isBiometricEnabled;
    }
    if (typeof settings.isCommandConfirmations === 'boolean') {
      cleanPatch.isCommandConfirmations = settings.isCommandConfirmations;
    }
    if (typeof settings.isSystemStateAlerts === 'boolean') {
      cleanPatch.isSystemStateAlerts = settings.isSystemStateAlerts;
    }
    if (Object.keys(cleanPatch).length > 0) {
      persistSecuritySetting(cleanPatch);
      set(cleanPatch);
    }
  },
}));
