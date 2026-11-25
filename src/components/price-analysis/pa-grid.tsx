import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  Plus,
  Download,
  ChevronDown,
  ChevronRight,
  Calculator,
  ShoppingBag,
  Layers,
  ArrowLeftRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { estimationClient } from "@/lib/estimation-client";
import { cn } from "@/lib/utils";
import { fmtNumber, fmtSAR } from "@/lib/format";
import { toast } from "sonner";
import { useActiveProjectId } from "@/lib/active-project";
import { computeDirectUnitCost, computePricingPhase2, roundTo } from "@/lib/estimation-calc";
import {
  analyzeAssemblyScopes,
  SCOPE_LABELS_AR,
  type AssemblyScopeTag,
  type ScopedAnalysisLine,
} from "@/lib/csi-assemblies-engine";
import { syncBoqItemBreakdownFromPa, clearManualPriceForBoqItem, restoreImportedRateForBoqItem } from "@/lib/pa-sync";
import type { Database } from "@/integrations/supabase/types";
import { ImportPaDialog } from "./import-pa-dialog";
import { SelectQuoteDialog } from "./select-quote-dialog";
import { exportPriceAnalysis } from "@/lib/pa-export";
import { useLanguage } from "@/lib/i18n";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
type PaItem = Database["public"]["Tables"]["price_analysis_items"]["Row"];
type Markup = Database["public"]["Tables"]["price_analysis_markup"]["Row"];
type ResourceType = Database["public"]["Enums"]["resource_type"];

// ─── Dual-Language Resource Type Labels (Plan Section 3) ──────────────────────
const TYPE_LABEL: Record<ResourceType, string> = {
  material: "مواد (Material)",
  labor: "عمالة (Labor)",
  equipment: "معدات (Equipment)",
  subcontractor: "مقاول باطن (Subcontractor)",
};

const SECTION_HEADER_CLS: Record<ResourceType, string> = {
  material:      "bg-muted/40 text-foreground border-r-[3px] border-r-chart-2",
  labor:         "bg-muted/40 text-foreground border-r-[3px] border-r-chart-3",
  equipment:     "bg-muted/40 text-foreground border-r-[3px] border-r-primary",
  subcontractor: "bg-muted/40 text-foreground border-r-[3px] border-r-chart-4",
};

const SECTION_SUBTOTAL_CLS: Record<ResourceType, string> = {
  material:      "bg-muted/25 text-foreground",
  labor:         "bg-muted/25 text-foreground",
  equipment:     "bg-muted/25 text-foreground",
  subcontractor: "bg-muted/25 text-foreground",
};

type CellStyles = Record<
  string,
  { bold?: boolean; italic?: boolean; align?: "right" | "center" | "left"; fontSize?: number; note?: string }
>;

type Col = { key: string; label: string; defaultW: number; align: "center" | "left" | "right" };

const CELL = "flex shrink-0 items-center overflow-hidden border-l border-border/40 px-2 py-[5px] text-[11px] tabular-nums";

