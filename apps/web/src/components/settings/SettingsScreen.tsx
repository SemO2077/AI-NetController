import React, { useState, useMemo } from 'react';
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
  Sun,
  Moon,
  Search,
  Zap,
  LayoutGrid,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { HostDevice, WolPacketPayload, WolPacketTriggerSource, WolSchedule } from '../../types';
import { WolEnergyCalculator } from '../wol/WolEnergyCalculator';
import { WolHistoryLogViewer } from '../wol/WolHistoryLogViewer';
import { AuditLogViewer, ExecutionAuditEntry } from './AuditLogViewer';
import { useTranslation } from '../../i18n/useTranslation';
import { LanguageToggle } from '../ui/LanguageToggle';
import { ThemeQuickControls } from '../ui/ThemeQuickControls';
import {
  useUIStore,
  ThemeMode,
  AccentColorPreset,
  FontFamilyPreset,
  GlassIntensityPreset,
  AmbientModePreset,
} from '../../store/uiStore';
import {
  SPRING_POP,
  SPRING_BUBBLY,
  SPRING_JELLY,
  POPOVER_BUBBLE_VARIANTS,
  MODAL_BUBBLE_VARIANTS,
} from '../../utils/springPhysics';

type SettingsHubTab = 'overview' | 'appearance' | 'wol' | 'audit' | 'ai_security';

const DEFAULT_BUILTIN_MODEL_IDS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'deepseek-r1:latest',
  'qwen2.5-coder:latest',
]);

