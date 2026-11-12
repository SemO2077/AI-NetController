import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  HardDrive,
  Cpu,
  Plus,
  Trash2,
  CheckCircle2,
  Sparkles,
  Monitor,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { HostDevice } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';
import { SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';

interface MemoryManagerProps {
  hosts: HostDevice[];
  onUpdateInstructions: (
    hostId: string,
    type: 'persistent' | 'session',
    instructions: string[]
  ) => void;
}

const BILINGUAL_RULE_DICTIONARY: Array<{ en: string; bg: string }> = [
  {
    en: 'Default browser is Brave (C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe)',
    bg: 'Браузър по подразбиране е Brave (C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe)',
  },
  {
    en: 'Project files are located in D:\\Projects\\AI_NetController',
    bg: 'Файловете на проекта се намират в D:\\Projects\\AI_NetController',
  },
  {
    en: 'Direct termination of the PostgreSQL service is strictly prohibited',
    bg: 'Директното спиране на услугата PostgreSQL е строго забранено',
  },
  {
    en: 'Do not prompt for confirmation on minor software updates',
    bg: 'Не изисквай потвърждение за малки софтуерни обновления',
  },
  {
    en: 'Development environment located in C:\\Dev\\Workstation',
    bg: 'Средата за разработка се намира в C:\\Dev\\Workstation',
  },
  {
    en: 'Field diagnostics laptop for remote Wi-Fi and VLAN inspection',
    bg: 'Лаптоп за полева диагностика и отдалечена инспекция на Wi-Fi и VLAN',
  },
  {
    en: 'NFS storage partition mounted at /mnt/ai_net_backups',
    bg: 'NFS дял за резервни копия, монтиран в /mnt/ai_net_backups',
  },
  {
    en: 'Never stop sshd.service without explicit secondary confirmation',
    bg: 'Никога не спирай sshd.service без изрично вторично потвърждение',
  },
  {
    en: 'AI orchestrator active with Ollama qwen2.5-coder',
    bg: 'AI оркестраторът е активен с локален модел Ollama qwen2.5-coder',
  },
  {
    en: 'Require administrator approval before modifying firewall rules',
    bg: 'Изисквай одобрение от администратор преди промяна на защитната стена',
  },
  {
    en: 'Always create a restore point before installing system drivers',
    bg: 'Винаги създавай точка за възстановяване преди инсталиране на драйвери',
  },
  {
    en: 'Keep Docker Desktop and WSL2 services running in background',
    bg: 'Поддържай услугите Docker Desktop и WSL2 активни във фонов режим',
  },
  {
    en: 'Prioritize low-latency power profile during active remote sessions',
    bg: 'Приоритизирай енергиен профил с ниско закъснение по време на активна сесия',
  },
  {
    en: 'Suppress non-critical notifications while screen sharing is active',
    bg: 'Заглуши некритичните известия, докато споделянето на екрана е активно',
  },
  {
    en: 'Log all executed PowerShell commands to current session audit trail',
    bg: 'Записвай всички изпълнени PowerShell команди в одитния дневник на сесията',
  },
];

export function localizeRuleText(rule: string, isBg: boolean): string {
  const trimmed = rule.trim();
  const match = BILINGUAL_RULE_DICTIONARY.find(
    (entry) => entry.en.toLowerCase() === trimmed.toLowerCase() || entry.bg.toLowerCase() === trimmed.toLowerCase()
  );
  if (match) {
    return isBg ? match.bg : match.en;
  }
  return rule;
}

export const MemoryManager: React.FC<MemoryManagerProps> = ({
  hosts,
  onUpdateInstructions,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';

    const [selectedHostId, setSelectedHostId] = useState<string>(hosts[0]?.id || '');
  useEffect(() => {
    if (hosts.length > 0 && (!selectedHostId || !hosts.some((h) => h.id === selectedHostId))) {
      setSelectedHostId(hosts[0].id);
    } else if (hosts.length === 0 && selectedHostId !== '') {
      setSelectedHostId('');
    }
  }, [hosts, selectedHostId]);
  const [activeTab, setActiveTab] = useState<'persistent' | 'session'>('persistent');
  const [newPersistentRule, setNewPersistentRule] = useState('');
  const [newSessionRule, setNewSessionRule] = useState('');
  const [savedFeedback, setSavedFeedback] = useState(false);

  const selectedHost = hosts.find((h) => h.id === selectedHostId) || hosts[0];

  const persistentRules = selectedHost?.persistentInstructions || [];
  const sessionRules = selectedHost?.sessionInstructions || [];

  const triggerFeedback = () => {
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2200);
  };

  const handleAddPersistent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPersistentRule.trim() || !selectedHost) return;
    triggerHapticFeedback('medium');
    const updated = [...persistentRules, newPersistentRule.trim()];
    onUpdateInstructions(selectedHost.id, 'persistent', updated);
    setNewPersistentRule('');
    triggerFeedback();
  };

  const handleAddPresetRule = (type: 'persistent' | 'session', text: string) => {
    if (!selectedHost) return;
    triggerHapticFeedback('light');
    const currentList = type === 'persistent' ? persistentRules : sessionRules;
    const alreadyExists = currentList.some(
      (r) => localizeRuleText(r, isBg).toLowerCase() === text.toLowerCase()
    );
    if (alreadyExists) return;
    onUpdateInstructions(selectedHost.id, type, [...currentList, text]);
    triggerFeedback();
  };

  const handleRemovePersistent = (index: number) => {
    if (!selectedHost) return;
    triggerHapticFeedback('light');
    const updated = persistentRules.filter((_, i) => i !== index);
    onUpdateInstructions(selectedHost.id, 'persistent', updated);
    triggerFeedback();
  };

  const handleAddSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionRule.trim() || !selectedHost) return;
    triggerHapticFeedback('medium');
    const updated = [...sessionRules, newSessionRule.trim()];
    onUpdateInstructions(selectedHost.id, 'session', updated);
    setNewSessionRule('');
    triggerFeedback();
  };

  const handleRemoveSession = (index: number) => {
    if (!selectedHost) return;
    triggerHapticFeedback('light');
    const updated = sessionRules.filter((_, i) => i !== index);
    onUpdateInstructions(selectedHost.id, 'session', updated);
    triggerFeedback();
  };

  const handleClearSession = () => {
    if (!selectedHost) return;
    triggerHapticFeedback('medium');
    onUpdateInstructions(selectedHost.id, 'session', []);
    triggerFeedback();
  };

  const persistentPresets = isBg
    ? [
        'Изисквай одобрение от администратор преди промяна на защитната стена',
        'Винаги създавай точка за възстановяване преди инсталиране на драйвери',
        'Поддържай услугите Docker Desktop и WSL2 активни във фонов режим',
      ]
    : [
        'Require administrator approval before modifying firewall rules',
        'Always create a restore point before installing system drivers',
        'Keep Docker Desktop and WSL2 services running in background',
      ];

  const sessionPresets = isBg
    ? [
        'Приоритизирай енергиен профил с ниско закъснение по време на активна сесия',
        'Заглуши некритичните известия, докато споделянето на екрана е активно',
        'Записвай всички изпълнени PowerShell команди в одитния дневник на сесията',
      ]
    : [
        'Prioritize low-latency power profile during active remote sessions',
        'Suppress non-critical notifications while screen sharing is active',
        'Log all executed PowerShell commands to current session audit trail',
      ];

  return (
    <div className="space-y-4 w-full min-w-0">
      {/* 1. Target Host Selector Card */}
      <div className="p-3.5 rounded-2xl bg-[#0b1324]/90 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300 shrink-0">
            <Monitor className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-slate-400">
              {isBg ? 'Целеви компютър за правилата' : 'Target Host for Rules'}
            </div>
            <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  selectedHost?.isOnline ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="truncate">{selectedHost?.name || selectedHostId || (isBg ? "Няма свързан компютър" : "No Host Connected")}</span>
              {selectedHost?.ip && <span className="text-slate-400 font-mono text-[11px]">({selectedHost.ip})</span>}
            </div>
          </div>
        </div>

        <div className="w-full sm:w-64 shrink-0 min-w-0">
          <select
            value={selectedHostId}
            onChange={(e) => {
              triggerHapticFeedback('selection');
              setSelectedHostId(e.target.value);
            }}
            aria-label={isBg ? 'Избери целеви компютър' : 'Select target host'}
            className="w-full truncate rounded-xl bg-[#060b16] border border-cyan-500/35 px-3 py-2 min-h-[42px] text-xs text-cyan-200 font-mono font-semibold focus:border-cyan-400 focus:outline-none cursor-pointer"
          >
            {hosts.length === 0 ? (
              <option value="" disabled className="bg-slate-950 text-slate-500">
                {isBg ? 'Няма регистрирани устройства' : 'No registered devices'}
              </option>
            ) : (
              hosts.map((h) => (
                <option key={h.id} value={h.id} className="bg-slate-950 text-cyan-200">
                  {h.name} ({h.ip})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Sync Toast Banner */}
      <AnimatePresence>
        {savedFeedback && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="p-3 bg-emerald-500/15 border border-emerald-500/35 rounded-xl text-emerald-300 text-xs flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>
              {isBg
                ? `Правилата за ${selectedHost?.name} са синхронизирани успешно!`
                : `Memory rules for ${selectedHost?.name} synchronized successfully!`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Clean Segmented Tab Switcher: Persistent Rules vs Session Memory */}
      <div className="grid grid-cols-2 gap-1.5 p-1.5 rounded-2xl bg-[#060b16] border border-white/10">
        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback('selection');
            setActiveTab('persistent');
          }}
          className={`relative min-h-[42px] px-3 py-2 rounded-xl text-xs font-display font-bold flex items-center justify-center gap-2 transition cursor-pointer z-10 min-w-0 ${
            activeTab === 'persistent' ? 'text-teal-200' : 'text-slate-400 hover:text-white'
          }`}
        >
          {activeTab === 'persistent' && (
            <motion.div
              layoutId="memoryManagerTabPill"
              transition={SPRING_BUBBLY}
              className="absolute inset-0 rounded-xl bg-teal-500/20 border border-teal-400/40 shadow-[0_0_16px_rgba(20,184,166,0.2)] -z-10"
            />
          )}
          <HardDrive className="w-3.5 h-3.5 text-teal-400 shrink-0" />
          <span className="truncate">
            {isBg ? 'Постоянни правила' : 'Persistent Rules'}
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 text-[10px] font-mono shrink-0">
            {persistentRules.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback('selection');
            setActiveTab('session');
          }}
          className={`relative min-h-[42px] px-3 py-2 rounded-xl text-xs font-display font-bold flex items-center justify-center gap-2 transition cursor-pointer z-10 min-w-0 ${
            activeTab === 'session' ? 'text-indigo-200' : 'text-slate-400 hover:text-white'
          }`}
        >
          {activeTab === 'session' && (
            <motion.div
              layoutId="memoryManagerTabPill"
              transition={SPRING_BUBBLY}
              className="absolute inset-0 rounded-xl bg-indigo-500/20 border border-indigo-400/40 shadow-[0_0_16px_rgba(99,102,241,0.2)] -z-10"
            />
          )}
          <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">
            {isBg ? 'Сесийна памет (RAM)' : 'Session Memory (RAM)'}
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-mono shrink-0">
            {sessionRules.length}
          </span>
        </button>
      </div>

      {/* 3. Active Tab Content Panel (Full Width — Zero Horizontal Overflow) */}
      {activeTab === 'persistent' ? (
        <div className="rounded-2xl bg-[#0b1324]/90 border border-teal-500/25 p-4 sm:p-5 space-y-4 w-full min-w-0">
          {/* Header & Storage Badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
              <h3 className="font-bold text-sm text-white truncate">
                {isBg
                  ? 'Постоянни системни правила (Дългосрочна памет)'
                  : 'Persistent System Rules (Long-Term Storage)'}
              </h3>
            </div>
            <span className="text-[10.5px] bg-teal-500/15 text-teal-300 px-2.5 py-0.5 rounded-full border border-teal-500/30 font-mono shrink-0">
              config.json
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            {isBg
              ? 'Записват се постоянно на диска на хоста и се спазват от AI агента при всяко изпълнение на команда, дори след рестарт на компютъра.'
              : 'Saved permanently on the host disk and enforced by the AI agent across every command and system reboot.'}
          </p>

          {/* Add Persistent Rule Input Row (min-w-0 prevents flex overflow) */}
          <form onSubmit={handleAddPersistent} className="flex flex-col sm:flex-row gap-2 w-full min-w-0">
            <input
              type="text"
              value={newPersistentRule}
              onChange={(e) => setNewPersistentRule(e.target.value)}
              placeholder={
                isBg
                  ? 'Въведете ново постоянно правило (напр. Браузър по подразбиране е Brave)...'
                  : 'Enter a new persistent rule (e.g. Default browser is Brave)...'
              }
              className="flex-1 min-w-0 min-h-[44px] bg-[#050914] border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white focus:border-teal-400 focus:outline-none placeholder:text-slate-500"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.96 }}
              transition={SPRING_POP}
              disabled={!newPersistentRule.trim()}
              className="min-h-[44px] px-4 py-2 bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shrink-0 transition cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>{isBg ? 'Добави правило' : 'Add Rule'}</span>
            </motion.button>
          </form>

          {/* Active Persistent Rules List */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
            {persistentRules.length === 0 ? (
              <div className="text-xs text-slate-400 py-6 text-center rounded-xl bg-black/30 border border-dashed border-white/10">
                {isBg
                  ? 'Няма конфигурирани постоянни правила за този хост.'
                  : 'No persistent rules configured for this host.'}
              </div>
            ) : (
              persistentRules.map((rule, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 p-3 bg-[#060b16] border border-white/10 hover:border-teal-500/35 rounded-xl text-xs text-slate-100 transition"
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <span className="w-5 h-5 rounded-lg bg-teal-500/15 border border-teal-500/30 text-teal-300 font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed break-words min-w-0">
                      {localizeRuleText(rule, isBg)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemovePersistent(idx)}
                    className="text-slate-400 hover:text-rose-400 p-2 rounded-lg hover:bg-rose-500/10 transition shrink-0 cursor-pointer"
                    title={isBg ? 'Изтрий правило' : 'Delete rule'}
                    aria-label={isBg ? 'Изтрий правило' : 'Delete rule'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* 1-Tap Quick Rule Templates */}
          <div className="pt-2 border-t border-white/[0.08] space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-teal-300/90">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isBg ? 'Бързи шаблони с 1 клик:' : '1-Tap Quick Rule Templates:'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {persistentPresets.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleAddPresetRule('persistent', preset)}
                  className="text-left px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-teal-500/15 border border-white/10 hover:border-teal-400/40 text-[11px] text-slate-300 hover:text-teal-200 transition cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-3 h-3 text-teal-400 shrink-0" />
                  <span className="line-clamp-1">{preset}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-[#0b1324]/90 border border-indigo-500/25 p-4 sm:p-5 space-y-4 w-full min-w-0">
          {/* Header & RAM Badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2 min-w-0">
              <Cpu className="w-4 h-4 text-indigo-400 shrink-0" />
              <h3 className="font-bold text-sm text-white truncate">
                {isBg
                  ? 'Сесийни инструкции (Временна RAM памет)'
                  : 'Session Instructions (Ephemeral RAM Context)'}
              </h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10.5px] bg-indigo-500/15 text-indigo-300 px-2.5 py-0.5 rounded-full border border-indigo-500/30 font-mono">
                {isBg ? 'Само в RAM' : 'RAM Only'}
              </span>
              {sessionRules.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearSession}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-[11px] font-semibold text-rose-300 flex items-center gap-1 transition cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{isBg ? 'Изчисти RAM' : 'Clear RAM'}</span>
                </button>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            {isBg
              ? 'Временни инструкции, валидни само за текущата работна сесия. Изчистват се автоматично при рестартиране на демона.'
              : 'Temporary instructions active only for the current session. Automatically cleared when the host daemon restarts.'}
          </p>

          {/* Add Session Rule Input Row */}
          <form onSubmit={handleAddSession} className="flex flex-col sm:flex-row gap-2 w-full min-w-0">
            <input
              type="text"
              value={newSessionRule}
              onChange={(e) => setNewSessionRule(e.target.value)}
              placeholder={
                isBg
                  ? 'Нова временна инструкция (напр. Не питай за потвърждение при малки ъпдейти)...'
                  : 'New session instruction (e.g. Do not prompt for minor updates)...'
              }
              className="flex-1 min-w-0 min-h-[44px] bg-[#050914] border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white focus:border-indigo-400 focus:outline-none placeholder:text-slate-500"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.96 }}
              transition={SPRING_POP}
              disabled={!newSessionRule.trim()}
              className="min-h-[44px] px-4 py-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shrink-0 transition cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>{isBg ? 'Запази в RAM' : 'Save to RAM'}</span>
            </motion.button>
          </form>

          {/* Active Session Rules List */}
          <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
            {sessionRules.length === 0 ? (
              <div className="text-xs text-slate-400 py-6 text-center rounded-xl bg-black/30 border border-dashed border-white/10">
                {isBg
                  ? 'Няма активни сесийни инструкции в RAM паметта.'
                  : 'No active session instructions in RAM.'}
              </div>
            ) : (
              sessionRules.map((rule, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 p-3 bg-[#060b16] border border-white/10 hover:border-indigo-500/35 rounded-xl text-xs text-slate-100 transition"
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <span className="w-5 h-5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed break-words min-w-0">
                      {localizeRuleText(rule, isBg)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveSession(idx)}
                    className="text-slate-400 hover:text-rose-400 p-2 rounded-lg hover:bg-rose-500/10 transition shrink-0 cursor-pointer"
                    title={isBg ? 'Изтрий инструкция' : 'Delete instruction'}
                    aria-label={isBg ? 'Изтрий инструкция' : 'Delete instruction'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* 1-Tap Session Templates */}
          <div className="pt-2 border-t border-white/[0.08] space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-indigo-300/90">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isBg ? 'Бързи сесийни шаблони:' : '1-Tap Session Templates:'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sessionPresets.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleAddPresetRule('session', preset)}
                  className="text-left px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-indigo-500/15 border border-white/10 hover:border-indigo-400/40 text-[11px] text-slate-300 hover:text-indigo-200 transition cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-3 h-3 text-indigo-400 shrink-0" />
                  <span className="line-clamp-1">{preset}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

