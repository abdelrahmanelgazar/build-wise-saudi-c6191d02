import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { estimationClient } from "@/lib/estimation-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileSpreadsheet,
  Upload,
  X,
  AlertCircle,
  CheckCircle2,
  Layers,
  FileText,
  SlidersHorizontal,
  GitCompare,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useActiveProjectId, useActiveTenderId } from "@/lib/active-project";
import { csiDivisionCode, CSI_DIVISIONS } from "@/lib/csi-divisions";
import { separateCategoryAndRate } from "@/lib/boq-header-mapping";
import {
  arrayBufferToBase64,
  buildRowCellRefs,
  computeBoqReimportDiff,
  computeFileSha256,
  detectCarryForwardRowKind,
  type BoqRowKind,
} from "@/lib/excel-roundtrip";
import { scopeRowsByTender } from "@/lib/tender-pricing-scope";

// Field keys (broader than ParsedRow — includes computed columns)
export type FieldKey =
  | "item_no"
  | "description_ar"
  | "unit"
  | "quantity"
  | "material_cost"
  | "labor_cost"
  | "equipment_cost"
  | "subcontractor_cost"
  | "unit_rate"
  | "total"
  | "note";

export const FIELD_LABELS: Record<FieldKey, string> = {
  item_no: "رقم البند / المسلسل",
  description_ar: "الوصف / البيان",
  unit: "الوحدة",
  quantity: "الكمية",
  unit_rate: "سعر الوحدة / الفئة",
  material_cost: "تكلفة المواد",
  labor_cost: "تكلفة العمالة",
  equipment_cost: "تكلفة المعدات",
  subcontractor_cost: "مقاول الباطن",
  total: "الإجمالي / القيمة",
  note: "ملاحظات",
};

const HEADER_MAP: Record<string, FieldKey> = {
  // Item number / sequence
  "رقم البند": "item_no",
  "رمز البند": "item_no",
  "كود البند": "item_no",
  "رقم": "item_no",
  "البند": "item_no",
  "البند item": "item_no",
  "item بند": "item_no",
  "كود": "item_no",
  "رمز": "item_no",
  "م": "item_no",
  "م.": "item_no",
  "مسلسل": "item_no",
  "تسلسل": "item_no",
  "ت": "item_no",
  "الرقم": "item_no",
  "فقرة": "item_no",
  "فقره": "item_no",
  "الفقرة": "item_no",
  "code": "item_no",
  "item": "item_no",
  "item no": "item_no",
  "item_no": "item_no",
  "no": "item_no",
  "no.": "item_no",
  "sr": "item_no",
  "sr.": "item_no",
  "sn": "item_no",
  "s.n.": "item_no",
  "#": "item_no",

  // Description / Specifications
  "الوصف": "description_ar",
  "وصف": "description_ar",
  "البيان": "description_ar",
  "بيان": "description_ar",
  "بيان الاعمال": "description_ar",
  "بيان الأعمال": "description_ar",
  "وصف الاعمال": "description_ar",
  "وصف الأعمال": "description_ar",
  "وصف البند": "description_ar",
  "تفاصيل": "description_ar",
  "التفاصيل": "description_ar",
  "المواصفات": "description_ar",
  "المواصفات والبيان": "description_ar",
  "نص البند": "description_ar",
  "جدول الكميات": "description_ar",
  "description": "description_ar",
  "desc": "description_ar",
  "item description": "description_ar",
  "work description": "description_ar",

  // Unit
  "الوحدة": "unit",
  "وحدة": "unit",
  "الوحده": "unit",
  "وحده": "unit",
  "وحدة القياس": "unit",
  "وحده القياس": "unit",
  "unit": "unit",
  "uom": "unit",
  "unit of measurement": "unit",

  // Quantity
  "الكمية": "quantity",
  "كمية": "quantity",
  "الكميه": "quantity",
  "كميه": "quantity",
  "الكميات": "quantity",
  "كميات": "quantity",
  "الكمية التقديرية": "quantity",
  "الكميه التقديريه": "quantity",
  "quantity": "quantity",
  "qty": "quantity",
  "est qty": "quantity",

  // Unit rate / price
  "سعر الوحدة": "unit_rate",
  "سعر الوحده": "unit_rate",
  "سعر الفئة": "unit_rate",
  "سعر الفئه": "unit_rate",
  "الفئة": "unit_rate",
  "الفئه": "unit_rate",
  "فئة": "unit_rate",
  "فئه": "unit_rate",
  "سعر": "unit_rate",
  "السعر": "unit_rate",
  "سعر الافراد": "unit_rate",
  "السعر الافرادي": "unit_rate",
  "rate": "unit_rate",
  "rate sar": "unit_rate",
  "unit rate": "unit_rate",
  "unit price": "unit_rate",
  "price": "unit_rate",

  // Total
  "الإجمالي": "total",
  "إجمالي": "total",
  "اجمالي": "total",
  "الاجمالي": "total",
  "المجموع": "total",
  "مجموع": "total",
  "المبلغ": "total",
  "مبلغ": "total",
  "القيمة": "total",
  "القيمه": "total",
  "القيمة الإجمالية": "total",
  "القيمه الاجماليه": "total",
  "إجمالي التكلفة": "total",
  "اجمالي التكلفة": "total",
  "إجمالي التكلفه بالريال السعودي": "total",
  "amount": "total",
  "amount sar": "total",
  "total": "total",
  "total sar": "total",

  // Breakdown costs
  "مواد": "material_cost",
  "تكلفة المواد": "material_cost",
  "المواد": "material_cost",
  "material": "material_cost",
  "materials": "material_cost",

  "عمالة": "labor_cost",
  "عماله": "labor_cost",
  "العمالة": "labor_cost",
  "العماله": "labor_cost",
  "تكلفة العمالة": "labor_cost",
  "أجور": "labor_cost",
  "اجور": "labor_cost",
  "labor": "labor_cost",
  "labour": "labor_cost",

  "معدات": "equipment_cost",
  "المعدات": "equipment_cost",
  "تكلفة المعدات": "equipment_cost",
  "آليات": "equipment_cost",
  "اليات": "equipment_cost",
  "equipment": "equipment_cost",

  "مقاول باطن": "subcontractor_cost",
  "مقاول الباطن": "subcontractor_cost",
  "مقاولو الباطن": "subcontractor_cost",
  "مقاول": "subcontractor_cost",
  "باطن": "subcontractor_cost",
  "subcontractor": "subcontractor_cost",
  "sub": "subcontractor_cost",

  // Notes
  "ملاحظات": "note",
  "الملاحظات": "note",
  "ملاحظه": "note",
  "ملاحظة": "note",
  "notes": "note",
  "note": "note",
  "remarks": "note",
};

