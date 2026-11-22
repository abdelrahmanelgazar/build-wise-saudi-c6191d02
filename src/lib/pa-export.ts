import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";

type PaItem = Database["public"]["Tables"]["price_analysis_items"]["Row"];
type Markup = Database["public"]["Tables"]["price_analysis_markup"]["Row"];
type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
type ResourceType = Database["public"]["Enums"]["resource_type"];

const TYPE_LABEL_AR: Record<ResourceType, string> = {
  material: "مواد",
  labor: "عمالة",
  equipment: "معدات",
  subcontractor: "مقاول باطن",
};

const TYPE_LABEL_EN: Record<ResourceType, string> = {
  material: "Materials",
  labor: "Labour",
  equipment: "Equipment",
  subcontractor: "Subcontractor",
};

export function exportPriceAnalysis(
  boqItem: BoqRow,
  items: PaItem[],
  markup: Markup | null,
  fileName?: string,
  lang: "ar" | "en" = "ar"
) {
  const isEn = lang === "en";
  const typeLabel = isEn ? TYPE_LABEL_EN : TYPE_LABEL_AR;
  const aoa: (string | number)[][] = [];

  const boqDesc = isEn
    ? (boqItem.description_en?.trim() || boqItem.description_ar)
    : boqItem.description_ar;

  aoa.push([isEn ? "Unit Rate Analysis" : "تحليل أسعار البند"]);
  aoa.push([isEn ? "Item No." : "رقم البند", boqItem.item_no]);
  aoa.push([isEn ? "Description" : "الوصف", boqDesc]);
  aoa.push([isEn ? "Unit" : "الوحدة", boqItem.unit ?? ""]);
  aoa.push([isEn ? "Quantity" : "الكمية", Number(boqItem.quantity ?? 0)]);
  aoa.push([]);
  aoa.push(
    isEn
      ? ["Type", "Description", "Unit", "Quantity", "Unit Rate", "Total"]
      : ["النوع", "الوصف", "الوحدة", "الكمية", "سعر الوحدة", "الإجمالي"]
  );

  let direct = 0;
  (["material", "labor", "equipment", "subcontractor"] as ResourceType[]).forEach((t) => {
    const rows = items.filter((i) => i.resource_type === t);
    if (rows.length === 0) return;
    let sub = 0;
    rows.forEach((r) => {
      const total = Number(r.quantity) * Number(r.unit_price);
      sub += total;
      const itemDesc = isEn
        ? (r.description_en?.trim() || r.description_ar)
        : r.description_ar;
      aoa.push([
        typeLabel[t],
        itemDesc,
        r.unit,
        Number(r.quantity),
        Number(r.unit_price),
        total,
      ]);
    });
    aoa.push([
      isEn ? `Total ${typeLabel[t]}` : `مجموع ${typeLabel[t]}`,
      "",
      "",
      "",
      "",
      sub,
    ]);
    direct += sub;
  });

  aoa.push([]);
  const indirect = Number(markup?.indirect_pct ?? 0);
  const overhead = Number(markup?.overhead_pct ?? 0);
  const risk     = Number(markup?.risk_pct     ?? 0);
  const profit   = Number(markup?.profit_pct   ?? 0);
  const indirectVal = (direct * indirect) / 100;
  const s1 = direct + indirectVal;
  const overheadVal = (s1 * overhead) / 100;
  const s2 = s1 + overheadVal;
  const riskVal = (s2 * risk) / 100;
  const s3 = s2 + riskVal;
  const profitVal = (s3 * profit) / 100;
  const selling = s3 + profitVal;

  aoa.push([isEn ? "Direct Cost" : "التكلفة المباشرة", "", "", "", "", direct]);
  aoa.push([isEn ? `Indirect Cost % (${indirect}%)` : `غير مباشرة % (${indirect}%)`, "", "", "", "", indirectVal]);
  aoa.push([isEn ? `General Overhead % (${overhead}%)` : `مصاريف عامة % (${overhead}%)`, "", "", "", "", overheadVal]);
  aoa.push([isEn ? `Risk % (${risk}%)` : `المخاطر % (${risk}%)`, "", "", "", "", riskVal]);
  aoa.push([isEn ? `Profit % (${profit}%)` : `الربح % (${profit}%)`, "", "", "", "", profitVal]);
  aoa.push([isEn ? "Unit Selling Price" : "سعر البيع للوحدة", "", "", "", "", selling]);

  aoa.push([isEn ? "Total for Quantity" : "الإجمالي للكمية", "", "", "", "", selling * Number(boqItem.quantity ?? 0)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 18 },
    { wch: 45 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rate Build-Up");

  const safeItemNo = boqItem.item_no.replace(/[\/\\?%*:|"<>]/g, "-");
  const name = fileName || `RateBuildUp_${safeItemNo}.xlsx`;
  XLSX.writeFile(wb, name);
}
