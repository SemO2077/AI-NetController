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
  const resetAppearance = useUIStore((s) => s.resetAppearance);
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

  const [isAutoDiscovery, setIsAutoDiscovery] = useState(true);
  const [isHitlEnabled, setIsHitlEnabled] = useState(true);
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [isCommandConfirmations, setIsCommandConfirmations] = useState(true);
  const [isSystemStateAlerts, setIsSystemStateAlerts] = useState(true);

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
      id: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash (Recommended)',
      nameBg: 'Gemini 3.8 Flash (Препоръчителен)',
      description: 'Ultra-fast multimodal reasoning model for real-time fleet triage & control',
      descriptionBg:
        'Свръхбърз мултимодален модел за диагностика на флота и управление в реално време',
      provider: 'gemini',
    },
    {
      id: 'gemini-3.1-flash-lite',
      name: 'Gemini 3.1 Flash Lite',
      nameBg: 'Gemini 3.1 Flash Lite',
      description: 'Lightweight high-efficiency low-latency model for quick sysadmin tasks',
      descriptionBg: 'Лек и високоефективен модел с ниско закъснение за бързи системни задачи',
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

  const handleTestModel = async (modelId: string) => {
    setIsTestingModel(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(`⚡ Online (${data.latencyMs}ms)`);
      } else {
        setTestResult(`⚠️ ${data.error || (language === 'bg' ? 'Неуспешен тест' : 'Test failed')}`);
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
        body: JSON.stringify({
          id: newModelId,
          name: newModelName,
          provider: newModelProvider,
          description: newModelDesc || 'Custom Model Endpoint',
        }),
      });
      const data = await res.json();
      if (data.success && data.models) {
        setModelsList(data.models);
        setSelectedModel(data.model.id);
        setNewModelId('');
        setNewModelName('');
        setNewModelDesc('');
        setIsAddModelOpen(false);
        triggerHapticFeedback('medium');
      }
    } catch (err) {
      console.error('Failed to save model:', err);
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
    <div className="w-full max-w-6xl mx-auto pb-4 select-none grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* LEFT COLUMN: GENERAL & AI + WAKE-ON-LAN */}
      <div className="lg:col-span-7 flex flex-col space-y-5">
        {/* SECTION 0: LIQUID GLASS & APPEARANCE STUDIO */}
        <div className="space-y-2 relative z-40">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-mono text-cyan-300 uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                {language === 'bg'
                  ? 'ТЕЧНО СТЪКЛО И ПЕРСОНАЛИЗАЦИЯ'
                  : 'LIQUID GLASS & APPEARANCE'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('medium');
                resetAppearance();
              }}
              className="text-[11px] font-mono text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition active:scale-95"
              title={language === 'bg' ? 'Възстанови стандартния облик' : 'Reset appearance to defaults'}
            >
              <RotateCcw className="w-3 h-3" />
              <span>{language === 'bg' ? 'Нулирай' : 'Reset'}</span>
            </button>
          </div>

          <div className="glass-liquid w-full rounded-2xl divide-y divide-white/[0.08] overflow-hidden">
            {/* 1. Accent Color Palette Picker */}
            <div className="p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/35">
                    <Palette className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight">
                      {language === 'bg' ? 'Цветова Палитра и Сияние' : 'Accent Color & Aurora Glow'}
                    </span>
                    <span className="text-fluid-meta text-slate-400">
                      {language === 'bg'
                        ? 'Променя акцентите, индикаторите и фоновото сияние'
                        : 'Tints liquid glass edges, telemetry bars & ambient aurora'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-0.5">
                {(
                  [
                    {
                      id: 'cyan' as AccentColorPreset,
                      label: language === 'bg' ? 'Кибер Циан' : 'Cyber Cyan',
                      swatch: 'from-[#22d3ee] via-[#38bdf8] to-[#6366f1]',
                    },
                    {
                      id: 'violet' as AccentColorPreset,
                      label: language === 'bg' ? 'Ултравиолет' : 'Ultraviolet',
                      swatch: 'from-[#c084fc] via-[#a855f7] to-[#ec4899]',
                    },
                    {
                      id: 'emerald' as AccentColorPreset,
                      label: language === 'bg' ? 'Емералд' : 'Bio Mint',
                      swatch: 'from-[#34d399] via-[#10b981] to-[#06b6d4]',
                    },
                    {
                      id: 'rose' as AccentColorPreset,
                      label: language === 'bg' ? 'Рубин' : 'Crimson',
                      swatch: 'from-[#fb7185] via-[#f43f5e] to-[#fb923c]',
                    },
                    {
                      id: 'amber' as AccentColorPreset,
                      label: language === 'bg' ? 'Соларно Злато' : 'Solar Gold',
                      swatch: 'from-[#fbbf24] via-[#f59e0b] to-[#ef4444]',
                    },
                    {
                      id: 'cobalt' as AccentColorPreset,
                      label: language === 'bg' ? 'Сапфир' : 'Sapphire',
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
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 transition active:scale-95 ${
                        isSelected
                          ? 'bg-white/[0.12] border-white/40 shadow-[0_0_16px_var(--theme-accent-glow)]'
                          : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.07]'
                      }`}
                    >
                      <span
                        className={`w-7 h-7 rounded-full bg-gradient-to-br ${item.swatch} flex items-center justify-center shadow-inner border border-white/30`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />}
                      </span>
                      <span
                        className={`text-[10.5px] font-medium truncate max-w-full ${
                          isSelected ? 'text-white font-bold' : 'text-slate-300'
                        }`}
                      >
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Typography / Font Family Selector */}
            <div className="p-3.5 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/35">
                  <Type className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight">
                    {language === 'bg' ? 'Шрифт на Интерфейса' : 'Interface Typography'}
                  </span>
                  <span className="text-fluid-meta text-slate-400">
                    {language === 'bg'
                      ? 'Изберете стил на шрифта за заглавия и панели'
                      : 'Choose the primary typeface across cards & controls'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
                {(
                  [
                    {
                      id: 'geometric' as FontFamilyPreset,
                      name: 'Onest',
                      desc: language === 'bg' ? 'Модерен' : 'Geometric',
                      sampleStyle: { fontFamily: '"Onest", sans-serif' },
                    },
                    {
                      id: 'jakarta' as FontFamilyPreset,
                      name: 'Jakarta',
                      desc: language === 'bg' ? 'Динамичен' : 'Editorial',
                      sampleStyle: { fontFamily: '"Plus Jakarta Sans", sans-serif' },
                    },
                    {
                      id: 'system' as FontFamilyPreset,
                      name: 'SF System',
                      desc: language === 'bg' ? 'Системен' : 'Native OS',
                      sampleStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
                    },
                    {
                      id: 'mono' as FontFamilyPreset,
                      name: 'JetBrains',
                      desc: language === 'bg' ? 'Терминален' : 'Tech Mono',
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
                      className={`px-3 py-2 rounded-xl border text-left transition flex items-center justify-between gap-2 active:scale-95 ${
                        isSelected
                          ? 'bg-cyan-500/20 border-cyan-300/55 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                          : 'bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">{f.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{f.desc}</div>
                      </div>
                      <span className="text-sm font-extrabold text-cyan-300 shrink-0">Aa</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Liquid Glass Translucency & Ambient Aurora Row */}
            <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Layers className="w-3.5 h-3.5 text-cyan-300" />
                  <span>
                    {language === 'bg' ? 'Прозрачност на Стъклото' : 'Glass Translucency'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-black/30 border border-white/10">
                  {(
                    [
                      {
                        id: 'clear' as GlassIntensityPreset,
                        label: language === 'bg' ? 'Кристал' : 'Crystal',
                      },
                      {
                        id: 'balanced' as GlassIntensityPreset,
                        label: language === 'bg' ? 'Баланс' : 'Liquid',
                      },
                      {
                        id: 'frosted' as GlassIntensityPreset,
                        label: language === 'bg' ? 'Матово' : 'Frosted',
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
                        className={`h-8 rounded-lg text-[11px] font-semibold transition active:scale-95 ${
                          active
                            ? 'bg-cyan-500/25 text-white border border-cyan-300/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                  <span>
                    {language === 'bg' ? 'Фоново Аврора Сияние' : 'Ambient Aurora & Motion'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-black/30 border border-white/10">
                  {(
                    [
                      {
                        id: 'vibrant' as AmbientModePreset,
                        label: language === 'bg' ? 'Живо' : 'Vibrant',
                      },
                      {
                        id: 'subtle' as AmbientModePreset,
                        label: language === 'bg' ? 'Нежно' : 'Subtle',
                      },
                      {
                        id: 'minimal' as AmbientModePreset,
                        label: language === 'bg' ? 'Изчистено' : 'Minimal',
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
                        className={`h-8 rounded-lg text-[11px] font-semibold transition active:scale-95 ${
                          active
                            ? 'bg-cyan-500/25 text-white border border-cyan-300/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 1: GENERAL & AI */}
        <div className="space-y-2 relative z-30">
          <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
            {t('settings_general_title')}
          </span>

          <div className="glass-liquid w-full rounded-2xl divide-y divide-white/[0.06] relative overflow-visible">
            {/* Row 0: Language */}
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
                    className="h-9 px-2.5 rounded-xl bg-white/[0.04] hover:bg-white/10 text-cyan-300 text-xs font-mono transition border border-white/10 flex items-center justify-center active:scale-95"
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
                    className="h-9 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-cyan-300 text-xs font-mono font-medium flex items-center gap-1.5 transition border border-white/10 active:scale-95"
                  >
                    <span className="max-w-[125px] sm:max-w-[180px] truncate">
                      {selectedModel}
                    </span>
                    <ChevronRight
                      className={`w-3.5 h-3.5 transition-transform duration-150 shrink-0 ${
                        isModelDropdownOpen ? 'rotate-90' : ''
                      }`}
                    />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {isModelDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-[75] bg-black/60"
                      onClick={() => setIsModelDropdownOpen(false)}
                    />
                    <motion.div
                      variants={POPOVER_BUBBLE_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="absolute right-3 top-14 w-80 max-w-[calc(100vw-2rem)] rounded-2xl z-[80] bg-[#0a1224] border border-white/20 shadow-2xl p-2 space-y-1 max-h-80 overflow-y-auto"
                    >
                      <div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-white/10">
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
                          {language === 'bg' ? '+ Добави' : '+ Add Custom'}
                        </button>
                      </div>

                      {modelsList.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            triggerHapticFeedback('light');
                            setSelectedModel(m.id);
                            setIsModelDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-xl text-xs font-mono flex flex-col transition ${
                            selectedModel === m.id
                              ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-400/30'
                              : 'text-slate-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold truncate">
                              {language === 'bg' ? m.nameBg || m.name : m.name}
                            </span>
                            {selectedModel === m.id && (
                              <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0 ml-1" />
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 truncate mt-0.5">
                            {language === 'bg' ? m.descriptionBg || m.description : m.description}
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {isAddModelOpen && (
                  <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/75">
                    <motion.div
                      variants={MODAL_BUBBLE_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="w-full max-w-md rounded-2xl glass-liquid-modal p-5 space-y-4 text-white"
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
                            className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-white outline-none focus:border-cyan-400"
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
                            placeholder="e.g. Custom Gemini 2.5 Flash"
                            className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-white outline-none focus:border-cyan-400"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            {language === 'bg' ? 'Доставчик' : 'Provider Type'}
                          </label>
                          <select
                            value={newModelProvider}
                            onChange={(e) => setNewModelProvider(e.target.value as any)}
                            className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-white outline-none focus:border-cyan-400"
                          >
                            <option value="gemini">Google Gemini API</option>
                            <option value="deepseek">DeepSeek AI</option>
                            <option value="ollama">Local Ollama</option>
                            <option value="custom">Custom Endpoint</option>
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
                            className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-white outline-none focus:border-cyan-400"
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

            {/* Row 2: Auto Discovery */}
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
                  setIsAutoDiscovery(!isAutoDiscovery);
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

            {/* Row 3: Memory / Persistent Instructions */}
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

            {/* Row 4: WoL Scheduler */}
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

        {/* SECTION 2: WAKE-ON-LAN PACKET HISTORY */}
        <WolHistoryLogViewer hosts={hosts} onSendWolPacket={onSendWolPacket} />

        {/* SECTION 2B: ENERGY CALCULATOR (Dynamically uses actual Fleet Count) */}
        <WolEnergyCalculator
          wolSchedules={wolSchedules}
          defaultHostCount={hostsCount !== undefined && hostsCount > 0 ? hostsCount : 1}
        />
      </div>

      {/* RIGHT COLUMN: SECURITY, NOTIFICATIONS & SYSTEM */}
      <div className="lg:col-span-5 flex flex-col space-y-5">
        {/* SECTION 3: SECURITY & ACCESS */}
        <div className="space-y-2">
          <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
            {t('settings_hitl').split('(')[0] || 'SECURITY'}
          </span>

          <div className="glass-liquid w-full rounded-2xl divide-y divide-white/[0.06]">
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
              <CyberToggle checked={isHitlEnabled} onChange={setIsHitlEnabled} />
            </div>

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
              <CyberToggle checked={isBiometricEnabled} onChange={setIsBiometricEnabled} />
            </div>
          </div>
        </div>

        {/* SECTION 4: NOTIFICATIONS & ALERTS */}
        <div className="space-y-2">
          <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
            {t('settings_alerts')}
          </span>

          <div className="glass-liquid w-full rounded-2xl divide-y divide-white/[0.06]">
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
              <CyberToggle checked={isCommandConfirmations} onChange={setIsCommandConfirmations} />
            </div>

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
              <CyberToggle checked={isSystemStateAlerts} onChange={setIsSystemStateAlerts} />
            </div>
          </div>
        </div>

        {/* SECTION 5: SYSTEM & CONNECTION CONTROLS */}
        <div className="space-y-2">
          <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-1 font-semibold">
            {t('settings_audit_title')}
          </span>

          <div className="glass-liquid w-full rounded-2xl divide-y divide-white/[0.06]">
            {/* Pair PC & QR Setup */}
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                useUIStore.getState().openModal('quickSetup');
              }}
              className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center border border-emerald-400/30 shrink-0">
                  <QrCode className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {language === 'bg' ? 'Сдвояване на Телефон и PC' : 'Phone & PC Pairing Setup'}
                  </span>
                  <span className="text-fluid-meta text-slate-400 truncate">
                    {language === 'bg'
                      ? 'Сканирай QR код или свържи PC агент в локалната мрежа'
                      : 'Scan QR code or pair PC daemon over LAN'}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

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

            {/* PC Daemon Control Center */}
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                useUIStore.getState().openModal('pcDaemonGui');
              }}
              className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/30 shrink-0">
                  <Monitor className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {language === 'bg'
                      ? 'PC Демон Контролен Център'
                      : 'PC Daemon Control Center'}
                  </span>
                  <span className="text-fluid-meta text-slate-400 truncate">
                    {language === 'bg'
                      ? 'Настройки на хост демона, ключ за сдвояване и сигурност'
                      : 'Host daemon status, pairing key & view-only lock'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-emerald-300 bg-emerald-500/12 border border-emerald-400/25 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="w-3 h-3" />
                  <span>TLS</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            </button>

            {/* Update Center (Clean v0.34.0 version indicator, no hardcoded fake count) */}
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                if (onOpenUpdateCenter) onOpenUpdateCenter();
              }}
              className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/25 shrink-0">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {t('settings_update_center')}
                  </span>
                  <span className="text-fluid-meta text-slate-400 truncate">
                    {t('settings_update_center_desc')}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-400/25 px-2 py-0.5 rounded">
                  v0.34.0
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            </button>

            {/* Interactive Onboarding Tour */}
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                useUIStore.getState().openModal('onboarding');
              }}
              className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center border border-violet-400/30 shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {language === 'bg' ? 'Интерактивно Ръководство' : 'Interactive App Guide'}
                  </span>
                  <span className="text-fluid-meta text-slate-400 truncate">
                    {language === 'bg'
                      ? 'Преглед на функциите, сигурността и сдвояването'
                      : 'Overview of features, security guardrails & pairing'}
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
    </div>
  );
};

export const SettingsScreen = React.memo(SettingsScreenComponent);
