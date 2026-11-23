import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type BreakdownResourceType = "material" | "labor" | "equipment" | "subcontractor";

export interface BreakdownResourceItem {
  id: string;
  resource_type: BreakdownResourceType;
  description_ar: string;
  description_en: string;
  unit: string;
  quantity: number;
  unit_price: number;
  notes?: string;
}

export interface BreakdownTemplate {
  id: string;
  code: string;
  division: string;
  title_ar: string;
  title_en: string;
  description_ar: string;
  description_en: string;
  unit: string;
  recommended_overhead_pct: number;
  recommended_profit_pct: number;
  recommended_risk_pct: number;
  items: BreakdownResourceItem[];
  is_custom?: boolean;
  created_at?: string;
}

const STORAGE_KEY = "taqdiri:item_breakdown_library:custom";

export const DEFAULT_BREAKDOWN_TEMPLATES: BreakdownTemplate[] = [
  {
    id: "tmpl-rc-foundations",
    code: "CONC-RC-FDN",
    division: "Div. 03 - Concrete Works",
    title_ar: "خرسانة مسلحة للأساسات — م³",
    title_en: "Reinforced Concrete for Foundations — m³",
    description_ar: "توريد وصب خرسانة مسلحة للأساسات والقواعد شاملة خرسانة جاهزة C35 وحديد تسليح 100 كجم/م³، ومضخة خرسانة بوم وطاقم صب معتمد وشدات خشبية.",
    description_en: "Supply and cast reinforced concrete for foundations including C35 ready-mix, 100 kg/m³ high tensile steel rebar, concrete boom pump, pouring crew and formwork.",
    unit: "m3",
    recommended_overhead_pct: 10,
    recommended_profit_pct: 10,
    recommended_risk_pct: 2,
    items: [
      {
        id: "res-rc-mat-conc",
        resource_type: "material",
        description_ar: "خرسانة جاهزة SRC رتبة C35 محطة خلط معتمدة",
        description_en: "Ready-mix SRC concrete C35 from approved batching plant",
        unit: "m3",
        quantity: 1.05,
        unit_price: 245.00,
      },
      {
        id: "res-rc-mat-steel",
        resource_type: "material",
        description_ar: "حديد تسليح عالي المقاومة مشكل ومربوط (100 كجم/م³)",
        description_en: "High tensile deformed steel rebar fabricated & fixed (100 kg/m³)",
        unit: "kg",
        quantity: 100,
        unit_price: 3.00,
        notes: "معامل الاستهلاك المرجعي 100 كجم/م³ بسعر 3 ر.س/كجم",
      },
      {
        id: "res-rc-eq-pump",
        resource_type: "equipment",
        description_ar: "مضخة خرسانة بوم 42 م وهزازات ميكانيكية",
        description_en: "Concrete boom pump 42m and mechanical vibrators",
        unit: "m3",
        quantity: 1,
        unit_price: 25.00,
      },
      {
        id: "res-rc-lab-crew",
        resource_type: "labor",
        description_ar: "طاقم صب ودمك وتسوية الخرسانة (فورمن + 4 عمال)",
        description_en: "Pouring and finishing labor crew (foreman + 4 laborers)",
        unit: "m3",
        quantity: 1,
        unit_price: 30.00,
      },
      {
        id: "res-rc-sub-form",
        resource_type: "subcontractor",
        description_ar: "مصنعية شدات خشبية للأساسات وفك الشدات",
        description_en: "Subcontractor formwork carpentry for foundations",
        unit: "m3",
        quantity: 1,
        unit_price: 35.00,
      },
    ],
  },
  {
    id: "tmpl-blk-153c",
    code: "BLK-153C",
    division: "Div. 04 - Masonry",
    title_ar: "مباني بلوك مصمت سماكة 150 مم مقاوم للحريق 1 ساعة",
    title_en: "Concrete Masonry Solid Blockwork, 150 mm, 1 hour fire rated, Type BLK-153C",
    description_ar: "توريد وبناء بلوك أسمنتي مصمت سماكة 150 مم مع المونة الإسمنتية المقاومة والشبوك والزوايا المعدنية حسب الكود السعودي.",
    description_en: "Supply and install 150mm solid concrete blockwork with cement mortar, wire mesh reinforcement and ties conforming to SBC.",
    unit: "m2",
    recommended_overhead_pct: 10,
    recommended_profit_pct: 8,
    recommended_risk_pct: 2,
    items: [
      {
        id: "res-blk-150-mat",
        resource_type: "material",
        description_ar: "بلوك أسمنتي مصمت 150 مم ومونة لاصقة إسمنتية وشبوك ربط",
        description_en: "Solid concrete blocks 150mm, cement mortar and wall ties",
        unit: "m2",
        quantity: 1,
        unit_price: 28.60,
      },
      {
        id: "res-blk-150-sub",
        resource_type: "subcontractor",
        description_ar: "مصنعية مقاول باطن لأعمال بناء البلوك والسقالات والنقل الداخلي",
        description_en: "Subcontractor masonry labor, scaffolding and internal handling",
        unit: "m2",
        quantity: 1,
        unit_price: 16.00,
      },
    ],
  },
  {
    id: "tmpl-blk-100a",
    code: "BLK-100A",
    division: "Div. 04 - Masonry",
    title_ar: "مباني بلوك مصمت سماكة 100 مم غير مقاوم للحريق",
    title_en: "Concrete Masonry Solid Blockwork, 100 mm, non fire rated, Type BLK-100A",
    description_ar: "توريد وبناء قواطع بلوك أسمنتي مصمت 100 مم للقواطع الداخلية مع المونة والمثبتات.",
    description_en: "Supply and install 100mm solid concrete blockwork for partition walls including mortar and accessories.",
    unit: "m2",
    recommended_overhead_pct: 10,
    recommended_profit_pct: 8,
    recommended_risk_pct: 2,
    items: [
      {
        id: "res-blk-100-mat",
        resource_type: "material",
        description_ar: "بلوك أسمنتي مصمت 100 مم ومونة إسمنتية وشبوك",
        description_en: "Solid concrete blocks 100mm and cement mortar",
        unit: "m2",
        quantity: 1,
        unit_price: 22.40,
      },
      {
        id: "res-blk-100-sub",
        resource_type: "subcontractor",
        description_ar: "مصنعية مقاول باطن لأعمال بناء القواطع والسقالات",
        description_en: "Subcontractor partition masonry labor and scaffolding",
        unit: "m2",
        quantity: 1,
        unit_price: 14.00,
      },
    ],
  },
  {
    id: "tmpl-blk-203c",
    code: "BLK-203C",
    division: "Div. 04 - Masonry",
    title_ar: "مباني بلوك مصمت سماكة 200 مم مقاوم للحريق 1 ساعة",
    title_en: "Concrete Masonry Solid Blockwork, 200 mm, 1 hour fire rated, Type BLK-203C",
    description_ar: "توريد وبناء جدران بلوك أسمنتي مصمت 200 مم للواجهات والقواطع الحاملة.",
    description_en: "Supply and install 200mm solid concrete blockwork for external and load bearing walls.",
    unit: "m2",
    recommended_overhead_pct: 10,
    recommended_profit_pct: 8,
    recommended_risk_pct: 2,
    items: [
      {
        id: "res-blk-200-mat",
        resource_type: "material",
        description_ar: "بلوك أسمنتي مصمت 200 مم ومونة إسمنتية وحديد تسليح شريطي",
        description_en: "Solid concrete blocks 200mm, mortar and ladder reinforcement",
        unit: "m2",
        quantity: 1,
        unit_price: 35.80,
      },
      {
        id: "res-blk-200-sub",
        resource_type: "subcontractor",
        description_ar: "مصنعية مقاول باطن لبناء جدران 200 مم شاملة السقالات",
        description_en: "Subcontractor masonry labor for 200mm walls with scaffolding",
        unit: "m2",
        quantity: 1,
        unit_price: 18.50,
      },
    ],
  },
  {
    id: "tmpl-conc-c35",
    code: "CONC-C35",
    division: "Div. 03 - Concrete Works",
    title_ar: "خرسانة مسلحة جاهزة رتبة C35 للقواعد والأساسات",
    title_en: "Ready-Mix Reinforced Concrete C35 for Foundations",
    description_ar: "توريد وصب خرسانة مسلحة C35 مقاومة للكبريتات SRC شاملة الضخ والدمك والمعالجة بالماء.",
    description_en: "Supply and pour ready-mix C35 SRC sulfate resisting concrete including pumping, vibration and curing.",
    unit: "m3",
    recommended_overhead_pct: 8,
    recommended_profit_pct: 10,
    recommended_risk_pct: 2,
    items: [
      {
        id: "res-conc-mat-1",
        resource_type: "material",
        description_ar: "خرسانة جاهزة SRC رتبة C35 محطة خلط معتمدة",
        description_en: "Ready-mix SRC concrete C35 from approved batching plant",
        unit: "m3",
        quantity: 1.05,
        unit_price: 245.00,
      },
      {
        id: "res-conc-eq-1",
        resource_type: "equipment",
        description_ar: "مضخة خرسانة بوم 42 م وهزازات ميكانيكية",
        description_en: "Concrete boom pump 42m and mechanical vibrators",
        unit: "m3",
        quantity: 1,
        unit_price: 25.00,
      },
      {
        id: "res-conc-lab-1",
        resource_type: "labor",
        description_ar: "فريق صب ودمك وتسوية الخرسانة (فورمن + 4 عمال)",
        description_en: "Pouring and finishing labor crew (foreman + 4 laborers)",
        unit: "m3",
        quantity: 1,
        unit_price: 30.00,
      },
    ],
  },
  {
    id: "tmpl-plaster-int",
    code: "PLAST-INT-20",
    division: "Div. 09 - Finishes",
    title_ar: "لياسة إسمنتية داخلية سماكة 15-20 مم مع الطرطشة والأوتار",
    title_en: "Internal Cement Plastering 15-20mm including rush coat & guides",
    description_ar: "أعمال لياسة داخلية ناعمة للجدران والأسقف مع الشبوك المعدنية وزوايا الحماية ومعالجة الشقوق.",
    description_en: "Internal smooth cement plaster for walls and ceilings with corner beads, wire mesh and curing.",
    unit: "m2",
    recommended_overhead_pct: 10,
    recommended_profit_pct: 10,
    recommended_risk_pct: 2,
    items: [
      {
        id: "res-plaster-mat",
        resource_type: "material",
        description_ar: "إسمنت بورتلاندي ورمل مغسول وشبوك وزوايا معدنية وبوند لاصق",
        description_en: "Portland cement, washed sand, mesh, corner beads and bonding agent",
        unit: "m2",
        quantity: 1,
        unit_price: 11.50,
      },
      {
        id: "res-plaster-sub",
        resource_type: "subcontractor",
        description_ar: "مصنعية مقاول باطن لأعمال اللياسة الداخلية الموزونة بالقدة والميزان",
        description_en: "Subcontractor plastering labor with level and straightedge finishing",
        unit: "m2",
        quantity: 1,
        unit_price: 18.00,
      },
    ],
  },
  {
    id: "tmpl-waterproof-roof",
    code: "WP-ROOF-4MM",
    division: "Div. 07 - Thermal & Moisture",
    title_ar: "عزل مائي لفائف بيتومينية 4 مم للأسطح",
    title_en: "Bituminous Waterproofing Membrane 4mm for Roofs",
    description_ar: "توريد وتركيب عزل مائي لفائف SBS بيتومينية معدلة بالبوليستر سماكة 4 مم مع البرايمر والرقاب واختبار الغمر.",
    description_en: "Supply and torch-apply 4mm SBS bituminous polyester reinforced membrane with primer, cant strips and flood test.",
    unit: "m2",
    recommended_overhead_pct: 10,
    recommended_profit_pct: 12,
    recommended_risk_pct: 3,
    items: [
      {
        id: "res-wp-mat-1",
        resource_type: "material",
        description_ar: "لفائف بيتومينية 4 مم وبرايمر ومعجون فواصل معتمد",
        description_en: "Bituminous membrane 4mm, primer and mastic sealant",
        unit: "m2",
        quantity: 1.15,
        unit_price: 24.00,
      },
      {
        id: "res-wp-sub-1",
        resource_type: "subcontractor",
        description_ar: "مصنعية مقاول عزل متخصص شاملة مشاعل الغاز واختبار المياه 48 ساعة",
        description_en: "Specialist waterproofing contractor labor including torching and 48hr flood test",
        unit: "m2",
        quantity: 1,
        unit_price: 14.00,
      },
    ],
  },
];

