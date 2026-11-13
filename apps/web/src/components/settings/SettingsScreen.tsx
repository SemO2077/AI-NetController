import React, { useState } from 'react';
import {
  Brain,
  Radio,
  FileText,
  ShieldAlert,
  Fingerprint,
  Bell,
  Activity,
  ArrowUpCircle,
  ChevronRight,
  ChevronDown,
  Terminal,
  Check,
  RefreshCw,
  Clock,
  Languages,
  Monitor,
  ShieldCheck,
  QrCode,
  Sparkles,
  Palette,
  Type,
  Layers,
  RotateCcw,
  Eye,
  EyeOff,
  Code2,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { HostDevice, WolPacketPayload, WolPacketTriggerSource, WolSchedule } from '../../types';
import { WolEnergyCalculator } from '../wol/WolEnergyCalculator';
import { WolHistoryLogViewer } from '../wol/WolHistoryLogViewer';
import { useTranslation } from '../../i18n/useTranslation';
import { LanguageToggle } from '../ui/LanguageToggle';
import {
  useUIStore,
  AccentColorPreset,
  FontFamilyPreset,
  GlassIntensityPreset,
  AmbientModePreset,
} from '../../store/uiStore';
import {
  SPRING_POP,
  POPOVER_BUBBLE_VARIANTS,
  MODAL_BUBBLE_VARIANTS,
} from '../../utils/springPhysics';

interface SettingsScreenProps {
  onOpenPersistentInstructions: () => void;
  onOpenCodeViewer: () => void;
  onOpenWsConfig: () => void;
  onOpenTerminalLogs: () => void;
  onOpenUpdateCenter?: () => void;
  onOpenWolScheduler?: () => void;
  activeWolSchedulesCount?: number;
  wolSchedules?: WolSchedule[];
  hostsCount?: number;
  hosts?: HostDevice[];
  onSendWolPacket?: (
    payload: WolPacketPayload,
    deviceId: string,
    source?: WolPacketTriggerSource,
    customDeviceName?: string
  ) => void;
}

const SettingsScreenComponent: React.FC<SettingsScreenProps> = ({
  onOpenPersistentInstructions,
  onOpenCodeViewer,
  onOpenWsConfig,
  onOpenTerminalLogs,
  onOpenUpdateCenter,
  onOpenWolScheduler,
  activeWolSchedulesCount,
  wolSchedules,
  hostsCount,
  hosts,
  onSendWolPacket,
}) => {
  const { t, language } = useTranslation();

  const selectedModel = useUIStore((s) => s.selectedModel);
  const setSelectedModel = useUIStore((s) => s.setSelectedModel);
  const accentColor = useUIStore((s) => s.accentColor);
  const setAccentColor = useUIStore((s) => s.setAccentColor);
  const fontFamily = useUIStore((s) => s.fontFamily);
  const setFontFamily = useUIStore((s) => s.setFontFamily);
  const glassIntensity = useUIStore((s) => s.glassIntensity);
  const setGlassIntensity = useUIStore((s) => s.setGlassIntensity);
  const ambientMode = useUIStore((s) => s.ambientMode);
  const setAmbientMode = useUIStore((s) => s.setAmbientMode);
  const isCustomizationOpen = useUIStore((s) => s.isCustomizationOpen);
  const toggleCustomizationOpen = useUIStore((s) => s.toggleCustomizationOpen);
  const resetAppearance = useUIStore((s) => s.resetAppearance);
  const isAutoDiscovery = useUIStore((s) => s.isAutoDiscovery);
  const setAutoDiscovery = useUIStore((s) => s.setAutoDiscovery);
  const isHitlEnabled = useUIStore((s) => s.isHitlEnabled);
  const setHitlEnabled = useUIStore((s) => s.setHitlEnabled);
  const isBiometricEnabled = useUIStore((s) => s.isBiometricEnabled);
  const setBiometricEnabled = useUIStore((s) => s.setBiometricEnabled);
  const isCommandConfirmations = useUIStore((s) => s.isCommandConfirmations);
  const setCommandConfirmations = useUIStore((s) => s.setCommandConfirmations);
  const isSystemStateAlerts = useUIStore((s) => s.isSystemStateAlerts);
  const setSystemStateAlerts = useUIStore((s) => s.setSystemStateAlerts);
  const hydrateSecuritySettings = useUIStore((s) => s.hydrateSecuritySettings);

  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isAddModelOpen, setIsAddModelOpen] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelProvider, setNewModelProvider] = useState<
    'gemini' | 'ollama' | 'deepseek' | 'custom'
  >('gemini');
  const [newModelDesc, setNewModelDesc] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [settingsSyncError, setSettingsSyncError] = useState<string | null>(null);
  const [biometricNotice, setBiometricNotice] = useState<string | null>(null);

  const DEFAULT_BUILTIN_MODEL_IDS = new Set([
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-flash-latest',
    'deepseek-r1:latest',
  ]);

  const persistSettingPatch = async (
    patch: Partial<{
      isAutoDiscovery: boolean;
      isHitlEnabled: boolean;
      isBiometricEnabled: boolean;
      isCommandConfirmations: boolean;
      isSystemStateAlerts: boolean;
    }>
  ) => {
    setSettingsSyncError(null);
    if (typeof patch.isAutoDiscovery === 'boolean') setAutoDiscovery(patch.isAutoDiscovery);
    if (typeof patch.isHitlEnabled === 'boolean') setHitlEnabled(patch.isHitlEnabled);
    if (typeof patch.isBiometricEnabled === 'boolean') setBiometricEnabled(patch.isBiometricEnabled);
    if (typeof patch.isCommandConfirmations === 'boolean') {
      setCommandConfirmations(patch.isCommandConfirmations);
    }
    if (typeof patch.isSystemStateAlerts === 'boolean') {
      setSystemStateAlerts(patch.isSystemStateAlerts);
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSettingsSyncError(
          data.error ||
            (language === 'bg'
              ? `Неуспешно запазване на настройката (HTTP ${res.status}).`
              : `Failed to persist setting (HTTP ${res.status}).`)
        );
        return;
      }
      if (data?.settings) {
        hydrateSecuritySettings(data.settings);
      }
    } catch {
      setSettingsSyncError(
        language === 'bg'
          ? 'Контролният сървър е офлайн — настройката е запазена локално.'
          : 'Control server offline — preference saved locally.'
      );
    }
  };

  const handleToggleBiometric = async (nextVal: boolean) => {
    setBiometricNotice(null);
    if (nextVal) {
      if (
        typeof window === 'undefined' ||
        !window.isSecureContext ||
        typeof window.PublicKeyCredential === 'undefined'
      ) {
        setBiometricNotice(
          language === 'bg'
            ? 'WebAuthn / биометричната защита изисква HTTPS или защитен локален контекст (localhost).'
            : 'WebAuthn biometric lock requires HTTPS or a secure localhost context.'
        );
        return;
      }
      try {
        const available =
          typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
          'function'
            ? await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
            : true;
        if (!available) {
          setBiometricNotice(
            language === 'bg'
              ? 'Няма открит хардуерен биометричен/PIN модул (Platform Authenticator) на това устройство.'
              : 'No platform biometric authenticator detected on this device.'
          );
          return;
        }
      } catch {
        setBiometricNotice(
          language === 'bg'
            ? 'Неуспешна проверка на биометричния хардуерен модул.'
            : 'Unable to verify hardware biometric authenticator.'
        );
        return;
      }
    }
    await persistSettingPatch({ isBiometricEnabled: nextVal });
  };

  const handleDeleteCustomModel = async (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (DEFAULT_BUILTIN_MODEL_IDS.has(modelId)) return;
    triggerHapticFeedback('medium');
    setSettingsSyncError(null);
    try {
      const res = await fetch(`/api/ai/models/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && Array.isArray(data.models)) {
        setModelsList(data.models);
        if (selectedModel === modelId && data.models.length > 0) {
          setSelectedModel(data.models[0].id);
        }
      } else {
        setSettingsSyncError(
          data.error ||
            (language === 'bg' ? 'Неуспешно премахване на модела.' : 'Failed to remove custom model.')
        );
      }
    } catch {
      setSettingsSyncError(
        language === 'bg' ? 'Грешка при връзка със сървъра.' : 'Failed to reach control server.'
      );
    }
  };

  const [modelsList, setModelsList] = useState<
    Array<{
      id: string;
      name: string;
      nameBg?: string;
      description: string;
      descriptionBg?: string;
      provider: string;
    }>
  >([
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash (Recommended)',
      nameBg: 'Gemini 2.5 Flash (Препоръчителен)',
      description: 'Fast multimodal reasoning model for real-time fleet triage & control',
      descriptionBg:
        'Бърз мултимодален модел за диагностика на флота и управление в реално време',
      provider: 'gemini',
    },
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      nameBg: 'Gemini 2.5 Pro',
      description: 'Deep reasoning and complex PowerShell/Linux orchestration model',
      descriptionBg: 'Модел за дълбоко разсъждение и сложна PowerShell/Linux оркестрация',
      provider: 'gemini',
    },
    {
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      nameBg: 'Gemini 2.0 Flash',
      description: 'Lightweight low-latency model for quick sysadmin tasks',
      descriptionBg: 'Лек модел с ниско закъснение за бързи системни задачи',
      provider: 'gemini',
    },
    {
      id: 'gemini-flash-latest',
      name: 'Gemini Flash Latest',
      nameBg: 'Gemini Flash Latest',
      description: 'High-speed agentic model with structured tool-use capabilities',
      descriptionBg: 'Високоскоростен агентен модел със структурирано извикване на инструменти',
      provider: 'gemini',
    },
    {
      id: 'deepseek-r1:latest',
      name: 'DeepSeek-R1 (Local / Ollama)',
      nameBg: 'DeepSeek-R1 (Локален / Ollama)',
      description: 'Reasoning model for offline air-gapped network management',
      descriptionBg: 'Локален модел за разсъждение и автономно управление в изолирани мрежи',
      provider: 'deepseek',
    },
  ]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch('/api/ai/models', { credentials: 'include', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data?.models) && data.models.length > 0) {
          setModelsList(data.models);
        }
      })
      .catch(() => {});

    fetch('/api/settings', { credentials: 'include', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && data?.settings) {
          hydrateSecuritySettings(data.settings);
        }
      })
      .catch(() => {});

    return () => {
      controller.abort();
    };
  }, [hydrateSecuritySettings]);

  const handleTestModel = async (modelId: string) => {
    setIsTestingModel(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setTestResult(`⚡ Online (${data.latencyMs}ms)`);
      } else {
        setTestResult(
          `⚠️ ${data.error || (!res.ok ? `HTTP ${res.status}` : language === 'bg' ? 'Неуспешен тест' : 'Test failed')}`
        );
      }
    } catch {
      setTestResult(language === 'bg' ? '⚠️ Грешка при връзка' : '⚠️ Connection error');
    } finally {
      setIsTestingModel(false);
    }
  };

  const handleAddCustomModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModelId.trim() || !newModelName.trim()) return;

    try {
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: newModelId,
          name: newModelName,
          provider: newModelProvider,
          description: newModelDesc || 'Custom Model Endpoint',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.models) {
        setModelsList(data.models);
        setSelectedModel(data.model.id);
        setNewModelId('');
        setNewModelName('');
        setNewModelDesc('');
        setIsAddModelOpen(false);
        triggerHapticFeedback('medium');
      } else {
        setTestResult(`⚠️ ${data.error || `HTTP ${res.status}`}`);
      }
    } catch {
      setTestResult(language === 'bg' ? '⚠️ Грешка при запазване' : '⚠️ Failed to save model');
    }
  };

  const CyberToggle = ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        triggerHapticFeedback('light');
        onChange(!checked);
      }}
      className="p-1.5 min-w-[44px] min-h-[40px] flex items-center justify-center shrink-0"
      aria-label="Toggle setting"
    >
      <div
        className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-150 flex items-center relative border ${
          checked
            ? 'bg-cyan-500/25 border-cyan-400/55'
            : 'bg-white/10 border-white/15'
        }`}
      >
        <motion.div
          initial={false}
          animate={{ x: checked ? 20 : 0 }}
          transition={SPRING_POP}
          className={`w-4.5 h-4.5 rounded-full ${
            checked ? 'bg-cyan-300' : 'bg-slate-400'
          }`}
        />
      </div>
    </button>
  );

  return (
    <div className="w-full max-w-6xl mx-auto pb-6 select-none space-y-5">
      {/* =====================================================================
          TOP COMMAND BAR: 4 QUICK-LAUNCH CONTROL CENTERS
         ===================================================================== */}
      <div className="space-y-2">
        <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
          {language === 'bg' ? 'БЪРЗ ДОСТЪП И КОНТРОЛНИ ЦЕНТРОВЕ' : 'QUICK-LAUNCH CONTROL CENTERS'}
        </span>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {/* 1. Phone & PC Pairing Setup */}
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              useUIStore.getState().openModal('quickSetup');
            }}
            className="glass-liquid p-3.5 rounded-2xl text-left flex items-start gap-3 group active:scale-[0.98]"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center border border-emerald-400/35 shrink-0">
              <QrCode className="w-5 h-5 icon-bubbly" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-xs sm:text-sm font-bold text-white truncate">
                {language === 'bg' ? 'Сдвои Телефон & PC' : 'Pair Phone & PC'}
              </div>
              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                {language === 'bg' ? '1-клик QR код и LAN' : '1-Tap QR & LAN Setup'}
              </div>
            </div>
          </button>

          {/* 2. PC Daemon Control Center */}
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              useUIStore.getState().openModal('pcDaemonGui');
            }}
            className="glass-liquid p-3.5 rounded-2xl text-left flex items-start gap-3 group active:scale-[0.98]"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/35 shrink-0">
              <Monitor className="w-5 h-5 icon-bubbly" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-xs sm:text-sm font-bold text-white truncate flex items-center gap-1.5">
                <span className="truncate">
                  {language === 'bg' ? 'PC Демон Център' : 'PC Daemon Center'}
                </span>
              </div>
              <div className="text-[11px] text-emerald-300/90 font-mono truncate mt-0.5 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {language === 'bg' ? 'Защита и Сесии' : 'Safeguards & Peers'}
                </span>
              </div>
            </div>
          </button>

          {/* 3. System & AI Update Center */}
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              if (onOpenUpdateCenter) onOpenUpdateCenter();
            }}
            className="glass-liquid p-3.5 rounded-2xl text-left flex items-start gap-3 group active:scale-[0.98]"
          >
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-300 flex items-center justify-center border border-sky-400/35 shrink-0">
              <RefreshCw className="w-5 h-5 icon-spin-bubbly" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-xs sm:text-sm font-bold text-white truncate">
                {language === 'bg' ? 'Системен & AI Център' : 'System & AI Center'}
              </div>
              <div className="text-[11px] text-cyan-300 font-mono truncate mt-0.5">
                Beta v0.60.0 • AI-NET/3.0
              </div>
            </div>
          </button>

          {/* 4. Interactive App Guide */}
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              useUIStore.getState().openModal('onboarding');
            }}
            className="glass-liquid p-3.5 rounded-2xl text-left flex items-start gap-3 group active:scale-[0.98]"
          >
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center border border-violet-400/35 shrink-0">
              <Sparkles className="w-5 h-5 icon-sparkle-live" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-xs sm:text-sm font-bold text-white truncate">
                {language === 'bg' ? 'Ръководство' : 'Interactive Guide'}
              </div>
              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                {language === 'bg' ? 'Обиколка на функциите' : 'App Tour & Help'}
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* =====================================================================
          MAIN 2-COLUMN ORGANIZED SETTINGS GRID
         ===================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN (6 cols): CONNECTION, AI COPILOT & SECURITY */}
        <div className="lg:col-span-6 flex flex-col space-y-5">
          {/* GROUP 1: CONNECTION, NETWORK DISCOVERY & LANGUAGE */}
          <div className="space-y-2 relative z-20">
            <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
              {language === 'bg' ? '1. ВРЪЗКА, МРЕЖА И ЕЗИК' : '1. CONNECTION, NETWORK & LANGUAGE'}
            </span>

            <div className="glass-liquid w-full rounded-2xl divide-y divide-white/[0.06] overflow-hidden">
              {/* WebSocket Endpoint Config */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onOpenWsConfig();
                }}
                className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/12 text-emerald-300 flex items-center justify-center border border-emerald-500/25 shrink-0">
                    <ArrowUpCircle className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_ws_config')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_ws_config_desc')}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              {/* Auto Discovery (mDNS) */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/25 shrink-0">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_autodiscovery')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_autodiscovery_desc')}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    void persistSettingPatch({ isAutoDiscovery: !isAutoDiscovery });
                  }}
                  className={`px-3 py-1.5 h-8 rounded-lg text-[10px] font-mono font-bold uppercase transition shrink-0 active:scale-95 ${
                    isAutoDiscovery
                      ? 'bg-emerald-500/18 text-emerald-300 border border-emerald-500/40'
                      : 'bg-white/5 text-slate-400 border border-white/10'
                  }`}
                >
                  {isAutoDiscovery
                    ? language === 'bg'
                      ? 'mDNS АКТИВЕН'
                      : 'mDNS AUTO'
                    : language === 'bg'
                    ? 'РЪЧЕН IP'
                    : 'MANUAL IP'}
                </button>
              </div>

              {/* Language Selector */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/25 shrink-0">
                    <Languages className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_language')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_language_desc')}
                    </span>
                  </div>
                </div>
                <LanguageToggle variant="segmented" />
              </div>
            </div>
          </div>

          {/* GROUP 2: AI COPILOT ENGINE & AUTOMATION (Elevated z-index when dropdown is open!) */}
          <div
            className={`space-y-2 relative ${
              isModelDropdownOpen || isAddModelOpen ? 'z-[80]' : 'z-30'
            }`}
          >
            <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
              {language === 'bg'
                ? '2. AI ЯДРО И АВТОМАТИЗАЦИЯ'
                : '2. AI COPILOT ENGINE & AUTOMATION'}
            </span>

            <div className="glass-liquid w-full rounded-2xl divide-y divide-white/[0.06] relative overflow-visible">
              {/* Row 1: Dynamic AI Model Selector */}
              <div className="p-3.5 flex flex-col space-y-2.5 relative">
                <div className="flex items-center justify-between gap-2.5 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/25 shrink-0">
                      <Brain className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                        {t('settings_ai_model')}
                      </span>
                      <span className="text-fluid-meta text-slate-400 truncate">
                        {t('settings_ai_model_desc')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <button
                      type="button"
                      onClick={() => handleTestModel(selectedModel)}
                      disabled={isTestingModel}
                      className="h-9 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-cyan-300 text-xs font-mono transition border border-white/10 flex items-center justify-center active:scale-95"
                      title={language === 'bg' ? 'Тествай модела' : 'Test Model'}
                    >
                      {isTestingModel ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        testResult || (language === 'bg' ? 'Тест' : 'Test')
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsModelDropdownOpen((prev) => !prev)}
                      className="h-9 px-3 rounded-xl bg-[#070d1b] hover:bg-[#0d162c] text-cyan-300 text-xs font-mono font-medium flex items-center gap-1.5 transition border border-cyan-400/35 active:scale-95"
                    >
                      <span className="max-w-[125px] sm:max-w-[175px] truncate">
                        {selectedModel}
                      </span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-150 shrink-0 ${
                          isModelDropdownOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Solid-Backed High-Contrast Dropdown Menu (Zero Overlap / Zero Bleed-Through) */}
                <AnimatePresence>
                  {isModelDropdownOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-[90] bg-black/50"
                        onClick={() => setIsModelDropdownOpen(false)}
                      />
                      <motion.div
                        variants={POPOVER_BUBBLE_VARIANTS}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="absolute right-3 top-14 w-80 max-w-[calc(100vw-2rem)] rounded-2xl dropdown-menu-surface p-2 space-y-1 max-h-80 overflow-y-auto"
                      >
                        <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px] font-mono text-slate-300 uppercase tracking-wider border-b border-white/15">
                          <span>
                            {language === 'bg' ? 'Налични AI Модели' : 'Available AI Models'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setIsModelDropdownOpen(false);
                              setIsAddModelOpen(true);
                            }}
                            className="text-cyan-400 hover:underline font-bold"
                          >
                            {language === 'bg' ? '+ Добави модел' : '+ Add Custom'}
                          </button>
                        </div>

                        {modelsList.map((m) => (
                          <div
                            key={m.id}
                            className={`w-full rounded-xl text-xs font-mono flex items-stretch transition ${
                              selectedModel === m.id
                                ? 'bg-cyan-500/20 text-cyan-200 font-semibold border border-cyan-400/40'
                                : 'text-slate-200 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                triggerHapticFeedback('light');
                                setSelectedModel(m.id);
                                setIsModelDropdownOpen(false);
                              }}
                              className="flex-1 min-w-0 text-left px-3 py-2.5 flex flex-col cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold truncate">
                                  {language === 'bg' ? m.nameBg || m.name : m.name}
                                </span>
                                {selectedModel === m.id && (
                                  <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                                {language === 'bg' ? m.descriptionBg || m.description : m.description}
                              </span>
                            </button>
                            {!DEFAULT_BUILTIN_MODEL_IDS.has(m.id) && (
                              <button
                                type="button"
                                onClick={(e) => void handleDeleteCustomModel(m.id, e)}
                                title={language === 'bg' ? 'Премахни модела' : 'Remove custom model'}
                                aria-label={
                                  language === 'bg' ? `Премахни ${m.name}` : `Remove ${m.name}`
                                }
                                className="px-2.5 flex items-center justify-center text-slate-400 hover:text-rose-400 transition shrink-0 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {isAddModelOpen && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80">
                      <motion.div
                        variants={MODAL_BUBBLE_VARIANTS}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="w-full max-w-md rounded-2xl dropdown-menu-surface p-5 space-y-4 text-white"
                      >
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                          <h3 className="text-sm sm:text-base font-bold text-cyan-300">
                            {language === 'bg'
                              ? 'Добави Персонализиран AI Модел'
                              : 'Add Custom AI Model'}
                          </h3>
                          <button
                            type="button"
                            onClick={() => setIsAddModelOpen(false)}
                            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-300 hover:text-white"
                            aria-label={language === 'bg' ? 'Затвори' : 'Close'}
                          >
                            ✕
                          </button>
                        </div>

                        <form onSubmit={handleAddCustomModel} className="space-y-3 font-mono text-xs">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              {language === 'bg' ? 'Идентификатор (ID)' : 'Model Identifier (ID)'}
                            </label>
                            <input
                              type="text"
                              required
                              value={newModelId}
                              onChange={(e) => setNewModelId(e.target.value)}
                              placeholder="e.g. gemini-2.5-flash or ollama/llama3.3"
                              className="w-full px-3 py-2 rounded-xl bg-[#040812] border border-white/15 text-white outline-none focus:border-cyan-400"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              {language === 'bg' ? 'Показвано име' : 'Display Name'}
                            </label>
                            <input
                              type="text"
                              required
                              value={newModelName}
                              onChange={(e) => setNewModelName(e.target.value)}
                              placeholder="e.g. Custom Gemini Flash"
                              className="w-full px-3 py-2 rounded-xl bg-[#040812] border border-white/15 text-white outline-none focus:border-cyan-400"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              {language === 'bg' ? 'Доставчик' : 'Provider Type'}
                            </label>
                            <select
                              value={newModelProvider}
                              onChange={(e) => setNewModelProvider(e.target.value as any)}
                              className="w-full px-3 py-2 rounded-xl bg-[#040812] border border-white/15 text-white outline-none focus:border-cyan-400"
                            >
                              <option value="gemini" className="bg-[#060b16] text-white">
                                Google Gemini API
                              </option>
                              <option value="deepseek" className="bg-[#060b16] text-white">
                                DeepSeek AI
                              </option>
                              <option value="ollama" className="bg-[#060b16] text-white">
                                Local Ollama
                              </option>
                              <option value="custom" className="bg-[#060b16] text-white">
                                Custom Endpoint
                              </option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              {language === 'bg' ? 'Описание' : 'Description'}
                            </label>
                            <input
                              type="text"
                              value={newModelDesc}
                              onChange={(e) => setNewModelDesc(e.target.value)}
                              placeholder={
                                language === 'bg'
                                  ? 'Кратко описание'
                                  : 'Short description of capabilities'
                              }
                              className="w-full px-3 py-2 rounded-xl bg-[#040812] border border-white/15 text-white outline-none focus:border-cyan-400"
                            />
                          </div>

                          <div className="pt-2 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsAddModelOpen(false)}
                              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200"
                            >
                              {language === 'bg' ? 'Отказ' : 'Cancel'}
                            </button>
                            <button
                              type="submit"
                              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
                            >
                              {language === 'bg' ? 'Запази' : 'Save Model'}
                            </button>
                          </div>
                        </form>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Row 2: Persistent AI Memory / Instructions */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onOpenPersistentInstructions();
                }}
                className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-violet-500/12 text-violet-300 flex items-center justify-center border border-violet-500/25 shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_memory')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_memory_desc')}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              {/* Row 3: Automated WoL Scheduler */}
              <button
                id="settings-wol-scheduler-row"
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  if (onOpenWolScheduler) onOpenWolScheduler();
                }}
                className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/12 text-amber-300 flex items-center justify-center border border-amber-500/25 shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_wol_scheduler')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_wol_scheduler_desc')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {activeWolSchedulesCount !== undefined && activeWolSchedulesCount > 0 && (
                    <span className="text-[11px] font-mono text-amber-300 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/30">
                      {activeWolSchedulesCount}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </button>
            </div>
          </div>

          {/* GROUP 3: SECURITY, NOTIFICATIONS & DIAGNOSTICS */}
          <div className="space-y-2 relative z-10">
            <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
              {language === 'bg'
                ? '3. СИГУРНОСТ, ИЗВЕСТИЯ И ДИАГНОСТИКА'
                : '3. SECURITY, ALERTS & DIAGNOSTICS'}
            </span>

            {settingsSyncError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{settingsSyncError}</span>
              </div>
            )}

            {biometricNotice && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{biometricNotice}</span>
              </div>
            )}

            <div className="glass-liquid w-full rounded-2xl divide-y divide-white/[0.06] overflow-hidden">
              {/* HITL Gate */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-rose-500/12 text-rose-300 flex items-center justify-center border border-rose-500/25 shrink-0">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_hitl')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_hitl_desc')}
                    </span>
                  </div>
                </div>
                <CyberToggle
                  checked={isHitlEnabled}
                  onChange={(v) => void persistSettingPatch({ isHitlEnabled: v })}
                />
              </div>

              {/* Biometric Hardware Lock */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/25 shrink-0">
                    <Fingerprint className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_biometric')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_biometric_desc')}
                    </span>
                  </div>
                </div>
                <CyberToggle
                  checked={isBiometricEnabled}
                  onChange={(v) => void handleToggleBiometric(v)}
                />
              </div>

              {/* Command Confirmations */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/25 shrink-0">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_confirmations')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_confirmations_desc')}
                    </span>
                  </div>
                </div>
                <CyberToggle
                  checked={isCommandConfirmations}
                  onChange={(v) => void persistSettingPatch({ isCommandConfirmations: v })}
                />
              </div>

              {/* Host State Alerts */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/12 text-emerald-300 flex items-center justify-center border border-emerald-500/25 shrink-0">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_alerts')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_alerts_desc')}
                    </span>
                  </div>
                </div>
                <CyberToggle
                  checked={isSystemStateAlerts}
                  onChange={(v) => void persistSettingPatch({ isSystemStateAlerts: v })}
                />
              </div>

              {/* Release Binaries (.APK / .EXE) & Source Archive */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onOpenCodeViewer();
                }}
                className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/25 shrink-0">
                    <Code2 className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {language === 'bg'
                        ? 'Бинарни Релийзи (.APK / .EXE) и Сорс Код'
                        : 'Release Binaries (.APK / .EXE) & Source Code'}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {language === 'bg'
                        ? 'Изтегли компилирани пакети за Windows и Android'
                        : 'Download pre-built Windows & Android packages'}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              {/* System & Audit Logs */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onOpenTerminalLogs();
                }}
                className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-violet-500/12 text-violet-300 flex items-center justify-center border border-violet-500/25 shrink-0">
                    <Terminal className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                      {t('settings_system_logs')}
                    </span>
                    <span className="text-fluid-meta text-slate-400 truncate">
                      {t('settings_system_logs_desc')}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (6 cols): WAKE-ON-LAN TELEMETRY & ENERGY CALCULATOR */}
        <div className="lg:col-span-6 flex flex-col space-y-5">
          <div className="space-y-2">
            <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
              {language === 'bg'
                ? '4. WAKE-ON-LAN ИСТОРИЯ И ЕНЕРГИЙНА ЕФЕКТИВНОСТ'
                : '4. WAKE-ON-LAN TELEMETRY & FLEET ENERGY'}
            </span>

            <div className="space-y-5">
              <WolHistoryLogViewer hosts={hosts} onSendWolPacket={onSendWolPacket} />

              <WolEnergyCalculator
                wolSchedules={wolSchedules}
                defaultHostCount={hostsCount !== undefined && hostsCount > 0 ? hostsCount : 1}
              />
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          BOTTOM SECTION (HIDEABLE / COLLAPSIBLE): APPEARANCE & FLUID STUDIO
         ===================================================================== */}
      <div className="pt-2 space-y-2 relative z-10">
        <div className="glass-liquid w-full rounded-2xl overflow-hidden">
          {/* Collapsible Header Bar */}
          <div className="p-3.5 sm:px-4 flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                toggleCustomizationOpen();
              }}
              className="flex items-center gap-3 min-w-0 flex-1 text-left"
            >
              <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/35 shrink-0">
                <Palette className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight">
                    {language === 'bg'
                      ? 'Персонализация, Течно Стъкло и Течен Фон'
                      : 'Appearance, Surface Material & Fluid Background'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-400/30 text-[10px] font-mono text-cyan-200 uppercase">
                    {glassIntensity === 'clear'
                      ? language === 'bg'
                        ? 'Кристал'
                        : 'Crystal'
                      : glassIntensity === 'frosted'
                      ? language === 'bg'
                        ? 'Пълен Мат'
                        : 'True Matte'
                      : language === 'bg'
                      ? 'Течно Стъкло'
                      : 'Liquid Glass'}
                  </span>
                </div>
                <p className="text-fluid-meta text-slate-400 truncate mt-0.5">
                  {language === 'bg'
                    ? 'Променете цвета, матовия/стъклен ефект, шрифта и движещия се течен фон'
                    : 'Customize accent colors, Crystal vs True Matte finish, typography & moving fluid background'}
                </p>
              </div>
            </button>

            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {isCustomizationOpen && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('medium');
                    resetAppearance();
                  }}
                  className="h-8 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-[11px] font-mono text-slate-300 hover:text-cyan-300 flex items-center gap-1 transition active:scale-95"
                  title={
                    language === 'bg'
                      ? 'Възстанови стандартния облик'
                      : 'Reset appearance to defaults'
                  }
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{language === 'bg' ? 'Нулирай' : 'Reset'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  toggleCustomizationOpen();
                }}
                className="h-8 px-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-[11px] font-mono font-semibold text-cyan-200 flex items-center gap-1.5 transition active:scale-95"
              >
                {isCustomizationOpen ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-cyan-300" />
                    <span>{language === 'bg' ? 'Скрий менюто' : 'Hide Studio'}</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5 text-cyan-300" />
                    <span>{language === 'bg' ? 'Покажи менюто' : 'Show Studio'}</span>
                  </>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    isCustomizationOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Collapsible Body */}
          <AnimatePresence initial={false}>
            {isCustomizationOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="border-t border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden"
              >
                {/* 1. Accent Color Palette Picker */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-display font-bold text-white flex items-center gap-2">
                      <Palette className="w-3.5 h-3.5 text-cyan-300" />
                      <span>
                        {language === 'bg'
                          ? '1. Цветова Палитра и Акценти'
                          : '1. Accent Color Palette'}
                      </span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 uppercase">
                      {accentColor}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {(
                      [
                        {
                          id: 'cyan' as AccentColorPreset,
                          label: language === 'bg' ? 'Кибер Циан' : 'Cyber Cyan',
                          desc: language === 'bg' ? 'Електриково синьо' : 'Electric Cyan & Indigo',
                          swatch: 'from-[#22d3ee] via-[#38bdf8] to-[#6366f1]',
                        },
                        {
                          id: 'violet' as AccentColorPreset,
                          label: language === 'bg' ? 'Ултравиолет' : 'Ultraviolet',
                          desc: language === 'bg' ? 'Неоново лилаво' : 'Royal Violet & Magenta',
                          swatch: 'from-[#c084fc] via-[#a855f7] to-[#ec4899]',
                        },
                        {
                          id: 'emerald' as AccentColorPreset,
                          label: language === 'bg' ? 'Емералд' : 'Bio Mint',
                          desc: language === 'bg' ? 'Матрично зелено' : 'Neon Emerald & Mint',
                          swatch: 'from-[#34d399] via-[#10b981] to-[#06b6d4]',
                        },
                        {
                          id: 'rose' as AccentColorPreset,
                          label: language === 'bg' ? 'Рубин' : 'Crimson Rose',
                          desc: language === 'bg' ? 'Топъл корал' : 'Sunset Rose & Coral',
                          swatch: 'from-[#fb7185] via-[#f43f5e] to-[#fb923c]',
                        },
                        {
                          id: 'amber' as AccentColorPreset,
                          label: language === 'bg' ? 'Соларно Злато' : 'Solar Gold',
                          desc: language === 'bg' ? 'Златист кехлибар' : 'Warm Amber & Gold',
                          swatch: 'from-[#fbbf24] via-[#f59e0b] to-[#ef4444]',
                        },
                        {
                          id: 'cobalt' as AccentColorPreset,
                          label: language === 'bg' ? 'Сапфир' : 'Sapphire Blue',
                          desc: language === 'bg' ? 'Дълбок кобалт' : 'Deep Cobalt & Teal',
                          swatch: 'from-[#60a5fa] via-[#3b82f6] to-[#8b5cf6]',
                        },
                      ] as const
                    ).map((item) => {
                      const isSelected = accentColor === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            triggerHapticFeedback('selection');
                            setAccentColor(item.id);
                          }}
                          className={`p-2.5 rounded-xl border flex items-center gap-2.5 text-left transition active:scale-95 ${
                            isSelected
                              ? 'bg-white/[0.12] border-white/45 shadow-[0_0_16px_var(--theme-accent-glow)]'
                              : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.07]'
                          }`}
                        >
                          <span
                            className={`w-7 h-7 rounded-full bg-gradient-to-br ${item.swatch} flex items-center justify-center shadow-inner border border-white/30 shrink-0`}
                          >
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div
                              className={`text-xs truncate ${
                                isSelected ? 'text-white font-bold' : 'text-slate-200 font-medium'
                              }`}
                            >
                              {item.label}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">{item.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Surface Material (Crystal vs Liquid Glass vs True Matte) & Moving Fluid Background */}
                <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Surface Finish */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-display font-bold text-white flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-cyan-300" />
                        <span>
                          {language === 'bg'
                            ? '2. Повърхност на Панелите (Кристал / Течно / Пълен Мат)'
                            : '2. Surface Material (Crystal vs Liquid vs True Matte)'}
                        </span>
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          {
                            id: 'clear' as GlassIntensityPreset,
                            label: language === 'bg' ? 'Кристал' : 'Crystal Glass',
                            desc:
                              language === 'bg'
                                ? '20% ултра-прозрачно + призма'
                                : '20% ultra-clear + prism rim',
                          },
                          {
                            id: 'balanced' as GlassIntensityPreset,
                            label: language === 'bg' ? 'Течно Стъкло' : 'Liquid Glass',
                            desc:
                              language === 'bg'
                                ? '52% Apple Liquid рефракция'
                                : '52% Apple Liquid refraction',
                          },
                          {
                            id: 'frosted' as GlassIntensityPreset,
                            label: language === 'bg' ? 'Пълен Мат' : 'True Matte',
                            desc:
                              language === 'bg'
                                ? '100% плътен мат без отблясък'
                                : '100% flat stealth, zero gloss',
                          },
                        ] as const
                      ).map((g) => {
                        const active = glassIntensity === g.id;
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => {
                              triggerHapticFeedback('selection');
                              setGlassIntensity(g.id);
                            }}
                            className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between active:scale-95 ${
                              active
                                ? 'bg-cyan-500/22 text-white border-cyan-300/55 shadow-[0_0_16px_var(--theme-accent-glow)]'
                                : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.07]'
                            }`}
                          >
                            <div className="text-xs font-bold flex items-center justify-between gap-1">
                              <span className="truncate">{g.label}</span>
                              {active && <Check className="w-3 h-3 text-cyan-300 shrink-0" />}
                            </div>
                            <div className="text-[10px] text-slate-400 leading-snug mt-1">
                              {g.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Moving Fluid Background Animation Mode */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-display font-bold text-white flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                        <span>
                          {language === 'bg'
                            ? '3. Движещ се Течен Фон (120Hz GPU Анимация)'
                            : '3. Moving Fluid Background Animation'}
                        </span>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          {
                            id: 'fluid' as AmbientModePreset,
                            label: language === 'bg' ? 'Течна Плазма' : 'Liquid Plasma',
                            desc:
                              language === 'bg'
                                ? 'Орбитални флуидни вълни'
                                : 'Morphing orbital fluid mesh',
                          },
                          {
                            id: 'aurora' as AmbientModePreset,
                            label: language === 'bg' ? 'Аврора Вълни' : 'Aurora Waves',
                            desc:
                              language === 'bg'
                                ? 'Плаващи светлинни ленти'
                                : 'Sweeping northern ribbons',
                          },
                          {
                            id: 'cyber' as AmbientModePreset,
                            label: language === 'bg' ? 'Кибер Мрежа' : 'Cyber Matrix',
                            desc:
                              language === 'bg'
                                ? '3D решетка и пулсиращо ядро'
                                : 'Grid horizon & pulse core',
                          },
                          {
                            id: 'minimal' as AmbientModePreset,
                            label: language === 'bg' ? 'Статичен' : 'Static Off',
                            desc:
                              language === 'bg'
                                ? 'Изчистен тъмен фон (0% GPU)'
                                : 'Pure dark canvas (0% GPU)',
                          },
                        ] as const
                      ).map((m) => {
                        const active = ambientMode === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              triggerHapticFeedback('selection');
                              setAmbientMode(m.id);
                            }}
                            className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between active:scale-95 ${
                              active
                                ? 'bg-cyan-500/22 text-white border-cyan-300/55 shadow-[0_0_16px_var(--theme-accent-glow)]'
                                : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.07]'
                            }`}
                          >
                            <div className="text-xs font-bold flex items-center justify-between gap-1">
                              <span className="truncate">{m.label}</span>
                              {active && <Check className="w-3 h-3 text-cyan-300 shrink-0" />}
                            </div>
                            <div className="text-[10px] text-slate-400 leading-snug mt-1">
                              {m.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 4. Typography / Font Family Selector */}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-display font-bold text-white flex items-center gap-2">
                      <Type className="w-3.5 h-3.5 text-cyan-300" />
                      <span>
                        {language === 'bg'
                          ? '4. Типография и Шрифт на Интерфейса'
                          : '4. Interface Typography & Font Style'}
                      </span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        {
                          id: 'geometric' as FontFamilyPreset,
                          name: 'Onest Geometric',
                          desc:
                            language === 'bg'
                              ? 'Заоблен модерен геометричен'
                              : 'Clean rounded geometric sans',
                          sampleStyle: { fontFamily: '"Onest", sans-serif' },
                        },
                        {
                          id: 'jakarta' as FontFamilyPreset,
                          name: 'Jakarta Editorial',
                          desc:
                            language === 'bg'
                              ? 'Широк дисплеен контраст'
                              : 'Wide tracking display contrast',
                          sampleStyle: {
                            fontFamily: '"Plus Jakarta Sans", sans-serif',
                            letterSpacing: '0.02em',
                          },
                        },
                        {
                          id: 'system' as FontFamilyPreset,
                          name: 'Native OS UI',
                          desc:
                            language === 'bg'
                              ? 'Плътен системен шрифт'
                              : 'Compact native system UI',
                          sampleStyle: {
                            fontFamily:
                              'system-ui, -apple-system, BlinkMacSystemFont, "Roboto", sans-serif',
                          },
                        },
                        {
                          id: 'mono' as FontFamilyPreset,
                          name: 'JetBrains Mono',
                          desc:
                            language === 'bg'
                              ? 'Пълен терминален моноспейс'
                              : 'Full cyber terminal monospace',
                          sampleStyle: { fontFamily: '"JetBrains Mono", monospace' },
                        },
                      ] as const
                    ).map((f) => {
                      const isSelected = fontFamily === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => {
                            triggerHapticFeedback('selection');
                            setFontFamily(f.id);
                          }}
                          style={f.sampleStyle}
                          className={`px-3 py-2.5 rounded-xl border text-left transition flex items-center justify-between gap-2 active:scale-95 ${
                            isSelected
                              ? 'bg-cyan-500/22 border-cyan-300/55 text-white shadow-[0_0_16px_var(--theme-accent-glow)]'
                              : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.07]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{f.name}</div>
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">
                              {f.desc}
                            </div>
                          </div>
                          <span className="text-sm font-extrabold text-cyan-300 shrink-0">Aa</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export const SettingsScreen = React.memo(SettingsScreenComponent);
