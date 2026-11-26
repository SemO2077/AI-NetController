import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Keyboard, X, Command, Sparkles } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';
import { SPRING_BUBBLY } from '../../utils/springPhysics';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { language } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const shortcutGroups = [
    {
      title: language === 'bg' ? 'Глобална навигация' : 'Global Navigation',
      items: [
        { key: '1', label: language === 'bg' ? 'Флот Табло (Fleet Dashboard)' : 'Fleet Dashboard' },
        { key: '2', label: language === 'bg' ? 'Многохостова Конзола (Terminal)' : 'Multi-Host Command Terminal' },
        { key: '3', label: language === 'bg' ? 'Агентен AI Копилот (Gemini AI)' : 'Agentic AI Copilot' },
        { key: '4', label: language === 'bg' ? 'Системни Настройки & Енергия' : 'System Settings & WoL Energy' },
      ],
    },
    {
      title: language === 'bg' ? 'Търсене & Откриване' : 'Search & Discovery',
      items: [
        { key: '⌘K / /', label: language === 'bg' ? 'Бързо Търсене / Omnibar' : 'Focus Fleet Search / Omnibar' },
        { key: 'R', label: language === 'bg' ? 'Моментно mDNS Сканиране' : 'Instant mDNS Discovery & Telemetry Refresh' },
        { key: '?', label: language === 'bg' ? 'Преглед на Бързи Клавиши' : 'Toggle Keyboard Shortcuts Sheet' },
      ],
    },
    {
      title: language === 'bg' ? 'Дистанционен Десктоп' : 'Remote Desktop & Stream',
      items: [
        { key: 'F', label: language === 'bg' ? 'Цял екран (Fullscreen)' : 'Toggle Fullscreen Stream View' },
        { key: 'P', label: language === 'bg' ? 'Пауза / Продължи поток' : 'Pause / Resume Live Stream' },
        { key: '+ / - / 0', label: language === 'bg' ? 'Приближаване / 1x нулиране' : 'Zoom Stream In / Out / Reset' },
        { key: 'Q', label: language === 'bg' ? 'Бързи действия (лента)' : 'Toggle Quick Actions Strip' },
        {
          key: 'I',
          label:
            language === 'bg'
              ? 'Фокус AI / Клавиатура (Shift+I превкл.)'
              : 'Focus AI / Keyboard Input (Shift+I Toggle)',
        },
        { key: 'Esc', label: language === 'bg' ? 'Затвори текущ прозорец' : 'Close Active Modal / Exit Stream' },
      ],
    },
    {
      title: language === 'bg' ? 'Терминал & Команди' : 'Command Terminal',
      items: [
        { key: '↑ / ↓', label: language === 'bg' ? 'Навигация в история на командите' : 'Cycle Command History (keeps draft)' },
        { key: 'Enter', label: language === 'bg' ? 'Изпълни команда' : 'Execute Command' },
        { key: 'Ctrl + L', label: language === 'bg' ? 'Изчисти конзолата' : 'Clear Console Output' },
        { key: 'Esc', label: language === 'bg' ? 'Изчисти полето / Затвори история' : 'Clear Prompt / Close History' },
      ],
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={language === 'bg' ? 'Бързи клавиши' : 'Keyboard Shortcuts'}
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              triggerHapticFeedback('light');
              onClose();
            }}
            style={{ backgroundColor: 'var(--backdrop-scrim)' }}
            className="absolute inset-0 backdrop-blur-xl modal-backdrop-scrim"
          />

          {/* Liquid Glass Modal Window */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={SPRING_BUBBLY}
            className="relative w-full max-w-xl max-h-[90dvh] flex flex-col rounded-[2rem] glass-liquid-modal overflow-hidden z-10 transform-gpu p-5 sm:p-6"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.08] mb-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 squircle-badge squircle-hero flex items-center justify-center shrink-0">
                  <Keyboard className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-display font-extrabold ink-primary flex items-center gap-2 flex-wrap">
                    <span>{language === 'bg' ? 'Бързи клавиши' : 'Keyboard Shortcuts'}</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/14 text-cyan-400 border border-cyan-400/35">
                      v0.90.0
                    </span>
                  </h3>
                  <p className="text-xs ink-muted truncate">
                    {language === 'bg'
                      ? 'Бързо управление на системата без докосване на мишката'
                      : 'High-speed keyboard-driven fleet orchestration'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  onClose();
                }}
                className="w-9 h-9 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]/60 focus-visible:outline-none"
                aria-label={language === 'bg' ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Shortcut Categories Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 flex-1 min-h-0 overflow-y-auto bouncy-scroll pr-1">
              {shortcutGroups.map((group, gIdx) => (
                <div
                  key={gIdx}
                  className="rounded-[22px] glass-liquid-subtle p-4 flex flex-col gap-2.5"
                >
                  <div className="text-[11px] font-display font-bold text-cyan-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{group.title}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {group.items.map((item, iIdx) => (
                      <div key={iIdx} className="flex items-center justify-between gap-2 text-xs">
                        <span className="ink-secondary font-medium leading-snug">{item.label}</span>
                        <kbd className="px-2.5 py-0.5 rounded-full liquid-control-pill text-[11px] font-mono text-cyan-400 font-bold shrink-0">
                          {item.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer Note */}
            <div className="mt-4 pt-3.5 border-t border-white/[0.08] flex items-center justify-between text-[11px] ink-muted shrink-0">
              <span>{language === 'bg' ? 'Натиснете Esc за изход' : 'Press Esc to dismiss'}</span>
              <div className="flex items-center gap-1 font-mono text-cyan-400 font-semibold">
                <Command className="w-3 h-3" />
                <span>AI-NET/3.0</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
