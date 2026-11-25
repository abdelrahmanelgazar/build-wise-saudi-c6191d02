import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  resolveBoqItemPricing,
  computeProjectFinancials,
  type MarkupSettings,
  type ResourceCostInput,
} from "../lib/estimation-calc";
import { arrayBufferToBase64, writeBoqIntoOriginalWorkbook } from "../lib/excel-roundtrip";
import { submitTenderVersion } from "../lib/client-tender-service";
import { restoreProjectBackup, type ProjectBackupSnapshot } from "../lib/project-backup";
import { executeLocalQuery } from "../../scripts/local-estimation-query";
import {
  compareSupplierQuotesNormalized,
  computeValueAndValidityCoverage,
} from "../lib/csi-assemblies-engine";
import { CSI_CONCRETE_ELEMENTS_ASSEMBLIES } from "../lib/csi-concrete-elements-assemblies";
import { calculateBreakdownCost, DEFAULT_BREAKDOWN_TEMPLATES } from "../lib/breakdown-library";

describe("PLATFORM_ENGINEERING_REVIEW §G1 — Canonical Pricing Reconciliation", () => {
  it("rounds manual unit price 6.25 -> 7 and computes 17.50 for qty 2.5 identically across BOQ, Excel, Financial, and Tender Submission", async () => {
    const boqItem = {
      id: "item-g1",
      item_no: "03-01-01",
      description_ar: "خرسانة مسلحة",
      unit: "م³",
      quantity: 2.5,
      is_group: false,
      manual_unit_price: 6.25,
      rate_source: "analysis",
      material_cost: 99, // even with analysis & stored cost present, manual override wins cleanly
    };

    const paLines: ResourceCostInput[] = [
      { resource_type: "material", quantity: 1, unit_price: 5.0 },
    ];
    const markup: MarkupSettings = {
      indirect_pct: 5,
      overhead_pct: 3,
      risk_pct: 2,
      profit_pct: 10,
      pricing_policy: "additive_v2",
      round_up_rate: true,
    };

    // 1. Canonical resolver
    const resolved = resolveBoqItemPricing({
      item: boqItem,
      paLines,
      hasAnalysisFlag: true,
      markup,
    });
    expect(resolved.source).toBe("manual");
    expect(resolved.approvedUnitRate).toBe(7);
    expect(resolved.lineSellingPrice).toBe(17.5);

    // 2. Original Excel roundtrip writeback
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["رقم البند", "الوصف", "الكمية", "السعر الإفرادي", "الإجمالي"],
      ["03-01-01", "خرسانة مسلحة", 2.5, "", ""],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Concrete");
    const b64 = arrayBufferToBase64(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);

    const written = writeBoqIntoOriginalWorkbook({
      originalWorkbookB64: b64,
      rows: [{ ...boqItem, sheet_name: "Concrete", rate_cell_ref: "D2", total_cell_ref: "E2" }],
      paSellingRates: new Map([["item-g1", 6]]), // should NOT override manual 6.25->7!
      paItemsByItemId: new Map([["item-g1", paLines]]),
      markupsByItemId: new Map([["item-g1", markup]]),
    });
    expect(written.workbook.Sheets["Concrete"]?.["D2"]?.v).toBe(7);
    expect(written.workbook.Sheets["Concrete"]?.["E2"]?.v).toBe(17.5);

    // 3. Financial Summary
    const fin = computeProjectFinancials({
      boqItems: [boqItem as any],
      paItemsByItemId: new Map([["item-g1", paLines]]),
      markupsByItemId: new Map([["item-g1", markup]]),
      defaultMarkup: markup,
      vatRate: 15,
    });
    expect(fin.netSellingPrice).toBe(17.5);

    // 4. Submitted Tender Snapshot
    const snap = await submitTenderVersion({
      tenderId: `tender-g1-${Date.now()}`,
      projectId: "proj-g1",
      idempotencyKey: `idem-g1-${Date.now()}`,
      userId: "user-g1",
      boqItems: [boqItem],
      paItemsByBoqId: new Map([["item-g1", paLines]]),
      markupsByBoqId: new Map([["item-g1", markup]]),
    });
    expect(snap.netSellingPrice).toBe(17.5);
    expect(snap.items[0]?.approvedUnitRate).toBe(7);
  });

  it("validates direct 100 + markups 5%, 3%, 2%, 10% = selling rate 120 and clears rate when last resource is removed", () => {
    const markup: MarkupSettings = {
      indirect_pct: 5,
      overhead_pct: 3,
      risk_pct: 2,
      profit_pct: 10,
      pricing_policy: "additive_v2",
      round_up_rate: true,
    };

    const priced = resolveBoqItemPricing({
      item: { id: "i1", quantity: 10, rate_source: "analysis" },
      paLines: [{ resource_type: "material", quantity: 1, unit_price: 100 }],
      hasAnalysisFlag: true,
      markup,
    });
    expect(priced.approvedUnitRate).toBe(120);
    expect(priced.lineSellingPrice).toBe(1200);

    // Delete last PA resource -> even if stale stored material_cost=100 was in DB, rate drops cleanly to 0 (unpriced)
    const deletedLast = resolveBoqItemPricing({
      item: { id: "i1", quantity: 10, rate_source: "analysis", material_cost: 100 },
      paLines: [],
      hasAnalysisFlag: false,
      markup,
    });
    expect(deletedLast.source).toBe("unpriced");
    expect(deletedLast.approvedUnitRate).toBe(0);
    expect(deletedLast.lineSellingPrice).toBe(0);
    expect(deletedLast.isUnpriced).toBe(true);
  });
});

