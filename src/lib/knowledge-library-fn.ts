import { createServerFn } from "@tanstack/react-start";

export interface ServerPublishPriceEvidenceInput {
  boqItemId: string;
  projectId: string;
  projectName: string;
  clientName?: string | null;
  tenderId?: string | null;
  csiDivision: string;
  scope: "general" | "project" | "typical_assembly";
  linkedAssemblyCode?: string | null;
  taxBasis?: "included" | "excluded" | "unknown";
  priceBasis?: "supply" | "supply_install" | "delivered" | "reference";
  reusable?: boolean;
  lineIds: string[];
  idempotencyKey?: string;
}

export interface ServerReviewTemplateInput {
  templateId: string;
  decision: "approve" | "return_with_comments" | "archive";
  notes?: string;
  promoteToCompany?: boolean;
}

async function resolveAuthenticatedSupabase() {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const authHeader = getRequestHeader("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const supabaseUrl = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const supabaseKey =
    process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

  if (!supabaseUrl || !supabaseKey || !bearerToken) {
    return null;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });
  const { data: userRes, error: userErr } = await client.auth.getUser(bearerToken);
  if (userErr || !userRes?.user) {
    throw new Error("NOT_AUTHENTICATED: جلسة المستخدم غير صالحة أو منتهية.");
  }
  return { client, userId: userRes.user.id };
}

/**
 * Server-validated Price Evidence publisher (§3):
 * Derives resource pricing, units, and supplier quote linkage strictly from stored DB rows
 * rather than accepting client-submitted price figures in hosted production.
 */
export const publishPriceEvidenceServerFn = createServerFn({ method: "POST" })
  .inputValidator((input: ServerPublishPriceEvidenceInput) => input)
  .handler(async ({ data }) => {
    const auth = await resolveAuthenticatedSupabase();
    if (!auth) {
      throw new Error("SERVER_SESSION_REQUIRED: يتطلب النشر الخادمي جلسة مصادقة صالحة.");
    }
    const { client, userId } = auth;

    const { data: paRows, error: paErr } = await client
      .from("price_analysis_items")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("boq_item_id", data.boqItemId)
      .in("id", data.lineIds);

    if (paErr) throw new Error(paErr.message);
    if (!paRows || paRows.length === 0) {
      throw new Error("SOURCE_NOT_FOUND: لم يتم العثور على سطور التحليل المحفوظة في قاعدة البيانات.");
    }

    const { data: proj } = await client
      .from("projects")
      .select("id, company_id, name, client_name")
      .eq("id", data.projectId)
      .maybeSingle();

    if (!proj) {
      throw new Error("NOT_AUTHORIZED: المشروع المحدد غير متاح ضمن صلاحياتك.");
    }

    const priceDate = new Date().toISOString().slice(0, 10);
    const inserted: any[] = [];

    for (const line of paRows as Array<Record<string, any>>) {
      const hasDocQuote = Boolean(line["quote_item_id"]);
      const idem = data.idempotencyKey
        ? `${data.idempotencyKey}:${String(line["id"])}`
        : `${String(line["id"])}:${data.scope}`;

      const payload = {
        workspace_id: userId,
        company_id: proj["company_id"] ?? null,
        resource_id: line["resource_id"] ?? null,
        supplier_quote_id: line["supplier_quote_id"] ?? null,
        quote_item_id: line["quote_item_id"] ?? null,
        project_id: data.projectId,
        tender_id: data.tenderId ?? null,
        boq_item_id: data.boqItemId,
        source_analysis_line_id: line["id"],
        source_type: hasDocQuote ? "supplier_quote" : "analysis_line",
        resource_type: line["resource_type"],
        material_category: line["material_category"] ?? null,
        csi_division: data.csiDivision,
        title_ar: line["description_ar"],
        title_en: line["description_en"] ?? null,
        unit: line["unit"] || "وحدة",
        purchase_unit: line["unit"] || "وحدة",
        conversion_factor: 1,
        direct_unit_price: Number(line["unit_price"] ?? 0),
        original_quote_price: hasDocQuote ? Number(line["unit_price"] ?? 0) : null,
        currency: "SAR",
        tax_basis: data.taxBasis ?? "unknown",
        price_basis: data.priceBasis ?? (hasDocQuote ? "supply" : "reference"),
        price_date: priceDate,
        confidence: hasDocQuote ? "A" : "C",
        verification_status: hasDocQuote ? "approved" : "pending_review",
        reusable: data.reusable ?? data.scope === "general",
        scope: data.scope,
        linked_assembly_code: data.linkedAssemblyCode ?? null,
        source_context_snapshot: {
          project_name: proj["name"] ?? data.projectName,
          client_name: proj["client_name"] ?? data.clientName ?? null,
        },
        idempotency_key: idem,
        created_by: userId,
      };

      const { data: existing } = await client
        .from("knowledge_price_evidence")
        .select("*")
        .eq("source_analysis_line_id", line["id"])
        .eq("scope", data.scope)
        .maybeSingle();

      if (existing) {
        inserted.push(existing);
        continue;
      }

      const { data: row, error: insErr } = await client
        .from("knowledge_price_evidence")
        .insert(payload)
        .select("*")
        .single();

      if (insErr) throw new Error(insErr.message);
      inserted.push(row);
    }

    await client.from("knowledge_audit_logs").insert({
      workspace_id: userId,
      company_id: proj["company_id"] ?? null,
      actor_id: userId,
      action: "price_evidence_published",
      entity_type: "knowledge_price_evidence",
      entity_id: data.boqItemId,
      metadata: { count: inserted.length, scope: data.scope, csiDivision: data.csiDivision },
    });

    return { created: inserted };
  });

