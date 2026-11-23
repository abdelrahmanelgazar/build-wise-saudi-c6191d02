import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Layers,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Hammer,
  Truck,
  Building2,
  DollarSign,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber, fmtSAR } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import {
  getAllBreakdownTemplates,
  calculateBreakdownCost,
  applyTemplateToBoqItem,
  type BreakdownTemplate,
} from "@/lib/breakdown-library";
import type { Database } from "@/integrations/supabase/types";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];

interface InPlaceTemplateCallerProps {
  boqItem: BoqRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}

export function InPlaceTemplateCaller({
  boqItem,
  open,
  onOpenChange,
  onApplied,
}: InPlaceTemplateCallerProps) {
  const { t, language } = useLanguage();
  const isEn = language === "en";
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedDivision, setSelectedDivision] = useState<string>("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // All templates
  const templates = useMemo(() => getAllBreakdownTemplates(), [open]);

  // Extract divisions
  const divisions = useMemo(() => {
    const set = new Set<string>();
    templates.forEach((t) => set.add(t.division));
    return Array.from(set).sort();
  }, [templates]);

  // Check if item already has price analysis items
  const { data: existingItemsCount = 0 } = useQuery({
    queryKey: ["pa_items_count", boqItem.id],
    enabled: open,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("price_analysis_items")
        .select("*", { count: "exact", head: true })
        .eq("boq_item_id", boqItem.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Filter templates
  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cleanUnit = (boqItem.unit ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

    return templates
      .map((tmpl) => {
        const tmplUnit = tmpl.unit.toLowerCase().replace(/[^a-z0-9]/g, "");
        const isUnitMatch =
          cleanUnit &&
          (cleanUnit === tmplUnit ||
            (cleanUnit.includes("m3") && tmplUnit.includes("m3")) ||
            (cleanUnit.includes("m2") && tmplUnit.includes("m2")));

        return { ...tmpl, isUnitMatch };
      })
      .filter((tmpl) => {
        if (selectedDivision !== "all" && tmpl.division !== selectedDivision) {
          return false;
        }
        if (!q) return true;
        return (
          tmpl.code.toLowerCase().includes(q) ||
          tmpl.title_ar.toLowerCase().includes(q) ||
          tmpl.title_en.toLowerCase().includes(q) ||
          tmpl.description_ar.toLowerCase().includes(q) ||
          tmpl.description_en.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Show matching unit templates first
        if (a.isUnitMatch && !b.isUnitMatch) return -1;
        if (!a.isUnitMatch && b.isUnitMatch) return 1;
        return a.code.localeCompare(b.code);
      });
  }, [templates, search, selectedDivision, boqItem.unit]);

  // Auto-select first matching template on load
  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId) {
      const found = templates.find((t) => t.id === selectedTemplateId);
      if (found) return found;
    }
    return filteredTemplates[0] ?? null;
  }, [selectedTemplateId, templates, filteredTemplates]);

  // Cost calculation of selected template
  const calc = useMemo(() => {
    if (!selectedTemplate) return null;
    return calculateBreakdownCost(selectedTemplate);
  }, [selectedTemplate]);

  // Total for item quantity
  const totalItemAmount = useMemo(() => {
    if (!calc || !boqItem.quantity) return 0;
    return calc.unitSellingPrice * Number(boqItem.quantity);
  }, [calc, boqItem.quantity]);

  const handleApply = async () => {
    if (!selectedTemplate) return;
    if (existingItemsCount > 0 && !confirmReplace) {
      toast.error(t("pa.replaceWarningDesc", "يرجى تأكيد استبدال التحليل الحالي أولاً"));
      return;
    }

    setIsApplying(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("يجب تسجيل الدخول أولاً");
      if (!boqItem.project_id) throw new Error("المشروع غير محدد");

      await applyTemplateToBoqItem({
        template: selectedTemplate,
        boqItemId: boqItem.id,
        projectId: boqItem.project_id,
        userId,
        replaceExisting: true,
      });

      toast.success(
        isEn
          ? `Template "${selectedTemplate.title_en || selectedTemplate.title_ar}" applied successfully!`
          : `تم تطبيق نموذج «${selectedTemplate.title_ar}» على البند بنجاح!`
      );

      // Invalidate queries to refresh the live grid
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] }),
        qc.invalidateQueries({ queryKey: ["pa_markup", boqItem.id] }),
        qc.invalidateQueries({ queryKey: ["boq_items", boqItem.project_id] }),
      ]);

      onApplied?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ أثناء تطبيق النموذج");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Modal Header */}
        <DialogHeader className="p-4 border-b border-border bg-card/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  {t("pa.callBreakdownFromLibrary", "استدعاء تحليل من المكتبة")}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  استعرض نماذج الأكواد السعودية المعتمدة وطبّق بنية التكلفة والموارد على البند مباشرة
                </DialogDescription>
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
              {boqItem.item_no}
            </Badge>
          </div>

          {/* Active BOQ Item Summary Banner */}
          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex-1 min-w-[200px]">
              <span className="text-muted-foreground text-[11px] block">البند المستهدف:</span>
              <span className="font-semibold text-foreground">
                {isEn && boqItem.description_en ? boqItem.description_en : boqItem.description_ar}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <div>
                <span className="text-muted-foreground text-[10px] block">الوحدة:</span>
                <span className="font-bold text-primary">{boqItem.unit || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-[10px] block">الكمية:</span>
                <span className="font-bold text-foreground">{fmtNumber(boqItem.quantity, 2)}</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Modal Body: Two Columns */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-border">
          {/* Left / Template List Column (5 cols) */}
          <div className="md:col-span-5 flex flex-col h-full overflow-hidden bg-card/40">
            {/* Search and Filters */}
            <div className="p-3 border-b border-border space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث بكود النموذج أو الوصف…"
                  className="h-8 ps-8 text-xs bg-background"
                />
              </div>

              <Select value={selectedDivision} onValueChange={setSelectedDivision}>
                <SelectTrigger className="h-7 text-xs bg-background">
                  <SelectValue placeholder="تصفية حسب القسم" />
                </SelectTrigger>
                <SelectContent className="max-h-56 text-xs">
                  <SelectItem value="all">جميع الأقسام ({templates.length})</SelectItem>
                  {divisions.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Scrollable Template List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {filteredTemplates.map((tmpl) => {
                const isSelected = selectedTemplate?.id === tmpl.id;
                const tmplCost = calculateBreakdownCost(tmpl);

                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(tmpl.id)}
                    className={`w-full text-start rounded-lg border p-2.5 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border/60 bg-card hover:border-border hover:bg-accent/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-bold text-foreground">
                          {tmpl.code}
                        </span>
                        {tmpl.isUnitMatch && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] px-1 py-0 h-4"
                          >
                            {t("pa.matchingTemplateBadge", "مطابق للوحدة")}
                          </Badge>
                        )}
                      </div>
                      <span className="font-mono text-xs font-semibold text-primary">
                        {fmtSAR(tmplCost.unitSellingPrice, language)}/{tmpl.unit}
                      </span>
                    </div>

                    <p className="line-clamp-2 text-xs font-medium text-foreground/90">
                      {isEn ? tmpl.title_en : tmpl.title_ar}
                    </p>

                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/40 pt-1">
                      <span>{tmpl.division}</span>
                      <span>{tmpl.items.length} موارد</span>
                    </div>
                  </button>
                );
              })}

              {filteredTemplates.length === 0 && (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  لم يتم العثور على نماذج تطابق بحثك.
                </div>
              )}
            </div>
          </div>

          {/* Right / Selected Template Preview Column (7 cols) */}
          <div className="md:col-span-7 flex flex-col h-full overflow-hidden bg-background">
            {selectedTemplate && calc ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Header details */}
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      {selectedTemplate.code}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {selectedTemplate.division}
                    </span>
                  </div>
                  <h3 className="mt-1.5 text-sm font-bold text-foreground">
                    {isEn ? selectedTemplate.title_en : selectedTemplate.title_ar}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    {isEn ? selectedTemplate.description_en : selectedTemplate.description_ar}
                  </p>
                </div>

                {/* Rates & Markups summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-border bg-card p-2 text-center">
                    <span className="text-[10px] text-muted-foreground block">التكلفة المباشرة:</span>
                    <span className="font-mono text-xs font-bold text-foreground">
                      {fmtSAR(calc.directUnitCost, language)}
                    </span>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-2 text-center">
                    <span className="text-[10px] text-muted-foreground block">الهوامش والتحميلات:</span>
                    <span className="font-mono text-xs font-bold text-amber-500">
                      {calc.totalMarkupPct}%
                    </span>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-center">
                    <span className="text-[10px] text-primary block font-medium">سعر بيع الوحدة:</span>
                    <span className="font-mono text-xs font-bold text-primary">
                      {fmtSAR(calc.unitSellingPrice, language)}
                    </span>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-2 text-center">
                    <span className="text-[10px] text-muted-foreground block">إجمالي المقايسة:</span>
                    <span className="font-mono text-xs font-bold text-foreground">
                      {fmtSAR(totalItemAmount, language)}
                    </span>
                  </div>
                </div>

                {/* Resource breakdown preview table */}
                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-primary" />
                    مكونات التحليل التفصيلي (لوحدة {selectedTemplate.unit}):
                  </h4>
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-xs tabular-nums">
                      <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
                        <tr>
                          <th className="px-2.5 py-1.5 text-start font-medium">النوع</th>
                          <th className="px-2.5 py-1.5 text-start font-medium">التوصيف</th>
                          <th className="px-2.5 py-1.5 text-center font-medium">الكمية</th>
                          <th className="px-2.5 py-1.5 text-center font-medium">الوحدة</th>
                          <th className="px-2.5 py-1.5 text-end font-medium">السعر</th>
                          <th className="px-2.5 py-1.5 text-end font-medium">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedTemplate.items.map((res) => {
                          const itemTotal = (res.quantity || 0) * (res.unit_price || 0);
                          return (
                            <tr key={res.id} className="hover:bg-muted/20">
                              <td className="px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">
                                {res.resource_type === "material" && "مواد"}
                                {res.resource_type === "labor" && "عمالة"}
                                {res.resource_type === "equipment" && "معدات"}
                                {res.resource_type === "subcontractor" && "مقاول باطن"}
                              </td>
                              <td className="px-2.5 py-1.5 font-medium text-foreground">
                                {isEn && res.description_en ? res.description_en : res.description_ar}
                              </td>
                              <td className="px-2.5 py-1.5 text-center font-mono">
                                {fmtNumber(res.quantity, 2)}
                              </td>
                              <td className="px-2.5 py-1.5 text-center text-muted-foreground">
                                {res.unit}
                              </td>
                              <td className="px-2.5 py-1.5 text-end font-mono">
                                {fmtSAR(res.unit_price, language)}
                              </td>
                              <td className="px-2.5 py-1.5 text-end font-mono font-semibold text-foreground">
                                {fmtSAR(itemTotal, language)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Replacement Warning Banner if item already has price lines */}
                {existingItemsCount > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-amber-500 font-semibold text-xs">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{t("pa.replaceWarningTitle", "تنبيه: استبدال التحليل الحالي")}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      هذا البند يحتوي حالياً على ({existingItemsCount}) بند تكلفة. تطبيق هذا النموذج سيحذف المكونات الحالية ويستبدلها بالنموذج الجديد.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Checkbox
                        id="confirm-replace"
                        checked={confirmReplace}
                        onCheckedChange={(c) => setConfirmReplace(!!c)}
                      />
                      <Label htmlFor="confirm-replace" className="text-xs font-medium cursor-pointer">
                        {t("pa.confirmReplace", "نعم، أؤكد استبدال التحليل الحالي")}
                      </Label>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
                اختر نموذجاً من القائمة لمعاينة تفاصيله
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <DialogFooter className="p-3 border-t border-border bg-card/80 flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            {t("common.cancel", "إلغاء")}
          </Button>

          <Button
            size="sm"
            onClick={handleApply}
            disabled={
              !selectedTemplate ||
              isApplying ||
              (existingItemsCount > 0 && !confirmReplace)
            }
            className="text-xs gap-1.5 font-semibold"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isApplying ? "جاري التطبيق…" : t("pa.applyToActiveItem", "استخدام هذا التحليل للبند")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
