import taqdiriMark from "@/assets/taqdiri-mark.svg";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Calculator,
  LayoutDashboard,
  FileText,
  TrendingUp,
  Layers,
  Database,
  ShieldCheck,
  BarChart3,
  Sparkles,
  Settings,
  LogOut,
  Search,
  Building2,
  Check,
  ChevronsUpDown,
  FolderKanban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Save,
  RefreshCw,
  Plus,
  Users,
  Briefcase,
  Boxes,
  Hammer,
  Truck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { estimationClient } from "@/lib/estimation-client";
import { isLocalDevelopment } from "@/lib/local-development";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveProjectId, setActiveProjectId } from "@/lib/active-project";
import { useLanguage } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { WorkspaceActionsProvider, useWorkspaceActions } from "@/lib/workspace-page-actions";

type SidebarProject = {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
  company_name?: string | null;
  created_at?: string;
};

const SECONDARY_NAV_ITEMS = [
  { to: "/boq", translationKey: "nav.boq", defaultLabel: "جدول الكميات", icon: Calculator },
  { to: "/price-analysis", translationKey: "nav.priceAnalysis", defaultLabel: "تحليل الأسعار", icon: TrendingUp },
  { to: "/item-breakdown-library", translationKey: "nav.itemBreakdownLibrary", defaultLabel: "مكتبة نماذج البنود", icon: Layers },
  { to: "/financial", translationKey: "nav.financial", defaultLabel: "المراجعة المالية", icon: ShieldCheck },
  { to: "/reports", translationKey: "nav.reports", defaultLabel: "التقارير", icon: BarChart3 },
  { to: "/ai-assistant", translationKey: "nav.aiAssistant", defaultLabel: "مساعد الذكاء الاصطناعي", icon: Sparkles },
  { to: "/settings", translationKey: "nav.settings", defaultLabel: "الإعدادات والصلاحيات", icon: Settings },
] as const;

const RESOURCE_SUB_ITEMS = [
  { tab: "all", label: "عام", icon: Database },
  { tab: "material", label: "مواد", icon: Boxes },
  { tab: "labor", label: "العمالة", icon: Hammer },
  { tab: "equipment", label: "المعدات", icon: Truck },
  { tab: "subcontractor", label: "مقاول الباطن", icon: Briefcase },
  { tab: "general_requirements", label: "المتطلبات العامة", icon: FileText },
] as const;

