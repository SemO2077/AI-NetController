import React, { useState, useCallback, useEffect, useMemo, useDeferredValue, useRef } from 'react';
import {
  Plus,
  RefreshCw,
  Search,
  X,
  AlertTriangle,
  ChevronDown,
  OctagonAlert,
  ArrowDownAZ,
  ArrowUpAZ,
  Activity,
  Gauge,
  Cpu,
  Star,
  LayoutGrid,
  Network,
  Zap,
  Monitor,
  QrCode,
  RotateCcw,
} from 'lucide-react';
import { HostDevice, WolPacketPayload } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useUIStore } from '../../store/uiStore';
import { useWolHistory } from '../../store/wolHistoryStore';
import { HostCard } from './HostCard';
import { generateMagicPacket } from '../../services/wolService';
import { useTranslation, Language } from '../../i18n/useTranslation';
import { POPOVER_BUBBLE_VARIANTS, SPRING_JELLY, SPRING_POP } from '../../utils/springPhysics';
import { ThemeQuickControls } from '../ui/ThemeQuickControls';
import { getPersistentItem, setPersistentItem } from '../../utils/nativeStorage';

const LazyNetworkTopologyGraph = React.lazy(() =>
  import('../telemetry/NetworkTopologyGraph').then((module) => ({
    default: module.NetworkTopologyGraph,
  }))
);

export type FleetSortMode = 'alphabetical' | 'status' | 'latency' | 'load';
export type FleetSortDirection = 'asc' | 'desc';
export type FleetFilterMode = 'all' | 'pinned' | 'online' | 'sleeping' | 'servers' | 'quarantined';

const VALID_FILTERS: FleetFilterMode[] = ['all', 'pinned', 'online', 'sleeping', 'servers', 'quarantined'];
const NOOP = () => {};

interface FleetDashboardProps {
  hosts: HostDevice[];
  selectedHostId?: string;
  selectedTarget?: string;
  quarantinedHosts?: string[];
  circuitTrippedHosts?: string[];
  onPanicKill?: () => void;
  onSelectHost?: (hostId: string) => void;
  onSelectHostForCommand?: (hostId: string) => void;
  onInspectWolPacket: (device: HostDevice) => void;
  onWakeHost?: (payload: WolPacketPayload, deviceId: string) => void;
  onSendCommand?: (command: string, targetOverride?: string) => void;
  onSendInputOpcode?: (opcode: number, payload: Record<string, any> | string) => boolean;
  onSendWol?: (device: HostDevice) => void;
  onViewScreen: (device: HostDevice) => void;
  onOpenAddHostModal?: () => void;
  onAddNewHost?: () => void;
  onRescan?: () => void;
  isScanning?: boolean;
  isNetworkDisconnected?: boolean;
  onReconnectNetwork?: () => void;
  onToast?: (msg: string) => void;
}

const latencyConfigCache = new Map<string, any>();

/**
 * Calculates color-coded network latency telemetry and visual bar levels with O(1) memoization
 */
