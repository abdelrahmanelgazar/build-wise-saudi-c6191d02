export type Language = "ar" | "en";
export type Direction = "rtl" | "ltr";

export interface I18nContextValue {
  language: Language;
  direction: Direction;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, defaultVal?: string) => string;
}
