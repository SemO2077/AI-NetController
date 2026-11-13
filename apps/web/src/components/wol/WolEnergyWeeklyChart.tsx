import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import {
  Calendar,
  CheckCircle2
} from 'lucide-react';
import { WolSchedule, Weekday } from '../../types';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { localizeWolSchedule } from '../../services/wolService';

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
    <div className="bg-[#091020]/95 border border-white/20 rounded-xl p-3 shadow-2xl backdrop-blur-3xl text-xs font-sans max-w-xs z-50">
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-1.5 mb-2 gap-3">
        <span className="font-bold text-white font-display text-sm">{data.dayFull}</span>
        {data.isScheduled ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            {isBg ? 'АКТИВЕН ГРАФИК' : 'WOL ACTIVE'}
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 bg-slate-800 border border-slate-700">
            {isBg ? '24ч В ГОТОВНОСТ' : '24h STANDBY'}
          </span>
        )}
      </div>

      <div className="space-y-1.5 font-mono text-[11px]">
        <div className="flex justify-between items-center text-slate-300 gap-3">
          <span className="flex items-center gap-1.5 text-rose-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/80 inline-block" />
            {isBg ? 'Базова консумация 24/7:' : '24/7 Baseline Idle:'}
          </span>
          <span className="font-bold">
            {data.baselineKwh} kWh ({data.baselineCost} {currencySymbol})
          </span>
        </div>

        <div className="flex justify-between items-center text-slate-300 gap-3">
          <span className="flex items-center gap-1.5 text-cyan-300">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400 inline-block" />
            {isBg ? `По график (${data.activeHours}ч):` : `WoL Schedule (${data.activeHours}h):`}
          </span>
          <span className="font-bold text-cyan-300">
            {data.scheduledKwh} kWh ({data.scheduledCost} {currencySymbol})
          </span>
        </div>

        <div className="border-t border-slate-700/60 pt-1.5 mt-1 flex justify-between items-center text-emerald-400 font-bold">
          <span>{isBg ? 'Спестена Енергия:' : 'Energy Saved:'}</span>
          <span>
            +{data.savedKwh} kWh (-{data.percentSaved}%)
          </span>
        </div>
      </div>

      {data.scheduledEvents.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-cyan-500/10 text-[10px] text-slate-400">
          <span className="text-slate-500 font-mono">{isBg ? 'Графици: ' : 'Schedules: '}</span>
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
  currencySymbol = 'BGN'
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';
  const initialScheduledHours = activeHoursPerDay ?? 8;
  const [scheduledDayActiveHours, setScheduledDayActiveHours] = useState<number>(initialScheduledHours);
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
    const enabledSchedules = schedules.filter(s => s.enabled);

    return weekdayDefs.map((dayDef) => {
      const matchingSchedules = enabledSchedules.filter(s =>
        s.days && s.days.includes(dayDef.key)
      );

      const isScheduled = enabledSchedules.length > 0 && matchingSchedules.length > 0;
      const scheduledEvents = matchingSchedules.map(s => {
        const loc = localizeWolSchedule(s, language);
        return `${loc.name} (${s.time})`;
      });

      const activeHours = isScheduled ? effectiveActiveHoursPerDay : 0;
      const standbyHours = Math.max(0, 24 - activeHours);

      const baselineKwh = (hostCount * activeWatts * 24) / 1000;
      const scheduledKwh =
        (hostCount * activeWatts * activeHours + hostCount * standbyWatts * standbyHours) /
        1000;

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
        savedCost: Number(savedCost.toFixed(2))
      } as DayDataPoint;
    });
  }, [schedules, weekdayDefs, hostCount, activeWatts, standbyWatts, kwhRate, effectiveActiveHoursPerDay, language]);

  const weeklyTotals = useMemo(() => {
    let totalBaselineKwh = 0;
    let totalScheduledKwh = 0;
    let totalSavedKwh = 0;
    let totalBaselineCost = 0;
    let totalScheduledCost = 0;
    let totalSavedCost = 0;
    let totalScheduledDays = 0;

    weeklyData.forEach(d => {
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
      overallPercentSaved
    };
  }, [weeklyData]);

  return (
    <div className="w-full rounded-2xl bg-[#06101D] border border-cyan-500/20 p-4 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cyan-500/10 pb-3">
        <div>
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <Calendar className="w-4 h-4 text-cyan-400" />
            <h4 className="text-xs font-bold text-white font-display uppercase tracking-wider">
              {isBg ? 'Седмично Сравнение на Енергията' : 'Weekly Energy Comparison'}
            </h4>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 font-bold">
              {weeklyTotals.totalScheduledDays} {isBg ? 'ДНИ С ГРАФИК' : 'SCHEDULED DAYS'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {isBg
              ? `Консумация по дни от седмицата на база запазените Wake-on-LAN графици (${hostCount} компютъра @ ${activeWatts}W)`
              : `Daily power consumption based on active Wake-on-LAN schedules (${hostCount} hosts @ ${activeWatts}W)`}
          </p>
        </div>

        {/* Metric Switcher (kWh vs Currency) */}
        <div className="flex items-center space-x-2 shrink-0 self-start sm:self-auto">
          <div className="flex bg-[#0A1628] border border-cyan-500/30 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                setActiveMetricView('kwh');
              }}
              className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition cursor-pointer ${
                activeMetricView === 'kwh'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isBg ? 'Енергия (kWh)' : 'Energy (kWh)'}
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                setActiveMetricView('cost');
              }}
              className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition cursor-pointer ${
                activeMetricView === 'cost'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isBg ? `Стойност (${currencySymbol})` : `Cost (${currencySymbol})`}
            </button>
          </div>
        </div>
      </div>

      {/* Weekly KPI Highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-[#0A1628]/80 border border-slate-800 rounded-xl p-2.5">
          <div className="text-[10px] text-slate-400 font-mono uppercase">
            {isBg ? 'Базова консумация 24/7' : '24/7 Baseline Load'}
          </div>
          <div className="text-base font-bold text-rose-400 font-mono mt-0.5">
            {activeMetricView === 'kwh'
              ? `${weeklyTotals.totalBaselineKwh} kWh`
              : `${weeklyTotals.totalBaselineCost} ${currencySymbol}`}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            {isBg ? '168 часа непрекъснат ход' : '168 hrs continuous idle'}
          </div>
        </div>

        <div className="bg-[#0A1628]/80 border border-cyan-500/30 rounded-xl p-2.5">
          <div className="text-[10px] text-cyan-400 font-mono uppercase">
            {isBg ? 'Енергия по график' : 'WoL Scheduled Energy'}
          </div>
          <div className="text-base font-bold text-cyan-300 font-mono mt-0.5">
            {activeMetricView === 'kwh'
              ? `${weeklyTotals.totalScheduledKwh} kWh`
              : `${weeklyTotals.totalScheduledCost} ${currencySymbol}`}
          </div>
          <div className="text-[10px] text-cyan-400/70 font-mono">
            {isBg
              ? `${weeklyTotals.totalScheduledDays} дни активни + готовност`
              : `${weeklyTotals.totalScheduledDays} active days + Standby`}
          </div>
        </div>

        <div className="bg-[#0A1628]/80 border border-emerald-500/30 rounded-xl p-2.5">
          <div className="text-[10px] text-emerald-400 font-mono uppercase">
            {isBg ? 'Седмично спестени' : 'Weekly Saved'}
          </div>
          <div className="text-base font-bold text-emerald-300 font-mono mt-0.5">
            {activeMetricView === 'kwh'
              ? `-${weeklyTotals.totalSavedKwh} kWh`
              : `-${weeklyTotals.totalSavedCost} ${currencySymbol}`}
          </div>
          <div className="text-[10px] text-emerald-400/80 font-mono">
            -{weeklyTotals.overallPercentSaved}% {isBg ? 'редукция' : 'reduction'}
          </div>
        </div>

        <div className="bg-[#0A1628]/80 border border-slate-800 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono uppercase">
            <span>{isBg ? 'Активни часове/ден:' : 'Active hrs/day:'}</span>
            <span className="text-amber-300 font-bold">
              {scheduledDayActiveHours}{isBg ? 'ч' : 'h'}
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
            className="w-full accent-cyan-400 cursor-pointer h-1.5 mt-1"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
            <span>4{isBg ? 'ч' : 'h'}</span>
            <span>8{isBg ? 'ч (Лаб)' : 'h (Lab)'}</span>
            <span>16{isBg ? 'ч' : 'h'}</span>
          </div>
        </div>
      </div>

      {enabledSchedulesCount === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 font-mono">
          {isBg
            ? 'Няма активни Wake-on-LAN графици — активирайте или добавете график, за да моделирате спестяванията.'
            : 'No active Wake-on-LAN schedules enabled — add or enable a schedule to model energy savings.'}
        </div>
      )}

      {/* Recharts Bar Chart Container */}
      <div className="w-full h-64 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={weeklyData}
            margin={{ top: 10, right: 12, left: 4, bottom: 0 }}
            barGap={4}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#1E293B"
              vertical={false}
            />
            <XAxis
              dataKey="dayShort"
              stroke="#64748B"
              tick={{ fill: '#94A3B8', fontSize: 11, fontFamily: 'monospace' }}
              tickLine={{ stroke: '#334155' }}
            />
            <YAxis
              width={54}
              stroke="#64748B"
              tick={{ fill: '#94A3B8', fontSize: 10, fontFamily: 'monospace' }}
              tickLine={{ stroke: '#334155' }}
              unit={activeMetricView === 'kwh' ? 'k' : currencySymbol}
            />
            <Tooltip
              content={<WeeklyEnergyTooltip isBg={isBg} currencySymbol={currencySymbol} />}
            />
            <Legend
              verticalAlign="top"
              align="right"
              wrapperStyle={{ paddingBottom: 8, fontSize: 11, fontFamily: 'monospace' }}
              formatter={(value: string) => {
                if (value === 'baselineVal') return isBg ? 'Базова 24/7 консумация' : '24/7 Baseline Idle';
                if (value === 'scheduledVal') return isBg ? 'Мощност по график' : 'Scheduled WoL Power';
                return value;
              }}
            />
            <Bar
              name="baselineVal"
              dataKey={activeMetricView === 'kwh' ? 'baselineKwh' : 'baselineCost'}
              fill="#F43F5E"
              opacity={0.4}
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
            <Bar
              name="scheduledVal"
              dataKey={activeMetricView === 'kwh' ? 'scheduledKwh' : 'scheduledCost'}
              fill="#00F0FF"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Dynamic Schedule Badges / Status */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800">
        <span className="text-[10px] text-slate-500 font-mono uppercase mr-1">
          {isBg ? 'Статус на дните:' : 'Daily Schedule Status:'}
        </span>
        {weeklyData.map(d => (
          <span
            key={d.dayKey}
            className={`px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 border ${
              d.isScheduled
                ? 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
            title={d.scheduledEvents.join(', ') || (isBg ? 'Няма насрочено събуждане' : 'No wake scheduled')}
          >
            {d.isScheduled && <CheckCircle2 className="w-2.5 h-2.5 text-cyan-400" />}
            {d.dayShort}:{' '}
            {d.isScheduled
              ? isBg
                ? `${d.activeHours}ч активен`
                : `${d.activeHours}h active`
              : isBg
              ? 'Готовност'
              : 'Standby'}
          </span>
        ))}
      </div>
    </div>
  );
};
