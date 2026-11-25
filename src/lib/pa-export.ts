import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";
import {
  computeDirectUnitCost,
  computePricingPhase2,
  roundTo,
  type ResourceCostInput,
} from "./estimation-calc";
import { SCOPE_LABELS_AR, type AssemblyScopeTag } from "./csi-assemblies-engine";

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

function computePaLineDirectCost(r: Partial<PaItem>): number {
  const qty = Number(r.quantity) || 0;
  const price = Number(r.unit_price) || 0;
  const waste = r.resource_type === "material" ? Number(r.waste_pct ?? 0) : 0;
  const productivity = Number(r.productivity ?? 0);
  if ((r.resource_type === "labor" || r.resource_type === "equipment") && productivity > 0) {
    return roundTo(price / productivity, 4);
  }
  return roundTo(qty * (1 + waste / 100) * price, 4);
}

export function buildPriceAnalysisExportRows(
  boqItem: Pick<BoqRow, "item_no" | "description_ar" | "description_en" | "unit" | "quantity" | "manual_unit_price">,
  items: Partial<PaItem>[],
  markup: Partial<Markup> | null,
  lang: "ar" | "en" = "ar",
): { aoa: (string | number)[][]; phase2: ReturnType<typeof computePricingPhase2> } {
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
      ? ["Type", "Scope", "Description", "Unit", "Net Qty", "Waste %", "Unit Rate", "Total Direct Cost"]
      : ["النوع", "النطاق", "الوصف", "الوحدة", "الكمية الصافية", "الهالك %", "سعر الوحدة", "إجمالي التكلفة المباشرة"],
  );

  (["material", "labor", "equipment", "subcontractor"] as ResourceType[]).forEach((t) => {
    const rows = items.filter((i) => i.resource_type === t);
    if (rows.length === 0) return;
    let sub = 0;
    rows.forEach((r) => {
      const total = computePaLineDirectCost(r);
      sub = roundTo(sub + total, 4);
      const itemDesc = isEn
        ? (r.description_en?.trim() || r.description_ar || "")
        : (r.description_ar || "");
      const cs = (r.cell_styles ?? {}) as Record<string, unknown>;
      const rawScope = (r as any).scope_tag ?? (cs["scope_tag"] as string | undefined) ?? "";
      const scopeDisplay = rawScope
        ? (isEn ? rawScope : (SCOPE_LABELS_AR[rawScope as AssemblyScopeTag] ?? rawScope))
        : "";
      const wasteVal = r.resource_type === "material" ? Number(r.waste_pct ?? 0) : 0;

      aoa.push([
        typeLabel[t],
        scopeDisplay,
        itemDesc,
        r.unit ?? "",
        Number(r.quantity ?? 0),
        wasteVal,
        Number(r.unit_price ?? 0),
        roundTo(total, 2),
      ]);
    });
    aoa.push([
      isEn ? `Total ${typeLabel[t]}` : `مجموع ${typeLabel[t]}`,
      "",
      "",
      "",
      "",
      "",
      "",
      roundTo(sub, 2),
    ]);
  });

  const mappedInputs: ResourceCostInput[] = items.map((r) => ({
    resource_type: (r.resource_type ?? "material") as ResourceCostInput["resource_type"],
    quantity: Number(r.quantity ?? 0),
    unit_price: Number(r.unit_price ?? 0),
    waste_pct: r.resource_type === "material" ? Number(r.waste_pct ?? 0) : 0,
    ...(Number(r.productivity ?? 0) > 0 ? { productivity: Number(r.productivity) } : {}),
  }));

  const direct = computeDirectUnitCost(mappedInputs).directUnitCost;
  const indirect = Number(markup?.indirect_pct ?? 0);
  const overhead = Number(markup?.overhead_pct ?? 0);
  const risk = Number(markup?.risk_pct ?? 0);
  const profit = Number(markup?.profit_pct ?? 0);

  const phase2 = computePricingPhase2({
    directUnitCost: direct,
    quantity: Number(boqItem.quantity ?? 0),
    markups: {
      indirect_pct: indirect,
      overhead_pct: overhead,
      risk_pct: risk,
      profit_pct: profit,
      pricing_policy:
        ((markup?.pricing_policy as "additive_v2" | "cascaded_v1" | null) ?? "additive_v2"),
      round_up_rate: markup?.round_up_rate ?? true,
    },
    manualSellingPrice: markup?.manual_unit_price ?? boqItem.manual_unit_price ?? null,
  });

  aoa.push([]);
  aoa.push([isEn ? "Direct Unit Cost" : "التكلفة المباشرة للوحدة", "", "", "", "", "", "", phase2.directUnitCost]);
  aoa.push([isEn ? `Indirect Cost (${indirect}%)` : `تكلفة غير مباشرة (${indirect}%)`, "", "", "", "", "", "", phase2.indirectVal]);
  aoa.push([isEn ? `General Overhead (${overhead}%)` : `مصاريف عامة (${overhead}%)`, "", "", "", "", "", "", phase2.overheadVal]);
  aoa.push([isEn ? `Risk (${risk}%)` : `المخاطر (${risk}%)`, "", "", "", "", "", "", phase2.riskVal]);
  aoa.push([isEn ? `Profit (${profit}%)` : `الربح (${profit}%)`, "", "", "", "", "", "", phase2.profitVal]);
  aoa.push([isEn ? "Raw Unit Selling Price" : "سعر البيع الخام قبل التقريب", "", "", "", "", "", "", phase2.rawUnitSellingPrice]);
  aoa.push([isEn ? "ROUNDUP Adjustment" : "أثر تقريب الفئة (ROUNDUP)", "", "", "", "", "", "", phase2.roundingDifferencePerUnit]);
  aoa.push([isEn ? "Approved Unit Rate (ROUNDUP)" : "فئة البيع المعتمدة (ROUNDUP)", "", "", "", "", "", "", phase2.approvedUnitRate]);
  aoa.push([isEn ? "Total for BOQ Quantity" : "الإجمالي للكمية", "", "", "", "", "", "", phase2.lineSellingPrice]);

  return { aoa, phase2 };
}

export function exportPriceAnalysis(
  boqItem: BoqRow,
  items: PaItem[],
  markup: Markup | null,
  fileName?: string,
  lang: "ar" | "en" = "ar",
) {
  const { aoa } = buildPriceAnalysisExportRows(boqItem, items, markup, lang);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 16 },
    { wch: 24 },
    { wch: 44 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 18 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rate Build-Up");

  const safeItemNo = boqItem.item_no.replace(/[\/\\?%*:|"<>]/g, "-");
  const name = fileName || `RateBuildUp_${safeItemNo}.xlsx`;
  XLSX.writeFile(wb, name);
}
