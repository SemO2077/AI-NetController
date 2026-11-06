import React, { useState } from 'react';
import {
  Brain,
  Radio,
  FileText,
  ShieldAlert,
  Fingerprint,
  Bell,
  Activity,
  Info,
  ArrowUpCircle,
  ChevronRight,
  Code,
  Terminal,
  Check,
  RefreshCw,
  Clock,
  Languages,
  SlidersHorizontal,
  Monitor,
  ShieldCheck,
  QrCode,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { HostDevice, WolPacketPayload, WolPacketTriggerSource, WolSchedule } from '../../types';
import { WolEnergyCalculator } from '../wol/WolEnergyCalculator';
import { WolHistoryLogViewer } from '../wol/WolHistoryLogViewer';
import { useTranslation } from '../../i18n/useTranslation';
import { LanguageToggle } from '../ui/LanguageToggle';
import { useUIStore } from '../../store/uiStore';
import {
  SPRING_BUBBLY,
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
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isAddModelOpen, setIsAddModelOpen] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelProvider, setNewModelProvider] = useState<'gemini' | 'ollama' | 'deepseek' | 'custom'>('gemini');
  const [newModelDesc, setNewModelDesc] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTestingModel, setIsTestingModel] = useState(false);

  const [isAutoDiscovery, setIsAutoDiscovery] = useState(true);
  const [isHitlEnabled, setIsHitlEnabled] = useState(true);
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [isCommandConfirmations, setIsCommandConfirmations] = useState(true);
  const [isSystemStateAlerts, setIsSystemStateAlerts] = useState(true);

  const [modelsList, setModelsList] = useState<Array<{ id: string; name: string; nameBg?: string; description: string; descriptionBg?: string; provider: string }>>([
    {
      id: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash (Recommended)',
      nameBg: 'Gemini 3.8 Flash (Препоръчителен)',
      description: 'Ultra-fast multimodal reasoning model for real-time fleet triage & mouse control',
      descriptionBg: 'Свръхбърз мултимодален модел за диагностика на флота и управление в реално време',
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
      setTestResult(language === 'bg' ? '⚠️ Грешка при връзка' : '⚠️ Test connection error');
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

  const CyberToggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      type="button"
      onClick={() => {
        triggerHapticFeedback('light');
        onChange(!checked);
      }}
      className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer group"
      aria-label="Toggle setting"
    >
      <div
        className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 flex items-center relative border transform-gpu ${
          checked
            ? 'bg-cyan-500/25 border-cyan-400/55 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
            : 'bg-white/10 border-white/12'
        }`}
      >
        <motion.div
          initial={false}
          animate={{
            x: checked ? 20 : 0,
            scale: checked ? 1.06 : 0.96,
          }}
          transition={SPRING_POP}
          className={`w-4.5 h-4.5 rounded-full transform-gpu ${
            checked ? 'bg-cyan-300 shadow-[0_0_10px_#22d3ee]' : 'bg-white/60 group-hover:bg-white/80'
          }`}
        />
      </div>
    </button>
  );

  return (
    <div className="w-full max-w-6xl mx-auto pb-4 select-none grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* LEFT COLUMN (Desktop): GENERAL & AI + GREEN WOL ENERGY CALCULATOR */}
      <div className="lg:col-span-7 flex flex-col space-y-6">
        {/* SECTION 1: GENERAL & AI */}
        <div className="space-y-2 relative z-30">
          <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-2 font-semibold">
            {t('settings_general_title')}
          </span>

          <div className="bg-[#0b1324]/55 backdrop-blur-2xl backdrop-saturate-[160%] border border-white/[0.07] border-t-white/[0.16] shadow-[0_12px_32px_rgba(0,0,0,0.4)] transform-gpu w-full rounded-[2rem] p-1 divide-y divide-white/[0.05] relative overflow-visible">
            <div className="absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none" />
            {/* Row 0: Language */}
            <div className="group p-3.5 sm:p-4 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/20 shrink-0">
                  <Languages className="w-4 h-4 icon-bubbly" />
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

            {/* Row 1: Dynamic AI Model Selector & Management */}
            <div className="group p-3.5 sm:p-4 flex flex-col space-y-3 relative">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-2xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/20 shrink-0">
                    <Brain className="w-4 h-4 icon-bubbly" />
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

                <div className="flex items-center space-x-2 shrink-0">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => handleTestModel(selectedModel)}
                    disabled={isTestingModel}
                    className="px-3 min-h-[40px] rounded-full bg-white/[0.04] hover:bg-white/10 text-cyan-300 text-xs font-mono transition cursor-pointer border border-white/10 flex items-center justify-center"
                    title={language === 'bg' ? 'Тествай връзка с модела' : 'Test Model Connection'}
                  >
                    {isTestingModel ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      testResult || (language === 'bg' ? 'Тест' : 'Test')
                    )}
                  </motion.button>

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setIsModelDropdownOpen((prev) => !prev)}
                    className="px-3 min-h-[40px] rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-cyan-300 text-xs font-mono font-medium flex items-center space-x-2 transition cursor-pointer border border-white/10"
                  >
                    <span className="max-w-[140px] sm:max-w-none truncate">{selectedModel}</span>
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 shrink-0 ${isModelDropdownOpen ? 'rotate-90' : ''}`} />
                  </motion.button>
                </div>
              </div>

              <AnimatePresence>
                {isModelDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-[75] bg-black/75 backdrop-blur-md"
                      onClick={() => setIsModelDropdownOpen(false)}
                    />
                    <motion.div
                      variants={POPOVER_BUBBLE_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="absolute right-4 top-14 w-80 max-w-[calc(100vw-2rem)] rounded-2xl z-[80] bg-[#0a1224]/98 backdrop-blur-3xl border border-white/20 shadow-2xl p-2.5 space-y-1.5 max-h-80 overflow-y-auto transform-gpu"
                    >
                      <div className="flex items-center justify-between px-2 py-1 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-white/10">
                        <span>{language === 'bg' ? 'Налични AI Модели' : 'Available AI Models'}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsModelDropdownOpen(false);
                            setIsAddModelOpen(true);
                          }}
                          className="text-cyan-400 hover:underline cursor-pointer font-bold"
                        >
                          {language === 'bg' ? '+ Добави модел' : '+ Add Custom Model'}
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
                          className={`w-full text-left px-3 py-2 rounded-xl text-xs font-mono flex flex-col transition cursor-pointer ${
                            selectedModel === m.id
                              ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-400/30'
                              : 'text-slate-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold truncate">{language === 'bg' ? (m.nameBg || m.name) : m.name}</span>
                            {selectedModel === m.id && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0 ml-1" />}
                          </div>
                          <span className="text-[10px] text-slate-400 truncate mt-0.5">
                            {language === 'bg' ? (m.descriptionBg || m.description) : m.description}
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {isAddModelOpen && (
                  <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
                    <motion.div
                      variants={MODAL_BUBBLE_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="w-full max-w-md rounded-3xl bg-[#091020]/96 backdrop-blur-3xl border border-white/15 border-t-white/25 shadow-[0_24px_64px_rgba(0,0,0,0.9)] p-6 space-y-4 text-white transform-gpu"
                    >
                      <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <h3 className="text-base font-bold text-cyan-300">
                          {language === 'bg' ? 'Добави / Обнови AI Модел' : 'Add / Update AI Model'}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setIsAddModelOpen(false)}
                          className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-white/10 flex items-center justify-center text-slate-300 hover:text-white cursor-pointer"
                          aria-label={language === 'bg' ? 'Затвори' : 'Close'}
                        >
                          ✕
                        </button>
                      </div>

                      <form onSubmit={handleAddCustomModel} className="space-y-3 font-mono text-xs">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            {language === 'bg' ? 'Идентификатор на модел (ID)' : 'Model Identifier (ID)'}
                          </label>
                          <input
                            type="text"
                            required
                            value={newModelId}
                            onChange={(e) => setNewModelId(e.target.value)}
                            placeholder="e.g. gemini-2.5-flash or ollama/llama3.3"
                            className="w-full px-3 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white outline-none focus:border-cyan-400"
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
                            className="w-full px-3 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white outline-none focus:border-cyan-400"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            {language === 'bg' ? 'Доставчик на модел' : 'Provider Type'}
                          </label>
                          <select
                            value={newModelProvider}
                            onChange={(e) => setNewModelProvider(e.target.value as any)}
                            className="w-full px-3 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white outline-none focus:border-cyan-400"
                          >
                            <option value="gemini">{language === 'bg' ? 'Google Gemini API' : 'Google Gemini API'}</option>
                            <option value="deepseek">{language === 'bg' ? 'DeepSeek AI' : 'DeepSeek AI'}</option>
                            <option value="ollama">{language === 'bg' ? 'Локален Ollama сървър' : 'Local Ollama / Open Source'}</option>
                            <option value="custom">{language === 'bg' ? 'Персонализиран адрес' : 'Custom Endpoint'}</option>
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
                            placeholder={language === 'bg' ? 'Кратко описание на възможностите' : 'Short description of capabilities'}
                            className="w-full px-3 py-2.5 rounded-xl bg-black/50 border border-white/15 text-white outline-none focus:border-cyan-400"
                          />
                        </div>

                        <div className="pt-2 flex justify-end space-x-2">
                          <button
                            type="button"
                            onClick={() => setIsAddModelOpen(false)}
                            className="px-4 py-2.5 min-h-[44px] rounded-full bg-white/10 hover:bg-white/20 text-slate-200 cursor-pointer"
                          >
                            {language === 'bg' ? 'Отказ' : 'Cancel'}
                          </button>
                          <button
                            type="submit"
                            className="px-5 py-2.5 min-h-[44px] rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold cursor-pointer"
                          >
                            {language === 'bg' ? 'Запази модел' : 'Save Model'}
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {/* Row 2: Auto Discovery */}
            <div className="p-3.5 sm:p-4 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/20 shrink-0">
                  <Radio className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs sm:text-sm font-semibold text-white tracking-wide truncate">
                    {t('settings_autodiscovery')}
                  </span>
                  <span className="text-[11px] text-slate-400 truncate">
                    {t('settings_autodiscovery_desc')}
                  </span>
                </div>
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  triggerHapticFeedback('light');
                  setIsAutoDiscovery(!isAutoDiscovery);
                }}
                className={`px-3 py-1.5 min-h-[36px] rounded-full text-[10px] font-mono font-bold uppercase transition shrink-0 cursor-pointer ${
                  isAutoDiscovery
                    ? 'bg-emerald-500/18 text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(0,230,118,0.2)]'
                    : 'bg-white/5 text-slate-400 border border-white/10'
                }`}
              >
                {isAutoDiscovery
                  ? language === 'bg'
                    ? 'АВТО-ОТКРИВАНЕ'
                    : 'AUTO-DISCOVERY'
                  : language === 'bg'
                  ? 'РЪЧЕН IP'
                  : 'MANUAL IP'}
              </motion.button>
            </div>

            {/* Row 3: Memory / Persistent Instructions */}
            <motion.div
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                onOpenPersistentInstructions();
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-violet-500/12 text-violet-300 flex items-center justify-center border border-violet-500/20 shrink-0">
                  <FileText className="w-4 h-4 icon-bubbly" />
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

              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </motion.div>

            {/* Row 4: WoL Scheduler */}
            <motion.div
              id="settings-wol-scheduler-row"
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                if (onOpenWolScheduler) onOpenWolScheduler();
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-amber-500/12 text-amber-300 flex items-center justify-center border border-amber-500/20 shrink-0">
                  <Clock className="w-4 h-4 icon-bubbly" />
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

              <div className="flex items-center space-x-2 shrink-0">
                <span className="hidden sm:inline-block text-[11px] font-mono text-amber-300/90">
                  {activeWolSchedulesCount !== undefined
                    ? `${activeWolSchedulesCount} ${t('settings_active_schedules')}`
                    : language === 'bg'
                    ? 'Настройки'
                    : 'Config'}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </motion.div>
          </div>
        </div>

        {/* SECTION 2: WAKE-ON-LAN PACKET HISTORY LOG VIEWER */}
        <WolHistoryLogViewer hosts={hosts} onSendWolPacket={onSendWolPacket} />

        {/* SECTION 2B: ENERGY CALCULATOR */}
        <WolEnergyCalculator wolSchedules={wolSchedules} defaultHostCount={hostsCount || 15} />
      </div>

      {/* RIGHT COLUMN (Desktop): SECURITY, NOTIFICATIONS & AUDIT */}
      <div className="lg:col-span-5 flex flex-col space-y-6">
        {/* SECTION 3: SECURITY & ACCESS */}
        <div className="space-y-2">
          <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-2 font-semibold">
            {t('settings_hitl').split('(')[0] || 'SECURITY'}
          </span>

          <div className="bg-[#0b1324]/55 backdrop-blur-2xl backdrop-saturate-[160%] border border-white/[0.07] border-t-white/[0.16] shadow-[0_12px_32px_rgba(0,0,0,0.4)] transform-gpu w-full rounded-[2rem] p-1 divide-y divide-white/[0.05] relative overflow-hidden">
            <div className="absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none" />
            <div className="group p-3.5 sm:p-4 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-rose-500/12 text-rose-300 flex items-center justify-center border border-rose-500/20 shrink-0">
                  <ShieldAlert className="w-4 h-4 icon-bubbly" />
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

            <div className="group p-3.5 sm:p-4 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/20 shrink-0">
                  <Fingerprint className="w-4 h-4 icon-bubbly" />
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
          <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-2 font-semibold">
            {t('settings_alerts')}
          </span>

          <div className="bg-[#0b1324]/55 backdrop-blur-2xl backdrop-saturate-[160%] border border-white/[0.07] border-t-white/[0.16] shadow-[0_12px_32px_rgba(0,0,0,0.4)] transform-gpu w-full rounded-[2rem] p-1 divide-y divide-white/[0.05] relative overflow-hidden">
            <div className="absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none" />
            <div className="group p-3.5 sm:p-4 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/20 shrink-0">
                  <Bell className="w-4 h-4 icon-bubbly" />
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

            <div className="group p-3.5 sm:p-4 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/12 text-emerald-300 flex items-center justify-center border border-emerald-500/20 shrink-0">
                  <Activity className="w-4 h-4 icon-bubbly" />
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

        {/* SECTION 5: AUDIT & SYSTEM CONTROLS */}
        <div className="space-y-2">
          <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest px-2 font-semibold">
            {t('settings_audit_title')}
          </span>

          <div className="bg-[#0b1324]/55 backdrop-blur-2xl backdrop-saturate-[160%] border border-white/[0.07] border-t-white/[0.16] shadow-[0_12px_32px_rgba(0,0,0,0.4)] transform-gpu w-full rounded-[2rem] p-1 divide-y divide-white/[0.05] relative overflow-hidden">
            <div className="absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none" />
            <motion.div
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                useUIStore.getState().openModal('quickSetup');
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center border border-emerald-400/30 shrink-0 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                  <QrCode className="w-4 h-4 icon-bubbly" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {language === 'bg' ? 'Бърза Настройка с 1 Клик (Телефон + PC)' : '1-Click Easy Setup (Phone QR + PC .EXE)'}
                  </span>
                  <span className="text-fluid-meta text-slate-400 truncate">
                    {language === 'bg'
                      ? 'Сканирай QR код за автоматично сдвояване или изтегли 1-клик .BAT / .EXE / .APK'
                      : 'Scan QR code for zero-typing phone pairing or download 1-click .BAT / .EXE / .APK'}
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <span className="hidden sm:inline-block text-[10px] font-mono text-emerald-300">
                  {language === 'bg' ? 'Авто-Сдвояване' : 'Auto-Pair'}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </motion.div>

            {/* Interactive Onboarding Tour */}
            <motion.div
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                useUIStore.getState().openModal('onboarding');
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-violet-500/15 text-violet-300 flex items-center justify-center border border-violet-400/30 shrink-0 shadow-[0_0_12px_rgba(168,85,247,0.2)]">
                  <Sparkles className="w-4 h-4 icon-bubbly" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {language === 'bg' ? 'Интерактивна Обиколка (Onboarding)' : 'Interactive App Tour & Onboarding'}
                  </span>
                  <span className="text-fluid-meta text-slate-400 truncate">
                    {language === 'bg'
                      ? 'Повторете 5-степенния наръчник за възможностите, сигурността и сдвояването'
                      : 'Replay the 5-step guided walkthrough on features, security & pairing'}
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-violet-300 bg-violet-500/12 border border-violet-400/25 px-2 py-0.5 rounded-full">
                  <span>{language === 'bg' ? 'Обиколка' : '5 Steps'}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </motion.div>

            <motion.div
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                useUIStore.getState().openModal('pcDaemonGui');
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-400/30 shrink-0 shadow-[0_0_12px_rgba(34,211,238,0.2)]">
                  <Monitor className="w-4 h-4 icon-bubbly" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {language === 'bg' ? 'PC Демон Контролен Център (GUI)' : 'PC Daemon Control Center (GUI)'}
                  </span>
                  <span className="text-fluid-meta text-slate-400 truncate">
                    {language === 'bg'
                      ? 'Графичен панел на хост демона, сдвояване, изглед-само и антивирусна защита'
                      : 'Host daemon GUI dashboard, pairing key, view-only lock & AV integrity'}
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0">
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-emerald-300 bg-emerald-500/12 border border-emerald-400/25 px-2 py-0.5 rounded-full">
                  <ShieldCheck className="w-3 h-3 icon-bubbly" />
                  <span>{language === 'bg' ? 'Проверен' : 'AV Clean'}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </motion.div>

            <motion.div
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                onOpenCodeViewer();
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/20 shrink-0">
                  <Info className="w-4 h-4 icon-bubbly" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-display text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                    {t('settings_code_viewer')}
                  </span>
                  <span className="text-fluid-meta text-slate-400 truncate">
                    {t('settings_code_viewer_desc')}
                  </span>
                </div>
              </div>
              <Code className="w-4 h-4 text-slate-400 group-hover:text-cyan-300 transition-colors shrink-0 icon-bubbly" />
            </motion.div>

            <motion.div
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                if (onOpenUpdateCenter) onOpenUpdateCenter();
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-cyan-500/12 text-cyan-300 flex items-center justify-center border border-cyan-500/20 shrink-0">
                  <RefreshCw className="w-4 h-4 icon-spin-bubbly" />
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

              <div className="flex items-center space-x-2 shrink-0">
                <span className="hidden sm:inline-block text-[11px] font-mono text-amber-300/90">
                  {language === 'bg' ? '5 налични' : '5 available'}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </motion.div>

            <motion.div
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                onOpenWsConfig();
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/12 text-emerald-300 flex items-center justify-center border border-emerald-500/20 shrink-0">
                  <ArrowUpCircle className="w-4 h-4 icon-bubbly" />
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
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </motion.div>

            <motion.div
              whileTap={{ scale: 0.985 }}
              onClick={() => {
                triggerHapticFeedback('light');
                onOpenTerminalLogs();
              }}
              className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.035] transition group"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-2xl bg-violet-500/12 text-violet-300 flex items-center justify-center border border-violet-500/20 shrink-0">
                  <Terminal className="w-4 h-4 icon-bubbly" />
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
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const SettingsScreen = React.memo(SettingsScreenComponent);
