import * as XLSX from "xlsx";
import {
  resolveBoqItemPricing,
  roundTo,
  roundUpRate,
  type MarkupSettings,
  type ResourceCostInput,
} from "./estimation-calc";

export type BoqRowKind = "group" | "item" | "carry_forward" | "brought_forward" | "summary";

export interface ExcelWritebackCellCoord {
  sheetName: string;
  excelRowIndex: number; // 1-based row index in Excel
  rateCellRef: string | null;
  totalCellRef: string | null;
  noteCellRef: string | null;
}

export interface BoqDiffItemInput {
  id?: string;
  item_no: string;
  description_ar: string;
  unit?: string | null;
  quantity?: number | null;
  sheet_name?: string | null;
  is_group?: boolean;
  sort_order?: number;
  row_kind?: BoqRowKind | string | null;
  manual_unit_price?: number | null;
  note?: string | null;
}

export type BoqDiffStatus =
  | "unchanged"
  | "updated_qty"
  | "reordered"
  | "description_changed"
  | "added"
  | "removed";

export interface BoqDiffEntry {
  status: BoqDiffStatus;
  sheetName: string;
  itemNo: string;
  descriptionAr: string;
  existingId?: string | undefined;
  incomingTmpId?: string | undefined;
  qtyBefore?: number | undefined;
  qtyAfter?: number | undefined;
  sortBefore?: number | undefined;
  sortAfter?: number | undefined;
  hasExistingPricing?: boolean | undefined;
}

