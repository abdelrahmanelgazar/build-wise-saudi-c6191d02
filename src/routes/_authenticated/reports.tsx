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
import { useLanguage } from "@/lib/i18n";
import { STATUS_CONFIGS, ALL_STATUSES, type ProjectStatus } from "@/lib/status";
import type { Database } from "@/integrations/supabase/types";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Status = Database["public"]["Enums"]["project_status"];
type BoqItem = Database["public"]["Tables"]["boq_items"]["Row"];
type Resource = Database["public"]["Tables"]["resources"]["Row"];

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { t } = useLanguage();

  return (
    <div className="p-6 print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">{t("reports.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("reports.subtitle")}
          </p>
        </div>
      </div>

      <Tabs defaultValue="projects" className="mt-6">
        <TabsList className="print:hidden">
          <TabsTrigger value="projects" className="gap-1.5"><FolderKanban className="h-4 w-4" /> {t("reports.tabProjects")}</TabsTrigger>
          <TabsTrigger value="boq" className="gap-1.5"><Calculator className="h-4 w-4" /> {t("reports.tabDetailedBoq")}</TabsTrigger>
          <TabsTrigger value="resources" className="gap-1.5"><DatabaseIcon className="h-4 w-4" /> {t("reports.tabResources")}</TabsTrigger>
          <TabsTrigger value="summary" className="gap-1.5"><FileBarChart className="h-4 w-4" /> {t("reports.tabExecutiveSummary")}</TabsTrigger>
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
  const { t } = useLanguage();
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onExcel} className="gap-1.5">
          <FileSpreadsheet className="h-4 w-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
          <Printer className="h-4 w-4" /> {t("reports.printPdf")}
        </Button>
      </div>
    </div>
  );
}

