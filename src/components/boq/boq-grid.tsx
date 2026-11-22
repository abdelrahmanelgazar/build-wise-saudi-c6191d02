import { useEffect, useRef, useState, useMemo } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, TrendingUp, Trash2, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Globe } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";
import { useLanguage } from "@/lib/i18n";
import { getTextDirection } from "@/lib/text-direction";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
export type TreeNode = BoqRow & { children: TreeNode[]; rolledTotal: number; unitRate: number };

type CellStyles = Record<
  string,
  { bold?: boolean; italic?: boolean; align?: "right" | "center" | "left"; fontSize?: number }
>;

type FieldKey =
  | "item_no"
  | "description_ar"
  | "unit"
  | "quantity"
  | "material_cost"
  | "labor_cost"
  | "equipment_cost"
  | "subcontractor_cost"
  | "unit_rate"
  | "total";

type RawHeader = string | { label: string; field: FieldKey | null };

type Column = {
  key: string;
  label: string;
  width: number;
  align: "right" | "center" | "left";
  field: FieldKey | null;
  rawIdx: number | null;
};

const DEFAULT_FIELD_WIDTHS: Record<FieldKey, number> = {
  item_no: 80,
  description_ar: 340,
  unit: 70,
  quantity: 80,
  unit_rate: 110,
  total: 130,
  material_cost: 110,
  labor_cost: 110,
  equipment_cost: 110,
  subcontractor_cost: 110,
};

