import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { estimationClient } from "@/lib/estimation-client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building2,
  Wallet,
  TrendingUp,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Database,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  Plus,
  FileSpreadsheet,
  FileText,
  BarChart3,
  ExternalLink,
  Layers,
  Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { fmtSAR, fmtNumber } from "@/lib/format";
import type { Database as DB } from "@/integrations/supabase/types";
import { useLanguage } from "@/lib/i18n";
import { setActiveProjectId } from "@/lib/active-project";
import { NewProjectDialog } from "./projects.index";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";

type Project = DB["public"]["Tables"]["projects"]["Row"];
type Status = DB["public"]["Enums"]["project_status"];

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "لوحة التحكم — تقديري" },
      {
        name: "description",
        content:
          "منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.",
      },
    ],
  }),
  component: DashboardPage,
});

const STATUS_META: Record<Status, { label: string; color: string }> = {
  studying: { label: "قيد الدراسة", color: "#94a3b8" },
  submitted_to_medial_man: { label: "مُرسل للوسيط", color: "#f59e0b" },
  submitted_to_client: { label: "مُرسل للعميل", color: "#3b82f6" },
  waiting_for_reply: { label: "بانتظار الرد", color: "#eab308" },
  inquiries_sent: { label: "استفسارات", color: "#06b6d4" },
  answers_received: { label: "ردود مستلمة", color: "#6366f1" },
  on_hold: { label: "مُعلّق", color: "#f97316" },
  client_rejected: { label: "رفض العميل", color: "#ef4444" },
  construction_ongoing: { label: "تنفيذ جاري", color: "#10b981" },
  construction_complete: { label: "تنفيذ مكتمل", color: "#14b8a6" },
  finished: { label: "منتهي", color: "#0ea5e9" },
  closed: { label: "مغلق", color: "#64748b" },
};

const WON_STATUSES: Status[] = ["construction_ongoing", "construction_complete", "finished"];
const LOST_STATUSES: Status[] = ["client_rejected"];

