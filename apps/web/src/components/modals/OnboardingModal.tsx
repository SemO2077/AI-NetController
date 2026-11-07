import React, { useState, useEffect } from 'react';
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
  Flame,
  Radio,
  SlidersHorizontal,
} from 'lucide-react';
import { useTranslation, Language } from '../../i18n/useTranslation';
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
  const setCompletedOnboarding = useUIStore((s) => s.setCompletedOnboarding);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const TOTAL_STEPS = 5;

  // Reset to first step whenever opened
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
    }
  }, [isOpen]);

  // Keyboard navigation
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
  }, [isOpen, currentStep]);

  const handleNext = () => {
    triggerHapticFeedback('light');
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    triggerHapticFeedback('light');
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleFinish = (openSetup = false) => {
    triggerHapticFeedback('heavy');
    try {
      setCompletedOnboarding();
    } catch {}
    onClose();
    if (openSetup && onOpenQuickSetup) {
      setTimeout(() => {
        onOpenQuickSetup();
      }, 300);
    }
  };

  const stepTitles = [
    isBg ? 'Добре дошли' : 'Welcome',
    isBg ? 'Сигурност & Архитектура' : 'Security & Architecture',
    isBg ? 'Свързване на Хост' : 'Host Pairing',
    isBg ? 'Ключови Възможности' : 'Core Superpowers',
    isBg ? 'Готови за Старт' : 'Ready to Launch',
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => handleFinish()}
        className="fixed inset-0 bg-[#02050c]/80 backdrop-blur-xl transition-opacity"
      />

      {/* Main Dialog Container */}
      <motion.div
        variants={MODAL_BUBBLE_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative w-full max-w-2xl bg-[#080f21]/95 border border-cyan-500/25 rounded-3xl shadow-[0_25px_70px_rgba(0,240,255,0.18)] overflow-hidden flex flex-col my-auto max-h-[92dvh] z-10 text-white"
      >
        {/* Top Progress Glow Line */}
        <div className="w-full bg-white/5 h-1.5 relative overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 shadow-[0_0_12px_#00F0FF]"
            animate={{ width: `${((currentStep + 1) / TOTAL_STEPS) * 100}%` }}
            transition={SPRING_BUBBLY}
          />
        </div>

        {/* Header Bar */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/[0.02]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/10 border border-cyan-400/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-cyan-400 truncate">
                  AI NetController
                </span>
                <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 shrink-0 shadow-[0_0_8px_rgba(0,240,255,0.2)]">
                  v0.31.3
                </span>
              </div>
              <h2 className="text-sm font-semibold text-white/90 truncate">
                {stepTitles[currentStep]}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Step Indicator Badges */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-white/50">
              <span>{currentStep + 1}</span>
              <span>/</span>
              <span>{TOTAL_STEPS}</span>
            </div>

            <button
              onClick={() => handleFinish()}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-white/10 text-white/60 hover:text-white transition cursor-pointer"
              title={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Slide Body */}
        <div className="p-5 sm:p-7 overflow-y-auto flex-1 text-sm custom-scrollbar">
          <AnimatePresence mode="wait">
            {/* STEP 1: WELCOME & PURPOSE */}
            {currentStep === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={SPRING_BUBBLY}
                className="space-y-5"
              >
                <div className="text-center space-y-2 py-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-400/30 text-cyan-300 text-xs font-mono font-semibold">
                    <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    {isBg ? 'Автономен Системен Мост' : 'Autonomous Local-First SysAdmin'}
                  </div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                    {isBg
                      ? 'Добре дошли в AI NetController'
                      : 'Welcome to AI NetController'}
                  </h1>
                  <p className="text-white/70 max-w-lg mx-auto text-xs sm:text-sm leading-relaxed">
                    {isBg
                      ? 'Платформа от ново поколение за управление на локална компютърна инфраструктура с изкуствен интелект, криптографска сигурност Zero-Trust и 120Hz поточно видео.'
                      : 'Next-generation local-first platform for autonomous AI system administration, zero-trust hardware control, and sub-5ms 120Hz display streaming.'}
                  </p>
                </div>

                {/* 3 Core Highlights */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-cyan-400/30 transition">
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400 mb-2.5">
                      <Lock className="w-4 h-4" />
                    </div>
                    <h3 className="font-semibold text-white text-xs mb-1">
                      {isBg ? '100% Локално (LAN)' : '100% Local-First'}
                    </h3>
                    <p className="text-[11.5px] text-white/60 leading-normal">
                      {isBg
                        ? 'Няма външни облачни сървъри. Данните и телеметрията не напускат вашата мрежа.'
                        : 'No third-party cloud telemetry. Your commands and screen data stay on your LAN.'}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-emerald-400/30 transition">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center text-emerald-400 mb-2.5">
                      <Zap className="w-4 h-4" />
                    </div>
                    <h3 className="font-semibold text-white text-xs mb-1">
                      {isBg ? '120Hz Поточен Екран' : '120Hz Display Stream'}
                    </h3>
                    <p className="text-[11.5px] text-white/60 leading-normal">
                      {isBg
                        ? 'Хардуерно-ускорен нисколатентен видео стрийминг с виртуално дистанционно управление.'
                        : 'Hardware-accelerated sub-5ms desktop mirroring with virtual trackpad & remote control.'}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-teal-400/30 transition">
                    <div className="w-8 h-8 rounded-xl bg-teal-500/10 border border-teal-400/30 flex items-center justify-center text-teal-400 mb-2.5">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <h3 className="font-semibold text-white text-xs mb-1">
                      {isBg ? 'AI Системен Администратор' : 'AI Autonomous Admin'}
                    </h3>
                    <p className="text-[11.5px] text-white/60 leading-normal">
                      {isBg
                        ? 'Команди на естествен език, автоматизирана диагностика и защита с Human-in-the-Loop.'
                        : 'Natural language sysadmin prompts, automated triage, and Human-in-the-Loop safety.'}
                    </p>
                  </div>
                </div>

                {/* Language Switcher Quick Strip */}
                <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    <span className="text-white/80 font-medium">
                      {isBg ? 'Език на интерфейса' : 'Interface Language'}:
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLanguage('bg')}
                      className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition flex items-center justify-center ${
                        isBg
                          ? 'bg-cyan-500 text-black shadow-[0_0_10px_#00F0FF]'
                          : 'bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      Български 🇧🇬
                    </button>
                    <button
                      type="button"
                      onClick={() => setLanguage('en')}
                      className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition flex items-center justify-center ${
                        !isBg
                          ? 'bg-cyan-500 text-black shadow-[0_0_10px_#00F0FF]'
                          : 'bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      English 🇬🇧
                    </button>
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
                  <span className="text-[11px] font-mono text-emerald-400 font-bold uppercase tracking-wider">
                    {isBg ? 'Сигурност от Военен Клас' : 'Zero-Trust Architecture'}
                  </span>
                  <h3 className="text-lg font-bold text-white">
                    {isBg
                      ? 'Как CST AI защитава вашите системи'
                      : 'How CST AI Protects Your Machines'}
                  </h3>
                  <p className="text-white/60 text-xs leading-relaxed">
                    {isBg
                      ? 'Никоя команда не се изпълнява без проверка. Системата комбинира криптография, статичен синтактичен анализ и човешки надзор.'
                      : 'No command executes unchecked. The system combines modern cryptography, AST syntax inspection, and operator oversight.'}
                  </p>
                </div>

                <div className="space-y-2.5">
                  {/* Security Pillar 1 */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.025] border border-white/10 flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-400/20 text-cyan-400 shrink-0 mt-0.5">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-white text-xs">
                          {isBg ? 'Ефемерен X25519 & ChaCha20-Poly1305' : 'Ephemeral X25519 & ChaCha20-Poly1305'}
                        </h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                          RFC 8439
                        </span>
                      </div>
                      <p className="text-[11.5px] text-white/60 leading-normal">
                        {isBg
                          ? 'Всяка WebSocket сесия генерира нов еднократен симетричен ключ. Защита срещу Replay атаки чрез 128-битов плъзгащ се битов прозорец (RFC 6479).'
                          : 'Every session establishes fresh ephemeral keys. Replay protection is enforced via RFC 6479 128-bit sliding bitmap windows.'}
                      </p>
                    </div>
                  </div>

                  {/* Security Pillar 2 */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.025] border border-white/10 flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-400/20 text-amber-400 shrink-0 mt-0.5">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-white text-xs">
                          {isBg ? 'Human-in-the-Loop (HITL) Портал' : 'Human-in-the-Loop (HITL) Gate'}
                        </h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                          Safety
                        </span>
                      </div>
                      <p className="text-[11.5px] text-white/60 leading-normal">
                        {isBg
                          ? 'Критични команди (рестарт, форматиране, изтриване на файлове) изискват задържане на бутон или биометрично потвърждение.'
                          : 'Destructive operations (reboot, format, file purge) require mandatory operator hold-to-confirm or biometric approval.'}
                      </p>
                    </div>
                  </div>

                  {/* Security Pillar 3 */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.025] border border-white/10 flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-400/20 text-teal-400 shrink-0 mt-0.5">
                      <TerminalSquare className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-white text-xs">
                          {isBg ? 'AST Командна Защитна Стена' : 'AST Command Firewall'}
                        </h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-500/20 text-teal-300">
                          De-Obfuscation
                        </span>
                      </div>
                      <p className="text-[11.5px] text-white/60 leading-normal">
                        {isBg
                          ? 'Автоматично разпознава опити за маскиране на шел команди (символи ^, `, променливи на средата) и блокира зловредни скриптове преди изпълнение.'
                          : 'Resolves shell obfuscation tricks (caret ^, backtick `, env variable slices) and neutralizes fork-bombs and raw overwrites pre-flight.'}
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
                  <span className="text-[11px] font-mono text-cyan-400 font-bold uppercase tracking-wider">
                    {isBg ? 'Лесно Свързване' : 'Host Pairing'}
                  </span>
                  <h3 className="text-lg font-bold text-white">
                    {isBg
                      ? 'Как да свържете вашия компютър'
                      : 'How to Connect Your Computer'}
                  </h3>
                  <p className="text-white/60 text-xs leading-relaxed">
                    {isBg
                      ? 'Стартирайте лекия фонов агент на вашата машина с 1 клик, за да получите пълен достъп през конзолата.'
                      : 'Launch the lightweight background agent on your machine in 1 click to enable full autonomous control.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Option A: Windows PC */}
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-cyan-400/30 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400">
                        <Monitor className="w-5 h-5" />
                      </div>
                      <h4 className="font-semibold text-white text-xs">
                        {isBg ? 'Компютър (Windows / Linux)' : 'PC (Windows / Linux)'}
                      </h4>
                      <p className="text-[11.5px] text-white/60 leading-normal">
                        {isBg
                          ? 'Стартирайте START_HERE_WINDOWS.bat или cst_host_daemon.exe. Демонът се стартира автоматично на порт 8765 с mDNS.'
                          : 'Run START_HERE_WINDOWS.bat or cst_host_daemon.exe. The daemon listens on port 8765 with zero-config mDNS.'}
                      </p>
                    </div>

                    <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-cyan-300">
                      <span>Port 8765</span>
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Check className="w-3.5 h-3.5" /> mDNS Ready
                      </span>
                    </div>
                  </div>

                  {/* Option B: Mobile / Tablet */}
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-emerald-400/30 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <h4 className="font-semibold text-white text-xs">
                        {isBg ? 'Мобилно Устройство / PWA' : 'Mobile / Phone PWA'}
                      </h4>
                      <p className="text-[11.5px] text-white/60 leading-normal">
                        {isBg
                          ? 'Сканирайте QR кода от бутона "Бърз Старт" с камерата на телефона за автоматично сдвояване без ръчно писане.'
                          : 'Scan the QR code from "Quick Setup" with your phone camera for zero-typing instantaneous pairing.'}
                      </p>
                    </div>

                    <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-emerald-300">
                      <span>PWA / Android</span>
                      <span className="flex items-center gap-1 text-cyan-400">
                        <QrCode className="w-3.5 h-3.5" /> QR Scan
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick WebSocket URI reminder */}
                <div className="p-3 rounded-2xl bg-[#040814] border border-white/10 flex items-center justify-between font-mono text-xs text-white/80">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Wifi className="w-4 h-4" />
                    <span>ws://localhost:8765</span>
                  </div>
                  <span className="text-[11px] text-white/50">
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
                  <span className="text-[11px] font-mono text-teal-400 font-bold uppercase tracking-wider">
                    {isBg ? 'Възможности на Системата' : 'Core Capabilities'}
                  </span>
                  <h3 className="text-lg font-bold text-white">
                    {isBg
                      ? 'Всичко, от което се нуждаете в един екран'
                      : 'Everything You Need in One Unified Console'}
                  </h3>
                  <p className="text-white/60 text-xs leading-relaxed">
                    {isBg
                      ? 'Преминете през 4-те основни режима на управление чрез долната плаваща навигационна лента или клавиши [1]-[4].'
                      : 'Cycle between the 4 main management tabs using the bottom floating pill or keyboard numbers [1]-[4].'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/10 flex items-start gap-2.5">
                    <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 shrink-0">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-xs">
                        {isBg ? 'Флот & Топология [1]' : 'Fleet & Topology [1]'}
                      </h4>
                      <p className="text-[11px] text-white/60">
                        {isBg
                          ? 'Следете RTT трептене (RFC 3550), RAM, CPU и визуализирайте мрежата в интерактивна D3 графика.'
                          : 'Monitor real-time RTT jitter (RFC 3550), RAM/CPU, and interactive D3 network graphs.'}
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/10 flex items-start gap-2.5">
                    <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400 shrink-0">
                      <TerminalSquare className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-xs">
                        {isBg ? 'Команден Терминал [2]' : 'Command Terminal [2]'}
                      </h4>
                      <p className="text-[11px] text-white/60">
                        {isBg
                          ? 'Изпълнявайте отдалечени команди на PowerShell/Bash с непрекъснат поточно изведен резултат.'
                          : 'Execute remote PowerShell/Bash commands with live stream stdout/stderr.'}
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/10 flex items-start gap-2.5">
                    <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-xs">
                        {isBg ? 'AI Асистент & Чат [3]' : 'AI Copilot & Chat [3]'}
                      </h4>
                      <p className="text-[11px] text-white/60">
                        {isBg
                          ? 'Задавайте въпроси и управлявайте машините на естествен език чрез Gemini или локален DeepSeek.'
                          : 'Ask questions and orchestrate hosts in plain English or Bulgarian using Gemini or DeepSeek.'}
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/10 flex items-start gap-2.5">
                    <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-xs">
                        {isBg ? 'Wake-on-LAN & Захранване' : 'Wake-on-LAN & Power'}
                      </h4>
                      <p className="text-[11px] text-white/60">
                        {isBg
                          ? 'Събуждайте спящи хостове, планирайте разписания и изчислявайте икономията на електроенергия.'
                          : 'Wake sleeping PCs with IEEE 802.3 magic packets, configure weekly schedules & save power.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Omnibar Shortcut Tip */}
                <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-cyan-300">
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>
                      {isBg
                        ? 'Бързо меню: Натиснете [Ctrl + K] или [/] навсякъде'
                        : 'Quick Omnibar: Press [Ctrl + K] or [/] anytime'}
                    </span>
                  </div>
                  <span className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-cyan-400/20 text-cyan-200">
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
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 mx-auto shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    {isBg ? 'Готови сте за работа!' : 'You Are All Set!'}
                  </h3>
                  <p className="text-white/60 text-xs max-w-md mx-auto">
                    {isBg
                      ? 'Всички основни компоненти са настроени. Изберете предпочитан AI модел и стартирайте.'
                      : 'All foundational components are active. Select your preferred AI model and dive right in.'}
                  </p>
                </div>

                {/* AI Model Preference Selection */}
                <div className="space-y-2">
                  <label className="text-[11px] font-mono font-semibold text-white/70 uppercase">
                    {isBg ? 'Предпочитан AI Модел' : 'Default AI Model'}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedModel('gemini-3.8-flash')}
                      className={`p-3 rounded-2xl text-left border transition cursor-pointer flex items-start gap-2.5 ${
                        selectedModel === 'gemini-3.8-flash'
                          ? 'bg-cyan-500/15 border-cyan-400/60 shadow-[0_0_15px_rgba(0,240,255,0.15)]'
                          : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                      }`}
                    >
                      <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-xs text-white">Gemini 3.8 Flash</div>
                        <div className="text-[10.5px] text-white/50">
                          {isBg ? 'Препоръчителен • Бърз & Точен' : 'Recommended • Fast & Accurate'}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedModel('deepseek-r1:latest')}
                      className={`p-3 rounded-2xl text-left border transition cursor-pointer flex items-start gap-2.5 ${
                        selectedModel === 'deepseek-r1:latest'
                          ? 'bg-teal-500/15 border-teal-400/60 shadow-[0_0_15px_rgba(20,184,166,0.15)]'
                          : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                      }`}
                    >
                      <Cpu className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-xs text-white">DeepSeek-R1 (Local)</div>
                        <div className="text-[10.5px] text-white/50">
                          {isBg ? '100% Офлайн през Ollama' : '100% Offline via Ollama'}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Checkbox: Don't show again */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="dontShowAgain"
                    checked={dontShowAgain}
                    onChange={(e) => setDontShowAgain(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-0 focus:outline-none cursor-pointer"
                  />
                  <label htmlFor="dontShowAgain" className="text-xs text-white/70 cursor-pointer">
                    {isBg
                      ? 'Запомни завършването (не показвай автоматично при следващ старт)'
                      : 'Remember completion (do not auto-popup on next startup)'}
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Navigation Bar */}
        <div className="px-3.5 sm:px-5 py-3.5 sm:py-4 border-t border-white/10 bg-white/[0.02] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="shrink-0">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {isBg ? 'Назад' : 'Back'}
              </button>
            )}
          </div>

          {/* Dots Indicator */}
          <div className="hidden xs:flex items-center gap-1">
            {Array.from({ length: TOTAL_STEPS }).map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  setCurrentStep(idx);
                }}
                className="min-w-[32px] min-h-[32px] flex items-center justify-center cursor-pointer"
                title={`Step ${idx + 1}`}
              >
                <span
                  className={`h-2 rounded-full transition-all ${
                    idx === currentStep
                      ? 'w-6 bg-cyan-400 shadow-[0_0_8px_#00F0FF]'
                      : 'w-2 bg-white/20 hover:bg-white/40'
                  }`}
                />
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
            {currentStep < TOTAL_STEPS - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="min-h-[42px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 hover:from-cyan-400 hover:to-teal-300 text-black font-bold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer shadow-[0_0_15px_rgba(0,240,255,0.25)]"
              >
                <span>{isBg ? 'Напред' : 'Next'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => handleFinish(true)}
                  className="min-h-[42px] px-3.5 sm:px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-cyan-300 font-semibold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer border border-cyan-400/30 whitespace-nowrap"
                  title={isBg ? 'Свържи реален PC демон сега' : 'Pair Live PC Daemon Now'}
                >
                  <QrCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{isBg ? 'Сдвояване' : 'Pair Host'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFinish(false)}
                  className="min-h-[42px] px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-black font-bold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.3)] whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 fill-black shrink-0" />
                  <span>{isBg ? 'Към Конзолата' : 'Enter Console'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
