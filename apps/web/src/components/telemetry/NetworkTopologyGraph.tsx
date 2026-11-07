import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import {
  Activity,
  Maximize2,
  Minimize2,
  RotateCcw,
  Zap,
  Power,
  Terminal,
  Shield,
  Server,
  Monitor,
  Laptop,
  Wifi,
  Info,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  Filter,
} from 'lucide-react';
import { HostDevice } from '../../types';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { computeViewportMetrics } from '../../utils/viewportScale';

export interface TopologyNode extends d3.SimulationNodeDatum {
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

export interface TopologyLink extends d3.SimulationLinkDatum<TopologyNode> {
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
  const { t, language } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<TopologyNode, TopologyLink> | null>(null);

  const [activeNode, setActiveNode] = useState<TopologyNode | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'online' | 'servers'>('all');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Deep copy for D3
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [links, setLinks] = useState<TopologyLink[]>([]);

  // Topology Signature - Changes ONLY when structural updates occur
  const topologySignature = useMemo(() => {
    return hosts
      .map(
        (h) =>
          `${h.id}-${h.isOnline}-${h.deviceType}-${quarantinedHosts.includes(h.id)}-${circuitTrippedHosts.includes(
            h.id
          )}`
      )
      .join('|') + `_${filterMode}_${selectedHostId}`;
  }, [hosts, filterMode, quarantinedHosts, circuitTrippedHosts, selectedHostId]);

  // Construct Topology Graph Data (Nodes + Links)
  const graphData = useMemo(() => {
    // Central AI NetController Gateway Node
    const controllerNode: TopologyNode = {
      id: 'cst-gateway',
      name: 'AI NetController Gateway (L3 Switch)',
      ip: '192.168.1.1',
      mac: '00:00:C5:71:00:01',
      os: 'controller',
      deviceType: 'gateway',
      isOnline: true,
      ping: 0.6,
      cpu: 18,
      ram: 34,
      tags: ['Gateway', 'L3 Switch', 'CST/3.0'],
      isController: true,
    };

    // Filter hosts based on filterMode
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

    const allNodes: TopologyNode[] = [controllerNode, ...hostNodes];

    // Build realistic network links:
    // 1. Primary star uplink from Central Gateway to every managed node
    // 2. Peer cluster links between hosts in same lab cluster / server rack
    const links: TopologyLink[] = [];

    hostNodes.forEach((node) => {
      const ping = node.ping ?? (node.isOnline ? 12 : 999);
      let health: TopologyLink['health'] = 'offline';
      if (node.isOnline) {
        health = ping <= 25 ? 'healthy' : 'warning';
      }

      links.push({
        source: controllerNode.id,
        target: node.id,
        latency: ping,
        health,
        linkType: 'uplink',
        throughputMbps: node.isOnline ? (node.deviceType === 'server' ? 1000 : 100) : 0,
      });
    });

    // Subnet mesh links between workstations in the same group
    for (let i = 0; i < hostNodes.length; i++) {
      for (let j = i + 1; j < hostNodes.length; j++) {
        const a = hostNodes[i];
        const b = hostNodes[j];
        const sharedTag = a.tags?.some((t) => b.tags?.includes(t));
        if (sharedTag && a.isOnline && b.isOnline) {
          links.push({
            source: a.id,
            target: b.id,
            latency: Math.max(2, Math.abs((a.ping || 10) - (b.ping || 10)) + 1),
            health: 'healthy',
            linkType: 'lab_mesh',
            throughputMbps: 1000,
          });
        }
      }
    }

    return { nodes: allNodes, links };
  }, [topologySignature]); // Rebuild only when structural topology changes

  // Update telemetry live without D3 teardown
  useEffect(() => {
    if (!svgRef.current) return;

    // Fast DOM updates for latency badges and outer rings without tearing down the simulation
    const svg = d3.select(svgRef.current);

    svg.selectAll('.node-latency-badge').text((d: any) => {
      if (d.isController) return `AI GATEWAY`;
      const host = hosts.find(h => h.id === d.id);
      if (!host || !host.isOnline) return `OFFLINE • ${d.ip}`;
      return `${host.ping ?? 0}ms • ${d.ip}`;
    });

    svg.selectAll('.node-outer-ring')
      .attr('stroke', (d: any) => {
        if (d.isController) return '#38bdf8';
        const host = hosts.find(h => h.id === d.id);
        if (quarantinedHosts.includes(d.id) || circuitTrippedHosts.includes(d.id)) return '#f43f5e';
        if (!host || !host.isOnline) return 'rgba(255,255,255,0.15)';
        return (host.ping ?? 10) <= 25 ? '#22d3ee' : '#fbbf24';
      });

  }, [hosts, quarantinedHosts, circuitTrippedHosts]);

