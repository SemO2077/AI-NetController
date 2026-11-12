import React, { useState } from 'react';
import {
  Monitor,
  Laptop,
  Server,
  Power,
  ScanEye,
  RefreshCw,
  TerminalSquare,
  ChevronDown,
  Copy,
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  Zap,
  Check,
  Lock,
  Sparkles,
  RotateCcw,
  HardDrive,
  Star,
  Link2,
  Info,
} from 'lucide-react';
import { HostDevice } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { copyToClipboard } from '../../utils/clipboard';
import { getLatencyConfig, FleetSortMode } from './FleetDashboard';
import { useTranslation, Language } from '../../i18n/useTranslation';
import { clampPercentage } from '../../utils/viewportScale';

export interface HostCardProps {
  host: HostDevice;
  language?: Language;
  isSelected: boolean;
  isExpanded: boolean;
  isPinned?: boolean;
  isQuarantined: boolean;
  isCircuitTripped: boolean;
  sortMode: FleetSortMode;
  remainingWakeSeconds?: number;
  onSelect: (hostId: string) => void;
  onToggleExpand: (hostId: string) => void;
  onTogglePin?: (hostId: string) => void;
  onInspectWolPacket: (device: HostDevice) => void;
  onViewScreen: (device: HostDevice) => void;
  onSelectForCommand?: (hostId: string) => void;
  onQuickCommand?: (command: string, targetOverride?: string) => void;
  onDiagnoseHost?: (device: HostDevice) => void;
  onOpenDetailsModal: (device: HostDevice) => void;
  onWakeClick: (e: React.MouseEvent, device: HostDevice) => void;
}

export const getBatteryConfig = (percentage: number, isCharging?: boolean) => {
  const safePct = clampPercentage(percentage, 100);
  if (isCharging) {
    return {
      icon: BatteryCharging,
      colorText: 'text-amber-300',
      colorBorder: 'border-amber-400/40 bg-amber-500/10',
      iconColor: 'text-amber-400',
    };
  }
  if (safePct >= 70) {
    return {
      icon: BatteryFull,
      colorText: 'text-emerald-400',
      colorBorder: 'border-emerald-500/30 bg-emerald-500/10',
      iconColor: 'text-emerald-400',
    };
  }
  if (safePct >= 30) {
    return {
      icon: BatteryMedium,
      colorText: 'text-cyan-300',
      colorBorder: 'border-cyan-500/30 bg-cyan-500/10',
      iconColor: 'text-cyan-400',
    };
  }
  if (safePct >= 15) {
    return {
      icon: BatteryLow,
      colorText: 'text-amber-300',
      colorBorder: 'border-amber-400/30 bg-amber-500/10',
      iconColor: 'text-amber-400',
    };
  }
  return {
    icon: BatteryWarning,
    colorText: 'text-rose-400',
    colorBorder: 'border-rose-500/40 bg-rose-500/15',
    iconColor: 'text-rose-400',
  };
};

