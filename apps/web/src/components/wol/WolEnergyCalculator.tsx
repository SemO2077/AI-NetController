import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap,
  Clock,
  Calendar,
  Monitor,
  RefreshCw,
  Sparkles,
  ChevronDown,
  Leaf,
  TrendingDown,
  SlidersHorizontal,
  Coins,
  RotateCcw,
} from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { WolSchedule } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';
import { SPRING_POP } from '../../utils/springPhysics';

const WolEnergyWeeklyChart = React.lazy(() =>
  import('./WolEnergyWeeklyChart').then((m) => ({ default: m.WolEnergyWeeklyChart }))
);

interface WolEnergyCalculatorProps {
  wolSchedules?: WolSchedule[];
  defaultHostCount?: number;
}

type Currency = 'BGN' | 'EUR' | 'USD';

interface PowerProfilePreset {
  name: string;
  nameBg: string;
  activeHours: number;
  daysPerWeek: number;
  activeWatts: number;
  standbyWatts: number;
}

const POWER_PROFILE_PRESETS: PowerProfilePreset[] = [
  {
    name: 'Desktop PC (120W)',
    nameBg: 'Настолен PC (120W)',
    activeHours: 8,
    daysPerWeek: 5,
    activeWatts: 120,
    standbyWatts: 1.8,
  },
  {
    name: 'Laptop / Mini PC (45W)',
    nameBg: 'Лаптоп / Мини PC (45W)',
    activeHours: 9,
    daysPerWeek: 5,
    activeWatts: 45,
    standbyWatts: 1.0,
  },
  {
    name: 'Workstation (250W)',
    nameBg: 'Работна станция (250W)',
    activeHours: 8,
    daysPerWeek: 5,
    activeWatts: 250,
    standbyWatts: 2.5,
  },
  {
    name: 'Server / GPU Node (380W)',
    nameBg: 'Сървър / GPU (380W)',
    activeHours: 10,
    daysPerWeek: 6,
    activeWatts: 380,
    standbyWatts: 3.5,
  },
];