export function PaGrid({ boqItem }: { boqItem: BoqRow }) {
  const qc        = useQueryClient();
  const projectId = useActiveProjectId();
  const { t, language } = useLanguage();
  const storageKey = `pa-grid-v3-widths:${boqItem.id}`;

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}"); }
    catch { return {}; }
  });
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(colWidths));
  }, [colWidths, storageKey]);

  // Unified single "التوصيف (Description)" column + dedicated "الملاحظات (Notes)" as LAST logical column after amount
  const cols = useMemo(() => {
    const rawCols: Col[] = [
      { key: "level",          label: t("pa.colItemNo", "رقم البند"),             defaultW: 75,  align: "center" },
      { key: "description",    label: "التوصيف (Description)",                    defaultW: 360, align: "right"  },
      { key: "qty",            label: t("common.quantity", "الكمية"),             defaultW: 75,  align: "center" },
      { key: "uom",            label: t("common.unit", "وحدة القياس"),            defaultW: 75,  align: "center" },
      { key: "rate",           label: t("common.directCost", "التكلفة المباشرة"), defaultW: 120, align: "center" },
      { key: "amount",         label: "إجمالي التكلفة المباشرة",                   defaultW: 140, align: "center" },
      { key: "notes",          label: "الملاحظات (Notes)",                        defaultW: 220, align: "right"  },
      { key: "__actions",      label: "",                                         defaultW: 64,  align: "center" },
    ];
    return rawCols.map((c) => ({ ...c, w: colWidths[c.key] ?? c.defaultW }));
  }, [colWidths, t]);
  const totalW = cols.reduce((s, c) => s + c.w, 0);

  const [collapsed, setCollapsed] = useState<Set<ResourceType | string>>(new Set());
  const toggleCollapse = (t: ResourceType | string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [quoteDialogType, setQuoteDialogType] = useState<ResourceType>("material");

  const { data: items = [] } = useQuery({
    queryKey: ["pa_items", boqItem.id],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("price_analysis_items")
        .select("*")
        .eq("boq_item_id", boqItem.id)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data as PaItem[];
    },
  });

  const { data: markup } = useQuery({
    queryKey: ["pa_markup", boqItem.id],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("price_analysis_markup")
        .select("*")
        .eq("boq_item_id", boqItem.id)
        .maybeSingle();
      if (error) throw error;
      return data as Markup | null;
    },
  });

  const directBreakdown = useMemo(() => computeDirectUnitCost(items as any), [items]);
  const scopeAudit = useMemo(
    () =>
      analyzeAssemblyScopes(
        items.map((it) => {
          const cs = (it.cell_styles ?? {}) as Record<string, unknown>;
          return {
            ...(it as unknown as ScopedAnalysisLine),
            is_split_pour: Boolean(cs["is_split_pour"]),
            allocated_qty: typeof cs["allocated_qty"] === "number" ? cs["allocated_qty"] : null,
          };
        }),
        { boqQuantity: Number(boqItem.quantity ?? 0) },
      ),
    [items, boqItem.quantity],
  );
  const directCost = directBreakdown.directUnitCost;
  const indirect = Number(markup?.indirect_pct ?? 0);
  const overhead = Number(markup?.overhead_pct ?? 0);
  const risk = Number(markup?.risk_pct ?? 0);
  const profit = Number(markup?.profit_pct ?? 0);

  // Unified Phase 2 Pricing Engine contract (same engine as BOQ, Financial, and Export)
  const phase2 = useMemo(
    () =>
      computePricingPhase2({
        directUnitCost: directCost,
        quantity: Number(boqItem.quantity ?? 1),
        markups: {
          indirect_pct: indirect,
          overhead_pct: overhead,
          risk_pct: risk,
          profit_pct: profit,
          pricing_policy: ((markup as any)?.pricing_policy as "additive_v2" | "cascaded_v1") ?? "additive_v2",
          round_up_rate: (markup as any)?.round_up_rate ?? true,
        },
        manualSellingPrice: (markup as any)?.manual_unit_price ?? (boqItem as any)?.manual_unit_price ?? null,
      }),
    [directCost, boqItem, indirect, overhead, risk, profit, markup],
  );

  const indirectVal = phase2.indirectVal;
  const overheadVal = phase2.overheadVal;
  const riskVal = phase2.riskVal;
  const profitVal = phase2.profitVal;
  const totalAdditions = phase2.totalAdditions;
  const rawSellingPrice = phase2.rawUnitSellingPrice;
  const approvedRate = phase2.approvedUnitRate;
  const roundingDifference = phase2.roundingDifferencePerUnit;
  const selling = approvedRate;

  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const onColResizeStart = (key: string, startW: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { key, startX: e.clientX, startW };
    const onMove = (ev: MouseEvent) => {
      const current = resizeRef.current;
      if (!current) return;
      const next = Math.max(40, current.startW + (ev.clientX - current.startX));
      setColWidths((w) => ({ ...w, [current.key]: next }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  const updateMut = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<PaItem> }) => {
      const { error } = await estimationClient
        .from("price_analysis_items").update(vars.patch).eq("id", vars.id);
      if (error) throw error;
      await syncBoqItemBreakdownFromPa(boqItem.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] });
      qc.invalidateQueries({ queryKey: ["pa_items_project", projectId] });
      qc.invalidateQueries({ queryKey: ["boq_items"] });
    },
    onError:   (e: Error) => toast.error(e.message),
  });

  const toggleMaterialCategoryMut = useMutation({
    mutationFn: async ({ id, currentCat }: { id: string; currentCat: string }) => {
      const item = items.find((i) => i.id === id);
      const cellStyles = ((item?.cell_styles ?? {}) as Record<string, unknown>);
      const nextCat = currentCat === "accessory" ? "primary" : "accessory";
      const nextStyles = { ...cellStyles, material_category: nextCat };
      const { error } = await estimationClient
        .from("price_analysis_items")
        .update({
          material_category: nextCat,
          cell_styles: nextStyles as any,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تحديث تصنيف المادة بنجاح");
      qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateBoqItemMut = useMutation({
    mutationFn: async ({ note, description_ar }: { note?: string; description_ar?: string }) => {
      const patch: Record<string, unknown> = {};
      if (note !== undefined) {
        patch["note"] = note;
        patch["cell_styles"] = { ...((boqItem.cell_styles as Record<string, unknown>) ?? {}), note };
      }
      if (description_ar !== undefined) {
        patch["description_ar"] = description_ar;
      }
      const { error } = await estimationClient.from("boq_items").update(patch as any).eq("id", boqItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تحديث بيانات البند بنجاح");
      qc.invalidateQueries({ queryKey: ["boq_items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await estimationClient.from("price_analysis_items").delete().eq("id", id);
      if (error) throw error;
      await syncBoqItemBreakdownFromPa(boqItem.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] });
      qc.invalidateQueries({ queryKey: ["pa_items_project", projectId] });
      qc.invalidateQueries({ queryKey: ["boq_items"] });
    },
  });

  const addMut = useMutation({
    mutationFn: async (opts: ResourceType | { type: ResourceType; materialCategory?: "primary" | "accessory" }) => {
      const type = typeof opts === "string" ? opts : opts.type;
      const cat = typeof opts === "object" ? opts.materialCategory : "primary";
      const { data: u } = await estimationClient.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");
      const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0);
      const isAccessory = type === "material" && cat === "accessory";
      const { error } = await estimationClient.from("price_analysis_items").insert({
        boq_item_id:   boqItem.id,
        user_id:       userId,
        project_id:    projectId,
        resource_type: type,
        description_ar: isAccessory ? "إكسسوار / مستهلك جديد" : `مكوّن جديد (${TYPE_LABEL[type]})`,
        unit:          type === "material" ? (isAccessory ? "عدد" : "م³") : type === "labor" ? "يومية" : type === "equipment" ? "ساعة" : "مقطوعية",
        quantity:      1,
        unit_price:    0,
        sort_order:    maxSort + 1,
        material_category: type === "material" ? (cat ?? "primary") : null,
        cell_styles:   (type === "material" ? { material_category: cat ?? "primary" } : null) as any,
      });
      if (error) throw error;
      await syncBoqItemBreakdownFromPa(boqItem.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] });
      qc.invalidateQueries({ queryKey: ["pa_items_project", projectId] });
      qc.invalidateQueries({ queryKey: ["boq_items"] });
    },
    onError:   (e: Error) => toast.error(e.message),
  });

  const cw = (key: string) => {
    const c = cols.find((x) => x.key === key);
    if (!c) return { width: 0, minWidth: 0 };
    return { width: c.w, minWidth: c.w };
  };

  const TYPES: ResourceType[] = ["material", "labor", "equipment", "subcontractor"];

  // Combined BOQ item description (Arabic + English verbatim if both present)
  const boqDescCombined = useMemo(() => {
    const ar = boqItem.description_ar?.trim() ?? "";
    const en = (boqItem as any).description_en?.trim() ?? "";
    if (ar && en && ar !== en) return `${ar}\n${en}`;
    return ar || en || "—";
  }, [boqItem]);

  const boqNoteValue = boqItem.note || ((boqItem.cell_styles as any)?.note as string) || "";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ══ Toolbar ══════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono font-semibold text-primary">
            {boqItem.item_no}
          </span>
          <span className="truncate max-w-sm font-medium text-foreground">{boqDescCombined.split("\n")[0]}</span>
          <span className="text-border">·</span>
          <span>{t("pa.quantityLabel", "الكمية:")} <strong className="text-foreground">{fmtNumber(boqItem.quantity, 2)}</strong> {boqItem.unit}</span>
          <span className="text-border">·</span>
          <span>{t("pa.sellingPriceLabel", "سعر البيع:")} <strong className="text-primary font-bold">{fmtSAR(selling, language)}</strong></span>
          <Badge variant="outline" className="text-[10px]">
            {boqItem.is_included_elsewhere
              ? "مشمول في بند آخر"
              : Number(boqItem.manual_unit_price ?? 0) > 0
                ? "المصدر: سعر يدوي"
                : items.length > 0
                  ? "المصدر: تحليل الأسعار"
                  : boqItem.rate_source === "imported"
                    ? "المصدر: مستورد"
                    : "غير مسعّر"}
          </Badge>
          {Number(boqItem.manual_unit_price ?? 0) > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-amber-600"
              onClick={async () => {
                await clearManualPriceForBoqItem(boqItem.id);
                await qc.invalidateQueries({ queryKey: ["boq_items"] });
                toast.success("تم إلغاء السعر اليدوي والعودة إلى التحليل");
              }}
            >
              إلغاء السعر اليدوي
            </Button>
          )}
          {items.length === 0 && Number(boqItem.imported_unit_rate ?? 0) > 0 && boqItem.rate_source !== "imported" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-primary"
              onClick={async () => {
                await restoreImportedRateForBoqItem(boqItem.id);
                await qc.invalidateQueries({ queryKey: ["boq_items"] });
                toast.success("تمت استعادة السعر المستورد كمرجع نشط");
              }}
            >
              استعادة السعر المستورد ({fmtSAR(Number(boqItem.imported_unit_rate), language)})
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setQuoteDialogType("material");
              setQuoteDialogOpen(true);
            }}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            اختيار من عروض الأسعار
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {t("pa.addRow", "إضافة صف")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => addMut.mutate({ type: "material", materialCategory: "primary" })}>
                <span className="mr-2 h-2 w-2 rounded-full bg-chart-2" />
                مادة أساسية (Primary Material)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addMut.mutate({ type: "material", materialCategory: "accessory" })}>
                <span className="mr-2 h-2 w-2 rounded-full bg-amber-500" />
                إكسسوار / مستهلك (Accessory)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addMut.mutate("labor")}>
                <span className="mr-2 h-2 w-2 rounded-full bg-chart-3" />
                العمالة (Labor)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addMut.mutate("equipment")}>
                <span className="mr-2 h-2 w-2 rounded-full bg-primary" />
                المعدات (Equipment)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addMut.mutate("subcontractor")}>
                <span className="mr-2 h-2 w-2 rounded-full bg-chart-4" />
                مقاولو الباطن (Subcontractor)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setQuoteDialogOpen(true)}>
                <ShoppingBag className="mr-2 h-3.5 w-3.5 text-primary" />
                استدعاء من عروض الأسعار…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ImportPaDialog boqItemId={boqItem.id} />

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => exportPriceAnalysis(boqItem, items, markup ?? null)}
          >
            <Download className="h-3.5 w-3.5" />
            {t("common.exportExcel", "تصدير Excel")}
          </Button>
        </div>
      </div>

      {/* Sync warning if breakdown is empty (0) while BOQ still holds a stale stored cost */}
      {items.length === 0 &&
        (Number(boqItem.material_cost ?? 0) +
          Number(boqItem.labor_cost ?? 0) +
          Number(boqItem.equipment_cost ?? 0) +
          Number(boqItem.subcontractor_cost ?? 0)) > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs">
            <span className="text-amber-700 dark:text-amber-300 font-medium">
              البريك داون لهذا البند فارغ (0.00)، بينما يحتوي جدول الكميات على تكلفة سابقة (
              {fmtSAR(
                Number(boqItem.material_cost ?? 0) +
                  Number(boqItem.labor_cost ?? 0) +
                  Number(boqItem.equipment_cost ?? 0) +
                  Number(boqItem.subcontractor_cost ?? 0),
                language,
              )}
              ).
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-500/40"
              onClick={async () => {
                await syncBoqItemBreakdownFromPa(boqItem.id);
                await qc.invalidateQueries({ queryKey: ["boq_items"] });
                await qc.invalidateQueries({ queryKey: ["pa_items_project", projectId] });
                toast.success("تم تصفير ومزامنة تكلفة البند في جدول الكميات بنجاح");
              }}
            >
              تصفير تكلفة البند في جدول الكميات
            </Button>
          </div>
        )}

      {/* CSI Scope Conflict & Provenance Warnings (§4.3) */}
      {scopeAudit.warnings.length > 0 && (
        <div className="space-y-1 border-b border-border bg-muted/20 px-4 py-2 text-xs">
          {scopeAudit.warnings.map((w) => (
            <div
              key={w.code}
              className={cn(
                "flex items-center justify-between gap-2 rounded px-2.5 py-1",
                w.severity === "error"
                  ? "bg-destructive/15 text-destructive font-semibold"
                  : w.severity === "warning"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-300"
                    : "bg-primary/10 text-primary",
              )}
            >
              <span>{w.message_ar}</span>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {w.code}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* ══ Sheet ════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: totalW }} className="select-text">

          {/* ── Column header row (Excel-style bold header) ── */}
          <div
            className="sticky top-0 z-20 flex border-b-2 border-primary/40 bg-primary/15 backdrop-blur"
            style={{ minWidth: totalW }}
          >
            {cols.map((c) => (
              <div
                key={c.key}
                style={{ width: c.w, minWidth: c.w, position: "relative" }}
                className={cn(
                  CELL,
                  "py-2 text-[11px] font-bold text-primary border-l border-primary/30 whitespace-pre-line leading-tight",
                  c.align === "center" && "justify-center text-center",
                  c.align === "right"  && "justify-start  text-right",
                  c.align === "left"   && "justify-start  text-left",
                )}
              >
                {c.label}
                {c.key !== "__actions" && (
                  <span
                    onMouseDown={onColResizeStart(c.key, c.w)}
                    className="absolute inset-y-0 start-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/50"
                  />
                )}
              </div>
            ))}
          </div>

          {/* ── Main BOQ item header row (solid bold band, Excel navy equivalent) ── */}
          <div
            className="flex border-b-2 border-primary/50 bg-primary text-primary-foreground"
            style={{ minWidth: totalW }}
          >
            {/* Level (Item No) */}
            <div style={cw("level")}
              className={cn(CELL, "justify-center font-mono text-[11px] font-bold border-l-primary-foreground/20")}>
              {boqItem.item_no ?? "—"}
            </div>
            {/* Description (Single unified column) */}
            <div style={cw("description")}
              className={cn(CELL, "font-bold text-[12px] border-l-primary-foreground/20 justify-start text-right")}>
              <EditableCell
                value={boqItem.description_ar}
                onSave={(v) => updateBoqItemMut.mutate({ description_ar: v })}
                className="flex-1"
              >
                <div className="whitespace-pre-wrap break-words leading-snug">
                  {boqDescCombined}
                </div>
              </EditableCell>
            </div>
            {/* QTY */}
            <div style={cw("qty")}
              className={cn(CELL, "justify-center font-bold border-l-primary-foreground/20")}>
              {fmtNumber(boqItem.quantity, 2)}
            </div>
            {/* UOM */}
            <div style={cw("uom")}
              className={cn(CELL, "justify-center font-bold border-l-primary-foreground/20")}>
              {boqItem.unit ?? "—"}
            </div>
            {/* Rate (Direct Cost per Unit) */}
            <div style={cw("rate")}
              className={cn(CELL, "justify-center font-bold border-l-primary-foreground/20")}>
              {fmtNumber(directCost, 2)}
            </div>
            {/* Amount (Total Direct Cost = Qty * Direct Cost) */}
            <div style={cw("amount")}
              className={cn(CELL, "justify-center border-l-primary-foreground/20 font-bold text-[12px]")}
              title="إجمالي التكلفة المباشرة للبند = كمية المقايسة × التكلفة المباشرة للوحدة"
            >
              {fmtNumber(directCost * Number(boqItem.quantity ?? 0), 2)}
            </div>
            {/* Notes (Dedicated Notes column as last logical column after amount) */}
            <div style={cw("notes")}
              className={cn(CELL, "border-l-primary-foreground/20 justify-start text-right")}>
              <EditableCell
                value={boqNoteValue}
                onSave={(v) => updateBoqItemMut.mutate({ note: v })}
                className="flex-1"
              >
                <span className="block w-full whitespace-pre-wrap break-words text-[11px] opacity-90 truncate" title={boqNoteValue || "أضف ملاحظة للبند…"}>
                  {boqNoteValue || "—"}
                </span>
              </EditableCell>
            </div>
            {/* Actions placeholder */}
            <div style={cw("__actions")} className={cn(CELL, "border-l-0")} />
          </div>

          {/* ── Empty state with quick add buttons (Plan Section 3) ── */}
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="rounded-full bg-primary/10 p-4 ring-1 ring-primary/20">
                <Calculator className="h-8 w-8 text-primary" />
              </div>
              <div className="max-w-md space-y-1">
                <h3 className="text-base font-semibold text-foreground">البند غير مسعّر بعد</h3>
                <p className="text-xs text-muted-foreground">
                  أضف مكوّنات التكلفة المباشرة للبدء في تحليل سعر البند واشتقاق سعر البيع بعد هوامش الربح:
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs font-semibold"
                  onClick={() => addMut.mutate({ type: "material", materialCategory: "primary" })}
                >
                  <Plus className="h-3.5 w-3.5 text-chart-2" />
                  مادة أساسية
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs font-semibold"
                  onClick={() => addMut.mutate({ type: "material", materialCategory: "accessory" })}
                >
                  <Plus className="h-3.5 w-3.5 text-amber-500" />
                  إكسسوار / مستهلك
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs font-semibold"
                  onClick={() => addMut.mutate("labor")}
                >
                  <Plus className="h-3.5 w-3.5 text-chart-3" />
                  العمالة
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs font-semibold"
                  onClick={() => addMut.mutate("equipment")}
                >
                  <Plus className="h-3.5 w-3.5 text-primary" />
                  المعدات
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs font-semibold"
                  onClick={() => addMut.mutate("subcontractor")}
                >
                  <Plus className="h-3.5 w-3.5 text-chart-4" />
                  مقاولو الباطن
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 text-xs font-semibold"
                  onClick={() => {
                    setQuoteDialogType("material");
                    setQuoteDialogOpen(true);
                  }}
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  اختيار من عروض الأسعار
                </Button>
              </div>
            </div>
          )}

          {/* ── Resource Sections ── */}
          {TYPES.map((type) => {
            const lineCostWithSingleWaste = (i: PaItem) => {
              const qty = Number(i.quantity) || 0;
              const price = Number(i.unit_price) || 0;
              const waste = i.resource_type === "material" ? Number(i.waste_pct ?? 0) : 0;
              return qty * (1 + waste / 100) * price;
            };
            const sectionItems = items.filter((i) => i.resource_type === type);
            const subtotal     = sectionItems.reduce(
              (s, i) => s + lineCostWithSingleWaste(i), 0,
            );
            const isCollapsed  = collapsed.has(type);
            const isMaterial   = type === "material";

            // Material subcategories per plan §3 & §7: Primary vs Accessories
            const primaryItems   = isMaterial ? sectionItems.filter((i) => (i.cell_styles as any)?.material_category !== "accessory") : [];
            const accessoryItems = isMaterial ? sectionItems.filter((i) => (i.cell_styles as any)?.material_category === "accessory") : [];
            const primaryTotal   = primaryItems.reduce((s, i) => s + lineCostWithSingleWaste(i), 0);
            const accessoryTotal = accessoryItems.reduce((s, i) => s + lineCostWithSingleWaste(i), 0);

            const renderItemRow = (it: PaItem, idx: number) => {
              const cellStyles = ((it.cell_styles ?? {}) as CellStyles);
              const total      = lineCostWithSingleWaste(it);
              const noteVal    = (cellStyles as any)?.note ?? "";
              const isAccessory = (cellStyles as any)?.material_category === "accessory";

              return (
                <div
                  key={it.id}
                  className="group flex border-b border-border/40 hover:bg-muted/10 transition-colors"
                  style={{ minWidth: totalW, minHeight: 30 }}
                >
                  {/* Level */}
                  <div style={cw("level")}
                    className={cn(CELL, "justify-center text-[10px] text-muted-foreground/60 select-none")}>
                    {idx + 1}
                  </div>

                  {/* Description (Unified editable cell) */}
                  <div
                    className={cn(CELL, "gap-1.5", {
                      "font-bold": cellStyles["description"]?.bold,
                      "italic":    cellStyles["description"]?.italic,
                    })}
                    style={{
                      ...cw("description"),
                      fontSize:  cellStyles["description"]?.fontSize
                        ? `${cellStyles["description"].fontSize}px` : undefined,
                      textAlign: cellStyles["description"]?.align ?? "right",
                    }}
                  >
                    <EditableCell
                      value={it.description_ar}
                      onSave={(v) =>
                        updateMut.mutate({ id: it.id, patch: { description_ar: v || "—" } })
                      }
                      className="flex-1"
                    >
                      <span className="block w-full whitespace-pre-wrap break-words text-[11px]">
                        {it.description_ar}
                      </span>
                    </EditableCell>

                    {/* Scope & Quote Provenance Chip */}
                    {((it as any).scope_tag || (cellStyles as any)?.scope_tag) && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 text-muted-foreground">
                        {SCOPE_LABELS_AR[((it as any).scope_tag || (cellStyles as any)?.scope_tag) as AssemblyScopeTag] ??
                          ((it as any).scope_tag || (cellStyles as any)?.scope_tag)}
                      </Badge>
                    )}
                    {(cellStyles as any)?.quote_status === "expired" && (
                      <Badge variant="destructive" className="text-[9px] px-1 py-0 shrink-0">
                        منتهي
                      </Badge>
                    )}

                    {/* Inline Material Subcategory Toggle (Plan §3 & §7) */}
                    {isMaterial && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-primary gap-1 shrink-0"
                        title="نقر للتبديل بين مادة أساسية وإكسسوار"
                        onClick={() => toggleMaterialCategoryMut.mutate({ id: it.id, currentCat: isAccessory ? "accessory" : "primary" })}
                      >
                        <ArrowLeftRight className="h-2.5 w-2.5" />
                        <span className={cn("text-[9px] px-1 py-0.2 rounded font-medium", isAccessory ? "bg-amber-500/15 text-amber-600" : "bg-primary/10 text-primary")}>
                          {isAccessory ? "إكسسوار" : "أساسية"}
                        </span>
                      </Button>
                    )}

                    <FormatPopover
                      styles={cellStyles}
                      colKey="description"
                      onChange={(next) =>
                        updateMut.mutate({ id: it.id, patch: { cell_styles: next as unknown as never } })
                      }
                    />
                  </div>

                  {/* QTY (editable) */}
                  <EditableCell
                    value={String(it.quantity)}
                    onSave={(v) =>
                      updateMut.mutate({ id: it.id, patch: { quantity: Number(v) || 0 } })
                    }
                    className={cn(CELL, "justify-center")}
                    style={cw("qty")}
                  >
                    <span className="text-[11px]">{fmtNumber(it.quantity, 3)}</span>
                  </EditableCell>

                  {/* UOM (editable) */}
                  <EditableCell
                    value={it.unit}
                    onSave={(v) =>
                      updateMut.mutate({ id: it.id, patch: { unit: v || "وحدة" } })
                    }
                    className={cn(CELL, "justify-center text-muted-foreground")}
                    style={cw("uom")}
                  >
                    <span className="text-[11px]">{it.unit}</span>
                  </EditableCell>

                  {/* Rate (editable) */}
                  <EditableCell
                    value={String(it.unit_price)}
                    onSave={(v) =>
                      updateMut.mutate({ id: it.id, patch: { unit_price: Number(v) || 0 } })
                    }
                    className={cn(CELL, "justify-center")}
                    style={cw("rate")}
                  >
                    <span className="text-[11px]">{fmtNumber(it.unit_price, 2)}</span>
                  </EditableCell>

                  {/* Amount (computed, read-only) */}
                  <div
                    style={cw("amount")}
                    className={cn(CELL, "justify-center border-l-border/40 font-semibold text-foreground text-[11px]")}
                  >
                    {fmtNumber(total, 2)}
                  </div>

                  {/* Notes (Dedicated Component Note as LAST logical column after amount) */}
                  <div
                    className={cn(CELL, "gap-1")}
                    style={cw("notes")}
                  >
                    <EditableCell
                      value={noteVal}
                      onSave={(v) => {
                        const nextStyles = { ...cellStyles, note: v };
                        updateMut.mutate({ id: it.id, patch: { cell_styles: nextStyles as unknown as never } });
                      }}
                      className="flex-1"
                    >
                      <span className="block w-full whitespace-pre-wrap break-words text-[11px] text-muted-foreground truncate" title={noteVal}>
                        {noteVal || "—"}
                      </span>
                    </EditableCell>
                  </div>

                  {/* Actions */}
                  <div
                    style={cw("__actions")}
                    className={cn(CELL, "justify-center border-l-0 opacity-0 transition-opacity group-hover:opacity-100")}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMut.mutate(it.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            };

            return (
              <div key={type}>
                {/* Section header — Dual-language label + item count */}
                <div
                  onClick={() => toggleCollapse(type)}
                  className={cn(
                    "flex cursor-pointer select-none border-b border-border transition-colors",
                    SECTION_HEADER_CLS[type],
                  )}
                  style={{ minWidth: totalW }}
                >
                  <div style={cw("level")}
                    className={cn(CELL, "justify-center text-[11px] text-muted-foreground")}>
                    {isCollapsed
                      ? <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      : <ChevronDown  className="h-3.5 w-3.5 shrink-0" />}
                  </div>
                  <div style={cw("description")}
                    className={cn(CELL, "gap-2 text-[13px] font-bold justify-start text-right")}>
                    <span>{TYPE_LABEL[type]}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">({sectionItems.length})</span>
                  </div>
                  <div style={cw("qty")}   className={cn(CELL, "justify-center")} />
                  <div style={cw("uom")}   className={cn(CELL, "justify-center")} />
                  <div style={cw("rate")}  className={cn(CELL, "justify-center")} />
                  <div style={cw("amount")}
                    className={cn(CELL, "justify-center border-l-border/40 text-[12px] font-bold")}>
                    {subtotal > 0 ? fmtNumber(subtotal, 2) : ""}
                  </div>
                  <div style={cw("notes")} className={cn(CELL, "justify-start")} />
                  <div style={cw("__actions")} className={cn(CELL, "border-l-0")} />
                </div>

                {/* Component rows (with material subcategories if material) */}
                {!isCollapsed && (
                  <>
                    {isMaterial ? (
                      <>
                        {/* Sub-Group 1: المواد الأساسية (Primary Materials) */}
                        <div className="flex items-center justify-between px-4 py-1.5 bg-chart-2/10 border-b border-border/40 text-[11px] font-semibold text-chart-2" style={{ minWidth: totalW }}>
                          <span className="flex items-center gap-1.5">
                            <Layers className="h-3 w-3" />
                            مواد أساسية ({primaryItems.length})
                          </span>
                          <div className="flex items-center gap-3">
                            <span>المجموع الفرعي: {fmtSAR(primaryTotal)}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-2 text-[10px] text-chart-2 hover:bg-chart-2/20"
                              onClick={(e) => {
                                e.stopPropagation();
                                addMut.mutate({ type: "material", materialCategory: "primary" });
                              }}
                            >
                              <Plus className="h-3 w-3 me-1" /> إضافة مادة أساسية
                            </Button>
                          </div>
                        </div>
                        {primaryItems.map((it, idx) => renderItemRow(it, idx))}

                        {/* Sub-Group 2: إكسسوارات ومستهلكات (Accessories / Consumables) */}
                        <div className="flex items-center justify-between px-4 py-1.5 bg-amber-500/10 border-b border-border/40 text-[11px] font-semibold text-amber-600" style={{ minWidth: totalW }}>
                          <span className="flex items-center gap-1.5">
                            <Layers className="h-3 w-3" />
                            إكسسوارات ومستهلكات ({accessoryItems.length})
                          </span>
                          <div className="flex items-center gap-3">
                            <span>المجموع الفرعي: {fmtSAR(accessoryTotal)}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-2 text-[10px] text-amber-600 hover:bg-amber-500/20"
                              onClick={(e) => {
                                e.stopPropagation();
                                addMut.mutate({ type: "material", materialCategory: "accessory" });
                              }}
                            >
                              <Plus className="h-3 w-3 me-1" /> إضافة إكسسوار
                            </Button>
                          </div>
                        </div>
                        {accessoryItems.map((it, idx) => renderItemRow(it, idx))}
                      </>
                    ) : (
                      sectionItems.map((it, idx) => renderItemRow(it, idx))
                    )}
                  </>
                )}

                {/* Subtotal row */}
                {!isCollapsed && sectionItems.length > 0 && (
                  <div
                    className={cn("flex border-b text-[11px] font-semibold", SECTION_SUBTOTAL_CLS[type])}
                    style={{ minWidth: totalW }}
                  >
                    <div style={cw("level")}       className={cn(CELL, "justify-center")} />
                    <div style={cw("description")} className={cn(CELL, "justify-start text-right font-bold")}>
                      مجموع {TYPE_LABEL[type]}
                    </div>
                    <div style={cw("qty")}         className={cn(CELL, "justify-center")} />
                    <div style={cw("uom")}         className={cn(CELL, "justify-center")} />
                    <div style={cw("rate")}        className={cn(CELL, "justify-center")} />
                    <div style={cw("amount")}
                      className={cn(CELL, "justify-center border-l-border/40 font-bold")}>
                      {fmtNumber(subtotal, 2)}
                    </div>
                    <div style={cw("notes")}       className={cn(CELL, "justify-start")} />
                    <div style={cw("__actions")} className={cn(CELL, "border-l-0")} />
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Grand total (sticky bottom) ── */}
          {items.length > 0 && (
            <div
              className="sticky bottom-0 z-10 flex border-t-2 border-primary/40 bg-primary/10 text-[12px] font-bold backdrop-blur"
              style={{ minWidth: totalW }}
            >
              <div style={cw("level")} className={cn(CELL, "justify-center")} />
              <div
                style={{
                  width: (cols[1]?.w ?? 0) + (cols[2]?.w ?? 0) + (cols[3]?.w ?? 0) + (cols[4]?.w ?? 0),
                  minWidth: (cols[1]?.w ?? 0) + (cols[2]?.w ?? 0) + (cols[3]?.w ?? 0) + (cols[4]?.w ?? 0),
                }}
                className={cn(CELL, "justify-end text-primary")}
              >
                إجمالي التكلفة المباشرة للوحدة ({boqItem.unit ?? "وحدة"})
              </div>
              <div style={cw("amount")}
                className={cn(CELL, "justify-center border-l-0 text-primary")}>
                {fmtSAR(directCost)}
              </div>
              <div style={cw("notes")} className={cn(CELL, "border-l-0")} />
              <div style={cw("__actions")} className={cn(CELL, "border-l-0")} />
            </div>
          )}
        </div>
      </div>

      {/* ══ Markup footer (Phase 2 Unified Pricing Contract: 4 independent markups + ROUNDUP rate) ═════════ */}
      <div className="border-t border-border bg-secondary/30 px-4 py-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs tabular-nums md:grid-cols-4">
          <SumLine label={t("pa.directCostLabel", "التكلفة المباشرة")} value={fmtSAR(directCost, language)} />
          <MarkupLine label={t("pa.indirectLabel", "تكلفة غير مباشرة")} pct={indirect} value={indirectVal} field="indirect_pct" boqItemId={boqItem.id} markup={markup} projectId={projectId} lang={language} />
          <MarkupLine label={t("pa.overheadLabel", "مصاريف عامة")} pct={overhead} value={overheadVal} field="overhead_pct" boqItemId={boqItem.id} markup={markup} projectId={projectId} lang={language} />
          <MarkupLine label={t("pa.riskLabel", "المخاطر")} pct={risk} value={riskVal} field="risk_pct" boqItemId={boqItem.id} markup={markup} projectId={projectId} lang={language} />
          <MarkupLine label={t("pa.profitLabel", "الربح")} pct={profit} value={profitVal} field="profit_pct" boqItemId={boqItem.id} markup={markup} projectId={projectId} lang={language} />
          <SumLine label="سعر البيع الخام قبل التقريب" value={fmtSAR(rawSellingPrice, language)} />
          <SumLine label="أثر تقريب الفئة (ROUNDUP)" value={`+${fmtSAR(roundingDifference, language)}`} />
          <div className="col-span-2 md:col-span-4 mt-1 flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 ring-1 ring-primary/30">
            <span className="text-sm font-bold text-primary">فئة البيع المعتمدة لكل {boqItem.unit} (ROUNDUP)</span>
            <span className="text-lg font-bold tabular-nums text-primary">{fmtSAR(approvedRate, language)}</span>
          </div>
          <div className="col-span-2 flex items-center justify-between text-muted-foreground md:col-span-4">
            <span>{t("pa.totalForQty", "الإجمالي للكمية")} ({fmtNumber(boqItem.quantity, 2)} {boqItem.unit})</span>
            <span className="font-semibold text-foreground">
              {fmtSAR(approvedRate * Number(boqItem.quantity ?? 0), language)}
            </span>
          </div>
        </div>
      </div>

      <SelectQuoteDialog
        open={quoteDialogOpen}
        onOpenChange={setQuoteDialogOpen}
        boqItemId={boqItem.id}
        projectId={projectId}
        defaultType={quoteDialogType}
      />
    </div>
  );
}

function SumLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function MarkupLine({
  label, pct, value, field, boqItemId, markup, projectId, lang,
}: {
  label: string;
  pct: number;
  value: number;
  field: "indirect_pct" | "overhead_pct" | "risk_pct" | "profit_pct";
  boqItemId: string;
  markup: Markup | null | undefined;
  projectId: string | null;
  lang?: "ar" | "en";
}) {
  const qc  = useQueryClient();
  const mut = useMutation({
    mutationFn: async (newPct: number) => {
      const { data: u } = await estimationClient.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");
      if (markup) {
        const { error } = await estimationClient
          .from("price_analysis_markup")
          .update({ [field]: newPct } as Partial<Markup>)
          .eq("boq_item_id", boqItemId);
        if (error) throw error;
      } else {
        const { error } = await estimationClient.from("price_analysis_markup").insert({
          boq_item_id: boqItemId,
          user_id:     userId,
          project_id:  projectId,
          indirect_pct: field === "indirect_pct" ? newPct : 0,
          overhead_pct: field === "overhead_pct" ? newPct : 0,
          risk_pct:     field === "risk_pct"     ? newPct : 0,
          profit_pct:   field === "profit_pct"   ? newPct : 0,
        });
        if (error) throw error;
      }
      await syncBoqItemBreakdownFromPa(boqItemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pa_markup", boqItemId] });
      qc.invalidateQueries({ queryKey: ["pa_markup_project", projectId] });
      qc.invalidateQueries({ queryKey: ["boq_items"] });
    },
    onError:   (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {label}
        <Input
          type="number"
          step="0.5"
          defaultValue={pct}
          onBlur={(e) => { const v = Number(e.target.value); if (v !== pct) mut.mutate(v); }}
          className="h-6 w-14 px-1.5 text-center text-xs"
        />
        <span className="text-[10px] text-muted-foreground">%</span>
      </span>
      <span className="font-semibold text-foreground">{fmtSAR(value, lang)}</span>
    </div>
  );
}

function EditableCell({
  value,
  onSave,
  children,
  className,
  style,
}: {
  value: string;
  onSave: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <div className={className} style={style}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); if (draft !== value) onSave(draft); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
            if (e.key === "Escape")               { setDraft(value); setEditing(false); }
          }}
          className="w-full resize-none rounded border border-primary bg-background px-1.5 py-0.5 text-[11px] leading-tight outline-none focus:ring-1 focus:ring-primary"
          rows={Math.min(4, Math.max(1, draft.split("\n").length))}
        />
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className={cn("cursor-pointer rounded px-1 py-0.5 hover:bg-muted/40", className)}
      style={style}
      title="انقر للتحرير"
    >
      {children}
    </div>
  );
}

function FormatPopover({
  styles,
  colKey,
  onChange,
}: {
  styles: CellStyles;
  colKey: string;
  onChange: (s: CellStyles) => void;
}) {
  const st = styles[colKey] ?? {};
  const setBold = () =>
    onChange({ ...styles, [colKey]: { ...st, bold: !st.bold } });
  const setItalic = () =>
    onChange({ ...styles, [colKey]: { ...st, italic: !st.italic } });
  const setAlign = (align: "right" | "center" | "left") =>
    onChange({ ...styles, [colKey]: { ...st, align } });
  const setSize = (delta: number) => {
    const cur = st.fontSize ?? 11;
    onChange({ ...styles, [colKey]: { ...st, fontSize: Math.max(9, Math.min(18, cur + delta)) } });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100! text-muted-foreground p-0.5"
          title="تنسيق الخلية"
        >
          <span className="text-[10px] font-mono">Aa</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1.5" align="start">
        <div className="flex items-center gap-1 text-xs">
          <Button
            size="icon"
            variant={st.bold ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={setBold}
            title="عريض"
          >
            <Bold className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant={st.italic ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={setItalic}
            title="مائل"
          >
            <Italic className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            size="icon"
            variant={st.align === "right" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={() => setAlign("right")}
            title="محاذاة لليمين"
          >
            <AlignRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant={st.align === "center" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={() => setAlign("center")}
            title="توسيط"
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant={st.align === "left" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={() => setAlign("left")}
            title="محاذاة لليسار"
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-xs font-mono"
            onClick={() => setSize(-1)}
            title="تصغير الخط"
          >
            A-
          </Button>
          <span className="text-[10px] text-muted-foreground w-4 text-center font-mono">
            {st.fontSize ?? 11}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-xs font-mono"
            onClick={() => setSize(1)}
            title="تكبير الخط"
          >
            A+
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
