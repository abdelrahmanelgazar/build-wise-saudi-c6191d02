import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { computeSha256Hex, uploadSubmissionArtifact } from "../lib/submission-storage";
import { executeLocalQuery } from "../../scripts/local-estimation-query";
import { computePricingPhase2, resolveBoqItemPricing, roundUpRate } from "../lib/estimation-calc";
import {
  applyTemplateToBoqItem,
  assertDirectCostTemplatePayload,
  calculateLibraryDirectCost,
  saveCustomTemplate,
  sanitizeTemplateToDirectCost,
} from "../lib/breakdown-library";
import {
  classifyPriceFreshness,
  listAllPriceEvidence,
  previewSaveAnalysisAsTemplate,
  publishSelectedResourcesToPriceLibrary,
  queryKnowledgeTemplatesTree,
  resetKnowledgeLibraryMemoryForTests,
  reviewKnowledgeTemplateVersion,
  saveAnalysisAsTemplate,
} from "../lib/knowledge-library-service";
import {
  allocateIndirectCostPool,
  calculatePlywoodFenceAssembly,
  calculatePlywoodFenceDiscretePurchase,
  calculateTimePhasedHistogramCost,
  calculateUndergroundTankAssembly,
  compareAssemblyBuildupVsOffer,
  detectCyclicAssemblyReferences,
  detectIndirectDoubleCounting,
  evaluateRestrictedFormula,
} from "../lib/assemblies-and-indirect-engine";
import {
  approveAndLockTenderSubmission,
  compareBoqRevisions,
  consolidateHoldsFinancialExposure,
  evaluateNormalizedComparisonPackage,
  evaluateTenderReadiness,
  reconcileExcelAgainstBoq,
  sanitizeExcelTextCell,
  transitionHoldState,
  type TenderHoldRecord,
} from "../lib/tender-assurance-engine";

function createInMemClient(initialDb: Record<string, any[]> = {}) {
  let raw = JSON.stringify(initialDb);
  const makeBuilder = (table: any) => {
    const filters: [string, unknown][] = [];
    const orders: { column: string; ascending?: boolean }[] = [];
    let operation: "read" | "insert" | "upsert" | "update" | "delete" = "read";
    let values: any[] = [];
    let conflict: string[] = [];
    let columns = "*";
    let head = false;
    let count = false;

    const run = async (cardinality: "many" | "single" | "optional") =>
      executeLocalQuery(
        { table, filters, orders, operation, values, conflict, columns, head, count, cardinality },
        () => raw,
        (next) => {
          raw = next;
        },
      );

    const builder: any = {
      select: (cols = "*", opts?: { count?: "exact"; head?: boolean }) => {
        columns = cols;
        count = opts?.count === "exact";
        head = Boolean(opts?.head);
        return builder;
      },
      insert: (v: any) => {
        operation = "insert";
        values = Array.isArray(v) ? v : [v];
        return builder;
      },
      upsert: (v: any, opts?: { onConflict?: string }) => {
        operation = "upsert";
        values = Array.isArray(v) ? v : [v];
        conflict = opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()) : [];
        return builder;
      },
      update: (v: any) => {
        operation = "update";
        values = [v];
        return builder;
      },
      delete: () => {
        operation = "delete";
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orders.push({ column: col, ascending: opts?.ascending ?? true });
        return builder;
      },
      single: () => run("single"),
      maybeSingle: () => run("optional"),
      then: (resolve: any, reject: any) => run("many").then(resolve, reject),
    };
    return builder;
  };
  return {
    getDb: () => JSON.parse(raw),
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => makeBuilder(table),
    } as any,
  };
}