  // Aggregate Topology Metrics
  const metrics = useMemo(() => {
    const total = graphData.nodes.filter((n) => !n.isController).length;
    const online = graphData.nodes.filter((n) => !n.isController && n.isOnline).length;
    const pings = graphData.nodes.filter((n) => n.isOnline && typeof n.ping === 'number').map((n) => n.ping!);
    const avgPing = pings.length > 0 ? (pings.reduce((a, b) => a + b, 0) / pings.length).toFixed(1) : 'N/A';
    return { total, online, sleeping: total - online, avgPing };
  }, [graphData]);

  // Reset / Re-center View
  const handleResetZoom = useCallback(() => {
    triggerHapticFeedback('light');
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(500)
      .call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
    setZoomLevel(1);
  }, []);

  // Main D3 Force Simulation Setup
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;

    const svg = d3.select(svgRef.current);
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
    onlineGrad.append('stop').attr('offset', '0%').attr('stop-color', '#22d3ee');
    onlineGrad.append('stop').attr('offset', '100%').attr('stop-color', '#0891b2');

    // Warning node gradient
    const warningGrad = defs.append('radialGradient')
      .attr('id', 'grad-warning');
    warningGrad.append('stop').attr('offset', '0%').attr('stop-color', '#fbbf24');
    warningGrad.append('stop').attr('offset', '100%').attr('stop-color', '#d97706');

    // Sleeping node gradient
    const sleepingGrad = defs.append('radialGradient')
      .attr('id', 'grad-sleeping');
    sleepingGrad.append('stop').attr('offset', '0%').attr('stop-color', '#475569');
    sleepingGrad.append('stop').attr('offset', '100%').attr('stop-color', '#1e293b');

    // Zoom container root group
    const g = svg.append('g').attr('class', 'topology-zoom-group');

    // Zoom Behavior with smooth clamping
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 3.5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        setZoomLevel(Number(event.transform.k.toFixed(2)));
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

    const simulation = d3.forceSimulation<TopologyNode, TopologyLink>(nodesCopy)
      .force(
        'link',
        d3.forceLink<TopologyNode, TopologyLink>(linksCopy)
          .id((d) => d.id)
          .distance((d) => (d.linkType === 'uplink' ? forceCfg.uplinkDistance : forceCfg.meshDistance))
          .strength(0.65)
      )
      .force('charge', d3.forceManyBody().strength((d: any) => (d.isController ? forceCfg.chargeStrength * 1.7 : forceCfg.chargeStrength)))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<TopologyNode>().radius((d) => (d.isController ? forceCfg.gatewayRadius : forceCfg.nodeRadius)))
      .alphaDecay(0.028);

    simulationRef.current = simulation;

    // Draw Links (Lines)
    const linkGroup = g.append('g').attr('class', 'links');
    const link = linkGroup
      .selectAll<SVGLineElement, TopologyLink>('line')
      .data(linksCopy)
      .join('line')
      .attr('stroke', (d) => {
        if (d.health === 'offline') return 'rgba(255, 255, 255, 0.12)';
        if (d.health === 'warning') return 'rgba(251, 191, 36, 0.6)';
        return d.linkType === 'lab_mesh' ? 'rgba(56, 189, 248, 0.35)' : 'rgba(34, 211, 238, 0.65)';
      })
      .attr('stroke-width', (d) => (d.linkType === 'uplink' ? 2 : 1.2))
      .attr('stroke-dasharray', (d) => (d.health === 'offline' ? '4,4' : 'none'))
      .attr('stroke-opacity', 0.85);

    // Animated packet pulses for healthy links
    const pulseGroup = g.append('g').attr('class', 'packet-pulses');
    const pulses = pulseGroup
      .selectAll<SVGCircleElement, TopologyLink>('circle')
      .data(linksCopy.filter((l) => l.health === 'healthy'))
      .join('circle')
      .attr('r', 2.5)
      .attr('fill', '#38bdf8')
      .attr('filter', 'url(#neon-glow)');

    const pulseTimer = d3.timer((elapsed) => {
      // 144Hz Framerate-Independent animation (constant speed across 60Hz, 120Hz & 144Hz displays)
      const pulseProgress = (elapsed * 0.00048) % 1;
      pulses.each(function (d: any) {
        if (d.source.x !== undefined && d.target.x !== undefined) {
          const x = d.source.x + (d.target.x - d.source.x) * pulseProgress;
          const y = d.source.y + (d.target.y - d.source.y) * pulseProgress;
          d3.select(this).attr('cx', x).attr('cy', y);
        }
      });
    });

