import React from 'react';
import { motion } from 'motion/react';
import { Cpu, TerminalSquare, WandSparkles, SlidersHorizontal, Radio } from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { SPRING_BUBBLY } from '../../utils/springPhysics';

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
    <div className="fixed bottom-0 inset-x-0 z-40 px-2.5 sm:px-4 pb-[calc(env(safe-area-inset-bottom,6px)+0.35rem)] pt-1 select-none pointer-events-none">
      <nav
        aria-label="Primary Navigation"
        className="landscape-compact-nav pointer-events-auto mx-auto max-w-xl glass-liquid-elevated rounded-2xl h-[58px] sm:h-[62px] px-1.5 py-1 flex items-center gap-1"
      >
        {/* 4 Equal-Width Navigation Destinations (Zero Layout Shift) */}
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
                    triggerHapticFeedback('selection');
                    onChangeTab(tab.id);
                  }
                }}
                className="relative flex flex-col items-center justify-center h-full rounded-xl transition-colors cursor-pointer min-w-0 px-1 group active:scale-95"
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNavPill"
                    className="absolute inset-0.5 rounded-xl bg-cyan-500/15 border border-cyan-400/35 pointer-events-none"
                    transition={SPRING_BUBBLY}
                  />
                )}

                <div className="relative z-10 flex flex-col items-center justify-center gap-0.5 min-w-0 w-full">
                  <Icon
                    className={`w-[18px] h-[18px] transition-colors duration-150 shrink-0 ${
                      isActive
                        ? 'text-cyan-300 stroke-[2.3]'
                        : 'text-slate-400 group-hover:text-slate-200 stroke-[1.9]'
                    }`}
                  />
                  <span
                    className={`font-display text-[10px] xs:text-[10.5px] sm:text-[11px] font-semibold tracking-tight truncate max-w-full leading-tight transition-colors duration-150 ${
                      isActive ? 'text-cyan-100' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Compact Connection / Endpoint Pill */}
        {onOpenNetworkConfig && (
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              onOpenNetworkConfig();
            }}
            className={`shrink-0 h-[42px] px-2.5 sm:px-3 rounded-xl border flex items-center gap-1.5 text-[11px] font-mono tabular-nums transition active:scale-95 ${
              isConnected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/15'
                : 'bg-slate-800/80 border-white/10 text-slate-300 hover:border-cyan-400/30'
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
