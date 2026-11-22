import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import type { Language, Direction, I18nContextValue } from "./types";
import { arTranslations } from "./locales/ar";
import { enTranslations } from "./locales/en";

const STORAGE_KEY = "taqdiri:language";

function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "ar";
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (saved === "ar" || saved === "en") return saved;
  } catch {
    // ignore
  }
  return "ar";
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ar");

  useEffect(() => { setLanguageState(getInitialLanguage()); }, []);

  const direction: Direction = useMemo(() => (language === "ar" ? "rtl" : "ltr"), [language]);

  const setLanguage = useCallback((newLang: Language) => {
    setLanguageState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
      document.documentElement.lang = newLang;
      document.documentElement.dir = newLang === "ar" ? "rtl" : "ltr";
    } catch {
      // ignore
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === "ar" ? "en" : "ar");
  }, [language, setLanguage]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
      document.documentElement.dir = direction;
    }
  }, [language, direction]);

  const t = useCallback(
    (key: string, defaultVal?: string): string => {
      const dict: Partial<Record<string, string>> = language === "ar" ? arTranslations : enTranslations;
      return dict[key] ?? (defaultVal || key);
    },
    [language]
  );

  const value: I18nContextValue = useMemo(
    () => ({
      language,
      direction,
      setLanguage,
      toggleLanguage,
      t,
    }),
    [language, direction, setLanguage, toggleLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLanguage(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback if rendered outside provider
    return {
      language: "ar",
      direction: "rtl",
      setLanguage: () => {},
      toggleLanguage: () => {},
      t: (k: string, d?: string) => d || k,
    };
  }
  return ctx;
}
