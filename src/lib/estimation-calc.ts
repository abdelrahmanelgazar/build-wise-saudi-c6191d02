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
  material_category?: "primary" | "accessory"; // Subcategory for materials per Phase 2
}

export type PriceAnalysisItemRow = ResourceCostInput & {
  id?: string;
  boq_item_id?: string;
  description_ar?: string;
  unit?: string;
  cost_type?: "material" | "labor" | "equipment" | "subcontractor";
  cell_styles?: Record<string, unknown> | null;
};

export interface MarkupSettings {
  indirect_pct?: number; // % on direct cost (تكلفة غير مباشرة)
  overhead_pct?: number; // % on direct cost (مصاريف عامة)
  risk_pct?: number; // % on direct cost (المخاطر)
  profit_pct?: number; // % profit on direct cost (الربح)
  margin_mode?: "markup" | "margin"; // "markup" = cost-plus, "margin" = % of selling price
  custom_factor?: number; // optional direct factor e.g. 1.10
  round_up_rate?: boolean; // Phase 2 contract: ROUNDUP to integer
  pricing_policy?: "additive_v2" | "cascaded_v1";
}

export interface LineItemFinancials {
  materialCost: number;
  primaryMaterialCost?: number;
  accessoryMaterialCost?: number;
  laborCost: number;
  equipmentCost: number;
  subcontractorCost: number;
  directUnitCost: number;
  loadedUnitCost: number;
  rawUnitSellingPrice: number;
  unitSellingPrice: number;
  roundingDiffPerUnit: number;
  lineRoundingDiff: number;
  lineAdditions: number;
  lineManualAdjustment: number;
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
  totalAdditions: number;
  totalRoundingDifference: number;
  totalManualAdjustment: number;
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

export interface Phase2PricingResult {
  directUnitCost: number;
  indirectVal: number;
  overheadVal: number;
  riskVal: number;
  profitVal: number;
  totalAdditions: number;
  rawUnitSellingPrice: number;
  approvedUnitRate: number; // ROUNDUP(rawUnitSellingPrice, 0)
  roundingDifferencePerUnit: number;
  quantity: number;
  lineDirectCost: number;
  lineAdditions: number;
  lineRoundingDifference: number;
  lineManualAdjustment: number;
  lineSellingPrice: number;
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

export function roundCurrency(value: number): number {
  return roundTo(value, 2);
}

/**
 * Compute unit direct cost from a list of resource breakdown lines
 */
export function computeDirectUnitCost(items: ResourceCostInput[]): {
  materialCost: number;
  primaryMaterialCost: number;
  accessoryMaterialCost: number;
  laborCost: number;
  equipmentCost: number;
  subcontractorCost: number;
  directUnitCost: number;
} {
  let materialCost = 0;
  let primaryMaterialCost = 0;
  let accessoryMaterialCost = 0;
  let laborCost = 0;
  let equipmentCost = 0;
  let subcontractorCost = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price) || 0;
    const waste = Number(item.waste_pct) || 0;
    const productivity = Number(item.productivity) || 0;
    const resType = item.resource_type || (item as any).cost_type;
    const cat = item.material_category || (item as any).cell_styles?.material_category;

    let cost = 0;
    if (resType === "material") {
      // Net consumption * (1 + waste%) * price
      cost = qty * (1 + waste / 100) * price;
      materialCost += cost;
      if (cat === "accessory") {
        accessoryMaterialCost += cost;
      } else {
        primaryMaterialCost += cost;
      }
    } else if (resType === "labor" || resType === "equipment") {
      if (productivity > 0) {
        cost = price / productivity;
      } else {
        cost = qty * price;
      }
      if (resType === "labor") laborCost += cost;
      else equipmentCost += cost;
    } else if (resType === "subcontractor") {
      cost = qty * price;
      subcontractorCost += cost;
    }
  }

  const directUnitCost = materialCost + laborCost + equipmentCost + subcontractorCost;

  return {
    materialCost: roundTo(materialCost, 4),
    primaryMaterialCost: roundTo(primaryMaterialCost, 4),
    accessoryMaterialCost: roundTo(accessoryMaterialCost, 4),
    laborCost: roundTo(laborCost, 4),
    equipmentCost: roundTo(equipmentCost, 4),
    subcontractorCost: roundTo(subcontractorCost, 4),
    directUnitCost: roundTo(directUnitCost, 4),
  };
}