export type ParsedRow = {
  item_no: string;
  description_ar: string;
  unit: string;
  quantity: number;
  material_cost: number;
  labor_cost: number;
  equipment_cost: number;
  subcontractor_cost: number;
  unit_rate: number;
  total: number;
  is_group: boolean;
  row_kind: BoqRowKind;
  excel_row_index: number;
  rate_cell_ref: string | null;
  total_cell_ref: string | null;
  note_cell_ref: string | null;
  note_text?: string | null;
  _raw: (string | number | null)[];
};

export type ExcelHeader = { label: string; field: FieldKey | null };

export function normHeader(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\u0640/g, "") // remove Arabic tatweel / kashida (e.g. وصــف -> وصف)
    .replace(/[\u064B-\u065F]/g, "") // remove tashkeel
    .replace(/[:：()_\-/.\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchHeaderField(s: unknown): FieldKey | null {
  const norm = normHeader(s);
  if (!norm) return null;
  if (HEADER_MAP[norm]) return HEADER_MAP[norm];

  // 1. Description patterns
  if (
    norm.includes("الوصف") ||
    norm.includes("وصف") ||
    norm.includes("البيان") ||
    norm.includes("بيان") ||
    norm.includes("تفاصيل") ||
    norm.includes("التفاصيل") ||
    norm.includes("المواصفات") ||
    norm.includes("مواصفات") ||
    norm.includes("نص البند") ||
    norm.includes("description") ||
    norm.includes("desc")
  ) {
    return "description_ar";
  }

  // 2. Item number / sequence patterns
  if (
    /^(م|مسلسل|تسلسل|ت|رقم|بند|كود|الرقم|البند|الكود|فقره|الفقره|item|code|no|sr|sn|#)$/.test(norm) ||
    norm.includes("رقم البند") ||
    norm.includes("رمز البند") ||
    norm.includes("كود البند") ||
    norm.includes("البند item") ||
    norm.includes("item بند") ||
    norm.includes("item no") ||
    norm.includes("item_no") ||
    norm === "البند" ||
    norm === "رقم" ||
    norm === "item" ||
    norm.startsWith("بند ") ||
    norm.endsWith(" بند")
  ) {
    return "item_no";
  }

  // 3. Unit
  if (
    norm.includes("الوحده") ||
    norm.includes("وحده") ||
    norm.includes("الوحدة") ||
    norm.includes("وحدة") ||
    norm.includes("unit") ||
    norm.includes("uom")
  ) {
    return "unit";
  }

  // 4. Quantity
  if (
    norm.includes("الكميه") ||
    norm.includes("كميه") ||
    norm.includes("الكمية") ||
    norm.includes("كمية") ||
    norm.includes("كميات") ||
    norm.includes("quantity") ||
    norm.includes("qty")
  ) {
    return "quantity";
  }

  // 5. Unit rate / price / category
  if (
    norm.includes("سعر الوحده") ||
    norm.includes("سعر الوحدة") ||
    norm.includes("سعر الفئه") ||
    norm.includes("سعر الفئة") ||
    norm.includes("سعر الافراد") ||
    norm.includes("السعر الافرادي") ||
    norm.includes("الفئه") ||
    norm.includes("الفئة") ||
    norm.includes("فئه") ||
    norm.includes("فئة") ||
    norm.includes("unit rate") ||
    norm.includes("unit price") ||
    norm.includes("rate") ||
    norm === "سعر" ||
    norm === "السعر"
  ) {
    return "unit_rate";
  }

  // 6. Total
  if (
    norm.includes("الاجمالي") ||
    norm.includes("الإجمالي") ||
    norm.includes("اجمالي") ||
    norm.includes("إجمالي") ||
    norm.includes("المجموع") ||
    norm.includes("المبلغ") ||
    norm.includes("القيمه") ||
    norm.includes("القيمة") ||
    norm.includes("total") ||
    norm.includes("amount")
  ) {
    return "total";
  }

  // 7. Breakdown costs
  if (norm.includes("مواد") || norm.includes("المواد") || norm.includes("material") || norm.includes("materials")) return "material_cost";
  if (norm.includes("عماله") || norm.includes("العماله") || norm.includes("عمالة") || norm.includes("العمالة") || norm.includes("اجور") || norm.includes("أجور") || norm.includes("labor") || norm.includes("labour")) return "labor_cost";
  if (norm.includes("معدات") || norm.includes("المعدات") || norm.includes("اليات") || norm.includes("آليات") || norm.includes("equipment")) return "equipment_cost";
  if (norm.includes("باطن") || norm.includes("مقاول") || norm.includes("subcontractor")) return "subcontractor_cost";
  if (norm.includes("ملاحظ") || norm.includes("notes") || norm === "note" || norm.includes("remarks")) return "note";

  return null;
}

export function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Detect group rows
export function detectGroup(itemNo: string, qty: number, unit: string, costs: number[]): boolean {
  const totalCost = costs.reduce((s, c) => s + c, 0);
  if (qty === 0 && totalCost === 0 && !unit) return true;
  if (itemNo && !itemNo.includes(".") && qty === 0 && totalCost === 0) return true;
  return false;
}

export function parseSheet(
  rows: unknown[][],
  sheetName?: string,
  forcedHeaderIdx?: number,
  forcedColMap?: Record<number, FieldKey>,
): {
  headers: ExcelHeader[];
  preHeaders: unknown[][];
  data: ParsedRow[];
  warnings: string[];
  detectedHeaderIdx: number;
  colMap: Record<number, FieldKey>;
} {
  const warnings: string[] = [];
  if (!rows.length) {
    return {
      headers: [],
      preHeaders: [],
      data: [],
      warnings: ["الملف فارغ"],
      detectedHeaderIdx: -1,
      colMap: {},
    };
  }

  // Trim empty columns from the right
  let maxCol = -1;
  rows.forEach((r) => {
    r.forEach((cell, idx) => {
      if (cell !== null && cell !== undefined && String(cell).trim() !== "") {
        if (idx > maxCol) maxCol = idx;
      }
    });
  });
  if (maxCol >= 0) {
    rows = rows.map((r) => r.slice(0, maxCol + 1));
  }

  let headerIdx = forcedHeaderIdx !== undefined ? forcedHeaderIdx : -1;
  let colMap: Record<number, FieldKey> = forcedColMap ? { ...forcedColMap } : {};

  // Score candidate header rows if not forced
  if (headerIdx < 0) {
    const scoreMap = (map: Record<number, FieldKey>): number => {
      const fields = new Set(Object.values(map));
      let score = 0;
      if (fields.has("description_ar")) score += 20;
      if (fields.has("quantity")) score += 15;
      if (fields.has("unit")) score += 12;
      if (fields.has("unit_rate")) score += 12;
      if (fields.has("item_no")) score += 10;
      if (fields.has("total")) score += 8;
      if (fields.has("material_cost")) score += 5;
      if (fields.has("labor_cost")) score += 5;
      if (fields.has("equipment_cost")) score += 5;
      if (fields.has("subcontractor_cost")) score += 5;

      // Bonus for core BOQ table combinations
      if (fields.has("description_ar") && (fields.has("quantity") || fields.has("unit") || fields.has("unit_rate") || fields.has("item_no"))) {
        score += 25;
      }
      return score;
    };

    type Candidate = { rowIdx: number; colMap: Record<number, FieldKey>; score: number };
    const candidates: Candidate[] = [];
    const maxScan = Math.min(rows.length, 120);

    // 1. Single row scan
    for (let i = 0; i < maxScan; i++) {
      const r = rows[i] || [];
      const map: Record<number, FieldKey> = {};
      const usedFields = new Set<FieldKey>();
      r.forEach((cell, idx) => {
        const key = matchHeaderField(cell);
        if (key && !usedFields.has(key)) {
          map[idx] = key;
          usedFields.add(key);
        }
      });
      const score = scoreMap(map);
      if (score >= 20 || (score >= 12 && usedFields.has("description_ar"))) {
        candidates.push({ rowIdx: i, colMap: map, score });
      }
    }

    // 2. Adjacent rows combination scan (e.g. Arabic row + English row)
    for (let i = 0; i < maxScan - 1; i++) {
      const r1 = rows[i] || [];
      const r2 = rows[i + 1] || [];
      const maxLen = Math.max(r1.length, r2.length);
      const map: Record<number, FieldKey> = {};
      const usedFields = new Set<FieldKey>();
      for (let idx = 0; idx < maxLen; idx++) {
        const combined = `${r1[idx] ?? ""} ${r2[idx] ?? ""}`.trim();
        const key = matchHeaderField(combined) || matchHeaderField(r1[idx]) || matchHeaderField(r2[idx]);
        if (key && !usedFields.has(key)) {
          map[idx] = key;
          usedFields.add(key);
        }
      }
      const score = scoreMap(map);
      if (score >= 25 && usedFields.has("description_ar")) {
        candidates.push({ rowIdx: i + 1, colMap: map, score: score + 5 });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best) {
      headerIdx = best.rowIdx;
      colMap = best.colMap;
    }
  }

  if (headerIdx < 0) {
    return {
      headers: [],
      preHeaders: [],
      data: [],
      warnings: ["لم يتم التعرف على رؤوس الأعمدة. تأكد من وجود أعمدة: رقم البند، الوصف، الوحدة، الكمية… أو حدد صف العناوين يدوياً"],
      detectedHeaderIdx: -1,
      colMap: {},
    };
  }

  const rawHeaders = (rows[headerIdx] as unknown[]).map((c) => String(c ?? ""));
  let headers: ExcelHeader[] = rawHeaders.map((label, idx) => ({
    label,
    field: colMap[idx] ?? null,
  }));
  const preHeaders = rows.slice(0, headerIdx);
  if (!forcedColMap) {
    headers = separateCategoryAndRate(headers, preHeaders) as ExcelHeader[];
    colMap = Object.fromEntries(headers.flatMap((header, index) =>
      header.field ? [[index, header.field]] : [],
    )) as Record<number, FieldKey>;
  }
  const data: ParsedRow[] = [];

  const divCode = sheetName ? csiDivisionCode(sheetName) : undefined;
  const findColIdx = (target: FieldKey): number | null => {
    const found = Object.entries(colMap).find(([, v]) => v === target)?.[0];
    return found !== undefined ? Number(found) : null;
  };
  const rateColIdx = findColIdx("unit_rate");
  const totalColIdx = findColIdx("total");
  const noteColIdx = findColIdx("note");

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.length || r.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;

    const get = (k: FieldKey): unknown => {
      const idx = Object.entries(colMap).find(([, v]) => v === k)?.[0];
      return idx !== undefined ? r[Number(idx)] : "";
    };

    const item_no_raw = String(get("item_no") ?? "").trim();
    const description_ar = String(get("description_ar") ?? "").trim();
    if (!description_ar && !item_no_raw) continue;

    const unit = String(get("unit") ?? "").trim();
    let quantity = toNum(get("quantity"));
    let material_cost = toNum(get("material_cost"));
    const labor_cost = toNum(get("labor_cost"));
    const equipment_cost = toNum(get("equipment_cost"));
    const subcontractor_cost = toNum(get("subcontractor_cost"));
    const unit_rate = toNum(get("unit_rate"));
    const total = toNum(get("total"));
    const note_text = String(get("note") ?? "").trim() || null;

    // Classify carry-forward / brought-forward / sheet summary lines before skipping billable totals
    const preliminaryKind = detectCarryForwardRowKind(description_ar, item_no_raw, unit, quantity, false);
    if (preliminaryKind === "carry_forward" || preliminaryKind === "brought_forward" || preliminaryKind === "summary") {
      warnings.push(`تم رصد صف غير قابل للفوترة (${preliminaryKind === "carry_forward" ? "مرحل ما بعده" : preliminaryKind === "brought_forward" ? "منقول ما قبله" : "إجمالي/ملخص"}): "${description_ar}" في الصف ${i + 1} وتم استبعاده من جمع البنود.`);
      continue;
    }

    // Filter out common sheet footer / total summary rows that aren't real BOQ items
    if (
      description_ar.startsWith("إجمالي") ||
      description_ar.startsWith("اجمالي") ||
      description_ar.startsWith("المجموع الكلي") ||
      description_ar.startsWith("Total")
    ) {
      continue;
    }

    // If unit rate exists but breakdown is empty, put it into material_cost
    if (material_cost === 0 && labor_cost === 0 && equipment_cost === 0 && subcontractor_cost === 0 && unit_rate > 0) {
      material_cost = unit_rate;
    } else if (material_cost === 0 && total > 0 && quantity > 0) {
      material_cost = total / quantity;
    }

    // Preliminaries / Lump sum items: if quantity is 0 or unmapped but unit or rate exists, default qty = 1
    const hasUnitOrRate = Boolean(unit || unit_rate > 0 || material_cost > 0);
    if (quantity === 0 && hasUnitOrRate) {
      quantity = 1;
    }

    const is_group = detectGroup(item_no_raw, quantity, unit, [
      material_cost,
      labor_cost,
      equipment_cost,
      subcontractor_cost,
    ]);
    const row_kind = detectCarryForwardRowKind(description_ar, item_no_raw, unit, quantity, is_group);

    let final_item_no = item_no_raw;
    if (!final_item_no) {
      const prefix = divCode || "01";
      final_item_no = `${prefix}.${String(data.length + 1).padStart(2, "0")}`;
    }

    let suffix = 1;
    const base_no = final_item_no;
    while (data.some((d) => d.item_no === final_item_no)) {
      final_item_no = `${base_no}-${suffix}`;
      suffix++;
    }

    const coords = buildRowCellRefs({
      excelRowZeroBased: i,
      rateColIdx,
      totalColIdx,
      noteColIdx,
    });

    data.push({
      item_no: final_item_no,
      description_ar,
      unit,
      quantity,
      material_cost,
      labor_cost,
      equipment_cost,
      subcontractor_cost,
      unit_rate: unit_rate || material_cost,
      total: total || quantity * (unit_rate || material_cost),
      is_group,
      row_kind,
      excel_row_index: coords.excelRowIndex,
      rate_cell_ref: coords.rateCellRef,
      total_cell_ref: coords.totalCellRef,
      note_cell_ref: coords.noteCellRef,
      note_text,
      _raw: r as (string | number | null)[],
    });
  }

  if (!data.length) warnings.push("لم يتم العثور على بنود بعد رؤوس الأعمدة.");
  return {
    headers,
    preHeaders,
    data,
    warnings,
    detectedHeaderIdx: headerIdx,
    colMap,
  };
}

// Build parent linkage from item_no hierarchy (e.g. 01 → 01.01 → 01.01.01)
export function linkParents(rows: ParsedRow[]) {
  type Prepared = ParsedRow & { _tmpId: string; _parentTmpId: string | null; _level: number };
  const prepared: Prepared[] = rows.map((r, i) => ({
    ...r,
    _tmpId: `t${i}`,
    _parentTmpId: null,
    _level: 0,
  }));

  const byItemNo = new Map<string, Prepared>();
  prepared.forEach((r) => byItemNo.set(r.item_no, r));

  prepared.forEach((r) => {
    const parts = r.item_no.split(".");
    r._level = Math.max(0, parts.length - 1);
    if (parts.length > 1) {
      for (let cut = parts.length - 1; cut >= 1; cut--) {
        const cand = parts.slice(0, cut).join(".");
        const parent = byItemNo.get(cand);
        if (parent) {
          r._parentTmpId = parent._tmpId;
          r._level = (parent._level ?? 0) + 1;
          break;
        }
      }
    }
  });

  // Fallback: rows without explicit parent fall under nearest preceding group
  let lastGroupId: string | null = null;
  let lastGroupLevel = -1;
  prepared.forEach((r) => {
    if (r.is_group) {
      lastGroupId = r._tmpId;
      lastGroupLevel = r._level;
    } else if (r._parentTmpId === null && lastGroupId) {
      r._parentTmpId = lastGroupId;
      r._level = lastGroupLevel + 1;
    }
  });
  return prepared;
}

export function ImportExcelDialog() {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [importScope, setImportScope] = useState<"all" | "single">("all");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [smartDiffMerge, setSmartDiffMerge] = useState(true);
  const [fileSha256, setFileSha256] = useState<string>("");
  const [originalWorkbookB64, setOriginalWorkbookB64] = useState<string | null>(null);
  const [showColumnMapper, setShowColumnMapper] = useState(false);
  const [manualHeaderIdx, setManualHeaderIdx] = useState<number | null>(null);
  const [customColMap, setCustomColMap] = useState<Record<number, FieldKey>>({});

  const [parsed, setParsed] = useState<{
    headers: ExcelHeader[];
    preHeaders: unknown[][];
    data: ParsedRow[];
    warnings: string[];
    detectedHeaderIdx: number;
    colMap: Record<number, FieldKey>;
  }>({
    headers: [],
    preHeaders: [],
    data: [],
    warnings: [],
    detectedHeaderIdx: -1,
    colMap: {},
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const activeTenderId = useActiveTenderId();

  const { data: existingProjectBoq = [] } = useQuery({
    queryKey: ["boq_items_diff_baseline", projectId, activeTenderId],
    enabled: Boolean(open && projectId),
    queryFn: async () => {
      const { data } = await estimationClient
        .from("boq_items")
        .select("id, item_no, description_ar, unit, quantity, sheet_name, is_group, sort_order, manual_unit_price, note, tender_id")
        .eq("project_id", projectId!);
      return scopeRowsByTender((data as any[]) ?? [], activeTenderId);
    },
  });

  const { data: existingPaItemIds = new Set<string>() } = useQuery({
    queryKey: ["pa_ids_diff_baseline", projectId, activeTenderId],
    enabled: Boolean(open && projectId),
    queryFn: async () => {
      const { data } = await estimationClient
        .from("price_analysis_items")
        .select("boq_item_id, tender_id")
        .eq("project_id", projectId!);
      const scoped = scopeRowsByTender((data as any[]) ?? [], activeTenderId);
      return new Set(scoped.map((r) => String(r.boq_item_id)));
    },
  });

  const reset = () => {
    setFileName("");
    setSheetNames([]);
    setActiveSheet("");
    setWorkbook(null);
    setImportScope("all");
    setReplaceExisting(false);
    setSmartDiffMerge(true);
    setFileSha256("");
    setOriginalWorkbookB64(null);
    setShowColumnMapper(false);
    setManualHeaderIdx(null);
    setCustomColMap({});
    setParsed({
      headers: [],
      preHeaders: [],
      data: [],
      warnings: [],
      detectedHeaderIdx: -1,
      colMap: {},
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const loadSheet = (
    wb: XLSX.WorkBook,
    name: string,
    forcedIdx?: number | null,
    forcedCols?: Record<number, FieldKey>,
  ) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    // Keep blank rows so 0-based index matches the exact Excel sheet row coordinate
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: true,
    });
    const result = parseSheet(
      rows,
      name,
      forcedIdx !== null && forcedIdx !== undefined ? forcedIdx : undefined,
      forcedCols,
    );
    setParsed(result);
    if (!forcedCols || Object.keys(forcedCols).length === 0) {
      setCustomColMap(result.colMap);
    }
  };

  const handleFile = async (file: File) => {
    try {
      if (file.size > 25 * 1024 * 1024) {
        toast.error("الحد الأقصى لحجم الملف 25 ميجابايت");
        return;
      }
      const buf = await file.arrayBuffer();
      const sha256 = await computeFileSha256(buf);
      setFileSha256(sha256);
      // Store original binary template up to 4MB raw so roundtrip export can write straight into it
      setOriginalWorkbookB64(buf.byteLength <= 4 * 1024 * 1024 ? arrayBufferToBase64(buf) : null);

      const wb = XLSX.read(buf, { type: "array", cellFormula: true, cellNF: true });
      setWorkbook(wb);
      setFileName(file.name);
      setSheetNames(wb.SheetNames);
      const first = wb.SheetNames[0];
      if (!first) throw new Error("الملف لا يحتوي على صفحات");
      setActiveSheet(first);
      loadSheet(wb, first);
    } catch (err) {
      toast.error("تعذّر قراءة الملف. تأكد من أنه ملف Excel صالح.");
      console.error(err);
    }
  };

  const switchSheet = (name: string) => {
    setActiveSheet(name);
    setManualHeaderIdx(null);
    setCustomColMap({});
    if (workbook) loadSheet(workbook, name);
  };

  const handleColumnMapChange = (colIndex: number, newField: FieldKey | "ignore") => {
    const nextMap = { ...customColMap };
    if (newField === "ignore") {
      delete nextMap[colIndex];
    } else {
      nextMap[colIndex] = newField;
    }
    setCustomColMap(nextMap);
    if (workbook && activeSheet) {
      loadSheet(workbook, activeSheet, manualHeaderIdx, nextMap);
    }
  };

  // Estimate total items in all sheets & compute live re-import diff when existing BOQ exists
  const allSheetsStats = useMemo(() => {
    if (!workbook) return { totalItems: 0, sheetCounts: {} as Record<string, number>, allIncoming: [] as Array<ParsedRow & { sheet_name: string }> };
    let total = 0;
    const sheetCounts: Record<string, number> = {};
    const allIncoming: Array<ParsedRow & { sheet_name: string }> = [];
    for (const name of workbook.SheetNames) {
      const ws = workbook.Sheets[name];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: true });
      const res = parseSheet(rows, name);
      sheetCounts[name] = res.data.length;
      total += res.data.length;
      res.data.forEach((d) => allIncoming.push({ ...d, sheet_name: name }));
    }
    return { totalItems: total, sheetCounts, allIncoming };
  }, [workbook]);

  const reimportDiff = useMemo(() => {
    if (!workbook || existingProjectBoq.length === 0) return null;
    const incoming =
      importScope === "all"
        ? allSheetsStats.allIncoming
        : parsed.data.map((d) => ({ ...d, sheet_name: activeSheet || "Sheet1" }));
    return computeBoqReimportDiff(existingProjectBoq, incoming, existingPaItemIds);
  }, [workbook, existingProjectBoq, existingPaItemIds, importScope, allSheetsStats.allIncoming, parsed.data, activeSheet]);

  const groupsCount = useMemo(() => parsed.data.filter((r) => r.is_group).length, [parsed.data]);
  const itemsCount = useMemo(() => parsed.data.filter((r) => !r.is_group).length, [parsed.data]);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data: userData } = await estimationClient.auth.getUser();
      const user_id = userData.user?.id || "00000000-0000-0000-0000-000000000000";
      if (!workbook) throw new Error("لم يتم تحميل الملف");

      const allHeaders: Record<string, ExcelHeader[]> = {};
      const allPreHeaders: Record<string, unknown[][]> = {};
      const writebackMap: Record<string, Record<string, { excelRowIndex: number; rateCellRef: string | null; totalCellRef: string | null; noteCellRef: string | null }>> = {};
      let totalImported = 0;

      // Save workbook version record first so imported items link cleanly to this version
      const excelVersionId = crypto.randomUUID();
      await estimationClient.from("boq_excel_versions").insert({
        id: excelVersionId,
        project_id: projectId,
        tender_id: activeTenderId ?? null,
        user_id,
        file_name: fileName || "BOQ.xlsx",
        file_sha256: fileSha256 || "unknown",
        sheet_names: workbook.SheetNames as unknown as never,
        writeback_map: {} as unknown as never,
        original_workbook_b64: originalWorkbookB64,
        imported_count: 0,
        status: "active",
      });

      const useSmartMerge = Boolean(existingProjectBoq.length > 0 && smartDiffMerge && !replaceExisting && reimportDiff);

      if (replaceExisting) {
        if (activeTenderId) {
          const toDeleteIds = existingProjectBoq.map((r: any) => r.id).filter(Boolean);
          for (const delId of toDeleteIds) {
            await estimationClient.from("boq_items").delete().eq("id", delId);
          }
        } else {
          const { error: delErr } = await estimationClient
            .from("boq_items")
            .delete()
            .eq("project_id", projectId);
          if (delErr) throw delErr;
        }
      }

      const sheetsToProcess = importScope === "all" ? workbook.SheetNames : [activeSheet];

      for (const sheetName of sheetsToProcess) {
        const ws = workbook.Sheets[sheetName];
        if (!ws) continue;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: true });

        // Use custom col map if current sheet, else auto-detect
        const isCurrent = sheetName === activeSheet;
        const sheetParsed = parseSheet(
          rows,
          sheetName,
          isCurrent && manualHeaderIdx !== null ? manualHeaderIdx : undefined,
          isCurrent && Object.keys(customColMap).length > 0 ? customColMap : undefined,
        );

        allHeaders[sheetName] = sheetParsed.headers;
        allPreHeaders[sheetName] = sheetParsed.preHeaders;
        const sheetWriteback: Record<string, { excelRowIndex: number; rateCellRef: string | null; totalCellRef: string | null; noteCellRef: string | null }> = {};
        sheetParsed.data.forEach((d) => {
          sheetWriteback[d.item_no] = {
            excelRowIndex: d.excel_row_index,
            rateCellRef: d.rate_cell_ref,
            totalCellRef: d.total_cell_ref,
            noteCellRef: d.note_cell_ref,
          };
        });
        writebackMap[sheetName] = sheetWriteback;

        if (!sheetParsed.data.length) continue;

        // Auto-create top-level CSI group for multi-sheet workbook
        let sheetGroupDbId: string | null = null;
        if (sheetsToProcess.length > 1) {
          const divCode = csiDivisionCode(sheetName);
          const div = divCode ? CSI_DIVISIONS.find((d) => d.code === divCode) : null;
          const groupTitle = div
            ? `القسم ${div.code} — ${div.name_ar}`
            : sheetName;

          // Check if group already exists in current tender/baseline scope
          const { data: existingGroups } = await estimationClient
            .from("boq_items")
            .select("id, item_no, tender_id")
            .eq("project_id", projectId)
            .eq("is_group", true);

          const scopedGroups = scopeRowsByTender((existingGroups as any[]) ?? [], activeTenderId);
          const matchedGroup = scopedGroups.find(
            (g) =>
              (divCode && (g.item_no === divCode || g.item_no?.startsWith(divCode + " "))) ||
              g.item_no === sheetName,
          );

          if (matchedGroup) {
            sheetGroupDbId = matchedGroup.id;
          } else {
            const { data: createdGrp, error: grpErr } = await estimationClient
              .from("boq_items")
              .insert({
                user_id,
                project_id: projectId,
                tender_id: activeTenderId ?? null,
                excel_version_id: excelVersionId,
                sheet_name: sheetName,
                item_no: divCode || sheetName.slice(0, 10),
                description_ar: groupTitle,
                description_en: div?.name_en || null,
                is_group: true,
                row_kind: "group",
                level: 0,
                sort_order: divCode ? Number(divCode) * 10 : 100,
              })
              .select("id")
              .single();
            if (grpErr) throw grpErr;
            sheetGroupDbId = (createdGrp as any)?.id;
          }
        }

        const prepared = linkParents(sheetParsed.data);

        // If top-level sheet group exists, assign it as parent for items with no parent
        if (sheetGroupDbId) {
          prepared.forEach((r) => {
            if (!r._parentTmpId) {
              r._level = r._level + 1;
            }
          });
        }

        const tmpToDbId = new Map<string, string>();
        const indexOf = new Map<string, number>();
        prepared.forEach((r, i) => indexOf.set(r._tmpId, i));

        // Build diff lookup map for preserving matched IDs and linked price analyses
        const existingByKey = new Map<string, any>();
        if (useSmartMerge && reimportDiff) {
          reimportDiff.entries.forEach((e) => {
            if (e.existingId && e.sheetName === sheetName) {
              existingByKey.set(`${e.itemNo}::${e.descriptionAr}`, e.existingId);
            }
          });
        }

        const byLevel = new Map<number, typeof prepared>();
        prepared.forEach((r) => {
          const arr = byLevel.get(r._level) ?? [];
          arr.push(r);
          byLevel.set(r._level, arr);
        });
        const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

        for (const lvl of levels) {
          const batch = byLevel.get(lvl);
          if (!batch) continue;
          const toUpsert: any[] = [];
          for (const r of batch) {
            const matchedExistingId = useSmartMerge
              ? existingByKey.get(`${r.item_no}::${r.description_ar}`)
              : undefined;

            if (matchedExistingId) {
              // Update matched item in place to preserve linked price_analysis_items, notes, and manual rates
              await estimationClient
                .from("boq_items")
                .update({
                  item_no: r.item_no,
                  description_ar: r.description_ar,
                  unit: r.is_group ? null : r.unit || null,
                  quantity: r.is_group ? 0 : r.quantity,
                  sort_order: (indexOf.get(r._tmpId) ?? 0) + 1,
                  excel_version_id: excelVersionId,
                  excel_row_index: r.excel_row_index,
                  rate_cell_ref: r.rate_cell_ref,
                  total_cell_ref: r.total_cell_ref,
                  note_cell_ref: r.note_cell_ref,
                  row_kind: r.row_kind,
                })
                .eq("id", matchedExistingId);
              tmpToDbId.set(r._tmpId, matchedExistingId);
            } else {
              toUpsert.push({
                user_id,
                project_id: projectId,
                tender_id: activeTenderId ?? null,
                excel_version_id: excelVersionId,
                sheet_name: sheetName,
                parent_id: r._parentTmpId
                  ? tmpToDbId.get(r._parentTmpId) ?? sheetGroupDbId
                  : sheetGroupDbId,
                item_no: r.item_no,
                description_ar: r.description_ar,
                unit: r.is_group ? null : r.unit || null,
                quantity: r.is_group ? 0 : r.quantity,
                material_cost: r.material_cost,
                labor_cost: r.labor_cost,
                equipment_cost: r.equipment_cost,
                subcontractor_cost: r.subcontractor_cost,
                note: r.note_text ?? null,
                is_group: r.is_group,
                row_kind: r.row_kind,
                excel_row_index: r.excel_row_index,
                rate_cell_ref: r.rate_cell_ref,
                total_cell_ref: r.total_cell_ref,
                note_cell_ref: r.note_cell_ref,
                level: r._level,
                sort_order: (indexOf.get(r._tmpId) ?? 0) + 1,
                raw_row: r._raw as unknown as never,
              });
            }
          }

          if (toUpsert.length > 0) {
            const { data, error } = await estimationClient
              .from("boq_items")
              .upsert(toUpsert, { onConflict: "user_id,project_id,sheet_name,item_no" })
              .select("id, item_no");
            if (error) throw error;
            (data ?? []).forEach((row: any, i: number) => {
              const source = batch.find((b) => b.item_no === row.item_no) ?? batch[i];
              if (source) tmpToDbId.set(source._tmpId, row.id);
            });
          }
        }
        totalImported += sheetParsed.data.length;
      }

      await estimationClient
        .from("boq_excel_versions")
        .update({
          writeback_map: writebackMap as unknown as never,
          imported_count: totalImported,
        })
        .eq("id", excelVersionId);

      await estimationClient
        .from("projects")
        .update({
          excel_headers: allHeaders as unknown as never,
          excel_pre_headers: allPreHeaders as unknown as never,
          excel_sheets_order: workbook.SheetNames as unknown as never,
        })
        .eq("id", projectId);

      return totalImported;
    },
    onSuccess: (totalImported) => {
      toast.success(
        importScope === "all"
          ? `تم استيراد ${totalImported} بنداً بنجاح من كافة أقسام وصفحات الملف!`
          : `تم استيراد ${totalImported} بنداً بنجاح من صفحة (${activeSheet})`,
      );
      qc.invalidateQueries({ queryKey: ["boq_items"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      reset();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalEffectiveItems =
    importScope === "all" ? allSheetsStats.totalItems : parsed.data.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileSpreadsheet className="h-4 w-4" />
          استيراد من Excel
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-5xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>استيراد جدول كميات من Excel</DialogTitle>
          <DialogDescription className="leading-relaxed text-xs">
            ارفع ملف .xlsx أو .xls — يتم التعرّف تلقائياً على الأعمدة (رقم البند، الوصف، الوحدة، الكمية، الفئة)
            وتوزيع البنود على أقسام الـ CSI القياسية بدقة وسلاسة.
          </DialogDescription>
        </DialogHeader>

        {!workbook && (
          <label
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 p-10 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 cursor-pointer my-4",
            )}
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">اسحب الملف هنا أو اضغط للاختيار</div>
            <div className="text-xs text-muted-foreground">.xlsx, .xls — حتى 25 ميجابايت</div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
        )}

        {workbook && (
          <div className="space-y-3 overflow-y-auto pr-1 flex-1">
            {/* File info and scope selector */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="font-semibold">{fileName}</span>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  {allSheetsStats.totalItems} بنداً إجمالياً عبر {sheetNames.length} صفحة
                </Badge>
                {parsed.detectedHeaderIdx >= 0 && (
                  <Badge variant="secondary" className="text-[11px]">
                    صف العناوين: {parsed.detectedHeaderIdx + 1}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowColumnMapper(!showColumnMapper)}
                  className="gap-1 text-xs h-7"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  {showColumnMapper ? "إخفاء تخصيص الأعمدة" : "تخصيص الأعمدة وصف العناوين"}
                </Button>
                <Button variant="ghost" size="sm" onClick={reset} className="gap-1 text-xs h-7">
                  <X className="h-3.5 w-3.5" />
                  تغيير الملف
                </Button>
              </div>
            </div>

            {/* Scope Selection */}
            {sheetNames.length > 1 && (
              <div className="rounded-md border border-border/80 bg-card p-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-muted-foreground">نطاق الاستيراد:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="radio"
                      name="importScope"
                      checked={importScope === "all"}
                      onChange={() => setImportScope("all")}
                      className="accent-primary"
                    />
                    <Layers className="h-3.5 w-3.5 text-primary" />
                    استيراد كافة صفحات المصنف ({sheetNames.length} قسم/صفحة — {allSheetsStats.totalItems} بند)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="radio"
                      name="importScope"
                      checked={importScope === "single"}
                      onChange={() => setImportScope("single")}
                      className="accent-primary"
                    />
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    استيراد الصفحة الحالية فقط ({parsed.data.length} بند)
                  </label>
                </div>
              </div>
            )}

            {/* Replace Existing / Smart Re-Import Diff Options */}
            {reimportDiff && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-primary">
                    <GitCompare className="h-4 w-4" />
                    <span>مقارنة إعادة الاستيراد (Re-Import Diff)</span>
                    {fileSha256 && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        SHA-256: {fileSha256.slice(0, 10)}…
                      </Badge>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={smartDiffMerge && !replaceExisting}
                      disabled={replaceExisting}
                      onChange={(e) => setSmartDiffMerge(e.target.checked)}
                      className="accent-primary h-3.5 w-3.5"
                    />
                    <span>تحديث ذكي يحفظ تحليلات الأسعار المرتبطة ({reimportDiff.preservedPricingCount})</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px] tabular-nums">
                  <div className="rounded border border-border bg-background px-2 py-1">تطابق تام: <strong>{reimportDiff.unchangedCount}</strong></div>
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1">تغيير كمية: <strong>{reimportDiff.qtyChangedCount}</strong></div>
                  <div className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1">تغيير وصف: <strong>{reimportDiff.descriptionChangedCount}</strong></div>
                  <div className="rounded border border-purple-500/30 bg-purple-500/10 px-2 py-1">إعادة ترتيب: <strong>{reimportDiff.reorderedCount}</strong></div>
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1">بنود جديدة: <strong>{reimportDiff.addedCount}</strong></div>
                  <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1">غير موجودة بالملف: <strong>{reimportDiff.removedCount}</strong></div>
                </div>
              </div>
            )}

            {!reimportDiff && fileSha256 && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>بصمة المصنف المحفوظة للكتابة العكسية (SHA-256):</span>
                <code className="font-mono">{fileSha256.slice(0, 16)}…</code>
                {originalWorkbookB64 && <Badge variant="secondary" className="text-[10px]">جاهز لحقن الأسعار في الأصل (.xlsx)</Badge>}
              </div>
            )}

            {/* Replace Existing Option */}
            <div className="rounded-md border border-destructive/25 bg-destructive/5 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-destructive">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="accent-destructive h-4 w-4 rounded"
                />
                <span>استبدال جدول الكميات الحالي بالكامل (حذف البنود السابقة لهذا المشروع قبل الاستيراد)</span>
              </label>
              {replaceExisting && (
                <Badge variant="destructive" className="text-[10px]">
                  سيتم تفريغ البنود السابقة واستبدالها بالملف
                </Badge>
              )}
            </div>

            {/* Sheets selector tabs */}
            {sheetNames.length > 1 && (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 rounded-md bg-muted/20 border border-border/50">
                {sheetNames.map((n) => {
                  const count = allSheetsStats.sheetCounts[n] ?? 0;
                  const divCode = csiDivisionCode(n);
                  return (
                    <button
                      key={n}
                      onClick={() => switchSheet(n)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs transition-colors flex items-center gap-1",
                        activeSheet === n
                          ? "border-primary bg-primary/15 text-primary font-semibold shadow-xs"
                          : "border-border text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      <span>{n}</span>
                      {divCode && (
                        <span className="rounded bg-primary/20 px-1 text-[10px] text-primary">
                          {divCode}
                        </span>
                      )}
                      <span className="text-[10px] opacity-70">({count})</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Manual Column & Header Row Mapper */}
            {showColumnMapper && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-primary">
                    تخصيص تعيين الأعمدة لصفحة ({activeSheet}):
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span>رقم صف العناوين:</span>
                    <input
                      type="number"
                      min={1}
                      max={150}
                      value={
                        manualHeaderIdx !== null
                          ? manualHeaderIdx + 1
                          : parsed.detectedHeaderIdx + 1 || 1
                      }
                      onChange={(e) => {
                        const val = Number(e.target.value) - 1;
                        if (val >= 0 && workbook && activeSheet) {
                          setManualHeaderIdx(val);
                          loadSheet(workbook, activeSheet, val, customColMap);
                        }
                      }}
                      className="w-16 rounded border border-border bg-background px-2 py-0.5 text-center text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                  {parsed.headers.map((h, idx) => (
                    <div key={idx} className="rounded border border-border bg-background p-1.5 space-y-1">
                      <div className="truncate font-medium text-[11px] text-muted-foreground" title={h.label}>
                        عمود {idx + 1}: {h.label || "بدون عنوان"}
                      </div>
                      <Select
                        value={customColMap[idx] || h.field || "ignore"}
                        onValueChange={(val) => handleColumnMapChange(idx, val as FieldKey | "ignore")}
                      >
                        <SelectTrigger className="h-6 text-[11px]">
                          <SelectValue placeholder="تجاهل" />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          <SelectItem value="ignore">تجاهل هذا العمود</SelectItem>
                          {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {FIELD_LABELS[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {parsed.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1">
                  <span>{w}</span>
                  {!showColumnMapper && (
                    <button
                      onClick={() => setShowColumnMapper(true)}
                      className="mr-2 underline text-primary font-semibold hover:opacity-80"
                    >
                      اضغط هنا لتحديد صف العناوين أو تخصيص الأعمدة يدوياً
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Data Preview Table */}
            {parsed.data.length > 0 && (
              <>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    تم التعرّف على {parsed.data.length} بنداً في ({activeSheet}) — معاينة:
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    {groupsCount} مجموعة · {itemsCount} بند مستقل
                  </div>
                </div>

                <div className="max-h-[360px] overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[900px] text-xs tabular-nums">
                    <thead className="sticky top-0 z-10 bg-muted/90 text-[11px] text-muted-foreground backdrop-blur">
                      <tr className="border-b border-border">
                        {parsed.headers.map((h, i) => {
                          const field = customColMap[i] || h.field;
                          return (
                            <th key={i} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                              <div>{h.label || `عمود ${i + 1}`}</div>
                              {field && (
                                <span className="inline-block rounded bg-primary/15 text-primary text-[10px] px-1 py-0.2 mt-0.5 font-normal">
                                  {FIELD_LABELS[field]}
                                </span>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.data.slice(0, 100).map((r, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-border/60",
                            r.is_group
                              ? "bg-secondary/40 font-semibold text-foreground"
                              : "hover:bg-muted/20",
                          )}
                        >
                          {r._raw.map((cell, j) => (
                            <td
                              key={j}
                              className="px-2 py-1.5 text-right align-top whitespace-pre-wrap"
                            >
                              {cell === null || cell === undefined ? "" : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.data.length > 100 && (
                    <div className="border-t border-border bg-muted/30 px-3 py-2 text-center text-[11px] text-muted-foreground">
                      عرض أول 100 صف فقط — سيتم استيراد {parsed.data.length} صفاً كاملةً.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="mt-3 gap-2">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            إلغاء
          </Button>
          <Button
            onClick={() => importMut.mutate()}
            disabled={!totalEffectiveItems || importMut.isPending || !projectId}
            className="gap-2 font-semibold"
          >
            {importMut.isPending ? (
              "جاري الاستيراد وتحليل الهيكل…"
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {importScope === "all" && sheetNames.length > 1
                  ? `استيراد كافة الأقسام (${allSheetsStats.totalItems} بنداً من ${sheetNames.length} صفحة)`
                  : `استيراد ${parsed.data.length || ""} بنداً من (${activeSheet || "الصفحة"})`}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
