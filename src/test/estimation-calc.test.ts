import { describe, it, expect } from "vitest";
import {
  computeDirectUnitCost,
  computeUnitSellingPrice,
  computeLineItemFinancials,
  computeProjectFinancials,
  roundTo,
} from "../lib/estimation-calc";

describe("Estimation Calculation Engine - PLATFORM_DEVELOPMENT_AUDIT.md Verification", () => {
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
      { ...boqItems[0], quantity: 51 },
      boqItems[1],
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
      baseBreakdown[0],
      { resource_type: "material" as const, quantity: 110, unit_price: 3.00 }, // Steel 110 kg (+10 kg)
      baseBreakdown[2],
      baseBreakdown[3],
      baseBreakdown[4],
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
    expect(result.missingPriceItems[0].item_no).toBe("02");
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
