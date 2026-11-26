import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  select,
  zoom,
  zoomIdentity,
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  drag,
  timer,
  transition as d3Transition,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  type ZoomBehavior,
} from 'd3';
import {
  Activity,
  Maximize2,
  Minimize2,
  RotateCcw,
  Zap,
  Power,
  Shield,
  Server,
  Monitor,
  Play,
  Pause,
  Network,
  Copy,
  Check,
} from 'lucide-react';
import { HostDevice } from '../../types';
import { triggerHapticFeedback } from '../../services/hapticService';
import { copyToClipboard } from '../../utils/clipboard';
import { useTranslation } from '../../i18n/useTranslation';
import { computeViewportMetrics } from '../../utils/viewportScale';
import { useUIStore } from '../../store/uiStore';

// Ensure d3-transition registers Selection.prototype.transition cleanly under tree-shaking
void d3Transition;

export interface TopologyNode extends SimulationNodeDatum {
  id: string;
  name: string;
  ip: string;
  mac: string;
  os: 'windows' | 'linux' | 'controller';
  deviceType: 'pc' | 'laptop' | 'server' | 'gateway';
  isOnline: boolean;
  ping?: number;
  cpu?: number;
  ram?: number;
  tags?: string[];
  isController?: boolean;
  isQuarantined?: boolean;
  isCircuitTripped?: boolean;
}

export interface TopologyLink extends SimulationLinkDatum<TopologyNode> {
  source: string | TopologyNode;
  target: string | TopologyNode;
  latency: number;
  health: 'healthy' | 'warning' | 'offline';
  linkType: 'uplink' | 'peer' | 'lab_mesh';
  throughputMbps?: number;
}

interface NetworkTopologyGraphProps {
  hosts: HostDevice[];
  selectedHostId?: string;
  quarantinedHosts?: string[];
  circuitTrippedHosts?: string[];
  onSelectHost?: (hostId: string) => void;
  onSendWol?: (device: HostDevice) => void;
  onViewScreen?: (device: HostDevice) => void;
  className?: string;
}