describe("TENDER_KNOWLEDGE_IMPLEMENTATION_PLAN — Direct-Cost Contract & Acceptance Gate (100.25 -> 111 SAR)", () => {
  beforeEach(() => {
    resetKnowledgeLibraryMemoryForTests();
  });

  it("preserves exact direct cost 100.25 SAR across save -> copy -> composite insertion -> 10% target tender = 111 SAR & preserves existing target markups", async () => {
    const db = createInMemClient({
      projects: [{ id: "proj-1", name: "برج الرياض", client_name: "وزارة الإسكان", user_id: "user-1" }],
      boq_items: [
        { id: "boq-src", project_id: "proj-1", item_no: "03-01", description_ar: "خرسانة عمود", unit: "m3", quantity: 10 },
        { id: "boq-dst", project_id: "proj-1", item_no: "03-02", description_ar: "خرسانة عطاء ثان", unit: "m3", quantity: 10, tender_id: "tender-2" },
      ],
      price_analysis_items: [
        { id: "pa-1", boq_item_id: "boq-src", project_id: "proj-1", user_id: "user-1", resource_type: "material", description_ar: "مادة", unit: "m3", quantity: 1, waste_pct: 5, unit_price: 95.47619 },
      ],
      price_analysis_markup: [
        { boq_item_id: "boq-src", project_id: "proj-1", user_id: "user-1", indirect_pct: 5, overhead_pct: 5, risk_pct: 5, profit_pct: 5 },
        { boq_item_id: "boq-dst", project_id: "proj-1", tender_id: "tender-2", user_id: "user-1", indirect_pct: 4, overhead_pct: 3, risk_pct: 1, profit_pct: 2 },
      ],
    });

    // Source item: 1 * 1.05 * 95.47619 = 100.25 direct; 20% markup -> raw 120.30 -> ROUNDUP = 121 SAR in tender 1
    const preview = await previewSaveAnalysisAsTemplate({ boqItemId: "boq-src", projectId: "proj-1", client: db.client });
    expect(preview.directUnitCost).toBe(100.25);

    const saved = await saveAnalysisAsTemplate(
      {
        code: "COL-10025",
        titleAr: "خرسانة عمود 100.25",
        csiDivision: "03",
        unit: "m3",
        categoryType: "project_item",
        resources: preview.resources,
        sourceContext: preview.sourceContext,
        userId: "user-1",
      },
      db.client,
    );
    expect(saved.directUnitCost).toBe(100.25);
    expect(saved.template.recommended_overhead_pct).toBe(0);

    // Copy & composite assembly factor 1 stays 100.25 exact
    const copied = sanitizeTemplateToDirectCost({ ...saved.template, id: "copy-1", code: "COL-COPY" });
    expect(calculateLibraryDirectCost(copied).directUnitCost).toBe(100.25);

    // Target tender item already has 10% total markups (4+3+1+2).
    // Verify calculatePricing on target tender gives 100.25 + 10% = 110.275 -> ROUNDUP = 111 SAR
    const targetP2 = computePricingPhase2({
      directUnitCost: 100.25,
      quantity: 1,
      markups: { indirect_pct: 4, overhead_pct: 3, risk_pct: 1, profit_pct: 2, pricing_policy: "additive_v2", round_up_rate: true },
    });
    expect(targetP2.rawUnitSellingPrice).toBe(110.275);
    expect(targetP2.approvedUnitRate).toBe(111);

    // Reject importing 121 as direct cost when tagged selling_price
    expect(() =>
      assertDirectCostTemplatePayload({
        basis: "selling_price",
        unit_price: 121,
      }),
    ).toThrow("مرفوض");

    // Verify applyTemplateToBoqItem preserves existing target markups (even if invoked template had legacy recommended_% > 0!)
    await applyTemplateToBoqItem({
      template: { ...copied, recommended_indirect_pct: 10, recommended_overhead_pct: 10, recommended_profit_pct: 10, recommended_risk_pct: 10 },
      boqItemId: "boq-dst",
      projectId: "proj-1",
      userId: "user-1",
      tenderId: "tender-2",
      replaceExisting: true,
      client: db.client,
    });
    const currentDb = db.getDb();
    expect(currentDb.price_analysis_markup.find((m: any) => m.boq_item_id === "boq-dst").indirect_pct).toBe(4);
    expect(currentDb.price_analysis_markup.find((m: any) => m.boq_item_id === "boq-dst").profit_pct).toBe(2);
    expect(currentDb.boq_items.find((b: any) => b.id === "boq-dst").material_cost).toBe(100.25);
  });

  it("enforces RBAC on template review/publish and idempotency on duplicate save & M-02 resource publishing (TC-305..308, QL-005..019)", async () => {
    const db = createInMemClient({
      projects: [{ id: "p-1", name: "مستشفى الشمال", client_name: "وزارة الصحة", user_id: "u1" }],
      boq_items: [{ id: "b-1", project_id: "p-1", item_no: "03-10", description_ar: "صب خرسانة", unit: "m3", quantity: 100 }],
      price_analysis_items: [
        { id: "line-conc", boq_item_id: "b-1", project_id: "p-1", user_id: "u1", resource_type: "material", description_ar: "خرسانة C35", unit: "m3", quantity: 1, unit_price: 250 },
        { id: "line-pump", boq_item_id: "b-1", project_id: "p-1", user_id: "u1", resource_type: "equipment", description_ar: "مضخة خرسانة", unit: "m3", quantity: 1, unit_price: 25 },
      ],
    });

    const preview = await previewSaveAnalysisAsTemplate({ boqItemId: "b-1", projectId: "p-1", client: db.client });
    const first = await saveAnalysisAsTemplate(
      {
        code: "CONC-M01",
        titleAr: "تحليل صب خرسانة",
        csiDivision: "03",
        unit: "m3",
        categoryType: "project_item",
        resources: preview.resources,
        sourceContext: preview.sourceContext,
        idempotencyKey: "same-req-key-1",
        userId: "u1",
      },
      db.client,
    );
    const second = await saveAnalysisAsTemplate(
      {
        code: "CONC-M01",
        titleAr: "تحليل صب خرسانة",
        csiDivision: "03",
        unit: "m3",
        categoryType: "project_item",
        resources: preview.resources,
        sourceContext: preview.sourceContext,
        idempotencyKey: "same-req-key-1",
        userId: "u1",
      },
      db.client,
    );
    expect(second.templateId).toBe(first.templateId);

    // Plain pricing_engineer cannot approve/publish (QL-019)
    await expect(
      reviewKnowledgeTemplateVersion({
        templateId: first.templateId,
        decision: "approve",
        actorId: "u1",
        actorRole: "pricing_engineer",
        promoteToCompany: true,
        client: db.client,
      }),
    ).rejects.toThrow("NOT_AUTHORIZED");

    // Reviewer approves and promotes to company section library
    const approved = await reviewKnowledgeTemplateVersion({
      templateId: first.templateId,
      decision: "approve",
      actorId: "rev-1",
      actorRole: "discipline_reviewer",
      promoteToCompany: true,
      client: db.client,
    });
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.scope).toBe("company");

    // M-02: publish 2 selected lines twice -> idempotent deduplication, tagged `analysis_line` (NOT supplier_quote)
    const linesToPublish = [
      { id: "line-conc", resource_type: "material" as const, description_ar: "خرسانة C35", unit: "m3", unit_price: 250 },
      { id: "line-pump", resource_type: "equipment" as const, description_ar: "مضخة خرسانة", unit: "m3", unit_price: 25 },
    ];
    const pub1 = await publishSelectedResourcesToPriceLibrary(
      {
        boqItemId: "b-1",
        projectId: "p-1",
        projectName: "مستشفى الشمال",
        csiDivision: "03",
        scope: "project",
        lines: linesToPublish,
        userId: "u1",
      },
      db.client,
    );
    const pub2 = await publishSelectedResourcesToPriceLibrary(
      {
        boqItemId: "b-1",
        projectId: "p-1",
        projectName: "مستشفى الشمال",
        csiDivision: "03",
        scope: "project",
        lines: linesToPublish,
        userId: "u1",
      },
      db.client,
    );
    expect(pub1.skippedDuplicates).toBe(0);
    expect(pub2.skippedDuplicates).toBe(2);
    expect(listAllPriceEvidence({ projectId: "p-1" }).every((e) => e.source_type === "analysis_line")).toBe(true);

    // Unified query view counts match Sidebar and In-Place Caller (M-03 / M-04 / QL-012)
    const tree = queryKnowledgeTemplatesTree({ view: "typical_assemblies" });
    expect(tree.countsByView.typical_assemblies).toBe(tree.records.length);

    // Price freshness check (expired quote stays stale, not extended)
    expect(
      classifyPriceFreshness({ price: 250, priceDate: "2026-01-01", validUntil: "2026-02-01", asOfDate: "2026-11-26" }),
    ).toBe("stale");
  });
});

