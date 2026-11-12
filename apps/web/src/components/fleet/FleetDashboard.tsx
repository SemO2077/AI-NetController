import React, { useState, useCallback, useEffect, useMemo, useDeferredValue } from 'react';
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
  LayoutGrid,
  Network,
  Zap,
  Monitor,
  QrCode,
} from 'lucide-react';
import { HostDevice, WolPacketPayload } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useUIStore } from '../../store/uiStore';
import { HostCard } from './HostCard';
import { generateMagicPacket } from '../../services/wolService';
import { useTranslation, Language } from '../../i18n/useTranslation';
import { POPOVER_BUBBLE_VARIANTS } from '../../utils/springPhysics';

const LazyNetworkTopologyGraph = React.lazy(() =>
  import('../telemetry/NetworkTopologyGraph').then((module) => ({
    default: module.NetworkTopologyGraph,
  }))
);

export type FleetSortMode = 'alphabetical' | 'status' | 'latency';
export type FleetSortDirection = 'asc' | 'desc';

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
  onSendWol?: (device: HostDevice) => void;
  onViewScreen: (device: HostDevice) => void;
  onOpenAddHostModal?: () => void;
  onAddNewHost?: () => void;
  onRescan?: () => void;
  isScanning?: boolean;
  isNetworkDisconnected?: boolean;
  onReconnectNetwork?: () => void;
}

const latencyConfigCache = new Map<string, any>();

/**
 * Calculates color-coded network latency telemetry and visual bar levels with O(1) memoization
 */
