import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
export type TreeNode = BoqRow & { children: TreeNode[]; rolledTotal: number; unitRate: number };

export type ExcelHeader = { label: string; field: string | null };

export function exportBoq(
  projectName: string,
  allRows: BoqRow[],
  paSellingRates: Map<string, number>,
  excelHeadersRaw: any,
  excelPreHeadersRaw: any,
  format: "xlsx" | "csv",
  lang: "ar" | "en" = "ar"
) {
  const isEn = lang === "en";
  const sheetNames = Array.from(new Set(allRows.map((r) => r.sheet_name || "Sheet1")));
  if (sheetNames.length === 0) sheetNames.push("Sheet1");

  const wb = XLSX.utils.book_new();

  for (const sheetName of sheetNames) {
    const sheetRows = allRows.filter((r) => (r.sheet_name || "Sheet1") === sheetName);

    const map = new Map<string, TreeNode>();
    sheetRows.forEach((r) => map.set(r.id, { ...r, children: [], rolledTotal: 0, unitRate: 0 }));
    const roots: TreeNode[] = [];
    sheetRows.forEach((r) => {
      const node = map.get(r.id);
      if (!node) return;
      const parent = r.parent_id ? map.get(r.parent_id) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });
    const sortRec = (arr: TreeNode[]) => {
      arr.sort((a, b) => a.sort_order - b.sort_order);
      arr.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    const computeTotal = (n: TreeNode): number => {
      if (n.is_group) {
        n.unitRate = 0;
        n.rolledTotal = n.children.reduce((s, c) => s + computeTotal(c), 0);
      } else {
        const fromPa = paSellingRates.get(n.id);
        n.unitRate =
          typeof fromPa === "number" && fromPa > 0
            ? fromPa
            : Number(n.material_cost ?? 0) +
              Number(n.labor_cost ?? 0) +
              Number(n.equipment_cost ?? 0) +
              Number(n.subcontractor_cost ?? 0);
        n.rolledTotal = n.unitRate * Number(n.quantity ?? 0);
      }
      return n.rolledTotal;
    };
    roots.forEach(computeTotal);

    const flatRows: TreeNode[] = [];
    const traverse = (arr: TreeNode[]) => {
      arr.forEach((n) => {
        flatRows.push(n);
        traverse(n.children);
      });
    };
    traverse(roots);

    let hList = excelHeadersRaw?.[sheetName];
    if (!hList && Array.isArray(excelHeadersRaw)) hList = excelHeadersRaw;

    let phList = excelPreHeadersRaw?.[sheetName];
    if (!phList && Array.isArray(excelPreHeadersRaw)) phList = excelPreHeadersRaw;

    const defaultHeaders: ExcelHeader[] = isEn
      ? [
          { label: "Item No.", field: "item_no" },
          { label: "Description", field: "description" },
          { label: "Unit", field: "unit" },
          { label: "Quantity", field: "quantity" },
          { label: "Unit Rate", field: "unit_rate" },
          { label: "Total Price", field: "total" },
        ]
      : [
          { label: "رقم البند", field: "item_no" },
          { label: "الوصف", field: "description" },
          { label: "الوحدة", field: "unit" },
          { label: "الكمية", field: "quantity" },
          { label: "سعر الوحدة", field: "unit_rate" },
          { label: "الإجمالي", field: "total" },
        ];

    const headers: ExcelHeader[] =
      hList && hList.length > 0
        ? hList.map((h: any) => (typeof h === "string" ? { label: h, field: null } : h))
        : defaultHeaders;

    const aoaData: unknown[][] = [];

    if (phList && Array.isArray(phList)) {
      phList.forEach((row: any) => {
        aoaData.push(Array.isArray(row) ? row : []);
      });
    }

    const headerLabels = headers.map((h) => h.label);
    aoaData.push(headerLabels);

    flatRows.forEach((node) => {
      const rawRow = (node.raw_row as unknown[]) || [];
      const resultRow = new Array(Math.max(headers.length, rawRow.length)).fill("");

      for (let i = 0; i < rawRow.length; i++) {
        resultRow[i] = rawRow[i];
      }

      headers.forEach((h, idx) => {
        const f = h.field;
        if (f === "item_no") resultRow[idx] = node.item_no;
        if (f === "description" || f === "description_ar" || f === "description_en") {
          // If English mode, prefer description_en with fallback to description_ar
          const desc = isEn
            ? (node.description_en?.trim() || node.description_ar)
            : node.description_ar;
          resultRow[idx] = desc;
        }
        if (f === "unit") resultRow[idx] = node.unit;
        if (f === "quantity") resultRow[idx] = node.is_group ? "" : node.quantity;
        if (f === "unit_rate") resultRow[idx] = node.is_group ? "" : node.unitRate;
        if (f === "total") resultRow[idx] = node.rolledTotal;
        if (f === "material_cost") resultRow[idx] = node.material_cost;
        if (f === "labor_cost") resultRow[idx] = node.labor_cost;
        if (f === "equipment_cost") resultRow[idx] = node.equipment_cost;
        if (f === "subcontractor_cost") resultRow[idx] = node.subcontractor_cost;
      });

      aoaData.push(resultRow);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoaData);

    const colWidths = headers.map((h) => {
      const f = h.field;
      if (f === "description" || f === "description_ar") return { wch: 60 };
      if (f === "item_no") return { wch: 15 };
      if (f === "total") return { wch: 18 };
      return { wch: 12 };
    });
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = (projectName || "BOQ").replace(/[\/\\?%*:|"<>]/g, "-");
  XLSX.writeFile(wb, `${safeName}_${timestamp}.${format}`);
}