export function getLatencyConfig(
  ping?: number,
  isOnline?: boolean,
  _seedId: string = 'host',
  lang: Language = 'bg'
) {
  const normalizedPing =
    typeof ping === 'number' && Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : -1;
  const cacheKey = `${normalizedPing}_${isOnline ? 1 : 0}_${lang}`;
  const cached = latencyConfigCache.get(cacheKey);
  if (cached) return cached;

  let result;
  if (!isOnline) {
    result = {
      latency: null,
      level: 'offline' as const,
      label: lang === 'bg' ? 'Спящ режим (N/A)' : 'Sleeping (N/A)',
      tooltip:
        lang === 'bg'
          ? 'Устройството е в спящ режим — няма активна телеметрия'
          : 'Host is sleeping — no active RTT telemetry',
      colorDot: 'bg-slate-400/70',
      colorText: 'ink-muted',
      colorBg: 'bg-slate-500/10',
      colorBorder: 'border-slate-400/30',
      bars: [
        { active: false, height: '4px', color: 'bg-slate-400/35' },
        { active: false, height: '7px', color: 'bg-slate-400/35' },
        { active: false, height: '10px', color: 'bg-slate-400/35' },
      ],
    };
  } else {
    const latency = normalizedPing >= 0 ? normalizedPing : 0;

    if (latency <= 20) {
      result = {
        latency,
        level: 'optimal' as const,
        label: lang === 'bg' ? 'Отлично закъснение (<20ms)' : 'Optimal latency (<20ms)',
        tooltip:
          lang === 'bg'
            ? `Мрежова латентност (RTT): ${latency} ms • Отлична реакция на връзката (GbE LAN)`
            : `Network latency (RTT): ${latency} ms • Excellent connection response (GbE LAN)`,
        colorDot: 'bg-emerald-400',
        colorText: 'text-emerald-400',
        colorBg: 'bg-emerald-500/12',
        colorBorder: 'border-emerald-500/35',
        bars: [
          { active: true, height: '4px', color: 'bg-emerald-400' },
          { active: true, height: '7px', color: 'bg-emerald-400' },
          { active: true, height: '10px', color: 'bg-emerald-400' },
        ],
      };
    } else if (latency <= 60) {
      result = {
        latency,
        level: 'good' as const,
        label: lang === 'bg' ? 'Добро закъснение (20-60ms)' : 'Good latency (20-60ms)',
        tooltip:
          lang === 'bg'
            ? `Мрежова латентност (RTT): ${latency} ms • Стабилна и бърза мрежова връзка`
            : `Network latency (RTT): ${latency} ms • Stable and responsive connection`,
        colorDot: 'bg-cyan-400',
        colorText: 'text-cyan-400',
        colorBg: 'bg-cyan-500/12',
        colorBorder: 'border-cyan-500/35',
        bars: [
          { active: true, height: '4px', color: 'bg-cyan-400' },
          { active: true, height: '7px', color: 'bg-cyan-400' },
          { active: true, height: '10px', color: 'bg-cyan-400/50' },
        ],
      };
    } else if (latency <= 120) {
      result = {
        latency,
        level: 'moderate' as const,
        label: lang === 'bg' ? 'Умерено закъснение (60-120ms)' : 'Moderate latency (60-120ms)',
        tooltip:
          lang === 'bg'
            ? `Мрежова латентност (RTT): ${latency} ms • Възможно е слабо забавяне при стрийминг`
            : `Network latency (RTT): ${latency} ms • Possible slight stream delay`,
        colorDot: 'bg-amber-400',
        colorText: 'text-amber-400',
        colorBg: 'bg-amber-500/12',
        colorBorder: 'border-amber-500/35',
        bars: [
          { active: true, height: '4px', color: 'bg-amber-400' },
          { active: true, height: '7px', color: 'bg-amber-400' },
          { active: false, height: '10px', color: 'bg-slate-400/35' },
        ],
      };
    } else {
      result = {
        latency,
        level: 'high' as const,
        label: lang === 'bg' ? 'Високо закъснение (>120ms)' : 'High latency (>120ms)',
        tooltip:
          lang === 'bg'
            ? `Мрежова латентност (RTT): ${latency} ms • Високо закъснение / натоварена мрежа`
            : `Network latency (RTT): ${latency} ms • High latency / congested route`,
        colorDot: 'bg-rose-400',
        colorText: 'text-rose-400',
        colorBg: 'bg-rose-500/12',
        colorBorder: 'border-rose-500/35',
        bars: [
          { active: true, height: '4px', color: 'bg-rose-400' },
          { active: false, height: '7px', color: 'bg-slate-400/35' },
          { active: false, height: '10px', color: 'bg-slate-400/35' },
        ],
      };
    }
  }

  if (latencyConfigCache.size > 160) {
    latencyConfigCache.clear();
  }
  latencyConfigCache.set(cacheKey, result);
  return result;
}

