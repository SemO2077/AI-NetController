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

const PINNED_COMMANDS_KEY = 'ai_pinned_terminal_commands_v1';

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
    }, 60);
    return () => clearTimeout(timeoutId);
  }, [executionLogs.length, isExecuting]);

  const localizedPresets = useMemo(
    () => [
      {
        id: 'updates',
        label: language === 'bg' ? 'Обновления' : 'Check Updates',
        icon: RefreshCw,
        colorClass: 'border-emerald-400/35 hover:border-emerald-400/60 text-emerald-200',
        iconColor: 'text-emerald-400',
        prompt:
          language === 'bg'
            ? 'Провери за системни обновления и инсталирани пакети'
            : 'Check for pending OS system updates and installed packages',
      },
      {
        id: 'stats',
        label: language === 'bg' ? 'CPU и RAM' : 'CPU & RAM Stats',
        icon: Activity,
        colorClass: 'border-violet-400/35 hover:border-violet-400/60 text-violet-200',
        iconColor: 'text-violet-400',
        prompt:
          language === 'bg'
            ? 'Покажи топ 10 процеса по натоварване на CPU и RAM памет'
            : 'List top 10 processes sorted by CPU and RAM utilization',
      },
      {
        id: 'browser',
        label: language === 'bg' ? 'Отвори браузър' : 'Open Browser',
        icon: Globe,
        colorClass: 'border-sky-400/35 hover:border-sky-400/60 text-sky-200',
        iconColor: 'text-sky-400',
        prompt:
          language === 'bg'
            ? 'Отвори системния браузър с таблото за мониторинг'
            : 'Open default system browser to network status dashboard',
      },
      {
        id: 'restart',
        label: language === 'bg' ? 'Рестартирай' : 'Restart Host',
        icon: RotateCcw,
        colorClass: 'border-amber-400/35 hover:border-amber-400/60 text-amber-200',
        iconColor: 'text-amber-400',
        prompt:
          language === 'bg'
            ? 'Планирай безопасен рестарт на работната станция след 30 секунди'
            : 'Schedule a safe workstation restart in 30 seconds',
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
      {/* 1. Target Host Selector Bar */}
      <div className="py-1 flex items-center justify-between gap-2 mb-2.5 max-w-full overflow-hidden">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 min-w-0 py-0.5">
          {hosts.length === 0 ? (
            <span className="text-xs font-mono text-slate-400 py-1.5 px-3 rounded-xl bg-[#0b1326] border border-white/10">
              {language === 'bg' ? 'Няма добавени хостове' : 'No hosts registered'}
            </span>
          ) : (
            hosts.map((h) => {
              const isSelected = h.id === selectedTarget;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('selection');
                    onSelectTarget(h.id);
                  }}
                  className={`h-9 px-3 rounded-xl text-xs font-mono transition flex items-center gap-2 shrink-0 border active:scale-95 ${
                    isSelected
                      ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200 font-bold'
                      : 'bg-[#0b1326] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      h.isOnline ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  <span className="whitespace-nowrap">{h.name}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              setIsHistoryDrawerOpen((prev) => !prev);
            }}
            className={`h-9 px-2.5 sm:px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition active:scale-95 ${
              isHistoryDrawerOpen
                ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200'
                : 'bg-[#0b1326] border-white/10 text-slate-300 hover:text-white'
            }`}
            title={language === 'bg' ? 'История на командите' : 'Command History'}
          >
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">
              {language === 'bg' ? 'История' : 'History'}
            </span>
            {executionLogs.length > 0 && (
              <span className="text-[10px] font-mono text-cyan-300">
                ({executionLogs.length})
              </span>
            )}
          </button>

          {executionLogs.length > 0 && (
            <button
              type="button"
              onClick={handleClearConsole}
              className="h-9 px-2.5 sm:px-3 rounded-xl bg-[#0b1326] border border-white/10 hover:border-rose-400/35 text-slate-400 hover:text-rose-300 text-xs font-medium flex items-center gap-1.5 transition active:scale-95"
              title={language === 'bg' ? 'Изчисти конзолата' : 'Clear console output'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {language === 'bg' ? 'Изчисти' : 'Clear'}
              </span>
            </button>
          )}

          {selectedHost && (
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                onViewScreen(selectedHost);
              }}
              className="h-9 px-2.5 sm:px-3 rounded-xl bg-[#0b1326] border border-white/10 hover:border-cyan-400/40 text-cyan-300 text-xs font-medium flex items-center gap-1.5 shrink-0 transition active:scale-95"
              title={t('term_view_screen')}
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('term_view_screen')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Command History & Pinned Commands Drawer */}
      <AnimatePresence>
        {isHistoryDrawerOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden mb-2.5"
          >
            <div className="p-3 rounded-2xl glass-liquid space-y-2">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    {language === 'bg'
                      ? 'Последни команди'
                      : 'Recent & Pinned Commands'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsHistoryDrawerOpen(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {executionLogs.length === 0 ? (
                <div className="text-xs text-slate-400 py-2 font-mono">
                  {language === 'bg'
                    ? 'Все още няма изпълнени команди в тази сесия.'
                    : 'No commands executed in this session yet.'}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {executionLogs
                    .slice()
                    .reverse()
                    .map((item) => {
                      const cmdText = item.commandPrompt || item.output.split('\n')[0];
                      const isPinned = pinnedCommands.includes(cmdText);
                      return (
                        <div
                          key={`hist-${item.id}`}
                          className="px-2.5 py-1.5 rounded-xl bg-[#070d1b] border border-white/10 flex items-center justify-between gap-2 text-xs font-mono"
                        >
                          <button
                            type="button"
                            onClick={() => dispatchPrompt(cmdText)}
                            className="text-left text-cyan-200 hover:text-white truncate flex-1"
                          >
                            $ {cmdText}
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300">
                              {item.execution_time_ms}ms
                            </span>
                            <button
                              type="button"
                              onClick={() => togglePinCommand(cmdText)}
                              className={`p-1 rounded hover:bg-white/10 transition ${
                                isPinned
                                  ? 'text-amber-300'
                                  : 'text-slate-400 hover:text-white'
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

      {/* 2. Main Terminal Output Surface */}
      <GlassContainer className="flex-1 p-3.5 sm:p-4 flex flex-col justify-between min-h-[220px] sm:min-h-[340px] mb-2.5 overflow-hidden">
        <div className="flex items-center justify-between gap-2 pb-2.5 text-xs text-slate-400 border-b border-white/[0.08] overflow-hidden">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="font-semibold text-white truncate">
              {t('term_agent_context')}
            </span>
          </div>
          <span className="font-mono text-[11px] text-cyan-300/90 tabular-nums shrink-0">
            {selectedHost
              ? `${selectedHost.ip}:${selectedHost.port || 8765}`
              : language === 'bg'
              ? 'Няма хост'
              : 'No Host'}
          </span>
        </div>

        {/* Scrollable Command Output */}
        <div className="flex-1 min-h-[160px] max-h-[52dvh] py-3 font-mono text-xs leading-relaxed space-y-2.5 overflow-y-auto">
          {selectedHost ? (
            <div className="text-slate-400">
              {t('term_connected_to', {
                name: selectedHost.name,
                os: selectedHost.os === 'linux' ? 'Linux' : 'Windows',
              })}
            </div>
          ) : (
            <div className="text-amber-300/90 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-mono">
              {language === 'bg'
                ? 'Няма избран компютър. Добавете компютър от таб „Флот“, за да изпращате команди.'
                : 'No computer selected. Add a PC from the "Fleet" tab to execute commands.'}
            </div>
          )}

          {executionLogs.map((entry) => {
            const isPinned = entry.commandPrompt
              ? pinnedCommands.includes(entry.commandPrompt)
              : false;
            const isError =
              entry.status === 'failed' ||
              entry.status === 'rejected' ||
              (entry.exitCode !== undefined && entry.exitCode !== 0);
            return (
              <div
                key={entry.id}
                className={`p-3 rounded-xl bg-[#070d1b] border space-y-1.5 ${
                  isError ? 'border-rose-500/35' : 'border-cyan-400/25'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums border-b border-white/[0.06] pb-1.5">
                  {isError ? (
                    <span className="text-rose-400 flex items-center gap-1.5 font-semibold truncate">
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {language === 'bg'
                          ? `Грешка (${entry.execution_time_ms}ms)`
                          : `Failed (${entry.execution_time_ms}ms)`}{' '}
                        • Exit {entry.exitCode ?? -1}
                      </span>
                    </span>
                  ) : (
                    <span className="text-emerald-400 flex items-center gap-1.5 font-semibold truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {t('term_exec_success', { time: entry.execution_time_ms })} • Exit{' '}
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
                          className={`transition flex items-center gap-1 ${
                            isPinned
                              ? 'text-amber-300'
                              : 'text-slate-400 hover:text-amber-300'
                          }`}
                          title={language === 'bg' ? 'Закачи команда' : 'Pin command'}
                        >
                          <Star
                            className={`w-3 h-3 ${
                              isPinned ? 'fill-amber-400 text-amber-400' : ''
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => dispatchPrompt(entry.commandPrompt!)}
                          disabled={isExecuting}
                          className="text-slate-400 hover:text-cyan-300 transition flex items-center gap-1 disabled:opacity-40"
                          title={language === 'bg' ? 'Изпълни отново' : 'Re-run command'}
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopyOutput(entry.id, entry.output)}
                      className="text-slate-400 hover:text-cyan-300 transition flex items-center gap-1"
                      title={language === 'bg' ? 'Копирай изхода' : 'Copy output'}
                    >
                      {copiedId === entry.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                    <span className="text-slate-500">{entry.timestamp}</span>
                  </div>
                </div>

                {entry.commandPrompt && (
                  <div className="text-[11px] text-cyan-300 font-semibold truncate">
                    $ {entry.commandPrompt}
                  </div>
                )}

                <pre className="text-slate-100 text-xs whitespace-pre-wrap break-words overflow-x-auto max-w-full font-mono select-text">
                  {entry.output}
                </pre>
              </div>
            );
          })}

          {isExecuting && (
            <div className="flex items-center gap-2 text-cyan-300 py-1">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{t('term_executing')}</span>
            </div>
          )}

          <div ref={logScrollRef} />
        </div>
      </GlassContainer>

      {/* 3. Preset Chips + Prompt Bar */}
      <div className="w-full space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {pinnedCommands.map((pinned, idx) => (
            <div
              key={`pin-${idx}`}
              className="h-8 pl-2.5 pr-1.5 rounded-lg bg-amber-500/15 border border-amber-400/40 text-xs font-semibold text-amber-200 whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <button
                type="button"
                disabled={isExecuting}
                onClick={() => dispatchPrompt(pinned)}
                className="flex items-center gap-1 disabled:opacity-40"
              >
                <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                <span className="max-w-[160px] truncate">{pinned}</span>
              </button>
              <button
                type="button"
                onClick={() => togglePinCommand(pinned)}
                className="p-0.5 rounded hover:bg-white/10 text-amber-300/70 hover:text-white"
                title={language === 'bg' ? 'Премахни' : 'Unpin'}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          {localizedPresets.map((preset) => {
            const PresetIcon = preset.icon || Sparkles;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={isExecuting}
                onClick={() => dispatchPrompt(preset.prompt)}
                className={`h-8 px-3 rounded-lg bg-[#0b1326] border text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition disabled:opacity-40 active:scale-95 ${preset.colorClass}`}
              >
                <PresetIcon className={`w-3.5 h-3.5 shrink-0 ${preset.iconColor}`} />
                <span className="font-display">{preset.label}</span>
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} className="w-full relative">
          <div className="h-12 rounded-2xl bg-[#0b1326] border border-white/15 focus-within:border-cyan-400/60 px-3.5 flex items-center gap-2.5 transition">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('term_prompt_placeholder')}
              disabled={isExecuting}
              className="flex-1 bg-transparent border-none outline-none text-xs sm:text-sm text-white placeholder-slate-500 disabled:opacity-50 min-w-0"
            />
            {prompt.trim() && (
              <button
                type="button"
                onClick={() => togglePinCommand(prompt)}
                className={`p-1.5 rounded-lg transition shrink-0 ${
                  pinnedCommands.includes(prompt.trim())
                    ? 'text-amber-300'
                    : 'text-slate-400 hover:text-amber-300'
                }`}
                title={language === 'bg' ? 'Закачи командата' : 'Pin command'}
              >
                <Star
                  className={`w-4 h-4 ${
                    pinnedCommands.includes(prompt.trim()) ? 'fill-amber-400 text-amber-400' : ''
                  }`}
                />
              </button>
            )}
            <button
              type="submit"
              disabled={!prompt.trim() || isExecuting}
              className="w-9 h-9 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-35 text-slate-950 flex items-center justify-center transition shrink-0 active:scale-95"
              aria-label={t('term_send_btn')}
            >
              {isExecuting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const CommandTerminal = React.memo(CommandTerminalComponent);
