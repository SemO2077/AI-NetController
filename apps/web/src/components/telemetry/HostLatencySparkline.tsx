import React, { useState, useMemo, useRef, useCallback } from 'react';
import { LatencyDataPoint } from '../../types';
import { Activity, Clock, ShieldCheck, Zap } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';

export interface HostLatencySparklineProps {
  history?: LatencyDataPoint[] | number[];
  currentPing?: number | null;
  isOnline: boolean;
  hostId?: string;
  hostName?: string;
  timeWindowSeconds?: number; // default: 30
  className?: string;
  showSummaryStats?: boolean;
  showTimeAxis?: boolean;
  compact?: boolean;
  interactive?: boolean;
}

interface PointWithCoord {
  x: number;
  y: number;
  latency: number;
  timestamp: number;
  relativeSeconds: number;
}

const HostLatencySparklineComponent: React.FC<HostLatencySparklineProps> = ({
  history = [],
  currentPing,
  isOnline,
  hostId = 'host',
  hostName,
  timeWindowSeconds = 30,
  className = '',
  showSummaryStats = true,
  showTimeAxis = true,
  compact = false,
  interactive = true,
}) => {
  const { t, language } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<PointWithCoord | null>(null);

  // Parse and normalize data into chronological 30-second window
  const { points, stats, statusLevel } = useMemo(() => {
    const now = Date.now();
    const windowMs = timeWindowSeconds * 1000;
    const cutoff = now - windowMs;

    let rawPoints: { timestamp: number; latency: number }[] = [];

    if (Array.isArray(history) && history.length > 0) {
      if (typeof history[0] === 'number') {
        // Array of raw numbers
        const numArr = history as number[];
        const step = windowMs / Math.max(1, numArr.length - 1);
        rawPoints = numArr.map((lat, i) => ({
          timestamp: cutoff + i * step,
          latency: lat,
        }));
      } else {
        // Array of LatencyDataPoint
        const dataArr = history as LatencyDataPoint[];
        rawPoints = dataArr
          .filter((p) => p.timestamp >= cutoff)
          .sort((a, b) => a.timestamp - b.timestamp);
      }
    }

    // When only currentPing is available without prior buffered history, plot a flat real baseline
    if (rawPoints.length === 0 && isOnline && typeof currentPing === 'number') {
      rawPoints.push(
        { timestamp: cutoff, latency: currentPing },
        { timestamp: now, latency: currentPing }
      );
    }

    if (!isOnline || rawPoints.length === 0) {
      return {
        points: [] as { timestamp: number; latency: number }[],
        stats: {
          current: null,
          min: null,
          max: null,
          avg: null,
          jitter: 0,
          samplesCount: 0,
        },
        statusLevel: 'offline' as const,
      };
    }

    const latencies = rawPoints.map((p) => p.latency);
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const sum = latencies.reduce((acc, v) => acc + v, 0);
    const avg = Math.round((sum / latencies.length) * 10) / 10;
    const current = currentPing ?? rawPoints[rawPoints.length - 1].latency;

    // Calculate jitter (mean absolute deviation between consecutive readings)
    let jitterSum = 0;
    for (let i = 1; i < latencies.length; i++) {
      jitterSum += Math.abs(latencies[i] - latencies[i - 1]);
    }
    const jitter =
      latencies.length > 1
        ? Math.round((jitterSum / (latencies.length - 1)) * 10) / 10
        : 0.6;

    let statusLevel: 'optimal' | 'good' | 'moderate' | 'high' = 'optimal';
    if (current > 120) statusLevel = 'high';
    else if (current > 60) statusLevel = 'moderate';
    else if (current > 20) statusLevel = 'good';

    return {
      points: rawPoints,
      stats: {
        current,
        min,
        max,
        avg,
        jitter,
        samplesCount: rawPoints.length,
      },
      statusLevel,
    };
  }, [history, currentPing, isOnline, timeWindowSeconds]);

  // Dimensions & SVG Geometry
  const width = compact ? 240 : 380;
  const height = compact ? 52 : 82;
  const paddingLeft = 10;
  const paddingRight = 10;
  const paddingTop = 8;
  const paddingBottom = showTimeAxis ? 20 : 8;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Calculate SVG coordinates mapping timestamp linearly over the 30-second window
  const { pathD, areaD, pointCoords, minVal, maxVal } = useMemo(() => {
    if (points.length === 0) {
      return { pathD: '', areaD: '', pointCoords: [], minVal: 0, maxVal: 20 };
    }

    const now = Date.now();
    const windowMs = timeWindowSeconds * 1000;
    const startTime = now - windowMs;

    const latValues = points.map((p) => p.latency);
    const rawMin = Math.min(...latValues);
    const rawMax = Math.max(...latValues);

    const minVal = Math.max(0, Math.floor(rawMin - 1));
    const maxVal = Math.max(minVal + 8, Math.ceil(rawMax + 2), 16);
    const range = maxVal - minVal || 1;

    const pointCoords: PointWithCoord[] = points.map((p) => {
      // Linear mapping of timestamp to X position
      const timeOffset = Math.max(0, Math.min(windowMs, p.timestamp - startTime));
      const x = paddingLeft + (timeOffset / windowMs) * chartWidth;

      // Inverted Y position
      const normY = (p.latency - minVal) / range;
      const y = paddingTop + (1 - normY) * chartHeight;

      const relativeSeconds = Math.max(
        0,
        Math.round((now - p.timestamp) / 100) / 10
      );

      return { x, y, latency: p.latency, timestamp: p.timestamp, relativeSeconds };
    });

    if (pointCoords.length === 0) {
      return { pathD: '', areaD: '', pointCoords: [], minVal, maxVal };
    }

    // Smooth cubic bezier spline
    let pathD = `M ${pointCoords[0].x.toFixed(1)} ${pointCoords[0].y.toFixed(1)}`;
    for (let i = 1; i < pointCoords.length; i++) {
      const prev = pointCoords[i - 1];
      const curr = pointCoords[i];
      const midX = (prev.x + curr.x) / 2;
      pathD += ` C ${midX.toFixed(1)} ${prev.y.toFixed(1)}, ${midX.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }

    const lastX = pointCoords[pointCoords.length - 1].x.toFixed(1);
    const firstX = pointCoords[0].x.toFixed(1);
    const baseY = (paddingTop + chartHeight).toFixed(1);
    const areaD = `${pathD} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;

    return { pathD, areaD, pointCoords, minVal, maxVal };
  }, [points, timeWindowSeconds, chartWidth, chartHeight, paddingLeft, paddingTop]);

  // Color configurations based on status
  const colors = useMemo(() => {
    if (!isOnline) {
      return {
        stroke: 'rgba(255, 255, 255, 0.25)',
        fillGradStart: 'rgba(255, 255, 255, 0.05)',
        fillGradEnd: 'rgba(255, 255, 255, 0.0)',
        dot: 'bg-white/30',
        text: 'text-white/40',
        badge: 'bg-white/5 text-white/50 border-white/10',
        glow: 'none',
      };
    }

    switch (statusLevel) {
      case 'high':
        return {
          stroke: '#f43f5e',
          fillGradStart: 'rgba(244, 63, 94, 0.35)',
          fillGradEnd: 'rgba(244, 63, 94, 0.0)',
          dot: 'bg-rose-400 shadow-[0_0_10px_#f43f5e]',
          text: 'text-rose-400',
          badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
          glow: 'rgba(244, 63, 94, 0.3)',
        };
      case 'moderate':
        return {
          stroke: '#fbbf24',
          fillGradStart: 'rgba(251, 191, 36, 0.3)',
          fillGradEnd: 'rgba(251, 191, 36, 0.0)',
          dot: 'bg-amber-400 shadow-[0_0_10px_#fbbf24]',
          text: 'text-amber-400',
          badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
          glow: 'rgba(251, 191, 36, 0.25)',
        };
      case 'good':
        return {
          stroke: '#22d3ee',
          fillGradStart: 'rgba(34, 211, 238, 0.32)',
          fillGradEnd: 'rgba(34, 211, 238, 0.0)',
          dot: 'bg-cyan-400 shadow-[0_0_10px_#22d3ee]',
          text: 'text-cyan-300',
          badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
          glow: 'rgba(34, 211, 238, 0.25)',
        };
      case 'optimal':
      default:
        return {
          stroke: '#34d399',
          fillGradStart: 'rgba(52, 211, 153, 0.32)',
          fillGradEnd: 'rgba(52, 211, 153, 0.0)',
          dot: 'bg-emerald-400 shadow-[0_0_10px_#34d399]',
          text: 'text-emerald-400',
          badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
          glow: 'rgba(52, 211, 153, 0.25)',
        };
    }
  }, [isOnline, statusLevel]);

  // Pointer scrubbing interaction
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive || pointCoords.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * width;

      // Find nearest point
      let closest: PointWithCoord = pointCoords[0];
      let minDistance = Math.abs(pointCoords[0].x - svgX);

      for (let i = 1; i < pointCoords.length; i++) {
        const d = Math.abs(pointCoords[i].x - svgX);
        if (d < minDistance) {
          minDistance = d;
          closest = pointCoords[i];
        }
      }

      setHoveredPoint(closest);
    },
    [interactive, pointCoords, width]
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredPoint(null);
  }, []);

  const lastPoint = pointCoords.length > 0 ? pointCoords[pointCoords.length - 1] : null;

  return (
    <div
      ref={containerRef}
      className={`w-full flex flex-col space-y-2 select-none ${className}`}
      id={`latency-sparkline-${hostId}`}
    >
      {/* Chart Header with Live Indicator & Window Size */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isOnline ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]' : 'bg-rose-400/60'
              }`}
            />
            <span className="text-xs font-semibold text-white/90 uppercase tracking-wider font-mono">
              {language === 'bg' ? 'Латентност (последните 30 сек)' : 'Latency (Last 30 sec)'}
            </span>
          </div>
          <span className="glass-liquid px-2 py-0.5 rounded-full text-[10px] font-mono text-cyan-300/90 border border-cyan-400/20 shrink-0">
            {language === 'bg' ? '1 Hz телеметрия' : '1 Hz telemetry'}
          </span>
        </div>

        {isOnline && stats.current !== null && (
          <div className="flex items-center space-x-1.5 font-mono text-xs">
            <span className="text-white/40 text-[11px]">
              {language === 'bg' ? 'Текущ RTT:' : 'Current RTT:'}
            </span>
            <span
              className={`font-bold px-2 py-0.5 rounded-md border ${colors.badge}`}
            >
              {stats.current} ms
            </span>
          </div>
        )}
      </div>

      {/* SVG Canvas Area */}
      <div className="relative w-full rounded-xl bg-slate-950/60 border border-white/10 p-2 overflow-hidden shadow-inner">
        {/* Subtle Horizontal Threshold Guides */}
        <div className="absolute inset-x-2 top-2 bottom-6 pointer-events-none flex flex-col justify-between opacity-15">
          <div className="w-full border-b border-cyan-300 border-dashed" />
          <div className="w-full border-b border-cyan-300 border-dashed" />
          <div className="w-full border-b border-cyan-300 border-dashed" />
        </div>

        {/* Hover scrub tooltip pill */}
        {hoveredPoint && (
          <div
            className="absolute z-30 pointer-events-none -top-1 transform -translate-x-1/2 -translate-y-full transition-all duration-75"
            style={{
              left: `${(hoveredPoint.x / width) * 100}%`,
            }}
          >
            <div className="glass-liquid px-2.5 py-1 rounded-lg border border-cyan-400/40 text-[11px] font-mono shadow-[0_4px_16px_rgba(0,0,0,0.6)] flex items-center space-x-2 bg-slate-950/95 text-white whitespace-nowrap">
              <span className={`font-bold ${colors.text}`}>
                {hoveredPoint.latency} ms
              </span>
              <span className="text-white/30">•</span>
              <span className="text-white/60 text-[10px]">
                {hoveredPoint.relativeSeconds <= 0.5
                  ? language === 'bg' ? 'сега' : 'now'
                  : language === 'bg'
                  ? `преди ${hoveredPoint.relativeSeconds}с`
                  : `${hoveredPoint.relativeSeconds}s ago`}
              </span>
            </div>
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-20 sm:h-24 overflow-visible touch-none cursor-crosshair"
          preserveAspectRatio="none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            <linearGradient id={`grad-${hostId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.fillGradStart} />
              <stop offset="100%" stopColor={colors.fillGradEnd} />
            </linearGradient>

            {/* Glowing filter for sparkline line */}
            <filter id={`glow-${hostId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={colors.stroke} floodOpacity="0.4" />
            </filter>
          </defs>

          {/* Area Fill */}
          {areaD && isOnline && (
            <path d={areaD} fill={`url(#grad-${hostId})`} />
          )}

          {/* Stroke Path */}
          {pathD ? (
            <path
              d={pathD}
              fill="none"
              stroke={colors.stroke}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#glow-${hostId})`}
            />
          ) : (
            /* Offline dashed baseline */
            <line
              x1={paddingLeft}
              y1={paddingTop + chartHeight / 2}
              x2={width - paddingRight}
              y2={paddingTop + chartHeight / 2}
              stroke="rgba(255, 255, 255, 0.2)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          )}

          {/* Interactive Scrub Line */}
          {hoveredPoint && (
            <g>
              <line
                x1={hoveredPoint.x}
                y1={paddingTop}
                x2={hoveredPoint.x}
                y2={paddingTop + chartHeight}
                stroke="#ffffff"
                strokeOpacity="0.4"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={hoveredPoint.x}
                cy={hoveredPoint.y}
                r="4.5"
                fill="#ffffff"
                stroke={colors.stroke}
                strokeWidth="2"
              />
            </g>
          )}

          {/* Active Latest Reading Pulse Dot */}
          {isOnline && lastPoint && !hoveredPoint && (
            <g>
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r="3.5"
                fill={colors.stroke}
                className="animate-ping origin-center"
                opacity="0.75"
              />
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r="3"
                fill="#ffffff"
                stroke={colors.stroke}
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* Time Axis Labels: -30s, -20s, -10s, Now */}
          {showTimeAxis && (
            <g className="text-[10px] font-mono fill-white/40 select-none">
              <text x={paddingLeft} y={height - 4} textAnchor="start">
                {language === 'bg' ? '-30с' : '-30s'}
              </text>
              <text x={paddingLeft + chartWidth * 0.33} y={height - 4} textAnchor="middle">
                {language === 'bg' ? '-20с' : '-20s'}
              </text>
              <text x={paddingLeft + chartWidth * 0.66} y={height - 4} textAnchor="middle">
                {language === 'bg' ? '-10с' : '-10s'}
              </text>
              <text x={width - paddingRight} y={height - 4} textAnchor="end" className="fill-cyan-300 font-bold">
                {t('spark_now')}
              </text>
            </g>
          )}
        </svg>

        {/* Offline overlay notice */}
        {!isOnline && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px] rounded-xl text-white/50 text-xs font-mono">
            <span>{t('spark_sleeping_host')}</span>
          </div>
        )}
      </div>

      {/* Latency Summary Stats Strip */}
      {showSummaryStats && isOnline && stats.current !== null && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-0.5 text-xs font-mono">
          <div className="glass-liquid p-2 rounded-lg flex flex-col justify-between border border-white/5">
            <span className="text-white/40 text-[10px]">{t('spark_avg_30s')}</span>
            <span className="text-white font-bold text-[13px]">{stats.avg} ms</span>
          </div>
          <div className="glass-liquid p-2 rounded-lg flex flex-col justify-between border border-white/5">
            <span className="text-white/40 text-[10px]">{t('spark_min_max')}</span>
            <span className="text-white/90 font-semibold text-[12px]">
              {stats.min} / {stats.max} ms
            </span>
          </div>
          <div className="glass-liquid p-2 rounded-lg flex flex-col justify-between border border-white/5">
            <span className="text-white/40 text-[10px]">{t('spark_jitter')}</span>
            <span className="text-amber-300/90 font-semibold text-[12px]">
              ±{stats.jitter} ms
            </span>
          </div>
          <div className="glass-liquid p-2 rounded-lg flex flex-col justify-between border border-white/5">
            <span className="text-white/40 text-[10px]">{t('spark_stability')}</span>
            <span className="text-emerald-400 font-bold text-[12px] flex items-center space-x-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{stats.jitter <= 2.0 ? t('spark_excellent') : t('spark_stable')}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export const HostLatencySparkline = React.memo(HostLatencySparklineComponent);
