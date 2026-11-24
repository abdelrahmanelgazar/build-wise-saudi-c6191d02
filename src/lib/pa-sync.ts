import { estimationClient } from "@/lib/estimation-client";
import { computeDirectUnitCost, type ResourceCostInput } from "@/lib/estimation-calc";

/**
 * Synchronizes a BOQ item's stored cost columns (material_cost, labor_cost,
 * equipment_cost, subcontractor_cost) with its current price_analysis_items rows.
 * When all breakdown rows are deleted or zeroed, the BOQ item columns are updated
 * to 0 so stale imported/template values never linger in BOQ or Financial views.
 */
export async function syncBoqItemBreakdownFromPa(boqItemId: string): Promise<{
  material_cost: number;
  labor_cost: number;
  equipment_cost: number;
  subcontractor_cost: number;
}> {
  const { data, error } = await estimationClient
    .from("price_analysis_items")
    .select("resource_type, quantity, unit_price, waste_pct, productivity, cell_styles")
    .eq("boq_item_id", boqItemId);

  if (error) throw error;

  const rows = (data as ResourceCostInput[] | null) ?? [];
  const breakdown = computeDirectUnitCost(rows);

  const patch = {
    material_cost: breakdown.materialCost,
    labor_cost: breakdown.laborCost,
    equipment_cost: breakdown.equipmentCost,
    subcontractor_cost: breakdown.subcontractorCost,
  };

  const { error: updErr } = await estimationClient
    .from("boq_items")
    .update(patch)
    .eq("id", boqItemId);

  if (updErr) throw updErr;
  return patch;
}
