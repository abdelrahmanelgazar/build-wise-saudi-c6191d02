import { useEffect, useState, useCallback } from "react";

export type Division = { code: string; name_ar: string };

export const DEFAULT_DIVISIONS: Division[] = [
  { code: "01", name_ar: "المتطلبات العامة" },
  { code: "02", name_ar: "الظروف الحالية" },
  { code: "03", name_ar: "أعمال الخرسانة" },
  { code: "04", name_ar: "المباني" },
  { code: "05", name_ar: "الأعمال المعدنية" },
  { code: "06", name_ar: "الخشب والبلاستيك والمواد المركبة" },
  { code: "07", name_ar: "عزل الحرارة والرطوبة" },
  { code: "08", name_ar: "الأبواب والنوافذ" },
  { code: "09", name_ar: "التشطيبات" },
  { code: "10", name_ar: "أعمال اختصاصية" },
  { code: "11", name_ar: "الأجهزة" },
  { code: "12", name_ar: "الفرش" },
  { code: "13", name_ar: "المنشآت الخاصة" },
  { code: "14", name_ar: "معدات الانتقال (المصاعد)" },
  { code: "15", name_ar: "" },
  { code: "16", name_ar: "" },
  { code: "17", name_ar: "" },
  { code: "18", name_ar: "" },
  { code: "19", name_ar: "" },
  { code: "20", name_ar: "" },
  { code: "21", name_ar: "مكافحة الحرائق" },
  { code: "22", name_ar: "السباكة" },
  { code: "23", name_ar: "التدفئة والتهوية وتكييف الهواء (HVAC)" },
  { code: "26", name_ar: "الكهرباء" },
  { code: "27", name_ar: "أنظمة خاصة" },
  { code: "28", name_ar: "الأمن والسلامة الإلكترونية" },
  { code: "31", name_ar: "أعمال الحفر والردم" },
  { code: "32", name_ar: "التحسينات الخارجية" },
  { code: "48-1", name_ar: "نظام الطاقة الشمسية الرئيسي على السطح" },
  { code: "48-2", name_ar: "نظام الطاقة الشمسية للمأذنة والواجهة" },
];

// Back-compat export
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
    (code: string, name_ar: string) => {
      const next = loadDivisions(projectId).map((d) => (d.code === code ? { ...d, name_ar } : d));
      saveDivisions(projectId, next);
    },
    [projectId],
  );

  const remove = useCallback(
    (code: string) => {
      const next = loadDivisions(projectId).filter((d) => d.code !== code);
      saveDivisions(projectId, next);
    },
    [projectId],
  );

  const labelFor = useCallback(
    (code: string | null | undefined) => {
      if (!code) return null;
      const d = divisions.find((x) => x.code === code);
      const name = d?.name_ar?.trim();
      return name ? `القسم ${code} - ${name}` : `القسم ${code}`;
    },
    [divisions],
  );

  return { divisions, rename, remove, labelFor };
}

// Back-compat label helper (uses defaults only)
export const DIVISION_LABEL = (code: string | null | undefined) => {
  if (!code) return null;
  const d = DEFAULT_DIVISIONS.find((x) => x.code === code);
  const name = d?.name_ar?.trim();
  return name ? `القسم ${code} - ${name}` : `القسم ${code}`;
};
