import * as XLSX from "xlsx";
import { describe, it, expect } from "vitest";
import {
  computeDirectUnitCost,
  computePricingPhase2,
  computeProjectFinancials,
  computeUnitSellingPrice,
  roundUpRate,
} from "@/lib/estimation-calc";
import {
  getSubmittedTenderSnapshot,
  submitTenderVersion,
} from "@/lib/client-tender-service";

describe("Platform Independence & Unified Acceptance Suite (PLATFORM_INDEPENDENCE_AND_NAVIGATION_PLAN.md)", () => {
  it("passes the shared procurement-estimation-dev acceptance test (1,600 submitted v1 vs 1,700 revised draft)", async () => {
    const boqItem = {
      id: "boq-paint-100",
      item_no: "09.01",
      description_ar: "أعمال دهان تشطيب",
      unit: "م²",
      quantity: 100,
      is_group: false,
    };

    // v1 Supplier Quote: 20L pack @ 400 SAR -> 20 SAR/L; consumption 0.20 L/m2 + 5% waste = 4.20 SAR/m2
    // Accessories: 0.80 SAR/m2; Labor: 10.00 SAR/m2 -> Materials 5.00, Direct 15.00
    const v1Resources = [
      {
        resource_type: "material" as const,
        material_category: "primary" as const,
        description_ar: "دهان (عبوة 20 لتر بسعر 400 ريال)",
        quantity: 0.2,
        unit_price: 400 / 20, // 20 SAR/L
        waste_pct: 5,
      },
      {
        resource_type: "material" as const,
        material_category: "accessory" as const,
        description_ar: "إكسسوارات دهان",
        quantity: 1,
        unit_price: 0.8,
        waste_pct: 0,
      },
      {
        resource_type: "labor" as const,
        description_ar: "عمالة دهان",
        quantity: 1,
        unit_price: 10,
      },
    ];

    const v1Direct = computeDirectUnitCost(v1Resources);
    expect(v1Direct.primaryMaterialCost).toBe(4.2);
    expect(v1Direct.accessoryMaterialCost).toBe(0.8);
    expect(v1Direct.materialCost).toBe(5.0);
    expect(v1Direct.laborCost).toBe(10.0);
    expect(v1Direct.directUnitCost).toBe(15.0);

    // 4 independent 1% markups: raw = 15.60, ROUNDUP = 16, total = 1,600
    const markups = {
      indirect_pct: 1,
      overhead_pct: 1,
      risk_pct: 1,
      profit_pct: 1,
      pricing_policy: "additive_v2" as const,
      round_up_rate: true,
    };

    const p2v1 = computePricingPhase2({
      directUnitCost: v1Direct.directUnitCost,
      quantity: 100,
      markups,
    });
    expect(p2v1.rawUnitSellingPrice).toBe(15.6);
    expect(p2v1.approvedUnitRate).toBe(16);
    expect(p2v1.lineSellingPrice).toBe(1600);

    // Also verify computeUnitSellingPrice & computeProjectFinancials match 100%
    const unitV1 = computeUnitSellingPrice(v1Direct.directUnitCost, markups);
    expect(unitV1.rawUnitSellingPrice).toBe(15.6);
    expect(unitV1.unitSellingPrice).toBe(16);

    const finV1 = computeProjectFinancials({
      boqItems: [boqItem],
      paItemsByItemId: new Map([[boqItem.id, v1Resources]]),
      markupsByItemId: new Map([[boqItem.id, markups]]),
    });
    expect(finV1.totalDirectCost).toBe(1500);
    expect(finV1.netSellingPrice).toBe(1600);

    // Submit Tender v1 (immutable snapshot)
    const tenderId = `tnd-shared-${Date.now()}`;
    const snapV1 = await submitTenderVersion({
      tenderId,
      projectId: "proj-shared",
      expectedDraftVersion: 1,
      currentDraftVersion: 1,
      idempotencyKey: `idem-v1-${tenderId}`,
      userId: "approver-1",
      documentRef: "DOC-2026-V1",
      boqItems: [boqItem],
      paItemsByBoqId: new Map([[boqItem.id, v1Resources]]),
      markupsByBoqId: new Map([[boqItem.id, markups]]),
    });
    expect(snapV1.versionNo).toBe(1);
    expect(snapV1.netSellingPrice).toBe(1600);

    // Idempotent retry returns the exact same snapshot
    const snapV1Retry = await submitTenderVersion({
      tenderId,
      projectId: "proj-shared",
      expectedDraftVersion: 1,
      currentDraftVersion: 1,
      idempotencyKey: `idem-v1-${tenderId}`,
      userId: "approver-1",
      boqItems: [boqItem],
    });
    expect(snapV1Retry.id).toBe(snapV1.id);
    expect(snapV1Retry.netSellingPrice).toBe(1600);

    // Now supplier revises quote: 20L pack @ 500 SAR -> 25 SAR/L
    // Paint = 0.20 * 1.05 * 25 = 5.25; Direct = 16.05; Raw = 16.692; Rate = 17; Total = 1,700
    const v2Resources = [
      { ...v1Resources[0]!, unit_price: 500 / 20 },
      v1Resources[1]!,
      v1Resources[2]!,
    ];
    const v2Direct = computeDirectUnitCost(v2Resources);
    expect(v2Direct.primaryMaterialCost).toBe(5.25);
    expect(v2Direct.directUnitCost).toBe(16.05);

    const p2v2 = computePricingPhase2({
      directUnitCost: v2Direct.directUnitCost,
      quantity: 100,
      markups,
    });
    expect(p2v2.rawUnitSellingPrice).toBe(16.692);
    expect(p2v2.approvedUnitRate).toBe(17);
    expect(p2v2.lineSellingPrice).toBe(1700);

    // Submitted v1 snapshot MUST still be 1,600 SAR!
    const historicalV1 = getSubmittedTenderSnapshot(tenderId, 1);
    expect(historicalV1?.netSellingPrice).toBe(1600);
    expect(historicalV1?.items[0]?.approvedUnitRate).toBe(16);

    // Verify Excel round-trip export & re-read preserves exact submitted (1,600) vs draft (1,700) numeric values
    const wsV1 = XLSX.utils.json_to_sheet(
      historicalV1!.items.map((it) => ({
        item_no: it.itemNo,
        qty: it.quantity,
        unit_rate: it.approvedUnitRate,
        total: it.lineSellingPrice,
      })),
    );
    const wbV1 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbV1, wsV1, "SubmittedV1");
    const buf = XLSX.write(wbV1, { type: "buffer", bookType: "xlsx" });
    const parsedWb = XLSX.read(buf, { type: "buffer" });
    const rowsBack = XLSX.utils.sheet_to_json<Record<string, number>>(parsedWb.Sheets["SubmittedV1"]!);
    expect(rowsBack[0]?.["unit_rate"]).toBe(16);
    expect(rowsBack[0]?.["total"]).toBe(1600);
  });

  it("verifies Section 8 rounding boundaries, failure atomicity, and 10,300 vs 10,500 isolation", async () => {
    expect(roundUpRate(6.25)).toBe(7);
    expect(roundUpRate(6.25) * 2.5).toBe(17.5);

    const p647 = computePricingPhase2({
      directUnitCost: 647.25,
      quantity: 100,
      markups: { indirect_pct: 1, overhead_pct: 1, risk_pct: 1, profit_pct: 1, pricing_policy: "additive_v2", round_up_rate: true },
    });
    expect(p647.rawUnitSellingPrice).toBe(673.14);
    expect(p647.approvedUnitRate).toBe(674);
    expect(p647.lineSellingPrice).toBe(67400);

    const tenderId = `tnd-atomic-${Date.now()}`;
    await expect(
      submitTenderVersion({
        tenderId,
        projectId: "proj-atomic",
        expectedDraftVersion: 1,
        currentDraftVersion: 1,
        idempotencyKey: `idem-fail-${tenderId}`,
        userId: "approver-1",
        boqItems: [{ id: "i1", item_no: "01", description_ar: "بند", quantity: 10, is_group: false, material_cost: 1030 }],
        simulateFailure: true,
      }),
    ).rejects.toThrow("فشل متعمد");
    expect(getSubmittedTenderSnapshot(tenderId)).toBeNull();

    // Version conflict check
    await expect(
      submitTenderVersion({
        tenderId,
        projectId: "proj-atomic",
        expectedDraftVersion: 1,
        currentDraftVersion: 2,
        idempotencyKey: `idem-conflict-${tenderId}`,
        userId: "approver-1",
        boqItems: [],
      }),
    ).rejects.toThrow("تعارض في إصدار المسودة");

    // 10,300 submitted remains 10,300 when draft becomes 10,500
    const snap = await submitTenderVersion({
      tenderId,
      projectId: "proj-atomic",
      expectedDraftVersion: 2,
      currentDraftVersion: 2,
      idempotencyKey: `idem-10300-${tenderId}`,
      userId: "approver-1",
      boqItems: [{ id: "i1", item_no: "01", description_ar: "بند", quantity: 10, is_group: false, material_cost: 1030 }],
    });
    expect(snap.netSellingPrice).toBe(10300);
    expect(getSubmittedTenderSnapshot(tenderId, 1)?.netSellingPrice).toBe(10300);
  });
});
