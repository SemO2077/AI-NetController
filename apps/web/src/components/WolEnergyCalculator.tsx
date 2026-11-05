import React, { useState, useMemo } from 'react';
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
import { triggerHapticFeedback } from '../services/hapticService';
import { WolSchedule } from '../types';
import { WolEnergyWeeklyChart } from './WolEnergyWeeklyChart';
import { useTranslation } from '../i18n/useTranslation';

interface WolEnergyCalculatorProps {
  wolSchedules?: WolSchedule[];
  defaultHostCount?: number;
}

type Currency = 'BGN' | 'EUR' | 'USD';

interface PresetScenario {
  name: string;
  nameBg: string;
  hostCount: number;
  activeHours: number;
  daysPerWeek: number;
  activeWatts: number;
  standbyWatts: number;
}

const PRESET_SCENARIOS: PresetScenario[] = [
  {
    name: 'CST Lab (15 Workstations)',
    nameBg: 'КСТ Лаборатория (15 компютъра)',
    hostCount: 15,
    activeHours: 8,
    daysPerWeek: 5,
    activeWatts: 120,
    standbyWatts: 1.8
  },
  {
    name: 'Department Office (8 PCs)',
    nameBg: 'Катедрен офис (8 компютъра)',
    hostCount: 8,
    activeHours: 9,
    daysPerWeek: 5,
    activeWatts: 85,
    standbyWatts: 1.5
  },
  {
    name: 'AI Training Fleet (4 GPU Rigs)',
    nameBg: 'AI GPU Клъстер (4 сървъра)',
    hostCount: 4,
    activeHours: 6,
    daysPerWeek: 6,
    activeWatts: 320,
    standbyWatts: 3.2
  },
  {
    name: 'Single Remote Workstation',
    nameBg: 'Единична работна станция',
    hostCount: 1,
    activeHours: 5,
    daysPerWeek: 5,
    activeWatts: 140,
    standbyWatts: 1.5
  }
];

