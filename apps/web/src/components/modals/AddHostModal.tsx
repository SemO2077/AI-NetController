import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Plus,
  Monitor,
  Laptop,
  Server,
  Tag,
  CheckCircle2,
  AlertCircle,
  Wand2,
  KeyRound,
  Save,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { HostDevice, OSType } from '../../types';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { MODAL_BUBBLE_VARIANTS, SPRING_POP } from '../../utils/springPhysics';

export interface AddHostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddHost: (newHost: HostDevice, pairingPin?: string) => void;
  editingHost?: HostDevice | null;
  onEditHost?: (updatedHost: HostDevice, previousId?: string) => void;
}

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

const QUICK_TAGS = ['Workstation', 'Lab', 'Server', 'Gaming', 'Storage'];

export const AddHostModal: React.FC<AddHostModalProps> = ({
  isOpen,
  onClose,
  onAddHost,
  editingHost = null,
  onEditHost,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';

  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [mac, setMac] = useState('');
  const [deviceType, setDeviceType] = useState<'pc' | 'laptop' | 'server'>('pc');
  const [os, setOs] = useState<OSType>('windows');
  const [initialStatus, setInitialStatus] = useState<'ready' | 'sleeping'>('ready');
  const [tagsInput, setTagsInput] = useState('');
  const [port, setPort] = useState('8765');
  const [pairingPin, setPairingPin] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

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

  useEffect(() => {
    if (!isOpen) return;
    if (editingHost) {
      setName(editingHost.name || '');
      setIp(editingHost.ip || '');
      setMac(editingHost.mac || '');
      setDeviceType(editingHost.deviceType || 'pc');
      setOs(editingHost.os || 'windows');
      setInitialStatus(editingHost.isOnline ? 'ready' : 'sleeping');
      setTagsInput(Array.isArray(editingHost.tags) ? editingHost.tags.join(', ') : '');
      setPort(String(editingHost.port || 8765));
      setPairingPin('');
      setShowAdvanced(Boolean(editingHost.tags && editingHost.tags.length > 0));
      setErrors({});
    } else {
      setName('');
      setIp('');
      setMac('');
      setDeviceType('pc');
      setOs('windows');
      setInitialStatus('ready');
      setTagsInput('');
      setPort('8765');
      setPairingPin('');
      setShowAdvanced(false);
      setErrors({});
    }
  }, [isOpen, editingHost]);

  // Live inline validation helpers
  const liveValidation = useMemo(() => {
    const trimmedName = name.trim();
    const trimmedIp = ip.trim();
    const ipValid = IPV4_REGEX.test(trimmedIp);
    const macClean = mac.trim().replace(/[:.-]/g, '');
    const macHexOnly = /^[0-9A-Fa-f]*$/.test(macClean);
    const macValid = macClean.length === 12 && /^[0-9A-Fa-f]{12}$/.test(macClean);
    const canAutoFormatMac =
      macClean.length > 0 &&
      macHexOnly &&
      macClean.length <= 12 &&
      mac.trim() !== (macClean.toUpperCase().match(/.{1,2}/g)?.join(':') || '');
    const parsedPort = Number(port.trim());
    const portValid = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
    const pinClean = pairingPin.trim();
    const pinValid = /^\d{6}$/.test(pinClean);

    return {
      nameValid: trimmedName.length >= 2,
      ipEntered: trimmedIp.length > 0,
      ipValid,
      macClean,
      macHexCount: macClean.length,
      macHexOnly,
      macValid,
      canAutoFormatMac,
      portValid,
      pinLength: pinClean.length,
      pinValid,
    };
  }, [name, ip, mac, port, pairingPin]);

  const handleAutoFormatMac = () => {
    const clean = mac.trim().replace(/[^0-9A-Fa-f]/g, '').slice(0, 12).toUpperCase();
    if (!clean) return;
    const formatted = clean.match(/.{1,2}/g)?.join(':') || clean;
    setMac(formatted);
    setErrors((prev) => ({ ...prev, mac: '' }));
    triggerHapticFeedback('light');
  };

  const handleToggleQuickTag = (tag: string) => {
    triggerHapticFeedback('light');
    const existing = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const hasTag = existing.some((t) => t.toLowerCase() === tag.toLowerCase());
    const next = hasTag
      ? existing.filter((t) => t.toLowerCase() !== tag.toLowerCase())
      : [...existing, tag];
    setTagsInput(next.join(', '));
  };

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!name.trim()) {
      newErrors.name = isBg ? 'Въведете име на хоста' : 'Please enter a hostname';
    }

    if (!ip.trim() || !IPV4_REGEX.test(ip.trim())) {
      newErrors.ip = isBg
        ? 'Невалиден IPv4 адрес (напр. 192.168.1.120)'
        : 'Invalid IPv4 address (e.g. 192.168.1.120)';
    }

    const macClean = mac.trim().replace(/[:.-]/g, '');
    if (macClean && (macClean.length !== 12 || !/^[0-9A-Fa-f]{12}$/.test(macClean))) {
      newErrors.mac = isBg
        ? 'Невалиден MAC адрес (12 шестнайсетични знака, напр. 00:1A:2B:3C:4D:5E)'
        : 'Invalid MAC address (12 hex digits, e.g. 00:1A:2B:3C:4D:5E)';
    }

    const cleanPin = pairingPin.trim();
    if (cleanPin && !/^\d{6}$/.test(cleanPin)) {
      newErrors.pairingPin = isBg
        ? 'PIN кодът трябва да е точно 6 цифри'
        : 'Pairing PIN must be exactly 6 digits';
    }

    const parsedPort = Number(port.trim());
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      newErrors.port = isBg ? 'Порт 1–65535' : 'Port 1–65535';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      triggerHapticFeedback('heavy');
      return;
    }

    triggerHapticFeedback('medium');

    const cleanMac = mac.trim().replace(/[:.-]/g, '').toUpperCase();
    const formattedMac = cleanMac ? cleanMac.match(/.{1,2}/g)?.join(':') || mac.toUpperCase() : '';

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) {
      tags.push(os === 'windows' ? 'Windows' : 'Linux');
    }

    const isOnline = initialStatus === 'ready';
    const safeId =
      name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '') || `HOST-${Date.now()}`;

    const parsedPort = Number(port.trim()) || 8765;
    const isEditing = Boolean(editingHost);
    const newHost: HostDevice = {
      ...(editingHost || {}),
      id: editingHost ? editingHost.id : safeId,
      name: name.trim().toUpperCase(),
      ip: ip.trim(),
      mac: formattedMac,
      port: parsedPort,
      os,
      deviceType,
      isOnline,
      lastSeen: isEditing
        ? editingHost!.lastSeen || (isOnline ? 'Online' : 'Offline')
        : isOnline
        ? 'Active (Manual host)'
        : 'Offline (Ready for Wake-on-LAN)',
      tags,
      specStatus: isEditing
        ? editingHost!.specStatus || (isOnline ? 'READY' : 'SLEEPING')
        : isOnline
        ? 'READY'
        : 'SLEEPING',
      cpuUsage: editingHost?.cpuUsage ?? 0,
      ramUsage: editingHost?.ramUsage ?? 0,
      diskUsage: editingHost?.diskUsage,
      persistentInstructions: editingHost?.persistentInstructions || [
        `Custom host configured on port ${parsedPort}`,
      ],
      sessionInstructions: editingHost?.sessionInstructions || [],
    };

    if (editingHost && onEditHost) {
      onEditHost(newHost, editingHost.id);
    } else {
      onAddHost(newHost, pairingPin.trim() || undefined);
    }
    onClose();

    setName('');
    setIp('');
    setMac('');
    setPairingPin('');
    setErrors({});
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              triggerHapticFeedback('light');
              onClose();
            }
          }}
          style={{ backgroundColor: 'var(--backdrop-scrim)' }}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-md overflow-y-auto"
        >
          <motion.div
            variants={MODAL_BUBBLE_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative w-full max-w-lg glass-liquid-modal rounded-[28px] overflow-hidden my-auto landscape-compact-modal"
          >
            {/* Specular Accent Rim */}
            <div className="h-1 w-full bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-secondary)] to-[var(--accent-tertiary)]" />

            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-[var(--glass-border)]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 squircle-badge squircle-hero shrink-0">
                  {editingHost ? (
                    <Save className="w-5 h-5 stroke-[2.2]" />
                  ) : (
                    <Plus className="w-5 h-5 stroke-[2.5]" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-extrabold ink-primary font-display tracking-tight truncate">
                    {editingHost
                      ? isBg
                        ? 'Редактиране на устройство'
                        : 'Edit Device'
                      : isBg
                      ? 'Добавяне на устройство'
                      : 'Add Host Device'}
                  </h3>
                  <p className="text-xs ink-secondary truncate">
                    {editingHost
                      ? isBg
                        ? `Актуализиране на мрежовите параметри за ${editingHost.name}`
                        : `Update network configuration for ${editingHost.name}`
                      : isBg
                      ? 'Ръчна регистрация в локалната мрежа'
                      : 'Manual LAN device registration & pairing'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onClose();
                }}
                className="min-w-[40px] min-h-[40px] w-10 h-10 rounded-full liquid-control-pill flex items-center justify-center ink-secondary hover:ink-primary transition cursor-pointer shrink-0"
                aria-label={isBg ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="p-5 sm:p-6 space-y-4 max-h-[82dvh] overflow-y-auto bouncy-scroll"
            >
              {/* Host Name Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-display font-semibold ink-primary">
                    {isBg ? 'Име на хоста' : 'Hostname'}{' '}
                    <span className="text-[var(--accent-primary)]">*</span>
                  </label>
                  {liveValidation.nameValid && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25">
                      <CheckCircle2 className="w-3 h-3" />
                      {isBg ? 'Готово' : 'Ready'}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value.toUpperCase());
                    if (errors.name) setErrors((p) => ({ ...p, name: '' }));
                  }}
                  placeholder={
                    isBg ? 'напр. WORKSTATION-01 или BACKUP-NODE' : 'e.g. WORKSTATION-01 or BACKUP-NODE'
                  }
                  className={`w-full px-3.5 py-2.5 rounded-2xl liquid-terminal-entry font-mono text-xs ink-primary placeholder:opacity-55 focus:outline-none transition border ${
                    errors.name
                      ? 'border-rose-500/70'
                      : 'border-[var(--glass-border)] focus:border-[var(--accent-primary)]'
                  }`}
                />
                {errors.name && (
                  <p className="text-[11px] text-rose-500 dark:text-rose-400 font-medium mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{errors.name}</span>
                  </p>
                )}
              </div>

              {/* IP Address & Port Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-display font-semibold ink-primary">
                      {isBg ? 'IPv4 адрес' : 'IPv4 Address'}{' '}
                      <span className="text-[var(--accent-primary)]">*</span>
                    </label>
                    {liveValidation.ipEntered && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          liveValidation.ipValid
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/25'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/25'
                        }`}
                      >
                        {liveValidation.ipValid ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            <span>IPv4</span>
                          </>
                        ) : (
                          <span>{isBg ? 'Проверете формата' : 'Check format'}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={ip}
                    onChange={(e) => {
                      setIp(e.target.value);
                      if (errors.ip) setErrors((p) => ({ ...p, ip: '' }));
                    }}
                    placeholder="192.168.1.120"
                    className={`w-full px-3.5 py-2.5 rounded-2xl liquid-terminal-entry font-mono text-xs ink-primary placeholder:opacity-55 focus:outline-none transition border ${
                      errors.ip
                        ? 'border-rose-500/70'
                        : liveValidation.ipValid
                        ? 'border-emerald-500/45 focus:border-emerald-500'
                        : 'border-[var(--glass-border)] focus:border-[var(--accent-primary)]'
                    }`}
                  />
                  {errors.ip && (
                    <p className="text-[11px] text-rose-500 dark:text-rose-400 font-medium mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{errors.ip}</span>
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-display font-semibold ink-primary">
                      {isBg ? 'Порт' : 'Agent Port'}
                    </label>
                    {liveValidation.portValid && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={port}
                    onChange={(e) => {
                      setPort(e.target.value.replace(/[^\d]/g, '').slice(0, 5));
                      if (errors.port) setErrors((p) => ({ ...p, port: '' }));
                    }}
                    placeholder="8765"
                    className={`w-full px-3.5 py-2.5 rounded-2xl liquid-terminal-entry font-mono text-xs ink-primary placeholder:opacity-55 focus:outline-none transition border ${
                      errors.port
                        ? 'border-rose-500/70'
                        : 'border-[var(--glass-border)] focus:border-[var(--accent-primary)]'
                    }`}
                  />
                  {errors.port && (
                    <p className="text-[11px] text-rose-500 dark:text-rose-400 font-medium mt-1">
                      {errors.port}
                    </p>
                  )}
                </div>
              </div>

              {/* MAC Address & Optional 6-Digit Pairing PIN Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between gap-1.5 mb-1.5">
                    <label className="text-xs font-display font-semibold ink-primary truncate">
                      {isBg ? 'MAC адрес (WoL)' : 'MAC Address (WoL)'}
                    </label>
                    <div className="flex items-center gap-1 shrink-0">
                      {liveValidation.canAutoFormatMac && (
                        <button
                          type="button"
                          onClick={handleAutoFormatMac}
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)]/25 transition inline-flex items-center gap-1 cursor-pointer"
                          title={isBg ? 'Форматирай като AA:BB:CC:DD:EE:FF' : 'Auto-format AA:BB:CC:DD:EE:FF'}
                        >
                          <Wand2 className="w-2.5 h-2.5" />
                          <span>AA:BB</span>
                        </button>
                      )}
                      {liveValidation.macHexCount > 0 && (
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border tabular-nums ${
                            liveValidation.macValid
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                              : !liveValidation.macHexOnly || liveValidation.macHexCount > 12
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {liveValidation.macHexCount}/12
                        </span>
                      )}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={mac}
                    onChange={(e) => {
                      setMac(e.target.value.toUpperCase());
                      if (errors.mac) setErrors((p) => ({ ...p, mac: '' }));
                    }}
                    placeholder="00:1A:2B:3C:4D:5E"
                    className={`w-full px-3.5 py-2.5 rounded-2xl liquid-terminal-entry font-mono text-xs ink-primary placeholder:opacity-55 focus:outline-none transition border ${
                      errors.mac
                        ? 'border-rose-500/70'
                        : liveValidation.macValid
                        ? 'border-emerald-500/45 focus:border-emerald-500'
                        : 'border-[var(--glass-border)] focus:border-[var(--accent-primary)]'
                    }`}
                  />
                  {errors.mac && (
                    <p className="text-[11px] text-rose-500 dark:text-rose-400 font-medium mt-1">
                      {errors.mac}
                    </p>
                  )}
                </div>

                {!editingHost && (
                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-1.5">
                      <label className="text-xs font-display font-semibold text-amber-600 dark:text-amber-300 flex items-center gap-1 truncate">
                        <KeyRound className="w-3.5 h-3.5 shrink-0" />
                        <span>{isBg ? '6-цифрен PIN' : '6-Digit Pair PIN'}</span>
                      </label>
                      {liveValidation.pinLength > 0 && (
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border tabular-nums ${
                            liveValidation.pinValid
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {liveValidation.pinLength}/6
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={pairingPin}
                      onChange={(e) => {
                        setPairingPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                        if (errors.pairingPin) setErrors((p) => ({ ...p, pairingPin: '' }));
                      }}
                      placeholder="482910"
                      className={`w-full px-3.5 py-2.5 rounded-2xl liquid-terminal-entry font-mono text-xs tracking-[0.2em] ink-primary placeholder:opacity-55 focus:outline-none transition border ${
                        errors.pairingPin
                          ? 'border-rose-500/70'
                          : liveValidation.pinValid
                          ? 'border-emerald-500/45 focus:border-emerald-500'
                          : 'border-amber-500/30 focus:border-amber-500'
                      }`}
                    />
                    {errors.pairingPin && (
                      <p className="text-[11px] text-rose-500 dark:text-rose-400 font-medium mt-1">
                        {errors.pairingPin}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Device Type Selector */}
              <div>
                <label className="block text-xs font-display font-semibold ink-primary mb-2">
                  {isBg ? 'Тип устройство' : 'Device Type'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'pc' as const, label: isBg ? 'Десктоп PC' : 'Desktop PC', icon: Monitor },
                    { id: 'laptop' as const, label: isBg ? 'Лаптоп' : 'Laptop', icon: Laptop },
                    { id: 'server' as const, label: isBg ? 'Сървър / NAS' : 'Server / NAS', icon: Server },
                  ].map((item) => {
                    const Icon = item.icon;
                    const isSelected = deviceType === item.id;
                    return (
                      <motion.button
                        key={item.id}
                        type="button"
                        whileTap={{ scale: 0.96 }}
                        transition={SPRING_POP}
                        onClick={() => {
                          triggerHapticFeedback('light');
                          setDeviceType(item.id);
                        }}
                        className={`p-3 rounded-2xl border flex flex-col items-center gap-1.5 transition text-xs font-display cursor-pointer ${
                          isSelected
                            ? 'bg-[var(--accent-primary)]/14 border-[var(--accent-primary)]/50 text-[var(--accent-primary)] font-bold shadow-sm'
                            : 'glass-liquid-subtle border-[var(--glass-border)] ink-secondary hover:ink-primary'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-[11px]">{item.label}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* OS & Initial Status Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-display font-semibold ink-primary mb-2">
                    {isBg ? 'Операционна система' : 'Operating System'}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-full glass-liquid-subtle border border-[var(--glass-border)]">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        setOs('windows');
                      }}
                      className={`py-2 px-3 rounded-full text-xs font-display font-semibold transition cursor-pointer ${
                        os === 'windows'
                          ? 'bg-sky-500/20 text-sky-600 dark:text-sky-300 border border-sky-500/40 shadow-sm'
                          : 'ink-secondary hover:ink-primary border border-transparent'
                      }`}
                    >
                      Windows
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        setOs('linux');
                      }}
                      className={`py-2 px-3 rounded-full text-xs font-display font-semibold transition cursor-pointer ${
                        os === 'linux'
                          ? 'bg-violet-500/20 text-violet-600 dark:text-violet-300 border border-violet-500/40 shadow-sm'
                          : 'ink-secondary hover:ink-primary border border-transparent'
                      }`}
                    >
                      Linux
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-display font-semibold ink-primary mb-2">
                    {isBg ? 'Начален статус' : 'Initial State'}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-full glass-liquid-subtle border border-[var(--glass-border)]">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        setInitialStatus('ready');
                      }}
                      className={`py-2 px-3 rounded-full text-xs font-display font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        initialStatus === 'ready'
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                          : 'ink-secondary hover:ink-primary border border-transparent'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>{isBg ? 'Онлайн' : 'Online'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        setInitialStatus('sleeping');
                      }}
                      className={`py-2 px-3 rounded-full text-xs font-display font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        initialStatus === 'sleeping'
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40 shadow-sm'
                          : 'ink-secondary hover:ink-primary border border-transparent'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{isBg ? 'Приспан' : 'Sleeping'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Collapsible Optional Tags & Presets */}
              <div className="rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    setShowAdvanced((v) => !v);
                  }}
                  className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-display font-semibold ink-primary hover:bg-[var(--glass-surface-hover)] transition cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                    <span>
                      {isBg ? 'Етикети и организация (по избор)' : 'Tags & Organization (Optional)'}
                    </span>
                  </span>
                  {showAdvanced ? (
                    <ChevronUp className="w-4 h-4 ink-muted" />
                  ) : (
                    <ChevronDown className="w-4 h-4 ink-muted" />
                  )}
                </button>
                <AnimatePresence initial={false}>
                  {showAdvanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-[var(--glass-border)]"
                    >
                      <div className="p-3.5 space-y-2.5">
                        <div className="relative">
                          <input
                            type="text"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            placeholder="Lab, Production, Storage, AI"
                            className="w-full px-3.5 py-2 pl-9 rounded-xl liquid-terminal-entry border border-[var(--glass-border)] focus:border-[var(--accent-primary)] ink-primary font-mono text-xs focus:outline-none transition"
                          />
                          <Tag className="w-3.5 h-3.5 ink-muted absolute left-3 top-2.5 pointer-events-none" />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {QUICK_TAGS.map((tag) => {
                            const active = tagsInput
                              .split(',')
                              .map((t) => t.trim().toLowerCase())
                              .includes(tag.toLowerCase());
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => handleToggleQuickTag(tag)}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition cursor-pointer border ${
                                  active
                                    ? 'bg-[var(--accent-primary)]/18 text-[var(--accent-primary)] border-[var(--accent-primary)]/40 font-semibold'
                                    : 'liquid-control-pill ink-secondary hover:ink-primary'
                                }`}
                              >
                                + {tag}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer Buttons */}
              <div className="pt-3 border-t border-[var(--glass-border)] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    onClose();
                  }}
                  className="min-h-[42px] px-4 py-2 rounded-full liquid-control-pill ink-secondary hover:ink-primary font-display text-xs font-semibold transition cursor-pointer"
                >
                  {isBg ? 'Отказ' : 'Cancel'}
                </button>
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  transition={SPRING_POP}
                  className="min-h-[42px] px-5 py-2 rounded-full liquid-hero-btn preserve-white font-display text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  {editingHost ? (
                    <Save className="w-4 h-4" />
                  ) : (
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                  )}
                  <span>
                    {editingHost
                      ? isBg
                        ? 'Запази промените'
                        : 'Save Changes'
                      : isBg
                      ? 'Добави устройство'
                      : 'Add Device'}
                  </span>
                </motion.button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
