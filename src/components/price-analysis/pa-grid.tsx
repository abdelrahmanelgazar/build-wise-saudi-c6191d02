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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtNumber, fmtSAR } from "@/lib/format";
import { toast } from "sonner";
import { useActiveProjectId } from "@/lib/active-project";
import type { Database } from "@/integrations/supabase/types";
import { ImportPaDialog } from "./import-pa-dialog";
import { exportPriceAnalysis } from "@/lib/pa-export";
import { useLanguage } from "@/lib/i18n";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
type PaItem = Database["public"]["Tables"]["price_analysis_items"]["Row"];
type Markup = Database["public"]["Tables"]["price_analysis_markup"]["Row"];
type ResourceType = Database["public"]["Enums"]["resource_type"];

// ─── Labels ──────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<ResourceType, string> = {
  material: "مواد",
  labor: "عمالة",
  equipment: "معدات",
  subcontractor: "مقاول باطن",
};

// ─── Platform-native colour tokens per section ───────────────────────────────
// Excel-like layout: bold section headers without coloured bands; a thin left
// bar keeps the type accent on-brand, and subtotals use a neutral muted tint.
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

// ─── Cell-style type (rich-text per cell) ────────────────────────────────────
type CellStyles = Record<
  string,
  { bold?: boolean; italic?: boolean; align?: "right" | "center" | "left"; fontSize?: number }
>;

// ─── Type-code abbreviations used in hierarchical task codes ─────────────────
const TYPE_CODE: Record<ResourceType, string> = {
  material:      "MA",
  labor:         "MP",
  equipment:     "EQ",
  subcontractor: "SUB",
};

// ─── Column definitions ───────────────────────────────────────────────────────
type Col = { key: string; label: string; defaultW: number; align: "center" | "left" | "right" };

const COLS: Col[] = [
  { key: "level",          label: "رقم البند",           defaultW: 70,  align: "center" },
  { key: "description_en", label: "Description",    defaultW: 320, align: "left"   },
  { key: "description",    label: "التوصيف",        defaultW: 320, align: "right"  },
  { key: "qty",            label: "الكمية",            defaultW: 70,  align: "center" },
  { key: "uom",            label: "وحدة القياس",           defaultW: 70,  align: "center" },
  { key: "rate",           label: "التكلفة المباشرة",      defaultW: 110, align: "center" },
  { key: "amount",         label: "اجمالي تكلفة البند",    defaultW: 140, align: "center" },
  { key: "__actions",      label: "",               defaultW: 48,  align: "center" },
];

// ─── Shared cell base class ───────────────────────────────────────────────────
const CELL = "flex shrink-0 items-center overflow-hidden border-l border-border/40 px-2 py-[5px] text-[11px] tabular-nums";

