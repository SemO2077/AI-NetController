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
  Maximize2,
  Lock,
  Sparkles,
  RotateCcw,
  HardDrive,
  Star,
  Radio,
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
import { SPRING_BUBBLY, SPRING_POP, SPRING_ELASTIC } from '../../utils/springPhysics';

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
      colorBorder: 'border-amber-400/40 bg-amber-500/10 shadow-[0_0_10px_rgba(245,158,11,0.2)]',
      iconColor: 'text-amber-400',
    };
  }
  if (safePct >= 70) {
    return {
      icon: BatteryFull,
      colorText: 'text-emerald-400',
      colorBorder: 'border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_8px_rgba(52,211,153,0.15)]',
      iconColor: 'text-emerald-400',
    };
  }
  if (safePct >= 30) {
    return {
      icon: BatteryMedium,
      colorText: 'text-cyan-300',
      colorBorder: 'border-cyan-500/30 bg-cyan-500/10 shadow-[0_0_8px_rgba(6,182,212,0.15)]',
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
    colorText: 'text-rose-400 animate-pulse',
    colorBorder: 'border-rose-500/40 bg-rose-500/15 shadow-[0_0_8px_rgba(244,63,94,0.3)]',
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
      <svg width="60" height="18" viewBox="0 0 60 18" className="shrink-0 opacity-35">
        <line x1="0" y1="9" x2="60" y2="9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" className="text-slate-500" />
      </svg>
    );
  }

  const safePing = Number.isFinite(ping) && ping > 0 ? ping : 12;
  const samples =
    history && history.length >= 3
      ? history.slice(-12).map((d) => (Number.isFinite(d.latency) ? d.latency : safePing))
      : [safePing, safePing + 1, Math.max(1, safePing - 1), safePing, safePing + 1, safePing];

  const minVal = Math.min(...samples, 1);
  const maxVal = Math.max(...samples, minVal + 4);
  const range = Math.max(1, maxVal - minVal);

  const points = samples
    .map((val, idx) => {
      const x = (idx / Math.max(1, samples.length - 1)) * 56 + 2;
      const y = 15 - ((val - minVal) / range) * 12;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width="60" height="18" viewBox="0 0 60 18" className="shrink-0 overflow-visible">
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
  const [isSonarPulsing, setIsSonarPulsing] = useState(false);
  const [dispatchedAction, setDispatchedAction] = useState<string | null>(null);

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

  const connectionUri =
    host.os === 'windows'
      ? `ws://${host.ip}:${host.port || 8765}`
      : `ssh admin@${host.ip}`;

  const handleCopyUri = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticFeedback('light');
    copyToClipboard(connectionUri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 1800);
  };

  const handleTriggerSonarPing = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticFeedback('medium');
    setIsSonarPulsing(true);
    setTimeout(() => setIsSonarPulsing(false), 1800);
  };

  const handleQuickAction = (e: React.MouseEvent, actionId: string, command: string) => {
    e.stopPropagation();
    triggerHapticFeedback('medium');
    setDispatchedAction(actionId);
    if (onQuickCommand) {
      onQuickCommand(command, host.id);
    } else if (onSelectForCommand) {
      onSelectForCommand(host.id);
    }
    setTimeout(() => {
      setDispatchedAction((prev) => (prev === actionId ? null : prev));
    }, 1600);
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
  const osBadge = host.os === 'windows' ? 'Win 11' : 'Linux';
  const osFullLabel = host.os === 'windows' ? 'Windows 11 Pro' : 'Linux Kernel 6.8';

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
      label: currentLang === 'bg' ? 'Провери обновления' : 'Check Updates',
      icon: RefreshCw,
      command:
        host.os === 'windows'
          ? 'winget upgrade --include-unknown'
          : 'sudo apt-get update && apt list --upgradable',
      variant: 'default' as const,
    },
    {
      id: 'dns',
      label: currentLang === 'bg' ? 'Изчисти DNS и Temp' : 'Flush DNS & Temp',
      icon: Sparkles,
      command:
        host.os === 'windows'
          ? 'ipconfig /flushdns && wsreset.exe'
          : 'resolvectl flush-caches && sync',
      variant: 'default' as const,
    },
    {
      id: 'lock',
      label: currentLang === 'bg' ? 'Заключи екрана' : 'Lock Screen',
      icon: Lock,
      command:
        host.os === 'windows'
          ? 'rundll32.exe user32.dll,LockWorkStation'
          : 'loginctl lock-session',
      variant: 'default' as const,
    },
    {
      id: 'restart',
      label: currentLang === 'bg' ? 'Рестартирай хоста' : 'Restart Host',
      icon: RotateCcw,
      command:
        host.os === 'windows'
          ? 'shutdown /r /t 30 /c "Scheduled maintenance restart"'
          : 'sudo shutdown -r +1 "Scheduled maintenance restart"',
      variant: 'warning' as const,
    },
  ];

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.13 } }}
      whileHover={{ y: -2.5, scale: 1.005 }}
      transition={SPRING_BUBBLY}
      className={`${isExpanded ? 'lg:col-span-2' : ''} transform-gpu smooth-144hz contain-paint-layout`}
    >
      {/* Tier 1 — Resting Canvas Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          triggerHapticFeedback('light');
          onSelect(host.id);
          onToggleExpand(host.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(host.id);
            onToggleExpand(host.id);
          }
        }}
        className={`
          bg-[#081024]/85 backdrop-blur-2xl backdrop-saturate-[210%] border border-cyan-400/25 border-t-cyan-400/55 shadow-[0_16px_40px_rgba(0,0,0,0.7),0_0_24px_rgba(0,240,255,0.12)] transform-gpu
          w-full max-w-full rounded-[1.75rem] p-3.5 sm:p-5 text-left cursor-pointer select-none relative overflow-hidden transition-all duration-200
          ${
            isSonarPulsing
              ? 'border-cyan-300 shadow-[0_0_48px_rgba(0,240,255,0.6)] ring-2 ring-cyan-400/70'
              : isSelected
              ? 'border-cyan-400/80 shadow-[0_20px_54px_-8px_rgba(0,0,0,0.8),0_0_36px_rgba(0,240,255,0.35)] ring-1 ring-cyan-400/60'
              : 'hover:border-cyan-400/40 hover:shadow-[0_20px_50px_rgba(0,0,0,0.65),0_0_32px_rgba(0,240,255,0.2)]'
          }
          ${isOffline ? 'opacity-85' : ''}
        `}
      >
        <div className="absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent pointer-events-none" />

        {/* Collapsed Header Row */}
        <div className="relative z-10 flex flex-wrap xs:flex-nowrap items-center justify-between gap-2 sm:gap-3">
          {/* Left: 44x44px Squircle Icon + Full Hostname + OS Badge + Monospace IP + Latency / Sleeping state */}
          <div className="flex items-center space-x-2.5 sm:space-x-3.5 min-w-[170px] flex-1">
            <motion.div
              animate={
                isExpanded
                  ? { scale: 1.07, rotate: -5 }
                  : { scale: 1, rotate: 0 }
              }
              whileHover={{ scale: 1.14, rotate: -8, y: -1.5 }}
              transition={SPRING_POP}
              className={`
                w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl flex items-center justify-center shrink-0 border relative overflow-hidden transform-gpu
                ${
                  isOffline
                    ? 'bg-white/[0.04] text-white/40 border-white/10'
                    : 'bg-gradient-to-br from-cyan-400/35 via-sky-500/25 to-indigo-500/30 text-cyan-200 border-cyan-300/60 shadow-[inset_0_1px_2px_rgba(255,255,255,0.6),0_0_24px_rgba(0,229,255,0.4)]'
                }
              `}
            >
              <DeviceIcon className="w-5 h-5 icon-bubbly" />
              {isSonarPulsing && (
                <span className="absolute inset-0 rounded-2xl border-2 border-cyan-300 animate-ping" />
              )}
            </motion.div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                <span className="text-fluid-card-title font-bold text-white tracking-tight truncate min-w-0">
                  {host.name || safeId}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-[10px] font-mono font-semibold text-white/80 shrink-0">
                  {osBadge}
                </span>
                {onTogglePin && (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.22, rotate: 16 }}
                    whileTap={{ scale: 0.85, rotate: -12 }}
                    animate={
                      isPinned
                        ? { scale: 1.08, rotate: 12 }
                        : { scale: 1, rotate: 0 }
                    }
                    transition={SPRING_POP}
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('selection');
                      onTogglePin(host.id);
                    }}
                    className={`p-1.5 rounded-full transition cursor-pointer shrink-0 transform-gpu ${
                      isPinned
                        ? 'text-amber-300 hover:text-amber-200'
                        : 'text-white/25 hover:text-white/75'
                    }`}
                    title={
                      isPinned
                        ? currentLang === 'bg'
                          ? 'Откачи от върха'
                          : 'Unpin host'
                        : currentLang === 'bg'
                        ? 'Закачи най-отгоре'
                        : 'Pin host to top'
                    }
                    aria-label="Pin host"
                  >
                    <Star className={`w-3.5 h-3.5 ${isPinned ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]' : ''}`} />
                  </motion.button>
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

              {/* Clean Scannable Metadata Sub-row (1-Click Copy IP + Online RTT or Offline Ready state) */}
              <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-fluid-meta mt-1 tabular-nums">
                <button
                  type="button"
                  onClick={handleCopyIp}
                  className="inline-flex items-center gap-1 font-mono text-cyan-300/95 hover:text-cyan-200 text-[11.5px] font-medium transition cursor-pointer group/ip"
                  title={currentLang === 'bg' ? 'Кликни за копиране на IP' : 'Click to copy IP address'}
                >
                  <span>{host.ip}</span>
                  {copiedIp ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-2.5 h-2.5 opacity-0 group-hover/ip:opacity-70 transition-opacity" />
                  )}
                </button>
                <span className="text-white/25" aria-hidden="true">•</span>
                {isOffline ? (
                  <span className="text-amber-300 font-semibold text-[11.5px] drop-shadow-[0_0_8px_rgba(255,183,3,0.55)]">
                    {currentLang === 'bg' ? 'Спящ • Готов за Wake-on-LAN' : 'Sleeping • Ready for Wake-on-LAN'}
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-400/60 font-mono text-[11px] font-bold text-emerald-300 shadow-[0_0_16px_rgba(0,245,155,0.4)]">
                      <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
                        <span className="beacon-pulse-emerald absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400 shadow-[0_0_8px_#00f59b]" />
                      </span>
                      {rttMs}ms
                    </span>
                    {isLaptop && safeBatteryPct !== undefined && batteryConfig && (
                      <>
                        <span className="text-white/25" aria-hidden="true">•</span>
                        <span
                          className={`inline-flex items-center space-x-1 text-[11px] font-mono tabular-nums ${batteryConfig.colorText}`}
                          title={`Battery: ${safeBatteryPct}%${host.isCharging ? ' (Charging)' : ''}`}
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

          {/* Right: Primary 1-tap action buttons + expand chevron */}
          <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0 ml-auto">
            {isOffline ? (
              remainingWakeSeconds !== undefined ? (
                <div className="min-w-[38px] min-h-[38px] w-9.5 h-9.5 sm:min-w-[42px] sm:min-h-[42px] sm:w-10 sm:h-10 rounded-full bg-amber-500/15 border border-amber-400/40 flex flex-col items-center justify-center text-amber-300 text-[10px] font-mono font-bold">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400 mb-0.5" />
                  <span>{remainingWakeSeconds}s</span>
                </div>
              ) : (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.11, y: -2, rotate: -6 }}
                  whileTap={{ scale: 0.88 }}
                  transition={SPRING_POP}
                  onClick={(e) => onWakeClick(e, host)}
                  className="group min-w-[38px] min-h-[38px] w-9.5 h-9.5 sm:min-w-[42px] sm:min-h-[42px] sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/25 hover:from-amber-500/45 hover:to-orange-500/40 border border-amber-400/70 text-amber-100 flex items-center justify-center transition-colors cursor-pointer shadow-[0_0_24px_rgba(255,183,3,0.55)] transform-gpu"
                  title={t('host_wake_tooltip')}
                  aria-label={t('host_wake_tooltip')}
                >
                  <Power className="w-4 h-4 stroke-[2.3] icon-bolt-live" />
                </motion.button>
              )
            ) : (
              <>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.11, y: -2, rotate: 5 }}
                  whileTap={{ scale: 0.88 }}
                  transition={SPRING_POP}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticFeedback('light');
                    onSelectForCommand?.(host.id);
                  }}
                  className="group min-w-[38px] min-h-[38px] w-9.5 h-9.5 sm:min-w-[42px] sm:min-h-[42px] sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-cyan-500/20 to-sky-500/20 hover:from-cyan-500/35 hover:to-sky-500/35 border border-cyan-400/50 text-cyan-200 flex items-center justify-center transition-colors cursor-pointer shadow-[0_0_16px_rgba(0,240,255,0.3)] transform-gpu"
                  title={t('host_terminal_tooltip')}
                  aria-label={t('host_terminal_tooltip')}
                >
                  <TerminalSquare className="w-4 h-4 icon-bubbly" />
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.11, y: -2, rotate: -5 }}
                  whileTap={{ scale: 0.88 }}
                  transition={SPRING_POP}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticFeedback('light');
                    onViewScreen(host);
                  }}
                  className="group min-w-[38px] min-h-[38px] w-9.5 h-9.5 sm:min-w-[42px] sm:min-h-[42px] sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-sky-500/25 to-blue-500/20 hover:from-sky-500/40 hover:to-blue-500/35 border border-sky-400/60 text-sky-200 flex items-center justify-center transition-colors cursor-pointer shadow-[0_0_18px_rgba(14,165,233,0.4)] transform-gpu"
                  title={t('host_screen_tooltip')}
                  aria-label={t('host_screen_tooltip')}
                >
                  <ScanEye className="w-4 h-4 icon-bubbly" />
                </motion.button>
              </>
            )}

            <motion.button
              type="button"
              whileHover={{ scale: 1.11, y: -2 }}
              whileTap={{ scale: 0.88 }}
              transition={SPRING_POP}
              onClick={(e) => {
                e.stopPropagation();
                triggerHapticFeedback('light');
                onOpenDetailsModal(host);
              }}
              className="min-w-[38px] min-h-[38px] w-9.5 h-9.5 sm:min-w-[42px] sm:min-h-[42px] sm:w-10 sm:h-10 rounded-full bg-white/[0.05] hover:bg-white/[0.12] border border-white/15 text-white/75 hover:text-cyan-300 flex items-center justify-center transition-colors cursor-pointer transform-gpu"
              title={currentLang === 'bg' ? 'Детайли за хост, Карантина и Защити' : 'Host Details, Quarantine & Circuit Breaker'}
              aria-label="Host Details"
            >
              <Info className="w-4 h-4 icon-bubbly" />
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.08, y: -1 }}
              whileTap={{ scale: 0.9 }}
              transition={SPRING_POP}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(host.id);
              }}
              aria-expanded={isExpanded}
              className={`min-w-[38px] min-h-[38px] w-9.5 h-9.5 sm:min-w-[42px] sm:min-h-[42px] sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer border transform-gpu ${
                isExpanded
                  ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/50 shadow-[0_0_12px_rgba(0,240,255,0.3)]'
                  : 'bg-white/[0.04] text-white/55 hover:text-white border-white/15'
              }`}
              title={isExpanded ? t('host_hide_details_btn') : t('host_details_btn')}
            >
              <motion.div
                animate={{ rotate: isExpanded ? 180 : 0, scale: isExpanded ? 1.1 : 1 }}
                transition={SPRING_POP}
              >
                <ChevronDown className="w-4 h-4" />
              </motion.div>
            </motion.button>
          </div>
        </div>

        {/* Bottom of Collapsed Card (Online only): Ultra-sleek progress bars for CPU and RAM + Proactive AI Anomaly Pill */}
        {host.isOnline && (
          <div className="relative z-10 mt-3.5 pt-2.5 border-t border-white/[0.08] space-y-2.5">
            <div className="grid grid-cols-2 gap-4 items-center">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                  <span className="text-white/60 font-medium">CPU</span>
                  <span className={cpuVal >= 75 ? 'text-rose-300 font-bold drop-shadow-[0_0_8px_rgba(255,42,109,0.7)]' : 'text-cyan-300 font-bold drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]'}>
                    {cpuVal}%
                  </span>
                </div>
                <div className="h-[4.5px] w-full rounded-full telemetry-track p-[0.5px] overflow-hidden">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: Math.min(1, Math.max(0.04, cpuVal / 100)) }}
                    transition={SPRING_ELASTIC}
                    style={{ transformOrigin: 'left' }}
                    className={`h-full w-full rounded-full transform-gpu ${
                      cpuVal >= 75
                        ? 'bg-gradient-to-r from-rose-500 via-pink-400 to-amber-400 telemetry-glow-rose'
                        : 'bg-gradient-to-r from-cyan-400 via-sky-300 to-white telemetry-glow-cyan'
                    }`}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                  <span className="text-white/60 font-medium">RAM</span>
                  <span className={ramVal >= 75 ? 'text-amber-300 font-bold drop-shadow-[0_0_8px_rgba(255,183,3,0.7)]' : 'text-indigo-300 font-bold drop-shadow-[0_0_8px_rgba(139,92,246,0.6)]'}>
                    {ramVal}%
                  </span>
                </div>
                <div className="h-[4.5px] w-full rounded-full telemetry-track p-[0.5px] overflow-hidden">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: Math.min(1, Math.max(0.04, ramVal / 100)) }}
                    transition={SPRING_ELASTIC}
                    style={{ transformOrigin: 'left' }}
                    className={`h-full w-full rounded-full transform-gpu ${
                      ramVal >= 75
                        ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 telemetry-glow-amber'
                        : 'bg-gradient-to-r from-violet-400 via-purple-300 to-cyan-300 telemetry-glow-violet'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Proactive "Diagnose with AI" Anomaly Pill for High CPU/RAM Hosts */}
            {isHighLoadAnomaly && (
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10.5px] font-mono text-rose-300/90 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                  <span>
                    {currentLang === 'bg'
                      ? `Високо натоварване (${cpuVal}% CPU / ${ramVal}% RAM)`
                      : `High resource utilization (${cpuVal}% CPU / ${ramVal}% RAM)`}
                  </span>
                </span>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05, y: -1 }}
                  whileTap={{ scale: 0.92 }}
                  transition={SPRING_POP}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticFeedback('medium');
                    onDiagnoseHost?.(host);
                  }}
                  className="px-2.5 py-1 rounded-full bg-violet-500/20 hover:bg-violet-500/35 border border-violet-400/50 text-violet-200 text-[10.5px] font-semibold flex items-center gap-1 shadow-[0_0_16px_rgba(139,92,246,0.3)] transition cursor-pointer shrink-0 transform-gpu"
                >
                  <Sparkles className="w-3 h-3 text-violet-300 animate-pulse" />
                  <span>
                    {currentLang === 'bg' ? 'Диагностицирай с AI' : 'Diagnose High Load'}
                  </span>
                </motion.button>
              </div>
            )}
          </div>
        )}

        {/* Expanded 3-Tile "Bento" Drawer (120Hz Bubbly Spring Reveal) */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.13 } }}
              transition={SPRING_BUBBLY}
              className="overflow-hidden relative z-10 transform-gpu"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mt-4 pt-3.5 border-t border-white/[0.08] grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* TILE 1: Live Mini-Screen Preview (Interactive 16:9) */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticFeedback('medium');
                    if (host.isOnline) {
                      onViewScreen(host);
                    } else {
                      onWakeClick(e, host);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      if (host.isOnline) onViewScreen(host);
                    }
                  }}
                  className="group relative aspect-video w-full rounded-2xl overflow-hidden border border-white/12 bg-[#060b16] shadow-inner flex flex-col justify-between p-3 cursor-pointer"
                >
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: host.isOnline
                        ? 'radial-gradient(circle at 25% 25%, rgba(14,165,233,0.22), rgba(15,23,42,0.92) 65%), linear-gradient(135deg, #071226 0%, #09152b 50%, #050a14 100%)'
                        : 'linear-gradient(135deg, #060913 0%, #0a0f1d 100%)',
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-white/5 pointer-events-none" />

                  {host.isOnline && (
                    <div className="absolute inset-x-4 top-8 bottom-7 rounded-lg border border-cyan-400/20 bg-[#040914]/80 p-2 flex flex-col gap-1.5 pointer-events-none overflow-hidden">
                      <div className="flex items-center justify-between border-b border-white/[0.06] pb-1">
                        <div className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400/70" />
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70" />
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
                          <span className="text-[10px] font-mono text-cyan-300/70 ml-1">
                            {host.name}:~/{host.os === 'windows' ? 'PowerShell' : 'bash'}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-white/40">CST/3.0 • Binary WS</span>
                      </div>
                      <div className="font-mono text-[10px] text-emerald-300/80 leading-tight space-y-0.5">
                        <div>$ agent_daemon --status --tls</div>
                        <div className="text-cyan-300/75">
                          [OK] Framebuffer pipe active • CPU {cpuVal}% • RAM {ramVal}%
                        </div>
                        <div className="text-white/45">
                          [OK] CST/3.0 frame stream ready ({host.ip}:{host.port || 8765})
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="relative z-10 flex items-center justify-between">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-mono font-bold tracking-wider uppercase border ${
                        host.isOnline
                          ? 'bg-black/65 text-emerald-300 border-emerald-400/40'
                          : 'bg-black/65 text-amber-300 border-amber-400/35'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          host.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                        }`}
                      />
                      {host.isOnline
                        ? currentLang === 'bg'
                          ? 'НА ЖИВО'
                          : 'LIVE'
                        : currentLang === 'bg'
                        ? 'СПЯЩ ХОСТ'
                        : 'HOST SLEEPING'}
                    </span>

                    <span className="text-[10px] font-mono text-white/60 bg-black/50 px-2 py-0.5 rounded-md border border-white/10">
                      1920×1080
                    </span>
                  </div>

                  <div className="relative z-10 mt-auto flex items-center justify-center">
                    <div className="w-full min-h-[38px] py-1.5 px-3 rounded-xl bg-[#070c18]/90 group-hover:bg-cyan-500/25 border border-white/15 group-hover:border-cyan-400/50 text-center transition-all flex items-center justify-center gap-1.5 text-[11px] font-semibold text-cyan-200 shadow-lg">
                      <Maximize2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">
                        {host.isOnline
                          ? currentLang === 'bg'
                            ? 'Отвори цял екран и тракпад'
                            : 'Open Fullscreen & Trackpad'
                          : currentLang === 'bg'
                          ? 'Събуди с Magic Packet (WoL)'
                          : 'Wake via Magic Packet (WoL)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* TILE 2: 1-Tap Quick OS Actions (2x2 Grid) */}
                <div className="rounded-2xl bg-[#070c18]/75 border border-white/10 p-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-white/50 font-semibold">
                      {currentLang === 'bg' ? 'Бързи OS Действия (1-Клик)' : '1-Tap Quick OS Actions'}
                    </span>
                    <span className="text-[10px] font-mono text-cyan-300/80">
                      {host.os === 'windows' ? 'WinRM / PS' : 'SSH / Systemd'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 flex-1">
                    {quickActions.map((act) => {
                      const ActIcon = act.icon;
                      const isDispatched = dispatchedAction === act.id;
                      const isWarning = act.variant === 'warning';
                      const iconAnimClass =
                        act.id === 'updates'
                          ? 'icon-spin-bubbly'
                          : act.id === 'dns'
                          ? 'icon-sparkle-live'
                          : 'icon-bubbly';
                      return (
                        <motion.button
                          key={act.id}
                          type="button"
                          disabled={isOffline}
                          whileHover={isOffline ? undefined : { scale: 1.03, y: -1.5 }}
                          whileTap={isOffline ? undefined : { scale: 0.93 }}
                          transition={SPRING_POP}
                          onClick={(e) => handleQuickAction(e, act.id, act.command)}
                          className={`group min-h-[44px] px-2.5 py-2 rounded-xl border text-left transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transform-gpu ${
                            isDispatched
                              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                              : isWarning
                              ? 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-400/30 text-amber-200'
                              : 'bg-white/[0.04] hover:bg-white/[0.09] border-white/10 hover:border-cyan-400/35 text-white/85'
                          }`}
                        >
                          {isDispatched ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 icon-bubbly" />
                          ) : (
                            <ActIcon
                              className={`w-3.5 h-3.5 shrink-0 ${iconAnimClass} ${
                                isWarning ? 'text-amber-400' : 'text-cyan-400'
                              }`}
                            />
                          )}
                          <span className="font-display text-[11px] font-semibold leading-tight line-clamp-2">
                            {isDispatched
                              ? currentLang === 'bg'
                                ? 'Изпратено!'
                                : 'Sent!'
                              : act.label}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* TILE 3: Compact Diagnostics & Copyable Identity (Full-Width Bottom Tile) */}
                <div className="md:col-span-2 rounded-xl bg-[#070c18]/80 border border-white/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs font-mono tabular-nums">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/45">MAC:</span>
                    <span className="text-white/90 font-semibold">{host.mac}</span>
                    <button
                      type="button"
                      onClick={handleCopyMac}
                      className="p-1.5 rounded-md hover:bg-white/10 text-white/50 hover:text-cyan-300 transition cursor-pointer"
                      title={currentLang === 'bg' ? 'Копирай MAC адрес' : 'Copy MAC address'}
                    >
                      {copiedMac ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <span className="hidden sm:inline text-white/20">•</span>

                  <div className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-cyan-400/80 shrink-0" />
                    <span className="text-white/45">
                      {currentLang === 'bg' ? 'Диск:' : 'Disk:'}
                    </span>
                    <span className="text-white/85 font-medium">
                      {host.diskUsage || 'N/A'}
                    </span>
                  </div>

                  <span className="hidden sm:inline text-white/20">•</span>

                  <div className="flex items-center gap-1.5">
                    <span className="text-white/45">OS:</span>
                    <span className="text-white/85 font-medium">{osFullLabel}</span>
                  </div>

                  <span className="hidden lg:inline text-white/20">•</span>

                  {/* 1-Click Copy Connection URI & Visual Sonar Ping */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyUri}
                      className="px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 text-[10.5px] text-cyan-300 flex items-center gap-1 transition cursor-pointer"
                      title={
                        currentLang === 'bg'
                          ? `Копирай URI (${connectionUri})`
                          : `Copy URI (${connectionUri})`
                      }
                    >
                      {copiedUri ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Link2 className="w-3 h-3 text-cyan-400" />
                      )}
                      <span>{copiedUri ? (currentLang === 'bg' ? 'Копирано' : 'Copied') : 'URI'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTriggerSonarPing}
                      className={`px-2 py-1 rounded-lg border text-[10.5px] flex items-center gap-1 transition cursor-pointer ${
                        isSonarPulsing
                          ? 'bg-cyan-500/25 border-cyan-300 text-cyan-200'
                          : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/10 text-white/75 hover:text-cyan-200'
                      }`}
                      title={currentLang === 'bg' ? 'Визуален Sonar Ping тест' : 'Visual Sonar Ping locate'}
                    >
                      <Radio className={`w-3 h-3 text-cyan-400 ${isSonarPulsing ? 'animate-ping' : ''}`} />
                      <span>Ping</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <InlineMiniSparkline
                      history={host.latencyHistory}
                      ping={host.ping}
                      isOnline={host.isOnline}
                    />
                    <span className="text-cyan-300 font-semibold">
                      {host.isOnline
                        ? `RTT: ${rttMs}ms (±${jitterMs}ms jitter)`
                        : currentLang === 'bg'
                        ? 'RTT: Офлайн'
                        : 'RTT: Offline'}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
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

