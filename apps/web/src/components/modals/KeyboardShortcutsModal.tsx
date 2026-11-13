import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Keyboard, X, Command, Sparkles } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';
import { SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';

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
        { key: '↑ / ↓', label: language === 'bg' ? 'Навигация в история на командите' : 'Cycle Command History' },
        { key: 'Enter', label: language === 'bg' ? 'Изпълни команда' : 'Execute Command' },
        { key: 'Ctrl + L', label: language === 'bg' ? 'Изчисти конзолата' : 'Clear Console Output' },
      ],
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              triggerHapticFeedback('light');
              onClose();
            }}
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
          />

          {/* Modal Window */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={SPRING_BUBBLY}
            className="relative w-full max-w-xl rounded-3xl bg-[#070c18]/95 border border-white/20 border-t-white/35 shadow-[0_24px_64px_rgba(0,0,0,0.85)] overflow-hidden z-10 transform-gpu p-6"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-400/35 flex items-center justify-center text-cyan-300">
                  <Keyboard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>{language === 'bg' ? 'Бързи Клавиши' : 'Keyboard Shortcuts'}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                      v0.60.0
                    </span>
                  </h3>
                  <p className="text-xs text-white/50">
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
                className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Shortcut Categories Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto scrollbar-none pr-1">
              {shortcutGroups.map((group, gIdx) => (
                <div
                  key={gIdx}
                  className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-3.5 flex flex-col gap-2.5"
                >
                  <div className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    <span>{group.title}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {group.items.map((item, iIdx) => (
                      <div
                        key={iIdx}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-white/75 truncate">{item.label}</span>
                        <kbd className="px-2 py-0.5 rounded-lg bg-white/[0.08] border border-white/15 text-[11px] font-mono text-cyan-200 font-semibold shadow-inner shrink-0">
                          {item.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer Note */}
            <div className="mt-5 pt-3.5 border-t border-white/10 flex items-center justify-between text-[11px] text-white/40">
              <span>{language === 'bg' ? 'Натиснете Esc за изход' : 'Press Esc to dismiss'}</span>
              <div className="flex items-center gap-1 font-mono text-cyan-400/80">
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
