import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveProjectId, setActiveProjectId } from "@/lib/active-project";
import { useLanguage } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/ui/language-switcher";

type NavItemConfig = {
  to: string;
  translationKey: string;
  defaultLabel: string;
  icon: typeof LayoutDashboard;
  enabled: boolean;
};

const NAV_ITEMS: NavItemConfig[] = [
  { to: "/dashboard", translationKey: "nav.dashboard", defaultLabel: "لوحة التحكم", icon: LayoutDashboard, enabled: true },
  { to: "/projects", translationKey: "nav.projects", defaultLabel: "المشاريع", icon: FileText, enabled: true },
  { to: "/boq", translationKey: "nav.boq", defaultLabel: "جدول الكميات", icon: Calculator, enabled: true },
  { to: "/price-analysis", translationKey: "nav.priceAnalysis", defaultLabel: "تحليل الأسعار", icon: TrendingUp, enabled: true },
  { to: "/item-breakdown-library", translationKey: "nav.itemBreakdownLibrary", defaultLabel: "مكتبة نماذج البنود", icon: Layers, enabled: true },
  { to: "/resources", translationKey: "nav.resources", defaultLabel: "عروض الأسعار", icon: Database, enabled: true },
  { to: "/financial", translationKey: "nav.financial", defaultLabel: "المراجعة المالية", icon: ShieldCheck, enabled: true },
  { to: "/reports", translationKey: "nav.reports", defaultLabel: "التقارير", icon: BarChart3, enabled: true },
  { to: "/ai-assistant", translationKey: "nav.aiAssistant", defaultLabel: "مساعد الذكاء الاصطناعي", icon: Sparkles, enabled: true },
  { to: "/settings", translationKey: "nav.settings", defaultLabel: "الإعدادات والصلاحيات", icon: Settings, enabled: true },
];

function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const activeId = useActiveProjectId();
  const qc = useQueryClient();
  const { t } = useLanguage();
  const { data: projects = [] } = useQuery({
    queryKey: ["project-switcher-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, client_name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; name: string; client_name: string | null }[];
    },
  });

  // Auto-pick first project on first load
  useEffect(() => {
    const firstProject = projects[0];
    if (!activeId && firstProject) setActiveProjectId(firstProject.id);
  }, [activeId, projects]);

  const active = projects.find((p) => p.id === activeId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-full justify-between gap-2 px-3 text-start"
        >
          <FolderKanban className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="flex-1 truncate text-xs font-medium">
            {active?.name ?? (projects.length === 0 ? t("nav.newProject", "أنشئ مشروعاً") : t("nav.selectProject", "اختر مشروعاً للبدء"))}
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
              onClick={() => {
                setActiveProjectId(p.id);
                qc.invalidateQueries({ queryKey: ["active-project-data"] });
                setOpen(false);
              }}
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

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string>("");
  const { t, direction } = useLanguage();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar (adapts side automatically via flex and border) */}
      <aside
        className={cn(
          "sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-sidebar",
          direction === "rtl" ? "border-l border-sidebar-border" : "border-r border-sidebar-border"
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
            <Calculator className="h-4 w-4 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold text-sidebar-foreground">{t("nav.brand", "تقديري")}</div>
            <div className="text-[10px] text-muted-foreground">{t("nav.subtitle", "منصة التسعير الاحترافية")}</div>
          </div>
        </div>

        <div className="border-b border-sidebar-border p-2">
          <ProjectSwitcher />
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.to);
              const label = t(item.translationKey, item.defaultLabel);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      "group flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary/15 text-primary ring-1 ring-primary/20 font-medium"
                        : "text-sidebar-foreground hover:bg-sidebar-accent",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{label}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

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
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/80 px-6 backdrop-blur">
          <div className="relative flex-1 max-w-md">
            <Search
              className={cn(
                "pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
                direction === "rtl" ? "right-3" : "left-3"
              )}
            />
            <Input
              placeholder={t("nav.searchPlaceholder", "ابحث في البنود، الموارد، المناقصات…")}
              className={cn("h-9 text-sm", direction === "rtl" ? "pr-9" : "pl-9")}
            />
          </div>
          <div className="flex items-center gap-2">
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
    </div>
  );
}