function ProjectSwitcher({ projects }: { projects: SidebarProject[] }) {
  const [open, setOpen] = useState(false);
  const activeId = useActiveProjectId();
  const qc = useQueryClient();
  const { t } = useLanguage();
  const actions = useWorkspaceActions();

  useEffect(() => {
    const firstProject = projects[0];
    if (!activeId && firstProject) setActiveProjectId(firstProject.id);
  }, [activeId, projects]);

  const active = projects.find((p) => p.id === activeId);

  const selectProject = (id: string) => {
    const proceed = () => {
      setActiveProjectId(id);
      qc.invalidateQueries({ queryKey: ["active-project-data"] });
      setOpen(false);
    };
    if (actions && id !== activeId) {
      actions.guardNavigation("تغيير المشروع النشط", proceed);
    } else {
      proceed();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-full justify-between gap-2 px-3 text-start"
        >
          <FolderKanban className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="flex-1 truncate text-xs font-medium">
            {active?.name ??
              (projects.length === 0
                ? t("nav.newProject", "أنشئ مشروعاً")
                : t("nav.selectProject", "اختر مشروعاً للبدء"))}
          </span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        <div className="max-h-72 overflow-auto">
          {projects.length === 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground">
              {t("projects.empty", "لا توجد مشاريع بعد")}
            </div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProject(p.id)}
              className={cn(
                "flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-2 text-start text-xs hover:bg-accent",
                p.id === activeId && "bg-primary/10 text-primary",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                {p.client_name && (
                  <div className="truncate text-[10px] text-muted-foreground">{p.client_name}</div>
                )}
              </div>
              {p.id === activeId && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
        <div className="mt-1 border-t border-border pt-1">
          <Link
            to="/projects"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2.5 py-2 text-center text-xs text-primary hover:bg-accent"
          >
            {t("nav.manageAllProjects", "إدارة كل المشاريع ←")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TreeToggleArrow({
  isOpen,
  onToggle,
  direction,
  label,
}: {
  isOpen: boolean;
  onToggle: () => void;
  direction: "rtl" | "ltr";
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-label={label}
      aria-expanded={isOpen}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
    >
      {isOpen ? (
        <ChevronDown className="h-3.5 w-3.5" />
      ) : direction === "rtl" ? (
        <ChevronLeft className="h-3.5 w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr || "" });
  const [email, setEmail] = useState<string>("");
  const { t, direction } = useLanguage();
  const localDevelopment = isLocalDevelopment();
  const actions = useWorkspaceActions();

  const searchParams = useMemo(() => new URLSearchParams(searchStr), [searchStr]);
  const urlCompany = searchParams.get("company") ?? "";
  const urlTab = searchParams.get("tab") ?? "";

  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    dashboard: false,
    clients: false,
    projects: false,
    resources: false,
  });

  // Restore active branch & open ancestors automatically from URL
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      if (pathname.startsWith("/dashboard")) next["dashboard"] = true;
      if (pathname.startsWith("/clients")) {
        next["clients"] = true;
        if (urlCompany) next[`clients:company:${urlCompany}`] = true;
      }
      if (pathname.startsWith("/projects")) {
        next["projects"] = true;
        if (urlCompany) next[`projects:company:${urlCompany}`] = true;
      }
      if (pathname.startsWith("/resources")) next["resources"] = true;
      return next;
    });
  }, [pathname, urlCompany]);

  const toggleNode = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (localDevelopment) return;
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, [localDevelopment]);

  const { data: projects = [] } = useQuery({
    queryKey: ["project-switcher-projects"],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("projects")
        .select("id, name, client_id, client_name, company_name, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as SidebarProject[]) ?? [];
    },
  });

  // Build hierarchical Company -> Owner -> Projects index
  const companyTree = useMemo(() => {
    const companyMap = new Map<
      string,
      {
        companyName: string;
        owners: Map<
          string,
          {
            ownerKey: string;
            ownerName: string;
            clientId: string | null;
            projects: SidebarProject[];
          }
        >;
        projects: SidebarProject[];
      }
    >();

    for (const p of projects) {
      const rawCompany = (p.company_name || "").trim();
      const companyName = rawCompany || "شركة غير محددة";
      if (!companyMap.has(companyName)) {
        companyMap.set(companyName, {
          companyName,
          owners: new Map(),
          projects: [],
        });
      }
      const cEntry = companyMap.get(companyName)!;
      cEntry.projects.push(p);

      const ownerName = (p.client_name || "مالك غير محدد").trim();
      const ownerKey = p.client_id || ownerName;
      if (!cEntry.owners.has(ownerKey)) {
        cEntry.owners.set(ownerKey, {
          ownerKey,
          ownerName,
          clientId: p.client_id,
          projects: [],
        });
      }
      cEntry.owners.get(ownerKey)!.projects.push(p);
    }

    return Array.from(companyMap.values()).map((c) => ({
      companyName: c.companyName,
      projects: c.projects,
      owners: Array.from(c.owners.values()),
    }));
  }, [projects]);

  const recentProjects = useMemo(() => projects.slice(0, 5), [projects]);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  const guardedNavigate = (to: string, label: string) => {
    const go = () => {
      void navigate({ to: to as any });
    };
    if (actions) {
      actions.guardNavigation(label, go);
    } else {
      go();
    }
  };

  return (
    // Outer container uses dir="ltr" so the sidebar is consistently positioned on the LEFT side per spec §4,
    // while inner panels keep dir={direction} for Arabic RTL / English LTR text flow.
    <div dir="ltr" className="flex min-h-screen w-full bg-background text-foreground">
      {/* Left Hierarchical Sidebar */}
      <aside
        dir={direction}
        className="sticky top-0 flex h-screen w-68 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
          <img src={taqdiriMark} alt="" width={32} height={32} />
          <div className="leading-tight">
            <div className="text-sm font-bold text-sidebar-foreground">{t("nav.brand", "تقديري")}</div>
            <div className="text-[10px] text-muted-foreground">{t("nav.subtitle", "منصة التسعير الاحترافية")}</div>
          </div>
        </div>

        <div className="border-b border-sidebar-border p-2">
          <ProjectSwitcher projects={projects} />
        </div>

        <nav className="flex-1 overflow-y-auto p-2 text-xs">
          <ul className="space-y-1">
            {/* 1. لوحة التحكم */}
            <li>
              <div
                className={cn(
                  "flex items-center justify-between gap-1 rounded-md px-2 py-1.5 transition-colors",
                  pathname.startsWith("/dashboard")
                    ? "bg-primary/15 text-primary ring-1 ring-primary/20 font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => guardedNavigate("/dashboard", "لوحة التحكم")}
                  className="flex flex-1 items-center gap-2 text-start text-sm"
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t("nav.dashboard", "لوحة التحكم")}</span>
                </button>
                <TreeToggleArrow
                  isOpen={Boolean(expanded["dashboard"])}
                  onToggle={() => toggleNode("dashboard")}
                  direction={direction}
                  label="توسيع قائمة لوحة التحكم"
                />
              </div>

              {expanded["dashboard"] && (
                <ul className="mt-1 space-y-0.5 border-s border-border/60 ms-3 ps-2">
                  <li>
                    <button
                      type="button"
                      onClick={() => guardedNavigate("/dashboard", "لوحة التحكم — عام")}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1 text-start hover:bg-sidebar-accent",
                        pathname === "/dashboard" && "text-primary font-medium",
                      )}
                    >
                      <span>عام</span>
                    </button>
                  </li>

                  {/* قائمة العملاء / الشركات */}
                  <li>
                    <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-sidebar-accent">
                      <button
                        type="button"
                        onClick={() => guardedNavigate("/clients", "قائمة العملاء والشركات")}
                        className="flex-1 text-start font-medium"
                      >
                        قائمة العملاء / الشركات
                      </button>
                      <TreeToggleArrow
                        isOpen={Boolean(expanded["dash:companies"])}
                        onToggle={() => toggleNode("dash:companies")}
                        direction={direction}
                        label="توسيع قائمة الشركات"
                      />
                    </div>
                    {expanded["dash:companies"] && (
                      <ul className="ms-2 border-s border-border/50 ps-2 space-y-0.5">
                        {companyTree.map((c) => (
                          <li key={c.companyName}>
                            <button
                              type="button"
                              onClick={() =>
                                guardedNavigate(
                                  `/clients?company=${encodeURIComponent(c.companyName)}`,
                                  c.companyName,
                                )
                              }
                              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                            >
                              <Building2 className="h-3 w-3 shrink-0" />
                              <span className="truncate">{c.companyName}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>

                  {/* إجراءات سريعة */}
                  <li>
                    <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-sidebar-accent">
                      <button
                        type="button"
                        onClick={() => guardedNavigate("/dashboard", "إجراءات سريعة")}
                        className="flex-1 text-start font-medium"
                      >
                        إجراءات سريعة
                      </button>
                      <TreeToggleArrow
                        isOpen={Boolean(expanded["dash:quick"])}
                        onToggle={() => toggleNode("dash:quick")}
                        direction={direction}
                        label="توسيع الإجراءات السريعة"
                      />
                    </div>
                    {expanded["dash:quick"] && (
                      <ul className="ms-2 border-s border-border/50 ps-2 space-y-0.5 text-[11px]">
                        <li>
                          <button
                            type="button"
                            onClick={() => guardedNavigate("/projects?new=1", "إضافة مشروع جديد")}
                            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start hover:bg-sidebar-accent"
                          >
                            <Plus className="h-3 w-3 text-primary" />
                            <span>إضافة مشروع جديد</span>
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            onClick={() => guardedNavigate("/boq", "جدول الكميات")}
                            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start hover:bg-sidebar-accent"
                          >
                            <Calculator className="h-3 w-3" />
                            <span>جدول الكميات</span>
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            onClick={() => guardedNavigate("/resources", "عروض الأسعار")}
                            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start hover:bg-sidebar-accent"
                          >
                            <Database className="h-3 w-3" />
                            <span>عروض الأسعار</span>
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            onClick={() => guardedNavigate("/reports", "عرض التقارير")}
                            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start hover:bg-sidebar-accent"
                          >
                            <BarChart3 className="h-3 w-3" />
                            <span>عرض التقارير</span>
                          </button>
                        </li>
                      </ul>
                    )}
                  </li>

                  {/* أحدث المشاريع */}
                  <li>
                    <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-sidebar-accent">
                      <button
                        type="button"
                        onClick={() => guardedNavigate("/projects", "أحدث المشاريع")}
                        className="flex-1 text-start font-medium"
                      >
                        أحدث المشاريع
                      </button>
                      <TreeToggleArrow
                        isOpen={Boolean(expanded["dash:recent"])}
                        onToggle={() => toggleNode("dash:recent")}
                        direction={direction}
                        label="توسيع أحدث المشاريع"
                      />
                    </div>
                    {expanded["dash:recent"] && (
                      <ul className="ms-2 border-s border-border/50 ps-2 space-y-0.5 text-[11px]">
                        {recentProjects.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveProjectId(p.id);
                                guardedNavigate(`/projects/${p.id}`, p.name);
                              }}
                              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                            >
                              <FileText className="h-3 w-3 shrink-0" />
                              <span className="truncate">{p.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                </ul>
              )}
            </li>

            {/* 2. العملاء */}
            <li>
              <div
                className={cn(
                  "flex items-center justify-between gap-1 rounded-md px-2 py-1.5 transition-colors",
                  pathname.startsWith("/clients")
                    ? "bg-primary/15 text-primary ring-1 ring-primary/20 font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => guardedNavigate("/clients", "العملاء")}
                  className="flex flex-1 items-center gap-2 text-start text-sm"
                >
                  <Building2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t("nav.clients", "العملاء")}</span>
                </button>
                <TreeToggleArrow
                  isOpen={Boolean(expanded["clients"])}
                  onToggle={() => toggleNode("clients")}
                  direction={direction}
                  label="توسيع قائمة العملاء"
                />
              </div>

              {expanded["clients"] && (
                <ul className="mt-1 space-y-0.5 border-s border-border/60 ms-3 ps-2">
                  <li>
                    <button
                      type="button"
                      onClick={() => guardedNavigate("/clients", "العملاء — عام")}
                      className={cn(
                        "flex w-full items-center rounded px-2 py-1 text-start hover:bg-sidebar-accent",
                        pathname === "/clients" && !urlCompany && "text-primary font-medium",
                      )}
                    >
                      عام
                    </button>
                  </li>
                  {companyTree.map((c) => {
                    const compKey = `clients:company:${c.companyName}`;
                    const compOpen = Boolean(expanded[compKey]);
                    return (
                      <li key={c.companyName}>
                        <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-sidebar-accent">
                          <button
                            type="button"
                            onClick={() =>
                              guardedNavigate(
                                `/clients?company=${encodeURIComponent(c.companyName)}`,
                                c.companyName,
                              )
                            }
                            className={cn(
                              "flex flex-1 items-center gap-1.5 text-start truncate",
                              pathname.startsWith("/clients") && urlCompany === c.companyName && "text-primary font-medium",
                            )}
                          >
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{c.companyName}</span>
                          </button>
                          <TreeToggleArrow
                            isOpen={compOpen}
                            onToggle={() => toggleNode(compKey)}
                            direction={direction}
                            label={`توسيع ${c.companyName}`}
                          />
                        </div>
                        {compOpen && (
                          <ul className="ms-2 border-s border-border/50 ps-2 space-y-0.5">
                            {c.owners.map((o) => {
                              const ownerKey = `${compKey}:owner:${o.ownerKey}`;
                              const ownerOpen = Boolean(expanded[ownerKey]);
                              return (
                                <li key={o.ownerKey}>
                                  <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-sidebar-accent text-[11px]">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (o.clientId) {
                                          guardedNavigate(`/clients/${o.clientId}`, o.ownerName);
                                        } else {
                                          guardedNavigate(
                                            `/clients?company=${encodeURIComponent(c.companyName)}&owner=${encodeURIComponent(o.ownerName)}`,
                                            o.ownerName,
                                          );
                                        }
                                      }}
                                      className="flex flex-1 items-center gap-1.5 text-start truncate"
                                    >
                                      <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                                      <span className="truncate">{o.ownerName}</span>
                                    </button>
                                    <TreeToggleArrow
                                      isOpen={ownerOpen}
                                      onToggle={() => toggleNode(ownerKey)}
                                      direction={direction}
                                      label={`توسيع مشاريع ${o.ownerName}`}
                                    />
                                  </div>
                                  {ownerOpen && (
                                    <ul className="ms-2 border-s border-border/40 ps-2 space-y-0.5 text-[11px]">
                                      {o.projects.map((p) => (
                                        <li key={p.id}>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveProjectId(p.id);
                                              guardedNavigate(`/projects/${p.id}`, p.name);
                                            }}
                                            className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-start text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                                          >
                                            <span className="truncate">• {p.name}</span>
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>

            {/* 3. المشاريع */}
            <li>
              <div
                className={cn(
                  "flex items-center justify-between gap-1 rounded-md px-2 py-1.5 transition-colors",
                  pathname.startsWith("/projects")
                    ? "bg-primary/15 text-primary ring-1 ring-primary/20 font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => guardedNavigate("/projects", "المشاريع")}
                  className="flex flex-1 items-center gap-2 text-start text-sm"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t("nav.projects", "المشاريع")}</span>
                </button>
                <TreeToggleArrow
                  isOpen={Boolean(expanded["projects"])}
                  onToggle={() => toggleNode("projects")}
                  direction={direction}
                  label="توسيع قائمة المشاريع"
                />
              </div>

              {expanded["projects"] && (
                <ul className="mt-1 space-y-0.5 border-s border-border/60 ms-3 ps-2">
                  <li>
                    <button
                      type="button"
                      onClick={() => guardedNavigate("/projects", "المشاريع — عام")}
                      className={cn(
                        "flex w-full items-center rounded px-2 py-1 text-start hover:bg-sidebar-accent",
                        pathname === "/projects" && !urlCompany && "text-primary font-medium",
                      )}
                    >
                      عام
                    </button>
                  </li>
                  {companyTree.map((c) => {
                    const compKey = `projects:company:${c.companyName}`;
                    const compOpen = Boolean(expanded[compKey]);
                    return (
                      <li key={c.companyName}>
                        <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-sidebar-accent">
                          <button
                            type="button"
                            onClick={() =>
                              guardedNavigate(
                                `/projects?company=${encodeURIComponent(c.companyName)}`,
                                c.companyName,
                              )
                            }
                            className={cn(
                              "flex flex-1 items-center gap-1.5 text-start truncate",
                              pathname.startsWith("/projects") && urlCompany === c.companyName && "text-primary font-medium",
                            )}
                          >
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{c.companyName}</span>
                          </button>
                          <TreeToggleArrow
                            isOpen={compOpen}
                            onToggle={() => toggleNode(compKey)}
                            direction={direction}
                            label={`توسيع مشاريع ${c.companyName}`}
                          />
                        </div>
                        {compOpen && (
                          <ul className="ms-2 border-s border-border/50 ps-2 space-y-0.5 text-[11px]">
                            {c.projects.map((p) => (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveProjectId(p.id);
                                    guardedNavigate(`/projects/${p.id}`, p.name);
                                  }}
                                  className={cn(
                                    "flex w-full items-center gap-1.5 rounded px-2 py-1 text-start hover:bg-sidebar-accent",
                                    pathname === `/projects/${p.id}`
                                      ? "text-primary font-medium"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                >
                                  <FileText className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{p.name}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>

            {/* 4. عروض الأسعار */}
            <li>
              <div
                className={cn(
                  "flex items-center justify-between gap-1 rounded-md px-2 py-1.5 transition-colors",
                  pathname.startsWith("/resources")
                    ? "bg-primary/15 text-primary ring-1 ring-primary/20 font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => guardedNavigate("/resources", "عروض الأسعار")}
                  className="flex flex-1 items-center gap-2 text-start text-sm"
                >
                  <Database className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t("nav.resources", "عروض الأسعار")}</span>
                </button>
                <TreeToggleArrow
                  isOpen={Boolean(expanded["resources"])}
                  onToggle={() => toggleNode("resources")}
                  direction={direction}
                  label="توسيع قائمة عروض الأسعار"
                />
              </div>

              {expanded["resources"] && (
                <ul className="mt-1 space-y-0.5 border-s border-border/60 ms-3 ps-2">
                  {RESOURCE_SUB_ITEMS.map((sub) => {
                    const SubIcon = sub.icon;
                    const isSubActive =
                      pathname.startsWith("/resources") &&
                      (urlTab === sub.tab || (sub.tab === "all" && !urlTab));
                    return (
                      <li key={sub.tab}>
                        <button
                          type="button"
                          onClick={() =>
                            guardedNavigate(`/resources?tab=${sub.tab}`, `عروض الأسعار — ${sub.label}`)
                          }
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1 text-start hover:bg-sidebar-accent",
                            isSubActive ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <SubIcon className="h-3 w-3 shrink-0" />
                          <span>{sub.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>

            {/* Secondary Workspace Links */}
            <li className="pt-2 mt-2 border-t border-sidebar-border/60" />
            {SECONDARY_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.to);
              const label = t(item.translationKey, item.defaultLabel);
              return (
                <li key={item.to}>
                  <button
                    type="button"
                    onClick={() => guardedNavigate(item.to, label)}
                    className={cn(
                      "group flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors text-start",
                      active
                        ? "bg-primary/15 text-primary ring-1 ring-primary/20 font-medium"
                        : "text-sidebar-foreground hover:bg-sidebar-accent",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{label}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {!localDevelopment && (
          <div className="border-t border-sidebar-border p-3">
            <div className="mb-2 flex items-center gap-2 rounded-md bg-card/50 px-2.5 py-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                {email.charAt(0).toUpperCase() || "U"}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-xs font-medium text-sidebar-foreground">
                  {email || t("common.user", "مستخدم")}
                </div>
                <div className="text-[10px] text-muted-foreground">{t("common.pricingManager", "مدير التسعير")}</div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              {t("nav.signOut", "تسجيل الخروج")}
            </Button>
          </div>
        )}
      </aside>

      {/* Main area */}
      <div dir={direction} className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/80 px-6 backdrop-blur">
          <div className="relative flex-1 max-w-md">
            <Search
              className={cn(
                "pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
                direction === "rtl" ? "right-3" : "left-3",
              )}
            />
            <Input
              placeholder={t("nav.searchPlaceholder", "ابحث في البنود، الموارد، المناقصات…")}
              className={cn("h-9 text-sm", direction === "rtl" ? "pr-9" : "pl-9")}
            />
          </div>

          {/* Global Save & Refresh + Status Badges */}
          <div className="flex items-center gap-2">
            {actions && (
              <div className="flex items-center gap-1.5 me-1">
                {actions.lastSavedAt && (
                  <span className="hidden lg:inline text-[11px] text-muted-foreground">
                    آخر حفظ: {actions.lastSavedAt.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <Button
                  size="sm"
                  variant={actions.config?.isDirty ? "default" : "outline"}
                  className="h-8 gap-1.5"
                  disabled={
                    actions.isSaving ||
                    (actions.config?.hasEditableState === false && !actions.config?.isDirty)
                  }
                  onClick={() => void actions.triggerSave()}
                  title="حفظ تعديلات الصفحة الحالية"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{actions.isSaving ? "جاري الحفظ…" : "حفظ"}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  disabled={actions.isRefreshing}
                  onClick={() => void actions.triggerRefresh()}
                  title="تحديث بيانات الصفحة الحالية"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", actions.isRefreshing && "animate-spin")} />
                  <span>{actions.isRefreshing ? "جاري التحديث…" : "تحديث"}</span>
                </Button>
              </div>
            )}

            <Badge
              variant="outline"
              className="hidden h-7 gap-1.5 border-primary/30 bg-primary/10 text-primary md:flex"
            >
              <Sparkles className="h-3 w-3" />
              {t("nav.aiAssistant", "مساعد الذكاء الاصطناعي")}
            </Badge>
            <Badge variant="outline" className="h-7 gap-1.5 border-border/60">
              <Building2 className="h-3 w-3" />
              {t("nav.saudiMarket", "السوق السعودي")}
            </Badge>
            <LanguageSwitcher />
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* Pending Unsaved Changes Guard Dialog */}
      <Dialog
        open={Boolean(actions?.pendingDirtyPrompt)}
        onOpenChange={(open) => {
          if (!open) void actions?.resolveDirtyPrompt("cancel");
        }}
      >
        <DialogContent dir={direction} className="max-w-md">
          <DialogHeader>
            <DialogTitle>تغييرات غير محفوظة</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed pt-1">
              يوجد تعديلات معلّقة في هذه الصفحة قبل تنفيذ ({actions?.pendingDirtyPrompt?.actionLabel}). ماذا تفضل؟
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void actions?.resolveDirtyPrompt("cancel")}
            >
              متابعة التحرير
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void actions?.resolveDirtyPrompt("discard")}
            >
              تجاهل التعديلات
            </Button>
            <Button
              size="sm"
              onClick={() => void actions?.resolveDirtyPrompt("save_and_proceed")}
            >
              حفظ ثم متابعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceActionsProvider>
      <AppShellInner>{children}</AppShellInner>
    </WorkspaceActionsProvider>
  );
}
