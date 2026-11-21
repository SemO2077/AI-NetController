import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { HostDevice } from '../../types';
import { BottomSheet } from '../ui/BottomSheet';
import { HostLatencySparkline } from '../telemetry/HostLatencySparkline';
import {
  Monitor,
  Laptop,
  Server,
  Power,
  Terminal,
  Eye,
  Copy,
  Check,
  Clock,
  Tag,
  ShieldAlert,
  ShieldOff,
  RotateCcw,
  Zap,
  Edit3,
  Trash2,
  ChevronDown,
  X,
} from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { getBatteryConfig } from '../fleet/HostCard';
import { useTranslation } from '../../i18n/useTranslation';
import { copyToClipboard as copySafe } from '../../utils/clipboard';
import { clampPercentage } from '../../utils/viewportScale';

interface HostDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  host: HostDevice | null;
  isQuarantined?: boolean;
  onToggleQuarantine?: (hostId: string) => void;
  isCircuitTripped?: boolean;
  onResetCircuit?: (hostId: string) => void;
  onSelectForTerminal?: (hostId: string) => void;
  onViewScreen?: (host: HostDevice) => void;
  onSendWol?: (host: HostDevice) => void;
  onEditHost?: (host: HostDevice) => void;
  onDeleteHost?: (hostId: string) => void;
}

