/**
 * Unified Estimation & Pricing Calculation Engine
 * Platform: Taqdiri - BuildWise Saudi
 * Conforming to: PLATFORM_DEVELOPMENT_AUDIT.md & ESTIMATION_IMPLEMENTATION_PLAN.md
 */

export interface ResourceCostInput {
  resource_type: "material" | "labor" | "equipment" | "subcontractor";
  quantity: number;
  unit_price: number;
  waste_pct?: number; // e.g. 5 for 5%
  productivity?: number; // units per period
}

export interface MarkupSettings {
  indirect_pct?: number; // % on direct cost
  overhead_pct?: number; // % on loaded cost
  risk_pct?: number; // % on loaded cost
  profit_pct?: number; // % profit
  margin_mode?: "markup" | "margin"; // "markup" = cost-plus, "margin" = % of selling price
  custom_factor?: number; // optional direct factor e.g. 1.10
}

export interface LineItemFinancials {
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  subcontractorCost: number;
  directUnitCost: number;
  loadedUnitCost: number;
  unitSellingPrice: number;
  effectiveMarkupPct: number;
  quantity: number;
  lineDirectCost: number;
  lineSellingPrice: number;
  isGroup: boolean;
  isManualPrice: boolean;
  isIncludedElsewhere: boolean;
  isUnpriced: boolean;
}

export interface ProjectFinancialSummary {
  materialTotal: number;
  laborTotal: number;
  equipmentTotal: number;
  subcontractorTotal: number;
  totalDirectCost: number;
  indirectTotal: number;
  overheadTotal: number;
  riskTotal: number;
  profitTotal: number;
  netSellingPrice: number;
  totalMarkupAmount: number;
  totalMarkupPercentage: number;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  grandTotalWithVat: number;
  totalItemsCount: number;
  pricedItemsCount: number;
  unpricedItemsCount: number;
  missingPriceItems: Array<{ id: string; item_no: string; description_ar: string }>;
  canIssueTender: boolean;
}

/**
 * Convert Arabic/Indic digits and formatted numeric strings (e.g. "١٬٢٥٠٫٥٠" or "1,250.50") to a standard JavaScript number
 */
export function parseArabicNumber(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  let str = String(val).trim();
  // Arabic-Indic digits conversion (٠١٢٣٤٥٦٧٨٩ -> 0123456789)
  str = str.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  // Arabic decimal separator (٫) -> dot, Arabic thousands separator (٬) -> empty
  str = str.replace(/٫/g, ".").replace(/٬/g, "").replace(/,/g, "").replace(/\s+/g, "");
  const num = Number(str);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Round a number to specified decimal places using standard commercial rounding (half away from zero)
 */
export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Compute unit direct cost from a list of resource breakdown lines
 */
export function computeDirectUnitCost(items: ResourceCostInput[]): {
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  subcontractorCost: number;
  directUnitCost: number;
} {
  let materialCost = 0;
  let laborCost = 0;
  let equipmentCost = 0;
  let subcontractorCost = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const waste = Number(item.waste_pct) || 0;
    const productivity = Number(item.productivity) || 0;

    let cost = 0;
    if (item.resource_type === "material") {
      // Net consumption * (1 + waste%) * price
      cost = qty * (1 + waste / 100) * price;
      materialCost += cost;
    } else if (item.resource_type === "labor" || item.resource_type === "equipment") {
      if (productivity > 0) {
        cost = price / productivity;
      } else {
        cost = qty * price;
      }
      if (item.resource_type === "labor") laborCost += cost;
      else equipmentCost += cost;
    } else if (item.resource_type === "subcontractor") {
      cost = qty * price;
      subcontractorCost += cost;
    }
  }

  const directUnitCost = materialCost + laborCost + equipmentCost + subcontractorCost;

  return {
    materialCost: roundTo(materialCost, 4),
    laborCost: roundTo(laborCost, 4),
    equipmentCost: roundTo(equipmentCost, 4),
    subcontractorCost: roundTo(subcontractorCost, 4),
    directUnitCost: roundTo(directUnitCost, 4),
  };
}

/**
 * Compute unit selling price from direct unit cost and markup configuration
 */
