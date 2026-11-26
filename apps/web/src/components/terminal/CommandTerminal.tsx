import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Terminal,
  Sparkles,
  ArrowUp,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Eye,
  Copy,
  Check,
  Trash2,
  RotateCcw,
  Star,
  Clock,
  X,
  Activity,
  Globe,
  Download,
  Search,
  CornerDownLeft,
  Cpu,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HostDevice, AgentExecutionResponse } from '../../types';
import { GlassContainer } from '../ui/GlassContainer';
import { triggerHapticFeedback } from '../../services/hapticService';
import { copyToClipboard } from '../../utils/clipboard';
import { useTranslation } from '../../i18n/useTranslation';
import { useScreenStore } from '../../store/screenStore';
import { ThemeQuickControls } from '../ui/ThemeQuickControls';
import { SPRING_POP } from '../../utils/springPhysics';

interface CommandTerminalProps {
  hosts: HostDevice[];
  selectedTarget: string;
  onSelectTarget: (targetId: string) => void;
  onSendCommand: (command: any) => void;
  isExecuting: boolean;
  lastExecutionResult?: AgentExecutionResponse | null;
  onViewScreen: (device: HostDevice) => void;
  screenBase64?: string | null;
  onRefreshScreen: (hostId: string) => void;
  isCapturingScreen: boolean;
}

interface TerminalHistoryEntry extends AgentExecutionResponse {
  id: string;
  commandPrompt?: string;
  exitCode?: number;
}

const PINNED_COMMANDS_KEY = 'ai_pinned_terminal_commands_v1';
const COMMAND_HISTORY_KEY = 'ai_terminal_cmd_history_v1';

