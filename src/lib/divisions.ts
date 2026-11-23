import { useEffect, useState, useCallback } from "react";
import { useLanguage } from "./i18n";
import { toast } from "sonner";
import { CSI_DIVISIONS } from "./csi-divisions";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings";

export type Division = { code: string; name_ar: string; name_en?: string };

export const DEFAULT_DIVISIONS: Division[] = CSI_DIVISIONS;

export const DIVISIONS = DEFAULT_DIVISIONS;

const storageKey = (projectId: string | null | undefined) =>
  `divisions:${projectId ?? "global"}`;

function loadDivisions(projectId: string | null | undefined): Division[] {
  if (typeof window === "undefined") return DEFAULT_DIVISIONS;
  try {
    const raw = readWorkspaceSetting(storageKey(projectId));
    if (!raw) return DEFAULT_DIVISIONS;
    const parsed = JSON.parse(raw) as Division[];
    if (!Array.isArray(parsed)) return DEFAULT_DIVISIONS;
    return parsed;
  } catch {
    return DEFAULT_DIVISIONS;
  }
}

async function saveDivisions(projectId: string | null | undefined, divisions: Division[]) {
  try {
    await writeWorkspaceSetting(storageKey(projectId), JSON.stringify(divisions));
    window.dispatchEvent(new CustomEvent("divisions-changed", { detail: { projectId } }));
  } catch (error) {
    toast.error(String(error));
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
      const d = divisions.find((x) => x.code === code) ?? DEFAULT_DIVISIONS.find((x) => x.code === code);
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
