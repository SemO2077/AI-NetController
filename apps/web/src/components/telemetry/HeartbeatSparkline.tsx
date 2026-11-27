import React, { useId, useMemo } from 'react';
import { Activity, Gauge, AlertCircle, CheckCircle2 } from 'lucide-react';
import { HeartbeatMetrics } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';
import { useUIStore } from '../../store/uiStore';

interface HeartbeatSparklineProps {
  metrics: HeartbeatMetrics;
  variant?: 'compact' | 'detailed';
  onClick?: () => void;
  className?: string;
}

const HeartbeatSparklineComponent: React.FC<HeartbeatSparklineProps> = ({
  metrics,
  variant = 'compact',
  onClick,
  className = '',
}) => {
  const { t, language } = useTranslation();
  const themeMode = useUIStore((s) => s.themeMode);
  const isLight = themeMode === 'light';
  const uid = useId();
  const compactGradId = `compactSparklineGrad-${uid}`;
  const detailedGradId = `detailedSparklineGrad-${uid}`;
  const { currentLatencyMs, history, jitterMs, minLatencyMs, maxLatencyMs, avgLatencyMs, status } = metrics;

  // Compute SVG sparkline path from real measured samples only
  const svgData = useMemo(() => {
    const data =
      history.length >= 2
        ? history
        : history.length === 1
        ? [history[0], history[0]]
        : currentLatencyMs !== null
        ? [currentLatencyMs, currentLatencyMs]
        : [];
    const width = variant === 'compact' ? 56 : 320;
    const height = variant === 'compact' ? 20 : 64;
    const padding = variant === 'compact' ? 2 : 6;

    if (data.length === 0) {
      return { path: '', area: '', lastPoint: null, width, height, minVal: 0, maxVal: 0 };
    }

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
  }, [history, currentLatencyMs, variant]);

  // Color scheme based on status, jitter, and polarity
  const colorConfig = useMemo(() => {
    if (status === 'unreachable') {
      return {
        stroke: isLight ? '#e11d48' : '#fb7185',
        text: 'text-rose-400',
        border: 'border-rose-500/35',
        dotFill: isLight ? '#ffffff' : '#ffffff',
      };
    }
    if (status === 'warning' || jitterMs > 25) {
      return {
        stroke: isLight ? '#d97706' : '#fbbf24',
        text: 'text-amber-400',
        border: 'border-amber-500/35',
        dotFill: '#ffffff',
      };
    }
    return {
      stroke: isLight ? '#7c3aed' : '#22d3ee',
      text: 'text-cyan-400',
      border: 'border-cyan-400/35',
      dotFill: '#ffffff',
    };
  }, [status, jitterMs, isLight]);

  // COMPACT VARIANT
  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`group flex items-center space-x-2 px-3 py-1 rounded-full liquid-control-pill border ${colorConfig.border} transition-all select-none cursor-pointer ${className}`}
        title={
          language === 'bg'
            ? `Heartbeat RTT: ${currentLatencyMs ?? 0}ms • Джитър: ±${jitterMs}ms • Кликни за WebSocket настройки`
            : `Heartbeat RTT: ${currentLatencyMs ?? 0}ms • Jitter: ±${jitterMs}ms • Click for WebSocket settings`
        }
      >
        <Activity className={`w-3.5 h-3.5 ${colorConfig.text} ${status === 'healthy' ? 'animate-pulse' : ''}`} />

        <div className="relative w-14 h-5 flex items-center">
          <svg
            viewBox={`0 0 ${svgData.width} ${svgData.height}`}
            className="w-full h-full overflow-visible"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id={compactGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorConfig.stroke} stopOpacity="0.38" />
                <stop offset="100%" stopColor={colorConfig.stroke} stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path d={svgData.area} fill={`url(#${compactGradId})`} />
            <path
              d={svgData.path}
              fill="none"
              stroke={colorConfig.stroke}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {svgData.lastPoint && (
              <circle
                cx={svgData.lastPoint.x}
                cy={svgData.lastPoint.y}
                r="2"
                fill={colorConfig.stroke}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                className="animate-ping"
              />
            )}
            {svgData.lastPoint && (
              <circle
                cx={svgData.lastPoint.x}
                cy={svgData.lastPoint.y}
                r="2"
                fill={colorConfig.dotFill}
                stroke={colorConfig.stroke}
                strokeWidth="1"
              />
            )}
          </svg>
        </div>

        <div className="flex flex-col items-start font-mono leading-none">
          <span className={`text-[11px] font-bold ${colorConfig.text}`}>
            {currentLatencyMs !== null ? `${currentLatencyMs}ms` : '—'}
          </span>
          <span className="text-[10px] ink-muted tracking-tight">
            ±{jitterMs}ms jtr
          </span>
        </div>
      </button>
    );
  }

  // DETAILED VARIANT (Dual-Mode Liquid Glass for WsConfigModal)
  return (
    <div className={`p-4 glass-liquid-subtle border ${colorConfig.border} rounded-[24px] space-y-3 select-none ${className}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 squircle-badge squircle-hero flex items-center justify-center shrink-0">
            <Gauge className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold ink-primary font-display tracking-tight">
            {language === 'bg' ? 'Латентност и джитър в реално време' : 'Real-Time Heartbeat Jitter & Latency'}
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          {status === 'healthy' && (
            <span className="flex items-center space-x-1 text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/14 border border-emerald-500/35 px-2.5 py-0.5 rounded-full">
              <CheckCircle2 className="w-3 h-3" />
              <span>{jitterMs <= 5 ? t('spark_high_stability') : t('spark_normal_variation')}</span>
            </span>
          )}
          {status === 'warning' && (
            <span className="flex items-center space-x-1 text-[11px] font-mono font-bold text-amber-400 bg-amber-500/14 border border-amber-500/35 px-2.5 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3 animate-pulse" />
              <span>{t('spark_delay_jitter')}</span>
            </span>
          )}
          {status === 'unreachable' && (
            <span className="flex items-center space-x-1 text-[11px] font-mono font-bold text-rose-400 bg-rose-500/14 border border-rose-500/35 px-2.5 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />
              <span>{t('spark_unreachable')}</span>
            </span>
          )}
        </div>
      </div>

      {/* Adaptive SVG Canvas */}
      <div className="relative w-full h-18 liquid-terminal-entry rounded-2xl p-2 overflow-hidden">
        <div className="absolute inset-0 flex flex-col justify-between p-2.5 pointer-events-none opacity-25">
          <div className="w-full border-b border-current border-dashed" />
          <div className="w-full border-b border-current border-dashed" />
          <div className="w-full border-b border-current border-dashed" />
        </div>

        <svg
          viewBox={`0 0 ${svgData.width} ${svgData.height}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id={detailedGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorConfig.stroke} stopOpacity={isLight ? '0.32' : '0.42'} />
              <stop offset="100%" stopColor={colorConfig.stroke} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <path d={svgData.area} fill={`url(#${detailedGradId})`} />
          <path
            d={svgData.path}
            fill="none"
            stroke={colorConfig.stroke}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {svgData.lastPoint && (
            <>
              <circle
                cx={svgData.lastPoint.x}
                cy={svgData.lastPoint.y}
                r="3.5"
                fill={colorConfig.stroke}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                className="animate-ping"
              />
              <circle
                cx={svgData.lastPoint.x}
                cy={svgData.lastPoint.y}
                r="3.5"
                fill="#ffffff"
                stroke={colorConfig.stroke}
                strokeWidth="1.5"
              />
            </>
          )}
        </svg>

        <div className="absolute bottom-1 right-2.5 text-[10px] font-mono ink-muted pointer-events-none">
          Max: {maxLatencyMs}ms
        </div>
        <div className="absolute top-1 right-2.5 text-[10px] font-mono ink-muted pointer-events-none">
          Min: {minLatencyMs}ms
        </div>
      </div>

      {/* Numerical KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
        <div className="liquid-terminal-entry p-2.5 rounded-2xl text-center">
          <div className="text-[10px] ink-muted uppercase font-mono">{t('spark_rtt_now')}</div>
          <div className={`text-sm font-extrabold font-mono ${colorConfig.text} mt-0.5`}>
            {currentLatencyMs !== null ? `${currentLatencyMs} ms` : '—'}
          </div>
        </div>

        <div className="liquid-terminal-entry p-2.5 rounded-2xl text-center">
          <div className="text-[10px] ink-muted uppercase font-mono">{t('spark_jitter')}</div>
          <div className="text-sm font-extrabold font-mono text-amber-400 mt-0.5">
            ±{jitterMs} ms
          </div>
        </div>

        <div className="liquid-terminal-entry p-2.5 rounded-2xl text-center">
          <div className="text-[10px] ink-muted uppercase font-mono">{t('spark_avg_30s')}</div>
          <div className="text-sm font-extrabold font-mono ink-primary mt-0.5">
            {avgLatencyMs} ms
          </div>
        </div>

        <div className="liquid-terminal-entry p-2.5 rounded-2xl text-center">
          <div className="text-[10px] ink-muted uppercase font-mono">{t('spark_samples')}</div>
          <div className="text-sm font-extrabold font-mono ink-secondary mt-0.5">
            {history.length} / 20
          </div>
        </div>
      </div>
    </div>
  );
};

export const HeartbeatSparkline = React.memo(HeartbeatSparklineComponent);
