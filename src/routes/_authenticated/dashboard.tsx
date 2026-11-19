import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Wallet,
  TrendingUp,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Database,
  Calculator,
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
import { useLanguage } from "@/lib/i18n";
import { STATUS_CONFIGS, type ProjectStatus } from "@/lib/status";
import type { Database as DB } from "@/integrations/supabase/types";

type Project = DB["public"]["Tables"]["projects"]["Row"];
type Status = DB["public"]["Enums"]["project_status"];

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

const WON_STATUSES: Status[] = ["construction_ongoing", "construction_complete", "finished"];
const LOST_STATUSES: Status[] = ["client_rejected"];

function DashboardPage() {
  const { t, language, direction } = useLanguage();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["dashboard-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  const { data: resourcesCount = 0 } = useQuery({
    queryKey: ["dashboard-resources-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("resources")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: boqCount = 0 } = useQuery({
    queryKey: ["dashboard-boq-count"],
    queryFn: async () => {
      const { count, error } = await supabase
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
      ["studying", "submitted_to_client", "submitted_to_medial_man", "waiting_for_reply", "inquiries_sent", "answers_received", "construction_ongoing"].includes(p.status as string)
    ).length;
    return { total, totalValue, totalBudget, won, lost, winRate, active };
  }, [projects]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach((p) => {
      const s = p.status as Status;
      counts[s] = (counts[s] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => {
      const cfg = STATUS_CONFIGS[status as ProjectStatus];
      return {
        name: cfg ? t(cfg.translationKey) : status,
        value,
        color: cfg?.color ?? "#94a3b8",
      };
    });
  }, [projects, t]);

  const monthlyData = useMemo(() => {
    const months: Record<string, { month: string; value: number; count: number }> = {};
    const monthNames = [
      t("month.1"), t("month.2"), t("month.3"), t("month.4"),
      t("month.5"), t("month.6"), t("month.7"), t("month.8"),
      t("month.9"), t("month.10"), t("month.11"), t("month.12")
    ];
    projects.forEach((p) => {
      if (!p.created_at) return;
      const d = new Date(p.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!months[key]) months[key] = { month: `${monthNames[d.getMonth()]} ${d.getFullYear()}`, value: 0, count: 0 };
      months[key].value += Number(p.estimated_value ?? 0);
      months[key].count += 1;
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([, v]) => v);
  }, [projects, t]);

  const recentProjects = projects.slice(0, 5);
  const ArrowIcon = direction === "rtl" ? ArrowLeft : ArrowRight;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/projects">
            {t("dashboard.manageProjects")} <ArrowIcon className="ms-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Building2}
          label={t("dashboard.totalProjects")}
          value={fmtNumber(stats.total, 0)}
          hint={`${stats.active} ${t("dashboard.active")}`}
          color="text-primary"
        />
        <KpiCard
          icon={Wallet}
          label={t("dashboard.totalValue")}
          value={fmtSAR(stats.totalValue, language)}
          hint={`${t("dashboard.budget")}: ${fmtSAR(stats.totalBudget, language)}`}
          color="text-emerald-500"
        />
        <KpiCard
          icon={TrendingUp}
          label={t("dashboard.winRate")}
          value={`${stats.winRate.toFixed(1)}%`}
          hint={`${stats.won} ${t("dashboard.won")} / ${stats.lost} ${t("dashboard.lost")}`}
          color="text-blue-500"
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("dashboard.libraryData")}
          value={fmtNumber(resourcesCount, 0)}
          hint={`${boqCount} ${t("dashboard.boqItemsCount")}`}
          color="text-violet-500"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("dashboard.monthlyValue")}</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyData.length === 0 ? (
              <EmptyState text={t("common.noData")} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => fmtSAR(v, language)}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dashboard.statusDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <EmptyState text={t("common.noData")} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => e.value}>
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent projects + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("dashboard.recentProjects")}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">
                {t("common.viewAll")} <ArrowIcon className="ms-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center text-sm text-muted-foreground py-8">{t("common.loading")}</div>
            ) : recentProjects.length === 0 ? (
              <EmptyState text={t("dashboard.noProjects")} />
            ) : (
              <div className="space-y-2">
                {recentProjects.map((p) => {
                  const cfg = STATUS_CONFIGS[p.status as ProjectStatus];
                  const label = cfg ? t(cfg.translationKey) : p.status;
                  return (
                    <Link
                      key={p.id}
                      to="/projects/$projectId"
                      params={{ projectId: p.id }}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/60 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.client_name ?? "—"} · {p.project_no ? `#${p.project_no}` : ""}
                        </div>
                      </div>
                      <div className="text-end shrink-0">
                        <div className="text-sm font-semibold">{fmtSAR(p.estimated_value, language)}</div>
                        <Badge variant="outline" className="text-[10px] mt-0.5" style={{ borderColor: cfg?.color, color: cfg?.color }}>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("dashboard.quickActions")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <QuickAction to="/projects" icon={Building2} label={t("dashboard.newProjectAction")} direction={direction} />
            <QuickAction to="/boq" icon={Calculator} label={t("nav.boq")} direction={direction} />
            <QuickAction to="/resources" icon={Database} label={t("nav.resources")} direction={direction} />
            <QuickAction to="/reports" icon={TrendingUp} label={t("dashboard.viewReports")} direction={direction} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, hint, color }: { icon: any; label: string; value: string; hint?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-bold mt-1 truncate">{value}</div>
            {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
          </div>
          <div className={`h-9 w-9 rounded-lg bg-muted/40 flex items-center justify-center shrink-0 ${color ?? ""}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickAction({ to, icon: Icon, label, direction }: { to: string; icon: any; label: string; direction: string }) {
  const ArrowIcon = direction === "rtl" ? ArrowLeft : ArrowRight;
  return (
    <Button asChild variant="outline" className="w-full justify-start gap-2 h-10">
      <Link to={to}>
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-start">{label}</span>
        <ArrowIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </Link>
    </Button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-center text-sm text-muted-foreground py-12">{text}</div>;
}