export function PaGrid({ boqItem }: { boqItem: BoqRow }) {
  const qc        = useQueryClient();
  const projectId = useActiveProjectId();
  const { t, language } = useLanguage();
  const storageKey = `pa-grid-v2-widths:${boqItem.id}`;

  // ── Column widths (persisted) ──────────────────────────────────────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}"); }
    catch { return {}; }
  });
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(colWidths));
  }, [colWidths, storageKey]);

  const cols = useMemo(() => {
    const isEn = language === "en";
    const rawCols: Col[] = [
      { key: "level",          label: t("pa.colItemNo", "رقم البند"),      defaultW: 70,  align: "center" },
      { key: "description_en", label: isEn ? t("common.description", "Description") : "Description (EN)",    defaultW: 320, align: "left"   },
      { key: "description",    label: isEn ? "التوصيف (عربي)" : t("common.description", "التوصيف"), defaultW: 320, align: "right"  },
      { key: "qty",            label: t("common.quantity", "الكمية"),   defaultW: 70,  align: "center" },
      { key: "uom",            label: t("common.unit", "وحدة القياس"),       defaultW: 70,  align: "center" },
      { key: "rate",           label: t("common.directCost", "التكلفة المباشرة"), defaultW: 110, align: "center" },
      { key: "amount",         label: t("pa.itemTotalCost", "اجمالي تكلفة البند"),  defaultW: 140, align: "center" },
      { key: "__actions",      label: "",                     defaultW: 48,  align: "center" },
    ];
    return rawCols.map((c) => ({ ...c, w: colWidths[c.key] ?? c.defaultW }));
  }, [colWidths, t, language]);
  const totalW = cols.reduce((s, c) => s + c.w, 0);

  // ── Collapsed sections ─────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Set<ResourceType>>(new Set());
  const toggleCollapse = (t: ResourceType) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: items = [] } = useQuery({
    queryKey: ["pa_items", boqItem.id],
    queryFn: async () => {
      const { data, error } = await supabase
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
      const { data, error } = await supabase
        .from("price_analysis_markup")
        .select("*")
        .eq("boq_item_id", boqItem.id)
        .maybeSingle();
      if (error) throw error;
      return data as Markup | null;
    },
  });

  // ── Markup calc ────────────────────────────────────────────────────────────
  const directCost  = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const indirect    = Number(markup?.indirect_pct ?? 0);
  const overhead    = Number(markup?.overhead_pct ?? 0);
  const risk        = Number(markup?.risk_pct ?? 0);
  const profit      = Number(markup?.profit_pct ?? 0);
  const indirectVal = (directCost * indirect) / 100;
  const s1          = directCost + indirectVal;
  const overheadVal = (s1 * overhead) / 100;
  const s2          = s1 + overheadVal;
  const riskVal     = (s2 * risk) / 100;
  const s3          = s2 + riskVal;
  const profitVal   = (s3 * profit) / 100;
  const selling     = s3 + profitVal;

  // ── Column resize ──────────────────────────────────────────────────────────
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

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateMut = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<PaItem> }) => {
      const { error } = await supabase
        .from("price_analysis_items").update(vars.patch).eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] }),
    onError:   (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("price_analysis_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] }),
  });

  const addMut = useMutation({
    mutationFn: async (type: ResourceType) => {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");
      const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0);
      const { error } = await supabase.from("price_analysis_items").insert({
        boq_item_id:   boqItem.id,
        user_id:       userId,
        project_id:    projectId,
        resource_type: type,
        description_ar: "بند جديد",
        unit:          "وحدة",
        quantity:      1,
        unit_price:    0,
        sort_order:    maxSort + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] }),
    onError:   (e: Error) => toast.error(e.message),
  });

  // ── Helper: col width object ───────────────────────────────────────────────
  const cw = (key: string) => {
    const c = cols.find((x) => x.key === key);
    if (!c) return { width: 0, minWidth: 0 };
    return { width: c.w, minWidth: c.w };
  };

  const TYPES: ResourceType[] = ["material", "labor", "equipment", "subcontractor"];

  // ── Render ─────────────────────────────────────────────────────────────────
  const typeLabels: Record<ResourceType, string> = {
    material: t("pa.materials", "مواد"),
    labor: t("pa.labour", "عمالة"),
    equipment: t("pa.equipment", "معدات"),
    subcontractor: t("pa.subcontractor", "مقاول باطن"),
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ══ Toolbar ══════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono font-semibold text-primary">
            {boqItem.item_no}
          </span>
          <span className="truncate max-w-xs">{language === "en" && boqItem.description_en ? boqItem.description_en : boqItem.description_ar}</span>
          <span className="text-border">·</span>
          <span>{t("pa.quantityLabel", "الكمية:")} <strong className="text-foreground">{fmtNumber(boqItem.quantity, 2)}</strong> {boqItem.unit}</span>
          <span className="text-border">·</span>
          <span>{t("pa.sellingPriceLabel", "سعر البيع:")} <strong className="text-primary">{fmtSAR(selling, language)}</strong></span>
        </div>

        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {t("pa.addRow", "إضافة صف")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {TYPES.map((t) => (
                <DropdownMenuItem key={t} onClick={() => addMut.mutate(t)}>
                  <span className={cn("mr-2 h-2 w-2 rounded-full", {
                    "bg-chart-2":  t === "material",
                    "bg-chart-3":  t === "labor",
                    "bg-primary":  t === "equipment",
                    "bg-chart-4":  t === "subcontractor",
                  })} />
                  {typeLabels[t]}
                </DropdownMenuItem>
              ))}
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
                    className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/50"
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
            {/* Description EN */}
            <div style={cw("description_en")}
              className={cn(CELL, "font-bold text-[12px] border-l-primary-foreground/20 justify-start text-left")} dir="ltr">
              {(boqItem as BoqRow & { description_en?: string | null }).description_en ?? ""}
            </div>
            {/* Description AR */}
            <div style={cw("description")}
              className={cn(CELL, "font-bold text-[12px] border-l-primary-foreground/20 justify-start text-right")}>
              {boqItem.description_ar}
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
            {/* Rate */}
            <div style={cw("rate")}
              className={cn(CELL, "justify-center font-bold border-l-primary-foreground/20")}>
              {fmtNumber(directCost, 2)}
            </div>
            {/* Amount */}
            <div style={cw("amount")}
              className={cn(CELL, "justify-center border-l-0 font-bold text-[12px]")}>
              {fmtNumber(directCost * Number(boqItem.quantity ?? 0), 2)}
            </div>
            {/* Actions placeholder */}
            <div style={cw("__actions")} className={cn(CELL, "border-l-0")} />
          </div>

          {/* ── Empty state ── */}
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
              <div className="text-5xl opacity-20">📋</div>
              <p className="text-sm">لا توجد بنود — أضف صفوفاً أو استورد من Excel.</p>
            </div>
          )}

          {/* ── Sections ── */}
          {TYPES.map((type) => {
            const sectionItems = items.filter((i) => i.resource_type === type);
            const subtotal     = sectionItems.reduce(
              (s, i) => s + Number(i.quantity) * Number(i.unit_price), 0,
            );
            const isCollapsed  = collapsed.has(type);

            return (
              <div key={type}>

                {/* Section header — Excel-style bold (size 14) without colour band */}
                <div
                  onClick={() => toggleCollapse(type)}
                  className={cn(
                    "flex cursor-pointer select-none border-b border-border transition-colors",
                    SECTION_HEADER_CLS[type],
                  )}
                  style={{ minWidth: totalW }}
                >
                  {/* Level (with collapse icon) */}
                  <div style={cw("level")}
                    className={cn(CELL, "justify-center text-[11px] text-muted-foreground")}>
                    {isCollapsed
                      ? <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      : <ChevronDown  className="h-3.5 w-3.5 shrink-0" />}
                  </div>
                  {/* Description EN (section label, left-aligned) */}
                  <div style={cw("description_en")}
                    className={cn(CELL, "gap-1.5 text-[13px] font-bold justify-start text-left")} dir="ltr">
                    {type === "material" ? "Materials" : type === "labor" ? "Labour" : type === "equipment" ? "Equipment" : "Subcontractor"}
                    <span className="text-[10px] font-normal text-muted-foreground">({sectionItems.length})</span>
                  </div>
                  {/* Description AR */}
                  <div style={cw("description")}
                    className={cn(CELL, "gap-1.5 text-[13px] font-bold justify-start text-right")}>
                    {TYPE_LABEL[type]}
                  </div>
                  {/* QTY */}
                  <div style={cw("qty")}   className={cn(CELL, "justify-center")} />
                  {/* UOM */}
                  <div style={cw("uom")}   className={cn(CELL, "justify-center")} />
                  {/* Rate */}
                  <div style={cw("rate")}  className={cn(CELL, "justify-center")} />
                  {/* Amount (section subtotal preview) */}
                  <div style={cw("amount")}
                    className={cn(CELL, "justify-center border-l-0 text-[12px] font-bold")}>
                    {subtotal > 0 ? fmtNumber(subtotal, 2) : ""}
                  </div>
                  {/* Actions */}
                  <div style={cw("__actions")} className={cn(CELL, "border-l-0")} />
                </div>

                {/* Item rows */}
                {!isCollapsed && sectionItems.map((it, idx) => {
                  const cellStyles = ((it.cell_styles ?? {}) as CellStyles);
                  const total      = Number(it.quantity) * Number(it.unit_price);

                  return (
                    <div
                      key={it.id}
                      className="group flex border-b border-border/40 hover:bg-muted/10"
                      style={{ minWidth: totalW, minHeight: 30 }}
                    >
                      {/* Level */}
                      <div style={cw("level")}
                        className={cn(CELL, "justify-center text-[10px] text-muted-foreground/60 select-none")}>
                        {idx + 1}
                      </div>

                      {/* Description EN (editable) */}
                      <div
                        className={cn(CELL, "gap-1")}
                        style={{ ...cw("description_en"), textAlign: "left" }}
                        dir="ltr"
                      >
                        <EditableCell
                          value={(it as PaItem & { description_en?: string | null }).description_en ?? ""}
                          onSave={(v) =>
                            updateMut.mutate({ id: it.id, patch: { description_en: v } as Partial<PaItem> })
                          }
                          className="flex-1"
                        >
                          <span className="block w-full whitespace-pre-wrap break-words text-[11px] text-left">
                            {(it as PaItem & { description_en?: string | null }).description_en ?? ""}
                          </span>
                        </EditableCell>
                      </div>

                      {/* Description AR (editable) */}
                      <div
                        className={cn(CELL, "gap-1", {
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
                        className={cn(CELL, "justify-center border-l-0 font-semibold text-foreground text-[11px]")}
                      >
                        {fmtNumber(total, 2)}
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
                })}

                {/* Subtotal row */}
                {!isCollapsed && sectionItems.length > 0 && (
                  <div
                    className={cn("flex border-b text-[11px] font-semibold", SECTION_SUBTOTAL_CLS[type])}
                    style={{ minWidth: totalW }}
                  >
                    <div style={cw("level")}          className={cn(CELL, "justify-center")} />
                    <div style={cw("description_en")} className={cn(CELL, "justify-start text-left font-bold")} dir="ltr">
                      Total {type === "material" ? "Materials" : type === "labor" ? "Labour" : type === "equipment" ? "Equipment" : "Subcontractor"}
                    </div>
                    <div style={cw("description")}    className={cn(CELL, "justify-start text-right font-bold")}>
                      مجموع {TYPE_LABEL[type]}
                    </div>
                    <div style={cw("qty")}            className={cn(CELL, "justify-center")} />
                    <div style={cw("uom")}            className={cn(CELL, "justify-center")} />
                    <div style={cw("rate")}           className={cn(CELL, "justify-center")} />
                    <div style={cw("amount")}
                      className={cn(CELL, "justify-center border-l-0 font-bold")}>
                      {fmtNumber(subtotal, 2)}
                    </div>
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
              <div style={cw("level")}      className={cn(CELL, "justify-center")} />
              <div
                style={{ width: (cols[1]?.w ?? 0) + (cols[2]?.w ?? 0) + (cols[3]?.w ?? 0) + (cols[4]?.w ?? 0) + (cols[5]?.w ?? 0),
                         minWidth: (cols[1]?.w ?? 0) + (cols[2]?.w ?? 0) + (cols[3]?.w ?? 0) + (cols[4]?.w ?? 0) + (cols[5]?.w ?? 0) }}
                className={cn(CELL, "justify-end text-primary")}
              >
                إجمالي التكلفة المباشرة للوحدة ({boqItem.unit ?? "وحدة"})
              </div>
              <div style={cw("amount")}
                className={cn(CELL, "justify-center border-l-0 text-primary")}>
                {fmtSAR(directCost)}
              </div>
              <div style={cw("__actions")} className={cn(CELL, "border-l-0")} />
            </div>
          )}
        </div>
      </div>

      {/* ══ Markup footer ════════════════════════════════════════════════════ */}
      <div className="border-t border-border bg-secondary/30 px-4 py-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs tabular-nums md:grid-cols-3">
          <SumLine label={t("pa.directCostLabel", "التكلفة المباشرة")} value={fmtSAR(directCost, language)} />
          <MarkupLine label={t("pa.indirectLabel", "غير مباشرة")}  pct={indirect} value={indirectVal} field="indirect_pct" boqItemId={boqItem.id} markup={markup} projectId={projectId} lang={language} />
          <MarkupLine label={t("pa.overheadLabel", "مصاريف عامة")} pct={overhead}  value={overheadVal} field="overhead_pct"  boqItemId={boqItem.id} markup={markup} projectId={projectId} lang={language} />
          <MarkupLine label={t("pa.riskLabel", "المخاطر")}     pct={risk}      value={riskVal}     field="risk_pct"      boqItemId={boqItem.id} markup={markup} projectId={projectId} lang={language} />
          <MarkupLine label={t("pa.profitLabel", "الربح")}       pct={profit}    value={profitVal}   field="profit_pct"    boqItemId={boqItem.id} markup={markup} projectId={projectId} lang={language} />
          <div className="col-span-2 md:col-span-3 mt-1 flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 ring-1 ring-primary/30">
            <span className="text-sm font-bold text-primary">{t("pa.sellingPricePer", "سعر البيع لكل")} {boqItem.unit}</span>
            <span className="text-lg font-bold tabular-nums text-primary">{fmtSAR(selling, language)}</span>
          </div>
          <div className="col-span-2 flex items-center justify-between text-muted-foreground md:col-span-3">
            <span>{t("pa.totalForQty", "الإجمالي للكمية")} ({fmtNumber(boqItem.quantity, 2)} {boqItem.unit})</span>
            <span className="font-semibold text-foreground">
              {fmtSAR(selling * Number(boqItem.quantity ?? 0), language)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SumLine ─────────────────────────────────────────────────────────────────
function SumLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

// ─── MarkupLine ───────────────────────────────────────────────────────────────
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
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");
      if (markup) {
        const { error } = await supabase
          .from("price_analysis_markup")
          .update({ [field]: newPct } as Partial<Markup>)
          .eq("boq_item_id", boqItemId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("price_analysis_markup").insert({
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
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pa_markup", boqItemId] }),
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

// ─── EditableCell ─────────────────────────────────────────────────────────────
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
          className="h-full w-full resize-none bg-background px-1 text-[11px] outline-none ring-1 ring-primary"
          style={{ direction: "inherit", textAlign: "inherit" }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(className, "cursor-text")}
      style={style}
      onDoubleClick={() => setEditing(true)}
      title="انقر مرّتين للتحرير"
    >
      {children}
    </div>
  );
}

// ─── FormatPopover ────────────────────────────────────────────────────────────
function FormatPopover({
  styles,
  colKey,
  onChange,
}: {
  styles: CellStyles;
  colKey: string;
  onChange: (next: CellStyles) => void;
}) {
  const cur = styles[colKey] ?? {};
  const set = (patch: Partial<CellStyles[string]>) =>
    onChange({ ...styles, [colKey]: { ...cur, ...patch } });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="invisible h-5 w-5 shrink-0 rounded text-muted-foreground hover:bg-muted hover:text-foreground group-hover:visible"
          onClick={(e) => e.stopPropagation()}
          title="تنسيق النص"
        >
          <Bold className="mx-auto h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1.5" align="end" dir="rtl">
        <div className="flex items-center gap-0.5">
          <button className={cn("rounded p-1 hover:bg-muted", cur.bold   && "bg-muted")} onClick={() => set({ bold:   !cur.bold   })}><Bold   className="h-3.5 w-3.5" /></button>
          <button className={cn("rounded p-1 hover:bg-muted", cur.italic && "bg-muted")} onClick={() => set({ italic: !cur.italic })}><Italic className="h-3.5 w-3.5" /></button>
          <div className="mx-1 h-4 w-px bg-border" />
          <button className={cn("rounded p-1 hover:bg-muted", cur.align === "right"  && "bg-muted")} onClick={() => set({ align: "right"  })}><AlignRight  className="h-3.5 w-3.5" /></button>
          <button className={cn("rounded p-1 hover:bg-muted", cur.align === "center" && "bg-muted")} onClick={() => set({ align: "center" })}><AlignCenter className="h-3.5 w-3.5" /></button>
          <button className={cn("rounded p-1 hover:bg-muted", cur.align === "left"   && "bg-muted")} onClick={() => set({ align: "left"   })}><AlignLeft   className="h-3.5 w-3.5" /></button>
          <div className="mx-1 h-4 w-px bg-border" />
          <select
            value={cur.fontSize ?? 12}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="rounded border border-border bg-background px-1 py-0.5 text-xs"
          >
            {[10, 11, 12, 13, 14, 16, 18, 20].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