describe("PLATFORM_ENGINEERING_REVIEW §G2 — Backup Isolation & Dependency Check", () => {
  it("rejects restore_in_place into a different projectId and includes explicit step diagnostics on failure", async () => {
    const sampleSnapshot: ProjectBackupSnapshot = {
      version: "2.1.0",
      exported_at: new Date().toISOString(),
      project: { id: "orig-proj-1", name: "Original Hospital", estimated_value: 10300 },
      tenders: [
        { id: "t-1", project_id: "orig-proj-1", tender_no: "T-01", title: "Pkg 1", status: "submitted" },
        { id: "t-2", project_id: "orig-proj-1", tender_no: "T-02", title: "Pkg 2", status: "studying" },
      ],
      boq_excel_versions: [{ id: "ver-1", project_id: "orig-proj-1", file_name: "hosp.xlsx", file_sha256: "abc" }],
      boq_items: [{ id: "b-1", project_id: "orig-proj-1", item_no: "03-01", description_ar: "خرسانة", level: 0 }],
      price_analysis_items: [],
      price_analysis_markup: [],
      resources: [],
      tender_submissions: [
        {
          id: "sub-1",
          tender_id: "t-1",
          project_id: "orig-proj-1",
          version_no: 1,
          idempotency_key: "k-1",
          currency: "SAR",
          total_direct_cost: 9000,
          net_selling_price: 10300,
          vat_rate: 15,
          vat_amount: 1545,
          grand_total_with_vat: 11845,
          items_snapshot: [],
          submitted_by: "u-1",
        },
      ],
      metadata: { totalItems: 1, totalAnalyses: 0, estimatedValue: 10300 },
    };

    let rawDb = JSON.stringify({
      projects: [{ id: "orig-proj-1", name: "Original Hospital", estimated_value: 10300 }],
      tenders: [{ id: "t-1", project_id: "orig-proj-1", tender_no: "T-01", title: "Pkg 1", status: "submitted" }],
      boq_items: [{ id: "b-1", project_id: "orig-proj-1", item_no: "03-01", description_ar: "خرسانة", level: 0 }],
    });
    const inMemClient: any = {
      from: (table: string) => {
        const filters: [string, unknown][] = [];
        const builder: any = {
          select: () => builder,
          eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
          maybeSingle: async () =>
            executeLocalQuery({ table: table as any, filters, orders: [], operation: "read", values: [], conflict: [], head: false, count: false, cardinality: "optional" }, () => rawDb, (d) => { rawDb = d; }),
          upsert: async (vals: any, opts?: { onConflict?: string }) =>
            executeLocalQuery({ table: table as any, filters, orders: [], operation: "upsert", values: Array.isArray(vals) ? vals : [vals], conflict: (opts?.onConflict || "id").split(","), head: false, count: false, cardinality: "many" }, () => rawDb, (d) => { rawDb = d; }),
          insert: async (vals: any) =>
            executeLocalQuery({ table: table as any, filters, orders: [], operation: "insert", values: Array.isArray(vals) ? vals : [vals], conflict: [], head: false, count: false, cardinality: "many" }, () => rawDb, (d) => { rawDb = d; }),
          delete: () => ({
            eq: async (col: string, val: unknown) =>
              executeLocalQuery({ table: table as any, filters: [[col, val]], orders: [], operation: "delete", values: [], conflict: [], head: false, count: false, cardinality: "many" }, () => rawDb, (d) => { rawDb = d; }),
          }),
        };
        return builder;
      },
    };

    await expect(
      restoreProjectBackup(sampleSnapshot, {
        mode: "restore_in_place",
        targetProjectId: "different-proj-id",
        client: inMemClient,
      }),
    ).rejects.toThrow("clone_as_new");

    // Simulate mid-flight failure at boq_items -> rolls back cloned project cleanly
    await expect(
      restoreProjectBackup(sampleSnapshot, {
        mode: "clone_as_new",
        simulateFailureAtStep: "boq_items",
        client: inMemClient,
      }),
    ).rejects.toThrow("boq_items");

    const dbAfterFail = JSON.parse(rawDb);
    expect(dbAfterFail.projects.length).toBe(1); // source project untouched, partial clone rolled back

    // Retry clone_as_new succeeds cleanly with fresh UUIDs and all tenders/submissions preserved
    const cloned = await restoreProjectBackup(sampleSnapshot, {
      mode: "clone_as_new",
      newProjectName: "Hospital Clone Copy",
      client: inMemClient,
    });
    expect(cloned.projectId).not.toBe("orig-proj-1");
    expect(cloned.tendersRestored).toBe(2);
    expect(cloned.submissionsRestored).toBe(1);
    expect(cloned.excelVersionsRestored).toBe(1);

    const dbAfterClone = JSON.parse(rawDb);
    expect(dbAfterClone.projects.length).toBe(2);
    expect(dbAfterClone.projects[0].name).toBe("Original Hospital"); // original intact
    expect(dbAfterClone.tender_submissions[0].net_selling_price).toBe(10300);
  });
});

