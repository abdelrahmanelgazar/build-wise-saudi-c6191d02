/**
 * CSI Divisions 01–10 Parametric QTO, Quote Conversion, Scope Audit, and Coverage Engine
 * Implements CSI_01_10_ASSEMBLIES_PLAN.md (§1, §2, §3, §4, §5).
 * Pure browser-safe engineering module delegating all final cost & markup math to estimation-calc.ts.
 */

import { computeDirectUnitCost, roundTo, type ResourceCostInput } from "./estimation-calc";
import { csiDivisionCode } from "./csi-divisions";

// ── 1. Scope Tags & Provenance Types ──────────────────────────────────────────

export type AssemblyScopeTag =
  | "concrete_supply"
  | "pumping"
  | "pouring_compaction"
  | "curing"
  | "supply_pump_pour"
  | "formwork"
  | "rebar_supply_fix"
  | "excavation_backfill"
  | "waterproofing"
  | "masonry"
  | "metals"
  | "carpentry"
  | "openings"
  | "finishes"
  | "specialties"
  | "equipment_conveying"
  | "mep_fire"
  | "mep_plumbing"
  | "mep_hvac"
  | "mep_electrical"
  | "low_current"
  | "infrastructure"
  | "general";

export type RateKind = "supply" | "install" | "composite" | "reference";
export type QuoteStatus = "quoted" | "reference" | "expired";

export interface ScopedAnalysisLine extends ResourceCostInput {
  id?: string;
  description_ar?: string;
  description_en?: string;
  unit?: string;
  scope_tag?: AssemblyScopeTag | string | null;
  rate_kind?: RateKind | string | null;
  quote_status?: QuoteStatus | string | null;
  supplier_quote_id?: string | null;
  quote_item_id?: string | null;
  is_split_pour?: boolean;
  allocated_qty?: number | null;
  cell_styles?: Record<string, unknown> | null;
}

export const SCOPE_LABELS_AR: Record<AssemblyScopeTag, string> = {
  concrete_supply: "توريد خرسانة جاهزة",
  pumping: "ضخ الخرسانة",
  pouring_compaction: "صب وهز ميكانيكي وتسوية",
  curing: "معالجة الخرسانة (Curing)",
  supply_pump_pour: "توريد + ضخ + صب شامل",
  formwork: "شدة خشبية / معدنية (نجارة مسلحة)",
  rebar_supply_fix: "حديد تسليح (توريد وتشكيل وتركيب)",
  excavation_backfill: "أعمال حفر وردم وإحلال",
  waterproofing: "عزل مائي وحراري وحماية",
  masonry: "مباني بلوك ومونة وأعتاب",
  metals: "أعمال معدنية وهياكل حديدية",
  carpentry: "نجارة معمارية وأخشاب",
  openings: "أبواب ونوافذ وزجاج وخردوات",
  finishes: "تشطيبات (لياسة / بلاط / دهانات / جبس)",
  specialties: "تخصصات (لوحات / فواصل / تجهيزات)",
  equipment_conveying: "معدات ومصاعد وأنظمة نقل",
  mep_fire: "أنظمة إخماد ومكافحة الحريق",
  mep_plumbing: "أعمال السباكة والصرف الصحي",
  mep_hvac: "التدفئة والتهوية والتكييف (HVAC)",
  mep_electrical: "الأعمال الكهربائية والقوى والتأريض",
  low_current: "التيار الخفيف وBMS والأمن",
  infrastructure: "أعمال البنية التحتية والموقع العام",
  general: "بنود عامة ومؤقتات موقع",
};

// ── 2. Parametric Structural Concrete QTO Engine (§2) ─────────────────────────

export type ConcreteElementFamily =
  | "lean_concrete"
  | "isolated_footing"
  | "raft_foundation"
  | "column"
  | "retaining_wall"
  | "beam"
  | "grade_beam"
  | "solid_slab"
  | "flat_slab"
  | "hollow_block_slab"
  | "stairs_and_misc";

export interface ConcreteQtoInput {
  family: ConcreteElementFamily;
  width_m: number;
  length_or_depth_m: number;
  height_or_thickness_m: number;
  count?: number;
  /** Optional explicit formwork contact area (m²) overriding geometric derivation */
  formwork_area_m2_override?: number;
  /** Explicit waste % on ready-mix purchase (default 3%) — applied strictly ONCE */
  concrete_waste_pct?: number;
  /** Either total rebar weight for the batch (kg) OR rebar ratio kg/m³ */
  rebar_total_kg?: number;
  rebar_kg_per_m3?: number;
  /** Scope inclusion toggles */
  include_concrete_supply?: boolean;
  include_pumping?: boolean;
  include_pouring_compaction?: boolean;
  include_curing?: boolean;
  include_formwork?: boolean;
  include_rebar?: boolean;
  /** Reference or quoted unit rates (SAR) */
  concrete_unit_price?: number;
  pump_unit_price?: number;
  pouring_crew_unit_price?: number;
  curing_unit_price?: number;
  formwork_unit_price?: number;
  rebar_unit_price?: number;
  rate_source_kind?: RateKind;
}

export interface ConcreteQtoResult {
  family: ConcreteElementFamily;
  count: number;
  unit_volume_m3: number;
  total_volume_m3: number;
  formwork_contact_m2: number;
  formwork_m2_per_m3: number;
  gross_concrete_factor: number;
  gross_concrete_m3: number;
  rebar_total_kg: number;
  rebar_kg_per_m3: number;
  included_scopes: AssemblyScopeTag[];
  excluded_scopes: AssemblyScopeTag[];
  lines: ScopedAnalysisLine[];
  directUnitCostPerM3: number;
  breakdownByResource: ReturnType<typeof computeDirectUnitCost>;
}

const DEFAULT_CONCRETE_RATES = {
  concrete: 265, // SAR/m³ ready-mix C35/C40 reference
  pump: 28, // SAR/m³ pump
  pouring: 25, // SAR/m³ crew + vibrator
  curing: 12, // SAR/m³ hessian + water/compound
  formwork: 68, // SAR/m² formwork contact
  rebar: 3.15, // SAR/kg rebar supply & fix (3,150 SAR/ton)
};

