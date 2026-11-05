import React, { useState, useMemo } from 'react';
import {
  Zap,
  CheckCircle2,
  XCircle,
  Search,
  Trash2,
  RotateCcw,
  Check,
  RefreshCw,
} from 'lucide-react';
import {
  HostDevice,
  WolPacketLogEntry,
  WolPacketLogStatus,
  WolPacketPayload,
  WolPacketTriggerSource,
} from '../types';
import { useWolHistory, wolHistoryStore } from '../store/wolHistoryStore';
import { generateMagicPacket } from '../services/wolService';
import { triggerHapticFeedback } from '../services/hapticService';
import { useTranslation } from '../i18n/useTranslation';
import { copyToClipboard } from '../utils/clipboard';

interface WolHistoryLogViewerProps {
  hosts?: HostDevice[];
  onSendWolPacket?: (
    payload: WolPacketPayload,
    deviceId: string,
    source?: WolPacketTriggerSource,
    customDeviceName?: string
  ) => void;
}

export const WolHistoryLogViewer: React.FC<WolHistoryLogViewerProps> = ({
  onSendWolPacket,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';

  const entries = useWolHistory();

  const [statusFilter, setStatusFilter] = useState<'all' | WolPacketLogStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const total = entries.length;
    const success = entries.filter((e) => e.status === 'success').length;
    const failed = total - success;
    return { total, success, failed };
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
        entry.timestamp.toLowerCase().includes(q)
      );
    });
  }, [entries, statusFilter, searchQuery]);

  const handleCopyMac = (id: string, mac: string) => {
    triggerHapticFeedback('light');
    copyToClipboard(mac);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleRetryPacket = (entry: WolPacketLogEntry) => {
    triggerHapticFeedback('medium');
    setRetryingId(entry.id);
    setTimeout(() => setRetryingId(null), 700);

    try {
      const pkt = generateMagicPacket(entry.mac, entry.broadcastIp, entry.port);
      if (onSendWolPacket) {
        onSendWolPacket(pkt, entry.deviceId, 'manual', entry.deviceName);
      } else {
        wolHistoryStore.addEntry({
          deviceId: entry.deviceId,
          deviceName: entry.deviceName,
          mac: entry.mac,
          broadcastIp: entry.broadcastIp,
          port: entry.port,
          bytesCount: pkt.bytesCount,
          status: 'success',
          source: 'manual',
        });
      }
    } catch {
      wolHistoryStore.addEntry({
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        mac: entry.mac,
        broadcastIp: entry.broadcastIp,
        port: entry.port,
        bytesCount: 102,
        status: 'failed',
        source: 'manual',
      });
    }
  };

  return (
    <div id="wol-history-log-viewer" className="space-y-2">
      <div className="flex items-center justify-between px-2">
        <span className="text-[11px] font-mono text-cyan-300/80 uppercase tracking-widest font-semibold">
          {isBg ? 'ИСТОРИЯ НА WAKE-ON-LAN' : 'WAKE-ON-LAN HISTORY'}
        </span>
        <span className="text-[11px] font-mono text-slate-400">
          {isBg ? `${counts.total} записа` : `${counts.total} entries`}
        </span>
      </div>

      <div className="bg-[#0b1324]/55 backdrop-blur-2xl border border-white/[0.07] border-t-white/[0.16] shadow-[0_12px_32px_rgba(0,0,0,0.4)] w-full rounded-[2rem] p-4 space-y-3">
        {/* Compact Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center border border-amber-400/25 shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-xs sm:text-sm font-bold text-white truncate">
                {isBg ? 'Дневник на пакетите' : 'Packet Log'}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                wolHistoryStore.resetToDefaultHistory();
              }}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/10 border border-white/10 text-slate-300 text-xs flex items-center gap-1.5 transition cursor-pointer"
              title={isBg ? 'Възстанови примерните записи' : 'Restore sample logs'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isBg ? 'Нулирай' : 'Reset'}</span>
            </button>

            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('medium');
                  wolHistoryStore.clearHistory();
                }}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-1.5 transition cursor-pointer"
                title={isBg ? 'Изчисти историята' : 'Clear history'}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isBg ? 'Изчисти' : 'Clear'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Single-Row Filter + Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#050914] border border-white/10 shrink-0">
            {(
              [
                { id: 'all', label: isBg ? 'Всички' : 'All', count: counts.total },
                { id: 'success', label: isBg ? 'Успешни' : 'Sent', count: counts.success },
                { id: 'failed', label: isBg ? 'Грешки' : 'Failed', count: counts.failed },
              ] as const
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
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    active
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="text-xs text-slate-400 font-mono">({tab.count})</span>
                </button>
              );
            })}
          </div>

          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isBg ? 'Търси устройство или MAC...' : 'Search device or MAC...'}
              className="w-full h-8 pl-8 pr-7 rounded-xl bg-[#050914] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs cursor-pointer"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Clean, Scannable Packet List */}
        <div className="rounded-2xl bg-[#050914]/80 border border-white/[0.07] divide-y divide-white/[0.06] max-h-72 overflow-y-auto">
          {filteredEntries.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              {isBg ? 'Няма записи за Wake-on-LAN пакети.' : 'No Wake-on-LAN packet history found.'}
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const isSuccess = entry.status === 'success';
              const isRetrying = retryingId === entry.id;

              return (
                <div
                  key={entry.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition"
                >
                  {/* Left: Status Icon + Device Name + MAC */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {isSuccess ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-white truncate">
                          {entry.deviceName}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded shrink-0 ${
                            isSuccess
                              ? 'text-emerald-300 bg-emerald-500/10'
                              : 'text-rose-300 bg-rose-500/15'
                          }`}
                        >
                          {isSuccess
                            ? isBg
                              ? 'Успешен'
                              : 'Sent'
                            : isBg
                            ? 'Грешка'
                            : 'Failed'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 mt-0.5">
                        <button
                          type="button"
                          onClick={() => handleCopyMac(entry.id, entry.mac)}
                          className="hover:text-cyan-300 transition flex items-center gap-1 cursor-pointer"
                          title={isBg ? 'Копирай MAC' : 'Copy MAC'}
                        >
                          <span>{entry.mac}</span>
                          {copiedId === entry.id && (
                            <Check className="w-3 h-3 text-emerald-400" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right: Timestamp + Quick Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {entry.timestamp.slice(11) || entry.timestamp}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRetryPacket(entry)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-white/5 transition cursor-pointer"
                      title={isBg ? 'Изпрати отново' : 'Resend packet'}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin text-cyan-300' : ''}`} />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        wolHistoryStore.removeEntry(entry.id);
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/5 transition cursor-pointer"
                      title={isBg ? 'Изтрий' : 'Remove'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
