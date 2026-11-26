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
  Plus,
  Keyboard,
  Sun,
  Moon,
  Cpu,
} from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { HostDevice } from '../../types';
import { QUICK_ACTIONS, getLocalizedPreset } from '../../constants/commandPresets';
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
  iconBg?: string;
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
  const themeMode = useUIStore((s) => s.themeMode);
  const toggleThemeMode = useUIStore((s) => s.toggleThemeMode);
  const { t, language, toggleLanguage } = useTranslation();
  const isBg = language === 'bg';

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedHostObj = useMemo(
    () => hosts.find((h) => h.id === selectedTarget) || hosts[0] || null,
    [hosts, selectedTarget]
  );

  const q = query.toLowerCase().trim();
  const isActionMode = q.startsWith('>');
  const isHostMode = q.startsWith('@');
  const isAiMode = q.startsWith('/');
  const rawQuery = q.replace(/^[>@/]\s*/, '');

  const setModePrefix = useCallback((prefix: '>' | '@' | '/' | '') => {
    triggerHapticFeedback('selection');
    setQuery((prev) => {
      const stripped = prev.replace(/^[>@/]\s*/, '');
      if (!prefix) return stripped;
      const alreadyActive = prev.trimStart().startsWith(prefix);
      return alreadyActive ? stripped : `${prefix} ${stripped}`.trimEnd() + (stripped ? '' : ' ');
    });
    inputRef.current?.focus();
  }, []);

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
          h.mac.toLowerCase().includes(rawQuery) ||
          h.tags?.some((tag) => tag.toLowerCase().includes(rawQuery))
      );
      filteredHosts.forEach((h) => {
        items.push({
          id: `host-${h.id}`,
          kind: 'host',
          title: h.name,
          subtitle: `${h.ip} · ${h.mac || 'No MAC'}`,
          isOnline: h.isOnline,
          badge: h.isOnline ? t('omni_console') : isBg ? 'Спящ' : 'Sleeping',
          icon: Monitor,
          iconBg: h.isOnline ? 'squircle-hero' : 'squircle-slate',
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
            iconBg: 'squircle-amber',
            onTrigger: () => executeAction(() => onSendWolDirect(h)),
          });
        }
      });
    }

    if (!q || isActionMode) {
      const systemActions = [
        {
          label: t('omni_action_rescan'),
          subtitle: 'mDNS + ARP LAN Discovery',
          badge: 'R',
          icon: Search,
          iconBg: 'squircle-sky',
          action: onRescanMdns,
        },
        {
          label: isBg ? 'Добави нов компютър / хост' : 'Add Host Device',
          subtitle: isBg ? 'Ръчна регистрация IP / MAC / PIN' : 'Register LAN IP, MAC & PIN',
          icon: Plus,
          iconBg: 'squircle-emerald',
          action: () => openModal('addHost'),
        },
        {
          label: t('omni_action_ws'),
          subtitle: 'WebSocket · AEAD · PIN Pairing',
          icon: TerminalSquare,
          iconBg: 'squircle-emerald',
          action: () => openModal('wsConfig'),
        },
        {
          label: t('omni_action_wol'),
          subtitle: isBg ? 'Директно събуждане и графици' : 'Direct Wake & Recurring Schedules',
          icon: Zap,
          iconBg: 'squircle-amber',
          action: () => openModal('wol', { tab: 'schedules' }),
        },
        {
          label: isBg ? 'PC Демон Център' : 'PC Daemon Control Center',
          subtitle: isBg ? 'Клиенти, банове и защитни щитове' : 'Active peers, firewall & shields',
          icon: Cpu,
          iconBg: 'squircle-hero',
          action: () => openModal('pcDaemonGui'),
        },
        {
          label: t('omni_action_memory'),
          subtitle: isBg ? 'Постоянни и сесийни AI правила' : 'Persistent & RAM AI host rules',
          icon: Sparkles,
          iconBg: 'squircle-violet',
          action: () => openModal('memory'),
        },
        {
          label:
            themeMode === 'dark'
              ? isBg
                ? 'Превключи към Светъл режим (Daylight)'
                : 'Switch to Bright Daylight Theme'
              : isBg
              ? 'Превключи към Тъмен режим (Vibrant Dark)'
              : 'Switch to Vibrant Dark Theme',
          subtitle: isBg ? 'Облик и контраст' : 'Theme polarity',
          icon: themeMode === 'dark' ? Sun : Moon,
          iconBg: 'squircle-amber',
          action: () => toggleThemeMode(),
        },
        {
          label: t('omni_switch_lang'),
          subtitle: isBg ? 'Български ↔ English' : 'English ↔ Български',
          icon: Languages,
          iconBg: 'squircle-rose',
          action: () => toggleLanguage(),
        },
        {
          label: isBg ? 'Бързи клавиши' : 'Keyboard Shortcuts Reference',
          subtitle: isBg ? 'Клавишна навигация' : 'Hotkeys & navigation guide',
          badge: '?',
          icon: Keyboard,
          iconBg: 'squircle-sky',
          action: () => openModal('shortcuts'),
        },
        {
          label: isBg ? 'Обиколка на приложението & Първи стъпки' : 'App Tour & Onboarding Walkthrough',
          subtitle: isBg ? 'Интерактивно ръководство' : 'Interactive setup guide',
          icon: Sparkles,
          iconBg: 'squircle-violet',
          action: () => openModal('onboarding'),
        },
      ].filter(
        (a) =>
          a.label.toLowerCase().includes(rawQuery) ||
          (a.subtitle && a.subtitle.toLowerCase().includes(rawQuery))
      );

      systemActions.forEach((act, idx) => {
        items.push({
          id: `action-${idx}`,
          kind: 'action',
          title: act.label,
          subtitle: act.subtitle,
          badge: act.badge,
          icon: act.icon,
          iconBg: act.iconBg,
          onTrigger: () => executeAction(act.action),
        });
      });
    }

    if (isAiMode) {
      QUICK_ACTIONS.map((p) => ({
        raw: p,
        loc: getLocalizedPreset(p, language, selectedHostObj?.os),
      }))
        .filter(({ loc }) => {
          return (
            loc.label.toLowerCase().includes(rawQuery) ||
            loc.command.toLowerCase().includes(rawQuery) ||
            loc.description.toLowerCase().includes(rawQuery)
          );
        })
        .forEach(({ raw: p, loc }, idx) => {
          const isAiPrompt = p.iconType === 'ai' || p.id === 'ai-diag';
          items.push({
            id: `preset-${idx}`,
            kind: 'preset',
            title: loc.label,
            subtitle: `${loc.command} · ${loc.description}`,
            badge: isAiPrompt ? 'AI' : selectedHostObj?.os === 'linux' ? 'SH' : 'CMD',
            icon: isAiPrompt ? Sparkles : Terminal,
            iconBg: isAiPrompt ? 'squircle-violet' : 'squircle-sky',
            onTrigger: () =>
              executeAction(() =>
                onSendCommand({
                  target_id: selectedTarget || selectedHostObj?.id || '',
                  command_type: isAiPrompt ? 'natural_language' : 'system_command',
                  prompt: loc.command,
                })
              ),
          });
        });
    }

    if (q && !isActionMode && !isHostMode && !isAiMode) {
      const looksLikeShell =
        /^(?:ipconfig|ifconfig|systeminfo|whoami|hostname|dir|ls|pwd|uname|uptime|ps|tasklist|netstat|ss|df|free|ping|tracert|traceroute|winget|apt|systemctl|loginctl|wmic)\b/i.test(
          q
        );
      const targetLabel = selectedHostObj?.name || selectedTarget || 'Host';
      items.push({
        id: 'direct-query',
        kind: 'query',
        title: t('omni_send_to_host', { target: targetLabel }),
        subtitle: `"${query.trim()}"`,
        badge: looksLikeShell ? 'SHELL' : 'AI',
        icon: looksLikeShell ? Terminal : Sparkles,
        iconBg: looksLikeShell ? 'squircle-sky' : 'squircle-violet',
        onTrigger: () =>
          executeAction(() =>
            onSendCommand({
              target_id: selectedTarget || selectedHostObj?.id || '',
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
    selectedHostObj,
    t,
    isBg,
    language,
    themeMode,
    toggleThemeMode,
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

  useEffect(() => {
    if (!isOpen) return;
    const activeEl = itemRefs.current[selectedIndex];
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, isOpen]);

  // Keyboard shortcut listener (CMD+K / CTRL+K / Escape / ArrowUp / ArrowDown / Tab / Enter)
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
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const order: Array<'' | '>' | '@' | '/'> = ['', '>', '@', '/'];
        const curr: '' | '>' | '@' | '/' = isActionMode ? '>' : isHostMode ? '@' : isAiMode ? '/' : '';
        const nextIdx = (order.indexOf(curr) + (e.shiftKey ? order.length - 1 : 1)) % order.length;
        setModePrefix(order[nextIdx]);
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
  }, [isOpen, setOmnibarOpen, selectableItems, selectedIndex, isActionMode, isHostMode, isAiMode, setModePrefix]);

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
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isBg ? 'Бързо командно меню' : 'Command Omnibar'}
          className="fixed inset-0 z-[100] flex flex-col justify-start select-none sm:px-4"
        >
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

          {/* Apple Liquid Glass Spotlight Surface (optically centered on desktop) */}
          <motion.div
            initial={{ opacity: 0, y: -24, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96, transition: { duration: 0.13 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 24, mass: 0.7 }}
            className="
              relative z-10 w-full max-w-2xl mx-auto
              glass-liquid-modal
              transform-gpu
              flex flex-col pt-[calc(env(safe-area-inset-top,12px)+0.5rem)]
              sm:mt-[10vh] sm:rounded-[2rem] overflow-hidden
            "
          >
            {/* Top Drag Indicator */}
            <div className="w-full flex justify-center pb-1 sm:hidden">
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
                className="flex-1 bg-transparent border-none outline-none ink-primary text-base px-3 placeholder:opacity-55 font-sans"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                  className="min-w-[40px] min-h-[40px] flex items-center justify-center ink-muted hover:ink-primary transition cursor-pointer"
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
                  className="min-w-[40px] min-h-[40px] flex items-center justify-center ink-muted hover:ink-primary transition cursor-pointer"
                  aria-label="Close search"
                >
                  <kbd className="inline-block px-2.5 py-0.5 rounded-full liquid-control-pill text-[10px] font-mono">
                    ESC
                  </kbd>
                </button>
              )}
            </div>

            {/* Interactive Context Mode Pills & Keyboard Navigation Hint */}
            <div className="flex items-center justify-between gap-2 px-4 pb-2.5 text-[11px] ink-muted border-b border-white/[0.08]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setModePrefix('>')}
                  className={`px-2.5 py-1 rounded-full transition cursor-pointer ${
                    isActionMode
                      ? 'liquid-hero-btn preserve-white font-semibold'
                      : 'liquid-control-pill ink-secondary hover:ink-primary'
                  }`}
                >
                  {t('omni_actions')}
                </button>
                <button
                  type="button"
                  onClick={() => setModePrefix('@')}
                  className={`px-2.5 py-1 rounded-full transition cursor-pointer ${
                    isHostMode
                      ? 'liquid-hero-btn preserve-white font-semibold'
                      : 'liquid-control-pill ink-secondary hover:ink-primary'
                  }`}
                >
                  {t('omni_hosts')}
                </button>
                <button
                  type="button"
                  onClick={() => setModePrefix('/')}
                  className={`px-2.5 py-1 rounded-full transition cursor-pointer ${
                    isAiMode
                      ? 'liquid-hero-btn preserve-white font-semibold'
                      : 'liquid-control-pill ink-secondary hover:ink-primary'
                  }`}
                >
                  {t('omni_ai')}
                </button>
              </div>
              <span className="hidden sm:inline font-mono text-[10px] opacity-75 shrink-0">
                {isBg ? '↑↓ Навигация • Tab Режим • ↵ Избор' : '↑↓ Move • Tab Mode • ↵ Select'}
              </span>
            </div>

            {/* Results List */}
            <div className="max-h-[54dvh] overflow-y-auto p-2.5 bouncy-scroll space-y-1">
              {selectableItems.length === 0 ? (
                <div className="py-10 px-4 text-center space-y-2">
                  <Search className="w-6 h-6 ink-muted mx-auto opacity-65" />
                  <p className="text-xs font-display font-bold ink-primary">
                    {isBg ? 'Няма съвпадащи резултати' : 'No matching hosts, actions, or presets'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      inputRef.current?.focus();
                    }}
                    className="px-3.5 py-1.5 rounded-full liquid-control-pill text-xs font-semibold ink-primary cursor-pointer"
                  >
                    {isBg ? 'Изчисти филтъра' : 'Clear Filter'}
                  </button>
                </div>
              ) : (
                selectableItems.map((item, idx) => {
                  const Icon = item.icon;
                  const isHighlighted = idx === selectedIndex;
                  const badgeClass =
                    item.iconBg ||
                    (item.kind === 'host'
                      ? 'squircle-hero'
                      : item.kind === 'action'
                      ? 'squircle-sky'
                      : 'squircle-violet');
                  return (
                    <button
                      key={item.id}
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      type="button"
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={item.onTrigger}
                      className={`w-full min-h-[52px] flex items-center justify-between p-2.5 sm:p-3 rounded-2xl transition cursor-pointer border ${
                        isHighlighted
                          ? 'glass-liquid-elevated border-cyan-400/45 shadow-[0_6px_18px_var(--theme-accent-glow)]'
                          : 'border-transparent hover:bg-cyan-500/8'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0 flex-1">
                        <div
                          className={`w-9 h-9 sm:w-10 sm:h-10 squircle-badge flex items-center justify-center shrink-0 ${badgeClass}`}
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
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
