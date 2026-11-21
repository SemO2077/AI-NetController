import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Calendar, CheckCircle2, Moon } from 'lucide-react';
import { WolSchedule, Weekday } from '../../types';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { localizeWolSchedule } from '../../services/wolService';
import { useUIStore } from '../../store/uiStore';
import { SPRING_JELLY } from '../../utils/springPhysics';

interface WolEnergyWeeklyChartProps {
  schedules?: WolSchedule[];
  hostCount?: number;
  activeHoursPerDay?: number;
  onActiveHoursChange?: (hours: number) => void;
  activeWatts?: number;
  standbyWatts?: number;
  kwhRate?: number;
  currencySymbol?: string;
}

interface DayDataPoint {
  dayKey: Weekday;
  dayShort: string;
  dayFull: string;
  isScheduled: boolean;
  scheduledEvents: string[];
  activeHours: number;
  standbyHours: number;
  baselineKwh: number;
  scheduledKwh: number;
  savedKwh: number;
  percentSaved: number;
  baselineCost: number;
  scheduledCost: number;
  savedCost: number;
}

const WeeklyEnergyTooltip: React.FC<{
  active?: boolean;
  payload?: any[];
  isBg: boolean;
  currencySymbol: string;
}> = ({ active, payload, isBg, currencySymbol }) => {
  if (!active || !payload || !payload.length) return null;
  const data: DayDataPoint = payload[0].payload;
  return (
    <div className="glass-liquid-modal rounded-2xl p-3.5 text-xs font-sans max-w-xs z-50">
      <div className="flex items-center justify-between border-b border-white/[0.10] pb-2 mb-2 gap-3">
        <span className="font-bold ink-primary font-display text-sm">{data.dayFull}</span>
        {data.isScheduled ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/16 text-emerald-400 border border-emerald-500/35">
            {isBg ? 'Активен график' : 'WoL Active'}
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono ink-muted liquid-control-pill">
            {isBg ? '24ч Готовност' : '24h Standby'}
          </span>
        )}
      </div>

      <div className="space-y-1.5 font-mono text-[11px]">
        <div className="flex justify-between items-center gap-3">
          <span className="flex items-center gap-1.5 text-rose-400 font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            {isBg ? '24/7 Базова:' : '24/7 Baseline:'}
          </span>
          <span className="font-bold ink-primary tabular-nums">
            {data.baselineKwh} kWh ({data.baselineCost} {currencySymbol})
          </span>
        </div>

        <div className="flex justify-between items-center gap-3">
          <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />
            {isBg ? `По график (${data.activeHours}ч):` : `Scheduled (${data.activeHours}h):`}
          </span>
          <span className="font-bold text-cyan-400 tabular-nums">
            {data.scheduledKwh} kWh ({data.scheduledCost} {currencySymbol})
          </span>
        </div>

        <div className="border-t border-white/[0.10] pt-1.5 mt-1 flex justify-between items-center text-emerald-400 font-bold">
          <span>{isBg ? 'Спестени:' : 'Saved:'}</span>
          <span className="tabular-nums">
            +{data.savedKwh} kWh (-{data.percentSaved}%)
          </span>
        </div>
      </div>

      {data.scheduledEvents.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-white/[0.08] text-[10px] ink-muted">
          <span className="font-mono font-semibold">{isBg ? 'Графици: ' : 'Schedules: '}</span>
          {data.scheduledEvents.join(', ')}
        </div>
      )}
    </div>
  );
};

