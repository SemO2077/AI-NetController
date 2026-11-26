import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  WifiOff,
} from 'lucide-react';
import { HostDevice } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { copyToClipboard } from '../../utils/clipboard';
import { buildHostWsUri } from '../../services/securityService';
import { getLatencyConfig, FleetSortMode } from './FleetDashboard';
import { useTranslation, Language } from '../../i18n/useTranslation';
import { clampPercentage } from '../../utils/viewportScale';
import { SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';

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
  onViewScreen: (device: HostDevice) => void;
  onSelectForCommand?: (hostId: string) => void;
  onQuickCommand?: (command: string, targetOverride?: string) => void;
  onSendInputOpcode?: (opcode: number, payload: Record<string, any> | string) => boolean;
  onDiagnoseHost?: (device: HostDevice) => void;
  onOpenDetailsModal: (device: HostDevice) => void;
  onWakeClick: (e: React.MouseEvent, device: HostDevice) => void;
  onNotify?: (message: string) => void;
}

export const getBatteryConfig = (percentage: number, isCharging?: boolean) => {
  const safePct = clampPercentage(percentage, 100);
  if (isCharging) {
    return {
      icon: BatteryCharging,
      colorText: 'text-amber-400',
      colorBorder: 'border-amber-500/35 bg-amber-500/12',
      iconColor: 'text-amber-400',
    };
  }
  if (safePct >= 70) {
    return {
      icon: BatteryFull,
      colorText: 'text-emerald-400',
      colorBorder: 'border-emerald-500/35 bg-emerald-500/12',
      iconColor: 'text-emerald-400',
    };
  }
  if (safePct >= 30) {
    return {
      icon: BatteryMedium,
      colorText: 'text-sky-400',
      colorBorder: 'border-sky-500/35 bg-sky-500/12',
      iconColor: 'text-sky-400',
    };
  }
  if (safePct >= 15) {
    return {
      icon: BatteryLow,
      colorText: 'text-amber-400',
      colorBorder: 'border-amber-500/35 bg-amber-500/12',
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
  level?: 'offline' | 'optimal' | 'good' | 'moderate' | 'high';
}> = React.memo(({ history, ping = 12, isOnline, level = 'optimal' }) => {
  if (!isOnline) {
    return (
      <svg width="52" height="16" viewBox="0 0 52 16" className="shrink-0 opacity-45">
        <line
          x1="0"
          y1="8"
          x2="52"
          y2="8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          className="ink-muted"
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

  const strokeClass =
    level === 'high'
      ? 'text-rose-400'
      : level === 'moderate'
      ? 'text-amber-400'
      : level === 'good'
      ? 'text-sky-400'
      : 'text-emerald-400';

  return (
    <svg width="52" height="16" viewBox="0 0 52 16" className={`shrink-0 overflow-visible ${strokeClass}`}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
});

InlineMiniSparkline.displayName = 'InlineMiniSparkline';

const hasUsableMac = (mac?: string): boolean => {
  if (!mac) return false;
  const clean = mac.trim().toUpperCase();
  return Boolean(clean && clean !== '00:00:00:00:00:00' && clean !== '00:00:00:00:00' && clean !== 'FF:FF:FF:FF:FF:FF');
};

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
  onSendInputOpcode,
  onDiagnoseHost,
  onOpenDetailsModal,
  onWakeClick,
  onNotify,
}) => {
  const { t, language: storeLang } = useTranslation();
  const currentLang = propLang || storeLang;
  const isOffline = !host.isOnline;
  const [copiedMac, setCopiedMac] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [dispatchedAction, setDispatchedAction] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const glintRafRef = useRef<number | null>(null);

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
      if (glintRafRef.current !== null) {
        cancelAnimationFrame(glintRafRef.current);
        glintRafRef.current = null;
      }
    };
  }, []);

  const handleCardMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (glintRafRef.current !== null) return;
    glintRafRef.current = requestAnimationFrame(() => {
      glintRafRef.current = null;
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--glint-x', `${clientX - rect.left}px`);
      el.style.setProperty('--glint-y', `${clientY - rect.top}px`);
    });
  }, []);

  const handleCopyMac = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!host.mac) return;
    triggerHapticFeedback('light');
    const ok = await copyToClipboard(host.mac);
    if (ok) {
      setCopiedMac(true);
      onNotify?.(t('host_copied_mac', { value: host.mac }));
      scheduleTimer(() => setCopiedMac(false), 1800);
    }
  };

  const handleCopyIp = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!host.ip) return;
    triggerHapticFeedback('light');
    const ok = await copyToClipboard(host.ip);
    if (ok) {
      setCopiedIp(true);
      onNotify?.(t('host_copied_ip', { value: host.ip }));
      scheduleTimer(() => setCopiedIp(false), 1600);
    }
  };

  const connectionUri = buildHostWsUri(host.ip, host.port || 8765);

  const handleCopyUri = async (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHapticFeedback('light');
    const ok = await copyToClipboard(connectionUri);
    if (ok) {
      setCopiedUri(true);
      onNotify?.(t('host_copied_endpoint', { value: connectionUri }));
      scheduleTimer(() => setCopiedUri(false), 1800);
    }
  };

  const handleQuickAction = (e: React.MouseEvent, actionId: string, command: string) => {
    e.stopPropagation();
    if (actionId === 'restart' && !confirmRestart) {
      triggerHapticFeedback('warning');
      setConfirmRestart(true);
      scheduleTimer(() => setConfirmRestart(false), 3500);
      return;
    }
    setConfirmRestart(false);
    triggerHapticFeedback('medium');
    if (actionId === 'lock' && onSendInputOpcode && isSelected) {
      const sent = onSendInputOpcode(0x09, { type: 'lock_pc' });
      if (sent) {
        setDispatchedAction(actionId);
        scheduleTimer(() => {
          setDispatchedAction((prev) => (prev === actionId ? null : prev));
        }, 1500);
        return;
      }
    }
    if (onQuickCommand) {
      setDispatchedAction(actionId);
      onQuickCommand(command, host.id);
      scheduleTimer(() => {
        setDispatchedAction((prev) => (prev === actionId ? null : prev));
      }, 1500);
    } else if (onSelectForCommand) {
      onSelectForCommand(host.id);
    }
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
  const validMac = hasUsableMac(host.mac);

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
      iconTone: 'text-sky-400',
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
      iconTone: 'text-emerald-400',
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
      iconTone: 'text-violet-400',
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
      iconTone: 'text-amber-400',
      command:
        host.os === 'windows'
          ? 'shutdown /r /t 30 /c "Scheduled maintenance restart"'
          : 'sudo shutdown -r +1 "Scheduled maintenance restart"',
      variant: 'warning' as const,
    },
  ];

  const wakeProgressPct =
    remainingWakeSeconds !== undefined
      ? Math.min(100, Math.max(4, Math.round(((45 - remainingWakeSeconds) / 45) * 100)))
      : 0;

  return (
    <div className="contain-paint-layout">
      <div
        onMouseMove={handleCardMouseMove}
        className={`
          glass-liquid liquid-glint w-full max-w-full rounded-[26px] p-4 text-left select-none relative overflow-hidden
          ${isSelected ? 'iridescent-active-rim' : isPinned ? 'ring-1 ring-amber-400/35' : ''}
          ${isOffline ? 'opacity-95' : ''}
        `}
      >
        {/* Top Header Row: Device Badge + Generous Title + Non-Redundant Action Controls */}
        <div className="flex items-center justify-between gap-2.5 relative z-[1]">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <motion.button
              type="button"
              whileHover={{ scale: 1.07, rotate: -3 }}
              whileTap={{ scale: 0.9 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                onSelect(host.id);
                onToggleExpand(host.id);
              }}
              className={`
                w-10 h-10 squircle-badge flex items-center justify-center shrink-0 relative cursor-pointer
                ${
                  isOffline
                    ? remainingWakeSeconds !== undefined
                      ? 'squircle-amber'
                      : 'squircle-slate'
                    : isHighLoadAnomaly
                    ? 'squircle-rose'
                    : host.deviceType === 'server'
                    ? 'squircle-sky'
                    : 'squircle-hero'
                }
              `}
              aria-label={host.name || safeId}
            >
              <DeviceIcon className="w-5 h-5" />
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white shadow-sm ${
                  isOffline ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
            </motion.button>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    onSelect(host.id);
                    onToggleExpand(host.id);
                  }}
                  className="text-fluid-card-title font-extrabold ink-primary tracking-tight truncate text-left hover:text-cyan-400 transition cursor-pointer"
                  title={host.name || safeId}
                >
                  {host.name || safeId}
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                <span className="text-[10.5px] font-mono ink-muted truncate">
                  {osBadge}
                  {host.isOnline && host.lastSeen ? ` · ${host.lastSeen}` : ''}
                </span>
                {isQuarantined && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/35 text-[9.5px] font-mono font-bold text-rose-400 shrink-0">
                    {t('host_quarantined')}
                  </span>
                )}
                {isCircuitTripped && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/35 text-[9.5px] font-mono font-bold text-amber-400 shrink-0">
                    {t('host_circuit_tripped')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: 1-Tap Action Controls (hide redundant Terminal/Screen buttons when expanded) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {!isExpanded &&
              (isOffline ? (
                remainingWakeSeconds !== undefined ? (
                  <div className="h-9 px-3 rounded-full bg-amber-500/15 border border-amber-400/45 flex items-center gap-1.5 text-amber-400 text-[11px] font-mono font-bold">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{remainingWakeSeconds}s</span>
                  </div>
                ) : (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.06, y: -1 }}
                    whileTap={{ scale: 0.9 }}
                    transition={SPRING_POP}
                    onClick={(e) => onWakeClick(e, host)}
                    className="h-9 px-3 rounded-full squircle-amber preserve-white flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                    title={t('host_wake_tooltip')}
                    aria-label={t('host_wake_tooltip')}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">
                      {currentLang === 'bg' ? 'Събуди' : 'Wake'}
                    </span>
                  </motion.button>
                )
              ) : (
                <>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.08, y: -1 }}
                    whileTap={{ scale: 0.88 }}
                    transition={SPRING_POP}
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('light');
                      onSelectForCommand?.(host.id);
                    }}
                    className="w-9 h-9 rounded-full liquid-control-pill text-cyan-400 flex items-center justify-center cursor-pointer"
                    title={t('host_terminal_tooltip')}
                    aria-label={t('host_terminal_tooltip')}
                  >
                    <TerminalSquare className="w-4 h-4" />
                  </motion.button>

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.08, y: -1 }}
                    whileTap={{ scale: 0.88 }}
                    transition={SPRING_POP}
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('light');
                      onViewScreen(host);
                    }}
                    className="w-9 h-9 rounded-full squircle-sky preserve-white flex items-center justify-center cursor-pointer"
                    title={t('host_screen_tooltip')}
                    aria-label={t('host_screen_tooltip')}
                  >
                    <ScanEye className="w-4 h-4" />
                  </motion.button>
                </>
              ))}

            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.88 }}
              transition={SPRING_POP}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(host.id);
              }}
              aria-expanded={isExpanded}
              className={`w-9 h-9 rounded-full flex items-center justify-center cursor-pointer ${
                isExpanded
                  ? 'liquid-hero-btn'
                  : 'liquid-control-pill ink-secondary hover:ink-primary'
              }`}
              title={isExpanded ? t('host_hide_details_btn') : t('host_details_btn')}
              aria-label={isExpanded ? t('host_hide_details_btn') : t('host_details_btn')}
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </motion.button>
          </div>
        </div>

        {/* Clean Metadata & Connection/Latency Status Pills Row (No dangling dots, generous hit targets) */}
        <div className="flex items-center flex-wrap gap-1.5 mt-2.5 tabular-nums relative z-[1]">
          <button
            type="button"
            onClick={handleCopyIp}
            className={`min-h-[28px] px-2.5 py-0.5 rounded-full border font-mono text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer ${
              copiedIp
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                : 'liquid-control-pill text-cyan-400'
            }`}
            title={t('host_copy_ip')}
            aria-label={t('host_copy_ip')}
          >
            <span>{copiedIp ? t('host_copied_short') : host.ip}</span>
            {copiedIp ? (
              <Check className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-3 h-3 opacity-65 shrink-0" />
            )}
          </button>

          {isOffline ? (
            <span
              className={`min-h-[28px] px-2.5 py-0.5 rounded-full border text-[11px] font-semibold inline-flex items-center gap-1.5 ${
                remainingWakeSeconds !== undefined
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              }`}
              title={latencyConfig.tooltip}
            >
              <WifiOff className="w-3 h-3 shrink-0" />
              <span>
                {remainingWakeSeconds !== undefined
                  ? `${t('host_waking_seconds')} ${remainingWakeSeconds}s`
                  : currentLang === 'bg'
                  ? 'Спящ (WoL)'
                  : 'Sleeping (WoL)'}
              </span>
            </span>
          ) : (
            <span
              className={`min-h-[28px] px-2.5 py-0.5 rounded-full border font-mono text-[11px] font-bold inline-flex items-center gap-1.5 ${latencyConfig.colorBg} ${latencyConfig.colorBorder} ${latencyConfig.colorText}`}
              title={latencyConfig.tooltip}
            >
              <span className="inline-flex items-end gap-[2px] h-2.5" aria-hidden="true">
                {latencyConfig.bars.map((bar: { height: string; color: string }, i: number) => (
                  <span
                    key={i}
                    style={{ height: bar.height }}
                    className={`w-[3px] rounded-full ${bar.color}`}
                  />
                ))}
              </span>
              <span>{rttMs}ms</span>
            </span>
          )}

          {isLaptop && safeBatteryPct !== undefined && batteryConfig && (
            <span
              className={`min-h-[28px] px-2.5 py-0.5 rounded-full border text-[11px] font-mono font-semibold inline-flex items-center gap-1 ${batteryConfig.colorBorder} ${batteryConfig.colorText}`}
            >
              <BatteryIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{safeBatteryPct}%</span>
              {host.isCharging && <Zap className="w-2.5 h-2.5 text-amber-400 fill-current shrink-0" />}
            </span>
          )}

          {onTogglePin && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.88 }}
              transition={SPRING_POP}
              onClick={(e) => {
                e.stopPropagation();
                triggerHapticFeedback('selection');
                onTogglePin(host.id);
              }}
              className={`ml-auto min-w-[32px] h-7 px-2 rounded-full border inline-flex items-center justify-center transition shrink-0 cursor-pointer ${
                isPinned
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                  : 'liquid-control-pill ink-muted hover:text-amber-400'
              }`}
              title={isPinned ? t('host_unpin') : t('host_pin')}
              aria-label={isPinned ? t('host_unpin') : t('host_pin')}
              aria-pressed={isPinned}
            >
              <Star
                className={`w-3.5 h-3.5 ${isPinned ? 'fill-amber-400 text-amber-400' : ''}`}
              />
            </motion.button>
          )}
        </div>

        {/* Offline WoL Readiness / Waking Countdown Footer Strip */}
        {isOffline && (
          <div className="mt-3 pt-2.5 border-t border-white/[0.08] space-y-2 relative z-[1]">
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
              {validMac ? (
                <button
                  type="button"
                  onClick={handleCopyMac}
                  className={`min-h-[28px] px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1.5 transition cursor-pointer truncate max-w-[70%] ${
                    copiedMac
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'liquid-control-pill ink-secondary hover:ink-primary'
                  }`}
                  title={t('host_copy_mac')}
                  aria-label={t('host_copy_mac')}
                >
                  <span className="truncate">{copiedMac ? t('host_copied_short') : host.mac}</span>
                  {copiedMac ? (
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-60 shrink-0" />
                  )}
                </button>
              ) : (
                <span className="text-[11px] ink-muted italic">{t('host_wol_no_mac')}</span>
              )}

              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                  validMac
                    ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-400'
                    : 'bg-slate-500/10 border-slate-400/25 ink-muted'
                }`}
              >
                {validMac ? t('host_wol_ready') : t('host_wol_no_mac')}
              </span>
            </div>

            {remainingWakeSeconds !== undefined && (
              <div className="h-1.5 w-full rounded-full telemetry-track overflow-hidden">
                <div
                  style={{ width: `${wakeProgressPct}%` }}
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-emerald-400 transition-all duration-700"
                />
              </div>
            )}
          </div>
        )}

        {/* Vivid Glossy Telemetry Bars */}
        {host.isOnline && (
          <div className="mt-3 pt-2.5 border-t border-white/[0.08] space-y-2 relative z-[1]">
            <div className="grid grid-cols-2 gap-3.5 items-center">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10.5px] font-mono tabular-nums">
                  <span className="ink-muted font-semibold">CPU</span>
                  <span
                    className={
                      cpuVal >= 75 ? 'text-rose-400 font-bold' : 'text-sky-400 font-bold'
                    }
                  >
                    {cpuVal}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full telemetry-track overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, Math.max(0, cpuVal))}%` }}
                    className={`h-full rounded-full transition-all duration-300 ${
                      cpuVal >= 75
                        ? 'bg-gradient-to-r from-rose-500 via-pink-500 to-amber-400 telemetry-glow-rose'
                        : 'bg-gradient-to-r from-sky-400 via-cyan-400 to-violet-500 telemetry-glow-cyan'
                    }`}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10.5px] font-mono tabular-nums">
                  <span className="ink-muted font-semibold">RAM</span>
                  <span
                    className={
                      ramVal >= 75 ? 'text-amber-400 font-bold' : 'text-violet-400 font-bold'
                    }
                  >
                    {ramVal}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full telemetry-track overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, Math.max(0, ramVal))}%` }}
                    className={`h-full rounded-full transition-all duration-300 ${
                      ramVal >= 75
                        ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-500 telemetry-glow-amber'
                        : 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-400 telemetry-glow-violet'
                    }`}
                  />
                </div>
              </div>
            </div>

            {isHighLoadAnomaly && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[10.5px] font-mono text-rose-400 font-semibold flex items-center gap-1.5 truncate">
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 animate-pulse" />
                  <span className="truncate">
                    {currentLang === 'bg'
                      ? `Високо натоварване (${cpuVal}% / ${ramVal}%)`
                      : `High load (${cpuVal}% CPU / ${ramVal}% RAM)`}
                  </span>
                </span>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.91 }}
                  transition={SPRING_POP}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHapticFeedback('medium');
                    onDiagnoseHost?.(host);
                  }}
                  className="px-3 py-1 rounded-full squircle-violet preserve-white text-[10.5px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{currentLang === 'bg' ? 'AI Анализ' : 'AI Diagnose'}</span>
                </motion.button>
              </div>
            )}
          </div>
        )}

        {/* Expanded Control & Telemetry Drawer */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING_BUBBLY}
              className="overflow-hidden relative z-[1]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mt-3.5 pt-3.5 border-t border-white/[0.08] space-y-3">
                {/* Primary Remote Control Actions */}
                <div className="grid grid-cols-3 gap-2">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03, y: -1 }}
                    whileTap={{ scale: 0.92 }}
                    transition={SPRING_POP}
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('medium');
                      if (host.isOnline) {
                        onViewScreen(host);
                      } else {
                        onWakeClick(e, host);
                      }
                    }}
                    className={`min-h-[40px] px-2.5 py-2 rounded-full text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                      host.isOnline
                        ? 'squircle-sky preserve-white'
                        : 'squircle-amber preserve-white'
                    }`}
                  >
                    {host.isOnline ? (
                      <>
                        <ScanEye className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {currentLang === 'bg' ? 'Екран' : 'Screen'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Power className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {currentLang === 'bg' ? 'Събуди' : 'Wake PC'}
                        </span>
                      </>
                    )}
                  </motion.button>

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03, y: -1 }}
                    whileTap={{ scale: 0.92 }}
                    transition={SPRING_POP}
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('light');
                      onSelectForCommand?.(host.id);
                    }}
                    className="min-h-[40px] px-2.5 py-2 rounded-full liquid-control-pill text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <TerminalSquare className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">
                      {currentLang === 'bg' ? 'Терминал' : 'Terminal'}
                    </span>
                  </motion.button>

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.03, y: -1 }}
                    whileTap={{ scale: 0.92 }}
                    transition={SPRING_POP}
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerHapticFeedback('light');
                      onOpenDetailsModal(host);
                    }}
                    className="min-h-[40px] px-2.5 py-2 rounded-full liquid-control-pill text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Info className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span className="truncate">
                      {currentLang === 'bg' ? 'Детайли' : 'Details'}
                    </span>
                  </motion.button>
                </div>

                {/* 1-Tap Quick OS Actions */}
                <div className="rounded-2xl glass-liquid-subtle p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider ink-muted font-bold">
                      {currentLang === 'bg' ? 'Бързи OS Команди' : 'Quick OS Actions'}
                    </span>
                    <span className="text-[10px] font-mono font-semibold text-cyan-400">
                      {host.os === 'windows' ? 'PowerShell' : 'Systemd'}
                    </span>
                  </div>

                  {isOffline ? (
                    <div className="text-[11px] ink-muted py-1.5 flex items-center gap-1.5">
                      <Power className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>
                        {currentLang === 'bg'
                          ? 'Събудете хоста чрез WoL, за да изпълнявате OS команди.'
                          : 'Wake host via WoL to dispatch live OS actions.'}
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {quickActions.map((act) => {
                        const ActIcon = act.icon;
                        const isDispatched = dispatchedAction === act.id;
                        const isWarning = act.variant === 'warning';
                        return (
                          <motion.button
                            key={act.id}
                            type="button"
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.94 }}
                            transition={SPRING_POP}
                            onClick={(e) => handleQuickAction(e, act.id, act.command)}
                            className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-left transition flex items-center gap-2 cursor-pointer ${
                              isDispatched
                                ? 'squircle-emerald preserve-white border-white/40'
                                : isWarning
                                ? 'bg-amber-500/14 hover:bg-amber-500/22 border-amber-500/40 text-amber-400'
                                : 'liquid-control-pill'
                            }`}
                          >
                            {isDispatched ? (
                              <Check className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <ActIcon className={`w-3.5 h-3.5 shrink-0 ${act.iconTone}`} />
                            )}
                            <span className="font-display text-[11px] font-bold leading-tight truncate">
                              {isDispatched
                                ? currentLang === 'bg'
                                  ? 'Изпратено'
                                  : 'Sent'
                                : act.label}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Network & Hardware Telemetry Strip */}
                <div className="rounded-2xl glass-liquid-subtle px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  {host.mac ? (
                    <button
                      type="button"
                      onClick={handleCopyMac}
                      className={`min-h-[28px] px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1.5 transition cursor-pointer ${
                        copiedMac
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                          : 'liquid-control-pill ink-primary'
                      }`}
                      title={t('host_copy_mac')}
                      aria-label={t('host_copy_mac')}
                    >
                      <span className="ink-muted">MAC</span>
                      <span className="font-semibold">
                        {copiedMac ? t('host_copied_short') : host.mac}
                      </span>
                      {copiedMac ? (
                        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                      ) : (
                        <Copy className="w-3 h-3 opacity-60 shrink-0" />
                      )}
                    </button>
                  ) : (
                    <span className="ink-muted">MAC: —</span>
                  )}

                  {host.diskUsage && (
                    <div className="min-h-[28px] px-2.5 py-0.5 rounded-full liquid-control-pill flex items-center gap-1.5">
                      <HardDrive className="w-3 h-3 text-sky-400 shrink-0" />
                      <span className="ink-muted">
                        {currentLang === 'bg' ? 'Диск' : 'Disk'}
                      </span>
                      <span className="ink-primary font-semibold">{host.diskUsage}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCopyUri}
                    className={`min-h-[28px] px-2.5 py-0.5 rounded-full border text-[10.5px] flex items-center gap-1.5 max-w-full cursor-pointer transition ${
                      copiedUri
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                        : 'liquid-control-pill text-cyan-400'
                    }`}
                    title={t('host_copy_endpoint')}
                    aria-label={t('host_copy_endpoint')}
                  >
                    {copiedUri ? (
                      <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <Link2 className="w-3 h-3 text-cyan-400 shrink-0" />
                    )}
                    <span className="truncate">
                      {copiedUri ? t('host_copied_short') : connectionUri}
                    </span>
                  </button>

                  <div className="flex items-center gap-2 ml-auto">
                    <InlineMiniSparkline
                      history={host.latencyHistory}
                      ping={host.ping}
                      isOnline={host.isOnline}
                      level={latencyConfig.level}
                    />
                    <span className={`font-bold ${latencyConfig.colorText}`}>
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
    prev.host.latencyHistory === next.host.latencyHistory &&
    prev.onNotify === next.onNotify
  );
});
