import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Download,
  Trash2,
  RefreshCw,
  ChevronDown,
  Copy,
  Check,
  Server,
  Clock,
  ExternalLink,
  X,
  FileText,
} from 'lucide-react';
import { useLogs, logStore } from '../../store/logStore';
import { useTranslation } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';
import { copyToClipboard } from '../../utils/clipboard';
import { SPRING_JELLY, SPRING_POP } from '../../utils/springPhysics';

export interface ExecutionAuditEntry {
  id: string;
  timestamp: string;
  target_id: string;
  status: string;
  output?: string;
  commandPrompt?: string;
  exitCode?: number;
  execution_time_ms?: number;
}

interface AuditLogViewerProps {
  executionLogs?: ExecutionAuditEntry[];
  onOpenLiveConsole?: () => void;
}

type AuditCategory = 'command' | 'security' | 'daemon' | 'system';
type AuditSeverity = 'info' | 'success' | 'warn' | 'error';

interface UnifiedAuditItem {
  id: string;
  timestamp: string;
  category: AuditCategory;
  severity: AuditSeverity;
  sourceLabel: string;
  target: string;
  title: string;
  detail?: string;
  durationMs?: number;
  exitCode?: number;
  rawPayload?: unknown;
}

function downloadFile(filename: string, content: string, mime: string) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const AuditLogViewer: React.FC<AuditLogViewerProps> = React.memo(({
  executionLogs = [],
  onOpenLiveConsole,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';
  const rawStoreLogs = useLogs();

  const [categoryFilter, setCategoryFilter] = useState<
    'all' | 'command' | 'security' | 'daemon' | 'error'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [daemonLogs, setDaemonLogs] = useState<
    Array<{ time: string; level: string; message: string }>
  >([]);
  const [isRefreshingDaemon, setIsRefreshingDaemon] = useState(false);
  const fetchAbortRef = React.useRef<AbortController | null>(null);
  const copyTimerRef = React.useRef<number | null>(null);

  const fetchDaemonAuditLogs = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setIsRefreshingDaemon(true);
    try {
      const res = await fetch('/api/daemon/state', {
        credentials: 'include',
        signal: controller.signal,
      });
      if (res.ok && !controller.signal.aborted) {
        const data = await res.json();
        const rawLogs = Array.isArray(data?.daemon?.logs)
          ? data.daemon.logs
          : Array.isArray(data?.logs)
          ? data.logs
          : null;
        if (rawLogs) {
          setDaemonLogs(rawLogs.slice(-80).reverse());
        }
      }
    } catch {
      // Daemon bridge offline or aborted is normal when not running locally
    } finally {
      if (!controller.signal.aborted) {
        setIsRefreshingDaemon(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchDaemonAuditLogs();
    return () => {
      fetchAbortRef.current?.abort();
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, [fetchDaemonAuditLogs]);

  // Combine Shell Commands + Security/HITL + PC Daemon logs (strictly excluding WoL packets)
  const items = useMemo<UnifiedAuditItem[]>(() => {
    const combined: UnifiedAuditItem[] = [];

    // 1. Executed Shell / AI Commands
    executionLogs.forEach((ex) => {
      const isErr =
        ex.status === 'failed' ||
        ex.status === 'rejected' ||
        ex.status === 'error' ||
        (typeof ex.exitCode === 'number' && ex.exitCode !== 0);
      const isHitl = ex.status === 'pending_approval' || ex.status === 'rejected';

      combined.push({
        id: `exec-${ex.id}`,
        timestamp: ex.timestamp,
        category: isHitl ? 'security' : 'command',
        severity: isErr ? 'error' : isHitl ? 'warn' : 'success',
        sourceLabel: isHitl ? 'HITL Guard' : 'Shell Command',
        target: ex.target_id || 'HOST',
        title: ex.commandPrompt ? `$ ${ex.commandPrompt}` : ex.output?.split('\n')[0] || ex.status,
        detail: ex.output,
        durationMs: ex.execution_time_ms,
        exitCode: ex.exitCode,
        rawPayload: ex,
      });
    });

    // 2. Application & Security Store Logs (exclude WOL_ENGINE & raw packet entries)
    rawStoreLogs.forEach((entry) => {
      if (entry.sender === 'WOL_ENGINE' || entry.type === 'packet') return;
      const msgLower = entry.message.toLowerCase();
      const isSecurity =
        /hitl|quarantine|circuit|security|auth|ban|blocked|reject|vault|hmac|aead|panic|pin/i.test(
          msgLower
        );
      const isCommand = /command|shell|exec|terminal|cmd|powershell/i.test(msgLower);

      const category: AuditCategory = isSecurity
        ? 'security'
        : isCommand
        ? 'command'
        : entry.sender === 'HOST_AGENT'
        ? 'daemon'
        : 'system';

      const severity: AuditSeverity =
        entry.type === 'error'
          ? 'error'
          : entry.type === 'warn'
          ? 'warn'
          : entry.type === 'success'
          ? 'success'
          : 'info';

      combined.push({
        id: `store-${entry.id}`,
        timestamp: entry.timestamp,
        category,
        severity,
        sourceLabel:
          entry.sender === 'HOST_AGENT'
            ? 'Host Agent'
            : entry.sender === 'SYSTEM_MDNS'
            ? 'Discovery'
            : 'Control Client',
        target: entry.targetId || 'SYSTEM',
        title: entry.message,
        detail:
          entry.payload !== undefined
            ? typeof entry.payload === 'string'
              ? entry.payload
              : JSON.stringify(entry.payload, null, 2)
            : undefined,
        rawPayload: entry.payload,
      });
    });

    // 3. Live PC Host Daemon Security & Audit Stream
    daemonLogs.forEach((dl, idx) => {
      const lvl = String(dl.level || 'INFO').toUpperCase();
      const isSec = lvl === 'SECURITY' || lvl === 'ALERT' || /hitl|ban|auth|policy|pin/i.test(dl.message);
      const severity: AuditSeverity =
        lvl === 'ALERT' || lvl === 'ERROR'
          ? 'error'
          : lvl === 'WARN'
          ? 'warn'
          : lvl === 'SUCCESS'
          ? 'success'
          : 'info';

      combined.push({
        id: `daemon-${idx}-${dl.time}`,
        timestamp: dl.time || '--:--:--',
        category: isSec ? 'security' : 'daemon',
        severity,
        sourceLabel: `PC Daemon (${lvl})`,
        target: 'LOCAL-HOST',
        title: dl.message,
        rawPayload: dl,
      });
    });

    return combined;
  }, [executionLogs, rawStoreLogs, daemonLogs]);

  const counts = useMemo(() => {
    let command = 0;
    let security = 0;
    let daemon = 0;
    let error = 0;
    for (const i of items) {
      if (i.category === 'command') command += 1;
      else if (i.category === 'security') security += 1;
      else if (i.category === 'daemon') daemon += 1;
      if (i.severity === 'error' || i.severity === 'warn') error += 1;
    }
    return { total: items.length, command, security, daemon, error };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter === 'error') {
        if (item.severity !== 'error' && item.severity !== 'warn') return false;
      } else if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.target.toLowerCase().includes(q) ||
        item.sourceLabel.toLowerCase().includes(q) ||
        (item.detail && item.detail.toLowerCase().includes(q))
      );
    });
  }, [items, categoryFilter, searchQuery]);

  const handleExport = (format: 'json' | 'csv') => {
    triggerHapticFeedback('light');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (format === 'json') {
      downloadFile(
        `ainet-audit-log-${stamp}.json`,
        JSON.stringify(filteredItems, null, 2),
        'application/json'
      );
      return;
    }
    const headers = ['timestamp', 'category', 'severity', 'source', 'target', 'title', 'detail'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filteredItems.map((i) =>
      [i.timestamp, i.category, i.severity, i.sourceLabel, i.target, i.title, i.detail ?? '']
        .map(esc)
        .join(',')
    );
    downloadFile(
      `ainet-audit-log-${stamp}.csv`,
      [headers.join(','), ...rows].join('\n'),
      'text/csv;charset=utf-8'
    );
  };

  const handleCopyAllFiltered = () => {
    if (filteredItems.length === 0) return;
    triggerHapticFeedback('light');
    const summary = filteredItems
      .map(
        (item) =>
          `[${item.timestamp}] [${item.sourceLabel}] [${item.target}] ${item.title}${
            item.detail ? `\n${item.detail}` : ''
          }`
      )
      .join('\n\n');
    copyToClipboard(summary);
    setCopiedId('__all__');
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedId((prev) => (prev === '__all__' ? null : prev));
    }, 1600);
  };

  const handleCopyEntry = (item: UnifiedAuditItem) => {
    triggerHapticFeedback('light');
    const text = `[${item.timestamp}] [${item.sourceLabel}] [${item.target}] ${item.title}${
      item.detail ? `\n${item.detail}` : ''
    }`;
    copyToClipboard(text);
    setCopiedId(item.id);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedId((prev) => (prev === item.id ? null : prev));
    }, 1500);
  };

  const renderSeverityIcon = (severity: AuditSeverity) => {
    if (severity === 'error') {
      return (
        <div className="w-7 h-7 rounded-xl bg-rose-500/14 border border-rose-500/35 text-rose-400 flex items-center justify-center shrink-0">
          <XCircle className="w-4 h-4" />
        </div>
      );
    }
    if (severity === 'warn') {
      return (
        <div className="w-7 h-7 rounded-xl bg-amber-500/14 border border-amber-400/35 text-amber-400 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-4 h-4" />
        </div>
      );
    }
    if (severity === 'success') {
      return (
        <div className="w-7 h-7 rounded-xl bg-emerald-500/14 border border-emerald-500/35 text-emerald-400 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div className="w-7 h-7 rounded-xl bg-sky-500/14 border border-sky-400/35 text-sky-400 flex items-center justify-center shrink-0">
        <FileText className="w-4 h-4" />
      </div>
    );
  };

  return (
    <div id="security-audit-log-viewer" className="glass-liquid w-full rounded-[28px] p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 squircle-badge squircle-violet flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display text-sm sm:text-base font-extrabold ink-primary tracking-tight">
                {isBg ? 'Одитен дневник за сигурност и команди' : 'Security & Command Audit Log'}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-violet-500/14 dark:bg-violet-950/75 border border-violet-500/35 text-violet-700 dark:text-violet-200">
                {counts.total} {isBg ? 'събития' : 'events'}
              </span>
            </div>
            <p className="text-xs ink-muted mt-0.5">
              {isBg
                ? 'Изпълнени Shell команди, HITL одобрения и събития на PC демона (WoL пакетите са в „WoL & Енергия“)'
                : 'Shell executions, HITL firewall decisions & PC daemon security events (WoL packets live in WoL & Energy)'}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {onOpenLiveConsole && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.92 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                onOpenLiveConsole();
              }}
              className="h-8.5 px-3.5 rounded-full liquid-hero-btn text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{isBg ? 'Жива конзола' : 'Live Console'}</span>
              <ExternalLink className="w-3 h-3 opacity-85" />
            </motion.button>
          )}

          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              void fetchDaemonAuditLogs();
            }}
            className="h-8.5 px-3 rounded-full liquid-control-pill text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
            title={isBg ? 'Обнови от PC Демона' : 'Sync PC Daemon logs'}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshingDaemon ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">{isBg ? 'Синхронизирай' : 'Sync'}</span>
          </button>

          {items.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleCopyAllFiltered}
                disabled={filteredItems.length === 0}
                className="h-8.5 px-3 rounded-full liquid-control-pill text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-45"
                title={isBg ? 'Копирай филтрираните записи' : 'Copy filtered entries'}
              >
                {copiedId === '__all__' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">{isBg ? 'Копирано' : 'Copied'}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-cyan-400" />
                    <span className="hidden sm:inline">{isBg ? 'Копирай' : 'Copy'}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleExport('csv')}
                className="h-8.5 px-3 rounded-full liquid-control-pill text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3 h-3 text-cyan-400" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('json')}
                className="h-8.5 px-3 rounded-full liquid-control-pill text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3 h-3 text-violet-400" />
                <span>JSON</span>
              </button>

              {confirmClear ? (
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-rose-500/15 dark:bg-rose-950/80 border border-rose-500/40">
                  <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-200 px-1">
                    {isBg ? 'Изчисти?' : 'Clear?'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback('medium');
                      logStore.clearLogs();
                      setDaemonLogs([]);
                      setConfirmClear(false);
                    }}
                    className="px-2.5 py-0.5 rounded-full squircle-rose preserve-white text-[11px] font-bold cursor-pointer"
                  >
                    {isBg ? 'Да' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="p-1 rounded-full ink-secondary hover:ink-primary cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    setConfirmClear(true);
                  }}
                  className="h-8.5 px-3 rounded-full bg-rose-500/14 dark:bg-rose-950/75 hover:bg-rose-500/22 dark:hover:bg-rose-900/80 border border-rose-500/35 text-rose-700 dark:text-rose-200 text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isBg ? 'Изчисти' : 'Clear'}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 4 Interactive KPI Filter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback('selection');
            setCategoryFilter('all');
          }}
          className={`text-left rounded-2xl liquid-terminal-entry px-3.5 py-2.5 transition cursor-pointer ${
            categoryFilter === 'all' ? 'ring-2 ring-[var(--theme-accent)]/50' : 'hover:border-cyan-400/40'
          }`}
        >
          <div className="text-[10px] ink-muted font-semibold uppercase tracking-wide">
            {isBg ? 'Общо събития' : 'Total Audited'}
          </div>
          <div className="text-base font-extrabold font-mono ink-primary tabular-nums mt-0.5">
            {counts.total}
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback('selection');
            setCategoryFilter('command');
          }}
          className={`text-left rounded-2xl liquid-terminal-entry px-3.5 py-2.5 border border-sky-400/25 transition cursor-pointer ${
            categoryFilter === 'command' ? 'ring-2 ring-sky-400/60' : 'hover:border-sky-400/50'
          }`}
        >
          <div className="text-[10px] text-sky-400 font-semibold uppercase tracking-wide">
            {isBg ? 'Shell команди' : 'Shell Commands'}
          </div>
          <div className="text-base font-extrabold font-mono text-sky-400 tabular-nums mt-0.5">
            {counts.command}
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback('selection');
            setCategoryFilter('security');
          }}
          className={`text-left rounded-2xl liquid-terminal-entry px-3.5 py-2.5 border border-violet-400/25 transition cursor-pointer ${
            categoryFilter === 'security' ? 'ring-2 ring-violet-400/60' : 'hover:border-violet-400/50'
          }`}
        >
          <div className="text-[10px] text-violet-300 font-semibold uppercase tracking-wide">
            {isBg ? 'Сигурност / HITL' : 'Security & HITL'}
          </div>
          <div className="text-base font-extrabold font-mono text-violet-300 tabular-nums mt-0.5">
            {counts.security}
          </div>
        </button>
        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback('selection');
            setCategoryFilter('error');
          }}
          className={`text-left rounded-2xl liquid-terminal-entry px-3.5 py-2.5 border border-rose-400/25 transition cursor-pointer ${
            categoryFilter === 'error' ? 'ring-2 ring-rose-400/60' : 'hover:border-rose-400/50'
          }`}
        >
          <div className="text-[10px] text-rose-400 font-semibold uppercase tracking-wide">
            {isBg ? 'Предупреждения' : 'Alerts & Errors'}
          </div>
          <div className="text-base font-extrabold font-mono text-rose-400 tabular-nums mt-0.5">
            {counts.error}
          </div>
        </button>
      </div>

      {/* Filter Pills + Search */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
        <div className="flex items-center gap-1 p-1 rounded-full glass-liquid-subtle overflow-x-auto scrollbar-none shrink-0">
          {(
            [
              { id: 'all' as const, label: isBg ? 'Всички' : 'All', count: counts.total },
              { id: 'command' as const, label: isBg ? 'Команди' : 'Commands', count: counts.command },
              { id: 'security' as const, label: isBg ? 'Сигурност' : 'Security & HITL', count: counts.security },
              { id: 'daemon' as const, label: isBg ? 'PC Демон' : 'Daemon', count: counts.daemon },
              { id: 'error' as const, label: isBg ? 'Аларми' : 'Alerts', count: counts.error },
            ]
          ).map((tab) => {
            const active = categoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  triggerHapticFeedback('selection');
                  setCategoryFilter(tab.id);
                }}
                className={`relative h-8 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer ${
                  active ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="auditCategoryPill"
                    transition={SPRING_JELLY}
                    className="absolute inset-0 rounded-full liquid-hero-btn pointer-events-none"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
                <span
                  className={`relative z-10 text-[10px] font-mono ${
                    active ? 'opacity-90' : 'ink-muted'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-[var(--theme-accent)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && searchQuery) {
                e.preventDefault();
                setSearchQuery('');
              }
            }}
            placeholder={
              isBg
                ? 'Търси команда, хост, политика или изход...'
                : 'Search command, host, policy or output...'
            }
            className="w-full h-10 pl-9 pr-8 rounded-full glass-liquid-subtle text-xs ink-primary placeholder:text-[var(--ink-secondary)] placeholder:opacity-80 focus:border-cyan-400/65 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 ink-muted hover:ink-primary cursor-pointer z-10"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Audit Trail Timeline */}
      <div className="rounded-[22px] liquid-terminal-entry divide-y divide-white/[0.08] max-h-[26rem] overflow-y-auto bouncy-scroll">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center space-y-2.5">
            <div className="w-11 h-11 squircle-badge squircle-violet mx-auto flex items-center justify-center opacity-85">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="text-xs font-display font-bold ink-primary">
              {items.length === 0
                ? isBg
                  ? 'Одитният дневник е чист'
                  : 'Audit Trail is Clean'
                : isBg
                ? 'Няма съвпадащи одитни събития'
                : 'No matching audit entries'}
            </div>
            <p className="text-[11px] ink-muted max-w-sm mx-auto">
              {isBg
                ? 'Изпълнени команди, HITL проверки за сигурност и системни събития от PC демона ще се появят тук в реално време.'
                : 'Executed remote shell commands, HITL approval decisions, and PC host daemon security events will stream here automatically.'}
            </p>
            {items.length > 0 && (categoryFilter !== 'all' || searchQuery.trim()) && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('all');
                  setSearchQuery('');
                }}
                className="px-3.5 py-1.5 rounded-full liquid-control-pill text-xs font-semibold ink-primary cursor-pointer"
              >
                {isBg ? 'Изчисти филтрите' : 'Reset Filters'}
              </button>
            )}
          </div>
        ) : (
          filteredItems.map((item) => {
            const isExpanded = expandedId === item.id;
            const hasDetail = Boolean(item.detail || item.rawPayload);
            return (
              <div key={item.id} className="transition hover:bg-white/[0.03]">
                <div className="px-3.5 py-3 flex items-start justify-between gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!hasDetail) return;
                      triggerHapticFeedback('light');
                      setExpandedId(isExpanded ? null : item.id);
                    }}
                    className={`flex items-start gap-2.5 min-w-0 flex-1 text-left ${
                      hasDetail ? 'cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    {renderSeverityIcon(item.severity)}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/12 border border-cyan-400/30 text-cyan-400">
                          {item.sourceLabel}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono liquid-control-pill ink-secondary inline-flex items-center gap-1">
                          <Server className="w-2.5 h-2.5" />
                          {item.target}
                        </span>
                        {typeof item.exitCode === 'number' && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                              item.exitCode === 0
                                ? 'bg-emerald-500/12 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/12 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            Exit {item.exitCode}
                          </span>
                        )}
                        {typeof item.durationMs === 'number' && (
                          <span className="text-[10px] font-mono ink-muted tabular-nums">
                            {item.durationMs}ms
                          </span>
                        )}
                        <span className="text-[10px] font-mono ink-muted inline-flex items-center gap-1 ml-auto">
                          <Clock className="w-2.5 h-2.5" />
                          {item.timestamp}
                        </span>
                      </div>

                      <div className="text-xs font-mono ink-primary break-words font-medium leading-snug">
                        {item.title}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyEntry(item)}
                      className="w-7 h-7 rounded-full liquid-control-pill flex items-center justify-center ink-secondary hover:text-cyan-400 cursor-pointer"
                      title={isBg ? 'Копирай записа' : 'Copy log entry'}
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {hasDetail && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="w-7 h-7 rounded-full liquid-control-pill flex items-center justify-center ink-muted cursor-pointer"
                        aria-label="Toggle audit details"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform duration-150 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isExpanded && hasDetail && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.16 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-3 pt-1 ml-9">
                        <pre className="p-3 rounded-2xl glass-liquid-subtle font-mono text-[11px] ink-primary whitespace-pre-wrap break-words overflow-x-auto max-h-48 select-text">
                          {item.detail || JSON.stringify(item.rawPayload, null, 2)}
                        </pre>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
AuditLogViewer.displayName = 'AuditLogViewer';