const CommandTerminalComponent: React.FC<CommandTerminalProps> = ({
  hosts,
  selectedTarget,
  onSelectTarget,
  onSendCommand,
  isExecuting,
  lastExecutionResult,
  onViewScreen,
  screenBase64: propScreenBase64,
  onRefreshScreen,
  isCapturingScreen,
}) => {
  const storeScreenBase64 = useScreenStore((s) => s.screenBase64);
  const screenBase64 = propScreenBase64 ?? storeScreenBase64;
  const { t, language } = useTranslation();
  const isBg = language === 'bg';
  const [prompt, setPrompt] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(COMMAND_HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string').slice(-50);
      }
    } catch {}
    return [];
  });
  const [historyCursor, setHistoryCursor] = useState<number>(-1);
  const [historySearch, setHistorySearch] = useState('');
  const [executionLogs, setExecutionLogs] = useState<TerminalHistoryEntry[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);

  const [pinnedCommands, setPinnedCommands] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(PINNED_COMMANDS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const togglePinCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    triggerHapticFeedback('selection');
    setPinnedCommands((prev) => {
      const next = prev.includes(trimmed)
        ? prev.filter((item) => item !== trimmed)
        : [...prev, trimmed];
      try {
        localStorage.setItem(PINNED_COMMANDS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const pendingCommandsRef = useRef<Map<string, string>>(new Map());
  const lastResultRef = useRef<AgentExecutionResponse | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftPromptRef = useRef<string>('');

  const selectedHost = hosts.find((h) => h.id === selectedTarget) || hosts[0] || null;

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!lastExecutionResult || lastExecutionResult === lastResultRef.current) return;
    lastResultRef.current = lastExecutionResult;

    const cmdId = lastExecutionResult.command_id || '';
    const matchedPrompt = cmdId ? pendingCommandsRef.current.get(cmdId) : undefined;
    if (cmdId) {
      pendingCommandsRef.current.delete(cmdId);
    }

    const resolvedExitCode =
      typeof (lastExecutionResult as any).exit_code === 'number'
        ? (lastExecutionResult as any).exit_code
        : lastExecutionResult.status === 'error'
        ? 1
        : 0;
    setExecutionLogs((prev) => [
      ...prev.slice(-39),
      {
        ...lastExecutionResult,
        id: `${cmdId || Date.now()}-${prev.length}`,
        commandPrompt: matchedPrompt,
        exitCode: resolvedExitCode,
      },
    ]);
  }, [lastExecutionResult]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const el = outputContainerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }, 60);
    return () => clearTimeout(timeoutId);
  }, [executionLogs.length, isExecuting]);

  const localizedPresets = useMemo(
    () => [
      {
        id: 'updates',
        label: isBg ? 'Обновления' : 'Check Updates',
        icon: RefreshCw,
        iconColor: 'text-emerald-400',
        commandType: 'system_command' as const,
        prompt:
          selectedHost?.os === 'linux'
            ? 'apt list --upgradable'
            : 'winget upgrade --include-unknown',
      },
      {
        id: 'sysinfo',
        label: isBg ? 'Системно инфо' : 'System Info',
        icon: Activity,
        iconColor: 'text-violet-400',
        commandType: 'system_command' as const,
        prompt: selectedHost?.os === 'linux' ? 'uname -a && uptime' : 'systeminfo',
      },
      {
        id: 'network',
        label: isBg ? 'Мрежов статус' : 'Network Config',
        icon: Globe,
        iconColor: 'text-sky-400',
        commandType: 'system_command' as const,
        prompt: selectedHost?.os === 'linux' ? 'ip -brief addr show' : 'ipconfig /all',
      },
      {
        id: 'processes',
        label: isBg ? 'Топ процеси' : 'Top Processes',
        icon: Cpu,
        iconColor: 'text-cyan-400',
        commandType: 'system_command' as const,
        prompt:
          selectedHost?.os === 'linux'
            ? 'ps aux --sort=-%cpu | head -n 15'
            : 'tasklist /fo table',
      },
      {
        id: 'restart',
        label: isBg ? 'Рестартирай' : 'Restart Host',
        icon: RotateCcw,
        iconColor: 'text-amber-400',
        commandType: 'system_command' as const,
        prompt:
          selectedHost?.os === 'linux'
            ? 'sudo shutdown -r +1 "Scheduled maintenance restart"'
            : 'shutdown /r /t 30 /c "Scheduled maintenance restart"',
      },
    ],
    [isBg, selectedHost?.os]
  );

  const dispatchPrompt = (
    text: string,
    commandTypeOverride?: 'natural_language' | 'system_command'
  ) => {
    const trimmed = text.trim();
    if (!trimmed || isExecuting) return;

    const commandId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    pendingCommandsRef.current.set(commandId, trimmed);
    if (pendingCommandsRef.current.size > 50) {
      const oldest = pendingCommandsRef.current.keys().next().value;
      if (oldest) pendingCommandsRef.current.delete(oldest);
    }

    const inferredType: 'natural_language' | 'system_command' =
      commandTypeOverride ||
      (/^(?:ipconfig|ifconfig|systeminfo|whoami|hostname|dir|ls|pwd|uname|uptime|ps|tasklist|netstat|ss|df|free|ping|tracert|traceroute|winget|apt|systemctl|loginctl|shutdown|wmic)\b/i.test(
        trimmed
      )
        ? 'system_command'
        : 'natural_language');

    triggerHapticFeedback('medium');
    setCommandHistory((prev) => {
      const deduped = prev.filter((item) => item !== trimmed);
      const next = [...deduped.slice(-49), trimmed];
      try {
        localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    setHistoryCursor(-1);
    draftPromptRef.current = '';

    onSendCommand({
      command_id: commandId,
      target_id: selectedTarget || selectedHost?.id || '',
      command_type: inferredType,
      prompt: trimmed,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isExecuting) return;
    dispatchPrompt(prompt);
    setPrompt('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      handleClearConsole();
      return;
    }
    if (e.key === 'Escape') {
      if (prompt) {
        e.preventDefault();
        setPrompt('');
        setHistoryCursor(-1);
        draftPromptRef.current = '';
      } else if (isHistoryDrawerOpen) {
        e.preventDefault();
        setIsHistoryDrawerOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowUp' && commandHistory.length > 0) {
      e.preventDefault();
      if (historyCursor === -1) {
        draftPromptRef.current = prompt;
      }
      const nextIdx =
        historyCursor === -1
          ? commandHistory.length - 1
          : Math.max(0, historyCursor - 1);
      setHistoryCursor(nextIdx);
      setPrompt(commandHistory[nextIdx]);
    } else if (e.key === 'ArrowDown' && historyCursor !== -1) {
      e.preventDefault();
      if (historyCursor >= commandHistory.length - 1) {
        setHistoryCursor(-1);
        setPrompt(draftPromptRef.current);
      } else {
        const nextIdx = historyCursor + 1;
        setHistoryCursor(nextIdx);
        setPrompt(commandHistory[nextIdx]);
      }
    }
  };

  const handleCopyText = (id: string, text: string) => {
    triggerHapticFeedback('light');
    copyToClipboard(text);
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1600);
  };

  const handleLoadIntoPrompt = (cmd: string) => {
    triggerHapticFeedback('selection');
    setPrompt(cmd);
    setHistoryCursor(-1);
    inputRef.current?.focus();
  };

  const handleExportLogs = () => {
    if (executionLogs.length === 0 || typeof document === 'undefined') return;
    triggerHapticFeedback('light');
    const hostLabel = selectedHost ? `${selectedHost.name} (${selectedHost.ip})` : 'fleet';
    const content = [
      `AI NetController Terminal Transcript — ${hostLabel}`,
      `Exported: ${new Date().toISOString()}`,
      '='.repeat(64),
      ...executionLogs.map(
        (entry) =>
          `\n[${entry.timestamp}] (${entry.status} · Exit ${entry.exitCode ?? 0} · ${entry.execution_time_ms ?? 0}ms)\n` +
          (entry.commandPrompt ? `$ ${entry.commandPrompt}\n` : '') +
          `${entry.output || ''}\n`
      ),
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `ainet-terminal-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleClearConsole = () => {
    triggerHapticFeedback('light');
    setExecutionLogs([]);
  };

  const filteredHistoryEntries = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    const reversedLogs = executionLogs.slice().reverse();
    if (!q) return reversedLogs;
    return reversedLogs.filter((item) => {
      const cmdText = (item.commandPrompt || (item.output ?? '').split('\n')[0] || '').toLowerCase();
      return cmdText.includes(q) || (item.output ?? '').toLowerCase().includes(q);
    });
  }, [executionLogs, historySearch]);

  const filteredPastCommands = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    const reversed = commandHistory.slice().reverse();
    if (!q) return reversed.slice(0, 15);
    return reversed.filter((cmd) => cmd.toLowerCase().includes(q)).slice(0, 15);
  }, [commandHistory, historySearch]);

  const historyBadgeCount = executionLogs.length || commandHistory.length;

  return (
    <div className="w-full max-w-5xl 2xl:max-w-7xl mx-auto flex-1 flex flex-col justify-between select-none relative pb-1 gap-3">
      {/* 1. Detached Floating Liquid Glass Host Selector & Action Capsule */}
      <header className="glass-liquid-elevated liquid-capsule-refract rounded-[28px] px-3.5 py-2.5 flex items-center justify-between gap-2 max-w-full flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 min-w-0 py-0.5">
          {hosts.length === 0 ? (
            <span className="text-xs font-mono ink-muted py-1.5 px-3.5 rounded-full liquid-control-pill">
              {isBg ? 'Няма добавени хостове' : 'No hosts registered'}
            </span>
          ) : (
            hosts.map((h) => {
              const isSelected = h.id === selectedTarget;
              return (
                <motion.button
                  key={h.id}
                  type="button"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.92 }}
                  transition={SPRING_POP}
                  onClick={() => {
                    triggerHapticFeedback('selection');
                    onSelectTarget(h.id);
                    inputRef.current?.focus();
                  }}
                  className={`h-9 px-3.5 rounded-full text-xs font-mono transition flex items-center gap-2 shrink-0 cursor-pointer ${
                    isSelected
                      ? 'liquid-hero-btn font-bold'
                      : 'liquid-control-pill ink-secondary hover:ink-primary'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      h.isOnline
                        ? isSelected
                          ? 'bg-emerald-200'
                          : 'bg-emerald-500'
                        : 'bg-amber-400'
                    }`}
                  />
                  <span className="whitespace-nowrap">{h.name}</span>
                </motion.button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <ThemeQuickControls showAccentDots={false} compact />

          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.91 }}
            transition={SPRING_POP}
            onClick={() => {
              triggerHapticFeedback('light');
              setIsHistoryDrawerOpen((prev) => !prev);
            }}
            className={`h-9 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              isHistoryDrawerOpen
                ? 'liquid-hero-btn'
                : 'liquid-control-pill'
            }`}
            title={isBg ? 'История на командите' : 'Command History'}
          >
            <Clock className={`w-3.5 h-3.5 ${isHistoryDrawerOpen ? 'text-white' : 'text-cyan-400'}`} />
            <span className="hidden sm:inline">
              {isBg ? 'История' : 'History'}
            </span>
            {historyBadgeCount > 0 && (
              <span className="text-[10px] font-mono opacity-85 tabular-nums">
                ({historyBadgeCount})
              </span>
            )}
          </motion.button>

          {executionLogs.length > 0 && (
            <>
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.91 }}
                transition={SPRING_POP}
                onClick={handleExportLogs}
                className="h-9 px-3 rounded-full liquid-control-pill ink-secondary hover:ink-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                title={isBg ? 'Експортирай изхода (.txt)' : 'Export session output (.txt)'}
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden md:inline">{isBg ? 'Експорт' : 'Export'}</span>
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.91 }}
                transition={SPRING_POP}
                onClick={handleClearConsole}
                className="h-9 px-3 rounded-full liquid-control-pill hover:border-rose-400/45 ink-secondary hover:text-rose-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                title={isBg ? 'Изчисти конзолата (Ctrl+L)' : 'Clear console output (Ctrl+L)'}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {isBg ? 'Изчисти' : 'Clear'}
                </span>
              </motion.button>
            </>
          )}

          {selectedHost && (
            <>
              {onRefreshScreen && (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.91 }}
                  transition={SPRING_POP}
                  disabled={isCapturingScreen}
                  onClick={() => {
                    triggerHapticFeedback('light');
                    onRefreshScreen(selectedHost.id);
                  }}
                  className="h-9 px-3 rounded-full liquid-control-pill text-xs font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                  title={isBg ? 'Заснеми екран' : 'Capture Frame'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isCapturingScreen ? 'animate-spin' : ''}`} />
                  <span className="hidden md:inline">
                    {isBg ? 'Кадър' : 'Frame'}
                  </span>
                </motion.button>
              )}
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.91 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  onViewScreen(selectedHost);
                }}
                className="h-9 px-3 rounded-full squircle-sky preserve-white text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                title={t('term_view_screen')}
              >
                <Eye className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('term_view_screen')}</span>
              </motion.button>
            </>
          )}
        </div>
      </header>

      {/* Collapsible Command History & Pinned Commands Drawer */}
      <AnimatePresence>
        {isHistoryDrawerOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="p-3.5 rounded-[24px] glass-liquid space-y-2.5">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 flex-wrap">
                <span className="text-xs font-display font-bold text-cyan-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {isBg
                      ? 'Последни и закачени команди'
                      : 'Recent & Saved Command History'}
                  </span>
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <div className="relative w-44 sm:w-56">
                    <Search className="w-3.5 h-3.5 text-[var(--theme-accent)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder={isBg ? 'Филтрирай история...' : 'Filter history...'}
                      className="w-full h-8 pl-8 pr-7 rounded-full liquid-terminal-entry text-[11px] ink-primary placeholder:opacity-65 focus:outline-none focus:border-cyan-400"
                    />
                    {historySearch && (
                      <button
                        type="button"
                        onClick={() => setHistorySearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 ink-muted hover:ink-primary z-10 cursor-pointer"
                        aria-label="Clear filter"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsHistoryDrawerOpen(false)}
                    className="w-7 h-7 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
                    aria-label={isBg ? 'Затвори' : 'Close'}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {filteredHistoryEntries.length === 0 && filteredPastCommands.length === 0 ? (
                <div className="text-xs ink-muted py-2 font-mono">
                  {historySearch.trim()
                    ? isBg
                      ? 'Няма съвпадащи команди в историята.'
                      : 'No commands match your filter.'
                    : isBg
                    ? 'Все още няма изпълнени команди.'
                    : 'No commands executed yet.'}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto bouncy-scroll pr-1">
                  {filteredHistoryEntries.length > 0
                    ? filteredHistoryEntries.map((item) => {
                        const cmdText =
                          item.commandPrompt || (item.output ?? '').split('\n')[0];
                        const isPinned = pinnedCommands.includes(cmdText);
                        return (
                          <div
                            key={`hist-${item.id}`}
                            className="px-3 py-1.5 rounded-2xl liquid-terminal-entry flex items-center justify-between gap-2 text-xs font-mono"
                          >
                            <button
                              type="button"
                              onClick={() => dispatchPrompt(cmdText)}
                              className="text-left text-cyan-400 hover:underline truncate flex-1 font-semibold cursor-pointer"
                              title={isBg ? 'Кликни за директно изпълнение' : 'Click to run immediately'}
                            >
                              $ {cmdText}
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 tabular-nums">
                                {item.execution_time_ms}ms
                              </span>
                              <button
                                type="button"
                                onClick={() => handleLoadIntoPrompt(cmdText)}
                                className="p-1 rounded-full ink-muted hover:text-cyan-400 transition cursor-pointer"
                                title={isBg ? 'Зареди в полето за редакция' : 'Load into prompt'}
                              >
                                <CornerDownLeft className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => togglePinCommand(cmdText)}
                                className={`p-1 rounded-full transition cursor-pointer ${
                                  isPinned
                                    ? 'text-amber-500'
                                    : 'ink-muted hover:text-amber-500'
                                }`}
                                title={isBg ? 'Закачи команда' : 'Pin command'}
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${
                                    isPinned ? 'fill-amber-400 text-amber-400' : ''
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    : filteredPastCommands.map((cmdText, idx) => {
                        const isPinned = pinnedCommands.includes(cmdText);
                        return (
                          <div
                            key={`saved-${idx}`}
                            className="px-3 py-1.5 rounded-2xl liquid-terminal-entry flex items-center justify-between gap-2 text-xs font-mono"
                          >
                            <button
                              type="button"
                              onClick={() => dispatchPrompt(cmdText)}
                              className="text-left text-cyan-400 hover:underline truncate flex-1 font-semibold cursor-pointer"
                            >
                              $ {cmdText}
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleLoadIntoPrompt(cmdText)}
                                className="p-1 rounded-full ink-muted hover:text-cyan-400 transition cursor-pointer"
                                title={isBg ? 'Зареди в полето' : 'Load into prompt'}
                              >
                                <CornerDownLeft className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => togglePinCommand(cmdText)}
                                className={`p-1 rounded-full transition cursor-pointer ${
                                  isPinned
                                    ? 'text-amber-500'
                                    : 'ink-muted hover:text-amber-500'
                                }`}
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${
                                    isPinned ? 'fill-amber-400 text-amber-400' : ''
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Full Bright Daylight / Vibrant Dark Adaptive Liquid Glass Terminal Canvas */}
      <GlassContainer className="flex-1 p-4 sm:p-5 flex flex-col justify-between min-h-[240px] sm:min-h-[360px] overflow-hidden liquid-terminal-pane">
        <div className="flex items-center justify-between gap-2 pb-3 text-xs border-b border-white/[0.08] overflow-hidden">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 squircle-badge squircle-hero flex items-center justify-center shrink-0">
              <Terminal className="w-4 h-4" />
            </div>
            <span className="font-display font-bold ink-primary truncate">
              {t('term_agent_context')}
            </span>
          </div>
          {selectedHost ? (
            <button
              type="button"
              onClick={() =>
                handleCopyText(
                  'host-endpoint',
                  `${selectedHost.ip}:${selectedHost.port || 8765}`
                )
              }
              className="px-2.5 py-1 rounded-full liquid-control-pill font-mono text-[11px] font-semibold text-cyan-400 tabular-nums shrink-0 flex items-center gap-1.5 cursor-pointer"
              title={isBg ? 'Копирай IP:Порт' : 'Copy host IP:Port'}
            >
              <span>
                {selectedHost.ip}:{selectedHost.port || 8765}
              </span>
              {copiedId === 'host-endpoint' ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 opacity-75" />
              )}
            </button>
          ) : (
            <span className="px-2.5 py-1 rounded-full liquid-control-pill font-mono text-[11px] font-semibold ink-muted shrink-0">
              {isBg ? 'Няма хост' : 'No Host'}
            </span>
          )}
        </div>

        {screenBase64 && selectedHost && (
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              onViewScreen(selectedHost);
            }}
            className="mt-3 flex items-center gap-3 p-2.5 rounded-2xl liquid-terminal-entry hover:border-cyan-400/50 transition text-left w-full group cursor-pointer"
          >
            <img
              src={screenBase64}
              alt={`${selectedHost.name} screen`}
              className="w-20 h-12 object-cover rounded-xl border border-white/20 shrink-0 shadow-sm"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-display font-bold text-cyan-400 truncate">
                {isBg ? `Последен кадър · ${selectedHost.name}` : `Latest Frame · ${selectedHost.name}`}
              </div>
              <div className="text-[10.5px] font-mono ink-muted truncate">
                {isBg ? 'Натисни за пълен интерактивен екран' : 'Click to open interactive screen viewer'}
              </div>
            </div>
          </button>
        )}

        {/* Scrollable Command Output (Full Bright Daylight Frosted Glass + Crisp Dark Ink) */}
        <div
          ref={outputContainerRef}
          className="flex-1 min-h-[160px] max-h-[54dvh] py-3.5 font-mono text-xs leading-relaxed space-y-3 overflow-y-auto bouncy-scroll"
        >
          {selectedHost ? (
            selectedHost.isOnline ? (
              <div className="ink-muted flex items-center gap-2 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                <span>
                  {isBg
                    ? `Целеви хост: ${selectedHost.name} (${selectedHost.os === 'linux' ? 'Linux' : 'Windows'}) · Готов за изпращане на команди.`
                    : `Target host: ${selectedHost.name} (${selectedHost.os === 'linux' ? 'Linux' : 'Windows'}) · Ready to dispatch commands.`}
                </span>
              </div>
            ) : (
              <div className="text-amber-400 p-3 rounded-2xl bg-amber-500/12 border border-amber-500/30 text-xs font-mono font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                <span>
                  {isBg
                    ? `${selectedHost.name} е в режим на готовност / офлайн. Събудете го чрез WoL или свържете Host Agent преди изпълнение на команди.`
                    : `${selectedHost.name} is sleeping / offline. Wake via WoL or connect Host Agent before executing commands.`}
                </span>
              </div>
            )
          ) : (
            <div className="text-amber-400 p-3.5 rounded-2xl bg-amber-500/12 border border-amber-500/30 text-xs font-mono font-medium">
              {isBg
                ? 'Няма избран компютър. Добавете компютър от таб „Устройства“, за да изпращате команди.'
                : 'No computer selected. Add a PC from the "Devices" tab to execute commands.'}
            </div>
          )}

          {executionLogs.map((entry) => {
            const isPinned = entry.commandPrompt
              ? pinnedCommands.includes(entry.commandPrompt)
              : false;
            const isError =
              entry.status === 'failed' ||
              entry.status === 'rejected' ||
              entry.status === 'error' ||
              (entry.exitCode !== undefined && entry.exitCode !== 0);
            return (
              <div
                key={entry.id}
                className={`p-3.5 rounded-2xl liquid-terminal-entry space-y-2 ${
                  isError ? 'border-rose-500/40' : 'border-cyan-400/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] ink-muted tabular-nums border-b border-white/[0.08] pb-2">
                  {isError ? (
                    <span className="px-2 py-0.5 rounded-full bg-rose-500/14 border border-rose-500/30 text-rose-400 flex items-center gap-1.5 font-bold truncate">
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isBg
                          ? `Грешка (${entry.execution_time_ms ?? 0}ms)`
                          : `Failed (${entry.execution_time_ms ?? 0}ms)`}{' '}
                        • Exit {entry.exitCode ?? -1}
                      </span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/14 border border-emerald-500/30 text-emerald-400 flex items-center gap-1.5 font-bold truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {t('term_exec_success', { time: entry.execution_time_ms ?? 0 })} • Exit{' '}
                        {entry.exitCode ?? 0}
                      </span>
                    </span>
                  )}

                  <div className="flex items-center gap-2 shrink-0">
                    {entry.commandPrompt && (
                      <>
                        <button
                          type="button"
                          onClick={() => togglePinCommand(entry.commandPrompt!)}
                          className={`transition flex items-center gap-1 cursor-pointer ${
                            isPinned
                              ? 'text-amber-500'
                              : 'ink-muted hover:text-amber-500'
                          }`}
                          title={isBg ? 'Закачи команда' : 'Pin command'}
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              isPinned ? 'fill-amber-400 text-amber-400' : ''
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => dispatchPrompt(entry.commandPrompt!)}
                          disabled={isExecuting}
                          className="ink-muted hover:text-cyan-400 transition flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                          title={isBg ? 'Изпълни отново' : 'Re-run command'}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopyText(`out-${entry.id}`, entry.output ?? '')}
                      className="ink-muted hover:text-cyan-400 transition flex items-center gap-1 cursor-pointer"
                      title={isBg ? 'Копирай изхода' : 'Copy output'}
                    >
                      {copiedId === `out-${entry.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <span className="opacity-65">{entry.timestamp}</span>
                  </div>
                </div>

                {entry.commandPrompt && (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleLoadIntoPrompt(entry.commandPrompt!)}
                      className="text-[11.5px] text-cyan-400 font-bold truncate text-left hover:underline cursor-pointer"
                      title={isBg ? 'Кликни за зареждане в командния ред' : 'Click to load into command input'}
                    >
                      $ {entry.commandPrompt}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyText(`cmd-${entry.id}`, entry.commandPrompt!)}
                      className="text-[10px] font-mono ink-muted hover:text-cyan-400 flex items-center gap-1 shrink-0 cursor-pointer"
                      title={isBg ? 'Копирай командата' : 'Copy command'}
                    >
                      {copiedId === `cmd-${entry.id}` ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">{isBg ? 'Копирано' : 'Copied'}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span className="hidden sm:inline">{isBg ? 'Команда' : 'Cmd'}</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                <pre className="ink-primary text-xs whitespace-pre-wrap break-words overflow-x-auto max-w-full font-mono select-text">
                  {entry.output}
                </pre>
              </div>
            );
          })}

          {isExecuting && (
            <div className="flex items-center gap-2 text-cyan-400 font-semibold py-1">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{t('term_executing')}</span>
            </div>
          )}
        </div>
      </GlassContainer>

      {/* 3. Glossy Preset Pills + Floating Capsule Command Composer */}
      <div className="w-full space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {pinnedCommands.map((pinned, idx) => (
            <div
              key={`pin-${idx}`}
              className="h-8.5 pl-3 pr-1.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-xs font-bold text-amber-400 whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <button
                type="button"
                disabled={isExecuting}
                onClick={() => dispatchPrompt(pinned)}
                className="flex items-center gap-1 disabled:opacity-40 cursor-pointer"
              >
                <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                <span className="max-w-[160px] truncate">{pinned}</span>
              </button>
              <button
                type="button"
                onClick={() => togglePinCommand(pinned)}
                className="p-0.5 rounded-full hover:bg-amber-500/20 cursor-pointer"
                title={isBg ? 'Премахни' : 'Unpin'}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {localizedPresets.map((preset) => {
            const PresetIcon = preset.icon || Sparkles;
            return (
              <motion.button
                key={preset.id}
                type="button"
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.91 }}
                transition={SPRING_POP}
                disabled={isExecuting}
                onClick={() => dispatchPrompt(preset.prompt, preset.commandType)}
                className="h-8.5 px-3.5 rounded-full liquid-control-pill text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                title={preset.prompt}
              >
                <PresetIcon className={`w-3.5 h-3.5 shrink-0 ${preset.iconColor}`} />
                <span className="font-display">{preset.label}</span>
              </motion.button>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} className="w-full relative space-y-1">
          <div className="h-13 rounded-full glass-liquid-elevated px-4 flex items-center gap-2.5 focus-within:border-cyan-400/70 transition">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (historyCursor !== -1) setHistoryCursor(-1);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder={t('term_prompt_placeholder')}
              disabled={isExecuting}
              className="flex-1 bg-transparent border-none outline-none text-xs sm:text-sm ink-primary placeholder:text-[var(--ink-secondary)] placeholder:opacity-80 disabled:opacity-50 min-w-0 font-medium"
            />
            {prompt.trim() && (
              <button
                type="button"
                onClick={() => togglePinCommand(prompt)}
                className={`p-1.5 rounded-full transition shrink-0 cursor-pointer ${
                  pinnedCommands.includes(prompt.trim())
                    ? 'text-amber-500'
                    : 'ink-muted hover:text-amber-500'
                }`}
                title={isBg ? 'Закачи командата' : 'Pin command'}
              >
                <Star
                  className={`w-4 h-4 ${
                    pinnedCommands.includes(prompt.trim()) ? 'fill-amber-400 text-amber-400' : ''
                  }`}
                />
              </button>
            )}
            <motion.button
              type="submit"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.88 }}
              transition={SPRING_POP}
              disabled={!prompt.trim() || isExecuting}
              className="w-9 h-9 rounded-full liquid-hero-btn disabled:opacity-35 flex items-center justify-center shrink-0 cursor-pointer"
              aria-label={t('term_send_btn')}
            >
              {isExecuting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4 stroke-[2.6]" />
              )}
            </motion.button>
          </div>
          <div className="hidden sm:flex items-center justify-between px-4 text-[10.5px] font-mono ink-muted opacity-80">
            <span>
              {isBg
                ? '↑↓ История (запазва черновата) · Ctrl+L Изчисти · Esc Нулирай'
                : '↑↓ History (keeps draft) · Ctrl+L Clear · Esc Reset'}
            </span>
            <span>
              {commandHistory.length > 0
                ? isBg
                  ? `${commandHistory.length} записани команди`
                  : `${commandHistory.length} saved commands`
                : isBg
                ? 'Shell или естествен език'
                : 'Shell or Natural Language'}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
};

export const CommandTerminal = React.memo(CommandTerminalComponent);
