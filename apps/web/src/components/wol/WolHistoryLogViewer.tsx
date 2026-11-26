import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap,
  CheckCircle2,
  XCircle,
  Search,
  Trash2,
  Check,
  RefreshCw,
  Download,
  ChevronDown,
  Clock,
  Radio,
  Sparkles,
  Hand,
  Calendar,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  HostDevice,
  WolPacketLogEntry,
  WolPacketLogStatus,
  WolPacketPayload,
  WolPacketTriggerSource,
} from '../../types';
import { useWolHistory, wolHistoryStore } from '../../store/wolHistoryStore';
import { generateMagicPacket } from '../../services/wolService';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { copyToClipboard } from '../../utils/clipboard';
import { useUIStore } from '../../store/uiStore';
import { SPRING_JELLY, SPRING_POP } from '../../utils/springPhysics';

interface WolHistoryLogViewerProps {
  hosts?: HostDevice[];
  onSendWolPacket?: (
    payload: WolPacketPayload,
    deviceId: string,
    source?: WolPacketTriggerSource,
    customDeviceName?: string
  ) => void;
}

function triggerFileDownload(filename: string, content: string, mime: string) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, 1000);
}

const WolHistoryLogViewerComponent: React.FC<WolHistoryLogViewerProps> = ({
  hosts = [],
  onSendWolPacket,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';
  const openModal = useUIStore((s) => s.openModal);

  const entries = useWolHistory();

  const [statusFilter, setStatusFilter] = useState<'all' | WolPacketLogStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const scheduleTimer = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  };

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
    };
  }, []);

  const stats = useMemo(() => {
    const total = entries.length;
    const success = entries.filter((e) => e.status === 'success').length;
    const failed = total - success;
    const rate = total > 0 ? Math.round((success / total) * 100) : 100;
    const rttEntries = entries.filter((e) => typeof e.latencyMs === 'number' && e.latencyMs > 0);
    const avgRtt =
      rttEntries.length > 0
        ? Math.round(
            rttEntries.reduce((acc, e) => acc + (e.latencyMs || 0), 0) / rttEntries.length
          )
        : null;
    return { total, success, failed, rate, avgRtt };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        entry.deviceName.toLowerCase().includes(q) ||
        entry.mac.toLowerCase().includes(q) ||
        entry.broadcastIp.toLowerCase().includes(q) ||
        String(entry.port).includes(q) ||
        entry.source.toLowerCase().includes(q) ||
        entry.timestamp.toLowerCase().includes(q)
      );
    });
  }, [entries, statusFilter, searchQuery]);

  const handleCopyMac = (id: string, mac: string) => {
    triggerHapticFeedback('light');
    copyToClipboard(mac);
    setCopiedId(id);
    scheduleTimer(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  };

  const formatEntryTime = (entry: WolPacketLogEntry): string => {
    if (typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)) {
      return new Date(entry.createdAt).toLocaleTimeString(isBg ? 'bg-BG' : 'en-GB', {
        hour12: false,
      });
    }
    const parts = entry.timestamp.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : entry.timestamp;
  };

  const handleExport = (format: 'json' | 'csv') => {
    triggerHapticFeedback('light');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    if (format === 'json') {
      triggerFileDownload(
        `wol-magic-packets-${stamp}.json`,
        JSON.stringify(filteredEntries, null, 2),
        'application/json'
      );
      return;
    }
    const headers = [
      'timestamp',
      'deviceName',
      'mac',
      'broadcastIp',
      'port',
      'bytesCount',
      'source',
      'status',
      'latencyMs',
      'details',
    ];
    const escapeCsv = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const rows = filteredEntries.map((e) =>
      [
        e.timestamp,
        e.deviceName,
        e.mac,
        e.broadcastIp,
        e.port,
        e.bytesCount,
        e.source,
        e.status,
        e.latencyMs ?? '',
        (isBg ? e.detailsBg : e.details) ?? '',
      ]
        .map(escapeCsv)
        .join(',')
    );
    triggerFileDownload(
      `wol-magic-packets-${stamp}.csv`,
      [headers.join(','), ...rows].join('\n'),
      'text/csv;charset=utf-8'
    );
  };

  const handleRetryPacket = async (entry: WolPacketLogEntry) => {
    triggerHapticFeedback('medium');
    setRetryingId(entry.id);

    try {
      const pkt = generateMagicPacket(entry.mac, entry.broadcastIp, entry.port);
      if (onSendWolPacket) {
        onSendWolPacket(pkt, entry.deviceId, 'manual', entry.deviceName);
      } else {
        const start = performance.now();
        const res = await fetch('/api/wol', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            mac: pkt.mac,
            broadcastIp: pkt.broadcastIp || '255.255.255.255',
            port: pkt.port || 9,
          }),
        });
        const data = await res.json().catch(() => ({} as any));
        const rtt = Math.max(1, Math.round(performance.now() - start));
        const ok = Boolean(res.ok && data?.success);
        wolHistoryStore.addEntry({
          deviceId: entry.deviceId,
          deviceName: entry.deviceName,
          mac: pkt.mac,
          broadcastIp: pkt.broadcastIp,
          port: pkt.port,
          bytesCount: pkt.bytesCount,
          status: ok ? 'success' : 'failed',
          source: 'manual',
          latencyMs: ok ? rtt : undefined,
          details: ok
            ? undefined
            : data?.error || `HTTP ${res.status} dispatching Wake-on-LAN packet`,
          detailsBg: ok
            ? undefined
            : data?.error || `Грешка HTTP ${res.status} при изпращане на WoL пакет`,
        });
      }
    } catch (err: any) {
      wolHistoryStore.addEntry({
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        mac: entry.mac,
        broadcastIp: entry.broadcastIp,
        port: entry.port,
        bytesCount: 102,
        status: 'failed',
        source: 'manual',
        details: err?.message || 'Wake-on-LAN retry failed',
        detailsBg: err?.message || 'Неуспешен повторен опит за Wake-on-LAN',
      });
    } finally {
      scheduleTimer(() => setRetryingId((prev) => (prev === entry.id ? null : prev)), 700);
    }
  };

  const renderSourceBadge = (source: WolPacketTriggerSource) => {
    if (source === 'schedule') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-sky-500/14 border border-sky-400/35 text-sky-400">
          <Calendar className="w-2.5 h-2.5" />
          <span>{isBg ? 'График' : 'Scheduled'}</span>
        </span>
      );
    }
    if (source === 'ai') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-violet-500/14 border border-violet-400/35 text-violet-300">
          <Sparkles className="w-2.5 h-2.5" />
          <span>AI</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold liquid-control-pill ink-secondary">
        <Hand className="w-2.5 h-2.5" />
        <span>{isBg ? 'Ръчно' : 'Manual'}</span>
      </span>
    );
  };

  return (
    <div id="wol-history-log-viewer" className="glass-liquid w-full rounded-[28px] p-4 sm:p-5 space-y-4">
      {/* Header + Quick Wake + Export + Inline 2-Step Clear */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 squircle-badge squircle-amber flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display text-sm sm:text-base font-extrabold ink-primary tracking-tight">
                {isBg ? 'Дневник на Magic пакетите' : 'Magic Packet Log'}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/14 border border-amber-400/35 text-amber-400">
                {stats.total} {isBg ? 'записа' : 'packets'}
              </span>
            </div>
            <p className="text-xs ink-muted mt-0.5">
              {isBg
                ? 'Пълна телеметрия на изпратени IEEE 802.3 UDP Magic пакети (102B / 108B SecureOn)'
                : 'Live IEEE 802.3 UDP Magic Packet telemetry (source, broadcast target, SecureOn & RTT)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <motion.button
            type="button"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_POP}
            onClick={() => {
              triggerHapticFeedback('light');
              openModal('wol', { device: hosts[0] || null, tab: 'direct' });
            }}
            className="h-8.5 px-3.5 rounded-full liquid-hero-btn text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>{isBg ? 'Изпрати пакет' : 'Send Packet'}</span>
          </motion.button>

          {entries.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => handleExport('csv')}
                className="h-8.5 px-3 rounded-full liquid-control-pill text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                title={isBg ? 'Експорт в CSV' : 'Export CSV'}
              >
                <Download className="w-3 h-3 text-cyan-400" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('json')}
                className="h-8.5 px-3 rounded-full liquid-control-pill text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                title={isBg ? 'Експорт в JSON' : 'Export JSON'}
              >
                <Download className="w-3 h-3 text-violet-400" />
                <span>JSON</span>
              </button>

              {confirmClear ? (
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-rose-500/15 border border-rose-500/40">
                  <span className="text-[11px] font-semibold text-rose-400 px-1">
                    {isBg ? 'Изчисти?' : 'Clear all?'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback('medium');
                      wolHistoryStore.clearHistory();
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
                    aria-label="Cancel clear"
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
                  className="h-8.5 px-3 rounded-full bg-rose-500/12 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isBg ? 'Изчисти' : 'Clear'}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Summary Telemetry Strip */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-2xl liquid-terminal-entry px-3.5 py-2.5">
          <div className="text-[10px] ink-muted font-semibold uppercase tracking-wide">
            {isBg ? 'Успеваемост' : 'Delivery Rate'}
          </div>
          <div className="text-base font-extrabold font-mono text-emerald-400 tabular-nums mt-0.5">
            {stats.total > 0 ? `${stats.rate}%` : '—'}
          </div>
        </div>
        <div className="rounded-2xl liquid-terminal-entry px-3.5 py-2.5">
          <div className="text-[10px] ink-muted font-semibold uppercase tracking-wide">
            {isBg ? 'Средно RTT' : 'Avg Dispatch RTT'}
          </div>
          <div className="text-base font-extrabold font-mono text-cyan-400 tabular-nums mt-0.5">
            {stats.avgRtt !== null ? `${stats.avgRtt}ms` : '—'}
          </div>
        </div>
        <div className="rounded-2xl liquid-terminal-entry px-3.5 py-2.5">
          <div className="text-[10px] ink-muted font-semibold uppercase tracking-wide">
            {isBg ? 'Грешки' : 'Failed Packets'}
          </div>
          <div
            className={`text-base font-extrabold font-mono tabular-nums mt-0.5 ${
              stats.failed > 0 ? 'text-rose-400' : 'ink-secondary'
            }`}
          >
            {stats.failed}
          </div>
        </div>
      </div>

      {/* Sliding Status Filter Pills + Capsule Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="grid grid-cols-3 gap-1 p-1 rounded-full glass-liquid-subtle shrink-0">
          {(
            [
              { id: 'all' as const, label: isBg ? 'Всички' : 'All', count: stats.total },
              { id: 'success' as const, label: isBg ? 'Изпратени' : 'Sent', count: stats.success },
              { id: 'failed' as const, label: isBg ? 'Грешки' : 'Failed', count: stats.failed },
            ]
          ).map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  triggerHapticFeedback('selection');
                  setStatusFilter(tab.id);
                }}
                className={`relative h-8 px-3 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  active ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="wolLogStatusPill"
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
          <Search className="w-3.5 h-3.5 text-cyan-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isBg ? 'Търси устройство, MAC, IP или източник...' : 'Search host, MAC, IP or source...'
            }
            className="w-full h-10 pl-9 pr-8 rounded-full glass-liquid-subtle text-xs ink-primary placeholder:text-[var(--ink-secondary)] placeholder:opacity-80 focus:border-cyan-400/65 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 ink-muted hover:ink-primary cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Rich Telemetry Packet List */}
      <div className="rounded-[22px] liquid-terminal-entry divide-y divide-white/[0.08] max-h-80 overflow-y-auto bouncy-scroll">
        {filteredEntries.length === 0 ? (
          <div className="p-7 text-center space-y-2">
            <div className="w-10 h-10 squircle-badge squircle-amber mx-auto flex items-center justify-center opacity-85">
              <Radio className="w-5 h-5" />
            </div>
            <div className="text-xs font-display font-bold ink-primary">
              {entries.length === 0
                ? isBg
                  ? 'Няма изпратени Magic пакети'
                  : 'No Magic Packets Sent Yet'
                : isBg
                ? 'Няма съвпадения за този филтър'
                : 'No matching packets found'}
            </div>
            <p className="text-[11px] ink-muted max-w-xs mx-auto">
              {isBg
                ? 'Използвайте бутона „Изпрати пакет“ или събудете устройство от таб Устройства.'
                : 'Click "Send Packet" above or wake any computer from the Devices tab to inspect live packet telemetry.'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isSuccess = entry.status === 'success';
            const isRetrying = retryingId === entry.id;
            const isExpanded = expandedId === entry.id;
            const isSecureOn = entry.bytesCount >= 108;
            const detailsMsg = isBg ? entry.detailsBg || entry.details : entry.details;
            const resolvedDeviceName =
              hosts.find(
                (h) =>
                  h.id === entry.deviceId || h.mac.toLowerCase() === entry.mac.toLowerCase()
              )?.name || entry.deviceName;

            return (
              <div key={entry.id} className="transition hover:bg-white/[0.03]">
                <div className="px-3.5 py-3 flex items-start sm:items-center justify-between gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback('light');
                      setExpandedId(isExpanded ? null : entry.id);
                    }}
                    className="flex items-start gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        isSuccess
                          ? 'bg-emerald-500/14 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/14 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isSuccess ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-display font-bold ink-primary truncate">
                          {resolvedDeviceName}
                        </span>
                        {renderSourceBadge(entry.source)}
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                            isSecureOn
                              ? 'bg-violet-500/14 text-violet-300 border border-violet-400/35'
                              : 'bg-cyan-500/12 text-cyan-400 border border-cyan-400/30'
                          }`}
                        >
                          {isSecureOn && <ShieldCheck className="w-2.5 h-2.5" />}
                          <span>{isSecureOn ? '108B SecureOn' : `${entry.bytesCount || 102}B`}</span>
                        </span>
                        {typeof entry.latencyMs === 'number' && (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/12 text-emerald-400 border border-emerald-500/30 tabular-nums">
                            {entry.latencyMs}ms
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] font-mono ink-muted flex-wrap">
                        <span>{entry.mac}</span>
                        <span>•</span>
                        <span>
                          {entry.broadcastIp}:{entry.port}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {formatEntryTime(entry)}
                        </span>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyMac(entry.id, entry.mac)}
                      className="h-7 px-2 rounded-full liquid-control-pill text-[10px] font-mono font-semibold flex items-center gap-1 cursor-pointer"
                      title={isBg ? 'Копирай MAC' : 'Copy MAC'}
                    >
                      {copiedId === entry.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <span>MAC</span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRetryPacket(entry)}
                      className="w-7 h-7 rounded-full liquid-control-pill flex items-center justify-center text-cyan-400 cursor-pointer"
                      title={isBg ? 'Изпрати отново' : 'Resend packet'}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        wolHistoryStore.removeEntry(entry.id);
                      }}
                      className="w-7 h-7 rounded-full liquid-control-pill flex items-center justify-center text-rose-400 cursor-pointer"
                      title={isBg ? 'Изтрий' : 'Remove'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="w-7 h-7 rounded-full liquid-control-pill flex items-center justify-center ink-muted cursor-pointer"
                      aria-label="Toggle packet details"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-150 ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.16 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-3 pt-1 ml-9 space-y-1.5 text-[11px] font-mono">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 ink-secondary">
                          <span>
                            {isBg ? 'Час:' : 'Timestamp:'} <strong>{entry.timestamp}</strong>
                          </span>
                          <span>
                            {isBg ? 'Цел:' : 'Target:'}{' '}
                            <strong>
                              udp://{entry.broadcastIp}:{entry.port}
                            </strong>
                          </span>
                          <span>
                            {isBg ? 'Размер:' : 'Payload:'}{' '}
                            <strong>{entry.bytesCount || 102} bytes</strong>
                          </span>
                        </div>
                        {detailsMsg && (
                          <div
                            className={`p-2.5 rounded-xl border text-[11px] ${
                              isSuccess
                                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                                : 'bg-rose-500/12 border-rose-500/30 text-rose-400'
                            }`}
                          >
                            {detailsMsg}
                          </div>
                        )}
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
};

export const WolHistoryLogViewer = React.memo(WolHistoryLogViewerComponent);
