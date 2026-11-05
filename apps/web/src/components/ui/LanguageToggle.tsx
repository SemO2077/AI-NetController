import React from 'react';
import { motion } from 'motion/react';
import { Languages } from 'lucide-react';
import { useTranslation, Language } from '../../i18n/useTranslation';
import { triggerHapticFeedback } from '../../services/hapticService';

interface LanguageToggleProps {
  className?: string;
  variant?: 'pill' | 'segmented';
}

export const LanguageToggle: React.FC<LanguageToggleProps> = ({
  className = '',
  variant = 'pill',
}) => {
  const { language, setLanguage, toggleLanguage } = useTranslation();

  const handleSelect = (lang: Language) => {
    if (lang === language) return;
    triggerHapticFeedback('selection');
    setLanguage(lang);
  };

  if (variant === 'segmented') {
    return (
      <div
        className={`glass-liquid-subtle p-1 rounded-full flex items-center border border-white/10 select-none ${className}`}
        role="group"
        aria-label="Language selection"
      >
        <button
          type="button"
          onClick={() => handleSelect('bg')}
          className={`relative min-h-[38px] px-4 py-2 rounded-full text-xs font-bold transition cursor-pointer flex items-center justify-center ${
            language === 'bg' ? 'text-cyan-300' : 'text-white/50 hover:text-white'
          }`}
        >
          {language === 'bg' && (
            <motion.div
              layoutId="langActiveSegment"
              className="absolute inset-0 rounded-full bg-cyan-500/25 border border-cyan-400/50 shadow-[0_0_12px_rgba(0,212,255,0.25)]"
              transition={{ type: 'spring', stiffness: 450, damping: 28 }}
            />
          )}
          <span className="relative z-10">Български</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelect('en')}
          className={`relative min-h-[38px] px-4 py-2 rounded-full text-xs font-bold transition cursor-pointer flex items-center justify-center ${
            language === 'en' ? 'text-cyan-300' : 'text-white/50 hover:text-white'
          }`}
        >
          {language === 'en' && (
            <motion.div
              layoutId="langActiveSegment"
              className="absolute inset-0 rounded-full bg-cyan-500/25 border border-cyan-400/50 shadow-[0_0_12px_rgba(0,212,255,0.25)]"
              transition={{ type: 'spring', stiffness: 450, damping: 28 }}
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
      whileHover={{ scale: 1.03 }}
      onClick={() => {
        triggerHapticFeedback('selection');
        toggleLanguage();
      }}
      className={`glass-liquid min-h-[40px] px-3 py-1.5 rounded-full border border-cyan-400/30 hover:border-cyan-400/50 text-cyan-300 text-xs font-bold flex items-center space-x-1.5 cursor-pointer bubble-tap select-none shadow-[0_0_12px_rgba(0,212,255,0.15)] ${className}`}
      title={language === 'bg' ? 'Смени езика на English' : 'Switch language to Български'}
      aria-label="Toggle language"
    >
      <Languages className="w-3.5 h-3.5 text-cyan-400" />
      <span className="tracking-wide font-mono uppercase">{language === 'bg' ? 'BG' : 'EN'}</span>
    </motion.button>
  );
};
