import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  Copy,
  Eye,
  RotateCcw,
  FolderKanban,
  Sparkles,
  Info,
  DollarSign,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  buildLegacyTemplateDispositionLedger,
  computeConcreteElementQto,
  computeMultiTradeQto,
  computeProjectCoverageStats,
  expandSubAssemblyAtDirectCost,
  SCOPE_LABELS_AR,
  type AssemblyScopeTag,
  type ConcreteElementFamily,
  type MultiTradeQtoKind,
  type ScopedAnalysisLine,
} from "@/lib/csi-assemblies-engine";
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
import { estimationClient } from "@/lib/estimation-client";
import { useActiveProjectId, useActiveTenderId } from "@/lib/active-project";
import { scopeRowsByTender } from "@/lib/tender-pricing-scope";
import { useLanguage } from "@/lib/i18n";
import { CSI_DIVISIONS, csiDivisionCode, csiDivisionLabel } from "@/lib/csi-divisions";
import {
  getAllBreakdownTemplates,
  DEFAULT_BREAKDOWN_TEMPLATES,
  saveCustomTemplate,
  importCustomTemplatesBatch,
  deleteCustomTemplate,
  calculateBreakdownCost,
  applyTemplateToBoqItem,
  type BreakdownTemplate,
  type BreakdownResourceItem,
  type BreakdownResourceType,
} from "@/lib/breakdown-library";
import type { Database } from "@/integrations/supabase/types";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
const resourceLabels = {
  material: "pa.materials",
  labor: "pa.labour",
  equipment: "pa.equipment",
  subcontractor: "pa.subcontractor",
} as const;

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

  useRegisterPageActions({
    pageKey: "item-breakdown-library",
    hasEditableState: true,
    queryKeys: [["boq_items", projectId]],
  });

  const [search, setSearch] = useState("");
  const [selectedDivision, setSelectedDivision] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"library" | "qto" | "coverage">("library");
  const [templates, setTemplates] = useState<BreakdownTemplate[]>(() => getAllBreakdownTemplates());

  // Parametric Concrete Division 03 QTO state (defaulting to §2 verification example)
  const [qtoFamily, setQtoFamily] = useState<ConcreteElementFamily>("column");
  const [qtoWidth, setQtoWidth] = useState<number>(0.4);
  const [qtoLength, setQtoLength] = useState<number>(0.6);
  const [qtoHeight, setQtoHeight] = useState<number>(3.0);
  const [qtoCount, setQtoCount] = useState<number>(1);
  const [qtoWastePct, setQtoWastePct] = useState<number>(3);
  const [qtoRebarKg, setQtoRebarKg] = useState<number>(90);
  const [qtoIncludeFormwork, setQtoIncludeFormwork] = useState<boolean>(true);
  const [qtoIncludeRebar, setQtoIncludeRebar] = useState<boolean>(true);

  // Multi-Trade Parametric QTO state ("باقي الأعمال")
  const [multiTradeKind, setMultiTradeKind] = useState<MultiTradeQtoKind>("masonry_wall");
  const [mtLength, setMtLength] = useState<number>(10);
  const [mtWidth, setMtWidth] = useState<number>(4);
  const [mtHeight, setMtHeight] = useState<number>(3.2);
  const [mtOpenings, setMtOpenings] = useState<number>(2.0);
  const [mtSwell, setMtSwell] = useState<number>(1.25);
  const [mtWaste, setMtWaste] = useState<number>(4);

  const multiTradeResult = useMemo(
    () =>
      computeMultiTradeQto({
        kind: multiTradeKind,
        length_m: mtLength,
        width_or_thickness_m: mtWidth,
        height_or_depth_m: mtHeight,
        openings_deduction_m2: mtOpenings,
        swell_factor: mtSwell,
        waste_pct: mtWaste,
      }),
    [multiTradeKind, mtLength, mtWidth, mtHeight, mtOpenings, mtSwell, mtWaste],
  );

  const qtoResult = useMemo(
    () =>
      computeConcreteElementQto({
        family: qtoFamily,
        width_m: qtoWidth,
        length_or_depth_m: qtoLength,
        height_or_thickness_m: qtoHeight,
        count: qtoCount,
        concrete_waste_pct: qtoWastePct,
        rebar_total_kg: qtoRebarKg,
        include_formwork: qtoIncludeFormwork,
        include_rebar: qtoIncludeRebar,
      }),
    [qtoFamily, qtoWidth, qtoLength, qtoHeight, qtoCount, qtoWastePct, qtoRebarKg, qtoIncludeFormwork, qtoIncludeRebar],
  );

  // Apply dialog state
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [targetTemplate, setTargetTemplate] = useState<BreakdownTemplate | null>(null);
  const [targetBoqItemId, setTargetBoqItemId] = useState<string>("");
  const [isApplying, setIsApplying] = useState(false);

  // New template dialog state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<BreakdownTemplate | null>(null);
  const [editorMode, setEditorMode] = useState<"new" | "edit" | "duplicate">("new");
  const [previewTemplate, setPreviewTemplate] = useState<BreakdownTemplate | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [subAssemblyCodeToAdd, setSubAssemblyCodeToAdd] = useState<string>("");
  const [migrationRuns, setMigrationRuns] = useState<number>(0);

  const legacyLedger = useMemo(
    () => buildLegacyTemplateDispositionLedger(templates),
    [templates],
  );

  const activeTenderId = useActiveTenderId();

  // Fetch project BOQ items for apply modal and Coverage Registry
  const { data: allBoqItems = [] } = useQuery({
    queryKey: ["boq_items_for_apply", projectId, activeTenderId],
    enabled: !!projectId && (applyModalOpen || activeTab === "coverage"),
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await estimationClient
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

  const boqItems = useMemo(
    () => scopeRowsByTender(allBoqItems as any[], activeTenderId) as BoqRow[],
    [allBoqItems, activeTenderId],
  );

  const { data: coverageRecords = [] } = useQuery({
    queryKey: ["assembly_coverage_records", projectId],
    enabled: !!projectId && activeTab === "coverage",
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await estimationClient
        .from("assembly_coverage_records")
        .select("*")
        .eq("project_id", projectId);
      if (error) return [];
      return data as Database["public"]["Tables"]["assembly_coverage_records"]["Row"][];
    },
  });

  const coverageReport = useMemo(() => {
    const recordByBoqId = new Map(coverageRecords.map((r) => [r.boq_item_id, r]));
    const availableDivisions = new Set(
      templates.map((tmpl) => csiDivisionCode(tmpl.division)).filter((c): c is string => Boolean(c)),
    );
    return computeProjectCoverageStats(
      boqItems.map((b) => {
        const rec = recordByBoqId.get(b.id);
        return {
          id: b.id,
          item_no: b.item_no,
          description_ar: b.description_ar,
          quantity: Number(b.quantity ?? 0),
          is_group: b.is_group,
          csi_division: rec?.csi_division ?? b.sheet_name ?? b.item_no ?? null,
          pricing_status: b.pricing_status ?? null,
          rate_source: b.rate_source ?? null,
          material_cost: Number(b.material_cost ?? 0),
          labor_cost: Number(b.labor_cost ?? 0),
          equipment_cost: Number(b.equipment_cost ?? 0),
          subcontractor_cost: Number(b.subcontractor_cost ?? 0),
          selling_unit_rate: Number(b.manual_unit_price ?? b.imported_unit_rate ?? 0),
          assembly_id: rec?.assembly_id ?? null,
          quote_status: rec?.coverage_status === "reference_only" ? "reference" : null,
        };
      }),
      availableDivisions,
    );
  }, [boqItems, coverageRecords, templates]);

  const hasUnclassified = templates.some((template) => !csiDivisionCode(template.division));

  const filteredTemplates = templates.filter((tmpl) => {
    const q = search.toLowerCase().trim();
    const matchSearch =
      !q ||
      tmpl.code.toLowerCase().includes(q) ||
      tmpl.title_ar.toLowerCase().includes(q) ||
      tmpl.title_en.toLowerCase().includes(q) ||
      tmpl.description_ar.toLowerCase().includes(q) ||
      tmpl.description_en.toLowerCase().includes(q);

    const matchDiv = selectedDivision === "all" ||
      (csiDivisionCode(tmpl.division) ?? "unclassified") === selectedDivision;
    return matchSearch && matchDiv;
  });

  const refreshTemplates = () => {
    setTemplates(getAllBreakdownTemplates());
  };

  function openEditor(template: BreakdownTemplate, mode: "edit" | "duplicate") {
    const draft = structuredClone(template);
    if (mode === "duplicate") {
      const prefix = `${template.code}-COPY`;
      const usedCodes = new Set(templates.map(({ code }) => code.trim().toLowerCase()));
      draft.code = prefix;
      for (let suffix = 2; usedCodes.has(draft.code.toLowerCase()); suffix++) {
        draft.code = `${prefix}-${suffix}`;
      }
      draft.id = crypto.randomUUID();
      draft.items = draft.items.map((item) => ({ ...item, id: crypto.randomUUID() }));
    }
    setEditorMode(mode);
    setEditingTemplate(draft);
    setCreateModalOpen(true);
  }

  function updateResource(id: string, changes: Partial<BreakdownResourceItem>) {
    setEditingTemplate((current) => current && ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...changes } : item),
    }));
  }

  async function handleSaveTemplate() {
    if (!editingTemplate || isSaving) return;
    const code = editingTemplate.code.trim();
    const unit = editingTemplate.unit.trim();
    if (!code || !unit || !(editingTemplate.title_ar.trim() || editingTemplate.title_en.trim())) {
      toast.error(t("breakdown.templateRequiredFields"));
      return;
    }
    if (getAllBreakdownTemplates().some((template) =>
      template.id !== editingTemplate.id && template.code.trim().toLowerCase() === code.toLowerCase(),
    )) {
      toast.error(t("breakdown.templateCodeInUse"));
      return;
    }
    setIsSaving(true);
    try {
      await saveCustomTemplate({ ...editingTemplate, code, unit });
      refreshTemplates();
      setCreateModalOpen(false);
      toast.success(t("breakdown.templateSaved"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setIsSaving(false);
    }
  }

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
      const { data: { user } } = await estimationClient.auth.getUser();
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

  const handleDeleteTemplate = async (id: string, restoreDefault: boolean) => {
    if (!confirm(t(restoreDefault ? "breakdown.restoreTemplate" : "breakdown.deleteTemplate"))) return;
    try {
      await deleteCustomTemplate(id);
    } catch (error) {
      toast.error(String(error));
      return;
    }
    refreshTemplates();
    toast.success(t(restoreDefault ? "breakdown.templateRestored" : "breakdown.templateDeleted"));
  };

  const targetBoqItem = boqItems.find((b) => b.id === targetBoqItemId);
  const targetCalc = targetTemplate ? calculateBreakdownCost(targetTemplate) : null;
  const previewCalc = previewTemplate ? calculateBreakdownCost(previewTemplate) : null;
  const targetQty = targetBoqItem?.quantity || 1;
  const totalDirectForQty = (targetCalc?.directUnitCost || 0) * targetQty;
  const totalSellingForQty = (targetCalc?.unitSellingPrice || 0) * targetQty;

  if (createModalOpen && editingTemplate) {
    const totals = calculateBreakdownCost(editingTemplate);
    return (
      <section className="h-full overflow-y-auto space-y-4 p-4 md:p-6">
        <h1 className="text-xl font-bold">{t(editorMode === "duplicate" ? "breakdown.duplicateTemplate" : editorMode === "new" ? "breakdown.addNewTemplate" : "breakdown.editTemplate")} — {editingTemplate.code}</h1>
        <div className="flex flex-wrap gap-5 rounded border p-3 font-semibold">
          <span>{t("breakdown.directCostPerUnit")} {totals.directUnitCost.toFixed(2)} {t("common.sar")}</span>
          <span>{t("breakdown.sellingRatePerUnit")} {totals.unitSellingPrice.toFixed(2)} {t("common.sar")}</span>
        </div>
        {editingTemplate && (
          <div className="space-y-4 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="template-code" className="font-semibold block mb-1">{t("common.code", "الكود")}:</label>
                <Input
                  id="template-code"
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
              <Select
                value={csiDivisionCode(editingTemplate.division) ?? "legacy"}
                onValueChange={(division) => setEditingTemplate({ ...editingTemplate, division })}
              >
                <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!csiDivisionCode(editingTemplate.division) && (
                    <SelectItem value="legacy" disabled>
                      {editingTemplate.division || t("common.unclassifiedDivision")}
                    </SelectItem>
                  )}
                  {CSI_DIVISIONS.map(({ code, name_ar, name_en }) => (
                    <SelectItem key={code} value={code}>
                      {code} — {language === "ar" ? name_ar : name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div>
              <label htmlFor="template-description-en" className="font-semibold block mb-1">{t("breakdown.descriptionEn")}</label>
              <Input
                id="template-description-en"
                value={editingTemplate.description_en}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, description_en: e.target.value })}
                className="text-xs"
                dir="ltr"
              />
            </div>

            {/* Resource Items */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">{t("breakdown.resourceComponents", "مكونات الموارد لوحدة واحدة:")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Select value={subAssemblyCodeToAdd} onValueChange={setSubAssemblyCodeToAdd}>
                      <SelectTrigger className="h-7 w-[190px] text-[10px]">
                        <SelectValue placeholder="إدراج بند فرعي بالتكلفة المباشرة…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-56">
                        {templates
                          .filter((tItem) => tItem.id !== editingTemplate.id)
                          .slice(0, 35)
                          .map((tItem) => (
                            <SelectItem key={tItem.id} value={tItem.id} className="text-[11px]">
                              {tItem.code} — {tItem.title_ar}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 text-[10px]"
                      disabled={!subAssemblyCodeToAdd}
                      onClick={() => {
                        const chosen = templates.find((tItem) => tItem.id === subAssemblyCodeToAdd);
                        if (!chosen) return;
                        // Expand strictly at direct cost without compounding overhead/profit twice (§4.4)
                        const expanded = expandSubAssemblyAtDirectCost(
                          chosen.items.map((it) => ({
                            resource_type: it.resource_type,
                            quantity: it.quantity,
                            waste_pct: it.waste_pct ?? 0,
                            unit_price: it.unit_price,
                            description_ar: it.description_ar,
                            description_en: it.description_en,
                            unit: it.unit,
                            ...(it.material_category ? { material_category: it.material_category } : {}),
                            ...(it.scope_tag ? { scope_tag: it.scope_tag } : {}),
                          })) as ScopedAnalysisLine[],
                        );
                        setEditingTemplate({
                          ...editingTemplate,
                          items: [
                            ...editingTemplate.items,
                            ...expanded.lines.map((line) => ({
                              id: crypto.randomUUID(),
                              resource_type: line.resource_type,
                              ...(line.material_category ? { material_category: line.material_category } : {}),
                              description_ar: `${line.description_ar ?? chosen.title_ar} [فرعي: ${chosen.code}]`,
                              description_en: line.description_en ?? chosen.title_en,
                              unit: line.unit ?? chosen.unit,
                              quantity: line.quantity,
                              ...(line.waste_pct ? { waste_pct: line.waste_pct } : {}),
                              unit_price: line.unit_price,
                              notes: "مكوّن مستدعى بالتكلفة المباشرة بدون مضاعفة الهوامش",
                            })),
                          ],
                        });
                        toast.success(`تم إدراج مكونات «${chosen.code}» بالتكلفة المباشرة (${expanded.directUnitCost.toFixed(2)} ر.س) دون تكرار الهوامش`);
                        setSubAssemblyCodeToAdd("");
                      }}
                    >
                      إدراج مباشر
                    </Button>
                  </div>
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
                            id: crypto.randomUUID(),
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
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {editingTemplate.items.map((item, idx) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 bg-muted/20">
                    <Select
                      value={item.resource_type}
                      onValueChange={(resource_type: BreakdownResourceType) => updateResource(item.id, { resource_type })}
                    >
                      <SelectTrigger className="w-24 text-[10px] h-7">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(resourceLabels).map(([type, label]) => (
                          <SelectItem key={type} value={type} className="text-xs">{t(label)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      value={item.description_ar}
                      aria-label={t("common.description")}
                      onChange={(e) => updateResource(item.id, { description_ar: e.target.value })}
                      className="flex-1 text-xs h-7"
                      placeholder={t("common.description")}
                    />
                    <Input
                      value={item.unit}
                      aria-label={t("common.unit")}
                      placeholder={t("common.unit")}
                      onChange={(e) => updateResource(item.id, { unit: e.target.value })}
                      className="h-7 w-16 text-xs"
                    />

                    <Input
                      type="number"
                      value={item.quantity}
                      aria-label={t("common.quantity")}
                      onChange={(e) => updateResource(item.id, { quantity: Number(e.target.value) || 0 })}
                      className="w-16 text-xs h-7 font-mono"
                      placeholder={t("common.quantity")}
                    />

                    <Input
                      type="number"
                      value={item.unit_price}
                      aria-label={t("breakdown.itemUnitPrice")}
                      onChange={(e) => updateResource(item.id, { unit_price: Number(e.target.value) || 0 })}
                      className="w-20 text-xs h-7 font-mono"
                      placeholder={t("breakdown.itemUnitPrice")}
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
                    <div className="grid w-full grid-cols-2 gap-2">
                      <Input
                        value={item.description_en}
                        aria-label={t("breakdown.resourceDescriptionEn")}
                        placeholder={t("breakdown.resourceDescriptionEn")}
                        onChange={(e) => updateResource(item.id, { description_en: e.target.value })}
                        className="h-7 text-xs"
                        dir="ltr"
                      />
                      <Input
                        value={item.notes ?? ""}
                        aria-label={t("common.notes")}
                        placeholder={t("common.notes")}
                        onChange={(e) => updateResource(item.id, { notes: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommended Markups */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border">
              <div>
                <label>{t("pa.indirectLabel")} (%)</label>
                <Input type="number" value={editingTemplate.recommended_indirect_pct ?? 0} onChange={(e) => setEditingTemplate({ ...editingTemplate, recommended_indirect_pct: Number(e.target.value) || 0 })} />
              </div>
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

        <footer className="sticky bottom-0 flex gap-2 border-t bg-background p-3">
          <Button variant="outline" size="sm" disabled={isSaving} onClick={() => setCreateModalOpen(false)}>
            {t("common.cancel", "إلغاء")}
          </Button>
          <Button
            size="sm"
            disabled={isSaving}
            onClick={handleSaveTemplate}
          >
            {isSaving ? t("common.saving") : t("common.save")}
          </Button>
        </footer>
      </section>
    );
  }

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
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const text = await file.text();
                  const parsedJson = JSON.parse(text);
                  const arr = Array.isArray(parsedJson) ? parsedJson : parsedJson?.templates;
                  if (!Array.isArray(arr)) throw new Error("ملف JSON يجب أن يحتوي على مصفوفة قوالب");
                  const importedCount = await importCustomTemplatesBatch(arr);
                  setTemplates(getAllBreakdownTemplates());
                  toast.success(`تم استيراد ${importedCount} نموذجاً معتمداً إلى مكتبة الشركة بنجاح.`);
                } catch (err: any) {
                  toast.error(err?.message || "تعذر قراءة ملف القوالب JSON");
                }
              }}
            />
            <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
              <Copy className="h-3.5 w-3.5 text-primary" />
              استيراد قوالب (JSON)
            </span>
          </label>
          <Button
            onClick={() => {
              setEditorMode("new");
              setEditingTemplate({
                id: "tmpl-" + Date.now(),
                code: "DIV-CUSTOM",
                division: "01",
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

      {/* Sub-navigation Tabs: Library vs Parametric Concrete QTO vs Coverage Registry */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <Button
          size="sm"
          variant={activeTab === "library" ? "default" : "outline"}
          className="gap-1.5 text-xs"
          onClick={() => setActiveTab("library")}
        >
          <Layers className="h-3.5 w-3.5" />
          مكتبة القوالب التنفيذية (CSI 01–33 الشاملة)
        </Button>
        <Button
          size="sm"
          variant={activeTab === "qto" ? "default" : "outline"}
          className="gap-1.5 text-xs"
          onClick={() => setActiveTab("qto")}
        >
          <Calculator className="h-3.5 w-3.5" />
          حاسبة الحصر (الخرسانة + باقي الأعمال)
        </Button>
        <Button
          size="sm"
          variant={activeTab === "coverage" ? "default" : "outline"}
          className="gap-1.5 text-xs"
          onClick={() => setActiveTab("coverage")}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          سجل تغطية المقايسات والفجوات
        </Button>
      </div>

      {activeTab === "qto" && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              حاسبة الحصر الخرساني البارامترية — القسم 03 (م³، م² شدة، كجم حديد، وهالك واحد)
            </CardTitle>
            <CardDescription className="text-xs">
              تحسب الكميات الهندسية الصافية ومعامل التوريد والشدة والحديد دون ازدواجية في الهالك أو التكاليف غير المباشرة.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <Label className="text-[11px]">العنصر الإنشائي</Label>
                <Select value={qtoFamily} onValueChange={(v) => setQtoFamily(v as ConcreteElementFamily)}>
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lean_concrete">خرسانة نظافة عادية</SelectItem>
                    <SelectItem value="isolated_footing">قواعد منفصلة / مشتركة</SelectItem>
                    <SelectItem value="raft_foundation">لبشة مسلحة</SelectItem>
                    <SelectItem value="column">أعمدة ورقاب</SelectItem>
                    <SelectItem value="retaining_wall">حوائط ساندة / قص / خزانات</SelectItem>
                    <SelectItem value="beam">كمرات وجسور</SelectItem>
                    <SelectItem value="grade_beam">ميدات وشدادات</SelectItem>
                    <SelectItem value="solid_slab">بلاطات مصمتة / أعصاب</SelectItem>
                    <SelectItem value="flat_slab">فلات سلاب / سقوط وتيجان</SelectItem>
                    <SelectItem value="hollow_block_slab">هوردى / وافل</SelectItem>
                    <SelectItem value="stairs_and_misc">سلالم وبروزات وملحقات</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">العرض (م)</Label>
                <Input type="number" step="0.01" value={qtoWidth} onChange={(e) => setQtoWidth(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
              </div>
              <div>
                <Label className="text-[11px]">الطول / العمق (م)</Label>
                <Input type="number" step="0.01" value={qtoLength} onChange={(e) => setQtoLength(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
              </div>
              <div>
                <Label className="text-[11px]">الارتفاع / السماكة (م)</Label>
                <Input type="number" step="0.01" value={qtoHeight} onChange={(e) => setQtoHeight(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
              </div>
              <div>
                <Label className="text-[11px]">العدد</Label>
                <Input type="number" step="1" min={1} value={qtoCount} onChange={(e) => setQtoCount(Math.max(1, Number(e.target.value) || 1))} className="h-8 text-xs mt-1" />
              </div>
              <div>
                <Label className="text-[11px]">هالك الخرسانة % (مرة واحدة)</Label>
                <Input type="number" step="0.5" value={qtoWastePct} onChange={(e) => setQtoWastePct(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
              </div>
              <div>
                <Label className="text-[11px]">إجمالي الحديد للعنصر (كجم)</Label>
                <Input type="number" step="1" value={qtoRebarKg} onChange={(e) => setQtoRebarKg(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
              </div>
              <div className="flex flex-col justify-end gap-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={qtoIncludeFormwork} onChange={(e) => setQtoIncludeFormwork(e.target.checked)} />
                  <span>شامل الشدة</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={qtoIncludeRebar} onChange={(e) => setQtoIncludeRebar(e.target.checked)} />
                  <span>شامل الحديد</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
              <div>
                <div className="text-muted-foreground text-[10px]">حجم الخرسانة الهندسي</div>
                <div className="font-mono font-bold text-sm">{qtoResult.total_volume_m3} م³</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px]">سطح تلامس الشدة</div>
                <div className="font-mono font-bold text-sm">{qtoResult.formwork_contact_m2} م²</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px]">معامل الشدة / م³</div>
                <div className="font-mono font-bold text-sm text-primary">{qtoResult.formwork_m2_per_m3} م²/م³</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px]">معدل الحديد / م³</div>
                <div className="font-mono font-bold text-sm text-primary">{qtoResult.rebar_kg_per_m3} كجم/م³</div>
              </div>
              <div>
                <div className="text-muted-foreground text-[10px]">التكلفة المباشرة التقديرية / م³</div>
                <div className="font-mono font-bold text-sm text-emerald-500">{qtoResult.directUnitCostPerM3.toFixed(2)} ر.س</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-muted-foreground">
                النطاقات المشمولة: {qtoResult.included_scopes.map((s) => SCOPE_LABELS_AR[s]).join(" · ")}
                {qtoResult.excluded_scopes.length > 0 && (
                  <span className="text-amber-600 ms-2">
                    | مستبعد: {qtoResult.excluded_scopes.map((s) => SCOPE_LABELS_AR[s]).join(" · ")}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() =>
                  handleOpenApply({
                    id: `parametric-${qtoFamily}`,
                    code: `03-QTO-${qtoFamily.toUpperCase()}`,
                    division: "Div. 03 - Concrete Works",
                    title_ar: `خرسانة ${qtoFamily} بارامترية (${qtoWidth}×${qtoLength}×${qtoHeight}م)`,
                    title_en: `Parametric concrete ${qtoFamily}`,
                    description_ar: `توليد بارامتري: حجم ${qtoResult.total_volume_m3} م³، شدة ${qtoResult.formwork_m2_per_m3} م²/م³، حديد ${qtoResult.rebar_kg_per_m3} كجم/م³.`,
                    description_en: `Parametric assembly: ${qtoResult.total_volume_m3} m³`,
                    unit: "م³",
                    recommended_indirect_pct: 4,
                    recommended_overhead_pct: 10,
                    recommended_profit_pct: 10,
                    recommended_risk_pct: 3,
                    assembly_kind: "executable",
                    rate_kind: "composite",
                    included_scopes: qtoResult.included_scopes,
                    excluded_scopes: qtoResult.excluded_scopes,
                    items: qtoResult.lines.map((line, i) => ({
                      id: `qto-line-${i + 1}`,
                      resource_type: line.resource_type,
                      ...(line.material_category ? { material_category: line.material_category } : {}),
                      description_ar: line.description_ar ?? "",
                      description_en: line.description_en ?? "",
                      unit: line.unit ?? "م³",
                      quantity: line.quantity,
                      ...(line.waste_pct !== undefined ? { waste_pct: line.waste_pct } : {}),
                      unit_price: line.unit_price,
                      ...(line.scope_tag ? { scope_tag: String(line.scope_tag) } : {}),
                      ...(line.rate_kind ? { rate_kind: String(line.rate_kind) } : {}),
                    })),
                  })
                }
              >
                <ArrowRight className="h-3.5 w-3.5" />
                تطبيق النتيجة البارامترية على بند بالمقايسة
              </Button>
            </div>

            {/* Multi-Trade Parametric Calculator for Remaining Works ("باقي الأعمال") */}
            <div className="pt-4 border-t border-border space-y-3">
              <div>
                <h3 className="text-sm font-bold">حاسبة الحصر والـ Breakdown لباقي الأعمال (مباني، ترابية، عزل، ومسارات MEP)</h3>
                <p className="text-[11px] text-muted-foreground">
                  احسب صافي كميات الدفع ومعامل الانتفاش أو الوزرات أو مسار الكابلات والمواسير ثم طبّق التحليل مباشرة على بند بالمقايسة.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
                <div className="col-span-2">
                  <Label className="text-[11px]">نوع العمل</Label>
                  <Select value={multiTradeKind} onValueChange={(v) => setMultiTradeKind(v as MultiTradeQtoKind)}>
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="masonry_wall">04 — مباني بلوك (مع خصم الفتحات)</SelectItem>
                      <SelectItem value="earthwork_trench_bulk">31 — حفر وترحيل (بمعامل انتفاش)</SelectItem>
                      <SelectItem value="waterproofing_area">07 — عزل مائي (شامل وزرة الحواف)</SelectItem>
                      <SelectItem value="mep_pipe_cable_run">22/26 — مسار مواسير/كابلات مع حوامل</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">الطول (م)</Label>
                  <Input type="number" step="0.5" value={mtLength} onChange={(e) => setMtLength(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
                </div>
                <div>
                  <Label className="text-[11px]">العرض (م)</Label>
                  <Input type="number" step="0.5" value={mtWidth} onChange={(e) => setMtWidth(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
                </div>
                <div>
                  <Label className="text-[11px]">الارتفاع/العمق (م)</Label>
                  <Input type="number" step="0.1" value={mtHeight} onChange={(e) => setMtHeight(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
                </div>
                <div>
                  <Label className="text-[11px]">
                    {multiTradeKind === "masonry_wall" ? "خصم فتحات (م²)" : multiTradeKind === "earthwork_trench_bulk" ? "معامل الانتفاش" : "نسبة الهالك %"}
                  </Label>
                  {multiTradeKind === "masonry_wall" ? (
                    <Input type="number" step="0.5" value={mtOpenings} onChange={(e) => setMtOpenings(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
                  ) : multiTradeKind === "earthwork_trench_bulk" ? (
                    <Input type="number" step="0.05" value={mtSwell} onChange={(e) => setMtSwell(Number(e.target.value) || 1)} className="h-8 text-xs mt-1" />
                  ) : (
                    <Input type="number" step="0.5" value={mtWaste} onChange={(e) => setMtWaste(Number(e.target.value) || 0)} className="h-8 text-xs mt-1" />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-xs">
                <div className="flex flex-wrap gap-6">
                  <div>
                    <span className="text-muted-foreground">كمية الدفع الصافية: </span>
                    <strong className="font-mono">{multiTradeResult.primaryPayQty} {multiTradeResult.payUnit}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{multiTradeResult.secondaryMetricLabel}: </span>
                    <strong className="font-mono text-primary">{multiTradeResult.secondaryMetricVal}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">التكلفة المباشرة التقديرية/وحدة: </span>
                    <strong className="font-mono text-emerald-500">{multiTradeResult.directUnitCost.toFixed(2)} ر.س</strong>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-xs gap-1.5"
                  onClick={() =>
                    handleOpenApply({
                      id: `parametric-${multiTradeKind}`,
                      code: `QTO-${multiTradeKind.toUpperCase()}`,
                      division:
                        multiTradeKind === "masonry_wall"
                          ? "Div. 04 - Masonry"
                          : multiTradeKind === "earthwork_trench_bulk"
                            ? "Div. 31 - Earthwork"
                            : multiTradeKind === "waterproofing_area"
                              ? "Div. 07 - Thermal & Moisture Protection"
                              : "Div. 26 - Electrical",
                      title_ar: `تحليل بارامتري — ${multiTradeKind}`,
                      title_en: `Parametric assembly ${multiTradeKind}`,
                      description_ar: `كمية الدفع الصافية ${multiTradeResult.primaryPayQty} ${multiTradeResult.payUnit}.`,
                      description_en: `Net pay qty ${multiTradeResult.primaryPayQty}`,
                      unit: multiTradeResult.payUnit,
                      recommended_indirect_pct: 3,
                      recommended_overhead_pct: 9,
                      recommended_profit_pct: 11,
                      recommended_risk_pct: 2,
                      assembly_kind: "executable",
                      rate_kind: "composite",
                      items: multiTradeResult.lines.map((line, i) => ({
                        id: `mt-line-${i + 1}`,
                        resource_type: line.resource_type,
                        ...(line.material_category ? { material_category: line.material_category } : {}),
                        description_ar: line.description_ar ?? "",
                        description_en: line.description_en ?? "",
                        unit: line.unit ?? multiTradeResult.payUnit,
                        quantity: line.quantity,
                        ...(line.waste_pct !== undefined ? { waste_pct: line.waste_pct } : {}),
                        unit_price: line.unit_price,
                        ...(line.scope_tag ? { scope_tag: String(line.scope_tag) } : {}),
                        ...(line.rate_kind ? { rate_kind: String(line.rate_kind) } : {}),
                      })),
                    })
                  }
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  تطبيق التحليل على بند بالمقايسة
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "coverage" && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              سجل تغطية المقايسات وفجوات التسعير — الأقسام (CSI 01–10)
            </CardTitle>
            <CardDescription className="text-xs">
              يقيس نسبة تغطية بنود المشروع بعدد البنود وبقيمة العطاء بالريال السعودي، ويميز الأسعار الموثقة بعروض موردين عن المرجعية والمنتهية.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!projectId ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-600">
                اختر مشروعاً نشطاً من الشريط العلوي لعرض تقرير تغطية جدول الكميات.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <div className="text-muted-foreground text-[10px]">نسبة التغطية (بعد البنود)</div>
                    <div className="font-mono font-bold text-lg text-primary">{coverageReport.countCoveragePct}%</div>
                    <div className="text-[10px] text-muted-foreground">{coverageReport.coveredItems} من {coverageReport.totalItems} بند</div>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <div className="text-muted-foreground text-[10px]">نسبة التغطية (بالقيمة ر.س)</div>
                    <div className="font-mono font-bold text-lg text-emerald-500">{coverageReport.valueCoveragePct}%</div>
                    <div className="text-[10px] text-muted-foreground">{coverageReport.coveredValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} ر.س</div>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <div className="text-muted-foreground text-[10px]">بنود الفجوات (Gaps)</div>
                    <div className="font-mono font-bold text-lg text-amber-500">{coverageReport.gapItems}</div>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <div className="text-muted-foreground text-[10px]">مرجعي فقط / غير مسعر</div>
                    <div className="font-mono font-bold text-lg">{coverageReport.referenceOnlyItems} / {coverageReport.unpricedItems}</div>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <div className="text-muted-foreground text-[10px]">عروض منتهية الصلاحية</div>
                    <div className="font-mono font-bold text-lg text-destructive">{coverageReport.expiredItems}</div>
                  </div>
                </div>

                {coverageReport.byDivision.length > 0 && (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="p-2 text-start">القسم CSI</th>
                          <th className="p-2 text-center">إجمالي البنود</th>
                          <th className="p-2 text-center">المغطاة</th>
                          <th className="p-2 text-center">الفجوات</th>
                          <th className="p-2 text-center">نسبة العدد</th>
                          <th className="p-2 text-center">نسبة القيمة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coverageReport.byDivision.map((row) => (
                          <tr key={row.divisionCode} className="border-t">
                            <td className="p-2 font-mono font-semibold">القسم {row.divisionCode}</td>
                            <td className="p-2 text-center tabular-nums">{row.totalItems}</td>
                            <td className="p-2 text-center tabular-nums text-emerald-600">{row.coveredItems}</td>
                            <td className="p-2 text-center tabular-nums text-amber-600">{row.gapItems}</td>
                            <td className="p-2 text-center tabular-nums">{row.countCoveragePct}%</td>
                            <td className="p-2 text-center tabular-nums">{row.valueCoveragePct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {coverageReport.highImpactGaps.length > 0 && (
                  <div className="pt-2 space-y-2">
                    <h4 className="text-xs font-bold text-amber-600">
                      الدفعة التالية ذات الأثر المالي الأعلى ({coverageReport.highImpactGaps.length} بند فجوة):
                    </h4>
                    <div className="max-h-48 overflow-y-auto rounded-md border">
                      <table className="w-full text-[11px]">
                        <thead className="bg-muted/40 sticky top-0">
                          <tr>
                            <th className="p-2 text-start">رقم البند</th>
                            <th className="p-2 text-start">الوصف</th>
                            <th className="p-2 text-center">القسم</th>
                            <th className="p-2 text-center">الأثر المالي التقديري</th>
                            <th className="p-2 text-center">إجراء</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {coverageReport.highImpactGaps.slice(0, 15).map((gap) => (
                            <tr key={gap.boqItemId}>
                              <td className="p-1.5 font-mono font-bold">{gap.itemNo}</td>
                              <td className="p-1.5 max-w-xs truncate">{gap.description_ar}</td>
                              <td className="p-1.5 text-center font-mono">{gap.divisionCode}</td>
                              <td className="p-1.5 text-center font-mono text-amber-600">
                                {gap.estimatedValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} ر.س
                              </td>
                              <td className="p-1.5 text-center">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px]"
                                  onClick={() => {
                                    if (gap.divisionCode && gap.divisionCode !== "00") {
                                      setSelectedDivision(gap.divisionCode);
                                    }
                                    setActiveTab("library");
                                  }}
                                >
                                  عرض قوالب القسم
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* 50-Template Legacy Disposition & Idempotent Migration Ledger (§5 Delivery #1) */}
            <div className="pt-4 border-t border-border space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold">جرد الـ {legacyLedger.totalAudited} قالباً القديمة وقرارات الترحيل</h3>
                  <p className="text-[11px] text-muted-foreground">
                    إبقاء تنفيذي: {legacyLedger.byDisposition.keep_executable} · تفكيك نطاقات: {legacyLedger.byDisposition.split_by_scope} · مرجع مركّب: {legacyLedger.byDisposition.reference_composite} · حزمة شراء: {legacyLedger.byDisposition.purchase_package_only}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs gap-1.5"
                  onClick={() => {
                    setMigrationRuns((n) => n + 1);
                    toast.success(`نجحت محاكاة الترحيل رقم #${migrationRuns + 1}: تطابق كامل (${legacyLedger.totalAudited} سجل بدون تكرار).`);
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  اختبار تكرار الترحيل ({migrationRuns})
                </Button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="p-2 text-start">المعرف القديم</th>
                      <th className="p-2 text-start">الكود</th>
                      <th className="p-2 text-start">قرار المعالجة</th>
                      <th className="p-2 text-start">البديل المعتمد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {legacyLedger.entries.map((entry) => (
                      <tr key={entry.legacyId}>
                        <td className="p-1.5 font-mono text-muted-foreground">{entry.legacyId}</td>
                        <td className="p-1.5 font-mono font-semibold">{entry.code}</td>
                        <td className="p-1.5">
                          <Badge
                            variant={entry.disposition === "reference_composite" ? "destructive" : "outline"}
                            className="text-[10px]"
                          >
                            {entry.disposition === "keep_executable"
                              ? "إبقاء تنفيذي"
                              : entry.disposition === "split_by_scope"
                                ? "تفكيك نطاقات"
                                : entry.disposition === "reference_composite"
                                  ? "مرجع مركّب"
                                  : "حزمة شراء"}
                          </Badge>
                        </td>
                        <td className="p-1.5 font-mono text-primary">{entry.replacementCode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
              {t("common.allDivisions", "جميع أقسام CSI")}
            </SelectItem>
            {CSI_DIVISIONS.map(({ code, name_ar, name_en }) => (
              <SelectItem key={code} value={code} className="text-xs">
                {code} — {language === "ar" ? name_ar : name_en}
              </SelectItem>
            ))}
            {hasUnclassified && (
              <SelectItem value="unclassified">{t("common.unclassifiedDivision")}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Grid of Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map((template) => {
          const calc = calculateBreakdownCost(template);
          const restoreDefault = DEFAULT_BREAKDOWN_TEMPLATES.some(({ id }) => id === template.id);
          const removeLabel = t(restoreDefault ? "breakdown.restoreTemplate" : "breakdown.deleteTemplate");
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
                    {template.assembly_kind === "reference_composite" && (
                      <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px] gap-1">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        مرجع مركّب
                      </Badge>
                    )}
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
                    {csiDivisionLabel(template.division, language)}
                  </CardDescription>
                </div>

                <p className="text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed">
                  {isEn ? template.description_en || template.description_ar : template.description_ar}
                </p>
                {(template.included_scopes?.length || template.excluded_scopes?.length) ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {template.excluded_scopes?.slice(0, 2).map((ex) => (
                      <Badge key={ex} variant="outline" className="text-[9px] border-amber-500/30 text-amber-600">
                        مستبعد: {SCOPE_LABELS_AR[ex as AssemblyScopeTag] ?? ex}
                      </Badge>
                    ))}
                  </div>
                ) : null}
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
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setPreviewTemplate(template)}>
                    <Eye className="h-3.5 w-3.5" />
                    {t("breakdown.previewTemplate")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEditor(template, "edit")}>
                    <Edit className="h-3.5 w-3.5" />
                    {t("common.edit")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEditor(template, "duplicate")}>
                    <Copy className="h-3.5 w-3.5" />
                    {t("breakdown.duplicateTemplate")}
                  </Button>
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
                      className="col-span-2 justify-start text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteTemplate(template.id, restoreDefault)}
                    >
                      {restoreDefault ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                      {removeLabel}
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

      <Dialog open={!!previewTemplate} onOpenChange={(open) => { if (!open) setPreviewTemplate(null); }}>
        {previewTemplate && previewCalc && (
          <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{(isEn ? previewTemplate.title_en : previewTemplate.title_ar) || previewTemplate.title_ar || previewTemplate.title_en}</DialogTitle>
              <DialogDescription>
                {previewTemplate.code} · {csiDivisionLabel(previewTemplate.division, language)} · {previewTemplate.unit}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {(isEn ? previewTemplate.description_en : previewTemplate.description_ar) ||
                previewTemplate.description_ar || previewTemplate.description_en}
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    {[t("common.type"), t("common.description"), t("common.unit"), t("common.quantity"),
                    t("breakdown.itemUnitPrice"), t("breakdown.itemLineTotal")].map((label) => (
                      <th key={label} scope="col" className="p-2 text-start font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewTemplate.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="p-2">{t(resourceLabels[item.resource_type])}</td>
                      <td className="p-2">
                        {(isEn ? item.description_en : item.description_ar) || item.description_ar || item.description_en}
                        {item.notes && <div className="text-xs text-muted-foreground">{item.notes}</div>}
                      </td>
                      <td className="p-2">{item.unit}</td>
                      <td className="p-2 tabular-nums">{item.quantity}</td>
                      <td className="p-2 tabular-nums">{item.unit_price.toFixed(2)}</td>
                      <td className="p-2 tabular-nums">{(item.quantity * item.unit_price).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
              <div><dt>{t("breakdown.directCostPerUnit")}</dt><dd className="font-semibold">{previewCalc.directUnitCost.toFixed(2)} {t("common.sar")}</dd></div>
              <div><dt>{t("breakdown.sellingRatePerUnit")} ({previewCalc.totalMarkupPct}%)</dt><dd className="font-semibold">{previewCalc.unitSellingPrice.toFixed(2)} {t("common.sar")}</dd></div>
            </dl>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreviewTemplate(null)}>{t("common.close")}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

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
                  {csiDivisionLabel(targetTemplate.division, language)}
                </div>
              </div>

              {targetTemplate.assembly_kind === "reference_composite" && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>تنبيه مرجعي:</strong> هذا القالب مصنّف كـ «مرجع تقديري مركّب» ولا يشمل{" "}
                    {targetTemplate.excluded_scopes?.map((s) => SCOPE_LABELS_AR[s as AssemblyScopeTag] ?? s).join(" و")}.
                    يجب مراجعة النطاق وربط أسطر الموردين الفعلية قبل اعتماد السعر في العطاء النهائي.
                  </div>
                </div>
              )}

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

    </div>
  );
}