    // Draw Nodes (Groups)
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const node = nodeGroup
      .selectAll<SVGGElement, TopologyNode>('g')
      .data(nodesCopy)
      .join('g')
      .attr('class', 'topology-node cursor-pointer')
      .call(
        d3.drag<SVGGElement, TopologyNode>()
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
        if (!d.isOnline) return 'rgba(255,255,255,0.15)';
        return (d.ping ?? 10) <= 25 ? '#22d3ee' : '#fbbf24';
      })
      .attr('stroke-width', (d) => (d.id === selectedHostId ? 3.5 : 1.5))
      .attr('stroke-dasharray', (d) => (!d.isOnline ? '3,3' : 'none'))
      .attr('filter', (d) => (d.isOnline ? 'url(#neon-glow)' : 'none'))
      .attr('opacity', 0.9);

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
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.4);

    // Node Type Icon / Glyph in Center
    node.each(function (d) {
      const gNode = d3.select(this);

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

    // Node Hostname Label Below
    node
      .append('text')
      .attr('dy', (d) => (d.isController ? 38 : 30))
      .attr('text-anchor', 'middle')
      .attr('fill', '#f1f5f9')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#050811')
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .text((d) => (d.name.length > 16 ? d.name.slice(0, 14) + '…' : d.name));

    // Latency Badge / IP Sub-Label
    node
      .append('text')
      .attr('class', 'node-latency-badge')
      .attr('dy', (d) => (d.isController ? 50 : 42))
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => {
        if (!d.isOnline) return '#64748b';
        return (d.ping ?? 10) <= 25 ? '#38bdf8' : '#fbbf24';
      })
      .attr('font-size', '9.5px')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#050811')
      .attr('stroke-width', 2.5)
      .text((d) => (d.isOnline ? `${d.ping ?? 0}ms • ${d.ip}` : `OFFLINE • ${d.ip}`));

    // Node Interaction Events
    node
      .on('mouseenter', function (_event, d) {
        d3.select(this).select('circle').transition().duration(150).attr('transform', 'scale(1.15)');
      })
      .on('mouseleave', function () {
        d3.select(this).select('circle').transition().duration(150).attr('transform', 'scale(1)');
      })
      .on('click', (_event, d) => {
        triggerHapticFeedback('light');
        setActiveNode(d);
        if (!d.isController && onSelectHost) {
          onSelectHost(d.id);
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
      } else if (!isPaused) {
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
          simulationRef.current.force('center', d3.forceCenter(w / 2, h / 2));
          simulationRef.current.alpha(0.15).restart();
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      simulation.stop();
      pulseTimer.stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resizeObserver.disconnect();
    };
  }, [graphData, selectedHostId, onSelectHost]);

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

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-2xl glass-liquid-elevated border border-white/15 overflow-hidden shadow-2xl flex flex-col transition-all duration-300 ${
        isFullScreen
          ? 'fixed inset-2 sm:inset-3 z-50 h-[calc(100dvh-16px)] sm:h-[calc(100dvh-24px)]'
          : 'h-[clamp(320px,62dvh,660px)]'
      } ${className}`}
    >
      {/* Top Header Bar / HUD Overlay */}
      <div className="absolute top-0 inset-x-0 z-20 px-3.5 py-2.5 bg-gradient-to-b from-black/85 via-black/45 to-transparent flex items-center justify-between pointer-events-none">
        {/* Title & Live Status */}
        <div className="flex items-center space-x-2.5 pointer-events-auto">
          <div className="p-1.5 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 shadow-[0_0_12px_rgba(0,212,255,0.3)]">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs sm:text-sm font-bold text-white tracking-tight">
                {language === 'bg' ? 'Мрежова топология (D3.js)' : 'Network Topology (D3.js)'}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                CST/3.0
              </span>
            </div>
            <p className="text-[10px] text-slate-400 flex items-center gap-2">
              <span>
                {language === 'bg'
                  ? `${metrics.online}/${metrics.total} Онлайн`
                  : `${metrics.online}/${metrics.total} Online`}
              </span>
              <span>•</span>
              <span className="font-mono text-cyan-400">RTT: ~{metrics.avgPing}ms</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5 pointer-events-auto">
          {/* Filter Pills */}
          <div className="hidden sm:flex items-center bg-black/40 border border-white/10 rounded-xl p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                setFilterMode('all');
              }}
              className={`px-2 py-0.5 rounded-lg transition cursor-pointer ${
                filterMode === 'all' ? 'bg-cyan-500/30 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {language === 'bg' ? 'Всички' : 'All'}
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                setFilterMode('online');
              }}
              className={`px-2 py-0.5 rounded-lg transition cursor-pointer ${
                filterMode === 'online' ? 'bg-cyan-500/30 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {language === 'bg' ? 'Онлайн' : 'Online'}
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                setFilterMode('servers');
              }}
              className={`px-2 py-0.5 rounded-lg transition cursor-pointer ${
                filterMode === 'servers' ? 'bg-cyan-500/30 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {language === 'bg' ? 'Сървъри' : 'Servers'}
            </button>
          </div>

          {/* Pause / Resume */}
          <button
            type="button"
            onClick={togglePauseSimulation}
            className="p-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/15 text-slate-300 hover:text-white transition cursor-pointer"
            title={isPaused ? 'Resume Physics' : 'Freeze Nodes'}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          {/* Re-center / Reset Zoom */}
          <button
            type="button"
            onClick={handleResetZoom}
            className="p-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/15 text-slate-300 hover:text-white transition cursor-pointer"
            title="Reset Zoom / Pan"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Reheat Simulation */}
          <button
            type="button"
            onClick={handleReheat}
            className="p-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/15 text-slate-300 hover:text-white transition cursor-pointer"
            title="Re-balance Graph"
          >
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
          </button>

          {/* Toggle Full Screen */}
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('medium');
              setIsFullScreen(!isFullScreen);
            }}
            className="p-1.5 rounded-xl bg-black/40 hover:bg-white/10 border border-white/15 text-slate-300 hover:text-white transition cursor-pointer"
            title={isFullScreen ? 'Exit Full Screen' : 'Full Screen'}
          >
            {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Interactive SVG Canvas */}
      <svg
        ref={svgRef}
        className="w-full h-full bg-[#050811]/90 cursor-grab active:cursor-grabbing select-none"
      />

      {/* Bottom Floating Legend & Node Inspector Card */}
      <div className="absolute bottom-2.5 inset-x-2.5 z-20 flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-2 pointer-events-none">
        {/* Legend */}
        <div className="px-3 py-1.5 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 flex items-center space-x-3 text-[10px] text-slate-300 pointer-events-auto">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
            <span>&lt;25ms (Fast)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
            <span>&gt;25ms (Jitter)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-600 border border-dashed border-white/30" />
            <span>{language === 'bg' ? 'Спящ (WoL)' : 'Sleeping (WoL)'}</span>
          </div>
          <span className="text-slate-500 hidden md:inline">| Drag nodes to reposition • Scroll to zoom</span>
        </div>

        {/* Selected Node Inspector Flyout */}
        {activeNode && (
          <div className="p-3 rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-cyan-400/40 shadow-2xl text-xs text-white max-w-sm pointer-events-auto flex items-start space-x-3">
            <div
              className={`p-2 rounded-xl mt-0.5 border ${
                activeNode.isOnline
                  ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300'
                  : 'bg-slate-800 border-white/20 text-slate-400'
              }`}
            >
              {activeNode.isController ? (
                <Shield className="w-4 h-4 text-cyan-300" />
              ) : activeNode.deviceType === 'server' ? (
                <Server className="w-4 h-4 text-purple-300" />
              ) : (
                <Monitor className="w-4 h-4" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white truncate">{activeNode.name}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    activeNode.isOnline
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {activeNode.isOnline ? `${activeNode.ping ?? 0}ms` : 'SLEEPING'}
                </span>
              </div>

              <div className="text-[11px] font-mono text-slate-300 mt-0.5 truncate">
                IP: {activeNode.ip} • MAC: {activeNode.mac}
              </div>

              {/* Action buttons if not controller */}
              {!activeNode.isController && (
                <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-1.5">
                  {!activeNode.isOnline && onSendWol && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('heavy');
                        const targetHost = hosts.find((h) => h.id === activeNode.id);
                        if (targetHost) onSendWol(targetHost);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/40 text-emerald-300 text-[11px] font-semibold flex items-center space-x-1 cursor-pointer transition"
                    >
                      <Power className="w-3 h-3" />
                      <span>{language === 'bg' ? 'Събуди (WoL)' : 'Wake (WoL)'}</span>
                    </button>
                  )}

                  {activeNode.isOnline && onViewScreen && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHapticFeedback('medium');
                        const targetHost = hosts.find((h) => h.id === activeNode.id);
                        if (targetHost) onViewScreen(targetHost);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-400/40 text-cyan-300 text-[11px] font-semibold flex items-center space-x-1 cursor-pointer transition"
                    >
                      <Monitor className="w-3 h-3" />
                      <span>{language === 'bg' ? 'Екран' : 'Screen'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveNode(null)}
                    className="ml-auto text-[10px] text-slate-400 hover:text-white cursor-pointer px-1.5 py-1"
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