export const NetworkTopologyGraph: React.FC<NetworkTopologyGraphProps> = ({
  hosts,
  selectedHostId,
  quarantinedHosts = [],
  circuitTrippedHosts = [],
  onSelectHost,
  onSendWol,
  onViewScreen,
  className = '',
}) => {
  const { language } = useTranslation();
  const themeMode = useUIStore((s) => s.themeMode);
  const isLight = themeMode === 'light';
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<Simulation<TopologyNode, TopologyLink> | null>(null);

  const [activeNode, setActiveNode] = useState<TopologyNode | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'online' | 'servers'>('all');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const onSelectHostRef = useRef(onSelectHost);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    onSelectHostRef.current = onSelectHost;
  }, [onSelectHost]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Topology Signature - Changes ONLY when structural/identity updates occur (not selection clicks)
  const topologySignature = useMemo(() => {
    return (
      hosts
        .map(
          (h) =>
            `${h.id}-${h.name}-${h.ip}-${h.mac}-${h.isOnline}-${h.deviceType}-${quarantinedHosts.includes(
              h.id
            )}-${circuitTrippedHosts.includes(h.id)}`
        )
        .join('|') + `_${filterMode}`
    );
  }, [hosts, filterMode, quarantinedHosts, circuitTrippedHosts]);

  // Construct Topology Graph Data (Real Managed Hosts & Subnet Links Only)
  const graphData = useMemo(() => {
    const visibleHosts = hosts.filter((h) => {
      if (filterMode === 'online') return h.isOnline;
      if (filterMode === 'servers') return h.deviceType === 'server' || h.id.includes('SRV');
      return true;
    });

    const hostNodes: TopologyNode[] = visibleHosts.map((h) => ({
      id: h.id,
      name: h.name,
      ip: h.ip,
      mac: h.mac,
      os: h.os,
      deviceType: h.deviceType || (h.id.includes('SRV') ? 'server' : 'pc'),
      isOnline: h.isOnline,
      ping: h.ping,
      cpu: h.cpuUsage ?? h.cpu,
      ram: h.ramUsage ?? h.ram,
      tags: h.tags || [],
      isController: false,
      isQuarantined: quarantinedHosts.includes(h.id),
      isCircuitTripped: circuitTrippedHosts.includes(h.id),
    }));

    const links: TopologyLink[] = [];
    const subnetOf = (ip?: string) => (ip ? ip.split('.').slice(0, 3).join('.') : '');

    for (let i = 0; i < hostNodes.length; i++) {
      for (let j = i + 1; j < hostNodes.length; j++) {
        const a = hostNodes[i];
        const b = hostNodes[j];
        const sharedTag = a.tags?.some((tag) => b.tags?.includes(tag));
        const sameSubnet = Boolean(subnetOf(a.ip) && subnetOf(a.ip) === subnetOf(b.ip));
        if (sharedTag || sameSubnet || hostNodes.length <= 4) {
          const anyOffline = !a.isOnline || !b.isOnline;
          const maxPing = Math.max(a.ping ?? 0, b.ping ?? 0);
          const health: TopologyLink['health'] = anyOffline
            ? 'offline'
            : maxPing <= 25
            ? 'healthy'
            : 'warning';
          links.push({
            source: a.id,
            target: b.id,
            latency: anyOffline ? 999 : Math.max(1, Math.round(((a.ping ?? 1) + (b.ping ?? 1)) / 2)),
            health,
            linkType: sharedTag ? 'lab_mesh' : 'peer',
            throughputMbps: anyOffline ? 0 : 1000,
          });
        }
      }
    }

    return { nodes: hostNodes, links };
  }, [topologySignature]);

  // Update telemetry & selection highlight live without D3 teardown
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = select(svgRef.current);

    svg.selectAll('.node-latency-badge').text((d: any) => {
      if (d.isController) return `${d.ping ?? 0}ms • ${d.ip}`;
      const host = hosts.find((h) => h.id === d.id);
      if (!host || !host.isOnline) return `OFFLINE • ${d.ip}`;
      return typeof host.ping === 'number' ? `${host.ping}ms • ${d.ip}` : `ONLINE • ${d.ip}`;
    });

    svg
      .selectAll('.node-outer-ring')
      .attr('stroke-width', (d: any) => (d.id === selectedHostId ? 3.5 : 1.75))
      .attr('stroke', (d: any) => {
        if (d.isController) return '#38bdf8';
        const host = hosts.find((h) => h.id === d.id);
        if (quarantinedHosts.includes(d.id) || circuitTrippedHosts.includes(d.id)) return '#f43f5e';
        if (!host || !host.isOnline) return isLight ? 'rgba(99,102,241,0.28)' : 'rgba(255,255,255,0.20)';
        return (host.ping ?? 10) <= 25 ? (isLight ? '#7c3aed' : '#22d3ee') : '#f59e0b';
      });
  }, [hosts, quarantinedHosts, circuitTrippedHosts, selectedHostId, isLight]);

  // Aggregate Topology Metrics
  const metrics = useMemo(() => {
    const visibleHosts = hosts.filter((h) => {
      if (filterMode === 'online') return h.isOnline;
      if (filterMode === 'servers') return h.deviceType === 'server' || h.id.includes('SRV');
      return true;
    });
    const total = visibleHosts.length;
    const online = visibleHosts.filter((h) => h.isOnline).length;
    const pings = visibleHosts
      .filter((h) => h.isOnline && typeof h.ping === 'number' && Number.isFinite(h.ping))
      .map((h) => h.ping!);
    const avgPing =
      pings.length > 0 ? (pings.reduce((a, b) => a + b, 0) / pings.length).toFixed(1) : null;
    return { total, online, sleeping: total - online, avgPing };
  }, [hosts, filterMode]);

  // Reset / Re-center View
  const handleResetZoom = useCallback(() => {
    triggerHapticFeedback('light');
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    select(svgRef.current)
      .transition()
      .duration(500)
      .call(zoomBehaviorRef.current.transform, zoomIdentity);
  }, []);

  // Main D3 Force Simulation Setup
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;

    const svg = select(svgRef.current);
    svg.selectAll('*').remove();

    // Definitions for gradients & glowing drop-shadow filters
    const defs = svg.append('defs');

    // Glow filter for healthy nodes
    const glowFilter = defs.append('filter')
      .attr('id', 'neon-glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    glowFilter.append('feGaussianBlur')
      .attr('stdDeviation', '4')
      .attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Gateway node gradient
    const gatewayGrad = defs.append('radialGradient')
      .attr('id', 'grad-gateway');
    gatewayGrad.append('stop').attr('offset', '0%').attr('stop-color', '#38bdf8');
    gatewayGrad.append('stop').attr('offset', '100%').attr('stop-color', '#0284c7');

    // Online node gradient
    const onlineGrad = defs.append('radialGradient')
      .attr('id', 'grad-online');
    onlineGrad.append('stop').attr('offset', '0%').attr('stop-color', isLight ? '#a855f7' : '#38bdf8');
    onlineGrad.append('stop').attr('offset', '100%').attr('stop-color', isLight ? '#6366f1' : '#0891b2');

    // Warning node gradient
    const warningGrad = defs.append('radialGradient')
      .attr('id', 'grad-warning');
    warningGrad.append('stop').attr('offset', '0%').attr('stop-color', '#fbbf24');
    warningGrad.append('stop').attr('offset', '100%').attr('stop-color', '#d97706');

    // Sleeping node gradient
    const sleepingGrad = defs.append('radialGradient')
      .attr('id', 'grad-sleeping');
    sleepingGrad.append('stop').attr('offset', '0%').attr('stop-color', isLight ? '#cbd5e1' : '#475569');
    sleepingGrad.append('stop').attr('offset', '100%').attr('stop-color', isLight ? '#94a3b8' : '#1e293b');

    // Zoom container root group
    const g = svg.append('g').attr('class', 'topology-zoom-group');

    // Zoom Behavior with smooth clamping
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 3.5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    zoomBehaviorRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    // Deep copy nodes and links so D3 doesn't mutate React state directly
    const nodesCopy: TopologyNode[] = graphData.nodes.map((d) => ({ ...d }));
    const linksCopy: TopologyLink[] = graphData.links.map((d) => ({
      ...d,
      source: typeof d.source === 'object' && d.source !== null ? (d.source as any).id : d.source,
      target: typeof d.target === 'object' && d.target !== null ? (d.target as any).id : d.target,
    }));

    // Create Aspect-Ratio Adaptive D3 Force Simulation
    const vpMetrics = computeViewportMetrics(width, height);
    const forceCfg = vpMetrics.topologyForceConfig;

    const simulation = forceSimulation<TopologyNode, TopologyLink>(nodesCopy)
      .force(
        'link',
        forceLink<TopologyNode, TopologyLink>(linksCopy)
          .id((d) => d.id)
          .distance((d) => (d.linkType === 'uplink' ? forceCfg.uplinkDistance : forceCfg.meshDistance))
          .strength(0.65)
      )
      .force('charge', forceManyBody().strength((d: any) => (d.isController ? forceCfg.chargeStrength * 1.7 : forceCfg.chargeStrength)))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collision', forceCollide<TopologyNode>().radius((d) => (d.isController ? forceCfg.gatewayRadius : forceCfg.nodeRadius)))
      .alphaDecay(0.028);

    simulationRef.current = simulation;

    // Draw Links (Lines)
    const linkGroup = g.append('g').attr('class', 'links');
    const link = linkGroup
      .selectAll<SVGLineElement, TopologyLink>('line')
      .data(linksCopy)
      .join('line')
      .attr('stroke', (d) => {
        if (d.health === 'offline') return isLight ? 'rgba(99, 102, 241, 0.20)' : 'rgba(255, 255, 255, 0.14)';
        if (d.health === 'warning') return 'rgba(245, 158, 11, 0.65)';
        return d.linkType === 'lab_mesh'
          ? isLight
            ? 'rgba(124, 58, 237, 0.42)'
            : 'rgba(192, 132, 252, 0.45)'
          : isLight
          ? 'rgba(14, 165, 233, 0.58)'
          : 'rgba(34, 211, 238, 0.68)';
      })
      .attr('stroke-width', (d) => (d.linkType === 'uplink' ? 2.2 : 1.5))
      .attr('stroke-dasharray', (d) => (d.health === 'offline' ? '4,4' : 'none'))
      .attr('stroke-opacity', 0.85);

    // Animated packet pulses for healthy links
    const pulseGroup = g.append('g').attr('class', 'packet-pulses');
    const pulses = pulseGroup
      .selectAll<SVGCircleElement, TopologyLink>('circle')
      .data(linksCopy.filter((l) => l.health === 'healthy'))
      .join('circle')
      .attr('r', 3)
      .attr('fill', isLight ? '#7c3aed' : '#38bdf8')
      .attr('filter', 'url(#neon-glow)');

    const pulseNodes = pulses.nodes();
    const pulseData = pulses.data();
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pulseTimer =
      prefersReducedMotion || pulseNodes.length === 0
        ? null
        : timer((elapsed) => {
            if (isPausedRef.current || (typeof document !== 'undefined' && document.hidden)) {
              return;
            }
            // 144Hz Framerate-Independent animation with zero per-frame D3 selection allocation
            const pulseProgress = (elapsed * 0.00048) % 1;
            for (let i = 0; i < pulseNodes.length; i++) {
              const d = pulseData[i] as any;
              const src = d?.source;
              const tgt = d?.target;
              if (src && tgt && src.x !== undefined && tgt.x !== undefined) {
                const el = pulseNodes[i];
                el.setAttribute('cx', String(src.x + (tgt.x - src.x) * pulseProgress));
                el.setAttribute('cy', String(src.y + (tgt.y - src.y) * pulseProgress));
              }
            }
          });

    // Draw Nodes (Groups)
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const node = nodeGroup
      .selectAll<SVGGElement, TopologyNode>('g')
      .data(nodesCopy)
      .join('g')
      .attr('class', 'topology-node cursor-pointer')
      .call(
        drag<SVGGElement, TopologyNode>()
          .on('start', (event, d) => {
            triggerHapticFeedback('selection');
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            // keep fixed in place or release smoothly
            d.fx = null;
            d.fy = null;
          })
      );

    // Outer Aura Ring for Nodes
    node
      .append('circle')
      .attr('class', 'node-outer-ring')
      .attr('r', (d) => (d.isController ? 28 : 22))
      .attr('fill', 'none')
      .attr('stroke', (d) => {
        if (d.isQuarantined || d.isCircuitTripped) return '#f43f5e';
        if (d.isController) return '#38bdf8';
        if (!d.isOnline) return isLight ? 'rgba(99,102,241,0.28)' : 'rgba(255,255,255,0.20)';
        return (d.ping ?? 10) <= 25 ? (isLight ? '#7c3aed' : '#22d3ee') : '#f59e0b';
      })
      .attr('stroke-width', (d) => (d.id === selectedHostId ? 3.5 : 1.75))
      .attr('stroke-dasharray', (d) => (!d.isOnline ? '3,3' : 'none'))
      .attr('filter', (d) => (d.isOnline ? 'url(#neon-glow)' : 'none'))
      .attr('opacity', 0.92);

    // Core Solid Circle
    node
      .append('circle')
      .attr('r', (d) => (d.isController ? 20 : 15))
      .attr('fill', (d) => {
        if (d.isController) return 'url(#grad-gateway)';
        if (!d.isOnline) return 'url(#grad-sleeping)';
        return (d.ping ?? 10) <= 25 ? 'url(#grad-online)' : 'url(#grad-warning)';
      })
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.75)
      .attr('stroke-opacity', isLight ? 0.9 : 0.45);

    // Node Type Icon / Glyph in Center
    node.each(function (d) {
      const gNode = select(this);

      // Icon text glyph for crisp vector look
      let glyph = '💻';
      if (d.isController) glyph = '🌐';
      else if (d.deviceType === 'server') glyph = '🖳';
      else if (d.deviceType === 'laptop') glyph = '💻';
      else if (!d.isOnline) glyph = '💤';

      gNode
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', d.isController ? '14px' : '11px')
        .attr('pointer-events', 'none')
        .text(glyph);
    });

    // Node Hostname Label Below (Adaptive Daylight/Dark Halo)
    const labelHalo = isLight ? 'rgba(255, 255, 255, 0.92)' : '#090b1d';
    node
      .append('text')
      .attr('dy', (d) => (d.isController ? 38 : 30))
      .attr('text-anchor', 'middle')
      .attr('fill', isLight ? '#141530' : '#f7f9ff')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('paint-order', 'stroke')
      .attr('stroke', labelHalo)
      .attr('stroke-width', 3.5)
      .attr('stroke-linejoin', 'round')
      .text((d) => (d.name.length > 16 ? d.name.slice(0, 14) + '…' : d.name));

    // Latency Badge / IP Sub-Label
    node
      .append('text')
      .attr('class', 'node-latency-badge')
      .attr('dy', (d) => (d.isController ? 50 : 42))
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => {
        if (!d.isOnline) return isLight ? '#64748b' : '#94a3b8';
        return (d.ping ?? 10) <= 25 ? (isLight ? '#6d28d9' : '#38bdf8') : (isLight ? '#b45309' : '#fbbf24');
      })
      .attr('font-size', '9.5px')
      .attr('font-weight', '600')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('paint-order', 'stroke')
      .attr('stroke', labelHalo)
      .attr('stroke-width', 2.8)
      .text((d) => (d.isOnline ? `${d.ping ?? 0}ms • ${d.ip}` : `OFFLINE • ${d.ip}`));

    // Node Interaction Events
    node
      .on('mouseenter', function () {
        select(this).select('circle').transition().duration(150).attr('transform', 'scale(1.15)');
      })
      .on('mouseleave', function () {
        select(this).select('circle').transition().duration(150).attr('transform', 'scale(1)');
      })
      .on('click', (_event, d) => {
        triggerHapticFeedback('light');
        setActiveNode(d);
        if (!d.isController && onSelectHostRef.current) {
          onSelectHostRef.current(d.id);
        }
      });

    // Simulation Tick Updates
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`);
    });

    // Handle tab visibility to sleep simulation and save CPU/battery
    const handleVisibilityChange = () => {
      if (document.hidden) {
        simulation.stop();
      } else if (!isPausedRef.current) {
        simulation.alpha(0.2).restart();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Handle dynamic container resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0 && simulationRef.current) {
          simulationRef.current.force('center', forceCenter(w / 2, h / 2));
          simulationRef.current.alpha(0.15).restart();
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      simulation.stop();
      pulseTimer?.stop();
      svg.on('.zoom', null);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resizeObserver.disconnect();
    };
  }, [graphData, isLight]);

  // Pause / Resume Physics
  const togglePauseSimulation = () => {
    triggerHapticFeedback('light');
    if (simulationRef.current) {
      if (isPaused) {
        simulationRef.current.alpha(0.3).restart();
        setIsPaused(false);
      } else {
        simulationRef.current.stop();
        setIsPaused(true);
      }
    }
  };

  // Reheat / Rebalance layout
  const handleReheat = () => {
    triggerHapticFeedback('medium');
    if (simulationRef.current) {
      simulationRef.current.alpha(0.8).restart();
    }
  };

  useEffect(() => {
    if (!isFullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullScreen]);

  const liveActiveNode = useMemo(() => {
    if (!activeNode) return null;
    const liveHost = hosts.find((h) => h.id === activeNode.id);
    if (!liveHost) {
      return graphData.nodes.find((n) => n.id === activeNode.id) || activeNode;
    }
    return {
      ...activeNode,
      name: liveHost.name,
      ip: liveHost.ip,
      mac: liveHost.mac,
      isOnline: liveHost.isOnline,
      ping: liveHost.ping,
      cpu: liveHost.cpuUsage ?? liveHost.cpu,
      ram: liveHost.ramUsage ?? liveHost.ram,
    };
  }, [activeNode, hosts, graphData.nodes]);

  const handleCopyNodeIp = useCallback(async (ip: string) => {
    if (!ip) return;
    triggerHapticFeedback('light');
    const ok = await copyToClipboard(ip);
    if (ok) {
      setCopiedIp(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedIp(false), 1600);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-[28px] glass-liquid overflow-hidden flex flex-col transition-all duration-300 ${
        isFullScreen
          ? 'fixed inset-2 sm:inset-3 z-50 h-[calc(100dvh-16px)] sm:h-[calc(100dvh-24px)]'
          : 'h-[clamp(340px,62dvh,660px)]'
      } ${className}`}
    >
      {/* Top Floating Liquid Glass HUD Bar */}
      <div className="absolute top-3 inset-x-3 z-20 px-3.5 py-2.5 rounded-[22px] glass-liquid-elevated flex items-center justify-between gap-2 flex-wrap pointer-events-auto">
        {/* Title & Live Status */}
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 squircle-badge squircle-hero flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs sm:text-sm font-display font-extrabold ink-primary tracking-tight truncate">
                {language === 'bg' ? 'Мрежова топология' : 'Network Topology'}
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/14 text-emerald-400 border border-emerald-500/35 shrink-0">
                AI-NET/3.0
              </span>
            </div>
            <p className="text-[10.5px] ink-muted flex items-center gap-2 font-mono tabular-nums">
              <span>
                {language === 'bg'
                  ? `${metrics.online}/${metrics.total} Онлайн`
                  : `${metrics.online}/${metrics.total} Online`}
              </span>
              <span>•</span>
              <span className="text-cyan-400 font-semibold">
                {metrics.avgPing !== null ? `RTT: ~${metrics.avgPing}ms` : 'RTT: —'}
              </span>
            </p>
          </div>
        </div>

        {/* Action Controls (Visible across Desktop & Mobile) */}
        <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center glass-liquid-subtle rounded-full p-0.5 text-[11px]">
            {(
              [
                { id: 'all' as const, label: language === 'bg' ? 'Всички' : 'All' },
                { id: 'online' as const, label: language === 'bg' ? 'Онлайн' : 'Online' },
                { id: 'servers' as const, label: language === 'bg' ? 'Сървъри' : 'Servers' },
              ]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  setFilterMode(opt.id);
                }}
                className={`px-2.5 py-1 rounded-full transition cursor-pointer font-semibold ${
                  filterMode === opt.id
                    ? 'liquid-hero-btn preserve-white'
                    : 'ink-secondary hover:ink-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePauseSimulation}
              className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
              title={
                isPaused
                  ? language === 'bg'
                    ? 'Продължи физиката'
                    : 'Resume Physics'
                  : language === 'bg'
                  ? 'Замрази възлите'
                  : 'Freeze Nodes'
              }
              aria-label={isPaused ? 'Resume Physics' : 'Freeze Nodes'}
            >
              {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={handleResetZoom}
              className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
              title={language === 'bg' ? 'Нулирай мащаба' : 'Reset Zoom / Pan'}
              aria-label="Reset Zoom"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleReheat}
              className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
              title={language === 'bg' ? 'Пренареди графа' : 'Re-balance Graph'}
              aria-label="Re-balance Graph"
            >
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('medium');
                setIsFullScreen(!isFullScreen);
              }}
              className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
              title={
                isFullScreen
                  ? language === 'bg'
                    ? 'Изход от цял екран'
                    : 'Exit Full Screen'
                  : language === 'bg'
                  ? 'Цял екран'
                  : 'Full Screen'
              }
              aria-label={isFullScreen ? 'Exit Full Screen' : 'Full Screen'}
            >
              {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main Adaptive Daylight / Vibrant Dark Interactive SVG Canvas */}
      <svg
        ref={svgRef}
        style={{
          background: isLight
            ? 'radial-gradient(circle at 50% 48%, rgba(255,255,255,0.68) 0%, rgba(238,242,255,0.45) 100%)'
            : 'radial-gradient(circle at 50% 48%, rgba(20,24,58,0.82) 0%, rgba(9,11,29,0.92) 100%)',
        }}
        className="w-full h-full cursor-grab active:cursor-grabbing select-none"
      />

      {/* Empty State Overlay when no nodes match or fleet is empty */}
      {graphData.nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none">
          <div className="glass-liquid-modal rounded-[26px] px-6 py-5 max-w-xs text-center space-y-2.5 pointer-events-auto">
            <div className="w-11 h-11 squircle-badge squircle-hero mx-auto flex items-center justify-center">
              <Network className="w-5 h-5" />
            </div>
            <h4 className="font-display text-sm font-extrabold ink-primary">
              {hosts.length === 0
                ? language === 'bg'
                  ? 'Няма възли в топологията'
                  : 'No Nodes in Topology'
                : language === 'bg'
                ? 'Няма съвпадащи устройства'
                : 'No Matching Nodes'}
            </h4>
            <p className="text-xs ink-muted leading-relaxed">
              {hosts.length === 0
                ? language === 'bg'
                  ? 'Добавете компютър или сканирайте локалната мрежа, за да визуализирате живата LAN топология.'
                  : 'Add a computer or scan your LAN to map live hosts and subnet links here.'
                : language === 'bg'
                ? 'Текущият филтър скрива всички устройства в мрежовия граф.'
                : 'The active topology filter has no matching hosts.'}
            </p>
            {hosts.length > 0 && filterMode !== 'all' && (
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className="h-8.5 px-4 rounded-full liquid-hero-btn text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>{language === 'bg' ? 'Покажи всички' : 'Show All Nodes'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom Floating Legend & Frosted Selected Node Inspector */}
      <div className="absolute bottom-3 inset-x-3 z-20 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-2 pointer-events-none">
        <div className="px-3.5 py-2 rounded-[20px] glass-liquid-elevated flex items-center flex-wrap gap-x-3 gap-y-1 text-[10.5px] ink-secondary font-medium pointer-events-auto">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
            <span>{language === 'bg' ? '<25ms (Бърз)' : '<25ms (Fast)'}</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span>{language === 'bg' ? '>25ms (Джитър)' : '>25ms (Jitter)'}</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 border border-dashed border-current" />
            <span>{language === 'bg' ? 'Спящ (WoL)' : 'Sleeping (WoL)'}</span>
          </div>
          <span className="ink-muted hidden md:inline">
            {language === 'bg'
              ? '• Влачете възлите • Колелце за мащаб'
              : '• Drag to reposition • Scroll to zoom'}
          </span>
        </div>

        {liveActiveNode && (
          <div className="p-3.5 rounded-[24px] glass-liquid-modal text-xs ink-primary max-w-sm pointer-events-auto flex items-start space-x-3">
            <div
              className={`w-9 h-9 squircle-badge shrink-0 flex items-center justify-center ${
                liveActiveNode.isOnline ? 'squircle-hero' : 'squircle-amber opacity-80'
              }`}
            >
              {liveActiveNode.isController ? (
                <Shield className="w-4 h-4" />
              ) : liveActiveNode.deviceType === 'server' ? (
                <Server className="w-4 h-4" />
              ) : (
                <Monitor className="w-4 h-4" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-bold ink-primary truncate">
                  {liveActiveNode.name}
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0 ${
                    liveActiveNode.isOnline
                      ? 'bg-emerald-500/16 text-emerald-400 border border-emerald-500/35'
                      : 'liquid-control-pill ink-muted'
                  }`}
                >
                  {liveActiveNode.isOnline
                    ? `${liveActiveNode.ping ?? 0}ms`
                    : language === 'bg'
                    ? 'СПЯЩ'
                    : 'SLEEPING'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-mono ink-secondary mt-1">
                <button
                  type="button"
                  onClick={() => handleCopyNodeIp(liveActiveNode.ip)}
                  className="inline-flex items-center gap-1 text-cyan-400 hover:underline cursor-pointer truncate"
                  title={language === 'bg' ? 'Копирай IP' : 'Copy IP'}
                >
                  <span>{liveActiveNode.ip}</span>
                  {copiedIp ? (
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Copy className="w-2.5 h-2.5 opacity-65 shrink-0" />
                  )}
                </button>
                {liveActiveNode.mac && (
                  <>
                    <span className="opacity-35">·</span>
                    <span className="truncate ink-muted">{liveActiveNode.mac}</span>
                  </>
                )}
              </div>

              {!liveActiveNode.isController && (
                <div className="mt-2.5 pt-2 border-t border-white/[0.10] flex items-center gap-1.5">
                  {!liveActiveNode.isOnline && onSendWol && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('heavy');
                        const targetHost = hosts.find((h) => h.id === liveActiveNode.id);
                        if (targetHost) onSendWol(targetHost);
                      }}
                      className="px-3 py-1 rounded-full squircle-amber preserve-white text-[11px] font-bold flex items-center space-x-1 cursor-pointer"
                    >
                      <Power className="w-3 h-3" />
                      <span>{language === 'bg' ? 'Събуди (WoL)' : 'Wake (WoL)'}</span>
                    </button>
                  )}

                  {liveActiveNode.isOnline && onViewScreen && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('medium');
                        const targetHost = hosts.find((h) => h.id === liveActiveNode.id);
                        if (targetHost) onViewScreen(targetHost);
                      }}
                      className="px-3 py-1 rounded-full liquid-hero-btn text-[11px] font-bold flex items-center space-x-1 cursor-pointer"
                    >
                      <Monitor className="w-3 h-3" />
                      <span>{language === 'bg' ? 'Екран' : 'Screen'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveNode(null)}
                    className="ml-auto w-7 h-7 rounded-full liquid-control-pill text-[11px] flex items-center justify-center cursor-pointer"
                    aria-label={language === 'bg' ? 'Затвори' : 'Close'}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