/* ============== 1) PROJECTS REPORT ============== */
function ProjectsReport() {
  const { t, language } = useLanguage();
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
    const isEn = language === "en";
    const rows = filtered.map((p) => ({
      [isEn ? "No" : "No"]: p.project_no ?? "",
      [isEn ? "Code" : "Code"]: p.code ?? "",
      [isEn ? "Project Name" : "اسم المشروع"]: p.name,
      [isEn ? "Client" : "العميل"]: p.client_name ?? "",
      [isEn ? "Location" : "الموقع"]: p.location ?? "",
      [isEn ? "Status" : "الحالة"]: STATUS_CONFIGS[p.status] ? t(STATUS_CONFIGS[p.status].translationKey) : p.status,
      [isEn ? "Duration" : "مدة المشروع"]: (p as any).duration ?? "",
      [isEn ? "Estimated Value" : "القيمة التقديرية"]: Number(p.estimated_value ?? 0),
      [isEn ? "Budget" : "الميزانية"]: Number(p.budget ?? 0),
      [isEn ? "Notes" : "ملاحظات"]: (p as any).note ?? "",
    }));
    downloadXlsx(rows, "projects-report", isEn ? "Projects" : "المشاريع");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Toolbar title={t("reports.projectReportTitle")} onExcel={exportExcel} />

      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as Status | "all")}>
          <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("reports.allStatuses")}</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(STATUS_CONFIGS[s].translationKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">{filtered.length} {t("projects.countOf")}</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Stat label={t("dashboard.totalProjects")} value={String(totals.count)} />
        <Stat label={t("dashboard.totalValue")} value={fmtSAR(totals.est, language)} hl />
        <Stat label={t("dashboard.budget")} value={fmtSAR(totals.bud, language)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1100px] text-start text-xs">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("projects.colNo")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("projects.colCode")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("projects.colName")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("projects.colClient")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("projects.colLocation")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("projects.colStatus")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("projects.colDuration")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("projects.colValue")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("projects.statBudget")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">{t("common.loading")}</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">{t("projects.emptyProjects")}</td></tr>
            )}
            {filtered.map((p) => {
              const cfg = STATUS_CONFIGS[p.status];
              const statusLabel = cfg ? t(cfg.translationKey) : p.status;
              const badgeCls = cfg ? cfg.badgeClass : "bg-muted/60 text-muted-foreground border-border/60";

              return (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums">{p.project_no ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{(p as any).code || "—"}</td>
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.client_name || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.location || "—"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className={badgeCls}>{statusLabel}</Badge></td>
                  <td className="px-3 py-2 text-muted-foreground">{(p as any).duration || "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtSAR(Number(p.estimated_value ?? 0), language)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtSAR(Number(p.budget ?? 0), language)}</td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="bg-muted/40 font-medium">
              <tr>
                <td colSpan={7} className="px-3 py-2 text-start">{t("common.grandTotal")}</td>
                <td className="px-3 py-2 tabular-nums">{fmtSAR(totals.est, language)}</td>
                <td className="px-3 py-2 tabular-nums">{fmtSAR(totals.bud, language)}</td>
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
  const { t, language } = useLanguage();
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
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
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
    const isEn = language === "en";
    const data = rows.map(({ b, unitCost, total }) => {
      const desc = isEn && b.description_en ? b.description_en : b.description_ar;
      return {
        [isEn ? "Item No" : "البند"]: b.item_no,
        [isEn ? "Description" : "الوصف"]: desc,
        [isEn ? "Unit" : "الوحدة"]: b.unit ?? "",
        [isEn ? "Quantity" : "الكمية"]: b.is_group ? "" : Number(b.quantity ?? 0),
        [isEn ? "Material" : "مواد"]: Number(b.material_cost ?? 0),
        [isEn ? "Labour" : "عمالة"]: Number(b.labor_cost ?? 0),
        [isEn ? "Equipment" : "معدات"]: Number(b.equipment_cost ?? 0),
        [isEn ? "Subcontractor" : "مقاولين باطن"]: Number(b.subcontractor_cost ?? 0),
        [isEn ? "Unit Rate" : "سعر الوحدة"]: unitCost,
        [isEn ? "Total" : "الإجمالي"]: b.is_group ? "" : total,
      };
    });
    downloadXlsx(data, `boq-${project.name}`, "BOQ");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Toolbar title={t("reports.boqReportTitle")} onExcel={exportExcel} />

      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-9 w-80"><SelectValue placeholder={t("projects.selectPlaceholder")} /></SelectTrigger>
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
          {t("pa.selectProjectPrompt")}
        </div>
      )}

      {projectId && project && (
        <>
          <div className="mb-3 text-sm text-muted-foreground print:mb-4">
            <span className="font-semibold text-foreground">{project.name}</span>
            {project.client_name && <> · {t("projects.colClient")}: {project.client_name}</>}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-start text-xs">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("boq.itemNo")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("common.description")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("common.unit")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("common.quantity")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("common.unitRate")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("common.total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">{t("common.loading")}</td></tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">{t("boq.emptyState")}</td></tr>
                )}
                {rows.map(({ b, unitCost, total }) => {
                  const desc = language === "en" && b.description_en ? b.description_en : b.description_ar;
                  return (
                    <tr key={b.id} className={b.is_group ? "bg-muted/30 font-semibold" : "hover:bg-muted/20"}>
                      <td className="px-3 py-2 font-mono text-[11px]">{b.item_no}</td>
                      <td className="px-3 py-2">{desc}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.unit ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{b.is_group ? "" : Number(b.quantity ?? 0)}</td>
                      <td className="px-3 py-2 tabular-nums">{b.is_group ? "" : fmtSAR(unitCost, language)}</td>
                      <td className="px-3 py-2 tabular-nums">{b.is_group ? "" : fmtSAR(total, language)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-muted/40 font-medium">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-start">{t("common.grandTotal")}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtSAR(grandTotal, language)}</td>
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
  const { t, language } = useLanguage();
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

  const typeLabels: Record<string, string> = {
    material: t("resources.tabMaterials"),
    labor: t("resources.tabLabour"),
    equipment: t("resources.tabEquipment"),
  };

  const exportExcel = () => {
    const isEn = language === "en";
    const rows = filtered.map((r: any) => ({
      [isEn ? "Code" : "الكود"]: r.code ?? "",
      [isEn ? "Type" : "النوع"]: typeLabels[r.type] ?? r.type,
      [isEn ? "Name" : "الاسم"]: isEn && r.name_en ? r.name_en : r.name_ar,
      [isEn ? "Unit" : "الوحدة"]: r.unit,
      [isEn ? "Unit Rate" : "سعر الوحدة"]: Number(r.unit_price ?? 0),
      [isEn ? "Notes" : "ملاحظات"]: r.notes ?? "",
    }));
    downloadXlsx(rows, "resources-report", isEn ? "Resources" : "الموارد");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Toolbar title={t("reports.resourcesReportTitle")} onExcel={exportExcel} />

      <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
          <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            <SelectItem value="material">{t("resources.tabMaterials")}</SelectItem>
            <SelectItem value="labor">{t("resources.tabLabour")}</SelectItem>
            <SelectItem value="equipment">{t("resources.tabEquipment")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <Stat label={t("resources.tabMaterials")} value={String(byType.material ?? 0)} />
        <Stat label={t("resources.tabLabour")} value={String(byType.labor ?? 0)} />
        <Stat label={t("resources.tabEquipment")} value={String(byType.equipment ?? 0)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[800px] text-start text-xs">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("resources.colCode")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("common.type")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("resources.colName")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("resources.colUnit")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("resources.colRate")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t("common.loading")}</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t("resources.emptySection")}</td></tr>
            )}
            {filtered.map((r: any) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-[11px]">{r.code || "—"}</td>
                <td className="px-3 py-2">{typeLabels[r.type] ?? r.type}</td>
                <td className="px-3 py-2">{language === "en" && r.name_en ? r.name_en : r.name_ar}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.unit}</td>
                <td className="px-3 py-2 tabular-nums">{fmtSAR(Number(r.unit_price ?? 0), language)}</td>
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
  const { t, language } = useLanguage();
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
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
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
    const isEn = language === "en";
    const rows = [
      { [isEn ? "Field" : "البند"]: isEn ? "Project Name" : "اسم المشروع", [isEn ? "Value" : "القيمة"]: project.name },
      { [isEn ? "Field" : "البند"]: isEn ? "Client" : "العميل", [isEn ? "Value" : "القيمة"]: project.client_name ?? "—" },
      { [isEn ? "Field" : "البند"]: isEn ? "Location" : "الموقع", [isEn ? "Value" : "القيمة"]: project.location ?? "—" },
      { [isEn ? "Field" : "البند"]: isEn ? "Status" : "الحالة", [isEn ? "Value" : "القيمة"]: STATUS_CONFIGS[project.status] ? t(STATUS_CONFIGS[project.status].translationKey) : project.status },
      { [isEn ? "Field" : "البند"]: isEn ? "Estimated Value" : "القيمة التقديرية", [isEn ? "Value" : "القيمة"]: Number(project.estimated_value ?? 0) },
      { [isEn ? "Field" : "البند"]: isEn ? "Budget" : "الميزانية", [isEn ? "Value" : "القيمة"]: Number(project.budget ?? 0) },
      { [isEn ? "Field" : "البند"]: isEn ? "BOQ Total Cost" : "إجمالي تكلفة BOQ", [isEn ? "Value" : "القيمة"]: stats?.boqTotal ?? 0 },
      { [isEn ? "Field" : "البند"]: isEn ? "BOQ Items Count" : "عدد بنود BOQ", [isEn ? "Value" : "القيمة"]: stats?.boqCount ?? 0 },
      { [isEn ? "Field" : "البند"]: isEn ? "Resources Count" : "عدد الموارد", [isEn ? "Value" : "القيمة"]: stats?.resourcesCount ?? 0 },
      { [isEn ? "Field" : "البند"]: isEn ? "Materials" : "مواد", [isEn ? "Value" : "القيمة"]: stats?.resByType.material ?? 0 },
      { [isEn ? "Field" : "البند"]: isEn ? "Labour" : "عمالة", [isEn ? "Value" : "القيمة"]: stats?.resByType.labor ?? 0 },
      { [isEn ? "Field" : "البند"]: isEn ? "Equipment" : "معدات", [isEn ? "Value" : "القيمة"]: stats?.resByType.equipment ?? 0 },
    ];
    downloadXlsx(rows, `summary-${project.name}`, isEn ? "Summary" : "ملخص");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <Toolbar title={t("reports.summaryReportTitle")} onExcel={exportExcel} />

      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="h-9 w-80"><SelectValue placeholder={t("projects.selectPlaceholder")} /></SelectTrigger>
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
          {t("pa.selectProjectPrompt")}
        </div>
      )}

      {project && (
        <>
          <div className="mb-4">
            <h3 className="text-xl font-bold">{project.name}</h3>
            <div className="mt-1 text-sm text-muted-foreground">
              {project.client_name || "—"} · {project.location || "—"} ·{" "}
              <Badge variant="outline" className={STATUS_CONFIGS[project.status]?.badgeClass}>
                {STATUS_CONFIGS[project.status] ? t(STATUS_CONFIGS[project.status].translationKey) : project.status}
              </Badge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("dashboard.totalValue")} value={fmtSAR(Number(project.estimated_value ?? 0), language)} />
            <Stat label={t("dashboard.budget")} value={fmtSAR(Number(project.budget ?? 0), language)} />
            <Stat label={t("projects.statBoqTotal")} value={fmtSAR(stats?.boqTotal ?? 0, language)} hl />
            <Stat label={t("projects.statBoqItems")} value={String(stats?.boqCount ?? 0)} sub={`${stats?.resourcesCount ?? 0} ${t("projects.resourceCountSub")}`} />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label={t("resources.tabMaterials")} value={String(stats?.resByType.material ?? 0)} />
            <Stat label={t("resources.tabLabour")} value={String(stats?.resByType.labor ?? 0)} />
            <Stat label={t("resources.tabEquipment")} value={String(stats?.resByType.equipment ?? 0)} />
          </div>

          {project.estimated_value && stats?.boqTotal ? (
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-4 text-sm">
              <div className="font-medium">{language === "en" ? "Estimated Margin" : "الهامش التقديري"}</div>
              <div className="mt-1 text-muted-foreground">
                {fmtSAR(Number(project.estimated_value) - stats.boqTotal, language)} ({((1 - stats.boqTotal / Number(project.estimated_value)) * 100).toFixed(1)}%)
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
    rows = [{ "—": "No Data" }];
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
