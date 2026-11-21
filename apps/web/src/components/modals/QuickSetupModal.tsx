import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import {
  X,
  Smartphone,
  Monitor,
  QrCode,
  Download,
  Check,
  Copy,
  Sparkles,
  Wifi,
  ShieldCheck,
  ShieldAlert,
  Zap,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  KeyRound,
} from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';
import { buildHostWsUri } from '../../services/securityService';
import { copyToClipboard } from '../../utils/clipboard';
import { SPRING_BUBBLY, SPRING_POP, MODAL_BUBBLE_VARIANTS } from '../../utils/springPhysics';

interface SetupInfo {
  hostname: string;
  osName: string;
  localIp: string;
  daemonPort: number;
  webPort: number;
  mac: string;
  adapterName: string;
  wsUri: string;
  pairingPin?: string;
  pairingToken?: string;
  daemonOnline?: boolean;
  allowLanWeb?: boolean;
  ainetPairUri?: string;
  webOrigin: string;
  mobilePairUrl: string;
  exeDownloadUrl: string;
  apkDownloadUrl: string;
  portableZipUrl?: string;
  launcherDownloadUrl: string;
}

interface QuickSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAutoPairHost: (hostData: {
    id: string;
    name: string;
    ip: string;
    mac: string;
    os: 'windows' | 'linux';
    wsUri: string;
    pairingToken?: string;
    pairingPin?: string;
  }) => void;
  isConnected?: boolean;
}

