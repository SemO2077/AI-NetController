import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  WEEKDAYS_MAP,
} from '../../services/wolService';
import { triggerHapticFeedback } from '../../services/hapticService';
import { HostDevice, Weekday, WolPacketPayload, WolSchedule, WolScheduleTargetType } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';
import { SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';
import { copyToClipboard } from '../../utils/clipboard';
import { wolHistoryStore } from '../../store/wolHistoryStore';

interface WolModalProps {
  device: HostDevice | null;
  hosts?: HostDevice[];
  isOpen: boolean;
  onClose: () => void;
  onSendPacket: (payload: WolPacketPayload, deviceId: string) => boolean | void | Promise<boolean | void>;
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
  const [macTouched, setMacTouched] = useState(false);
  const timersRef = useRef<Set<number>>(new Set());

  const scheduleTimer = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Schedules State
  const [schedules, setSchedules] = useState<WolSchedule[]>(() => externalSchedules || loadWolSchedules());
  const [isAddingSchedule, setIsAddingSchedule] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [recentlyFiredId, setRecentlyFiredId] = useState<string | null>(null);
  const [confirmDeleteScheduleId, setConfirmDeleteScheduleId] = useState<string | null>(null);
  const [confirmRestoreDefaults, setConfirmRestoreDefaults] = useState(false);

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
    if (!mac.trim()) {
      setPacket(null);
      setError(null);
      return;
    }
    try {
      const generated = generateMagicPacket(mac, broadcastIp, port, secureOnPassword);
      setPacket(generated);
      setError(null);
    } catch (err: any) {
      setPacket(null);
      if (macTouched || secureOnPassword.trim()) {
        const rawErr = String(err?.message || '');
        if (/secureon|password/i.test(rawErr)) {
          setError(
            isBg
              ? 'Невалидна SecureOn парола (оставете празно или въведете точно 12 шестнадесетични символа).'
              : 'Invalid SecureOn password (leave empty or enter exactly 12 hexadecimal characters).'
          );
        } else {
          setError(
            isBg
              ? 'Невалиден MAC адрес (трябва да съдържа 12 шестнадесетични символа).'
              : 'Invalid MAC address (must contain 12 hexadecimal characters).'
          );
        }
      } else {
        setError(null);
      }
    }
  }, [mac, broadcastIp, port, secureOnPassword, isBg, macTouched]);

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
      scheduleTimer(() => setCopied(false), 2000);
    }
  };

  const handleSendDirect = async () => {
    if (!packet || isSending) return;
    setIsSending(true);
    triggerHapticFeedback('heavy');
    const targetId =
      selectedDirectHostId !== 'CUSTOM' ? selectedDirectHostId : device?.id || 'CUSTOM-MAC';
    try {
      const res = await Promise.resolve(onSendPacket(packet, targetId));
      if (res === false) {
        setIsSending(false);
        return;
      }
      scheduleTimer(() => {
        setIsSending(false);
        onClose();
      }, 300);
    } catch {
      setIsSending(false);
      setError(
        isBg ? 'Неуспешно изпращане на WoL пакета.' : 'Failed to dispatch Wake-on-LAN packet.'
      );
    }
  };

  const handleToggleSchedule = (id: string, currentEnabled: boolean) => {
    triggerHapticFeedback('light');
    const updated = schedules.map((s) => (s.id === id ? { ...s, enabled: !currentEnabled } : s));
    persistSchedules(updated);
  };

  const handleDeleteSchedule = (id: string) => {
    if (confirmDeleteScheduleId !== id) {
      triggerHapticFeedback('light');
      setConfirmDeleteScheduleId(id);
      scheduleTimer(() => {
        setConfirmDeleteScheduleId((curr) => (curr === id ? null : curr));
      }, 3500);
      return;
    }
    triggerHapticFeedback('medium');
    setConfirmDeleteScheduleId(null);
    const updated = schedules.filter((s) => s.id !== id);
    persistSchedules(updated);
    fetch(`/api/wol/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
  };

  const handleRestoreDefaults = () => {
    if (!confirmRestoreDefaults) {
      triggerHapticFeedback('light');
      setConfirmRestoreDefaults(true);
      scheduleTimer(() => setConfirmRestoreDefaults(false), 3500);
      return;
    }
    triggerHapticFeedback('medium');
    setConfirmRestoreDefaults(false);
    persistSchedules(DEFAULT_WOL_SCHEDULES);
  };

  const handleTestTriggerSchedule = (schedule: WolSchedule) => {
    triggerHapticFeedback('heavy');
    setRecentlyFiredId(schedule.id);
    scheduleTimer(() => setRecentlyFiredId(null), 2200);

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

    if (formTargetType === 'custom_mac') {
      try {
        generateMagicPacket(formTargetMac, formBroadcastIp, formPort);
      } catch {
        setFormError(
          isBg
            ? 'Моля, въведете валиден MAC адрес (напр. 00:1A:2B:3C:4D:5E).'
            : 'Please enter a valid target MAC address (e.g. 00:1A:2B:3C:4D:5E).'
        );
        return;
      }
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

    const existingSchedule = editingScheduleId
      ? schedules.find((s) => s.id === editingScheduleId)
      : undefined;

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
      enabled: existingSchedule ? existingSchedule.enabled : true,
      broadcastIp: formBroadcastIp.trim() || '255.255.255.255',
      port: formPort,
      notes: formNotes.trim(),
      lastTriggered: existingSchedule?.lastTriggered,
      createdTimestamp: existingSchedule?.createdTimestamp ?? Date.now(),
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
    hosts.find((h) => h.id === selectedDirectHostId) ||
    (selectedDirectHostId === device?.id ? device : null);

  const normalizedMacHex = mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  const isMacValid = normalizedMacHex.length === 12;
  const formattedMacSuggestion = isMacValid
    ? normalizedMacHex.match(/.{2}/g)?.join(':') || mac
    : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center select-none sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ backgroundColor: 'var(--backdrop-scrim)' }}
            className="fixed inset-0 backdrop-blur-md modal-backdrop-scrim"
          />

          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
            transition={SPRING_BUBBLY}
            className="relative z-10 w-full max-w-2xl rounded-t-[2.2rem] sm:rounded-[2rem] glass-liquid-modal flex flex-col overflow-hidden transform-gpu max-h-[90vh]"
          >
            {/* Mobile Drag Handle */}
            <div className="pt-3 pb-1 w-full flex justify-center sm:hidden">
              <div className="w-12 h-1.5 bg-current opacity-20 rounded-full" />
            </div>

            {/* Clean Liquid Glass Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 squircle-badge squircle-amber flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display font-extrabold ink-primary text-base tracking-tight truncate">
                    {isBg ? 'Събуждане по мрежата (WoL)' : 'Wake-on-LAN Controller'}
                  </h3>
                  <p className="text-xs ink-muted truncate">
                    {isBg
                      ? 'Директно събуждане на компютър и автоматични графици'
                      : 'Instant host wake-up & automated recurring schedules'}
                  </p>
                </div>
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.9 }}
                transition={SPRING_POP}
                onClick={onClose}
                className="min-w-[38px] min-h-[38px] w-9.5 h-9.5 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer shrink-0"
                title={isBg ? 'Затвори' : 'Close'}
                aria-label={isBg ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Full-Capsule Sliding 2-Tab Bar */}
            <div className="px-5 sm:px-6 pt-3.5 pb-1 shrink-0">
              <div className="grid grid-cols-2 gap-1.5 p-1.5 rounded-full glass-liquid-subtle">
                <button
                  id="tab-direct-packet"
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('selection');
                    setActiveTab('direct');
                  }}
                  className={`relative min-h-[38px] px-3 py-1.5 rounded-full text-xs font-display font-bold flex items-center justify-center gap-2 transition cursor-pointer z-10 ${
                    activeTab === 'direct' ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                  }`}
                >
                  {activeTab === 'direct' && (
                    <motion.div
                      layoutId="wolActiveTabPill"
                      transition={SPRING_BUBBLY}
                      className="absolute inset-0 rounded-full liquid-hero-btn -z-10"
                    />
                  )}
                  <Zap className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{isBg ? 'Директно събуждане' : 'Wake Host Now'}</span>
                </button>

                <button
                  id="tab-recurring-schedules"
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('selection');
                    setActiveTab('schedules');
                  }}
                  className={`relative min-h-[38px] px-3 py-1.5 rounded-full text-xs font-display font-bold flex items-center justify-center gap-2 transition cursor-pointer z-10 ${
                    activeTab === 'schedules' ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                  }`}
                >
                  {activeTab === 'schedules' && (
                    <motion.div
                      layoutId="wolActiveTabPill"
                      transition={SPRING_BUBBLY}
                      className="absolute inset-0 rounded-full liquid-hero-btn -z-10"
                    />
                  )}
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{isBg ? 'Графици за събуждане' : 'Wake Schedules'}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono shrink-0 ${
                      activeTab === 'schedules'
                        ? 'bg-white/20 text-white'
                        : 'bg-amber-500/15 text-amber-400'
                    }`}
                  >
                    {schedules.filter((s) => s.enabled).length}
                  </span>
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto overflow-x-hidden flex-1 bouncy-scroll">
              {/* TAB 1: DIRECT WAKE */}
              {activeTab === 'direct' && (
                <div className="space-y-4">
                  {/* Target Host Picker Card */}
                  <div className="p-4 rounded-[24px] glass-liquid-subtle space-y-3.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 squircle-badge squircle-hero flex items-center justify-center shrink-0">
                          <Monitor className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold ink-muted">
                            {isBg ? 'Изберете компютър за събуждане' : 'Select Host to Wake'}
                          </div>
                          <div className="text-xs font-display font-bold ink-primary truncate">
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
                        className="w-full sm:w-60 rounded-full liquid-control-pill px-3.5 py-2 min-h-[38px] text-xs ink-primary font-mono font-semibold focus:border-cyan-400 focus:outline-none cursor-pointer"
                      >
                        {hosts.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name} ({h.isOnline ? (isBg ? 'Онлайн' : 'Online') : isBg ? 'Спящ' : 'Sleeping'})
                          </option>
                        ))}
                        <option value="CUSTOM">
                          {isBg ? '+ Друг MAC адрес...' : '+ Custom MAC address...'}
                        </option>
                      </select>
                    </div>

                    {/* Streamlined MAC & Broadcast Inputs with Live Inline Validation */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-3 border-t border-white/[0.08]">
                      <div className="sm:col-span-5">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-semibold ink-secondary">
                            {isBg ? 'MAC адрес' : 'Target MAC Address'}
                          </label>
                          {mac.trim() && (
                            <span
                              className={`text-[10px] font-mono font-bold ${
                                isMacValid ? 'text-emerald-400' : 'text-amber-400'
                              }`}
                            >
                              {isMacValid
                                ? isBg
                                  ? '✓ Валиден'
                                  : '✓ Valid'
                                : `${normalizedMacHex.length}/12 hex`}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={mac}
                            onChange={(e) => {
                              setMacTouched(true);
                              setMac(e.target.value);
                              setSelectedDirectHostId('CUSTOM');
                            }}
                            placeholder="00:1A:2B:3C:4D:5E"
                            className="flex-1 min-w-0 min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs ink-primary font-mono focus:border-cyan-400 focus:outline-none"
                          />
                          {formattedMacSuggestion && formattedMacSuggestion !== mac && (
                            <button
                              type="button"
                              onClick={() => setMac(formattedMacSuggestion)}
                              className="px-2.5 min-h-[40px] rounded-full liquid-control-pill text-[10px] font-mono font-bold text-cyan-400 shrink-0 cursor-pointer"
                              title={isBg ? 'Форматирай MAC' : 'Auto-format MAC'}
                            >
                              AA:BB
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="sm:col-span-5">
                        <label className="block text-[11px] font-semibold ink-secondary mb-1">
                          {isBg ? 'Broadcast IP адрес' : 'Broadcast IP Address'}
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={broadcastIp}
                            onChange={(e) => setBroadcastIp(e.target.value)}
                            placeholder="255.255.255.255"
                            className="flex-1 min-w-0 min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs ink-primary font-mono focus:border-cyan-400 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setBroadcastIp(
                                broadcastIp === '255.255.255.255' ? '192.168.1.255' : '255.255.255.255'
                              )
                            }
                            className="px-3 min-h-[40px] rounded-full liquid-control-pill text-[10px] font-mono font-bold text-cyan-400 shrink-0 cursor-pointer"
                            title={
                              isBg
                                ? 'Превключи между глобален и локален субнет адрес'
                                : 'Toggle Global / Subnet broadcast'
                            }
                          >
                            .255
                          </button>
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold ink-secondary mb-1">
                          {isBg ? 'UDP порт' : 'Port'}
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={port}
                          onChange={(e) => {
                            const parsed = parseInt(e.target.value, 10);
                            setPort(
                              Number.isFinite(parsed)
                                ? Math.min(65535, Math.max(1, parsed))
                                : 9
                            );
                          }}
                          className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-2.5 py-2 text-xs ink-primary font-mono text-center focus:border-cyan-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/14 border border-rose-500/35 p-3 rounded-2xl font-medium">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Progressive Disclosure: SecureOn & Raw Hex Inspector */}
                  <div className="rounded-[24px] glass-liquid-subtle overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        setShowAdvancedHex((prev) => !prev);
                      }}
                      className="w-full px-4 py-3 flex items-center justify-between text-xs font-display font-bold ink-primary transition cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Radio className="w-3.5 h-3.5 text-cyan-400" />
                        <span>
                          {isBg
                            ? `SecureOn и Hex инспектор (${packet?.bytesCount || 102} байта)`
                            : `SecureOn & Raw Hex Inspector (${packet?.bytesCount || 102} bytes)`}
                        </span>
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 ink-muted transition-transform duration-200 ${
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
                          className="px-4 pb-4 space-y-3 border-t border-white/[0.08] pt-3 overflow-hidden"
                        >
                          <div>
                            <label className="block text-[11px] font-semibold ink-secondary mb-1">
                              {isBg
                                ? 'SecureOn парола (Опционален 6-байтов ключ)'
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
                              className="w-full liquid-terminal-entry rounded-full px-3.5 py-2 text-xs ink-primary font-mono focus:border-cyan-400 focus:outline-none"
                            />
                          </div>

                          {packet && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-mono ink-muted">
                                  {isBg ? 'Шестнадесетичен вид на пакета:' : 'Raw Ethernet Hex Payload:'}
                                </span>
                                <button
                                  type="button"
                                  onClick={handleCopyHex}
                                  className="flex items-center gap-1.5 text-xs text-cyan-400 px-3 py-1 rounded-full liquid-control-pill font-semibold cursor-pointer"
                                >
                                  {copied ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                  <span>{copied ? (isBg ? 'Копирано!' : 'Copied!') : isBg ? 'Копирай' : 'Copy Hex'}</span>
                                </button>
                              </div>

                              <div className="liquid-terminal-entry rounded-2xl p-3 font-mono text-[10.5px] ink-primary overflow-x-auto leading-relaxed max-h-36">
                                {formatHexDump(packet.rawHex).map((line, idx) => (
                                  <div key={idx} className="whitespace-pre">
                                    <span className="ink-muted">{line.slice(0, 6)}</span>
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

              {/* TAB 2: AUTOMATED RECURRING SCHEDULES */}
              {activeTab === 'schedules' && (
                <div className="space-y-4">
                  {/* Top Bar */}
                  <div className="glass-liquid-subtle rounded-[24px] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 squircle-badge squircle-amber flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-display font-bold ink-primary truncate">
                          {isBg ? 'Автоматични графици за събуждане' : 'Automated Wake-Up Schedules'}
                        </h4>
                        <p className="text-[11px] ink-muted truncate">
                          {isBg
                            ? 'Събужда компютрите автоматично в избраните дни и часове'
                            : 'Automatically wakes target hosts at scheduled days and times'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.92 }}
                        transition={SPRING_POP}
                        onClick={handleOpenNewScheduleForm}
                        className={`min-h-[36px] flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full transition cursor-pointer ${
                          isAddingSchedule
                            ? 'liquid-control-pill ink-primary'
                            : 'liquid-hero-btn preserve-white'
                        }`}
                      >
                        {isAddingSchedule ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        <span>
                          {isAddingSchedule
                            ? isBg
                              ? 'Отказ'
                              : 'Cancel'
                            : isBg
                            ? 'Нов график'
                            : 'New Schedule'}
                        </span>
                      </motion.button>

                      <button
                        type="button"
                        onClick={handleRestoreDefaults}
                        className={`min-h-[36px] px-2.5 rounded-full flex items-center justify-center gap-1 text-[11px] font-semibold transition cursor-pointer ${
                          confirmRestoreDefaults
                            ? 'bg-amber-500/18 border border-amber-400/45 text-amber-400'
                            : 'liquid-control-pill ink-secondary'
                        }`}
                        title={
                          confirmRestoreDefaults
                            ? isBg
                              ? 'Натиснете отново за възстановяване'
                              : 'Click again to confirm restore'
                            : isBg
                            ? 'Възстанови стандартните графици'
                            : 'Restore default schedules'
                        }
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {confirmRestoreDefaults && (
                          <span>{isBg ? 'Потвърди?' : 'Reset?'}</span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Schedule Creator / Editor Form */}
                  {isAddingSchedule && (
                    <form
                      onSubmit={handleSaveFormSchedule}
                      className="glass-liquid-elevated iridescent-active-rim rounded-[24px] p-4 space-y-3.5"
                    >
                      <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                        <span className="text-xs font-display font-bold text-cyan-400 flex items-center gap-1.5">
                          <Clock className="w-4 h-4" />
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
                        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/14 border border-rose-500/35 p-2.5 rounded-2xl">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{formError}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold ink-secondary mb-1">
                            {isBg ? 'Име на графика' : 'Schedule Name'}
                          </label>
                          <input
                            type="text"
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder={
                              isBg ? 'напр. Сутрешно събуждане' : 'e.g. Morning Lab Wake-Up'
                            }
                            className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs ink-primary focus:border-cyan-400 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold ink-secondary mb-1">
                            {isBg ? 'Целеви компютри' : 'Target Hosts'}
                          </label>
                          <select
                            value={formTargetType}
                            onChange={(e) => setFormTargetType(e.target.value as WolScheduleTargetType)}
                            className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs ink-primary focus:border-cyan-400 focus:outline-none cursor-pointer"
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
                          <label className="block text-[11px] font-semibold ink-secondary mb-1">
                            {isBg ? 'Целеви MAC адрес' : 'Target MAC Address'}
                          </label>
                          <input
                            type="text"
                            value={formTargetMac}
                            onChange={(e) => setFormTargetMac(e.target.value)}
                            placeholder="00:1A:2B:3C:4D:5E"
                            className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs text-cyan-400 font-mono focus:border-cyan-400 focus:outline-none"
                          />
                        </div>
                      )}

                      {formTargetType === 'specific_device' && (
                        <div>
                          <label className="block text-[11px] font-semibold ink-secondary mb-1">
                            {isBg ? 'Изберете компютър' : 'Select Host'}
                          </label>
                          <select
                            value={formTargetDeviceId}
                            onChange={(e) => {
                              setFormTargetDeviceId(e.target.value);
                              const h = hosts.find((item) => item.id === e.target.value);
                              if (h) setFormTargetMac(h.mac);
                            }}
                            className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs text-cyan-400 font-mono focus:border-cyan-400 focus:outline-none"
                          >
                            {hosts.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name} ({h.ip} • {h.mac})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Time & Weekday Pill Selector */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-semibold ink-secondary mb-1">
                            {isBg ? 'Час (24ч)' : 'Wake Time (24h)'}
                          </label>
                          <input
                            type="time"
                            value={formTime}
                            onChange={(e) => setFormTime(e.target.value)}
                            className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-1.5 text-sm text-cyan-400 font-mono font-bold focus:border-cyan-400 focus:outline-none"
                          />
                        </div>

                        <div className="sm:col-span-8 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-semibold ink-secondary">
                              {isBg ? 'Дни от седмицата' : 'Days of Week'}
                            </label>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => setFormDays(['mon', 'tue', 'wed', 'thu', 'fri'])}
                                className="px-2.5 py-0.5 text-[10px] liquid-control-pill rounded-full font-semibold cursor-pointer"
                              >
                                {isBg ? 'Пон–Пет' : 'Mon–Fri'}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setFormDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
                                }
                                className="px-2.5 py-0.5 text-[10px] liquid-control-pill rounded-full font-semibold cursor-pointer"
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
                                  className={`min-h-[36px] rounded-full text-xs font-mono font-bold transition cursor-pointer ${
                                    isSelected
                                      ? 'liquid-hero-btn preserve-white'
                                      : 'liquid-control-pill ink-muted'
                                  }`}
                                >
                                  {isBg ? day.shortBg : day.short}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="sm:col-span-12 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div>
                            <label className="text-[11px] font-semibold ink-secondary block mb-1">
                              {isBg ? 'Broadcast IP адрес' : 'Broadcast IP'}
                            </label>
                            <input
                              type="text"
                              value={formBroadcastIp}
                              onChange={(e) => setFormBroadcastIp(e.target.value)}
                              placeholder="255.255.255.255"
                              className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs ink-primary font-mono focus:border-cyan-400 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold ink-secondary block mb-1">
                              {isBg ? 'UDP порт' : 'UDP Port'}
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={65535}
                              value={formPort}
                              onChange={(e) => {
                                const parsed = parseInt(e.target.value, 10);
                                setFormPort(
                                  Number.isFinite(parsed)
                                    ? Math.min(65535, Math.max(1, parsed))
                                    : 9
                                );
                              }}
                              className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs ink-primary font-mono focus:border-cyan-400 focus:outline-none"
                            />
                          </div>
                        </div>

                        <div className="sm:col-span-12">
                          <label className="text-[11px] font-semibold ink-secondary block mb-1">
                            {isBg ? 'Бележки (по избор)' : 'Notes (Optional)'}
                          </label>
                          <input
                            type="text"
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            placeholder={
                              isBg
                                ? 'Напр. Ранно сутрешно стартиране на GPU клъстера'
                                : 'e.g. Early morning GPU cluster wake'
                            }
                            className="w-full min-h-[40px] liquid-terminal-entry rounded-full px-3.5 py-2 text-xs ink-primary focus:border-cyan-400 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.08]">
                        <button
                          type="button"
                          onClick={() => setIsAddingSchedule(false)}
                          className="px-4 py-2 text-xs font-semibold liquid-control-pill rounded-full cursor-pointer"
                        >
                          {isBg ? 'Отказ' : 'Cancel'}
                        </button>
                        <motion.button
                          type="submit"
                          whileTap={{ scale: 0.94 }}
                          transition={SPRING_POP}
                          className="flex items-center gap-1.5 px-4 py-2 liquid-hero-btn font-bold rounded-full text-xs cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{isBg ? 'Запази график' : 'Save Schedule'}</span>
                        </motion.button>
                      </div>
                    </form>
                  )}

                  {/* Schedules Cards List */}
                  <div className="space-y-2.5">
                    {schedules.map((schedule) => {
                      const localized = localizeWolSchedule(schedule, language);
                      const nextRun = calculateNextRun(schedule, new Date(), language);
                      const isFired = recentlyFiredId === schedule.id;
                      const resolvedTargets = resolveScheduleTargets(schedule, hosts);

                      return (
                        <div
                          key={schedule.id}
                          className={`rounded-[24px] p-4 transition min-w-0 ${
                            schedule.enabled
                              ? 'glass-liquid'
                              : 'glass-liquid-subtle opacity-70'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                    schedule.enabled ? 'bg-emerald-400' : 'bg-slate-400'
                                  }`}
                                />
                                <h4 className="text-sm font-display font-bold ink-primary truncate">
                                  {localized.name}
                                </h4>
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-cyan-500/14 text-cyan-400 border border-cyan-400/35 shrink-0">
                                  {localized.targetLabel}
                                </span>
                              </div>
                              {localized.notes && (
                                <p className="text-xs ink-muted mt-1 line-clamp-1">
                                  {localized.notes}
                                </p>
                              )}
                            </div>

                            {/* Tactile Pill Switch */}
                            <button
                              type="button"
                              onClick={() => handleToggleSchedule(schedule.id, schedule.enabled)}
                              className={`w-12 h-7 rounded-full p-0.5 transition flex items-center shrink-0 cursor-pointer ${
                                schedule.enabled
                                  ? 'liquid-hero-btn justify-end'
                                  : 'liquid-control-pill justify-start'
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
                              <div className="w-5 h-5 rounded-full bg-white shadow-sm" />
                            </button>
                          </div>

                          <div className="mt-3 pt-3 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-wrap min-w-0">
                              <div className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/35 text-amber-400 font-mono text-sm font-bold tabular-nums">
                                {schedule.time}
                              </div>

                              <div className="min-w-0">
                                <div className="text-[11px] font-semibold ink-primary">
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
                              <span className="hidden sm:inline text-[11px] font-mono ink-muted mr-1">
                                {resolvedTargets.length}{' '}
                                {isBg
                                  ? resolvedTargets.length === 1
                                    ? 'хост'
                                    : 'хоста'
                                  : resolvedTargets.length === 1
                                  ? 'host'
                                  : 'hosts'}
                              </span>

                              <motion.button
                                type="button"
                                whileTap={{ scale: 0.92 }}
                                transition={SPRING_POP}
                                onClick={() => handleTestTriggerSchedule(schedule)}
                                className={`min-h-[34px] px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                                  isFired
                                    ? 'squircle-emerald preserve-white'
                                    : 'squircle-amber preserve-white'
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
                              </motion.button>

                              <button
                                type="button"
                                onClick={() => handleStartEditSchedule(schedule)}
                                className="w-8.5 h-8.5 rounded-full liquid-control-pill flex items-center justify-center text-cyan-400 cursor-pointer"
                                title={isBg ? 'Редактирай' : 'Edit'}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteSchedule(schedule.id)}
                                className={`h-8.5 px-2.5 rounded-full transition cursor-pointer flex items-center gap-1 ${
                                  confirmDeleteScheduleId === schedule.id
                                    ? 'squircle-rose preserve-white'
                                    : 'liquid-control-pill text-rose-400'
                                }`}
                                title={
                                  confirmDeleteScheduleId === schedule.id
                                    ? isBg
                                      ? 'Натиснете отново за изтриване'
                                      : 'Click again to confirm delete'
                                    : isBg
                                    ? 'Изтрий'
                                    : 'Delete'
                                }
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {confirmDeleteScheduleId === schedule.id && (
                                  <span className="text-[10px] font-mono font-bold">
                                    {isBg ? 'Потвърди?' : 'Confirm?'}
                                  </span>
                                )}
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

            {/* Clean Adaptive Footer */}
            <div className="px-5 sm:px-6 py-3.5 border-t border-white/[0.08] glass-liquid-subtle flex items-center justify-between gap-3 shrink-0">
              <div className="text-xs ink-muted font-mono truncate">
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
                  className="px-4 py-2 min-h-[40px] text-xs font-semibold liquid-control-pill rounded-full cursor-pointer"
                >
                  {isBg ? 'Затвори' : 'Close'}
                </button>

                {activeTab === 'direct' && (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.94 }}
                    transition={SPRING_POP}
                    disabled={!packet || isSending}
                    onClick={handleSendDirect}
                    className="flex items-center gap-2 px-5 py-2 min-h-[40px] squircle-amber preserve-white disabled:opacity-40 font-bold rounded-full text-xs cursor-pointer"
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

