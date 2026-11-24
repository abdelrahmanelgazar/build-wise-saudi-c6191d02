import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { estimationClient } from "@/lib/estimation-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  Plus,
  Search,
  Trash2,
  FileText,
  LayoutGrid,
  Clock,
  Kanban,
  Building2,
  ExternalLink,
  Calendar,
  Layers,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Filter,
} from "lucide-react";
import { fmtSAR, fmtNumber } from "@/lib/format";
import { toast } from "sonner";
import { setActiveProjectId } from "@/lib/active-project";
import type { Database } from "@/integrations/supabase/types";
import { useLanguage } from "@/lib/i18n";
import type { Client, Tender, TenderStatus } from "@/types/client-tender";
import {
  CLIENT_TYPE_META,
  TENDER_STATUS_META,
} from "@/types/client-tender";
import { transitionTenderStatus } from "@/lib/client-tender-service";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Status = Database["public"]["Enums"]["project_status"];

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

const SCOPE_OPTIONS = ["Turnkey", "Civil", "MEP", "Finishing", "Infrastructure", "Other"];
const CONTRACT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Re-Measured", label: "Re-Measured" },
  { value: "Lump sum", label: "Lump sum" },
];

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "سجل المشاريع والمنافسات — تقديري" },
      {
        name: "description",
        content: "إدارة المشاريع والمنافسات، عروض البطاقات، وPipeline متابعة العطاءات في السوق السعودي.",
      },
    ],
  }),
  component: ProjectsIndex,
});

