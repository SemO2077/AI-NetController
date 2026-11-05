import React, { useMemo } from 'react';
import { Activity, Zap, ArrowUpRight, Gauge, AlertCircle, CheckCircle2 } from 'lucide-react';
import { HeartbeatMetrics } from '../types';
import { useTranslation } from '../i18n/useTranslation';

interface HeartbeatSparklineProps {
  metrics: HeartbeatMetrics;
  variant?: 'compact' | 'detailed';
  onClick?: () => void;
  className?: string;
  isSimulated?: boolean;
}

const HeartbeatSparklineComponent: React.FC<HeartbeatSparklineProps> = ({
  metrics,
  variant = 'compact',
  onClick,
  className = '',
  isSimulated = false
}) => {
  const { t } = useTranslation();
  const { currentLatencyMs, history, jitterMs, minLatencyMs, maxLatencyMs, avgLatencyMs, status } = metrics;

  // Compute SVG sparkline path
  const svgData = useMemo(() => {
    // If not enough history, generate a graceful placeholder
    const data = history.length > 0 ? history : [15, 16, 14, 15, 17, 14, 16];
    const width = variant === 'compact' ? 56 : 320;
    const height = variant === 'compact' ? 20 : 64;
    const padding = variant === 'compact' ? 2 : 6;

    const minVal = Math.max(0, Math.min(...data) - 4);
    const maxVal = Math.max(minVal + 10, Math.max(...data) + 4);
    const range = maxVal - minVal || 1;

    const points = data.map((val, idx) => {
      const x = padding + (idx / Math.max(1, data.length - 1)) * (width - 2 * padding);
      const normalized = (val - minVal) / range;
      // Invert Y because SVG coordinates go down
      const y = height - padding - normalized * (height - 2 * padding);
      return { x, y, val };
    });

    if (points.length === 0) return { path: '', area: '', lastPoint: null, width, height };

    // Build smooth cubic bezier or line path
    let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cx = (prev.x + curr.x) / 2;
      path += ` C ${cx.toFixed(1)} ${prev.y.toFixed(1)}, ${cx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }

    // Area path closed to bottom
    const area = `${path} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;
    const lastPoint = points[points.length - 1];

    return { path, area, lastPoint, width, height, minVal, maxVal };
  }, [history, variant]);

  // Color scheme based on status and jitter
  const colorConfig = useMemo(() => {
    if (status === 'unreachable') {
      return {
        stroke: '#f43f5e', // rose-500
        fill: 'rgba(244, 63, 94, 0.15)',
        text: 'text-rose-400',
        border: 'border-rose-500/30',
        bg: 'bg-rose-950/40',
        glow: 'shadow-[0_0_8px_rgba(244,63,94,0.3)]',
        badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30'
      };
    }
    if (status === 'warning' || jitterMs > 25) {
      return {
        stroke: '#f59e0b', // amber-500
        fill: 'rgba(245, 158, 11, 0.15)',
        text: 'text-amber-400',
        border: 'border-amber-500/30',
        bg: 'bg-amber-950/40',
        glow: 'shadow-[0_0_8px_rgba(245,158,11,0.3)]',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      };
    }
    // Healthy
    return {
      stroke: '#06b6d4', // cyan-500
      fill: 'rgba(6, 182, 212, 0.15)',
      text: 'text-cyan-300',
      border: 'border-cyan-500/30',
      bg: 'bg-slate-900/90',
      glow: 'shadow-[0_0_8px_rgba(6,182,212,0.25)]',
      badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
    };
  }, [status, jitterMs]);

  // COMPACT VARIANT (for Main CyberHeader)
  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`group flex items-center space-x-2 px-2.5 py-1 rounded-xl border ${colorConfig.border} ${colorConfig.bg} hover:border-cyan-400/50 transition-all select-none ${className}`}
        title={`Heartbeat RTT: ${currentLatencyMs ?? 0}ms • Джитър: ±${jitterMs}ms • Кликни за WebSocket настройки`}
      >
        {/* Activity Icon */}
        <Activity className={`w-3.5 h-3.5 ${colorConfig.text} ${status === 'healthy' ? 'animate-pulse' : ''}`} />

        {/* Inline SVG Sparkline */}
        <div className="relative w-14 h-5 flex items-center">
          <svg
            viewBox={`0 0 ${svgData.width} ${svgData.height}`}
            className="w-full h-full overflow-visible"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="compactSparklineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorConfig.stroke} stopOpacity="0.35" />
                <stop offset="100%" stopColor={colorConfig.stroke} stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path d={svgData.area} fill="url(#compactSparklineGrad)" />
            <path
              d={svgData.path}
              fill="none"
              stroke={colorConfig.stroke}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {svgData.lastPoint && (
              <circle
                cx={svgData.lastPoint.x}
                cy={svgData.lastPoint.y}
                r="2"
                fill={colorConfig.stroke}
                className="animate-ping"
              />
            )}
            {svgData.lastPoint && (
              <circle
                cx={svgData.lastPoint.x}
                cy={svgData.lastPoint.y}
                r="2"
                fill="#ffffff"
              />
            )}
          </svg>
        </div>

        {/* Real-time Metric Badges */}
        <div className="flex flex-col items-start font-mono leading-none">
          <div className="flex items-center space-x-1">
            <span className={`text-[11px] font-bold ${colorConfig.text}`}>
              {currentLatencyMs !== null ? `${currentLatencyMs}ms` : '—'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 tracking-tight">
            ±{jitterMs}ms jtr
          </span>
        </div>
      </button>
    );
  }

  // DETAILED VARIANT (for WsConfigModal)
  return (
    <div className={`p-4 bg-slate-950/90 border ${colorConfig.border} rounded-xl space-y-3 select-none ${className}`}>
      {/* Header & Stability Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Gauge className={`w-4 h-4 ${colorConfig.text}`} />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider font-display">
            Real-Time Heartbeat Jitter & Latency
          </span>
          {isSimulated && (
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
              SIM
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5">
          {status === 'healthy' && (
            <span className="flex items-center space-x-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="w-3 h-3" />
              <span>{jitterMs <= 5 ? t('spark_high_stability') : t('spark_normal_variation')}</span>
            </span>
          )}
          {status === 'warning' && (
            <span className="flex items-center space-x-1 text-[11px] font-mono text-amber-400 bg-amber-950/50 border border-amber-500/30 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3 animate-pulse" />
              <span>{t('spark_delay_jitter')}</span>
            </span>
          )}
          {status === 'unreachable' && (
            <span className="flex items-center space-x-1 text-[11px] font-mono text-rose-400 bg-rose-950/50 border border-rose-500/30 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />
              <span>{t('spark_unreachable')}</span>
            </span>
          )}
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative w-full h-16 bg-slate-900/80 rounded-lg p-1.5 border border-slate-800/80 overflow-hidden">
        {/* Subtle Horizontal Grid Guides */}
        <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none opacity-20">
          <div className="w-full border-b border-slate-600 border-dashed" />
          <div className="w-full border-b border-slate-600 border-dashed" />
          <div className="w-full border-b border-slate-600 border-dashed" />
        </div>

        <svg
          viewBox={`0 0 ${svgData.width} ${svgData.height}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="detailedSparklineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorConfig.stroke} stopOpacity="0.4" />
              <stop offset="100%" stopColor={colorConfig.stroke} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Fill Area */}
          <path d={svgData.area} fill="url(#detailedSparklineGrad)" />

          {/* Stroke Line */}
          <path
            d={svgData.path}
            fill="none"
            stroke={colorConfig.stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points */}
          {svgData.lastPoint && (
            <>
              <circle
                cx={svgData.lastPoint.x}
                cy={svgData.lastPoint.y}
                r="3.5"
                fill={colorConfig.stroke}
                className="animate-ping"
              />
              <circle
                cx={svgData.lastPoint.x}
                cy={svgData.lastPoint.y}
                r="3.5"
                fill="#ffffff"
              />
            </>
          )}
        </svg>

        {/* Watermark Min/Max scale labels */}
        <div className="absolute bottom-1 right-2 text-[10px] font-mono text-slate-500 pointer-events-none">
          Max: {maxLatencyMs}ms
        </div>
        <div className="absolute top-1 right-2 text-[10px] font-mono text-slate-500 pointer-events-none">
          Min: {minLatencyMs}ms
        </div>
      </div>

      {/* Numerical Metrics Row */}
      <div className="grid grid-cols-4 gap-2 pt-1">
        <div className="bg-slate-900/70 p-2 rounded-lg border border-slate-800/90 text-center">
          <div className="text-[10px] text-slate-400 uppercase font-mono">{t('spark_rtt_now')}</div>
          <div className={`text-sm font-bold font-mono ${colorConfig.text}`}>
            {currentLatencyMs !== null ? `${currentLatencyMs} ms` : '—'}
          </div>
        </div>

        <div className="bg-slate-900/70 p-2 rounded-lg border border-slate-800/90 text-center">
          <div className="text-[10px] text-slate-400 uppercase font-mono">{t('spark_jitter')}</div>
          <div className="text-sm font-bold font-mono text-amber-300">
            ±{jitterMs} ms
          </div>
        </div>

        <div className="bg-slate-900/70 p-2 rounded-lg border border-slate-800/90 text-center">
          <div className="text-[10px] text-slate-400 uppercase font-mono">{t('spark_avg_30s')}</div>
          <div className="text-sm font-bold font-mono text-slate-200">
            {avgLatencyMs} ms
          </div>
        </div>

        <div className="bg-slate-900/70 p-2 rounded-lg border border-slate-800/90 text-center">
          <div className="text-[10px] text-slate-400 uppercase font-mono">{t('spark_samples')}</div>
          <div className="text-sm font-bold font-mono text-slate-400">
            {history.length} / 20
          </div>
        </div>
      </div>
    </div>
  );
};

export const HeartbeatSparkline = React.memo(HeartbeatSparklineComponent);