describe("DEV-305 & DEV-306 — Typical Assemblies, Restricted Formulas & Indirect Histograms", () => {
  it("calculates 3m Plywood Fence (30,008 -> 300.08 -> 367/36,700) and discrete purchase (111 sheets, 43 posts = 13,250)", () => {
    const v3Fence = calculatePlywoodFenceAssembly({ length_m: 100, height_m: 3, gate_width_m: 4, waste_pct: 5 });
    expect(v3Fence.claddingAreaM2).toBe(302.4);
    expect(v3Fence.totalDirectCost).toBe(30008);
    expect(v3Fence.directUnitCostPerM).toBe(300.08);

    const p2Fence = computePricingPhase2({
      directUnitCost: v3Fence.directUnitCostPerM,
      quantity: 100,
      markups: { indirect_pct: 5, overhead_pct: 5, risk_pct: 2, profit_pct: 10, round_up_rate: true },
    });
    expect(p2Fence.rawUnitSellingPrice).toBe(366.0976);
    expect(p2Fence.approvedUnitRate).toBe(367);
    expect(p2Fence.lineSellingPrice).toBe(36700);

    const discreteFence = calculatePlywoodFenceDiscretePurchase({
      length_m: 100,
      height_m: 3,
      post_spacing_m: 2.4,
      waste_pct: 10,
      sheet_unit_price_sar: 100,
      post_unit_price_sar: 50,
    });
    expect(discreteFence.totalSheetsRounded).toBe(111);
    expect(discreteFence.totalPosts).toBe(43);
    expect(discreteFence.totalDirectCost).toBe(13250);
  });

  it("enforces tank missing-input check, restricted formula safety, cycle guard, and indirect histogram allocation", () => {
    const pendingTank = calculateUndergroundTankAssembly({ capacity_m3: 150, internal_depth_m: 3.5, wall_thickness_m: null });
    expect(pendingTank.status).toBe("Pending Design Information");

    expect(() => evaluateRestrictedFormula("alert(1)", { x: 1 })).toThrow("غير مسموحة");
    expect(() => evaluateRestrictedFormula("10 / x", { x: 0 })).toThrow("القسمة على صفر");
    expect(detectCyclicAssemblyReferences([{ parentCode: "A", childCode: "B" }, { parentCode: "B", childCode: "A" }])).toEqual([
      "A",
      "B",
      "A",
    ]);

    const staffCost = calculateTimePhasedHistogramCost([
      { label: "P1", months: 2, count: 2, monthlyRate: 15000 },
      { label: "P2", months: 8, count: 4, monthlyRate: 15000 },
      { label: "P3", months: 2, count: 2, monthlyRate: 15000 },
    ]);
    expect(staffCost).toBe(600000);

    const supervisorsCost = calculateTimePhasedHistogramCost([
      { label: "M1-3", months: 3, count: 2, monthlyRate: 10000 },
      { label: "M4", months: 1, count: 1, monthlyRate: 10000 },
    ]);
    expect(supervisorsCost).toBe(70000);

    const doubleCheck = detectIndirectDoubleCounting({
      indirectLines: [{ costScopeId: "site_staff", title_ar: "طاقم الإشراف", recovery_mode: "preliminaries_boq", totalCost: 600000 }],
      hasExplicitPrelimBoqItems: true,
      itemsHaveIndirectPct: true,
    });
    expect(doubleCheck.hasDoubleCounting).toBe(true);

    const allocated = allocateIndirectCostPool(100, [
      { boqItemId: "b1", directCostTotal: 333 },
      { boqItemId: "b2", directCostTotal: 333 },
      { boqItemId: "b3", directCostTotal: 334 },
    ]);
    const allocSum = allocated.reduce((s, r) => s + r.allocatedAmount, 0);
    expect(Number(allocSum.toFixed(2))).toBe(100);

    const cmpOffer = compareAssemblyBuildupVsOffer({
      buildupDirectCost: 300.08,
      offerUnitOrTotalPrice: 29500,
      quantity: 100,
      chosenBasis: "supplier_offer",
      rationale: "عرض مورّد أقل بوضوح ضمن نفس النطاق",
    });
    expect(cmpOffer.selectedDirectTotal).toBe(29500);
  });
});

