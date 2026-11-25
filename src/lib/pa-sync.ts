import { estimationClient } from "@/lib/estimation-client";
import { computeDirectUnitCost, type ResourceCostInput } from "@/lib/estimation-calc";

export type BoqRateSource = "analysis" | "manual" | "imported" | "none";
export type BoqPricingStatus = "priced" | "unpriced" | "included";

/**
 * Synchronizes a BOQ item's stored cost columns, rate_source, and pricing_status
 * with its current price_analysis_items rows (Section 7 contract).
 *
 * - When PA items exist (> 0 rows): rate_source becomes "analysis" (unless active manual override).
 * - When the last PA item is deleted (0 rows): stored cost columns are cleared to 0,
 *   any previously imported unit rate is preserved ONLY in `imported_unit_rate` as reference,
 *   and `pricing_status` becomes "unpriced" (or "included" / "priced" if manual/included).
 */
export async function syncBoqItemBreakdownFromPa(boqItemId: string): Promise<{
  material_cost: number;
  labor_cost: number;
  equipment_cost: number;
  subcontractor_cost: number;
  rate_source: BoqRateSource;
  pricing_status: BoqPricingStatus;
}> {
  const [paRes, boqRes] = await Promise.all([
    estimationClient
      .from("price_analysis_items")
      .select("resource_type, quantity, unit_price, waste_pct, productivity, cell_styles")
      .eq("boq_item_id", boqItemId),
    estimationClient
      .from("boq_items")
      .select(
        "material_cost, labor_cost, equipment_cost, subcontractor_cost, manual_unit_price, is_included_elsewhere, rate_source, imported_unit_rate",
      )
      .eq("id", boqItemId)
      .maybeSingle(),
  ]);

  if (paRes.error) throw paRes.error;
  if (boqRes.error) throw boqRes.error;

  const rows = (paRes.data as ResourceCostInput[] | null) ?? [];
  const boq = (boqRes.data as Record<string, any> | null) ?? {};

  const hasManual = Number(boq["manual_unit_price"] ?? 0) > 0;
  const isIncluded = Boolean(boq["is_included_elsewhere"]);
  const priorStoredTotal =
    Number(boq["material_cost"] ?? 0) +
    Number(boq["labor_cost"] ?? 0) +
    Number(boq["equipment_cost"] ?? 0) +
    Number(boq["subcontractor_cost"] ?? 0);

  const preservedImported =
    boq["imported_unit_rate"] != null
      ? Number(boq["imported_unit_rate"])
      : boq["rate_source"] !== "analysis" && priorStoredTotal > 0
        ? priorStoredTotal
        : null;

  const breakdown = computeDirectUnitCost(rows);

  const rate_source: BoqRateSource = hasManual
    ? "manual"
    : rows.length > 0
      ? "analysis"
      : "analysis";

  const pricing_status: BoqPricingStatus = isIncluded
    ? "included"
    : hasManual || (rows.length > 0 && breakdown.directUnitCost > 0)
      ? "priced"
      : "unpriced";

  const patch = {
    material_cost: rows.length > 0 ? breakdown.materialCost : 0,
    labor_cost: rows.length > 0 ? breakdown.laborCost : 0,
    equipment_cost: rows.length > 0 ? breakdown.equipmentCost : 0,
    subcontractor_cost: rows.length > 0 ? breakdown.subcontractorCost : 0,
    rate_source,
    pricing_status,
    ...(preservedImported != null ? { imported_unit_rate: preservedImported } : {}),
  };

  const { error: updErr } = await estimationClient
    .from("boq_items")
    .update(patch)
    .eq("id", boqItemId);

  if (updErr) throw updErr;
  return {
    material_cost: patch.material_cost,
    labor_cost: patch.labor_cost,
    equipment_cost: patch.equipment_cost,
    subcontractor_cost: patch.subcontractor_cost,
    rate_source,
    pricing_status,
  };
}

/** Explicitly clears manual price override so pricing returns to analysis (or unpriced if empty). */
export async function clearManualPriceForBoqItem(boqItemId: string): Promise<void> {
  const { error } = await estimationClient
    .from("boq_items")
    .update({ manual_unit_price: null })
    .eq("id", boqItemId);
  if (error) throw error;
  await syncBoqItemBreakdownFromPa(boqItemId);
}

/** Explicitly restores the saved imported reference rate only on intentional user action. */
export async function restoreImportedRateForBoqItem(boqItemId: string): Promise<void> {
  const { data, error } = await estimationClient
    .from("boq_items")
    .select("imported_unit_rate")
    .eq("id", boqItemId)
    .maybeSingle();
  if (error) throw error;
  const imported = Number((data as any)?.imported_unit_rate ?? 0);
  if (imported <= 0) throw new Error("لا يوجد سعر مستورد محفوظ لهذا البند");

  const { error: updErr } = await estimationClient
    .from("boq_items")
    .update({
      material_cost: imported,
      labor_cost: 0,
      equipment_cost: 0,
      subcontractor_cost: 0,
      manual_unit_price: null,
      rate_source: "imported",
      pricing_status: "priced",
    })
    .eq("id", boqItemId);
  if (updErr) throw updErr;
}

/** Upserts coverage lineage & exception evidence for a BOQ item across manual edits, Excel import, quotes, or templates. */
export async function syncCoverageRecordFromAnalysis(params: {
  projectId: string | null;
  boqItemId: string;
  userId: string;
  assemblyId?: string;
  assemblyCode?: string | null;
  csiDivision?: string | null;
  coverageStatus?: "matched" | "gap" | "manual" | "reference_only";
  includedScopes?: string[];
  excludedScopes?: string[];
  evidenceNote?: string | null;
}): Promise<void> {
  if (!params.projectId) return;
  const { data: existing } = await estimationClient
    .from("assembly_coverage_records")
    .select("*")
    .eq("project_id", params.projectId)
    .eq("boq_item_id", params.boqItemId)
    .maybeSingle();

  await estimationClient
    .from("assembly_coverage_records")
    .upsert(
      {
        project_id: params.projectId,
        boq_item_id: params.boqItemId,
        user_id: params.userId,
        assembly_id: params.assemblyId ?? existing?.assembly_id ?? "manual-analysis",
        assembly_code: params.assemblyCode ?? existing?.assembly_code ?? "MANUAL-PA",
        assembly_version: existing?.assembly_version ?? 1,
        csi_division: params.csiDivision ?? existing?.csi_division ?? null,
        coverage_status: params.coverageStatus ?? (existing?.coverage_status as any) ?? "manual",
        included_scopes: params.includedScopes ?? (existing?.included_scopes as any) ?? [],
        excluded_scopes: params.excludedScopes ?? (existing?.excluded_scopes as any) ?? [],
        evidence_note:
          params.evidenceNote !== undefined ? params.evidenceNote : (existing?.evidence_note ?? null),
      },
      { onConflict: "project_id,boq_item_id" },
    );
}