export const QuickSetupModal: React.FC<QuickSetupModalProps> = ({
  isOpen,
  onClose,
  onAutoPairHost,
  isConnected = false,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';

  const [activeStep, setActiveStep] = useState<'all' | 'pc' | 'phone' | 'verify'>('all');
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [customIp, setCustomIp] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isPairedSuccess, setIsPairedSuccess] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [deferredPwaPrompt, setDeferredPwaPrompt] = useState<any>(null);
  const [qrMode, setQrMode] = useState<'android' | 'browser'>('android');
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
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPwaPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const fetchSetupDetails = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/setup/info', { credentials: 'include', signal });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.setup) {
        setServerReachable(true);
        setSetupInfo(data.setup);
        setCustomIp((prev) => prev || data.setup.localIp);
      } else {
        setServerReachable(false);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setServerReachable(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetchSetupDetails(controller.signal);
    return () => controller.abort();
  }, [isOpen, fetchSetupDetails]);

  const effectiveIp = customIp.trim() || setupInfo?.localIp || window.location.hostname || '127.0.0.1';
  const effectivePort = setupInfo?.daemonPort || 8765;
  const effectiveHostname = setupInfo?.hostname || 'LOCAL-HOST';
  const effectiveMac = setupInfo?.mac || '';
  const effectivePin = setupInfo?.pairingPin || '';
  const effectiveToken = setupInfo?.pairingToken || '';
  const isDaemonReady = Boolean(serverReachable && setupInfo && setupInfo.daemonOnline !== false);
  const hasValidMac = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(effectiveMac);
  const effectiveWsUri = buildHostWsUri(effectiveIp, effectivePort);
  const allowLanWeb = setupInfo?.allowLanWeb === true;

  const effectiveAndroidPairUri = React.useMemo(() => {
    if (setupInfo?.ainetPairUri && (!customIp.trim() || customIp.trim() === setupInfo.localIp)) {
      return setupInfo.ainetPairUri;
    }
    const proto = effectiveWsUri.startsWith('wss://') ? 'wss' : 'ws';
    const params = new URLSearchParams({
      proto,
      host: effectiveIp,
      port: String(effectivePort),
      name: effectiveHostname,
      ...(effectivePin ? { pin: effectivePin } : {}),
    });
    return `ainet://pair?${params.toString()}`;
  }, [
    setupInfo?.ainetPairUri,
    setupInfo?.localIp,
    customIp,
    effectiveWsUri,
    effectiveIp,
    effectivePort,
    effectiveHostname,
    effectivePin,
  ]);

  const effectiveMobilePairUrl = React.useMemo(() => {
    const baseOrigin =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? `http://${effectiveIp}:${window.location.port || 3000}`
        : window.location.origin;

    const params = new URLSearchParams({
      pair_ip: effectiveIp,
      pair_port: String(effectivePort),
      pair_name: effectiveHostname,
      pair_mac: effectiveMac,
      pair_os: setupInfo?.osName?.toLowerCase().includes('linux') ? 'linux' : 'windows',
      ...(effectivePin ? { pair_pin: effectivePin } : {}),
    });
    return `${baseOrigin}/#${params.toString()}`;
  }, [effectiveIp, effectivePort, effectiveHostname, effectiveMac, effectivePin, setupInfo?.osName]);

  const activeQrPayload = qrMode === 'android' ? effectiveAndroidPairUri : effectiveMobilePairUrl;

  // High-contrast crisp QR on pure white frame (optimal for mobile cameras in Daylight & Dark)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    QRCode.toDataURL(activeQrPayload, {
      width: 240,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeQrPayload, isOpen]);

  const handleCopy = (text: string, label: string) => {
    triggerHapticFeedback('light');
    copyToClipboard(text);
    setCopiedField(label);
    scheduleTimer(() => setCopiedField((prev) => (prev === label ? null : prev)), 2000);
  };

  const handleOneTapAutoPair = () => {
    triggerHapticFeedback('heavy');
    onAutoPairHost({
      id: effectiveHostname.toUpperCase().replace(/[^A-Z0-9-]/g, '-'),
      name: effectiveHostname,
      ip: effectiveIp,
      mac: effectiveMac,
      os: setupInfo?.osName?.toLowerCase().includes('linux') ? 'linux' : 'windows',
      wsUri: effectiveWsUri,
      pairingToken: effectiveToken || undefined,
      pairingPin: effectivePin || undefined,
    });
    setIsPairedSuccess(true);
    scheduleTimer(() => setIsPairedSuccess(false), 3500);
  };

  const handleInstallPwa = async () => {
    triggerHapticFeedback('medium');
    if (deferredPwaPrompt) {
      deferredPwaPrompt.prompt();
      await deferredPwaPrompt.userChoice;
      setDeferredPwaPrompt(null);
    } else {
      setShowPwaGuide((prev) => !prev);
    }
  };

  const progressSteps = [
    {
      id: 'pc' as const,
      num: 1,
      label: isBg ? 'PC Агент' : 'PC Agent',
      done: isDaemonReady,
    },
    {
      id: 'phone' as const,
      num: 2,
      label: isBg ? 'QR & PIN' : 'Phone QR & PIN',
      done: Boolean(effectivePin || isPairedSuccess),
    },
    {
      id: 'verify' as const,
      num: 3,
      label: isBg ? 'Готовност' : 'Readiness',
      done: isConnected || isPairedSuccess,
    },
  ];

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            triggerHapticFeedback('light');
            onClose();
          }
        }}
        style={{ backgroundColor: 'var(--backdrop-scrim)' }}
        className="fixed inset-0 z-[95] flex items-center justify-center p-2.5 sm:p-4 backdrop-blur-md overflow-y-auto"
      >
        <motion.div
          variants={MODAL_BUBBLE_VARIANTS}
          initial="initial"
          animate="animate"
          exit="exit"
          className="relative w-full max-w-4xl rounded-[28px] glass-liquid-modal overflow-hidden my-auto max-h-[92dvh] flex flex-col transform-gpu"
        >
          {/* Specular Accent Top Bar */}
          <div className="h-1 w-full bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-secondary)] to-[var(--accent-tertiary)] shrink-0" />

          {/* Top Header */}
          <div className="px-5 py-4 border-b border-[var(--glass-border)] flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 squircle-badge squircle-hero shrink-0">
                <Sparkles className="w-5 h-5 icon-sparkle-live" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base sm:text-lg font-extrabold tracking-tight ink-primary truncate">
                  {isBg
                    ? 'Бърза настройка и сдвояване'
                    : 'Quick Setup & Device Pairing'}
                </h2>
                <p className="text-xs ink-secondary truncate">
                  {isBg
                    ? 'Автоматично сдвояване с 1 клик, QR код за телефон и инсталатори (.EXE / .APK)'
                    : 'Zero-typing auto-pairing, instant Phone QR code, and PC/Mobile installers'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                onClose();
              }}
              className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full liquid-control-pill flex items-center justify-center ink-secondary hover:ink-primary transition cursor-pointer shrink-0"
              aria-label={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Interactive 3-Step Readiness Stepper + View Filter Bar */}
          <div className="px-5 py-3 flex flex-col gap-2.5 border-b border-[var(--glass-border)] glass-liquid-subtle shrink-0">
            {/* Step Progress Indicator */}
            <div className="flex items-center justify-between gap-2">
              {progressSteps.map((step, idx) => (
                <React.Fragment key={step.id}>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback('light');
                      setActiveStep(step.id);
                    }}
                    className="flex items-center gap-2 min-w-0 group cursor-pointer"
                  >
                    <span
                      className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 transition ${
                        step.done
                          ? 'bg-emerald-500 text-white shadow-sm'
                          : activeStep === step.id
                          ? 'bg-[var(--accent-primary)] text-white shadow-sm'
                          : 'liquid-control-pill ink-secondary'
                      }`}
                    >
                      {step.done ? <Check className="w-3.5 h-3.5 stroke-[2.6]" /> : step.num}
                    </span>
                    <span
                      className={`text-xs font-display font-semibold truncate transition ${
                        activeStep === step.id
                          ? 'text-[var(--accent-primary)]'
                          : step.done
                          ? 'text-emerald-600 dark:text-emerald-300'
                          : 'ink-secondary group-hover:ink-primary'
                      }`}
                    >
                      {step.label}
                    </span>
                  </button>
                  {idx < progressSteps.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 rounded-full transition-colors ${
                        step.done
                          ? 'bg-emerald-500/60'
                          : 'bg-[var(--glass-border)]'
                      }`}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Filter Pills + Refresh IP */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1 p-1 rounded-full glass-liquid-subtle border border-[var(--glass-border)] overflow-x-auto scrollbar-none">
                {[
                  { id: 'all', label: isBg ? 'Всичко в 1 изглед' : 'All-in-One', icon: Sparkles },
                  { id: 'pc', label: isBg ? '1. PC Агент' : '1. PC Agent', icon: Monitor },
                  { id: 'phone', label: isBg ? '2. Телефон (QR)' : '2. Phone QR', icon: Smartphone },
                  { id: 'verify', label: isBg ? '3. Проверка' : '3. Readiness', icon: ShieldCheck },
                ].map((tab) => {
                  const isActive = activeStep === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('light');
                        setActiveStep(tab.id as any);
                      }}
                      className={`relative min-h-[34px] px-3 py-1.5 rounded-full text-xs font-display font-semibold flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer z-10 ${
                        isActive ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="quickSetupStepPill"
                          transition={SPRING_BUBBLY}
                          className="absolute inset-0 rounded-full liquid-hero-btn -z-10 transform-gpu"
                        />
                      )}
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.94 }}
                transition={SPRING_POP}
                onClick={() => void fetchSetupDetails()}
                className="min-h-[36px] px-3.5 rounded-full liquid-control-pill text-xs font-display font-semibold ink-primary flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[var(--accent-primary)] ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isBg ? 'Обнови IP' : 'Refresh IP'}</span>
              </motion.button>
            </div>
          </div>

          {/* Scrollable Body */}
          <div className="p-5 overflow-y-auto bouncy-scroll space-y-5 flex-1">
            {/* Quick Auto-Pair PC Hero Strip */}
            <div className="rounded-3xl glass-liquid-subtle border border-[var(--accent-primary)]/30 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--accent-primary)]/14 border border-[var(--accent-primary)]/30 text-[11px] font-display font-bold text-[var(--accent-primary)]">
                  <Zap className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isBg ? 'Мигновено авто-сдвояване' : 'Instant Zero-Config Auto-Pairing'}
                  </span>
                </div>
                <h3 className="font-display text-sm sm:text-base font-extrabold ink-primary">
                  {isBg
                    ? `Открит компютър: ${effectiveHostname} (${effectiveIp}:${effectivePort})`
                    : `Detected PC: ${effectiveHostname} (${effectiveIp}:${effectivePort})`}
                </h3>
                <p className="text-xs ink-secondary leading-relaxed">
                  {isBg
                    ? 'Добавете този компютър към устройствата и свържете WebSocket канала автоматично без въвеждане на IP.'
                    : 'Add this PC to your Devices list and establish a live encrypted WebSocket channel with zero manual typing.'}
                </p>
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.95 }}
                transition={SPRING_POP}
                onClick={handleOneTapAutoPair}
                className={`min-h-[46px] px-5 py-2.5 rounded-full font-display font-bold text-xs sm:text-sm flex items-center gap-2 whitespace-nowrap cursor-pointer shrink-0 transition transform-gpu preserve-white ${
                  isPairedSuccess
                    ? 'bg-emerald-500 hover:bg-emerald-400 shadow-lg'
                    : 'liquid-hero-btn'
                }`}
              >
                {isPairedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                    <span>{isBg ? 'Успешно сдвоен!' : 'PC Auto-Paired!'}</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 stroke-[2.3]" />
                    <span>{isBg ? 'Свържи това PC с 1 клик' : '1-Tap Pair This PC'}</span>
                  </>
                )}
              </motion.button>
            </div>

            {/* MAIN GRID: PC SETUP (LEFT) + PHONE QR SETUP (RIGHT) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              {/* STEP 1: PC SETUP CARD */}
              {(activeStep === 'all' || activeStep === 'pc') && (
                <div
                  className={`${
                    activeStep === 'pc' ? 'lg:col-span-12' : 'lg:col-span-6'
                  } rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 sm:p-5 flex flex-col justify-between space-y-4`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 squircle-badge squircle-sky shrink-0">
                          <Monitor className="w-4.5 h-4.5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-display text-sm sm:text-base font-bold ink-primary truncate">
                            {isBg ? '1. Стартиране на PC агента' : '1. Run on Your Windows PC'}
                          </h3>
                          <p className="text-[11px] ink-secondary truncate">
                            {isBg
                              ? 'Антивирус-безопасен контролен център'
                              : 'Antivirus-safe desktop control center'}
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25 shrink-0">
                        Port {effectivePort}
                      </span>
                    </div>

                    {/* Option A: Auto-Setup Launcher (.BAT) */}
                    <div className="p-3.5 rounded-2xl liquid-terminal-entry border border-[var(--accent-primary)]/30 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-display font-bold ink-primary">
                          {isBg
                            ? 'Вариант А (Препоръчан): Авто-стартер (.BAT)'
                            : 'Option A (Recommended): Auto-Setup (.BAT)'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 shrink-0">
                          Auto-Firewall
                        </span>
                      </div>
                      <p className="text-[11px] ink-secondary leading-snug">
                        {isBg
                          ? 'Проверява зависимостите, отваря порт 8765 в Windows Firewall и пуска PC демона + уеб сървъра.'
                          : 'Checks dependencies, opens Windows Firewall port 8765, and starts the PC Daemon GUI + Web Server.'}
                      </p>
                      <a
                        href="/api/setup/windows-launcher"
                        download="AI_NetController_PC_Setup.bat"
                        onClick={() => triggerHapticFeedback('medium')}
                        className="inline-flex min-h-[40px] px-4 py-2 rounded-full liquid-hero-btn preserve-white font-display font-bold text-xs items-center gap-2 transition cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        <span>
                          {isBg ? 'Изтегли PC Setup Launcher (.BAT)' : 'Download PC Setup Launcher (.BAT)'}
                        </span>
                      </a>
                    </div>

                    {/* Option B: Standalone Windows .EXE */}
                    <div className="p-3.5 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-display font-bold ink-primary">
                          {isBg
                            ? 'Вариант Б: Самостоятелен Windows .EXE'
                            : 'Option B: Standalone Windows .EXE'}
                        </span>
                        <span className="text-[10px] font-mono ink-muted">v0.80.0</span>
                      </div>
                      <p className="text-[11px] ink-secondary leading-snug">
                        {isBg
                          ? 'Готов компилиран изпълним файл за Windows 10/11 (AV-Safe без UPX компресия).'
                          : 'Pre-compiled Windows 10/11 binary built with AV-Safe directory mode (no UPX packer).'}
                      </p>
                      <a
                        href={
                          setupInfo?.exeDownloadUrl ||
                          '/releases/v0.80.0/AI_NetController_HostAgent_v0.80.0_win64.exe'
                        }
                        download="AI_NetController_HostAgent_v0.80.0_win64.exe"
                        onClick={() => triggerHapticFeedback('medium')}
                        className="inline-flex min-h-[40px] px-4 py-2 rounded-full liquid-control-pill ink-primary font-display font-semibold text-xs items-center gap-2 transition cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-emerald-500" />
                        <span>AI_NetController_HostAgent_v0.80.0_win64.exe</span>
                      </a>
                    </div>

                    {/* Option C: Copy 1-Line Command */}
                    <div className="p-3 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] ink-muted">
                          {isBg ? 'Или стартирайте от папката на проекта:' : 'Or run inside the project folder:'}
                        </div>
                        <code className="text-xs font-mono font-semibold text-[var(--accent-primary)] truncate block mt-0.5">
                          START_HERE_WINDOWS.bat
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy('START_HERE_WINDOWS.bat', 'cmd')}
                        className="min-h-[36px] px-3 rounded-full liquid-control-pill text-xs font-display font-semibold ink-primary flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        {copiedField === 'cmd' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>{isBg ? 'Копирано' : 'Copied'}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                            <span>{isBg ? 'Копирай' : 'Copy'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: PHONE QR & APK SETUP CARD */}
              {(activeStep === 'all' || activeStep === 'phone') && (
                <div
                  className={`${
                    activeStep === 'phone' ? 'lg:col-span-12' : 'lg:col-span-6'
                  } rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 sm:p-5 flex flex-col justify-between space-y-4`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 squircle-badge squircle-emerald shrink-0">
                          <Smartphone className="w-4.5 h-4.5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-display text-sm sm:text-base font-bold ink-primary truncate">
                            {isBg ? '2. Свързване на телефона (QR / APK)' : '2. Connect Your Phone (QR / APK)'}
                          </h3>
                          <p className="text-[11px] ink-secondary truncate">
                            {isBg
                              ? 'Сканирайте за автоматично сдвояване'
                              : 'Scan with camera for zero-typing pairing'}
                          </p>
                        </div>
                      </div>
                      <QrCode className="w-5 h-5 text-[var(--accent-primary)] shrink-0" />
                    </div>

                    {/* Prominent 6-Digit Pairing PIN Row */}
                    <div className="p-3.5 rounded-2xl bg-amber-500/12 border border-amber-500/35 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 squircle-badge squircle-amber shrink-0">
                          <KeyRound className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] font-display font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                            {isBg ? '6-цифрен PIN за сдвояване' : '6-Digit Pairing PIN'}
                          </div>
                          <div className="text-lg font-mono font-extrabold tracking-[0.22em] ink-primary tabular-nums">
                            {effectivePin || (isBg ? 'Офлайн' : 'Offline')}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!effectivePin}
                        onClick={() => handleCopy(effectivePin, 'pin')}
                        className="min-h-[36px] px-3.5 py-1.5 rounded-full liquid-control-pill disabled:opacity-40 text-xs font-display font-bold ink-primary flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        {copiedField === 'pin' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>{isBg ? 'Копиран' : 'Copied'}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" />
                            <span>{isBg ? 'Копирай PIN' : 'Copy PIN'}</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* QR Target Mode Toggle */}
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-full liquid-terminal-entry border border-[var(--glass-border)]">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHapticFeedback('light');
                          setQrMode('android');
                        }}
                        className={`min-h-[34px] px-2.5 py-1 rounded-full text-[11px] font-display font-bold transition cursor-pointer ${
                          qrMode === 'android'
                            ? 'bg-[var(--accent-primary)]/18 text-[var(--accent-primary)] border border-[var(--accent-primary)]/40'
                            : 'ink-secondary hover:ink-primary border border-transparent'
                        }`}
                      >
                        {isBg ? 'Android Приложение' : 'Android App (Direct)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          triggerHapticFeedback('light');
                          setQrMode('browser');
                        }}
                        className={`min-h-[34px] px-2.5 py-1 rounded-full text-[11px] font-display font-bold transition cursor-pointer ${
                          qrMode === 'browser'
                            ? 'bg-emerald-500/18 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40'
                            : 'ink-secondary hover:ink-primary border border-transparent'
                        }`}
                      >
                        {isBg ? 'Уеб Браузър (PWA)' : 'Phone Browser (PWA)'}
                      </button>
                    </div>

                    {/* Crisp White-Framed QR Code + Editable LAN IP Row */}
                    <div className="p-3.5 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex flex-col sm:flex-row items-center gap-4">
                      <div className="w-36 h-36 rounded-2xl bg-white p-2.5 flex items-center justify-center shrink-0 shadow-md border border-black/10">
                        {qrDataUrl ? (
                          <img
                            src={qrDataUrl}
                            alt="Phone Auto-Pairing QR Code"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-contain rounded-lg"
                          />
                        ) : (
                          <QrCode className="w-14 h-14 text-slate-400 animate-pulse" />
                        )}
                      </div>

                      <div className="flex-1 space-y-2.5 w-full min-w-0">
                        <div>
                          <label className="block text-[11px] font-display font-semibold ink-secondary mb-1">
                            {isBg ? 'Wi-Fi / LAN IP адрес на PC:' : 'Your PC Wi-Fi / LAN IP:'}
                          </label>
                          <input
                            type="text"
                            value={customIp}
                            onChange={(e) => setCustomIp(e.target.value)}
                            placeholder="192.168.1.104"
                            className="w-full px-3 py-2 rounded-xl glass-liquid-subtle border border-[var(--glass-border)] text-xs font-mono ink-primary outline-none focus:border-[var(--accent-primary)]"
                          />
                        </div>

                        <p className="text-[11px] ink-secondary leading-snug">
                          {qrMode === 'android'
                            ? isBg
                              ? 'Сканирайте от Android приложението или камерата. Сдвоява се директно с PC агента (порт 8765) с E2E криптиране.'
                              : 'Scan in the Android companion app or phone camera. Pairs directly to the PC Agent (port 8765) with E2E encryption.'
                            : allowLanWeb
                            ? isBg
                              ? 'Насочете камерата към QR кода — отваря уеб конзолата и автоматично сдвоява вашия PC.'
                              : 'Point your phone camera at this QR code to open the web console and auto-pair your PC.'
                            : isBg
                            ? 'Уеб сървърът слуша само на localhost. Стартирайте с ALLOW_LAN_WEB=true за браузър на телефона или ползвайте Android QR.'
                            : 'Web server is localhost-only. Set ALLOW_LAN_WEB=true for phone browser access, or switch to Android App QR.'}
                        </p>

                        <button
                          type="button"
                          onClick={() => handleCopy(activeQrPayload, 'pairUrl')}
                          className="w-full min-h-[36px] px-3 py-1.5 rounded-full liquid-control-pill text-xs font-display font-semibold ink-primary flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {copiedField === 'pairUrl' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span>{isBg ? 'Линкът е копиран!' : 'Auto-Pair Link Copied!'}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                              <span>
                                {qrMode === 'android'
                                  ? isBg
                                    ? 'Копирай ainet:// линк'
                                    : 'Copy ainet:// Pair Link'
                                  : isBg
                                  ? 'Копирай линк за сдвояване'
                                  : 'Copy Auto-Pairing Link'}
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Phone Install Buttons */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={handleInstallPwa}
                        className="min-h-[42px] px-3.5 py-2 rounded-full bg-emerald-500/18 hover:bg-emerald-500/26 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 font-display font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Smartphone className="w-4 h-4 shrink-0" />
                        <span>
                          {isBg ? 'Инсталирай Web App (PWA)' : '1-Tap Install PWA'}
                        </span>
                      </button>

                      <a
                        href={
                          setupInfo?.apkDownloadUrl ||
                          '/releases/v0.80.0/AI_NetController_v0.80.0_arm64-v8a.apk'
                        }
                        download="AI_NetController_v0.80.0_arm64-v8a.apk"
                        onClick={() => triggerHapticFeedback('medium')}
                        className="min-h-[42px] px-3.5 py-2 rounded-full liquid-control-pill ink-primary font-display font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
                        <span>{isBg ? 'Изтегли Android .APK' : 'Download Android .APK'}</span>
                      </a>
                    </div>

                    <AnimatePresence>
                      {showPwaGuide && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] ink-primary space-y-1 overflow-hidden"
                        >
                          <div className="font-display font-bold text-emerald-700 dark:text-emerald-300">
                            {isBg
                              ? 'Добавяне на иконата към началния екран:'
                              : 'Add to your Phone Home Screen:'}
                          </div>
                          <div>
                            • <strong>Android (Chrome):</strong>{' '}
                            {isBg
                              ? 'Менюто (⋮) горе вдясно → "Install app" / "Add to Home screen".'
                              : 'Tap menu (⋮) → "Install app" or "Add to Home screen".'}
                          </div>
                          <div>
                            • <strong>iPhone (Safari):</strong>{' '}
                            {isBg
                              ? 'Бутон Share долу → "Add to Home Screen".'
                              : 'Tap Share at the bottom → "Add to Home Screen".'}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>

            {/* STEP 3: LIVE READINESS & CONNECTION VERIFICATION */}
            {(activeStep === 'all' || activeStep === 'verify') && (
              <div className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 squircle-badge squircle-emerald">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <h4 className="font-display text-xs sm:text-sm font-bold ink-primary">
                      {isBg
                        ? '3. Автоматична проверка на готовността'
                        : '3. Automated System & Network Readiness'}
                    </h4>
                  </div>
                  <span className="text-[11px] font-mono ink-muted tabular-nums">
                    {effectiveWsUri} • MAC {hasValidMac ? effectiveMac : isBg ? 'Неоткрит' : 'Unverified'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-3 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex items-center gap-2.5">
                    {isDaemonReady ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-display font-semibold ink-primary truncate">
                        {isBg ? 'PC Демон' : 'PC Daemon Listener'}
                      </div>
                      <div
                        className={`text-[11px] font-mono truncate ${
                          isDaemonReady
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'text-amber-600 dark:text-amber-300'
                        }`}
                      >
                        {isDaemonReady
                          ? `ONLINE (${effectiveIp}:${effectivePort})`
                          : serverReachable === false
                          ? isBg
                            ? 'Офлайн (не отговаря)'
                            : 'Offline (Unreachable)'
                          : isBg
                          ? 'Непотвърден'
                          : 'Offline / Unverified'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex items-center gap-2.5">
                    {hasValidMac ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-display font-semibold ink-primary truncate">
                        Wake-on-LAN (UDP 9)
                      </div>
                      <div
                        className={`text-[11px] font-mono truncate ${
                          hasValidMac
                            ? 'text-[var(--accent-primary)]'
                            : 'text-amber-600 dark:text-amber-300'
                        }`}
                      >
                        {hasValidMac ? effectiveMac : isBg ? 'Липсва MAC' : 'MAC unverified'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex items-center gap-2.5">
                    {isDaemonReady ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 ink-muted shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-display font-semibold ink-primary truncate">
                        {isBg ? 'AV-Safe Защита' : 'AV-Safe Integrity'}
                      </div>
                      <div
                        className={`text-[11px] font-mono truncate ${
                          isDaemonReady
                            ? 'text-emerald-600 dark:text-emerald-300'
                            : 'ink-muted'
                        }`}
                      >
                        {isDaemonReady
                          ? 'No UPX • HWND Verified'
                          : isBg
                          ? 'Очаква проверка'
                          : 'Awaiting Daemon'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex items-center gap-2.5">
                    <Wifi
                      className={`w-4 h-4 shrink-0 ${
                        isConnected ? 'text-emerald-500' : 'text-[var(--accent-primary)]'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="font-display font-semibold ink-primary truncate">
                        {isBg ? 'Контролер Връзка' : 'Controller Channel'}
                      </div>
                      <div className="text-[11px] text-[var(--accent-primary)] font-mono truncate">
                        {isConnected
                          ? isBg
                            ? 'Свързан (Live WS)'
                            : 'Connected (Live WS)'
                          : isBg
                          ? 'Готов за сдвояване'
                          : 'Ready to Auto-Pair'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 border-t border-[var(--glass-border)] glass-liquid-subtle flex items-center justify-between gap-3 shrink-0">
            <div className="text-[11px] ink-secondary hidden sm:block">
              {isBg
                ? 'Съвет: Телефонът и компютърът трябва да са в една и съща Wi-Fi / LAN мрежа.'
                : 'Tip: Ensure both your phone and PC are on the same home Wi-Fi / LAN.'}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={handleOneTapAutoPair}
                className="min-h-[40px] px-4 py-2 rounded-full liquid-control-pill ink-primary font-display font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                <span>{isBg ? 'Авто-сдвои PC' : 'Auto-Pair Local PC'}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] px-5 py-2 rounded-full liquid-hero-btn preserve-white font-display font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>{isBg ? 'Готово' : 'Done'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