export function computeUnitSellingPrice(
  directUnitCost: number,
  markup?: MarkupSettings,
  tenderDecimals = 2
): {
  loadedUnitCost: number;
  unitSellingPrice: number;
  effectiveMarkupPct: number;
} {
  if (directUnitCost <= 0) {
    return { loadedUnitCost: 0, unitSellingPrice: 0, effectiveMarkupPct: 0 };
  }

  // If a simple direct factor is supplied (e.g. 1.10)
  if (markup?.custom_factor !== undefined && markup.custom_factor > 0) {
    const unitSellingPrice = roundTo(directUnitCost * markup.custom_factor, tenderDecimals);
    const effectiveMarkupPct = roundTo((markup.custom_factor - 1) * 100, 2);
    return { loadedUnitCost: directUnitCost, unitSellingPrice, effectiveMarkupPct };
  }

  const indirect = Number(markup?.indirect_pct ?? 0);
  const overhead = Number(markup?.overhead_pct ?? 0);
  const risk = Number(markup?.risk_pct ?? 0);
  const profit = Number(markup?.profit_pct ?? 0);
  const mode = markup?.margin_mode ?? "markup";

  // 1. Indirect costs
  const indirectVal = (directUnitCost * indirect) / 100;
  const s1 = directUnitCost + indirectVal;

  // 2. Overhead costs
  const overheadVal = (s1 * overhead) / 100;
  const s2 = s1 + overheadVal;

  // 3. Risk margin
  const riskVal = (s2 * risk) / 100;
  const loadedCost = s2 + riskVal;

  let unitSellingPrice = 0;
  if (mode === "margin") {
    // Selling Price = Loaded Cost / (1 - margin%)
    // margin must be strictly less than 100%
    if (profit >= 100) {
      throw new Error("هامش الربح كنسبة من سعر البيع يجب أن يكون أقل قطعيًا من 100%");
    }
    unitSellingPrice = loadedCost / (1 - profit / 100);
  } else {
    // Standard Cost-Plus: Profit added onto loaded cost
    const profitVal = (loadedCost * profit) / 100;
    unitSellingPrice = loadedCost + profitVal;
  }

  const roundedSellingPrice = roundTo(unitSellingPrice, tenderDecimals);
  const effectiveMarkupPct =
    directUnitCost > 0
      ? roundTo(((roundedSellingPrice - directUnitCost) / directUnitCost) * 100, 2)
      : 0;

  return {
    loadedUnitCost: roundTo(loadedCost, tenderDecimals),
    unitSellingPrice: roundedSellingPrice,
    effectiveMarkupPct,
  };
}

/**
 * Compute line item financials for a BOQ item
 */