export function BoqGrid({
  flatRows,
  expanded,
  onToggle,
  onDelete,
  extraHeaders,
  projectId,
  grandTotal,
  onDeleteColumn,
}: {
  flatRows: { node: TreeNode; depth: number }[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onDelete: (n: TreeNode) => void;
  extraHeaders: RawHeader[];
  projectId: string;
  grandTotal?: number;
  onDeleteColumn?: (field: string) => void;
}) {
  const qc = useQueryClient();
  const { t, language, direction } = useLanguage();
  const storageKey = `boq-grid:${projectId}`;
  const rowHeightsKey = `boq-row-heights:${projectId}`;

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [rowHeights, setRowHeights] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(rowHeightsKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* Storage unavailable */ }
  }, [widths, storageKey]);
  useEffect(() => {
    try { localStorage.setItem(rowHeightsKey, JSON.stringify(rowHeights)); } catch { /* Storage unavailable */ }
  }, [rowHeights, rowHeightsKey]);

  const columns: Column[] = useMemo(() => {
    const defaultCols: Column[] = [
      { key: "item_no", label: t("boq.itemNo", "رقم البند"), width: 100, align: "right", field: "item_no", rawIdx: null },
      { key: "description_ar", label: t("common.description", "التوصيف"), width: 360, align: "right", field: "description_ar", rawIdx: null },
      { key: "unit", label: t("boq.unitCol", "الوحدة"), width: 70, align: "center", field: "unit", rawIdx: null },
      { key: "quantity", label: t("boq.quantityCol", "الكمية"), width: 90, align: "center", field: "quantity", rawIdx: null },
      { key: "unit_rate", label: t("boq.unitRateCol", "سعر الوحدة"), width: 130, align: "center", field: "unit_rate", rawIdx: null },
      { key: "total", label: t("boq.totalCol", "الإجمالي"), width: 150, align: "center", field: "total", rawIdx: null },
    ];

    let base: Column[];
    if (!extraHeaders || extraHeaders.length === 0) {
      base = defaultCols.map((c) => ({ ...c, width: widths[c.key] ?? c.width }));
    } else {
      base = extraHeaders.map((h, idx) => {
        const rawLabel = typeof h === "string" ? h : h.label;
        const field = typeof h === "string" ? null : h.field;
        const key = field ?? `extra_${idx}`;
        const defW = field ? DEFAULT_FIELD_WIDTHS[field] ?? 100 : 120;
        const align: "right" | "center" | "left" =
          field === "quantity" || field === "unit" ? "center" : "right";
        return {
          key,
          label: rawLabel,
          width: widths[key] ?? defW,
          align,
          field,
          rawIdx: field ? null : idx,
        };
      });
    }
    return [
      ...base,
      { key: "__actions", label: t("common.actions", "إجراءات"), width: widths["__actions"] ?? 70, align: "center", field: null, rawIdx: null },
    ];
  }, [widths, extraHeaders, t]);

  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const onResizeStart = (key: string, startW: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { key, startX: e.clientX, startW };
    const move = (ev: MouseEvent) => {
      const current = resizingRef.current;
      if (!current) return;
      const dx = (current.startX - ev.clientX) * (direction === "rtl" ? 1 : -1);
      const next = Math.max(40, current.startW + dx);
      setWidths((w) => ({ ...w, [current.key]: next }));
    };
    const up = () => {
      resizingRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const rowResizingRef = useRef<{ id: string; startY: number; startH: number } | null>(null);
  const onRowResizeStart = (id: string, currentH: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rowResizingRef.current = { id, startY: e.clientY, startH: currentH };
    const move = (ev: MouseEvent) => {
      const current = rowResizingRef.current;
      if (!current) return;
      const dy = ev.clientY - current.startY;
      const next = Math.max(24, Math.min(600, current.startH + dy));
      setRowHeights((m) => ({ ...m, [current.id]: next }));
    };
    const up = () => {
      rowResizingRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const updateMut = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<BoqRow> }) => {
      const { error } = await supabase.from("boq_items").update(vars.patch).eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boq_items"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  return (
    <div className="flex-1 overflow-auto rounded-lg border border-border bg-card">
      <div style={{ minWidth: totalWidth }} className="text-xs tabular-nums select-text">
        {/* Header */}
        <div className="sticky top-0 z-10 flex border-b border-border bg-muted/50 backdrop-blur">
          {columns.map((c) => (
            <div
              key={c.key}
              style={{ width: c.width, minWidth: c.width }}
              className={cn(
                "group/col relative flex items-center border-l border-border/40 px-2 py-2 text-[11px] font-semibold text-muted-foreground",
                c.align === "center" && "justify-center text-center",
                c.align === "left" && "justify-start text-left",
                c.align === "right" && "justify-end text-right",
              )}
            >
              <span className="whitespace-normal break-words leading-tight">{c.label}</span>
              {c.key !== "__actions" && (
                <span
                  onMouseDown={onResizeStart(c.key, c.width)}
                  className="absolute inset-y-0 start-0 w-1.5 cursor-col-resize hover:bg-primary/40"
                  title={t("boq.resizeCol", "اسحب لتغيير عرض العمود")}
                />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        {flatRows.length === 0 && (
          <div className="px-4 py-16 text-center text-muted-foreground">
            {t("boq.emptyState", "لا توجد بنود بعد. ابدأ بإضافة مجموعة ثم بنود تحتها، أو استورد ملف Excel.")}
          </div>
        )}
        {flatRows.map(({ node, depth }) => {
          const styles = ((node.cell_styles ?? {}) as CellStyles) || {};
          const isOpen = expanded.has(node.id);
          const raw = (node.raw_row as unknown[] | null) ?? [];
          const customH = rowHeights[node.id];

          return (
            <div
              key={node.id}
              style={customH ? { height: customH } : { minHeight: 32 }}
              className={cn(
                "group relative flex border-b border-border/60 transition-colors",
                node.is_group
                  ? "bg-secondary/40 font-semibold text-foreground"
                  : "hover:bg-muted/20",
              )}
            >
              {columns.map((c) => {
                const st = styles[c.key];
                const baseClass = cn(
                  "flex items-start gap-1 whitespace-normal break-words border-l border-border/40 px-2 py-1.5 overflow-hidden",
                  c.align === "center" && "justify-center text-center",
                  c.align === "left" && "justify-start text-left",
                  c.align === "right" && "justify-end text-right",
                  st?.bold && "font-bold",
                  st?.italic && "italic",
                );
                const styleAttr: React.CSSProperties = {
                  width: c.width,
                  minWidth: c.width,
                  fontSize: st?.fontSize ? `${st.fontSize}px` : undefined,
                  textAlign: st?.align ?? c.align,
                };

                return (
                  <CellRenderer
                    key={c.key}
                    col={c}
                    node={node}
                    depth={depth}
                    raw={raw}
                    styles={styles}
                    baseClass={baseClass}
                    styleAttr={styleAttr}
                    isOpen={isOpen}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    onPatch={(patch) => updateMut.mutate({ id: node.id, patch })}
                    language={language}
                    direction={direction}
                  />
                );
              })}
              <div
                onMouseDown={onRowResizeStart(node.id, customH ?? 32)}
                className="absolute inset-x-0 bottom-0 z-10 h-1 cursor-row-resize opacity-0 hover:bg-primary/50 group-hover:opacity-100"
                title={t("boq.resizeRow", "اسحب لتغيير ارتفاع الصف")}
              />
            </div>
          );
        })}
        {grandTotal !== undefined && (
          <div className="sticky bottom-0 z-10 flex border-t-2 border-border bg-muted/90 backdrop-blur font-bold text-foreground">
            {columns.map((c) => (
              <div
                key={c.key}
                style={{ width: c.width, minWidth: c.width }}
                className={cn(
                  "flex items-center px-2 py-2.5 text-[12px]",
                  c.align === "center" && "justify-center text-center",
                  c.align === "left" && "justify-start text-left",
                  c.align === "right" && "justify-end text-right",
                )}
              >
                {c.key === "description_ar" && t("common.grandTotal", "الإجمالي الكلي")}
                {c.key === "total" && grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CellRenderer({
  col,
  node,
  depth,
  raw,
  styles,
  baseClass,
  styleAttr,
  isOpen,
  onToggle,
  onDelete,
  onPatch,
  language,
  direction,
}: {
  col: Column;
  node: TreeNode;
  depth: number;
  raw: unknown[];
  styles: CellStyles;
  baseClass: string;
  styleAttr: React.CSSProperties;
  isOpen: boolean;
  onToggle: (id: string) => void;
  onDelete: (n: TreeNode) => void;
  onPatch: (patch: Partial<BoqRow>) => void;
  language: "ar" | "en";
  direction: "rtl" | "ltr";
}) {
  if (col.key === "__actions") {
    return (
      <div className={baseClass} style={styleAttr}>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(node)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  switch (col.field) {
    case "item_no":
      return (
        <EditableCell
          className={baseClass}
          style={styleAttr}
          value={node.item_no}
          onSave={(v) => onPatch({ item_no: v })}
          fixedLtr
        >
          <span className="font-mono text-[11px] text-muted-foreground">{node.item_no}</span>
        </EditableCell>
      );
    case "description_ar": {
      // Respect user's selected language:
      // In English mode, display description_en if present; fallback to description_ar with visual note only if description_ar is Arabic
      const isEn = language === "en";
      const hasEn = Boolean(node.description_en?.trim());
      const displayDesc = isEn ? (hasEn ? (node.description_en ?? node.description_ar) : node.description_ar) : node.description_ar;
      const textHasArabic = /[\u0600-\u06FF]/.test(node.description_ar || "");
      const isFallback = isEn && !hasEn && textHasArabic;

      return (
        <div className={baseClass} style={styleAttr}>
          <div
            className="flex w-full items-start gap-1.5"
            style={{ paddingInlineStart: `${depth * 16}px` }}
          >
            {node.is_group ? (
              <button
                onClick={() => onToggle(node.id)}
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : direction === "rtl" ? (
                  <ChevronLeft className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="inline-block w-5 shrink-0" />
            )}
            <EditableCell
              className="flex-1 min-w-0"
              style={{}}
              value={displayDesc}
              onSave={(v) => {
                if (isEn) {
                  onPatch({ description_en: v });
                } else {
                  onPatch({ description_ar: v });
                }
              }}
            >
              <div className="flex items-center gap-1.5 w-full">
                <span className="block w-full whitespace-pre-wrap break-words">{displayDesc}</span>
                {isFallback && (
                  <span
                    className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary"
                    title="هذا البند معروض بالعربية لعدم توفر ترجمة إنجليزية له"
                  >
                    AR
                  </span>
                )}
              </div>
            </EditableCell>
            <FormatPopover
              styles={styles}
              colKey={col.key}
              onChange={(next) => onPatch({ cell_styles: next as unknown as never })}
            />
          </div>
        </div>
      );
    }
    case "unit":
      return (
        <EditableCell
          className={baseClass}
          style={styleAttr}
          value={node.unit ?? ""}
          onSave={(v) => onPatch({ unit: v || null })}
        >
          <span className="text-muted-foreground">{node.unit ?? "—"}</span>
        </EditableCell>
      );
    case "quantity":
      return (
        <EditableCell
          className={baseClass}
          style={styleAttr}
          value={String(node.quantity ?? "")}
          onSave={(v) => onPatch({ quantity: Number(v) || 0 })}
          fixedLtr
        >
          <span>{node.is_group ? "—" : fmtNumber(node.quantity, 2)}</span>
        </EditableCell>
      );
    case "unit_rate":
      return (
        <div className={cn(baseClass, "bg-primary/5")} style={styleAttr}>
          {node.is_group ? (
            <span>—</span>
          ) : (
            <Link
              to="/price-analysis"
              search={{ item: node.id }}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              title="تحليل أسعار البند"
            >
              {fmtNumber(node.unitRate, 2)}
              <TrendingUp className="h-3 w-3 opacity-60" />
            </Link>
          )}
        </div>
      );
    case "total":
      return (
        <div className={cn(baseClass, "bg-primary/10 font-bold text-primary")} style={styleAttr}>
          {fmtNumber(node.rolledTotal, 2)}
        </div>
      );
    case "material_cost":
    case "labor_cost":
    case "equipment_cost":
    case "subcontractor_cost": {
      const v = Number((node[col.field] as number | null) ?? 0);
      return (
        <div className={baseClass} style={styleAttr}>
          <span className="text-foreground/80">{fmtNumber(v, 2)}</span>
        </div>
      );
    }
    default: {
      const v = col.rawIdx !== null ? raw?.[col.rawIdx] : "";
      return (
        <div className={baseClass} style={styleAttr}>
          <span className="block w-full whitespace-pre-wrap break-words text-foreground/80">
            {v === null || v === undefined ? "" : String(v)}
          </span>
        </div>
      );
    }
  }
}

function EditableCell({
  value,
  onSave,
  children,
  className,
  style,
  fixedLtr = false,
}: {
  value: string;
  onSave: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  fixedLtr?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { direction: appDir } = useLanguage();
  useEffect(() => setDraft(value), [value]);

  const cellDir = fixedLtr ? "ltr" : getTextDirection(draft, appDir) ?? appDir;

  if (editing) {
    return (
      <div className={className} style={style}>
        <textarea
          autoFocus
          dir={cellDir}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== value) onSave(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          className="h-full w-full resize-none bg-background px-1 text-xs outline-none ring-1 ring-primary"
          style={{
            direction: cellDir,
            textAlign: cellDir === "rtl" ? "right" : "left",
          }}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(className, "cursor-text")}
      style={{
        ...style,
        direction: cellDir,
        textAlign: cellDir === "rtl" ? "right" : cellDir === "ltr" ? "left" : undefined,
      }}
      onDoubleClick={() => setEditing(true)}
      title="انقر مرّتين للتحرير | Double-click to edit"
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
  onChange: (next: CellStyles) => void;
}) {
  const cur = styles[colKey] ?? {};
  const set = (patch: Partial<CellStyles[string]>) => {
    const next = { ...styles, [colKey]: { ...cur, ...patch } };
    onChange(next);
  };
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
      <PopoverContent className="w-auto p-1.5" align="end">
        <div className="flex items-center gap-0.5">
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.bold && "bg-muted")}
            onClick={() => set({ bold: !cur.bold })}
            title="عريض"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.italic && "bg-muted")}
            onClick={() => set({ italic: !cur.italic })}
            title="مائل"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-4 w-px bg-border" />
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.align === "right" && "bg-muted")}
            onClick={() => set({ align: "right" })}
            title="يمين"
          >
            <AlignRight className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.align === "center" && "bg-muted")}
            onClick={() => set({ align: "center" })}
            title="وسط"
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.align === "left" && "bg-muted")}
            onClick={() => set({ align: "left" })}
            title="يسار"
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-4 w-px bg-border" />
          <select
            value={cur.fontSize ?? 12}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="rounded border border-border bg-background px-1 py-0.5 text-xs"
            title="حجم الخط"
          >
            {[10, 11, 12, 13, 14, 16, 18, 20].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