function ProjectsIndex() {
  const qc = useQueryClient();
  const { t, language, direction: dir } = useLanguage();

  // View mode: cards (default) | table | tenders | pipeline
  const [viewMode, setViewMode] = useState<"table" | "cards" | "tenders" | "pipeline">("cards");

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [groupByClient, setGroupByClient] = useState(false);
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());

  // Transition dialog state
  const [transitioningTender, setTransitioningTender] = useState<Tender | null>(null);
  const [targetStatus, setTargetStatus] = useState<TenderStatus>("submitted");
  const [transitionReason, setTransitionReason] = useState("");

  // Fetch projects
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("projects")
        .select("*")
        .order("project_no", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  // Fetch registered clients
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await estimationClient.from("clients").select("*");
      if (error) throw error;
      return (data as Client[] | null) ?? [];
    },
  });

  // Fetch tenders
  const { data: tenders = [], isLoading: tendersLoading } = useQuery({
    queryKey: ["tenders"],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("tenders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as Tender[] | null) ?? [];
    },
  });

  const updateNoMut = useMutation({
    mutationFn: async ({ id, project_no }: { id: string; project_no: number | null }) => {
      const { error } = await estimationClient.from("projects").update({ project_no } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("projects.noUpdated", "تم تحديث رقم المشروع"));
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await estimationClient.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("projects.deletedSuccess", "تم حذف المشروع"));
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transitionMut = useMutation({
    mutationFn: async () => {
      if (!transitioningTender) return;
      await transitionTenderStatus(
        transitioningTender.id,
        transitioningTender.status,
        targetStatus,
        transitionReason
      );
    },
    onSuccess: () => {
      toast.success("تم تحديث حالة المنافسة وتسجيل سبب القرار");
      qc.invalidateQueries({ queryKey: ["tenders"] });
      setTransitioningTender(null);
      setTransitionReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return projects
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => {
        if (clientFilter === "all") return true;
        return (p as any).client_id === clientFilter || p.client_name === clientFilter;
      })
      .filter((p) => {
        const subDate = p.last_submit_date || (p as any).submission_date;
        if (!subDate) return !dateFrom && !dateTo;
        if (dateFrom && subDate < dateFrom) return false;
        if (dateTo && subDate > dateTo) return false;
        return true;
      })
      .filter((p) => {
        if (!search) return true;
        const s = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(s) ||
          (p.client_name ?? "").toLowerCase().includes(s) ||
          (p.location ?? "").toLowerCase().includes(s) ||
          ((p as any).code ?? "").toLowerCase().includes(s) ||
          ((p as any).area ?? "").toLowerCase().includes(s)
        );
      });
  }, [projects, statusFilter, clientFilter, dateFrom, dateTo, search]);

  // Grouped projects by client
  const projectsByClient = useMemo(() => {
    const map = new Map<string, { clientName: string; clientId?: string; projects: Project[] }>();
    filteredProjects.forEach((p) => {
      const name = p.client_name?.trim() || "عملاء غير مصنفين";
      const id = (p as any).client_id;
      if (!map.has(name)) {
        map.set(name, { clientName: name, clientId: id, projects: [] });
      }
      map.get(name)!.projects.push(p);
    });
    return Array.from(map.values());
  }, [filteredProjects]);

  const toggleClientGroup = (name: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const ChevronIcon = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <div className="p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <FolderPlus className="h-7 w-7 text-primary" />
            <span>{t("projects.title", "المشاريع والمنافسات")}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            إدارة سجل المشاريع، بطاقات التفاصيل، وسجل ومراحل المنافسات (Pipeline).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/clients">
            <Button variant="outline" className="gap-2">
              <Building2 className="h-4 w-4" />
              <span>إدارة العملاء</span>
            </Button>
          </Link>
          <NewProjectDialog clients={clients} />
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <TabsList className="bg-muted/60 p-1">
            <TabsTrigger value="cards" className="gap-2 text-xs">
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>بطاقات المشاريع (الافتراضي)</span>
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-2 text-xs">
              <FileText className="h-3.5 w-3.5" />
              <span>جدول المشاريع</span>
            </TabsTrigger>
            <TabsTrigger value="tenders" className="gap-2 text-xs">
              <Clock className="h-3.5 w-3.5" />
              <span>سجل المنافسات ({tenders.length})</span>
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-2 text-xs">
              <Kanban className="h-3.5 w-3.5" />
              <span>لوحة المراحل Pipeline</span>
            </TabsTrigger>
          </TabsList>

          {/* Group by Client Toggle for Table/Tenders View */}
          {(viewMode === "table" || viewMode === "tenders") && (
            <Button
              variant={groupByClient ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setGroupByClient(!groupByClient)}
              className="gap-1.5 text-xs h-8 border border-border/50"
            >
              <Building2 className="h-3.5 w-3.5 text-primary" />
              <span>{groupByClient ? "إلغاء التجميع" : "تجميع حسب العميل"}</span>
            </Button>
          )}
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الكود أو العميل أو الموقع…"
              className="h-9 ps-9"
            />
          </div>

          {/* Client Filter */}
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="تصفية بالعميل" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل العملاء</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="الحالة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("projects.allStatuses", "كل الحالات")}</SelectItem>
              {(Object.keys(STATUS_META) as Status[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status.${s}`, STATUS_META[s].label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date Range Filters */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 p-1 rounded-md border border-border/50">
            <Calendar className="h-3.5 w-3.5 ms-1" />
            <span className="text-[11px]">التقديم من:</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-7 w-32 text-xs p-1"
            />
            <span className="text-[11px]">إلى:</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-7 w-32 text-xs p-1"
            />
          </div>

          <div className="text-xs text-muted-foreground">
            {filteredProjects.length} من {projects.length} مشروع
          </div>
        </div>

        {/* 1. Projects Table View (Default, Exact 16-Column Spec) */}
        <TabsContent value="table" className="mt-0">
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[1400px] text-start text-xs">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-medium">No</th>
                  <th className="px-3 py-3 font-medium">Code</th>
                  <th className="px-3 py-3 font-medium">{t("projects.client", "العميل")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.name", "اسم المشروع")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.location", "الموقع")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.area", "المنطقة")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.scopeOfWork", "نطاق العمل")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.contractType", "نوع التعاقد")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.tenderEntryDate", "دخول المناقصة")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.lastSubmitDate", "آخر تقديم")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.lastRfiDate", "آخر استفسارات")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.duration", "مدة المشروع")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.status", "الحالة")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.notes", "ملاحظات")}</th>
                  <th className="px-3 py-3 font-medium">{t("projects.value", "القيمة")} ({t("currency.sar", "ر.س")})</th>
                  <th className="px-3 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projectsLoading && (
                  <tr>
                    <td colSpan={16} className="px-4 py-8 text-center text-muted-foreground">
                      {t("common.loading", "جاري التحميل…")}
                    </td>
                  </tr>
                )}
                {!projectsLoading && filteredProjects.length === 0 && (
                  <tr>
                    <td colSpan={16} className="px-4 py-12 text-center text-muted-foreground">
                      <FolderPlus className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      <div>{t("projects.noProjects", "لا توجد مشاريع — أضف مشروعك الأول للبدء")}</div>
                    </td>
                  </tr>
                )}

                {/* Flat Rows Rendering */}
                {!groupByClient &&
                  filteredProjects.map((p: any) => renderProjectRow(p, t, language, ChevronIcon, updateNoMut, setActiveProjectId, delMut))}

                {/* Grouped by Client Rows */}
                {groupByClient &&
                  projectsByClient.map((group) => {
                    const isExpanded = !expandedClients.has(group.clientName);
                    return (
                      <tbody key={group.clientName} className="divide-y divide-border">
                        <tr
                          onClick={() => toggleClientGroup(group.clientName)}
                          className="bg-muted/60 hover:bg-muted/80 cursor-pointer font-bold select-none"
                        >
                          <td colSpan={16} className="px-3 py-2 text-primary">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                                <Building2 className="h-4 w-4" />
                                <span>{group.clientName}</span>
                                <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 bg-background">
                                  {group.projects.length} مشاريع
                                </Badge>
                              </div>
                              {group.clientId && (
                                <Link
                                  to="/clients/$clientId"
                                  params={{ clientId: group.clientId }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] text-muted-foreground hover:text-primary hover:underline flex items-center gap-1"
                                >
                                  <span>فتح ملف العميل</span>
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded &&
                          group.projects.map((p: any) =>
                            renderProjectRow(p, t, language, ChevronIcon, updateNoMut, setActiveProjectId, delMut)
                          )}
                      </tbody>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* 2. Project Cards View (Requirement 3) */}
        <TabsContent value="cards" className="mt-0">
          {filteredProjects.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground border border-dashed rounded-lg">
              لا توجد مشاريع مطابقة للخيارات.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredProjects.map((p: any) => {
                const m = STATUS_META[p.status as Status] ?? { label: p.status ?? "—", cls: "bg-muted" };
                const subDate = p.last_submit_date || p.submission_date || "غير محدد";

                return (
                  <Card
                    key={p.id}
                    className="group flex flex-col justify-between transition-all hover:border-primary/50 hover:shadow-md bg-card/70"
                  >
                    <CardHeader className="pb-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                          {p.code || `NO-${p.project_no || "1"}`}
                        </span>
                        <Badge variant="outline" className={m.cls}>
                          {t(`status.${p.status}`, m.label)}
                        </Badge>
                      </div>

                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: p.id }}
                        onClick={() => setActiveProjectId(p.id)}
                        className="block group-hover:text-primary transition-colors"
                      >
                        <CardTitle className="text-base font-bold leading-snug line-clamp-2">
                          {p.name}
                        </CardTitle>
                      </Link>

                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {p.client_name ? (
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="truncate font-medium text-foreground">{p.client_name}</span>
                          </div>
                        ) : null}
                        <Badge variant="outline" className="text-[10px] bg-muted/40 font-normal">
                          {(p as any).company_name || (p as any).studying_company || "شركة غير محددة"}
                        </Badge>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3 pt-0">
                      <div className="grid grid-cols-2 gap-2 text-xs border-t border-border/50 pt-2.5">
                        <div>
                          <span className="text-[11px] text-muted-foreground block">آخر موعد تقديم:</span>
                          <span className="font-mono font-medium text-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3 text-amber-500" />
                            {subDate}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-muted-foreground block">نطاق العمل:</span>
                          <span className="font-medium text-foreground truncate block mt-0.5">
                            {p.scope_of_work || "Turnkey"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-border/40 text-xs">
                        <div>
                          <span className="text-[10px] text-muted-foreground block">القيمة التقديرية:</span>
                          <span className="font-mono font-bold text-sm text-primary">
                            {p.estimated_value ? fmtSAR(Number(p.estimated_value), language) : "غير محدد"}
                          </span>
                        </div>

                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: p.id }}
                          onClick={() => setActiveProjectId(p.id)}
                        >
                          <Button size="sm" variant="ghost" className="gap-1 text-xs h-7 px-2">
                            <span>فتح المشروع</span>
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* 3. Tenders Register View (Requirement 4) */}
        <TabsContent value="tenders" className="mt-0">
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[1200px] text-start text-xs">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-medium">رقم المنافسة / المرجع</th>
                  <th className="px-3 py-3 font-medium">اسم المنافسة / المشروع</th>
                  <th className="px-3 py-3 font-medium">الجهة المالكة (العميل)</th>
                  <th className="px-3 py-3 font-medium">الحزمة / النطاق</th>
                  <th className="px-3 py-3 font-medium">المسؤول</th>
                  <th className="px-3 py-3 font-medium">موعد الإقفال والتقديم</th>
                  <th className="px-3 py-3 font-medium">الحالة الحالية</th>
                  <th className="px-3 py-3 font-medium">القيمة التقديرية</th>
                  <th className="px-3 py-3 text-end font-medium">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tenders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد منافسات مسجلة بعد.
                    </td>
                  </tr>
                ) : (
                  tenders.map((t) => {
                    const statusMeta = TENDER_STATUS_META[t.status] ?? { label: t.status, cls: "bg-muted" };
                    return (
                      <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-3 font-mono font-bold text-primary">{t.tender_no}</td>
                        <td className="px-3 py-3 font-medium text-foreground">
                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: t.project_id }}
                            onClick={() => setActiveProjectId(t.project_id)}
                            className="hover:underline hover:text-primary flex items-center gap-1"
                          >
                            <span>{t.title}</span>
                            <ExternalLink className="h-3 w-3 opacity-50" />
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{t.client_name || "—"}</td>
                        <td className="px-3 py-3 text-muted-foreground">{t.package_name || "—"}</td>
                        <td className="px-3 py-3 text-muted-foreground">{t.responsible_person || "—"}</td>
                        <td className="px-3 py-3 font-mono">{t.submission_deadline || "غير محدد"}</td>
                        <td className="px-3 py-3">
                          <Badge variant="outline" className={statusMeta.cls}>
                            {statusMeta.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 font-mono font-bold text-primary">
                          {t.estimated_value ? fmtSAR(t.estimated_value, language) : "غير محدد"}
                        </td>
                        <td className="px-3 py-3 text-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setTransitioningTender(t);
                              setTargetStatus(t.status);
                            }}
                            className="h-7 text-xs gap-1"
                          >
                            <span>تغيير الحالة</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* 4. Kanban Pipeline View (Requirement 4) */}
        <TabsContent value="pipeline" className="mt-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 overflow-x-auto pb-4">
            {(Object.keys(TENDER_STATUS_META) as TenderStatus[]).map((st) => {
              const meta = TENDER_STATUS_META[st];
              const stageTenders = tenders.filter((t) => t.status === st);
              const stageValue = stageTenders.reduce((s, t) => s + (t.estimated_value || 0), 0);

              return (
                <div key={st} className="flex flex-col rounded-lg border border-border bg-card/60 p-2.5 min-w-[210px]">
                  {/* Column Header */}
                  <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
                    <span className="font-semibold text-xs text-foreground truncate">{meta.label}</span>
                    <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                      {stageTenders.length}
                    </Badge>
                  </div>

                  {/* Stage Value */}
                  {stageValue > 0 && (
                    <div className="text-[10px] font-mono text-muted-foreground mb-2">
                      {fmtSAR(stageValue, language)}
                    </div>
                  )}

                  {/* Cards inside Column */}
                  <div className="flex-1 space-y-2 overflow-y-auto max-h-[600px]">
                    {stageTenders.length === 0 ? (
                      <div className="py-8 text-center text-[11px] text-muted-foreground/60 border border-dashed rounded">
                        فارغ
                      </div>
                    ) : (
                      stageTenders.map((t) => (
                        <div
                          key={t.id}
                          className="rounded-md border border-border/80 bg-background p-2.5 shadow-xs space-y-2 hover:border-primary/50 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-[10px] font-bold text-primary">{t.tender_no}</span>
                            <span className="text-[10px] font-mono text-muted-foreground truncate">
                              {t.submission_deadline || ""}
                            </span>
                          </div>

                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: t.project_id }}
                            onClick={() => setActiveProjectId(t.project_id)}
                            className="font-medium text-xs text-foreground hover:text-primary line-clamp-2 block"
                          >
                            {t.title}
                          </Link>

                          {t.client_name && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {t.client_name}
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px]">
                            <span className="font-mono font-bold text-primary">
                              {t.estimated_value ? fmtSAR(t.estimated_value, language) : "—"}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setTransitioningTender(t);
                                setTargetStatus(t.status);
                              }}
                              className="h-6 w-6"
                              title="تحديث المرحلة"
                            >
                              <ArrowRight className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Transition Dialog */}
      {transitioningTender && (
        <Dialog open={!!transitioningTender} onOpenChange={() => setTransitioningTender(null)}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>تغيير مرحلة المنافسة / اتخاذ القرار</DialogTitle>
              <DialogDescription>
                {transitioningTender.tender_no} — {transitioningTender.title}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label>المرحلة الجديدة:</Label>
                <Select value={targetStatus} onValueChange={(v) => setTargetStatus(v as TenderStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TENDER_STATUS_META) as TenderStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {TENDER_STATUS_META[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>سبب القرار / الملاحظات الموثقة (مطلوب لاتخاذ القرار):</Label>
                <Textarea
                  rows={3}
                  value={transitionReason}
                  onChange={(e) => setTransitionReason(e.target.value)}
                  placeholder="مثال: تقديم العرض بقيمة 10,300,000 ريال، أو استلام ملحق تمديد، أو اعتذار لعدم توفر الموارد…"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setTransitioningTender(null)}>
                إلغاء
              </Button>
              <Button onClick={() => transitionMut.mutate()} disabled={transitionMut.isPending}>
                {transitionMut.isPending ? "جاري التسجيل…" : "تأكيد وتوثيق الانتقال"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function renderProjectRow(
  p: any,
  t: any,
  language: any,
  ChevronIcon: any,
  updateNoMut: any,
  setActiveProjectId: any,
  delMut: any
) {
  const m = STATUS_META[p.status as Status] ?? {
    label: p.status ?? "—",
    cls: "bg-muted/60 text-muted-foreground border-border/60",
  };
  const statusLabel = t(`status.${p.status}`, m.label);

  return (
    <tr key={p.id} className="hover:bg-muted/30">
      <td className="px-3 py-3">
        <NoEditor
          value={p.project_no}
          onSave={(v) => updateNoMut.mutate({ id: p.id, project_no: v })}
        />
      </td>
      <td className="px-3 py-3 font-mono text-[11px]">{p.code || "—"}</td>
      <td className="px-3 py-3 text-muted-foreground">
        {p.client_id ? (
          <Link
            to="/clients/$clientId"
            params={{ clientId: p.client_id }}
            className="hover:text-primary hover:underline flex items-center gap-1"
          >
            <span>{p.client_name || "—"}</span>
            <ExternalLink className="h-2.5 w-2.5 opacity-50" />
          </Link>
        ) : (
          p.client_name || "—"
        )}
      </td>
      <td className="px-3 py-3 font-medium">
        <Link
          to="/projects/$projectId"
          params={{ projectId: p.id }}
          onClick={() => setActiveProjectId(p.id)}
          className="text-primary hover:underline"
        >
          {p.name}
        </Link>
      </td>
      <td className="px-3 py-3 text-muted-foreground">{p.location || "—"}</td>
      <td className="px-3 py-3 text-muted-foreground">{p.area || "—"}</td>
      <td className="px-3 py-3 text-muted-foreground">{p.scope_of_work || "—"}</td>
      <td className="px-3 py-3 text-muted-foreground">{p.contract_type || "—"}</td>
      <td className="px-3 py-3 text-muted-foreground">{p.tender_entry_date || "—"}</td>
      <td className="px-3 py-3 text-muted-foreground">{p.last_submit_date || p.submission_date || "—"}</td>
      <td className="px-3 py-3 text-muted-foreground">{p.last_rfi_date || "—"}</td>
      <td className="px-3 py-3 text-muted-foreground">{p.duration || "—"}</td>
      <td className="px-3 py-3">
        <Badge variant="outline" className={m.cls}>{statusLabel}</Badge>
      </td>
      <td className="px-3 py-3 max-w-[200px] truncate text-muted-foreground" title={p.note || ""}>
        {p.note || "—"}
      </td>
      <td className="px-3 py-3 tabular-nums">{fmtSAR(Number(p.estimated_value ?? 0), language)}</td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1">
          <Link
            to="/projects/$projectId"
            params={{ projectId: p.id }}
            onClick={() => setActiveProjectId(p.id)}
          >
            <Button size="sm" variant="ghost" className="gap-1">
              {t("common.open", "فتح")}
              <ChevronIcon className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              if (confirm(t("projects.confirmDelete", `حذف المشروع "${p.name}" مع كل بياناته؟`))) {
                delMut.mutate(p.id);
              }
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function NoEditor({ value, onSave }: { value: number | null | undefined; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(value == null ? "" : String(value));
  if (editing) {
    return (
      <Input
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const n = val.trim() === "" ? null : Number(val);
          if (n !== (value ?? null)) onSave(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setVal(value == null ? "" : String(value));
            setEditing(false);
          }
        }}
        autoFocus
        className="h-7 w-16 px-1.5 font-mono text-[11px]"
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      title="انقر لتعديل رقم المشروع"
      className="cursor-pointer rounded px-1 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted"
    >
      {value ?? "—"}
    </span>
  );
}

export function NewProjectDialog({ clients = [] }: { clients?: Client[] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    project_no: "",
    code: "",
    clientId: "",
    clientName: "",
    name: "",
    location: "",
    area: "",
    scope_of_work: "Turnkey",
    contract_type: "Re-Measured",
    tender_entry_date: "",
    last_submit_date: "",
    last_rfi_date: "",
    duration: "24 شهر",
    status: "studying" as Status,
    note: "",
    estValue: "",
  });
  const qc = useQueryClient();

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: async () => {
      const { data: u } = await estimationClient.auth.getUser();
      const user_id = u.user?.id;
      if (!user_id) throw new Error(t("auth.notLoggedIn", "غير مسجل دخول"));
      if (!form.name.trim()) throw new Error(t("projects.nameRequired", "اسم المشروع مطلوب"));

      const matchedClient = clients.find((c) => c.id === form.clientId);
      const client_name = matchedClient ? matchedClient.name : form.clientName.trim() || null;

      const { data, error } = await estimationClient
        .from("projects")
        .insert({
          user_id,
          project_no: form.project_no.trim() === "" ? null : Number(form.project_no),
          name: form.name.trim(),
          code: form.code.trim() || null,
          client_id: form.clientId || null,
          client_name,
          location: form.location.trim() || null,
          area: form.area.trim() || null,
          scope_of_work: form.scope_of_work || null,
          contract_type: form.contract_type || null,
          tender_entry_date: form.tender_entry_date || null,
          last_submit_date: form.last_submit_date || null,
          last_rfi_date: form.last_rfi_date || null,
          duration: form.duration || null,
          status: form.status,
          note: form.note.trim() || null,
          estimated_value: Number(form.estValue) || 0,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (p) => {
      toast.success(t("projects.createdSuccess", "تم إنشاء المشروع"));
      qc.invalidateQueries({ queryKey: ["projects"] });
      setActiveProjectId(p.id);
      setOpen(false);
      setForm({
        project_no: "",
        code: "", clientId: "", clientName: "", name: "", location: "", area: "",
        scope_of_work: "Turnkey", contract_type: "Re-Measured",
        tender_entry_date: "", last_submit_date: "", last_rfi_date: "",
        duration: "24 شهر",
        status: "studying", note: "", estValue: "",
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          <span>{t("projects.newProject", "مشروع جديد")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>{t("projects.newProject", "مشروع جديد")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.colNo", "رقم المشروع (No)")}</Label>
              <Input type="number" value={form.project_no} onChange={(e) => set("project_no", e.target.value)} placeholder="675" />
            </div>
            <div className="grid gap-1.5">
              <Label>Code</Label>
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="AFC-MAS-26-01" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.client", "العميل المسجل")}</Label>
              {clients.length > 0 ? (
                <Select
                  value={form.clientId}
                  onValueChange={(val) => {
                    const c = clients.find((x) => x.id === val);
                    set("clientId", val);
                    if (c) set("clientName", c.name);
                  }}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="اختر جهة مالكة…" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.clientName}
                  onChange={(e) => set("clientName", e.target.value)}
                  placeholder="اسم العميل"
                />
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>{t("projects.name", "اسم المشروع")} *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="مثال: إنشاء مستشفى عام - 50 سرير" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.location", "الموقع")}</Label>
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="الرياض / جازان" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.area", "المنطقة")}</Label>
              <Input value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="فيفا / المنطقة الجنوبية" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.scopeOfWork", "نطاق العمل")}</Label>
              <Select value={form.scope_of_work} onValueChange={(v) => set("scope_of_work", v)}>
                <SelectTrigger><SelectValue placeholder="اختر…" /></SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.contractType", "نوع التعاقد")}</Label>
              <Select value={form.contract_type} onValueChange={(v) => set("contract_type", v)}>
                <SelectTrigger><SelectValue placeholder="اختر…" /></SelectTrigger>
                <SelectContent>
                  {CONTRACT_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.tenderEntryDate", "دخول المناقصة")}</Label>
              <Input type="date" value={form.tender_entry_date} onChange={(e) => set("tender_entry_date", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.lastSubmitDate", "آخر موعد للتقديم")}</Label>
              <Input type="date" value={form.last_submit_date} onChange={(e) => set("last_submit_date", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.lastRfiDate", "آخر استفسارات")}</Label>
              <Input type="date" value={form.last_rfi_date} onChange={(e) => set("last_rfi_date", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.duration", "مدة المشروع")}</Label>
              <Input value={form.duration} onChange={(e) => set("duration", e.target.value)} placeholder="مثال: 24 شهر" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.value", "قيمة المشروع")} ({t("currency.sar", "ر.س")})</Label>
              <Input type="number" value={form.estValue} onChange={(e) => set("estValue", e.target.value)} placeholder="0" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.status", "الحالة")}</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as Status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_META) as Status[]).map((s) => (
                    <SelectItem key={s} value={s}>{t(`status.${s}`, STATUS_META[s].label)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.notes", "ملاحظة")}</Label>
              <Input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="ملاحظات…" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel", "إلغاء")}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? t("common.saving", "جاري الحفظ…") : t("common.save", "حفظ")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
