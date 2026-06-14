import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";

type PaItem = Database["public"]["Tables"]["price_analysis_items"]["Row"];
type Markup = Database["public"]["Tables"]["price_analysis_markup"]["Row"];
type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
type ResourceType = Database["public"]["Enums"]["resource_type"];

const TYPE_LABEL: Record<ResourceType, string> = {
  material: "مواد",
  labor: "عمالة",
  equipment: "معدات",
  subcontractor: "مقاول باطن",
};

export function exportPriceAnalysis(
  boqItem: BoqRow,
  items: PaItem[],
  markup: Markup | null,
  fileName?: string,
) {
  const aoa: (string | number)[][] = [];

  aoa.push(["تحليل أسعار البند"]);
  aoa.push(["رقم البند", boqItem.item_no]);
  aoa.push(["الوصف", boqItem.description_ar]);
  aoa.push(["الوحدة", boqItem.unit ?? ""]);
  aoa.push(["الكمية", Number(boqItem.quantity ?? 0)]);
  aoa.push([]);
  aoa.push(["النوع", "الوصف", "الوحدة", "الكمية", "سعر الوحدة", "الإجمالي"]);

  let direct = 0;
  (["material", "labor", "equipment", "subcontractor"] as ResourceType[]).forEach((t) => {
    const rows = items.filter((i) => i.resource_type === t);
    if (rows.length === 0) return;
    let sub = 0;
    rows.forEach((r) => {
      const total = Number(r.quantity) * Number(r.unit_price);
      sub += total;
      aoa.push([
        TYPE_LABEL[t],
        r.description_ar,
        r.unit,
        Number(r.quantity),
        Number(r.unit_price),
        total,
      ]);
    });
    aoa.push([`مجموع ${TYPE_LABEL[t]}`, "", "", "", "", sub]);
    direct += sub;
  });

  aoa.push([]);
  const indirect = Number(markup?.indirect_pct ?? 5);
  const overhead = Number(markup?.overhead_pct ?? 8);
  const risk = Number(markup?.risk_pct ?? 3);
  const profit = Number(markup?.profit_pct ?? 10);
  const indirectVal = (direct * indirect) / 100;
  const s1 = direct + indirectVal;
  const overheadVal = (s1 * overhead) / 100;
  const s2 = s1 + overheadVal;
  const riskVal = (s2 * risk) / 100;
  const s3 = s2 + riskVal;
  const profitVal = (s3 * profit) / 100;
  const selling = s3 + profitVal;

  aoa.push(["التكلفة المباشرة", "", "", "", "", direct]);
  aoa.push([`غير مباشرة %`, indirect, "", "", "", indirectVal]);
  aoa.push([`مصاريف عامة %`, overhead, "", "", "", overheadVal]);
  aoa.push([`المخاطر %`, risk, "", "", "", riskVal]);
  aoa.push([`الربح %`, profit, "", "", "", profitVal]);
  aoa.push(["سعر البيع للوحدة", "", "", "", "", selling]);
  aoa.push(["الإجمالي للكمية", "", "", "", "", selling * Number(boqItem.quantity ?? 0)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Price Analysis");
  XLSX.writeFile(wb, fileName ?? `price-analysis-${boqItem.item_no}.xlsx`);
}
