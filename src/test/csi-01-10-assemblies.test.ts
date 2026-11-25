import { describe, expect, it } from "vitest";
import {
  analyzeAssemblyScopes,
  buildLegacyTemplateDispositionLedger,
  computeConcreteElementQto,
  computeMultiTradeQto,
  computeProjectCoverageStats,
  convertQuoteToAnalysisLine,
  expandSubAssemblyAtDirectCost,
} from "@/lib/csi-assemblies-engine";
import {
  calculateBreakdownCost,
  getAllBreakdownTemplates,
} from "@/lib/breakdown-library";
import { computeDirectUnitCost, computePricingPhase2 } from "@/lib/estimation-calc";

describe("CSI 01–10 Assemblies, Concrete QTO, and Scope Audit (§1–§5)", () => {
  it("computes the §2 parametric concrete column (0.40x0.60x3.00m) with single waste and exact ratios", () => {
    const res = computeConcreteElementQto({
      family: "column",
      width_m: 0.4,
      length_or_depth_m: 0.6,
      height_or_thickness_m: 3.0,
      count: 1,
      concrete_waste_pct: 3,
      rebar_total_kg: 90,
      concrete_unit_price: 265,
      pump_unit_price: 28,
      pouring_crew_unit_price: 25,
      curing_unit_price: 12,
      formwork_unit_price: 68,
      rebar_unit_price: 3.15,
    });

    expect(res.total_volume_m3).toBe(0.72);
    expect(res.formwork_contact_m2).toBe(6);
    expect(res.formwork_m2_per_m3).toBe(8.3333);
    expect(res.gross_concrete_factor).toBe(1.03);
    expect(res.rebar_kg_per_m3).toBe(125);

    // Verify zero double waste: independent direct cost check
    const independentDirect =
      1 * 1.03 * 265 + // ready-mix + 3% waste once
      1 * 28 + // pump
      1 * 25 + // pour crew
      1 * 12 + // curing
      8.3333 * 68 + // formwork m²/m³
      125 * 3.15; // rebar kg/m³

    expect(res.directUnitCostPerM3).toBeCloseTo(independentDirect, 2);
  });

  it("reclassifies legacy tmpl-conc-c35 as composite reference with excluded rebar/formwork scopes and preserves all CSI 01-10 coverage", () => {
    const all = getAllBreakdownTemplates();
    const legacy = all.find((t) => t.id === "tmpl-conc-c35");
    expect(legacy).toBeDefined();
    expect(legacy?.legacy_id).toBe("tmpl-conc-c35");
    expect(legacy?.assembly_kind).toBe("reference_composite");
    expect(legacy?.excluded_scopes).toContain("rebar_supply_fix");
    expect(legacy?.excluded_scopes).toContain("formwork");

    // Ensure every CSI division 01 through 10 is covered in the catalog
    for (const div of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]) {
      const hasDiv = all.some((t) => t.division.includes(div) || t.code.startsWith(div));
      expect(hasDiv).toBe(true);
    }

    // Verify calculateBreakdownCost uses single waste for new CSI templates
    const col = all.find((t) => t.id === "csi-03-rc-columns");
    expect(col).toBeDefined();
    const calc = calculateBreakdownCost(col!);
    expect(calc.directUnitCost).toBeGreaterThan(1200);
    expect(calc.unitSellingPrice).toBeGreaterThanOrEqual(calc.rawSellingPrice);
  });

  it("detects overlapping all-in supply_pump_pour + separate pump, split-pour over-allocation, and excluded structural scopes", () => {
    const audit = analyzeAssemblyScopes(
      [
        {
          resource_type: "subcontractor",
          quantity: 1,
          unit_price: 290,
          scope_tag: "supply_pump_pour",
          supplier_quote_id: "sq-1",
          quote_item_id: "qi-1",
        },
        {
          resource_type: "equipment",
          quantity: 1,
          unit_price: 28,
          scope_tag: "pumping",
          supplier_quote_id: "sq-2",
          quote_item_id: "qi-2",
        },
        {
          resource_type: "material",
          quantity: 0.65,
          unit_price: 260,
          scope_tag: "concrete_supply",
          is_split_pour: true,
          allocated_qty: 65,
          supplier_quote_id: "sq-3",
        },
        {
          resource_type: "material",
          quantity: 0.55,
          unit_price: 265,
          scope_tag: "concrete_supply",
          is_split_pour: true,
          allocated_qty: 55,
          supplier_quote_id: "sq-4",
        },
      ],
      { boqQuantity: 100 },
    );

    expect(audit.hasErrors).toBe(true);
    const codes = audit.warnings.map((w) => w.code);
    expect(codes).toContain("OVERLAPPING_COMPOSITE_SCOPE");
    expect(codes).toContain("SPLIT_POUR_OVER_ALLOCATION");
    expect(codes).toContain("EXCLUDED_STRUCTURAL_SCOPE");
    expect(audit.excludedStructuralScopes).toEqual(["formwork", "rebar_supply_fix"]);
  });

  it("converts supplier quote units (ton->kg, m2->m3), spreads pump minimum charge, and guarantees single waste", () => {
    const rebarConv = convertQuoteToAnalysisLine({
      packagePrice: 2800,
      packageSize: 1,
      quoteUnit: "ton",
      consumptionUnit: "kg",
      consumptionRate: 125,
      wastePct: 4,
    });
    expect(rebarConv.unitConversionFactor).toBe(0.001);
    expect(rebarConv.convertedUnitPrice).toBe(2.8);
    expect(rebarConv.appliedWastePct).toBe(4);
    expect(rebarConv.directCostPerBoqUnit).toBeCloseTo(125 * 1.04 * 2.8, 4);

    // Same math when baked into quantity -> wastePct becomes 0 (never doubled)
    const rebarBaked = convertQuoteToAnalysisLine({
      packagePrice: 2800,
      packageSize: 1,
      quoteUnit: "ton",
      consumptionUnit: "kg",
      consumptionRate: 125,
      wastePct: 4,
      bakeWasteIntoQty: true,
    });
    expect(rebarBaked.appliedWastePct).toBe(0);
    expect(rebarBaked.directCostPerBoqUnit).toBeCloseTo(rebarConv.directCostPerBoqUnit, 4);

    // Pump minimum charge 1,500 SAR spread over 20 m³ vs 25 SAR/m³ base -> 75 SAR/m³ effective
    const pumpMin = convertQuoteToAnalysisLine({
      packagePrice: 25,
      packageSize: 1,
      quoteUnit: "m3",
      consumptionUnit: "m3",
      consumptionRate: 1,
      wastePct: 0,
      minOrderCharge: 1500,
      pourVolume: 20,
    });
    expect(pumpMin.effectiveUnitPriceWithMinCharge).toBe(75);
  });

  it("expands nested sub-assemblies at direct cost without compounding markups twice", () => {
    const subExpansion = expandSubAssemblyAtDirectCost([
      { resource_type: "material", quantity: 1, waste_pct: 3, unit_price: 200 },
      { resource_type: "labor", quantity: 1, unit_price: 50 },
    ]);
    // Direct = 206 + 50 = 256
    expect(subExpansion.directUnitCost).toBe(256);

    const parentDirect = computeDirectUnitCost(subExpansion.lines).directUnitCost;
    const p2 = computePricingPhase2({
      directUnitCost: parentDirect,
      quantity: 10,
      markups: { indirect_pct: 5, overhead_pct: 10, risk_pct: 2, profit_pct: 8, round_up_rate: true },
    });
    // Additive 25% markup applied ONCE on 256 = 320.00
    expect(p2.rawUnitSellingPrice).toBe(320);
    expect(p2.approvedUnitRate).toBe(320);
  });

  it("computes project coverage % by item count and SAR value across CSI 01–10", () => {
    const report = computeProjectCoverageStats([
      {
        id: "b1",
        item_no: "03-1",
        description_ar: "أعمدة خرسانية",
        quantity: 100,
        csi_division: "03",
        material_cost: 700,
        labor_cost: 100,
        equipment_cost: 50,
        subcontractor_cost: 550,
        selling_unit_rate: 1600,
        assembly_id: "csi-03-rc-columns",
      },
      {
        id: "b2",
        item_no: "09-1",
        description_ar: "بورسلان أرضيات",
        quantity: 200,
        csi_division: "09",
        pricing_status: "unpriced",
        material_cost: 0,
        labor_cost: 0,
        equipment_cost: 0,
        subcontractor_cost: 0,
        selling_unit_rate: 200, // potential BOQ allowance unanalyzed -> counts as gap
      },
    ]);

    expect(report.totalItems).toBe(2);
    expect(report.coveredItems).toBe(1);
    expect(report.gapItems).toBe(1);
    expect(report.countCoveragePct).toBe(50);
    // Covered = 100 * 1600 = 160,000; Gap = 200 * 200 = 40,000; Total = 200,000 -> 80% value covered
    expect(report.coveredValue).toBe(160000);
    expect(report.totalValue).toBe(200000);
    expect(report.valueCoveragePct).toBe(80);
  });

  it("covers all 11 concrete families (§2) and runs 50-template disposition ledger idempotently (§5 #1)", () => {
    const all = getAllBreakdownTemplates();
    const concreteCodes = [
      "03-30-01-LEAN",
      "03-30-11-FTG",
      "03-30-13-COL",
      "03-30-14-NECK",
      "03-30-15-WALL",
      "03-30-16-BEAM",
      "03-30-17-TIE",
      "03-30-20-SLAB",
      "03-30-22-FLAT",
      "03-30-24-HORDI",
      "03-38-00-PT",
      "03-30-28-STAIR",
      "03-21-00-REBAR",
      "03-11-00-FORM",
      "03-01-30-REPR",
    ];
    for (const code of concreteCodes) {
      expect(all.some((t) => t.code === code)).toBe(true);
    }

    // Hollow-block slab excludes voids volume (net ribs+topping 0.14 m³/m² rather than full 0.32m gross slab)
    const hordi = all.find((t) => t.code === "03-30-24-HORDI");
    const mixItem = hordi?.items.find((it) => it.scope_tag === "concrete_supply");
    expect(mixItem?.quantity).toBe(0.14);

    // 50-template legacy disposition ledger is deterministic across repeated runs
    const run1 = buildLegacyTemplateDispositionLedger(all);
    const run2 = buildLegacyTemplateDispositionLedger(all);
    expect(run1.totalAudited).toBe(50);
    expect(run2.totalAudited).toBe(50);
    expect(run1.signatureHash).toBe(run2.signatureHash);
    expect(run1.byDisposition.reference_composite).toBeGreaterThanOrEqual(1);
  });

  it("covers remaining CSI 11-33 divisions, multi-trade parametric QTO, and ranks high-impact gaps by SAR value", () => {
    const all = getAllBreakdownTemplates();
    for (const div of ["11", "12", "13", "14", "21", "22", "23", "25", "26", "27", "28", "31", "32", "33"]) {
      expect(all.some((t) => t.division.includes(div) || t.code.startsWith(div))).toBe(true);
    }

    // Multi-trade Masonry wall QTO: 10m x 3m = 30m2 - 2m2 opening = 28m2 net
    const wall = computeMultiTradeQto({
      kind: "masonry_wall",
      length_m: 10,
      width_or_thickness_m: 0.2,
      height_or_depth_m: 3.0,
      openings_deduction_m2: 2.0,
      waste_pct: 4,
    });
    expect(wall.primaryPayQty).toBe(28);
    expect(wall.secondaryMetricVal).toBe(350);

    // Earthwork bulking/swell factor 1.25 on 10x2x2 = 40 m3 bank -> 50 m3 loose
    const earth = computeMultiTradeQto({
      kind: "earthwork_trench_bulk",
      length_m: 10,
      width_or_thickness_m: 2,
      height_or_depth_m: 2,
      swell_factor: 1.25,
    });
    expect(earth.primaryPayQty).toBe(40);
    expect(earth.secondaryMetricVal).toBe(50);

    // High-impact gap ranking puts highest SAR gap first
    const rep = computeProjectCoverageStats([
      { id: "g1", item_no: "26-1", description_ar: "لوحة", quantity: 1, selling_unit_rate: 5000 },
      { id: "g2", item_no: "14-1", description_ar: "مصعد", quantity: 2, selling_unit_rate: 110000 },
    ]);
    expect(rep.highImpactGaps[0]?.boqItemId).toBe("g2");
    expect(rep.highImpactGaps[0]?.divisionCode).toBe("14");
  });
});