function deriveGeometricFormworkM2(input: ConcreteQtoInput): number {
  if (input.formwork_area_m2_override !== undefined && input.formwork_area_m2_override >= 0) {
    return input.formwork_area_m2_override;
  }
  const w = Math.max(0, input.width_m);
  const l = Math.max(0, input.length_or_depth_m);
  const h = Math.max(0, input.height_or_thickness_m);
  const n = Math.max(1, input.count ?? 1);

  switch (input.family) {
    case "lean_concrete":
      // Lean / plain blinding typically uses perimeter edge forms only or zero full formwork
      return roundTo(2 * (w + l) * Math.min(h, 0.25) * n, 4);
    case "isolated_footing":
    case "raft_foundation":
    case "column":
      // 4 vertical perimeter faces: 2 * (width + depth) * height
      return roundTo(2 * (w + l) * h * n, 4);
    case "retaining_wall":
      // Two primary faces along wall length
      return roundTo(2 * l * h * n, 4);
    case "beam":
    case "grade_beam":
      // Soffit + 2 sides for drop beams: (w + 2*h) * l (for grade_beam w=0 soffit on blinding -> 2*h*l)
      return roundTo((input.family === "grade_beam" ? 2 * h : w + 2 * h) * l * n, 4);
    case "solid_slab":
    case "flat_slab":
    case "hollow_block_slab":
    case "stairs_and_misc":
      // Soffit area + slab perimeter edges
      return roundTo((w * l + 2 * (w + l) * h) * n, 4);
  }
}

export function computeConcreteElementQto(input: ConcreteQtoInput): ConcreteQtoResult {
  const count = Math.max(1, input.count ?? 1);
  const unitVol = roundTo(
    Math.max(0, input.width_m) * Math.max(0, input.length_or_depth_m) * Math.max(0, input.height_or_thickness_m),
    6,
  );
  const totalVol = roundTo(unitVol * count, 6);
  const fwM2 = deriveGeometricFormworkM2(input);
  const fwPerM3 = totalVol > 0 ? roundTo(fwM2 / totalVol, 4) : 0;

  const wastePct = Math.max(0, input.concrete_waste_pct ?? 3);
  const grossFactor = roundTo(1 + wastePct / 100, 4);
  const grossVol = roundTo(totalVol * grossFactor, 4);

  let rebarTotal = 0;
  let rebarPerM3 = 0;
  if (input.rebar_total_kg !== undefined && input.rebar_total_kg >= 0) {
    rebarTotal = roundTo(input.rebar_total_kg, 4);
    rebarPerM3 = totalVol > 0 ? roundTo(rebarTotal / totalVol, 4) : 0;
  } else if (input.rebar_kg_per_m3 !== undefined && input.rebar_kg_per_m3 >= 0) {
    rebarPerM3 = roundTo(input.rebar_kg_per_m3, 4);
    rebarTotal = roundTo(rebarPerM3 * totalVol, 4);
  }

  const includeSupply = input.include_concrete_supply ?? true;
  const includePump = input.include_pumping ?? true;
  const includePour = input.include_pouring_compaction ?? true;
  const includeCuring = input.include_curing ?? true;
  const includeFormwork = input.include_formwork ?? (input.family !== "lean_concrete");
  const includeRebar = input.include_rebar ?? (input.family !== "lean_concrete" && rebarPerM3 > 0);

  const included_scopes: AssemblyScopeTag[] = [];
  const excluded_scopes: AssemblyScopeTag[] = [];
  const lines: ScopedAnalysisLine[] = [];
  const rateKind: RateKind = input.rate_source_kind ?? "reference";

  if (includeSupply) {
    included_scopes.push("concrete_supply");
    // SINGLE-WASTE RULE: quantity is net 1 m³, waste_pct carries the 3% purchase waste ONCE.
    lines.push({
      resource_type: "material",
      material_category: "primary",
      description_ar: `توريد خرسانة جاهزة (${input.family === "lean_concrete" ? "عادية" : "إنشائية"}) — صافي 1 م³ + هالك ${wastePct}%`,
      description_en: `Ready-mix concrete supply — net 1 m³ + ${wastePct}% waste`,
      unit: "م³",
      quantity: 1,
      waste_pct: wastePct,
      unit_price: input.concrete_unit_price ?? DEFAULT_CONCRETE_RATES.concrete,
      scope_tag: "concrete_supply",
      rate_kind: rateKind,
    });
  } else {
    excluded_scopes.push("concrete_supply");
  }

  if (includePump) {
    included_scopes.push("pumping");
    lines.push({
      resource_type: "equipment",
      description_ar: "ضخ الخرسانة (مضخة خرسانة متحركة)",
      description_en: "Concrete boom pump",
      unit: "م³",
      quantity: 1,
      waste_pct: 0,
      unit_price: input.pump_unit_price ?? DEFAULT_CONCRETE_RATES.pump,
      scope_tag: "pumping",
      rate_kind: rateKind,
    });
  } else {
    excluded_scopes.push("pumping");
  }

  if (includePour) {
    included_scopes.push("pouring_compaction");
    lines.push({
      resource_type: "labor",
      description_ar: "طاقم صب ودمك بالهزاز الميكانيكي وتسوية",
      description_en: "Concrete placing, vibration & finishing crew",
      unit: "م³",
      quantity: 1,
      waste_pct: 0,
      unit_price: input.pouring_crew_unit_price ?? DEFAULT_CONCRETE_RATES.pouring,
      scope_tag: "pouring_compaction",
      rate_kind: rateKind,
    });
  } else {
    excluded_scopes.push("pouring_compaction");
  }

  if (includeCuring) {
    included_scopes.push("curing");
    lines.push({
      resource_type: "material",
      material_category: "accessory",
      description_ar: "معالجة الخرسانة بالخيش والمياه / مادة عازلة للتبخر",
      description_en: "Concrete curing (water / hessian / curing compound)",
      unit: "م³",
      quantity: 1,
      waste_pct: 0,
      unit_price: input.curing_unit_price ?? DEFAULT_CONCRETE_RATES.curing,
      scope_tag: "curing",
      rate_kind: rateKind,
    });
  } else {
    excluded_scopes.push("curing");
  }

  if (includeFormwork) {
    included_scopes.push("formwork");
    lines.push({
      resource_type: "subcontractor",
      description_ar: `شدة خشبية / معدنية (${fwM2} م² على ${totalVol} م³ = ${fwPerM3} م²/م³)`,
      description_en: `Formwork contact ratio (${fwPerM3} m²/m³)`,
      unit: "م²",
      quantity: fwPerM3,
      waste_pct: 0,
      unit_price: input.formwork_unit_price ?? DEFAULT_CONCRETE_RATES.formwork,
      scope_tag: "formwork",
      rate_kind: rateKind,
    });
  } else if (input.family !== "lean_concrete") {
    excluded_scopes.push("formwork");
  }

  if (includeRebar && rebarPerM3 > 0) {
    included_scopes.push("rebar_supply_fix");
    lines.push({
      resource_type: "material",
      material_category: "primary",
      description_ar: `حديد تسليح مشكل ومركب (${rebarPerM3} كجم/م³)`,
      description_en: `Reinforcing steel supply & fix (${rebarPerM3} kg/m³)`,
      unit: "كجم",
      quantity: rebarPerM3,
      waste_pct: 0,
      unit_price: input.rebar_unit_price ?? DEFAULT_CONCRETE_RATES.rebar,
      scope_tag: "rebar_supply_fix",
      rate_kind: rateKind,
    });
  } else if (input.family !== "lean_concrete") {
    excluded_scopes.push("rebar_supply_fix");
  }

  const breakdownByResource = computeDirectUnitCost(lines);

  return {
    family: input.family,
    count,
    unit_volume_m3: unitVol,
    total_volume_m3: totalVol,
    formwork_contact_m2: fwM2,
    formwork_m2_per_m3: fwPerM3,
    gross_concrete_factor: grossFactor,
    gross_concrete_m3: grossVol,
    rebar_total_kg: rebarTotal,
    rebar_kg_per_m3: rebarPerM3,
    included_scopes,
    excluded_scopes,
    lines,
    directUnitCostPerM3: breakdownByResource.directUnitCost,
    breakdownByResource,
  };
}

