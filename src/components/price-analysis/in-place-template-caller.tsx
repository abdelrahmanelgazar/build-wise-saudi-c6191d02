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
import { estimationClient } from "@/lib/estimation-client";
import { fmtNumber, fmtSAR } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import { CSI_DIVISIONS, csiDivisionCode, csiDivisionLabel } from "@/lib/csi-divisions";
import { SCOPE_LABELS_AR, type AssemblyScopeTag } from "@/lib/csi-assemblies-engine";
import { computePricingPhase2 } from "@/lib/estimation-calc";
import {
  calculateLibraryDirectCost,
  applyTemplateToBoqItem,
  type BreakdownTemplate,
} from "@/lib/breakdown-library";
import {
  queryKnowledgeTemplatesTree,
  type KnowledgeTemplateCategory,
  type KnowledgeTemplateRecord,
} from "@/lib/knowledge-library-service";
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
  const [libraryView, setLibraryView] = useState<KnowledgeTemplateCategory>("by_section");
  const [selectedDivision, setSelectedDivision] = useState<string>("all");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [applyMode, setApplyMode] = useState<"replace" | "merge">("replace");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  // Unified Knowledge Library query (same single source of truth as Sidebar & Library pages)
  const libraryQuery = useMemo(
    () =>
      queryKnowledgeTemplatesTree({
        view: libraryView,
        division: selectedDivision,
        ...(libraryView === "by_project" && boqItem.project_id ? { projectId: boqItem.project_id } : {}),
        search,
      }),
    [open, libraryView, selectedDivision, boqItem.project_id, search],
  );
  const templates = useMemo(() => libraryQuery.records.map((r) => r.template), [libraryQuery]);
  const recordById = useMemo(
    () => new Map<string, KnowledgeTemplateRecord>(libraryQuery.records.map((r) => [r.templateId, r])),
    [libraryQuery],
  );

  const hasUnclassified = templates.some((template) => !csiDivisionCode(template.division));

  // Fetch target item's existing tender markups so preview shows target tender selling price (NOT template markups!)
  const { data: targetMarkupRow } = useQuery({
    queryKey: ["pa_markup", boqItem.id],
    enabled: open,
    queryFn: async () => {
      const { data } = await estimationClient
        .from("price_analysis_markup")
        .select("*")
        .eq("boq_item_id", boqItem.id)
        .maybeSingle();
      return data as Database["public"]["Tables"]["price_analysis_markup"]["Row"] | null;
    },
  });

  // Check if item already has price analysis items
  const { data: existingItemsCount = 0 } = useQuery({
    queryKey: ["pa_items_count", boqItem.id],
    enabled: open,
    queryFn: async () => {
      const { count, error } = await estimationClient
        .from("price_analysis_items")
        .select("*", { count: "exact", head: true })
        .eq("boq_item_id", boqItem.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Sort templates with matching units first
  const filteredTemplates = useMemo(() => {
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
      .sort((a, b) => {
        if (a.isUnitMatch && !b.isUnitMatch) return -1;
        if (!a.isUnitMatch && b.isUnitMatch) return 1;
        return a.code.localeCompare(b.code);
      });
  }, [templates, boqItem.unit]);

  // Auto-select first matching template on load
  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId) {
      const found = templates.find((t) => t.id === selectedTemplateId);
      if (found) return found;
    }
    return filteredTemplates[0] ?? null;
  }, [selectedTemplateId, templates, filteredTemplates]);

  const selectedMeta = selectedTemplate ? recordById.get(selectedTemplate.id) ?? null : null;

  // Compute direct unit cost from library + selling price using TARGET tender markups only
  const calc = useMemo(() => {
    if (!selectedTemplate) return null;
    const direct = calculateLibraryDirectCost(selectedTemplate);
    const indirectPct = Number(targetMarkupRow?.indirect_pct ?? 0);
    const overheadPct = Number(targetMarkupRow?.overhead_pct ?? 0);
    const riskPct = Number(targetMarkupRow?.risk_pct ?? 0);
    const profitPct = Number(targetMarkupRow?.profit_pct ?? 0);
    const p2 = computePricingPhase2({
      directUnitCost: direct.directUnitCost,
      quantity: 1,
      markups: {
        indirect_pct: indirectPct,
        overhead_pct: overheadPct,
        risk_pct: riskPct,
        profit_pct: profitPct,
        pricing_policy: "additive_v2",
        round_up_rate: true,
      },
    });
    return {
      directUnitCost: p2.directUnitCost,
      totalMarkupPct: indirectPct + overheadPct + riskPct + profitPct,
      unitSellingPrice: p2.approvedUnitRate,
      rawSellingPrice: p2.rawUnitSellingPrice,
    };
  }, [selectedTemplate, targetMarkupRow]);

  // Total for item quantity
  const totalItemAmount = useMemo(() => {
    if (!calc || !boqItem.quantity) return 0;
    return calc.unitSellingPrice * Number(boqItem.quantity);
  }, [calc, boqItem.quantity]);

  const handleApply = async () => {
    if (!selectedTemplate) return;
    if (existingItemsCount > 0 && applyMode === "replace" && !confirmReplace) {
      toast.error(t("pa.replaceWarningDesc", "يرجى تأكيد استبدال التحليل الحالي أولاً"));
      return;
    }

    setIsApplying(true);
    try {
      const { data: userData } = await estimationClient.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("يجب تسجيل الدخول أولاً");
      if (!boqItem.project_id) throw new Error("المشروع غير محدد");

      await applyTemplateToBoqItem({
        template: selectedTemplate,
        boqItemId: boqItem.id,
        projectId: boqItem.project_id,
        userId,
        tenderId: boqItem.tender_id ?? null,
        replaceExisting: applyMode === "replace",
      });

      toast.success(
        isEn
          ? `Template "${selectedTemplate.title_en || selectedTemplate.title_ar}" applied at direct cost!`
          : `تم تطبيق مكونات نموذج «${selectedTemplate.title_ar}» بالتكلفة المباشرة مع الحفاظ على تحميلات العطاء!`
      );

      // Invalidate queries to refresh the live grid
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] }),
        qc.invalidateQueries({ queryKey: ["pa_items_project", boqItem.project_id] }),
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

          {/* M-03 / M-04 Matching Library Navigation Tabs inside Item Caller */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(
              [
                { id: "overview", label: isEn ? "All" : "عام" },
                { id: "by_section", label: isEn ? "By CSI Section" : "حسب الأقسام" },
                { id: "by_project", label: isEn ? "By Project" : "حسب المشاريع" },
                { id: "indirect_cost", label: isEn ? "Indirect Cost" : "التكلفة غير المباشرة" },
                { id: "typical_assemblies", label: isEn ? "Typical Assemblies" : "نماذج نمطية" },
              ] as const
            ).map((tab) => (
              <Button
                key={tab.id}
                type="button"
                size="sm"
                variant={libraryView === tab.id ? "default" : "outline"}
                className="h-7 text-[11px] gap-1"
                onClick={() => setLibraryView(tab.id)}
              >
                <span>{tab.label}</span>
                <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono">
                  {libraryQuery.countsByView[tab.id]}
                </Badge>
              </Button>
            ))}
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
                  <SelectItem value="all">{t("common.allDivisions")} ({templates.length})</SelectItem>
                  {CSI_DIVISIONS.map(({ code, name_ar, name_en }) => (
                    <SelectItem key={code} value={code}>
                      {code} — {language === "ar" ? name_ar : name_en}
                    </SelectItem>
                  ))}
                  {hasUnclassified && (
                    <SelectItem value="unclassified">{t("common.unclassifiedDivision")}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Scrollable Template List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {filteredTemplates.map((tmpl) => {
                const isSelected = selectedTemplate?.id === tmpl.id;
                const directCost = calculateLibraryDirectCost(tmpl).directUnitCost;
                const meta = recordById.get(tmpl.id);

                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(tmpl.id)}
                    className={`w-full text-start rounded-lg border p-2.5 transition-all ${isSelected
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/60 bg-card hover:border-border hover:bg-accent/40"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[11px] font-bold text-foreground">
                          {tmpl.code}
                        </span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-mono">
                          v{meta?.versionNo ?? tmpl.version_no ?? 1}
                        </Badge>
                        {tmpl.isUnitMatch && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] px-1 py-0 h-4"
                          >
                            {t("pa.matchingTemplateBadge", "مطابق للوحدة")}
                          </Badge>
                        )}
                        {meta?.freshness === "stale" && (
                          <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">
                            سعر قديم
                          </Badge>
                        )}
                      </div>
                      <span className="font-mono text-xs font-semibold text-primary">
                        مباشر {fmtSAR(directCost, language)}/{tmpl.unit}
                      </span>
                    </div>

                    <p className="line-clamp-2 text-xs font-medium text-foreground/90">
                      {isEn ? tmpl.title_en : tmpl.title_ar}
                    </p>

                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/40 pt-1">
                      <span>{tmpl.source_project_name ? `المصدر: ${tmpl.source_project_name}` : csiDivisionLabel(tmpl.division, language)}</span>
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
                    {selectedTemplate.assembly_kind === "reference_composite" && (
                      <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px]">
                        مرجع مركّب
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {csiDivisionLabel(selectedTemplate.division, language)}
                    </span>
                  </div>
                  <h3 className="mt-1.5 text-sm font-bold text-foreground">
                    {isEn ? selectedTemplate.title_en : selectedTemplate.title_ar}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    {isEn ? selectedTemplate.description_en : selectedTemplate.description_ar}
                  </p>
                  {selectedTemplate.assembly_kind === "reference_composite" && (
                    <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                      تنبيه مرجعي: هذا القالب موروث مركّب لا يشمل{" "}
                      {selectedTemplate.excluded_scopes?.map((s) => SCOPE_LABELS_AR[s as AssemblyScopeTag] ?? s).join(" و")}
                      ، ويُفضّل استخدام قوالب القسم 03 التنفيذية أو ربط عروض الموردين.
                    </div>
                  )}
                </div>

                {/* Rates & Markups summary cards (Direct Cost owned by Library; Selling Price owned by Target Tender) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-border bg-card p-2 text-center">
                    <span className="text-[10px] text-muted-foreground block">التكلفة المباشرة (المكتبة):</span>
                    <span className="font-mono text-xs font-bold text-foreground">
                      {fmtSAR(calc.directUnitCost, language)}
                    </span>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-2 text-center">
                    <span className="text-[10px] text-muted-foreground block">تحميلات العطاء الحالي:</span>
                    <span className="font-mono text-xs font-bold text-amber-500">
                      {calc.totalMarkupPct}%
                    </span>
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-center">
                    <span className="text-[10px] text-primary block font-medium">سعر البيع في العطاء:</span>
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

                {selectedMeta && (
                  <div className="rounded-md border border-border/70 bg-muted/30 p-2 text-[11px] flex flex-wrap items-center justify-between gap-2">
                    <span>
                      المصدر: <strong>{selectedTemplate.source_project_name || "مكتبة تقديري المعتمدة"}</strong>
                      {" · "}إصدار <strong className="font-mono">v{selectedMeta.versionNo}</strong>
                      {selectedMeta.priceDate && <> · تاريخ السعر <strong className="font-mono">{selectedMeta.priceDate}</strong></>}
                    </span>
                    <Badge variant={selectedMeta.freshness === "stale" ? "destructive" : "secondary"} className="text-[10px]">
                      {selectedMeta.freshness === "fresh" ? "أسعار حديثة" : selectedMeta.freshness === "stale" ? "أسعار قديمة — يُنصح بالتحديث" : "سعر غير مؤرخ"}
                    </Badge>
                  </div>
                )}

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
                          const wasteFactor = res.resource_type === "material" ? 1 + (Number(res.waste_pct ?? 0) / 100) : 1;
                          const itemTotal = (res.quantity || 0) * wasteFactor * (res.unit_price || 0);
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

                {/* Merge vs Replace Mode Selector if item already has price lines */}
                {existingItemsCount > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-amber-500 font-semibold text-xs">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>يحتوي البند حالياً على ({existingItemsCount}) سطور تكلفة — اختر طريقة التطبيق:</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={applyMode === "replace" ? "default" : "outline"}
                          className="h-6 text-[10px]"
                          onClick={() => setApplyMode("replace")}
                        >
                          استبدال
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={applyMode === "merge" ? "default" : "outline"}
                          className="h-6 text-[10px]"
                          onClick={() => setApplyMode("merge")}
                        >
                          دمج مع الحالي
                        </Button>
                      </div>
                    </div>
                    {applyMode === "replace" && (
                      <div className="flex items-center gap-2 pt-1">
                        <Checkbox
                          id="confirm-replace"
                          checked={confirmReplace}
                          onCheckedChange={(c) => setConfirmReplace(!!c)}
                        />
                        <Label htmlFor="confirm-replace" className="text-xs font-medium cursor-pointer">
                          {t("pa.confirmReplace", "نعم، أؤكد استبدال التحليل الحالي مع الاحتفاظ بتحميلات العطاء")}
                        </Label>
                      </div>
                    )}
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
              (existingItemsCount > 0 && applyMode === "replace" && !confirmReplace)
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