export const HostDetailsModal: React.FC<HostDetailsModalProps> = ({
  isOpen,
  onClose,
  host,
  isQuarantined = false,
  onToggleQuarantine,
  isCircuitTripped = false,
  onResetCircuit,
  onSelectForTerminal,
  onViewScreen,
  onSendWol,
  onEditHost,
  onDeleteHost,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';
  const [copiedField, setCopiedField] = useState<'ip' | 'mac' | null>(null);
  const [showSecurityDrawer, setShowSecurityDrawer] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setConfirmDelete(false);
    setShowSecurityDrawer(Boolean(isQuarantined || isCircuitTripped));
  }, [host?.id, isOpen, isQuarantined, isCircuitTripped]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (!host) return null;

  const safeCpu = clampPercentage(host.cpuUsage ?? host.cpu ?? 0);
  const safeRam = clampPercentage(host.ramUsage ?? host.ram ?? 0);
  const isMdnsHost = Boolean(host.tags?.some((t) => t.toLowerCase().includes('mdns')));

  let DeviceIcon = Monitor;
  if (host.deviceType === 'laptop' || host.id.includes('LAPTOP') || host.id.includes('WORKSTATION')) {
    DeviceIcon = Laptop;
  } else if (
    host.deviceType === 'server' ||
    host.id.includes('SERVER') ||
    host.id.includes('SRV') ||
    host.id.includes('NFS')
  ) {
    DeviceIcon = Server;
  }

  const copyToClipboard = (text: string, field: 'ip' | 'mac') => {
    triggerHapticFeedback('light');
    copySafe(text);
    setCopiedField(field);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedField(null);
    }, 1600);
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={host.name}
      subtitle={
        isBg
          ? `Детайли за хост и мрежова телеметрия (${host.ip})`
          : `Host specifications & network telemetry (${host.ip})`
      }
    >
      <div className="space-y-4 select-none font-sans">
        {/* Top Host Profile Hero Banner */}
        <div className="flex items-center justify-between gap-3 p-4 rounded-[24px] glass-liquid-subtle">
          <div className="flex items-center space-x-3.5 min-w-0">
            <div
              className={`w-12 h-12 squircle-badge flex items-center justify-center shrink-0 ${
                host.isOnline ? 'squircle-hero' : 'squircle-amber opacity-85'
              }`}
            >
              <DeviceIcon className="w-6 h-6" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center space-x-2 flex-wrap">
                <span className="font-display font-extrabold ink-primary text-base break-words">
                  {host.name}
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border shrink-0 ${
                    host.isOnline
                      ? 'bg-emerald-500/14 text-emerald-400 border-emerald-500/35'
                      : 'bg-amber-500/14 text-amber-400 border-amber-500/35'
                  }`}
                >
                  {host.isOnline
                    ? isBg
                      ? 'Онлайн'
                      : 'Online'
                    : isBg
                    ? 'Спящ'
                    : 'Sleeping'}
                </span>
              </div>
              <p className="text-xs ink-muted font-mono mt-0.5">
                {host.ip} • {host.mac}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            {host.isOnline ? (
              <span className="flex items-center space-x-1.5 text-emerald-400 text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-emerald-500/12 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="hidden sm:inline">
                  {isMdnsHost
                    ? isBg
                      ? 'mDNS активен'
                      : 'mDNS Live'
                    : isBg
                    ? 'Онлайн'
                    : 'Live Host'}
                </span>
              </span>
            ) : (
              <span className="flex items-center space-x-1.5 text-amber-400 text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-amber-500/12 border border-amber-500/30">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="hidden sm:inline">
                  {isBg ? 'Готов за WoL' : 'WoL Ready'}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Primary Hero Action Bar (Up Front!) */}
        <div className="flex items-center gap-2">
          {host.isOnline ? (
            <>
              <motion.button
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.93 }}
                transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                onClick={() => {
                  triggerHapticFeedback('medium');
                  onClose();
                  onSelectForTerminal?.(host.id);
                }}
                className="flex-1 min-h-[42px] py-2.5 px-4 rounded-full liquid-hero-btn font-bold text-xs flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Terminal className="w-4 h-4" />
                <span>{isBg ? 'Отвори терминал' : 'Open Terminal'}</span>
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.93 }}
                transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                onClick={() => {
                  triggerHapticFeedback('medium');
                  onClose();
                  onViewScreen?.(host);
                }}
                className="flex-1 min-h-[42px] py-2.5 px-4 rounded-full liquid-control-pill font-bold text-xs flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Eye className="w-4 h-4 text-sky-400" />
                <span>{isBg ? 'Преглед на екран' : 'View Screen'}</span>
              </motion.button>
            </>
          ) : (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.93 }}
              transition={{ type: 'spring', stiffness: 480, damping: 24 }}
              onClick={() => {
                triggerHapticFeedback('heavy');
                onClose();
                onSendWol?.(host);
              }}
              className="w-full min-h-[44px] py-3 px-4 rounded-full squircle-amber preserve-white font-bold text-xs flex items-center justify-center space-x-2 cursor-pointer"
            >
              <Power className="w-4 h-4" />
              <span>{isBg ? 'Събуди през Wake-on-LAN' : 'Wake via Wake-on-LAN'}</span>
            </motion.button>
          )}
        </div>

        {/* 30-Second Adaptive Latency Sparkline */}
        <div className="p-4 rounded-[24px] glass-liquid-subtle">
          <HostLatencySparkline
            history={host.latencyHistory}
            currentPing={host.ping}
            isOnline={host.isOnline}
            hostId={host.id}
            hostName={host.name}
            timeWindowSeconds={30}
            showSummaryStats={true}
            showTimeAxis={true}
          />
        </div>

        {/* Hardware & System Specifications Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
          <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1">
            <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
              {isBg ? 'IP адрес' : 'IP Address'}
            </span>
            <div className="flex items-center justify-between gap-1">
              <span className="text-cyan-400 font-bold truncate">{host.ip}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(host.ip, 'ip')}
                className="ink-muted hover:ink-primary transition p-1 cursor-pointer"
                title={isBg ? 'Копирай IP' : 'Copy IP'}
              >
                {copiedField === 'ip' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1">
            <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
              {isBg ? 'MAC адрес' : 'MAC Address'}
            </span>
            <div className="flex items-center justify-between gap-1">
              <span className="ink-primary font-semibold truncate">{host.mac}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(host.mac, 'mac')}
                className="ink-muted hover:ink-primary transition p-1 cursor-pointer"
                title={isBg ? 'Копирай MAC' : 'Copy MAC'}
              >
                {copiedField === 'mac' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1">
            <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
              {isBg ? 'Порт на агента' : 'Agent Port'}
            </span>
            <span className="text-emerald-400 font-bold block">{host.port || 8765} (TCP/WS)</span>
          </div>

          <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1">
            <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
              {isBg ? 'Операционна система' : 'OS'}
            </span>
            <span className="ink-primary font-semibold capitalize block">
              {host.os === 'windows' ? 'Windows' : 'Linux'}
            </span>
          </div>

          <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1.5">
            <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
              {isBg ? 'Процесор (CPU)' : 'CPU Load'}
            </span>
            <div className="flex items-center space-x-2">
              <span className="ink-primary font-bold">{safeCpu}%</span>
              <div className="flex-1 h-2 bg-current/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-sky-400 rounded-full transition-all duration-500"
                  style={{ width: `${safeCpu}%` }}
                />
              </div>
            </div>
          </div>

          <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1.5">
            <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
              {isBg ? 'Памет (RAM)' : 'Memory (RAM)'}
            </span>
            <div className="flex items-center space-x-2">
              <span className="ink-primary font-bold">{safeRam}%</span>
              <div className="flex-1 h-2 bg-current/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                  style={{ width: `${safeRam}%` }}
                />
              </div>
            </div>
          </div>

          <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1">
            <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
              {isBg ? 'Дисково пространство' : 'Disk Storage'}
            </span>
            <span className="ink-primary font-medium truncate block">{host.diskUsage || 'N/A'}</span>
          </div>

          {host.batteryPercentage !== undefined && (
            <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1">
              <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
                {isBg ? 'Батерия' : 'Battery'}
              </span>
              <div className="flex items-center space-x-1.5">
                <span className={`font-bold ${getBatteryConfig(host.batteryPercentage, host.isCharging).colorText}`}>
                  {host.batteryPercentage}%
                </span>
                <span className="text-[10px] ink-muted">
                  {host.isCharging
                    ? isBg
                      ? 'Зарежда се'
                      : 'Charging'
                    : isBg
                    ? 'Батерия'
                    : 'Battery'}
                </span>
                {host.isCharging && <Zap className="w-3 h-3 text-amber-400 fill-current animate-pulse" />}
              </div>
            </div>
          )}

          <div className="liquid-terminal-entry p-3 rounded-2xl space-y-1 col-span-2">
            <span className="ink-muted text-[10px] font-sans font-semibold uppercase block">
              {isBg ? 'Последна телеметрия' : 'Last Telemetry'}
            </span>
            <span className="ink-primary truncate flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>{host.lastSeen}</span>
            </span>
          </div>
        </div>

        {/* Tags */}
        {host.tags && host.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <span className="ink-muted text-xs font-mono flex items-center space-x-1">
              <Tag className="w-3 h-3" />
              <span>{isBg ? 'Етикети:' : 'Tags:'}</span>
            </span>
            {host.tags.map((tag) => (
              <span
                key={tag}
                className="liquid-control-pill px-2.5 py-0.5 rounded-full text-xs font-mono text-cyan-400 font-semibold"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Progressive Disclosure: Security & Failsafe Isolation Drawer */}
        <div className="rounded-[24px] glass-liquid-subtle overflow-hidden">
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              setShowSecurityDrawer((v) => !v);
            }}
            className="w-full px-4 py-3 flex items-center justify-between gap-2 text-xs cursor-pointer"
          >
            <span className="font-display font-bold ink-primary flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>
                {isBg ? 'Защита и мрежова изолация' : 'Security & Network Isolation'}
              </span>
              {isQuarantined && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500/16 border border-rose-500/35 text-rose-400 font-mono text-[10px] font-bold">
                  {isBg ? 'Карантина' : 'Quarantined'}
                </span>
              )}
              {isCircuitTripped && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/16 border border-amber-500/35 text-amber-400 font-mono text-[10px] font-bold">
                  {isBg ? 'Прекъсвач' : 'Circuit Tripped'}
                </span>
              )}
            </span>
            <ChevronDown
              className={`w-4 h-4 ink-muted transition-transform duration-150 ${
                showSecurityDrawer ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showSecurityDrawer && (
            <div className="px-4 pb-4 pt-1 border-t border-white/[0.08] flex items-center gap-2 flex-wrap">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  triggerHapticFeedback('warning');
                  onToggleQuarantine?.(host.id);
                }}
                className={`flex-1 min-h-[40px] py-2 px-4 rounded-full text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                  isQuarantined
                    ? 'squircle-rose preserve-white'
                    : 'liquid-control-pill ink-primary'
                }`}
              >
                {isQuarantined ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />}
                <span>
                  {isQuarantined
                    ? isBg
                      ? 'Освободи от карантина'
                      : 'Release from Quarantine'
                    : isBg
                    ? 'Постави под карантина'
                    : 'Quarantine Host'}
                </span>
              </motion.button>

              {isCircuitTripped && (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => {
                    triggerHapticFeedback('light');
                    onResetCircuit?.(host.id);
                  }}
                  className="min-h-[40px] py-2 px-4 rounded-full text-xs font-bold squircle-amber preserve-white flex items-center space-x-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{isBg ? 'Нулирай прекъсвач' : 'Reset Circuit'}</span>
                </motion.button>
              )}
            </div>
          )}
        </div>

        {/* Host Management: Edit & Inline 2-Step Remove Confirmation */}
        {(onEditHost || onDeleteHost) && (
          <div className="flex items-center gap-2 pt-2 border-t border-white/[0.08]">
            {onEditHost && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onClose();
                  onEditHost(host);
                }}
                className="flex-1 min-h-[40px] py-2 px-4 rounded-full liquid-control-pill text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isBg ? 'Редактирай хост' : 'Edit Host'}</span>
              </button>
            )}
            {onDeleteHost &&
              (confirmDelete ? (
                <div className="flex-1 flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/14 border border-rose-500/40">
                  <span className="text-[11px] font-semibold text-rose-400 truncate">
                    {isBg ? 'Премахни?' : 'Remove host?'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('warning');
                        onDeleteHost(host.id);
                        onClose();
                      }}
                      className="px-3 py-1 rounded-full squircle-rose preserve-white text-[11px] font-bold cursor-pointer"
                    >
                      {isBg ? 'Потвърди' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="p-1 rounded-full ink-secondary hover:ink-primary cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    setConfirmDelete(true);
                  }}
                  className="flex-1 min-h-[40px] py-2 px-4 rounded-full bg-rose-500/12 hover:bg-rose-500/20 border border-rose-500/35 text-rose-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isBg ? 'Премахни хост' : 'Remove Host'}</span>
                </button>
              ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
};
