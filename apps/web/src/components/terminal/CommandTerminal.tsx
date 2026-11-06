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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HostDevice, AgentExecutionResponse } from '../../types';
import { GlassContainer } from '../ui/GlassContainer';
import { triggerHapticFeedback } from '../../services/hapticService';
import { copyToClipboard } from '../../utils/clipboard';
import { useTranslation } from '../../i18n/useTranslation';
import { SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';

interface CommandTerminalProps {
  hosts: HostDevice[];
  selectedTarget: string;
  onSelectTarget: (targetId: string) => void;
  onSendCommand: (command: any) => void;
  isExecuting: boolean;
  lastExecutionResult?: AgentExecutionResponse | null;
  onViewScreen: (device: HostDevice) => void;
  screenBase64: string | null;
  onRefreshScreen: (hostId: string) => void;
  isCapturingScreen: boolean;
}

interface TerminalHistoryEntry extends AgentExecutionResponse {
  id: string;
  commandPrompt?: string;
  exitCode?: number;
}

const PINNED_COMMANDS_KEY = 'cst_pinned_terminal_commands_v1';

const CommandTerminalComponent: React.FC<CommandTerminalProps> = ({
  hosts,
  selectedTarget,
  onSelectTarget,
  onSendCommand,
  isExecuting,
  lastExecutionResult,
  onViewScreen,
}) => {
  const { t, language } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number>(-1);
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

  const lastSubmittedPromptRef = useRef<string>('');
  const lastProcessedKeyRef = useRef<string>('');
  const logScrollRef = useRef<HTMLDivElement>(null);

  const selectedHost = hosts.find((h) => h.id === selectedTarget) || hosts[0] || null;

  useEffect(() => {
    if (!lastExecutionResult) return;
    const dedupKey = `${lastExecutionResult.command_id || ''}-${lastExecutionResult.timestamp || ''}-${lastExecutionResult.output?.length || 0}`;
    if (dedupKey && dedupKey !== lastProcessedKeyRef.current) {
      lastProcessedKeyRef.current = dedupKey;
      const resolvedExitCode =
        typeof (lastExecutionResult as any).exit_code === 'number'
          ? (lastExecutionResult as any).exit_code
          : lastExecutionResult.status === 'error'
          ? 1
          : 0;
      setExecutionLogs((prev) => [
        ...prev.slice(-24),
        {
          ...lastExecutionResult,
          id: `${lastExecutionResult.command_id || lastExecutionResult.timestamp}-${prev.length}`,
          commandPrompt: lastSubmittedPromptRef.current || undefined,
          exitCode: resolvedExitCode,
        },
      ]);
    }
  }, [lastExecutionResult]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      logScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 80);
    return () => clearTimeout(timeoutId);
  }, [executionLogs.length, isExecuting]);

  const localizedPresets = useMemo(
    () => [
      {
        id: 'updates',
        label: language === 'bg' ? 'Провери обновления' : 'Check Updates',
        icon: RefreshCw,
        colorClass: 'border-emerald-400/35 hover:border-emerald-400/70 text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.22)]',
        iconColor: 'text-emerald-400',
        prompt:
          language === 'bg'
            ? 'Провери за системни обновления на Windows и инсталирани пакети'
            : 'Check for pending OS system updates and installed packages',
      },
      {
        id: 'restart',
        label: language === 'bg' ? 'Рестартирай хоста' : 'Restart Host',
        icon: RotateCcw,
        colorClass: 'border-amber-400/35 hover:border-amber-400/70 text-amber-300 shadow-[0_0_16px_rgba(255,183,3,0.22)]',
        iconColor: 'text-amber-400',
        prompt:
          language === 'bg'
            ? 'Планирай безопасен рестарт на работната станция след 30 секунди'
            : 'Schedule a safe workstation restart in 30 seconds',
      },
      {
        id: 'browser',
        label: language === 'bg' ? 'Отвори браузър' : 'Open Browser',
        icon: Globe,
        colorClass: 'border-sky-400/35 hover:border-sky-400/70 text-sky-300 shadow-[0_0_16px_rgba(56,189,248,0.22)]',
        iconColor: 'text-sky-400',
        prompt:
          language === 'bg'
            ? 'Отвори системния браузър с таблото за мониторинг'
            : 'Open default system browser to network status dashboard',
      },
      {
        id: 'stats',
        label: language === 'bg' ? 'CPU и RAM Статистика' : 'CPU & RAM Stats',
        icon: Activity,
        colorClass: 'border-violet-400/35 hover:border-violet-400/70 text-violet-300 shadow-[0_0_16px_rgba(139,92,246,0.22)]',
        iconColor: 'text-violet-400',
        prompt:
          language === 'bg'
            ? 'Покажи топ 10 процеса по натоварване на CPU и RAM памет'
            : 'List top 10 processes sorted by CPU and RAM utilization',
      },
    ],
    [language]
  );

  const dispatchPrompt = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isExecuting) return;

    triggerHapticFeedback('medium');
    lastSubmittedPromptRef.current = trimmed;
    setCommandHistory((prev) => {
      const deduped = prev.filter((item) => item !== trimmed);
      return [...deduped.slice(-29), trimmed];
    });
    setHistoryCursor(-1);

    onSendCommand({
      target_id: selectedTarget || selectedHost?.id || '',
      command_type: 'natural_language',
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
    if (e.key === 'ArrowUp' && commandHistory.length > 0) {
      e.preventDefault();
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
        setPrompt('');
      } else {
        const nextIdx = historyCursor + 1;
        setHistoryCursor(nextIdx);
        setPrompt(commandHistory[nextIdx]);
      }
    }
  };

  const handleCopyOutput = (id: string, text: string) => {
    triggerHapticFeedback('light');
    copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const handleClearConsole = () => {
    triggerHapticFeedback('light');
    setExecutionLogs([]);
  };

  return (
    <div className="w-full max-w-5xl 2xl:max-w-7xl mx-auto flex-1 flex flex-col justify-between select-none relative pb-1">
      {/* 1. Header & Flush Target Selector Pills with Horizontal Scroll Fade Mask */}
      <div className="py-1.5 flex items-center justify-between gap-2 mb-3 max-w-full overflow-hidden">
        <div className="flex items-center space-x-2 overflow-x-auto scrollbar-none flex-1 min-w-0 pr-4 py-1 [mask-image:linear-gradient(to_right,black_90%,transparent_100%)]">
          {hosts.length === 0 ? (
            <span className="text-xs font-mono text-slate-400 py-1.5 px-3 rounded-full bg-white/5 border border-white/10">
              {language === 'bg' ? 'Няма добавени хостове' : 'No hosts registered'}
            </span>
          ) : (
            hosts.map((h) => {
            const isSelected = h.id === selectedTarget;
            return (
              <motion.button
                key={h.id}
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.93 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('selection');
                  onSelectTarget(h.id);
                }}
                className={`relative min-h-[44px] px-3.5 py-1.5 rounded-full text-xs font-mono transition-colors flex items-center space-x-2 shrink-0 overflow-hidden cursor-pointer border z-10 transform-gpu ${
                  isSelected
                    ? 'border-cyan-400/50 text-cyan-200 font-bold shadow-[0_0_16px_rgba(56,189,248,0.25)]'
                    : 'bg-[#070c18]/90 border-white/12 text-white/65 hover:text-white hover:border-white/25'
                }`}
              >
                {isSelected && (
                  <motion.div
                    layoutId="terminalTargetPill"
                    className="absolute inset-0 rounded-full bg-cyan-500/20 -z-10 transform-gpu"
                    transition={SPRING_BUBBLY}
                  />
                )}
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    h.isOnline ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-white/30'
                  }`}
                />
                <span className="whitespace-nowrap">{h.name}</span>
              </motion.button>
            );
          }))}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Command History Drawer Toggle */}
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              setIsHistoryDrawerOpen((prev) => !prev);
            }}
            className={`min-h-[44px] px-3 py-1.5 rounded-full border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              isHistoryDrawerOpen
                ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                : 'bg-[#070c18]/90 border-white/15 text-white/70 hover:text-white'
            }`}
            title={language === 'bg' ? 'История на командите' : 'Command History'}
          >
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">{language === 'bg' ? 'История' : 'History'}</span>
            {executionLogs.length > 0 && (
              <span className="text-[10px] font-mono text-cyan-300/90">({executionLogs.length})</span>
            )}
          </button>

          {executionLogs.length > 0 && (
            <button
              type="button"
              onClick={handleClearConsole}
              className="min-h-[44px] px-3 py-1.5 rounded-full bg-[#070c18]/90 border border-white/12 hover:border-rose-400/35 text-white/55 hover:text-rose-300 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
              title={language === 'bg' ? 'Изчисти конзолата' : 'Clear console output'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{language === 'bg' ? 'Изчисти' : 'Clear'}</span>
            </button>
          )}

          {selectedHost && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.05, y: -1.5 }}
              whileTap={{ scale: 0.92 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                onViewScreen(selectedHost);
              }}
              className="min-h-[44px] px-3.5 py-1.5 rounded-full bg-[#070c18]/90 backdrop-blur-3xl border border-white/15 border-t-white/25 hover:border-cyan-400/40 text-cyan-300 text-xs font-medium flex items-center space-x-1.5 shrink-0 transition cursor-pointer shadow-[0_16px_40px_rgba(0,0,0,0.8)] transform-gpu"
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('term_view_screen')}</span>
            </motion.button>
          )}
        </div>
      </div>

      {/* Collapsible Command History & Pinned Commands Drawer */}
      <AnimatePresence>
        {isHistoryDrawerOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.12 } }}
            transition={SPRING_BUBBLY}
            className="overflow-hidden mb-3 transform-gpu"
          >
            <div className="p-3.5 rounded-2xl bg-[#091020]/96 backdrop-blur-3xl border border-white/15 border-t-white/25 shadow-[0_24px_64px_rgba(0,0,0,0.9)] space-y-2.5">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    {language === 'bg'
                      ? 'Последни изпълнения и Закачени команди'
                      : 'Recent Executions & Pinned Commands'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsHistoryDrawerOpen(false)}
                  className="text-white/50 hover:text-white p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {executionLogs.length === 0 ? (
                <div className="text-xs text-white/45 py-2 font-mono">
                  {language === 'bg'
                    ? 'Все още няма изпълнени команди в тази сесия.'
                    : 'No commands executed in this session yet.'}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {executionLogs
                    .slice()
                    .reverse()
                    .map((item) => {
                      const cmdText = item.commandPrompt || item.output.split('\n')[0];
                      const isPinned = pinnedCommands.includes(cmdText);
                      return (
                        <div
                          key={`hist-${item.id}`}
                          className="px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-2 text-xs font-mono"
                        >
                          <button
                            type="button"
                            onClick={() => dispatchPrompt(cmdText)}
                            className="text-left text-cyan-200 hover:text-white truncate flex-1 cursor-pointer"
                          >
                            $ {cmdText}
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300">
                              {item.execution_time_ms}ms • Exit {item.exitCode ?? 0}
                            </span>
                            <button
                              type="button"
                              onClick={() => togglePinCommand(cmdText)}
                              className={`p-1 rounded hover:bg-white/10 transition cursor-pointer ${
                                isPinned ? 'text-amber-300' : 'text-white/40 hover:text-white'
                              }`}
                              title={
                                isPinned
                                  ? language === 'bg'
                                    ? 'Откачи командата'
                                    : 'Unpin command'
                                  : language === 'bg'
                                  ? 'Закачи към бързите бутони'
                                  : 'Pin to quick bar'
                              }
                            >
                              <Star className={`w-3.5 h-3.5 ${isPinned ? 'fill-amber-400 text-amber-400' : ''}`} />
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

      {/* 2. Main Terminal Output Surface (Tier 1 Resting Card) */}
      <GlassContainer className="flex-1 p-4 sm:p-5 flex flex-col justify-between min-h-[220px] sm:min-h-[360px] mb-3 overflow-hidden">
        {/* Terminal Header */}
        <div className="flex items-center justify-between gap-2 pb-3 text-xs text-white/50 border-b border-white/[0.08] overflow-hidden">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="font-semibold text-white truncate">{t('term_agent_context')}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {commandHistory.length > 0 && (
              <span className="hidden md:inline text-[10px] font-mono text-white/35">
                {language === 'bg' ? '↑/↓ история' : '↑/↓ history'}
              </span>
            )}
            <span className="font-mono text-[11px] text-cyan-300/80 pl-1 tabular-nums">
              {selectedHost ? `${selectedHost.ip}:${selectedHost.port || 8765}` : (language === 'bg' ? 'Няма хост' : 'No Host')}
            </span>
          </div>
        </div>

        {/* Scrollable Command Output */}
        <div className="flex-1 min-h-[160px] max-h-[52dvh] py-4 font-mono text-xs leading-relaxed space-y-3 overflow-y-auto scrollbar-thin">
          {selectedHost ? (
            <div className="text-white/50">
              {t('term_connected_to', {
                name: selectedHost.name,
                os: selectedHost.os || 'Windows 11',
              })}
            </div>
          ) : (
            <div className="text-amber-300/80 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs font-mono">
              {language === 'bg'
                ? 'Няма свързан компютър във флота. Моля, добавете компютър от таб „Флот“, за да изпращате команди.'
                : 'No computer registered in the fleet yet. Please add a PC from the "Fleet" tab to execute commands.'}
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {executionLogs.map((entry) => {
              const isPinned = entry.commandPrompt ? pinnedCommands.includes(entry.commandPrompt) : false;
              const isError =
                entry.status === 'failed' ||
                entry.status === 'rejected' ||
                (entry.exitCode !== undefined && entry.exitCode !== 0);
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                  className={`p-3.5 rounded-2xl bg-[#070c18]/90 border space-y-2 ${
                    isError ? 'border-rose-500/35' : 'border-cyan-400/25'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-white/50 tabular-nums border-b border-white/[0.06] pb-1.5">
                    {isError ? (
                      <span className="text-rose-400 flex items-center gap-1.5 font-semibold truncate">
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {language === 'bg'
                            ? `Неуспешно (${entry.execution_time_ms}ms)`
                            : `Failed (${entry.execution_time_ms}ms)`}{' '}
                          • Exit {entry.exitCode ?? -1}
                        </span>
                      </span>
                    ) : (
                      <span className="text-emerald-400 flex items-center gap-1.5 font-semibold truncate">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {t('term_exec_success', { time: entry.execution_time_ms })} • Exit {entry.exitCode ?? 0}
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
                              isPinned ? 'text-amber-300' : 'text-white/50 hover:text-amber-300'
                            }`}
                            title={language === 'bg' ? 'Закачи команда' : 'Pin command'}
                          >
                            <Star className={`w-3 h-3 ${isPinned ? 'fill-amber-400 text-amber-400' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => dispatchPrompt(entry.commandPrompt!)}
                            disabled={isExecuting}
                            className="text-white/50 hover:text-cyan-300 transition flex items-center gap-1 cursor-pointer disabled:opacity-40"
                            title={language === 'bg' ? 'Изпълни отново' : 'Re-run command'}
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopyOutput(entry.id, entry.output)}
                        className="text-white/50 hover:text-cyan-300 transition flex items-center gap-1 cursor-pointer"
                        title={language === 'bg' ? 'Копирай изхода' : 'Copy output'}
                      >
                        {copiedId === entry.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                      <span className="text-white/45">{entry.timestamp}</span>
                    </div>
                  </div>

                  {entry.commandPrompt && (
                    <div className="text-[11px] text-cyan-300/85 font-semibold truncate">
                      $ {entry.commandPrompt}
                    </div>
                  )}

                  <pre className="text-white/95 text-xs whitespace-pre-wrap break-words overflow-x-auto max-w-full font-mono select-text">
                    {entry.output}
                  </pre>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {isExecuting && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center space-x-2 text-cyan-300"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{t('term_executing')}</span>
            </motion.div>
          )}

          <div ref={logScrollRef} />
        </div>
      </GlassContainer>

      {/* 3. Bottom-Anchored Compact Horizontal Preset Chip Strip + Tier 2 Input Bar */}
      <div className="w-full space-y-2 pt-1">
        {/* Compact Horizontally Scrollable Preset & Pinned Chip Strip (Zero Truncation) */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 px-0.5 [mask-image:linear-gradient(to_right,black_92%,transparent_100%)]">
          {pinnedCommands.map((pinned, idx) => (
            <motion.div
              key={`pin-${idx}`}
              whileHover={{ y: -1.5 }}
              whileTap={{ scale: 0.95 }}
              className="min-h-[40px] pl-3 pr-2 rounded-full bg-amber-500/15 border border-amber-400/40 text-xs font-semibold text-amber-200 whitespace-nowrap shrink-0 flex items-center gap-1.5 shadow-[0_8px_20px_rgba(0,0,0,0.45)]"
            >
              <button
                type="button"
                disabled={isExecuting}
                onClick={() => dispatchPrompt(pinned)}
                className="flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                <span className="max-w-[180px] truncate">{pinned}</span>
              </button>
              <button
                type="button"
                onClick={() => togglePinCommand(pinned)}
                className="p-0.5 rounded-full hover:bg-white/10 text-amber-300/70 hover:text-white cursor-pointer"
                title={language === 'bg' ? 'Премахни' : 'Unpin'}
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          ))}

          {localizedPresets.map((preset) => {
            const PresetIcon = preset.icon || Sparkles;
            return (
              <motion.button
                key={preset.id}
                type="button"
                whileHover={{ y: -2, scale: 1.03 }}
                whileTap={{ scale: 0.93 }}
                transition={SPRING_POP}
                disabled={isExecuting}
                onClick={() => dispatchPrompt(preset.prompt)}
                className={`group min-h-[40px] px-3.5 rounded-full bg-[#081124]/90 backdrop-blur-2xl border text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40 transform-gpu bubble-tap ${preset.colorClass}`}
              >
                <PresetIcon className={`w-3.5 h-3.5 shrink-0 icon-bubbly ${preset.iconColor}`} />
                <span className="font-display">{preset.label}</span>
              </motion.button>
            );
          })}
        </div>

        {/* Tier 2 Liquid Glass Prompt Input Capsule */}
        <form onSubmit={handleSubmit} className="w-full relative">
          <div className="group min-h-[54px] h-14 rounded-full bg-[#081024]/95 backdrop-blur-2xl border border-white/18 border-t-cyan-400/45 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_24px_rgba(0,240,255,0.12)] px-4 flex items-center space-x-2.5 focus-within:border-cyan-400/70 focus-within:shadow-[0_20px_50px_rgba(0,0,0,0.9),0_0_32px_rgba(0,240,255,0.25)] transition transform-gpu">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 icon-sparkle-live" />
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('term_prompt_placeholder')}
              disabled={isExecuting}
              className="flex-1 bg-transparent border-none outline-none text-xs sm:text-sm text-white placeholder-white/40 disabled:opacity-50 min-w-0"
            />
            {prompt.trim() && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.2, rotate: 15 }}
                whileTap={{ scale: 0.88 }}
                transition={SPRING_POP}
                onClick={() => togglePinCommand(prompt)}
                className={`p-2 rounded-full transition cursor-pointer shrink-0 transform-gpu ${
                  pinnedCommands.includes(prompt.trim())
                    ? 'text-amber-300'
                    : 'text-white/40 hover:text-amber-300'
                }`}
                title={language === 'bg' ? 'Закачи командата' : 'Pin command to bar'}
              >
                <Star
                  className={`w-4 h-4 ${
                    pinnedCommands.includes(prompt.trim()) ? 'fill-amber-400 text-amber-400' : ''
                  }`}
                />
              </motion.button>
            )}
            <motion.button
              type="submit"
              whileHover={{ scale: 1.08, y: -1.5 }}
              whileTap={{ scale: 0.89 }}
              transition={SPRING_POP}
              disabled={!prompt.trim() || isExecuting}
              className="group min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-gradient-to-r from-cyan-400 to-sky-400 disabled:opacity-35 text-slate-950 flex items-center justify-center transition shadow-[0_0_16px_rgba(56,189,248,0.45)] shrink-0 cursor-pointer transform-gpu"
              aria-label={t('term_send_btn')}
            >
              {isExecuting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-5 h-5 stroke-[2.5] icon-bubbly" />
              )}
            </motion.button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const CommandTerminal = React.memo(CommandTerminalComponent);
