import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon, Palette, Check } from 'lucide-react';
import { useUIStore, AccentColorPreset } from '../../store/uiStore';
import { triggerHapticFeedback } from '../../services/hapticService';
import { SPRING_POP, POPOVER_BUBBLE_VARIANTS } from '../../utils/springPhysics';

interface ThemeQuickControlsProps {
  showAccentDots?: boolean;
  compact?: boolean;
  className?: string;
}

const ACCENT_DOTS: Array<{
  id: AccentColorPreset;
  label: string;
  labelBg: string;
  gradient: string;
}> = [
  {
    id: 'violet',
    label: 'Iridescent Violet',
    labelBg: 'Иридесцентно Виолетово',
    gradient: 'from-[#8b5cf6] via-[#a855f7] to-[#ec4899]',
  },
  {
    id: 'cobalt',
    label: 'Electric Azure',
    labelBg: 'Електриково Синьо',
    gradient: 'from-[#3b82f6] via-[#0ea5e9] to-[#6366f1]',
  },
  {
    id: 'cyan',
    label: 'Aqua Cyan',
    labelBg: 'Аква Циан',
    gradient: 'from-[#06b6d4] via-[#22d3ee] to-[#38bdf8]',
  },
  {
    id: 'emerald',
    label: 'Bio Mint',
    labelBg: 'Био Мента',
    gradient: 'from-[#10b981] via-[#34d399] to-[#2dd4bf]',
  },
  {
    id: 'rose',
    label: 'Coral Rose',
    labelBg: 'Коралова Роза',
    gradient: 'from-[#f43f5e] via-[#fb7185] to-[#fb923c]',
  },
  {
    id: 'amber',
    label: 'Solar Amber',
    labelBg: 'Соларен Кехлибар',
    gradient: 'from-[#f59e0b] via-[#fbbf24] to-[#f97316]',
  },
];

