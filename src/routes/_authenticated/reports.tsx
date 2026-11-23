import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Printer, FileSpreadsheet, FolderKanban, Calculator, Database as DatabaseIcon, FileBarChart } from "lucide-react";
import { fmtSAR } from "@/lib/format";
import * as XLSX from "xlsx";
import type { Database } from "@/integrations/supabase/types";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Status = Database["public"]["Enums"]["project_status"];
type BoqItem = Database["public"]["Tables"]["boq_items"]["Row"];
type Resource = Database["public"]["Tables"]["resources"]["Row"];

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  studying: { label: "قيد الدراسة", cls: "bg-muted/60 text-muted-foreground border-border/60" },
  submitted_to_medial_man: { label: "مُرسل للوسيط (GM)", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  submitted_to_client: { label: "مُرسل للعميل", cls: "bg-primary/15 text-primary border-primary/30" },
  waiting_for_reply: { label: "بانتظار الرد", cls: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" },
  inquiries_sent: { label: "استفسارات للعميل", cls: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30" },
  answers_received: { label: "ردود مستلمة - دراسة", cls: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30" },
  on_hold: { label: "مُعلّق", cls: "bg-orange-500/15 text-orange-500 border-orange-500/30" },
  client_rejected: { label: "رفض العميل", cls: "bg-red-500/15 text-red-500 border-red-500/30" },
  construction_ongoing: { label: "تنفيذ جاري", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  construction_complete: { label: "تنفيذ مكتمل", cls: "bg-teal-500/15 text-teal-500 border-teal-500/30" },
  finished: { label: "منتهي", cls: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  closed: { label: "مغلق", cls: "bg-muted/60 text-muted-foreground border-border/60" },
};

const RES_LABEL: Record<string, string> = { material: "مواد", labor: "عمالة", equipment: "معدات" };

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: 'التقارير — تقديري' }, { name: "description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:title", content: 'التقارير — تقديري' }, { property: "og:description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <div className="p-6 print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">التقارير</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            تقارير المشاريع، جداول الكميات، الموارد، والملخص التنفيذي — مع تصدير Excel وطباعة PDF.
          </p>
        </div>
      </div>

      <Tabs defaultValue="projects" className="mt-6">
        <TabsList className="print:hidden">
          <TabsTrigger value="projects" className="gap-1.5"><FolderKanban className="h-4 w-4" /> المشاريع</TabsTrigger>
          <TabsTrigger value="boq" className="gap-1.5"><Calculator className="h-4 w-4" /> BOQ التفصيلي</TabsTrigger>
          <TabsTrigger value="resources" className="gap-1.5"><DatabaseIcon className="h-4 w-4" /> عروض الأسعار</TabsTrigger>
          <TabsTrigger value="summary" className="gap-1.5"><FileBarChart className="h-4 w-4" /> الملخص التنفيذي</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4"><ProjectsReport /></TabsContent>
        <TabsContent value="boq" className="mt-4"><BoqReport /></TabsContent>
        <TabsContent value="resources" className="mt-4"><ResourcesReport /></TabsContent>
        <TabsContent value="summary" className="mt-4"><ExecutiveSummary /></TabsContent>
      </Tabs>
    </div>
  );
}

function Toolbar({ title, onExcel }: { title: string; onExcel: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onExcel} className="gap-1.5">
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
          <Printer className="h-4 w-4" /> طباعة / PDF
        </Button>
      </div>
    </div>
  );
}

/* ============== 1) PROJECTS REPORT ============== */
function ProjectsReport() {
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["report-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects").select("*").order("project_no", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  const filtered = useMemo(
    () => projects.filter((p) => statusFilter === "all" || p.status === statusFilter),
    [projects, statusFilter],
  );

  const totals = useMemo(() => {
    const est = filtered.reduce((s, p) => s + Number(p.estimated_value ?? 0), 0);
    const bud = filtered.reduce((s, p) => s + Number(p.budget ?? 0), 0);
    return { count: filtered.length, est, bud };
  }, [filtered]);

  const exportExcel = () => {
    const rows = filtered.map((p) => ({
      "No": p.project_no ?? "",
      "Code": p.code ?? "",
      "اسم المشروع": p.name,
      "العميل": p.client_name ?? "",
      "الموقع": p.location ?? "",
      "المنطقة": (p as any).area ?? "",
      "نطاق العمل": (p as any).scope_of_work ?? "",
      "نوع التعاقد": (p as any).contract_type ?? "",
      "الحالة": STATUS_META[p.status]?.label ?? p.status,
      "دخول المناقصة": (p as any).tender_entry_date ?? "",
      "آخر تقديم": (p as any).last_submit_date ?? "",
      "آخر استفسارات": (p as any).last_rfi_date ?? "",
      "مدة المشروع": (p as any).duration ?? "",
      "القيمة التقديرية": Number(p.estimated_value ?? 0),
      "الميزانية": Number(p.budget ?? 0),
      "ملاحظات": (p as any).note ?? "",
    }));
    downloadXlsx(rows, "projects-report", "المشاريع");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Toolbar title="تقرير المشاريع" onExcel={exportExcel} />

      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as Status | "all")}>
          <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {(Object.keys(STATUS_META) as Status[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">{filtered.length} مشروع</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Stat label="عدد المشاريع" value={String(totals.count)} />
        <Stat label="إجمالي القيمة التقديرية" value={fmtSAR(totals.est)} hl />
        <Stat label="إجمالي الميزانية" value={fmtSAR(totals.bud)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1100px] text-right text-xs">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">No</th>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">اسم المشروع</th>
              <th className="px-3 py-2 font-medium">العميل</th>
              <th className="px-3 py-2 font-medium">الموقع</th>
              <th className="px-3 py-2 font-medium">الحالة</th>
              <th className="px-3 py-2 font-medium">مدة المشروع</th>
              <th className="px-3 py-2 font-medium">القيمة (ر.س)</th>
              <th className="px-3 py-2 font-medium">الميزانية (ر.س)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">جاري التحميل…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">لا توجد مشاريع</td></tr>
            )}
            {filtered.map((p) => {
              const m = STATUS_META[p.status];
              return (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums">{p.project_no ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{(p as any).code || "—"}</td>
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.client_name || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.location || "—"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className={m.cls}>{m.label}</Badge></td>
                  <td className="px-3 py-2 text-muted-foreground">{(p as any).duration || "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtSAR(Number(p.estimated_value ?? 0))}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtSAR(Number(p.budget ?? 0))}</td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="bg-muted/40 font-medium">
              <tr>
                <td colSpan={7} className="px-3 py-2 text-left">الإجمالي</td>
                <td className="px-3 py-2 tabular-nums">{fmtSAR(totals.est)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtSAR(totals.bud)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ============== 2) BOQ REPORT ============== */
function BoqReport() {
  const [projectId, setProjectId] = useState<string>("");

  const { data: projects = [] } = useQuery({
    queryKey: ["report-boq-projects-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects").select("id,name,project_no,code,client_name")
        .order("project_no", { ascending: false });
      if (error) throw error;
      return data as Array<Pick<Project, "id" | "name" | "project_no" | "code" | "client_name">>;
    },
  });

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0]?.id ?? "");
  }, [projectId, projects]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["report-boq", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boq_items").select("*").eq("project_id", projectId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as BoqItem[];
    },
  });

  const project = projects.find((p) => p.id === projectId);

  const rows = useMemo(() => items.map((b) => {
    const unitCost = Number(b.material_cost ?? 0) + Number(b.labor_cost ?? 0)
      + Number(b.equipment_cost ?? 0) + Number(b.subcontractor_cost ?? 0);
    const total = b.is_group ? 0 : Number(b.quantity ?? 0) * unitCost;
    return { b, unitCost, total };
  }), [items]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  const exportExcel = () => {
    if (!project) return;
    const data = rows.map(({ b, unitCost, total }) => ({
      "البند": b.item_no,
      "الوصف": b.description_ar,
      "الوحدة": b.unit ?? "",
      "الكمية": b.is_group ? "" : Number(b.quantity ?? 0),
      "مواد": Number(b.material_cost ?? 0),
      "عمالة": Number(b.labor_cost ?? 0),
      "معدات": Number(b.equipment_cost ?? 0),
      "مقاولين باطن": Number(b.subcontractor_cost ?? 0),
      "سعر الوحدة": unitCost,
      "الإجمالي": b.is_group ? "" : total,
    }));
    downloadXlsx(data, `boq-${project.name}`, "BOQ");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Toolbar title="تقرير BOQ التفصيلي" onExcel={exportExcel} />

      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-9 w-80"><SelectValue placeholder="اختر مشروعاً…" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.project_no ? `#${p.project_no} — ` : ""}{p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!projectId && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          اختر مشروعاً لعرض تقرير BOQ التفصيلي.
        </div>
      )}

      {projectId && project && (
        <>
          <div className="mb-3 text-sm text-muted-foreground print:mb-4">
            <span className="font-semibold text-foreground">{project.name}</span>
            {project.client_name && <> · العميل: {project.client_name}</>}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-right text-xs">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">البند</th>
                  <th className="px-3 py-2 font-medium">الوصف</th>
                  <th className="px-3 py-2 font-medium">الوحدة</th>
                  <th className="px-3 py-2 font-medium">الكمية</th>
                  <th className="px-3 py-2 font-medium">سعر الوحدة</th>
                  <th className="px-3 py-2 font-medium">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">جاري التحميل…</td></tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">لا توجد بنود</td></tr>
                )}
                {rows.map(({ b, unitCost, total }) => (
                  <tr key={b.id} className={b.is_group ? "bg-muted/30 font-semibold" : "hover:bg-muted/20"}>
                    <td className="px-3 py-2 font-mono text-[11px]">{b.item_no}</td>
                    <td className="px-3 py-2">{b.description_ar}</td>
                    <td className="px-3 py-2 text-muted-foreground">{b.unit ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{b.is_group ? "" : Number(b.quantity ?? 0)}</td>
                    <td className="px-3 py-2 tabular-nums">{b.is_group ? "" : fmtSAR(unitCost)}</td>
                    <td className="px-3 py-2 tabular-nums">{b.is_group ? "" : fmtSAR(total)}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-muted/40 font-medium">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-left">الإجمالي العام</td>
                    <td className="px-3 py-2 tabular-nums">{fmtSAR(grandTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ============== 3) RESOURCES REPORT ============== */
function ResourcesReport() {
  const [type, setType] = useState<"all" | "material" | "labor" | "equipment">("all");

  const { data: resources = [], isLoading } = useQuery({
    queryKey: ["report-resources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources").select("*").order("type").order("code", { ascending: true });
      if (error) throw error;
      return data as Resource[];
    },
  });

  const filtered = useMemo(
    () => resources.filter((r) => type === "all" || r.type === type),
    [resources, type],
  );

  const byType = useMemo(() => {
    const out: Record<string, number> = { material: 0, labor: 0, equipment: 0 };
    resources.forEach((r) => { out[r.type] = (out[r.type] ?? 0) + 1; });
    return out;
  }, [resources]);

  const exportExcel = () => {
    const rows = filtered.map((r) => ({
      "الكود": r.code ?? "",
      "النوع": RES_LABEL[r.type] ?? r.type,
      "الاسم": r.name_ar,
      "الوحدة": r.unit,
      "سعر الوحدة": Number(r.unit_price ?? 0),
      "ملاحظات": r.notes ?? "",
    }));
    downloadXlsx(rows, "resources-report", "الموارد");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Toolbar title="تقرير عروض الأسعار والموارد" onExcel={exportExcel} />

      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
          <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="material">مواد</SelectItem>
            <SelectItem value="labor">عمالة</SelectItem>
            <SelectItem value="equipment">معدات</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Stat label="مواد" value={String(byType["material"] ?? 0)} />
        <Stat label="عمالة" value={String(byType["labor"] ?? 0)} />
        <Stat label="معدات" value={String(byType["equipment"] ?? 0)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[800px] text-right text-xs">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">الكود</th>
              <th className="px-3 py-2 font-medium">النوع</th>
              <th className="px-3 py-2 font-medium">الاسم</th>
              <th className="px-3 py-2 font-medium">الوحدة</th>
              <th className="px-3 py-2 font-medium">سعر الوحدة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">جاري التحميل…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">لا توجد موارد</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-[11px]">{r.code || "—"}</td>
                <td className="px-3 py-2">{RES_LABEL[r.type] ?? r.type}</td>
                <td className="px-3 py-2">{r.name_ar}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.unit}</td>
                <td className="px-3 py-2 tabular-nums">{fmtSAR(Number(r.unit_price ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============== 4) EXECUTIVE SUMMARY ============== */
function ExecutiveSummary() {
  const [projectId, setProjectId] = useState<string>("");

  const { data: projects = [] } = useQuery({
    queryKey: ["report-summary-projects-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects").select("id,name,project_no,client_name,location,status,estimated_value,budget")
        .order("project_no", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0]?.id ?? "");
  }, [projectId, projects]);

  const project = projects.find((p) => p.id === projectId);

  const { data: stats } = useQuery({
    queryKey: ["report-stats", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const [boq, res] = await Promise.all([
        supabase.from("boq_items").select("quantity,material_cost,labor_cost,equipment_cost,subcontractor_cost,is_group").eq("project_id", projectId),
        supabase.from("resources").select("type").eq("project_id", projectId),
      ]);
      const items = (boq.data ?? []).filter((b) => !b.is_group);
      const total = items.reduce(
        (s, b) => s + Number(b.quantity ?? 0) *
          (Number(b.material_cost ?? 0) + Number(b.labor_cost ?? 0)
            + Number(b.equipment_cost ?? 0) + Number(b.subcontractor_cost ?? 0)),
        0,
      );
      const resByType: Record<string, number> = { material: 0, labor: 0, equipment: 0 };
      (res.data ?? []).forEach((r: any) => { resByType[r.type] = (resByType[r.type] ?? 0) + 1; });
      return {
        boqCount: items.length, boqTotal: total,
        resourcesCount: (res.data ?? []).length, resByType,
      };
    },
  });

  const exportExcel = () => {
    if (!project) return;
    const rows = [
      { "البند": "اسم المشروع", "القيمة": project.name },
      { "البند": "العميل", "القيمة": project.client_name ?? "—" },
      { "البند": "الموقع", "القيمة": project.location ?? "—" },
      { "البند": "الحالة", "القيمة": STATUS_META[project.status]?.label ?? project.status },
      { "البند": "القيمة التقديرية", "القيمة": Number(project.estimated_value ?? 0) },
      { "البند": "الميزانية", "القيمة": Number(project.budget ?? 0) },
      { "البند": "إجمالي تكلفة BOQ", "القيمة": stats?.boqTotal ?? 0 },
      { "البند": "عدد بنود BOQ", "القيمة": stats?.boqCount ?? 0 },
      { "البند": "عدد الموارد", "القيمة": stats?.resourcesCount ?? 0 },
      { "البند": "مواد", "القيمة": stats?.resByType["material"] ?? 0 },
      { "البند": "عمالة", "القيمة": stats?.resByType["labor"] ?? 0 },
      { "البند": "معدات", "القيمة": stats?.resByType["equipment"] ?? 0 },
    ];
    downloadXlsx(rows, `summary-${project.name}`, "ملخص");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Toolbar title="الملخص التنفيذي للمشروع" onExcel={exportExcel} />

      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-9 w-80"><SelectValue placeholder="اختر مشروعاً…" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.project_no ? `#${p.project_no} — ` : ""}{p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!project && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          اختر مشروعاً لعرض الملخص التنفيذي.
        </div>
      )}

      {project && (
        <>
          <div className="mb-4">
            <h3 className="text-xl font-bold">{project.name}</h3>
            <div className="mt-1 text-sm text-muted-foreground">
              {project.client_name || "—"} · {project.location || "—"} ·{" "}
              <Badge variant="outline" className={STATUS_META[project.status].cls}>
                {STATUS_META[project.status].label}
              </Badge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="القيمة التقديرية" value={fmtSAR(Number(project.estimated_value ?? 0))} />
            <Stat label="الميزانية" value={fmtSAR(Number(project.budget ?? 0))} />
            <Stat label="إجمالي تكلفة BOQ" value={fmtSAR(stats?.boqTotal ?? 0)} hl />
            <Stat label="بنود BOQ" value={String(stats?.boqCount ?? 0)} sub={`${stats?.resourcesCount ?? 0} مورد`} />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label="مواد" value={String(stats?.resByType["material"] ?? 0)} />
            <Stat label="عمالة" value={String(stats?.resByType["labor"] ?? 0)} />
            <Stat label="معدات" value={String(stats?.resByType["equipment"] ?? 0)} />
          </div>

          {project.estimated_value && stats?.boqTotal ? (
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-4 text-sm">
              <div className="font-medium">الهامش التقديري</div>
              <div className="mt-1 text-muted-foreground">
                {fmtSAR(Number(project.estimated_value) - stats.boqTotal)} ({((1 - stats.boqTotal / Number(project.estimated_value)) * 100).toFixed(1)}%)
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ============== Helpers ============== */
function Stat({ label, value, sub, hl }: { label: string; value: string; sub?: string; hl?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${hl ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${hl ? "text-primary" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function downloadXlsx(rows: Array<Record<string, any>>, filename: string, sheetName: string) {
  if (rows.length === 0) {
    rows = [{ "—": "لا توجد بيانات" }];
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
