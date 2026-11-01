import React from 'react';
import { motion } from 'motion/react';
import { HostDevice } from '../types';
import { BottomSheet } from './ui/BottomSheet';
import { HostLatencySparkline } from './HostLatencySparkline';
import {
  Monitor,
  Laptop,
  Server,
  Power,
  Terminal,
  Eye,
  Copy,
  Clock,
  Tag,
  ShieldAlert,
  ShieldOff,
  RotateCcw,
  Zap,
  Edit3,
  Trash2,
} from 'lucide-react';
import { triggerHapticFeedback } from '../services/hapticService';
import { getBatteryConfig } from './HostCard';
import { useTranslation } from '../i18n/useTranslation';
import { copyToClipboard as copySafe } from '../utils/clipboard';

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

  if (!host) return null;

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

  const copyToClipboard = (text: string) => {
    triggerHapticFeedback('light');
    copySafe(text);
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={host.name}
      subtitle={
        language === 'bg'
          ? `Детайли за хост и мрежова телеметрия (${host.ip})`
          : `Host specifications & network telemetry (${host.ip})`
      }
    >
      <div className="space-y-4 select-none font-sans">
        {/* Top Host Profile Banner */}
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
          <div className="flex items-center space-x-3.5 min-w-0">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                host.isOnline
                  ? 'glass-liquid text-cyan-400 border-cyan-400/40 shadow-[0_4px_16px_rgba(6,182,212,0.2)]'
                  : 'glass-liquid text-white/40 border-white/10'
              }`}
            >
              <DeviceIcon className="w-6 h-6" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-white text-base break-words">{host.name}</span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                    host.isOnline
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-white/5 text-white/50 border-white/10'
                  }`}
                >
                  {host.isOnline
                    ? language === 'bg'
                      ? 'ОНЛАЙН'
                      : 'ONLINE'
                    : language === 'bg'
                    ? 'ПРИСПАН'
                    : 'SLEEPING'}
                </span>
              </div>
              <p className="text-xs text-white/50 font-mono mt-0.5">{host.ip} • {host.mac}</p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            {host.isOnline ? (
              <span className="flex items-center space-x-1 text-emerald-400 text-xs font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
                <span className="hidden sm:inline">
                  {language === 'bg' ? 'mDNS активен' : 'mDNS Active'}
                </span>
              </span>
            ) : (
              <span className="flex items-center space-x-1 text-amber-400/80 text-xs font-mono">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="hidden sm:inline">
                  {language === 'bg' ? 'Готов за WoL' : 'WoL Ready'}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* 30-Second Latency Sparkline Chart Component */}
        <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10">
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
          <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1">
            <span className="text-white/40 text-[10px] block">
              {language === 'bg' ? 'IP АДРЕС' : 'IP ADDRESS'}
            </span>
            <div className="flex items-center justify-between">
              <span className="text-cyan-300 font-bold">{host.ip}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(host.ip)}
                className="text-white/40 hover:text-white transition p-1 cursor-pointer"
                title={language === 'bg' ? 'Копирай IP' : 'Copy IP'}
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1">
            <span className="text-white/40 text-[10px] block">
              {language === 'bg' ? 'MAC АДРЕС' : 'MAC ADDRESS'}
            </span>
            <div className="flex items-center justify-between">
              <span className="text-white/80 font-medium truncate">{host.mac}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(host.mac)}
                className="text-white/40 hover:text-white transition p-1 cursor-pointer"
                title={language === 'bg' ? 'Копирай MAC' : 'Copy MAC'}
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1">
            <span className="text-white/40 text-[10px] block">
              {language === 'bg' ? 'CST ПОРТ АГЕНТ' : 'CST AGENT PORT'}
            </span>
            <span className="text-emerald-400 font-bold block">{host.port || 8765} (TCP/WS)</span>
          </div>

          <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1">
            <span className="text-white/40 text-[10px] block">
              {language === 'bg' ? 'ОПЕРАЦИОННА СИСТЕМА' : 'OPERATING SYSTEM'}
            </span>
            <span className="text-white/90 font-medium capitalize block">
              {host.os === 'windows' ? 'Windows 11 Pro' : 'Linux Kernel 6.8'}
            </span>
          </div>

          <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1">
            <span className="text-white/40 text-[10px] block">
              {language === 'bg' ? 'ПРОЦЕСОР (CPU)' : 'PROCESSOR (CPU)'}
            </span>
            <div className="flex items-center space-x-2">
              <span className="text-white font-bold">{host.cpuUsage ?? 0}%</span>
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                  style={{ width: `${host.cpuUsage ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1">
            <span className="text-white/40 text-[10px] block">
              {language === 'bg' ? 'ПАМЕТ (RAM)' : 'MEMORY (RAM)'}
            </span>
            <div className="flex items-center space-x-2">
              <span className="text-white font-bold">{host.ramUsage ?? 0}%</span>
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-400 rounded-full transition-all duration-500"
                  style={{ width: `${host.ramUsage ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1">
            <span className="text-white/40 text-[10px] block">
              {language === 'bg' ? 'ДИСКОВО ПРОСТРАНСТВО' : 'DISK STORAGE'}
            </span>
            <span className="text-white/80 truncate block">{host.diskUsage || 'N/A'}</span>
          </div>

          {host.batteryPercentage !== undefined && (
            <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1">
              <span className="text-white/40 text-[10px] block">
                {language === 'bg' ? 'БАТЕРИЯ (ЛАПТОП)' : 'BATTERY (LAPTOP)'}
              </span>
              <div className="flex items-center space-x-2">
                <span className={`font-bold ${getBatteryConfig(host.batteryPercentage, host.isCharging).colorText}`}>
                  {host.batteryPercentage}%
                </span>
                <span className="text-[10px] text-white/50">
                  {host.isCharging
                    ? language === 'bg'
                      ? 'Зарежда се'
                      : 'Charging'
                    : language === 'bg'
                    ? 'На батерия'
                    : 'On Battery'}
                </span>
                {host.isCharging && <Zap className="w-3 h-3 text-amber-300 fill-current animate-pulse" />}
              </div>
            </div>
          )}

          <div className="glass-liquid p-3 rounded-xl border border-white/5 space-y-1 col-span-2">
            <span className="text-white/40 text-[10px] block">
              {language === 'bg' ? 'ПОСЛЕДНА ТЕЛЕМЕТРИЯ' : 'LAST TELEMETRY'}
            </span>
            <span className="text-white/80 truncate block flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>{host.lastSeen}</span>
            </span>
          </div>
        </div>

        {/* Tags */}
        {host.tags && host.tags.length > 0 && (
          <div className="flex items-center space-x-2 flex-wrap gap-y-1.5 pt-1">
            <span className="text-white/40 text-xs font-mono flex items-center space-x-1">
              <Tag className="w-3 h-3" />
              <span>{language === 'bg' ? 'Етикети:' : 'Tags:'}</span>
            </span>
            {host.tags.map((tag) => (
              <span
                key={tag}
                className="glass-liquid px-2.5 py-0.5 rounded-full text-xs font-mono text-cyan-300 border border-cyan-400/20"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Security & Failsafe Actions */}
        <div className="p-3 bg-white/[0.02] border border-white/10 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                {language === 'bg' ? 'Защита и Мрежова Изолация' : 'Security & Network Isolation'}
              </span>
            </span>
            {isQuarantined && (
              <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-[10px] font-bold">
                {language === 'bg' ? 'ПОД КАРАНТИНА' : 'QUARANTINED'}
              </span>
            )}
            {isCircuitTripped && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-bold">
                {language === 'bg' ? 'ПРЕКЪСВАЧ: АКТИВЕН' : 'CIRCUIT TRIPPED'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <motion.button
              type="button"
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.93 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              onClick={() => {
                triggerHapticFeedback('warning');
                onToggleQuarantine?.(host.id);
              }}
              className={`flex-1 min-h-[44px] py-2.5 px-4 rounded-full text-xs font-semibold border transition flex items-center justify-center space-x-1.5 cursor-pointer ${
                isQuarantined
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-200 hover:bg-rose-500/30'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              {isQuarantined ? <ShieldOff className="w-3.5 h-3.5 text-rose-400" /> : <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />}
              <span>
                {isQuarantined
                  ? language === 'bg'
                    ? 'Освободи от Карантина'
                    : 'Release from Quarantine'
                  : language === 'bg'
                  ? 'Постави под Карантина'
                  : 'Quarantine Host'}
              </span>
            </motion.button>

            {isCircuitTripped && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.93 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                onClick={() => {
                  triggerHapticFeedback('light');
                  onResetCircuit?.(host.id);
                }}
                className="min-h-[44px] py-2.5 px-4 rounded-full text-xs font-semibold bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30 transition flex items-center space-x-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{language === 'bg' ? 'Нулирай прекъсвач' : 'Reset Circuit'}</span>
              </motion.button>
            )}
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center space-x-2 pt-2 border-t border-white/10">
          {host.isOnline ? (
            <>
              <motion.button
                type="button"
                whileHover={{ scale: 1.04, y: -1.5 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                onClick={() => {
                  triggerHapticFeedback('medium');
                  onClose();
                  onSelectForTerminal?.(host.id);
                }}
                className="flex-1 min-h-[44px] py-3 px-4 rounded-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-bold text-xs border border-cyan-400/40 transition flex items-center justify-center space-x-2 shadow-[0_4px_16px_rgba(6,182,212,0.2)] cursor-pointer"
              >
                <Terminal className="w-4 h-4" />
                <span>{language === 'bg' ? 'Отвори терминал' : 'Open Terminal'}</span>
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.04, y: -1.5 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                onClick={() => {
                  triggerHapticFeedback('medium');
                  onClose();
                  onViewScreen?.(host);
                }}
                className="flex-1 min-h-[44px] py-3 px-4 rounded-full glass-liquid hover:brightness-110 text-white font-semibold text-xs border border-white/20 transition flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Eye className="w-4 h-4 text-cyan-400" />
                <span>{language === 'bg' ? 'Преглед на екран' : 'View Screen'}</span>
              </motion.button>
            </>
          ) : (
            <motion.button
              type="button"
              whileHover={{ scale: 1.04, y: -1.5 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 480, damping: 24 }}
              onClick={() => {
                triggerHapticFeedback('heavy');
                onClose();
                onSendWol?.(host);
              }}
              className="w-full min-h-[44px] py-3.5 px-4 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-xs border border-amber-400/40 transition flex items-center justify-center space-x-2 shadow-[0_4px_16px_rgba(245,158,11,0.25)] cursor-pointer"
            >
              <Power className="w-4 h-4" />
              <span>{language === 'bg' ? 'Събуди през Wake-on-LAN' : 'Wake via Wake-on-LAN'}</span>
            </motion.button>
          )}
        </div>

        {/* Host Management: Edit & Remove Host */}
        {(onEditHost || onDeleteHost) && (
          <div className="flex items-center gap-2 pt-2 border-t border-white/10">
            {onEditHost && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onClose();
                  onEditHost(host);
                }}
                className="flex-1 min-h-[42px] py-2.5 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/12 text-slate-200 hover:text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                <span>{language === 'bg' ? 'Редактирай Хост' : 'Edit Host'}</span>
              </button>
            )}
            {onDeleteHost && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('warning');
                  onDeleteHost(host.id);
                  onClose();
                }}
                className="flex-1 min-h-[42px] py-2.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 hover:text-rose-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>{language === 'bg' ? 'Премахни Хост' : 'Remove Host'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
};
