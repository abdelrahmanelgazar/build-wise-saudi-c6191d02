import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_PRICING_POLICY,
  evaluateCanonicalReferenceCases,
} from "@/lib/estimation-calc";
import {
  resetKnowledgeLibraryMemoryForTests,
  reviewKnowledgeTemplateVersion,
  saveAnalysisAsTemplate,
} from "@/lib/knowledge-library-service";
import {
  buildSubmissionWorkbookBytes,
  reconcileWorkbookBinary,
  stageSubmissionPreparation,
} from "@/lib/submission-preparation";
import {
  executeUnifiedTenderSubmission,
  getSubmittedTenderSnapshots,
  submitTenderVersion,
} from "@/lib/client-tender-service";
import { retrieveSubmissionArtifact } from "@/lib/submission-storage";

// Mock Route tree imports lightly if only helper is tested
import { normalizeQuotationTab } from "@/routes/_authenticated/resources";

describe("TENDER_ASSURANCE_HARDENING_PLAN Verification Suite", () => {
  beforeEach(() => {
    resetKnowledgeLibraryMemoryForTests();
  });

  it("1. Resources Category Dropdown: normalizes valid ?tab values and falls back invalid to 'all'", () => {
    expect(normalizeQuotationTab("supplier_quotes")).toBe("supplier_quotes");
    expect(normalizeQuotationTab("price_evidence")).toBe("price_evidence");
    expect(normalizeQuotationTab("by_project")).toBe("by_project");
    expect(normalizeQuotationTab("typical_assembly_offers")).toBe("typical_assembly_offers");
    expect(normalizeQuotationTab("general_requirements")).toBe("general_requirements");
    expect(normalizeQuotationTab("invalid_unknown_tab")).toBe("all");
    expect(normalizeQuotationTab(undefined)).toBe("all");
  });

  it("2. Chief Estimator Calibration Suite: exact manual fractional, deleted-last-resource, included, steel ton->kg", () => {
    expect(CANONICAL_PRICING_POLICY.policyCode).toBe("additive_v2");
    expect(CANONICAL_PRICING_POLICY.roundingPolicy).toBe("roundup_integer_sar");

    const cases = evaluateCanonicalReferenceCases();
    const byKey = new Map(cases.map((c) => [c.caseKey, c.pricing]));

    const man = byKey.get("manual_fractional")!;
    expect(man.lineDirectCost).toBe(10);
    expect(man.approvedUnitRate).toBe(7);
    expect(man.lineSellingPrice).toBe(17.5);

    const del = byKey.get("deleted_last_resource")!;
    expect(del.directUnitCost).toBe(0);
    expect(del.approvedUnitRate).toBe(0);
    expect(del.isUnpriced).toBe(true);

    const inc = byKey.get("included_elsewhere")!;
    expect(inc.directUnitCost).toBe(0);
    expect(inc.approvedUnitRate).toBe(0);
    expect(inc.isUnpriced).toBe(false);

    const steel = byKey.get("steel_ton_to_kg")!;
    // 120 * 1.05 * 2.85 = 359.10 direct -> +10% = 395.01 -> ROUNDUP = 396
    expect(steel.directUnitCost).toBe(359.1);
    expect(steel.approvedUnitRate).toBe(396);
  });

  it("3. Atomic Knowledge Save: enforces idempotency, stale source detection, RBAC, and rollback on failure", async () => {
    const srcCtx = {
      project_id: "proj-h1",
      project_name: "مشروع الاختبار",
      boq_item_id: "boq-h1",
      boq_item_no: "03-10",
      captured_at: new Date().toISOString(),
    };
    const resList = [
      {
        id: "r1",
        resource_type: "material" as const,
        description_ar: "خرسانة جاهزة",
        description_en: "Ready Mix",
        unit: "م³",
        quantity: 1,
        unit_price: 260,
      },
    ];

    // Atomic failure before persist -> must roll back and leave zero stored templates
    await expect(
      saveAnalysisAsTemplate({
        code: "FAIL-ATOM-01",
        titleAr: "نموذج فاشل",
        csiDivision: "03",
        unit: "م³",
        categoryType: "project_item",
        resources: resList,
        sourceContext: srcCtx,
        simulateFailureAtStep: "audit",
      }),
    ).rejects.toThrow("TRANSACTION_ROLLED_BACK");

    // Stale source concurrency conflict
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { updated_at: "2026-11-26T15:00:00.000Z" } }),
          }),
        }),
      }),
    } as any;

    await expect(
      saveAnalysisAsTemplate(
        {
          code: "STALE-01",
          titleAr: "نموذج قديم",
          csiDivision: "03",
          unit: "م³",
          categoryType: "project_item",
          resources: resList,
          sourceContext: srcCtx,
          expectedBoqUpdatedAt: "2026-11-26T10:00:00.000Z",
        },
        fakeClient,
      ),
    ).rejects.toThrow("STALE_SOURCE");

    // Clean atomic save + idempotent repeat + RBAC block on pricing_engineer
    const saved1 = await saveAnalysisAsTemplate({
      code: "GOOD-ATOM-01",
      titleAr: "خرسانة قواعد",
      csiDivision: "03",
      unit: "م³",
      categoryType: "project_item",
      resources: resList,
      sourceContext: srcCtx,
      idempotencyKey: "idem-good-1",
    });
    const saved2 = await saveAnalysisAsTemplate({
      code: "GOOD-ATOM-01",
      titleAr: "خرسانة قواعد",
      csiDivision: "03",
      unit: "م³",
      categoryType: "project_item",
      resources: resList,
      sourceContext: srcCtx,
      idempotencyKey: "idem-good-1",
    });
    expect(saved2.templateId).toBe(saved1.templateId);

    await expect(
      reviewKnowledgeTemplateVersion({
        templateId: saved1.templateId,
        decision: "approve",
        actorId: "eng-1",
        actorRole: "pricing_engineer",
      }),
    ).rejects.toThrow("NOT_AUTHORIZED");
  });

  it("4. Multi-Sheet Client Original Workbook: preserves hidden sheets, handles duplicate item_no across sheets, and detects binary cell tamper", async () => {
    // Build multi-sheet workbook with hidden sheet & duplicate item_no "01-01" on two sheets
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ["رقم البند", "التوصيف", "الكمية", "السعر", "الإجمالي"],
      ["01-01", "أعمال خرسانة", 10, null, { f: "C2*D2", t: "n", v: 0 }],
      ["", "المجموع", "", "", { f: "SUM(E2:E2)", t: "n", v: 0 }],
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["رقم البند", "التوصيف", "الكمية", "السعر", "الإجمالي"],
      ["01-01", "أعمال دهانات", 20, null, { f: "C2*D2", t: "n", v: 0 }],
    ]);
    const wsHidden = XLSX.utils.aoa_to_sheet([["Notes", "Hidden spec sheet"]]);
    XLSX.utils.book_append_sheet(wb, ws1, "03_Structural");
    XLSX.utils.book_append_sheet(wb, ws2, "09_Finishes");
    XLSX.utils.book_append_sheet(wb, wsHidden, "_InternalNotes");
    wb.Workbook = { Sheets: [{}, {}, { Hidden: 1 }] };

    const origB64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

    const rows = [
      {
        id: "b-struct",
        item_no: "01-01",
        description_ar: "أعمال خرسانة",
        unit: "م³",
        quantity: 10,
        is_group: false,
        rate_source: "manual",
        manual_unit_price: 100.25,
        sheet_name: "03_Structural",
        rate_cell_ref: "D2",
        total_cell_ref: "E2",
      },
      {
        id: "b-fin",
        item_no: "01-01",
        description_ar: "أعمال دهانات",
        unit: "م²",
        quantity: 20,
        is_group: false,
        rate_source: "manual",
        manual_unit_price: 50,
        sheet_name: "09_Finishes",
        rate_cell_ref: "D2",
        total_cell_ref: "E2",
      },
    ];

    const { bytes, workbookMode } = buildSubmissionWorkbookBytes({
      rows,
      originalWorkbookB64: origB64,
    });
    expect(workbookMode).toBe("client_original");

    const okCheck = await reconcileWorkbookBinary({
      bytes,
      workbookMode: "client_original",
      expectedSheetNames: ["03_Structural", "09_Finishes", "_InternalNotes"],
      expectedFormulaTotals: [{ sheetName: "03_Structural", cellRef: "E3", expectedTotal: 1010 }],
      rows,
    });
    expect(okCheck.matched).toBe(true);
    expect(okCheck.boqNetTotal).toBe(10 * 101 + 20 * 50); // 1010 + 1000 = 2010
    expect(okCheck.sheetNames).toEqual(["03_Structural", "09_Finishes", "_InternalNotes"]);

    // Tamper D2 cell in sheet 09_Finishes and confirm binary check catches sheet & cell coordinate
    const tamperedWb = XLSX.read(bytes, { type: "array", cellFormula: true });
    tamperedWb.Sheets["09_Finishes"]!["D2"] = { t: "n", v: 99 };
    const tamperedBytes = new Uint8Array(XLSX.write(tamperedWb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);

    const failCheck = await reconcileWorkbookBinary({
      bytes: tamperedBytes,
      workbookMode: "client_original",
      rows,
    });
    expect(failCheck.matched).toBe(false);
    expect(failCheck.mismatches.some((m) => m.sheetName === "09_Finishes" && m.cellRef === "D2" && m.field === "rate")).toBe(true);
  });

  it("5. Unified Submission Gate, Staging Isolation, Idempotency Conflict, Concurrency & Artifact Proof", async () => {
    const tenderId = `tnd-hard-${Date.now()}`;
    const projectId = `proj-hard-${Date.now()}`;
    const boqItems = [
      {
        id: "item-1",
        item_no: "03-01",
        description_ar: "خرسانة مسلحة",
        unit: "م³",
        quantity: 2.5,
        is_group: false,
        manual_unit_price: 6.25,
      },
    ];

    // Failure on storage upload -> must NOT create any submission snapshot
    await expect(
      executeUnifiedTenderSubmission({
        tenderId,
        projectId,
        actorId: "approver-1",
        actorRole: "approver",
        readinessInputHash: "h_1",
        readinessOverallState: "READY",
        boqItems,
        useOriginalWorkbook: false,
        simulateUploadFailure: true,
      }),
    ).rejects.toThrow("STORAGE_UPLOAD_FAILED");
    expect(getSubmittedTenderSnapshots(tenderId).length).toBe(0);

    // Failure on read-back SHA check -> must clean up & lock nothing
    await expect(
      executeUnifiedTenderSubmission({
        tenderId,
        projectId,
        actorId: "approver-1",
        actorRole: "approver",
        readinessInputHash: "h_1",
        readinessOverallState: "READY",
        boqItems,
        useOriginalWorkbook: false,
        simulateReadbackMismatch: true,
      }),
    ).rejects.toThrow("STORAGE_HASH_MISMATCH");
    expect(getSubmittedTenderSnapshots(tenderId).length).toBe(0);

    // Concurrent calls with SAME idempotency key produce 1 locked snapshot
    const idemKey = `idem-conc-${Date.now()}`;
    const [resA, resB] = await Promise.all([
      executeUnifiedTenderSubmission({
        tenderId,
        projectId,
        actorId: "approver-1",
        actorRole: "approver",
        idempotencyKey: idemKey,
        readinessInputHash: "h_1",
        readinessOverallState: "READY",
        boqItems,
        useOriginalWorkbook: false,
      }),
      executeUnifiedTenderSubmission({
        tenderId,
        projectId,
        actorId: "approver-1",
        actorRole: "approver",
        idempotencyKey: idemKey,
        readinessInputHash: "h_1",
        readinessOverallState: "READY",
        boqItems,
        useOriginalWorkbook: false,
      }),
    ]);

    expect(resA.snapshot.id).toBe(resB.snapshot.id);
    expect(resA.snapshot.netSellingPrice).toBe(17.5);
    expect(resA.snapshot.hasVerifiedFileProof).toBe(true);
    expect(getSubmittedTenderSnapshots(tenderId).length).toBe(1);

    // Retrieving artifact proves stored file exists & SHA-256 matches
    const retrieved = await retrieveSubmissionArtifact({
      storagePath: resA.snapshot.storagePath ?? null,
      expectedSha256: resA.snapshot.exportSha256 ?? null,
      ...(resA.snapshot.hasVerifiedFileProof !== undefined
        ? { hasVerifiedFileProof: resA.snapshot.hasVerifiedFileProof }
        : {}),
    });
    expect(retrieved.verified).toBe(true);
    expect(retrieved.sha256).toBe(resA.staging.exportSha256);

    // Reusing SAME idempotency key with DIFFERENT amount fails with IDEMPOTENCY_CONFLICT
    await expect(
      submitTenderVersion({
        tenderId,
        projectId,
        idempotencyKey: idemKey,
        userId: "approver-1",
        actorRole: "approver",
        boqItems: [
          {
            ...boqItems[0]!,
            manual_unit_price: 99,
          },
        ],
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");

    // Legacy snapshot without stored file proof rejects download verification with explicit label error
    await expect(
      retrieveSubmissionArtifact({
        storagePath: "archive-ref://old",
        expectedSha256: null,
        hasVerifiedFileProof: false,
      }),
    ).rejects.toThrow("LEGACY_SNAPSHOT_NO_FILE_PROOF");
  });

  it("6. Hardening SQL Migration 000007 drops old RPC overloads and locks permissions", () => {
    const sqlPath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20261126000007_assurance_hardening_and_staging.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.submission_stagings");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.submit_tender_version(");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.save_knowledge_template_atomic(");
    expect(sql).toContain("IDEMPOTENCY_CONFLICT");
    expect(sql).toContain("STALE_VERSION");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.submit_tender_version");
  });
});