export function getCustomTemplates(): BreakdownTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BreakdownTemplate[];
  } catch {
    return [];
  }
}

export function getAllBreakdownTemplates(): BreakdownTemplate[] {
  const custom = getCustomTemplates();
  return [...custom, ...DEFAULT_BREAKDOWN_TEMPLATES];
}

export function saveCustomTemplate(template: BreakdownTemplate): void {
  if (typeof window === "undefined") return;
  const list = getCustomTemplates();
  const idx = list.findIndex((t) => t.id === template.id);
  if (idx >= 0) {
    list[idx] = { ...template, is_custom: true };
  } else {
    list.unshift({ ...template, is_custom: true, created_at: new Date().toISOString() });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function deleteCustomTemplate(id: string): void {
  if (typeof window === "undefined") return;
  const list = getCustomTemplates().filter((t) => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function calculateBreakdownCost(
  template: BreakdownTemplate,
  markups?: { overhead_pct?: number; profit_pct?: number; risk_pct?: number }
) {
  let materialCost = 0;
  let laborCost = 0;
  let equipmentCost = 0;
  let subcontractorCost = 0;

  template.items.forEach((item) => {
    const total = (item.quantity || 0) * (item.unit_price || 0);
    switch (item.resource_type) {
      case "material":
        materialCost += total;
        break;
      case "labor":
        laborCost += total;
        break;
      case "equipment":
        equipmentCost += total;
        break;
      case "subcontractor":
        subcontractorCost += total;
        break;
    }
  });

  const directUnitCost = materialCost + laborCost + equipmentCost + subcontractorCost;

  const overheadPct = markups?.overhead_pct ?? template.recommended_overhead_pct ?? 0;
  const profitPct = markups?.profit_pct ?? template.recommended_profit_pct ?? 0;
  const riskPct = markups?.risk_pct ?? template.recommended_risk_pct ?? 0;

  const totalMarkupPct = overheadPct + profitPct + riskPct;
  const unitSellingPrice = directUnitCost * (1 + totalMarkupPct / 100);

  return {
    materialCost,
    laborCost,
    equipmentCost,
    subcontractorCost,
    directUnitCost,
    overheadPct,
    profitPct,
    riskPct,
    totalMarkupPct,
    unitSellingPrice,
  };
}

export async function applyTemplateToBoqItem({
  template,
  boqItemId,
  projectId,
  userId,
  replaceExisting = true,
}: {
  template: BreakdownTemplate;
  boqItemId: string;
  projectId: string;
  userId: string;
  replaceExisting?: boolean;
}): Promise<void> {
  // If replacing existing, delete existing price analysis items for this boq item
  if (replaceExisting) {
    const { error: delErr } = await supabase
      .from("price_analysis_items")
      .delete()
      .eq("boq_item_id", boqItemId);
    if (delErr) throw delErr;
  }

  // Insert all template items into price_analysis_items
  const inserts = template.items.map((item, index) => ({
    boq_item_id: boqItemId,
    user_id: userId,
    project_id: projectId,
    resource_type: item.resource_type,
    description_ar: item.description_ar,
    description_en: item.description_en || null,
    unit: item.unit,
    quantity: item.quantity,
    unit_price: item.unit_price,
    sort_order: index + 1,
  }));

  if (inserts.length > 0) {
    const { error: insErr } = await supabase.from("price_analysis_items").insert(inserts);
    if (insErr) throw insErr;
  }

  // Calculate totals
  const calc = calculateBreakdownCost(template);

  // Update boq_item cached cost values
  const { error: boqUpdErr } = await supabase
    .from("boq_items")
    .update({
      material_cost: calc.materialCost,
      labor_cost: calc.laborCost,
      equipment_cost: calc.equipmentCost,
      subcontractor_cost: calc.subcontractorCost,
    })
    .eq("id", boqItemId);

  if (boqUpdErr) throw boqUpdErr;

  // Ensure markup row exists or update it
  const { data: existingMarkup } = await supabase
    .from("price_analysis_markup")
    .select("id")
    .eq("boq_item_id", boqItemId)
    .maybeSingle();

  if (existingMarkup) {
    await supabase
      .from("price_analysis_markup")
      .update({
        overhead_pct: calc.overheadPct,
        profit_pct: calc.profitPct,
        risk_pct: calc.riskPct,
        project_id: projectId,
      })
      .eq("boq_item_id", boqItemId);
  } else {
    await supabase.from("price_analysis_markup").insert({
      boq_item_id: boqItemId,
      project_id: projectId,
      user_id: userId,
      overhead_pct: calc.overheadPct,
      profit_pct: calc.profitPct,
      risk_pct: calc.riskPct,
    });
  }
}
