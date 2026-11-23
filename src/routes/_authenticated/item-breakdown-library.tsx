import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Layers,
  Search,
  Plus,
  ArrowRight,
  Check,
  Calculator,
  ExternalLink,
  Trash2,
  Edit,
  FolderKanban,
  Sparkles,
  Info,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProjectId } from "@/lib/active-project";
import { useLanguage } from "@/lib/i18n";
import {
  getAllBreakdownTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  calculateBreakdownCost,
  applyTemplateToBoqItem,
  type BreakdownTemplate,
  type BreakdownResourceItem,
  type BreakdownResourceType,
} from "@/lib/breakdown-library";
import type { Database } from "@/integrations/supabase/types";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];

export const Route = createFileRoute("/_authenticated/item-breakdown-library")({
  head: () => ({
    meta: [
      { title: "مكتبة نماذج البنود — تقديري" },
      { name: "description", content: "قوالب التحليل التفصيلي لأسعار بنود المقاولات والإنشاءات وفق الكود والممارسات السعودية." },
    ],
  }),
  component: ItemBreakdownLibraryPage,
});

function ItemBreakdownLibraryPage() {
  const { t, language } = useLanguage();
  const isEn = language === "en";
  const qc = useQueryClient();
  const projectId = useActiveProjectId();

  const [search, setSearch] = useState("");
  const [selectedDivision, setSelectedDivision] = useState<string>("all");
  const [templates, setTemplates] = useState<BreakdownTemplate[]>(() => getAllBreakdownTemplates());

  // Apply dialog state
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [targetTemplate, setTargetTemplate] = useState<BreakdownTemplate | null>(null);
  const [targetBoqItemId, setTargetBoqItemId] = useState<string>("");
  const [isApplying, setIsApplying] = useState(false);

  // New template dialog state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<BreakdownTemplate | null>(null);

  // Fetch project BOQ items for apply modal
  const { data: boqItems = [] } = useQuery({
    queryKey: ["boq_items_for_apply", projectId],
    enabled: !!projectId && applyModalOpen,
    queryFn: async () => {
      if (!projectId) return [];
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

  const divisions = Array.from(new Set(templates.map((t) => t.division)));

  const filteredTemplates = templates.filter((tmpl) => {
    const q = search.toLowerCase().trim();
    const matchSearch =
      !q ||
      tmpl.code.toLowerCase().includes(q) ||
      tmpl.title_ar.toLowerCase().includes(q) ||
      tmpl.title_en.toLowerCase().includes(q) ||
      tmpl.description_ar.toLowerCase().includes(q) ||
      tmpl.description_en.toLowerCase().includes(q);

    const matchDiv = selectedDivision === "all" || tmpl.division === selectedDivision;
    return matchSearch && matchDiv;
  });

  const refreshTemplates = () => {
    setTemplates(getAllBreakdownTemplates());
  };

  const handleOpenApply = (tmpl: BreakdownTemplate) => {
    setTargetTemplate(tmpl);
    setTargetBoqItemId(boqItems[0]?.id || "");
    setApplyModalOpen(true);
  };

  const handleConfirmApply = async () => {
    if (!targetTemplate || !targetBoqItemId || !projectId) {
      toast.error(t("breakdown.selectTargetPrompt", "يرجى اختيار البند المستهدف"));
      return;
    }
    setIsApplying(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error(t("auth.notLoggedIn", "يجب تسجيل الدخول"));

      await applyTemplateToBoqItem({
        template: targetTemplate,
        boqItemId: targetBoqItemId,
        projectId,
        userId: user.id,
        replaceExisting: true,
      });

      toast.success(
        isEn
          ? `Template "${targetTemplate.code}" successfully applied to item!`
          : `تم تطبيق قالب التحليل "${targetTemplate.code}" بنجاح على البند!`
      );
      qc.invalidateQueries({ queryKey: ["boq_items"] });
      qc.invalidateQueries({ queryKey: ["pa_items"] });
      setApplyModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ أثناء تطبيق القالب");
    } finally {
      setIsApplying(false);
    }
  };

  const handleDeleteTemplate = (id: string) => {
    deleteCustomTemplate(id);
    refreshTemplates();
    toast.success(t("breakdown.templateDeleted", "تم حذف القالب"));
  };

  const targetBoqItem = boqItems.find((b) => b.id === targetBoqItemId);
  const targetCalc = targetTemplate ? calculateBreakdownCost(targetTemplate) : null;
  const targetQty = targetBoqItem?.quantity || 1;
  const totalDirectForQty = (targetCalc?.directUnitCost || 0) * targetQty;
  const totalSellingForQty = (targetCalc?.unitSellingPrice || 0) * targetQty;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
              {t("nav.itemBreakdownLibrary", "مكتبة نماذج البنود")}
            </h1>
            <Badge variant="outline" className="border-primary/30 text-primary font-mono text-xs">
              Item Rate Breakdown Library
            </Badge>
          </div>
          <p className="mt-1 text-xs md:text-sm text-muted-foreground">
            {t(
              "breakdown.subtitle",
              "قوالب التحليل المباشر (مواد، عمالة، معدات، مقاول باطن) وسعر بيع الوحدة الجاهزة للتطبيق الفوري على بنود المناقصة."
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setEditingTemplate({
                id: "tmpl-" + Date.now(),
                code: "DIV-CUSTOM",
                division: "Div. 01 - General Requirements",
                title_ar: "بند تحليل تكلفة جديد",
                title_en: "New Rate Breakdown Item",
                description_ar: "توصيف البند ومكونات موارده ومصنعيته...",
                description_en: "Description of resources, specifications and execution...",
                unit: "m2",
                recommended_overhead_pct: 10,
                recommended_profit_pct: 8,
                recommended_risk_pct: 2,
                items: [
                  {
                    id: "res-1",
                    resource_type: "material",
                    description_ar: "مواد أساسية",
                    description_en: "Basic materials",
                    unit: "m2",
                    quantity: 1,
                    unit_price: 25,
                  },
                ],
              });
              setCreateModalOpen(true);
            }}
            className="gap-2 text-xs"
          >
            <Plus className="h-4 w-4" />
            {t("breakdown.addNewTemplate", "إضافة قالب تحليل جديد")}
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("breakdown.searchPlaceholder", "ابحث بالكود، اسم البند، أو التوصيف (بالعربية أو الإنجليزية)...")}
            className="ps-9 text-xs"
          />
        </div>

        <Select value={selectedDivision} onValueChange={setSelectedDivision}>
          <SelectTrigger className="w-full sm:w-[240px] text-xs">
            <SelectValue placeholder={t("breakdown.filterByDivision", "تصفية حسب القسم")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              {t("common.allDivisions", "جميع الأقسام (All Divisions)")}
            </SelectItem>
            {divisions.map((div) => (
              <SelectItem key={div} value={div} className="text-xs">
                {div}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grid of Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map((template) => {
          const calc = calculateBreakdownCost(template);
          return (
            <Card
              key={template.id}
              className="flex flex-col justify-between border-border hover:border-primary/40 transition-colors shadow-sm"
            >
              <CardHeader className="p-4 pb-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono text-[11px] font-bold border-primary/40 text-primary">
                    {template.code}
                  </Badge>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {template.unit}
                    </Badge>
                    {template.is_custom && (
                      <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]">
                        {t("breakdown.customBadge", "مخصص")}
                      </Badge>
                    )}
                  </div>
                </div>

                <div>
                  <CardTitle className="text-sm font-semibold line-clamp-2">
                    {isEn ? template.title_en || template.title_ar : template.title_ar}
                  </CardTitle>
                  <CardDescription className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                    {template.division}
                  </CardDescription>
                </div>

                <p className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed">
                  {isEn ? template.description_en || template.description_ar : template.description_ar}
                </p>
              </CardHeader>

              <CardContent className="p-4 pt-2 space-y-3">
                {/* Cost Breakdown Summary Chips */}
                <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-2 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">{t("pa.materials", "مواد")}: </span>
                    <span className="font-mono font-medium">{calc.materialCost.toFixed(2)} {t("common.sar", "ر.س")}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("pa.labour", "عمالة")}: </span>
                    <span className="font-mono font-medium">{calc.laborCost.toFixed(2)} {t("common.sar", "ر.س")}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("pa.equipment", "معدات")}: </span>
                    <span className="font-mono font-medium">{calc.equipmentCost.toFixed(2)} {t("common.sar", "ر.س")}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("pa.subcontractor", "مقاول باطن")}: </span>
                    <span className="font-mono font-medium">{calc.subcontractorCost.toFixed(2)} {t("common.sar", "ر.س")}</span>
                  </div>
                </div>

                {/* Price Result Banner */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-muted-foreground font-medium">
                      {t("breakdown.directCostPerUnit", "التكلفة المباشرة للوحدة")}
                    </div>
                    <div className="font-mono text-sm font-bold text-foreground">
                      {calc.directUnitCost.toFixed(2)} <span className="text-[10px] font-normal text-muted-foreground">ر.س / {template.unit}</span>
                    </div>
                  </div>

                  <div className="text-end">
                    <div className="text-[10px] text-primary font-medium">
                      {t("breakdown.sellingRatePerUnit", "سعر بيع الوحدة")} ({calc.totalMarkupPct}%)
                    </div>
                    <div className="font-mono text-base font-extrabold text-primary">
                      {calc.unitSellingPrice.toFixed(2)} <span className="text-[10px] font-normal">ر.س / {template.unit}</span>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="default"
                    className="flex-1 text-xs gap-1.5 h-8"
                    onClick={() => handleOpenApply(template)}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    {t("breakdown.applyToBoq", "تطبيق على بند بمشروع")}
                  </Button>

                  {template.is_custom && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteTemplate(template.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground opacity-40" />
          <h3 className="mt-3 text-sm font-semibold">{t("breakdown.noTemplatesFound", "لم يتم العثور على قوالب تحليل")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("breakdown.tryDifferentQuery", "جرب البحث بكلمات أخرى أو اختر قسماً آخر.")}
          </p>
        </div>
      )}

      {/* Apply Template Dialog */}
      <Dialog open={applyModalOpen} onOpenChange={setApplyModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("breakdown.applyModalTitle", "تطبيق قالب التحليل على بند")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t("breakdown.applyModalDesc", "سيتم نسخ تفصيل الموارد والأسعار المرجعية وتطبيق نسب هوامش المشروع على البند المختار.")}
            </DialogDescription>
          </DialogHeader>

          {targetTemplate && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-xs text-primary font-bold">
                    {targetTemplate.code}
                  </Badge>
                  <span className="text-xs font-semibold text-muted-foreground">{targetTemplate.unit}</span>
                </div>
                <div className="text-xs font-bold pt-1">
                  {isEn ? targetTemplate.title_en : targetTemplate.title_ar}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {targetTemplate.division}
                </div>
              </div>

              {!projectId ? (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-500">
                  {t("breakdown.noProjectSelected", "يرجى اختيار مشروع نشط أولاً من القائمة العلوية لتطبيق القالب عليه.")}
                </div>
              ) : boqItems.length === 0 ? (
                <div className="rounded-lg border border-muted p-4 text-center text-xs text-muted-foreground">
                  {t("breakdown.noBoqItemsInProject", "لا توجد بنود غير مجمعة في جدول كميات هذا المشروع بعد.")}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground mb-1 block">
                      {t("breakdown.selectBoqItem", "اختر البند من جدول الكميات:")}
                    </label>
                    <Select value={targetBoqItemId} onValueChange={setTargetBoqItemId}>
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue placeholder={t("breakdown.selectItemPlaceholder", "اختر البند...")} />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {boqItems.map((item) => (
                          <SelectItem key={item.id} value={item.id} className="text-xs">
                            <span className="font-mono font-bold me-2">{item.item_no}</span>
                            <span>{isEn ? item.description_en || item.description_ar : item.description_ar}</span>
                            <span className="text-muted-foreground ms-2">({item.quantity || 0} {item.unit || ""})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {targetBoqItem && targetCalc && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2 text-xs">
                      <div className="font-semibold text-primary">
                        {t("breakdown.calculationPreview", "معاينة نتائج التسعير للبند:")}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-muted-foreground">{t("common.quantity", "الكمية")}: </span>
                          <span className="font-mono font-semibold">{targetQty} {targetBoqItem.unit || targetTemplate.unit}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("breakdown.directUnitRate", "التكلفة المباشرة/وحدة")}: </span>
                          <span className="font-mono font-semibold">{targetCalc.directUnitCost.toFixed(2)} ر.س</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("breakdown.sellingUnitRate", "سعر البيع/وحدة")}: </span>
                          <span className="font-mono font-bold text-primary">{targetCalc.unitSellingPrice.toFixed(2)} ر.س</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t("breakdown.totalDirectCost", "إجمالي التكلفة المباشرة")}: </span>
                          <span className="font-mono font-semibold">{totalDirectForQty.toFixed(2)} ر.س</span>
                        </div>
                      </div>

                      <div className="border-t border-primary/20 pt-2 flex items-center justify-between font-bold">
                        <span>{t("breakdown.grandTotalForQuantity", "المبلغ الإجمالي للبند:")}</span>
                        <span className="font-mono text-sm text-primary">{totalSellingForQty.toFixed(2)} ر.س</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setApplyModalOpen(false)}>
              {t("common.cancel", "إلغاء")}
            </Button>
            <Button
              size="sm"
              disabled={isApplying || !projectId || !targetBoqItemId}
              onClick={handleConfirmApply}
              className="gap-1.5"
            >
              {isApplying ? t("common.saving", "جاري التطبيق...") : t("breakdown.confirmApply", "تأكيد وتطبيق التحليل")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Template Dialog */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {t("breakdown.createModalTitle", "إنشاء قالب تحليل تفصيلي جديد")}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t("breakdown.createModalDesc", "أدخل بيانات البند ومكونات موارده ومعدلات الاستهلاك لكل وحدة قياس.")}
            </DialogDescription>
          </DialogHeader>

          {editingTemplate && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">{t("common.code", "الكود")}:</label>
                  <Input
                    value={editingTemplate.code}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, code: e.target.value })}
                    className="text-xs font-mono"
                    placeholder="e.g. BLK-150-SPEC"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">{t("common.unit", "الوحدة")}:</label>
                  <Input
                    value={editingTemplate.unit}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, unit: e.target.value })}
                    className="text-xs"
                    placeholder="m2, m3, ton, item..."
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">{t("breakdown.division", "القسم (Division)")}:</label>
                <Input
                  value={editingTemplate.division}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, division: e.target.value })}
                  className="text-xs"
                  placeholder="e.g. Div. 04 - Masonry"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">{t("breakdown.titleAr", "اسم البند (بالعربية)")}:</label>
                <Input
                  value={editingTemplate.title_ar}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, title_ar: e.target.value })}
                  className="text-xs"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">{t("breakdown.titleEn", "اسم البند (بالإنجليزية)")}:</label>
                <Input
                  value={editingTemplate.title_en}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, title_en: e.target.value })}
                  className="text-xs font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">{t("common.description", "التوصيف الفني")}:</label>
                <Input
                  value={editingTemplate.description_ar}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, description_ar: e.target.value })}
                  className="text-xs"
                />
              </div>

              {/* Resource Items */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{t("breakdown.resourceComponents", "مكونات الموارد لوحدة واحدة:")}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1"
                    onClick={() => {
                      setEditingTemplate({
                        ...editingTemplate,
                        items: [
                          ...editingTemplate.items,
                          {
                            id: "res-" + Date.now(),
                            resource_type: "material",
                            description_ar: "مورد جديد",
                            description_en: "New resource",
                            unit: editingTemplate.unit,
                            quantity: 1,
                            unit_price: 10,
                          },
                        ],
                      });
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    {t("common.add", "إضافة مورد")}
                  </Button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {editingTemplate.items.map((item, idx) => (
                    <div key={item.id} className="flex items-center gap-2 rounded border border-border p-2 bg-muted/20">
                      <Select
                        value={item.resource_type}
                        onValueChange={(val: BreakdownResourceType) => {
                          const updated = [...editingTemplate.items];
                          updated[idx].resource_type = val;
                          setEditingTemplate({ ...editingTemplate, items: updated });
                        }}
                      >
                        <SelectTrigger className="w-24 text-[10px] h-7">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="material" className="text-xs">مواد</SelectItem>
                          <SelectItem value="labor" className="text-xs">عمالة</SelectItem>
                          <SelectItem value="equipment" className="text-xs">معدات</SelectItem>
                          <SelectItem value="subcontractor" className="text-xs">مقاول باطن</SelectItem>
                        </SelectContent>
                      </Select>

                      <Input
                        value={item.description_ar}
                        onChange={(e) => {
                          const updated = [...editingTemplate.items];
                          updated[idx].description_ar = e.target.value;
                          setEditingTemplate({ ...editingTemplate, items: updated });
                        }}
                        className="flex-1 text-xs h-7"
                        placeholder="اسم المورد"
                      />

                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => {
                          const updated = [...editingTemplate.items];
                          updated[idx].quantity = parseFloat(e.target.value) || 0;
                          setEditingTemplate({ ...editingTemplate, items: updated });
                        }}
                        className="w-16 text-xs h-7 font-mono"
                        placeholder="الكمية"
                      />

                      <Input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => {
                          const updated = [...editingTemplate.items];
                          updated[idx].unit_price = parseFloat(e.target.value) || 0;
                          setEditingTemplate({ ...editingTemplate, items: updated });
                        }}
                        className="w-20 text-xs h-7 font-mono"
                        placeholder="السعر ر.س"
                      />

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const updated = editingTemplate.items.filter((_, i) => i !== idx);
                          setEditingTemplate({ ...editingTemplate, items: updated });
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommended Markups */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
                <div>
                  <label className="text-[10px] text-muted-foreground block">{t("financial.overhead", "مصاريف إدارية %")}:</label>
                  <Input
                    type="number"
                    value={editingTemplate.recommended_overhead_pct}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, recommended_overhead_pct: parseFloat(e.target.value) || 0 })}
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block">{t("financial.profit", "الأرباح %")}:</label>
                  <Input
                    type="number"
                    value={editingTemplate.recommended_profit_pct}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, recommended_profit_pct: parseFloat(e.target.value) || 0 })}
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block">{t("financial.risk", "مخاطر %")}:</label>
                  <Input
                    type="number"
                    value={editingTemplate.recommended_risk_pct}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, recommended_risk_pct: parseFloat(e.target.value) || 0 })}
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateModalOpen(false)}>
              {t("common.cancel", "إلغاء")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!editingTemplate) return;
                saveCustomTemplate(editingTemplate);
                refreshTemplates();
                setCreateModalOpen(false);
                toast.success(t("breakdown.templateSaved", "تم حفظ قالب التحليل في المكتبة"));
              }}
            >
              {t("common.save", "حفظ القالب")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
