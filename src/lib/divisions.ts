import { useEffect, useState, useCallback } from "react";
import { useLanguage } from "./i18n";

export type Division = { code: string; name_ar: string; name_en?: string };

export const DEFAULT_DIVISIONS: Division[] = [
  { code: "01", name_ar: "المتطلبات العامة", name_en: "General Requirements" },
  { code: "02", name_ar: "الظروف الحالية", name_en: "Existing Conditions" },
  { code: "03", name_ar: "أعمال الخرسانة", name_en: "Concrete Works" },
  { code: "04", name_ar: "المباني", name_en: "Masonry" },
  { code: "05", name_ar: "الأعمال المعدنية", name_en: "Metals" },
  { code: "06", name_ar: "الخشب والبلاستيك والمواد المركبة", name_en: "Wood, Plastics & Composites" },
  { code: "07", name_ar: "عزل الحرارة والرطوبة", name_en: "Thermal & Moisture Protection" },
  { code: "08", name_ar: "الأبواب والنوافذ", name_en: "Openings (Doors & Windows)" },
  { code: "09", name_ar: "التشطيبات", name_en: "Finishes" },
  { code: "10", name_ar: "أعمال اختصاصية", name_en: "Specialties" },
  { code: "11", name_ar: "الأجهزة", name_en: "Equipment" },
  { code: "12", name_ar: "الفرش", name_en: "Furnishings" },
  { code: "13", name_ar: "المنشآت الخاصة", name_en: "Special Construction" },
  { code: "14", name_ar: "معدات الانتقال (المصاعد)", name_en: "Conveying Equipment" },
  { code: "15", name_ar: "", name_en: "" },
  { code: "16", name_ar: "", name_en: "" },
  { code: "17", name_ar: "", name_en: "" },
  { code: "18", name_ar: "", name_en: "" },
  { code: "19", name_ar: "", name_en: "" },
  { code: "20", name_ar: "", name_en: "" },
  { code: "21", name_ar: "مكافحة الحرائق", name_en: "Fire Suppression" },
  { code: "22", name_ar: "السباكة", name_en: "Plumbing" },
  { code: "23", name_ar: "التدفئة والتهوية وتكييف الهواء (HVAC)", name_en: "Heating, Ventilating & Air Conditioning (HVAC)" },
  { code: "26", name_ar: "الكهرباء", name_en: "Electrical" },
  { code: "27", name_ar: "أنظمة خاصة", name_en: "Communications" },
  { code: "28", name_ar: "الأمن والسلامة الإلكترونية", name_en: "Electronic Safety & Security" },
  { code: "31", name_ar: "أعمال الحفر والردم", name_en: "Earthwork" },
  { code: "32", name_ar: "التحسينات الخارجية", name_en: "Exterior Improvements" },
  { code: "48-1", name_ar: "نظام الطاقة الشمسية الرئيسي على السطح", name_en: "Rooftop Solar PV System" },
  { code: "48-2", name_ar: "نظام الطاقة الشمسية للمأذنة والواجهة", name_en: "Minaret & Facade Solar PV System" },
];

export const DIVISIONS = DEFAULT_DIVISIONS;

const storageKey = (projectId: string | null | undefined) =>
  `divisions:${projectId ?? "global"}`;

function loadDivisions(projectId: string | null | undefined): Division[] {
  if (typeof window === "undefined") return DEFAULT_DIVISIONS;
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return DEFAULT_DIVISIONS;
    const parsed = JSON.parse(raw) as Division[];
    if (!Array.isArray(parsed)) return DEFAULT_DIVISIONS;
    return parsed;
  } catch {
    return DEFAULT_DIVISIONS;
  }
}

function saveDivisions(projectId: string | null | undefined, divisions: Division[]) {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(divisions));
    window.dispatchEvent(new CustomEvent("divisions-changed", { detail: { projectId } }));
  } catch {
    /* ignore */
  }
}

export function useDivisions(projectId: string | null | undefined) {
  const { language } = useLanguage();
  const [divisions, setDivisions] = useState<Division[]>(() => loadDivisions(projectId));

  useEffect(() => {
    setDivisions(loadDivisions(projectId));
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { projectId?: string };
      if (detail?.projectId === projectId) setDivisions(loadDivisions(projectId));
    };
    window.addEventListener("divisions-changed", onChange);
    return () => window.removeEventListener("divisions-changed", onChange);
  }, [projectId]);

  const rename = useCallback(
    (code: string, name_ar: string, name_en?: string) => {
      const next = loadDivisions(projectId).map((d) =>
        d.code === code ? { ...d, name_ar, ...(name_en !== undefined ? { name_en } : {}) } : d
      );
      saveDivisions(projectId, next);
    },
    [projectId]
  );

  const remove = useCallback(
    (code: string) => {
      const next = loadDivisions(projectId).filter((d) => d.code !== code);
      saveDivisions(projectId, next);
    },
    [projectId]
  );

  const labelFor = useCallback(
    (code: string | null | undefined) => {
      if (!code) return null;
      const d = divisions.find((x) => x.code === code);
      const isEn = language === "en";
      const name = isEn ? (d?.name_en?.trim() || d?.name_ar?.trim()) : d?.name_ar?.trim();
      const prefix = isEn ? "Div." : "القسم";
      return name ? `${prefix} ${code} - ${name}` : `${prefix} ${code}`;
    },
    [divisions, language]
  );

  return { divisions, rename, remove, labelFor };
}

// Back-compat label helper (uses defaults only)
export const DIVISION_LABEL = (code: string | null | undefined, lang: "ar" | "en" = "ar") => {
  if (!code) return null;
  const d = DEFAULT_DIVISIONS.find((x) => x.code === code);
  const name = lang === "en" ? (d?.name_en?.trim() || d?.name_ar?.trim()) : d?.name_ar?.trim();
  const prefix = lang === "en" ? "Div." : "القسم";
  return name ? `${prefix} ${code} - ${name}` : `${prefix} ${code}`;
};