/**
 * Server-enforced Template Governance Review (§3):
 * Verifies workspace membership role server-side before approving or returning a template version.
 */
export const reviewTemplateServerFn = createServerFn({ method: "POST" })
  .inputValidator((input: ServerReviewTemplateInput) => input)
  .handler(async ({ data }) => {
    const auth = await resolveAuthenticatedSupabase();
    if (!auth) {
      throw new Error("SERVER_SESSION_REQUIRED: يتطلب الاعتماد جلسة مصادقة صالحة.");
    }
    const { client, userId } = auth;

    const { data: tpl, error: tplErr } = await client
      .from("knowledge_item_templates")
      .select("*")
      .eq("id", data.templateId)
      .single();

    if (tplErr || !tpl) {
      throw new Error("NOT_FOUND: النموذج غير موجود.");
    }

    const { data: member } = await client
      .from("workspace_memberships")
      .select("role")
      .eq("workspace_id", tpl["workspace_id"])
      .eq("user_id", userId)
      .maybeSingle();

    const role = (member as any)?.role ?? (tpl["workspace_id"] === userId ? "data_admin" : "pricing_engineer");
    if (!["discipline_reviewer", "approver", "data_admin"].includes(role)) {
      throw new Error("NOT_AUTHORIZED: اعتماد النماذج يقتصر على المراجع أو رئيس التسعير أو مسؤول البيانات.");
    }

    const nextStatus =
      data.decision === "approve" ? "approved" : data.decision === "archive" ? "archived" : "returned";
    const nextScope = data.decision === "approve" && data.promoteToCompany ? "company" : tpl["scope"];

    const { error: updErr } = await client
      .from("knowledge_item_templates")
      .update({
        status: nextStatus === "returned" ? "draft" : nextStatus,
        scope: nextScope,
        ...(data.promoteToCompany && data.decision === "approve" ? { category_type: "section_item" } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.templateId);

    if (updErr) throw new Error(updErr.message);

    if (tpl["current_version_id"]) {
      await client
        .from("knowledge_template_versions")
        .update({
          status: nextStatus,
          reviewer_notes: data.notes ?? null,
          reviewed_by: userId,
          ...(data.decision === "approve" ? { approved_by: userId, approved_at: new Date().toISOString() } : {}),
        })
        .eq("id", tpl["current_version_id"]);
    }

    await client.from("knowledge_audit_logs").insert({
      workspace_id: tpl["workspace_id"],
      company_id: tpl["company_id"] ?? null,
      actor_id: userId,
      action: `template_${data.decision}`,
      entity_type: "knowledge_item_template",
      entity_id: data.templateId,
      metadata: { notes: data.notes ?? null, nextStatus, nextScope, role },
    });

    return { templateId: data.templateId, approvalStatus: nextStatus, scope: nextScope };
  });
