export type TextDirection = "rtl" | "ltr";

// Unicode ranges for Arabic scripts (standard, supplement, presentation forms A & B)
const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
// Unicode range for Latin characters
const LATIN_REGEX = /[A-Za-z]/;

/**
 * Determines text direction based on the full text value:
 * 1. If any Arabic character is present -> "rtl" (Arabic priority rule).
 * 2. Else if Latin characters are present -> "ltr".
 * 3. Else (empty, digits, punctuation only) -> fallback direction (or undefined).
 */
export function getTextDirection(
  value: string | number | readonly string[] | undefined | null,
  fallbackDir?: TextDirection
): TextDirection | undefined {
  if (value === undefined || value === null) return fallbackDir;
  const str = String(value);
  if (!str.trim()) return fallbackDir;

  if (ARABIC_REGEX.test(str)) {
    return "rtl";
  }
  if (LATIN_REGEX.test(str)) {
    return "ltr";
  }
  return fallbackDir;
}
