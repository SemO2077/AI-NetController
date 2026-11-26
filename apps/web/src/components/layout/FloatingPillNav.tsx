import React from 'react';
import { motion } from 'motion/react';
import { Cpu, TerminalSquare, WandSparkles, SlidersHorizontal, Radio } from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { SPRING_JELLY, SPRING_POP } from '../../utils/springPhysics';

export type NavTab = 'fleet' | 'terminal' | 'chat' | 'settings';

interface FloatingPillNavProps {
  activeTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
  isConnected: boolean;
  isReconnecting?: boolean;
  latency: number | null;
  onOpenNetworkConfig?: () => void;
}

const FloatingPillNavComponent: React.FC<FloatingPillNavProps> = ({
  activeTab,
  onChangeTab,
  isConnected,
  isReconnecting = false,
  latency,
  onOpenNetworkConfig,
}) => {
  const { t, language } = useTranslation();
  const isBg = language === 'bg';

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
    <div className="fixed bottom-0 inset-x-0 z-40 px-3 sm:px-5 pb-[calc(env(safe-area-inset-bottom,8px)+0.55rem)] pt-1.5 select-none pointer-events-none">
      <nav
        aria-label={isBg ? 'Основна навигация' : 'Primary Navigation'}
        className="landscape-compact-nav pointer-events-auto mx-auto max-w-xl glass-liquid-elevated liquid-capsule-refract rounded-full h-[64px] sm:h-[68px] px-2 py-1.5 flex items-center gap-1.5 relative overflow-hidden"
      >
        {/* Curved Top Optical Reflection Arc */}
        <div className="absolute inset-x-10 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/90 to-transparent pointer-events-none z-20 opacity-90" />

        {/* 4 Equal-Width Apple Liquid Glass Navigation Destinations */}
        <div className="grid grid-cols-4 flex-1 h-full gap-1 min-w-0 relative z-10">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <motion.button
                key={tab.id}
                type="button"
                whileHover={{ scale: isActive ? 1.02 : 1.05 }}
                whileTap={{ scale: 0.9 }}
                transition={SPRING_POP}
                onClick={() => {
                  if (activeTab !== tab.id) {
                    triggerHapticFeedback('selection');
                    onChangeTab(tab.id);
                  }
                }}
                className="relative flex flex-col items-center justify-center h-full rounded-full cursor-pointer min-w-0 px-1.5 group"
                title={`${tab.label} (${tab.shortcut})`}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNavPill"
                    className="absolute inset-0.5 rounded-full liquid-hero-btn pointer-events-none"
                    transition={SPRING_JELLY}
                  />
                )}

                <motion.div
                  initial={false}
                  animate={isActive ? { y: -1, scale: 1.08 } : { y: 0, scale: 1 }}
                  transition={SPRING_POP}
                  className={`relative z-10 flex flex-col items-center justify-center gap-0.5 min-w-0 w-full ${
                    isActive ? 'preserve-white' : ''
                  }`}
                >
                  <Icon
                    className={`w-[19px] h-[19px] transition-colors duration-150 shrink-0 ${
                      isActive
                        ? 'text-white stroke-[2.4] drop-shadow-[0_2px_8px_rgba(0,0,0,0.22)]'
                        : 'ink-secondary group-hover:ink-primary stroke-[1.95]'
                    }`}
                  />
                  <span
                    className={`font-display text-[10px] xs:text-[10.5px] sm:text-[11px] font-bold tracking-tight truncate max-w-full leading-tight transition-colors duration-150 ${
                      isActive ? 'text-white' : 'ink-secondary group-hover:ink-primary'
                    }`}
                  >
                    {tab.label}
                  </span>
                </motion.div>
              </motion.button>
            );
          })}
        </div>

        {/* Refractive Capsule Connection / Endpoint Pill */}
        {onOpenNetworkConfig && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.06, y: -1 }}
            whileTap={{ scale: 0.9 }}
            transition={SPRING_POP}
            onClick={() => {
              triggerHapticFeedback('light');
              onOpenNetworkConfig();
            }}
            className={`relative z-10 shrink-0 h-[46px] px-3 sm:px-3.5 rounded-full border flex items-center gap-1.5 text-[11px] font-mono tabular-nums transition cursor-pointer ${
              isConnected
                ? 'squircle-emerald preserve-white border-white/50'
                : isReconnecting
                ? 'squircle-amber preserve-white border-white/50'
                : 'liquid-control-pill'
            }`}
            title={
              isConnected
                ? isBg
                  ? `Свързан (${latency !== null ? `${Math.round(latency)}ms` : 'на живо'})`
                  : `Connected (${latency !== null ? `${Math.round(latency)}ms` : 'live'})`
                : isReconnecting
                ? isBg
                  ? 'Повторно свързване...'
                  : 'Reconnecting to Host Agent...'
                : isBg
                ? 'Настрой адрес на хоста'
                : 'Configure Host Endpoint'
            }
            aria-label={
              isConnected
                ? isBg
                  ? 'Свързан с хост агента'
                  : 'Connected to host agent'
                : isReconnecting
                ? isBg
                  ? 'Повторно свързване'
                  : 'Reconnecting'
                : isBg
                ? 'Настрой мрежовата връзка'
                : 'Configure host endpoint'
            }
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {(isConnected || isReconnecting) && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-80" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isConnected || isReconnecting ? 'bg-white' : 'bg-cyan-400'
                }`}
              />
            </span>
            <span className="hidden xs:inline font-bold">
              {isConnected && latency !== null
                ? `${Math.round(latency)}ms`
                : isConnected
                ? t('nav_connected')
                : isReconnecting
                ? '...'
                : 'LAN'}
            </span>
            <Radio className="w-3.5 h-3.5 xs:hidden" />
          </motion.button>
        )}
      </nav>
    </div>
  );
};

export const FloatingPillNav = React.memo(FloatingPillNavComponent);
