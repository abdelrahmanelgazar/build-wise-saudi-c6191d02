import { estimationClient } from "./estimation-client";
import { getSubmittedTenderSnapshotsByProject } from "./client-tender-service";

export interface ProjectBackupSnapshot {
  version: "1.0.0" | "2.0.0" | "2.1.0";
  exported_at: string;
  project: any;
  tenders?: any[];
  tender_transitions?: any[];
  tender_submissions?: any[];
  boq_excel_versions?: any[];
  boq_items: any[];
  price_analysis_items: any[];
  price_analysis_markup: any[];
  resources: any[];
  supplier_quotes?: any[];
  supplier_quote_items?: any[];
  assembly_coverage_records?: any[];
  project_rfi_addenda?: any[];
  tender_evaluations?: any[];
  metadata: {
    totalItems: number;
    totalAnalyses: number;
    totalTenders?: number;
    totalSubmissions?: number;
    totalSupplierQuotes?: number;
    totalCoverageRecords?: number;
    totalExcelVersions?: number;
    totalRfiAddenda?: number;
    totalsByCurrency?: Record<string, number>;
    estimatedValue: number;
    checksum?: string;
  };
}

export type RestoreBackupMode = "restore_in_place" | "clone_as_new";

export interface RestoreBackupResult {
  mode: RestoreBackupMode;
  projectId: string;
  itemsRestored: number;
  analysesRestored: number;
  resourcesRestored: number;
  quotesRestored: number;
  coverageRestored: number;
  tendersRestored: number;
  submissionsRestored: number;
  excelVersionsRestored: number;
}

function assertWriteOk(res: { error?: { message?: string } | null } | null | undefined, step: string) {
  if (res?.error) {
    throw new Error(`فشل عملية الاستعادة في المرحلة [${step}]: ${res.error.message || "خطأ غير معروف"}`);
  }
}

