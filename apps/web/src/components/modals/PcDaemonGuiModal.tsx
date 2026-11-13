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
  Gauge,
  QrCode,
  Trash2,
} from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';
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
  version: '0.60.0',
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

  // Manual Blacklist Form State
  const [manualBanIp, setManualBanIp] = useState('');
  const [manualBanMac, setManualBanMac] = useState('');
  const [manualBanDevice, setManualBanDevice] = useState('');
  const [manualBanReason, setManualBanReason] = useState('');

  // Setup Wizard State
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [setupCompletedBanner, setSetupCompletedBanner] = useState(false);

  const fetchDaemonState = useCallback(async () => {
    try {
      const res = await fetch('/api/daemon/state', { credentials: 'include' });
      const data = await res.json();
      setServerReachable(res.ok);
      if (res.ok && data.success && data.daemon) {
        setDaemon(data.daemon);
        if (!isEditingPort) {
          setPortInput(String(data.daemon.port));
        }
      } else {
        setDaemon((prev) => ({ ...prev, isRunning: false }));
      }
    } catch {
      setServerReachable(false);
      setDaemon((prev) => ({ ...prev, isRunning: false }));
    }
  }, [isEditingPort]);

  useEffect(() => {
    if (!isOpen) return;
    fetchDaemonState();
    const timer = setInterval(fetchDaemonState, 1000);
    return () => clearInterval(timer);
  }, [isOpen, fetchDaemonState]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Generate QR code for Setup tab
  useEffect(() => {
    if (!isOpen) return;
    const primaryMac = daemon.activeAdapters?.[0]?.mac || '';
    const baseOrigin =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `http://${daemon.localIp}:${window.location.port || 3000}`
        : window.location.origin;
    const params = new URLSearchParams({
      pair_ip: daemon.localIp,
      pair_port: String(daemon.port),
      pair_name: daemon.hostname,
      pair_mac: primaryMac,
      pair_os: daemon.osName?.toLowerCase().includes('linux') ? 'linux' : 'windows',
      ...(daemon.pairingPin ? { pair_pin: daemon.pairingPin } : {}),
    });
    const pairUrl = `${baseOrigin}/#${params.toString()}`;
    QRCode.toDataURL(pairUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#e0f2fe', light: '#070c18' },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => {});
  }, [isOpen, daemon.localIp, daemon.port, daemon.hostname, daemon.osName, daemon.pairingPin, daemon.activeAdapters]);

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
        setDaemon(data.daemon);
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
      reason: manualBanReason.trim() || (isBg ? 'Ръчно блокиран от оператора' : 'Manually blacklisted by operator'),
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
        ? 'Прозрачен Tkinter контролен панел вместо скрит фонов процес'
        : 'Transparent Tkinter control center instead of headless socket listener',
    },
    {
      key: 'shell',
      passed: Boolean(daemon.avIntegrity?.zeroHiddenShell),
      title: isBg ? 'Без скрити PowerShell / CMD процеси' : 'Zero Hidden PowerShell / CMD Spawns',
      desc: isBg
        ? 'Чиста Python psutil & socket NIC диагностика без shell=True'
        : 'Pure Python psutil & socket NIC diagnostics without shell=True',
    },
    {
      key: 'manifest',
      passed: Boolean(daemon.avIntegrity?.manifestAsInvoker),
      title: isBg ? 'Windows 10/11 Манифест (asInvoker)' : 'Windows 10/11 Manifest (asInvoker)',
      desc: isBg
        ? 'Без принудителна UAC ескалация + PerMonitorV2 High-DPI скалиране'
        : 'Standard user privilege level + PerMonitorV2 High-DPI awareness',
    },
    {
      key: 'sig',
      passed: Boolean(daemon.avIntegrity?.authenticodeReady),
      title: isBg ? 'SHA-256 Authenticode Подпис' : 'SHA-256 Authenticode Signed',
      desc: isBg
        ? 'Включен sign_binary.ps1 и MpCmdRun.exe Defender верификация'
        : 'Includes sign_binary.ps1 & MpCmdRun.exe Defender verification',
    },
    {
      key: 'sandbox',
      passed: Boolean(daemon.avIntegrity?.sandboxJobObject),
      title: isBg ? 'Windows Job Object Изолация' : 'Windows Job Object Sandbox',
      desc: isBg
        ? '256MB RAM лимит и автоматично почистване на дъщерни задачи'
        : '256MB RAM cap & clean process tree lifecycle governance',
    },
  ];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          triggerHapticFeedback('light');
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none"
    >
      <div className="relative w-full max-w-5xl max-h-[93vh] flex flex-col rounded-[24px] bg-[#091020]/96 backdrop-blur-3xl border border-white/15 border-t-white/25 shadow-[0_24px_64px_rgba(0,0,0,0.92)] overflow-hidden">
        {/* Native Desktop Window Titlebar Chrome */}
        <div className="px-4 sm:px-6 py-3.5 bg-[#060b16] border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.2)] shrink-0">
              <Monitor className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white font-display tracking-wide truncate">
                  {isBg
                    ? `AI NetController PC Демон — ${daemon.hostname}`
                    : `AI NetController Host Control Center — ${daemon.hostname}`}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                    !daemon.isRunning
                      ? 'bg-rose-500/15 text-rose-300 border-rose-400/40'
                      : daemon.isPaused
                      ? 'bg-amber-500/15 text-amber-300 border-amber-400/40'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      !daemon.isRunning ? 'bg-rose-400' : daemon.isPaused ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                  />
                  {!daemon.isRunning
                    ? isBg
                      ? 'ОФЛАЙН • СПРЯН'
                      : 'OFFLINE • STOPPED'
                    : daemon.isPaused
                    ? isBg
                      ? 'ПАУЗИРАН'
                      : 'PAUSED'
                    : isBg
                    ? 'ОНЛАЙН • СЛУША'
                    : 'ONLINE • LISTENING'}
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/12 border border-cyan-400/30 text-cyan-300 text-[10px] font-mono font-semibold">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  <span>{isBg ? 'AV-Safe Верифициран' : 'AV-Safe Verified'}</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono truncate">
                {daemon.osName} • {daemon.protocol} • v{daemon.version} • Uptime: {daemon.uptime}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/releases/v0.60.0/AI_NetController_HostAgent_v0.60.0_win64.exe"
              download="AI_NetController_HostAgent_v0.60.0_win64.exe"
              onClick={() => triggerHapticFeedback('medium')}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-mono text-xs font-bold flex items-center gap-1.5 shadow-[0_0_15px_rgba(34,211,238,0.3)] transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isBg ? 'Свали .EXE (GUI)' : 'Download .EXE (GUI)'}</span>
            </a>

            {onOpenCodeReleases && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onOpenCodeReleases();
                }}
                className="hidden sm:flex min-h-[40px] px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-mono text-slate-200 items-center gap-1.5 transition cursor-pointer"
              >
                <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>agent_gui.py</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                onClose();
              }}
              className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 flex items-center justify-center transition cursor-pointer"
              aria-label={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Sub-Window Bar: [ Overview & Safeguards ] | [ Connected Devices & Blacklist (N) ] | [ Guided Setup Process ] */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#070c18] border-b border-white/10 flex items-center justify-between gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-[#0b1324] border border-white/10 overflow-x-auto scrollbar-none">
            {[
              {
                id: 'overview' as const,
                label: isBg ? 'Табло и Защита' : 'Overview & Safeguards',
                icon: Monitor,
                badge: null,
              },
              {
                id: 'devices' as const,
                label: isBg ? 'Свързани Устройства и Черен Списък' : 'Connected Devices & Blacklist',
                icon: Users,
                badge: `${daemon.connectedClients.length} / ${blacklistedList.length} Ban`,
              },
              {
                id: 'setup' as const,
                label: isBg ? 'Процес на Настройка (Wizard)' : 'Guided Setup Process',
                icon: Sparkles,
                badge: isBg ? '4 Стъпки' : '4 Steps',
              },
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {

                    setActiveTab(tab.id);
                  }}
                  className={`relative min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-display font-bold flex items-center gap-2 whitespace-nowrap transition cursor-pointer z-10 ${
                    isActive ? 'text-cyan-200' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="pcDaemonSubWindowTab"
                      transition={SPRING_BUBBLY}
                      className="absolute inset-0 rounded-xl bg-cyan-500/20 border border-cyan-400/40 shadow-[0_0_12px_rgba(34,211,238,0.18)] -z-10 transform-gpu"
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span className="text-[10px] font-mono text-cyan-300/90 tabular-nums ml-0.5">
                      ({tab.badge})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
            <span>PIN:</span>
            <button
              type="button"
              onClick={handleCopyPin}
              className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-300 font-bold tabular-nums flex items-center gap-1 cursor-pointer"
              title={isBg ? 'Копирай 6-цифрения ПИН за сдвояване' : 'Copy 6-Digit Pairing PIN'}
            >
              <span>{daemon.pairingPin || '------'}</span>
              {copiedPin ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={() => dispatchAction('rotate_pin')}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 cursor-pointer"
              title={isBg ? 'Генерирай нов 6-цифрен ПИН' : 'Generate new 6-digit PIN'}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Main Scrollable Desktop GUI Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {actionError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-2.5 text-xs text-rose-200 flex items-center justify-between gap-3">
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-rose-300 hover:text-white underline shrink-0"
              >
                {isBg ? 'Затвори' : 'Dismiss'}
              </button>
            </div>
          )}

          {!daemon.isRunning && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <span className="font-bold text-amber-300 uppercase tracking-wider mr-2">
                  {isBg ? 'Хост агентът не е активен' : 'Host Agent Offline'}
                </span>
                <span className="text-amber-100/90">
                  {isBg
                    ? 'Няма връзка с локалния Python Daemon (ws://127.0.0.1:8765). Стартирайте HostAgent или използвайте INSTALLERS за настройка.'
                    : 'No live connection to the local Python HostAgent (ws://127.0.0.1:8765). Start HostAgent on the target PC or open Setup to pair.'}
                </span>
              </div>
              {serverReachable === false && (
                <span className="text-[11px] font-mono text-rose-300 shrink-0">
                  {isBg ? 'Control Server: OFFLINE' : 'Control Server: OFFLINE'}
                </span>
              )}
            </div>
          )}

          {daemon.isRunning && serverReachable === false && !actionError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200 flex items-center justify-between gap-2">
              <span>
                {isBg
                  ? 'Локалният сървър за управление (/api/daemon) не отговаря в момента.'
                  : 'Local control server (/api/daemon) is currently unreachable.'}
              </span>
              <span className="text-[11px] font-mono text-rose-300 shrink-0">
                Control Server: OFFLINE
              </span>
            </div>
          )}

          {/* =====================================================================
              TAB 1: OVERVIEW & SAFEGUARDS
             ===================================================================== */}
          {activeTab === 'overview' && (
            <>
              {/* ROW 1: Network & Pairing Endpoint Card + Live Hardware Telemetry Card */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Left (6 cols): Network & Pairing Endpoint */}
                <div className="lg:col-span-6 rounded-2xl bg-[#0b1324]/75 border border-white/10 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/[0.07] pb-2">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider">
                        {isBg ? 'Мрежова точка и сдвояване' : 'Network & Pairing Endpoint'}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-emerald-300 tabular-nums">
                      Uptime: {daemon.uptime}
                    </span>
                  </div>

                  {/* WebSocket URI */}
                  <div className="flex items-center justify-between gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-slate-400">
                        {isBg ? 'Локален WebSocket адрес' : 'Local WebSocket URI'}
                      </div>
                      <div className="text-xs sm:text-sm font-mono font-bold text-cyan-300 truncate tabular-nums">
                        {daemon.wsUri}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyUri}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-cyan-200 text-xs font-mono font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer transition"
                    >
                      {copiedUri ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedUri ? (isBg ? 'Копирано' : 'Copied') : isBg ? 'Копирай URI' : 'Copy URI'}</span>
                    </button>
                  </div>

                  {/* Port & mDNS Info */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-black/30 border border-white/[0.07] rounded-xl p-2.5 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-mono text-slate-400">
                          {isBg ? 'Слушащ Порт' : 'Listening Port'}
                        </div>
                        {isEditingPort ? (
                          <form onSubmit={handleApplyPort} className="flex items-center gap-1 mt-0.5">
                            <input
                              type="number"
                              min={1024}
                              max={65535}
                              value={portInput}
                              onChange={(e) => setPortInput(e.target.value)}
                              className="w-20 px-1.5 py-0.5 rounded bg-black border border-cyan-400 text-xs font-mono text-white"
                            />
                            <button
                              type="submit"
                              className="px-2 py-0.5 rounded bg-cyan-400 text-slate-950 text-[10px] font-mono font-bold cursor-pointer"
                            >
                              OK
                            </button>
                          </form>
                        ) : (
                          <div className="text-xs font-mono font-bold text-white tabular-nums">
                            TCP {daemon.port}
                          </div>
                        )}
                      </div>
                      {!isEditingPort && (
                        <button
                          type="button"
                          onClick={() => setIsEditingPort(true)}
                          className="text-[10px] font-mono text-cyan-400 hover:underline cursor-pointer"
                        >
                          {isBg ? 'Промени' : 'Change'}
                        </button>
                      )}
                    </div>

                    <div className="bg-black/30 border border-white/[0.07] rounded-xl p-2.5 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-mono text-slate-400">mDNS ZeroConf</div>
                        <div className="text-xs font-mono font-bold text-white truncate">
                          {daemon.mdnsEnabled ? '_ai-net._tcp' : isBg ? 'Изключен' : 'Muted'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => dispatchAction('toggle_mdns')}
                        className={`px-2 py-1 rounded-lg text-[10px] font-mono font-semibold border cursor-pointer transition ${
                          daemon.mdnsEnabled
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                            : 'bg-white/5 text-slate-400 border-white/10'
                        }`}
                      >
                        {daemon.mdnsEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>

                  {/* Pairing Key Management */}
                  <div className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                        <KeyRound className="w-3 h-3 text-amber-400" />
                        <span>{isBg ? 'HMAC-SHA256 Ключ за сдвояване' : 'HMAC-SHA256 Pairing Key'}</span>
                      </div>
                      <div className="text-xs font-mono text-slate-200 truncate mt-0.5">
                        {showToken
                          ? daemon.pairingToken ||
                            (daemon.hasPairingToken
                              ? isBg
                                ? 'Скрит (натиснете Ротирай за нов)'
                                : 'Configured (click Rotate to reveal new key)'
                              : isBg
                              ? 'Не е конфигуриран'
                              : 'Not configured')
                          : '••••••••••••••••••••••••••••'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowToken((v) => !v)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 cursor-pointer"
                        title={showToken ? 'Hide Key' : 'Show Key'}
                      >
                        {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyToken}
                        disabled={!daemon.pairingToken}
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-mono text-cyan-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {copiedToken ? (isBg ? 'Копирано!' : 'Copied!') : isBg ? 'Копирай' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatchAction('rotate_token')}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-[11px] font-mono text-amber-300 cursor-pointer"
                        title={isBg ? 'Генерирай нов криптографски ключ' : 'Rotate pairing key'}
                      >
                        {isBg ? 'Ротирай' : 'Rotate'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right (6 cols): Live PC Hardware Telemetry & Active Peers Summary */}
                <div className="lg:col-span-6 rounded-2xl bg-[#0b1324]/75 border border-white/10 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/[0.07] pb-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider">
                        {isBg ? 'Системна телеметрия и стрийминг' : 'System Telemetry & Stream Pipeline'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {([60, 30, 15] as const).map((fpsOpt) => (
                        <button
                          key={fpsOpt}
                          type="button"
                          onClick={() => dispatchAction('set_target_fps', { fps: fpsOpt })}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border cursor-pointer transition ${
                            (daemon.targetFps || 60) === fpsOpt
                              ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40'
                              : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                          }`}
                        >
                          {fpsOpt} FPS
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* CPU & RAM Progress Bars */}
                  <div className="space-y-2.5">
                    <div>
                      <div className="flex items-center justify-between text-xs font-mono mb-1">
                        <span className="text-slate-300">
                          CPU ({daemon.cpuCores} {isBg ? 'ядра' : 'cores'})
                        </span>
                        <span className="text-cyan-300 font-bold tabular-nums">{daemon.cpuPercent}%</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-black/60 overflow-hidden border border-white/10">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(2, daemon.cpuPercent))}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs font-mono mb-1">
                        <span className="text-slate-300">RAM Memory (Job Limit: 256 MB)</span>
                        <span className="text-cyan-300 font-bold tabular-nums">
                          {daemon.ramPercent}% ({daemon.ramUsedGb} / {daemon.ramTotalGb} GB)
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-black/60 overflow-hidden border border-white/10">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-400 to-cyan-400 transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(2, daemon.ramPercent))}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Connected Controllers Quick Summary + Open Devices Window Button */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1.5">
                      <span>
                        {isBg
                          ? `Активни контролери (${daemon.connectedClients.length}) • Блокирани (${blacklistedList.length})`
                          : `Active Controllers (${daemon.connectedClients.length}) • Blacklisted (${blacklistedList.length})`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('devices')}
                        className="text-cyan-400 hover:underline font-bold cursor-pointer"
                      >
                        {isBg ? 'Управлявай устройствата →' : 'Manage Devices & Bans →'}
                      </button>
                    </div>

                    {daemon.connectedClients.length === 0 ? (
                      <div className="p-2.5 rounded-xl bg-black/30 border border-white/[0.06] text-xs font-mono text-slate-400">
                        {isBg
                          ? `Няма активни сесии (Слуша на порт ${daemon.port})`
                          : `No active sessions (Listening on port ${daemon.port})`}
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-28 overflow-y-auto">
                        {daemon.connectedClients.map((peer) => (
                          <div
                            key={peer.id}
                            className="px-3 py-1.5 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between gap-2 text-xs font-mono"
                          >
                            <div className="min-w-0 truncate">
                              <span className="text-white font-semibold">{peer.device}</span>
                              <span className="text-slate-400 ml-2">({peer.ip})</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => dispatchAction('disconnect_client', { clientId: peer.id })}
                                className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-[10px] text-amber-300 cursor-pointer"
                              >
                                {isBg ? 'Прекъсни' : 'Kick'}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  dispatchAction('blacklist_client', {
                                    clientId: peer.id,
                                    ip: peer.ip,
                                    mac: peer.mac,
                                    device: peer.device,
                                  })
                                }
                                className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[10px] text-rose-300 cursor-pointer"
                              >
                                {isBg ? 'Блокирай' : 'Ban'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ROW 2: Operator Safeguards & Security Shields */}
              <div className="rounded-2xl bg-[#0b1324]/85 border border-white/12 p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span>
                      {isBg
                        ? 'Управление на демона и защитни щитове на хоста'
                        : 'Daemon Controls & Local Host Security Shields'}
                    </span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {isBg ? 'Директен контрол над локалния компютър' : 'Immediate local operator governance'}
                  </span>
                </div>

                {/* Primary 4 Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    onClick={() => dispatchAction('toggle_pause')}
                    disabled={isLoadingAction === 'toggle_pause'}
                    className={`min-h-[44px] px-3.5 py-2.5 rounded-xl font-mono text-xs font-bold flex items-center justify-center gap-2 border transition cursor-pointer ${
                      daemon.isPaused
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-400/40'
                        : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-400/35'
                    }`}
                  >
                    {daemon.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    <span>
                      {daemon.isPaused
                        ? isBg
                          ? 'Възобнови Демона'
                          : 'Resume Daemon'
                        : isBg
                        ? 'Паузирай Демона'
                        : 'Pause Daemon'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAction('toggle_view_only')}
                    disabled={isLoadingAction === 'toggle_view_only'}
                    className={`min-h-[44px] px-3.5 py-2.5 rounded-xl font-mono text-xs font-bold flex items-center justify-center gap-2 border transition cursor-pointer ${
                      daemon.viewOnlyMode
                        ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-400/40'
                        : 'bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 border-white/15'
                    }`}
                  >
                    {daemon.viewOnlyMode ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    <span>
                      {daemon.viewOnlyMode
                        ? isBg
                          ? 'Само преглед (Вход заключен)'
                          : 'View-Only (Input Locked)'
                        : isBg
                        ? 'Вход: Разрешен'
                        : 'Remote Input: Allowed'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAction('run_diagnostics')}
                    disabled={isLoadingAction === 'run_diagnostics'}
                    className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 font-mono text-xs font-bold text-cyan-300 flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${isLoadingAction === 'run_diagnostics' ? 'animate-spin' : ''}`}
                    />
                    <span>{isBg ? 'Тест на NIC & WoL' : 'Check NIC & WoL'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAction('panic_disconnect')}
                    disabled={isLoadingAction === 'panic_disconnect'}
                    className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 font-mono text-xs font-bold text-rose-300 flex items-center justify-center gap-2 transition cursor-pointer"
                  >
                    <OctagonAlert className="w-4 h-4 text-rose-400" />
                    <span>{isBg ? 'Прекъсни всички сесии' : 'Panic Disconnect All'}</span>
                  </button>
                </div>

                {/* Secondary Advanced Safeguards Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => dispatchAction('toggle_clipboard_sync')}
                    className={`min-h-[40px] px-3 py-2 rounded-xl font-mono text-[11px] flex items-center justify-between border transition cursor-pointer ${
                      daemon.clipboardSyncAllowed
                        ? 'bg-emerald-500/12 border-emerald-400/30 text-emerald-200'
                        : 'bg-white/[0.04] border-white/10 text-slate-400'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Clipboard className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{isBg ? 'Клипборд Синхр.' : 'Clipboard Sync'}</span>
                    </span>
                    <span className="font-bold">{daemon.clipboardSyncAllowed ? 'ON' : 'LOCKED'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAction('toggle_auto_ban')}
                    className={`min-h-[40px] px-3 py-2 rounded-xl font-mono text-[11px] flex items-center justify-between border transition cursor-pointer ${
                      daemon.autoBanIntrusion
                        ? 'bg-emerald-500/12 border-emerald-400/30 text-emerald-200'
                        : 'bg-white/[0.04] border-white/10 text-slate-400'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{isBg ? 'Авто-Блок (3 опита)' : 'Auto-Ban Shield'}</span>
                    </span>
                    <span className="font-bold">{daemon.autoBanIntrusion ? 'ON' : 'OFF'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAction('toggle_subnet_geofence')}
                    className={`min-h-[40px] px-3 py-2 rounded-xl font-mono text-[11px] flex items-center justify-between border transition cursor-pointer ${
                      daemon.subnetGeofenceOnly
                        ? 'bg-cyan-500/12 border-cyan-400/30 text-cyan-200'
                        : 'bg-white/[0.04] border-white/10 text-slate-400'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Wifi className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{isBg ? 'Само LAN (Geofence)' : 'LAN Geofence Only'}</span>
                    </span>
                    <span className="font-bold">{daemon.subnetGeofenceOnly ? 'ON' : 'WAN OK'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => dispatchAction('toggle_auto_lock')}
                    className={`min-h-[40px] px-3 py-2 rounded-xl font-mono text-[11px] flex items-center justify-between border transition cursor-pointer ${
                      daemon.autoLockOnDisconnect
                        ? 'bg-amber-500/15 border-amber-400/35 text-amber-200'
                        : 'bg-white/[0.04] border-white/10 text-slate-400'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{isBg ? 'Авто-Заключване PC' : 'Auto-Lock on Drop'}</span>
                    </span>
                    <span className="font-bold">{daemon.autoLockOnDisconnect ? 'ARMED' : 'OFF'}</span>
                  </button>
                </div>
              </div>

              {/* ROW 3: Antivirus False-Positive Prevention & Binary Integrity Architecture */}
              <div className="rounded-2xl bg-[#0b1324]/75 border border-emerald-500/25 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.07] pb-2.5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold text-emerald-300 uppercase tracking-wider">
                      {isBg
                        ? 'Защита срещу фалшиви антивирусни сигнали (AV-Safe Architecture)'
                        : 'Antivirus False-Positive Prevention & Clean Binary Architecture'}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    Windows Defender • SmartScreen • CrowdStrike • Malwarebytes
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {avChecks.map((chk) => (
                    <div
                      key={chk.key}
                      className="p-2.5 rounded-xl bg-black/35 border border-white/[0.07] flex items-start gap-2.5"
                    >
                      {chk.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-mono font-bold text-white">{chk.title}</div>
                        <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{chk.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* =====================================================================
              TAB 2: ALL CONNECTED DEVICES & BLACKLIST MANAGER WINDOW
             ===================================================================== */}
          {activeTab === 'devices' && (
            <div className="space-y-4">
              {/* Top Action Header for Connected Devices */}
              <div className="rounded-2xl bg-[#0b1324]/85 border border-white/12 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <Users className="w-4.5 h-4.5 text-cyan-400" />
                    <span>
                      {isBg
                        ? `Всички Свързани Устройства (${daemon.connectedClients.length})`
                        : `All Connected Devices & Active Sessions (${daemon.connectedClients.length})`}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {isBg
                      ? 'Управлявайте достъпа на всяко устройство поотделно: заключете мишка/клавиатура, прекъснете връзката или го добавете в черния списък.'
                      : 'Control each connected device individually: lock mouse/keyboard input, disconnect session, or permanently blacklist its IP & MAC.'}
                  </p>
                </div>

                {daemon.connectedClients.length > 0 && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => dispatchAction('panic_disconnect')}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 font-mono text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                    >
                      <OctagonAlert className="w-3.5 h-3.5" />
                      <span>{isBg ? 'Прекъсни всички' : 'Disconnect All'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Connected Devices List */}
              {daemon.connectedClients.length === 0 ? (
                <div className="rounded-2xl bg-[#0b1324]/60 border border-white/10 p-8 text-center space-y-2">
                  <Users className="w-8 h-8 text-slate-500 mx-auto" />
                  <div className="text-sm font-bold text-white">
                    {isBg ? 'Няма свързани устройства в момента' : 'No Connected Devices Currently'}
                  </div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    {isBg
                      ? `Демонът е конфигуриран за ${daemon.wsUri}. Свържете телефона или браузъра си чрез QR кода / One-Tap Pairing в секция Бърза Настройка.`
                      : `Daemon endpoint is configured at ${daemon.wsUri}. Pair your mobile or browser controller via QR / One-Tap Pairing to manage active sessions.`}
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
                        className="rounded-2xl bg-[#0b1324]/85 border border-white/12 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300 shrink-0 mt-0.5">
                            <PeerIcon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-display text-sm font-bold text-white">
                                {peer.device}
                              </span>
                              <span className="text-xs font-mono text-cyan-300 tabular-nums">
                                {peer.ip}
                              </span>
                              {peer.mac && (
                                <span className="text-[11px] font-mono text-slate-400">
                                  · MAC {peer.mac}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 flex-wrap tabular-nums">
                              <span className="text-emerald-300">{peer.auth}</span>
                              <span>·</span>
                              <span>
                                {isBg ? 'Свързан в' : 'Since'} {peer.connectedAt}
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

                        {/* Per-Device Granular Controls */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {/* 1. Trust / Guest Toggle */}
                          <button
                            type="button"
                            onClick={() => dispatchAction('toggle_client_trust', { clientId: peer.id })}
                            className={`min-h-[38px] px-3 py-1.5 rounded-xl font-mono text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                              peer.isTrusted
                                ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                                : 'bg-white/[0.05] border-white/10 text-slate-300 hover:text-white'
                            }`}
                            title={
                              isBg
                                ? 'Маркирай устройството като Доверено (Whitelist)'
                                : 'Toggle Trusted Device status'
                            }
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

                          {/* 2. Per-Device Input Lock Toggle */}
                          <button
                            type="button"
                            onClick={() => dispatchAction('toggle_client_input', { clientId: peer.id })}
                            className={`min-h-[38px] px-3 py-1.5 rounded-xl font-mono text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer ${
                              inputAllowed
                                ? 'bg-cyan-500/15 border-cyan-400/35 text-cyan-200'
                                : 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                            }`}
                            title={
                              isBg
                                ? 'Разреши или заключи мишката и клавиатурата за това устройство'
                                : 'Allow or lock remote mouse & keyboard input for this specific device'
                            }
                          >
                            {inputAllowed ? (
                              <Unlock className="w-3.5 h-3.5" />
                            ) : (
                              <Lock className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {inputAllowed
                                ? isBg
                                  ? 'Вход: Активен'
                                  : 'Input: Allowed'
                                : isBg
                                ? 'Само Изглед'
                                : 'View-Only'}
                            </span>
                          </button>

                          {/* 3. Disconnect Session */}
                          <button
                            type="button"
                            onClick={() => dispatchAction('disconnect_client', { clientId: peer.id })}
                            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 text-amber-300 font-mono text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                            title={
                              isBg
                                ? 'Прекъсни текущата сесия на това устройство'
                                : 'Disconnect this device immediately'
                            }
                          >
                            <UserX className="w-3.5 h-3.5" />
                            <span>{isBg ? 'Прекъсни' : 'Disconnect'}</span>
                          </button>

                          {/* 4. Completely Disconnect & Blacklist */}
                          <button
                            type="button"
                            onClick={() =>
                              dispatchAction('blacklist_client', {
                                clientId: peer.id,
                                ip: peer.ip,
                                mac: peer.mac,
                                device: peer.device,
                                reason: isBg
                                  ? 'Прекъснат и блокиран от оператора чрез Daemon GUI'
                                  : 'Disconnected & blacklisted by operator via Daemon GUI',
                              })
                            }
                            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 border border-rose-500/45 text-rose-200 font-mono text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-[0_0_12px_rgba(244,63,94,0.2)]"
                            title={
                              isBg
                                ? 'Прекъсни незабавно и добави IP/MAC адреса в черния списък (Blacklist)'
                                : 'Disconnect immediately and permanently blacklist IP & MAC address'
                            }
                          >
                            <Ban className="w-3.5 h-3.5 text-rose-400" />
                            <span>{isBg ? 'Блокирай (Blacklist)' : 'Blacklist & Ban'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* FIREWALL BLACKLIST & MANUAL BAN SECTION */}
              <div className="rounded-2xl bg-[#0b1324]/90 border border-rose-500/30 p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <Ban className="w-4.5 h-4.5 text-rose-400" />
                    <div>
                      <h4 className="font-display text-sm font-bold text-rose-200">
                        {isBg
                          ? `Черен списък на защитната стена (${blacklistedList.length} блокирани)`
                          : `Daemon Firewall Blacklist (${blacklistedList.length} Banned)`}
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        {isBg
                          ? 'Устройствата в този списък са напълно блокирани на ниво сокет и не могат да се свързват към PC демона.'
                          : 'Devices on this blacklist are dropped immediately at the TCP/WebSocket socket layer.'}
                      </p>
                    </div>
                  </div>

                  {blacklistedList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => dispatchAction('clear_blacklist')}
                      className="min-h-[36px] px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono text-slate-300 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>{isBg ? 'Изчисти всички банове' : 'Clear All Bans'}</span>
                    </button>
                  )}
                </div>

                {/* Manual IP / MAC Ban Form */}
                <form
                  onSubmit={handleManualBanSubmit}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 bg-black/35 p-3 rounded-xl border border-white/10"
                >
                  <input
                    type="text"
                    required
                    value={manualBanIp}
                    onChange={(e) => setManualBanIp(e.target.value)}
                    placeholder={isBg ? 'IP адрес (напр. 192.168.1.205)' : 'IP Address (e.g. 192.168.1.205)'}
                    className="sm:col-span-3 px-3 py-2 rounded-xl bg-[#070c18] border border-white/15 text-xs font-mono text-white outline-none focus:border-rose-400"
                  />
                  <input
                    type="text"
                    value={manualBanMac}
                    onChange={(e) => setManualBanMac(e.target.value)}
                    placeholder={isBg ? 'MAC адрес (по избор)' : 'MAC Address (optional)'}
                    className="sm:col-span-3 px-3 py-2 rounded-xl bg-[#070c18] border border-white/15 text-xs font-mono text-white outline-none focus:border-rose-400"
                  />
                  <input
                    type="text"
                    value={manualBanReason}
                    onChange={(e) => setManualBanReason(e.target.value)}
                    placeholder={isBg ? 'Причина за блокиране' : 'Reason for ban'}
                    className="sm:col-span-4 px-3 py-2 rounded-xl bg-[#070c18] border border-white/15 text-xs font-mono text-white outline-none focus:border-rose-400"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-2 min-h-[38px] px-3 py-2 rounded-xl bg-rose-500/25 hover:bg-rose-500/35 border border-rose-500/50 text-rose-200 font-mono text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>{isBg ? 'Блокирай IP' : 'Ban IP'}</span>
                  </button>
                </form>

                {/* Blacklisted Entries List */}
                {blacklistedList.length === 0 ? (
                  <div className="p-4 rounded-xl bg-black/25 border border-white/5 text-xs font-mono text-slate-400 text-center">
                    {isBg
                      ? 'Няма блокирани IP/MAC адреси в черния списък.'
                      : 'No IPs or MAC addresses are currently blacklisted.'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {blacklistedList.map((ban) => (
                      <div
                        key={ban.id}
                        className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs font-mono"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-rose-200">{ban.device}</span>
                            <span className="text-rose-300 tabular-nums">{ban.ip}</span>
                            <span className="text-slate-400">· MAC {ban.mac}</span>
                            <span className="text-slate-500">· {ban.bannedAt}</span>
                          </div>
                          <div className="text-[11px] text-rose-300/80 truncate">{ban.reason}</div>
                        </div>

                        <button
                          type="button"
                          onClick={() => dispatchAction('unban_device', { banId: ban.id, ip: ban.ip })}
                          className="min-h-[36px] px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 text-emerald-300 font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-auto"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isBg ? 'Премахни бан (Unban)' : 'Unban & Restore'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =====================================================================
              TAB 3: GUIDED DAEMON SETUP WIZARD
             ===================================================================== */}
          {activeTab === 'setup' && (
            <div className="space-y-4">
              {setupCompletedBanner && (
                <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-200 text-xs font-mono flex items-center justify-between">
                  <span className="flex items-center gap-2 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>
                      {isBg
                        ? 'Конфигурацията на PC Демона е запазена и активирана успешно!'
                        : 'PC Daemon Setup & Security Profile saved and activated!'}
                    </span>
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Step 1 & Step 2 (Left 7 cols) */}
                <div className="lg:col-span-7 space-y-4">
                  {/* Step 1: Network & Firewall Auto-Config */}
                  <div className="rounded-2xl bg-[#0b1324]/85 border border-white/12 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold text-white">
                        {isBg
                          ? '1. Мрежов адаптер и защитна стена (Firewall)'
                          : '1. Network Adapter & Firewall Configuration'}
                      </h3>
                      <span className="text-[11px] font-mono text-emerald-300">UDP 9 + TCP {daemon.port}</span>
                    </div>

                    <div className="space-y-2">
                      {daemon.activeAdapters.map((nic, i) => (
                        <div
                          key={i}
                          className="p-3 rounded-xl bg-black/40 border border-cyan-400/30 flex items-center justify-between text-xs font-mono"
                        >
                          <div>
                            <div className="text-white font-bold">{nic.name}</div>
                            <div className="text-[11px] text-slate-400">
                              IPv4: <span className="text-cyan-300">{nic.ipv4}</span> · MAC:{' '}
                              <span className="text-emerald-300">{nic.mac}</span>
                            </div>
                          </div>
                          <span className="text-[11px] text-emerald-300 font-bold">ACTIVE</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => dispatchAction('run_diagnostics')}
                        className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-cyan-200 font-mono text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>
                          {isBg ? 'Авто-проверка на Портове и WoL' : 'Verify Ports & Wake-on-LAN'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => dispatchAction('toggle_autostart')}
                        className={`min-h-[38px] px-3.5 py-1.5 rounded-xl font-mono text-xs font-semibold border cursor-pointer ${
                          daemon.autoStartOnBoot
                            ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                            : 'bg-white/5 border-white/10 text-slate-400'
                        }`}
                      >
                        {daemon.autoStartOnBoot
                          ? isBg
                            ? '✓ Стартиране с Windows: ВКЛ'
                            : '✓ Run on Windows Startup: ON'
                          : isBg
                          ? 'Стартиране с Windows: ИЗКЛ'
                          : 'Run on Windows Startup: OFF'}
                      </button>
                    </div>
                  </div>

                  {/* Step 2: Security & Access Profile */}
                  <div className="rounded-2xl bg-[#0b1324]/85 border border-white/12 p-4 space-y-3">
                    <h3 className="font-display text-sm font-bold text-white">
                      {isBg
                        ? '2. Изберете профил за сигурност и достъп'
                        : '2. Choose Security & Remote Access Profile'}
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {[
                        {
                          id: 'zero_trust' as const,
                          title: isBg ? 'Zero-Trust Стриктен' : 'Zero-Trust Strict',
                          desc: isBg
                            ? 'HITL одобрение + Авто-бан + Заключен клипборд'
                            : 'HITL required + Auto-Ban + Clipboard locked',
                        },
                        {
                          id: 'balanced' as const,
                          title: isBg ? 'Домашна LAN (Препоръчан)' : 'Balanced LAN (Default)',
                          desc: isBg
                            ? 'HMAC-SHA256 + HITL за критични команди + Клипборд'
                            : 'HMAC-SHA256 + HITL for admin cmds + Clipboard sync',
                        },
                        {
                          id: 'view_only' as const,
                          title: isBg ? 'Само за преглед' : 'Presentation View-Only',
                          desc: isBg
                            ? 'Само видео стрийм; мишка и клавиатура са заключени'
                            : 'Screen stream only; mouse & keyboard locked',
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
                            className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                              isSelected
                                ? 'bg-cyan-500/20 border-cyan-400/50 text-white'
                                : 'bg-black/35 border-white/10 text-slate-300 hover:border-white/25'
                            }`}
                          >
                            <div className="text-xs font-display font-bold flex items-center justify-between">
                              <span>{prof.title}</span>
                              {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-cyan-300 shrink-0" />}
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1.5 leading-snug">{prof.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Step 3 & Step 4: Instant Phone QR + PIN Pairing (Right 5 cols) */}
                <div className="lg:col-span-5 rounded-2xl bg-[#0b1324]/90 border border-cyan-400/30 p-4 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold text-white flex items-center gap-2">
                        <QrCode className="w-4 h-4 text-cyan-400" />
                        <span>
                          {isBg ? '3. Сдвояване с Телефон (QR + PIN)' : '3. Instant Phone Pairing (QR + PIN)'}
                        </span>
                      </h3>
                      <span className="text-xs font-mono font-bold text-amber-300">
                        PIN: {daemon.pairingPin || '------'}
                      </span>
                    </div>

                    <div className="flex flex-col items-center text-center p-3 rounded-xl bg-[#070c18] border border-white/10 space-y-2.5">
                      {qrDataUrl && (
                        <img
                          src={qrDataUrl}
                          alt="Daemon Setup Pairing QR"
                          referrerPolicy="no-referrer"
                          className="w-36 h-36 rounded-xl border border-cyan-400/40 p-1.5 bg-[#070c18]"
                        />
                      )}
                      <p className="text-[11px] text-slate-300 max-w-xs leading-snug">
                        {isBg
                          ? 'Сканирайте QR кода с телефона си за автоматично добавяне на този компютър без въвеждане на IP адрес.'
                          : 'Scan this QR code with your phone camera to auto-pair this PC with zero manual typing.'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      dispatchAction('complete_setup');
                      setSetupCompletedBanner(true);
                      scheduleTimer(() => setSetupCompletedBanner(false), 3500);
                    }}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-display font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition shadow-lg shadow-emerald-500/20"
                  >
                    <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                    <span>
                      {isBg
                        ? 'Завърши настройката и активирай защитата'
                        : 'Complete Setup & Activate Daemon'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* LIVE DAEMON EVENT & SECURITY AUDIT LOG (Always visible at bottom) */}
          <div className="rounded-2xl bg-[#060b16] border border-white/10 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span>
                  {isBg
                    ? 'Журнал на събитията и сигурността на PC демона'
                    : 'Live PC Daemon Event & Security Audit Log'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => dispatchAction('clear_logs')}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-slate-400 hover:text-white cursor-pointer transition"
              >
                {isBg ? 'Изчисти лога' : 'Clear Log'}
              </button>
            </div>

            <div className="p-3 rounded-xl bg-black/70 border border-white/5 font-mono text-[11px] max-h-36 overflow-y-auto space-y-1">
              {daemon.logs.map((entry, idx) => (
                <div key={idx} className="leading-relaxed flex items-start gap-2">
                  <span className="text-slate-500 shrink-0 tabular-nums">[{entry.time}]</span>
                  <span
                    className={`shrink-0 font-bold ${
                      entry.level === 'ALERT'
                        ? 'text-rose-400'
                        : entry.level === 'WARN'
                        ? 'text-amber-400'
                        : entry.level === 'SECURITY'
                        ? 'text-emerald-400'
                        : entry.level === 'DIAG'
                        ? 'text-cyan-300'
                        : 'text-slate-400'
                    }`}
                  >
                    [{entry.level}]
                  </span>
                  <span className="text-slate-200 break-words">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
