import { estimationClient } from "@/lib/estimation-client";
import type {
  Client,
  ClientType,
  ClientStatus,
  Tender,
  TenderStatus,
  TenderTransition,
} from "@/types/client-tender";

export interface ClientWithStats extends Client {
  projects_count: number;
  active_tenders_count: number;
  total_value: number;
}

export async function fetchClientsWithStats(): Promise<ClientWithStats[]> {
  const [clientsRes, projectsRes, tendersRes] = await Promise.all([
    estimationClient.from("clients").select("*"),
    estimationClient.from("projects").select("id, client_id, client_name, estimated_value"),
    estimationClient.from("tenders").select("id, project_id, client_id, status, estimated_value"),
  ]);

  const rawClients = (clientsRes.data as Client[] | null) ?? [];
  const projects = (projectsRes.data as Record<string, unknown>[] | null) ?? [];
  const tenders = (tendersRes.data as Record<string, unknown>[] | null) ?? [];

  // Auto-seed existing project client if clients table is empty
  if (rawClients.length === 0 && projects.length > 0) {
    const existingClients = new Set<string>();
    projects.forEach((p) => {
      const name = String(p.client_name ?? "").trim();
      if (name) existingClients.add(name);
    });

    for (const name of existingClients) {
      const code = name.includes("صحة") ? "MOH-SA" : `CLI-${Math.floor(100 + Math.random() * 900)}`;
      const newClient: Client = {
        id: crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}`,
        code,
        name,
        type: name.includes("وزارة") || name.includes("هيئة") ? "government" : "private",
        sector: name.includes("صحة") || name.includes("مستشفى") ? "صحي" : "إنشاءات عامة",
        status: "active",
        contacts: [
          {
            id: "1",
            name: "إدارة العقود والمشتريات",
            role: "مدير المنافسات",
            email: "tenders@client.gov.sa",
            phone: "+966 11 000 0000",
            is_primary: true,
          },
        ],
        notes: "تم استيراده تلقائياً من المشاريع القائمة في منصة تقديري",
        created_at: new Date().toISOString(),
      };
      await estimationClient.from("clients").insert(newClient as any);
      rawClients.push(newClient);

      // Link projects matching name
      for (const p of projects) {
        if (p.client_name === name) {
          await estimationClient
            .from("projects")
            .update({ client_id: newClient.id } as any)
            .eq("id", p.id);
          p.client_id = newClient.id;

          // Also seed default tender for this project if no tenders exist
          if (tenders.length === 0) {
            const newTender: Tender = {
              id: crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}`,
              project_id: String(p.id),
              client_id: newClient.id,
              client_name: name,
              tender_no: String(p.code || "TND-2026-01"),
              title: String(p.name || "منافسة تنفيذ الأعمال"),
              package_name: String(p.scope_of_work || "Turnkey"),
              responsible_person: "مهندس العطاءات",
              status: "studying",
              submission_deadline: String(p.last_submit_date || "2026-12-06"),
              submission_time: "14:00",
              estimated_value: Number(p.estimated_value || 0),
              currency: "SAR",
              notes: "منافسة مسجلة تحت المشروع",
              created_at: new Date().toISOString(),
            };
            await estimationClient.from("tenders").insert(newTender as any);
            tenders.push(newTender as any);
          }
        }
      }
    }
  }

  return rawClients.map((client) => {
    const clientProjects = projects.filter(
      (p) => p.client_id === client.id || p.client_name === client.name
    );
    const clientProjectIds = new Set(clientProjects.map((p) => p.id));
    const clientTenders = tenders.filter(
      (t) => t.client_id === client.id || clientProjectIds.has(t.project_id)
    );

    const activeTenders = clientTenders.filter(
      (t) => t.status === "registered" || t.status === "studying" || t.status === "review"
    );

    const totalValue = clientProjects.reduce((sum, p) => sum + Number(p.estimated_value || 0), 0);

    return {
      ...client,
      projects_count: clientProjects.length,
      active_tenders_count: activeTenders.length,
      total_value: totalValue,
    };
  });
}

export async function checkDuplicateClientName(name: string, excludeId?: string): Promise<boolean> {
  const { data } = await estimationClient.from("clients").select("id, name");
  const list = (data as Client[] | null) ?? [];
  const normalized = name.trim().toLowerCase();
  return list.some(
    (c) => c.name.trim().toLowerCase() === normalized && c.id !== excludeId
  );
}

export async function archiveClient(id: string): Promise<void> {
  const { error } = await estimationClient
    .from("clients")
    .update({ status: "archived", updated_at: new Date().toISOString() } as any)
    .eq("id", id);
  if (error) throw error;
}

export async function mergeClients(sourceId: string, targetId: string, reason?: string): Promise<void> {
  const [sourceRes, targetRes] = await Promise.all([
    estimationClient.from("clients").select("*").eq("id", sourceId).single(),
    estimationClient.from("clients").select("*").eq("id", targetId).single(),
  ]);
  const source = sourceRes.data as Client | null;
  const target = targetRes.data as Client | null;
  if (!source || !target) throw new Error("تعذر العثور على العميلين لإتمام عملية الدمج");

  // Transfer all projects from source to target
  await estimationClient
    .from("projects")
    .update({ client_id: target.id, client_name: target.name } as any)
    .eq("client_id", source.id);

  // Transfer all tenders from source to target
  await estimationClient
    .from("tenders")
    .update({ client_id: target.id, client_name: target.name } as any)
    .eq("client_id", source.id);

  // Mark source client as archived with merge note
  await estimationClient
    .from("clients")
    .update({
      status: "archived",
      notes: `تم دمج هذا العميل في "${target.name}" (${target.code}). السبب: ${reason || "دمج حسابات مكررة"}.`,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", source.id);
}

export async function transitionTenderStatus(
  tenderId: string,
  fromStatus: TenderStatus,
  toStatus: TenderStatus,
  reason: string,
  userEmail?: string
): Promise<void> {
  const transition: TenderTransition = {
    id: crypto.randomUUID ? crypto.randomUUID() : `tr-${Date.now()}`,
    tender_id: tenderId,
    from_status: fromStatus,
    to_status: toStatus,
    reason: reason.trim() || null,
    changed_by: userEmail || "مدير العطاءات",
    created_at: new Date().toISOString(),
  };

  await Promise.all([
    estimationClient
      .from("tenders")
      .update({
        status: toStatus,
        status_reason: reason.trim() || null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", tenderId),
    estimationClient.from("tender_transitions").insert(transition as any),
  ]);
}
