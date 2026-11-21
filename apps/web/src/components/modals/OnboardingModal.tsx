import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  ShieldCheck,
  Cpu,
  Zap,
  TerminalSquare,
  Monitor,
  Smartphone,
  QrCode,
  Wifi,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Globe,
  Lock,
  Activity,
  X,
  Play,
  Radio,
  SlidersHorizontal,
  Sun,
  Moon,
} from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { useUIStore } from '../../store/uiStore';
import { triggerHapticFeedback } from '../../services/hapticService';
import { SPRING_BUBBLY, SPRING_POP, MODAL_BUBBLE_VARIANTS } from '../../utils/springPhysics';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenQuickSetup?: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onOpenQuickSetup,
}) => {
  const { language, setLanguage } = useTranslation();
  const isBg = language === 'bg';

  const [currentStep, setCurrentStep] = useState(0);
  const selectedModel = useUIStore((s) => s.selectedModel);
  const setSelectedModel = useUIStore((s) => s.setSelectedModel);
  const themeMode = useUIStore((s) => s.themeMode);
  const setThemeMode = useUIStore((s) => s.setThemeMode);
  const setCompletedOnboarding = useUIStore((s) => s.setCompletedOnboarding);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const setupTimerRef = useRef<number | null>(null);

  const TOTAL_STEPS = 5;

  useEffect(() => {
    return () => {
      if (setupTimerRef.current !== null) {
        window.clearTimeout(setupTimerRef.current);
        setupTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
    }
  }, [isOpen]);

  const handleFinish = useCallback(
    (openSetup: boolean | unknown = false) => {
      triggerHapticFeedback('heavy');
      if (dontShowAgain) {
        try {
          setCompletedOnboarding();
        } catch {}
      }
      onClose();
      if (openSetup === true && onOpenQuickSetup) {
        if (setupTimerRef.current !== null) {
          window.clearTimeout(setupTimerRef.current);
        }
        setupTimerRef.current = window.setTimeout(() => {
          setupTimerRef.current = null;
          onOpenQuickSetup();
        }, 300);
      }
    },
    [dontShowAgain, setCompletedOnboarding, onClose, onOpenQuickSetup]
  );

  const handlePrev = useCallback(() => {
    triggerHapticFeedback('light');
    setCurrentStep((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  const handleNext = useCallback(() => {
    triggerHapticFeedback('light');
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleFinish();
    }
  }, [currentStep, TOTAL_STEPS, handleFinish]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (currentStep < TOTAL_STEPS - 1) {
          e.preventDefault();
          handleNext();
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentStep > 0) {
          e.preventDefault();
          handlePrev();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleFinish();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStep, TOTAL_STEPS, handleNext, handlePrev, handleFinish]);

  const stepTitles = [
    isBg ? 'Добре дошли' : 'Welcome',
    isBg ? 'Сигурност и архитектура' : 'Security & Architecture',
    isBg ? 'Свързване на хост' : 'Host Pairing',
    isBg ? 'Ключови възможности' : 'Core Superpowers',
    isBg ? 'Готови за старт' : 'Ready to Launch',
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          {/* Adaptive Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => handleFinish()}
            style={{ backgroundColor: 'var(--backdrop-scrim)' }}
            className="fixed inset-0 backdrop-blur-md transition-opacity"
          />

          {/* Main Liquid Glass Dialog Container */}
          <motion.div
            variants={MODAL_BUBBLE_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative w-full max-w-2xl glass-liquid-modal rounded-[28px] overflow-hidden flex flex-col my-auto max-h-[92dvh] z-10"
          >
            {/* Top Progress Glow Line */}
            <div className="w-full bg-[var(--glass-border)] h-1.5 relative overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-secondary)] to-[var(--accent-tertiary)]"
                animate={{ width: `${((currentStep + 1) / TOTAL_STEPS) * 100}%` }}
                transition={SPRING_BUBBLY}
              />
            </div>

            {/* Header Bar */}
            <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-[var(--glass-border)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 squircle-badge squircle-hero shrink-0">
                  <Sparkles className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-display font-bold tracking-wide text-[var(--accent-primary)] truncate">
                      AI NetController
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[var(--accent-primary)]/14 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] shrink-0">
                      v0.80.0
                    </span>
                  </div>
                  <h2 className="text-sm font-display font-bold ink-primary truncate">
                    {stepTitles[currentStep]}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold liquid-control-pill ink-secondary tabular-nums">
                  {currentStep + 1} / {TOTAL_STEPS}
                </span>

                <button
                  type="button"
                  onClick={() => handleFinish()}
                  className="min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center rounded-full liquid-control-pill ink-secondary hover:ink-primary transition cursor-pointer"
                  title={isBg ? 'Затвори' : 'Close'}
                  aria-label={isBg ? 'Затвори' : 'Close'}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Slide Body */}
            <div className="p-5 sm:p-7 overflow-y-auto bouncy-scroll flex-1 text-sm">
              <AnimatePresence mode="wait">
                {/* STEP 1: WELCOME & QUICK PREFERENCES */}
                {currentStep === 0 && (
                  <motion.div
                    key="step-0"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={SPRING_BUBBLY}
                    className="space-y-5"
                  >
                    <div className="text-center space-y-2 py-1">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--accent-primary)]/12 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] text-xs font-display font-semibold">
                        <Radio className="w-3.5 h-3.5 animate-pulse" />
                        {isBg ? 'Автономен локален системен мост' : 'Autonomous Local-First SysAdmin'}
                      </div>
                      <h1 className="text-xl sm:text-2xl font-display font-extrabold ink-primary tracking-tight">
                        {isBg
                          ? 'Добре дошли в AI NetController'
                          : 'Welcome to AI NetController'}
                      </h1>
                      <p className="ink-secondary max-w-lg mx-auto text-xs sm:text-sm leading-relaxed">
                        {isBg
                          ? 'Платформа от ново поколение за управление на локална компютърна инфраструктура с изкуствен интелект, Zero-Trust криптография и 120Hz поточно видео.'
                          : 'Next-generation local-first platform for autonomous AI system administration, zero-trust hardware control, and sub-5ms 120Hz display streaming.'}
                      </p>
                    </div>

                    {/* 3 Core Highlights */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)]">
                        <div className="w-9 h-9 squircle-badge squircle-sky mb-2.5">
                          <Lock className="w-4 h-4" />
                        </div>
                        <h3 className="font-display font-bold ink-primary text-xs mb-1">
                          {isBg ? '100% Локално (LAN)' : '100% Local-First'}
                        </h3>
                        <p className="text-[11.5px] ink-secondary leading-normal">
                          {isBg
                            ? 'Няма външни облачни сървъри. Данните и телеметрията остават във вашата мрежа.'
                            : 'No third-party cloud telemetry. Commands and screen data stay on your LAN.'}
                        </p>
                      </div>

                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)]">
                        <div className="w-9 h-9 squircle-badge squircle-emerald mb-2.5">
                          <Zap className="w-4 h-4" />
                        </div>
                        <h3 className="font-display font-bold ink-primary text-xs mb-1">
                          {isBg ? '120Hz Поточен екран' : '120Hz Display Stream'}
                        </h3>
                        <p className="text-[11.5px] ink-secondary leading-normal">
                          {isBg
                            ? 'Хардуерно ускорен видео стрийминг с виртуално дистанционно управление.'
                            : 'Hardware-accelerated sub-5ms desktop mirroring with virtual remote control.'}
                        </p>
                      </div>

                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)]">
                        <div className="w-9 h-9 squircle-badge squircle-violet mb-2.5">
                          <Cpu className="w-4 h-4" />
                        </div>
                        <h3 className="font-display font-bold ink-primary text-xs mb-1">
                          {isBg ? 'AI Администратор' : 'AI Autonomous Admin'}
                        </h3>
                        <p className="text-[11.5px] ink-secondary leading-normal">
                          {isBg
                            ? 'Команди на естествен език, диагностика и Human-in-the-Loop защита.'
                            : 'Natural language sysadmin prompts, automated triage, and HITL safety.'}
                        </p>
                      </div>
                    </div>

                    {/* Quick Personalization: Language & Daylight/Dark Glass */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="flex items-center justify-between gap-2 p-3 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <Globe className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
                          <span className="ink-primary font-display font-semibold truncate">
                            {isBg ? 'Език' : 'Language'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHapticFeedback('light');
                              setLanguage('bg');
                            }}
                            className={`min-h-[34px] px-3 rounded-full text-xs font-display font-bold cursor-pointer transition ${
                              isBg
                                ? 'liquid-hero-btn preserve-white'
                                : 'liquid-control-pill ink-secondary hover:ink-primary'
                            }`}
                          >
                            БГ
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              triggerHapticFeedback('light');
                              setLanguage('en');
                            }}
                            className={`min-h-[34px] px-3 rounded-full text-xs font-display font-bold cursor-pointer transition ${
                              !isBg
                                ? 'liquid-hero-btn preserve-white'
                                : 'liquid-control-pill ink-secondary hover:ink-primary'
                            }`}
                          >
                            EN
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 p-3 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          {themeMode === 'light' ? (
                            <Sun className="w-4 h-4 text-amber-500 shrink-0" />
                          ) : (
                            <Moon className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
                          )}
                          <span className="ink-primary font-display font-semibold truncate">
                            {isBg ? 'Визия' : 'Glass Mode'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              triggerHapticFeedback('light');
                              setThemeMode('light');
                            }}
                            className={`min-h-[34px] px-2.5 rounded-full text-xs font-display font-bold cursor-pointer transition flex items-center gap-1 ${
                              themeMode === 'light'
                                ? 'liquid-hero-btn preserve-white'
                                : 'liquid-control-pill ink-secondary hover:ink-primary'
                            }`}
                          >
                            <Sun className="w-3 h-3" />
                            <span>{isBg ? 'Ден' : 'Day'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              triggerHapticFeedback('light');
                              setThemeMode('dark');
                            }}
                            className={`min-h-[34px] px-2.5 rounded-full text-xs font-display font-bold cursor-pointer transition flex items-center gap-1 ${
                              themeMode === 'dark'
                                ? 'liquid-hero-btn preserve-white'
                                : 'liquid-control-pill ink-secondary hover:ink-primary'
                            }`}
                          >
                            <Moon className="w-3 h-3" />
                            <span>{isBg ? 'Нощ' : 'Dark'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* STEP 2: ARCHITECTURE & ZERO-TRUST SECURITY */}
                {currentStep === 1 && (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={SPRING_BUBBLY}
                    className="space-y-4"
                  >
                    <div className="space-y-1">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-display font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                        {isBg ? 'Zero-Trust архитектура' : 'Zero-Trust Architecture'}
                      </span>
                      <h3 className="text-lg font-display font-extrabold ink-primary">
                        {isBg
                          ? 'Как AI NetController защитава вашите системи'
                          : 'How AI NetController Protects Your Machines'}
                      </h3>
                      <p className="ink-secondary text-xs leading-relaxed">
                        {isBg
                          ? 'Никоя команда не се изпълнява без проверка. Системата комбинира криптография, синтактичен анализ и човешки надзор.'
                          : 'No command executes unchecked. The system combines modern cryptography, AST syntax inspection, and operator oversight.'}
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex items-start gap-3">
                        <div className="w-9 h-9 squircle-badge squircle-sky shrink-0 mt-0.5">
                          <Lock className="w-4 h-4" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-display font-bold ink-primary text-xs">
                              {isBg
                                ? 'Ефемерен X25519 & ChaCha20-Poly1305'
                                : 'Ephemeral X25519 & ChaCha20-Poly1305'}
                            </h4>
                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300">
                              RFC 8439
                            </span>
                          </div>
                          <p className="text-[11.5px] ink-secondary leading-normal">
                            {isBg
                              ? 'Всяка WebSocket сесия генерира нов еднократен ключ. Защита срещу Replay атаки чрез 128-битов прозорец (RFC 6479).'
                              : 'Every session establishes fresh ephemeral keys. Replay protection is enforced via RFC 6479 128-bit sliding bitmap windows.'}
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex items-start gap-3">
                        <div className="w-9 h-9 squircle-badge squircle-amber shrink-0 mt-0.5">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-display font-bold ink-primary text-xs">
                              {isBg ? 'Human-in-the-Loop (HITL) портал' : 'Human-in-the-Loop (HITL) Gate'}
                            </h4>
                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
                              Safety
                            </span>
                          </div>
                          <p className="text-[11.5px] ink-secondary leading-normal">
                            {isBg
                              ? 'Критични команди (рестарт, форматиране, изтриване) изискват изрично одобрение от оператора.'
                              : 'Destructive operations (reboot, format, file purge) require mandatory explicit operator approval.'}
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex items-start gap-3">
                        <div className="w-9 h-9 squircle-badge squircle-emerald shrink-0 mt-0.5">
                          <TerminalSquare className="w-4 h-4" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-display font-bold ink-primary text-xs">
                              {isBg ? 'AST командна защитна стена' : 'AST Command Firewall'}
                            </h4>
                            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                              De-Obfuscation
                            </span>
                          </div>
                          <p className="text-[11.5px] ink-secondary leading-normal">
                            {isBg
                              ? 'Разпознава опити за маскиране на шел команди (символи ^, `, env променливи) и блокира опасни скриптове.'
                              : 'Resolves shell obfuscation tricks (caret ^, backtick `, env slices) and neutralizes dangerous commands pre-flight.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* STEP 3: HOST PAIRING */}
                {currentStep === 2 && (
                  <motion.div
                    key="step-2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={SPRING_BUBBLY}
                    className="space-y-4"
                  >
                    <div className="space-y-1">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-display font-bold bg-[var(--accent-primary)]/14 text-[var(--accent-primary)] border border-[var(--accent-primary)]/25">
                        {isBg ? 'Лесно свързване' : 'Host Pairing'}
                      </span>
                      <h3 className="text-lg font-display font-extrabold ink-primary">
                        {isBg
                          ? 'Как да свържете вашия компютър'
                          : 'How to Connect Your Computer'}
                      </h3>
                      <p className="ink-secondary text-xs leading-relaxed">
                        {isBg
                          ? 'Стартирайте лекия фонов агент на вашата машина с 1 клик, за да получите пълен достъп през конзолата.'
                          : 'Launch the lightweight background agent on your machine in 1 click to enable full autonomous control.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-4 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex flex-col justify-between">
                        <div className="space-y-2">
                          <div className="w-9 h-9 squircle-badge squircle-sky">
                            <Monitor className="w-4.5 h-4.5" />
                          </div>
                          <h4 className="font-display font-bold ink-primary text-xs">
                            {isBg ? 'Компютър (Windows / Linux)' : 'PC (Windows / Linux)'}
                          </h4>
                          <p className="text-[11.5px] ink-secondary leading-normal">
                            {isBg
                              ? 'Стартирайте START_HERE_WINDOWS.bat или AI_NetController_HostAgent.exe. Демонът слуша на порт 8765 с mDNS.'
                              : 'Run START_HERE_WINDOWS.bat or AI_NetController_HostAgent.exe. The daemon listens on port 8765 with zero-config mDNS.'}
                          </p>
                        </div>

                        <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex items-center justify-between text-[11px] font-mono">
                          <span className="text-[var(--accent-primary)] font-semibold">Port 8765</span>
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-300 font-semibold">
                            <Check className="w-3.5 h-3.5" /> mDNS Ready
                          </span>
                        </div>
                      </div>

                      <div className="p-4 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex flex-col justify-between">
                        <div className="space-y-2">
                          <div className="w-9 h-9 squircle-badge squircle-emerald">
                            <Smartphone className="w-4.5 h-4.5" />
                          </div>
                          <h4 className="font-display font-bold ink-primary text-xs">
                            {isBg ? 'Мобилно устройство / PWA' : 'Mobile / Phone PWA'}
                          </h4>
                          <p className="text-[11.5px] ink-secondary leading-normal">
                            {isBg
                              ? 'Сканирайте QR кода от „Бърза настройка“ с камерата на телефона за мигновено сдвояване.'
                              : 'Scan the QR code from "Quick Setup" with your phone camera for zero-typing instantaneous pairing.'}
                          </p>
                        </div>

                        <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex items-center justify-between text-[11px] font-mono">
                          <span className="text-emerald-600 dark:text-emerald-300 font-semibold">
                            PWA / Android
                          </span>
                          <span className="flex items-center gap-1 text-[var(--accent-primary)] font-semibold">
                            <QrCode className="w-3.5 h-3.5" /> QR Scan
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] flex items-center justify-between font-mono text-xs">
                      <div className="flex items-center gap-2 text-[var(--accent-primary)] font-semibold">
                        <Wifi className="w-4 h-4" />
                        <span>ws://localhost:8765</span>
                      </div>
                      <span className="text-[11px] ink-muted">
                        {isBg ? 'Стандартен адрес' : 'Default URI'}
                      </span>
                    </div>
                  </motion.div>
                )}

                {/* STEP 4: CORE SUPERPOWERS */}
                {currentStep === 3 && (
                  <motion.div
                    key="step-3"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={SPRING_BUBBLY}
                    className="space-y-4"
                  >
                    <div className="space-y-1">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-display font-bold bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/25">
                        {isBg ? 'Възможности на системата' : 'Core Capabilities'}
                      </span>
                      <h3 className="text-lg font-display font-extrabold ink-primary">
                        {isBg
                          ? 'Всичко необходимо в един изчистен интерфейс'
                          : 'Everything You Need in One Unified Console'}
                      </h3>
                      <p className="ink-secondary text-xs leading-relaxed">
                        {isBg
                          ? 'Превключвайте между 4-те режима чрез долната плаваща лента или клавиши [1]–[4].'
                          : 'Cycle between the 4 main tabs using the floating Liquid Glass dock or keys [1]–[4].'}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex items-start gap-2.5">
                        <div className="w-8 h-8 squircle-badge squircle-sky shrink-0">
                          <Activity className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-display font-bold ink-primary text-xs">
                            {isBg ? 'Устройства и топология [1]' : 'Devices & Topology [1]'}
                          </h4>
                          <p className="text-[11px] ink-secondary">
                            {isBg
                              ? 'Следете RTT, RAM, CPU и визуализирайте мрежата в интерактивна D3 графика.'
                              : 'Monitor real-time RTT jitter, RAM/CPU, and interactive D3 network graphs.'}
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex items-start gap-2.5">
                        <div className="w-8 h-8 squircle-badge squircle-emerald shrink-0">
                          <TerminalSquare className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-display font-bold ink-primary text-xs">
                            {isBg ? 'Команден терминал [2]' : 'Command Terminal [2]'}
                          </h4>
                          <p className="text-[11px] ink-secondary">
                            {isBg
                              ? 'Изпълнявайте PowerShell/Bash команди с мигновен поточно изведен резултат.'
                              : 'Execute remote PowerShell/Bash commands with live streamed stdout/stderr.'}
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex items-start gap-2.5">
                        <div className="w-8 h-8 squircle-badge squircle-violet shrink-0">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-display font-bold ink-primary text-xs">
                            {isBg ? 'AI Асистент и чат [3]' : 'AI Copilot & Chat [3]'}
                          </h4>
                          <p className="text-[11px] ink-secondary">
                            {isBg
                              ? 'Управлявайте машините на естествен език чрез Gemini или локален DeepSeek.'
                              : 'Orchestrate hosts in plain English or Bulgarian using Gemini or DeepSeek.'}
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] flex items-start gap-2.5">
                        <div className="w-8 h-8 squircle-badge squircle-amber shrink-0">
                          <Zap className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-display font-bold ink-primary text-xs">
                            {isBg ? 'Wake-on-LAN и енергия' : 'Wake-on-LAN & Energy'}
                          </h4>
                          <p className="text-[11px] ink-secondary">
                            {isBg
                              ? 'Събуждайте спящи хостове, планирайте графици и следете енергийната икономия.'
                              : 'Wake sleeping PCs with IEEE 802.3 packets, schedules & live energy savings.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/25 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 text-[var(--accent-primary)] font-display font-semibold">
                        <SlidersHorizontal className="w-4 h-4 shrink-0" />
                        <span>
                          {isBg
                            ? 'Бързо меню: Натиснете [Ctrl + K] или [/] навсякъде'
                            : 'Quick Omnibar: Press [Ctrl + K] or [/] anytime'}
                        </span>
                      </div>
                      <span className="font-mono text-[10.5px] font-bold px-2.5 py-0.5 rounded-full bg-[var(--accent-primary)]/18 text-[var(--accent-primary)] shrink-0">
                        Spotlight
                      </span>
                    </div>
                  </motion.div>
                )}

                {/* STEP 5: PREFERENCES & READY TO LAUNCH */}
                {currentStep === 4 && (
                  <motion.div
                    key="step-4"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={SPRING_BUBBLY}
                    className="space-y-4"
                  >
                    <div className="text-center space-y-1.5 py-1">
                      <div className="w-12 h-12 squircle-badge squircle-emerald mx-auto">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <h3 className="text-lg font-display font-extrabold ink-primary">
                        {isBg ? 'Готови сте за работа!' : 'You Are All Set!'}
                      </h3>
                      <p className="ink-secondary text-xs max-w-md mx-auto">
                        {isBg
                          ? 'Изберете предпочитан AI модел и стартирайте управлението на вашата мрежа.'
                          : 'Select your preferred AI model and dive right into your local network console.'}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-display font-bold ink-primary">
                        {isBg ? 'Предпочитан AI модел' : 'Default AI Model'}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            triggerHapticFeedback('light');
                            setSelectedModel('gemini-2.5-flash');
                          }}
                          className={`p-3.5 rounded-2xl text-left border transition cursor-pointer flex items-start gap-3 ${
                            selectedModel === 'gemini-2.5-flash'
                              ? 'bg-[var(--accent-primary)]/14 border-[var(--accent-primary)]/50 shadow-sm'
                              : 'glass-liquid-subtle border-[var(--glass-border)] hover:border-[var(--accent-primary)]/35'
                          }`}
                        >
                          <div className="w-8 h-8 squircle-badge squircle-hero shrink-0">
                            <Sparkles className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-display font-bold text-xs ink-primary">
                              Gemini 2.5 Flash
                            </div>
                            <div className="text-[11px] ink-secondary">
                              {isBg ? 'Препоръчан • Бърз и точен' : 'Recommended • Fast & Accurate'}
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            triggerHapticFeedback('light');
                            setSelectedModel('deepseek-r1:latest');
                          }}
                          className={`p-3.5 rounded-2xl text-left border transition cursor-pointer flex items-start gap-3 ${
                            selectedModel === 'deepseek-r1:latest'
                              ? 'bg-emerald-500/14 border-emerald-500/50 shadow-sm'
                              : 'glass-liquid-subtle border-[var(--glass-border)] hover:border-emerald-500/35'
                          }`}
                        >
                          <div className="w-8 h-8 squircle-badge squircle-emerald shrink-0">
                            <Cpu className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-display font-bold text-xs ink-primary">
                              DeepSeek-R1 (Local)
                            </div>
                            <div className="text-[11px] ink-secondary">
                              {isBg ? '100% Офлайн през Ollama' : '100% Offline via Ollama'}
                            </div>
                          </div>
                        </button>
                      </div>
                    </div>

                    <label
                      htmlFor="dontShowAgain"
                      className="flex items-center gap-2.5 pt-1 text-xs ink-secondary cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        id="dontShowAgain"
                        checked={dontShowAgain}
                        onChange={(e) => setDontShowAgain(e.target.checked)}
                        className="w-4 h-4 rounded accent-[var(--accent-primary)] cursor-pointer"
                      />
                      <span>
                        {isBg
                          ? 'Запомни завършването (не показвай автоматично при следващ старт)'
                          : 'Remember completion (do not auto-popup on next startup)'}
                      </span>
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer Navigation Bar */}
            <div className="px-4 sm:px-5 py-3.5 border-t border-[var(--glass-border)] glass-liquid-subtle flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="shrink-0">
                {currentStep > 0 && (
                  <button
                    type="button"
                    onClick={handlePrev}
                    className="min-h-[40px] px-3.5 py-2 rounded-full liquid-control-pill ink-primary text-xs font-display font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>{isBg ? 'Назад' : 'Back'}</span>
                  </button>
                )}
              </div>

              {/* Interactive Step Indicator Pills */}
              <div className="hidden xs:flex items-center gap-1">
                {Array.from({ length: TOTAL_STEPS }).map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback('light');
                      setCurrentStep(idx);
                    }}
                    className="min-w-[28px] min-h-[28px] flex items-center justify-center cursor-pointer"
                    title={`${isBg ? 'Стъпка' : 'Step'} ${idx + 1}: ${stepTitles[idx]}`}
                    aria-label={`${isBg ? 'Стъпка' : 'Step'} ${idx + 1}`}
                  >
                    <span
                      className={`h-2 rounded-full transition-all ${
                        idx === currentStep
                          ? 'w-6 bg-[var(--accent-primary)]'
                          : idx < currentStep
                          ? 'w-2 bg-emerald-500'
                          : 'w-2 bg-[var(--glass-border)] hover:bg-[var(--accent-primary)]/50'
                      }`}
                    />
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {currentStep < TOTAL_STEPS - 1 ? (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                    transition={SPRING_POP}
                    onClick={handleNext}
                    className="min-h-[40px] px-5 py-2 rounded-full liquid-hero-btn preserve-white font-display font-bold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <span>{isBg ? 'Напред' : 'Next'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </motion.button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={() => handleFinish(true)}
                      className="min-h-[40px] px-4 py-2 rounded-full liquid-control-pill ink-primary font-display font-semibold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                      title={isBg ? 'Свържи реален PC демон сега' : 'Pair Live PC Daemon Now'}
                    >
                      <QrCode className="w-3.5 h-3.5 text-[var(--accent-primary)] shrink-0" />
                      <span>{isBg ? 'Сдвояване' : 'Pair Host'}</span>
                    </button>
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                      transition={SPRING_POP}
                      onClick={() => handleFinish(false)}
                      className="min-h-[40px] px-5 py-2 rounded-full liquid-hero-btn preserve-white font-display font-bold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                      <span>{isBg ? 'Към конзолата' : 'Enter Console'}</span>
                    </motion.button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