export const ThemeQuickControls: React.FC<ThemeQuickControlsProps> = ({
  showAccentDots = true,
  compact = false,
  className = '',
}) => {
  const themeMode = useUIStore((s) => s.themeMode);
  const toggleThemeMode = useUIStore((s) => s.toggleThemeMode);
  const accentColor = useUIStore((s) => s.accentColor);
  const setAccentColor = useUIStore((s) => s.setAccentColor);
  const language = useUIStore((s) => s.language);
  const [accentMenuOpen, setAccentMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 64, right: 16 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const updateMenuPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 120, Math.round(rect.bottom + 8));
    const right = Math.max(12, Math.round(window.innerWidth - rect.right));
    setMenuPos({ top, right });
  }, []);

  useEffect(() => {
    if (!accentMenuOpen) return;
    updateMenuPosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccentMenuOpen(false);
    };
    const onResizeOrScroll = () => updateMenuPosition();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll, true);
    };
  }, [accentMenuOpen, updateMenuPosition]);

  const isLight = themeMode === 'light';
  const isBg = language === 'bg';
  const activeDot = ACCENT_DOTS.find((d) => d.id === accentColor) || ACCENT_DOTS[0];

  return (
    <div className={`flex items-center gap-1.5 relative ${className}`}>
      {/* 1-Tap Daylight / Vibrant Dark Liquid Pill */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.05, y: -1 }}
        whileTap={{ scale: 0.9 }}
        transition={SPRING_POP}
        onClick={() => {
          triggerHapticFeedback('selection');
          toggleThemeMode();
        }}
        className={`h-9 ${
          compact ? 'w-9 px-0 justify-center' : 'px-3 gap-1.5'
        } rounded-full liquid-control-pill flex items-center text-xs font-semibold cursor-pointer shrink-0`}
        title={
          isLight
            ? isBg
              ? 'Превключи към Тъмен Liquid Glass'
              : 'Switch to Vibrant Dark Glass'
            : isBg
            ? 'Превключи към Светъл Daylight Glass'
            : 'Switch to Bright Daylight Glass'
        }
        aria-label={isLight ? 'Switch to Vibrant Dark' : 'Switch to Bright Daylight'}
      >
        <motion.span
          key={isLight ? 'sun' : 'moon'}
          initial={{ rotate: isLight ? -45 : 45, scale: 0.72, opacity: 0.4 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={SPRING_POP}
          className={`flex items-center justify-center ${
            isLight ? 'text-amber-600' : 'text-violet-200'
          }`}
        >
          {isLight ? (
            <Sun className="w-4 h-4 fill-amber-400/50 stroke-[2.4]" />
          ) : (
            <Moon className="w-4 h-4 fill-violet-300/35 stroke-[2.3]" />
          )}
        </motion.span>
        {!compact && (
          <span className="hidden md:inline font-display tracking-tight">
            {isLight
              ? isBg
                ? 'Светъл'
                : 'Daylight'
              : isBg
              ? 'Тъмен'
              : 'Dark'}
          </span>
        )}
      </motion.button>

      {/* Compact Quick Accent Switcher Popover (Portaled above all glass layers) */}
      {showAccentDots && (
        <div className="relative">
          <motion.button
            ref={triggerRef}
            type="button"
            whileHover={{ scale: 1.06, y: -1 }}
            whileTap={{ scale: 0.9 }}
            transition={SPRING_POP}
            onClick={() => {
              triggerHapticFeedback('light');
              if (!accentMenuOpen) updateMenuPosition();
              setAccentMenuOpen((v) => !v);
            }}
            className="h-9 w-9 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer shrink-0"
            title={isBg ? 'Бърз избор на цвят' : 'Quick Hero Accent'}
            aria-label={isBg ? 'Бърз избор на цвят' : 'Quick Hero Accent'}
            aria-expanded={accentMenuOpen}
          >
            <span
              className={`w-4 h-4 rounded-full bg-gradient-to-br ${activeDot.gradient} ring-2 ring-white/80 shadow-sm`}
            />
          </motion.button>

          {typeof document !== 'undefined' &&
            createPortal(
              <AnimatePresence>
                {accentMenuOpen && (
                  <div key="accent-menu-portal">
                    <div
                      className="fixed inset-0"
                      style={{ zIndex: 998 }}
                      onClick={() => setAccentMenuOpen(false)}
                    />
                    <motion.div
                      variants={POPOVER_BUBBLE_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      style={{ top: menuPos.top, right: menuPos.right, zIndex: 999 }}
                      className="fixed p-2.5 rounded-3xl dropdown-menu-surface min-w-[220px]"
                    >
                      <div className="flex items-center gap-1.5 px-1.5 pb-2 mb-1.5 border-b border-current/10 text-[10px] font-semibold uppercase tracking-wider ink-secondary">
                        <Palette className="w-3 h-3" />
                        <span>{isBg ? 'Водещ Акцент' : 'Hero Accent'}</span>
                      </div>
                      <div className="grid grid-cols-6 gap-1.5 px-1 py-1">
                        {ACCENT_DOTS.map((dot) => {
                          const active = dot.id === accentColor;
                          return (
                            <motion.button
                              key={dot.id}
                              type="button"
                              whileHover={{ scale: 1.18 }}
                              whileTap={{ scale: 0.88 }}
                              transition={SPRING_POP}
                              onClick={() => {
                                triggerHapticFeedback('selection');
                                setAccentColor(dot.id);
                                setAccentMenuOpen(false);
                              }}
                              title={isBg ? dot.labelBg : dot.label}
                              aria-label={isBg ? dot.labelBg : dot.label}
                              className={`w-7 h-7 rounded-full bg-gradient-to-br ${dot.gradient} flex items-center justify-center cursor-pointer shadow-md transition ${
                                active
                                  ? 'ring-2 ring-offset-2 ring-offset-transparent ring-white scale-110'
                                  : 'opacity-85 hover:opacity-100'
                              }`}
                            >
                              {active && (
                                <Check className="w-3.5 h-3.5 text-white stroke-[3] drop-shadow" />
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>,
              document.body
            )}
        </div>
      )}
    </div>
  );
};