const InlineMiniSparkline: React.FC<{
  history?: { timestamp: number; latency: number }[];
  ping?: number;
  isOnline: boolean;
}> = React.memo(({ history, ping = 12, isOnline }) => {
  if (!isOnline) {
    return (
      <svg width="52" height="16" viewBox="0 0 52 16" className="shrink-0 opacity-35">
        <line
          x1="0"
          y1="8"
          x2="52"
          y2="8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          className="text-slate-500"
        />
      </svg>
    );
  }

  const safePing = Number.isFinite(ping) && ping > 0 ? ping : 12;
  const samples =
    history && history.length >= 2
      ? history.slice(-12).map((d) => (Number.isFinite(d.latency) ? d.latency : safePing))
      : [safePing, safePing];

  const minVal = Math.min(...samples, 1);
  const maxVal = Math.max(...samples, minVal + 4);
  const range = Math.max(1, maxVal - minVal);

  const points = samples
    .map((val, idx) => {
      const x = (idx / Math.max(1, samples.length - 1)) * 48 + 2;
      const y = 13 - ((val - minVal) / range) * 10;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width="52" height="16" viewBox="0 0 52 16" className="shrink-0 overflow-visible">
      <polyline
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
});

InlineMiniSparkline.displayName = 'InlineMiniSparkline';

const HostCardComponent: React.FC<HostCardProps> = ({
  host,
  language: propLang,
  isSelected,
  isExpanded,
  isPinned = false,
  isQuarantined,
  isCircuitTripped,
  remainingWakeSeconds,
  onSelect,
  onToggleExpand,
  onTogglePin,
  onViewScreen,
  onSelectForCommand,
  onQuickCommand,
  onDiagnoseHost,
  onOpenDetailsModal,
  onWakeClick,
}) => {
  const { t, language: storeLang } = useTranslation();
  const currentLang = propLang || storeLang;
  const isOffline = !host.isOnline;
  const [copiedMac, setCopiedMac] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [dispatchedAction, setDispatchedAction] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  const handleCopyMac = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticFeedback('light');
    copyToClipboard(host.mac);
    setCopiedMac(true);
    setTimeout(() => setCopiedMac(false), 1800);
  };

  const handleCopyIp = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticFeedback('light');
    copyToClipboard(host.ip);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 1600);
  };

  const connectionUri = `ws://${host.ip}:${host.port || 8765}`;

  const handleCopyUri = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticFeedback('light');
    copyToClipboard(connectionUri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 1800);
  };

  const handleQuickAction = (e: React.MouseEvent, actionId: string, command: string) => {
    e.stopPropagation();
    if (actionId === 'restart' && !confirmRestart) {
      triggerHapticFeedback('warning');
      setConfirmRestart(true);
      setTimeout(() => setConfirmRestart(false), 3500);
      return;
    }
    setConfirmRestart(false);
    triggerHapticFeedback('medium');
    setDispatchedAction(actionId);
    if (onQuickCommand) {
      onQuickCommand(command, host.id);
    } else if (onSelectForCommand) {
      onSelectForCommand(host.id);
    }
    setTimeout(() => {
      setDispatchedAction((prev) => (prev === actionId ? null : prev));
    }, 1500);
  };

  const safeId = host.id || 'HOST';
  let DeviceIcon = Monitor;
  if (
    host.deviceType === 'laptop' ||
    safeId.includes('LAPTOP') ||
    safeId.includes('WORKSTATION')
  ) {
    DeviceIcon = Laptop;
  } else if (
    host.deviceType === 'server' ||
    safeId.includes('SERVER') ||
    safeId.includes('SRV')
  ) {
    DeviceIcon = Server;
  }

  const isLaptop =
    host.deviceType === 'laptop' ||
    safeId.toLowerCase().includes('laptop') ||
    host.tags?.some((tag) => tag.toLowerCase() === 'laptop' || tag.toLowerCase() === 'mobile');
  const safeBatteryPct =
    host.batteryPercentage !== undefined ? clampPercentage(host.batteryPercentage, 100) : undefined;
  const batteryConfig =
    host.isOnline && safeBatteryPct !== undefined
      ? getBatteryConfig(safeBatteryPct, host.isCharging)
      : null;
  const BatteryIcon = batteryConfig?.icon || Battery;

  const latencyConfig = getLatencyConfig(host.ping, host.isOnline, safeId, currentLang);
  const cpuVal = clampPercentage(host.cpuUsage, 0);
  const ramVal = clampPercentage(host.ramUsage, 0);
  const isHighLoadAnomaly = host.isOnline && (cpuVal >= 75 || ramVal >= 75);
  const osBadge = host.os === 'windows' ? 'Windows' : 'Linux';

  const rttMs = latencyConfig.latency ?? 0;
  const jitterMs =
    host.latencyHistory && host.latencyHistory.length >= 2
      ? Math.abs(
          host.latencyHistory[host.latencyHistory.length - 1].latency -
            host.latencyHistory[host.latencyHistory.length - 2].latency
        ).toFixed(1)
      : '0.0';

  const quickActions = [
    {
      id: 'updates',
      label: currentLang === 'bg' ? 'Обновления' : 'Check Updates',
      icon: RefreshCw,
      command:
        host.os === 'windows'
          ? 'winget upgrade --include-unknown'
          : 'sudo apt-get update && apt list --upgradable',
      variant: 'default' as const,
    },
    {
      id: 'dns',
      label: currentLang === 'bg' ? 'Изчисти DNS' : 'Flush DNS',
      icon: Sparkles,
      command:
        host.os === 'windows'
          ? 'ipconfig /flushdns'
          : 'resolvectl flush-caches && sync',
      variant: 'default' as const,
    },
    {
      id: 'lock',
      label: currentLang === 'bg' ? 'Заключи екран' : 'Lock Screen',
      icon: Lock,
      command:
        host.os === 'windows'
          ? 'rundll32.exe user32.dll,LockWorkStation'
          : 'loginctl lock-session',
      variant: 'default' as const,
    },
    {
      id: 'restart',
      label: confirmRestart
        ? currentLang === 'bg'
          ? 'Потвърди рестарт?'
          : 'Confirm Restart?'
        : currentLang === 'bg'
        ? 'Рестартирай'
        : 'Restart Host',
      icon: RotateCcw,
      command:
        host.os === 'windows'
          ? 'shutdown /r /t 30 /c "Scheduled maintenance restart"'
          : 'sudo shutdown -r +1 "Scheduled maintenance restart"',
      variant: 'warning' as const,
    },
  ];

  return (
    <div className={`${isExpanded ? 'lg:col-span-2' : ''} contain-paint-layout`}>
      <div
        onClick={() => {
          triggerHapticFeedback('light');
          onSelect(host.id);
          onToggleExpand(host.id);
        }}
        className={`
          glass-liquid w-full max-w-full rounded-2xl p-3.5 sm:p-4 text-left cursor-pointer select-none relative overflow-hidden
          ${
            isSelected
              ? 'border-cyan-400/60 ring-1 ring-cyan-400/40'
              : 'border-white/[0.08]'
          }
          ${isOffline ? 'opacity-85' : ''}
        `}
      >
        {/* Main Row */}
        <div className="flex items-center justify-between gap-2.5">
          {/* Left: Device Icon + Identity + Status */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div
              className={`
                w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border relative
                ${
                  isOffline
                    ? 'bg-white/[0.06] text-slate-300 border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                    : 'bg-gradient-to-br from-cyan-400/25 via-cyan-500/15 to-indigo-500/15 text-cyan-200 border-cyan-300/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_16px_var(--theme-accent-glow)]'
                }
              `}
            >
              <DeviceIcon className="w-5 h-5" />
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0d1527] ${
                  isOffline ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-fluid-card-title font-bold text-white tracking-tight truncate">
                  {host.name || safeId}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-[10px] font-mono font-medium text-slate-300 shrink-0">
                  {osBadge}
                </span>
                {onTogglePin && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('selection');
                      onTogglePin(host.id);
                    }}
                    className={`p-1 rounded-full transition shrink-0 ${
                      isPinned
                        ? 'text-amber-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title={
                      isPinned
                        ? currentLang === 'bg'
                          ? 'Откачи'
                          : 'Unpin'
                        : currentLang === 'bg'
                        ? 'Закачи'
                        : 'Pin'
                    }
                    aria-label="Pin host"
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        isPinned ? 'fill-amber-400 text-amber-400' : ''
                      }`}
                    />
                  </button>
                )}
                {isQuarantined && (
                  <span className="text-[10px] font-mono font-semibold text-rose-400 shrink-0">
                    · {t('host_quarantined')}
                  </span>
                )}
                {isCircuitTripped && (
                  <span className="text-[10px] font-mono font-semibold text-amber-300 shrink-0">
                    · {t('host_circuit_tripped')}
                  </span>
                )}
              </div>

              {/* Sub-row: IP + RTT / Sleeping */}
              <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-fluid-meta mt-0.5 tabular-nums">
                <button
                  type="button"
                  onClick={handleCopyIp}
                  className="inline-flex items-center gap-1 font-mono text-cyan-300/90 hover:text-cyan-200 text-[11px] font-medium transition"
                  title={currentLang === 'bg' ? 'Копирай IP' : 'Copy IP'}
                >
                  <span>{host.ip}</span>
                  {copiedIp ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-2.5 h-2.5 opacity-60" />
                  )}
                </button>
                <span className="text-slate-600" aria-hidden="true">•</span>
                {isOffline ? (
                  <span className="text-amber-300/90 font-medium text-[11px] truncate">
                    {currentLang === 'bg' ? 'Спящ (WoL)' : 'Sleeping (WoL)'}
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-emerald-300">
                      {rttMs}ms
                    </span>
                    {isLaptop && safeBatteryPct !== undefined && batteryConfig && (
                      <>
                        <span className="text-slate-600" aria-hidden="true">•</span>
                        <span
                          className={`inline-flex items-center gap-0.5 text-[11px] font-mono ${batteryConfig.colorText}`}
                        >
                          <BatteryIcon className="w-3.5 h-3.5" />
                          <span>{safeBatteryPct}%</span>
                          {host.isCharging && <Zap className="w-2.5 h-2.5 text-amber-300 fill-current" />}
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: Clean 1-Tap Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isOffline ? (
              remainingWakeSeconds !== undefined ? (
                <div className="h-9 px-2.5 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center gap-1.5 text-amber-300 text-[11px] font-mono font-bold">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span>{remainingWakeSeconds}s</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => onWakeClick(e, host)}
                  className="h-9 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 flex items-center gap-1.5 text-xs font-semibold transition active:scale-95"
                  title={t('host_wake_tooltip')}
                  aria-label={t('host_wake_tooltip')}
                >
                  <Power className="w-3.5 h-3.5 text-amber-300" />
                  <span className="hidden xs:inline">
                    {currentLang === 'bg' ? 'Събуди' : 'Wake'}
                  </span>
                </button>
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticFeedback('light');
                    onSelectForCommand?.(host.id);
                  }}
                  className="w-9 h-9 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-cyan-200 flex items-center justify-center transition active:scale-95"
                  title={t('host_terminal_tooltip')}
                  aria-label={t('host_terminal_tooltip')}
                >
                  <TerminalSquare className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticFeedback('light');
                    onViewScreen(host);
                  }}
                  className="w-9 h-9 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 flex items-center justify-center transition active:scale-95"
                  title={t('host_screen_tooltip')}
                  aria-label={t('host_screen_tooltip')}
                >
                  <ScanEye className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(host.id);
              }}
              aria-expanded={isExpanded}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition border active:scale-95 ${
                isExpanded
                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40'
                  : 'bg-white/[0.04] text-slate-400 hover:text-white border-white/10'
              }`}
              title={isExpanded ? t('host_hide_details_btn') : t('host_details_btn')}
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-150 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Online Telemetry Bars */}
        {host.isOnline && (
          <div className="mt-3 pt-2.5 border-t border-white/[0.06] space-y-2">
            <div className="grid grid-cols-2 gap-3.5 items-center">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                  <span className="text-slate-400">CPU</span>
                  <span
                    className={
                      cpuVal >= 75 ? 'text-rose-300 font-bold' : 'text-cyan-300 font-semibold'
                    }
                  >
                    {cpuVal}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full telemetry-track overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, Math.max(4, cpuVal))}%` }}
                    className={`h-full rounded-full transition-all duration-300 ${
                      cpuVal >= 75
                        ? 'bg-gradient-to-r from-rose-500 via-pink-500 to-amber-400 shadow-[0_0_10px_rgba(244,63,94,0.6)]'
                        : 'bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400 telemetry-glow-cyan'
                    }`}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                  <span className="text-slate-400">RAM</span>
                  <span
                    className={
                      ramVal >= 75 ? 'text-amber-300 font-bold' : 'text-indigo-300 font-semibold'
                    }
                  >
                    {ramVal}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full telemetry-track overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, Math.max(4, ramVal))}%` }}
                    className={`h-full rounded-full transition-all duration-300 ${
                      ramVal >= 75
                        ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]'
                        : 'bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 shadow-[0_0_10px_rgba(168,85,247,0.45)]'
                    }`}
                  />
                </div>
              </div>
            </div>

            {isHighLoadAnomaly && (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[10.5px] font-mono text-rose-300 flex items-center gap-1.5 truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                  <span className="truncate">
                    {currentLang === 'bg'
                      ? `Високо натоварване (${cpuVal}% / ${ramVal}%)`
                      : `High load (${cpuVal}% CPU / ${ramVal}% RAM)`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticFeedback('medium');
                    onDiagnoseHost?.(host);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-200 text-[10.5px] font-semibold flex items-center gap-1 transition shrink-0 active:scale-95"
                >
                  <Sparkles className="w-3 h-3 text-violet-300" />
                  <span>{currentLang === 'bg' ? 'AI Анализ' : 'AI Diagnose'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Expanded Control & Telemetry Drawer (Zero Fake Placeholders) */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mt-3.5 pt-3 border-t border-white/[0.08] space-y-3">
                {/* Primary Remote Control Actions */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('medium');
                      if (host.isOnline) {
                        onViewScreen(host);
                      } else {
                        onWakeClick(e, host);
                      }
                    }}
                    className={`min-h-[40px] px-2.5 py-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 ${
                      host.isOnline
                        ? 'bg-cyan-500/20 hover:bg-cyan-500/30 border-cyan-400/45 text-cyan-100'
                        : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/45 text-amber-100'
                    }`}
                  >
                    {host.isOnline ? (
                      <>
                        <ScanEye className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                        <span className="truncate">
                          {currentLang === 'bg' ? 'Екран' : 'Live Screen'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Power className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                        <span className="truncate">
                          {currentLang === 'bg' ? 'Събуди' : 'Wake PC'}
                        </span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('light');
                      onSelectForCommand?.(host.id);
                    }}
                    className="min-h-[40px] px-2.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <TerminalSquare className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                    <span className="truncate">
                      {currentLang === 'bg' ? 'Терминал' : 'Terminal'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('light');
                      onOpenDetailsModal(host);
                    }}
                    className="min-h-[40px] px-2.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <Info className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                    <span className="truncate">
                      {currentLang === 'bg' ? 'Детайли' : 'Details'}
                    </span>
                  </button>
                </div>

                {/* 1-Tap Quick OS Actions */}
                <div className="rounded-xl bg-white/[0.04] border border-white/[0.10] border-t-white/[0.18] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                      {currentLang === 'bg' ? 'Бързи OS Команди' : 'Quick OS Actions'}
                    </span>
                    <span className="text-[10px] font-mono text-cyan-400/80">
                      {host.os === 'windows' ? 'PowerShell' : 'Systemd'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {quickActions.map((act) => {
                      const ActIcon = act.icon;
                      const isDispatched = dispatchedAction === act.id;
                      const isWarning = act.variant === 'warning';
                      return (
                        <button
                          key={act.id}
                          type="button"
                          disabled={isOffline}
                          onClick={(e) => handleQuickAction(e, act.id, act.command)}
                          className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border text-left transition flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 ${
                            isDispatched
                              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                              : isWarning
                              ? 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-400/30 text-amber-200'
                              : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.08] text-slate-200'
                          }`}
                        >
                          {isDispatched ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <ActIcon
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isWarning ? 'text-amber-400' : 'text-cyan-400'
                              }`}
                            />
                          )}
                          <span className="font-display text-[11px] font-semibold leading-tight truncate">
                            {isDispatched
                              ? currentLang === 'bg'
                                ? 'Изпратено'
                                : 'Sent'
                              : act.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Network & Hardware Telemetry Strip */}
                <div className="rounded-xl bg-white/[0.04] border border-white/[0.10] border-t-white/[0.18] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">MAC:</span>
                    <span className="text-slate-200 font-semibold">{host.mac || '—'}</span>
                    {host.mac && (
                      <button
                        type="button"
                        onClick={handleCopyMac}
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-cyan-300 transition"
                        title={currentLang === 'bg' ? 'Копирай MAC' : 'Copy MAC'}
                      >
                        {copiedMac ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>

                  {host.diskUsage && (
                    <div className="flex items-center gap-1">
                      <HardDrive className="w-3 h-3 text-cyan-400/80 shrink-0" />
                      <span className="text-slate-400">
                        {currentLang === 'bg' ? 'Диск:' : 'Disk:'}
                      </span>
                      <span className="text-slate-200">{host.diskUsage}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCopyUri}
                    className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-[10.5px] text-cyan-300 flex items-center gap-1 transition"
                    title={connectionUri}
                  >
                    {copiedUri ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Link2 className="w-3 h-3 text-cyan-400" />
                    )}
                    <span>{copiedUri ? (currentLang === 'bg' ? 'Копирано' : 'Copied') : connectionUri}</span>
                  </button>

                  <div className="flex items-center gap-2 ml-auto">
                    <InlineMiniSparkline
                      history={host.latencyHistory}
                      ping={host.ping}
                      isOnline={host.isOnline}
                    />
                    <span className="text-cyan-300 font-semibold">
                      {host.isOnline
                        ? `${rttMs}ms (±${jitterMs}ms)`
                        : currentLang === 'bg'
                        ? 'Офлайн'
                        : 'Offline'}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export const HostCard = React.memo(HostCardComponent, (prev, next) => {
  return (
    prev.host.id === next.host.id &&
    prev.host.name === next.host.name &&
    prev.host.ip === next.host.ip &&
    prev.host.mac === next.host.mac &&
    prev.host.port === next.host.port &&
    prev.host.os === next.host.os &&
    prev.host.deviceType === next.host.deviceType &&
    prev.host.isOnline === next.host.isOnline &&
    prev.host.ping === next.host.ping &&
    prev.host.cpuUsage === next.host.cpuUsage &&
    prev.host.ramUsage === next.host.ramUsage &&
    prev.host.diskUsage === next.host.diskUsage &&
    prev.host.lastSeen === next.host.lastSeen &&
    prev.host.tags === next.host.tags &&
    prev.host.batteryPercentage === next.host.batteryPercentage &&
    prev.host.isCharging === next.host.isCharging &&
    prev.isSelected === next.isSelected &&
    prev.isExpanded === next.isExpanded &&
    prev.isPinned === next.isPinned &&
    prev.isQuarantined === next.isQuarantined &&
    prev.isCircuitTripped === next.isCircuitTripped &&
    prev.sortMode === next.sortMode &&
    prev.remainingWakeSeconds === next.remainingWakeSeconds &&
    prev.language === next.language &&
    prev.host.latencyHistory === next.host.latencyHistory
  );
});