export function computeLineItemFinancials(params: {
  quantity: number;
  directUnitCost?: number;
  manualUnitSellingPrice?: number | null;
  materialCost?: number;
  laborCost?: number;
  equipmentCost?: number;
  subcontractorCost?: number;
  markup?: MarkupSettings;
  isGroup?: boolean;
  isIncludedElsewhere?: boolean;
  tenderDecimals?: number;
  currencyDecimals?: number;
}): LineItemFinancials {
  const {
    quantity = 0,
    isGroup = false,
    isIncludedElsewhere = false,
    manualUnitSellingPrice = null,
    tenderDecimals = 2,
    currencyDecimals = 2,
  } = params;

  if (isGroup) {
    return {
      materialCost: 0,
      laborCost: 0,
      equipmentCost: 0,
      subcontractorCost: 0,
      directUnitCost: 0,
      loadedUnitCost: 0,
      unitSellingPrice: 0,
      effectiveMarkupPct: 0,
      quantity: 0,
      lineDirectCost: 0,
      lineSellingPrice: 0,
      isGroup: true,
      isManualPrice: false,
      isIncludedElsewhere: false,
      isUnpriced: false,
    };
  }

  if (isIncludedElsewhere) {
    return {
      materialCost: 0,
      laborCost: 0,
      equipmentCost: 0,
      subcontractorCost: 0,
      directUnitCost: 0,
      loadedUnitCost: 0,
      unitSellingPrice: 0,
      effectiveMarkupPct: 0,
      quantity,
      lineDirectCost: 0,
      lineSellingPrice: 0,
      isGroup: false,
      isManualPrice: false,
      isIncludedElsewhere: true,
      isUnpriced: false,
    };
  }

  const isManualPrice =
    manualUnitSellingPrice !== null &&
    manualUnitSellingPrice !== undefined &&
    manualUnitSellingPrice > 0;

  let directUnitCost = params.directUnitCost ?? 0;
  if (!directUnitCost) {
    directUnitCost =
      (params.materialCost ?? 0) +
      (params.laborCost ?? 0) +
      (params.equipmentCost ?? 0) +
      (params.subcontractorCost ?? 0);
  }

  let unitSellingPrice = 0;
  let loadedUnitCost = directUnitCost;
  let effectiveMarkupPct = 0;

  if (isManualPrice) {
    unitSellingPrice = roundTo(manualUnitSellingPrice!, tenderDecimals);
    effectiveMarkupPct =
      directUnitCost > 0
        ? roundTo(((unitSellingPrice - directUnitCost) / directUnitCost) * 100, 2)
        : 0;
  } else {
    const calc = computeUnitSellingPrice(directUnitCost, params.markup, tenderDecimals);
    unitSellingPrice = calc.unitSellingPrice;
    loadedUnitCost = calc.loadedUnitCost;
    effectiveMarkupPct = calc.effectiveMarkupPct;
  }

  const isUnpriced = directUnitCost <= 0 && unitSellingPrice <= 0;
  const lineDirectCost = roundTo(quantity * directUnitCost, currencyDecimals);
  const lineSellingPrice = roundTo(quantity * unitSellingPrice, currencyDecimals);

  return {
    materialCost: params.materialCost ?? 0,
    laborCost: params.laborCost ?? 0,
    equipmentCost: params.equipmentCost ?? 0,
    subcontractorCost: params.subcontractorCost ?? 0,
    directUnitCost: roundTo(directUnitCost, tenderDecimals),
    loadedUnitCost: roundTo(loadedUnitCost, tenderDecimals),
    unitSellingPrice: roundTo(unitSellingPrice, tenderDecimals),
    effectiveMarkupPct,
    quantity,
    lineDirectCost,
    lineSellingPrice,
    isGroup: false,
    isManualPrice,
    isIncludedElsewhere: false,
    isUnpriced,
  };
}

/**
 * Compute the comprehensive project-level financial summary
 */
