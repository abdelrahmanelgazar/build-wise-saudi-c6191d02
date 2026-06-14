import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, TrendingUp, Trash2, Bold, Italic, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
export type TreeNode = BoqRow & { children: TreeNode[]; rolledTotal: number; unitRate: number };

type CellStyles = Record<
  string,
  { bold?: boolean; italic?: boolean; align?: "right" | "center" | "left"; fontSize?: number }
>;

const BUILTIN_KEYS = ["item_no", "description_ar", "unit", "quantity", "unit_rate", "total"] as const;

const BUILTIN_LABELS: Record<(typeof BUILTIN_KEYS)[number], string> = {
  item_no: "رقم البند",
  description_ar: "الوصف",
  unit: "الوحدة",
  quantity: "الكمية",
  unit_rate: "سعر الوحدة",
  total: "الإجمالي",
};

const BUILTIN_DEFAULT_WIDTH: Record<(typeof BUILTIN_KEYS)[number], number> = {
  item_no: 100,
  description_ar: 360,
  unit: 70,
  quantity: 90,
  unit_rate: 130,
  total: 150,
};

export function BoqGrid({
  flatRows,
  expanded,
  onToggle,
  onDelete,
  extraHeaders,
  projectId,
}: {
  flatRows: { node: TreeNode; depth: number }[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onDelete: (n: TreeNode) => void;
  extraHeaders: string[];
  projectId: string;
}) {
  const qc = useQueryClient();
  const storageKey = `boq-grid:${projectId}`;
  const rowHeightsKey = `boq-row-heights:${projectId}`;

  // Column widths persisted to localStorage
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  // Per-row heights persisted to localStorage. 0/undefined => auto (wrap)
  const [rowHeights, setRowHeights] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(rowHeightsKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [widths, storageKey]);
  useEffect(() => {
    localStorage.setItem(rowHeightsKey, JSON.stringify(rowHeights));
  }, [rowHeights, rowHeightsKey]);

  const columns: { key: string; label: string; width: number; align?: "right" | "center" | "left" }[] = useMemo(() => {
    const built = BUILTIN_KEYS.map((k) => ({
      key: k as string,
      label: BUILTIN_LABELS[k],
      width: widths[k] ?? BUILTIN_DEFAULT_WIDTH[k],
      align:
        k === "description_ar" || k === "item_no"
          ? ("right" as const)
          : k === "unit"
            ? ("center" as const)
            : ("left" as const),
    }));
    const extras = extraHeaders.map((h, i) => {
      const key = `extra_${i}`;
      return { key, label: h || `عمود ${i + 1}`, width: widths[key] ?? 130, align: "right" as const };
    });
    return [...built, ...extras, { key: "__actions", label: "إجراءات", width: widths["__actions"] ?? 80, align: "center" as const }];
  }, [widths, extraHeaders]);

  // Column resize handlers
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const onResizeStart = (key: string, startW: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { key, startX: e.clientX, startW };
    const move = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const dx = resizingRef.current.startX - ev.clientX; // RTL: dragging left grows width
      const next = Math.max(40, resizingRef.current.startW + dx);
      setWidths((w) => ({ ...w, [resizingRef.current!.key]: next }));
    };
    const up = () => {
      resizingRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Per-row resize handle
  const rowResizingRef = useRef<{ id: string; startY: number; startH: number } | null>(null);
  const onRowResizeStart = (id: string, currentH: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rowResizingRef.current = { id, startY: e.clientY, startH: currentH };
    const move = (ev: MouseEvent) => {
      if (!rowResizingRef.current) return;
      const dy = ev.clientY - rowResizingRef.current.startY;
      const next = Math.max(24, Math.min(400, rowResizingRef.current.startH + dy));
      setRowHeights((m) => ({ ...m, [rowResizingRef.current!.id]: next }));
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
              key={String(c.key)}
              style={{ width: c.width, minWidth: c.width }}
              className={cn(
                "relative flex items-center px-2 py-2 text-[11px] font-semibold uppercase text-muted-foreground",
                c.align === "center" && "justify-center",
                c.align === "left" && "justify-start",
                c.align === "right" && "justify-end",
              )}
            >
              <span className="truncate">{c.label}</span>
              {c.key !== "__actions" && (
                <span
                  onMouseDown={onResizeStart(String(c.key), c.width)}
                  className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-primary/40"
                  title="اسحب لتغيير عرض العمود"
                />
              )}
            </div>
          ))}
          {/* Row-height drag in the corner */}
          <div
            onMouseDown={onRowResizeStart}
            className="absolute bottom-0 right-2 h-1.5 w-10 cursor-row-resize rounded-full bg-border hover:bg-primary/40"
            title="اسحب لتغيير ارتفاع الصفوف"
          />
        </div>

        {/* Body */}
        {flatRows.length === 0 && (
          <div className="px-4 py-16 text-center text-muted-foreground">
            لا توجد بنود بعد. ابدأ بإضافة مجموعة ثم بنود تحتها، أو استورد ملف Excel.
          </div>
        )}
        {flatRows.map(({ node, depth }) => {
          const styles = ((node.cell_styles ?? {}) as CellStyles) || {};
          const isOpen = expanded.has(node.id);
          const raw = (node.raw_row as unknown[] | null) ?? [];

          return (
            <div
              key={node.id}
              style={{ minHeight: rowHeight }}
              className={cn(
                "flex border-b border-border/60 transition-colors",
                node.is_group
                  ? "bg-secondary/40 font-semibold text-foreground"
                  : "hover:bg-muted/20",
              )}
            >
              {columns.map((c) => {
                const colKey = String(c.key);
                const st = styles[colKey];
                const baseClass = cn(
                  "flex items-center gap-1 border-l border-border/40 px-2 py-1.5",
                  c.align === "center" && "justify-center",
                  c.align === "left" && "justify-start",
                  c.align === "right" && "justify-end",
                  st?.bold && "font-bold",
                  st?.italic && "italic",
                );
                const styleAttr: React.CSSProperties = {
                  width: c.width,
                  minWidth: c.width,
                  fontSize: st?.fontSize ? `${st.fontSize}px` : undefined,
                  textAlign: st?.align ?? (c.align as "right" | "center" | "left"),
                };

                if (c.key === "item_no") {
                  return (
                    <EditableCell
                      key={colKey}
                      className={baseClass}
                      style={styleAttr}
                      value={node.item_no}
                      onSave={(v) => updateMut.mutate({ id: node.id, patch: { item_no: v } })}
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">{node.item_no}</span>
                    </EditableCell>
                  );
                }
                if (c.key === "description_ar") {
                  return (
                    <div key={colKey} className={baseClass} style={styleAttr}>
                      <div
                        className="flex w-full items-center gap-1.5"
                        style={{ paddingInlineStart: `${depth * 16}px` }}
                      >
                        {node.is_group ? (
                          <button
                            onClick={() => onToggle(node.id)}
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronLeft className="h-3.5 w-3.5" />
                            )}
                          </button>
                        ) : (
                          <span className="inline-block w-5" />
                        )}
                        <EditableCell
                          className="flex-1"
                          style={{}}
                          value={node.description_ar}
                          onSave={(v) => updateMut.mutate({ id: node.id, patch: { description_ar: v } })}
                        >
                          <span className="block w-full truncate">{node.description_ar}</span>
                        </EditableCell>
                        <FormatPopover
                          styles={styles}
                          colKey={colKey}
                          onChange={(next) =>
                            updateMut.mutate({ id: node.id, patch: { cell_styles: next as unknown as never } })
                          }
                        />
                      </div>
                    </div>
                  );
                }
                if (c.key === "unit") {
                  return (
                    <EditableCell
                      key={colKey}
                      className={baseClass}
                      style={styleAttr}
                      value={node.unit ?? ""}
                      onSave={(v) => updateMut.mutate({ id: node.id, patch: { unit: v || null } })}
                    >
                      <span className="text-muted-foreground">{node.unit ?? "—"}</span>
                    </EditableCell>
                  );
                }
                if (c.key === "quantity") {
                  return (
                    <EditableCell
                      key={colKey}
                      className={baseClass}
                      style={styleAttr}
                      value={String(node.quantity ?? "")}
                      onSave={(v) => updateMut.mutate({ id: node.id, patch: { quantity: Number(v) || 0 } })}
                    >
                      <span>{node.is_group ? "—" : fmtNumber(node.quantity, 2)}</span>
                    </EditableCell>
                  );
                }
                if (c.key === "unit_rate") {
                  // Click → navigate to price analysis for this item
                  return (
                    <div key={colKey} className={cn(baseClass, "bg-primary/5")} style={styleAttr}>
                      {node.is_group ? (
                        <span />
                      ) : (
                        <Link
                          to="/price-analysis"
                          search={{ item: node.id }}
                          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                          title="افتح تحليل الأسعار لهذا البند"
                        >
                          {fmtNumber(node.unitRate, 2)}
                          <TrendingUp className="h-3 w-3 opacity-60" />
                        </Link>
                      )}
                    </div>
                  );
                }
                if (c.key === "total") {
                  return (
                    <div key={colKey} className={cn(baseClass, "bg-primary/10 font-bold text-primary")} style={styleAttr}>
                      {fmtNumber(node.rolledTotal, 2)}
                    </div>
                  );
                }
                if (c.key === "__actions") {
                  return (
                    <div key={colKey} className={baseClass} style={styleAttr}>
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
                // extra_* columns: render raw Excel cell value, read-only
                if (colKey.startsWith("extra_")) {
                  const idx = Number(colKey.slice(6));
                  const v = raw?.[idx];
                  return (
                    <div key={colKey} className={baseClass} style={styleAttr}>
                      <span className="block w-full truncate whitespace-pre-wrap text-foreground/80">
                        {v === null || v === undefined ? "" : String(v)}
                      </span>
                    </div>
                  );
                }
                return <div key={colKey} className={baseClass} style={styleAttr} />;
              })}
            </div>
          );
        })}
      </div>
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
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <div className={className} style={style}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== value) onSave(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          className="h-full w-full bg-background px-1 text-xs outline-none ring-1 ring-primary"
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
      <PopoverContent className="w-auto p-1.5" align="end" dir="rtl">
        <div className="flex items-center gap-0.5">
          <FmtBtn active={cur.bold} onClick={() => set({ bold: !cur.bold })} title="عريض">
            <Bold className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn active={cur.italic} onClick={() => set({ italic: !cur.italic })} title="مائل">
            <Italic className="h-3.5 w-3.5" />
          </FmtBtn>
          <span className="mx-1 h-4 w-px bg-border" />
          <FmtBtn active={cur.align === "right"} onClick={() => set({ align: "right" })} title="يمين">
            <AlignRight className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn active={cur.align === "center"} onClick={() => set({ align: "center" })} title="وسط">
            <AlignCenter className="h-3.5 w-3.5" />
          </FmtBtn>
          <FmtBtn active={cur.align === "left"} onClick={() => set({ align: "left" })} title="يسار">
            <AlignLeft className="h-3.5 w-3.5" />
          </FmtBtn>
          <span className="mx-1 h-4 w-px bg-border" />
          <select
            value={cur.fontSize ?? 12}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="h-7 rounded border border-border bg-background px-1 text-xs"
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

function FmtBtn({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-primary/15 text-primary",
      )}
    >
      {children}
    </button>
  );
}