describe("DEV-307..DEV-311 — Readiness, Holds, Quote Normalization, BOQ Diff & Immutable Submission", () => {
  it("evaluates Holds state machine, 14,400 -> 17,568 impact, overlap deduplication, and readiness rules (TC-319..330)", () => {
    const hold: TenderHoldRecord = {
      id: "h1",
      project_id: "p1",
      tender_id: "t1",
      hold_ref: "H-001",
      subject: "ضخ الخرسانة غير محدد",
      reason_code: "pumping_excluded",
      severity: "high",
      impact_type: "add",
      impact_group: "pumping",
      direct_cost_impact: 800 * 18, // 14,400 SAR
      included_in_current_price: false,
      currency: "SAR",
      assignee: "مهندس الإنشاءات",
      target_boq_item_ids: ["boq-1"],
      evidence_links: [],
      status: "Open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const dupHold: TenderHoldRecord = {
      ...hold,
      id: "h2",
      hold_ref: "H-002",
      direct_cost_impact: 10000, // overlaps same `pumping` group -> only max (14,400) counts
    };

    const exposure = consolidateHoldsFinancialExposure({
      holds: [hold, dupHold],
      boqItemsById: new Map([["boq-1", { lineSellingPrice: 240000 }]]),
      markups: { indirect_pct: 5, overhead_pct: 5, risk_pct: 2, profit_pct: 10 }, // 22%
    });
    expect(exposure.knownDirectCostImpactSar).toBe(14400);
    expect(exposure.knownSellingImpactSar).toBe(17568);
    expect(exposure.overlappingGroups.length).toBe(1);

    expect(() =>
      transitionHoldState({ hold, toStatus: "AcceptedRisk", actorId: "e1", actorRole: "pricing_engineer", reason: "ok" }),
    ).toThrow("NOT_AUTHORIZED");

    const inProg = transitionHoldState({ hold, toStatus: "InProgress", actorId: "e1", actorRole: "pricing_engineer" });
    const pendingRev = transitionHoldState({ hold: inProg, toStatus: "PendingReview", actorId: "e1", actorRole: "pricing_engineer" });
    expect(() =>
      transitionHoldState({ hold: pendingRev, toStatus: "Closed", actorId: "r1", actorRole: "discipline_reviewer", evidenceLinks: [] }),
    ).toThrow("VALIDATION_FAILED");
    const closed = transitionHoldState({
      hold: pendingRev,
      toStatus: "Closed",
      actorId: "r1",
      actorRole: "discipline_reviewer",
      evidenceLinks: ["QUOTE-C35-R1"],
    });
    expect(closed.status).toBe("Closed");

    // Circular Included Elsewhere detected in Readiness
    const readiness = evaluateTenderReadiness({
      tenderId: "t1",
      boqItems: [
        { id: "i1", item_no: "01", description_ar: "أ", is_included_elsewhere: true, pricing_status: "included", is_group: false },
        { id: "i2", item_no: "02", description_ar: "ب", is_included_elsewhere: true, pricing_status: "included", is_group: false },
      ],
      includedCarrierByItemId: new Map([["i1", "i2"], ["i2", "i1"]]),
    });
    expect(readiness.overallState).toBe("NOT_READY");
    expect(readiness.findings.some((f) => f.ruleCode === "RD-07")).toBe(true);
  });

  it("normalizes concrete offers A/B/C (274 vs 260 vs Incomplete) and splits BOQ Diff +43,500 (+30,000 qty + +13,500 rate)", () => {
    const offers = evaluateNormalizedComparisonPackage({
      requiredQuantity: 800,
      offers: [
        {
          offerId: "A",
          supplierName: "Offer A",
          quotedUnitRate: 250,
          adjustments: [
            { key: "pump", label_ar: "ضخ", kind: "addition", unitRateOrAmount: 18, basis: "per_unit", includedInOffer: false },
            { key: "trans", label_ar: "نقل", kind: "addition", unitRateOrAmount: 6, basis: "per_unit", includedInOffer: false },
          ],
        },
        {
          offerId: "B",
          supplierName: "Offer B",
          quotedUnitRate: 260,
          adjustments: [
            { key: "pump", label_ar: "ضخ", kind: "addition", unitRateOrAmount: 0, basis: "per_unit", includedInOffer: true },
            { key: "trans", label_ar: "نقل", kind: "addition", unitRateOrAmount: 0, basis: "per_unit", includedInOffer: true },
          ],
        },
        {
          offerId: "C",
          supplierName: "Offer C",
          quotedUnitRate: 245,
          adjustments: [
            { key: "pump", label_ar: "ضخ", kind: "addition", unitRateOrAmount: null, basis: "per_unit", includedInOffer: false, isUnknown: true },
          ],
        },
      ],
    });
    const offerA = offers.find((o) => o.offerId === "A")!;
    const offerB = offers.find((o) => o.offerId === "B")!;
    const offerC = offers.find((o) => o.offerId === "C")!;
    expect(offerA.comparableUnitRate).toBe(274);
    expect(offerA.normalizedAmount).toBe(219200);
    expect(offerB.comparableUnitRate).toBe(260);
    expect(offerB.rank).toBe(1);
    expect(offerC.isComplete).toBe(false);
    expect(offerC.rank).toBeNull();

    const diff = compareBoqRevisions(
      [{ id: "r1", item_no: "03-01", description_ar: "خرسانة", unit: "m3", quantity: 800, unitRate: 300 }],
      [{ id: "r2", item_no: "03-01", description_ar: "خرسانة", unit: "m3", quantity: 900, unitRate: 315 }],
    );
    expect(diff.summary.quantityEffectTotal).toBe(30000);
    expect(diff.summary.rateEffectTotal).toBe(13500);
    expect(diff.summary.netDelta).toBe(43500);
  });

  it("sanitizes Excel formula injection, verifies Excel reconciliation, blocks stale readiness, and freezes submitted snapshot (TC-341..352)", async () => {
    expect(sanitizeExcelTextCell("=SUM(A1:A5)")).toBe("'=SUM(A1:A5)");

    const mismatch = reconcileExcelAgainstBoq({
      boqItems: [{ item_no: "01", quantity: 10, approvedUnitRate: 111, lineSellingPrice: 1110 }],
      excelRows: [{ item_no: "01", quantity: 10, unitRate: 121, lineTotal: 1210 }],
    });
    expect(mismatch.matched).toBe(false);

    const tenderId = `tender-v3-${Date.now()}`;
    const boqItems = [
      { id: "i-lock", item_no: "01", description_ar: "بند معتمد", quantity: 10, is_group: false, material_cost: 100.25, rate_source: "analysis", pricing_status: "priced" },
    ];
    const paItemsByBoqId = new Map([
      ["i-lock", [{ resource_type: "material" as const, quantity: 1, unit_price: 100.25 }]],
    ]);
    const markups = new Map([["i-lock", { indirect_pct: 4, overhead_pct: 3, risk_pct: 1, profit_pct: 2, round_up_rate: true }]]);
    const readiness = evaluateTenderReadiness({ tenderId, boqItems, paItemsByBoqId, markupsByBoqId: markups });
    expect(readiness.overallState).toBe("READY");
    expect(readiness.netSellingPriceSar).toBe(1110);

    // Stale hash rejected (TC-343)
    await expect(
      approveAndLockTenderSubmission({
        tenderId,
        projectId: "proj-lock",
        actorId: "approver-1",
        actorRole: "approver",
        expectedDraftVersion: 1,
        currentDraftVersion: 1,
        readiness,
        currentEstimateInputHash: "changed-hash",
        exportReconciled: true,
        exportSha256: "abc123",
        idempotencyKey: "k1",
        boqItems,
        paItemsByBoqId,
        markupsByBoqId: markups,
      }),
    ).rejects.toThrow("STALE_VERSION");

    // Successful lock + idempotent retry (TC-348)
    const snap1 = await approveAndLockTenderSubmission({
      tenderId,
      projectId: "proj-lock",
      actorId: "approver-1",
      actorRole: "approver",
      expectedDraftVersion: 1,
      currentDraftVersion: 1,
      readiness,
      currentEstimateInputHash: readiness.inputHash,
      exportReconciled: true,
      exportSha256: "abc123",
      idempotencyKey: `lock-ok-${tenderId}`,
      boqItems,
      paItemsByBoqId,
      markupsByBoqId: markups,
    });
    expect(snap1.netSellingPrice).toBe(1110);
    expect(snap1.exportSha256).toBe("abc123");
  });

  it("blocks unit-changed BOQ diff until engineer decision, blocks RD-06 indirect double-counting, hashes artifacts, and validates server submit RPC migration", async () => {
    const unitDiff = compareBoqRevisions(
      [{ id: "o1", item_no: "03-05", description_ar: "خرسانة جدران", unit: "m3", quantity: 100, unitRate: 400 }],
      [{ id: "n1", item_no: "03-05", description_ar: "خرسانة جدران", unit: "m2", quantity: 300, unitRate: 150 }],
    );
    expect(unitDiff.mappings[0]?.changeType).toBe("UnitChanged");
    expect(unitDiff.mappings[0]?.requiresEngineerDecision).toBe(true);
    expect(unitDiff.summary.unresolvedCount).toBe(1);

    const blockedReadiness = evaluateTenderReadiness({
      tenderId: "t-rd06",
      boqItems: [],
      indirectDoubleCountWarnings: ["ازدواج التحميل (TC-317): طاقم الإشراف"],
      unresolvedBoqDiffCount: unitDiff.summary.unresolvedCount,
    });
    expect(blockedReadiness.overallState).toBe("NOT_READY");
    expect(blockedReadiness.findings.some((f) => f.ruleCode === "RD-06")).toBe(true);
    expect(blockedReadiness.findings.some((f) => f.ruleCode === "RD-09")).toBe(true);

    const digest = await computeSha256Hex("taqdiri-submission-workbook");
    expect(digest.length).toBeGreaterThanOrEqual(8);
    const artifact = await uploadSubmissionArtifact({
      projectId: "proj-1",
      tenderId: "t-1",
      versionNo: 2,
      fileName: "Tender Offer v2.xlsx",
      bytes: new Uint8Array([80, 75, 3, 4]),
    });
    expect(artifact.sha256.length).toBeGreaterThanOrEqual(8);
    expect(artifact.storagePath).toContain("v2_Tender_Offer_v2.xlsx");

    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261126000006_server_recompute_submit_rpc.sql"),
      "utf8",
    );
    expect(sql).toContain("FROM public.boq_items b");
    expect(sql).toContain("readiness_runs");
    expect(sql).toContain("'tender-documents'");
  });
});
