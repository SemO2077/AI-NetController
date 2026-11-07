import React, { useState, useMemo, useEffect } from 'react';
import {
  Calculator,
  Zap,
  Clock,
  Calendar,
  Monitor,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { WolSchedule } from '../../types';
import { WolEnergyWeeklyChart } from './WolEnergyWeeklyChart';
import { useTranslation } from '../../i18n/useTranslation';

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
  const [isExpanded, setIsExpanded] = useState(false);

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
    enabledSchedules.forEach((s) => s.days?.forEach((d) => allDays.add(d)));
    const calculatedDays = Math.max(1, Math.min(7, allDays.size || 5));

    setDaysPerWeek(calculatedDays);
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
    const treeEquivalents = Math.round(annualCo2KgSaved / 21.77);

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
    currency === 'BGN' ? (language === 'bg' ? 'лв.' : 'BGN') : currency === 'EUR' ? '€' : '$';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-mono uppercase text-cyan-300/80 tracking-widest font-semibold flex items-center gap-1.5">
          <Calculator className="w-3.5 h-3.5 text-emerald-400" />
          {t('calc_title')}
        </span>
        <button
          type="button"
          onClick={() => {
            triggerHapticFeedback('light');
            setIsExpanded(!isExpanded);
          }}
          className="h-8 px-2.5 rounded-lg hover:bg-white/5 text-xs text-cyan-300 flex items-center gap-1"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>{t('calc_collapse')}</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>{t('calc_expand')}</span>
            </>
          )}
        </button>
      </div>

      <div className="glass-liquid w-full rounded-2xl overflow-hidden relative">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            triggerHapticFeedback('light');
            setIsExpanded((prev) => !prev);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded((prev) => !prev);
            }
          }}
          className="p-3.5 sm:p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.02] transition"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                {language === 'bg' ? 'Зелена WoL Ефективност' : 'Green WoL Efficiency'}
              </h4>
              <p className="text-[11px] font-mono text-emerald-300 truncate mt-0.5">
                {language === 'bg' ? 'Спестявания:' : 'Est. Savings:'}{' '}
                {Math.round(stats.savedAnnualCost).toLocaleString(
                  language === 'bg' ? 'bg-BG' : 'en-US'
                )}{' '}
                {currencySymbol}/{language === 'bg' ? 'год.' : 'yr'} (-{stats.percentSaved.toFixed(0)}
                % • {hostCount} PC)
              </p>
            </div>
          </div>

          <ChevronDown
            className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </div>

        {isExpanded && (
          <div className="p-3.5 sm:p-4 space-y-4 border-t border-white/[0.06]">
            {/* Power Profiles */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-1.5 flex-wrap">
                <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  {t('calc_presets')}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSyncWithSchedules}
                    className="text-[11px] text-cyan-300 hover:text-cyan-200 font-mono flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-950/60 border border-cyan-500/30 transition"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{t('calc_sync_schedules')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetToDefault}
                    className="text-xs text-slate-400 hover:text-slate-200 font-mono px-2.5 py-1 rounded-lg hover:bg-white/5"
                  >
                    {t('calc_reset')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {POWER_PROFILE_PRESETS.map((preset, idx) => {
                  const isSelected = activePresetIndex === idx;
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => handleSelectPreset(preset, idx)}
                      className={`px-2.5 py-2 rounded-xl text-left text-xs transition border ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 font-semibold'
                          : 'bg-[#070d1b] border-white/10 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-semibold truncate">
                        {language === 'bg' ? preset.nameBg : preset.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {preset.activeWatts}W • {preset.activeHours}
                        {language === 'bg' ? 'ч/ден' : 'h/d'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sliders Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div className="space-y-3.5 bg-[#070d1b] p-3.5 rounded-xl border border-white/[0.07]">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-300 uppercase tracking-wider font-mono border-b border-white/10 pb-2">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    {language === 'bg'
                      ? 'График и Брой Компютри'
                      : 'Schedule & Device Count'}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5 text-slate-400" />
                      {t('calc_hosts_managed')}
                    </span>
                    <span className="font-mono text-cyan-300 font-bold">
                      {hostCount} {language === 'bg' ? 'комп.' : 'PC'}
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
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      {t('calc_active_hours_day')}
                    </span>
                    <span className="font-mono text-emerald-300 font-bold">
                      {activeHoursPerDay} {language === 'bg' ? 'ч/ден' : 'h/day'}
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
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {t('calc_wake_days_week')}
                    </span>
                    <span className="font-mono text-amber-300 font-bold">
                      {daysPerWeek} {language === 'bg' ? 'дни/седм.' : 'days/wk'}
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
                        className={`py-1 rounded-lg text-xs font-mono font-bold transition border ${
                          daysPerWeek === d
                            ? 'bg-amber-500/25 border-amber-400/60 text-amber-300'
                            : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        {d}
                        {language === 'bg' ? 'д' : 'd'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Power Parameters */}
              <div className="space-y-3.5 bg-[#070d1b] p-3.5 rounded-xl border border-white/[0.07]">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-300 uppercase tracking-wider font-mono border-b border-white/10 pb-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {language === 'bg' ? 'Мощност & Тарифа' : 'Power & Electricity Rate'}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium">{t('calc_active_power')}</span>
                    <span className="font-mono text-amber-300 font-bold">{activePowerWatts} W</span>
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
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium">{t('calc_standby_power')}</span>
                    <span className="font-mono text-cyan-300 font-bold">{standbyPowerWatts} W</span>
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
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs items-center">
                    <span className="text-slate-300 font-medium">{t('calc_electricity_rate')}</span>
                    <div className="flex items-center gap-1">
                      {(['BGN', 'EUR', 'USD'] as Currency[]).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCurrency(c)}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                            currency === c
                              ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/40'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="number"
                    step={0.01}
                    min={0.01}
                    max={2.0}
                    value={kwhRate}
                    onChange={(e) => setKwhRate(Number(e.target.value))}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400/50"
                  />
                </div>
              </div>
            </div>

            {/* Weekly Chart */}
            <WolEnergyWeeklyChart
              schedules={wolSchedules}
              activeHoursPerDay={activeHoursPerDay}
              daysPerWeek={daysPerWeek}
              hostCount={hostCount}
              activeWatts={activePowerWatts}
              standbyWatts={standbyPowerWatts}
              kwhRate={kwhRate}
              currencySymbol={currencySymbol}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const WolEnergyCalculator = React.memo(WolEnergyCalculatorComponent);
