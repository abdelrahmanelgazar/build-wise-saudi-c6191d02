import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { estimationClient } from "@/lib/estimation-client";
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
import { Download, Printer, FileSpreadsheet, FolderKanban, Calculator, Database as DatabaseIcon, FileBarChart, BarChart3 } from "lucide-react";
import { fmtSAR } from "@/lib/format";
import {
  computeDirectUnitCost,
  computeProjectFinancials,
  computeUnitSellingPrice,
  resolveBoqItemPricing,
  roundTo,
  type MarkupSettings,
  type ResourceCostInput,
} from "@/lib/estimation-calc";
import { computeProjectCoverageStats } from "@/lib/csi-assemblies-engine";
import { getAllBreakdownTemplates } from "@/lib/breakdown-library";
import { csiDivisionCode } from "@/lib/csi-divisions";
import { getSubmittedTenderSnapshots } from "@/lib/client-tender-service";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";
import { useActiveTenderId } from "@/lib/active-project";
import { scopeRowsByTender } from "@/lib/tender-pricing-scope";
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
  useRegisterPageActions({
    pageKey: "reports",
    hasEditableState: false,
    queryKeys: [["report-projects"], ["report-boq"], ["report-resources"], ["report-stats"]],
  });

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
          <TabsTrigger value="coverage" className="gap-1.5"><BarChart3 className="h-4 w-4" /> التغطية والفجوات CSI</TabsTrigger>
          <TabsTrigger value="summary" className="gap-1.5"><FileBarChart className="h-4 w-4" /> الملخص التنفيذي</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4"><ProjectsReport /></TabsContent>
        <TabsContent value="boq" className="mt-4"><BoqReport /></TabsContent>
        <TabsContent value="resources" className="mt-4"><ResourcesReport /></TabsContent>
        <TabsContent value="coverage" className="mt-4"><CoverageAnalysisReport /></TabsContent>
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
      const { data, error } = await estimationClient
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
  const activeTenderId = useActiveTenderId();
  const [selectedVersion, setSelectedVersion] = useState<string>("draft");

  const { data: projects = [] } = useQuery({
    queryKey: ["report-boq-projects-list"],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("projects").select("id,name,project_no,code,client_name")
        .order("project_no", { ascending: false });
      if (error) throw error;
      return data as Array<Pick<Project, "id" | "name" | "project_no" | "code" | "client_name">>;
    },
  });

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0]?.id ?? "");
  }, [projectId, projects]);

  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ["report-boq", projectId, activeTenderId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("boq_items").select("*").eq("project_id", projectId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as BoqItem[];
    },
  });

  const { data: allPaItems = [] } = useQuery({
    queryKey: ["report-pa-items", projectId, activeTenderId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("price_analysis_items")
        .select("boq_item_id, resource_type, quantity, unit_price, waste_pct, productivity, cell_styles, tender_id")
        .eq("project_id", projectId);
      if (error) throw error;
      return (data as Array<ResourceCostInput & { boq_item_id: string; tender_id?: string | null }>) ?? [];
    },
  });

  const { data: allPaMarkups = [] } = useQuery({
    queryKey: ["report-pa-markups", projectId, activeTenderId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("price_analysis_markup")
        .select("*")
        .eq("project_id", projectId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const items = useMemo(() => scopeRowsByTender(allItems as any[], activeTenderId) as BoqItem[], [allItems, activeTenderId]);
  const paItems = useMemo(() => scopeRowsByTender(allPaItems as any[], activeTenderId) as Array<ResourceCostInput & { boq_item_id: string }>, [allPaItems, activeTenderId]);
  const paMarkups = useMemo(() => scopeRowsByTender(allPaMarkups as any[], activeTenderId), [allPaMarkups, activeTenderId]);

  const { data: projectTenders = [] } = useQuery({
    queryKey: ["report-tenders", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await estimationClient.from("tenders").select("id").eq("project_id", projectId);
      return data ?? [];
    },
  });

  const snapshots = useMemo(() => {
    const ids = new Set<string>([projectId, ...projectTenders.map((t: any) => String(t.id))]);
    return Array.from(ids).flatMap((tid) => getSubmittedTenderSnapshots(tid));
  }, [projectId, projectTenders]);

  const activeSnapshot = useMemo(
    () => (selectedVersion === "draft" ? null : snapshots.find((s) => s.id === selectedVersion) ?? null),
    [selectedVersion, snapshots],
  );

  const project = projects.find((p) => p.id === projectId);

  const rows = useMemo(() => {
    if (activeSnapshot) {
      return activeSnapshot.items.map((it) => ({
        b: {
          id: it.boqItemId,
          item_no: it.itemNo,
          description_ar: it.descriptionAr,
          unit: it.unit,
          quantity: it.quantity,
          is_group: false,
          material_cost: it.directUnitCost,
          labor_cost: 0,
          equipment_cost: 0,
          subcontractor_cost: 0,
        } as any,
        unitCost: it.approvedUnitRate,
        total: it.lineSellingPrice,
      }));
    }

    const groupedPa = new Map<string, ResourceCostInput[]>();
    for (const p of paItems) {
      const list = groupedPa.get(p.boq_item_id) ?? [];
      list.push(p);
      groupedPa.set(p.boq_item_id, list);
    }
    const markupBy = new Map(paMarkups.map((m) => [m.boq_item_id, m]));

    return items.map((b) => {
      if (b.is_group) return { b, unitCost: 0, total: 0 };
      const paList = groupedPa.get(b.id);
      const m = markupBy.get(b.id) as MarkupSettings | undefined;
      const resolved = resolveBoqItemPricing({
        item: b,
        ...(paList ? { paLines: paList } : {}),
        ...(m ? { markup: m } : {}),
      });
      return { b, unitCost: resolved.approvedUnitRate, total: resolved.lineSellingPrice };
    });
  }, [activeSnapshot, items, paItems, paMarkups]);

  const grandTotal = activeSnapshot
    ? activeSnapshot.netSellingPrice
    : roundTo(rows.reduce((s, r) => s + r.total, 0), 2);

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
        <Select value={projectId} onValueChange={(v) => { setProjectId(v); setSelectedVersion("draft"); }}>
          <SelectTrigger className="h-9 w-80"><SelectValue placeholder="اختر مشروعاً…" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.project_no ? `#${p.project_no} — ` : ""}{p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {snapshots.length > 0 && (
          <Select value={selectedVersion} onValueChange={setSelectedVersion}>
            <SelectTrigger className="h-9 w-64">
              <SelectValue placeholder="الإصدار" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">المسودة الحالية (الأسعار الحية)</SelectItem>
              {snapshots.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  الإصدار المقدّم #{s.versionNo} ({fmtSAR(s.netSellingPrice)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
      const { data, error } = await estimationClient
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
  const activeTenderId = useActiveTenderId();

  const { data: projects = [] } = useQuery({
    queryKey: ["report-summary-projects-list"],
    queryFn: async () => {
      const { data, error } = await estimationClient
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
      const [boq, res, pa, mk] = await Promise.all([
        estimationClient.from("boq_items").select("*").eq("project_id", projectId),
        estimationClient.from("resources").select("type").eq("project_id", projectId),
        estimationClient.from("price_analysis_items").select("boq_item_id,resource_type,quantity,unit_price,waste_pct,productivity,tender_id").eq("project_id", projectId),
        estimationClient.from("price_analysis_markup").select("*").eq("project_id", projectId),
      ]);
      const boqRows = scopeRowsByTender((boq.data ?? []) as any[], activeTenderId) as BoqItem[];
      const paScoped = scopeRowsByTender((pa.data ?? []) as any[], activeTenderId);
      const mkScoped = scopeRowsByTender((mk.data ?? []) as any[], activeTenderId);
      const paByBoq = new Map<string, ResourceCostInput[]>();
      for (const p of paScoped) {
        const list = paByBoq.get(p.boq_item_id) ?? [];
        list.push(p);
        paByBoq.set(p.boq_item_id, list);
      }
      const mkByBoq = new Map<string, MarkupSettings>();
      for (const m of mkScoped) {
        if (m.boq_item_id) mkByBoq.set(m.boq_item_id, m);
      }
      const summary = computeProjectFinancials({
        boqItems: boqRows as any,
        paItemsByItemId: paByBoq,
        markupsByItemId: mkByBoq,
        defaultMarkup: { pricing_policy: "additive_v2", round_up_rate: true },
        vatRate: 15,
      });
      const resByType: Record<string, number> = { material: 0, labor: 0, equipment: 0 };
      (res.data ?? []).forEach((r: any) => { resByType[r.type] = (resByType[r.type] ?? 0) + 1; });
      return {
        boqCount: summary.totalItemsCount,
        boqTotal: summary.netSellingPrice,
        boqDirect: summary.totalDirectCost,
        resourcesCount: (res.data ?? []).length,
        resByType,
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
function CoverageAnalysisReport() {
  const [projectId, setProjectId] = useState<string>("");
  const { data: projects = [] } = useQuery({
    queryKey: ["report-cov-projects"],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("projects")
        .select("id,name,project_no")
        .order("project_no", { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; name: string; project_no: number | null }>;
    },
  });

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0]?.id ?? "");
  }, [projectId, projects]);

  const { data: items = [] } = useQuery({
    queryKey: ["report-cov-boq", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("boq_items")
        .select("*")
        .eq("project_id", projectId)
        .order("sort_order");
      if (error) throw error;
      return data as BoqItem[];
    },
  });

  const { data: records = [] } = useQuery({
    queryKey: ["report-cov-rec", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("assembly_coverage_records")
        .select("*")
        .eq("project_id", projectId);
      if (error) return [];
      return data ?? [];
    },
  });

  const report = useMemo(() => {
    const recMap = new Map(records.map((r) => [r.boq_item_id, r]));
    const availDivs = new Set(
      getAllBreakdownTemplates()
        .map((t) => csiDivisionCode(t.division))
        .filter((d): d is string => Boolean(d)),
    );
    return computeProjectCoverageStats(
      items.map((b) => {
        const rec = recMap.get(b.id);
        return {
          id: b.id,
          item_no: b.item_no,
          description_ar: b.description_ar,
          quantity: Number(b.quantity ?? 0),
          is_group: b.is_group,
          csi_division: rec?.csi_division ?? b.sheet_name ?? b.item_no ?? null,
          pricing_status: b.pricing_status ?? null,
          rate_source: b.rate_source ?? null,
          material_cost: Number(b.material_cost ?? 0),
          labor_cost: Number(b.labor_cost ?? 0),
          equipment_cost: Number(b.equipment_cost ?? 0),
          subcontractor_cost: Number(b.subcontractor_cost ?? 0),
          selling_unit_rate: Number(b.manual_unit_price ?? b.imported_unit_rate ?? 0),
          assembly_id: rec?.assembly_id ?? null,
          quote_status: rec?.coverage_status === "reference_only" ? "reference" : null,
        };
      }),
      availDivs,
    );
  }, [items, records]);

  const exportExcel = () => {
    const rows = report.byDivision.map((d) => ({
      "القسم CSI": `القسم ${d.divisionCode}`,
      "إجمالي البنود": d.totalItems,
      "المغطاة": d.coveredItems,
      "الفجوات": d.gapItems,
      "نسبة العدد %": d.countCoveragePct,
      "نسبة القيمة %": d.valueCoveragePct,
      "إجمالي القيمة (ر.س)": d.totalValue,
    }));
    downloadXlsx(rows, "csi-coverage-report", "التغطية والفجوات");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <Toolbar title="تقرير تغطية المقايسات والفجوات (CSI 01–33)" onExcel={exportExcel} />
      <div className="print:hidden">
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
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="تغطية العدد" value={`${report.countCoveragePct}%`} sub={`${report.coveredItems} / ${report.totalItems}`} hl />
        <Stat label="تغطية القيمة" value={`${report.valueCoveragePct}%`} sub={fmtSAR(report.coveredValue)} />
        <Stat label="بنود الفجوات" value={String(report.gapItems)} />
        <Stat label="مرجعي / غير مسعر" value={`${report.referenceOnlyItems} / ${report.unpricedItems}`} />
      </div>
      {report.byDivision.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-2 text-start">القسم CSI</th>
                <th className="p-2 text-center">إجمالي البنود</th>
                <th className="p-2 text-center">المغطاة</th>
                <th className="p-2 text-center">الفجوات</th>
                <th className="p-2 text-center">نسبة العدد</th>
                <th className="p-2 text-center">نسبة القيمة</th>
              </tr>
            </thead>
            <tbody>
              {report.byDivision.map((row) => (
                <tr key={row.divisionCode} className="border-t">
                  <td className="p-2 font-mono font-semibold">القسم {row.divisionCode}</td>
                  <td className="p-2 text-center">{row.totalItems}</td>
                  <td className="p-2 text-center text-emerald-600">{row.coveredItems}</td>
                  <td className="p-2 text-center text-amber-600">{row.gapItems}</td>
                  <td className="p-2 text-center">{row.countCoveragePct}%</td>
                  <td className="p-2 text-center">{row.valueCoveragePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