export function getLatencyConfig(
  ping?: number,
  isOnline?: boolean,
  seedId: string = 'host',
  lang: Language = 'bg'
) {
  const cacheKey = `${ping ?? -1}_${isOnline ? 1 : 0}_${seedId}_${lang}`;
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
      colorDot: 'bg-white/20',
      colorText: 'text-white/40',
      colorBg: 'bg-white/[0.04]',
      colorBorder: 'border-white/10',
      bars: [
        { active: false, height: '4px', color: 'bg-white/20' },
        { active: false, height: '7px', color: 'bg-white/20' },
        { active: false, height: '10px', color: 'bg-white/20' },
      ],
    };
  } else {
    const latency = typeof ping === 'number' && ping >= 0 ? ping : 0;

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
        colorBg: 'bg-emerald-500/10',
        colorBorder: 'border-emerald-500/30',
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
        colorText: 'text-cyan-300',
        colorBg: 'bg-cyan-500/10',
        colorBorder: 'border-cyan-500/30',
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
        colorText: 'text-amber-300',
        colorBg: 'bg-amber-500/10',
        colorBorder: 'border-amber-500/30',
        bars: [
          { active: true, height: '4px', color: 'bg-amber-400' },
          { active: true, height: '7px', color: 'bg-amber-400' },
          { active: false, height: '10px', color: 'bg-white/20' },
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
        colorBg: 'bg-rose-500/10',
        colorBorder: 'border-rose-500/30',
        bars: [
          { active: true, height: '4px', color: 'bg-rose-400' },
          { active: false, height: '7px', color: 'bg-white/20' },
          { active: false, height: '10px', color: 'bg-white/20' },
        ],
      };
    }
  }

  if (latencyConfigCache.size > 100) {
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
  onViewScreen,
  onOpenAddHostModal,
  onAddNewHost,
  onRescan,
  isScanning = false,
  isNetworkDisconnected = false,
  onReconnectNetwork,
}) => {
  const activeSelectedId = selectedHostId || selectedTarget;
  const onSelectHostSafe = onSelectHost || (() => {});
  const rescanHandler = onRescan || (() => {});
  const openModal = useUIStore((s) => s.openModal);
  const toggleOmnibar = useUIStore((s) => s.toggleOmnibar);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setPendingChatPrompt = useUIStore((s) => s.setPendingChatPrompt);
  const addHostHandler = onOpenAddHostModal || onAddNewHost || (() => openModal('addHost'));
  const { t, language } = useTranslation();

  const [expandedHostIds, setExpandedHostIds] = useState<Record<string, boolean>>(() => {
    return activeSelectedId ? { [activeSelectedId]: true } : {};
  });

  const [pinnedHostIds, setPinnedHostIds] = useState<string[]>(() => {
    try {
      const saved =
        localStorage.getItem('ai_pinned_hosts_v1') || localStorage.getItem('cst_pinned_hosts_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const togglePinHost = useCallback((hostId: string) => {
    setPinnedHostIds((prev) => {
      const next = prev.includes(hostId) ? prev.filter((id) => id !== hostId) : [...prev, hostId];
      try {
        localStorage.setItem('ai_pinned_hosts_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const [viewMode, setViewMode] = useState<'grid' | 'topology'>(() => {
    try {
      const saved =
        localStorage.getItem('ai_net_fleet_view_mode') ||
        localStorage.getItem('cst_fleet_view_mode');
      if (saved === 'grid' || saved === 'topology') return saved;
    } catch {}
    return 'grid';
  });

  useEffect(() => {
    try {
      localStorage.setItem('ai_net_fleet_view_mode', viewMode);
    } catch {}
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

  const [activeFilter, setActiveFilter] = useState<
    'all' | 'online' | 'sleeping' | 'servers' | 'quarantined'
  >('all');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState<FleetSortMode>(() => {
    try {
      const saved = localStorage.getItem('wakeflow_fleet_sort_mode');
      if (saved === 'alphabetical' || saved === 'status' || saved === 'latency') {
        return saved;
      }
    } catch {}
    return 'alphabetical';
  });
  const [sortDirection, setSortDirection] = useState<FleetSortDirection>(() => {
    try {
      const saved = localStorage.getItem('wakeflow_fleet_sort_direction');
      if (saved === 'asc' || saved === 'desc') {
        return saved;
      }
    } catch {}
    return 'asc';
  });

  useEffect(() => {
    try {
      localStorage.setItem('wakeflow_fleet_sort_mode', sortMode);
      localStorage.setItem('wakeflow_fleet_sort_direction', sortDirection);
    } catch {}
  }, [sortMode, sortDirection]);

  const handleSortToggle = useCallback((mode: FleetSortMode) => {
    triggerHapticFeedback('selection');
    setSortMode((prevMode) => {
      if (prevMode === mode) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevMode;
      } else {
        setSortDirection('asc');
        return mode;
      }
    });
  }, []);

  const [wakingCountdown, setWakingCountdown] = useState<Record<string, number>>({});

  const onlineCount = useMemo(() => hosts.filter((h) => h.isOnline).length, [hosts]);
  const offlineHosts = useMemo(() => hosts.filter((h) => !h.isOnline), [hosts]);
  const offlineCount = offlineHosts.length;

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
      onInspectWolPacket(host);
      setWakingCountdown((prev) => ({ ...prev, [host.id]: 45 }));
    },
    [onInspectWolPacket]
  );

  const handleWakeAllOffline = useCallback(() => {
    triggerHapticFeedback('heavy');
    if (offlineHosts.length === 0) return;

    const countdownUpdates: Record<string, number> = {};
    offlineHosts.forEach((host) => {
      countdownUpdates[host.id] = 45;
      if (onWakeHost) {
        try {
          const pkt = generateMagicPacket(host.mac, '255.255.255.255', 9);
          onWakeHost(pkt, host.id);
        } catch {
          onInspectWolPacket(host);
        }
      } else {
        onInspectWolPacket(host);
      }
    });
    setWakingCountdown((prev) => ({ ...prev, ...countdownUpdates }));
  }, [offlineHosts, onWakeHost, onInspectWolPacket]);

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

      if (activeFilter === 'online') return h.isOnline;
      if (activeFilter === 'sleeping') return !h.isOnline;
      if (activeFilter === 'servers')
        return h.deviceType === 'server' || h.id.includes('SERVER') || h.id.includes('SRV');
      if (activeFilter === 'quarantined') return quarantinedHosts.includes(h.id);
      return true;
    });

    return [...filtered].sort((a, b) => {
      const aPinned = pinnedHostIds.includes(a.id);
      const bPinned = pinnedHostIds.includes(b.id);
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
        const latA = a.isOnline ? (getLatencyConfig(a.ping, a.isOnline, a.id).latency ?? 9999) : 999999;
        const latB = b.isOnline ? (getLatencyConfig(b.ping, b.isOnline, b.id).latency ?? 9999) : 999999;

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

      return 0;
    });
  }, [activeFilter, hosts, deferredQuery, sortMode, sortDirection, pinnedHostIds, quarantinedHosts]);

  const sortOptions = [
    {
      id: 'alphabetical' as const,
      label: t('sort_name'),
      badge: sortDirection === 'asc' ? 'A→Z' : 'Z→A',
      icon: sortDirection === 'asc' ? ArrowDownAZ : ArrowUpAZ,
    },
    {
      id: 'status' as const,
      label: t('sort_status'),
      badge: sortDirection === 'asc' ? 'Online' : 'Sleep',
      icon: Activity,
    },
    {
      id: 'latency' as const,
      label: t('sort_latency'),
      badge: sortDirection === 'asc' ? 'Fast' : 'Slow',
      icon: Gauge,
    },
  ];
  const currentSortOption = sortOptions.find((o) => o.id === sortMode) || sortOptions[0];
  const CurrentSortIcon = currentSortOption.icon;

  return (
    <div id="fleet-dashboard-container" className="w-full flex flex-col select-none pb-2 relative">
      {/* Sleek Top App Bar & Unified Filter Controls */}
      <div className="pt-1 pb-3 flex flex-col gap-2.5 relative z-30">
        {/* Network Disconnection Banner */}
        {isNetworkDisconnected && (
          <div className="glass-liquid-subtle w-full px-3.5 py-2.5 border border-amber-500/40 rounded-xl flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate">{t('conn_disconnected')}</span>
            </div>
            {onReconnectNetwork && (
              <button
                type="button"
                onClick={onReconnectNetwork}
                className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/50 rounded-lg font-semibold transition shrink-0 active:scale-95"
              >
                {t('conn_reconnect')}
              </button>
            )}
          </div>
        )}

        {/* 1. NATIVE TOP APP BAR: Title & Live Status on Left | Primary Actions on Right */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0">
            <h1 className="text-fluid-title font-bold tracking-tight font-display text-white truncate">
              {t('fleet_title')}
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] font-medium tabular-nums mt-0.5">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-emerald-300 font-semibold">
                {onlineCount} {t('fleet_online')}
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-amber-300/90">
                {offlineCount} {t('fleet_sleeping')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {offlineCount > 0 && (
              <button
                type="button"
                onClick={handleWakeAllOffline}
                className="h-9 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-200 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                title={
                  language === 'bg'
                    ? `Събуди всички спящи хостове (${offlineCount})`
                    : `Wake all sleeping hosts (${offlineCount})`
                }
              >
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden xs:inline">
                  {language === 'bg' ? 'Събуди' : 'Wake All'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                openModal('quickSetup');
              }}
              className="h-9 px-2.5 sm:px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
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
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('selection');
                setViewMode((prev) => (prev === 'grid' ? 'topology' : 'grid'));
              }}
              className="w-9 h-9 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 flex items-center justify-center transition active:scale-95"
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
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                addHostHandler();
              }}
              className="h-9 px-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-100 font-semibold text-xs flex items-center gap-1.5 transition active:scale-95"
              title={t('fleet_add_host_tooltip')}
              aria-label={t('fleet_add_host_aria')}
            >
              <Plus className="w-4 h-4 text-cyan-300 shrink-0" />
              <span className="hidden xs:inline">
                {language === 'bg' ? 'Добави' : 'Add PC'}
              </span>
            </button>
          </div>
        </div>

        {/* 2. SEARCH + SCAN LAN + SORT ROW */}
        <div className={`flex items-center gap-2 relative ${isSortMenuOpen ? 'z-50' : 'z-20'}`}>
          <div className="flex-1 h-10 rounded-xl glass-liquid-subtle px-3 flex items-center gap-2 focus-within:border-cyan-400/60 transition min-w-0">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('fleet_search_placeholder')}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs sm:text-sm text-white placeholder-slate-500"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition"
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
                className="hidden lg:inline-flex px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-mono text-slate-300 border border-white/10 transition"
                title={t('fleet_spotlight_tooltip')}
              >
                ⌘K
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('medium');
              rescanHandler();
            }}
            disabled={isScanning}
            className="h-10 w-10 sm:w-auto sm:px-3 rounded-xl glass-liquid-subtle hover:border-cyan-400/45 text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-40 shrink-0 active:scale-95"
            title={t('fleet_rescan_tooltip')}
            aria-label={t('fleet_rescan_aria')}
          >
            <RefreshCw className={`w-4 h-4 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{language === 'bg' ? 'Сканирай' : 'Scan'}</span>
          </button>

          {/* Compact Sort Dropdown */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                setIsSortMenuOpen((prev) => !prev);
              }}
              className="h-10 px-2.5 sm:px-3 rounded-xl glass-liquid-subtle hover:border-cyan-400/45 flex items-center gap-1.5 text-xs font-medium text-slate-100 shrink-0 active:scale-95"
              title={`${t('sort_label')} ${currentSortOption.label}`}
              aria-label={`${t('sort_label')} ${currentSortOption.label}`}
            >
              <CurrentSortIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="hidden xs:inline font-semibold text-slate-200">
                {currentSortOption.label}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${
                  isSortMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            <AnimatePresence>
              {isSortMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-[90]"
                    onClick={() => setIsSortMenuOpen(false)}
                  />
                  <motion.div
                    variants={POPOVER_BUBBLE_VARIANTS}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="absolute right-0 top-11 z-[100] w-48 rounded-2xl dropdown-menu-surface p-1.5 space-y-1"
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
                          className={`w-full min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition ${
                            isActive
                              ? 'bg-cyan-500/20 text-cyan-200 font-semibold border border-cyan-400/30'
                              : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <OptIcon className="w-3.5 h-3.5 text-cyan-400" />
                            <span>{opt.label}</span>
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {opt.badge}
                          </span>
                        </button>
                      );
                    })}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 3. FILTER CHIPS ROW */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0 flex-1 py-0.5">
            {[
              { id: 'all', label: t('filter_all'), count: hosts.length },
              { id: 'online', label: t('filter_online'), count: onlineCount },
              { id: 'sleeping', label: t('filter_sleeping'), count: offlineCount },
              { id: 'servers', label: t('filter_servers'), count: null },
              ...(quarantinedHosts.length > 0
                ? [
                    {
                      id: 'quarantined',
                      label: language === 'bg' ? 'Карантина' : 'Quarantine',
                      count: quarantinedHosts.length,
                    },
                  ]
                : []),
            ].map((chip) => {
              const isActive = activeFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('selection');
                    setActiveFilter(chip.id as any);
                  }}
                  className={`h-8 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition flex items-center gap-1.5 shrink-0 border active:scale-95 ${
                    isActive
                      ? 'bg-gradient-to-b from-cyan-400/28 to-cyan-500/15 border-cyan-300/50 text-white font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                      : 'glass-liquid-subtle text-slate-300 hover:text-white'
                  }`}
                >
                  <span>{chip.label}</span>
                  {chip.count !== null && (
                    <span
                      className={`text-[10px] font-mono tabular-nums ${
                        isActive ? 'text-cyan-300' : 'text-slate-500'
                      }`}
                    >
                      {chip.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {onPanicKill && hosts.length > 0 && (
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('heavy');
                onPanicKill();
              }}
              className="h-8 px-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-300 text-[11px] font-semibold flex items-center gap-1 shrink-0 transition active:scale-95"
              title={t('fleet_panic_tooltip')}
              aria-label={t('fleet_panic_aria')}
            >
              <OctagonAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="hidden sm:inline">
                {language === 'bg' ? 'Авариен Стоп' : 'Kill Switch'}
              </span>
            </button>
          )}
        </div>
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
        <div className="glass-liquid rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center mx-auto max-w-md my-4">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-400/35 flex items-center justify-center text-cyan-300 mb-3">
            <Monitor className="w-6 h-6" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white tracking-tight font-display">
            {hosts.length === 0
              ? language === 'bg'
                ? 'Няма добавени компютри'
                : 'No Computers Added Yet'
              : t('empty_hosts_title')}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1.5 mb-5 leading-relaxed">
            {hosts.length === 0
              ? language === 'bg'
                ? 'Добавете своя компютър по IP и MAC адрес или сканирайте локалната мрежа за автоматично откриване.'
                : 'Add your computer by IP & MAC address, or scan your local network to discover active devices.'
              : t('empty_hosts_desc')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 w-full">
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="h-10 px-4 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 text-white border border-white/15 font-semibold text-xs transition"
              >
                {language === 'bg' ? 'Изчисти търсенето' : 'Clear Search'}
              </button>
            )}
            <button
              type="button"
              onClick={addHostHandler}
              className="h-10 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 active:scale-95 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>{language === 'bg' ? 'Добави компютър' : 'Add First PC'}</span>
            </button>
            {onRescan && (
              <button
                type="button"
                onClick={() => onRescan()}
                disabled={isScanning}
                className="h-10 px-4 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 active:scale-95 text-cyan-200 border border-cyan-400/35 font-semibold text-xs flex items-center gap-1.5 transition disabled:opacity-50"
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
              isPinned={pinnedHostIds.includes(host.id)}
              isQuarantined={quarantinedHosts.includes(host.id)}
              isCircuitTripped={circuitTrippedHosts.includes(host.id)}
              sortMode={sortMode}
              remainingWakeSeconds={wakingCountdown[host.id]}
              onSelect={onSelectHostSafe}
              onToggleExpand={toggleHostExpansion}
              onTogglePin={togglePinHost}
              onInspectWolPacket={onInspectWolPacket}
              onViewScreen={onViewScreen}
              onSelectForCommand={onSelectHostForCommand}
              onQuickCommand={onSendCommand}
              onDiagnoseHost={handleDiagnoseHost}
              onOpenDetailsModal={(dev) => openModal('hostDetails', dev)}
              onWakeClick={handleWakeClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FleetDashboard = React.memo(FleetDashboardComponent);
