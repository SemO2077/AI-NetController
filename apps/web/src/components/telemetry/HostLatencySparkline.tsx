import React, { useId, useState, useMemo, useRef, useCallback } from 'react';
import { LatencyDataPoint } from '../../types';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { useUIStore } from '../../store/uiStore';

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
  const themeMode = useUIStore((s) => s.themeMode);
  const isLight = themeMode === 'light';
  const safeUid = useId().replace(/:/g, '');
  const sanitizedHostId = hostId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const gradId = `grad-${sanitizedHostId}-${safeUid}`;
  const glowId = `glow-${sanitizedHostId}-${safeUid}`;
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
        : 0;

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

  // Adaptive Daylight / Vibrant Dark colors
  const colors = useMemo(() => {
    if (!isOnline) {
      return {
        stroke: isLight ? 'rgba(99, 102, 241, 0.30)' : 'rgba(255, 255, 255, 0.25)',
        fillGradStart: 'rgba(148, 163, 184, 0.08)',
        fillGradEnd: 'rgba(148, 163, 184, 0.0)',
        text: 'ink-muted',
        badge: 'liquid-control-pill ink-muted',
      };
    }

    switch (statusLevel) {
      case 'high':
        return {
          stroke: isLight ? '#e11d48' : '#fb7185',
          fillGradStart: 'rgba(244, 63, 94, 0.32)',
          fillGradEnd: 'rgba(244, 63, 94, 0.0)',
          text: 'text-rose-400',
          badge: 'bg-rose-500/14 text-rose-400 border-rose-500/35',
        };
      case 'moderate':
        return {
          stroke: isLight ? '#d97706' : '#fbbf24',
          fillGradStart: 'rgba(245, 158, 11, 0.28)',
          fillGradEnd: 'rgba(245, 158, 11, 0.0)',
          text: 'text-amber-400',
          badge: 'bg-amber-500/14 text-amber-400 border-amber-500/35',
        };
      case 'good':
        return {
          stroke: isLight ? '#0284c7' : '#22d3ee',
          fillGradStart: 'rgba(14, 165, 233, 0.30)',
          fillGradEnd: 'rgba(14, 165, 233, 0.0)',
          text: 'text-sky-400',
          badge: 'bg-sky-500/14 text-sky-400 border-sky-500/35',
        };
      case 'optimal':
      default:
        return {
          stroke: isLight ? '#059669' : '#34d399',
          fillGradStart: 'rgba(16, 185, 129, 0.30)',
          fillGradEnd: 'rgba(16, 185, 129, 0.0)',
          text: 'text-emerald-400',
          badge: 'bg-emerald-500/14 text-emerald-400 border-emerald-500/35',
        };
    }
  }, [isOnline, statusLevel, isLight]);

  // Pointer scrubbing interaction
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!interactive || pointCoords.length === 0) return;
      let svgX: number;
      const ctm = e.currentTarget.getScreenCTM?.();
      if (ctm && ctm.a) {
        svgX = (e.clientX - ctm.e) / ctm.a;
      } else {
        const rect = e.currentTarget.getBoundingClientRect();
        svgX = ((e.clientX - rect.left) / rect.width) * width;
      }

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
  const axisFill = isLight ? '#5a6085' : 'rgba(226, 232, 255, 0.55)';
  const nowFill = isLight ? '#7c3aed' : '#c084fc';
  const guideStroke = isLight ? 'rgba(99, 102, 241, 0.22)' : 'rgba(196, 181, 253, 0.22)';

  return (
    <div
      ref={containerRef}
      className={`w-full flex flex-col space-y-2.5 select-none ${className}`}
      id={`latency-sparkline-${hostId}`}
    >
      {/* Chart Header with Live Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400/70'
              }`}
            />
            <span className="text-xs font-display font-bold ink-primary tracking-tight">
              {language === 'bg' ? 'Латентност (30 сек)' : 'Latency (Last 30s)'}
            </span>
          </div>
          <span className="liquid-control-pill px-2.5 py-0.5 rounded-full text-[10px] font-mono text-cyan-400 font-semibold shrink-0">
            {language === 'bg' ? '1 Hz телеметрия' : '1 Hz live'}
          </span>
        </div>

        {isOnline && stats.current !== null && (
          <div className="flex items-center space-x-1.5 font-mono text-xs">
            <span className="ink-muted text-[11px]">
              {language === 'bg' ? 'Текущ RTT:' : 'Current RTT:'}
            </span>
            <span className={`font-bold px-2.5 py-0.5 rounded-full border ${colors.badge}`}>
              {stats.current} ms
            </span>
          </div>
        )}
      </div>

      {/* Adaptive SVG Canvas Area */}
      <div className="relative w-full rounded-2xl liquid-terminal-entry p-2.5 overflow-hidden">
        <div className="absolute inset-x-3 top-2.5 bottom-6 pointer-events-none flex flex-col justify-between opacity-30">
          <div className="w-full border-b border-dashed" style={{ borderColor: guideStroke }} />
          <div className="w-full border-b border-dashed" style={{ borderColor: guideStroke }} />
          <div className="w-full border-b border-dashed" style={{ borderColor: guideStroke }} />
        </div>

        {hoveredPoint && (
          <div
            className="absolute z-30 pointer-events-none top-1.5 transform -translate-x-1/2 transition-all duration-75"
            style={{
              left: `${Math.min(86, Math.max(14, (hoveredPoint.x / width) * 100))}%`,
            }}
          >
            <div className="glass-liquid-modal px-2.5 py-1 rounded-full text-[11px] font-mono flex items-center space-x-1.5 ink-primary whitespace-nowrap">
              <span className={`font-bold ${colors.text}`}>{hoveredPoint.latency} ms</span>
              <span className="ink-muted">•</span>
              <span className="ink-secondary text-[10px]">
                {hoveredPoint.relativeSeconds <= 0.5
                  ? language === 'bg'
                    ? 'сега'
                    : 'now'
                  : language === 'bg'
                  ? `преди ${hoveredPoint.relativeSeconds}с`
                  : `${hoveredPoint.relativeSeconds}s ago`}
              </span>
            </div>
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={`w-full overflow-visible touch-none cursor-crosshair ${
            compact ? 'aspect-[240/52] max-h-16' : 'aspect-[380/82] min-h-[76px] max-h-28'
          }`}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.fillGradStart} />
              <stop offset="100%" stopColor={colors.fillGradEnd} />
            </linearGradient>

            <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={colors.stroke} floodOpacity={isLight ? '0.25' : '0.45'} />
            </filter>
          </defs>

          {areaD && isOnline && <path d={areaD} fill={`url(#${gradId})`} />}

          {pathD ? (
            <path
              d={pathD}
              fill="none"
              stroke={colors.stroke}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${glowId})`}
            />
          ) : (
            <line
              x1={paddingLeft}
              y1={paddingTop + chartHeight / 2}
              x2={width - paddingRight}
              y2={paddingTop + chartHeight / 2}
              stroke={guideStroke}
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          )}

          {hoveredPoint && (
            <g>
              <line
                x1={hoveredPoint.x}
                y1={paddingTop}
                x2={hoveredPoint.x}
                y2={paddingTop + chartHeight}
                stroke={colors.stroke}
                strokeOpacity="0.45"
                strokeWidth="1.2"
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

          {isOnline && lastPoint && !hoveredPoint && (
            <g>
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r="3.5"
                fill={colors.stroke}
                className="animate-ping origin-center"
                opacity="0.7"
              />
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r="3"
                fill="#ffffff"
                stroke={colors.stroke}
                strokeWidth="1.75"
              />
            </g>
          )}

          {showTimeAxis && (
            <g className="text-[10px] font-mono select-none" fill={axisFill}>
              <text x={paddingLeft} y={height - 4} textAnchor="start">
                {language === 'bg' ? '-30с' : '-30s'}
              </text>
              <text x={paddingLeft + chartWidth * 0.33} y={height - 4} textAnchor="middle">
                {language === 'bg' ? '-20с' : '-20s'}
              </text>
              <text x={paddingLeft + chartWidth * 0.66} y={height - 4} textAnchor="middle">
                {language === 'bg' ? '-10с' : '-10s'}
              </text>
              <text x={width - paddingRight} y={height - 4} textAnchor="end" fill={nowFill} fontWeight={700}>
                {t('spark_now')}
              </text>
            </g>
          )}
        </svg>

        {!isOnline && (
          <div className="absolute inset-0 flex items-center justify-center backdrop-blur-[2px] rounded-2xl ink-muted text-xs font-mono font-semibold">
            <span>{t('spark_sleeping_host')}</span>
          </div>
        )}
      </div>

      {/* Latency Summary Stats Strip */}
      {showSummaryStats && isOnline && stats.current !== null && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5 text-xs font-mono">
          <div className="glass-liquid-subtle p-2.5 rounded-2xl flex flex-col justify-between">
            <span className="ink-muted text-[10px]">{t('spark_avg_30s')}</span>
            <span className="ink-primary font-extrabold text-[13px] mt-0.5">{stats.avg} ms</span>
          </div>
          <div className="glass-liquid-subtle p-2.5 rounded-2xl flex flex-col justify-between">
            <span className="ink-muted text-[10px]">{t('spark_min_max')}</span>
            <span className="ink-primary font-bold text-[12px] mt-0.5">
              {stats.min} / {stats.max} ms
            </span>
          </div>
          <div className="glass-liquid-subtle p-2.5 rounded-2xl flex flex-col justify-between">
            <span className="ink-muted text-[10px]">{t('spark_jitter')}</span>
            <span className="text-amber-400 font-bold text-[12px] mt-0.5">
              ±{stats.jitter} ms
            </span>
          </div>
          <div className="glass-liquid-subtle p-2.5 rounded-2xl flex flex-col justify-between">
            <span className="ink-muted text-[10px]">{t('spark_stability')}</span>
            <span className="text-emerald-400 font-bold text-[12px] flex items-center space-x-1 mt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{stats.jitter <= 2.0 ? t('spark_excellent') : t('spark_stable')}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export const HostLatencySparkline = React.memo(HostLatencySparklineComponent);