describe("PLATFORM_ENGINEERING_REVIEW §G3 — Concrete Elements & Scope-Normalized Quote Comparison", () => {
  it("provides independent executable assemblies for columns, necks, walls, beams, grade beams, slabs, and Div 01 setup/running", () => {
    expect(CSI_CONCRETE_ELEMENTS_ASSEMBLIES.length).toBeGreaterThanOrEqual(10);
    const allIds = new Set(DEFAULT_BREAKDOWN_TEMPLATES.map((t) => t.id));
    for (const tpl of CSI_CONCRETE_ELEMENTS_ASSEMBLIES) {
      expect(allIds.has(tpl.id)).toBe(true);
      const calc = calculateBreakdownCost(tpl);
      expect(calc.directUnitCost).toBeGreaterThan(0);
      expect(calc.unitSellingPrice).toBeGreaterThanOrEqual(calc.directUnitCost);
    }
  });

  it("normalizes all-in C35 supply+pump+pour quote against supply-only + pump minimum charge and tracks validity coverage", () => {
    const compared = compareSupplierQuotesNormalized({
      targetScopes: ["concrete_supply", "pumping", "pouring_compaction"],
      workQuantity: 50,
      quotes: [
        {
          id: "q-all-in",
          supplierName: "شركة الخرسانة المتكاملة (شامل الضخ)",
          unitRateSar: 320,
          status: "quoted",
          includedScopes: ["concrete_supply", "pumping", "pouring_compaction"],
        },
        {
          id: "q-supply-only",
          supplierName: "مصنع توريد فقط + مضخة منفصلة",
          unitRateSar: 285,
          status: "quoted",
          includedScopes: ["concrete_supply"],
          supplementalUnitRateSar: 30, // separate pour/pump labor
          minOrderChargeSar: 1000, // pump min charge over 50m3 = +20 SAR/m3 -> 335 SAR/m3
        },
      ],
    });

    expect(compared[0]?.id).toBe("q-all-in");
    expect(compared[0]?.normalizedUnitRateSar).toBe(320);
    expect(compared[1]?.normalizedUnitRateSar).toBe(335);

    const cov = computeValueAndValidityCoverage([
      { lineSellingPrice: 10000, quote_status: "quoted", pricing_status: "priced" },
      { lineSellingPrice: 5000, quote_status: "expired", pricing_status: "priced" },
      { lineSellingPrice: 5000, quote_status: "reference", pricing_status: "priced" },
    ]);
    expect(cov.totalValueSar).toBe(20000);
    expect(cov.validQuotedValueSar).toBe(10000);
    expect(cov.expiredQuotedValueSar).toBe(5000);
    expect(cov.validCommercialCoveragePct).toBe(50);
  });
});
