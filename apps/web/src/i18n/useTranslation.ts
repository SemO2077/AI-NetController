import { useCallback, useMemo } from 'react';
import { useUIStore } from '../store/uiStore';
import { translations, Translations, Language } from './translations';

export function useTranslation() {
  const language = useUIStore((s) => s.language);
  const setLanguage = useUIStore((s) => s.setLanguage);
  const toggleLanguage = useUIStore((s) => s.toggleLanguage);

  const t = useCallback(
    (key: keyof Translations, params?: Record<string, string | number>): string => {
      let text = translations[language]?.[key] || translations.en[key] || String(key);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return text;
    },
    [language]
  );

  const dict = translations[language] || translations.bg;

  return useMemo(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t,
      dict,
    }),
    [language, setLanguage, toggleLanguage, t, dict]
  );
}

export type { Language, Translations };
