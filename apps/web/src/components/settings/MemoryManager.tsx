import React, { useState, useEffect, useRef } from 'react';
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
  AlertTriangle,
  Search,
  X,
  Copy,
  Check,
} from 'lucide-react';
import { HostDevice } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';
import { copyToClipboard } from '../../utils/clipboard';
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

const MemoryManagerComponent: React.FC<MemoryManagerProps> = ({
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
  const [ruleSearch, setRuleSearch] = useState('');
  const [confirmClearRam, setConfirmClearRam] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const duplicateTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const onUpdateInstructionsRef = useRef(onUpdateInstructions);
  onUpdateInstructionsRef.current = onUpdateInstructions;

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
      if (duplicateTimerRef.current !== null) {
        window.clearTimeout(duplicateTimerRef.current);
        duplicateTimerRef.current = null;
      }
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedHostId || typeof fetch !== 'function') return;
    const controller = new AbortController();
    setSyncError(null);
    setConfirmClearRam(false);
    fetch(`/api/memory/${encodeURIComponent(selectedHostId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (controller.signal.aborted || !data?.exists) return;
        if (Array.isArray(data.persistent)) {
          onUpdateInstructionsRef.current(selectedHostId, 'persistent', data.persistent);
        }
        if (Array.isArray(data.session)) {
          onUpdateInstructionsRef.current(selectedHostId, 'session', data.session);
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [selectedHostId]);

  const selectedHost = hosts.find((h) => h.id === selectedHostId) || hosts[0];

  const persistentRules = selectedHost?.persistentInstructions || [];
  const sessionRules = selectedHost?.sessionInstructions || [];

  const triggerFeedback = () => {
    setSavedFeedback(true);
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setSavedFeedback(false);
    }, 2200);
  };

  const showDuplicateNotice = (msg: string) => {
    setDuplicateNotice(msg);
    if (duplicateTimerRef.current !== null) {
      window.clearTimeout(duplicateTimerRef.current);
    }
    duplicateTimerRef.current = window.setTimeout(() => {
      duplicateTimerRef.current = null;
      setDuplicateNotice(null);
    }, 2400);
  };

  const handleCopyText = (key: string, text: string) => {
    if (!text) return;
    triggerHapticFeedback('light');
    copyToClipboard(text);
    setCopiedKey(key);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopiedKey(null);
    }, 1800);
  };

  const hasMatchingRule = (list: string[], candidate: string) => {
    const norm = candidate.trim().toLowerCase();
    return list.some(
      (r) =>
        r.trim().toLowerCase() === norm ||
        localizeRuleText(r, isBg).trim().toLowerCase() === norm
    );
  };

  const persistMemoryUpdate = async (
    hostId: string,
    type: 'persistent' | 'session',
    instructions: string[]
  ) => {
    onUpdateInstructions(hostId, type, instructions);
    triggerFeedback();
    setSyncError(null);

    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(hostId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, instructions }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSyncError(
          data.error ||
            (isBg
              ? `Неуспешна синхронизация на паметта (HTTP ${res.status}).`
              : `Failed to sync host memory (HTTP ${res.status}).`)
        );
      }
    } catch {
      setSyncError(
        isBg
          ? 'Контролният сървър е недостъпен — промените са запазени локално.'
          : 'Control server unavailable — changes saved locally only.'
      );
    }
  };

  const handleAddPersistent = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newPersistentRule.trim();
    if (!cleaned || !selectedHost) return;
    if (hasMatchingRule(persistentRules, cleaned)) {
      triggerHapticFeedback('warning');
      showDuplicateNotice(
        isBg ? 'Това постоянно правило вече съществува.' : 'This persistent rule already exists.'
      );
      return;
    }
    triggerHapticFeedback('medium');
    const updated = [...persistentRules, cleaned];
    setNewPersistentRule('');
    setDuplicateNotice(null);
    void persistMemoryUpdate(selectedHost.id, 'persistent', updated);
  };

  const handleAddPresetRule = (type: 'persistent' | 'session', text: string) => {
    if (!selectedHost) return;
    const currentList = type === 'persistent' ? persistentRules : sessionRules;
    if (hasMatchingRule(currentList, text)) {
      showDuplicateNotice(
        isBg ? 'Шаблонът вече е добавен за този хост.' : 'Template is already active for this host.'
      );
      return;
    }
    triggerHapticFeedback('light');
    setDuplicateNotice(null);
    void persistMemoryUpdate(selectedHost.id, type, [...currentList, text]);
  };

  const handleRemovePersistent = (index: number) => {
    if (!selectedHost) return;
    triggerHapticFeedback('light');
    const updated = persistentRules.filter((_, i) => i !== index);
    void persistMemoryUpdate(selectedHost.id, 'persistent', updated);
  };

  const handleAddSession = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newSessionRule.trim();
    if (!cleaned || !selectedHost) return;
    if (hasMatchingRule(sessionRules, cleaned)) {
      triggerHapticFeedback('warning');
      showDuplicateNotice(
        isBg ? 'Тази сесийна инструкция вече е в RAM.' : 'This session instruction is already in RAM.'
      );
      return;
    }
    triggerHapticFeedback('medium');
    const updated = [...sessionRules, cleaned];
    setNewSessionRule('');
    setDuplicateNotice(null);
    void persistMemoryUpdate(selectedHost.id, 'session', updated);
  };

  const handleRemoveSession = (index: number) => {
    if (!selectedHost) return;
    triggerHapticFeedback('light');
    const updated = sessionRules.filter((_, i) => i !== index);
    void persistMemoryUpdate(selectedHost.id, 'session', updated);
  };

  const handleClearSession = () => {
    if (!selectedHost) return;
    triggerHapticFeedback('medium');
    void persistMemoryUpdate(selectedHost.id, 'session', []);
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

  const ruleQ = ruleSearch.trim().toLowerCase();
  const filteredPersistent = persistentRules
    .map((rule, origIdx) => ({ rule, origIdx, localized: localizeRuleText(rule, isBg) }))
    .filter((item) => !ruleQ || item.localized.toLowerCase().includes(ruleQ));
  const filteredSession = sessionRules
    .map((rule, origIdx) => ({ rule, origIdx, localized: localizeRuleText(rule, isBg) }))
    .filter((item) => !ruleQ || item.localized.toLowerCase().includes(ruleQ));

  return (
    <div className="space-y-4 w-full min-w-0">
      {/* 1. Target Host Selector Card */}
      <div className="p-3.5 rounded-[24px] glass-liquid-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 squircle-badge squircle-hero flex items-center justify-center shrink-0">
            <Monitor className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold ink-muted">
              {isBg ? 'Целеви компютър за правилата' : 'Target Host for Rules'}
            </div>
            <div className="text-xs font-display font-bold ink-primary truncate flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  selectedHost?.isOnline ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="truncate">
                {selectedHost?.name ||
                  selectedHostId ||
                  (isBg ? 'Няма свързан компютър' : 'No Host Connected')}
              </span>
              {selectedHost?.ip && (
                <span className="ink-muted font-mono text-[11px]">({selectedHost.ip})</span>
              )}
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
            className="w-full truncate rounded-full liquid-control-pill px-3.5 py-2 min-h-[40px] text-xs ink-primary font-mono font-semibold focus:border-cyan-400 focus:outline-none cursor-pointer"
          >
            {hosts.length === 0 ? (
              <option value="" disabled>
                {isBg ? 'Няма регистрирани устройства' : 'No registered devices'}
              </option>
            ) : (
              hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.ip})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Sync / Duplicate / Error Toast Banners */}
      <AnimatePresence>
        {savedFeedback && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="p-3 bg-emerald-500/14 border border-emerald-500/35 rounded-2xl text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {isBg
                ? `Правилата за ${selectedHost?.name} са синхронизирани успешно!`
                : `Memory rules for ${selectedHost?.name} synchronized successfully!`}
            </span>
          </motion.div>
        )}
        {duplicateNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="p-3 bg-amber-500/14 border border-amber-500/35 rounded-2xl text-amber-700 dark:text-amber-300 text-xs font-medium flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{duplicateNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setDuplicateNotice(null)}
              className="p-1 ink-muted hover:ink-primary cursor-pointer"
              aria-label={isBg ? 'Затвори' : 'Dismiss'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
        {syncError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="p-3 bg-amber-500/14 border border-amber-500/35 rounded-2xl text-amber-700 dark:text-amber-400 text-xs font-medium flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{syncError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSyncError(null)}
              className="p-1 ink-muted hover:ink-primary cursor-pointer"
              aria-label={isBg ? 'Затвори' : 'Dismiss'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Sliding Full-Capsule Tab Switcher + Live Rule Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-full glass-liquid-subtle flex-1">
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('selection');
              setActiveTab('persistent');
            }}
            className={`relative min-h-[38px] px-3 py-1.5 rounded-full text-xs font-display font-bold flex items-center justify-center gap-1.5 transition cursor-pointer z-10 min-w-0 ${
              activeTab === 'persistent' ? 'preserve-white' : 'ink-secondary hover:ink-primary'
            }`}
          >
            {activeTab === 'persistent' && (
              <motion.div
                layoutId="memoryManagerTabPill"
                transition={SPRING_BUBBLY}
                className="absolute inset-0 rounded-full liquid-hero-btn -z-10"
              />
            )}
            <HardDrive className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{isBg ? 'Постоянни' : 'Persistent'}</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono shrink-0 ${
                activeTab === 'persistent'
                  ? 'bg-white/25 text-white'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {persistentRules.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('selection');
              setActiveTab('session');
            }}
            className={`relative min-h-[38px] px-3 py-1.5 rounded-full text-xs font-display font-bold flex items-center justify-center gap-1.5 transition cursor-pointer z-10 min-w-0 ${
              activeTab === 'session' ? 'preserve-white' : 'ink-secondary hover:ink-primary'
            }`}
          >
            {activeTab === 'session' && (
              <motion.div
                layoutId="memoryManagerTabPill"
                transition={SPRING_BUBBLY}
                className="absolute inset-0 rounded-full liquid-hero-btn -z-10"
              />
            )}
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{isBg ? 'Сесийна (RAM)' : 'Session (RAM)'}</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono shrink-0 ${
                activeTab === 'session'
                  ? 'bg-white/25 text-white'
                  : 'bg-violet-500/15 text-violet-300'
              }`}
            >
              {sessionRules.length}
            </span>
          </button>
        </div>

        <div className="relative sm:w-52 shrink-0">
          <Search className="w-3.5 h-3.5 text-cyan-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
          <input
            type="text"
            value={ruleSearch}
            onChange={(e) => setRuleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && ruleSearch) {
                e.stopPropagation();
                setRuleSearch('');
              }
            }}
            placeholder={isBg ? 'Филтрирай правила...' : 'Filter rules...'}
            className="w-full h-10 pl-9 pr-8 rounded-full glass-liquid-subtle text-xs ink-primary placeholder:text-[var(--ink-secondary)] placeholder:opacity-80 focus:border-cyan-400 focus:outline-none"
          />
          {ruleSearch && (
            <button
              type="button"
              onClick={() => setRuleSearch('')}
              aria-label={isBg ? 'Изчисти филтъра' : 'Clear filter'}
              className="absolute right-3 top-1/2 -translate-y-1/2 ink-muted hover:ink-primary cursor-pointer z-10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 3. Active Tab Content Panel */}
      {activeTab === 'persistent' ? (
        <div className="rounded-[24px] glass-liquid-subtle p-4 sm:p-5 space-y-4 w-full min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--surface-border-subtle)]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 squircle-badge squircle-emerald flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <h3 className="font-display font-bold text-sm ink-primary truncate">
                {isBg
                  ? 'Постоянни системни правила'
                  : 'Persistent System Rules'}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {persistentRules.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText(
                      'all-persistent',
                      persistentRules.map((r, i) => `${i + 1}. ${localizeRuleText(r, isBg)}`).join('\n')
                    )
                  }
                  className="px-2.5 py-1 rounded-full liquid-control-pill text-[11px] font-semibold ink-secondary hover:ink-primary flex items-center gap-1 cursor-pointer"
                  title={isBg ? 'Копирай всички правила' : 'Copy all rules'}
                >
                  {copiedKey === 'all-persistent' ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>
                    {copiedKey === 'all-persistent'
                      ? isBg
                        ? 'Копирани'
                        : 'Copied'
                      : isBg
                      ? 'Копирай всички'
                      : 'Copy All'}
                  </span>
                </button>
              )}
              <span className="text-[10.5px] bg-emerald-500/14 text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-500/35 font-mono font-bold shrink-0">
                config.json
              </span>
            </div>
          </div>

          <p className="text-xs ink-secondary leading-relaxed">
            {isBg
              ? 'Записват се постоянно на диска на хоста и се спазват от AI агента при всяко изпълнение на команда, дори след рестарт.'
              : 'Saved permanently on the host disk and enforced by the AI agent across every command and reboot.'}
          </p>

          <form
            onSubmit={handleAddPersistent}
            className="flex flex-col sm:flex-row gap-2 w-full min-w-0"
          >
            <input
              type="text"
              value={newPersistentRule}
              onChange={(e) => {
                setNewPersistentRule(e.target.value);
                if (duplicateNotice) setDuplicateNotice(null);
              }}
              placeholder={
                isBg
                  ? 'Ново постоянно правило (напр. Браузър по подразбиране е Brave)...'
                  : 'New persistent rule (e.g. Default browser is Brave)...'
              }
              className="flex-1 min-w-0 min-h-[42px] liquid-terminal-entry rounded-full px-4 py-2 text-xs ink-primary focus:border-cyan-400 focus:outline-none placeholder:text-[var(--ink-secondary)] placeholder:opacity-80"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.94 }}
              transition={SPRING_POP}
              disabled={!newPersistentRule.trim()}
              className="min-h-[42px] px-4 py-2 liquid-hero-btn disabled:opacity-40 font-bold rounded-full text-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>{isBg ? 'Добави' : 'Add Rule'}</span>
            </motion.button>
          </form>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5 bouncy-scroll">
            {filteredPersistent.length === 0 ? (
              <div className="text-xs ink-muted py-6 px-4 text-center rounded-2xl liquid-terminal-entry border border-dashed border-[var(--surface-border-subtle)] space-y-2">
                <div>
                  {ruleQ
                    ? isBg
                      ? 'Няма съвпадащи правила.'
                      : 'No rules match your filter.'
                    : isBg
                    ? 'Няма конфигурирани постоянни правила за този хост.'
                    : 'No persistent rules configured for this host yet.'}
                </div>
                {ruleQ && (
                  <button
                    type="button"
                    onClick={() => setRuleSearch('')}
                    className="px-3 py-1 rounded-full liquid-control-pill text-[11px] font-semibold ink-primary cursor-pointer"
                  >
                    {isBg ? 'Изчисти филтъра' : 'Reset Filter'}
                  </button>
                )}
              </div>
            ) : (
              filteredPersistent.map(({ origIdx, localized }) => {
                const rowCopyKey = `p-${origIdx}`;
                return (
                  <div
                    key={origIdx}
                    className="flex items-center justify-between gap-2.5 p-3 liquid-terminal-entry rounded-2xl text-xs ink-primary transition"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {origIdx + 1}
                      </span>
                      <span className="leading-relaxed break-words min-w-0">{localized}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyText(rowCopyKey, localized)}
                        className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center ink-secondary hover:ink-primary shrink-0 cursor-pointer"
                        title={isBg ? 'Копирай правило' : 'Copy rule'}
                        aria-label={isBg ? 'Копирай правило' : 'Copy rule'}
                      >
                        {copiedKey === rowCopyKey ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemovePersistent(origIdx)}
                        className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center text-rose-400 shrink-0 cursor-pointer"
                        title={isBg ? 'Изтрий правило' : 'Delete rule'}
                        aria-label={isBg ? 'Изтрий правило' : 'Delete rule'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 1-Tap Quick Rule Templates */}
          <div className="pt-3 border-t border-[var(--surface-border-subtle)] space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-display font-bold text-emerald-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isBg ? 'Бързи шаблони с 1 клик:' : '1-Tap Quick Rule Templates:'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {persistentPresets.map((preset, idx) => {
                const isAdded = hasMatchingRule(persistentRules, preset);
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isAdded}
                    onClick={() => handleAddPresetRule('persistent', preset)}
                    className={`text-left px-3 py-1.5 rounded-full text-[11px] transition flex items-center gap-1.5 ${
                      isAdded
                        ? 'bg-emerald-500/14 border border-emerald-500/35 text-emerald-600 dark:text-emerald-300 opacity-80 cursor-default'
                        : 'liquid-control-pill ink-primary cursor-pointer'
                    }`}
                  >
                    {isAdded ? (
                      <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                    ) : (
                      <Plus className="w-3 h-3 text-emerald-400 shrink-0" />
                    )}
                    <span className="line-clamp-1">{preset}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] glass-liquid-subtle p-4 sm:p-5 space-y-4 w-full min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--surface-border-subtle)]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 squircle-badge squircle-violet flex items-center justify-center shrink-0">
                <Cpu className="w-4 h-4" />
              </div>
              <h3 className="font-display font-bold text-sm ink-primary truncate">
                {isBg ? 'Сесийни инструкции (RAM)' : 'Session Instructions (RAM)'}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              {sessionRules.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText(
                      'all-session',
                      sessionRules.map((r, i) => `${i + 1}. ${localizeRuleText(r, isBg)}`).join('\n')
                    )
                  }
                  className="px-2.5 py-1 rounded-full liquid-control-pill text-[11px] font-semibold ink-secondary hover:ink-primary flex items-center gap-1 cursor-pointer"
                  title={isBg ? 'Копирай всички инструкции' : 'Copy all instructions'}
                >
                  {copiedKey === 'all-session' ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>
                    {copiedKey === 'all-session'
                      ? isBg
                        ? 'Копирани'
                        : 'Copied'
                      : isBg
                      ? 'Копирай всички'
                      : 'Copy All'}
                  </span>
                </button>
              )}
              <span className="text-[10.5px] bg-violet-500/14 text-violet-300 px-2.5 py-0.5 rounded-full border border-violet-400/35 font-mono font-bold">
                {isBg ? 'Само в RAM' : 'RAM Only'}
              </span>
              {sessionRules.length > 0 &&
                (confirmClearRam ? (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/35">
                    <button
                      type="button"
                      onClick={() => {
                        handleClearSession();
                        setConfirmClearRam(false);
                      }}
                      className="px-2 py-0.5 rounded-full squircle-rose preserve-white text-[10.5px] font-bold cursor-pointer"
                    >
                      {isBg ? 'Потвърди' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearRam(false)}
                      className="p-0.5 ink-secondary cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearRam(true)}
                    className="px-2.5 py-1 rounded-full bg-rose-500/12 hover:bg-rose-500/20 border border-rose-500/30 text-[11px] font-semibold text-rose-400 flex items-center gap-1 transition cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{isBg ? 'Изчисти RAM' : 'Clear RAM'}</span>
                  </button>
                ))}
            </div>
          </div>

          <p className="text-xs ink-secondary leading-relaxed">
            {isBg
              ? 'Временни инструкции, валидни само за текущата работна сесия. Изчистват се автоматично при рестарт на демона.'
              : 'Temporary instructions active only for the current session. Automatically cleared when the host daemon restarts.'}
          </p>

          <form
            onSubmit={handleAddSession}
            className="flex flex-col sm:flex-row gap-2 w-full min-w-0"
          >
            <input
              type="text"
              value={newSessionRule}
              onChange={(e) => {
                setNewSessionRule(e.target.value);
                if (duplicateNotice) setDuplicateNotice(null);
              }}
              placeholder={
                isBg
                  ? 'Нова временна инструкция (напр. Не питай за потвърждение при малки ъпдейти)...'
                  : 'New session instruction (e.g. Do not prompt for minor updates)...'
              }
              className="flex-1 min-w-0 min-h-[42px] liquid-terminal-entry rounded-full px-4 py-2 text-xs ink-primary focus:border-cyan-400 focus:outline-none placeholder:text-[var(--ink-secondary)] placeholder:opacity-80"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.94 }}
              transition={SPRING_POP}
              disabled={!newSessionRule.trim()}
              className="min-h-[42px] px-4 py-2 liquid-hero-btn disabled:opacity-40 font-bold rounded-full text-xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>{isBg ? 'Запази в RAM' : 'Save to RAM'}</span>
            </motion.button>
          </form>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5 bouncy-scroll">
            {filteredSession.length === 0 ? (
              <div className="text-xs ink-muted py-6 px-4 text-center rounded-2xl liquid-terminal-entry border border-dashed border-[var(--surface-border-subtle)] space-y-2">
                <div>
                  {ruleQ
                    ? isBg
                      ? 'Няма съвпадащи инструкции.'
                      : 'No instructions match your filter.'
                    : isBg
                    ? 'Няма активни сесийни инструкции в RAM паметта.'
                    : 'No active session instructions in RAM.'}
                </div>
                {ruleQ && (
                  <button
                    type="button"
                    onClick={() => setRuleSearch('')}
                    className="px-3 py-1 rounded-full liquid-control-pill text-[11px] font-semibold ink-primary cursor-pointer"
                  >
                    {isBg ? 'Изчисти филтъра' : 'Reset Filter'}
                  </button>
                )}
              </div>
            ) : (
              filteredSession.map(({ origIdx, localized }) => {
                const rowCopyKey = `s-${origIdx}`;
                return (
                  <div
                    key={origIdx}
                    className="flex items-center justify-between gap-2.5 p-3 liquid-terminal-entry rounded-2xl text-xs ink-primary transition"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <span className="w-5 h-5 rounded-full bg-violet-500/15 border border-violet-400/35 text-violet-300 font-mono text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {origIdx + 1}
                      </span>
                      <span className="leading-relaxed break-words min-w-0">{localized}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyText(rowCopyKey, localized)}
                        className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center ink-secondary hover:ink-primary shrink-0 cursor-pointer"
                        title={isBg ? 'Копирай инструкция' : 'Copy instruction'}
                        aria-label={isBg ? 'Копирай инструкция' : 'Copy instruction'}
                      >
                        {copiedKey === rowCopyKey ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveSession(origIdx)}
                        className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center text-rose-400 shrink-0 cursor-pointer"
                        title={isBg ? 'Изтрий инструкция' : 'Delete instruction'}
                        aria-label={isBg ? 'Изтрий инструкция' : 'Delete instruction'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="pt-3 border-t border-[var(--surface-border-subtle)] space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-display font-bold text-violet-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isBg ? 'Бързи сесийни шаблони:' : '1-Tap Session Templates:'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sessionPresets.map((preset, idx) => {
                const isAdded = hasMatchingRule(sessionRules, preset);
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isAdded}
                    onClick={() => handleAddPresetRule('session', preset)}
                    className={`text-left px-3 py-1.5 rounded-full text-[11px] transition flex items-center gap-1.5 ${
                      isAdded
                        ? 'bg-violet-500/14 border border-violet-400/35 text-violet-600 dark:text-violet-300 opacity-80 cursor-default'
                        : 'liquid-control-pill ink-primary cursor-pointer'
                    }`}
                  >
                    {isAdded ? (
                      <Check className="w-3 h-3 text-violet-400 shrink-0" />
                    ) : (
                      <Plus className="w-3 h-3 text-violet-300 shrink-0" />
                    )}
                    <span className="line-clamp-1">{preset}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const MemoryManager = React.memo(MemoryManagerComponent);

