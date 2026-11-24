import { describe, it, expect } from "vitest";
import {
  computePricingPhase2,
  computeDirectUnitCost,
  computeUnitSellingPrice,
  computeLineItemFinancials,
  computeProjectFinancials,
  roundUpRate,
  roundCurrency,
  type PriceAnalysisItemRow,
  type MarkupSettings,
} from "@/lib/estimation-calc";
import { calculateBreakdownCost, type BreakdownTemplate } from "@/lib/breakdown-library";

describe("Tender Pricing Phase 2 Acceptance Tests (Plan §7 & TC-001 - TC-024)", () => {
  describe("TC-001: Baseline 647.25 with Four 1% Markups", () => {
    const directUnitCost = 647.25;
    const markup: MarkupSettings = {
      indirect_pct: 1,
      overhead_pct: 1,
      risk_pct: 1,
      profit_pct: 1,
      pricing_policy: "additive_v2",
      round_up_rate: true,
    };

    it("calculates additions, raw unit price, and integer approved unit rate", () => {
      const result = computePricingPhase2(directUnitCost, markup, 100);

      // Direct cost: 647.25
      expect(result.directUnitCost).toBe(647.25);

      // 4 markups at 1% of 647.25 = 6.4725 each
      expect(result.indirectVal).toBeCloseTo(6.4725, 4);
      expect(result.overheadVal).toBeCloseTo(6.4725, 4);
      expect(result.riskVal).toBeCloseTo(6.4725, 4);
      expect(result.profitVal).toBeCloseTo(6.4725, 4);

      // Total additions = 25.89
      expect(result.totalAdditions).toBe(25.89);

      // Raw selling unit price = 673.14
      expect(result.rawUnitSellingPrice).toBe(673.14);

      // Approved rate via ROUNDUP(673.14, 0) = 674
      expect(result.approvedUnitRate).toBe(674);

      // Rounding difference per unit = 674 - 673.14 = 0.86
      expect(result.roundingDifferencePerUnit).toBe(0.86);

      // For quantity 100:
      // Line direct = 64,725
      expect(result.lineDirectCost).toBe(64725);
      // Line additions = 2,589
      expect(result.lineAdditions).toBe(2589);
      // Line rounding difference = 86
      expect(result.lineRoundingDifference).toBe(86);
      // Line selling price = 67,400
      expect(result.lineSellingPrice).toBe(67400);

      // Financial reconciliation equation:
      // direct + additions + roundingDiff + manualAdjustment === sellingPrice
      expect(
        roundCurrency(
          result.lineDirectCost +
            result.lineAdditions +
            result.lineRoundingDifference +
            result.lineManualAdjustment
        )
      ).toBe(result.lineSellingPrice);
    });
  });

  describe("TC-002: Additive Symmetry and Markup Ordering", () => {
    it("produces identical raw selling price and approved rate regardless of markup order", () => {
      const directUnit = 647.25;
      const markupA: MarkupSettings = {
        indirect_pct: 2,
        overhead_pct: 3,
        risk_pct: 1.5,
        profit_pct: 5,
        pricing_policy: "additive_v2",
        round_up_rate: true,
      };
      const markupB: MarkupSettings = {
        indirect_pct: 5,
        overhead_pct: 1.5,
        risk_pct: 3,
        profit_pct: 2,
        pricing_policy: "additive_v2",
        round_up_rate: true,
      };

      const resA = computePricingPhase2(directUnit, markupA);
      const resB = computePricingPhase2(directUnit, markupB);

      expect(resA.totalAdditions).toBe(resB.totalAdditions);
      expect(resA.rawUnitSellingPrice).toBe(resB.rawUnitSellingPrice);
      expect(resA.approvedUnitRate).toBe(resB.approvedUnitRate);
    });
  });

  describe("TC-003: Rounding Boundaries and Fractional Quantity", () => {
    it("rounds unit selling rates up to next integer according to §7", () => {
      expect(roundUpRate(6.25)).toBe(7);
      expect(roundUpRate(6.0001)).toBe(7);
      expect(roundUpRate(7.0)).toBe(7);
      expect(roundUpRate(0)).toBe(0);
      expect(roundUpRate(-0.1)).toBe(0);
    });

    it("handles fractional quantities with approved rate", () => {
      // 2.5 qty with unit price 6.25 -> approved rate 7 -> line total 17.50
      const qty = 2.5;
      const approvedRate = roundUpRate(6.25); // 7
      const lineTotal = roundCurrency(qty * approvedRate);
      expect(lineTotal).toBe(17.5);
    });
  });

  describe("TC-004: Manual Unit Price Precedence and Reconciliation", () => {
    it("respects manual unit price with round-up and calculates manual adjustment", () => {
      const direct = 100;
      const markup: MarkupSettings = {
        indirect_pct: 5,
        overhead_pct: 5,
        risk_pct: 2,
        profit_pct: 8, // total additions = 20, raw = 120
        pricing_policy: "additive_v2",
        round_up_rate: true,
      };

      const res = computePricingPhase2(direct, markup, 10, 125.25);
      // Raw calculated would be 120
      // Manual is 125.25 -> approved rate = ROUNDUP(125.25) = 126
      expect(res.approvedUnitRate).toBe(126);
      expect(res.lineSellingPrice).toBe(1260);

      // Reconciliation equation must hold
      const reconciled = roundCurrency(
        res.lineDirectCost +
          res.lineAdditions +
          res.lineRoundingDifference +
          res.lineManualAdjustment
      );
      expect(reconciled).toBe(res.lineSellingPrice);
    });
  });

  describe("TC-005: Materials Partitioning (Primary vs Accessories)", () => {
    it("partitions materials into primary and accessory while combining into total materials", () => {
      const items = [
        // Primary material
        {
          id: "1",
          resource_type: "material" as const,
          quantity: 10,
          unit_price: 50,
          material_category: "primary" as const,
        },
        // Accessory material
        {
          id: "2",
          resource_type: "material" as const,
          quantity: 5,
          unit_price: 20,
          material_category: "accessory" as const,
        },
        // Labor
        {
          id: "3",
          resource_type: "labor" as const,
          quantity: 2,
          unit_price: 100,
        },
      ];

      const direct = computeDirectUnitCost(items);
      expect(direct.primaryMaterialCost).toBe(500);
      expect(direct.accessoryMaterialCost).toBe(100);
      expect(direct.materialCost).toBe(600); // 500 + 100
      expect(direct.laborCost).toBe(200);
      expect(direct.directUnitCost).toBe(800); // 600 + 200
    });

    it("moving an item between primary and accessory preserves parent material total 600", () => {
      // Reclassify item 2 as primary
      const items = [
        {
          id: "1",
          resource_type: "material" as const,
          quantity: 10,
          unit_price: 50,
          material_category: "primary" as const,
        },
        {
          id: "2",
          resource_type: "material" as const,
          quantity: 5,
          unit_price: 20,
          material_category: "primary" as const,
        },
      ];

      const direct = computeDirectUnitCost(items);
      expect(direct.primaryMaterialCost).toBe(600);
      expect(direct.accessoryMaterialCost).toBe(0);
      expect(direct.materialCost).toBe(600);
    });
  });

  describe("TC-006: Pack Size and Waste Consumption Formula", () => {
    it("calculates pack unit cost and waste factor correctly per §5", () => {
      // 20L pack at 400 SAR = 20 SAR/L
      const packPrice = 400;
      const packSize = 20;
      const unitPricePerLiter = packPrice / packSize;
      expect(unitPricePerLiter).toBe(20);

      // Consumption 0.20 L/m2 with 5% waste = 0.20 * 1.05 = 0.21 L/m2
      const netConsumption = 0.2;
      const wastePct = 5;
      const effectiveConsumption = netConsumption * (1 + wastePct / 100);
      expect(effectiveConsumption).toBeCloseTo(0.21, 4);

      // Cost per m2 = 0.21 * 20 = 4.20 SAR/m2
      const unitCost = roundCurrency(effectiveConsumption * unitPricePerLiter);
      expect(unitCost).toBe(4.2);
    });
  });

  describe("TC-007: Breakdown Template Cost Engine", () => {
    it("calculates 4 markups and approved integer unit rate for templates", () => {
      const template: BreakdownTemplate = {
        id: "tmpl-test",
        code: "09-91-00",
        division: "Div. 09 - Finishes",
        title_ar: "دهان داخلي مائي",
        title_en: "Internal emulsion paint",
        description_ar: "توريد وتنفيذ دهانات داخلية مائية",
        description_en: "Supply and apply internal emulsion paint",
        unit: "م2",
        items: [
          {
            id: "res-1",
            resource_type: "material",
            description_ar: "دهان أساس",
            description_en: "Primer paint",
            unit: "لتر",
            quantity: 0.21,
            unit_price: 20,
            material_category: "primary",
          } as any,
          {
            id: "res-2",
            resource_type: "material",
            description_ar: "شريط وصنفرة",
            description_en: "Tape & sandpaper",
            unit: "مقطوعية",
            quantity: 1,
            unit_price: 1.5,
            material_category: "accessory",
          } as any,
          {
            id: "res-3",
            resource_type: "labor",
            description_ar: "طاقم دهان",
            description_en: "Painter crew",
            unit: "ساعة",
            quantity: 0.15,
            unit_price: 40,
          } as any,
        ],
        recommended_indirect_pct: 3,
        recommended_overhead_pct: 5,
        recommended_risk_pct: 2,
        recommended_profit_pct: 10,
      };

      const preview = calculateBreakdownCost(template);
      // Direct: 0.21 * 20 (= 4.20) + 1.50 + 6.00 = 11.70
      expect(preview.directUnitCost).toBe(11.7);
      expect(preview.primaryMaterialCost).toBe(4.2);
      expect(preview.accessoryMaterialCost).toBe(1.5);
      expect(preview.materialCost).toBe(5.7);
      expect(preview.laborCost).toBe(6.0);

      // Additions = 3% + 5% + 2% + 10% = 20% of 11.70 = 2.34
      // Raw unit selling = 11.70 + 2.34 = 14.04
      // Approved unit selling rate = ROUNDUP(14.04, 0) = 15
      expect(preview.rawUnitSellingRate).toBe(14.04);
      expect(preview.unitSellingRate).toBe(15);
    });
  });

  describe("TC-008: Project-Level Financial Reconciliation Equation", () => {
    it("reconciles direct + additions + rounding diff + manual adjustment === net selling price", () => {
      const boqItems = [
        {
          id: "item-1",
          item_no: "1.1",
          description_ar: "بند 1",
          quantity: 100,
          is_group: false,
          material_cost: 647.25,
          labor_cost: 0,
          equipment_cost: 0,
          subcontractor_cost: 0,
        },
        {
          id: "item-2",
          item_no: "1.2",
          description_ar: "بند 2",
          quantity: 50,
          is_group: false,
          material_cost: 0,
          labor_cost: 100,
          equipment_cost: 0,
          subcontractor_cost: 0,
          manual_unit_price: 125.25,
        },
      ];

      const markupsByItemId = new Map<string, MarkupSettings>([
        [
          "item-1",
          {
            indirect_pct: 1,
            overhead_pct: 1,
            risk_pct: 1,
            profit_pct: 1,
            pricing_policy: "additive_v2",
            round_up_rate: true,
          },
        ],
        [
          "item-2",
          {
            indirect_pct: 5,
            overhead_pct: 5,
            risk_pct: 2,
            profit_pct: 8,
            pricing_policy: "additive_v2",
            round_up_rate: true,
          },
        ],
      ]);

      const fin = computeProjectFinancials({
        boqItems,
        markupsByItemId,
      });

      // Verify overall project reconciliation
      const totalReconciled = roundCurrency(
        fin.totalDirectCost +
          fin.totalAdditions +
          fin.totalRoundingDifference +
          fin.totalManualAdjustment
      );

      expect(totalReconciled).toBe(fin.netSellingPrice);
    });
  });

  describe("TC-009: Backward Compatibility with Legacy Cascaded Mode", () => {
    it("preserves cascaded multiplication when pricing_policy is cascaded_v1", () => {
      const direct = 100;
      const legacyMarkup: MarkupSettings = {
        indirect_pct: 10,
        overhead_pct: 10,
        risk_pct: 0,
        profit_pct: 10,
        pricing_policy: "cascaded_v1",
        round_up_rate: false,
      };

      const res = computeUnitSellingPrice(direct, legacyMarkup);
      // 100 * 1.1 = 110, 110 * 1.1 = 121, 121 * 1.1 = 133.1
      expect(res.unitSellingPrice).toBe(133.1);
    });
  });
});
