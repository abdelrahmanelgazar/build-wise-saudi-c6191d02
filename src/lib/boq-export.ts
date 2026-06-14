import * as XLSX from "xlsx";
import { type TreeNode } from "@/components/boq/boq-grid";

export type ExcelHeader = { label: string; field: string | null };

export function exportBoq(
  projectName: string,
  flatRows: { node: TreeNode; depth: number }[],
  excelHeaders: ExcelHeader[] | string[],
  excelPreHeaders: unknown[][],
  format: "xlsx" | "csv"
) {
  const aoaData: unknown[][] = [];
  
  // Normalize headers
  const headers: ExcelHeader[] = excelHeaders.length > 0 
    ? excelHeaders.map(h => typeof h === "string" ? { label: h, field: null } : h)
    : [
        { label: "رقم البند", field: "item_no" },
        { label: "الوصف", field: "description_ar" },
        { label: "الوحدة", field: "unit" },
        { label: "الكمية", field: "quantity" },
        { label: "سعر الوحدة", field: "unit_rate" },
        { label: "الإجمالي", field: "total" },
      ];

  // 1. Add Pre-Headers
  if (excelPreHeaders && Array.isArray(excelPreHeaders)) {
    excelPreHeaders.forEach(row => {
      aoaData.push(Array.isArray(row) ? row : []);
    });
  }

  // 2. Add Header Row
  const headerLabels = headers.map(h => h.label);
  aoaData.push(headerLabels);

  // 3. Add Data Rows
  flatRows.forEach(({ node }) => {
    const rawRow = (node.raw_row as unknown[]) || [];
    const resultRow = new Array(Math.max(headers.length, rawRow.length)).fill("");
    
    // First, fill with raw_row values
    for (let i = 0; i < rawRow.length; i++) {
      resultRow[i] = rawRow[i];
    }
    
    // Override mapped fields
    headers.forEach((h, idx) => {
      const f = h.field;
      if (f === "item_no") resultRow[idx] = node.item_no;
      if (f === "description_ar") resultRow[idx] = node.description_ar;
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

  // 4. Create Workbook
  const ws = XLSX.utils.aoa_to_sheet(aoaData);
  
  // Auto-width for columns
  const colWidths = headers.map(h => {
    const f = h.field;
    if (f === "description_ar") return { wch: 60 };
    if (f === "item_no") return { wch: 15 };
    if (f === "total") return { wch: 18 };
    return { wch: 12 };
  });
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BOQ");

  // 5. Download
  const timestamp = new Date().toISOString().slice(0, 10);
  const safeName = (projectName || "BOQ").replace(/[\/\\?%*:|"<>]/g, '-');
  XLSX.writeFile(wb, `${safeName}_${timestamp}.${format}`);
}
