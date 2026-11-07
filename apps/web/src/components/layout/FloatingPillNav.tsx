import React from 'react';
import { motion } from 'motion/react';
import { Cpu, TerminalSquare, WandSparkles, SlidersHorizontal, Radio } from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';

export type NavTab = 'fleet' | 'terminal' | 'chat' | 'settings';

interface FloatingPillNavProps {
  activeTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
  isConnected: boolean;
  latency: number | null;
  onOpenNetworkConfig?: () => void;
}

const FloatingPillNavComponent: React.FC<FloatingPillNavProps> = ({
  activeTab,
  onChangeTab,
  isConnected,
  latency,
  onOpenNetworkConfig,
}) => {
  const { t } = useTranslation();

  const tabs = [
    {
      id: 'fleet' as NavTab,
      label: t('nav_devices'),
      icon: Cpu,
      shortcut: '1',
    },
    {
      id: 'terminal' as NavTab,
      label: t('nav_console'),
      icon: TerminalSquare,
      shortcut: '2',
    },
    {
      id: 'chat' as NavTab,
      label: t('nav_gemini_ai'),
      icon: WandSparkles,
      shortcut: '3',
    },
    {
      id: 'settings' as NavTab,
      label: t('nav_settings'),
      icon: SlidersHorizontal,
      shortcut: '4',
    },
  ];

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 px-2.5 sm:px-4 pb-[calc(env(safe-area-inset-bottom,6px)+0.4rem)] pt-1 select-none pointer-events-none">
      <nav
        aria-label="Primary Navigation"
        className="landscape-compact-nav pointer-events-auto mx-auto max-w-xl glass-liquid-elevated rounded-[22px] h-[60px] sm:h-[64px] px-1.5 py-1.5 flex items-center gap-1.5"
      >
        {/* 4 Equal-Width Liquid Glass Navigation Destinations */}
        <div className="grid grid-cols-4 flex-1 h-full gap-1 min-w-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (activeTab !== tab.id) {
                    onChangeTab(tab.id);
                  }
                }}
                className="relative flex flex-col items-center justify-center h-full rounded-2xl transition-colors cursor-pointer min-w-0 px-1 group active:scale-95"
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNavPill"
                    className="absolute inset-0.5 rounded-2xl bg-gradient-to-b from-cyan-400/28 via-cyan-500/16 to-cyan-600/10 border border-cyan-300/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_16px_var(--theme-accent-glow)] pointer-events-none"
                    transition={SPRING_BUBBLY}
                  />
                )}

                <motion.div
                  initial={false}
                  animate={isActive ? { y: -1, scale: 1.05 } : { y: 0, scale: 1 }}
                  transition={SPRING_POP}
                  className="relative z-10 flex flex-col items-center justify-center gap-0.5 min-w-0 w-full"
                >
                  <Icon
                    className={`w-[18px] h-[18px] transition-colors duration-150 shrink-0 ${
                      isActive
                        ? 'text-cyan-200 stroke-[2.3] drop-shadow-[0_0_8px_var(--theme-accent-glow)]'
                        : 'text-slate-300/75 group-hover:text-white stroke-[1.9]'
                    }`}
                  />
                  <span
                    className={`font-display text-[10px] xs:text-[10.5px] sm:text-[11px] font-semibold tracking-tight truncate max-w-full leading-tight transition-colors duration-150 ${
                      isActive ? 'text-white' : 'text-slate-300/75 group-hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </span>
                </motion.div>
              </button>
            );
          })}
        </div>

        {/* Refractive Connection / Endpoint Pill */}
        {onOpenNetworkConfig && (
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              onOpenNetworkConfig();
            }}
            className={`shrink-0 h-[44px] px-2.5 sm:px-3 rounded-2xl border flex items-center gap-1.5 text-[11px] font-mono tabular-nums transition active:scale-95 ${
              isConnected
                ? 'bg-gradient-to-b from-emerald-400/20 to-emerald-500/10 border-emerald-400/40 text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:from-emerald-400/30'
                : 'bg-white/[0.06] border-white/15 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-cyan-400/40'
            }`}
            title={
              isConnected
                ? `Connected (${latency !== null ? `${Math.round(latency)}ms` : 'live'})`
                : 'Configure Host Endpoint'
            }
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {isConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isConnected ? 'bg-emerald-400' : 'bg-cyan-400'
                }`}
              />
            </span>
            <span className="hidden xs:inline font-semibold">
              {isConnected && latency !== null
                ? `${Math.round(latency)}ms`
                : isConnected
                ? t('nav_connected')
                : 'LAN'}
            </span>
            <Radio className="w-3.5 h-3.5 xs:hidden text-cyan-300" />
          </button>
        )}
      </nav>
    </div>
  );
};

export const FloatingPillNav = React.memo(FloatingPillNavComponent);
