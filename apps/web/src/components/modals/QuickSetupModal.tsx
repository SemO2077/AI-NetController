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
  TerminalSquare,
  CheckCircle2,
} from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';
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

  // Capture browser PWA install prompt if available
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

  // Compute dynamic pairing URL based on detected or user-edited LAN IP
  const effectiveIp = customIp.trim() || setupInfo?.localIp || window.location.hostname || '127.0.0.1';
  const effectivePort = setupInfo?.daemonPort || 8765;
  const effectiveHostname = setupInfo?.hostname || 'LOCAL-HOST';
  const effectiveMac = setupInfo?.mac || '';
  const effectivePin = setupInfo?.pairingPin || '';
  const effectiveToken = setupInfo?.pairingToken || '';
  const isDaemonReady = Boolean(serverReachable && setupInfo && setupInfo.daemonOnline !== false);
  const hasValidMac = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(effectiveMac);
  const effectiveWsUri = `ws://${effectiveIp}:${effectivePort}`;

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

  // Generate crisp QR Code whenever effectiveMobilePairUrl changes
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    QRCode.toDataURL(effectiveMobilePairUrl, {
      width: 240,
      margin: 1,
      color: {
        dark: '#e0f2fe',
        light: '#070c18',
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
  }, [effectiveMobilePairUrl, isOpen]);

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

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[95] flex items-center justify-center p-2.5 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
        <motion.div
          variants={MODAL_BUBBLE_VARIANTS}
          initial="initial"
          animate="animate"
          exit="exit"
          className="relative w-full max-w-4xl rounded-3xl bg-[#070c18]/96 backdrop-blur-3xl border border-white/15 border-t-white/25 shadow-[0_28px_80px_rgba(0,0,0,0.92)] text-white overflow-hidden my-auto max-h-[92dvh] flex flex-col transform-gpu"
        >
          {/* Top Header */}
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 bg-[#0b1324]/70 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-400/35 flex items-center justify-center text-cyan-300 shrink-0 shadow-[0_0_16px_rgba(34,211,238,0.2)]">
                <Sparkles className="w-5 h-5 icon-sparkle-live" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base sm:text-lg font-extrabold tracking-tight text-white truncate">
                  {isBg
                    ? 'Бърза Настройка и Свързване (PC + Телефон)'
                    : '1-Click Easy Setup & Phone/PC Pairing'}
                </h2>
                <p className="text-fluid-meta text-slate-400 truncate">
                  {isBg
                    ? 'Автоматично сдвояване с 1 клик, QR код за телефон и готови инсталатори (.EXE / .APK)'
                    : 'Zero-typing auto-pairing, instant Phone QR code, and 1-click PC/Mobile installers'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                onClose();
              }}
              className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-white/[0.06] hover:bg-white/15 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer shrink-0"
              aria-label={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step Filter Tabs */}
          <div className="px-5 pt-3 pb-2 flex items-center justify-between gap-2 flex-wrap border-b border-white/[0.06] bg-[#070c18]/60 shrink-0">
            <div className="flex items-center gap-1 p-1 rounded-2xl bg-[#0b1324] border border-white/10 overflow-x-auto scrollbar-none">
              {[
                { id: 'all', label: isBg ? 'Всичко в 1 изглед' : 'All-in-One Setup', icon: Sparkles },
                { id: 'pc', label: isBg ? '1. Настройка на PC' : '1. PC Setup (.EXE)', icon: Monitor },
                { id: 'phone', label: isBg ? '2. Телефон (QR / APK)' : '2. Phone (QR / APK)', icon: Smartphone },
                { id: 'verify', label: isBg ? '3. Тест на връзката' : '3. Verify Connection', icon: ShieldCheck },
              ].map((tab) => {
                const isActive = activeStep === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {

                      setActiveStep(tab.id as any);
                    }}
                    className={`relative min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-display font-semibold flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer z-10 ${
                      isActive ? 'text-cyan-200' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="quickSetupStepPill"
                        transition={SPRING_BUBBLY}
                        className="absolute inset-0 rounded-xl bg-cyan-500/20 border border-cyan-400/35 -z-10 transform-gpu"
                      />
                    )}
                    <Icon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
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
              className="min-h-[38px] px-3 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 text-xs font-mono text-cyan-300 flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isBg ? 'Обнови IP' : 'Refresh IP'}</span>
            </motion.button>
          </div>

          {/* Scrollable Body */}
          <div className="p-5 overflow-y-auto space-y-5 flex-1">
            {/* TOP HERO ACTION: 1-CLICK AUTO-PAIR THIS PC */}
            <div className="rounded-2xl bg-gradient-to-r from-cyan-500/15 via-sky-500/10 to-emerald-500/15 border border-cyan-400/35 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-xs font-mono text-cyan-300">
                  <Zap className="w-4 h-4 text-amber-400 icon-bolt-live shrink-0" />
                  <span>
                    {isBg ? 'СТЪПКА 0: АВТОМАТИЧНО СДВОЯВАНЕ' : 'INSTANT ZERO-CONFIG AUTO-PAIRING'}
                  </span>
                </div>
                <h3 className="font-display text-sm sm:text-base font-bold text-white">
                  {isBg
                    ? `Открит компютър: ${effectiveHostname} (${effectiveIp}:${effectivePort})`
                    : `Detected PC: ${effectiveHostname} (${effectiveIp}:${effectivePort})`}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isBg
                    ? 'Натиснете бутона отдясно, за да добавите този компютър към флота и да свържете WebSocket канала автоматично без писане на IP адреси.'
                    : 'Click the button on the right to automatically add this PC to your Fleet list and connect the live WebSocket channel with zero manual typing.'}
                </p>
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.04, y: -1 }}
                whileTap={{ scale: 0.94 }}
                transition={SPRING_POP}
                onClick={handleOneTapAutoPair}
                className={`min-h-[48px] px-5 py-2.5 rounded-2xl font-display font-bold text-xs sm:text-sm flex items-center gap-2 whitespace-nowrap cursor-pointer shrink-0 shadow-lg transition transform-gpu ${
                  isPairedSuccess
                    ? 'bg-emerald-400 text-slate-950 shadow-emerald-500/25'
                    : 'bg-cyan-400 hover:bg-cyan-300 text-slate-950 shadow-cyan-500/25'
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
                    <span>{isBg ? 'Свържи това PC с 1 клик' : '1-Tap Pair This PC Now'}</span>
                  </>
                )}
              </motion.button>
            </div>

            {/* MAIN GRID: PC SETUP (LEFT) + PHONE QR SETUP (RIGHT) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* STEP 1: PC SETUP CARD */}
              {(activeStep === 'all' || activeStep === 'pc') && (
                <div
                  className={`${
                    activeStep === 'pc' ? 'lg:col-span-12' : 'lg:col-span-6'
                  } rounded-2xl bg-[#0b1324]/90 border border-white/12 p-4 sm:p-5 flex flex-col justify-between space-y-4`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-300">
                          <Monitor className="w-4.5 h-4.5 icon-bubbly" />
                        </div>
                        <div>
                          <h3 className="font-display text-sm sm:text-base font-bold text-white">
                            {isBg ? '1. Стартиране на PC Демона' : '1. Run on Your Windows PC'}
                          </h3>
                          <p className="text-[11px] text-slate-400">
                            {isBg
                              ? 'Антивирус-безопасен десктоп контролен център'
                              : 'Antivirus-safe desktop control center & listener'}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-emerald-300">Port {effectivePort}</span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      {isBg
                        ? 'Изберете най-удобния начин за стартиране на компютъра си — не се изискват сложни настройки:'
                        : 'Pick whichever option is easiest for you — no manual terminal configuration needed:'}
                    </p>

                    {/* Option A: 1-Click Auto-Setup .BAT */}
                    <div className="p-3.5 rounded-xl bg-[#070c18] border border-cyan-400/30 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-display font-bold text-cyan-200">
                          {isBg
                            ? 'Вариант А (Препоръчан): 1-Клик Авто-Стартер (.BAT)'
                            : 'Option A (Easiest): 1-Click Auto-Setup Script (.BAT)'}
                        </span>
                        <span className="text-[10px] font-mono text-emerald-300">Auto-Firewall + GUI</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        {isBg
                          ? 'Автоматично инсталира зависимостите, отваря порт 8765 в Windows Firewall и пуска PC Демона + Уеб сървъра.'
                          : 'Automatically checks dependencies, opens Windows Firewall port 8765, and starts the PC Daemon GUI + Web Server.'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <a
                          href="/api/setup/windows-launcher"
                          download="AI_NetController_PC_Setup.bat"
                          onClick={() => triggerHapticFeedback('medium')}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 font-display font-bold text-xs flex items-center gap-2 transition cursor-pointer"
                        >
                          <Download className="w-4 h-4 text-cyan-300" />
                          <span>
                            {isBg ? 'Изтегли AI_NetController_PC_Setup.bat' : 'Download 1-Click PC Setup (.BAT)'}
                          </span>
                        </a>
                      </div>
                    </div>

                    {/* Option B: Standalone Windows .EXE */}
                    <div className="p-3.5 rounded-xl bg-[#070c18] border border-white/10 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-display font-bold text-white">
                          {isBg
                            ? 'Вариант Б: Самостоятелен Windows .EXE файл'
                            : 'Option B: Standalone Windows Executable (.EXE)'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">v0.50.0 (Beta)</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        {isBg
                          ? 'Готов компилиран изпълним файл за Windows 10/11 (AV-Safe режим без UPX компресия).'
                          : 'Pre-compiled Windows 10/11 binary built with AV-Safe directory mode (no UPX packer).'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <a
                          href={setupInfo?.exeDownloadUrl || '/releases/v0.50.0/AI_NetController_HostAgent_v0.50.0_win64.exe'}
                          download="AI_NetController_HostAgent_v0.50.0_win64.exe"
                          onClick={() => triggerHapticFeedback('medium')}
                          className="min-h-[42px] px-4 py-2 rounded-xl bg-white/[0.07] hover:bg-white/15 border border-white/15 text-white font-display font-semibold text-xs flex items-center gap-2 transition cursor-pointer"
                        >
                          <Download className="w-4 h-4 text-emerald-400" />
                          <span>{isBg ? 'Изтегли AI_NetController_HostAgent_v0.50.0_win64.exe' : 'Download AI_NetController_HostAgent_v0.50.0_win64.exe'}</span>
                        </a>
                      </div>
                    </div>

                    {/* Option C: Copy 1-Line Command */}
                    <div className="p-3 rounded-xl bg-[#050811] border border-white/10 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono text-slate-400">
                          {isBg ? 'Или стартирайте от папката на проекта:' : 'Or run inside the project folder:'}
                        </div>
                        <code className="text-xs font-mono text-cyan-300 truncate block mt-0.5">
                          START_HERE_WINDOWS.bat
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy('START_HERE_WINDOWS.bat', 'cmd')}
                        className="min-h-[38px] px-3 rounded-lg bg-white/[0.06] hover:bg-white/12 border border-white/10 text-xs font-mono text-slate-200 flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        {copiedField === 'cmd' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{isBg ? 'Копирано' : 'Copied'}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-cyan-400" />
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
                  } rounded-2xl bg-[#0b1324]/90 border border-white/12 p-4 sm:p-5 flex flex-col justify-between space-y-4`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
                          <Smartphone className="w-4.5 h-4.5 icon-bubbly" />
                        </div>
                        <div>
                          <h3 className="font-display text-sm sm:text-base font-bold text-white">
                            {isBg ? '2. Настройка на Телефона (QR или APK)' : '2. Connect Your Phone (QR or APK)'}
                          </h3>
                          <p className="text-[11px] text-slate-400">
                            {isBg
                              ? 'Сканирайте с камерата за автоматично сдвояване'
                              : 'Scan with phone camera for zero-typing auto-pairing'}
                          </p>
                        </div>
                      </div>
                      <QrCode className="w-5 h-5 text-cyan-400" />
                    </div>

                    {/* QR Code + Editable LAN IP Row */}
                    <div className="p-3.5 rounded-xl bg-[#070c18] border border-white/10 flex flex-col sm:flex-row items-center gap-4">
                      <div className="w-36 h-36 rounded-2xl bg-[#070c18] border-2 border-cyan-400/40 p-2 flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(34,211,238,0.15)]">
                        {qrDataUrl ? (
                          <img
                            src={qrDataUrl}
                            alt="Phone Auto-Pairing QR Code"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-contain rounded-lg"
                          />
                        ) : (
                          <QrCode className="w-14 h-14 text-cyan-400/50 animate-pulse" />
                        )}
                      </div>

                      <div className="flex-1 space-y-2.5 w-full min-w-0">
                        <div>
                          <label className="block text-[11px] font-mono text-slate-400 mb-1">
                            {isBg ? 'Wi-Fi / LAN IP адрес на вашия PC:' : 'Your PC Wi-Fi / LAN IP Address:'}
                          </label>
                          <input
                            type="text"
                            value={customIp}
                            onChange={(e) => setCustomIp(e.target.value)}
                            placeholder="192.168.1.104"
                            className="w-full px-3 py-2 rounded-xl bg-[#0b1324] border border-white/15 text-xs font-mono text-cyan-200 outline-none focus:border-cyan-400"
                          />
                        </div>

                        <p className="text-[11px] text-slate-300 leading-snug">
                          {isBg
                            ? 'Насочете камерата на телефона към QR кода. Приложението ще се отвори и автоматично ще добави и свърже вашия компютър!'
                            : 'Point your phone camera at this QR code. It opens the app on your phone and automatically pairs your PC!'}
                        </p>

                        <button
                          type="button"
                          onClick={() => handleCopy(effectiveMobilePairUrl, 'pairUrl')}
                          className="w-full min-h-[38px] px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/12 border border-white/10 text-xs font-mono text-cyan-300 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {copiedField === 'pairUrl' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>{isBg ? 'Линкът за сдвояване е копиран!' : 'Auto-Pair Link Copied!'}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>{isBg ? 'Копирай линк за авто-сдвояване' : 'Copy Auto-Pairing Link'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Two Phone App Installation Buttons: PWA (1-Tap) + Native Android .APK */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={handleInstallPwa}
                        className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 font-display font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Smartphone className="w-4 h-4 text-emerald-300 shrink-0" />
                        <span>
                          {isBg ? 'Инсталирай Уеб Приложение (PWA)' : '1-Tap Install Phone App (PWA)'}
                        </span>
                      </button>

                      <a
                        href={setupInfo?.apkDownloadUrl || '/releases/v0.50.0/AI_NetController_v0.50.0_arm64-v8a.apk'}
                        download="AI_NetController_v0.50.0_arm64-v8a.apk"
                        onClick={() => triggerHapticFeedback('medium')}
                        className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white/[0.07] hover:bg-white/15 border border-white/15 text-white font-display font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Download className="w-4 h-4 text-cyan-300 shrink-0" />
                        <span>{isBg ? 'Изтегли Android .APK' : 'Download Android .APK'}</span>
                      </a>
                    </div>

                    {/* Optional collapsible PWA guide for iOS Safari / Android Chrome */}
                    <AnimatePresence>
                      {showPwaGuide && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-[11px] text-emerald-100 space-y-1 overflow-hidden"
                        >
                          <div className="font-bold text-emerald-300">
                            {isBg
                              ? 'Как да добавите иконата на началния екран на телефона:'
                              : 'How to install directly to your Phone Home Screen:'}
                          </div>
                          <div>
                            • <strong>Android (Chrome):</strong>{' '}
                            {isBg
                              ? 'Натиснете менюто (⋮) горе вдясно → "Add to Home screen" / "Install app".'
                              : 'Tap the browser menu (⋮) → "Install app" or "Add to Home screen".'}
                          </div>
                          <div>
                            • <strong>iPhone (Safari):</strong>{' '}
                            {isBg
                              ? 'Натиснете бутона Share (Споделяне) долу → "Add to Home Screen".'
                              : 'Tap the Share button at the bottom → "Add to Home Screen".'}
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
              <div className="rounded-2xl bg-[#0b1324]/80 border border-white/10 p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4.5 h-4.5 text-emerald-400" />
                    <h4 className="font-display text-xs sm:text-sm font-bold text-white">
                      {isBg
                        ? '3. Автоматична проверка на готовността на системата'
                        : '3. Automated System & Network Readiness Check'}
                    </h4>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {effectiveWsUri} • MAC {hasValidMac ? effectiveMac : isBg ? 'Неоткрит' : 'Unverified'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-[#070c18] border border-white/10 flex items-center gap-2.5">
                    {isDaemonReady ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">
                        {isBg ? 'PC Демон Сървър' : 'PC Daemon Listener'}
                      </div>
                      <div
                        className={`text-[11px] font-mono truncate ${
                          isDaemonReady ? 'text-emerald-300' : 'text-amber-300'
                        }`}
                      >
                        {isDaemonReady
                          ? `ONLINE (${effectiveIp}:${effectivePort})`
                          : serverReachable === false
                          ? isBg
                            ? 'OFFLINE (Сървърът не отговаря)'
                            : 'OFFLINE (Server Unreachable)'
                          : isBg
                          ? 'Офлайн / Непотвърден'
                          : 'OFFLINE / UNVERIFIED'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#070c18] border border-white/10 flex items-center gap-2.5">
                    {hasValidMac ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">
                        {isBg ? 'Wake-on-LAN (UDP 9)' : 'Wake-on-LAN (UDP 9)'}
                      </div>
                      <div
                        className={`text-[11px] font-mono truncate ${
                          hasValidMac ? 'text-cyan-300' : 'text-amber-300'
                        }`}
                      >
                        {hasValidMac ? effectiveMac : isBg ? 'Липсва валиден MAC' : 'MAC missing / unverified'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#070c18] border border-white/10 flex items-center gap-2.5">
                    {isDaemonReady ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">
                        {isBg ? 'AV-Safe Защита' : 'AV-Safe Integrity'}
                      </div>
                      <div
                        className={`text-[11px] font-mono truncate ${
                          isDaemonReady ? 'text-emerald-300' : 'text-slate-400'
                        }`}
                      >
                        {isDaemonReady
                          ? 'No UPX • HWND Verified'
                          : isBg
                          ? 'Очаква проверка от демона'
                          : 'Awaiting Daemon Health'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#070c18] border border-white/10 flex items-center gap-2.5">
                    <Wifi className={`w-4 h-4 shrink-0 ${isConnected ? 'text-emerald-400' : 'text-cyan-400'}`} />
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">
                        {isBg ? 'Контролер Връзка' : 'Controller Channel'}
                      </div>
                      <div className="text-[11px] text-cyan-300 font-mono truncate">
                        {isConnected
                          ? isBg
                            ? 'Свързан (WebSocket)'
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
          <div className="px-5 py-3.5 border-t border-white/10 bg-[#0b1324]/80 flex items-center justify-between gap-3 shrink-0">
            <div className="text-[11px] text-slate-400 hidden sm:block">
              {isBg
                ? 'Съвет: Телефонът и компютърът трябва да са свързани към една и съща Wi-Fi мрежа.'
                : 'Tip: Ensure both your phone and PC are connected to the same home Wi-Fi / LAN.'}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={handleOneTapAutoPair}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 font-display font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-cyan-300" />
                <span>{isBg ? 'Авто-Сдвои PC' : 'Auto-Pair Local PC'}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-display font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
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