// ── 3. Scope Conflict, Split-Pour Over-Allocation & Gap Detection (§4.3) ──────

export interface ScopeAuditWarning {
  code:
    | "OVERLAPPING_COMPOSITE_SCOPE"
    | "SPLIT_POUR_OVER_ALLOCATION"
    | "EXCLUDED_STRUCTURAL_SCOPE"
    | "EXPIRED_QUOTE_RATE"
    | "REFERENCE_RATE_ONLY";
  severity: "error" | "warning" | "info";
  message_ar: string;
  message_en: string;
  involved_scopes?: string[];
}

export interface ScopeAuditResult {
  hasErrors: boolean;
  hasWarnings: boolean;
  includedScopes: string[];
  excludedStructuralScopes: string[];
  warnings: ScopeAuditWarning[];
  quotedLinesCount: number;
  referenceLinesCount: number;
  expiredLinesCount: number;
}

export function analyzeAssemblyScopes(
  lines: ScopedAnalysisLine[],
  options?: { expectedStructuralUnit?: boolean; boqQuantity?: number },
): ScopeAuditResult {
  const warnings: ScopeAuditWarning[] = [];
  const presentScopes = new Set<string>();
  let quotedLinesCount = 0;
  let referenceLinesCount = 0;
  let expiredLinesCount = 0;

  // Track split-pour allocations grouped by scope_tag
  const splitAllocationsByScope = new Map<string, number>();

  for (const line of lines) {
    const scope =
      line.scope_tag ??
      ((line.cell_styles?.["scope_tag"] as string | undefined) || undefined);
    if (scope) {
      presentScopes.add(scope);
      if (line.is_split_pour && typeof line.allocated_qty === "number") {
        splitAllocationsByScope.set(
          scope,
          (splitAllocationsByScope.get(scope) ?? 0) + line.allocated_qty,
        );
      }
    }

    const status =
      line.quote_status ??
      ((line.cell_styles?.["quote_status"] as string | undefined) || undefined);
    const rateKind =
      line.rate_kind ??
      ((line.cell_styles?.["rate_kind"] as string | undefined) || undefined);

    if (status === "expired") {
      expiredLinesCount++;
    } else if (status === "reference" || rateKind === "reference" || !line.supplier_quote_id) {
      if (rateKind === "reference" || status === "reference") {
        referenceLinesCount++;
      }
    } else if (line.supplier_quote_id || line.quote_item_id) {
      quotedLinesCount++;
    }
  }

  // Rule A: Detect composite supply+pump+pour alongside standalone supply/pump/pour
  if (presentScopes.has("supply_pump_pour")) {
    const overlapping = (["concrete_supply", "pumping", "pouring_compaction"] as const).filter((s) =>
      presentScopes.has(s),
    );
    if (overlapping.length > 0) {
      warnings.push({
        code: "OVERLAPPING_COMPOSITE_SCOPE",
        severity: "error",
        message_ar: `ازدواج تسعير محتمل: يوجد بند شامل (توريد+ضخ+صب) مع بنود منفصلة لنفس النطاق (${overlapping.map((s) => SCOPE_LABELS_AR[s]).join("، ")}).`,
        message_en: `Double-counting risk: all-in supply_pump_pour combined with separate ${overlapping.join(", ")}.`,
        involved_scopes: ["supply_pump_pour", ...overlapping],
      });
    }
  }

  // Rule B: Split-pour allocation cannot exceed required BOQ quantity
  if (options?.boqQuantity && options.boqQuantity > 0) {
    for (const [scope, totalAllocated] of splitAllocationsByScope.entries()) {
      if (totalAllocated > options.boqQuantity + 1e-6) {
        warnings.push({
          code: "SPLIT_POUR_OVER_ALLOCATION",
          severity: "error",
          message_ar: `تجاوز كمية التوزيع الجزئي لنطاق (${SCOPE_LABELS_AR[scope as AssemblyScopeTag] ?? scope}): الموزع ${totalAllocated} أكبر من كمية المقايسة ${options.boqQuantity}.`,
          message_en: `Split-pour over-allocation for ${scope}: ${totalAllocated} exceeds BOQ qty ${options.boqQuantity}.`,
          involved_scopes: [scope],
        });
      }
    }
  }

  // Rule C: Concrete structural item missing rebar or formwork stays flagged as excluded scope
  const excludedStructuralScopes: string[] = [];
  const hasConcreteScope =
    presentScopes.has("concrete_supply") || presentScopes.has("supply_pump_pour");
  if ((options?.expectedStructuralUnit || hasConcreteScope) && lines.length > 0) {
    if (!presentScopes.has("formwork")) excludedStructuralScopes.push("formwork");
    if (!presentScopes.has("rebar_supply_fix")) excludedStructuralScopes.push("rebar_supply_fix");

    if (excludedStructuralScopes.length > 0) {
      warnings.push({
        code: "EXCLUDED_STRUCTURAL_SCOPE",
        severity: "warning",
        message_ar: `نطاقات مستبعدة من هذا التحليل وتُقيَّم في بنودها المستقلة: ${excludedStructuralScopes.map((s) => SCOPE_LABELS_AR[s as AssemblyScopeTag]).join("، ")}.`,
        message_en: `Excluded structural scopes (must be priced independently if required): ${excludedStructuralScopes.join(", ")}.`,
        involved_scopes: excludedStructuralScopes,
      });
    }
  }

  if (expiredLinesCount > 0) {
    warnings.push({
      code: "EXPIRED_QUOTE_RATE",
      severity: "warning",
      message_ar: `يحتوي التحليل على ${expiredLinesCount} بند/بنود من عروض أسعار منتهية الصلاحية.`,
      message_en: `Analysis contains ${expiredLinesCount} expired quote rate(s).`,
    });
  }

  if (referenceLinesCount > 0 && quotedLinesCount === 0) {
    warnings.push({
      code: "REFERENCE_RATE_ONLY",
      severity: "info",
      message_ar: `الأسعار الحالية مرجعية استرشادية فقط (${referenceLinesCount} بند) ولم تُربط بعرض مورد معتمد بعد.`,
      message_en: `Current analysis relies on ${referenceLinesCount} reference rate(s) without an approved supplier quote.`,
    });
  }

  return {
    hasErrors: warnings.some((w) => w.severity === "error"),
    hasWarnings: warnings.some((w) => w.severity === "warning"),
    includedScopes: Array.from(presentScopes),
    excludedStructuralScopes,
    warnings,
    quotedLinesCount,
    referenceLinesCount,
    expiredLinesCount,
  };
}