const FleetDashboardComponent: React.FC<FleetDashboardProps> = ({
  hosts,
  selectedHostId,
  selectedTarget,
  quarantinedHosts = [],
  circuitTrippedHosts = [],
  onPanicKill,
  onSelectHost,
  onSelectHostForCommand,
  onInspectWolPacket,
  onWakeHost,
  onSendCommand,
  onSendInputOpcode,
  onSendWol,
  onViewScreen,
  onOpenAddHostModal,
  onAddNewHost,
  onRescan,
  isScanning = false,
  isNetworkDisconnected = false,
  onReconnectNetwork,
  onToast,
}) => {
  const activeSelectedId = selectedHostId || selectedTarget;
  const onSelectHostSafe = onSelectHost || NOOP;
  const rescanHandler = onRescan || NOOP;
  const openModal = useUIStore((s) => s.openModal);
  const toggleOmnibar = useUIStore((s) => s.toggleOmnibar);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setPendingChatPrompt = useUIStore((s) => s.setPendingChatPrompt);
  const addHostHandler = useMemo(
    () => onOpenAddHostModal || onAddNewHost || (() => openModal('addHost')),
    [onOpenAddHostModal, onAddNewHost, openModal]
  );
  const handleOpenDetailsModal = useCallback(
    (dev: HostDevice) => openModal('hostDetails', dev),
    [openModal]
  );
  const { t, language } = useTranslation();

  const [expandedHostIds, setExpandedHostIds] = useState<Record<string, boolean>>(() => {
    return activeSelectedId ? { [activeSelectedId]: true } : {};
  });

  const [pinnedHostIds, setPinnedHostIds] = useState<string[]>(() => {
    try {
      const saved =
        getPersistentItem('ai_pinned_hosts_v1') || getPersistentItem('cst_pinned_hosts_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter((id) => typeof id === 'string');
      }
    } catch {}
    return [];
  });

  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;

  const togglePinHost = useCallback(
    (hostId: string) => {
      setPinnedHostIds((prev) => {
        const wasPinned = prev.includes(hostId);
        const next = wasPinned ? prev.filter((id) => id !== hostId) : [...prev, hostId];
        setPersistentItem('ai_pinned_hosts_v1', JSON.stringify(next));
        const hostName = hostsRef.current.find((h) => h.id === hostId)?.name || hostId;
        onToast?.(
          wasPinned
            ? t('host_unpinned_toast', { name: hostName })
            : t('host_pinned_toast', { name: hostName })
        );
        return next;
      });
    },
    [onToast, t]
  );

  const [viewMode, setViewMode] = useState<'grid' | 'topology'>(() => {
    try {
      const saved =
        getPersistentItem('ai_net_fleet_view_mode') ||
        getPersistentItem('cst_fleet_view_mode');
      if (saved === 'grid' || saved === 'topology') return saved;
    } catch {}
    return 'grid';
  });

  useEffect(() => {
    setPersistentItem('ai_net_fleet_view_mode', viewMode);
  }, [viewMode]);

  const toggleHostExpansion = useCallback((hostId: string) => {
    triggerHapticFeedback('light');
    setExpandedHostIds((prev) => ({
      ...prev,
      [hostId]: !prev[hostId],
    }));
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const [confirmWakeAll, setConfirmWakeAll] = useState(false);

  const [activeFilter, setActiveFilter] = useState<FleetFilterMode>(() => {
    try {
      const saved = getPersistentItem('ai_net_fleet_filter') as FleetFilterMode | null;
      if (saved && VALID_FILTERS.includes(saved)) return saved;
    } catch {}
    return 'all';
  });

  useEffect(() => {
    setPersistentItem('ai_net_fleet_filter', activeFilter);
  }, [activeFilter]);

  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState<FleetSortMode>(() => {
    try {
      const saved = getPersistentItem('wakeflow_fleet_sort_mode');
      if (saved === 'alphabetical' || saved === 'status' || saved === 'latency' || saved === 'load') {
        return saved;
      }
    } catch {}
    return 'alphabetical';
  });
  const [sortDirection, setSortDirection] = useState<FleetSortDirection>(() => {
    try {
      const saved = getPersistentItem('wakeflow_fleet_sort_direction');
      if (saved === 'asc' || saved === 'desc') {
        return saved;
      }
    } catch {}
    return 'asc';
  });

  useEffect(() => {
    setPersistentItem('wakeflow_fleet_sort_mode', sortMode);
    setPersistentItem('wakeflow_fleet_sort_direction', sortDirection);
  }, [sortMode, sortDirection]);

  useEffect(() => {
    if (!isSortMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSortMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSortMenuOpen]);

  const handleSortToggle = useCallback((mode: FleetSortMode) => {
    triggerHapticFeedback('selection');
    setSortMode((prevMode) => {
      if (prevMode === mode) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevMode;
      } else {
        setSortDirection(mode === 'load' ? 'desc' : 'asc');
        return mode;
      }
    });
  }, []);

  const [wakingCountdown, setWakingCountdown] = useState<Record<string, number>>({});
  const wolHistory = useWolHistory();
  const seenWolIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (seenWolIdsRef.current === null) {
      seenWolIdsRef.current = new Set(wolHistory.map((e) => e.id));
      return;
    }
    const seen = seenWolIdsRef.current;
    if (seen.size > 400) {
      seen.clear();
      wolHistory.forEach((e) => seen.add(e.id));
      return;
    }
    const now = Date.now();
    const newlyWokenIds: string[] = [];
    for (const entry of wolHistory) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      if (entry.status !== 'success' || now - entry.createdAt > 15_000) continue;
      const matched =
        hosts.find((h) => h.id === entry.deviceId) ||
        hosts.find((h) => h.mac && entry.mac && h.mac.toUpperCase() === entry.mac.toUpperCase());
      if (matched && !matched.isOnline) {
        newlyWokenIds.push(matched.id);
      }
    }
    if (newlyWokenIds.length > 0) {
      setWakingCountdown((prev) => {
        const next = { ...prev };
        newlyWokenIds.forEach((id) => {
          next[id] = 45;
        });
        return next;
      });
    }
  }, [wolHistory, hosts]);

  const pinnedSet = useMemo(() => new Set(pinnedHostIds), [pinnedHostIds]);
  const quarantinedSet = useMemo(() => new Set(quarantinedHosts), [quarantinedHosts]);
  const circuitTrippedSet = useMemo(() => new Set(circuitTrippedHosts), [circuitTrippedHosts]);

  const onlineCount = useMemo(() => hosts.filter((h) => h.isOnline).length, [hosts]);
  const offlineHosts = useMemo(() => hosts.filter((h) => !h.isOnline), [hosts]);
  const offlineCount = offlineHosts.length;
  const pinnedCount = useMemo(
    () => hosts.filter((h) => pinnedSet.has(h.id)).length,
    [hosts, pinnedSet]
  );
  const serverCount = useMemo(
    () =>
      hosts.filter(
        (h) => h.deviceType === 'server' || h.id.includes('SERVER') || h.id.includes('SRV')
      ).length,
    [hosts]
  );

  // Auto-reset filter if user unpins last pinned host or clears last quarantined host while viewing that tab
  useEffect(() => {
    if (activeFilter === 'pinned' && pinnedCount === 0) {
      setActiveFilter('all');
    } else if (activeFilter === 'quarantined' && quarantinedHosts.length === 0) {
      setActiveFilter('all');
    }
  }, [activeFilter, pinnedCount, quarantinedHosts.length]);

  const handleDiagnoseHost = useCallback(
    (host: HostDevice) => {
      triggerHapticFeedback('medium');
      const prompt =
        language === 'bg'
          ? `Диагностицирай високото натоварване на хост ${host.name} (${host.ip}, OS: ${host.os}, CPU: ${host.cpuUsage ?? 0}%, RAM: ${host.ramUsage ?? 0}%). Предложи конкретни диагностични команди и оптимизации.`
          : `Diagnose the high resource load on host ${host.name} (${host.ip}, OS: ${host.os}, CPU: ${host.cpuUsage ?? 0}%, RAM: ${host.ramUsage ?? 0}%). Recommend specific diagnostic commands and remediation steps.`;
      setPendingChatPrompt(prompt);
      setActiveTab('chat');
    },
    [language, setPendingChatPrompt, setActiveTab]
  );

  const handleWakeClick = useCallback(
    (e: React.MouseEvent, host: HostDevice) => {
      e.stopPropagation();
      triggerHapticFeedback('heavy');
      if (onSendWol) {
        onSendWol(host);
      } else {
        onInspectWolPacket(host);
      }
    },
    [onSendWol, onInspectWolPacket]
  );

  const executeWakeAllOffline = useCallback(() => {
    triggerHapticFeedback('heavy');
    setConfirmWakeAll(false);
    if (offlineHosts.length === 0) return;

    offlineHosts.forEach((host) => {
      if (onWakeHost) {
        try {
          const pkt = generateMagicPacket(host.mac, '255.255.255.255', 9);
          void (onWakeHost as (...args: any[]) => unknown)(pkt, host.id, 'manual', host.name, true);
        } catch {
          onInspectWolPacket(host);
        }
      } else if (onSendWol) {
        onSendWol(host);
      } else {
        onInspectWolPacket(host);
      }
    });
  }, [offlineHosts, onWakeHost, onSendWol, onInspectWolPacket]);

  const handleWakeAllOffline = useCallback(() => {
    triggerHapticFeedback('light');
    if (offlineHosts.length === 0) return;

    if (useUIStore.getState().isCommandConfirmations && !confirmWakeAll) {
      setConfirmWakeAll(true);
      return;
    }
    executeWakeAllOffline();
  }, [offlineHosts.length, confirmWakeAll, executeWakeAllOffline]);

  const hasWakingHosts = Object.keys(wakingCountdown).length > 0;
  useEffect(() => {
    if (!hasWakingHosts) return;

    const interval = setInterval(() => {
      setWakingCountdown((prev) => {
        const next: Record<string, number> = {};
        for (const [id, count] of Object.entries(prev)) {
          const countNum = Number(count);
          if (countNum > 1) {
            next[id] = countNum - 1;
          }
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [hasWakingHosts]);

  useEffect(() => {
    if (!hasWakingHosts) return;
    setWakingCountdown((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, count] of Object.entries(prev)) {
        const host = hosts.find((h) => h.id === id);
        if (host?.isOnline) {
          changed = true;
        } else {
          next[id] = count;
        }
      }
      return changed ? next : prev;
    });
  }, [hosts, hasWakingHosts]);

  const filteredHosts = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase();
    const filtered = hosts.filter((h) => {
      const matchesQuery =
        !query ||
        (h.name && h.name.toLowerCase().includes(query)) ||
        (h.ip && h.ip.toLowerCase().includes(query)) ||
        (h.id && h.id.toLowerCase().includes(query)) ||
        (h.mac && h.mac.toLowerCase().includes(query)) ||
        (h.os && h.os.toLowerCase().includes(query)) ||
        (h.tags && h.tags.some((t) => t.toLowerCase().includes(query)));

      if (!matchesQuery) return false;

      if (activeFilter === 'pinned') return pinnedSet.has(h.id);
      if (activeFilter === 'online') return h.isOnline;
      if (activeFilter === 'sleeping') return !h.isOnline;
      if (activeFilter === 'servers')
        return h.deviceType === 'server' || h.id.includes('SERVER') || h.id.includes('SRV');
      if (activeFilter === 'quarantined') return quarantinedSet.has(h.id);
      return true;
    });

    return [...filtered].sort((a, b) => {
      const aPinned = pinnedSet.has(a.id);
      const bPinned = pinnedSet.has(b.id);
      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }

      if (sortMode === 'alphabetical') {
        const cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        return sortDirection === 'asc' ? cmp : -cmp;
      }

      if (sortMode === 'status') {
        if (a.isOnline !== b.isOnline) {
          return sortDirection === 'asc' ? (a.isOnline ? -1 : 1) : a.isOnline ? 1 : -1;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      if (sortMode === 'latency') {
        const latA = a.isOnline ? (getLatencyConfig(a.ping, a.isOnline, a.id, language).latency ?? 9999) : 999999;
        const latB = b.isOnline ? (getLatencyConfig(b.ping, b.isOnline, b.id, language).latency ?? 9999) : 999999;

        if (a.isOnline && b.isOnline) {
          const diff = latA - latB;
          if (diff !== 0) {
            return sortDirection === 'asc' ? diff : -diff;
          }
        } else if (a.isOnline !== b.isOnline) {
          return sortDirection === 'asc' ? (a.isOnline ? -1 : 1) : a.isOnline ? 1 : -1;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      if (sortMode === 'load') {
        if (a.isOnline !== b.isOnline) {
          return a.isOnline ? -1 : 1;
        }
        const loadA = Math.max(a.cpuUsage ?? a.cpu ?? 0, a.ramUsage ?? a.ram ?? 0);
        const loadB = Math.max(b.cpuUsage ?? b.cpu ?? 0, b.ramUsage ?? b.ram ?? 0);
        const diff = loadA - loadB;
        if (diff !== 0) {
          return sortDirection === 'desc' ? -diff : diff;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      return 0;
    });
  }, [activeFilter, hosts, deferredQuery, sortMode, sortDirection, pinnedSet, quarantinedSet, language]);

  const sortOptions = useMemo(
    () => [
      {
        id: 'alphabetical' as const,
        label: t('sort_name'),
        badge: sortDirection === 'asc' ? t('sort_name_asc') : t('sort_name_desc'),
        icon: sortDirection === 'asc' ? ArrowDownAZ : ArrowUpAZ,
      },
      {
        id: 'status' as const,
        label: t('sort_status'),
        badge:
          sortDirection === 'asc' ? t('sort_status_online_first') : t('sort_status_offline_first'),
        icon: Activity,
      },
      {
        id: 'latency' as const,
        label: t('sort_latency'),
        badge:
          sortDirection === 'asc' ? t('sort_latency_fast_first') : t('sort_latency_slow_first'),
        icon: Gauge,
      },
      {
        id: 'load' as const,
        label: t('sort_load'),
        badge: sortDirection === 'desc' ? t('sort_load_high_first') : t('sort_load_low_first'),
        icon: Cpu,
      },
    ],
    [sortDirection, t]
  );
  const currentSortOption = sortOptions.find((o) => o.id === sortMode) || sortOptions[0];
  const CurrentSortIcon = currentSortOption.icon;
  const hasActiveNarrowing = Boolean(searchQuery.trim() || activeFilter !== 'all');
  const resetFilters = useCallback(() => {
    triggerHapticFeedback('light');
    setSearchQuery('');
    setActiveFilter('all');
  }, []);

  return (
    <div id="fleet-dashboard-container" className="w-full flex flex-col select-none pb-2 relative">
      {/* Detached Floating Apple Liquid Glass Header & Airy Filter Toolbar */}
      <div className="pt-0.5 pb-4 flex flex-col gap-3 relative z-30">
        {/* Network Disconnection Banner */}
        {isNetworkDisconnected && (
          <div className="glass-liquid-subtle w-full px-4 py-2.5 border border-amber-500/40 rounded-full flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate font-medium">{t('conn_disconnected')}</span>
            </div>
            {onReconnectNetwork && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.92 }}
                transition={SPRING_POP}
                onClick={onReconnectNetwork}
                className="px-3.5 py-1.5 rounded-full squircle-amber preserve-white text-xs font-bold transition shrink-0"
              >
                {t('conn_reconnect')}
              </motion.button>
            )}
          </div>
        )}

        {/* 1. DETACHED FLOATING LIQUID GLASS HEADER CAPSULE */}
        <header className="glass-liquid-elevated liquid-capsule-refract rounded-[24px] sm:rounded-[28px] px-3.5 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2.5 sm:gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 squircle-badge squircle-hero flex items-center justify-center shrink-0">
              <Monitor className="w-5 h-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="text-fluid-title font-extrabold tracking-tight font-display ink-primary truncate">
                {t('fleet_title')}
              </h1>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold tabular-nums mt-0.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/18 border border-emerald-400/40 text-emerald-300">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="beacon-pulse-emerald absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span>
                    {onlineCount} {t('fleet_online')}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/16 border border-amber-400/35 text-amber-300">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span>
                    {offlineCount} {t('fleet_sleeping')}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-start sm:justify-end gap-1.5 w-full sm:w-auto shrink-0 sm:ml-auto flex-wrap">
            <ThemeQuickControls showAccentDots />

            {offlineCount > 0 &&
              (confirmWakeAll ? (
                <div className="flex items-center gap-1 h-9 px-1.5 rounded-full bg-amber-500/18 border border-amber-500/40">
                  <button
                    type="button"
                    onClick={executeWakeAllOffline}
                    className="h-7 px-2.5 rounded-full bg-amber-500 hover:bg-amber-400 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                  >
                    <Zap className="w-3 h-3 shrink-0" />
                    <span>
                      {language === 'bg'
                        ? `Събуди (${offlineCount})`
                        : `Wake ${offlineCount}?`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmWakeAll(false)}
                    className="h-7 px-2 rounded-full liquid-control-pill text-[11px] font-semibold ink-primary cursor-pointer"
                  >
                    {language === 'bg' ? 'Не' : 'Cancel'}
                  </button>
                </div>
              ) : (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05, y: -1 }}
                  whileTap={{ scale: 0.91 }}
                  transition={SPRING_POP}
                  onClick={handleWakeAllOffline}
                  className="h-9 px-3.5 rounded-full squircle-amber preserve-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  title={
                    language === 'bg'
                      ? `Събуди всички спящи хостове (${offlineCount})`
                      : `Wake all sleeping hosts (${offlineCount})`
                  }
                >
                  <Zap className="w-3.5 h-3.5 shrink-0 icon-bolt-live" />
                  <span className="hidden xs:inline">
                    {language === 'bg' ? 'Събуди' : 'Wake All'}
                  </span>
                </motion.button>
              ))}

            <motion.button
              type="button"
              whileHover={{ scale: 1.05, y: -1 }}
              whileTap={{ scale: 0.91 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                openModal('quickSetup');
              }}
              className="h-9 px-3 rounded-full liquid-control-pill text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              title={
                language === 'bg'
                  ? 'Сдвояване на компютър и QR настройка'
                  : 'Pair PC & Quick Setup'
              }
            >
              <QrCode className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="hidden sm:inline">
                {language === 'bg' ? 'Сдвои PC' : 'Pair PC'}
              </span>
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.06, y: -1 }}
              whileTap={{ scale: 0.9 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('selection');
                setViewMode((prev) => (prev === 'grid' ? 'topology' : 'grid'));
              }}
              className="w-9 h-9 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
              title={
                viewMode === 'grid'
                  ? t('fleet_view_topology')
                  : t('fleet_view_cards')
              }
              aria-label="Toggle View Mode"
            >
              {viewMode === 'grid' ? (
                <Network className="w-4 h-4 text-cyan-400" />
              ) : (
                <LayoutGrid className="w-4 h-4 text-cyan-400" />
              )}
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.05, y: -1 }}
              whileTap={{ scale: 0.91 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                addHostHandler();
              }}
              className="h-9 px-3.5 rounded-full liquid-hero-btn font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              title={t('fleet_add_host_tooltip')}
              aria-label={t('fleet_add_host_aria')}
            >
              <Plus className="w-4 h-4 stroke-[2.6] shrink-0 icon-plus-bubbly" />
              <span className="hidden xs:inline">
                {language === 'bg' ? 'Добави' : 'Add PC'}
              </span>
            </motion.button>
          </div>
        </header>

        {/* 2. AIRY FLOATING CAPSULE SEARCH + SCAN + SORT BAR */}
        <div className={`flex items-center gap-2 relative ${isSortMenuOpen ? 'z-50' : 'z-20'}`}>
          <div className="flex-1 h-11 rounded-full glass-liquid-subtle px-4 flex items-center gap-2.5 focus-within:border-cyan-400/65 transition min-w-0">
            <Search className="w-4 h-4 text-cyan-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (searchQuery) {
                    setSearchQuery('');
                  } else {
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }
              }}
              placeholder={
                language === 'bg' ? 'Търси PC, IP или MAC...' : 'Search PCs, IP or MAC...'
              }
              aria-label={language === 'bg' ? 'Търси PC, IP или MAC' : 'Search PCs, IP or MAC'}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs sm:text-sm ink-primary placeholder:text-[var(--ink-secondary)] placeholder:opacity-80"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 rounded-full hover:bg-black/5 ink-muted transition"
                aria-label={t('fleet_clear_search')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  toggleOmnibar();
                }}
                className="hidden lg:inline-flex items-center justify-center h-8 min-w-[44px] px-3 rounded-full liquid-control-pill text-[11px] font-mono font-bold ink-secondary hover:ink-primary"
                title={t('fleet_spotlight_tooltip')}
              >
                ⌘K
              </button>
            )}
          </div>

          <motion.button
            type="button"
            whileHover={{ scale: 1.05, y: -1 }}
            whileTap={{ scale: 0.91 }}
            transition={SPRING_POP}
            onClick={() => {
              triggerHapticFeedback('medium');
              rescanHandler();
            }}
            disabled={isScanning}
            className="h-11 w-11 sm:w-auto sm:px-4 rounded-full liquid-control-pill text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-45 shrink-0 cursor-pointer"
            title={t('fleet_rescan_tooltip')}
            aria-label={t('fleet_rescan_aria')}
          >
            <RefreshCw className={`w-4 h-4 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{language === 'bg' ? 'Сканирай' : 'Scan'}</span>
          </motion.button>

          {/* Compact Sort Pill Dropdown */}
          <div className="relative shrink-0">
            <motion.button
              type="button"
              whileHover={{ scale: 1.05, y: -1 }}
              whileTap={{ scale: 0.91 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                setIsSortMenuOpen((prev) => !prev);
              }}
              className="h-11 px-3 sm:px-3.5 rounded-full liquid-control-pill flex items-center gap-1.5 text-xs font-semibold shrink-0 cursor-pointer"
              title={`${t('sort_label')} ${currentSortOption.label}`}
              aria-label={`${t('sort_label')} ${currentSortOption.label}`}
              aria-haspopup="menu"
              aria-expanded={isSortMenuOpen}
            >
              <CurrentSortIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="hidden xs:inline">{currentSortOption.label}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 opacity-60 transition-transform duration-200 ${
                  isSortMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </motion.button>

            <AnimatePresence>
              {isSortMenuOpen && (
                <div key="fleet-sort-menu-layer">
                  <div
                    className="fixed inset-0 z-[90]"
                    onClick={() => setIsSortMenuOpen(false)}
                  />
                  <motion.div
                    variants={POPOVER_BUBBLE_VARIANTS}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="absolute right-0 top-12 z-[100] w-52 rounded-3xl dropdown-menu-surface p-2 space-y-1"
                  >
                    {sortOptions.map((opt) => {
                      const isActive = sortMode === opt.id;
                      const OptIcon = opt.icon;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            handleSortToggle(opt.id);
                            setIsSortMenuOpen(false);
                          }}
                          className={`w-full min-h-[38px] px-3 py-1.5 rounded-2xl text-xs flex items-center justify-between transition ${
                            isActive
                              ? 'liquid-hero-btn font-bold'
                              : 'ink-secondary hover:bg-cyan-500/10 hover:ink-primary'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <OptIcon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-cyan-400'}`} />
                            <span>{opt.label}</span>
                          </span>
                          <span className={`text-[10px] font-mono ${isActive ? 'text-white/90' : 'opacity-65'}`}>
                            {opt.badge}
                          </span>
                        </button>
                      );
                    })}
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 3. JELLY LIQUID FILTER PILLS ROW */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none min-w-0 flex-1 py-0.5 px-0.5">
            {[
              { id: 'all' as FleetFilterMode, label: t('filter_all'), count: hosts.length, isPinnedChip: false },
              ...(pinnedCount > 0
                ? [
                    {
                      id: 'pinned' as FleetFilterMode,
                      label: t('filter_pinned'),
                      count: pinnedCount,
                      isPinnedChip: true,
                    },
                  ]
                : []),
              { id: 'online' as FleetFilterMode, label: t('filter_online'), count: onlineCount, isPinnedChip: false },
              { id: 'sleeping' as FleetFilterMode, label: t('filter_sleeping'), count: offlineCount, isPinnedChip: false },
              { id: 'servers' as FleetFilterMode, label: t('filter_servers'), count: serverCount, isPinnedChip: false },
              ...(quarantinedHosts.length > 0
                ? [
                    {
                      id: 'quarantined' as FleetFilterMode,
                      label: t('filter_quarantined'),
                      count: quarantinedHosts.length,
                      isPinnedChip: false,
                    },
                  ]
                : []),
            ].map((chip) => {
              const isActive = activeFilter === chip.id;
              return (
                <motion.button
                  key={chip.id}
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.91 }}
                  transition={SPRING_POP}
                  onClick={() => {
                    triggerHapticFeedback('selection');
                    setActiveFilter(chip.id);
                  }}
                  className={`relative h-8.5 px-3.5 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 shrink-0 cursor-pointer ${
                    isActive ? 'preserve-white' : 'liquid-control-pill'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="fleetActiveFilterPill"
                      transition={SPRING_JELLY}
                      className="absolute inset-0 rounded-full liquid-hero-btn pointer-events-none"
                    />
                  )}
                  {chip.isPinnedChip && (
                    <Star
                      className={`relative z-10 w-3 h-3 shrink-0 ${
                        isActive ? 'text-white fill-white' : 'text-amber-400 fill-amber-400'
                      }`}
                    />
                  )}
                  <span className="relative z-10">{chip.label}</span>
                  {chip.count !== null && (
                    <span
                      className={`relative z-10 text-[10px] font-mono tabular-nums px-1.5 py-0.2 rounded-full ${
                        isActive
                          ? 'bg-white/25 text-white'
                          : 'bg-cyan-500/12 text-cyan-400'
                      }`}
                    >
                      {chip.count}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>

          {onPanicKill && hosts.length > 0 && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.9 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('heavy');
                onPanicKill();
              }}
              className="h-8.5 px-3 rounded-full bg-rose-500/14 border border-rose-500/35 hover:bg-rose-500/22 text-rose-400 text-[11px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
              title={t('fleet_panic_tooltip')}
              aria-label={t('fleet_panic_aria')}
            >
              <OctagonAlert className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {language === 'bg' ? 'Авариен Стоп' : 'Kill Switch'}
              </span>
            </motion.button>
          )}
        </div>

        {/* Active Search / Filter Status Bar */}
        {viewMode === 'grid' && hosts.length > 0 && hasActiveNarrowing && (
          <div className="flex items-center justify-between gap-2 px-1 text-[11px] font-mono ink-muted">
            <span>
              {t('filter_showing_count', { shown: filteredHosts.length, total: hosts.length })}
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-cyan-400 hover:underline font-semibold cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t('filter_reset')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Fleet Content */}
      {viewMode === 'topology' ? (
        <div className="px-0.5">
          <React.Suspense
            fallback={
              <div className="grid min-h-[280px] place-items-center" aria-busy="true">
                <div
                  className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent"
                  aria-hidden="true"
                />
              </div>
            }
          >
            <LazyNetworkTopologyGraph
              hosts={hosts}
              selectedHostId={activeSelectedId}
              quarantinedHosts={quarantinedHosts}
              circuitTrippedHosts={circuitTrippedHosts}
              onSelectHost={onSelectHostSafe}
              onSendWol={onInspectWolPacket}
              onViewScreen={onViewScreen}
            />
          </React.Suspense>
        </div>
      ) : filteredHosts.length === 0 ? (
        <div className="glass-liquid rounded-[30px] p-7 sm:p-10 flex flex-col items-center justify-center text-center mx-auto max-w-md my-6">
          <div className="w-14 h-14 squircle-badge squircle-hero flex items-center justify-center mb-4">
            {hosts.length === 0 ? <Monitor className="w-7 h-7" /> : <Search className="w-6 h-6" />}
          </div>
          <h3 className="text-base sm:text-lg font-extrabold ink-primary tracking-tight font-display">
            {hosts.length === 0
              ? language === 'bg'
                ? 'Няма добавени компютри'
                : 'No Computers Added Yet'
              : t('empty_hosts_title')}
          </h3>
          <p className="text-xs ink-muted max-w-sm mt-1.5 mb-5 leading-relaxed">
            {hosts.length === 0
              ? language === 'bg'
                ? 'Добавете своя компютър по IP и MAC адрес или сканирайте локалната мрежа за автоматично откриване.'
                : 'Add your computer by IP & MAC address, or scan your local network to discover active devices.'
              : t('empty_hosts_desc')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 w-full">
            {hasActiveNarrowing && (
              <button
                type="button"
                onClick={resetFilters}
                className="h-10 px-4 rounded-full liquid-hero-btn font-bold text-xs flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('filter_reset')}</span>
              </button>
            )}
            {hosts.length === 0 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    openModal('quickSetup');
                  }}
                  className="h-10 px-4 rounded-full squircle-emerald preserve-white font-bold text-xs flex items-center gap-1.5"
                >
                  <QrCode className="w-4 h-4" />
                  <span>{language === 'bg' ? 'Бързо сдвояване (QR/PIN)' : 'Quick Pair (QR/PIN)'}</span>
                </button>
                <button
                  type="button"
                  onClick={addHostHandler}
                  className="h-10 px-4 rounded-full liquid-hero-btn font-bold text-xs flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>{language === 'bg' ? 'Добави компютър' : 'Add First PC'}</span>
                </button>
              </>
            )}
            {onRescan && (
              <button
                type="button"
                onClick={() => onRescan()}
                disabled={isScanning}
                className="h-10 px-4 rounded-full liquid-control-pill text-cyan-400 font-semibold text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>
                  {isScanning
                    ? language === 'bg'
                      ? 'Сканиране...'
                      : 'Scanning...'
                    : language === 'bg'
                    ? 'Сканирай LAN'
                    : 'Scan LAN'}
                </span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="fleet-responsive-grid items-start">
          {filteredHosts.map((host) => (
            <HostCard
              key={host.id}
              host={host}
              language={language}
              isSelected={host.id === activeSelectedId}
              isExpanded={!!expandedHostIds[host.id]}
              isPinned={pinnedSet.has(host.id)}
              isQuarantined={quarantinedSet.has(host.id)}
              isCircuitTripped={circuitTrippedSet.has(host.id)}
              sortMode={sortMode}
              remainingWakeSeconds={wakingCountdown[host.id]}
              onSelect={onSelectHostSafe}
              onToggleExpand={toggleHostExpansion}
              onTogglePin={togglePinHost}
              onViewScreen={onViewScreen}
              onSelectForCommand={onSelectHostForCommand}
              onQuickCommand={onSendCommand}
              onSendInputOpcode={onSendInputOpcode}
              onDiagnoseHost={handleDiagnoseHost}
              onOpenDetailsModal={handleOpenDetailsModal}
              onWakeClick={handleWakeClick}
              onNotify={onToast}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FleetDashboard = React.memo(FleetDashboardComponent);
