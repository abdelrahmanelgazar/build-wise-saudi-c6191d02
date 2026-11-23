import { estimationClient } from "./estimation-client";
import { toast } from "sonner";

export interface ProjectBackupSnapshot {
  version: "1.0.0";
  exported_at: string;
  project: any;
  boq_items: any[];
  price_analysis_items: any[];
  price_analysis_markup: any[];
  resources: any[];
  metadata: {
    totalItems: number;
    totalAnalyses: number;
    estimatedValue: number;
    checksum?: string;
  };
}

/**
 * Export a complete consistent JSON snapshot of the active project
 */
export async function exportProjectBackup(projectId: string): Promise<ProjectBackupSnapshot> {
  const [projectRes, boqRes, paRes, markupRes, resRes] = await Promise.all([
    estimationClient.from("projects").select("*").eq("id", projectId).single(),
    estimationClient.from("boq_items").select("*").eq("project_id", projectId),
    estimationClient.from("price_analysis_items").select("*").eq("project_id", projectId),
    estimationClient.from("price_analysis_markup").select("*").eq("project_id", projectId),
    estimationClient.from("resources").select("*").eq("project_id", projectId),
  ]);

  if (projectRes.error) throw projectRes.error;

  const project = projectRes.data;
  const boq_items = (boqRes.data as any[]) ?? [];
  const price_analysis_items = (paRes.data as any[]) ?? [];
  const price_analysis_markup = (markupRes.data as any[]) ?? [];
  const resources = (resRes.data as any[]) ?? [];

  const snapshot: ProjectBackupSnapshot = {
    version: "1.0.0",
    exported_at: new Date().toISOString(),
    project,
    boq_items,
    price_analysis_items,
    price_analysis_markup,
    resources,
    metadata: {
      totalItems: boq_items.length,
      totalAnalyses: price_analysis_items.length,
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
 * Restore a project snapshot into the workspace
 */
export async function restoreProjectBackup(
  snapshot: ProjectBackupSnapshot,
  options: { targetProjectId?: string } = {}
): Promise<{
  projectId: string;
  itemsRestored: number;
  analysesRestored: number;
  resourcesRestored: number;
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

  // 3. Restore BOQ items
  if (snapshot.boq_items?.length > 0) {
    const boqPayload = snapshot.boq_items.map((b) => ({
      ...b,
      project_id: targetProjectId,
    }));
    await estimationClient.from("boq_items").upsert(boqPayload, { onConflict: "id" });
  }

  // 4. Restore Price Analysis items
  if (snapshot.price_analysis_items?.length > 0) {
    const paPayload = snapshot.price_analysis_items.map((p) => ({
      ...p,
      project_id: targetProjectId,
    }));
    await estimationClient.from("price_analysis_items").upsert(paPayload, { onConflict: "id" });
  }

  // 5. Restore Price Analysis Markup
  if (snapshot.price_analysis_markup?.length > 0) {
    const markupPayload = snapshot.price_analysis_markup.map((m) => ({
      ...m,
      project_id: targetProjectId,
    }));
    await estimationClient.from("price_analysis_markup").upsert(markupPayload, { onConflict: "boq_item_id" });
  }

  return {
    projectId: targetProjectId,
    itemsRestored: snapshot.boq_items?.length ?? 0,
    analysesRestored: snapshot.price_analysis_items?.length ?? 0,
    resourcesRestored: snapshot.resources?.length ?? 0,
  };
}