function DashboardPage() {
  const { t, language, direction: dir } = useLanguage();
  const navigate = useNavigate();

  useRegisterPageActions({
    pageKey: "dashboard",
    hasEditableState: false,
    queryKeys: [["dashboard-projects"], ["clients"], ["project-switcher-projects"]],
  });

  // Expanded states for company and owner tree
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set(["شركة غير محددة", "شركة أوتاد الفهد"]));
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["dashboard-projects"],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await estimationClient.from("clients").select("*");
      if (error) throw error;
      return (data as any[] | null) ?? [];
    },
  });

  const { data: resourcesCount = 0 } = useQuery({
    queryKey: ["dashboard-resources-count"],
    queryFn: async () => {
      const { count, error } = await estimationClient
        .from("resources")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: boqCount = 0 } = useQuery({
    queryKey: ["dashboard-boq-count"],
    queryFn: async () => {
      const { count, error } = await estimationClient
        .from("boq_items")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const stats = useMemo(() => {
    const total = projects.length;
    const totalValue = projects.reduce((s, p) => s + Number(p.estimated_value ?? 0), 0);
    const totalBudget = projects.reduce((s, p) => s + Number(p.budget ?? 0), 0);
    const won = projects.filter((p) => WON_STATUSES.includes(p.status as Status)).length;
    const lost = projects.filter((p) => LOST_STATUSES.includes(p.status as Status)).length;
    const decided = won + lost;
    const winRate = decided > 0 ? (won / decided) * 100 : 0;
    const active = projects.filter((p) =>
      [
        "studying",
        "submitted_to_client",
        "submitted_to_medial_man",
        "waiting_for_reply",
        "inquiries_sent",
        "answers_received",
        "construction_ongoing",
      ].includes(p.status as string)
    ).length;
    return { total, totalValue, totalBudget, won, lost, winRate, active };
  }, [projects]);

  // Company -> Owner -> Projects hierarchy tree
  const companyOwnerTree = useMemo(() => {
    const compMap = new Map<string, Map<string, Project[]>>();

    projects.forEach((p) => {
      const company = (p as any).company_name || (p as any).studying_company || "شركة غير محددة";
      const owner = p.client_name?.trim() || "مالك / عميل غير محدد";

      if (!compMap.has(company)) {
        compMap.set(company, new Map());
      }
      const ownerMap = compMap.get(company)!;
      if (!ownerMap.has(owner)) {
        ownerMap.set(owner, []);
      }
      ownerMap.get(owner)!.push(p);
    });

    return Array.from(compMap.entries()).map(([companyName, ownerMap]) => ({
      companyName,
      owners: Array.from(ownerMap.entries()).map(([clientName, projs]) => ({
        clientName,
        projects: projs,
        totalValue: projs.reduce((s, pr) => s + Number(pr.estimated_value ?? 0), 0),
      })),
      totalValue: Array.from(ownerMap.values())
        .flat()
        .reduce((s, pr) => s + Number(pr.estimated_value ?? 0), 0),
      totalCount: Array.from(ownerMap.values()).flat().length,
    }));
  }, [projects]);

  const toggleCompany = (company: string) => {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      return next;
    });
  };

  const toggleOwner = (ownerKey: string) => {
    setExpandedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(ownerKey)) next.delete(ownerKey);
      else next.add(ownerKey);
      return next;
    });
  };

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach((p) => {
      const s = p.status as Status;
      counts[s] = (counts[s] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: t(`status.${status}`, STATUS_META[status as Status]?.label ?? status),
      value,
      color: STATUS_META[status as Status]?.color ?? "#94a3b8",
    }));
  }, [projects, t]);

  const monthlyData = useMemo(() => {
    const months: Record<string, { month: string; value: number; count: number }> = {};
    projects.forEach((p) => {
      if (!p.created_at) return;
      const d = new Date(p.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!months[key]) {
        const monthNum = d.getMonth() + 1;
        const monthName = t(`month.${monthNum}`, d.toLocaleString("default", { month: "short" }));
        months[key] = { month: `${monthName} ${d.getFullYear()}`, value: 0, count: 0 };
      }
      months[key].value += Number(p.estimated_value ?? 0);
      months[key].count += 1;
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([, v]) => v);
  }, [projects, t]);

  const recentProjects = projects.slice(0, 5);
  const ArrowIcon = dir === "rtl" ? ArrowLeft : ArrowRight;
  const ChevronIcon = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-6">
      {/* Top Header & Quick Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("dashboard.title", "لوحة التحكم")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("dashboard.subtitle", "نظرة شاملة على الجهات الدارسة والملاك والمشاريع والأداء")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Actions Dropdown (Plan §4 item 2) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" className="gap-2">
                <Sparkles className="h-4 w-4" />
                <span>إجراءات سريعة</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                الوصول المباشر للوظائف الرئيسية
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={() => navigate({ to: "/projects" })}
              >
                <Plus className="h-4 w-4 text-primary" />
                <span>إضافة مشروع جديد</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={() => navigate({ to: "/boq" })}
              >
                <Calculator className="h-4 w-4 text-emerald-500" />
                <span>جدول الكميات (BOQ)</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={() => navigate({ to: "/resources" })}
              >
                <Database className="h-4 w-4 text-blue-500" />
                <span>عروض الأسعار والموارد</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 cursor-pointer"
                onClick={() => navigate({ to: "/reports" })}
              >
                <BarChart3 className="h-4 w-4 text-purple-500" />
                <span>التقارير والمراجعة المالية</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <NewProjectDialog clients={clients as any} />
        </div>
      </div>

      {/* KPI Cards (Plan §4: تبقى المؤشرات الحالية متاحة) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Building2}
          label={t("dashboard.totalProjects", "إجمالي المشاريع")}
          value={fmtNumber(stats.total, 0)}
          hint={`${stats.active} ${t("dashboard.active", "نشطة")}`}
          color="text-primary"
        />
        <KpiCard
          icon={Wallet}
          label={t("dashboard.totalValue", "إجمالي القيمة التقديرية")}
          value={fmtSAR(stats.totalValue, language)}
          hint={`${t("dashboard.budget", "الميزانية")}: ${fmtSAR(stats.totalBudget, language)}`}
          color="text-emerald-500"
        />
        <KpiCard
          icon={TrendingUp}
          label={t("dashboard.winRate", "نسبة الفوز")}
          value={`${stats.winRate.toFixed(1)}%`}
          hint={`${stats.won} ${t("dashboard.won", "فائز")} / ${stats.lost} ${t("dashboard.lost", "خاسر")}`}
          color="text-blue-500"
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("dashboard.libraryData", "بيانات المكتبة")}
          value={fmtNumber(resourcesCount, 0)}
          hint={`${boqCount} ${t("dashboard.boqItemsCount", "بند كميات")}`}
          color="text-violet-500"
        />
      </div>

      {/* 1. Expandable Company/Owner Tree List (Plan §4 item 1) */}
      <Card className="border border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span>شجرة الشركات والعملاء والمشاريع</span>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              الجهة الدارسة (مثل أوتاد الفهد أو العالمية) ← مالك المشروع (العميل) ← المشاريع التابعة
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="text-xs gap-1.5">
            <Link to="/projects">
              <span>عرض سجل المشاريع (بطاقات)</span>
              <ArrowIcon className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {companyOwnerTree.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              لا توجد مشاريع مسجلة بعد. استخدم «إجراءات سريعة» لإضافة أول مشروع.
            </div>
          ) : (
            companyOwnerTree.map((comp) => {
              const isCompExpanded = expandedCompanies.has(comp.companyName);
              return (
                <div
                  key={comp.companyName}
                  className="rounded-lg border border-border/70 bg-card/60 overflow-hidden"
                >
                  {/* Company Level Header */}
                  <div
                    onClick={() => toggleCompany(comp.companyName)}
                    className="flex items-center justify-between p-3 bg-muted/40 hover:bg-muted/60 cursor-pointer transition-colors select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      {isCompExpanded ? (
                        <ChevronDown className="h-4 w-4 text-primary" />
                      ) : (
                        <ChevronIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                      <Building2 className="h-4 w-4 text-primary" />
                      <span className="font-bold text-sm text-foreground">
                        {comp.companyName}
                      </span>
                      <Badge variant="outline" className="text-[10px] font-mono px-2 py-0">
                        {comp.totalCount} مشاريع
                      </Badge>
                    </div>
                    <div className="text-xs font-mono font-semibold text-primary">
                      {fmtSAR(comp.totalValue, language)}
                    </div>
                  </div>

                  {/* Company Body: Owners */}
                  {isCompExpanded && (
                    <div className="divide-y divide-border/40 bg-background/50">
                      {comp.owners.map((owner) => {
                        const ownerKey = `${comp.companyName}::${owner.clientName}`;
                        const isOwnerExpanded = expandedOwners.has(ownerKey);

                        return (
                          <div key={ownerKey} className="p-2 sm:ps-6">
                            {/* Owner Level Header */}
                            <div
                              onClick={() => toggleOwner(ownerKey)}
                              className="flex items-center justify-between p-2 rounded-md hover:bg-muted/40 cursor-pointer select-none"
                            >
                              <div className="flex items-center gap-2">
                                {isOwnerExpanded ? (
                                  <FolderOpen className="h-4 w-4 text-amber-500" />
                                ) : (
                                  <Folder className="h-4 w-4 text-amber-500" />
                                )}
                                <span className="text-xs font-semibold text-foreground">
                                  {owner.clientName}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  ({owner.projects.length} مشروع)
                                </span>
                              </div>
                              <span className="text-xs font-mono text-muted-foreground">
                                {fmtSAR(owner.totalValue, language)}
                              </span>
                            </div>

                            {/* Owner Body: Projects */}
                            {isOwnerExpanded && (
                              <div className="mt-1 ps-6 space-y-1.5">
                                {owner.projects.map((p) => {
                                  const meta = STATUS_META[p.status as Status];
                                  return (
                                    <Link
                                      key={p.id}
                                      to="/projects/$projectId"
                                      params={{ projectId: p.id }}
                                      onClick={() => setActiveProjectId(p.id)}
                                      className="flex items-center justify-between p-2 rounded border border-border/50 hover:border-primary/40 hover:bg-muted/20 transition-all text-xs"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20 shrink-0">
                                          {(p as any).code || `#${p.project_no || "1"}`}
                                        </span>
                                        <span className="font-medium text-foreground truncate">
                                          {p.name}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3 shrink-0">
                                        <span className="font-mono text-xs font-semibold text-foreground">
                                          {p.estimated_value
                                            ? fmtSAR(Number(p.estimated_value), language)
                                            : "—"}
                                        </span>
                                        <Badge
                                          variant="outline"
                                          className="text-[10px]"
                                          style={{
                                            borderColor: meta?.color,
                                            color: meta?.color,
                                          }}
                                        >
                                          {t(`status.${p.status}`, meta?.label ?? p.status)}
                                        </Badge>
                                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                      </div>
                                    </Link>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* 2 & 3: Recent Projects and Quick Actions Side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Authorized Projects (Plan §4 item 3) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("dashboard.recentProjects", "أحدث المشاريع المصرح بها")}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                آخر 5 مشاريع تم إنشاؤها أو تحديثها في مساحة العمل
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">
                {t("common.viewAll", "عرض الكل")} <ArrowIcon className="ms-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                {t("common.loading", "جارٍ التحميل...")}
              </div>
            ) : recentProjects.length === 0 ? (
              <EmptyState text={t("dashboard.noProjects", "لا توجد مشاريع بعد")} />
            ) : (
              <div className="space-y-2">
                {recentProjects.map((p) => {
                  const meta = STATUS_META[p.status as Status];
                  const label = t(`status.${p.status}`, meta?.label ?? p.status);
                  const company = (p as any).company_name || (p as any).studying_company || "شركة غير محددة";
                  return (
                    <Link
                      key={p.id}
                      to="/projects/$projectId"
                      params={{ projectId: p.id }}
                      onClick={() => setActiveProjectId(p.id)}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/60 hover:bg-muted/40 hover:border-primary/40 transition-all"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate text-foreground">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate flex items-center gap-2 mt-0.5">
                          <span>{p.client_name ?? "مالك غير محدد"}</span>
                          <span>•</span>
                          <span className="text-[11px] bg-muted/60 px-1.5 py-0.5 rounded">{company}</span>
                          {p.project_no && <span>• #{p.project_no}</span>}
                        </div>
                      </div>
                      <div className="text-start shrink-0">
                        <div className="text-sm font-semibold font-mono">
                          {fmtSAR(Number(p.estimated_value ?? 0), language)}
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] mt-0.5"
                          style={{ borderColor: meta?.color, color: meta?.color }}
                        >
                          {label}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions Shortcuts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dashboard.quickActions", "إجراءات سريعة")}</CardTitle>
            <CardDescription className="text-xs">
              الوظائف الأربع الأساسية لتسعير وإدارة المقايسات
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <QuickAction
              to="/projects"
              icon={Plus}
              label={t("dashboard.newProjectAction", "إضافة مشروع جديد")}
            />
            <QuickAction
              to="/boq"
              icon={Calculator}
              label={t("sidebar.boq", "جدول الكميات (BOQ)")}
            />
            <QuickAction
              to="/resources"
              icon={Database}
              label={t("nav.resources", "عروض الأسعار والموارد")}
            />
            <QuickAction
              to="/reports"
              icon={BarChart3}
              label={t("dashboard.viewReports", "التقارير والمراجعة المالية")}
            />
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              {t("dashboard.monthlyValue", "القيمة التقديرية للمشاريع الشهرية")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyData.length === 0 ? (
              <EmptyState text={t("common.noData", "لا توجد بيانات بعد")} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => fmtSAR(v, language)}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("dashboard.statusDistribution", "توزيع المشاريع حسب الحالة")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <EmptyState text={t("common.noData", "لا توجد بيانات بعد")} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(e: any) => e.value}
                  >
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-bold mt-1 truncate">{value}</div>
            {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
          </div>
          <div
            className={`h-9 w-9 rounded-lg bg-muted/40 flex items-center justify-center shrink-0 ${
              color ?? ""
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickAction({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Button asChild variant="outline" className="w-full justify-start gap-2 h-10 text-xs">
      <Link to={to}>
        <Icon className="h-4 w-4 text-primary" />
        <span className="flex-1 text-start">{label}</span>
        <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
      </Link>
    </Button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-center text-sm text-muted-foreground py-12">{text}</div>;
}