const WolEnergyCalculatorComponent: React.FC<WolEnergyCalculatorProps> = ({
  wolSchedules = [],
  defaultHostCount = 15
}) => {
  const { t, language } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  // User input parameters
  const [hostCount, setHostCount] = useState<number>(defaultHostCount > 0 ? defaultHostCount : 15);
  const [activeHoursPerDay, setActiveHoursPerDay] = useState<number>(8);
  const [daysPerWeek, setDaysPerWeek] = useState<number>(5);
  const [activePowerWatts, setActivePowerWatts] = useState<number>(120);
  const [standbyPowerWatts, setStandbyPowerWatts] = useState<number>(1.8);
  const [kwhRate, setKwhRate] = useState<number>(0.28);
  const [currency, setCurrency] = useState<Currency>('BGN');
  const [activePresetIndex, setActivePresetIndex] = useState<number | null>(0);

  // Sync with active WoL schedules in the system
  const handleSyncWithSchedules = () => {
    triggerHapticFeedback('medium');
    const enabledSchedules = wolSchedules.filter(s => s.enabled);
    if (enabledSchedules.length === 0) {
      setDaysPerWeek(5);
      setActiveHoursPerDay(8);
      return;
    }

    const allDays = new Set<string>();
    enabledSchedules.forEach(s => s.days?.forEach(d => allDays.add(d)));
    const calculatedDays = Math.max(1, Math.min(7, allDays.size || 5));

    setDaysPerWeek(calculatedDays);
    setActivePresetIndex(null);
  };

  const handleResetToDefault = () => {
    triggerHapticFeedback('light');
    setHostCount(15);
    setActiveHoursPerDay(8);
    setDaysPerWeek(5);
    setActivePowerWatts(120);
    setStandbyPowerWatts(1.8);
    setKwhRate(0.28);
    setCurrency('BGN');
    setActivePresetIndex(0);
  };

  const handleSelectPreset = (preset: PresetScenario, index: number) => {
    triggerHapticFeedback('light');
    setActivePresetIndex(index);
    setHostCount(preset.hostCount);
    setActiveHoursPerDay(preset.activeHours);
    setDaysPerWeek(preset.daysPerWeek);
    setActivePowerWatts(preset.activeWatts);
    setStandbyPowerWatts(preset.standbyWatts);
  };

  // Calculations
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
      ((hostCount * activePowerWatts * scheduledAwakeHoursWeekly) +
        (hostCount * standbyPowerWatts * scheduledSleepHoursWeekly)) /
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
      treeEquivalents
    };
  }, [hostCount, activeHoursPerDay, daysPerWeek, activePowerWatts, standbyPowerWatts, kwhRate]);

  const currencySymbol = currency === 'BGN' ? (language === 'bg' ? 'лв.' : 'BGN') : currency === 'EUR' ? '€' : '$';

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
          className="min-h-[36px] py-1 px-2.5 rounded-lg hover:bg-white/5 text-xs text-cyan-300 flex items-center gap-1.5 cursor-pointer"
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

      <div className="bg-[#0b1324]/55 backdrop-blur-2xl backdrop-saturate-[160%] border border-white/[0.07] border-t-white/[0.16] shadow-[0_12px_32px_rgba(0,0,0,0.4)] w-full rounded-[2rem] overflow-hidden relative">
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
          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.02] transition"
        >
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(0,255,163,0.2)] shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center flex-wrap gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                  {language === 'bg' ? 'Зелена WoL Ефективност' : 'Green WoL Efficiency'}
                </h4>
                <span className="text-white/30">•</span>
                <span className="text-xs sm:text-sm font-mono font-bold text-emerald-300">
                  {language === 'bg' ? 'Прогнозни спестявания:' : 'Est. Savings:'}{' '}
                  {Math.round(stats.savedAnnualCost).toLocaleString(language === 'bg' ? 'bg-BG' : 'en-US')}{' '}
                  {currencySymbol} / {language === 'bg' ? 'год.' : 'yr'} (-{stats.percentSaved.toFixed(0)}%{' '}
                  {language === 'bg' ? 'енергия' : 'energy'})
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <span className="px-3.5 py-1.5 rounded-full bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/35 text-xs font-semibold text-cyan-200 flex items-center gap-1.5 transition">
              <span>
                {isExpanded
                  ? language === 'bg'
                    ? 'Свий графиката'
                    : 'Hide Chart'
                  : language === 'bg'
                  ? 'Персонализирай и виж графика'
                  : 'Customize & View Chart'}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
            </span>
          </div>
        </div>

        {isExpanded && (
          <div className="p-3.5 sm:p-5 space-y-5 border-t border-white/[0.06]">
            {/* Presets */}
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  {t('calc_presets')}
                </span>
                <div className="flex items-center flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSyncWithSchedules}
                    className="text-[11px] text-cyan-300 hover:text-cyan-200 font-mono flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 transition hover:bg-cyan-900/50 cursor-pointer bubble-tap"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{t('calc_sync_schedules')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetToDefault}
                    className="min-h-[36px] text-xs text-slate-400 hover:text-slate-200 font-mono px-3 py-1.5 rounded-full hover:bg-white/5 cursor-pointer bubble-tap flex items-center justify-center"
                  >
                    {t('calc_reset')}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRESET_SCENARIOS.map((preset, idx) => {
                  const isSelected = activePresetIndex === idx;
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => handleSelectPreset(preset, idx)}
                      className={`px-3 py-2 rounded-2xl text-left text-xs transition border font-sans cursor-pointer bubble-tap ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-[0_0_12px_rgba(0,255,163,0.15)] font-semibold'
                          : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20'
                      }`}
                    >
                      <div className="font-semibold truncate">
                        {language === 'bg' ? preset.nameBg : preset.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {preset.hostCount} {language === 'bg' ? 'комп.' : 'PC'} • {preset.activeHours}{language === 'bg' ? 'ч/ден' : 'h/day'} • {preset.daysPerWeek}{language === 'bg' ? 'д/седм.' : 'd/wk'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sliders Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-4 bg-white/[0.02] p-4 rounded-2xl border border-white/10">
                <div className="flex items-center space-x-2 text-xs font-bold text-cyan-300 uppercase tracking-wider font-mono border-b border-white/10 pb-2">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  <span>{language === 'bg' ? 'График: Честота и Продължителност' : 'Schedule Frequency & Duration'}</span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5 text-slate-400" />
                      {t('calc_hosts_managed')}
                    </span>
                    <span className="font-mono text-cyan-300 font-bold">{hostCount} {language === 'bg' ? 'комп.' : 'PC'}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={60}
                    step={1}
                    value={hostCount}
                    onChange={e => {
                      setHostCount(Number(e.target.value));
                      setActivePresetIndex(null);
                    }}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      {t('calc_active_hours_day')}
                    </span>
                    <span className="font-mono text-emerald-300 font-bold">{activeHoursPerDay} {language === 'bg' ? 'ч/ден' : 'h/day'}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={24}
                    step={0.5}
                    value={activeHoursPerDay}
                    onChange={e => {
                      setActiveHoursPerDay(Number(e.target.value));
                      setActivePresetIndex(null);
                    }}
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {t('calc_wake_days_week')}
                    </span>
                    <span className="font-mono text-amber-300 font-bold">{daysPerWeek} {language === 'bg' ? 'дни/седм.' : 'days/wk'}</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {[1, 2, 3, 4, 5, 6, 7].map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          triggerHapticFeedback('light');
                          setDaysPerWeek(d);
                          setActivePresetIndex(null);
                        }}
                        className={`py-1 rounded-xl text-xs font-mono font-bold transition cursor-pointer border ${
                          daysPerWeek === d
                            ? 'bg-amber-500/25 border-amber-400/60 text-amber-300'
                            : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        {d}{language === 'bg' ? 'д' : 'd'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Power Parameters */}
              <div className="space-y-4 bg-white/[0.02] p-4 rounded-2xl border border-white/10">
                <div className="flex items-center space-x-2 text-xs font-bold text-amber-300 uppercase tracking-wider font-mono border-b border-white/10 pb-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>{language === 'bg' ? 'Мощност & Тарифа' : 'Power & Electricity Rate'}</span>
                </div>

                <div className="space-y-1.5">
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
                    onChange={e => {
                      setActivePowerWatts(Number(e.target.value));
                      setActivePresetIndex(null);
                    }}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
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
                    onChange={e => {
                      setStandbyPowerWatts(Number(e.target.value));
                      setActivePresetIndex(null);
                    }}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs items-center">
                    <span className="text-slate-300 font-medium">{t('calc_electricity_rate')}</span>
                    <div className="flex items-center space-x-1">
                      {(['BGN', 'EUR', 'USD'] as Currency[]).map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCurrency(c)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold transition cursor-pointer ${
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
                    onChange={e => setKwhRate(Number(e.target.value))}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400/50"
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
