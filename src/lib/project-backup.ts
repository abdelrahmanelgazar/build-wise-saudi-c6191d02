import { estimationClient } from "./estimation-client";

export interface ProjectBackupSnapshot {
  version: "1.0.0" | "2.0.0";
  exported_at: string;
  project: any;
  boq_items: any[];
  price_analysis_items: any[];
  price_analysis_markup: any[];
  resources: any[];
  supplier_quotes?: any[];
  supplier_quote_items?: any[];
  assembly_coverage_records?: any[];
  boq_excel_versions?: any[];
  project_rfi_addenda?: any[];
  tender_evaluations?: any[];
  metadata: {
    totalItems: number;
    totalAnalyses: number;
    totalSupplierQuotes?: number;
    totalCoverageRecords?: number;
    totalExcelVersions?: number;
    totalRfiAddenda?: number;
    estimatedValue: number;
    checksum?: string;
  };
}

/**
 * Export a complete consistent JSON snapshot of the active project (including supplier quotes & CSI coverage records).
 */
export async function exportProjectBackup(projectId: string): Promise<ProjectBackupSnapshot> {
  const [projectRes, boqRes, paRes, markupRes, resRes, sqRes, covRes, excelVerRes, rfiRes, evalRes] = await Promise.all([
    estimationClient.from("projects").select("*").eq("id", projectId).single(),
    estimationClient.from("boq_items").select("*").eq("project_id", projectId),
    estimationClient.from("price_analysis_items").select("*").eq("project_id", projectId),
    estimationClient.from("price_analysis_markup").select("*").eq("project_id", projectId),
    estimationClient.from("resources").select("*").eq("project_id", projectId),
    estimationClient.from("supplier_quotes").select("*").eq("project_id", projectId),
    estimationClient.from("assembly_coverage_records").select("*").eq("project_id", projectId),
    estimationClient.from("boq_excel_versions").select("*").eq("project_id", projectId),
    estimationClient.from("project_rfi_addenda").select("*").eq("project_id", projectId),
    estimationClient.from("tender_evaluations").select("*").eq("project_id", projectId),
  ]);

  if (projectRes.error) throw projectRes.error;

  const project = projectRes.data;
  const boq_items = (boqRes.data as any[]) ?? [];
  const price_analysis_items = (paRes.data as any[]) ?? [];
  const price_analysis_markup = (markupRes.data as any[]) ?? [];
  const resources = (resRes.data as any[]) ?? [];
  const supplier_quotes = (sqRes.data as any[]) ?? [];
  const assembly_coverage_records = (covRes.data as any[]) ?? [];
  const boq_excel_versions = (excelVerRes.data as any[]) ?? [];
  const project_rfi_addenda = (rfiRes.data as any[]) ?? [];
  const tender_evaluations = (evalRes.data as any[]) ?? [];

  let supplier_quote_items: any[] = [];
  if (supplier_quotes.length > 0) {
    const qIds = new Set(supplier_quotes.map((q) => q.id));
    const { data: sqItemsData } = await estimationClient.from("supplier_quote_items").select("*");
    supplier_quote_items = ((sqItemsData as any[]) ?? []).filter((it) => qIds.has(it.quote_id));
  }

  const snapshot: ProjectBackupSnapshot = {
    version: "2.0.0",
    exported_at: new Date().toISOString(),
    project,
    boq_items,
    price_analysis_items,
    price_analysis_markup,
    resources,
    supplier_quotes,
    supplier_quote_items,
    assembly_coverage_records,
    boq_excel_versions,
    project_rfi_addenda,
    tender_evaluations,
    metadata: {
      totalItems: boq_items.length,
      totalAnalyses: price_analysis_items.length,
      totalSupplierQuotes: supplier_quotes.length,
      totalCoverageRecords: assembly_coverage_records.length,
      totalExcelVersions: boq_excel_versions.length,
      totalRfiAddenda: project_rfi_addenda.length,
      estimatedValue: Number(project.estimated_value ?? 0),
    },
  };

  // Trigger browser download
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
 * Restore a project snapshot into the workspace (backward compatible with v1.0.0 and v2.0.0 snapshots).
 */
export async function restoreProjectBackup(
  snapshot: ProjectBackupSnapshot,
  options: { targetProjectId?: string } = {}
): Promise<{
  projectId: string;
  itemsRestored: number;
  analysesRestored: number;
  resourcesRestored: number;
  quotesRestored: number;
  coverageRestored: number;
}> {
  if (!snapshot.version || !snapshot.project) {
    throw new Error("ملف النسخة الاحتياطية غير صالح أو تالف.");
  }

  const targetProjectId = options.targetProjectId || snapshot.project.id;

  // 1. Restore/Upsert project row
  const projectPayload = {
    ...snapshot.project,
    id: targetProjectId,
    updated_at: new Date().toISOString(),
  };
  await estimationClient.from("projects").upsert(projectPayload, { onConflict: "id" });

  // 2. Restore Resources
  if (snapshot.resources?.length > 0) {
    const resPayload = snapshot.resources.map((r) => ({
      ...r,
      project_id: targetProjectId,
    }));
    await estimationClient.from("resources").upsert(resPayload, { onConflict: "id" });
  }

  // 3. Restore Supplier Quotes & Quote Line Items
  if (snapshot.supplier_quotes?.length) {
    const quotesPayload = snapshot.supplier_quotes.map((q) => ({
      ...q,
      project_id: targetProjectId,
    }));
    await estimationClient.from("supplier_quotes").upsert(quotesPayload, { onConflict: "id" });

    if (snapshot.supplier_quote_items?.length) {
      await estimationClient
        .from("supplier_quote_items")
        .upsert(snapshot.supplier_quote_items, { onConflict: "id" });
    }
  }

  // 4. Restore BOQ items
  if (snapshot.boq_items?.length > 0) {
    const boqPayload = snapshot.boq_items.map((b) => ({
      ...b,
      project_id: targetProjectId,
    }));
    await estimationClient.from("boq_items").upsert(boqPayload, { onConflict: "id" });
  }

  // 5. Restore Price Analysis items
  if (snapshot.price_analysis_items?.length > 0) {
    const paPayload = snapshot.price_analysis_items.map((p) => ({
      ...p,
      project_id: targetProjectId,
    }));
    await estimationClient.from("price_analysis_items").upsert(paPayload, { onConflict: "id" });
  }

  // 6. Restore Price Analysis Markup
  if (snapshot.price_analysis_markup?.length > 0) {
    const markupPayload = snapshot.price_analysis_markup.map((m) => ({
      ...m,
      project_id: targetProjectId,
    }));
    await estimationClient.from("price_analysis_markup").upsert(markupPayload, { onConflict: "boq_item_id" });
  }

  // 7. Restore Assembly Coverage Records
  if (snapshot.assembly_coverage_records?.length) {
    const covPayload = snapshot.assembly_coverage_records.map((c) => ({
      ...c,
      project_id: targetProjectId,
    }));
    await estimationClient
      .from("assembly_coverage_records")
      .upsert(covPayload, { onConflict: "project_id,boq_item_id" });
  }

  // 8. Restore Excel Workbook Versions, RFI/Addenda, and Go/No-Go Evaluations
  if (snapshot.boq_excel_versions?.length) {
    const verPayload = snapshot.boq_excel_versions.map((v) => ({
      ...v,
      project_id: targetProjectId,
    }));
    await estimationClient.from("boq_excel_versions").upsert(verPayload, { onConflict: "id" });
  }
  if (snapshot.project_rfi_addenda?.length) {
    const rfiPayload = snapshot.project_rfi_addenda.map((r) => ({
      ...r,
      project_id: targetProjectId,
    }));
    await estimationClient.from("project_rfi_addenda").upsert(rfiPayload, { onConflict: "id" });
  }
  if (snapshot.tender_evaluations?.length) {
    const evalPayload = snapshot.tender_evaluations.map((ev) => ({
      ...ev,
      project_id: targetProjectId,
    }));
    await estimationClient.from("tender_evaluations").upsert(evalPayload, { onConflict: "id" });
  }

  return {
    projectId: targetProjectId,
    itemsRestored: snapshot.boq_items?.length ?? 0,
    analysesRestored: snapshot.price_analysis_items?.length ?? 0,
    resourcesRestored: snapshot.resources?.length ?? 0,
    quotesRestored: snapshot.supplier_quotes?.length ?? 0,
    coverageRestored: snapshot.assembly_coverage_records?.length ?? 0,
  };
}