// ── 4. Quote Unit Conversion & Single-Waste Normalizer (§4.1 & §5) ────────────

export interface QuoteConversionInput {
  packagePrice: number;
  packageSize: number;
  consumptionRate: number;
  wastePct: number;
  /** Optional pricing basis: per unit OR full shift allocation divided by shift output */
  pricingBasis?: "unit" | "shift";
  shiftOutputQty?: number;
  shiftHours?: number;
  /** Optional unit conversion between quote unit and consumption unit */
  quoteUnit?: string;
  consumptionUnit?: string;
  /** e.g., slab thickness in meters for m² -> m³ conversion */
  thicknessMeters?: number;
  /** Equipment/pump minimum order charge allocated over pour volume */
  minOrderCharge?: number;
  minOrderQty?: number;
  pourVolume?: number;
  /** If true, returns baked gross qty with waste_pct = 0; otherwise returns net qty + waste_pct once */
  bakeWasteIntoQty?: boolean;
}

export interface QuoteConversionResult {
  unitConversionFactor: number;
  convertedUnitPrice: number;
  effectiveUnitPriceWithMinCharge: number;
  netConsumptionQty: number;
  appliedWastePct: number;
  grossEffectiveQty: number;
  directCostPerBoqUnit: number;
}

export function resolveUnitConversionFactor(
  quoteUnit?: string,
  consumptionUnit?: string,
  thicknessMeters?: number,
): number {
  const qU = (quoteUnit ?? "").trim().toLowerCase();
  const cU = (consumptionUnit ?? "").trim().toLowerCase();
  if (!qU || !cU || qU === cU) return 1;

  const isTon = (u: string) => u === "ton" || u === "t" || u === "طن";
  const isKg = (u: string) => u === "kg" || u === "كجم";
  const isM2 = (u: string) => u === "m2" || u === "m²" || u === "م²" || u === "م2";
  const isM3 = (u: string) => u === "m3" || u === "m³" || u === "م³" || u === "م3";

  // 1 ton purchase = 1000 kg -> SAR/kg = (SAR/ton) * 0.001
  if (isTon(qU) && isKg(cU)) return 0.001;
  // 1 kg purchase -> SAR/ton = (SAR/kg) * 1000
  if (isKg(qU) && isTon(cU)) return 1000;
  // m² pricing applied to m³ consumption given thickness in m: 1 m³ = 1/thickness m²
  if (isM2(qU) && isM3(cU) && thicknessMeters && thicknessMeters > 0) {
    return roundTo(1 / thicknessMeters, 6);
  }
  // m³ pricing applied to m² consumption given thickness in m: 1 m² = thickness m³
  if (isM3(qU) && isM2(cU) && thicknessMeters && thicknessMeters > 0) {
    return roundTo(thicknessMeters, 6);
  }
  return 1;
}

export function convertQuoteToAnalysisLine(input: QuoteConversionInput): QuoteConversionResult {
  const pkgSize = input.packageSize > 0 ? input.packageSize : 1;
  const baseUnitRate =
    input.pricingBasis === "shift" && input.shiftOutputQty && input.shiftOutputQty > 0
      ? input.packagePrice / input.shiftOutputQty
      : input.packagePrice / pkgSize;
  const unitConversionFactor = resolveUnitConversionFactor(
    input.quoteUnit,
    input.consumptionUnit,
    input.thicknessMeters,
  );
  const convertedUnitPrice = roundTo(baseUnitRate * unitConversionFactor, 4);

  // Allocate pump/equipment minimum order charge across pour volume if triggered
  let minChargeTopUp = 0;
  const pourVol = input.pourVolume ?? 0;
  if (pourVol > 0) {
    if ((input.minOrderCharge ?? 0) > 0) {
      const actualRevenue = pourVol * convertedUnitPrice;
      if (actualRevenue < (input.minOrderCharge ?? 0)) {
        minChargeTopUp = ((input.minOrderCharge ?? 0) - actualRevenue) / pourVol;
      }
    } else if ((input.minOrderQty ?? 0) > pourVol) {
      minChargeTopUp = (((input.minOrderQty ?? 0) - pourVol) * convertedUnitPrice) / pourVol;
    }
  }

  const effectiveUnitPriceWithMinCharge = roundTo(convertedUnitPrice + minChargeTopUp, 4);
  const netConsumptionQty = roundTo(Math.max(0, input.consumptionRate), 6);
  const safeWaste = Math.max(0, input.wastePct);
  const grossEffectiveQty = roundTo(netConsumptionQty * (1 + safeWaste / 100), 6);

  // SINGLE-WASTE GUARANTEE: either waste sits in waste_pct with net qty, or baked in qty with waste_pct = 0.
  const appliedWastePct = input.bakeWasteIntoQty ? 0 : safeWaste;
  const finalQtyForLine = input.bakeWasteIntoQty ? grossEffectiveQty : netConsumptionQty;

  const { directUnitCost } = computeDirectUnitCost([
    {
      resource_type: "material",
      quantity: finalQtyForLine,
      waste_pct: appliedWastePct,
      unit_price: effectiveUnitPriceWithMinCharge,
    },
  ]);

  return {
    unitConversionFactor,
    convertedUnitPrice,
    effectiveUnitPriceWithMinCharge,
    netConsumptionQty: finalQtyForLine,
    appliedWastePct,
    grossEffectiveQty,
    directCostPerBoqUnit: directUnitCost,
  };
}

// ── 5. Sub-Assembly Direct Cost Expansion (Zero Double-Markup Rule §4.4) ──────

export function expandSubAssemblyAtDirectCost(
  subItems: ScopedAnalysisLine[],
  multiplier = 1,
): { lines: ScopedAnalysisLine[]; directUnitCost: number } {
  const safeMult = multiplier > 0 ? multiplier : 1;
  const lines = subItems.map((item) => ({
    ...item,
    quantity: roundTo((Number(item.quantity) || 0) * safeMult, 6),
    cell_styles: {
      ...(item.cell_styles ?? {}),
      from_sub_assembly_direct_cost: true,
    },
  }));
  const { directUnitCost } = computeDirectUnitCost(lines);
  return { lines, directUnitCost };
}

// ── 6. CSI 01–10 Coverage & Gap Statistics (§3 & §4.5) ────────────────────────

export interface BoqCoverageCandidate {
  id: string;
  item_no?: string | null;
  description_ar: string;
  quantity?: number | null;
  is_group?: boolean;
  csi_division?: string | null;
  pricing_status?: string | null;
  rate_source?: string | null;
  material_cost?: number | null;
  labor_cost?: number | null;
  equipment_cost?: number | null;
  subcontractor_cost?: number | null;
  selling_unit_rate?: number | null;
  assembly_id?: string | null;
  quote_status?: QuoteStatus | null;
}

