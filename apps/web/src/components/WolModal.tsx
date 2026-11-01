import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap,
  X,
  Copy,
  Check,
  Radio,
  AlertCircle,
  Clock,
  Calendar,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  Monitor,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';
import {
  generateMagicPacket,
  formatHexDump,
  loadWolSchedules,
  saveWolSchedules,
  calculateNextRun,
  formatDaysSummary,
  resolveScheduleTargets,
  localizeWolSchedule,
  DEFAULT_WOL_SCHEDULES,
  TEST_WOL_SCHEDULES,
  WEEKDAYS_MAP,
} from '../services/wolService';
import { triggerHapticFeedback } from '../services/hapticService';
import { HostDevice, Weekday, WolPacketPayload, WolSchedule, WolScheduleTargetType } from '../types';
import { useTranslation } from '../i18n/useTranslation';
import { SPRING_BUBBLY, SPRING_POP } from '../utils/springPhysics';
import { copyToClipboard } from '../utils/clipboard';
import { wolHistoryStore } from '../store/wolHistoryStore';

interface WolModalProps {
  device: HostDevice | null;
  hosts?: HostDevice[];
  isOpen: boolean;
  onClose: () => void;
  onSendPacket: (payload: WolPacketPayload, deviceId: string) => void;
  onTriggerSchedule?: (schedule: WolSchedule) => void;
  schedules?: WolSchedule[];
  onUpdateSchedules?: (schedules: WolSchedule[]) => void;
  initialTab?: 'direct' | 'schedules';
}

