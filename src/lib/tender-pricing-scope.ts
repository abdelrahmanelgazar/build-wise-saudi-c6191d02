import { estimationClient } from "./estimation-client";

export interface TenderScopedRow {
  tender_id?: string | null;
}

/**
 * Filters BOQ / Price Analysis / Markup / Coverage rows by active tender scope:
 * - activeTenderId === null -> returns baseline project rows (tender_id is null/undefined)
 * - activeTenderId !== null -> returns rows strictly isolated to that tender_id
 */
export function scopeRowsByTender<T extends TenderScopedRow>(
  rows: T[],
  activeTenderId: string | null | undefined,
): T[] {
  if (!activeTenderId) {
    return rows.filter((r) => !r.tender_id);
  }
  return rows.filter((r) => r.tender_id === activeTenderId);
}

/**
 * Clones the project's baseline BOQ, Price Analysis lines, Markups, and Coverage records
 * into an isolated study for a specific tender opportunity (`tender_id`) so multiple tenders
 * under the same project can carry completely independent rates and totals.
 */
export async function cloneBaselineStudyToTender(params: {
  projectId: string;
  targetTenderId: string;
}): Promise<{ clonedItems: number; clonedAnalyses: number }> {
  const { projectId, targetTenderId } = params;
  const { data: userData } = await estimationClient.auth.getUser();
  const userId = userData.user?.id || "00000000-0000-0000-0000-000000000000";

  const [boqRes, paRes, mkRes, covRes] = await Promise.all([
    estimationClient.from("boq_items").select("*").eq("project_id", projectId),
    estimationClient.from("price_analysis_items").select("*").eq("project_id", projectId),
    estimationClient.from("price_analysis_markup").select("*").eq("project_id", projectId),
    estimationClient.from("assembly_coverage_records").select("*").eq("project_id", projectId),
  ]);

  const allBoq = (boqRes.data as any[]) ?? [];
  const existingTarget = allBoq.filter((r) => r.tender_id === targetTenderId);
  if (existingTarget.length > 0) {
    throw new Error("توجد بالفعل دراسة تسعير منفصلة لهذه الفرصة.");
  }

  const baselineBoq = allBoq.filter((r) => !r.tender_id);
  if (baselineBoq.length === 0) {
    return { clonedItems: 0, clonedAnalyses: 0 };
  }

  // Sort parents before children so parent_id remapping stays valid
  const sortedBaseline = [...baselineBoq].sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0));
  const idMap = new Map<string, string>();
  for (const row of sortedBaseline) {
    idMap.set(row.id, crypto.randomUUID());
  }

  const newBoqPayload = sortedBaseline.map((row) => ({
    ...row,
    id: idMap.get(row.id)!,
    parent_id: row.parent_id ? (idMap.get(row.parent_id) ?? null) : null,
    tender_id: targetTenderId,
    user_id: userId,
    created_at: undefined,
    updated_at: undefined,
  }));

  const { error: boqErr } = await estimationClient.from("boq_items").insert(newBoqPayload as any);
  if (boqErr) throw boqErr;

  const baselinePa = ((paRes.data as any[]) ?? []).filter((p) => !p.tender_id && idMap.has(p.boq_item_id));
  if (baselinePa.length > 0) {
    const newPaPayload = baselinePa.map((p) => ({
      ...p,
      id: crypto.randomUUID(),
      boq_item_id: idMap.get(p.boq_item_id)!,
      tender_id: targetTenderId,
      user_id: userId,
      created_at: undefined,
    }));
    const { error: paErr } = await estimationClient.from("price_analysis_items").insert(newPaPayload as any);
    if (paErr) throw paErr;
  }

  const baselineMk = ((mkRes.data as any[]) ?? []).filter((m) => !m.tender_id && idMap.has(m.boq_item_id));
  if (baselineMk.length > 0) {
    const newMkPayload = baselineMk.map((m) => ({
      ...m,
      id: idMap.get(m.boq_item_id)!,
      boq_item_id: idMap.get(m.boq_item_id)!,
      tender_id: targetTenderId,
      user_id: userId,
      updated_at: undefined,
    }));
    const { error: mkErr } = await estimationClient.from("price_analysis_markup").upsert(newMkPayload as any, { onConflict: "boq_item_id" });
    if (mkErr) throw mkErr;
  }

  const baselineCov = ((covRes.data as any[]) ?? []).filter((c) => !c.tender_id && idMap.has(c.boq_item_id));
  if (baselineCov.length > 0) {
    const newCovPayload = baselineCov.map((c) => ({
      ...c,
      id: crypto.randomUUID(),
      boq_item_id: idMap.get(c.boq_item_id)!,
      tender_id: targetTenderId,
      user_id: userId,
      created_at: undefined,
      updated_at: undefined,
    }));
    await estimationClient.from("assembly_coverage_records").insert(newCovPayload as any);
  }

  return { clonedItems: newBoqPayload.length, clonedAnalyses: baselinePa.length };
}
