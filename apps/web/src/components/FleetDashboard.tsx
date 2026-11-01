import React, { useState, useCallback, useEffect, useMemo, useDeferredValue, useRef } from 'react';
import {
  Plus,
  RefreshCw,
  Search,
  X,
  AlertTriangle,
  Wifi,
  ChevronDown,
  OctagonAlert,
  ArrowDownAZ,
  ArrowUpAZ,
  Activity,
  Gauge,
  LayoutGrid,
  Network,
  Zap,
  Download,
  Check,
  ShieldCheck,
  Monitor,
  QrCode,
  Sparkles,
} from 'lucide-react';
import { HostDevice, WolPacketPayload } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHapticFeedback } from '../services/hapticService';
import { useUIStore } from '../store/uiStore';
import { HostCard } from './HostCard';
import { LanguageToggle } from './ui/LanguageToggle';
import { generateMagicPacket } from '../services/wolService';
import { copyToClipboard } from '../utils/clipboard';
import { useTranslation, Language } from '../i18n/useTranslation';
import { SPRING_BUBBLY, SPRING_POP, POPOVER_BUBBLE_VARIANTS } from '../utils/springPhysics';

const LazyNetworkTopologyGraph = React.lazy(() =>
  import('./NetworkTopologyGraph').then((module) => ({
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
        colorDot: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
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
        colorDot: 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]',
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
        colorDot: 'bg-amber-400 shadow-[0_0_8px_#f59e0b]',
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
        colorDot: 'bg-rose-400 shadow-[0_0_8px_#f43f5e]',
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
  const addHostHandler = onOpenAddHostModal || onAddNewHost || (() => openModal('addHost'));
  const toggleOmnibar = useUIStore((s) => s.toggleOmnibar);
  const openModal = useUIStore((s) => s.openModal);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setPendingChatPrompt = useUIStore((s) => s.setPendingChatPrompt);
  const { t, language } = useTranslation();

  const [exportedFleetFeedback, setExportedFleetFeedback] = useState(false);

  const [expandedHostIds, setExpandedHostIds] = useState<Record<string, boolean>>(() => {
    return activeSelectedId ? { [activeSelectedId]: true } : {};
  });

  const [pinnedHostIds, setPinnedHostIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cst_pinned_hosts_v1');
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
        localStorage.setItem('cst_pinned_hosts_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const [viewMode, setViewMode] = useState<'grid' | 'topology'>(() => {
    try {
      const saved = localStorage.getItem('cst_fleet_view_mode');
      if (saved === 'grid' || saved === 'topology') return saved;
    } catch {}
    return 'grid';
  });

  const [showOnboardingBanner, setShowOnboardingBanner] = useState<boolean>(() => {
    try {
      return !localStorage.getItem('cst_onboarding_banner_dismissed');
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('cst_fleet_view_mode', viewMode);
    } catch {}
  }, [viewMode]);

  const toggleHostExpansion = useCallback((hostId: string) => {
    triggerHapticFeedback('light');
    setExpandedHostIds((prev) => ({
      ...prev,
      [hostId]: !prev[hostId],
    }));
  }, []);

  const lastSelectedHostRef = useRef<string | undefined>(selectedHostId);
  useEffect(() => {
    if (selectedHostId && selectedHostId !== lastSelectedHostRef.current) {
      lastSelectedHostRef.current = selectedHostId;
      setExpandedHostIds((prev) => ({ ...prev, [selectedHostId]: true }));
    }
  }, [selectedHostId]);

  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);

  const [activeFilter, setActiveFilter] = useState<'all' | 'online' | 'sleeping' | 'servers' | 'quarantined'>('all');
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

  // Native Pull-To-Refresh State
  const [pullY, setPullY] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef(0);
  const pullYRef = useRef(0);
  const pullRafRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pullYRef.current = pullY;
  }, [pullY]);

  const onlineCount = useMemo(() => hosts.filter((h) => h.isOnline).length, [hosts]);
  const offlineHosts = useMemo(() => hosts.filter((h) => !h.isOnline), [hosts]);
  const offlineCount = offlineHosts.length;

  const fleetHealthScore = useMemo(() => {
    if (hosts.length === 0) return 0;
    const onlineHosts = hosts.filter((h) => h.isOnline);
    if (onlineHosts.length === 0) return 0;
    const avgPing =
      onlineHosts.reduce((acc, h) => acc + (typeof h.ping === 'number' ? h.ping : 0), 0) /
      onlineHosts.length;
    const highLoadCount = onlineHosts.filter((h) => (h.cpuUsage ?? 0) >= 85 || (h.ramUsage ?? 0) >= 88).length;
    const score = Math.round(100 - Math.min(12, avgPing / 8) - highLoadCount * 2 - quarantinedHosts.length * 5);
    return Math.max(0, Math.min(100, score));
  }, [hosts, quarantinedHosts.length]);

  const handleDiagnoseHost = useCallback(
    (host: HostDevice) => {
      triggerHapticFeedback('medium');
      const prompt =
        language === 'bg'
          ? `Диагностицирай високото натоварване на хост ${host.name} (${host.ip}, OS: ${host.os}, CPU: ${host.cpuUsage ?? 78}%, RAM: ${host.ramUsage ?? 82}%). Предложи конкретни диагностични команди и оптимизации.`
          : `Diagnose the high resource load on host ${host.name} (${host.ip}, OS: ${host.os}, CPU: ${host.cpuUsage ?? 78}%, RAM: ${host.ramUsage ?? 82}%). Recommend specific diagnostic commands and remediation steps.`;
      setPendingChatPrompt(prompt);
      setActiveTab('chat');
    },
    [language, setPendingChatPrompt, setActiveTab]
  );

  const handleExportFleetJson = useCallback(() => {
    triggerHapticFeedback('light');
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      protocol: 'CST/3.0-SECURE',
      totalHosts: hosts.length,
      hosts: hosts.map((h) => ({
        id: h.id,
        name: h.name,
        ip: h.ip,
        mac: h.mac,
        os: h.os,
        deviceType: h.deviceType,
        tags: h.tags,
      })),
    };
    const jsonString = JSON.stringify(exportPayload, null, 2);
    copyToClipboard(jsonString);
    try {
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cst_fleet_manifest_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
    setExportedFleetFeedback(true);
    setTimeout(() => setExportedFleetFeedback(false), 2000);
  }, [hosts]);

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

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 5 || (containerRef.current && containerRef.current.scrollTop <= 5)) {
      startYRef.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;
    if (diff > 0) {
      if (pullRafRef.current) return;
      pullRafRef.current = requestAnimationFrame(() => {
        pullRafRef.current = null;
        const clamped = Math.min(diff * 0.45, 90);
        setPullY((prev) => {
          const next = Math.max(prev, clamped);
          if (next >= 60 && pullYRef.current < 60) {
            triggerHapticFeedback('light');
          }
          pullYRef.current = next;
          return next;
        });
      });
    }
  };

  const handleTouchEnd = () => {
    if (pullRafRef.current) {
      cancelAnimationFrame(pullRafRef.current);
      pullRafRef.current = null;
    }
    if (!isPulling) return;
    setIsPulling(false);
    const currentPullY = pullYRef.current;
    if (currentPullY >= 60 && !isRefreshing) {
      setIsRefreshing(true);
      triggerHapticFeedback('medium');
      onRescan?.();
      setTimeout(() => {
        setIsRefreshing(false);
        setPullY(0);
        pullYRef.current = 0;
      }, 1000);
    } else {
      setPullY(0);
      pullYRef.current = 0;
    }
  };

  useEffect(() => {
    return () => {
      if (pullRafRef.current) {
        cancelAnimationFrame(pullRafRef.current);
      }
    };
  }, []);

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
      if (activeFilter === 'quarantined')
        return quarantinedHosts.includes(h.id);
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
          return sortDirection === 'asc'
            ? a.isOnline ? -1 : 1
            : a.isOnline ? 1 : -1;
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
          return sortDirection === 'asc' ? (a.isOnline ? -1 : 1) : (a.isOnline ? 1 : -1);
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      return 0;
    });
  }, [activeFilter, hosts, deferredQuery, sortMode, sortDirection, pinnedHostIds, quarantinedHosts]);

  const areAllFilteredExpanded = useMemo(() => {
    if (filteredHosts.length === 0) return false;
    return filteredHosts.every((h) => !!expandedHostIds[h.id]);
  }, [filteredHosts, expandedHostIds]);

  const handleToggleExpandAll = useCallback(() => {
    triggerHapticFeedback('light');
    if (areAllFilteredExpanded) {
      setExpandedHostIds({});
    } else {
      const next: Record<string, boolean> = {};
      filteredHosts.forEach((h) => {
        next[h.id] = true;
      });
      setExpandedHostIds(next);
    }
  }, [areAllFilteredExpanded, filteredHosts]);

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
    <div
      id="fleet-dashboard-container"
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="w-full flex flex-col select-none pb-4 relative"
    >
      {/* Native-Grade Pull-to-Refresh Physics Spinner */}
      <AnimatePresence>
        {(pullY > 0 || isRefreshing) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{
              opacity: 1,
              height: isRefreshing ? 54 : pullY,
            }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="w-full flex items-center justify-center overflow-hidden"
          >
            <div className="bg-[#070c18]/90 backdrop-blur-3xl border border-cyan-400/30 flex items-center space-x-2.5 px-4 py-2 rounded-full text-cyan-300 text-xs font-semibold shadow-lg">
              <RefreshCw
                className={`w-4 h-4 text-cyan-400 ${
                  isRefreshing || isScanning || pullY >= 60 ? 'animate-spin' : ''
                }`}
                style={{
                  transform: !isRefreshing && !isScanning ? `rotate(${pullY * 3}deg)` : undefined,
                }}
              />
              <span>
                {isRefreshing || isScanning
                  ? t('pull_scanning')
                  : pullY >= 60
                  ? t('pull_release')
                  : t('pull_down')}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Streamlined Top Header & Unified Search/Filter Bar */}
      <div className="pt-1.5 pb-4 px-0.5 flex flex-col space-y-2.5">
        {/* Network Disconnection Banner */}
        {isNetworkDisconnected && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#070c18]/90 backdrop-blur-3xl w-full px-4 py-3 border border-amber-500/40 rounded-2xl flex items-center justify-between text-xs text-amber-200 shadow-lg"
          >
            <div className="flex items-center space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{t('conn_disconnected')}</span>
            </div>
            {onReconnectNetwork && (
              <button
                type="button"
                onClick={onReconnectNetwork}
                className="min-h-[44px] px-4 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-400/50 rounded-full font-semibold transition flex items-center justify-center cursor-pointer"
              >
                {t('conn_reconnect')}
              </button>
            )}
          </motion.div>
        )}

        {/* Onboarding Quick Guide Banner */}
        {showOnboardingBanner && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="w-full p-3.5 rounded-2xl bg-gradient-to-r from-violet-950/40 via-cyan-950/30 to-[#070c18] border border-violet-500/30 shadow-[0_8px_24px_rgba(139,92,246,0.12)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-400/40 flex items-center justify-center text-violet-300 shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white tracking-tight">
                    {language === 'bg' ? 'Добре дошли в CST NetController AI' : 'Welcome to CST NetController AI'}
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-violet-500/20 text-violet-300">
                    {language === 'bg' ? 'Първи стъпки' : 'Quick Start'}
                  </span>
                </div>
                <p className="text-[11.5px] text-white/60 truncate sm:whitespace-normal">
                  {language === 'bg'
                    ? 'Започнете с интерактивната обиколка, свържете вашия PC демон или сканирайте QR код.'
                    : 'Explore the 5-step interactive tour, pair your local PC daemon, or scan phone QR.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  openModal('onboarding');
                }}
                className="px-3 py-1.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-violet-300" />
                <span>{language === 'bg' ? 'Старт на Обиколката' : 'Start Tour'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowOnboardingBanner(false);
                  try {
                    localStorage.setItem('cst_onboarding_banner_dismissed', 'true');
                  } catch {}
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition cursor-pointer"
                title={language === 'bg' ? 'Скрий' : 'Dismiss'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* 1. HEADER ROW: Title + Inline Non-Wrapping Status Pill + Health Pill on Left | Wake All + Cards/Map + EN/BG on Right */}
        <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap sm:flex-nowrap">
            <h1 className="text-fluid-title font-black tracking-tight font-display truncate bg-gradient-to-r from-white via-cyan-100 to-cyan-400 bg-clip-text text-transparent drop-shadow-[0_2px_14px_rgba(0,229,255,0.35)]">
              {t('fleet_title')}
            </h1>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#060c1c]/95 backdrop-blur-3xl border border-cyan-400/30 text-[11px] font-medium whitespace-nowrap shrink-0 shadow-[0_8px_24px_rgba(0,0,0,0.6),0_0_16px_rgba(0,229,255,0.15)] tabular-nums">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#10b981] animate-pulse" />
              <span className="text-emerald-300 font-bold drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]">
                {onlineCount} {t('fleet_online')}
              </span>
              <span className="text-white/30">•</span>
              <span className="text-amber-300/90 font-medium">
                {offlineCount} {t('fleet_sleeping')}
              </span>
            </div>
            <div
              className="group hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/50 text-[10.5px] font-mono font-bold text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.25)] whitespace-nowrap shrink-0"
              title={
                language === 'bg'
                  ? 'Индекс на здравето на мрежата (RTT + натоварване + сигурност)'
                  : 'Real-time Fleet Network Health Index (RTT + load + security)'
              }
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 icon-bubbly drop-shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
              <span>{fleetHealthScore}% {language === 'bg' ? 'Здраве' : 'Health'}</span>
            </div>
          </div>

          {/* Right Header Controls: Wraps cleanly on mobile without overflowing */}
          <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap shrink-0 max-w-full justify-end ml-auto">
            {offlineCount > 0 && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.05, y: -1.5 }}
                whileTap={{ scale: 0.92 }}
                transition={SPRING_POP}
                onClick={handleWakeAllOffline}
                className="group min-h-[44px] px-3.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-[0_0_16px_rgba(245,158,11,0.2)] transition transform-gpu"
                title={
                  language === 'bg'
                    ? `Събуди всички спящи хостове (${offlineCount})`
                    : `Wake all sleeping hosts (${offlineCount})`
                }
              >
                <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/30 icon-bolt-live" />
                <span className="font-display">
                  {language === 'bg' ? `Събуди (${offlineCount})` : `Wake All (${offlineCount})`}
                </span>
              </motion.button>
            )}

            {/* [ ✨ App Tour ] Guided Onboarding Walkthrough */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.05, y: -1.5 }}
              whileTap={{ scale: 0.92 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                openModal('onboarding');
              }}
              className="group min-h-[44px] px-3 rounded-full bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/40 text-violet-300 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-[0_0_16px_rgba(168,85,247,0.18)] transition transform-gpu"
              title={
                language === 'bg'
                  ? 'Интерактивна обиколка на възможностите на системата'
                  : 'Interactive App Tour & Onboarding Walkthrough'
              }
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-400 icon-bubbly" />
              <span className="hidden sm:inline font-display">
                {language === 'bg' ? 'Обиколка' : 'Tour'}
              </span>
            </motion.button>

            {/* [ 📱 Quick Setup (Phone + PC) ] 1-Click Setup & QR Pairing Wizard */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.05, y: -1.5 }}
              whileTap={{ scale: 0.92 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                openModal('quickSetup');
              }}
              className="group min-h-[44px] px-3 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-[0_0_16px_rgba(16,185,129,0.18)] transition transform-gpu"
              title={
                language === 'bg'
                  ? 'Бърза Настройка с 1 Клик: Свържи Телефон (QR/APK) и Компютър (.EXE)'
                  : '1-Click Easy Setup: Connect Phone (QR/APK) & PC (.EXE)'
              }
            >
              <QrCode className="w-3.5 h-3.5 text-emerald-400 icon-bubbly" />
              <span className="hidden xs:inline font-display">
                {language === 'bg' ? 'Бърз Старт' : 'Quick Setup'}
              </span>
            </motion.button>

            {/* [ 🖥️ PC Daemon GUI ] Native Control Center Launcher */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.05, y: -1.5 }}
              whileTap={{ scale: 0.92 }}
              transition={SPRING_POP}
              onClick={() => {
                triggerHapticFeedback('light');
                openModal('pcDaemonGui');
              }}
              className="group min-h-[44px] px-3 rounded-full bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-[0_0_16px_rgba(34,211,238,0.18)] transition transform-gpu"
              title={
                language === 'bg'
                  ? 'Отвори Графичния Контролен Център на PC Демона (Антивирус-Верифициран)'
                  : 'Open PC Daemon Desktop Control Center GUI (AV-Verified)'
              }
            >
              <Monitor className="w-3.5 h-3.5 text-cyan-400 icon-bubbly" />
              <span className="hidden sm:inline font-display">
                {language === 'bg' ? 'PC Демон' : 'PC Daemon'}
              </span>
            </motion.button>

            {/* [Cards | Map] Segmented Toggle (Tier 2 Floating Chrome) */}
            <div className="bg-[#070c18]/90 backdrop-blur-3xl backdrop-saturate-[190%] border border-white/15 border-t-white/25 p-1 rounded-full flex items-center relative shadow-[0_16px_40px_rgba(0,0,0,0.8)] transform-gpu">
              {(['grid', 'topology'] as const).map((mode) => {
                const isActive = viewMode === mode;
                const Icon = mode === 'grid' ? LayoutGrid : Network;
                const label = mode === 'grid' ? t('fleet_view_cards') : t('fleet_view_topology');
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      triggerHapticFeedback('selection');
                      setViewMode(mode);
                    }}
                    className={`group relative min-h-[36px] px-2.5 rounded-full text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer z-10 whitespace-nowrap ${
                      isActive ? 'text-cyan-300 font-semibold' : 'text-white/55 hover:text-white'
                    }`}
                    title={label}
                    aria-label={label}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="fleetViewModeLens"
                        className="absolute inset-0 rounded-full bg-cyan-500/20 border border-cyan-400/35 shadow-[0_0_12px_rgba(56,189,248,0.2)] -z-10 transform-gpu"
                        transition={SPRING_BUBBLY}
                      />
                    )}
                    <motion.div
                      animate={
                        isActive
                          ? { scale: 1.15, rotate: mode === 'grid' ? -6 : 8 }
                          : { scale: 1, rotate: 0 }
                      }
                      transition={SPRING_POP}
                      className="flex items-center justify-center transform-gpu"
                    >
                      <Icon className="w-3.5 h-3.5 icon-bubbly" />
                    </motion.div>
                    <span className="hidden sm:inline font-display">{label}</span>
                  </button>
                );
              })}
            </div>

            {/* [EN/BG] Language Switch */}
            <LanguageToggle className="!min-h-[44px] !h-11 !px-3" />

            {/* Optional Emergency Panic Kill Button */}
            {onPanicKill && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.07, rotate: -6 }}
                whileTap={{ scale: 0.9 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('heavy');
                  onPanicKill();
                }}
                className="group min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-rose-500/15 border border-rose-500/35 hover:bg-rose-500/25 text-rose-400 flex items-center justify-center transition shrink-0 cursor-pointer transform-gpu"
                title={t('fleet_panic_tooltip')}
                aria-label={t('fleet_panic_aria')}
              >
                <OctagonAlert className="w-4 h-4 stroke-[2.1] icon-bubbly" />
              </motion.button>
            )}
          </div>
        </div>

        {/* 2. UNIFIED SEARCH + REFRESH + EXPORT + ADD HOST ROW */}
        <div className="flex items-center gap-2">
          <div className="group flex-1 min-h-[44px] h-11 rounded-xl bg-[#070c18]/90 backdrop-blur-3xl backdrop-saturate-[190%] border border-white/15 border-t-white/25 shadow-[0_16px_40px_rgba(0,0,0,0.8)] px-3 flex items-center gap-2 focus-within:border-cyan-400/50 transition min-w-0 transform-gpu">
            <Search className="w-4 h-4 text-cyan-400/80 shrink-0 icon-bubbly" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('fleet_search_placeholder')}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs sm:text-sm text-white placeholder-white/40"
            />
            {filteredHosts.length !== hosts.length && (
              <span className="text-[10px] font-mono text-cyan-300/80 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/30 shrink-0 tabular-nums">
                {filteredHosts.length}/{hosts.length}
              </span>
            )}
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition cursor-pointer"
                aria-label={t('fleet_clear_search')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    toggleOmnibar();
                  }}
                  className="px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[10px] font-mono text-cyan-300/90 border border-white/10 transition cursor-pointer"
                  title={t('fleet_spotlight_tooltip')}
                  aria-label={t('fleet_spotlight_aria')}
                >
                  ⌘K
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    openModal('shortcuts');
                  }}
                  className="px-1.5 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[10px] font-mono text-white/50 hover:text-white border border-white/10 transition cursor-pointer"
                  title={language === 'bg' ? 'Бързи Клавиши [?]' : 'Keyboard Shortcuts [?]'}
                  aria-label="Shortcuts"
                >
                  ?
                </button>
              </div>
            )}
          </div>

          {/* [Refresh] Button */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05, y: -1.5 }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_POP}
            onClick={() => {
              triggerHapticFeedback('medium');
              rescanHandler();
            }}
            disabled={isScanning}
            className="group min-h-[44px] min-w-[44px] h-11 px-3 rounded-xl bg-[#070c18]/90 backdrop-blur-3xl border border-white/15 border-t-white/25 hover:border-cyan-400/40 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-40 cursor-pointer shrink-0 shadow-[0_16px_40px_rgba(0,0,0,0.8)] transform-gpu"
            title={`${t('fleet_rescan_tooltip')} [R]`}
            aria-label={t('fleet_rescan_aria')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : 'icon-spin-bubbly'}`} />
            <span className="hidden sm:inline font-display">{language === 'bg' ? 'Обнови' : 'Refresh'}</span>
          </motion.button>

          {/* [Export Fleet JSON] Button */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05, y: -1.5 }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_POP}
            onClick={handleExportFleetJson}
            className="group hidden sm:inline-flex min-h-[44px] h-11 px-3 rounded-xl bg-[#070c18]/90 backdrop-blur-3xl border border-white/15 border-t-white/25 hover:border-cyan-400/40 text-white/80 hover:text-cyan-200 text-xs font-semibold items-center justify-center gap-1.5 transition cursor-pointer shrink-0 shadow-[0_16px_40px_rgba(0,0,0,0.8)] transform-gpu"
            title={language === 'bg' ? 'Експортирай JSON манифест на флота' : 'Export Fleet JSON manifest'}
          >
            {exportedFleetFeedback ? (
              <Check className="w-3.5 h-3.5 text-emerald-400 icon-bubbly" />
            ) : (
              <Download className="w-3.5 h-3.5 text-cyan-400 icon-bubbly" />
            )}
            <span className="hidden md:inline font-display">
              {exportedFleetFeedback
                ? language === 'bg'
                  ? 'Експортирано'
                  : 'Exported'
                : 'JSON'}
            </span>
          </motion.button>

          {/* [+ Add Host] Button */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05, y: -1.5 }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_POP}
            onClick={() => {
              triggerHapticFeedback('light');
              addHostHandler();
            }}
            className="group min-h-[44px] h-11 px-3.5 rounded-xl bg-gradient-to-r from-emerald-500/30 via-teal-500/25 to-cyan-500/25 hover:from-emerald-500/45 hover:to-cyan-500/35 border border-emerald-400/60 text-emerald-200 font-bold text-xs flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer shrink-0 shadow-[0_0_24px_rgba(16,185,129,0.38)] transform-gpu"
            title={t('fleet_add_host_tooltip')}
            aria-label={t('fleet_add_host_aria')}
          >
            <Plus className="w-4 h-4 stroke-[2.5] icon-plus-bubbly" />
            <span className="hidden xs:inline font-display">{language === 'bg' ? 'Добави хост' : 'Add Host'}</span>
          </motion.button>
        </div>

        {/* 3. HORIZONTAL FILTER PILLS + EXPAND/COLLAPSE ALL + COMPACT SORT DROPDOWN PILL */}
        <div className="flex items-center justify-between gap-2">
          {/* Filter Pills (All, Online, Sleeping, Servers, Quarantined) */}
          <div className="bg-[#060c1c]/95 backdrop-blur-3xl border border-cyan-400/25 border-t-white/30 shadow-[0_16px_40px_rgba(0,0,0,0.8),0_0_20px_rgba(0,229,255,0.12)] p-1 rounded-full flex items-center gap-0.5 overflow-x-auto scrollbar-none min-w-0 max-w-full flex-1 sm:flex-initial transform-gpu">
            {[
              { id: 'all', label: t('filter_all'), count: hosts.length },
              { id: 'online', label: t('filter_online'), count: onlineCount },
              { id: 'sleeping', label: t('filter_sleeping'), count: offlineCount },
              { id: 'servers', label: t('filter_servers'), count: null },
              ...(quarantinedHosts.length > 0
                ? [{ id: 'quarantined', label: language === 'bg' ? 'Карантина' : 'Quarantine', count: quarantinedHosts.length }]
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
                  className={`relative min-h-[36px] px-3 rounded-full text-[11px] sm:text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer z-10 ${
                    isActive ? 'text-cyan-200 font-semibold' : 'text-white/55 hover:text-white'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="fleetFilterLens"
                      className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-500/25 to-sky-500/20 border border-cyan-400/40 shadow-[0_0_12px_rgba(56,189,248,0.2)] -z-10 transform-gpu"
                      transition={SPRING_BUBBLY}
                    />
                  )}
                  <span>{chip.label}</span>
                  {chip.count !== null && (
                    <span className={`text-[10px] font-mono tabular-nums ${isActive ? 'text-cyan-300/90' : 'text-white/35'}`}>
                      {chip.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* QoL: 1-Tap Expand All / Collapse All Bento Drawers */}
            {viewMode === 'grid' && filteredHosts.length > 1 && (
              <button
                type="button"
                onClick={handleToggleExpandAll}
                className="hidden sm:inline-flex bg-[#070c18]/90 backdrop-blur-3xl border border-white/15 border-t-white/25 hover:border-cyan-400/35 min-h-[40px] px-3 rounded-full items-center gap-1 text-[11px] font-medium text-white/65 hover:text-cyan-200 transition cursor-pointer whitespace-nowrap shadow-[0_16px_40px_rgba(0,0,0,0.8)] transform-gpu"
                title={
                  areAllFilteredExpanded
                    ? language === 'bg'
                      ? 'Свий всички карти'
                      : 'Collapse all cards'
                    : language === 'bg'
                    ? 'Разгъни всички карти'
                    : 'Expand all cards'
                }
              >
                <span>
                  {areAllFilteredExpanded
                    ? language === 'bg'
                      ? 'Свий всички'
                      : 'Collapse All'
                    : language === 'bg'
                    ? 'Разгъни всички'
                    : 'Expand All'}
                </span>
              </button>
            )}

            {/* Single Compact Sort Dropdown Pill (Sort: Name ▾) */}
            <div className="relative shrink-0">
              <motion.button
                type="button"
                whileHover={{ scale: 1.04, y: -1 }}
                whileTap={{ scale: 0.93 }}
                transition={SPRING_POP}
                onClick={() => {
                  triggerHapticFeedback('light');
                  setIsSortMenuOpen((prev) => !prev);
                }}
                className="bg-[#070c18]/90 backdrop-blur-3xl backdrop-saturate-[190%] border border-white/15 border-t-white/25 min-h-[40px] px-3 rounded-full flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-cyan-200 hover:text-white cursor-pointer whitespace-nowrap shadow-[0_16px_40px_rgba(0,0,0,0.8)] transform-gpu"
                title={t('sort_title_template', {
                  mode: currentSortOption.label,
                  badge: currentSortOption.badge,
                })}
                aria-label={`${t('sort_label')} ${currentSortOption.label}`}
              >
                <CurrentSortIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-white/55">{language === 'bg' ? 'Сорт:' : 'Sort:'}</span>
                <span className="font-semibold text-cyan-200">{currentSortOption.label}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-white/50 transition-transform duration-200 ${
                    isSortMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </motion.button>

              <AnimatePresence>
                {isSortMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsSortMenuOpen(false)}
                    />
                    {/* Tier 3 Dropdown Surface */}
                    <motion.div
                      variants={POPOVER_BUBBLE_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="absolute right-0 top-11 z-50 w-48 rounded-2xl bg-[#091020]/96 backdrop-blur-3xl border border-white/15 border-t-white/25 p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.9)] space-y-1 transform-gpu"
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
                            className={`w-full min-h-[40px] px-3 py-2 rounded-xl text-xs flex items-center justify-between transition cursor-pointer ${
                              isActive
                                ? 'bg-cyan-500/20 text-cyan-200 font-semibold border border-cyan-400/30'
                                : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <OptIcon className="w-3.5 h-3.5 text-cyan-400" />
                              <span>{opt.label}</span>
                            </span>
                            <span className="text-[10px] font-mono text-white/50">
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
        </div>
      </div>

      {/* Interaction Area: D3 Force-Directed Network Topology or Responsive Multi-Column Cards Grid */}
      {viewMode === 'topology' ? (
        <motion.div
          key="topology-view"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.16 }}
          className="px-0.5"
        >
          <React.Suspense
            fallback={
              <div
                className="grid min-h-[320px] place-items-center"
                aria-busy="true"
              >
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
        </motion.div>
      ) : filteredHosts.length === 0 ? (
        <div className="rounded-3xl bg-[#0b1324]/65 backdrop-blur-2xl border border-white/10 p-8 sm:p-12 flex flex-col items-center justify-center text-center mx-auto max-w-lg my-6 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-400/25 flex items-center justify-center text-cyan-400 mb-4 shadow-[0_0_25px_rgba(34,211,238,0.2)]">
            <Monitor className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white tracking-tight">
            {hosts.length === 0
              ? language === 'bg'
                ? 'Няма добавени компютри'
                : 'No Computers Added Yet'
              : t('empty_hosts_title')}
          </h3>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mt-2 mb-6 leading-relaxed">
            {hosts.length === 0
              ? language === 'bg'
                ? 'Флотът ви е чист. Натиснете „Добави компютър“, за да въведете своя компютър, или сканирайте мрежата за автоматично откриване на хостове.'
                : 'Your fleet is ready for setup. Add your computer by entering its IP & MAC address, or scan your local network to discover devices.'
              : t('empty_hosts_desc')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 border border-white/15 font-semibold text-xs transition cursor-pointer"
              >
                {language === 'bg' ? 'Изчисти търсенето' : 'Clear Search'}
              </button>
            )}
            <button
              type="button"
              onClick={addHostHandler}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs flex items-center space-x-2 shadow-lg shadow-cyan-500/25 transition cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>{language === 'bg' ? 'Добави компютър' : 'Add First PC'}</span>
            </button>
            {onRescan && (
              <button
                type="button"
                onClick={() => onRescan()}
                disabled={isScanning}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-300 border border-cyan-500/30 font-semibold text-xs flex items-center space-x-2 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? (language === 'bg' ? 'Сканиране...' : 'Scanning...') : (language === 'bg' ? 'Сканирай мрежата' : 'Scan Network')}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: {
                staggerChildren: 0.045,
              },
            },
          }}
          className="fleet-responsive-grid gap-3.5 items-start px-0.5"
        >
          <AnimatePresence mode="popLayout">
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
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
};

export const FleetDashboard = React.memo(FleetDashboardComponent);