export interface CsiDivisionCoverageSummary {
  divisionCode: string;
  totalItems: number;
  coveredItems: number;
  gapItems: number;
  totalValue: number;
  coveredValue: number;
  countCoveragePct: number;
  valueCoveragePct: number;
}

export interface HighImpactGapEntry {
  boqItemId: string;
  itemNo: string;
  description_ar: string;
  divisionCode: string;
  quantity: number;
  estimatedValue: number;
}

export interface ProjectCoverageReport {
  totalItems: number;
  coveredItems: number;
  gapItems: number;
  unpricedItems: number;
  referenceOnlyItems: number;
  expiredItems: number;
  totalValue: number;
  coveredValue: number;
  countCoveragePct: number;
  valueCoveragePct: number;
  byDivision: CsiDivisionCoverageSummary[];
  gapItemIds: string[];
  highImpactGaps: HighImpactGapEntry[];
}

export function extractCsiDivisionPrefix(value?: string | null): string {
  if (!value) return "00";
  const resolved = csiDivisionCode(value);
  if (resolved) return resolved;
  const m = value.match(/\b(\d{2})\b/) ?? value.match(/^(\d{2})/);
  return m?.[1] ?? "00";
}

export function computeProjectCoverageStats(
  boqItems: BoqCoverageCandidate[],
  availableDivisionCodes?: Set<string>,
): ProjectCoverageReport {
  const leafItems = boqItems.filter((i) => !i.is_group);
  const divMap = new Map<string, CsiDivisionCoverageSummary>();

  let coveredItems = 0;
  let gapItems = 0;
  let unpricedItems = 0;
  let referenceOnlyItems = 0;
  let expiredItems = 0;
  let totalValue = 0;
  let coveredValue = 0;
  const gapItemIds: string[] = [];
  const highImpactGaps: HighImpactGapEntry[] = [];

  for (const item of leafItems) {
    const div = extractCsiDivisionPrefix(item.csi_division ?? item.item_no);
    const qty = Number(item.quantity ?? 0);
    const directSum =
      Number(item.material_cost ?? 0) +
      Number(item.labor_cost ?? 0) +
      Number(item.equipment_cost ?? 0) +
      Number(item.subcontractor_cost ?? 0);
    const unitVal = Number(item.selling_unit_rate ?? 0) > 0 ? Number(item.selling_unit_rate) : directSum;
    const itemValue = roundTo(qty * unitVal, 2);

    const hasAssemblyOrAnalysis = Boolean(item.assembly_id) || directSum > 0 || item.pricing_status === "included";
    const divisionHasTemplates = !availableDivisionCodes || availableDivisionCodes.has(div);
    const isCovered = hasAssemblyOrAnalysis && divisionHasTemplates;

    if (item.quote_status === "expired") expiredItems++;
    else if (item.quote_status === "reference" || item.rate_source === "manual") referenceOnlyItems++;
    if (!hasAssemblyOrAnalysis && item.pricing_status !== "priced") unpricedItems++;

    totalValue += itemValue;
    if (isCovered) {
      coveredItems++;
      coveredValue += itemValue;
    } else {
      gapItems++;
      gapItemIds.push(item.id);
      highImpactGaps.push({
        boqItemId: item.id,
        itemNo: item.item_no ?? "—",
        description_ar: item.description_ar,
        divisionCode: div,
        quantity: qty,
        estimatedValue: itemValue,
      });
    }

    const entry = divMap.get(div) ?? {
      divisionCode: div,
      totalItems: 0,
      coveredItems: 0,
      gapItems: 0,
      totalValue: 0,
      coveredValue: 0,
      countCoveragePct: 0,
      valueCoveragePct: 0,
    };
    entry.totalItems++;
    entry.totalValue = roundTo(entry.totalValue + itemValue, 2);
    if (isCovered) {
      entry.coveredItems++;
      entry.coveredValue = roundTo(entry.coveredValue + itemValue, 2);
    } else {
      entry.gapItems++;
    }
    divMap.set(div, entry);
  }

  for (const entry of divMap.values()) {
    entry.countCoveragePct =
      entry.totalItems > 0 ? roundTo((entry.coveredItems / entry.totalItems) * 100, 2) : 0;
    entry.valueCoveragePct =
      entry.totalValue > 0 ? roundTo((entry.coveredValue / entry.totalValue) * 100, 2) : 0;
  }

  highImpactGaps.sort((a, b) => b.estimatedValue - a.estimatedValue || b.quantity - a.quantity);

  const totalItems = leafItems.length;
  return {
    totalItems,
    coveredItems,
    gapItems,
    unpricedItems,
    referenceOnlyItems,
    expiredItems,
    totalValue: roundTo(totalValue, 2),
    coveredValue: roundTo(coveredValue, 2),
    countCoveragePct: totalItems > 0 ? roundTo((coveredItems / totalItems) * 100, 2) : 0,
    valueCoveragePct: totalValue > 0 ? roundTo((coveredValue / totalValue) * 100, 2) : 0,
    byDivision: Array.from(divMap.values()).sort((a, b) =>
      a.divisionCode.localeCompare(b.divisionCode),
    ),
    gapItemIds,
    highImpactGaps,
  };
}

// ── 8. Multi-Trade Parametric Breakdown QTO ("باقي الأعمال") ──────────────────

export type MultiTradeQtoKind =
  | "masonry_wall"
  | "earthwork_trench_bulk"
  | "waterproofing_area"
  | "mep_pipe_cable_run";

export interface MultiTradeQtoInput {
  kind: MultiTradeQtoKind;
  length_m: number;
  width_or_thickness_m: number;
  height_or_depth_m: number;
  openings_deduction_m2?: number;
  /** Upstand height for waterproofing parapet/skirting perimeter */
  upstand_height_m?: number;
  /** Swell/bulking factor for excavated soil haulage (e.g. 1.25) */
  swell_factor?: number;
  /** Single waste percentage */
  waste_pct?: number;
}

export interface MultiTradeQtoResult {
  kind: MultiTradeQtoKind;
  primaryPayQty: number;
  payUnit: string;
  secondaryMetricLabel: string;
  secondaryMetricVal: number;
  lines: ScopedAnalysisLine[];
  directUnitCost: number;
}

