import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FolderPlus,
  Layers,
  Sparkles,
  Calculator,
  ChevronRight,
  Menu,
  ArrowRight,
  ExternalLink,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useActiveProjectId } from "@/lib/active-project";
import { PaGrid } from "@/components/price-analysis/pa-grid";
import { BoqSidebar } from "@/components/price-analysis/boq-sidebar";
import { InPlaceTemplateCaller } from "@/components/price-analysis/in-place-template-caller";
import type { Database } from "@/integrations/supabase/types";
import { useLanguage } from "@/lib/i18n";
import { fmtNumber, fmtSAR } from "@/lib/format";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];

const searchSchema = z.object({ item: z.string().optional() });

export const Route = createFileRoute("/_authenticated/price-analysis")({
  head: () => ({
    meta: [
      { title: "تحليل الأسعار — تقديري" },
      {
        name: "description",
        content:
          "منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.",
      },
      { property: "og:title", content: "تحليل الأسعار — تقديري" },
      {
        property: "og:description",
        content:
          "منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: searchSchema,
  component: PriceAnalysisPage,
});

function PriceAnalysisPage() {
  const { t, language } = useLanguage();
  const isEn = language === "en";
  const { item } = Route.useSearch();
  const navigate = Route.useNavigate();
  const projectId = useActiveProjectId();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(item ?? null);
  const [templateCallerOpen, setTemplateCallerOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isAddingDemo, setIsAddingDemo] = useState(false);

  // Fetch BOQ items for active project
  const { data: boqItems = [], isLoading } = useQuery({
    queryKey: ["boq_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data, error } = await supabase
        .from("boq_items")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_group", false)
        .order("sort_order")
        .order("item_no");
      if (error) throw error;
      return data as BoqRow[];
    },
  });

  // Auto-pick first item if none selected and items exist
  useEffect(() => {
    if (!selectedId && boqItems.length > 0) {
      setSelectedId(boqItems[0]?.id ?? null);
    }
  }, [boqItems, selectedId]);

  // Synchronize search param
  useEffect(() => {
    if (item && item !== selectedId) {
      setSelectedId(item);
    }
  }, [item, selectedId]);

  const selected = boqItems.find((b) => b.id === selectedId) ?? null;

  const handleSelectItem = (itemRow: BoqRow) => {
    setSelectedId(itemRow.id);
    navigate({ search: { item: itemRow.id }, replace: true });
    setMobileSidebarOpen(false);
  };

  const handleAddDemoItem = async () => {
    if (!projectId) {
      toast.error("يرجى اختيار مشروع أولاً");
      return;
    }
    setIsAddingDemo(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("يرجى تسجيل الدخول أولاً");

      const { data, error } = await supabase
        .from("boq_items")
        .insert({
          project_id: projectId,
          user_id: userId,
          item_no: "03-30-01",
          description_ar: "خرسانة مسلحة للأساسات والقواعد — م³ (شاملة الخرسانة C35 وحديد التسليح والمضخة)",
          description_en: "Reinforced Concrete for Foundations — m³ (Including C35 ready-mix, steel rebar & pump)",
          unit: "م³",
          quantity: 50,
          sheet_name: "أعمال الخرسانة",
          sort_order: 1,
          level: 1,
          is_group: false,
        })
        .select()
        .single();

      if (error) throw error;
      toast.success("تمت إضافة بند الخرسانة المسلحة التجريبي بنجاح!");
      await qc.invalidateQueries({ queryKey: ["boq_items", projectId] });
      if (data?.id) {
        setSelectedId(data.id);
        navigate({ search: { item: data.id }, replace: true });
      }
    } catch (e: any) {
      toast.error(e.message || "حدث خطأ أثناء إضافة البند التجريبي");
    } finally {
      setIsAddingDemo(false);
    }
  };

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">
            {t("pa.selectProjectPrompt", "اختر مشروعاً للبدء")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("pa.selectProjectDesc", "تحليل الأسعار يعتمد على بنود مشروع محدد.")}
          </p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>{t("boq.goToProjects", "الذهاب للمشاريع")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Calculate quick stats for selected item
  const directUnitCost = selected
    ? (selected.material_cost ?? 0) +
      (selected.labor_cost ?? 0) +
      (selected.equipment_cost ?? 0) +
      (selected.subcontractor_cost ?? 0)
    : 0;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-background">
      {/* Master-Detail Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar (Master List): in RTL displays on the right, in LTR on the left */}
        <div className="hidden lg:flex shrink-0">
          <BoqSidebar
            items={boqItems}
            selectedId={selectedId}
            onSelect={handleSelectItem}
            isLoading={isLoading}
            onAddDemoItem={handleAddDemoItem}
          />
        </div>

        {/* Main Work Area (Detail Editor) */}
        <main className="flex flex-1 flex-col overflow-hidden min-w-0">
          {selected ? (
            <>
              {/* Active Item Top Banner & Actions Header */}
              <div className="border-b border-border bg-card/70 px-4 py-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Left (or Right in RTL): Mobile Sidebar Trigger + Item Info */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
                      <SheetTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 lg:hidden shrink-0"
                        >
                          <Menu className="h-4 w-4" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent side={isEn ? "left" : "right"} className="p-0 w-80">
                        <BoqSidebar
                          items={boqItems}
                          selectedId={selectedId}
                          onSelect={handleSelectItem}
                          isLoading={isLoading}
                          onAddDemoItem={handleAddDemoItem}
                        />
                      </SheetContent>
                    </Sheet>

                    <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 shrink-0">
                      {selected.item_no}
                    </Badge>

                    <h1 className="text-sm font-bold text-foreground truncate max-w-xl">
                      {isEn && selected.description_en ? selected.description_en : selected.description_ar}
                    </h1>

                    {selected.sheet_name && (
                      <Badge variant="secondary" className="text-[10px] hidden sm:inline-flex">
                        {selected.sheet_name}
                      </Badge>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => setTemplateCallerOpen(true)}
                      className="h-8 gap-1.5 text-xs font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t("pa.callBreakdownFromLibrary", "استدعاء تحليل من المكتبة")}
                    </Button>

                    <Link to="/item-breakdown-library">
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        <span className="hidden sm:inline">
                          {t("breakdown.title", "مكتبة نماذج البنود")}
                        </span>
                      </Button>
                    </Link>

                    <Link to="/boq">
                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground">
                        <Calculator className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">جدول الكميات</span>
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Sub-bar: Quantity, Unit, and Quick Rates */}
                <div className="flex flex-wrap items-center gap-4 text-xs pt-1 border-t border-border/40 text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span>{t("common.quantity", "الكمية")}:</span>
                    <span className="font-mono font-bold text-foreground">
                      {fmtNumber(selected.quantity, 2)} {selected.unit || "وحدة"}
                    </span>
                  </div>

                  <div className="h-3 w-px bg-border" />

                  <div className="flex items-center gap-1.5">
                    <span>{t("common.directCost", "التكلفة المباشرة")}:</span>
                    <span className="font-mono font-bold text-foreground">
                      {fmtSAR(directUnitCost, language)}/{selected.unit || "وحدة"}
                    </span>
                  </div>

                  {selected.quantity && directUnitCost > 0 && (
                    <>
                      <div className="h-3 w-px bg-border" />
                      <div className="flex items-center gap-1.5">
                        <span>إجمالي التكلفة المباشرة للكمية:</span>
                        <span className="font-mono font-bold text-primary">
                          {fmtSAR(directUnitCost * Number(selected.quantity), language)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Grid Work area */}
              <div className="flex-1 overflow-hidden p-2">
                <PaGrid boqItem={selected} key={selected.id} />
              </div>

              {/* In-Place Template Caller Modal */}
              <InPlaceTemplateCaller
                boqItem={selected}
                open={templateCallerOpen}
                onOpenChange={setTemplateCallerOpen}
              />
            </>
          ) : (
            /* Empty State */
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              {boqItems.length === 0 ? (
                <div className="max-w-md space-y-3">
                  <Layers className="mx-auto h-12 w-12 text-muted-foreground opacity-40" />
                  <h3 className="text-base font-semibold text-foreground">
                    لا توجد بنود في جدول كميات هذا المشروع
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    يمكنك إضافة بند خرسانة مسلحة تجريبي لاختبار دورة التحليل واستدعاء النماذج فوراً، أو الذهاب لجدول الكميات لاستيراد مقايسة كاملة.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                    <Button
                      size="sm"
                      onClick={handleAddDemoItem}
                      disabled={isAddingDemo}
                      className="gap-2 text-xs font-semibold bg-primary text-primary-foreground shadow-sm"
                    >
                      <Plus className="h-4 w-4" />
                      {isAddingDemo ? "جاري الإضافة…" : "إضافة بند خرسانة مسلحة (50 م³) لاختبار التحليل"}
                    </Button>
                    <Link to="/boq">
                      <Button size="sm" variant="outline" className="gap-2 text-xs">
                        <Calculator className="h-3.5 w-3.5" />
                        الذهاب لجدول الكميات
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="max-w-md space-y-3">
                  <Sparkles className="mx-auto h-12 w-12 text-primary opacity-60" />
                  <h3 className="text-base font-semibold text-foreground">
                    {t("pa.selectItemToAnalyze", "اختر بنداً لعرض تحليله السعري")}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    اختر بنداً من قائمة بنود جدول الكميات على الجانب لبدء تعديل الموارد واستدعاء النماذج المعتمدة من المكتبة.
                  </p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
