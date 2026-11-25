import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computePricingPhase2, computeDirectUnitCost } from "../lib/estimation-calc";
import {
  submitTenderVersion,
  getSubmittedTenderSnapshots,
} from "../lib/client-tender-service";

describe("CLOUD_RELEASE_PLAN §1 & §4 Acceptance Gates", () => {
  beforeEach(() => {
    if (typeof window !== "undefined" && typeof window.localStorage?.clear === "function") {
      window.localStorage.clear();
    }
  });

  it("validates 647.25 + four 1% additive markups -> raw 673.14, rounded 674, selling 67,400 for qty 100", () => {
    const res = computePricingPhase2({
      directUnitCost: 647.25,
      quantity: 100,
      markups: {
        indirect_pct: 1,
        overhead_pct: 1,
        risk_pct: 1,
        profit_pct: 1,
        pricing_policy: "additive_v2",
        round_up_rate: true,
      },
    });
    expect(res.rawUnitSellingPrice).toBe(673.14);
    expect(res.approvedUnitRate).toBe(674);
    expect(res.lineSellingPrice).toBe(67400);
  });

  it("clears item rate cleanly when last resource is removed from analyzed BOQ item", () => {
    const emptyDirect = computeDirectUnitCost([]);
    expect(emptyDirect.directUnitCost).toBe(0);
    const res = computePricingPhase2({
      directUnitCost: emptyDirect.directUnitCost,
      quantity: 50,
      markups: { indirect_pct: 10, overhead_pct: 5, risk_pct: 3, profit_pct: 10, round_up_rate: true },
    });
    expect(res.approvedUnitRate).toBe(0);
    expect(res.lineSellingPrice).toBe(0);
  });

  it("rolls back cleanly on simulated failure and keeps historical version (10,300 vs 10,500 SAR)", async () => {
    const tenderId = `tender-cloud-release-gate-${Date.now()}`;
    const baseBoq = [
      {
        id: "b1",
        item_no: "03-01",
        description_ar: "خرسانة مسلحة",
        unit: "م³",
        quantity: 10,
        is_group: false,
        material_cost: 1030,
      },
    ];

    // 1. Mid-flight failure should leave zero submitted snapshots
    await expect(
      submitTenderVersion({
        tenderId,
        projectId: "proj-gate",
        idempotencyKey: "k-fail",
        userId: "approver-1",
        boqItems: baseBoq,
        markupsByBoqId: new Map(),
        simulateFailure: true,
      }),
    ).rejects.toThrow();
    expect(getSubmittedTenderSnapshots(tenderId).length).toBe(0);

    // 2. Submit v1 at 10,300 SAR
    const v1 = await submitTenderVersion({
      tenderId,
      projectId: "proj-gate",
      idempotencyKey: "k-v1",
      userId: "approver-1",
      boqItems: baseBoq,
      markupsByBoqId: new Map(),
    });
    expect(v1.versionNo).toBe(1);
    expect(v1.netSellingPrice).toBe(10300);

    // 3. Revise draft (+200 SAR) and submit v2 -> v1 remains immutable at 10,300 SAR
    const revisedBoq = [{ ...baseBoq[0]!, material_cost: 1050 }];
    const v2 = await submitTenderVersion({
      tenderId,
      projectId: "proj-gate",
      idempotencyKey: "k-v2",
      userId: "approver-1",
      boqItems: revisedBoq,
      markupsByBoqId: new Map(),
    });
    expect(v2.versionNo).toBe(2);
    expect(v2.netSellingPrice).toBe(10500);

    const history = getSubmittedTenderSnapshots(tenderId);
    expect(history.find((s) => s.versionNo === 1)?.netSellingPrice).toBe(10300);
    expect(history.find((s) => s.versionNo === 2)?.netSellingPrice).toBe(10500);
  });

  it("verifies all supabase/migrations/*.sql filenames have strictly unique numeric prefixes", () => {
    const migDir = path.join(process.cwd(), "supabase", "migrations");
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThanOrEqual(4);
    const prefixes = files.map((f) => f.split("_")[0]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