export function computeMultiTradeQto(input: MultiTradeQtoInput): MultiTradeQtoResult {
  const L = Math.max(0, input.length_m);
  const W = Math.max(0, input.width_or_thickness_m);
  const H = Math.max(0, input.height_or_depth_m);

  if (input.kind === "masonry_wall") {
    const grossArea = roundTo(L * H, 4);
    const netArea = roundTo(Math.max(0, grossArea - (input.openings_deduction_m2 ?? 0)), 4);
    const waste = Math.max(0, input.waste_pct ?? 4);
    const lines: ScopedAnalysisLine[] = [
      {
        resource_type: "material",
        material_category: "primary",
        description_ar: `بلوك أسمنتي (12.5 بلوكة/م² + هالك ${waste}%) — صافي ${netArea} م² بعد خصم الفتحات`,
        description_en: `CMU block (12.5 pcs/m² + ${waste}% waste)`,
        unit: "بلوكة",
        quantity: 12.5,
        waste_pct: waste,
        unit_price: 4.5,
        scope_tag: "masonry",
        rate_kind: "reference",
      },
      {
        resource_type: "material",
        material_category: "accessory",
        description_ar: "مونة أسمنت ورمل وشبك مباني وكانات أعمدة",
        description_en: "Mortar, bed mesh & column ties",
        unit: "م²",
        quantity: 1,
        unit_price: 12,
        scope_tag: "masonry",
        rate_kind: "reference",
      },
      {
        resource_type: "labor",
        description_ar: "مصنعية بناء ومعالجة",
        description_en: "Mason crew labor",
        unit: "م²",
        quantity: 1,
        unit_price: 26,
        scope_tag: "masonry",
        rate_kind: "reference",
      },
    ];
    return {
      kind: input.kind,
      primaryPayQty: netArea,
      payUnit: "م²",
      secondaryMetricLabel: "إجمالي عدد البلوكات التقديري (قبل الهالك)",
      secondaryMetricVal: roundTo(netArea * 12.5, 0),
      lines,
      directUnitCost: computeDirectUnitCost(lines).directUnitCost,
    };
  }

  if (input.kind === "earthwork_trench_bulk") {
    const bankVol = roundTo(L * W * H, 4);
    const swell = Math.max(1, input.swell_factor ?? 1.25);
    const looseVol = roundTo(bankVol * swell, 4);
    const lines: ScopedAnalysisLine[] = [
      {
        resource_type: "equipment",
        description_ar: `حفار + قلابات ترحيل بمعامل انتفاش ${swell} (${looseVol} م³ سائب لإجمالي ${bankVol} م³)`,
        description_en: `Excavator & dump haulage (swell factor ${swell})`,
        unit: "م³",
        quantity: swell,
        unit_price: 16,
        scope_tag: "excavation_backfill",
        rate_kind: "reference",
      },
      {
        resource_type: "labor",
        description_ar: "تسوية القاع وتحديد المناسيب المساحية",
        description_en: "Trimming & survey crew",
        unit: "م³",
        quantity: 1,
        unit_price: 6,
        scope_tag: "excavation_backfill",
        rate_kind: "reference",
      },
    ];
    return {
      kind: input.kind,
      primaryPayQty: bankVol,
      payUnit: "م³",
      secondaryMetricLabel: "الحجم السائب للترحيل (م³)",
      secondaryMetricVal: looseVol,
      lines,
      directUnitCost: computeDirectUnitCost(lines).directUnitCost,
    };
  }

  if (input.kind === "waterproofing_area") {
    const flatArea = roundTo(L * W, 4);
    const perim = roundTo(2 * (L + W), 4);
    const upstandArea = roundTo(perim * (input.upstand_height_m ?? 0.3), 4);
    const totalContact = roundTo(flatArea + upstandArea, 4);
    const upstandFactorPerM2 = flatArea > 0 ? roundTo(totalContact / flatArea, 4) : 1;
    const waste = Math.max(0, input.waste_pct ?? 10);
    const lines: ScopedAnalysisLine[] = [
      {
        resource_type: "material",
        material_category: "primary",
        description_ar: `لفائف عزل SBS 4 مم شاملة وزرة الارتفاع (${upstandFactorPerM2} م²/م² + هالك ركوب ${waste}%)`,
        description_en: `SBS membrane incl. upstand (${upstandFactorPerM2} m²/m² + ${waste}% lap)`,
        unit: "م²",
        quantity: upstandFactorPerM2,
        waste_pct: waste,
        unit_price: 38,
        scope_tag: "waterproofing",
        rate_kind: "reference",
      },
      {
        resource_type: "subcontractor",
        description_ar: "تجهيز وبرايمر ولحام واختبار غمر 48 ساعة",
        description_en: "Primer, torching & 48hr flood test",
        unit: "م²",
        quantity: upstandFactorPerM2,
        unit_price: 22,
        scope_tag: "waterproofing",
        rate_kind: "reference",
      },
    ];
    return {
      kind: input.kind,
      primaryPayQty: flatArea,
      payUnit: "م²",
      secondaryMetricLabel: "المساحة الفعلية شاملة الوزرات (م²)",
      secondaryMetricVal: totalContact,
      lines,
      directUnitCost: computeDirectUnitCost(lines).directUnitCost,
    };
  }

  // mep_pipe_cable_run
  const totalRun = roundTo(L + H, 4); // horizontal + vertical drops
  const waste = Math.max(0, input.waste_pct ?? 6);
  const lines: ScopedAnalysisLine[] = [
    {
      resource_type: "material",
      material_category: "primary",
      description_ar: `توريد ماسورة/كابل المسار (1 م.ط صافي + هالك وصلات وانحناءات ${waste}%)`,
      description_en: `Pipe/cable run supply (1 L.M. + ${waste}% termination/waste)`,
      unit: "م.ط",
      quantity: 1,
      waste_pct: waste,
      unit_price: 65,
      scope_tag: "mep_electrical",
      rate_kind: "reference",
    },
    {
      resource_type: "material",
      material_category: "accessory",
      description_ar: "حوامل تعليق (Hangers/Tray) كل 1.5م وتثبيت",
      description_en: "Supports & hangers allocation",
      unit: "م.ط",
      quantity: 1,
      unit_price: 18,
      scope_tag: "mep_electrical",
      rate_kind: "reference",
    },
    {
      resource_type: "labor",
      description_ar: "فني تمديد وتثبيت واختبار عزل/ضغط",
      description_en: "Installation & testing labor",
      unit: "م.ط",
      quantity: 1,
      unit_price: 28,
      scope_tag: "mep_electrical",
      rate_kind: "reference",
    },
  ];
  return {
    kind: input.kind,
    primaryPayQty: totalRun,
    payUnit: "م.ط",
    secondaryMetricLabel: "عدد حوامل التثبيت المقدرة (كل 1.5م)",
    secondaryMetricVal: Math.ceil(totalRun / 1.5),
    lines,
    directUnitCost: computeDirectUnitCost(lines).directUnitCost,
  };
}

// ── 9. Quote Revision Delta Impact & Deduction Line Extension (§6 / §8) ──────

export interface QuoteRevisionImpactLine {
  paItemId: string;
  boqItemId: string;
  description_ar: string;
  quantity: number;
  waste_pct: number;
  oldUnitPrice: number;
  newUnitPrice: number;
  lineDirectDelta: number;
}