/**
 * Phase 2 Rounding Contract: ROUNDUP to the next whole integer rate.
 * Standard boundary checks:
 * 6.25 -> 7
 * 6.0001 -> 7
 * 7 -> 7
 * 0 -> 0
 */
export function roundUpRate(val: number): number {
  if (!Number.isFinite(val) || val <= 0) return 0;
  const rounded = Math.round(val);
  if (Math.abs(val - rounded) < 1e-9) return rounded;
  return Math.ceil(val);
}

/**
 * Phase 2 Unified Pricing Engine Contract (§2 & §7 of TENDER_PRICING_PHASE_2_PLAN.md)
 * 1. 4 independent markups calculated on direct unit cost:
 *    indirect = direct * indirect_pct / 100
 *    overhead = direct * overhead_pct / 100
 *    risk     = direct * risk_pct / 100
 *    profit   = direct * profit_pct / 100
 * 2. Total Additions = indirect + overhead + risk + profit
 * 3. Raw Unit Selling Price = direct + Total Additions
 * 4. Approved Unit Selling Rate = ROUNDUP(raw, 0)
 * 5. Rounding difference = approved - raw
 * 6. Financial Reconciliation: direct + additions + roundingDiff + manualAdjustment === sellingPrice
 */
export function computePricingPhase2(
  paramsOrDirect:
    | {
        directUnitCost: number;
        quantity?: number;
        markups?: MarkupSettings;
        manualSellingPrice?: number | null;
      }
    | number,
  maybeMarkups?: MarkupSettings,
  maybeQty?: number,
  maybeManual?: number | null
): Phase2PricingResult {
  let directUnitCost = 0;
  let qty = 1;
  let m: MarkupSettings | undefined = undefined;
  let manualSellingPrice: number | null | undefined = undefined;

  if (typeof paramsOrDirect === "number") {
    directUnitCost = roundTo(Math.max(0, paramsOrDirect || 0), 4);
    m = maybeMarkups;
    qty = Number(maybeQty ?? 1);
    manualSellingPrice = maybeManual ?? (m as any)?.manual_unit_price;
  } else {
    directUnitCost = roundTo(Math.max(0, paramsOrDirect.directUnitCost || 0), 4);
    qty = Number(paramsOrDirect.quantity ?? 1);
    m = paramsOrDirect.markups;
    manualSellingPrice = paramsOrDirect.manualSellingPrice ?? (m as any)?.manual_unit_price;
  }

  const indirect_pct = Number(m?.indirect_pct ?? 0);
  const overhead_pct = Number(m?.overhead_pct ?? 0);
  const risk_pct = Number(m?.risk_pct ?? 0);
  const profit_pct = Number(m?.profit_pct ?? 0);

  const indirectVal = roundTo((directUnitCost * indirect_pct) / 100, 4);
  const overheadVal = roundTo((directUnitCost * overhead_pct) / 100, 4);
  const riskVal = roundTo((directUnitCost * risk_pct) / 100, 4);
  const profitVal = roundTo((directUnitCost * profit_pct) / 100, 4);
  const totalAdditions = roundTo(indirectVal + overheadVal + riskVal + profitVal, 4);

  const rawUnitSellingPrice = roundTo(directUnitCost + totalAdditions, 4);

  let approvedUnitRate = 0;
  let roundingDifferencePerUnit = 0;
  let lineManualAdjustment = 0;

  const hasManual =
    manualSellingPrice !== null &&
    manualSellingPrice !== undefined &&
    manualSellingPrice > 0;

  if (hasManual) {
    const manual = Number(manualSellingPrice);
    approvedUnitRate = roundUpRate(manual);
    roundingDifferencePerUnit = roundTo(approvedUnitRate - manual, 4);
    lineManualAdjustment = roundTo(qty * (manual - rawUnitSellingPrice), 2);
  } else {
    approvedUnitRate = roundUpRate(rawUnitSellingPrice);
    roundingDifferencePerUnit = roundTo(approvedUnitRate - rawUnitSellingPrice, 4);
  }

  const lineDirectCost = roundTo(qty * directUnitCost, 2);
  const lineAdditions = roundTo(qty * totalAdditions, 2);
  const lineRoundingDifference = roundTo(qty * roundingDifferencePerUnit, 2);
  const lineSellingPrice = roundTo(qty * approvedUnitRate, 2);

  return {
    directUnitCost,
    indirectVal,
    overheadVal,
    riskVal,
    profitVal,
    totalAdditions,
    rawUnitSellingPrice,
    approvedUnitRate,
    roundingDifferencePerUnit,
    quantity: qty,
    lineDirectCost,
    lineAdditions,
    lineRoundingDifference,
    lineManualAdjustment,
    lineSellingPrice,
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
  rawUnitSellingPrice?: number;
  roundingDifference?: number;
  effectiveMarkupPct: number;
} {
  if (directUnitCost <= 0) {
    return { loadedUnitCost: 0, unitSellingPrice: 0, rawUnitSellingPrice: 0, roundingDifference: 0, effectiveMarkupPct: 0 };
  }

  // If a simple direct factor is supplied (e.g. 1.10)
  if (markup?.custom_factor !== undefined && markup.custom_factor > 0) {
    const unitSellingPrice = roundTo(directUnitCost * markup.custom_factor, tenderDecimals);
    const effectiveMarkupPct = roundTo((markup.custom_factor - 1) * 100, 2);
    return { loadedUnitCost: directUnitCost, unitSellingPrice, rawUnitSellingPrice: unitSellingPrice, roundingDifference: 0, effectiveMarkupPct };
  }

  // Phase 2 additive contract if round_up_rate is explicitly requested or policy is additive_v2
  if (markup?.round_up_rate || markup?.pricing_policy === "additive_v2") {
    const p2 = computePricingPhase2({ directUnitCost, markups: markup });
    const effectiveMarkupPct = directUnitCost > 0 ? roundTo(((p2.approvedUnitRate - directUnitCost) / directUnitCost) * 100, 2) : 0;
    return {
      loadedUnitCost: p2.rawUnitSellingPrice,
      rawUnitSellingPrice: p2.rawUnitSellingPrice,
      unitSellingPrice: p2.approvedUnitRate,
      roundingDifference: p2.roundingDifferencePerUnit,
      effectiveMarkupPct,
    };
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
    rawUnitSellingPrice: roundedSellingPrice,
    roundingDifference: 0,
    effectiveMarkupPct,
  };
}

export type CanonicalPricingSource = "included" | "manual" | "analysis" | "imported" | "unpriced";

export interface BoqItemPricingInput {
  id: string;
  quantity?: number | null;
  is_group?: boolean;
  is_included_elsewhere?: boolean | null;
  manual_unit_price?: number | null;
  rate_source?: string | null;
  material_cost?: number | null;
  labor_cost?: number | null;
  equipment_cost?: number | null;
  subcontractor_cost?: number | null;
}

export interface CanonicalBoqItemPricing {
  source: CanonicalPricingSource;
  directUnitCost: number;
  rawUnitSellingPrice: number;
  approvedUnitRate: number;
  roundingDifferencePerUnit: number;
  lineDirectCost: number;
  lineAdditions: number;
  lineRoundingDifference: number;
  lineManualAdjustment: number;
  lineSellingPrice: number;
  isUnpriced: boolean;
}

/**
 * Single canonical source-of-truth pricing resolver used identically across BOQ UI,
 * original Excel writeback, standard Excel/CSV export, Financial Review, Reports, and Tender Submission.
 *
 * Priority order:
 * 1. Group parent -> 0
 * 2. Included elsewhere -> 0 ("included")
 * 3. Active manual unit price > 0 -> rounded UP via Phase 2 ROUNDUP contract ("manual")
 * 4. Analysis lines (or rate_source === 'analysis' -> 0 if last line deleted) -> Phase 2 pricing ("analysis" / "unpriced")
 * 5. Stored / imported unit cost fallback -> Phase 2 pricing ("imported" / "unpriced")
 */
export function resolveBoqItemPricing(params: {
  item: BoqItemPricingInput;
  paLines?: ResourceCostInput[];
  hasAnalysisFlag?: boolean;
  markup?: MarkupSettings;
  defaultMarkup?: MarkupSettings;
}): CanonicalBoqItemPricing {
  const { item, paLines, hasAnalysisFlag = false, markup, defaultMarkup } = params;
  const qty = Number(item.quantity ?? 0) || 0;

  if (item.is_group) {
    return {
      source: "unpriced",
      directUnitCost: 0,
      rawUnitSellingPrice: 0,
      approvedUnitRate: 0,
      roundingDifferencePerUnit: 0,
      lineDirectCost: 0,
      lineAdditions: 0,
      lineRoundingDifference: 0,
      lineManualAdjustment: 0,
      lineSellingPrice: 0,
      isUnpriced: false,
    };
  }

  if (item.is_included_elsewhere) {
    return {
      source: "included",
      directUnitCost: 0,
      rawUnitSellingPrice: 0,
      approvedUnitRate: 0,
      roundingDifferencePerUnit: 0,
      lineDirectCost: 0,
      lineAdditions: 0,
      lineRoundingDifference: 0,
      lineManualAdjustment: 0,
      lineSellingPrice: 0,
      isUnpriced: false,
    };
  }

  const hasPaLines = Boolean(paLines && paLines.length > 0);
  const isAnalysisMode = item.rate_source === "analysis" || hasAnalysisFlag || hasPaLines;
  const directUnitCost = hasPaLines
    ? computeDirectUnitCost(paLines!).directUnitCost
    : isAnalysisMode
      ? 0
      : roundTo(
          Number(item.material_cost ?? 0) +
            Number(item.labor_cost ?? 0) +
            Number(item.equipment_cost ?? 0) +
            Number(item.subcontractor_cost ?? 0),
          4,
        );

  const effectiveMarkup: MarkupSettings = {
    ...(defaultMarkup ?? {}),
    ...(markup ?? {}),
    pricing_policy: markup?.pricing_policy ?? defaultMarkup?.pricing_policy ?? "additive_v2",
    round_up_rate: markup?.round_up_rate ?? defaultMarkup?.round_up_rate ?? true,
  };

  const manualRaw = item.manual_unit_price ?? (markup as any)?.manual_unit_price ?? null;
  const hasManual = manualRaw !== null && manualRaw !== undefined && Number(manualRaw) > 0;

  if (hasManual) {
    const p2 = computePricingPhase2({
      directUnitCost,
      quantity: qty,
      markups: effectiveMarkup,
      manualSellingPrice: Number(manualRaw),
    });
    return {
      source: "manual",
      directUnitCost: p2.directUnitCost,
      rawUnitSellingPrice: p2.rawUnitSellingPrice,
      approvedUnitRate: p2.approvedUnitRate,
      roundingDifferencePerUnit: p2.roundingDifferencePerUnit,
      lineDirectCost: p2.lineDirectCost,
      lineAdditions: p2.lineAdditions,
      lineRoundingDifference: p2.lineRoundingDifference,
      lineManualAdjustment: p2.lineManualAdjustment,
      lineSellingPrice: p2.lineSellingPrice,
      isUnpriced: false,
    };
  }

  if (directUnitCost > 0) {
    const p2 = computePricingPhase2({
      directUnitCost,
      quantity: qty,
      markups: effectiveMarkup,
    });
    return {
      source: isAnalysisMode ? "analysis" : "imported",
      directUnitCost: p2.directUnitCost,
      rawUnitSellingPrice: p2.rawUnitSellingPrice,
      approvedUnitRate: p2.approvedUnitRate,
      roundingDifferencePerUnit: p2.roundingDifferencePerUnit,
      lineDirectCost: p2.lineDirectCost,
      lineAdditions: p2.lineAdditions,
      lineRoundingDifference: p2.lineRoundingDifference,
      lineManualAdjustment: p2.lineManualAdjustment,
      lineSellingPrice: p2.lineSellingPrice,
      isUnpriced: p2.approvedUnitRate <= 0,
    };
  }

  return {
    source: "unpriced",
    directUnitCost: 0,
    rawUnitSellingPrice: 0,
    approvedUnitRate: 0,
    roundingDifferencePerUnit: 0,
    lineDirectCost: 0,
    lineAdditions: 0,
    lineRoundingDifference: 0,
    lineManualAdjustment: 0,
    lineSellingPrice: 0,
    isUnpriced: true,
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
  primaryMaterialCost?: number;
  accessoryMaterialCost?: number;
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
      primaryMaterialCost: 0,
      accessoryMaterialCost: 0,
      laborCost: 0,
      equipmentCost: 0,
      subcontractorCost: 0,
      directUnitCost: 0,
      loadedUnitCost: 0,
      rawUnitSellingPrice: 0,
      unitSellingPrice: 0,
      roundingDiffPerUnit: 0,
      lineRoundingDiff: 0,
      lineAdditions: 0,
      lineManualAdjustment: 0,
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
      primaryMaterialCost: 0,
      accessoryMaterialCost: 0,
      laborCost: 0,
      equipmentCost: 0,
      subcontractorCost: 0,
      directUnitCost: 0,
      loadedUnitCost: 0,
      rawUnitSellingPrice: 0,
      unitSellingPrice: 0,
      roundingDiffPerUnit: 0,
      lineRoundingDiff: 0,
      lineAdditions: 0,
      lineManualAdjustment: 0,
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
  let rawUnitSellingPrice = directUnitCost;
  let loadedUnitCost = directUnitCost;
  let effectiveMarkupPct = 0;
  let roundingDiffPerUnit = 0;
  let lineAdditions = 0;
  let lineManualAdjustment = 0;

  if (params.markup?.round_up_rate || params.markup?.pricing_policy === "additive_v2") {
    const p2 = computePricingPhase2({
      directUnitCost,
      quantity,
      markups: params.markup,
      manualSellingPrice: isManualPrice ? manualUnitSellingPrice : null,
    });
    unitSellingPrice = p2.approvedUnitRate;
    rawUnitSellingPrice = p2.rawUnitSellingPrice;
    loadedUnitCost = p2.rawUnitSellingPrice;
    roundingDiffPerUnit = p2.roundingDifferencePerUnit;
    lineAdditions = p2.lineAdditions;
    lineManualAdjustment = p2.lineManualAdjustment;
    effectiveMarkupPct = directUnitCost > 0 ? roundTo(((unitSellingPrice - directUnitCost) / directUnitCost) * 100, 2) : 0;
  } else if (isManualPrice) {
    unitSellingPrice = roundTo(manualUnitSellingPrice!, tenderDecimals);
    rawUnitSellingPrice = unitSellingPrice;
    roundingDiffPerUnit = 0;
    lineManualAdjustment = roundTo(quantity * (unitSellingPrice - directUnitCost), currencyDecimals);
    effectiveMarkupPct =
      directUnitCost > 0
        ? roundTo(((unitSellingPrice - directUnitCost) / directUnitCost) * 100, 2)
        : 0;
  } else {
    const calc = computeUnitSellingPrice(directUnitCost, params.markup, tenderDecimals);
    unitSellingPrice = calc.unitSellingPrice;
    rawUnitSellingPrice = calc.rawUnitSellingPrice ?? unitSellingPrice;
    loadedUnitCost = calc.loadedUnitCost;
    roundingDiffPerUnit = calc.roundingDifference ?? 0;
    effectiveMarkupPct = calc.effectiveMarkupPct;
    lineAdditions = roundTo(quantity * (rawUnitSellingPrice - directUnitCost), currencyDecimals);
  }

  const isUnpriced = directUnitCost <= 0 && unitSellingPrice <= 0;
  const lineDirectCost = roundTo(quantity * directUnitCost, currencyDecimals);
  const lineSellingPrice = roundTo(quantity * unitSellingPrice, currencyDecimals);
  const lineRoundingDiff = roundTo(quantity * roundingDiffPerUnit, currencyDecimals);

  return {
    materialCost: params.materialCost ?? 0,
    primaryMaterialCost: params.primaryMaterialCost ?? params.materialCost ?? 0,
    accessoryMaterialCost: params.accessoryMaterialCost ?? 0,
    laborCost: params.laborCost ?? 0,
    equipmentCost: params.equipmentCost ?? 0,
    subcontractorCost: params.subcontractorCost ?? 0,
    directUnitCost: roundTo(directUnitCost, tenderDecimals),
    loadedUnitCost: roundTo(loadedUnitCost, tenderDecimals),
    rawUnitSellingPrice: roundTo(rawUnitSellingPrice, tenderDecimals),
    unitSellingPrice: roundTo(unitSellingPrice, tenderDecimals),
    roundingDiffPerUnit: roundTo(roundingDiffPerUnit, 4),
    lineRoundingDiff,
    lineAdditions,
    lineManualAdjustment,
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
  paItemsByItemId?: Map<string, ResourceCostInput[]>;
  markupsByItemId?: Map<string, MarkupSettings>;
  defaultMarkup?: MarkupSettings;
  vatRate?: number; // e.g. 15 for 15%
  tenderDecimals?: number;
  currencyDecimals?: number;
}): ProjectFinancialSummary {
  const {
    boqItems,
    paItemsByItemId,
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
  let totalAdditions = 0;
  let totalRoundingDifference = 0;
  let totalManualAdjustment = 0;
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
    const paList = paItemsByItemId?.get(item.id);
    const hasPa = Boolean(paList && paList.length > 0);
    const isAnalysisEmpty = (item as any).rate_source === "analysis" && !hasPa;
    const paDirect = hasPa ? computeDirectUnitCost(paList!) : null;

    const line = computeLineItemFinancials({
      quantity: qty,
      materialCost: paDirect ? paDirect.materialCost : isAnalysisEmpty ? 0 : Number(item.material_cost) || 0,
      ...(paDirect
        ? {
            primaryMaterialCost: paDirect.primaryMaterialCost,
            accessoryMaterialCost: paDirect.accessoryMaterialCost,
            directUnitCost: paDirect.directUnitCost,
          }
        : isAnalysisEmpty
          ? { directUnitCost: 0 }
          : {}),
      laborCost: paDirect ? paDirect.laborCost : isAnalysisEmpty ? 0 : Number(item.labor_cost) || 0,
      equipmentCost: paDirect ? paDirect.equipmentCost : isAnalysisEmpty ? 0 : Number(item.equipment_cost) || 0,
      subcontractorCost: paDirect ? paDirect.subcontractorCost : isAnalysisEmpty ? 0 : Number(item.subcontractor_cost) || 0,
      manualUnitSellingPrice: item.manual_unit_price ?? (markup as any)?.manual_unit_price,
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
        totalAdditions += roundTo(line.lineSellingPrice - line.lineDirectCost, currencyDecimals);
      } else {
        const directU = line.directUnitCost;
        if (markup?.pricing_policy === "additive_v2" || markup?.round_up_rate) {
          const indVal = (directU * Number(markup?.indirect_pct ?? 0)) / 100;
          const ovVal = (directU * Number(markup?.overhead_pct ?? 0)) / 100;
          const rskVal = (directU * Number(markup?.risk_pct ?? 0)) / 100;
          const prfVal = (directU * Number(markup?.profit_pct ?? 0)) / 100;

          indirectTotal += roundTo(qty * indVal, currencyDecimals);
          overheadTotal += roundTo(qty * ovVal, currencyDecimals);
          riskTotal += roundTo(qty * rskVal, currencyDecimals);
          profitTotal += roundTo(qty * prfVal, currencyDecimals);

          totalAdditions += roundTo(qty * (indVal + ovVal + rskVal + prfVal), currencyDecimals);
          totalRoundingDifference += line.lineRoundingDiff;
          totalManualAdjustment += line.lineManualAdjustment;
        } else {
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
          totalAdditions += roundTo(line.lineSellingPrice - line.lineDirectCost, currencyDecimals);
        }
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
  totalAdditions = roundTo(totalAdditions, currencyDecimals);
  totalRoundingDifference = roundTo(totalRoundingDifference, currencyDecimals);
  totalManualAdjustment = roundTo(totalManualAdjustment, currencyDecimals);
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
    totalAdditions,
    totalRoundingDifference,
    totalManualAdjustment,
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