const WolEnergyCalculatorComponent: React.FC<WolEnergyCalculatorProps> = ({
  wolSchedules = [],
  defaultHostCount = 1,
}) => {
  const { t, language } = useTranslation();
  const isBg = language === 'bg';
  const [showFineTuning, setShowFineTuning] = useState(false);

  const resolvedDefaultCount = defaultHostCount > 0 ? defaultHostCount : 1;
  const [hostCount, setHostCount] = useState<number>(resolvedDefaultCount);
  const [activeHoursPerDay, setActiveHoursPerDay] = useState<number>(8);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(5);
  const [activePowerWatts, setActivePowerWatts] = useState<number>(120);
  const [standbyPowerWatts, setStandbyPowerWatts] = useState<number>(1.8);
  const [kwhRate, setKwhRate] = useState<number>(0.28);
  const [currency, setCurrency] = useState<Currency>('BGN');
  const [activePresetIndex, setActivePresetIndex] = useState<number | null>(0);

  useEffect(() => {
    if (defaultHostCount > 0) {
      setHostCount(defaultHostCount);
    }
  }, [defaultHostCount]);

  const handleSyncWithSchedules = () => {
    triggerHapticFeedback('medium');
    const enabledSchedules = wolSchedules.filter((s) => s.enabled);
    if (enabledSchedules.length === 0) {
      setDaysPerWeek(5);
      setActiveHoursPerDay(8);
      return;
    }

    const allDays = new Set<string>();
    const estimatedDurations: number[] = [];
    enabledSchedules.forEach((s) => {
      s.days?.forEach((d) => allDays.add(d));
      const hour = Number.parseInt(String(s.time || '').split(':')[0], 10);
      if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
        const dur = hour < 18 ? Math.max(4, Math.min(16, 18 - hour)) : 6;
        estimatedDurations.push(dur);
      }
    });
    const calculatedDays = Math.max(1, Math.min(7, allDays.size || 5));
    const calculatedHours =
      estimatedDurations.length > 0
        ? Math.round(estimatedDurations.reduce((a, b) => a + b, 0) / estimatedDurations.length)
        : 8;

    setDaysPerWeek(calculatedDays);
    setActiveHoursPerDay(calculatedHours);
    setActivePresetIndex(null);
  };

  const handleResetToDefault = () => {
    triggerHapticFeedback('light');
    setHostCount(resolvedDefaultCount);
    setActiveHoursPerDay(8);
    setDaysPerWeek(5);
    setActivePowerWatts(120);
    setStandbyPowerWatts(1.8);
    setKwhRate(0.28);
    setCurrency('BGN');
    setActivePresetIndex(0);
  };

  const handleSelectPreset = (preset: PowerProfilePreset, index: number) => {
    triggerHapticFeedback('light');
    setActivePresetIndex(index);
    setActiveHoursPerDay(preset.activeHours);
    setDaysPerWeek(preset.daysPerWeek);
    setActivePowerWatts(preset.activeWatts);
    setStandbyPowerWatts(preset.standbyWatts);
  };

  const stats = useMemo(() => {
    const totalWeeklyHours = 168;
    const scheduledAwakeHoursWeekly = daysPerWeek * activeHoursPerDay;
    const scheduledSleepHoursWeekly = Math.max(0, totalWeeklyHours - scheduledAwakeHoursWeekly);

    const weeksPerYear = 52.1429;
    const weeksPerMonth = weeksPerYear / 12;

    const baselineWeeklyKwh = (hostCount * activePowerWatts * totalWeeklyHours) / 1000;
    const baselineMonthlyKwh = baselineWeeklyKwh * weeksPerMonth;
    const baselineAnnualKwh = baselineWeeklyKwh * weeksPerYear;

    const wolWeeklyKwh =
      (hostCount * activePowerWatts * scheduledAwakeHoursWeekly +
        hostCount * standbyPowerWatts * scheduledSleepHoursWeekly) /
      1000;
    const wolMonthlyKwh = wolWeeklyKwh * weeksPerMonth;
    const wolAnnualKwh = wolWeeklyKwh * weeksPerYear;

    const savedMonthlyKwh = Math.max(0, baselineMonthlyKwh - wolMonthlyKwh);
    const savedAnnualKwh = Math.max(0, baselineAnnualKwh - wolAnnualKwh);
    const savedMonthlyCost = savedMonthlyKwh * kwhRate;
    const savedAnnualCost = savedAnnualKwh * kwhRate;

    const percentSaved =
      baselineAnnualKwh > 0
        ? Math.min(100, Math.max(0, ((baselineAnnualKwh - wolAnnualKwh) / baselineAnnualKwh) * 100))
        : 0;

    const annualCo2KgSaved = savedAnnualKwh * 0.475;
    const treeEquivalents =
      annualCo2KgSaved <= 0 ? 0 : Math.max(1, Math.round(annualCo2KgSaved / 21.77));

    return {
      scheduledAwakeHoursWeekly,
      scheduledSleepHoursWeekly,
      savedMonthlyKwh,
      savedAnnualKwh,
      savedMonthlyCost,
      savedAnnualCost,
      percentSaved,
      annualCo2KgSaved,
      treeEquivalents,
    };
  }, [hostCount, activeHoursPerDay, daysPerWeek, activePowerWatts, standbyPowerWatts, kwhRate]);

  const currencySymbol =
    currency === 'BGN' ? (isBg ? 'лв.' : 'BGN') : currency === 'EUR' ? '€' : '$';
  const locale = isBg ? 'bg-BG' : 'en-US';

  return (
    <div id="wol-energy-calculator" className="glass-liquid w-full rounded-[28px] p-4 sm:p-5 space-y-5">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 squircle-badge squircle-emerald flex items-center justify-center shrink-0">
            <Leaf className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display text-sm sm:text-base font-extrabold ink-primary tracking-tight">
                {isBg ? 'Зелена WoL Енергийна Ефективност' : 'Green WoL Energy Efficiency'}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/18 dark:bg-emerald-950/80 border border-emerald-500/40 text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-200">
                -{stats.percentSaved.toFixed(0)}% {isBg ? 'разход' : 'power'}
              </span>
            </div>
            <p className="text-xs ink-muted mt-0.5">
              {isBg
                ? `${hostCount} PC • ${activePowerWatts}W активни / ${standbyPowerWatts}W сън • ${daysPerWeek} дни × ${activeHoursPerDay}ч`
                : `${hostCount} PC${hostCount === 1 ? '' : 's'} • ${activePowerWatts}W active / ${standbyPowerWatts}W standby • ${daysPerWeek}d × ${activeHoursPerDay}h`}
            </p>
          </div>
        </div>

        {/* Quick Actions: Sync Schedules, Currency, Fine-Tune Toggle */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center glass-liquid-subtle p-0.5 rounded-full">
            {(['BGN', 'EUR', 'USD'] as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  setCurrency(c);
                }}
                className={`px-2.5 h-7 rounded-full text-[10.5px] font-mono font-bold transition cursor-pointer ${
                  currency === c ? 'liquid-hero-btn preserve-white' : 'ink-secondary hover:ink-primary'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <motion.button
            type="button"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_POP}
            onClick={handleSyncWithSchedules}
            className="h-8 px-3 rounded-full liquid-control-pill text-[11px] font-semibold text-cyan-400 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{t('calc_sync_schedules')}</span>
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_POP}
            onClick={() => {
              triggerHapticFeedback('light');
              setShowFineTuning((v) => !v);
            }}
            className={`h-8 px-3 rounded-full text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer ${
              showFineTuning ? 'liquid-hero-btn preserve-white' : 'liquid-control-pill ink-primary'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>{isBg ? 'Настройки' : 'Fine-Tune'}</span>
            <ChevronDown
              className={`w-3 h-3 transition-transform duration-200 ${
                showFineTuning ? 'rotate-180' : ''
              }`}
            />
          </motion.button>
        </div>
      </div>

      {/* 4 Vivid Always-Open Hero Energy KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-[22px] glass-liquid-subtle p-3.5 border border-emerald-500/30 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold ink-secondary">
              {isBg ? 'Годишни спестявания' : 'Annual Savings'}
            </span>
            <div className="w-7 h-7 squircle-badge squircle-emerald flex items-center justify-center shrink-0">
              <Coins className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-extrabold font-mono text-emerald-400 tabular-nums">
            {Math.round(stats.savedAnnualCost).toLocaleString(locale)} {currencySymbol}
          </div>
          <div className="text-[10.5px] font-mono ink-muted">
            ~{Math.round(stats.savedMonthlyCost).toLocaleString(locale)} {currencySymbol}/
            {isBg ? 'мес.' : 'mo'}
          </div>
        </div>

        <div className="rounded-[22px] glass-liquid-subtle p-3.5 border border-sky-400/30 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold ink-secondary">
              {isBg ? 'Спестена енергия' : 'Energy Saved'}
            </span>
            <div className="w-7 h-7 squircle-badge squircle-sky flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-extrabold font-mono text-sky-400 tabular-nums">
            {Math.round(stats.savedAnnualKwh).toLocaleString(locale)} kWh
          </div>
          <div className="text-[10.5px] font-mono ink-muted">
            {Math.round(stats.savedMonthlyKwh).toLocaleString(locale)} kWh/{isBg ? 'мес.' : 'mo'}
          </div>
        </div>

        <div className="rounded-[22px] glass-liquid-subtle p-3.5 border border-violet-400/30 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold ink-secondary">
              {isBg ? 'Спестен CO₂' : 'CO₂ Avoided'}
            </span>
            <div className="w-7 h-7 squircle-badge squircle-violet flex items-center justify-center shrink-0">
              <Leaf className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-extrabold font-mono text-violet-300 tabular-nums">
            {Math.round(stats.annualCo2KgSaved).toLocaleString(locale)} kg
          </div>
          <div className="text-[10.5px] font-mono ink-muted">
            ≈ {stats.treeEquivalents} {isBg ? 'дървета / год.' : 'trees / yr'}
          </div>
        </div>

        <div className="rounded-[22px] glass-liquid-subtle p-3.5 border border-amber-400/30 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold ink-secondary">
              {isBg ? 'Ефективност' : 'Power Reduction'}
            </span>
            <div className="w-7 h-7 squircle-badge squircle-amber flex items-center justify-center shrink-0">
              <TrendingDown className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-extrabold font-mono text-amber-400 tabular-nums">
            -{stats.percentSaved.toFixed(1)}%
          </div>
          <div className="text-[10.5px] font-mono ink-muted">
            {stats.scheduledSleepHoursWeekly}
            {isBg ? 'ч сън / седм.' : 'h sleep / wk'}
          </div>
        </div>
      </div>

      {/* Hardware Profile Preset Chips */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] font-display font-bold ink-secondary flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t('calc_presets')}</span>
          </span>
          <button
            type="button"
            onClick={handleResetToDefault}
            className="text-[11px] ink-muted hover:ink-primary font-semibold flex items-center gap-1 px-2.5 py-1 rounded-full liquid-control-pill cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t('calc_reset')}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {POWER_PROFILE_PRESETS.map((preset, idx) => {
            const isSelected = activePresetIndex === idx;
            return (
              <motion.button
                key={preset.name}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                transition={SPRING_POP}
                onClick={() => handleSelectPreset(preset, idx)}
                className={`px-3 py-2.5 rounded-2xl text-left text-xs transition cursor-pointer ${
                  isSelected
                    ? 'glass-liquid-elevated iridescent-active-rim font-bold ink-primary'
                    : 'liquid-control-pill ink-secondary'
                }`}
              >
                <div className="font-display font-bold truncate ink-primary">
                  {isBg ? preset.nameBg : preset.name}
                </div>
                <div className="text-[10.5px] ink-muted font-mono mt-0.5">
                  {preset.activeWatts}W • {preset.activeHours}
                  {isBg ? 'ч/ден' : 'h/d'}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Progressive Disclosure: Fine-Tune Watts, Hosts & Electricity Tariff Drawer */}
      <AnimatePresence initial={false}>
        {showFineTuning && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
              <div className="space-y-3.5 liquid-terminal-entry p-4 rounded-[22px]">
                <div className="flex items-center gap-2 text-xs font-display font-bold text-cyan-400 border-b border-white/[0.08] pb-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {isBg ? 'График и брой компютри' : 'Schedule & Device Count'}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="ink-secondary font-medium flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5 ink-muted" />
                      {t('calc_hosts_managed')}
                    </span>
                    <span className="font-mono text-cyan-400 font-bold">
                      {hostCount} {isBg ? 'комп.' : 'PC'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={60}
                    step={1}
                    value={hostCount}
                    onChange={(e) => {
                      setHostCount(Number(e.target.value));
                      setActivePresetIndex(null);
                    }}
                    className="w-full accent-violet-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="ink-secondary font-medium flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 ink-muted" />
                      {t('calc_active_hours_day')}
                    </span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {activeHoursPerDay} {isBg ? 'ч/ден' : 'h/day'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={24}
                    step={0.5}
                    value={activeHoursPerDay}
                    onChange={(e) => {
                      setActiveHoursPerDay(Number(e.target.value));
                      setActivePresetIndex(null);
                    }}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="ink-secondary font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 ink-muted" />
                      {t('calc_wake_days_week')}
                    </span>
                    <span className="font-mono text-amber-400 font-bold">
                      {daysPerWeek} {isBg ? 'дни/седм.' : 'days/wk'}
                    </span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          triggerHapticFeedback('light');
                          setDaysPerWeek(d);
                          setActivePresetIndex(null);
                        }}
                        className={`py-1.5 rounded-full text-xs font-mono font-bold transition cursor-pointer ${
                          daysPerWeek === d
                            ? 'liquid-hero-btn preserve-white'
                            : 'liquid-control-pill ink-secondary'
                        }`}
                      >
                        {d}
                        {isBg ? 'д' : 'd'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-3.5 liquid-terminal-entry p-4 rounded-[22px]">
                <div className="flex items-center gap-2 text-xs font-display font-bold text-amber-400 border-b border-white/[0.08] pb-2">
                  <Zap className="w-3.5 h-3.5" />
                  <span>{isBg ? 'Мощност и тарифа' : 'Power & Electricity Rate'}</span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="ink-secondary font-medium">{t('calc_active_power')}</span>
                    <span className="font-mono text-amber-400 font-bold">{activePowerWatts} W</span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={500}
                    step={5}
                    value={activePowerWatts}
                    onChange={(e) => {
                      setActivePowerWatts(Number(e.target.value));
                      setActivePresetIndex(null);
                    }}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="ink-secondary font-medium">{t('calc_standby_power')}</span>
                    <span className="font-mono text-cyan-400 font-bold">
                      {standbyPowerWatts} W
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={10}
                    step={0.1}
                    value={standbyPowerWatts}
                    onChange={(e) => {
                      setStandbyPowerWatts(Number(e.target.value));
                      setActivePresetIndex(null);
                    }}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs items-center">
                    <span className="ink-secondary font-medium">
                      {t('calc_electricity_rate')} ({currencySymbol}/kWh)
                    </span>
                  </div>
                  <input
                    type="number"
                    step={0.01}
                    min={0.01}
                    max={10.0}
                    value={kwhRate}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      setKwhRate(
                        Number.isFinite(parsed) ? Math.max(0.01, Math.min(10.0, parsed)) : 0.01
                      );
                    }}
                    className="w-full glass-liquid-subtle rounded-full px-4 py-2 text-xs font-mono font-bold text-cyan-400 focus:outline-none focus:border-cyan-400/60"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Always-Visible Adaptive Dual-Mode Weekly Energy Chart */}
      <Suspense
        fallback={
          <div className="h-56 rounded-3xl glass-liquid-subtle animate-pulse" aria-hidden="true" />
        }
      >
        <WolEnergyWeeklyChart
          schedules={wolSchedules}
          activeHoursPerDay={activeHoursPerDay}
          onActiveHoursChange={setActiveHoursPerDay}
          hostCount={hostCount}
          activeWatts={activePowerWatts}
          standbyWatts={standbyPowerWatts}
          kwhRate={kwhRate}
          currencySymbol={currencySymbol}
        />
      </Suspense>
    </div>
  );
};

export const WolEnergyCalculator = React.memo(WolEnergyCalculatorComponent);
