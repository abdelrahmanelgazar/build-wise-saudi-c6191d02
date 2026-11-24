import { estimationClient } from "@/lib/estimation-client";

export interface MigrationRowReport {
  entity: "boq_items" | "price_analysis_items" | "projects";
  id: string;
  status: "migrated" | "already_migrated" | "unclassified_company";
  details: string;
}

export interface MigrationSummary {
  boqItemsScanned: number;
  boqItemsMigrated: number;
  paItemsScanned: number;
  paItemsMigrated: number;
  projectsScanned: number;
  projectsUnclassifiedCompany: number;
  rows: MigrationRowReport[];
}

/**
 * Repeatable & idempotent migration from `cell_styles` JSON keys to explicit business columns
 * and company classification (Section 2 of PLATFORM_INDEPENDENCE_AND_NAVIGATION_PLAN.md).
 * Running this twice produces the exact same DB state and links.
 */
export async function runTransitionalDataMigration(): Promise<MigrationSummary> {
  const rows: MigrationRowReport[] = [];
  let boqItemsMigrated = 0;
  let paItemsMigrated = 0;
  let projectsUnclassifiedCompany = 0;

  const [boqRes, paRes, projRes] = await Promise.all([
    estimationClient.from("boq_items").select("id, note, cell_styles"),
    estimationClient
      .from("price_analysis_items")
      .select("id, material_category, line_note, quote_id, unit_price, unit, quantity, copied_unit_price, copied_unit, consumption_rate, cell_styles"),
    estimationClient.from("projects").select("id, name, client_name, company_name"),
  ]);

  const boqList = (boqRes.data as Array<Record<string, any>> | null) ?? [];
  for (const item of boqList) {
    const legacyNote = typeof item["cell_styles"]?.["note"] === "string" ? String(item["cell_styles"]["note"]) : null;
    if (!item["note"] && legacyNote) {
      await estimationClient.from("boq_items").update({ note: legacyNote } as any).eq("id", item["id"]);
      boqItemsMigrated++;
      rows.push({ entity: "boq_items", id: String(item["id"]), status: "migrated", details: "نقل الملاحظة من cell_styles.note" });
    } else {
      rows.push({ entity: "boq_items", id: String(item["id"]), status: "already_migrated", details: "محدّث مسبقاً" });
    }
  }

  const paList = (paRes.data as Array<Record<string, any>> | null) ?? [];
  for (const item of paList) {
    const cs = (item["cell_styles"] ?? {}) as Record<string, any>;
    const patch: Record<string, unknown> = {};
    if (!item["material_category"] && (cs["material_category"] === "primary" || cs["material_category"] === "accessory")) {
      patch["material_category"] = cs["material_category"];
    }
    const legacyNote = typeof cs["note"] === "string" ? cs["note"] : typeof cs["line_note"] === "string" ? cs["line_note"] : null;
    if (!item["line_note"] && legacyNote) patch["line_note"] = legacyNote;
    if (!item["quote_id"] && typeof cs["quote_id"] === "string") patch["quote_id"] = cs["quote_id"];
    if (item["copied_unit_price"] == null && item["unit_price"] != null) patch["copied_unit_price"] = item["unit_price"];
    if (!item["copied_unit"] && item["unit"]) patch["copied_unit"] = item["unit"];
    if (item["consumption_rate"] == null && item["quantity"] != null) patch["consumption_rate"] = item["quantity"];

    if (Object.keys(patch).length > 0) {
      await estimationClient.from("price_analysis_items").update(patch as any).eq("id", item["id"]);
      paItemsMigrated++;
      rows.push({
        entity: "price_analysis_items",
        id: String(item["id"]),
        status: "migrated",
        details: `ترحيل الحقول: ${Object.keys(patch).join(", ")}`,
      });
    } else {
      rows.push({ entity: "price_analysis_items", id: String(item["id"]), status: "already_migrated", details: "محدّث مسبقاً" });
    }
  }

  const projList = (projRes.data as Array<Record<string, any>> | null) ?? [];
  for (const proj of projList) {
    const comp = String(proj["company_name"] ?? "").trim();
    const cli = String(proj["client_name"] ?? "").trim();
    if (!comp && !cli) {
      projectsUnclassifiedCompany++;
      await estimationClient
        .from("projects")
        .update({ company_name: "شركة غير محددة" } as any)
        .eq("id", proj["id"]);
      rows.push({
        entity: "projects",
        id: String(proj["id"]),
        status: "unclassified_company",
        details: `تصنيف "${proj["name"]}" ضمن شركة غير محددة للمراجعة`,
      });
    } else if (!comp && cli) {
      await estimationClient
        .from("projects")
        .update({ company_name: cli } as any)
        .eq("id", proj["id"]);
      rows.push({
        entity: "projects",
        id: String(proj["id"]),
        status: "migrated",
        details: `تعيين الشركة المبدئية من العميل: ${cli}`,
      });
    } else {
      rows.push({ entity: "projects", id: String(proj["id"]), status: "already_migrated", details: comp });
    }
  }

  return {
    boqItemsScanned: boqList.length,
    boqItemsMigrated,
    paItemsScanned: paList.length,
    paItemsMigrated,
    projectsScanned: projList.length,
    projectsUnclassifiedCompany,
    rows,
  };
}