export interface QuoteRevisionImpactSummary {
  affectedLinesCount: number;
  affectedBoqIds: string[];
  totalDirectUnitDelta: number;
  lines: QuoteRevisionImpactLine[];
}

export function computeQuoteRevisionImpact(
  linkedPaItems: Array<{
    id: string;
    boq_item_id: string;
    description_ar: string;
    resource_type: "material" | "labor" | "equipment" | "subcontractor";
    quantity: number;
    waste_pct?: number | null;
    unit_price: number;
  }>,
  newQuoteUnitPrice: number,
): QuoteRevisionImpactSummary {
  const affectedBoqSet = new Set<string>();
  const lines: QuoteRevisionImpactLine[] = [];
  let totalDirectUnitDelta = 0;

  for (const item of linkedPaItems) {
    const qty = Number(item.quantity) || 0;
    const waste = item.resource_type === "material" ? Number(item.waste_pct ?? 0) : 0;
    const oldRate = Number(item.unit_price) || 0;
    const effectiveQty = qty * (1 + waste / 100);
    const delta = roundTo(effectiveQty * (newQuoteUnitPrice - oldRate), 4);
    totalDirectUnitDelta = roundTo(totalDirectUnitDelta + delta, 4);
    affectedBoqSet.add(item.boq_item_id);
    lines.push({
      paItemId: item.id,
      boqItemId: item.boq_item_id,
      description_ar: item.description_ar,
      quantity: qty,
      waste_pct: waste,
      oldUnitPrice: oldRate,
      newUnitPrice: roundTo(newQuoteUnitPrice, 4),
      lineDirectDelta: delta,
    });
  }

  return {
    affectedLinesCount: lines.length,
    affectedBoqIds: Array.from(affectedBoqSet),
    totalDirectUnitDelta,
    lines,
  };
}

/** Handles signed deduction BOQ rows cleanly (preserves negative deduction totals when quantity < 0). */
export function computeSignedBoqExtension(quantity: number, approvedUnitRate: number): number {
  return roundTo((Number(quantity) || 0) * Math.abs(Number(approvedUnitRate) || 0), 2);
}

// ── 10. Division 01 Preliminaries vs Indirect Overhead Audit (§3 & §6) ───────

export interface PreliminariesOverlapAuditResult {
  hasOverlapWarning: boolean;
  explicitPreliminariesCount: number;
  explicitPreliminariesTotal: number;
  indirectMarkupAppliedOnOtherItems: number;
  message_ar: string | null;
}

export function auditPreliminariesOverlap(params: {
  boqItems: BoqCoverageCandidate[];
  markupsByBoqId?: Map<string, { indirect_pct?: number }>;
}): PreliminariesOverlapAuditResult {
  let explicitPreliminariesCount = 0;
  let explicitPreliminariesTotal = 0;
  let indirectMarkupAppliedOnOtherItems = 0;

  for (const item of params.boqItems) {
    if (item.is_group) continue;
    const div = extractCsiDivisionPrefix(item.csi_division ?? item.item_no);
    const directUnit =
      Number(item.material_cost ?? 0) +
      Number(item.labor_cost ?? 0) +
      Number(item.equipment_cost ?? 0) +
      Number(item.subcontractor_cost ?? 0);
    const qty = Number(item.quantity ?? 0);
    const rate = Number(item.selling_unit_rate ?? 0) > 0 ? Number(item.selling_unit_rate) : directUnit;

    if (div === "01" && item.pricing_status !== "included" && rate > 0) {
      explicitPreliminariesCount++;
      explicitPreliminariesTotal = roundTo(explicitPreliminariesTotal + qty * rate, 2);
    } else if (div !== "01") {
      const m = params.markupsByBoqId?.get(item.id);
      const indirectPct = Number(m?.indirect_pct ?? 0);
      if (indirectPct > 0 && directUnit > 0) {
        indirectMarkupAppliedOnOtherItems = roundTo(
          indirectMarkupAppliedOnOtherItems + qty * ((directUnit * indirectPct) / 100),
          2,
        );
      }
    }
  }

  const hasOverlapWarning = explicitPreliminariesTotal > 0 && indirectMarkupAppliedOnOtherItems > 0;
  const message_ar = hasOverlapWarning
    ? `تنبيه ازدواج التمهيديات: يحتوي جدول الكميات على (${explicitPreliminariesCount}) بند متطلبات عامة صريح بالقسم 01 بقيمة ${explicitPreliminariesTotal.toLocaleString("en-US")} ر.س، مع تحميل نسبة تكاليف غير مباشرة (${indirectMarkupAppliedOnOtherItems.toLocaleString("en-US")} ر.س) على باقي البنود. راجع عدم تكرار مصروفات الموقع.`
    : null;

  return {
    hasOverlapWarning,
    explicitPreliminariesCount,
    explicitPreliminariesTotal,
    indirectMarkupAppliedOnOtherItems,
    message_ar,
  };
}

// ── 7. 50-Template Legacy Inventory & Idempotent Migration Ledger (§5 #1) ──────

export type LegacyTemplateDisposition =
  | "keep_executable"
  | "split_by_scope"
  | "reference_composite"
  | "purchase_package_only";

export interface LegacyTemplateLedgerEntry {
  legacyId: string;
  code: string;
  title_ar: string;
  division: string;
  disposition: LegacyTemplateDisposition;
  replacementCode: string;
  rationale_ar: string;
}

export interface LegacyMigrationPreviewResult {
  totalAudited: number;
  byDisposition: Record<LegacyTemplateDisposition, number>;
  entries: LegacyTemplateLedgerEntry[];
  signatureHash: string;
}