export interface BoqReimportDiffResult {
  matchedCount: number;
  unchangedCount: number;
  qtyChangedCount: number;
  reorderedCount: number;
  descriptionChangedCount: number;
  addedCount: number;
  removedCount: number;
  preservedPricingCount: number;
  /** Maps incoming index (or tmpId) -> existing boq_item id for matched items */
  matchedIdByIncomingKey: Map<string, string>;
  entries: BoqDiffEntry[];
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** Computes SHA-256 hex digest of an uploaded Excel workbook ArrayBuffer. */
export async function computeFileSha256(buffer: ArrayBuffer): Promise<string> {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Pure JS fallback when WebCrypto subtle is unavailable (e.g. non-secure context)
  const bytes = new Uint8Array(buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const byteVal = bytes[i] ?? 0;
    h1 ^= byteVal;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= byteVal + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `fallback-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * Classifies whether a parsed BOQ row is a carry-forward / brought-forward / summary line
 * so it is flagged and excluded from billable double-counting.
 */
export function detectCarryForwardRowKind(
  description: string,
  itemNo: string,
  unit: string,
  quantity: number,
  isGroup: boolean,
): BoqRowKind {
  if (isGroup) return "group";
  const text = `${itemNo} ${description}`.replace(/\s+/g, " ").trim();
  if (/ما\s*بعده|مرحل\s*(?:إلى|الى|للصفحة)|^\s*c\s*\/\s*f\b|carried\s*forward|subtotal\s*carried/i.test(text)) {
    return "carry_forward";
  }
  if (/ما\s*قبله|منقول\s*(?:من|عن)|^\s*b\s*\/\s*f\b|brought\s*forward/i.test(text)) {
    return "brought_forward";
  }
  if (
    !unit.trim() &&
    quantity <= 0 &&
    /الإجمالي\s*العام|المجموع\s*العام|مجموع\s*القسم|الإجمالي\s*الفرعي|grand\s*total|section\s*total|sub[-\s]*total/i.test(text)
  ) {
    return "summary";
  }
  return "item";
}

function normalizeDiffText(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\w\u0600-\u06FF]+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeDiffText(a).split(/\s+/).filter(Boolean));
  const tb = new Set(normalizeDiffText(b).split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

/**
 * Computes structural diff between existing BOQ rows and newly imported workbook rows,
 * preserving IDs across reordered rows and disambiguating duplicate client item numbers.
 */
export function computeBoqReimportDiff(
  existingRows: BoqDiffItemInput[],
  incomingRows: Array<BoqDiffItemInput & { _tmpId?: string }>,
  itemIdsWithAnalysis?: Set<string>,
): BoqReimportDiffResult {
  const existingCandidates = existingRows.filter((r) => !r.is_group);
  const incomingCandidates = incomingRows.filter((r) => !r.is_group);
  const usedExistingIds = new Set<string>();
  const matchedIdByIncomingKey = new Map<string, string>();
  const entries: BoqDiffEntry[] = [];

  let unchangedCount = 0;
  let qtyChangedCount = 0;
  let reorderedCount = 0;
  let descriptionChangedCount = 0;
  let addedCount = 0;
  let preservedPricingCount = 0;

  incomingCandidates.forEach((inc, idx) => {
    const incSheet = inc.sheet_name || "Sheet1";
    const incKey = inc._tmpId || `${incSheet}::${idx}`;
    const incNo = String(inc.item_no ?? "").trim();

    // 1. Match within same sheet & item_no (handling duplicate client item numbers via description similarity)
    const sameNoCandidates = existingCandidates.filter(
      (ex) =>
        ex.id &&
        !usedExistingIds.has(ex.id) &&
        (ex.sheet_name || "Sheet1") === incSheet &&
        String(ex.item_no ?? "").trim() === incNo,
    );

    let matched: BoqDiffItemInput | undefined;
    if (sameNoCandidates.length === 1) {
      matched = sameNoCandidates[0];
    } else if (sameNoCandidates.length > 1) {
      matched = sameNoCandidates
        .map((cand) => ({ cand, score: tokenSimilarity(cand.description_ar, inc.description_ar) }))
        .sort((a, b) => b.score - a.score)[0]?.cand;
    }

    // 2. Fallback: exact or very high normalized description match on the same sheet (renumbered item)
    if (!matched) {
      const descCandidates = existingCandidates
        .filter((ex) => ex.id && !usedExistingIds.has(ex.id) && (ex.sheet_name || "Sheet1") === incSheet)
        .map((cand) => ({ cand, score: tokenSimilarity(cand.description_ar, inc.description_ar) }))
        .filter((x) => x.score >= 0.8)
        .sort((a, b) => b.score - a.score);
      matched = descCandidates[0]?.cand;
    }

    if (matched?.id) {
      usedExistingIds.add(matched.id);
      matchedIdByIncomingKey.set(incKey, matched.id);

      const qtyBefore = Number(matched.quantity ?? 0);
      const qtyAfter = Number(inc.quantity ?? 0);
      const sortBefore = Number(matched.sort_order ?? 0);
      const sortAfter = Number(inc.sort_order ?? idx + 1);
      const descSame = normalizeDiffText(matched.description_ar) === normalizeDiffText(inc.description_ar);
      const qtyChanged = Math.abs(qtyBefore - qtyAfter) > 0.0001;
      const reordered = sortBefore > 0 && sortBefore !== sortAfter;

      const hasExistingPricing =
        Boolean(itemIdsWithAnalysis?.has(matched.id)) ||
        Number(matched.manual_unit_price ?? 0) > 0 ||
        Boolean(matched.note);
      if (hasExistingPricing) preservedPricingCount++;

      let status: BoqDiffStatus = "unchanged";
      if (qtyChanged) {
        status = "updated_qty";
        qtyChangedCount++;
      } else if (!descSame) {
        status = "description_changed";
        descriptionChangedCount++;
      } else if (reordered) {
        status = "reordered";
        reorderedCount++;
      } else {
        unchangedCount++;
      }

      entries.push({
        status,
        sheetName: incSheet,
        itemNo: incNo,
        descriptionAr: inc.description_ar,
        existingId: matched.id,
        incomingTmpId: inc._tmpId,
        qtyBefore,
        qtyAfter,
        sortBefore,
        sortAfter,
        hasExistingPricing,
      });
    } else {
      addedCount++;
      entries.push({
        status: "added",
        sheetName: incSheet,
        itemNo: incNo,
        descriptionAr: inc.description_ar,
        incomingTmpId: inc._tmpId,
        qtyAfter: Number(inc.quantity ?? 0),
        sortAfter: Number(inc.sort_order ?? idx + 1),
      });
    }
  });

  const removed = existingCandidates.filter((ex) => ex.id && !usedExistingIds.has(ex.id));
  for (const rem of removed) {
    entries.push({
      status: "removed",
      sheetName: rem.sheet_name || "Sheet1",
      itemNo: rem.item_no,
      descriptionAr: rem.description_ar,
      existingId: rem.id,
      qtyBefore: Number(rem.quantity ?? 0),
      hasExistingPricing: Boolean(rem.id && itemIdsWithAnalysis?.has(rem.id)) || Number(rem.manual_unit_price ?? 0) > 0,
    });
  }

  return {
    matchedCount: matchedIdByIncomingKey.size,
    unchangedCount,
    qtyChangedCount,
    reorderedCount,
    descriptionChangedCount,
    addedCount,
    removedCount: removed.length,
    preservedPricingCount,
    matchedIdByIncomingKey,
    entries,
  };
}

/**
 * Resolves exact A1 Excel coordinates for writeback given 0-based sheet row index and mapped columns.
 */
export function buildRowCellRefs(params: {
  excelRowZeroBased: number;
  rateColIdx: number | null;
  totalColIdx: number | null;
  noteColIdx: number | null;
}): Pick<ExcelWritebackCellCoord, "excelRowIndex" | "rateCellRef" | "totalCellRef" | "noteCellRef"> {
  const { excelRowZeroBased, rateColIdx, totalColIdx, noteColIdx } = params;
  return {
    excelRowIndex: excelRowZeroBased + 1,
    rateCellRef:
      rateColIdx !== null && rateColIdx >= 0
        ? XLSX.utils.encode_cell({ r: excelRowZeroBased, c: rateColIdx })
        : null,
    totalCellRef:
      totalColIdx !== null && totalColIdx >= 0
        ? XLSX.utils.encode_cell({ r: excelRowZeroBased, c: totalColIdx })
        : null,
    noteCellRef:
      noteColIdx !== null && noteColIdx >= 0
        ? XLSX.utils.encode_cell({ r: excelRowZeroBased, c: noteColIdx })
        : null,
  };
}

export interface WritebackRowInput {
  id: string;
  item_no: string;
  description_ar: string;
  quantity: number | null;
  is_group: boolean;
  is_included_elsewhere?: boolean | null;
  manual_unit_price?: number | null;
  rate_source?: string | null;
  material_cost?: number | null;
  labor_cost?: number | null;
  equipment_cost?: number | null;
  subcontractor_cost?: number | null;
  sheet_name?: string | null;
  excel_row_index?: number | null;
  rate_cell_ref?: string | null;
  total_cell_ref?: string | null;
  note_cell_ref?: string | null;
  note?: string | null;
  row_kind?: string | null;
}

/**
 * Injects priced unit rates & totals directly into a copy of the uploaded client Excel workbook
 * while preserving original sheets (including hidden sheets), formulas, number formats, and layout.
 */
export function writeBoqIntoOriginalWorkbook(params: {
  originalWorkbookB64: string;
  rows: WritebackRowInput[];
  paSellingRates: Map<string, number>;
  paItemsByItemId?: Map<string, ResourceCostInput[]>;
  markupsByItemId?: Map<string, MarkupSettings>;
}): { workbook: XLSX.WorkBook; updatedCells: number; preservedFormulaCells: number } {
  const bytes = base64ToUint8Array(params.originalWorkbookB64);
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    cellStyles: true,
    cellNF: true,
    cellDates: true,
  });

  let updatedCells = 0;
  let preservedFormulaCells = 0;

  for (const row of params.rows) {
    if (row.is_group) continue;
    if (row.row_kind && row.row_kind !== "item") continue;
    const sheetName = row.sheet_name || workbook.SheetNames[0];
    const ws = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!ws) continue;

    let cleanRate = 0;
    let cleanTotal = 0;
    if (params.paItemsByItemId || params.markupsByItemId) {
      const resolved = resolveBoqItemPricing({
        item: row,
        ...(params.paItemsByItemId?.get(row.id) ? { paLines: params.paItemsByItemId.get(row.id)! } : {}),
        ...(params.markupsByItemId?.get(row.id) ? { markup: params.markupsByItemId.get(row.id)! } : {}),
      });
      cleanRate = resolved.approvedUnitRate;
      cleanTotal = resolved.lineSellingPrice;
    } else {
      const fromPa = params.paSellingRates.get(row.id);
      if (row.is_included_elsewhere) {
        cleanRate = 0;
      } else if (Number(row.manual_unit_price ?? 0) > 0) {
        cleanRate = roundUpRate(Number(row.manual_unit_price));
      } else if (row.rate_source === "analysis" || params.paSellingRates.has(row.id)) {
        cleanRate = roundUpRate(typeof fromPa === "number" ? fromPa : 0);
      } else {
        const stored =
          Number(row.material_cost ?? 0) +
          Number(row.labor_cost ?? 0) +
          Number(row.equipment_cost ?? 0) +
          Number(row.subcontractor_cost ?? 0);
        cleanRate = roundUpRate(stored);
      }
      cleanTotal = roundTo(cleanRate * Number(row.quantity ?? 0), 2);
    }

    if (row.rate_cell_ref) {
      const existing = ws[row.rate_cell_ref] as XLSX.CellObject | undefined;
      if (existing?.f) {
        existing.v = cleanRate;
        preservedFormulaCells++;
      } else {
        ws[row.rate_cell_ref] = {
          ...(existing ?? {}),
          t: "n",
          v: cleanRate,
          z: existing?.z || "#,##0.00",
        };
        updatedCells++;
      }
    }

    if (row.total_cell_ref) {
      const existingTotal = ws[row.total_cell_ref] as XLSX.CellObject | undefined;
      if (existingTotal?.f) {
        // Keep the original client Excel formula intact and update cached numeric value
        existingTotal.v = cleanTotal;
        preservedFormulaCells++;
      } else {
        ws[row.total_cell_ref] = {
          ...(existingTotal ?? {}),
          t: "n",
          v: cleanTotal,
          z: existingTotal?.z || "#,##0.00",
        };
        updatedCells++;
      }
    }

    if (row.note_cell_ref && row.note) {
      const existingNote = ws[row.note_cell_ref] as XLSX.CellObject | undefined;
      ws[row.note_cell_ref] = {
        ...(existingNote ?? {}),
        t: "s",
        v: row.note,
      };
      updatedCells++;
    }
  }

  return { workbook, updatedCells, preservedFormulaCells };
}

export function exportOriginalWorkbookToFile(params: {
  originalWorkbookB64: string;
  projectName: string;
  rows: WritebackRowInput[];
  paSellingRates: Map<string, number>;
  paItemsByItemId?: Map<string, ResourceCostInput[]>;
  markupsByItemId?: Map<string, MarkupSettings>;
}): { updatedCells: number; preservedFormulaCells: number } {
  const result = writeBoqIntoOriginalWorkbook(params);
  const safeName = (params.projectName || "BOQ").replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, "_");
  const dateStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(result.workbook, `${safeName}_Priced_Original_${dateStr}.xlsx`);
  return {
    updatedCells: result.updatedCells,
    preservedFormulaCells: result.preservedFormulaCells,
  };
}
