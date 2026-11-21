import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import {
  Monitor,
  ShieldCheck,
  Cpu,
  Wifi,
  Copy,
  Check,
  RefreshCw,
  Pause,
  Play,
  Lock,
  Unlock,
  KeyRound,
  Terminal,
  Download,
  OctagonAlert,
  X,
  Eye,
  EyeOff,
  Activity,
  FileCode,
  CheckCircle2,
  Users,
  Ban,
  ShieldAlert,
  Smartphone,
  Laptop,
  Sparkles,
  UserCheck,
  UserX,
  Clipboard,
  QrCode,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { MODAL_BUBBLE_VARIANTS, SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';
import { copyToClipboard } from '../../utils/clipboard';

interface ConnectedPeer {
  id: string;
  ip: string;
  mac?: string;
  device: string;
  platform?: 'android' | 'ios' | 'web' | 'desktop';
  auth: string;
  connectedAt: string;
  latencyMs?: number;
  commandsSent?: number;
  inputAllowed?: boolean;
  isTrusted?: boolean;
}

interface BlacklistedDevice {
  id: string;
  ip: string;
  mac: string;
  device: string;
  reason: string;
  bannedAt: string;
}

interface DaemonLog {
  time: string;
  level: 'INFO' | 'SECURITY' | 'DIAG' | 'WARN' | 'ALERT';
  message: string;
}

interface DaemonStateSnapshot {
  version: string;
  protocol: string;
  hostname: string;
  osName: string;
  localIp: string;
  port: number;
  wsUri: string;
  uptime: string;
  isRunning: boolean;
  isPaused: boolean;
  mdnsEnabled: boolean;
  viewOnlyMode: boolean;
  requireHitlApproval: boolean;
  clipboardSyncAllowed?: boolean;
  autoLockOnDisconnect?: boolean;
  autoBanIntrusion?: boolean;
  subnetGeofenceOnly?: boolean;
  autoStartOnBoot?: boolean;
  targetFps?: 60 | 30 | 15;
  setupCompleted?: boolean;
  securityProfile?: 'zero_trust' | 'balanced' | 'view_only';
  pairingPin?: string;
  pairingToken: string;
  hasPairingToken?: boolean;
  cpuPercent: number;
  cpuCores: number;
  ramPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskPercent: number;
  captureFps: number;
  connectedClients: ConnectedPeer[];
  blacklistedDevices?: BlacklistedDevice[];
  activeAdapters: Array<{ name: string; ipv4: string; mac: string }>;
  avIntegrity: {
    upxDisabled: boolean;
    visibleHwnd: boolean;
    zeroHiddenShell: boolean;
    manifestAsInvoker: boolean;
    authenticodeReady: boolean;
    sandboxJobObject: boolean;
  };
  logs: DaemonLog[];
}

interface PcDaemonGuiModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCodeReleases?: () => void;
}

const INITIAL_DAEMON_STATE: DaemonStateSnapshot = {
  version: '0.90.0',
  protocol: 'AI-NET/3.0',
  hostname: 'LOCAL-HOST',
  osName: 'Windows / Linux Host',
  localIp: '127.0.0.1',
  port: 8765,
  wsUri: 'ws://127.0.0.1:8765',
  uptime: '00:00:00',
  isRunning: false,
  isPaused: false,
  mdnsEnabled: false,
  viewOnlyMode: false,
  requireHitlApproval: true,
  clipboardSyncAllowed: true,
  autoLockOnDisconnect: false,
  autoBanIntrusion: true,
  subnetGeofenceOnly: true,
  autoStartOnBoot: false,
  targetFps: 30,
  setupCompleted: false,
  securityProfile: 'balanced',
  pairingPin: '',
  pairingToken: '',
  hasPairingToken: false,
  cpuPercent: 0,
  cpuCores: 1,
  ramPercent: 0,
  ramUsedGb: 0,
  ramTotalGb: 0,
  diskPercent: 0,
  captureFps: 0,
  connectedClients: [],
  blacklistedDevices: [],
  activeAdapters: [],
  avIntegrity: {
    upxDisabled: false,
    visibleHwnd: false,
    zeroHiddenShell: false,
    manifestAsInvoker: false,
    authenticodeReady: false,
    sandboxJobObject: false,
  },
  logs: [],
};

export type DaemonGuiTab = 'overview' | 'devices' | 'setup';

export const PcDaemonGuiModal: React.FC<PcDaemonGuiModalProps> = ({
  isOpen,
  onClose,
  onOpenCodeReleases,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';

  const [activeTab, setActiveTab] = useState<DaemonGuiTab>('overview');
  const [daemon, setDaemon] = useState<DaemonStateSnapshot>(INITIAL_DAEMON_STATE);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoadingAction, setIsLoadingAction] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);
  const [portInput, setPortInput] = useState('8765');
  const [isEditingPort, setIsEditingPort] = useState(false);
  const [showAvChecks, setShowAvChecks] = useState(false);
  const [showDaemonLog, setShowDaemonLog] = useState(false);
  const [confirmPanic, setConfirmPanic] = useState(false);
  const [confirmClearBans, setConfirmClearBans] = useState(false);
  const [confirmClearLogs, setConfirmClearLogs] = useState(false);
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

  const [manualBanIp, setManualBanIp] = useState('');
  const [manualBanMac, setManualBanMac] = useState('');
  const [manualBanDevice, setManualBanDevice] = useState('');
  const [manualBanReason, setManualBanReason] = useState('');

  const [qrDataUrl, setQrDataUrl] = useState('');
  const [setupCompletedBanner, setSetupCompletedBanner] = useState(false);

  const daemonFetchAbortRef = useRef<AbortController | null>(null);
  const daemonFetchInFlightRef = useRef(false);

  const fetchDaemonState = useCallback(async () => {
    if (daemonFetchInFlightRef.current) return;
    daemonFetchInFlightRef.current = true;
    const controller = new AbortController();
    daemonFetchAbortRef.current = controller;
    try {
      const res = await fetch('/api/daemon/state', {
        credentials: 'include',
        signal: controller.signal,
      });
      const data = await res.json();
      if (controller.signal.aborted) return;
      setServerReachable(res.ok);
      if (res.ok && data.success && data.daemon) {
        setDaemon((prev) => ({
          ...data.daemon,
          pairingToken: data.daemon.pairingToken || prev.pairingToken || '',
        }));
        if (!isEditingPort) {
          setPortInput(String(data.daemon.port));
        }
      } else {
        setDaemon((prev) => ({ ...prev, isRunning: false }));
      }
    } catch {
      if (!controller.signal.aborted) {
        setServerReachable(false);
        setDaemon((prev) => ({ ...prev, isRunning: false }));
      }
    } finally {
      daemonFetchInFlightRef.current = false;
    }
  }, [isEditingPort]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchDaemonState();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchDaemonState();
    }, 3000);
    return () => {
      clearInterval(timer);
      daemonFetchAbortRef.current?.abort();
      daemonFetchAbortRef.current = null;
      daemonFetchInFlightRef.current = false;
    };
  }, [isOpen, fetchDaemonState]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const primaryAdapterMac = daemon.activeAdapters?.[0]?.mac || '';

  // Crisp high-contrast QR on pure white card for Daylight & Dark scanning
  useEffect(() => {
    if (!isOpen) return;
    const baseOrigin =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `http://${daemon.localIp}:${window.location.port || 3000}`
        : window.location.origin;
    const params = new URLSearchParams({
      pair_ip: daemon.localIp,
      pair_port: String(daemon.port),
      pair_name: daemon.hostname,
      pair_mac: primaryAdapterMac,
      pair_os: daemon.osName?.toLowerCase().includes('linux') ? 'linux' : 'windows',
      ...(daemon.pairingPin ? { pair_pin: daemon.pairingPin } : {}),
    });
    const pairUrl = `${baseOrigin}/#${params.toString()}`;
    let cancelled = false;
    QRCode.toDataURL(pairUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    daemon.localIp,
    daemon.port,
    daemon.hostname,
    daemon.osName,
    daemon.pairingPin,
    primaryAdapterMac,
  ]);

  if (!isOpen) return null;

  const dispatchAction = async (action: string, extra?: Record<string, any>) => {
    triggerHapticFeedback('medium');
    setIsLoadingAction(action);
    setActionError(null);
    try {
      const res = await fetch('/api/daemon/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      setServerReachable(res.ok);
      if (res.ok && data.success && data.daemon) {
        const nextDaemon =
          typeof data.rotatedToken === 'string' && data.rotatedToken
            ? { ...data.daemon, pairingToken: data.rotatedToken }
            : data.daemon;
        setDaemon(nextDaemon);
        if (typeof data.rotatedToken === 'string' && data.rotatedToken) {
          setShowToken(true);
        }
      } else {
        setActionError(
          data?.error ||
            (isBg
              ? `Сървърът отказа операцията "${action}" (HTTP ${res.status}).`
              : `Control server rejected "${action}" (HTTP ${res.status}).`)
        );
      }
    } catch {
      setServerReachable(false);
      setActionError(
        isBg
          ? `Няма връзка с Control Server (${action}). Промените не бяха записани.`
          : `Control server unreachable for "${action}". No state changes were persisted.`
      );
    } finally {
      setIsLoadingAction(null);
    }
  };

  const handleCopyUri = () => {
    triggerHapticFeedback('light');
    copyToClipboard(daemon.wsUri);
    setCopiedUri(true);
    scheduleTimer(() => setCopiedUri(false), 1800);
  };

  const handleCopyToken = () => {
    triggerHapticFeedback('light');
    copyToClipboard(daemon.pairingToken);
    setCopiedToken(true);
    scheduleTimer(() => setCopiedToken(false), 1800);
  };

  const handleCopyPin = () => {
    if (!daemon.pairingPin) return;
    triggerHapticFeedback('light');
    copyToClipboard(daemon.pairingPin);
    setCopiedPin(true);
    scheduleTimer(() => setCopiedPin(false), 1800);
  };

  const handleApplyPort = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(portInput);
    if (Number.isInteger(num) && num >= 1024 && num <= 65535) {
      setIsEditingPort(false);
      dispatchAction('update_port', { port: num });
    }
  };

  const handleManualBanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanIp = manualBanIp.trim();
    if (!cleanIp) return;
    dispatchAction('blacklist_client', {
      ip: cleanIp,
      mac: manualBanMac.trim() || '00:00:00:00:00:00',
      device: manualBanDevice.trim() || `Manual IP Ban (${cleanIp})`,
      reason:
        manualBanReason.trim() ||
        (isBg ? 'Ръчно блокиран от оператора' : 'Manually blacklisted by operator'),
    });
    setManualBanIp('');
    setManualBanMac('');
    setManualBanDevice('');
    setManualBanReason('');
  };

  const blacklistedList = daemon.blacklistedDevices || [];

  const avChecks = [
    {
      key: 'upx',
      passed: Boolean(daemon.avIntegrity?.upxDisabled),
      title: isBg ? 'Нулева UPX компресия (upx=False)' : 'Zero UPX Packing (upx=False)',
      desc: isBg
        ? 'Елиминира фалшивите детекции Win32/Wacatac при евристичен анализ'
        : 'Eliminates Win32/Wacatac heuristic unpacker false positives',
    },
    {
      key: 'hwnd',
      passed: Boolean(daemon.avIntegrity?.visibleHwnd),
      title: isBg ? 'Видим Desktop GUI прозорец (HWND)' : 'Visible Native GUI Window (HWND)',
      desc: isBg
        ? 'Прозрачен контролен панел вместо скрит фонов процес'
        : 'Transparent control center instead of headless socket listener',
    },
    {
      key: 'shell',
      passed: Boolean(daemon.avIntegrity?.zeroHiddenShell),
      title: isBg ? 'Без скрити PowerShell / CMD процеси' : 'Zero Hidden Shell Spawns',
      desc: isBg
        ? 'Чиста Python psutil & socket диагностика без shell=True'
        : 'Pure Python psutil & socket NIC diagnostics without shell=True',
    },
    {
      key: 'manifest',
      passed: Boolean(daemon.avIntegrity?.manifestAsInvoker),
      title: isBg ? 'Windows 10/11 Манифест (asInvoker)' : 'Windows 10/11 Manifest (asInvoker)',
      desc: isBg
        ? 'Стандартни права без принудителна UAC ескалация'
        : 'Standard user privilege level + PerMonitorV2 High-DPI awareness',
    },
    {
      key: 'sig',
      passed: Boolean(daemon.avIntegrity?.authenticodeReady),
      title: isBg ? 'SHA-256 Authenticode Подпис' : 'SHA-256 Authenticode Signed',
      desc: isBg
        ? 'Включен sign_binary.ps1 и Defender верификация'
        : 'Includes sign_binary.ps1 & Defender verification',
    },
    {
      key: 'sandbox',
      passed: Boolean(daemon.avIntegrity?.sandboxJobObject),
      title: isBg ? 'Windows Job Object Изолация' : 'Windows Job Object Sandbox',
      desc: isBg
        ? '256MB RAM лимит и автоматично почистване на задачи'
        : '256MB RAM cap & clean process tree lifecycle governance',
    },
  ];
  const passedAvCount = avChecks.filter((c) => c.passed).length;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          triggerHapticFeedback('light');
          onClose();
        }
      }}
      style={{ backgroundColor: 'var(--backdrop-scrim)' }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 backdrop-blur-md select-none"
    >
      <motion.div
        variants={MODAL_BUBBLE_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative w-full max-w-5xl max-h-[93vh] flex flex-col rounded-[28px] glass-liquid-modal overflow-hidden"
      >
        {/* Top Accent Specular Bar */}
        <div className="h-1 w-full bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-secondary)] to-[var(--accent-tertiary)] shrink-0" />

        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-[var(--glass-border)] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 squircle-badge squircle-hero shrink-0">
              <Monitor className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-extrabold ink-primary font-display tracking-tight truncate">
                  {isBg
                    ? `PC Демон център — ${daemon.hostname}`
                    : `Host Control Center — ${daemon.hostname}`}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                    !daemon.isRunning
                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35'
                      : daemon.isPaused
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35'
                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      !daemon.isRunning
                        ? 'bg-rose-500'
                        : daemon.isPaused
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                  />
                  {!daemon.isRunning
                    ? isBg
                      ? 'ОФЛАЙН'
                      : 'OFFLINE'
                    : daemon.isPaused
                    ? isBg
                      ? 'ПАУЗА'
                      : 'PAUSED'
                    : isBg
                    ? 'ОНЛАЙН'
                    : 'LISTENING'}
                </span>
              </div>
              <p className="text-[11px] ink-secondary font-mono truncate">
                {daemon.osName} • {daemon.protocol} • v{daemon.version} • Uptime {daemon.uptime}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/releases/v0.90.0/AI_NetController_HostAgent_v0.90.0_win64.exe"
              download="AI_NetController_HostAgent_v0.90.0_win64.exe"
              onClick={() => triggerHapticFeedback('medium')}
              className="min-h-[38px] px-3.5 py-1.5 rounded-full liquid-hero-btn preserve-white font-display text-xs font-bold flex items-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isBg ? 'Свали .EXE' : 'Download .EXE'}</span>
            </a>

            {onOpenCodeReleases && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onOpenCodeReleases();
                }}
                className="hidden sm:flex min-h-[38px] px-3 py-1.5 rounded-full liquid-control-pill text-xs font-mono font-semibold ink-primary items-center gap-1.5 transition cursor-pointer"
              >
                <FileCode className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                <span>agent_gui.py</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                onClose();
              }}
              className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full liquid-control-pill ink-secondary hover:ink-primary flex items-center justify-center transition cursor-pointer"
              aria-label={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-Window Pill Tabs + Quick Pairing PIN */}
        <div className="px-4 sm:px-6 py-2.5 glass-liquid-subtle border-b border-[var(--glass-border)] flex items-center justify-between gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-full liquid-terminal-entry border border-[var(--glass-border)] overflow-x-auto scrollbar-none">
            {[
              {
                id: 'overview' as const,
                label: isBg ? 'Табло и защита' : 'Overview & Shields',
                icon: Monitor,
                badge: null,
              },
              {
                id: 'devices' as const,
                label: isBg ? 'Клиенти и банове' : 'Peers & Firewall',
                icon: Users,
                badge: `${daemon.connectedClients.length}/${blacklistedList.length}`,
              },
              {
                id: 'setup' as const,
                label: isBg ? 'Настройка и QR' : 'Setup & QR',
                icon: Sparkles,
                badge: null,
              },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    setActiveTab(tab.id);
                  }}
                  className={`relative min-h-[34px] px-3.5 py-1.5 rounded-full text-xs font-display font-bold flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer z-10 ${
                    isActive ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="pcDaemonSubWindowTab"
                      transition={SPRING_BUBBLY}
                      className="absolute inset-0 rounded-full liquid-hero-btn -z-10 transform-gpu"
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span className="text-[10px] font-mono opacity-85 tabular-nums">
                      ({tab.badge})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-mono ink-secondary">
            <span className="hidden sm:inline">PIN:</span>
            <button
              type="button"
              onClick={handleCopyPin}
              className="px-3 py-1 rounded-full bg-amber-500/15 hover:bg-amber-500/22 border border-amber-500/35 text-amber-700 dark:text-amber-300 font-bold tabular-nums flex items-center gap-1.5 cursor-pointer"
              title={isBg ? 'Копирай 6-цифрения ПИН' : 'Copy 6-Digit Pairing PIN'}
            >
              <span>{daemon.pairingPin || '------'}</span>
              {copiedPin ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={() => dispatchAction('rotate_pin')}
              className="w-8 h-8 rounded-full liquid-control-pill ink-secondary hover:ink-primary flex items-center justify-center cursor-pointer"
              title={isBg ? 'Генерирай нов 6-цифрен ПИН' : 'Rotate 6-digit PIN'}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto bouncy-scroll p-4 sm:p-6 space-y-4">
          {actionError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/12 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-200 flex items-center justify-between gap-3">
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="font-display font-bold underline shrink-0 cursor-pointer"
              >
                {isBg ? 'Затвори' : 'Dismiss'}
              </button>
            </div>
          )}

          {!daemon.isRunning && (
            <div className="rounded-2xl border border-amber-500/35 bg-amber-500/12 px-4 py-3 text-xs ink-primary flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <span className="font-display font-bold text-amber-700 dark:text-amber-300 mr-2">
                  {isBg ? 'Хост агентът не е активен' : 'Host Agent Offline'}
                </span>
                <span className="ink-secondary">
                  {isBg
                    ? 'Няма връзка с локалния Python Daemon (ws://127.0.0.1:8765). Стартирайте HostAgent или отворете Настройка.'
                    : 'No live connection to local Python HostAgent (ws://127.0.0.1:8765). Launch HostAgent or open Setup.'}
                </span>
              </div>
              {serverReachable === false && (
                <span className="text-[11px] font-mono font-bold text-rose-600 dark:text-rose-300 shrink-0">
                  Control Server: OFFLINE
                </span>
              )}
            </div>
          )}

          {/* TAB 1: OVERVIEW & SHIELDS */}
          {activeTab === 'overview' && (
            <>
              {/* Quick Telemetry KPI Pills */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)]">
                  <div className="text-[11px] ink-muted font-display font-semibold">
                    CPU ({daemon.cpuCores} {isBg ? 'ядра' : 'cores'})
                  </div>
                  <div className="text-lg font-mono font-extrabold ink-primary tabular-nums mt-0.5">
                    {daemon.cpuPercent}%
                  </div>
                  <div className="mt-1.5 w-full h-1.5 rounded-full bg-[var(--glass-border)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(3, daemon.cpuPercent))}%` }}
                    />
                  </div>
                </div>

                <div className="p-3 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)]">
                  <div className="text-[11px] ink-muted font-display font-semibold">
                    RAM ({daemon.ramUsedGb}/{daemon.ramTotalGb} GB)
                  </div>
                  <div className="text-lg font-mono font-extrabold ink-primary tabular-nums mt-0.5">
                    {daemon.ramPercent}%
                  </div>
                  <div className="mt-1.5 w-full h-1.5 rounded-full bg-[var(--glass-border)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-500 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(3, daemon.ramPercent))}%` }}
                    />
                  </div>
                </div>

                <div className="p-3 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)]">
                  <div className="text-[11px] ink-muted font-display font-semibold">
                    {isBg ? 'Свързани клиенти' : 'Active Peers'}
                  </div>
                  <div className="flex items-baseline justify-between mt-0.5">
                    <span className="text-lg font-mono font-extrabold ink-primary tabular-nums">
                      {daemon.connectedClients.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('devices')}
                      className="text-[11px] font-display font-semibold text-[var(--accent-primary)] hover:underline cursor-pointer"
                    >
                      {isBg ? 'Управление →' : 'Manage →'}
                    </button>
                  </div>
                  <div className="text-[10.5px] font-mono ink-muted mt-1">
                    {blacklistedList.length} {isBg ? 'блокирани' : 'blacklisted'}
                  </div>
                </div>

                <div className="p-3 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)]">
                  <div className="text-[11px] ink-muted font-display font-semibold">
                    {isBg ? 'Целеви стрийм FPS' : 'Stream Target FPS'}
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    {([60, 30, 15] as const).map((fpsOpt) => (
                      <button
                        key={fpsOpt}
                        type="button"
                        onClick={() => dispatchAction('set_target_fps', { fps: fpsOpt })}
                        className={`flex-1 py-1 rounded-full text-[11px] font-mono font-bold border cursor-pointer transition ${
                          (daemon.targetFps || 60) === fpsOpt
                            ? 'bg-[var(--accent-primary)]/18 text-[var(--accent-primary)] border-[var(--accent-primary)]/45'
                            : 'liquid-control-pill ink-secondary hover:ink-primary'
                        }`}
                      >
                        {fpsOpt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Endpoint & Pairing Card */}
              <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 squircle-badge squircle-sky">
                      <Wifi className="w-4 h-4" />
                    </div>
                    <span className="text-xs sm:text-sm font-display font-bold ink-primary">
                      {isBg ? 'Мрежова точка и HMAC ключ' : 'Network Endpoint & Pairing Key'}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-300 font-semibold tabular-nums">
                    Uptime {daemon.uptime}
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {/* WS URI + Port + mDNS */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 liquid-terminal-entry border border-[var(--glass-border)] rounded-2xl px-3.5 py-2.5">
                      <div className="min-w-0">
                        <div className="text-[10px] ink-muted">
                          {isBg ? 'Локален WebSocket адрес' : 'Local WebSocket URI'}
                        </div>
                        <div className="text-xs sm:text-sm font-mono font-bold text-[var(--accent-primary)] truncate tabular-nums">
                          {daemon.wsUri}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyUri}
                        className="px-3 py-1.5 rounded-full liquid-control-pill ink-primary text-xs font-display font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        {copiedUri ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                        )}
                        <span>{copiedUri ? (isBg ? 'Копирано' : 'Copied') : isBg ? 'Копирай' : 'Copy'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="liquid-terminal-entry border border-[var(--glass-border)] rounded-2xl p-2.5 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] ink-muted">{isBg ? 'Порт' : 'Port'}</div>
                          {isEditingPort ? (
                            <form onSubmit={handleApplyPort} className="flex items-center gap-1 mt-0.5">
                              <input
                                type="number"
                                min={1024}
                                max={65535}
                                value={portInput}
                                onChange={(e) => setPortInput(e.target.value)}
                                className="w-18 px-2 py-0.5 rounded-lg glass-liquid-subtle border border-[var(--accent-primary)] text-xs font-mono ink-primary"
                              />
                              <button
                                type="submit"
                                className="px-2 py-0.5 rounded-full liquid-hero-btn preserve-white text-[10px] font-bold cursor-pointer"
                              >
                                OK
                              </button>
                            </form>
                          ) : (
                            <div className="text-xs font-mono font-bold ink-primary tabular-nums">
                              TCP {daemon.port}
                            </div>
                          )}
                        </div>
                        {!isEditingPort && (
                          <button
                            type="button"
                            onClick={() => setIsEditingPort(true)}
                            className="text-[11px] font-display font-semibold text-[var(--accent-primary)] hover:underline cursor-pointer"
                          >
                            {isBg ? 'Промени' : 'Edit'}
                          </button>
                        )}
                      </div>

                      <div className="liquid-terminal-entry border border-[var(--glass-border)] rounded-2xl p-2.5 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="text-[10px] ink-muted">mDNS ZeroConf</div>
                          <div className="text-xs font-mono font-bold ink-primary truncate">
                            {daemon.mdnsEnabled ? '_cst-agent._tcp' : isBg ? 'Изключен' : 'Muted'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => dispatchAction('toggle_mdns')}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border cursor-pointer transition shrink-0 ${
                            daemon.mdnsEnabled
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                              : 'liquid-control-pill ink-muted'
                          }`}
                        >
                          {daemon.mdnsEnabled ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* HMAC Key Card */}
                  <div className="liquid-terminal-entry border border-[var(--glass-border)] rounded-2xl p-3.5 flex flex-col justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className="text-[11px] font-display font-semibold ink-secondary flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                        <span>{isBg ? 'HMAC-SHA256 ключ за сдвояване' : 'HMAC-SHA256 Pairing Key'}</span>
                      </div>
                      <div className="text-xs font-mono ink-primary truncate mt-1">
                        {showToken
                          ? daemon.pairingToken ||
                            (daemon.hasPairingToken
                              ? isBg
                                ? 'Конфигуриран (натиснете Ротирай за нов)'
                                : 'Configured (click Rotate for a fresh key)'
                              : isBg
                              ? 'Не е конфигуриран'
                              : 'Not configured')
                          : '••••••••••••••••••••••••••••'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setShowToken((v) => !v)}
                        className="px-2.5 py-1 rounded-full liquid-control-pill ink-secondary hover:ink-primary text-xs flex items-center gap-1 cursor-pointer"
                      >
                        {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{showToken ? (isBg ? 'Скрий' : 'Hide') : isBg ? 'Покажи' : 'Reveal'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyToken}
                        disabled={!daemon.pairingToken}
                        className="px-2.5 py-1 rounded-full liquid-control-pill ink-primary text-xs font-display font-semibold cursor-pointer disabled:opacity-40"
                      >
                        {copiedToken ? (isBg ? 'Копирано!' : 'Copied!') : isBg ? 'Копирай' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatchAction('rotate_token')}
                        className="px-2.5 py-1 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-700 dark:text-amber-300 text-xs font-display font-bold cursor-pointer"
                      >
                        {isBg ? 'Ротирай' : 'Rotate'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Operator Controls & Local Security Shields */}
              <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 squircle-badge squircle-violet">
                      <Activity className="w-4 h-4" />
                    </div>
                    <span className="text-xs sm:text-sm font-display font-bold ink-primary">
                      {isBg ? 'Управление и защитни щитове' : 'Daemon Controls & Security Shields'}
                    </span>
                  </div>
                  <span className="text-[11px] ink-muted">
                    {isBg ? 'Директен контрол над хоста' : 'Immediate host operator governance'}
                  </span>
                </div>

                {/* Primary 4 Controls (with inline 2-step Panic Disconnect) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    onClick={() => dispatchAction('toggle_pause')}
                    disabled={isLoadingAction === 'toggle_pause'}
                    className={`min-h-[42px] px-3.5 py-2 rounded-2xl font-display text-xs font-bold flex items-center justify-center gap-2 border transition cursor-pointer ${
                      daemon.isPaused
                        ? 'bg-emerald-500/18 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                        : 'bg-[var(--accent-primary)]/14 text-[var(--accent-primary)] border-[var(--accent-primary)]/35'
                    }`}
                  >
                    {daemon.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    <span>
                      {daemon.isPaused
                        ? isBg
                          ? 'Възобнови демона'
                          : 'Resume Daemon'
                        : isBg
                        ? 'Паузирай демона'
                        : 'Pause Daemon'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAction('toggle_view_only')}
                    disabled={isLoadingAction === 'toggle_view_only'}
                    className={`min-h-[42px] px-3.5 py-2 rounded-2xl font-display text-xs font-bold flex items-center justify-center gap-2 border transition cursor-pointer ${
                      daemon.viewOnlyMode
                        ? 'bg-amber-500/18 text-amber-700 dark:text-amber-300 border-amber-500/35'
                        : 'liquid-control-pill ink-primary'
                    }`}
                  >
                    {daemon.viewOnlyMode ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    <span>
                      {daemon.viewOnlyMode
                        ? isBg
                          ? 'Вход: Заключен'
                          : 'Input Locked'
                        : isBg
                        ? 'Вход: Разрешен'
                        : 'Input Allowed'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAction('run_diagnostics')}
                    disabled={isLoadingAction === 'run_diagnostics'}
                    className="min-h-[42px] px-3.5 py-2 rounded-2xl liquid-control-pill font-display text-xs font-bold ink-primary flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-4 h-4 text-[var(--accent-primary)] ${
                        isLoadingAction === 'run_diagnostics' ? 'animate-spin' : ''
                      }`}
                    />
                    <span>{isBg ? 'Тест NIC & WoL' : 'Check NIC & WoL'}</span>
                  </button>

                  {confirmPanic ? (
                    <div className="min-h-[42px] px-2.5 py-1.5 rounded-2xl bg-rose-500/18 border border-rose-500/45 flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmPanic(false);
                          dispatchAction('panic_disconnect');
                        }}
                        className="flex-1 py-1 rounded-full bg-rose-500 text-white font-display text-[11px] font-bold cursor-pointer"
                      >
                        {isBg ? 'Потвърди!' : 'Confirm Drop'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmPanic(false)}
                        className="px-2.5 py-1 rounded-full liquid-control-pill text-[11px] font-semibold ink-primary cursor-pointer"
                      >
                        {isBg ? 'Не' : 'Cancel'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmPanic(true)}
                      disabled={isLoadingAction === 'panic_disconnect'}
                      className="min-h-[42px] px-3.5 py-2 rounded-2xl bg-rose-500/14 hover:bg-rose-500/22 border border-rose-500/35 font-display text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center justify-center gap-2 transition cursor-pointer"
                    >
                      <OctagonAlert className="w-4 h-4" />
                      <span>{isBg ? 'Прекъсни всички' : 'Panic Kill All'}</span>
                    </button>
                  )}
                </div>

                {/* Secondary Shield Pills */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {[
                    {
                      action: 'toggle_clipboard_sync',
                      active: Boolean(daemon.clipboardSyncAllowed),
                      icon: Clipboard,
                      label: isBg ? 'Клипборд синхр.' : 'Clipboard Sync',
                      onText: 'ON',
                      offText: 'LOCKED',
                    },
                    {
                      action: 'toggle_auto_ban',
                      active: Boolean(daemon.autoBanIntrusion),
                      icon: ShieldAlert,
                      label: isBg ? 'Авто-блок (3 опита)' : 'Auto-Ban Shield',
                      onText: 'ON',
                      offText: 'OFF',
                    },
                    {
                      action: 'toggle_subnet_geofence',
                      active: Boolean(daemon.subnetGeofenceOnly),
                      icon: Wifi,
                      label: isBg ? 'Само LAN (Geofence)' : 'LAN Geofence',
                      onText: 'LAN',
                      offText: 'WAN',
                    },
                    {
                      action: 'toggle_auto_lock',
                      active: Boolean(daemon.autoLockOnDisconnect),
                      icon: Lock,
                      label: isBg ? 'Авто-заключване PC' : 'Auto-Lock Drop',
                      onText: 'ARMED',
                      offText: 'OFF',
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.action}
                        type="button"
                        onClick={() => dispatchAction(item.action)}
                        className={`min-h-[38px] px-3 py-1.5 rounded-2xl text-[11px] font-display font-semibold flex items-center justify-between border transition cursor-pointer ${
                          item.active
                            ? 'bg-emerald-500/14 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                            : 'liquid-control-pill ink-secondary'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </span>
                        <span className="font-mono font-bold ml-1.5 shrink-0">
                          {item.active ? item.onText : item.offText}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Collapsible Progressive Disclosure: AV-Safe Binary Integrity */}
              <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    setShowAvChecks((v) => !v);
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between gap-2 text-xs font-display font-bold ink-primary hover:bg-[var(--glass-surface-hover)] transition cursor-pointer"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="truncate">
                      {isBg
                        ? 'AV-Safe интегритет и защита от фалшиви детекции'
                        : 'AV-Safe Binary Integrity & SmartScreen Posture'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shrink-0">
                      {passedAvCount}/{avChecks.length}
                    </span>
                  </span>
                  {showAvChecks ? (
                    <ChevronUp className="w-4 h-4 ink-muted shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 ink-muted shrink-0" />
                  )}
                </button>
                <AnimatePresence initial={false}>
                  {showAvChecks && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-[var(--glass-border)]"
                    >
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {avChecks.map((chk) => (
                          <div
                            key={chk.key}
                            className="p-3 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex items-start gap-2.5"
                          >
                            {chk.passed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            ) : (
                              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            )}
                            <div className="min-w-0">
                              <div className="text-xs font-display font-bold ink-primary">
                                {chk.title}
                              </div>
                              <p className="text-[11px] ink-secondary leading-snug mt-0.5">
                                {chk.desc}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* TAB 2: PEERS & FIREWALL BLACKLIST */}
          {activeTab === 'devices' && (
            <div className="space-y-4">
              <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 squircle-badge squircle-sky shrink-0">
                    <Users className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-extrabold ink-primary">
                      {isBg
                        ? `Свързани контролери (${daemon.connectedClients.length})`
                        : `Connected Controllers (${daemon.connectedClients.length})`}
                    </h3>
                    <p className="text-xs ink-secondary">
                      {isBg
                        ? 'Заключете вход, прекъснете сесия или блокирайте IP/MAC на ниво сокет.'
                        : 'Lock remote input, disconnect a session, or blacklist IP/MAC at the socket layer.'}
                    </p>
                  </div>
                </div>
              </div>

              {daemon.connectedClients.length === 0 ? (
                <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-8 text-center space-y-2">
                  <Users className="w-8 h-8 ink-muted mx-auto" />
                  <div className="text-sm font-display font-bold ink-primary">
                    {isBg ? 'Няма активни сесии в момента' : 'No Active Sessions Currently'}
                  </div>
                  <p className="text-xs ink-secondary max-w-md mx-auto">
                    {isBg
                      ? `Демонът слуша на ${daemon.wsUri}. Свържете мобилния или уеб клиента чрез QR кода.`
                      : `Daemon listening on ${daemon.wsUri}. Pair your mobile or browser client via QR code.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {daemon.connectedClients.map((peer) => {
                    const PeerIcon =
                      peer.platform === 'android' || peer.platform === 'ios' ? Smartphone : Laptop;
                    const inputAllowed = peer.inputAllowed !== false && !daemon.viewOnlyMode;

                    return (
                      <div
                        key={peer.id}
                        className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-10 h-10 squircle-badge squircle-sky shrink-0">
                            <PeerIcon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-display text-sm font-bold ink-primary">
                                {peer.device}
                              </span>
                              <span className="text-xs font-mono font-semibold text-[var(--accent-primary)] tabular-nums">
                                {peer.ip}
                              </span>
                              {peer.mac && (
                                <span className="text-[11px] font-mono ink-muted">· {peer.mac}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] font-mono ink-secondary flex-wrap tabular-nums">
                              <span className="text-emerald-600 dark:text-emerald-300 font-semibold">
                                {peer.auth}
                              </span>
                              <span>·</span>
                              <span>RTT {peer.latencyMs ?? 5} ms</span>
                              <span>·</span>
                              <span>
                                {peer.commandsSent ?? 0} {isBg ? 'команди' : 'cmds'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => dispatchAction('toggle_client_trust', { clientId: peer.id })}
                            className={`min-h-[34px] px-3 py-1 rounded-full font-display text-xs font-semibold flex items-center gap-1 border transition cursor-pointer ${
                              peer.isTrusted
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                                : 'liquid-control-pill ink-secondary'
                            }`}
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>
                              {peer.isTrusted
                                ? isBg
                                  ? 'Доверено'
                                  : 'Trusted'
                                : isBg
                                ? 'Гост'
                                : 'Guest'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => dispatchAction('toggle_client_input', { clientId: peer.id })}
                            className={`min-h-[34px] px-3 py-1 rounded-full font-display text-xs font-semibold flex items-center gap-1 border transition cursor-pointer ${
                              inputAllowed
                                ? 'bg-[var(--accent-primary)]/14 border-[var(--accent-primary)]/35 text-[var(--accent-primary)]'
                                : 'bg-amber-500/15 border-amber-500/35 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {inputAllowed ? (
                              <Unlock className="w-3.5 h-3.5" />
                            ) : (
                              <Lock className="w-3.5 h-3.5" />
                            )}
                            <span>{inputAllowed ? (isBg ? 'Вход' : 'Input') : isBg ? 'Изглед' : 'View'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => dispatchAction('disconnect_client', { clientId: peer.id })}
                            className="min-h-[34px] px-3 py-1 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-700 dark:text-amber-300 font-display text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            <span>{isBg ? 'Прекъсни' : 'Kick'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              dispatchAction('blacklist_client', {
                                clientId: peer.id,
                                ip: peer.ip,
                                mac: peer.mac,
                                device: peer.device,
                                reason: isBg
                                  ? 'Блокиран от оператора'
                                  : 'Blacklisted by operator',
                              })
                            }
                            className="min-h-[34px] px-3 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-700 dark:text-rose-300 font-display text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>{isBg ? 'Блокирай' : 'Ban'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Firewall Blacklist */}
              <div className="rounded-3xl glass-liquid-subtle border border-rose-500/30 p-4 space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[var(--glass-border)]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 squircle-badge squircle-rose shrink-0">
                      <Ban className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-display text-sm font-bold ink-primary">
                        {isBg
                          ? `Черен списък на защитната стена (${blacklistedList.length})`
                          : `Firewall Blacklist (${blacklistedList.length})`}
                      </h4>
                      <p className="text-[11px] ink-secondary">
                        {isBg
                          ? 'Блокирани на ниво TCP/WebSocket сокет.'
                          : 'Dropped immediately at the TCP/WebSocket socket layer.'}
                      </p>
                    </div>
                  </div>

                  {blacklistedList.length > 0 &&
                    (confirmClearBans ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmClearBans(false);
                            dispatchAction('clear_blacklist');
                          }}
                          className="px-3 py-1 rounded-full bg-rose-500 text-white text-xs font-display font-bold cursor-pointer"
                        >
                          {isBg ? 'Потвърди изчистване' : 'Confirm Clear All'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClearBans(false)}
                          className="px-2.5 py-1 rounded-full liquid-control-pill text-xs font-display font-semibold ink-primary cursor-pointer"
                        >
                          {isBg ? 'Отказ' : 'Cancel'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClearBans(true)}
                        className="min-h-[34px] px-3 py-1 rounded-full liquid-control-pill text-xs font-display font-semibold ink-primary flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                        <span>{isBg ? 'Изчисти всички' : 'Clear All Bans'}</span>
                      </button>
                    ))}
                </div>

                <form
                  onSubmit={handleManualBanSubmit}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                >
                  <input
                    type="text"
                    required
                    value={manualBanIp}
                    onChange={(e) => setManualBanIp(e.target.value)}
                    placeholder={isBg ? 'IP адрес (192.168.1.205)' : 'IP Address (192.168.1.205)'}
                    className="sm:col-span-3 px-3 py-2 rounded-xl liquid-terminal-entry border border-[var(--glass-border)] text-xs font-mono ink-primary outline-none focus:border-rose-500"
                  />
                  <input
                    type="text"
                    value={manualBanMac}
                    onChange={(e) => setManualBanMac(e.target.value)}
                    placeholder={isBg ? 'MAC (по избор)' : 'MAC (optional)'}
                    className="sm:col-span-3 px-3 py-2 rounded-xl liquid-terminal-entry border border-[var(--glass-border)] text-xs font-mono ink-primary outline-none focus:border-rose-500"
                  />
                  <input
                    type="text"
                    value={manualBanReason}
                    onChange={(e) => setManualBanReason(e.target.value)}
                    placeholder={isBg ? 'Причина за блокиране' : 'Ban reason'}
                    className="sm:col-span-4 px-3 py-2 rounded-xl liquid-terminal-entry border border-[var(--glass-border)] text-xs font-mono ink-primary outline-none focus:border-rose-500"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-2 min-h-[36px] px-3 py-2 rounded-full bg-rose-500 hover:bg-rose-400 text-white font-display text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>{isBg ? 'Блокирай' : 'Ban IP'}</span>
                  </button>
                </form>

                {blacklistedList.length === 0 ? (
                  <div className="p-3.5 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] text-xs ink-muted text-center">
                    {isBg ? 'Няма блокирани IP/MAC адреси.' : 'No blacklisted IP or MAC addresses.'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto bouncy-scroll">
                    {blacklistedList.map((ban) => (
                      <div
                        key={ban.id}
                        className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold ink-primary">{ban.device}</span>
                            <span className="text-rose-600 dark:text-rose-300 tabular-nums">
                              {ban.ip}
                            </span>
                            <span className="ink-muted">· {ban.mac}</span>
                          </div>
                          <div className="text-[11px] ink-secondary truncate">{ban.reason}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => dispatchAction('unban_device', { banId: ban.id, ip: ban.ip })}
                          className="min-h-[34px] px-3 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 font-display font-bold flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-auto"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isBg ? 'Отблокирай' : 'Unban'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SETUP & QR */}
          {activeTab === 'setup' && (
            <div className="space-y-4">
              {setupCompletedBanner && (
                <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-xs font-display font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    {isBg
                      ? 'Конфигурацията на PC демона е запазена успешно!'
                      : 'PC Daemon Setup & Security Profile saved and activated!'}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 space-y-4">
                  {/* Adapters & Startup */}
                  <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold ink-primary">
                        {isBg ? '1. Мрежови адаптери и стартиране' : '1. Network Adapters & Startup'}
                      </h3>
                      <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-300 font-semibold">
                        UDP 9 + TCP {daemon.port}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {daemon.activeAdapters.map((nic, i) => (
                        <div
                          key={i}
                          className="p-3 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex items-center justify-between text-xs font-mono"
                        >
                          <div>
                            <div className="ink-primary font-bold">{nic.name}</div>
                            <div className="text-[11px] ink-secondary">
                              IPv4: <span className="text-[var(--accent-primary)]">{nic.ipv4}</span> ·
                              MAC: <span className="text-emerald-600 dark:text-emerald-300">{nic.mac}</span>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            ACTIVE
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => dispatchAction('run_diagnostics')}
                        className="min-h-[36px] px-3.5 py-1.5 rounded-full liquid-control-pill ink-primary font-display text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                        <span>{isBg ? 'Провери портове и WoL' : 'Verify Ports & WoL'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => dispatchAction('toggle_autostart')}
                        className={`min-h-[36px] px-3.5 py-1.5 rounded-full font-display text-xs font-semibold border cursor-pointer ${
                          daemon.autoStartOnBoot
                            ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                            : 'liquid-control-pill ink-secondary'
                        }`}
                      >
                        {daemon.autoStartOnBoot
                          ? isBg
                            ? '✓ Стартиране с Windows: ВКЛ'
                            : '✓ Run on Startup: ON'
                          : isBg
                          ? 'Стартиране с Windows: ИЗКЛ'
                          : 'Run on Startup: OFF'}
                      </button>
                    </div>
                  </div>

                  {/* Security Profiles */}
                  <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 space-y-3">
                    <h3 className="font-display text-sm font-bold ink-primary">
                      {isBg ? '2. Профил за сигурност' : '2. Security & Remote Access Profile'}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {[
                        {
                          id: 'zero_trust' as const,
                          title: isBg ? 'Zero-Trust Стриктен' : 'Zero-Trust Strict',
                          desc: isBg
                            ? 'HITL + Авто-бан + Заключен клипборд'
                            : 'HITL + Auto-Ban + Clipboard locked',
                        },
                        {
                          id: 'balanced' as const,
                          title: isBg ? 'Балансиран LAN' : 'Balanced LAN',
                          desc: isBg
                            ? 'HMAC-SHA256 + HITL за критични команди'
                            : 'HMAC-SHA256 + HITL for admin cmds',
                        },
                        {
                          id: 'view_only' as const,
                          title: isBg ? 'Само преглед' : 'View-Only',
                          desc: isBg
                            ? 'Само видео поток; входът е заключен'
                            : 'Screen stream only; input locked',
                        },
                      ].map((prof) => {
                        const isSelected = (daemon.securityProfile || 'balanced') === prof.id;
                        return (
                          <button
                            key={prof.id}
                            type="button"
                            onClick={() =>
                              dispatchAction('apply_security_profile', { profile: prof.id })
                            }
                            className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
                              isSelected
                                ? 'bg-[var(--accent-primary)]/14 border-[var(--accent-primary)]/50'
                                : 'liquid-terminal-entry border-[var(--glass-border)] hover:border-[var(--accent-primary)]/35'
                            }`}
                          >
                            <div className="text-xs font-display font-bold ink-primary flex items-center justify-between gap-1">
                              <span>{prof.title}</span>
                              {isSelected && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-primary)] shrink-0" />
                              )}
                            </div>
                            <p className="text-[11px] ink-secondary mt-1.5 leading-snug">{prof.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* White-Framed QR + Complete Setup */}
                <div className="lg:col-span-5 rounded-3xl glass-liquid-subtle border border-[var(--accent-primary)]/30 p-4 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold ink-primary flex items-center gap-2">
                        <QrCode className="w-4 h-4 text-[var(--accent-primary)]" />
                        <span>{isBg ? '3. Сдвояване с QR + PIN' : '3. Phone QR + PIN'}</span>
                      </h3>
                      <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-300">
                        PIN: {daemon.pairingPin || '------'}
                      </span>
                    </div>

                    <div className="flex flex-col items-center text-center p-4 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] space-y-3">
                      {qrDataUrl && (
                        <div className="w-36 h-36 rounded-2xl bg-white p-2.5 shadow-md border border-black/10 flex items-center justify-center">
                          <img
                            src={qrDataUrl}
                            alt="Daemon Setup Pairing QR"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-contain rounded-lg"
                          />
                        </div>
                      )}
                      <p className="text-[11px] ink-secondary max-w-xs leading-snug">
                        {isBg
                          ? 'Сканирайте QR кода с телефона си за автоматично добавяне на този компютър.'
                          : 'Scan this QR code with your phone camera to auto-pair this PC.'}
                      </p>
                    </div>
                  </div>

                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                    transition={SPRING_POP}
                    onClick={() => {
                      dispatchAction('complete_setup');
                      setSetupCompletedBanner(true);
                      scheduleTimer(() => setSetupCompletedBanner(false), 3500);
                    }}
                    className="w-full min-h-[42px] py-2.5 px-4 rounded-full liquid-hero-btn preserve-white font-display font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isBg ? 'Завърши и активирай защитата' : 'Complete Setup & Activate'}
                    </span>
                  </motion.button>
                </div>
              </div>
            </div>
          )}

          {/* Collapsible Progressive Disclosure: Live Daemon Event Log */}
          <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  setShowDaemonLog((v) => !v);
                }}
                className="flex items-center gap-2 text-xs font-display font-bold ink-primary cursor-pointer"
              >
                <Terminal className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
                <span>
                  {isBg ? 'Журнал на събитията на PC демона' : 'Live PC Daemon Event Log'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono liquid-control-pill ink-muted tabular-nums">
                  {daemon.logs.length}
                </span>
                {showDaemonLog ? (
                  <ChevronUp className="w-4 h-4 ink-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 ink-muted" />
                )}
              </button>

              {daemon.logs.length > 0 &&
                (confirmClearLogs ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmClearLogs(false);
                        dispatchAction('clear_logs');
                      }}
                      className="px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-display font-bold cursor-pointer"
                    >
                      {isBg ? 'Потвърди' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearLogs(false)}
                      className="px-2.5 py-1 rounded-full liquid-control-pill text-[11px] font-display font-semibold ink-primary cursor-pointer"
                    >
                      {isBg ? 'Отказ' : 'Cancel'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearLogs(true)}
                    className="px-2.5 py-1 rounded-full liquid-control-pill text-[11px] font-display font-semibold ink-secondary hover:ink-primary cursor-pointer"
                  >
                    {isBg ? 'Изчисти' : 'Clear Log'}
                  </button>
                ))}
            </div>

            <AnimatePresence initial={false}>
              {showDaemonLog && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-[var(--glass-border)]"
                >
                  <div className="p-3">
                    <div className="p-3 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] font-mono text-[11px] max-h-40 overflow-y-auto bouncy-scroll space-y-1">
                      {daemon.logs.length === 0 ? (
                        <div className="ink-muted text-center py-2">
                          {isBg ? 'Няма записани събития.' : 'No daemon log entries yet.'}
                        </div>
                      ) : (
                        daemon.logs.map((entry, idx) => (
                          <div key={idx} className="leading-relaxed flex items-start gap-2">
                            <span className="ink-muted shrink-0 tabular-nums">[{entry.time}]</span>
                            <span
                              className={`shrink-0 font-bold ${
                                entry.level === 'ALERT'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : entry.level === 'WARN'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : entry.level === 'SECURITY'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : entry.level === 'DIAG'
                                  ? 'text-[var(--accent-primary)]'
                                  : 'ink-secondary'
                              }`}
                            >
                              [{entry.level}]
                            </span>
                            <span className="ink-primary break-words">{entry.message}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