function computeSnapshotChecksum(payload: unknown): string {
  const str = JSON.stringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Export a complete consistent JSON snapshot of the active project
 * including tenders, tender transitions, immutable submissions, Excel versions, quotes, and coverage.
 */
export async function exportProjectBackup(projectId: string): Promise<ProjectBackupSnapshot> {
  const [
    projectRes,
    tendersRes,
    boqRes,
    paRes,
    markupRes,
    resRes,
    sqRes,
    covRes,
    excelVerRes,
    rfiRes,
    evalRes,
    dbSubRes,
  ] = await Promise.all([
    estimationClient.from("projects").select("*").eq("id", projectId).single(),
    estimationClient.from("tenders").select("*").eq("project_id", projectId),
    estimationClient.from("boq_items").select("*").eq("project_id", projectId),
    estimationClient.from("price_analysis_items").select("*").eq("project_id", projectId),
    estimationClient.from("price_analysis_markup").select("*").eq("project_id", projectId),
    estimationClient.from("resources").select("*").eq("project_id", projectId),
    estimationClient.from("supplier_quotes").select("*").eq("project_id", projectId),
    estimationClient.from("assembly_coverage_records").select("*").eq("project_id", projectId),
    estimationClient.from("boq_excel_versions").select("*").eq("project_id", projectId),
    estimationClient.from("project_rfi_addenda").select("*").eq("project_id", projectId),
    estimationClient.from("tender_evaluations").select("*").eq("project_id", projectId),
    estimationClient.from("tender_submissions").select("*").eq("project_id", projectId),
  ]);

  if (projectRes.error) throw projectRes.error;

  const project = projectRes.data;
  const tenders = (tendersRes.data as any[]) ?? [];
  const boq_items = (boqRes.data as any[]) ?? [];
  const price_analysis_items = (paRes.data as any[]) ?? [];
  const price_analysis_markup = (markupRes.data as any[]) ?? [];
  const resources = (resRes.data as any[]) ?? [];
  const supplier_quotes = (sqRes.data as any[]) ?? [];
  const assembly_coverage_records = (covRes.data as any[]) ?? [];
  const boq_excel_versions = (excelVerRes.data as any[]) ?? [];
  const project_rfi_addenda = (rfiRes.data as any[]) ?? [];
  const tender_evaluations = (evalRes.data as any[]) ?? [];

  let tender_transitions: any[] = [];
  if (tenders.length > 0) {
    const tIds = new Set(tenders.map((t) => t.id));
    const { data: trData } = await estimationClient.from("tender_transitions").select("*");
    tender_transitions = ((trData as any[]) ?? []).filter((tr) => tIds.has(tr.tender_id));
  }

  let supplier_quote_items: any[] = [];
  if (supplier_quotes.length > 0) {
    const qIds = new Set(supplier_quotes.map((q) => q.id));
    const { data: sqItemsData } = await estimationClient.from("supplier_quote_items").select("*");
    supplier_quote_items = ((sqItemsData as any[]) ?? []).filter((it) => qIds.has(it.quote_id));
  }

  // Merge DB tender_submissions with any local-mode snapshots
  const dbSubs = (dbSubRes.data as any[]) ?? [];
  const localSubs = getSubmittedTenderSnapshotsByProject(projectId);
  const subIds = new Set(dbSubs.map((s) => s.id));
  const mergedSubmissions = [
    ...dbSubs,
    ...localSubs
      .filter((ls) => !subIds.has(ls.id))
      .map((ls) => ({
        id: ls.id,
        tender_id: ls.tenderId,
        project_id: ls.projectId,
        version_no: ls.versionNo,
        idempotency_key: ls.idempotencyKey,
        currency: ls.currency,
        pricing_policy: ls.pricingPolicy,
        document_ref: ls.documentRef ?? null,
        total_direct_cost: ls.totalDirectCost,
        net_selling_price: ls.netSellingPrice,
        vat_rate: ls.vatRate,
        vat_amount: ls.vatAmount,
        grand_total_with_vat: ls.grandTotalWithVat,
        items_snapshot: ls.items,
        submitted_by: ls.submittedBy,
        submitted_at: ls.submittedAt,
      })),
  ];

  const totalsByCurrency: Record<string, number> = {};
  for (const s of mergedSubmissions) {
    const cur = String(s.currency || "SAR");
    totalsByCurrency[cur] = (totalsByCurrency[cur] ?? 0) + Number(s.net_selling_price ?? 0);
  }

  const snapshot: ProjectBackupSnapshot = {
    version: "2.1.0",
    exported_at: new Date().toISOString(),
    project,
    tenders,
    tender_transitions,
    tender_submissions: mergedSubmissions,
    boq_excel_versions,
    boq_items,
    price_analysis_items,
    price_analysis_markup,
    resources,
    supplier_quotes,
    supplier_quote_items,
    assembly_coverage_records,
    project_rfi_addenda,
    tender_evaluations,
    metadata: {
      totalItems: boq_items.length,
      totalAnalyses: price_analysis_items.length,
      totalTenders: tenders.length,
      totalSubmissions: mergedSubmissions.length,
      totalSupplierQuotes: supplier_quotes.length,
      totalCoverageRecords: assembly_coverage_records.length,
      totalExcelVersions: boq_excel_versions.length,
      totalRfiAddenda: project_rfi_addenda.length,
      totalsByCurrency,
      estimatedValue: Number(project.estimated_value ?? 0),
    },
  };
  snapshot.metadata.checksum = computeSnapshotChecksum({
    projectId: project.id,
    tenders: tenders.length,
    submissions: mergedSubmissions.length,
    items: boq_items.length,
    totalsByCurrency,
  });

  if (typeof window !== "undefined") {
    const jsonStr = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (project.name || "project").replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, "_");
    const dateStr = new Date().toISOString().split("T")[0];
    a.href = url;
    a.download = `taqdiri-backup-${safeName}-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return snapshot;
}

/**
 * Restores a project snapshot explicitly either in-place (preserving original IDs for the same project)
 * OR as an isolated clone (`mode: "clone_as_new"`) with newly minted UUIDs and remapped dependencies.
 * Every write is checked for errors and ordered by foreign-key dependency (`projects -> tenders -> excel_versions -> resources -> quotes -> boq -> pa -> submissions`).
 */
export async function restoreProjectBackup(
  snapshot: ProjectBackupSnapshot,
  options: {
    targetProjectId?: string;
    mode?: RestoreBackupMode;
    newProjectName?: string;
    simulateFailureAtStep?: string;
    client?: typeof estimationClient;
  } = {},
): Promise<RestoreBackupResult> {
  const db = options.client ?? estimationClient;
  if (!snapshot.version || !snapshot.project) {
    throw new Error("ملف النسخة الاحتياطية غير صالح أو تالف.");
  }

  const inferredMode: RestoreBackupMode =
    options.mode ??
    (options.targetProjectId && options.targetProjectId !== snapshot.project.id
      ? "clone_as_new"
      : "restore_in_place");

  if (
    inferredMode === "restore_in_place" &&
    options.targetProjectId &&
    options.targetProjectId !== snapshot.project.id
  ) {
    throw new Error(
      "استعادة مشروع بمعرّف مختلف تتطلب وضع النسخ المستقل (clone_as_new) لحماية بيانات المشروع الأصلي.",
    );
  }

  const targetProjectId =
    inferredMode === "clone_as_new"
      ? options.targetProjectId || crypto.randomUUID()
      : snapshot.project.id;

  const isClone = inferredMode === "clone_as_new";
  const failIf = (step: string) => {
    if (options.simulateFailureAtStep === step) {
      throw new Error(`فشل متعمد في مرحلة الاستعادة [${step}] — تم التراجع النظيف.`);
    }
  };

  // Remap maps when cloning into a fresh independent project
  const tenderMap = new Map<string, string>();
  const excelVerMap = new Map<string, string>();
  const resourceMap = new Map<string, string>();
  const quoteMap = new Map<string, string>();
  const boqMap = new Map<string, string>();

  const mapId = (map: Map<string, string>, oldId: string | null | undefined): string | null => {
    if (!oldId) return null;
    if (!isClone) return oldId;
    const existing = map.get(oldId);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    map.set(oldId, fresh);
    return fresh;
  };

  for (const t of snapshot.tenders ?? []) mapId(tenderMap, t.id);
  for (const ev of snapshot.boq_excel_versions ?? []) mapId(excelVerMap, ev.id);
  for (const r of snapshot.resources ?? []) mapId(resourceMap, r.id);
  for (const q of snapshot.supplier_quotes ?? []) mapId(quoteMap, q.id);
  for (const b of snapshot.boq_items ?? []) mapId(boqMap, b.id);

  let projectCreated = false;

  try {
    // 1. Project root
    failIf("projects");
    const projectPayload = {
      ...snapshot.project,
      id: targetProjectId,
      name: isClone && options.newProjectName ? options.newProjectName : snapshot.project.name,
      updated_at: new Date().toISOString(),
    };
    const projRes = await db.from("projects").upsert(projectPayload, { onConflict: "id" });
    assertWriteOk(projRes, "projects");
    projectCreated = true;

    // 2. Tenders (before boq_items, excel_versions, transitions, submissions)
    if (snapshot.tenders?.length) {
      failIf("tenders");
      const tendersPayload = snapshot.tenders.map((t) => ({
        ...t,
        id: mapId(tenderMap, t.id),
        project_id: targetProjectId,
      }));
      const res = await db.from("tenders").upsert(tendersPayload, { onConflict: "id" });
      assertWriteOk(res, "tenders");
    }

    // 3. Excel Workbook Versions (MUST precede boq_items because boq_items.excel_version_id references it)
    if (snapshot.boq_excel_versions?.length) {
      failIf("boq_excel_versions");
      const verPayload = snapshot.boq_excel_versions.map((v) => ({
        ...v,
        id: mapId(excelVerMap, v.id),
        project_id: targetProjectId,
        tender_id: mapId(tenderMap, v.tender_id),
      }));
      const res = await db.from("boq_excel_versions").upsert(verPayload, { onConflict: "id" });
      assertWriteOk(res, "boq_excel_versions");
    }

    // 4. Resources
    if (snapshot.resources?.length) {
      failIf("resources");
      const resPayload = snapshot.resources.map((r) => ({
        ...r,
        id: mapId(resourceMap, r.id),
        project_id: targetProjectId,
      }));
      const res = await db.from("resources").upsert(resPayload, { onConflict: "id" });
      assertWriteOk(res, "resources");
    }

    // 5. Supplier Quotes & Quote Line Items
    if (snapshot.supplier_quotes?.length) {
      failIf("supplier_quotes");
      const quotesPayload = snapshot.supplier_quotes.map((q) => ({
        ...q,
        id: mapId(quoteMap, q.id),
        project_id: targetProjectId,
        tender_id: mapId(tenderMap, q.tender_id),
      }));
      const qRes = await db.from("supplier_quotes").upsert(quotesPayload, { onConflict: "id" });
      assertWriteOk(qRes, "supplier_quotes");

      if (snapshot.supplier_quote_items?.length) {
        const qItemsPayload = snapshot.supplier_quote_items.map((qi) => ({
          ...qi,
          id: isClone ? crypto.randomUUID() : qi.id,
          quote_id: mapId(quoteMap, qi.quote_id) || qi.quote_id,
          resource_id: mapId(resourceMap, qi.resource_id),
        }));
        const qiRes = await db
          .from("supplier_quote_items")
          .upsert(qItemsPayload, { onConflict: "id" });
        assertWriteOk(qiRes, "supplier_quote_items");
      }
    }

    // 6. BOQ Items (sorted by hierarchy level so parent_id always exists prior to children)
    if (snapshot.boq_items?.length) {
      failIf("boq_items");
      const sortedBoq = [...snapshot.boq_items].sort(
        (a, b) => Number(a.level ?? 0) - Number(b.level ?? 0),
      );
      const boqPayload = sortedBoq.map((b) => ({
        ...b,
        id: mapId(boqMap, b.id),
        project_id: targetProjectId,
        parent_id: mapId(boqMap, b.parent_id),
        tender_id: mapId(tenderMap, b.tender_id),
        excel_version_id: mapId(excelVerMap, b.excel_version_id),
      }));
      const res = await db.from("boq_items").upsert(boqPayload, { onConflict: "id" });
      assertWriteOk(res, "boq_items");
    }

    // 7. Price Analysis Items
    if (snapshot.price_analysis_items?.length) {
      failIf("price_analysis_items");
      const paPayload = snapshot.price_analysis_items.map((p) => ({
        ...p,
        id: isClone ? crypto.randomUUID() : p.id,
        project_id: targetProjectId,
        boq_item_id: mapId(boqMap, p.boq_item_id) || p.boq_item_id,
        resource_id: mapId(resourceMap, p.resource_id),
        supplier_quote_id: mapId(quoteMap, p.supplier_quote_id),
        tender_id: mapId(tenderMap, p.tender_id),
      }));
      const res = await db.from("price_analysis_items").upsert(paPayload, { onConflict: "id" });
      assertWriteOk(res, "price_analysis_items");
    }

    // 8. Price Analysis Markup
    if (snapshot.price_analysis_markup?.length) {
      failIf("price_analysis_markup");
      const mkPayload = snapshot.price_analysis_markup.map((m) => ({
        ...m,
        boq_item_id: mapId(boqMap, m.boq_item_id) || m.boq_item_id,
        project_id: targetProjectId,
        tender_id: mapId(tenderMap, m.tender_id),
      }));
      const res = await db
        .from("price_analysis_markup")
        .upsert(mkPayload, { onConflict: "boq_item_id" });
      assertWriteOk(res, "price_analysis_markup");
    }

    // 9. Assembly Coverage Records
    if (snapshot.assembly_coverage_records?.length) {
      failIf("assembly_coverage_records");
      const covPayload = snapshot.assembly_coverage_records.map((c) => ({
        ...c,
        id: isClone ? crypto.randomUUID() : c.id,
        project_id: targetProjectId,
        boq_item_id: mapId(boqMap, c.boq_item_id) || c.boq_item_id,
        tender_id: mapId(tenderMap, c.tender_id),
      }));
      const res = await db
        .from("assembly_coverage_records")
        .upsert(covPayload, { onConflict: "project_id,boq_item_id" });
      assertWriteOk(res, "assembly_coverage_records");
    }

    // 10. RFI / Addenda & Go/No-Go Evaluations
    if (snapshot.project_rfi_addenda?.length) {
      failIf("project_rfi_addenda");
      const rfiPayload = snapshot.project_rfi_addenda.map((r) => ({
        ...r,
        id: isClone ? crypto.randomUUID() : r.id,
        project_id: targetProjectId,
        tender_id: mapId(tenderMap, r.tender_id),
      }));
      const res = await db.from("project_rfi_addenda").upsert(rfiPayload, { onConflict: "id" });
      assertWriteOk(res, "project_rfi_addenda");
    }

    if (snapshot.tender_evaluations?.length) {
      failIf("tender_evaluations");
      const evalPayload = snapshot.tender_evaluations.map((ev) => ({
        ...ev,
        id: isClone ? crypto.randomUUID() : ev.id,
        project_id: targetProjectId,
        tender_id: mapId(tenderMap, ev.tender_id),
      }));
      const res = await db.from("tender_evaluations").upsert(evalPayload, { onConflict: "id" });
      assertWriteOk(res, "tender_evaluations");
    }

    // 11. Tender Transitions & Immutable Submissions History
    if (snapshot.tender_transitions?.length) {
      failIf("tender_transitions");
      const trPayload = snapshot.tender_transitions.map((tr) => ({
        ...tr,
        id: isClone ? crypto.randomUUID() : tr.id,
        tender_id: mapId(tenderMap, tr.tender_id) || tr.tender_id,
      }));
      const res = await db.from("tender_transitions").upsert(trPayload, { onConflict: "id" });
      assertWriteOk(res, "tender_transitions");
    }

    if (snapshot.tender_submissions?.length) {
      failIf("tender_submissions");
      const subPayload = snapshot.tender_submissions.map((s) => ({
        ...s,
        id: isClone ? crypto.randomUUID() : s.id,
        project_id: targetProjectId,
        tender_id: mapId(tenderMap, s.tender_id) || s.tender_id,
        idempotency_key: isClone ? `clone-${targetProjectId.slice(0, 8)}-${s.idempotency_key}` : s.idempotency_key,
      }));
      // Insert new cloned submissions safely; in-place skips existing immutable rows via ignoreDuplicates / conflict check
      for (const row of subPayload) {
        if (isClone) {
          const ins = await db.from("tender_submissions").insert(row);
          assertWriteOk(ins, "tender_submissions");
        } else {
          const { data: existingSub } = await db
            .from("tender_submissions")
            .select("id")
            .eq("id", row.id)
            .maybeSingle();
          if (!existingSub) {
            const ins = await db.from("tender_submissions").insert(row);
            assertWriteOk(ins, "tender_submissions");
          }
        }
      }
    }

    return {
      mode: inferredMode,
      projectId: targetProjectId,
      itemsRestored: snapshot.boq_items?.length ?? 0,
      analysesRestored: snapshot.price_analysis_items?.length ?? 0,
      resourcesRestored: snapshot.resources?.length ?? 0,
      quotesRestored: snapshot.supplier_quotes?.length ?? 0,
      coverageRestored: snapshot.assembly_coverage_records?.length ?? 0,
      tendersRestored: snapshot.tenders?.length ?? 0,
      submissionsRestored: snapshot.tender_submissions?.length ?? 0,
      excelVersionsRestored: snapshot.boq_excel_versions?.length ?? 0,
    };
  } catch (err) {
    // Clean rollback when a clone operation fails mid-flight so no half-cloned project leaks
    if (isClone && projectCreated) {
      await db.from("projects").delete().eq("id", targetProjectId);
    }
    throw err;
  }
}
