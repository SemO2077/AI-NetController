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
import { QUICK_ACTIONS } from '../../constants/commandPresets';
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
      QUICK_ACTIONS.filter((p) => {
        return (
          p.label.toLowerCase().includes(rawQuery) ||
          p.command.toLowerCase().includes(rawQuery) ||
          p.description.toLowerCase().includes(rawQuery)
        );
      }).forEach((p, idx) => {
        const isAiPrompt = p.iconType === 'ai' || p.id === 'ai-diag';
        items.push({
          id: `preset-${idx}`,
          kind: 'preset',
          title: p.label,
          subtitle: `${p.command} · ${p.description}`,
          icon: Sparkles,
          onTrigger: () =>
            executeAction(() =>
              onSendCommand({
                target_id: selectedTarget,
                command_type: isAiPrompt ? 'natural_language' : 'system_command',
                prompt: p.command,
              })
            ),
        });
      });
    }

    if (q && !isActionMode && !isHostMode && !isAiMode) {
      const looksLikeShell =
        /^(?:ipconfig|ifconfig|systeminfo|whoami|hostname|dir|ls|pwd|uname|uptime|ps|tasklist|netstat|ss|df|free|ping|tracert|traceroute|winget|apt|systemctl|loginctl)\b/i.test(
          q
        );
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
              command_type: looksLikeShell ? 'system_command' : 'natural_language',
              prompt: query.trim(),
            })
          ),
      });
    }

    return items;
  }, [
    q,
    query,
    isHostMode,
    isActionMode,
    isAiMode,
    rawQuery,
    hosts,
    t,
    isBg,
    language,
    executeAction,
    onSelectHost,
    onSendWolDirect,
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

  // Focus input automatically when opened and safely save/restore body scroll
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-start select-none">
          {/* Adaptive Dimming Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setOmnibarOpen(false)}
            style={{ backgroundColor: 'var(--backdrop-scrim)' }}
            className="fixed inset-0 backdrop-blur-md transform-gpu modal-backdrop-scrim"
          />

          {/* Apple Liquid Glass Spotlight Surface */}
          <motion.div
            initial={{ opacity: 0, y: -28, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.95, transition: { duration: 0.13 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 22, mass: 0.7 }}
            className="
              relative z-10 w-full max-w-2xl mx-auto
              glass-liquid-modal
              transform-gpu
              flex flex-col pt-[calc(env(safe-area-inset-top,12px)+0.5rem)]
              sm:mt-6 sm:rounded-[2rem]
            "
          >
            {/* Top Drag Indicator */}
            <div className="w-full flex justify-center pb-1">
              <div className="w-10 h-1 rounded-full bg-current opacity-20" />
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
                className="flex-1 bg-transparent border-none outline-none ink-primary text-base px-3 placeholder:opacity-50 font-sans"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center ink-muted hover:ink-primary transition cursor-pointer"
                  aria-label={t('omni_clear')}
                >
                  <div className="w-7 h-7 rounded-full liquid-control-pill flex items-center justify-center">
                    <X className="w-3.5 h-3.5" />
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setOmnibarOpen(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center ink-muted hover:ink-primary transition cursor-pointer"
                  aria-label="Close search"
                >
                  <kbd className="inline-block px-2.5 py-0.5 rounded-full liquid-control-pill text-[10px] font-mono">
                    ESC
                  </kbd>
                </button>
              )}
            </div>

            {/* Context Mode Badges & Keyboard Navigation Hint */}
            <div className="flex items-center justify-between px-4 pb-2.5 text-[11px] ink-muted border-b border-white/[0.08]">
              <div className="flex items-center gap-1.5">
                <span
                  className={`px-2.5 py-0.5 rounded-full transition ${
                    isActionMode
                      ? 'liquid-hero-btn preserve-white font-semibold'
                      : 'liquid-control-pill'
                  }`}
                >
                  {t('omni_actions')}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full transition ${
                    isHostMode
                      ? 'liquid-hero-btn preserve-white font-semibold'
                      : 'liquid-control-pill'
                  }`}
                >
                  {t('omni_hosts')}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full transition ${
                    isAiMode
                      ? 'liquid-hero-btn preserve-white font-semibold'
                      : 'liquid-control-pill'
                  }`}
                >
                  {t('omni_ai')}
                </span>
              </div>
              <span className="hidden sm:inline font-mono text-[10px] opacity-65">
                {isBg ? '↑↓ Навигация • ↵ Избор' : '↑↓ Navigate • ↵ Select'}
              </span>
            </div>

            {/* Results List */}
            <div className="max-h-[58dvh] overflow-y-auto p-2.5 scrollbar-none space-y-1">
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
                        ? 'glass-liquid-elevated border-cyan-400/45 shadow-[0_6px_18px_var(--theme-accent-glow)]'
                        : 'border-transparent hover:bg-cyan-500/8'
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 squircle-badge flex items-center justify-center shrink-0 ${
                          item.kind === 'host'
                            ? 'squircle-hero'
                            : item.kind === 'action'
                            ? 'squircle-amber'
                            : 'squircle-violet'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col text-left min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-bold ink-primary truncate">
                            {item.title}
                          </span>
                          {item.kind === 'host' && (
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                item.isOnline
                                  ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]'
                                  : 'bg-amber-400'
                              }`}
                            />
                          )}
                        </div>
                        {item.subtitle && (
                          <span className="text-xs ink-muted font-mono truncate">
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0 pl-2">
                      {item.badge && (
                        <span className="text-[10px] liquid-control-pill px-2.5 py-0.5 rounded-full font-mono font-semibold">
                          {item.badge}
                        </span>
                      )}
                      <ChevronRight
                        className={`w-4 h-4 transition-transform ${
                          isHighlighted ? 'text-cyan-400 translate-x-0.5' : 'ink-muted'
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