export const WolModal: React.FC<WolModalProps> = ({
  device,
  hosts = [],
  isOpen,
  onClose,
  onSendPacket,
  onTriggerSchedule,
  schedules: externalSchedules,
  onUpdateSchedules,
  initialTab = 'direct',
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';

  const [activeTab, setActiveTab] = useState<'direct' | 'schedules'>(initialTab);

  // Direct Packet State
  const [selectedDirectHostId, setSelectedDirectHostId] = useState<string>(device?.id || hosts[0]?.id || 'CUSTOM');
  const [mac, setMac] = useState(device?.mac || hosts[0]?.mac || '');
  const [broadcastIp, setBroadcastIp] = useState('255.255.255.255');
  const [port, setPort] = useState(9);
  const [secureOnPassword, setSecureOnPassword] = useState('');
  const [showAdvancedHex, setShowAdvancedHex] = useState(false);
  const [packet, setPacket] = useState<WolPacketPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Schedules State
  const [schedules, setSchedules] = useState<WolSchedule[]>(() => externalSchedules || loadWolSchedules());
  const [isAddingSchedule, setIsAddingSchedule] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [recentlyFiredId, setRecentlyFiredId] = useState<string | null>(null);

  // Form State for Adding/Editing Schedule
  const [formName, setFormName] = useState('');
  const [formTargetType, setFormTargetType] = useState<WolScheduleTargetType>('all_lab');
  const [formTargetDeviceId, setFormTargetDeviceId] = useState<string>('');
  const [formTargetMac, setFormTargetMac] = useState<string>('');
  const [formTime, setFormTime] = useState('08:00');
  const [formDays, setFormDays] = useState<Weekday[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [formBroadcastIp, setFormBroadcastIp] = useState('192.168.1.255');
  const [formPort, setFormPort] = useState(9);
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (externalSchedules) {
      setSchedules(externalSchedules);
    }
  }, [externalSchedules]);

  useEffect(() => {
    if (device) {
      setSelectedDirectHostId(device.id);
      setMac(device.mac);
      setFormTargetDeviceId(device.id);
      setFormTargetMac(device.mac);
    }
  }, [device]);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    try {
      const generated = generateMagicPacket(mac, broadcastIp, port, secureOnPassword);
      setPacket(generated);
      setError(null);
    } catch {
      setError(
        isBg
          ? 'Невалиден MAC адрес (трябва да съдържа 12 шестнадесетични символа).'
          : 'Invalid MAC address (must contain 12 hexadecimal characters).'
      );
      setPacket(null);
    }
  }, [mac, broadcastIp, port, secureOnPassword, isBg]);

  const persistSchedules = (newSchedules: WolSchedule[]) => {
    setSchedules(newSchedules);
    saveWolSchedules(newSchedules);
    if (onUpdateSchedules) {
      onUpdateSchedules(newSchedules);
    }
  };

  const handleCopyHex = () => {
    if (packet) {
      copyToClipboard(packet.rawHex);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSendDirect = () => {
    if (!packet) return;
    setIsSending(true);
    triggerHapticFeedback('heavy');
    const targetId =
      selectedDirectHostId !== 'CUSTOM' ? selectedDirectHostId : device?.id || 'CUSTOM-MAC';
    setTimeout(() => {
      onSendPacket(packet, targetId);
      setIsSending(false);
      onClose();
    }, 450);
  };

  const handleToggleSchedule = (id: string, currentEnabled: boolean) => {
    triggerHapticFeedback('light');
    const updated = schedules.map((s) => (s.id === id ? { ...s, enabled: !currentEnabled } : s));
    persistSchedules(updated);
  };

  const handleDeleteSchedule = (id: string) => {
    triggerHapticFeedback('medium');
    const updated = schedules.filter((s) => s.id !== id);
    persistSchedules(updated);
  };

  const handleRestoreDefaults = () => {
    triggerHapticFeedback('medium');
    persistSchedules(DEFAULT_WOL_SCHEDULES);
  };

  const handleTestTriggerSchedule = (schedule: WolSchedule) => {
    triggerHapticFeedback('heavy');
    setRecentlyFiredId(schedule.id);
    setTimeout(() => setRecentlyFiredId(null), 2200);

    if (onTriggerSchedule) {
      onTriggerSchedule(schedule);
    } else {
      const targets = resolveScheduleTargets(schedule, hosts);
      targets.forEach((t) => {
        try {
          const p = generateMagicPacket(t.mac, schedule.broadcastIp, schedule.port);
          onSendPacket(p, t.id);
        } catch (e: any) {
          console.error(`Failed to send packet to target ${t.name}:`, e);
          wolHistoryStore.addEntry({
            deviceId: t.id,
            deviceName: t.name,
            mac: t.mac,
            broadcastIp: schedule.broadcastIp,
            port: schedule.port,
            bytesCount: 102,
            status: 'failed',
            source: 'schedule',
            details: `Schedule "${schedule.name}" failed: ${e?.message || 'Invalid target MAC address'}`,
            detailsBg: `Графикът „${schedule.name}“ се провали: ${e?.message || 'Невалиден MAC адрес'}`,
          });
        }
      });
    }

    const timeStr = new Date().toLocaleTimeString(isBg ? 'bg-BG' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const updated = schedules.map((s) =>
      s.id === schedule.id
        ? {
            ...s,
            lastTriggered: isBg ? `Днес в ${timeStr}` : `Today at ${timeStr}`,
          }
        : s
    );
    persistSchedules(updated);
  };

  const handleOpenNewScheduleForm = () => {
    triggerHapticFeedback('light');
    if (isAddingSchedule) {
      setIsAddingSchedule(false);
      setEditingScheduleId(null);
      setFormError(null);
      return;
    }
    setEditingScheduleId(null);
    setFormName(isBg ? 'Събуждане на залата (08:00)' : 'Wake Lab PCs (08:00)');
    setFormTargetType('all_lab');
    setFormTargetDeviceId(hosts[0]?.id || '');
    setFormTargetMac(hosts[0]?.mac || '');
    setFormTime('08:00');
    setFormDays(['mon', 'tue', 'wed', 'thu', 'fri']);
    setFormBroadcastIp('192.168.1.255');
    setFormPort(9);
    setFormNotes('');
    setFormError(null);
    setIsAddingSchedule(true);
  };

  const handleStartEditSchedule = (schedule: WolSchedule) => {
    triggerHapticFeedback('light');
    const localized = localizeWolSchedule(schedule, language);
    setEditingScheduleId(schedule.id);
    setFormName(localized.name);
    setFormTargetType(schedule.targetType);
    setFormTargetDeviceId(schedule.targetDeviceId || hosts[0]?.id || '');
    setFormTargetMac(schedule.targetMac || '');
    setFormTime(schedule.time);
    setFormDays(schedule.days);
    setFormBroadcastIp(schedule.broadcastIp || '192.168.1.255');
    setFormPort(schedule.port || 9);
    setFormNotes(localized.notes);
    setFormError(null);
    setIsAddingSchedule(true);
  };

  const handleSaveFormSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError(isBg ? 'Моля, въведете име на графика.' : 'Please enter a schedule name.');
      return;
    }
    if (!formTime) {
      setFormError(isBg ? 'Моля, изберете час за събуждане.' : 'Please select a wake-up time.');
      return;
    }
    if (formDays.length === 0) {
      setFormError(
        isBg ? 'Изберете поне един ден от седмицата.' : 'Please select at least one day of the week.'
      );
      return;
    }

    let targetName = isBg ? 'Лабораторни компютри' : 'Lab Workstations';
    if (formTargetType === 'all_offline') {
      targetName = isBg ? 'Всички спящи компютри' : 'All Sleeping Hosts';
    } else if (formTargetType === 'all_hosts') {
      targetName = isBg ? 'Всички компютри във флота' : 'All Fleet Hosts';
    } else if (formTargetType === 'specific_device') {
      const found = hosts.find((h) => h.id === formTargetDeviceId);
      targetName = found ? `${found.name} (${found.ip})` : formTargetDeviceId || 'Host';
    } else if (formTargetType === 'custom_mac') {
      targetName = formTargetMac;
    }

    const scheduleObj: WolSchedule = {
      id: editingScheduleId || `sched-${Date.now()}`,
      name: formName.trim(),
      targetType: formTargetType,
      targetDeviceId: formTargetType === 'specific_device' ? formTargetDeviceId : undefined,
      targetMac:
        formTargetType === 'custom_mac'
          ? formTargetMac
          : formTargetType === 'specific_device'
          ? hosts.find((h) => h.id === formTargetDeviceId)?.mac || formTargetMac
          : undefined,
      targetName,
      time: formTime,
      days: formDays,
      enabled: true,
      broadcastIp: formBroadcastIp,
      port: formPort,
      notes: formNotes.trim(),
      createdTimestamp: Date.now(),
    };

    const updated = editingScheduleId
      ? schedules.map((s) => (s.id === editingScheduleId ? scheduleObj : s))
      : [scheduleObj, ...schedules];

    persistSchedules(updated);
    triggerHapticFeedback('medium');
    setIsAddingSchedule(false);
    setEditingScheduleId(null);
    setFormError(null);
  };

  const toggleDayInForm = (day: Weekday) => {
    triggerHapticFeedback('light');
    if (formDays.includes(day)) {
      if (formDays.length > 1) {
        setFormDays(formDays.filter((d) => d !== day));
      }
    } else {
      setFormDays([...formDays, day]);
    }
  };

  const activeDirectHost =
    hosts.find((h) => h.id === selectedDirectHostId) || (selectedDirectHostId === device?.id ? device : null);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center select-none sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-md"
          />

          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
            transition={SPRING_BUBBLY}
            className="
              relative z-10 w-full max-w-2xl
              rounded-t-[2.2rem] sm:rounded-[2rem]
              bg-[#091020]/96 backdrop-blur-3xl
              border border-white/15 border-t-white/25
              shadow-[0_24px_64px_rgba(0,0,0,0.9)]
              flex flex-col overflow-hidden
              transform-gpu
              max-h-[90vh]
            "
          >
            {/* Mobile Drag Handle */}
            <div className="pt-3 pb-1 w-full flex justify-center sm:hidden">
              <div className="w-12 h-1.5 bg-white/20 rounded-full" />
            </div>

            {/* Clean Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-2xl flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-base tracking-tight truncate">
                    {isBg ? 'Събуждане по мрежата (WoL)' : 'Wake-on-LAN Controller'}
                  </h3>
                  <p className="text-xs text-slate-400 truncate">
                    {isBg
                      ? 'Директно събуждане на компютър и автоматични графици'
                      : 'Instant host wake-up & automated recurring schedules'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-white min-w-[40px] min-h-[40px] w-10 h-10 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 transition cursor-pointer shrink-0"
                title={isBg ? 'Затвори' : 'Close'}
                aria-label={isBg ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Segmented 2-Tab Bar */}
            <div className="px-5 sm:px-6 pt-3 pb-1 shrink-0">
              <div className="grid grid-cols-2 gap-1.5 p-1.5 rounded-2xl bg-[#050914] border border-white/10">
                <button
                  id="tab-direct-packet"
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('selection');
                    setActiveTab('direct');
                  }}
                  className={`relative min-h-[40px] px-3 py-2 rounded-xl text-xs font-display font-bold flex items-center justify-center gap-2 transition cursor-pointer z-10 ${
                    activeTab === 'direct' ? 'text-cyan-200' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {activeTab === 'direct' && (
                    <motion.div
                      layoutId="wolActiveTabPill"
                      transition={SPRING_BUBBLY}
                      className="absolute inset-0 rounded-xl bg-cyan-500/20 border border-cyan-400/40 -z-10"
                    />
                  )}
                  <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">{isBg ? 'Директно събуждане' : 'Wake Host Now'}</span>
                </button>

                <button
                  id="tab-recurring-schedules"
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('selection');
                    setActiveTab('schedules');
                  }}
                  className={`relative min-h-[40px] px-3 py-2 rounded-xl text-xs font-display font-bold flex items-center justify-center gap-2 transition cursor-pointer z-10 ${
                    activeTab === 'schedules' ? 'text-amber-200' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {activeTab === 'schedules' && (
                    <motion.div
                      layoutId="wolActiveTabPill"
                      transition={SPRING_BUBBLY}
                      className="absolute inset-0 rounded-xl bg-amber-500/20 border border-amber-400/40 -z-10"
                    />
                  )}
                  <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">{isBg ? 'Графици за събуждане' : 'Wake Schedules'}</span>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-300 shrink-0">
                    {schedules.filter((s) => s.enabled).length}
                  </span>
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto overflow-x-hidden flex-1">
              {/* ========================================================================= */}
              {/* TAB 1: SIMPLIFIED DIRECT WAKE                                             */}
              {/* ========================================================================= */}
              {activeTab === 'direct' && (
                <div className="space-y-4">
                  {/* 1. Quick Target Host Selector */}
                  <div className="p-4 rounded-2xl bg-[#0b1324]/90 border border-white/10 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300 shrink-0">
                          <Monitor className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono text-slate-400">
                            {isBg ? 'Изберете компютър за събуждане' : 'Select Host to Wake'}
                          </div>
                          <div className="text-xs font-bold text-white truncate">
                            {activeDirectHost
                              ? `${activeDirectHost.name} (${activeDirectHost.ip})`
                              : isBg
                              ? 'Ръчно въведен MAC адрес'
                              : 'Custom MAC Address'}
                          </div>
                        </div>
                      </div>

                      <select
                        value={selectedDirectHostId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedDirectHostId(val);
                          const found = hosts.find((h) => h.id === val);
                          if (found) {
                            setMac(found.mac);
                          }
                        }}
                        className="w-full sm:w-60 rounded-xl bg-[#050914] border border-cyan-500/35 px-3 py-2 min-h-[40px] text-xs text-cyan-200 font-mono font-semibold focus:border-cyan-400 focus:outline-none cursor-pointer"
                      >
                        {hosts.map((h) => (
                          <option key={h.id} value={h.id} className="bg-slate-950 text-cyan-200">
                            {h.name} ({h.isOnline ? (isBg ? 'Онлайн' : 'Online') : isBg ? 'Спящ' : 'Sleeping'})
                          </option>
                        ))}
                        <option value="CUSTOM" className="bg-slate-950 text-amber-300">
                          {isBg ? '+ Друг MAC адрес...' : '+ Custom MAC address...'}
                        </option>
                      </select>
                    </div>

                    {/* Streamlined MAC & Broadcast Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2 border-t border-white/[0.06]">
                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                          {isBg ? 'MAC адрес на картата' : 'Target MAC Address'}
                        </label>
                        <input
                          type="text"
                          value={mac}
                          onChange={(e) => {
                            setMac(e.target.value);
                            setSelectedDirectHostId('CUSTOM');
                          }}
                          placeholder="00:1A:2B:3C:4D:5E"
                          className="w-full min-h-[42px] bg-[#050914] border border-white/15 rounded-xl px-3 py-2 text-xs text-cyan-100 font-mono focus:border-cyan-400 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                          {isBg ? 'Мрежов адрес за излъчване' : 'Broadcast IP Address'}
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={broadcastIp}
                            onChange={(e) => setBroadcastIp(e.target.value)}
                            placeholder="255.255.255.255"
                            className="flex-1 min-w-0 min-h-[42px] bg-[#050914] border border-white/15 rounded-xl px-3 py-2 text-xs text-cyan-100 font-mono focus:border-cyan-400 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setBroadcastIp(
                                broadcastIp === '255.255.255.255' ? '192.168.1.255' : '255.255.255.255'
                              )
                            }
                            className="px-2.5 min-h-[42px] rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-[10px] font-mono text-cyan-300 shrink-0 cursor-pointer"
                            title={
                              isBg
                                ? 'Превключи между глобален и локален субнет адрес'
                                : 'Toggle between Global and Subnet broadcast'
                            }
                          >
                            .255
                          </button>
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                          {isBg ? 'UDP порт' : 'UDP Port'}
                        </label>
                        <input
                          type="number"
                          value={port}
                          onChange={(e) => setPort(Number(e.target.value))}
                          className="w-full min-h-[42px] bg-[#050914] border border-white/15 rounded-xl px-2.5 py-2 text-xs text-cyan-100 font-mono text-center focus:border-cyan-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-500/15 border border-rose-500/30 p-3 rounded-xl">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Collapsible Advanced Options & Hex Inspector */}
                  <div className="rounded-2xl bg-[#0b1324]/60 border border-white/10 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        setShowAdvancedHex((prev) => !prev);
                      }}
                      className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Radio className="w-3.5 h-3.5 text-cyan-400" />
                        <span>
                          {isBg
                            ? `Разширени настройки и преглед на пакета (${packet?.bytesCount || 102} байта)`
                            : `Advanced Options & Raw Packet Preview (${packet?.bytesCount || 102} bytes)`}
                        </span>
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                          showAdvancedHex ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    <AnimatePresence initial={false}>
                      {showAdvancedHex && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="px-4 pb-4 space-y-3 border-t border-white/[0.06] pt-3"
                        >
                          <div>
                            <label className="block text-[11px] font-medium text-slate-300 mb-1">
                              {isBg
                                ? 'Парола за събуждане (Опционален 6-байтов ключ)'
                                : 'SecureOn Password (Optional 6-byte hex key)'}
                            </label>
                            <input
                              type="text"
                              value={secureOnPassword}
                              onChange={(e) => setSecureOnPassword(e.target.value)}
                              placeholder={
                                isBg
                                  ? 'Оставете празно за стандартен 102-байтов пакет'
                                  : 'Leave empty for standard 102-byte packet'
                              }
                              className="w-full bg-[#050914] border border-white/15 rounded-xl px-3 py-2 text-xs text-cyan-100 font-mono focus:border-cyan-400 focus:outline-none"
                            />
                          </div>

                          {packet && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-mono text-slate-400">
                                  {isBg ? 'Шестнадесетичен вид на пакета:' : 'Raw Ethernet Hex Payload:'}
                                </span>
                                <button
                                  type="button"
                                  onClick={handleCopyHex}
                                  className="flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 transition px-2 py-1 rounded-lg bg-white/5 cursor-pointer"
                                >
                                  {copied ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                  <span>{copied ? (isBg ? 'Копирано!' : 'Copied!') : isBg ? 'Копирай' : 'Copy Hex'}</span>
                                </button>
                              </div>

                              <div className="bg-[#040A15] border border-cyan-500/20 rounded-xl p-3 font-mono text-[10.5px] text-slate-300 overflow-x-auto leading-relaxed max-h-36">
                                {formatHexDump(packet.rawHex).map((line, idx) => (
                                  <div key={idx} className="whitespace-pre">
                                    <span className="text-slate-500">{line.slice(0, 6)}</span>
                                    {idx === 0 ? (
                                      <>
                                        <span className="text-amber-400 font-bold">{line.slice(6, 24)}</span>
                                        <span className="text-emerald-400">{line.slice(24)}</span>
                                      </>
                                    ) : (
                                      <span className="text-emerald-400">{line.slice(6)}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* ========================================================================= */}
              {/* TAB 2: CLEAN RECURRING SCHEDULES                                          */}
              {/* ========================================================================= */}
              {activeTab === 'schedules' && (
                <div className="space-y-4">
                  {/* Top Bar: Description + New Schedule Button */}
                  <div className="bg-[#0b1324]/90 border border-white/10 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 bg-amber-500/15 border border-amber-500/30 rounded-xl flex items-center justify-center text-amber-400 shrink-0">
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                          {isBg ? 'Автоматични графици за събуждане' : 'Automated Wake-Up Schedules'}
                        </h4>
                        <p className="text-[11px] text-slate-400 truncate">
                          {isBg
                            ? 'Събужда компютрите автоматично в избраните дни и часове'
                            : 'Automatically wakes target hosts at scheduled days and times'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleOpenNewScheduleForm}
                        className={`min-h-[38px] flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl transition border cursor-pointer ${
                          isAddingSchedule
                            ? 'bg-slate-800 text-slate-200 border-slate-700'
                            : 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400'
                        }`}
                      >
                        {isAddingSchedule ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        <span>
                          {isAddingSchedule
                            ? isBg
                              ? 'Затвори'
                              : 'Cancel'
                            : isBg
                            ? 'Нов график'
                            : 'New Schedule'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleRestoreDefaults}
                        className="min-h-[38px] w-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                        title={
                          isBg ? 'Възстанови стандартните графици' : 'Restore default schedules'
                        }
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Streamlined Schedule Creator / Editor Form */}
                  {isAddingSchedule && (
                    <form
                      onSubmit={handleSaveFormSchedule}
                      className="bg-[#060b16] border border-cyan-500/40 rounded-2xl p-4 space-y-3.5 shadow-xl"
                    >
                      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                        <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-cyan-400" />
                          <span>
                            {editingScheduleId
                              ? isBg
                                ? 'Редактиране на график'
                                : 'Edit Wake Schedule'
                              : isBg
                              ? 'Нов график за събуждане'
                              : 'Create Wake Schedule'}
                          </span>
                        </span>
                      </div>

                      {formError && (
                        <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-500/15 border border-rose-500/30 p-2.5 rounded-xl">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{formError}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-300 mb-1">
                            {isBg ? 'Име на графика' : 'Schedule Name'}
                          </label>
                          <input
                            type="text"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder={
                              isBg ? 'напр. Сутрешно събуждане' : 'e.g. Morning Lab Wake-Up'
                            }
                            className="w-full min-h-[40px] bg-[#0b1324] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-400 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-300 mb-1">
                            {isBg ? 'Целеви компютри' : 'Target Hosts'}
                          </label>
                          <select
                            value={formTargetType}
                            onChange={(e) => setFormTargetType(e.target.value as WolScheduleTargetType)}
                            className="w-full min-h-[40px] bg-[#0b1324] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-400 focus:outline-none cursor-pointer"
                          >
                            <option value="all_lab">
                              {isBg ? 'Всички лабораторни компютри' : 'All Lab Workstations'}
                            </option>
                            <option value="all_offline">
                              {isBg ? 'Всички спящи компютри' : 'All Sleeping Hosts'}
                            </option>
                            <option value="all_hosts">
                              {isBg ? 'Всички компютри във флота' : 'All Fleet Hosts'}
                            </option>
                            <option value="specific_device">
                              {isBg ? 'Конкретен компютър от списъка' : 'Specific Host from Fleet'}
                            </option>
                            <option value="custom_mac">
                              {isBg ? 'Ръчно въведен MAC адрес' : 'Custom MAC Address'}
                            </option>
                          </select>
                        </div>
                      </div>

                      {formTargetType === 'custom_mac' && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-300 mb-1">
                            {isBg ? 'Целеви MAC адрес' : 'Target MAC Address'}
                          </label>
                          <input
                            type="text"
                            value={formTargetMac}
                            onChange={(e) => setFormTargetMac(e.target.value)}
                            placeholder="00:1A:2B:3C:4D:5E"
                            className="w-full min-h-[40px] bg-[#0b1324] border border-white/15 rounded-xl px-3 py-2 text-xs text-cyan-200 font-mono focus:border-cyan-400 focus:outline-none"
                          />
                        </div>
                      )}

                      {formTargetType === 'specific_device' && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-300 mb-1">
                            {isBg ? 'Изберете компютър' : 'Select Host'}
                          </label>
                          <select
                            value={formTargetDeviceId}
                            onChange={(e) => {
                              setFormTargetDeviceId(e.target.value);
                              const h = hosts.find((item) => item.id === e.target.value);
                              if (h) setFormTargetMac(h.mac);
                            }}
                            className="w-full min-h-[40px] bg-[#0b1324] border border-white/15 rounded-xl px-3 py-2 text-xs text-cyan-200 font-mono focus:border-cyan-400 focus:outline-none"
                          >
                            {hosts.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name} ({h.ip} • {h.mac})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Time & Weekday Selector Row */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-medium text-slate-300 mb-1">
                            {isBg ? 'Час (24ч)' : 'Wake Time (24h)'}
                          </label>
                          <input
                            type="time"
                            value={formTime}
                            onChange={(e) => setFormTime(e.target.value)}
                            className="w-full min-h-[40px] bg-[#0b1324] border border-white/15 rounded-xl px-3 py-1.5 text-sm text-cyan-200 font-mono font-bold focus:border-cyan-400 focus:outline-none"
                          />
                        </div>

                        <div className="sm:col-span-8 space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-medium text-slate-300">
                              {isBg ? 'Дни от седмицата' : 'Days of Week'}
                            </label>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => setFormDays(['mon', 'tue', 'wed', 'thu', 'fri'])}
                                className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 rounded border border-white/10 cursor-pointer"
                              >
                                {isBg ? 'Пон–Пет' : 'Mon–Fri'}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setFormDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
                                }
                                className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 rounded border border-white/10 cursor-pointer"
                              >
                                {isBg ? 'Всеки ден' : 'Daily'}
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-7 gap-1">
                            {WEEKDAYS_MAP.map((day) => {
                              const isSelected = formDays.includes(day.id);
                              return (
                                <button
                                  key={day.id}
                                  type="button"
                                  onClick={() => toggleDayInForm(day.id)}
                                  className={`min-h-[38px] rounded-xl text-xs font-mono font-bold transition border cursor-pointer ${
                                    isSelected
                                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                                      : 'bg-[#0b1324] border-white/10 text-slate-500 hover:text-slate-300'
                                  }`}
                                >
                                  {isBg ? day.shortBg : day.short}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                        <button
                          type="button"
                          onClick={() => setIsAddingSchedule(false)}
                          className="px-3.5 py-2 text-xs text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
                        >
                          {isBg ? 'Отказ' : 'Cancel'}
                        </button>
                        <button
                          type="submit"
                          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{isBg ? 'Запази график' : 'Save Schedule'}</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Clean Schedules Cards List */}
                  <div className="space-y-2.5">
                    {schedules.map((schedule) => {
                      const localized = localizeWolSchedule(schedule, language);
                      const nextRun = calculateNextRun(schedule, new Date(), language);
                      const isFired = recentlyFiredId === schedule.id;
                      const resolvedTargets = resolveScheduleTargets(schedule, hosts);

                      return (
                        <div
                          key={schedule.id}
                          className={`rounded-2xl p-4 transition border min-w-0 ${
                            schedule.enabled
                              ? 'bg-[#0b1324]/90 border-cyan-500/30'
                              : 'bg-[#060b16]/70 border-white/10 opacity-75'
                          }`}
                        >
                          {/* Top Row: Title + Target Pill + Toggle */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    schedule.enabled ? 'bg-emerald-400' : 'bg-slate-600'
                                  }`}
                                />
                                <h4 className="text-sm font-bold text-white truncate">
                                  {localized.name}
                                </h4>
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
                                  {localized.targetLabel}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                                {localized.notes}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleToggleSchedule(schedule.id, schedule.enabled)}
                              className={`w-11 h-6 rounded-full p-0.5 transition flex items-center border shrink-0 cursor-pointer ${
                                schedule.enabled
                                  ? 'bg-cyan-500/25 border-cyan-400 justify-end'
                                  : 'bg-slate-900 border-slate-700 justify-start'
                              }`}
                              title={
                                schedule.enabled
                                  ? isBg
                                    ? 'Изключи графика'
                                    : 'Disable schedule'
                                  : isBg
                                  ? 'Включи графика'
                                  : 'Enable schedule'
                              }
                            >
                              <div
                                className={`w-4 h-4 rounded-full ${
                                  schedule.enabled ? 'bg-cyan-400' : 'bg-slate-500'
                                }`}
                              />
                            </button>
                          </div>

                          {/* Bottom Row: Time + Days + Next Run + Action Buttons */}
                          <div className="mt-3 pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-wrap min-w-0">
                              <div className="px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-sm font-bold tabular-nums">
                                {schedule.time}
                              </div>

                              <div className="min-w-0">
                                <div className="text-[11px] font-semibold text-slate-200">
                                  {formatDaysSummary(schedule.days, language)}
                                </div>
                                <div className="text-[11px] font-mono text-emerald-400">
                                  {schedule.enabled && nextRun
                                    ? `${nextRun.relativeText} (${
                                        isBg ? 'след' : 'in'
                                      } ${nextRun.timeUntilFormatted})`
                                    : isBg
                                    ? 'Паузиран'
                                    : 'Paused'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 ml-auto shrink-0">
                              <span className="hidden sm:inline text-[11px] font-mono text-slate-400 mr-1">
                                {resolvedTargets.length}{' '}
                                {isBg
                                  ? resolvedTargets.length === 1
                                    ? 'хост'
                                    : 'хоста'
                                  : resolvedTargets.length === 1
                                  ? 'host'
                                  : 'hosts'}
                              </span>

                              <button
                                type="button"
                                onClick={() => handleTestTriggerSchedule(schedule)}
                                className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                                  isFired
                                    ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                                    : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                                }`}
                              >
                                {isFired ? (
                                  <Check className="w-3.5 h-3.5" />
                                ) : (
                                  <Zap className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {isFired
                                    ? isBg
                                      ? 'Изпратено!'
                                      : 'Sent!'
                                    : isBg
                                    ? 'Събуди сега'
                                    : 'Wake Now'}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleStartEditSchedule(schedule)}
                                className="p-2 text-slate-400 hover:text-cyan-300 rounded-xl hover:bg-white/5 transition cursor-pointer"
                                title={isBg ? 'Редактирай' : 'Edit'}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteSchedule(schedule.id)}
                                className="p-2 text-slate-400 hover:text-rose-400 rounded-xl hover:bg-white/5 transition cursor-pointer"
                                title={isBg ? 'Изтрий' : 'Delete'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Clean Footer */}
            <div className="px-5 sm:px-6 py-3.5 border-t border-white/10 bg-[#050914] flex items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-slate-400 font-mono truncate">
                {activeTab === 'direct'
                  ? `UDP ${broadcastIp}:${port}`
                  : isBg
                  ? `${schedules.length} графика (${schedules.filter((s) => s.enabled).length} активни)`
                  : `${schedules.length} schedules (${schedules.filter((s) => s.enabled).length} active)`}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 min-h-[42px] text-xs font-semibold text-slate-300 hover:text-white rounded-xl hover:bg-white/5 transition cursor-pointer"
                >
                  {isBg ? 'Затвори' : 'Close'}
                </button>

                {activeTab === 'direct' && (
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    transition={SPRING_POP}
                    disabled={!packet || isSending}
                    onClick={handleSendDirect}
                    className="flex items-center gap-2 px-5 py-2 min-h-[42px] bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-amber-500/20 transition cursor-pointer"
                  >
                    <Zap className="w-4 h-4 stroke-[2.3]" />
                    <span>
                      {isSending
                        ? isBg
                          ? 'Изпращане...'
                          : 'Sending...'
                        : isBg
                        ? 'Събуди компютъра'
                        : 'Wake Host Now'}
                    </span>
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

