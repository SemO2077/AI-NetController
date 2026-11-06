import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  Monitor,
  Terminal,
  Zap,
  X,
  TerminalSquare,
  Command,
  ChevronRight,
  Sparkles,
  Languages,
} from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { HostDevice } from '../../types';
import { DEMO_PRESET_COMMANDS } from '../../data/mockHosts';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';

interface CommandOmnibarProps {
  hosts: HostDevice[];
  selectedTarget: string;
  onSelectHost: (id: string) => void;
  onSendCommand: (cmd: any) => void;
  onSendWolDirect: (device: HostDevice) => void;
  onRescanMdns: () => void;
}

interface OmnibarSelectableItem {
  id: string;
  kind: 'host' | 'action' | 'preset' | 'query';
  title: string;
  subtitle?: string;
  isOnline?: boolean;
  badge?: string;
  icon: any;
  onTrigger: () => void;
}

export const CommandOmnibar: React.FC<CommandOmnibarProps> = ({
  hosts,
  selectedTarget,
  onSelectHost,
  onSendCommand,
  onSendWolDirect,
  onRescanMdns,
}) => {
  const isOpen = useUIStore((s) => s.isOmnibarOpen);
  const setOmnibarOpen = useUIStore((s) => s.setOmnibarOpen);
  const openModal = useUIStore((s) => s.openModal);
  const { t, language, toggleLanguage } = useTranslation();
  const isBg = language === 'bg';

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.toLowerCase().trim();
  const isActionMode = q.startsWith('>');
  const isHostMode = q.startsWith('@');
  const isAiMode = q.startsWith('/');
  const rawQuery = q.replace(/^[>@/]\s*/, '');

  const executeAction = useCallback(
    (action: () => void) => {
      triggerHapticFeedback('medium');
      action();
      setOmnibarOpen(false);
    },
    [setOmnibarOpen]
  );

  const selectableItems = useMemo<OmnibarSelectableItem[]>(() => {
    const items: OmnibarSelectableItem[] = [];

    if (!q || isHostMode) {
      const filteredHosts = hosts.filter(
        (h) =>
          h.name.toLowerCase().includes(rawQuery) ||
          h.ip.includes(rawQuery) ||
          h.mac.toLowerCase().includes(rawQuery)
      );
      filteredHosts.forEach((h) => {
        items.push({
          id: `host-${h.id}`,
          kind: 'host',
          title: h.name,
          subtitle: `${h.ip} · ${h.mac}`,
          isOnline: h.isOnline,
          badge: t('omni_console'),
          icon: Monitor,
          onTrigger: () => executeAction(() => onSelectHost(h.id)),
        });

        if (!h.isOnline && onSendWolDirect) {
          items.push({
            id: `wol-${h.id}`,
            kind: 'action',
            title: isBg ? `Събуди ${h.name} чрез WoL` : `Wake ${h.name} via WoL`,
            subtitle: `${h.mac} · Magic Packet`,
            badge: 'WOL',
            icon: Zap,
            onTrigger: () => executeAction(() => onSendWolDirect(h)),
          });
        }
      });
    }

    if (!q || isActionMode) {
      const systemActions = [
        { label: language === 'bg' ? 'Обиколка на приложението & Първи стъпки' : 'App Tour & Onboarding Walkthrough', icon: Sparkles, action: () => openModal('onboarding') },
        { label: t('omni_action_rescan'), icon: Search, action: onRescanMdns },
        { label: t('omni_action_ws'), icon: TerminalSquare, action: () => openModal('wsConfig') },
        { label: t('omni_action_wol'), icon: Zap, action: () => openModal('wol', { tab: 'schedules' }) },
        { label: t('omni_action_memory'), icon: Monitor, action: () => openModal('memory') },
        { label: t('omni_switch_lang'), icon: Languages, action: () => toggleLanguage() },
      ].filter((a) => a.label.toLowerCase().includes(rawQuery));

      systemActions.forEach((act, idx) => {
        items.push({
          id: `action-${idx}`,
          kind: 'action',
          title: act.label,
          icon: act.icon,
          onTrigger: () => executeAction(act.action),
        });
      });
    }

    if (isAiMode) {
      DEMO_PRESET_COMMANDS.filter((p) => {
        const title = isBg ? p.labelBg : p.labelEn;
        const sub = isBg ? p.promptBg : p.promptEn;
        return title.toLowerCase().includes(rawQuery) || sub.toLowerCase().includes(rawQuery);
      }).forEach((p, idx) => {
        const title = isBg ? p.labelBg : p.labelEn;
        const sub = isBg ? p.promptBg : p.promptEn;
        items.push({
          id: `preset-${idx}`,
          kind: 'preset',
          title,
          subtitle: sub,
          icon: Sparkles,
          onTrigger: () =>
            executeAction(() =>
              onSendCommand({
                target_id: selectedTarget,
                command_type: 'natural_language',
                prompt: sub,
              })
            ),
        });
      });
    }

    if (q && !isActionMode && !isHostMode && !isAiMode) {
      items.push({
        id: 'direct-query',
        kind: 'query',
        title: t('omni_send_to_host', { target: selectedTarget }),
        subtitle: `"${q}"`,
        icon: Terminal,
        onTrigger: () =>
          executeAction(() =>
            onSendCommand({
              target_id: selectedTarget,
              command_type: 'natural_language',
              prompt: q,
            })
          ),
      });
    }

    return items;
  }, [
    q,
    isHostMode,
    isActionMode,
    isAiMode,
    rawQuery,
    hosts,
    t,
    isBg,
    executeAction,
    onSelectHost,
    onRescanMdns,
    openModal,
    toggleLanguage,
    onSendCommand,
    selectedTarget,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard shortcut listener (CMD+K / CTRL+K / Escape / ArrowUp / ArrowDown / Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOmnibarOpen(!isOpen);
        return;
      }
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setOmnibarOpen(false);
      } else if (e.key === 'ArrowDown' && selectableItems.length > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % selectableItems.length);
      } else if (e.key === 'ArrowUp' && selectableItems.length > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + selectableItems.length) % selectableItems.length);
      } else if (e.key === 'Enter' && selectableItems[selectedIndex]) {
        e.preventDefault();
        selectableItems[selectedIndex].onTrigger();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setOmnibarOpen, selectableItems, selectedIndex]);

  // Focus input automatically when opened and prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = '';
      };
    } else {
      setQuery('');
      setSelectedIndex(0);
      document.body.style.overflow = '';
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-start select-none">
          {/* Tier 3 Dimming Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOmnibarOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-md transform-gpu"
          />

          {/* Tier 3 Spotlight Surface */}
          <motion.div
            initial={{ opacity: 0, y: -28, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.96, transition: { duration: 0.13 } }}
            transition={{ type: 'spring', stiffness: 480, damping: 24, mass: 0.6 }}
            className="
              relative z-10 w-full max-w-2xl mx-auto
              bg-[#091020]/95 backdrop-blur-3xl
              border border-white/15 border-t-white/25
              shadow-[0_24px_64px_rgba(0,0,0,0.85)]
              transform-gpu
              flex flex-col pt-[calc(env(safe-area-inset-top,12px)+0.5rem)]
              sm:rounded-b-[2rem]
            "
          >
            {/* Top Drag Indicator */}
            <div className="w-full flex justify-center pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Search Input Bar */}
            <div className="flex items-center px-4 py-2.5">
              <Command className="w-5 h-5 text-cyan-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('omni_placeholder')}
                className="flex-1 bg-transparent border-none outline-none text-white text-base px-3 placeholder-white/40 font-sans"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-white/50 hover:text-white transition cursor-pointer"
                  aria-label={t('omni_clear')}
                >
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                    <X className="w-3.5 h-3.5" />
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setOmnibarOpen(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-white/50 hover:text-white transition cursor-pointer"
                  aria-label="Close search"
                >
                  <kbd className="inline-block px-2 py-0.5 rounded bg-white/[0.06] text-[10px] font-mono text-white/50 border border-white/[0.08]">
                    ESC
                  </kbd>
                </button>
              )}
            </div>

            {/* Context Mode Badges & Keyboard Navigation Hint */}
            <div className="flex items-center justify-between px-4 pb-2 text-[11px] text-white/50 border-b border-white/[0.08]">
              <div className="flex items-center space-x-1.5">
                <span
                  className={`px-2 py-0.5 rounded-full transition ${
                    isActionMode
                      ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-400/30'
                      : 'bg-white/5'
                  }`}
                >
                  {t('omni_actions')}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full transition ${
                    isHostMode
                      ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-400/30'
                      : 'bg-white/5'
                  }`}
                >
                  {t('omni_hosts')}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full transition ${
                    isAiMode
                      ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-400/30'
                      : 'bg-white/5'
                  }`}
                >
                  {t('omni_ai')}
                </span>
              </div>
              <span className="hidden sm:inline font-mono text-[10px] text-white/35">
                {isBg ? '↑↓ Навигация • ↵ Избор' : '↑↓ Navigate • ↵ Select'}
              </span>
            </div>

            {/* Results List */}
            <div className="max-h-[58dvh] overflow-y-auto p-2 scrollbar-none space-y-1">
              {selectableItems.map((item, idx) => {
                const Icon = item.icon;
                const isHighlighted = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={item.onTrigger}
                    className={`w-full min-h-[52px] flex items-center justify-between p-3 rounded-2xl transition cursor-pointer border ${
                      isHighlighted
                        ? 'bg-cyan-500/15 border-cyan-400/35 shadow-[0_0_16px_rgba(56,189,248,0.12)]'
                        : 'border-transparent hover:bg-white/[0.06] hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                          item.kind === 'host'
                            ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                            : item.kind === 'action'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col text-left min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-semibold text-white truncate">
                            {item.title}
                          </span>
                          {item.kind === 'host' && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                item.isOnline
                                  ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                                  : 'bg-slate-500'
                              }`}
                            />
                          )}
                        </div>
                        {item.subtitle && (
                          <span className="text-xs text-white/50 font-mono truncate">
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0 pl-2">
                      {item.badge && (
                        <span className="text-[10px] bg-white/5 px-2 py-1 rounded border border-white/10 text-white/60 font-mono">
                          {item.badge}
                        </span>
                      )}
                      <ChevronRight
                        className={`w-4 h-4 transition-transform ${
                          isHighlighted ? 'text-cyan-300 translate-x-0.5' : 'text-white/35'
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
