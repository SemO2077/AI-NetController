import React, { useId } from 'react';
import { motion } from 'motion/react';
import { Languages } from 'lucide-react';
import { useTranslation, Language } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';
import { SPRING_JELLY, SPRING_POP } from '../../utils/springPhysics';

interface LanguageToggleProps {
  className?: string;
  variant?: 'pill' | 'segmented';
}

export const LanguageToggle: React.FC<LanguageToggleProps> = ({
  className = '',
  variant = 'pill',
}) => {
  const { language, setLanguage, toggleLanguage } = useTranslation();
  const segmentLayoutId = `langActiveSegment-${useId()}`;

  const handleSelect = (lang: Language) => {
    if (lang === language) return;
    triggerHapticFeedback('selection');
    setLanguage(lang);
  };

  if (variant === 'segmented') {
    return (
      <div
        className={`glass-liquid-subtle p-1 rounded-full flex items-center select-none ${className}`}
        role="group"
        aria-label={language === 'bg' ? 'Избор на език' : 'Language selection'}
      >
        <button
          type="button"
          onClick={() => handleSelect('bg')}
          className={`relative min-h-[36px] px-4 py-1.5 rounded-full text-xs font-bold transition cursor-pointer flex items-center justify-center ${
            language === 'bg' ? 'preserve-white' : 'ink-secondary hover:ink-primary'
          }`}
        >
          {language === 'bg' && (
            <motion.div
              layoutId={segmentLayoutId}
              className="absolute inset-0 rounded-full liquid-hero-btn"
              transition={SPRING_JELLY}
            />
          )}
          <span className="relative z-10">Български</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelect('en')}
          className={`relative min-h-[36px] px-4 py-1.5 rounded-full text-xs font-bold transition cursor-pointer flex items-center justify-center ${
            language === 'en' ? 'preserve-white' : 'ink-secondary hover:ink-primary'
          }`}
        >
          {language === 'en' && (
            <motion.div
              layoutId={segmentLayoutId}
              className="absolute inset-0 rounded-full liquid-hero-btn"
              transition={SPRING_JELLY}
            />
          )}
          <span className="relative z-10">English</span>
        </button>
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.05 }}
      transition={SPRING_POP}
      onClick={() => {
        triggerHapticFeedback('selection');
        toggleLanguage();
      }}
      className={`liquid-control-pill min-h-[38px] px-3.5 py-1.5 rounded-full text-cyan-400 text-xs font-bold flex items-center gap-1.5 cursor-pointer select-none ${className}`}
      title={language === 'bg' ? 'Смени езика на English' : 'Switch language to Български'}
      aria-label="Toggle language"
    >
      <Languages className="w-3.5 h-3.5" />
      <span className="tracking-wide font-mono uppercase">{language === 'bg' ? 'BG' : 'EN'}</span>
    </motion.button>
  );
};
