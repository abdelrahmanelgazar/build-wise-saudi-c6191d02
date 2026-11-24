import { describe, it, expect } from "vitest";
import {
  computeDirectUnitCost,
  computeUnitSellingPrice,
  computeLineItemFinancials,
  computeProjectFinancials,
  parseArabicNumber,
  roundTo,
} from "../lib/estimation-calc";

describe("Estimation Calculation Engine - PLATFORM_DEVELOPMENT_AUDIT.md & EXCEL_BOQ_PRICING_PLAN.md Verification", () => {
  it("passes the mandatory financial acceptance test: 9,000 direct cost and 10,300 selling price", () => {
    // 50 units * cost 100 * factor 1.10 = 5,500 (direct 5,000)
    // 20 units * cost 200 * factor 1.20 = 4,800 (direct 4,000)
    const boqItems = [
      {
        id: "item-1",
        item_no: "01",
        description_ar: "بند اختباري ١",
        quantity: 50,
        is_group: false,
        material_cost: 100,
        labor_cost: 0,
        equipment_cost: 0,
        subcontractor_cost: 0,
      },
      {
        id: "item-2",
        item_no: "02",
        description_ar: "بند اختباري ٢",
        quantity: 20,
        is_group: false,
        material_cost: 200,
        labor_cost: 0,
        equipment_cost: 0,
        subcontractor_cost: 0,
      },
    ];

    const markupsByItemId = new Map([
      ["item-1", { custom_factor: 1.10 }],
      ["item-2", { custom_factor: 1.20 }],
    ]);

    const result = computeProjectFinancials({
      boqItems,
      markupsByItemId,
    });

    expect(result.totalDirectCost).toBe(9000);
    expect(result.netSellingPrice).toBe(10300);
    expect(result.totalMarkupAmount).toBe(1300);
    expect(result.canIssueTender).toBe(true);

    // Qty change test: change Item 1 qty to 51
    const boqItemsUpdated = [
      { ...boqItems[0]!, quantity: 51 },
      boqItems[1]!,
    ];

    const updatedResult = computeProjectFinancials({
      boqItems: boqItemsUpdated,
      markupsByItemId,
    });

    // 51 * 100 = 5,100 + 4,000 = 9,100 direct
    // 51 * 110 = 5,610 + 4,800 = 10,410 selling
    expect(updatedResult.totalDirectCost).toBe(9100);
    expect(updatedResult.netSellingPrice).toBe(10410);
  });

  it("verifies the 6,000 m3 acceptance test from EXCEL_BOQ_PRICING_PLAN (1,873,500.00 direct / 2,248,200.00 selling)", () => {
    // Quantity: 6,000, Direct Unit Cost: 312.25 -> Total Direct = 1,873,500.00
    // Markup 20% cost-plus, other loadings zero -> Unit Selling = 374.70, Total Selling = 2,248,200.00
    const boqItems = [
      {
        id: "item-conc-6000",
        item_no: "04-01-01",
        description_ar: "خرسانة مسلحة للمشروع 6,000 م3",
        quantity: 6000,
        is_group: false,
        material_cost: 312.25,
        labor_cost: 0,
        equipment_cost: 0,
        subcontractor_cost: 0,
      },
    ];

    const markupsByItemId = new Map([
      ["item-conc-6000", { profit_pct: 20, margin_mode: "markup" as const }],
    ]);

    const result = computeProjectFinancials({
      boqItems,
      markupsByItemId,
    });

    expect(result.totalDirectCost).toBe(1873500.00);
    expect(result.netSellingPrice).toBe(2248200.00);
    expect(result.totalMarkupAmount).toBe(374700.00);

    // Verify unit selling price
    const unitCalc = computeUnitSellingPrice(312.25, { profit_pct: 20, margin_mode: "markup" });
    expect(unitCalc.unitSellingPrice).toBe(374.70);
  });

  it("verifies independent multi-item cascaded loadings test (EXCEL_BOQ_PRICING_PLAN Section 7)", () => {
    // Item A: 50 * 100.00 | indirect 10% on direct, admin 5% after indirect, profit 20% on loaded cost -> 138.60 / 6,930.00
    // Item B: 20 * 200.00 | risk 5% on direct, margin 16% on selling price -> 250.00 / 5,000.00
    const boqItems = [
      {
        id: "item-A",
        item_no: "A-01",
        description_ar: "بند أ",
        quantity: 50,
        is_group: false,
        material_cost: 100.00,
        labor_cost: 0,
        equipment_cost: 0,
        subcontractor_cost: 0,
      },
      {
        id: "item-B",
        item_no: "B-01",
        description_ar: "بند ب",
        quantity: 20,
        is_group: false,
        material_cost: 200.00,
        labor_cost: 0,
        equipment_cost: 0,
        subcontractor_cost: 0,
      },
    ];

    const markupsByItemId = new Map([
      [
        "item-A",
        {
          indirect_pct: 10,
          overhead_pct: 5,
          risk_pct: 0,
          profit_pct: 20,
          margin_mode: "markup" as const,
        },
      ],
      [
        "item-B",
        {
          indirect_pct: 0,
          overhead_pct: 0,
          risk_pct: 5,
          profit_pct: 16,
          margin_mode: "margin" as const,
        },
      ],
    ]);

    const result = computeProjectFinancials({
      boqItems,
      markupsByItemId,
      vatRate: 15,
    });

    // Check line A unit price & line price
    const calcA = computeUnitSellingPrice(100.00, {
      indirect_pct: 10,
      overhead_pct: 5,
      profit_pct: 20,
      margin_mode: "markup",
    });
    expect(calcA.unitSellingPrice).toBe(138.60);

    // Check line B unit price & line price
    const calcB = computeUnitSellingPrice(200.00, {
      risk_pct: 5,
      profit_pct: 16,
      margin_mode: "margin",
    });
    expect(calcB.unitSellingPrice).toBe(250.00);

    // Check comprehensive breakdown totals
    expect(result.totalDirectCost).toBe(9000.00);
    expect(result.indirectTotal).toBe(500.00);
    expect(result.overheadTotal).toBe(275.00);
    expect(result.riskTotal).toBe(200.00);
    expect(result.profitTotal).toBe(1955.00);
    expect(result.netSellingPrice).toBe(11930.00);
    expect(result.vatAmount).toBe(1789.50);
    expect(result.grandTotalWithVat).toBe(13719.50);
  });

  it("verifies half-up rounding on unit price and line total (10.125 * 3 gives 10.13 unit and 30.39 total)", () => {
    const line = computeLineItemFinancials({
      quantity: 3,
      directUnitCost: 10.125,
      tenderDecimals: 2,
      currencyDecimals: 2,
    });
    expect(line.unitSellingPrice).toBe(10.13);
    expect(line.lineSellingPrice).toBe(30.39);
  });

  it("parses Arabic-Indic digits and formatted numbers correctly into float numbers", () => {
    expect(parseArabicNumber("١٬٢٥٠٫٥٠")).toBe(1250.50);
    expect(parseArabicNumber("٣٧٤٫٧٠")).toBe(374.70);
    expect(parseArabicNumber("1,250.50")).toBe(1250.50);
    expect(parseArabicNumber("0")).toBe(0);
    expect(parseArabicNumber("")).toBe(0);
    expect(parseArabicNumber(null)).toBe(0);
  });

  it("throws a clear error when margin of 100% or more is entered in margin mode", () => {
    expect(() => {
      computeUnitSellingPrice(100, { profit_pct: 100, margin_mode: "margin" });
    }).toThrow("هامش الربح كنسبة من سعر البيع يجب أن يكون أقل قطعيًا من 100%");
  });

  it("verifies markup mode vs margin on selling price correctly (100 cost: markup 20% gives 120, margin 20% gives 125)", () => {
    // 100 with 20% markup (profit_pct: 20) -> 120
    const markupResult = computeUnitSellingPrice(100, { profit_pct: 20, margin_mode: "markup" });
    expect(markupResult.unitSellingPrice).toBe(120);

    // 100 with 20% margin -> 100 / (1 - 0.20) = 125
    const marginResult = computeUnitSellingPrice(100, { profit_pct: 20, margin_mode: "margin" });
    expect(marginResult.unitSellingPrice).toBe(125);
  });

  it("verifies reinforced concrete foundation reference test (+30 SAR/m3 and +1,500 SAR for 50 m3)", () => {
    // 100 kg steel @ 3.00 SAR/kg
    const baseBreakdown = [
      { resource_type: "material" as const, quantity: 1.05, unit_price: 245.00 }, // Ready mix
      { resource_type: "material" as const, quantity: 100, unit_price: 3.00 }, // Steel 100 kg
      { resource_type: "equipment" as const, quantity: 1, unit_price: 25.00 }, // Pump
      { resource_type: "labor" as const, quantity: 1, unit_price: 30.00 }, // Crew
      { resource_type: "subcontractor" as const, quantity: 1, unit_price: 35.00 }, // Formwork
    ];

    const baseCost = computeDirectUnitCost(baseBreakdown);
    // 1.05*245 (257.25) + 300 + 25 + 30 + 35 = 647.25
    expect(baseCost.directUnitCost).toBe(647.25);

    // Increase steel to 110 kg
    const modifiedBreakdown = [
      baseBreakdown[0]!,
      { resource_type: "material" as const, quantity: 110, unit_price: 3.00 }, // Steel 110 kg (+10 kg)
      baseBreakdown[2]!,
      baseBreakdown[3]!,
      baseBreakdown[4]!,
    ];

    const modifiedCost = computeDirectUnitCost(modifiedBreakdown);
    expect(modifiedCost.directUnitCost).toBe(677.25);

    // Unit increase = 30.00 SAR/m3
    const unitDiff = roundTo(modifiedCost.directUnitCost - baseCost.directUnitCost, 2);
    expect(unitDiff).toBe(30.00);

    // For 50 m3 quantity = exactly 1,500 SAR increase
    const totalDiff = roundTo(unitDiff * 50, 2);
    expect(totalDiff).toBe(1500.00);
  });

  it("blocks tender issuance when any non-group item is unpriced", () => {
    const boqItems = [
      {
        id: "item-1",
        item_no: "01",
        description_ar: "بند مسعر",
        quantity: 10,
        is_group: false,
        material_cost: 50,
      },
      {
        id: "item-2",
        item_no: "02",
        description_ar: "بند ناقص السعر",
        quantity: 5,
        is_group: false,
        material_cost: 0,
        labor_cost: 0,
        equipment_cost: 0,
        subcontractor_cost: 0,
      },
    ];

    const result = computeProjectFinancials({ boqItems });
    expect(result.canIssueTender).toBe(false);
    expect(result.unpricedItemsCount).toBe(1);
    expect(result.missingPriceItems[0]?.item_no).toBe("02");
  });

  it("handles intentional zero cost when item is explicitly included elsewhere", () => {
    const boqItems = [
      {
        id: "item-1",
        item_no: "01",
        description_ar: "بند رئيسي",
        quantity: 10,
        is_group: false,
        material_cost: 100,
      },
      {
        id: "item-2",
        item_no: "02",
        description_ar: "بند مصنعية مشمولة في البند 01",
        quantity: 10,
        is_group: false,
        material_cost: 0,
        is_included_elsewhere: true,
      },
    ];

    const result = computeProjectFinancials({ boqItems });
    expect(result.canIssueTender).toBe(true);
    expect(result.unpricedItemsCount).toBe(0);
  });
});