const CyberToggle = React.memo(
  ({
    checked,
    onChange,
    label = 'Toggle setting',
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label?: string;
  }) => (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      whileTap={{ scale: 0.9 }}
      transition={SPRING_POP}
      onClick={() => {
        triggerHapticFeedback('light');
        onChange(!checked);
      }}
      className="p-1.5 min-w-[44px] min-h-[40px] flex items-center justify-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] rounded-full"
      aria-label={label}
    >
      <div
        className={`w-12 h-7 rounded-full p-0.5 transition-all duration-200 flex items-center relative border ${
          checked ? 'liquid-hero-btn border-white/45' : 'liquid-control-pill'
        }`}
      >
        <motion.div
          initial={false}
          animate={{ x: checked ? 20 : 0, scale: checked ? 1.04 : 0.96 }}
          transition={SPRING_BUBBLY}
          className="w-5.5 h-5.5 rounded-full bg-white shadow-[0_2px_8px_rgba(15,23,42,0.28)]"
        />
      </div>
    </motion.button>
  )
);
CyberToggle.displayName = 'CyberToggle';

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
  executionLogs?: ExecutionAuditEntry[];
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
  executionLogs = [],
}) => {
  const { t, language } = useTranslation();
  const isBg = language === 'bg';
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsHubTab>('overview');
  const [settingsSearch, setSettingsSearch] = useState('');

  const selectedModel = useUIStore((s) => s.selectedModel);
  const setSelectedModel = useUIStore((s) => s.setSelectedModel);
  const themeMode = useUIStore((s) => s.themeMode);
  const setThemeMode = useUIStore((s) => s.setThemeMode);
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
  const [newModelEndpointUrl, setNewModelEndpointUrl] = useState('');
  const [newModelApiKey, setNewModelApiKey] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [settingsSyncError, setSettingsSyncError] = useState<string | null>(null);
  const [biometricNotice, setBiometricNotice] = useState<string | null>(null);

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
      isBuiltIn?: boolean;
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
        setTestResult(`Online (${data.latencyMs}ms)`);
      } else {
        setTestResult(
          `${data.error || (!res.ok ? `HTTP ${res.status}` : language === 'bg' ? 'Неуспешен тест' : 'Test failed')}`
        );
      }
    } catch {
      setTestResult(language === 'bg' ? 'Грешка при връзка' : 'Connection error');
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
          ...(newModelEndpointUrl.trim() ? { endpointUrl: newModelEndpointUrl.trim() } : {}),
          ...(newModelApiKey.trim() ? { apiKey: newModelApiKey.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.models) {
        setModelsList(data.models);
        setSelectedModel(data.model.id);
        setNewModelId('');
        setNewModelName('');
        setNewModelDesc('');
        setNewModelEndpointUrl('');
        setNewModelApiKey('');
        setIsAddModelOpen(false);
        triggerHapticFeedback('medium');
      } else {
        setTestResult(`${data.error || `HTTP ${res.status}`}`);
      }
    } catch {
      setTestResult(language === 'bg' ? 'Грешка при запазване' : 'Failed to save model');
    }
  };

  const settingsTabs: Array<{
    id: SettingsHubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
  }> = useMemo(
    () => [
      { id: 'overview', label: isBg ? 'Общ преглед' : 'Overview', icon: LayoutGrid },
      { id: 'appearance', label: isBg ? 'Облик' : 'Appearance', icon: Palette },
      {
        id: 'wol',
        label: isBg ? 'WoL & Енергия' : 'WoL & Energy',
        icon: Zap,
        badge:
          activeWolSchedulesCount !== undefined && activeWolSchedulesCount > 0
            ? activeWolSchedulesCount
            : undefined,
      },
      {
        id: 'audit',
        label: isBg ? 'Одит & Логове' : 'Audit & Logs',
        icon: ShieldCheck,
        badge: executionLogs.length > 0 ? executionLogs.length : undefined,
      },
      { id: 'ai_security', label: isBg ? 'AI & Сигурност' : 'AI & Security', icon: Brain },
    ],
    [isBg, activeWolSchedulesCount, executionLogs.length]
  );

  const searchableSettings = useMemo(
    () => [
      {
        id: 'pair',
        title: isBg ? 'Сдвои Телефон & PC (QR / PIN)' : 'Pair Phone & PC (QR / PIN)',
        keywords: 'qr pin pair setup phone mobile connect',
        tab: 'overview' as SettingsHubTab,
        action: () => useUIStore.getState().openModal('quickSetup'),
      },
      {
        id: 'daemon',
        title: isBg ? 'PC Демон Център' : 'PC Daemon Center',
        keywords: 'pc daemon host agent ban peers security',
        tab: 'overview' as SettingsHubTab,
        action: () => useUIStore.getState().openModal('pcDaemonGui'),
      },
      {
        id: 'ws',
        title: t('settings_ws_config'),
        keywords: 'websocket endpoint ws wss lan ip port vault crypto',
        tab: 'overview' as SettingsHubTab,
        action: () => onOpenWsConfig(),
      },
      {
        id: 'mdns',
        title: t('settings_autodiscovery'),
        keywords: 'mdns discovery network scan zeroconf auto',
        tab: 'overview' as SettingsHubTab,
      },
      {
        id: 'lang',
        title: t('settings_language'),
        keywords: 'language english bulgarian език български',
        tab: 'overview' as SettingsHubTab,
      },
      {
        id: 'appearance_studio',
        title: isBg ? 'Apple Liquid Glass Студио (Теми, Акценти, Шрифт)' : 'Apple Liquid Glass Studio (Daylight, Dark, Accent, Font)',
        keywords: 'theme daylight dark light violet accent glass frosted aurora font appearance',
        tab: 'appearance' as SettingsHubTab,
      },
      {
        id: 'wol_energy',
        title: isBg ? 'Зелена WoL Енергийна Ефективност & Седмична Графика' : 'Green WoL Energy Efficiency & Weekly Chart',
        keywords: 'wol energy calculator efficiency kwh co2 cost savings chart',
        tab: 'wol' as SettingsHubTab,
      },
      {
        id: 'wol_log',
        title: isBg ? 'Дневник на Magic пакетите (WoL)' : 'Magic Packet Log (WoL History)',
        keywords: 'wol magic packet log history mac broadcast secureon export csv json',
        tab: 'wol' as SettingsHubTab,
      },
      {
        id: 'wol_sched',
        title: t('settings_wol_scheduler'),
        keywords: 'wol schedule wake timer cron morning',
        tab: 'wol' as SettingsHubTab,
        action: () => onOpenWolScheduler?.(),
      },
      {
        id: 'audit_logs',
        title: isBg ? 'Одитен дневник за сигурност и команди' : 'Security & Command Audit Log',
        keywords: 'audit log security shell commands hitl daemon export',
        tab: 'audit' as SettingsHubTab,
      },
      {
        id: 'ai_model',
        title: t('settings_ai_model'),
        keywords: 'ai gemini ollama deepseek model custom copilot llm',
        tab: 'ai_security' as SettingsHubTab,
      },
      {
        id: 'memory',
        title: t('settings_memory'),
        keywords: 'memory rules persistent session instructions ai context',
        tab: 'ai_security' as SettingsHubTab,
        action: () => onOpenPersistentInstructions(),
      },
      {
        id: 'hitl_sec',
        title: t('settings_hitl'),
        keywords: 'hitl security firewall approval biometric lock alerts notifications',
        tab: 'ai_security' as SettingsHubTab,
      },
      {
        id: 'releases',
        title: isBg ? 'Бинарни Релийзи (.APK / .EXE) и Код' : 'Release Binaries (.APK / .EXE) & Source Code',
        keywords: 'download apk exe binary release source code update',
        tab: 'ai_security' as SettingsHubTab,
        action: () => onOpenCodeViewer(),
      },
    ],
    [isBg, t, onOpenWsConfig, onOpenWolScheduler, onOpenPersistentInstructions, onOpenCodeViewer]
  );

  const searchMatches = useMemo(() => {
    const q = settingsSearch.trim().toLowerCase();
    if (!q) return [];
    return searchableSettings.filter(
      (item) => item.title.toLowerCase().includes(q) || item.keywords.includes(q)
    );
  }, [settingsSearch, searchableSettings]);

  return (
    <div className="w-full max-w-6xl mx-auto pb-6 select-none space-y-4">
      {/* =====================================================================
          1. DETACHED FLOATING LIQUID GLASS SETTINGS HEADER
         ===================================================================== */}
      <header className="glass-liquid-elevated liquid-capsule-refract rounded-[26px] sm:rounded-[28px] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 squircle-badge squircle-hero flex items-center justify-center shrink-0">
            <Palette className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-fluid-title font-extrabold font-display ink-primary tracking-tight truncate">
              {isBg ? 'Настройки и Контролен Хъб' : 'Settings & Control Hub'}
            </h1>
            <p className="text-xs ink-muted truncate">
              {isBg
                ? 'Облик, WoL Енергия, Одитен дневник, AI и Zero-Trust сигурност'
                : 'Appearance studio, WoL & Energy, Audit Logs, AI & Zero-Trust'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <ThemeQuickControls showAccentDots />
        </div>
      </header>

      {/* =====================================================================
          2. PILL-TABBED SETTINGS HUB SUB-NAV + INSTANT LIVE SEARCH
         ===================================================================== */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1 p-1.5 rounded-full glass-liquid-subtle overflow-x-auto scrollbar-none">
          {settingsTabs.map((tab) => {
            const TabIcon = tab.icon;
            const active = activeSettingsTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  triggerHapticFeedback('selection');
                  setActiveSettingsTab(tab.id);
                }}
                className={`relative h-9 px-3.5 rounded-full text-xs font-display font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition cursor-pointer ${
                  active ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="settingsHubActiveTab"
                    transition={SPRING_JELLY}
                    className="absolute inset-0 rounded-full liquid-hero-btn pointer-events-none"
                  />
                )}
                <TabIcon className="w-3.5 h-3.5 relative z-10 shrink-0" />
                <span className="relative z-10">{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`relative z-10 px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none ${
                      active ? 'bg-white/25 text-white' : 'bg-cyan-500/15 text-cyan-400'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative lg:w-72 shrink-0">
          <Search className="w-3.5 h-3.5 text-cyan-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            placeholder={isBg ? 'Търси в настройките...' : 'Search all settings...'}
            className="w-full h-10 pl-9 pr-8 rounded-full glass-liquid-subtle text-xs ink-primary placeholder:text-[var(--ink-secondary)] placeholder:opacity-80 focus:border-cyan-400/65 focus:outline-none"
          />
          {settingsSearch && (
            <button
              type="button"
              onClick={() => setSettingsSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 ink-muted hover:ink-primary cursor-pointer"
              aria-label="Clear settings search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Instant Live Search Jump Results */}
      <AnimatePresence>
        {settingsSearch.trim() && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="glass-liquid rounded-[24px] p-3.5 space-y-2"
          >
            <div className="text-[11px] font-mono font-bold text-cyan-400 px-1">
              {searchMatches.length > 0
                ? isBg
                  ? `Намерени настройки (${searchMatches.length})`
                  : `Matching settings (${searchMatches.length})`
                : isBg
                ? 'Няма намерени настройки за това търсене'
                : 'No settings match your search'}
            </div>
            {searchMatches.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {searchMatches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback('light');
                      setActiveSettingsTab(m.tab);
                      if (m.action) m.action();
                      setSettingsSearch('');
                    }}
                    className="px-3 py-1.5 rounded-full liquid-control-pill text-xs font-semibold ink-primary flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{m.title}</span>
                    <ChevronRight className="w-3 h-3 text-cyan-400" />
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* =====================================================================
          TAB: APPEARANCE — APPLE LIQUID GLASS STUDIO
         ===================================================================== */}
      {activeSettingsTab === 'appearance' && (
      <div className="space-y-2 relative z-20">
        <div className="glass-liquid w-full rounded-[28px] overflow-hidden">
          <div className="p-4 sm:px-5 flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                toggleCustomizationOpen();
              }}
              className="flex items-center gap-3 min-w-0 flex-1 text-left"
            >
              <div className="w-10 h-10 squircle-badge squircle-violet flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 icon-sparkle-live" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-sm font-extrabold ink-primary tracking-tight">
                    {language === 'bg'
                      ? 'Apple Liquid Glass Студио'
                      : 'Apple Liquid Glass Studio'}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/14 border border-cyan-400/35 text-[10px] font-mono font-bold text-cyan-400 uppercase">
                    {themeMode === 'light'
                      ? language === 'bg'
                        ? 'Светъл Daylight'
                        : 'Bright Daylight'
                      : language === 'bg'
                      ? 'Тъмен Prism'
                      : 'Vibrant Dark'}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full liquid-control-pill text-[10px] font-mono font-semibold ink-secondary uppercase">
                    {glassIntensity === 'clear'
                      ? language === 'bg'
                        ? 'Кристал'
                        : 'Crystal'
                      : glassIntensity === 'frosted'
                      ? language === 'bg'
                        ? 'Мат'
                        : 'Frosted'
                      : language === 'bg'
                      ? 'Течно Стъкло'
                      : 'Liquid Glass'}
                  </span>
                </div>
                <p className="text-fluid-meta ink-muted truncate mt-0.5">
                  {language === 'bg'
                    ? 'Светъл/Тъмен режим, водещ акцент, оптично стъкло, аврора фон и шрифт'
                    : 'Daylight/Dark polarity, hero accent, optical glass finish, moving aurora & typography'}
                </p>
              </div>
            </button>

            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {isCustomizationOpen && (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.91 }}
                  transition={SPRING_POP}
                  onClick={() => {
                    triggerHapticFeedback('medium');
                    resetAppearance();
                  }}
                  className="h-8.5 px-3 rounded-full liquid-control-pill text-[11px] font-mono font-semibold flex items-center gap-1.5 cursor-pointer"
                  title={
                    language === 'bg'
                      ? 'Възстанови стандартния Daylight + Iridescent Violet облик'
                      : 'Reset to Daylight + Iridescent Violet defaults'
                  }
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{language === 'bg' ? 'Нулирай' : 'Reset'}</span>
                </motion.button>
              )}

              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.91 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  toggleCustomizationOpen();
                }}
                className="h-8.5 px-3.5 rounded-full liquid-hero-btn text-[11px] font-mono font-bold flex items-center gap-1.5 cursor-pointer"
              >
                {isCustomizationOpen ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>{language === 'bg' ? 'Скрий' : 'Hide'}</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>{language === 'bg' ? 'Отвори' : 'Open'}</span>
                  </>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    isCustomizationOpen ? 'rotate-180' : ''
                  }`}
                />
              </motion.button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {isCustomizationOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="border-t border-white/[0.08] divide-y divide-white/[0.08] overflow-hidden"
              >
                {/* 0. Theme Polarity: Bright Daylight Glass vs Vibrant Dark */}
                <div className="p-4 sm:px-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-display font-bold ink-primary flex items-center gap-2">
                      {themeMode === 'light' ? (
                        <Sun className="w-4 h-4 text-amber-500" />
                      ) : (
                        <Moon className="w-4 h-4 text-violet-400" />
                      )}
                      <span>
                        {language === 'bg'
                          ? '1. Тема и Осветеност (Daylight / Vibrant Dark)'
                          : '1. Theme Polarity (Daylight Glass vs. Vibrant Dark)'}
                      </span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(
                      [
                        {
                          id: 'light' as ThemeMode,
                          label: language === 'bg' ? 'Светло Течно Стъкло (Daylight)' : 'Bright Daylight Glass',
                          desc:
                            language === 'bg'
                              ? 'Слънчева iOS 26 пастелна призма и кристален терминал'
                              : 'Sunlit iOS 26 pastel-prism canvas & bright frosted terminal',
                          icon: Sun,
                          previewClass:
                            'from-[#f5f3ff] via-[#e0f2fe] to-[#fce7f3] text-amber-500 border-white/90',
                        },
                        {
                          id: 'dark' as ThemeMode,
                          label: language === 'bg' ? 'Тъмен Неон (Vibrant Dark)' : 'Vibrant Dark Glass',
                          desc:
                            language === 'bg'
                              ? 'Дълбок индиго здрач с ярки светещи аврора акценти'
                              : 'Luminous twilight indigo mesh with glowing jewel refraction',
                          icon: Moon,
                          previewClass:
                            'from-[#0f102e] via-[#1f1247] to-[#2e1042] text-violet-300 border-violet-400/40',
                        },
                      ] as const
                    ).map((mode) => {
                      const active = themeMode === mode.id;
                      const ModeIcon = mode.icon;
                      return (
                        <motion.button
                          key={mode.id}
                          type="button"
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.96 }}
                          transition={SPRING_POP}
                          onClick={() => {
                            triggerHapticFeedback('selection');
                            setThemeMode(mode.id);
                          }}
                          className={`p-3 rounded-2xl border flex items-center gap-3 text-left transition cursor-pointer ${
                            active
                              ? 'glass-liquid-elevated iridescent-active-rim'
                              : 'glass-liquid-subtle hover:border-cyan-400/40'
                          }`}
                        >
                          <div
                            className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${mode.previewClass} border flex items-center justify-center shrink-0 shadow-md`}
                          >
                            <ModeIcon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs sm:text-sm font-display font-bold ink-primary flex items-center justify-between gap-2">
                              <span className="truncate">{mode.label}</span>
                              {active && (
                                <span className="w-5 h-5 rounded-full liquid-hero-btn flex items-center justify-center shrink-0">
                                  <Check className="w-3 h-3 stroke-[3]" />
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] ink-muted truncate mt-0.5">{mode.desc}</p>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Hero Accent Color Palette Picker (Iridescent Violet Default) */}
                <div className="p-4 sm:px-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-display font-bold ink-primary flex items-center gap-2">
                      <Palette className="w-3.5 h-3.5 text-cyan-400" />
                      <span>
                        {language === 'bg'
                          ? '2. Водещ Цветов Акцент (Hero Accent)'
                          : '2. Unified Hero Accent Palette'}
                      </span>
                    </span>
                    <span className="text-[11px] font-mono text-cyan-400 font-bold uppercase">
                      {accentColor}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    {(
                      [
                        {
                          id: 'violet' as AccentColorPreset,
                          label: language === 'bg' ? 'Иридесцентно Виолетово' : 'Iridescent Violet',
                          desc: language === 'bg' ? 'По подразбиране' : 'VisionOS Default',
                          swatch: 'from-[#7c3aed] via-[#a855f7] to-[#ec4899]',
                        },
                        {
                          id: 'cobalt' as AccentColorPreset,
                          label: language === 'bg' ? 'Електриково Синьо' : 'Electric Azure',
                          desc: language === 'bg' ? 'Apple сапфир' : 'Apple Sky & Cobalt',
                          swatch: 'from-[#2563eb] via-[#0ea5e9] to-[#6366f1]',
                        },
                        {
                          id: 'cyan' as AccentColorPreset,
                          label: language === 'bg' ? 'Аква Циан' : 'Aqua Cyan',
                          desc: language === 'bg' ? 'Кристално аква' : 'Ocean Aqua & Indigo',
                          swatch: 'from-[#06b6d4] via-[#22d3ee] to-[#6366f1]',
                        },
                        {
                          id: 'emerald' as AccentColorPreset,
                          label: language === 'bg' ? 'Био Мента' : 'Bio Mint',
                          desc: language === 'bg' ? 'Изумрудена мента' : 'Vibrant Emerald',
                          swatch: 'from-[#059669] via-[#10b981] to-[#2dd4bf]',
                        },
                        {
                          id: 'rose' as AccentColorPreset,
                          label: language === 'bg' ? 'Коралова Роза' : 'Coral Rose',
                          desc: language === 'bg' ? 'Залез и корал' : 'Poppy Rose & Coral',
                          swatch: 'from-[#e11d48] via-[#f43f5e] to-[#fb923c]',
                        },
                        {
                          id: 'amber' as AccentColorPreset,
                          label: language === 'bg' ? 'Соларно Злато' : 'Solar Amber',
                          desc: language === 'bg' ? 'Топъл кехлибар' : 'Sunlit Gold & Flame',
                          swatch: 'from-[#d97706] via-[#f59e0b] to-[#f97316]',
                        },
                      ] as const
                    ).map((item) => {
                      const isSelected = accentColor === item.id;
                      return (
                        <motion.button
                          key={item.id}
                          type="button"
                          whileHover={{ scale: 1.04, y: -1 }}
                          whileTap={{ scale: 0.93 }}
                          transition={SPRING_POP}
                          onClick={() => {
                            triggerHapticFeedback('selection');
                            setAccentColor(item.id);
                          }}
                          className={`p-2.5 rounded-2xl border flex items-center gap-2.5 text-left transition cursor-pointer ${
                            isSelected
                              ? 'glass-liquid-elevated iridescent-active-rim'
                              : 'glass-liquid-subtle hover:border-cyan-400/40'
                          }`}
                        >
                          <span
                            className={`w-7 h-7 rounded-full bg-gradient-to-br ${item.swatch} flex items-center justify-center shadow-md border border-white/60 shrink-0 preserve-white`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs truncate ink-primary font-bold">
                              {item.label}
                            </div>
                            <div className="text-[10px] ink-muted truncate">{item.desc}</div>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Surface Material & Moving Fluid Background */}
                <div className="p-4 sm:px-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2.5">
                    <span className="text-xs font-display font-bold ink-primary flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      <span>
                        {language === 'bg'
                          ? '3. Повърхност на Стъклото'
                          : '3. Optical Glass Finish'}
                      </span>
                    </span>

                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          {
                            id: 'clear' as GlassIntensityPreset,
                            label: language === 'bg' ? 'Кристал' : 'Crystal',
                            desc:
                              language === 'bg'
                                ? 'Ултра прозрачна призма'
                                : 'Ultra-clear prism glass',
                          },
                          {
                            id: 'balanced' as GlassIntensityPreset,
                            label: language === 'bg' ? 'Течно' : 'Liquid',
                            desc:
                              language === 'bg'
                                ? 'Балансирано iOS 26 стъкло'
                                : 'Signature iOS 26 glass',
                          },
                          {
                            id: 'frosted' as GlassIntensityPreset,
                            label: language === 'bg' ? 'Мат' : 'Frosted',
                            desc:
                              language === 'bg'
                                ? 'Плътен матов контраст'
                                : 'Soft high-contrast matte',
                          },
                        ] as const
                      ).map((g) => {
                        const active = glassIntensity === g.id;
                        return (
                          <motion.button
                            key={g.id}
                            type="button"
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.94 }}
                            transition={SPRING_POP}
                            onClick={() => {
                              triggerHapticFeedback('selection');
                              setGlassIntensity(g.id);
                            }}
                            className={`p-2.5 rounded-2xl border text-left transition flex flex-col justify-between cursor-pointer ${
                              active
                                ? 'liquid-hero-btn preserve-white'
                                : 'glass-liquid-subtle ink-primary'
                            }`}
                          >
                            <div className="text-xs font-bold flex items-center justify-between gap-1">
                              <span className="truncate">{g.label}</span>
                              {active && <Check className="w-3 h-3 shrink-0" />}
                            </div>
                            <div className={`text-[10px] leading-snug mt-1 ${active ? 'opacity-90' : 'ink-muted'}`}>
                              {g.desc}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <span className="text-xs font-display font-bold ink-primary flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <span>
                        {language === 'bg'
                          ? '4. Енергичен Аврора Фон'
                          : '4. Animated Backdrop'}
                      </span>
                    </span>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        [
                          {
                            id: 'aurora' as AmbientModePreset,
                            label: language === 'bg' ? 'Аврора' : 'Aurora',
                            desc: language === 'bg' ? 'Живи светлинни вълни' : 'Shifting aurora ribbons',
                          },
                          {
                            id: 'fluid' as AmbientModePreset,
                            label: language === 'bg' ? 'Плазма' : 'Plasma',
                            desc: language === 'bg' ? 'Орбитална течност' : 'Orbital fluid mesh',
                          },
                          {
                            id: 'cyber' as AmbientModePreset,
                            label: language === 'bg' ? 'Призма' : 'Prism Grid',
                            desc: language === 'bg' ? 'Мрежа и ядро' : 'Grid & breathing core',
                          },
                          {
                            id: 'minimal' as AmbientModePreset,
                            label: language === 'bg' ? 'Статичен' : 'Static',
                            desc: language === 'bg' ? 'Изчистен (0% GPU)' : 'Clean static (0% GPU)',
                          },
                        ] as const
                      ).map((m) => {
                        const active = ambientMode === m.id;
                        return (
                          <motion.button
                            key={m.id}
                            type="button"
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.94 }}
                            transition={SPRING_POP}
                            onClick={() => {
                              triggerHapticFeedback('selection');
                              setAmbientMode(m.id);
                            }}
                            className={`p-2.5 rounded-2xl border text-left transition flex flex-col justify-between cursor-pointer ${
                              active
                                ? 'liquid-hero-btn preserve-white'
                                : 'glass-liquid-subtle ink-primary'
                            }`}
                          >
                            <div className="text-xs font-bold flex items-center justify-between gap-1">
                              <span className="truncate">{m.label}</span>
                              {active && <Check className="w-3 h-3 shrink-0" />}
                            </div>
                            <div className={`text-[10px] leading-snug mt-1 ${active ? 'opacity-90' : 'ink-muted'}`}>
                              {m.desc}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 5. Typography / Font Family Selector */}
                <div className="p-4 sm:px-5 space-y-2.5">
                  <span className="text-xs font-display font-bold ink-primary flex items-center gap-2">
                    <Type className="w-3.5 h-3.5 text-cyan-400" />
                    <span>
                      {language === 'bg'
                        ? '5. Типография и Шрифт (Latin + Кирилица)'
                        : '5. Interface Typography (Latin + Cyrillic)'}
                    </span>
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        {
                          id: 'geometric' as FontFamilyPreset,
                          name: 'Apple Geometric',
                          desc: language === 'bg' ? 'Модерен заоблен sans' : 'Sleek Onest geometric',
                          sampleStyle: { fontFamily: '"Onest", sans-serif' },
                        },
                        {
                          id: 'jakarta' as FontFamilyPreset,
                          name: 'Jakarta Display',
                          desc: language === 'bg' ? 'Изразителен дисплеен' : 'Bold display contrast',
                          sampleStyle: { fontFamily: '"Plus Jakarta Sans", sans-serif' },
                        },
                        {
                          id: 'system' as FontFamilyPreset,
                          name: 'Native OS UI',
                          desc: language === 'bg' ? 'Системен шрифт' : 'SF Pro / System UI',
                          sampleStyle: {
                            fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
                          },
                        },
                        {
                          id: 'mono' as FontFamilyPreset,
                          name: 'JetBrains Mono',
                          desc: language === 'bg' ? 'Пълен моноспейс' : 'Full terminal monospace',
                          sampleStyle: { fontFamily: '"JetBrains Mono", monospace' },
                        },
                      ] as const
                    ).map((f) => {
                      const isSelected = fontFamily === f.id;
                      return (
                        <motion.button
                          key={f.id}
                          type="button"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.94 }}
                          transition={SPRING_POP}
                          onClick={() => {
                            triggerHapticFeedback('selection');
                            setFontFamily(f.id);
                          }}
                          style={f.sampleStyle}
                          className={`px-3 py-2.5 rounded-2xl border text-left transition flex items-center justify-between gap-2 cursor-pointer ${
                            isSelected
                              ? 'liquid-hero-btn preserve-white'
                              : 'glass-liquid-subtle ink-primary'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{f.name}</div>
                            <div className={`text-[10px] truncate mt-0.5 ${isSelected ? 'opacity-90' : 'ink-muted'}`}>
                              {f.desc}
                            </div>
                          </div>
                          <span className="text-sm font-extrabold shrink-0">Aa</span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      )}

      {/* =====================================================================
          TAB: OVERVIEW — APPEARANCE BANNER, QUICK-LAUNCH & CONNECTION/LANGUAGE
         ===================================================================== */}
      {activeSettingsTab === 'overview' && (
        <div className="space-y-5">
          {/* Elevated Compact Liquid Glass Studio Strip */}
          <div className="glass-liquid rounded-[26px] p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 squircle-badge squircle-violet flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 icon-sparkle-live" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-sm font-extrabold ink-primary tracking-tight">
                    {isBg ? 'Apple Liquid Glass Студио' : 'Apple Liquid Glass Studio'}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/14 border border-cyan-400/35 text-[10px] font-mono font-bold text-cyan-400 uppercase">
                    {themeMode === 'light'
                      ? isBg
                        ? 'Светъл Daylight'
                        : 'Bright Daylight'
                      : isBg
                      ? 'Тъмен Prism'
                      : 'Vibrant Dark'}
                  </span>
                </div>
                <p className="text-xs ink-muted truncate mt-0.5">
                  {isBg
                    ? 'Сменяйте теми, акценти, оптично стъкло, аврора фон и шрифтове'
                    : 'Customize polarity, 6 hero accents, optical glass finish, aurora & typography'}
                </p>
              </div>
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.93 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                setActiveSettingsTab('appearance');
              }}
              className="h-9 px-4 rounded-full liquid-hero-btn text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 ml-auto"
            >
              <Palette className="w-3.5 h-3.5" />
              <span>{isBg ? 'Отвори Студио' : 'Open Studio'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>

          {/* Quick-Launch Control Centers */}
          <div className="space-y-2.5">
            <span className="text-[11px] font-display text-cyan-400 uppercase tracking-wider px-1 font-bold">
              {isBg ? 'Контролни центрове за бърз достъп' : 'Quick-Launch Control Centers'}
            </span>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {/* 1. Pair Phone & PC */}
              <motion.button
                type="button"
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  useUIStore.getState().openModal('quickSetup');
                }}
                className="glass-liquid p-3.5 rounded-[24px] text-left flex items-start gap-3 cursor-pointer"
              >
                <div className="w-10 h-10 squircle-badge squircle-emerald flex items-center justify-center shrink-0">
                  <QrCode className="w-5 h-5 icon-bubbly" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs sm:text-sm font-bold ink-primary truncate">
                    {isBg ? 'Сдвои Телефон & PC' : 'Pair Phone & PC'}
                  </div>
                  <div className="text-[11px] ink-muted truncate mt-0.5">
                    {isBg ? '1-клик QR код и 6-цифрен PIN' : '1-Tap QR & 6-Digit PIN Setup'}
                  </div>
                </div>
              </motion.button>

              {/* 2. PC Daemon Control Center */}
              <motion.button
                type="button"
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  useUIStore.getState().openModal('pcDaemonGui');
                }}
                className="glass-liquid p-3.5 rounded-[24px] text-left flex items-start gap-3 cursor-pointer"
              >
                <div className="w-10 h-10 squircle-badge squircle-hero flex items-center justify-center shrink-0">
                  <Monitor className="w-5 h-5 icon-bubbly" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs sm:text-sm font-bold ink-primary truncate">
                    {isBg ? 'PC Демон Център' : 'PC Daemon Center'}
                  </div>
                  <div className="text-[11px] text-emerald-400 font-mono font-semibold truncate mt-0.5 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                    <span className="truncate">{isBg ? 'Защита и Сесии' : 'Safeguards & Peers'}</span>
                  </div>
                </div>
              </motion.button>

              {/* 3. System & AI Update Center */}
              <motion.button
                type="button"
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  if (onOpenUpdateCenter) onOpenUpdateCenter();
                }}
                className="glass-liquid p-3.5 rounded-[24px] text-left flex items-start gap-3 cursor-pointer"
              >
                <div className="w-10 h-10 squircle-badge squircle-sky flex items-center justify-center shrink-0">
                  <RefreshCw className="w-5 h-5 icon-spin-bubbly" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs sm:text-sm font-bold ink-primary truncate">
                    {isBg ? 'Системен & AI Център' : 'System & AI Center'}
                  </div>
                  <div className="text-[11px] text-cyan-400 font-mono font-semibold truncate mt-0.5">
                    Beta v0.90.0 • AI-NET/3.0
                  </div>
                </div>
              </motion.button>

              {/* 4. WoL & Energy Hub Shortcut */}
              <motion.button
                type="button"
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  setActiveSettingsTab('wol');
                }}
                className="glass-liquid p-3.5 rounded-[24px] text-left flex items-start gap-3 cursor-pointer"
              >
                <div className="w-10 h-10 squircle-badge squircle-amber flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs sm:text-sm font-bold ink-primary truncate">
                    {isBg ? 'WoL & Енергия' : 'WoL & Energy'}
                  </div>
                  <div className="text-[11px] ink-muted truncate mt-0.5">
                    {isBg ? 'Magic пакети, графици и CO₂' : 'Magic Packet Log & CO₂ savings'}
                  </div>
                </div>
              </motion.button>

              {/* 5. Security & Command Audit Log Shortcut */}
              <motion.button
                type="button"
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  setActiveSettingsTab('audit');
                }}
                className="glass-liquid p-3.5 rounded-[24px] text-left flex items-start gap-3 cursor-pointer"
              >
                <div className="w-10 h-10 squircle-badge squircle-violet flex items-center justify-center shrink-0">
                  <Terminal className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs sm:text-sm font-bold ink-primary truncate">
                    {isBg ? 'Одитен дневник' : 'Security Audit Log'}
                  </div>
                  <div className="text-[11px] ink-muted truncate mt-0.5">
                    {isBg ? 'Команди, HITL и Демон логове' : 'Commands, HITL & Daemon trail'}
                  </div>
                </div>
              </motion.button>

              {/* 6. Interactive App Guide */}
              <motion.button
                type="button"
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  useUIStore.getState().openModal('onboarding');
                }}
                className="glass-liquid p-3.5 rounded-[24px] text-left flex items-start gap-3 cursor-pointer"
              >
                <div className="w-10 h-10 squircle-badge squircle-rose flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 icon-sparkle-live" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs sm:text-sm font-bold ink-primary truncate">
                    {isBg ? 'Интерактивно ръководство' : 'Interactive Guide'}
                  </div>
                  <div className="text-[11px] ink-muted truncate mt-0.5">
                    {isBg ? 'Обиколка на функциите и помощ' : 'Guided walkthrough & tips'}
                  </div>
                </div>
              </motion.button>
            </div>
          </div>

          {/* Connection, Discovery & Language Card */}
          <div className="space-y-2.5">
            <span className="text-[11px] font-display text-cyan-400 uppercase tracking-wider px-1 font-bold">
              {isBg ? 'Връзка, мрежово откриване и език' : 'Connection, Network & Language'}
            </span>

            <div className="glass-liquid w-full rounded-[26px] divide-y divide-white/[0.08] overflow-hidden">
              {/* WebSocket Endpoint Config */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onOpenWsConfig();
                }}
                className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-emerald flex items-center justify-center shrink-0">
                    <ArrowUpCircle className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_ws_config')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
                      {t('settings_ws_config_desc')}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 ink-muted shrink-0" />
              </button>

              {/* Auto Discovery (mDNS) */}
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-sky flex items-center justify-center shrink-0">
                    <Radio className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_autodiscovery')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
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
                  className={`px-3.5 py-1.5 h-8.5 rounded-full text-[10.5px] font-mono font-bold uppercase transition shrink-0 cursor-pointer ${
                    isAutoDiscovery
                      ? 'bg-emerald-500/16 text-emerald-400 border border-emerald-500/35'
                      : 'liquid-control-pill ink-secondary'
                  }`}
                >
                  {isAutoDiscovery
                    ? isBg
                      ? 'mDNS Активен'
                      : 'mDNS Auto'
                    : isBg
                    ? 'Ръчен IP'
                    : 'Manual IP'}
                </button>
              </div>

              {/* Language Selector */}
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-violet flex items-center justify-center shrink-0">
                    <Languages className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_language')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
                      {t('settings_language_desc')}
                    </span>
                  </div>
                </div>
                <LanguageToggle variant="segmented" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB: WOL & ENERGY HUB
         ===================================================================== */}
      {activeSettingsTab === 'wol' && (
        <div className="space-y-5">
          {/* Quick Action Ribbon for Schedules & Direct Packet */}
          <div className="glass-liquid rounded-[26px] p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 squircle-badge squircle-amber flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-sm font-extrabold ink-primary tracking-tight">
                  {isBg ? 'Wake-on-LAN Автоматизация и Графици' : 'Wake-on-LAN Automation & Schedules'}
                </h2>
                <p className="text-xs ink-muted mt-0.5">
                  {activeWolSchedulesCount !== undefined && activeWolSchedulesCount > 0
                    ? isBg
                      ? `${activeWolSchedulesCount} активни графика за автоматично събуждане`
                      : `${activeWolSchedulesCount} active recurring wake schedules`
                    : isBg
                    ? 'Настройте графици за събуждане и спестете енергия автоматично'
                    : 'Configure automated wake schedules and maximize fleet power efficiency'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-auto flex-wrap">
              <motion.button
                type="button"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.92 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  useUIStore.getState().openModal('wol', { device: hosts?.[0] || null, tab: 'direct' });
                }}
                className="h-9 px-3.5 rounded-full squircle-amber preserve-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{isBg ? 'Директен пакет' : 'Direct Wake'}</span>
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.92 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  if (onOpenWolScheduler) onOpenWolScheduler();
                }}
                className="h-9 px-4 rounded-full liquid-hero-btn text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{isBg ? 'Управлявай графици' : 'Manage Schedules'}</span>
              </motion.button>
            </div>
          </div>

          <WolEnergyCalculator
            wolSchedules={wolSchedules}
            defaultHostCount={hostsCount !== undefined && hostsCount > 0 ? hostsCount : 1}
          />

          <WolHistoryLogViewer hosts={hosts} onSendWolPacket={onSendWolPacket} />
        </div>
      )}

      {/* =====================================================================
          TAB: AUDIT & LOGS (Shell Commands + Security/HITL + PC Daemon)
         ===================================================================== */}
      {activeSettingsTab === 'audit' && (
        <AuditLogViewer
          executionLogs={executionLogs}
          onOpenLiveConsole={onOpenTerminalLogs}
        />
      )}

      {/* =====================================================================
          TAB: AI & ZERO-TRUST SECURITY
         ===================================================================== */}
      {activeSettingsTab === 'ai_security' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT: AI COPILOT ENGINE & MEMORY */}
          <div
            className={`lg:col-span-6 space-y-2.5 relative ${
              isModelDropdownOpen || isAddModelOpen ? 'z-[80]' : 'z-30'
            }`}
          >
            <span className="text-[11px] font-display text-cyan-400 uppercase tracking-wider px-1 font-bold">
              {isBg ? 'AI Двигател и Контекстна Памет' : 'AI Copilot Engine & Memory'}
            </span>

            <div className="glass-liquid w-full rounded-[26px] divide-y divide-white/[0.08] relative overflow-visible">
              {/* Row 1: Dynamic AI Model Selector */}
              <div className="p-4 flex flex-col space-y-2.5 relative">
                <div className="flex items-center justify-between gap-2.5 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 squircle-badge squircle-hero flex items-center justify-center shrink-0">
                      <Brain className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                        {t('settings_ai_model')}
                      </span>
                      <span className="text-fluid-meta ink-muted truncate">
                        {t('settings_ai_model_desc')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <button
                      type="button"
                      onClick={() => handleTestModel(selectedModel)}
                      disabled={isTestingModel}
                      className="h-9 px-3 rounded-full liquid-control-pill text-cyan-400 text-xs font-mono font-semibold flex items-center justify-center cursor-pointer"
                      title={isBg ? 'Тествай модела' : 'Test Model'}
                    >
                      {isTestingModel ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        testResult || (isBg ? 'Тест' : 'Test')
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsModelDropdownOpen((prev) => !prev)}
                      className="h-9 px-3.5 rounded-full liquid-control-pill border border-cyan-400/40 text-cyan-400 text-xs font-mono font-semibold flex items-center gap-1.5 cursor-pointer"
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

                {/* High-Contrast Liquid Dropdown Menu */}
                <AnimatePresence>
                  {isModelDropdownOpen && (
                    <div key="model-dropdown-layer">
                      <div
                        className="fixed inset-0"
                        style={{ zIndex: 90, backgroundColor: 'var(--backdrop-scrim)' }}
                        onClick={() => setIsModelDropdownOpen(false)}
                      />
                      <motion.div
                        variants={POPOVER_BUBBLE_VARIANTS}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        style={{ zIndex: 95 }}
                        className="absolute right-3 top-14 w-80 max-w-[calc(100vw-2rem)] rounded-[24px] dropdown-menu-surface p-2.5 space-y-1 max-h-80 overflow-y-auto bouncy-scroll"
                      >
                        <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px] font-mono ink-secondary uppercase tracking-wider border-b border-white/[0.10]">
                          <span>{isBg ? 'Налични AI Модели' : 'Available AI Models'}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setIsModelDropdownOpen(false);
                              setIsAddModelOpen(true);
                            }}
                            className="text-cyan-400 hover:underline font-bold cursor-pointer"
                          >
                            {isBg ? '+ Добави модел' : '+ Add Custom'}
                          </button>
                        </div>

                        {modelsList.map((m) => (
                          <div
                            key={m.id}
                            className={`w-full rounded-2xl text-xs font-mono flex items-stretch transition ${
                              selectedModel === m.id
                                ? 'bg-cyan-500/16 text-cyan-400 font-semibold border border-cyan-400/40'
                                : 'ink-primary hover:bg-white/[0.06]'
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
                                  {isBg ? m.nameBg || m.name : m.name}
                                </span>
                                {selectedModel === m.id && (
                                  <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                )}
                              </div>
                              <span className="text-[10px] ink-muted line-clamp-2 mt-0.5 leading-snug">
                                {isBg ? m.descriptionBg || m.description : m.description}
                              </span>
                            </button>
                            {!(m.isBuiltIn ?? DEFAULT_BUILTIN_MODEL_IDS.has(m.id)) && (
                              <button
                                type="button"
                                onClick={(e) => void handleDeleteCustomModel(m.id, e)}
                                title={isBg ? 'Премахни модела' : 'Remove custom model'}
                                aria-label={isBg ? `Премахни ${m.name}` : `Remove ${m.name}`}
                                className="px-2.5 flex items-center justify-center ink-muted hover:text-rose-400 transition shrink-0 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {/* Add Custom AI Model Liquid Glass Modal */}
                <AnimatePresence>
                  {isAddModelOpen && (
                    <div
                      className="fixed inset-0 z-[110] flex items-center justify-center p-4 backdrop-blur-md modal-backdrop-scrim"
                      style={{ backgroundColor: 'var(--backdrop-scrim)' }}
                    >
                      <motion.div
                        variants={MODAL_BUBBLE_VARIANTS}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="w-full max-w-md rounded-[28px] glass-liquid-modal p-5 space-y-4 ink-primary"
                      >
                        <div className="flex items-center justify-between border-b border-white/[0.10] pb-3">
                          <h3 className="text-sm sm:text-base font-display font-extrabold text-cyan-400">
                            {isBg ? 'Добави персонализиран AI модел' : 'Add Custom AI Model'}
                          </h3>
                          <button
                            type="button"
                            onClick={() => setIsAddModelOpen(false)}
                            className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
                            aria-label={isBg ? 'Затвори' : 'Close'}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <form onSubmit={handleAddCustomModel} className="space-y-3 font-mono text-xs">
                          <div>
                            <label className="block text-[11px] font-sans font-semibold ink-secondary mb-1">
                              {isBg ? 'Идентификатор (ID)' : 'Model Identifier (ID)'}
                            </label>
                            <input
                              type="text"
                              required
                              value={newModelId}
                              onChange={(e) => setNewModelId(e.target.value)}
                              placeholder="e.g. gemini-2.5-flash or ollama/llama3.3"
                              className="w-full px-3.5 py-2.5 rounded-full liquid-terminal-entry ink-primary outline-none focus:border-cyan-400"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-sans font-semibold ink-secondary mb-1">
                              {isBg ? 'Показвано име' : 'Display Name'}
                            </label>
                            <input
                              type="text"
                              required
                              value={newModelName}
                              onChange={(e) => setNewModelName(e.target.value)}
                              placeholder="e.g. Custom Gemini Flash"
                              className="w-full px-3.5 py-2.5 rounded-full liquid-terminal-entry ink-primary outline-none focus:border-cyan-400"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-sans font-semibold ink-secondary mb-1">
                              {isBg ? 'Доставчик' : 'Provider Type'}
                            </label>
                            <select
                              value={newModelProvider}
                              onChange={(e) => setNewModelProvider(e.target.value as any)}
                              className="w-full px-3.5 py-2.5 rounded-full liquid-terminal-entry ink-primary outline-none focus:border-cyan-400"
                            >
                              <option value="gemini">Google Gemini API</option>
                              <option value="deepseek">DeepSeek AI</option>
                              <option value="ollama">Local Ollama</option>
                              <option value="custom">Custom Endpoint</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-sans font-semibold ink-secondary mb-1">
                              {isBg ? 'Описание' : 'Description'}
                            </label>
                            <input
                              type="text"
                              value={newModelDesc}
                              onChange={(e) => setNewModelDesc(e.target.value)}
                              placeholder={
                                isBg ? 'Кратко описание' : 'Short description of capabilities'
                              }
                              className="w-full px-3.5 py-2.5 rounded-full liquid-terminal-entry ink-primary outline-none focus:border-cyan-400"
                            />
                          </div>

                          {(newModelProvider === 'custom' || newModelProvider === 'ollama') && (
                            <>
                              <div>
                                <label className="block text-[11px] font-sans font-semibold ink-secondary mb-1">
                                  {isBg ? 'URL на API крайната точка' : 'Endpoint URL'}{' '}
                                  {newModelProvider === 'custom' && (
                                    <span className="text-cyan-400">*</span>
                                  )}
                                </label>
                                <input
                                  type="url"
                                  required={newModelProvider === 'custom'}
                                  value={newModelEndpointUrl}
                                  onChange={(e) => setNewModelEndpointUrl(e.target.value)}
                                  placeholder={
                                    newModelProvider === 'ollama'
                                      ? 'http://127.0.0.1:11434'
                                      : 'https://api.example.com/v1/chat/completions'
                                  }
                                  className="w-full px-3.5 py-2.5 rounded-full liquid-terminal-entry ink-primary outline-none focus:border-cyan-400"
                                />
                              </div>
                              {newModelProvider === 'custom' && (
                                <div>
                                  <label className="block text-[11px] font-sans font-semibold ink-secondary mb-1">
                                    {isBg
                                      ? 'API ключ (По избор — съхранява се само на сървъра)'
                                      : 'API Key (Optional — stored server-side only)'}
                                  </label>
                                  <input
                                    type="password"
                                    autoComplete="off"
                                    value={newModelApiKey}
                                    onChange={(e) => setNewModelApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full px-3.5 py-2.5 rounded-full liquid-terminal-entry ink-primary outline-none focus:border-cyan-400"
                                  />
                                </div>
                              )}
                            </>
                          )}

                          <div className="pt-2 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setIsAddModelOpen(false)}
                              className="px-4 py-2 rounded-full liquid-control-pill font-sans font-semibold cursor-pointer"
                            >
                              {isBg ? 'Отказ' : 'Cancel'}
                            </button>
                            <button
                              type="submit"
                              className="px-4 py-2 rounded-full liquid-hero-btn font-sans font-bold cursor-pointer"
                            >
                              {isBg ? 'Запази' : 'Save Model'}
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
                className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-violet flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_memory')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
                      {t('settings_memory_desc')}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 ink-muted shrink-0" />
              </button>

              {/* Row 3: Release Binaries & Source Code */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onOpenCodeViewer();
                }}
                className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-sky flex items-center justify-center shrink-0">
                    <Code2 className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {isBg
                        ? 'Бинарни Релийзи (.APK / .EXE) и Сорс Код'
                        : 'Release Binaries (.APK / .EXE) & Source Code'}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
                      {isBg
                        ? 'Изтегли компилирани пакети за Windows и Android'
                        : 'Download pre-built Windows & Android packages'}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 ink-muted shrink-0" />
              </button>
            </div>
          </div>

          {/* RIGHT: ZERO-TRUST SECURITY, ALERTS & AUDIT SHORTCUT */}
          <div className="lg:col-span-6 space-y-2.5 relative z-10">
            <span className="text-[11px] font-display text-cyan-400 uppercase tracking-wider px-1 font-bold">
              {isBg ? 'Zero-Trust Сигурност и Известия' : 'Zero-Trust Security & Alerts'}
            </span>

            {settingsSyncError && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-rose-500/12 border border-rose-500/35 text-rose-400 text-xs font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{settingsSyncError}</span>
              </div>
            )}

            {biometricNotice && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-amber-500/12 border border-amber-500/35 text-amber-400 text-xs font-mono">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{biometricNotice}</span>
              </div>
            )}

            <div className="glass-liquid w-full rounded-[26px] divide-y divide-white/[0.08] overflow-hidden">
              {/* HITL Gate */}
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-rose flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_hitl')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
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
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-hero flex items-center justify-center shrink-0">
                    <Fingerprint className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_biometric')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
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
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-amber flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_confirmations')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
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
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-emerald flex items-center justify-center shrink-0">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_alerts')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
                      {t('settings_alerts_desc')}
                    </span>
                  </div>
                </div>
                <CyberToggle
                  checked={isSystemStateAlerts}
                  onChange={(v) => void persistSettingPatch({ isSystemStateAlerts: v })}
                />
              </div>

              {/* Dedicated Security Audit Log Shortcut */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  setActiveSettingsTab('audit');
                }}
                className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.04] transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 squircle-badge squircle-violet flex items-center justify-center shrink-0">
                    <Terminal className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-display text-xs sm:text-sm font-bold ink-primary tracking-tight truncate">
                      {t('settings_system_logs')}
                    </span>
                    <span className="text-fluid-meta ink-muted truncate">
                      {t('settings_system_logs_desc')}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 ink-muted shrink-0" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const SettingsScreen = React.memo(SettingsScreenComponent);