export function computeProjectFinancials(params: {
  boqItems: Array<{
    id: string;
    item_no: string;
    description_ar: string;
    quantity: number | null;
    is_group: boolean;
    material_cost?: number | null;
    labor_cost?: number | null;
    equipment_cost?: number | null;
    subcontractor_cost?: number | null;
    manual_unit_price?: number | null;
    is_included_elsewhere?: boolean | null;
  }>;
  markupsByItemId?: Map<string, MarkupSettings>;
  defaultMarkup?: MarkupSettings;
  vatRate?: number; // e.g. 15 for 15%
  tenderDecimals?: number;
  currencyDecimals?: number;
}): ProjectFinancialSummary {
  const {
    boqItems,
    markupsByItemId = new Map(),
    defaultMarkup,
    vatRate = 15,
    tenderDecimals = 2,
    currencyDecimals = 2,
  } = params;

  let materialTotal = 0;
  let laborTotal = 0;
  let equipmentTotal = 0;
  let subcontractorTotal = 0;
  let totalDirectCost = 0;
  let indirectTotal = 0;
  let overheadTotal = 0;
  let riskTotal = 0;
  let profitTotal = 0;
  let netSellingPrice = 0;

  const missingPriceItems: Array<{ id: string; item_no: string; description_ar: string }> = [];
  let totalItemsCount = 0;
  let pricedItemsCount = 0;
  let unpricedItemsCount = 0;

  for (const item of boqItems) {
    if (item.is_group) continue; // Skip group parents in totals

    totalItemsCount++;
    const qty = Number(item.quantity) || 0;
    const markup = markupsByItemId.get(item.id) ?? defaultMarkup;

    const line = computeLineItemFinancials({
      quantity: qty,
      materialCost: Number(item.material_cost) || 0,
      laborCost: Number(item.labor_cost) || 0,
      equipmentCost: Number(item.equipment_cost) || 0,
      subcontractorCost: Number(item.subcontractor_cost) || 0,
      manualUnitSellingPrice: item.manual_unit_price,
      isIncludedElsewhere: !!item.is_included_elsewhere,
      markup,
      tenderDecimals,
      currencyDecimals,
    });

    if (line.isUnpriced) {
      unpricedItemsCount++;
      missingPriceItems.push({
        id: item.id,
        item_no: item.item_no || "—",
        description_ar: item.description_ar || "—",
      });
    } else {
      pricedItemsCount++;
    }

    materialTotal += roundTo(qty * line.materialCost, currencyDecimals);
    laborTotal += roundTo(qty * line.laborCost, currencyDecimals);
    equipmentTotal += roundTo(qty * line.equipmentCost, currencyDecimals);
    subcontractorTotal += roundTo(qty * line.subcontractorCost, currencyDecimals);

    // Track loadings breakdown
    if (!line.isGroup && !line.isIncludedElsewhere && line.directUnitCost > 0) {
      if (markup?.custom_factor !== undefined && markup.custom_factor > 0) {
        profitTotal += roundTo(line.lineSellingPrice - line.lineDirectCost, currencyDecimals);
      } else {
        const directU = line.directUnitCost;
        const indVal = (directU * Number(markup?.indirect_pct ?? 0)) / 100;
        const s1 = directU + indVal;
        const ovVal = (s1 * Number(markup?.overhead_pct ?? 0)) / 100;
        const s2 = s1 + ovVal;
        const rskVal = (s2 * Number(markup?.risk_pct ?? 0)) / 100;
        const loadedU = s2 + rskVal;
        const profitU = line.unitSellingPrice - loadedU;

        indirectTotal += roundTo(qty * indVal, currencyDecimals);
        overheadTotal += roundTo(qty * ovVal, currencyDecimals);
        riskTotal += roundTo(qty * rskVal, currencyDecimals);
        profitTotal += roundTo(qty * profitU, currencyDecimals);
      }
    }

    totalDirectCost += line.lineDirectCost;
    netSellingPrice += line.lineSellingPrice;
  }

  totalDirectCost = roundTo(totalDirectCost, currencyDecimals);
  indirectTotal = roundTo(indirectTotal, currencyDecimals);
  overheadTotal = roundTo(overheadTotal, currencyDecimals);
  riskTotal = roundTo(riskTotal, currencyDecimals);
  profitTotal = roundTo(profitTotal, currencyDecimals);
  netSellingPrice = roundTo(netSellingPrice, currencyDecimals);

  const totalMarkupAmount = roundTo(netSellingPrice - totalDirectCost, currencyDecimals);
  const totalMarkupPercentage =
    totalDirectCost > 0 ? roundTo((totalMarkupAmount / totalDirectCost) * 100, 2) : 0;

  const taxableAmount = netSellingPrice;
  const vatAmount = roundTo((taxableAmount * (vatRate || 0)) / 100, currencyDecimals);
  const grandTotalWithVat = roundTo(taxableAmount + vatAmount, currencyDecimals);

  const canIssueTender = unpricedItemsCount === 0 && totalItemsCount > 0;

  return {
    materialTotal: roundTo(materialTotal, currencyDecimals),
    laborTotal: roundTo(laborTotal, currencyDecimals),
    equipmentTotal: roundTo(equipmentTotal, currencyDecimals),
    subcontractorTotal: roundTo(subcontractorTotal, currencyDecimals),
    totalDirectCost,
    indirectTotal,
    overheadTotal,
    riskTotal,
    profitTotal,
    netSellingPrice,
    totalMarkupAmount,
    totalMarkupPercentage,
    taxableAmount,
    vatRate,
    vatAmount,
    grandTotalWithVat,
    totalItemsCount,
    pricedItemsCount,
    unpricedItemsCount,
    missingPriceItems,
    canIssueTender,
  };
}