export const WolEnergyWeeklyChart: React.FC<WolEnergyWeeklyChartProps> = ({
  schedules = [],
  hostCount = 15,
  activeHoursPerDay,
  onActiveHoursChange,
  activeWatts = 115,
  standbyWatts = 1.8,
  kwhRate = 0.28,
  currencySymbol = 'BGN',
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';
  const themeMode = useUIStore((s) => s.themeMode);
  const isLight = themeMode === 'light';

  const initialScheduledHours = activeHoursPerDay ?? 8;
  const [scheduledDayActiveHours, setScheduledDayActiveHours] = useState<number>(
    initialScheduledHours
  );
  const [activeMetricView, setActiveMetricView] = useState<'kwh' | 'cost'>('kwh');

  useEffect(() => {
    if (typeof activeHoursPerDay === 'number' && Number.isFinite(activeHoursPerDay)) {
      setScheduledDayActiveHours(activeHoursPerDay);
    }
  }, [activeHoursPerDay]);

  const effectiveActiveHoursPerDay = scheduledDayActiveHours;

  const weekdayDefs = useMemo(
    () => [
      { key: 'mon' as Weekday, short: isBg ? 'Пон' : 'Mon', full: isBg ? 'Понеделник' : 'Monday' },
      { key: 'tue' as Weekday, short: isBg ? 'Вто' : 'Tue', full: isBg ? 'Вторник' : 'Tuesday' },
      { key: 'wed' as Weekday, short: isBg ? 'Сря' : 'Wed', full: isBg ? 'Сряда' : 'Wednesday' },
      { key: 'thu' as Weekday, short: isBg ? 'Чет' : 'Thu', full: isBg ? 'Четвъртък' : 'Thursday' },
      { key: 'fri' as Weekday, short: isBg ? 'Пет' : 'Fri', full: isBg ? 'Петък' : 'Friday' },
      { key: 'sat' as Weekday, short: isBg ? 'Съб' : 'Sat', full: isBg ? 'Събота' : 'Saturday' },
      { key: 'sun' as Weekday, short: isBg ? 'Нед' : 'Sun', full: isBg ? 'Неделя' : 'Sunday' },
    ],
    [isBg]
  );

  const enabledSchedulesCount = useMemo(
    () => schedules.filter((s) => s.enabled).length,
    [schedules]
  );

  const weeklyData = useMemo(() => {
    const enabledSchedules = schedules.filter((s) => s.enabled);

    return weekdayDefs.map((dayDef) => {
      const matchingSchedules = enabledSchedules.filter(
        (s) => s.days && s.days.includes(dayDef.key)
      );

      const isScheduled = enabledSchedules.length > 0 && matchingSchedules.length > 0;
      const scheduledEvents = matchingSchedules.map((s) => {
        const loc = localizeWolSchedule(s, language);
        return `${loc.name} (${s.time})`;
      });

      const activeHours = isScheduled ? effectiveActiveHoursPerDay : 0;
      const standbyHours = Math.max(0, 24 - activeHours);

      const baselineKwh = (hostCount * activeWatts * 24) / 1000;
      const scheduledKwh =
        (hostCount * activeWatts * activeHours + hostCount * standbyWatts * standbyHours) / 1000;

      const savedKwh = Math.max(0, baselineKwh - scheduledKwh);
      const percentSaved = baselineKwh > 0 ? (savedKwh / baselineKwh) * 100 : 0;

      const baselineCost = baselineKwh * kwhRate;
      const scheduledCost = scheduledKwh * kwhRate;
      const savedCost = savedKwh * kwhRate;

      return {
        dayKey: dayDef.key,
        dayShort: dayDef.short,
        dayFull: dayDef.full,
        isScheduled,
        scheduledEvents,
        activeHours,
        standbyHours,
        baselineKwh: Number(baselineKwh.toFixed(2)),
        scheduledKwh: Number(scheduledKwh.toFixed(2)),
        savedKwh: Number(savedKwh.toFixed(2)),
        percentSaved: Number(percentSaved.toFixed(1)),
        baselineCost: Number(baselineCost.toFixed(2)),
        scheduledCost: Number(scheduledCost.toFixed(2)),
        savedCost: Number(savedCost.toFixed(2)),
      } as DayDataPoint;
    });
  }, [
    schedules,
    weekdayDefs,
    hostCount,
    activeWatts,
    standbyWatts,
    kwhRate,
    effectiveActiveHoursPerDay,
    language,
  ]);

  const weeklyTotals = useMemo(() => {
    let totalBaselineKwh = 0;
    let totalScheduledKwh = 0;
    let totalSavedKwh = 0;
    let totalBaselineCost = 0;
    let totalScheduledCost = 0;
    let totalSavedCost = 0;
    let totalScheduledDays = 0;

    weeklyData.forEach((d) => {
      totalBaselineKwh += d.baselineKwh;
      totalScheduledKwh += d.scheduledKwh;
      totalSavedKwh += d.savedKwh;
      totalBaselineCost += d.baselineCost;
      totalScheduledCost += d.scheduledCost;
      totalSavedCost += d.savedCost;
      if (d.isScheduled) totalScheduledDays += 1;
    });

    const overallPercentSaved =
      totalBaselineKwh > 0 ? ((totalSavedKwh / totalBaselineKwh) * 100).toFixed(1) : '0';

    return {
      totalBaselineKwh: totalBaselineKwh.toFixed(1),
      totalScheduledKwh: totalScheduledKwh.toFixed(1),
      totalSavedKwh: totalSavedKwh.toFixed(1),
      totalBaselineCost: totalBaselineCost.toFixed(2),
      totalScheduledCost: totalScheduledCost.toFixed(2),
      totalSavedCost: totalSavedCost.toFixed(2),
      totalScheduledDays,
      overallPercentSaved,
    };
  }, [weeklyData]);

  // Dual-mode chart palette tokens
  const gridStroke = isLight ? 'rgba(99, 102, 241, 0.14)' : 'rgba(196, 181, 253, 0.14)';
  const axisTickColor = isLight ? '#4b4f75' : '#cbd5f5';
  const axisLineStroke = isLight ? 'rgba(99, 102, 241, 0.22)' : 'rgba(196, 181, 253, 0.22)';
  const cursorFill = isLight ? 'rgba(124, 58, 237, 0.06)' : 'rgba(192, 132, 252, 0.10)';

  return (
    <div className="w-full rounded-[24px] glass-liquid-subtle p-4 sm:p-5 space-y-4">
      {/* Header & Sliding Metric Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.10] pb-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-7 h-7 squircle-badge squircle-sky flex items-center justify-center shrink-0">
              <Calendar className="w-3.5 h-3.5" />
            </div>
            <h4 className="text-xs sm:text-sm font-bold ink-primary font-display tracking-tight">
              {isBg ? 'Седмично сравнение на енергията' : 'Weekly Energy Comparison'}
            </h4>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-violet-500/15 dark:bg-violet-950/75 text-violet-700 dark:text-violet-200 border border-violet-500/35 font-bold">
              {weeklyTotals.totalScheduledDays}{' '}
              {isBg ? 'активни дни' : 'scheduled days'}
            </span>
          </div>
          <p className="text-[11px] ink-muted mt-1">
            {isBg
              ? `Прогнозна консумация по дни (${hostCount} хоста @ ${activeWatts}W активна мощност)`
              : `Daily load forecast from enabled Wake-on-LAN schedules (${hostCount} hosts @ ${activeWatts}W)`}
          </p>
        </div>

        {/* Sliding Liquid Pill Metric Switcher */}
        <div className="flex items-center glass-liquid-subtle p-1 rounded-full self-start sm:self-auto shrink-0">
          {(
            [
              { id: 'kwh' as const, label: isBg ? 'Енергия (kWh)' : 'Energy (kWh)' },
              { id: 'cost' as const, label: isBg ? `Стойност (${currencySymbol})` : `Cost (${currencySymbol})` },
            ]
          ).map((opt) => {
            const active = activeMetricView === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  setActiveMetricView(opt.id);
                }}
                className={`relative px-3 h-7 rounded-full text-[11px] font-semibold transition cursor-pointer whitespace-nowrap ${
                  active ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="wolWeeklyMetricPill"
                    transition={SPRING_JELLY}
                    className="absolute inset-0 rounded-full liquid-hero-btn pointer-events-none"
                  />
                )}
                <span className="relative z-10 font-mono">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Weekly KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-2xl liquid-terminal-entry p-3">
          <div className="text-[10px] ink-muted font-semibold uppercase tracking-wide">
            {isBg ? '24/7 Базов товар' : '24/7 Baseline Load'}
          </div>
          <div className="text-sm sm:text-base font-bold text-rose-400 font-mono tabular-nums mt-0.5">
            {activeMetricView === 'kwh'
              ? `${weeklyTotals.totalBaselineKwh} kWh`
              : `${weeklyTotals.totalBaselineCost} ${currencySymbol}`}
          </div>
          <div className="text-[10px] ink-muted font-mono">
            {isBg ? '168ч непрекъснато' : '168h continuous idle'}
          </div>
        </div>

        <div className="rounded-2xl liquid-terminal-entry p-3 border border-cyan-400/30">
          <div className="text-[10px] text-cyan-400 font-semibold uppercase tracking-wide">
            {isBg ? 'По WoL график' : 'WoL Scheduled'}
          </div>
          <div className="text-sm sm:text-base font-bold text-cyan-400 font-mono tabular-nums mt-0.5">
            {activeMetricView === 'kwh'
              ? `${weeklyTotals.totalScheduledKwh} kWh`
              : `${weeklyTotals.totalScheduledCost} ${currencySymbol}`}
          </div>
          <div className="text-[10px] ink-muted font-mono">
            {isBg
              ? `${weeklyTotals.totalScheduledDays} активни + готовност`
              : `${weeklyTotals.totalScheduledDays} active + standby`}
          </div>
        </div>

        <div className="rounded-2xl liquid-terminal-entry p-3 border border-emerald-500/30">
          <div className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide">
            {isBg ? 'Спестени / седм.' : 'Weekly Saved'}
          </div>
          <div className="text-sm sm:text-base font-bold text-emerald-400 font-mono tabular-nums mt-0.5">
            {activeMetricView === 'kwh'
              ? `-${weeklyTotals.totalSavedKwh} kWh`
              : `-${weeklyTotals.totalSavedCost} ${currencySymbol}`}
          </div>
          <div className="text-[10px] text-emerald-400 font-mono font-semibold">
            -{weeklyTotals.overallPercentSaved}% {isBg ? 'редукция' : 'reduction'}
          </div>
        </div>

        <div className="rounded-2xl liquid-terminal-entry p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] ink-muted font-semibold uppercase">
            <span>{isBg ? 'Активни ч/ден' : 'Active h/day'}</span>
            <span className="text-amber-400 font-mono font-bold">
              {scheduledDayActiveHours}
              {isBg ? 'ч' : 'h'}
            </span>
          </div>
          <input
            type="range"
            min={2}
            max={18}
            step={1}
            value={scheduledDayActiveHours}
            onChange={(e) => {
              const next = Number(e.target.value);
              setScheduledDayActiveHours(next);
              onActiveHoursChange?.(next);
            }}
            className="w-full accent-violet-500 cursor-pointer h-1.5 mt-1.5"
          />
          <div className="flex justify-between text-[10px] ink-muted font-mono mt-1">
            <span>4{isBg ? 'ч' : 'h'}</span>
            <span>8{isBg ? 'ч' : 'h'}</span>
            <span>16{isBg ? 'ч' : 'h'}</span>
          </div>
        </div>
      </div>

      {enabledSchedulesCount === 0 && (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/12 px-3.5 py-2.5 text-[11px] text-amber-400 font-medium flex items-center gap-2">
          <Moon className="w-4 h-4 shrink-0" />
          <span>
            {isBg
              ? 'Няма активни Wake-on-LAN графици — активирайте или добавете график, за да моделирате реални спестявания.'
              : 'No active Wake-on-LAN schedules enabled — add or enable a schedule to model live weekly savings.'}
          </span>
        </div>
      )}

      {/* Adaptive Daylight / Vibrant Dark Recharts Bar Chart */}
      <div className="w-full h-64 pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={weeklyData}
            margin={{ top: 10, right: 12, left: 4, bottom: 0 }}
            barGap={6}
          >
            <defs>
              <linearGradient id="wolBaselineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={isLight ? 0.72 : 0.78} />
                <stop offset="100%" stopColor="#fb7185" stopOpacity={isLight ? 0.24 : 0.25} />
              </linearGradient>
              <linearGradient id="wolScheduledGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isLight ? '#7c3aed' : '#c084fc'} stopOpacity={0.98} />
                <stop offset="100%" stopColor={isLight ? '#0ea5e9' : '#38bdf8'} stopOpacity={0.78} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke={gridStroke} vertical={false} />
            <XAxis
              dataKey="dayShort"
              stroke={axisLineStroke}
              tick={{ fill: axisTickColor, fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}
              tickLine={false}
            />
            <YAxis
              width={78}
              stroke={axisLineStroke}
              tick={{ fill: axisTickColor, fontSize: 10, fontFamily: 'monospace' }}
              tickLine={false}
              tickFormatter={(v) =>
                activeMetricView === 'kwh' ? `${v} kWh` : `${v} ${currencySymbol}`
              }
            />
            <Tooltip
              cursor={{ fill: cursorFill, radius: 10 }}
              content={<WeeklyEnergyTooltip isBg={isBg} currencySymbol={currencySymbol} />}
            />
            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{
                paddingBottom: 10,
                fontSize: 11,
                fontFamily: 'monospace',
                color: axisTickColor,
              }}
              formatter={(value: string) => {
                if (value === 'baselineVal')
                  return isBg ? '24/7 Базова консумация' : '24/7 Baseline Idle';
                if (value === 'scheduledVal')
                  return isBg ? 'Мощност по WoL график' : 'Scheduled WoL Power';
                return value;
              }}
            />
            <Bar
              name="baselineVal"
              dataKey={activeMetricView === 'kwh' ? 'baselineKwh' : 'baselineCost'}
              fill="url(#wolBaselineGrad)"
              radius={[8, 8, 2, 2]}
              maxBarSize={28}
            />
            <Bar
              name="scheduledVal"
              dataKey={activeMetricView === 'kwh' ? 'scheduledKwh' : 'scheduledCost'}
              fill="url(#wolScheduledGrad)"
              radius={[8, 8, 2, 2]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Daily Schedule Status Pills */}
      <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-white/[0.10]">
        <span className="text-[10px] ink-muted font-semibold uppercase tracking-wide mr-1">
          {isBg ? 'Дни от седмицата:' : 'Weekly Cadence:'}
        </span>
        {weeklyData.map((d) => (
          <span
            key={d.dayKey}
            className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold flex items-center gap-1 border ${
              d.isScheduled
                ? 'bg-emerald-500/14 border-emerald-500/35 text-emerald-400'
                : 'liquid-control-pill ink-muted'
            }`}
            title={
              d.scheduledEvents.join(', ') ||
              (isBg ? 'Няма насрочено събуждане' : 'No wake scheduled')
            }
          >
            {d.isScheduled && <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />}
            <span>
              {d.dayShort}:{' '}
              {d.isScheduled
                ? isBg
                  ? `${d.activeHours}ч`
                  : `${d.activeHours}h`
                : isBg
                ? 'Сън'
                : 'Sleep'}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
};