export function buildLegacyTemplateDispositionLedger(
  templates: Array<{
    id: string;
    legacy_id?: string | undefined;
    code: string;
    title_ar: string;
    division: string;
    assembly_kind?: "executable" | "reference_composite" | undefined;
    is_custom?: boolean | undefined;
    items: Array<{ resource_type: string; description_ar: string }>;
  }>,
): LegacyMigrationPreviewResult {
  const entries: LegacyTemplateLedgerEntry[] = [];
  const byDisposition: Record<LegacyTemplateDisposition, number> = {
    keep_executable: 0,
    split_by_scope: 0,
    reference_composite: 0,
    purchase_package_only: 0,
  };

  // Deduplicate deterministically by stable legacy id so running migration twice stays idempotent
  const seenIds = new Set<string>();
  const sorted = [...templates]
    .filter((t) => !t.id.startsWith("csi-") && !t.id.startsWith("v2-"))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const t of sorted) {
    const stableId = t.legacy_id ?? t.id;
    if (seenIds.has(stableId)) continue;
    seenIds.add(stableId);

    let disposition: LegacyTemplateDisposition = "keep_executable";
    let replacementCode = t.code;
    let rationale_ar = "قالب تنفيذي متوازن الموارد — جاهز للاستخدام المباشر مع تحديث الأسعار.";

    if (stableId === "tmpl-conc-c35" || t.assembly_kind === "reference_composite") {
      disposition = "reference_composite";
      replacementCode = "03-30-13-COL / 03-30-20-SLAB";
      rationale_ar = "يجمع التوريد والضخ والصب بدون حديد أو شدة؛ يُحفظ كمرجع مركّب ويُستبدل بقوالب القسم 03.";
    } else if (stableId === "tmpl-rc-foundations" || (t.division.includes("03") && t.items.length >= 4)) {
      disposition = "split_by_scope";
      replacementCode = "03-30-11-FTG / 03-21-00-REBAR / 03-11-00-FORM";
      rationale_ar = "يُتاح كعمل متكامل أو يُفكك عند فصل الشدة والحديد في جدول الكميات.";
    } else if (t.items.length === 1 && t.items[0]?.resource_type === "material") {
      disposition = "purchase_package_only";
      replacementCode = `${t.code}-PKG`;
      rationale_ar = "يمثل حزمة شراء مادة مفردة ويُربط بعرض مورد أو استهلاك مباشر.";
    } else if (t.division.includes("01") && t.title_ar.includes("إيجار")) {
      disposition = "split_by_scope";
      replacementCode = "01-50-00-MOB + 01-45-00-QA";
      rationale_ar = "فصل كلفة التأسيس المقطوعة عن التشغيل الشهري بالمدة.";
    }

    byDisposition[disposition]++;
    entries.push({
      legacyId: stableId,
      code: t.code,
      title_ar: t.title_ar,
      division: t.division,
      disposition,
      replacementCode,
      rationale_ar,
    });
  }

  const signatureHash = entries
    .map((e) => `${e.legacyId}:${e.disposition}:${e.replacementCode}`)
    .join("|");

  return {
    totalAudited: entries.length,
    byDisposition,
    entries,
    signatureHash,
  };
}

// ── 8. Normalized Supplier Quote Scope Comparison (§G3) ───────────────────────

export interface NormalizedQuoteCandidate {
  id: string;
  supplierName: string;
  unitRateSar: number;
  status: "quoted" | "reference" | "expired";
  includedScopes: AssemblyScopeTag[];
  /** Extra pump / install rate per unit needed when quote excludes pumping/install */
  supplementalUnitRateSar?: number;
  /** Minimum mobilization or pump charge spread across workQuantity */
  minOrderChargeSar?: number;
  validityDate?: string | null;
  city?: string | null;
  documentRef?: string | null;
}

export interface NormalizedQuoteComparisonRow {
  id: string;
  supplierName: string;
  rawUnitRateSar: number;
  normalizedUnitRateSar: number;
  normalizedTotalSar: number;
  isEquivalentScope: boolean;
  missingScopesAdded: AssemblyScopeTag[];
  status: "quoted" | "reference" | "expired";
  rank: number;
}

/**
 * Normalizes supplier quotes with differing commercial scopes (e.g. C35 all-in supply+pump+pour vs
 * supply-only + separate pump minimum charge) onto the same target scope for fair bid comparison.
 */
export function compareSupplierQuotesNormalized(params: {
  targetScopes: AssemblyScopeTag[];
  workQuantity: number;
  quotes: NormalizedQuoteCandidate[];
}): NormalizedQuoteComparisonRow[] {
  const qty = Math.max(0.0001, Number(params.workQuantity) || 1);
  const rows: NormalizedQuoteComparisonRow[] = params.quotes.map((q) => {
    const missing = params.targetScopes.filter((s) => !q.includedScopes.includes(s));
    const amortizedMinCharge = roundTo((q.minOrderChargeSar ?? 0) / qty, 4);
    const supplement = missing.length > 0 ? Number(q.supplementalUnitRateSar ?? 0) : 0;
    const normalizedUnitRateSar = roundTo(q.unitRateSar + supplement + amortizedMinCharge, 2);
    const normalizedTotalSar = roundTo(normalizedUnitRateSar * qty, 2);
    return {
      id: q.id,
      supplierName: q.supplierName,
      rawUnitRateSar: q.unitRateSar,
      normalizedUnitRateSar,
      normalizedTotalSar,
      isEquivalentScope: missing.length === 0,
      missingScopesAdded: missing,
      status: q.status,
      rank: 0,
    };
  });

  rows.sort((a, b) => a.normalizedUnitRateSar - b.normalizedUnitRateSar);
  rows.forEach((r, idx) => {
    r.rank = idx + 1;
  });
  return rows;
}

export interface ValueAndValidityBreakdown {
  totalValueSar: number;
  validQuotedValueSar: number;
  expiredQuotedValueSar: number;
  referenceOnlyValueSar: number;
  manualValueSar: number;
  includedValueSar: number;
  unpricedValueSar: number;
  validCommercialCoveragePct: number;
}

/** Measures project BOQ coverage by SAR value and quote commercial validity status (§G3). */
export function computeValueAndValidityCoverage(
  items: Array<{
    is_group?: boolean;
    pricing_status?: string | null;
    rate_source?: string | null;
    quote_status?: "quoted" | "reference" | "expired" | null;
    lineSellingPrice: number;
  }>,
): ValueAndValidityBreakdown {
  let totalValueSar = 0;
  let validQuotedValueSar = 0;
  let expiredQuotedValueSar = 0;
  let referenceOnlyValueSar = 0;
  let manualValueSar = 0;
  let includedValueSar = 0;
  let unpricedValueSar = 0;

  for (const it of items) {
    if (it.is_group) continue;
    const val = roundTo(Math.max(0, Number(it.lineSellingPrice) || 0), 2);
    totalValueSar += val;

    if (it.pricing_status === "included") {
      includedValueSar += val;
    } else if (val <= 0 || it.pricing_status === "unpriced") {
      unpricedValueSar += val;
    } else if (it.rate_source === "manual") {
      manualValueSar += val;
    } else if (it.quote_status === "expired") {
      expiredQuotedValueSar += val;
    } else if (it.quote_status === "quoted") {
      validQuotedValueSar += val;
    } else {
      referenceOnlyValueSar += val;
    }
  }

  totalValueSar = roundTo(totalValueSar, 2);
  const validCommercialCoveragePct =
    totalValueSar > 0 ? roundTo((validQuotedValueSar / totalValueSar) * 100, 2) : 0;

  return {
    totalValueSar,
    validQuotedValueSar: roundTo(validQuotedValueSar, 2),
    expiredQuotedValueSar: roundTo(expiredQuotedValueSar, 2),
    referenceOnlyValueSar: roundTo(referenceOnlyValueSar, 2),
    manualValueSar: roundTo(manualValueSar, 2),
    includedValueSar: roundTo(includedValueSar, 2),
    unpricedValueSar: roundTo(unpricedValueSar, 2),
    validCommercialCoveragePct,
  };
}
