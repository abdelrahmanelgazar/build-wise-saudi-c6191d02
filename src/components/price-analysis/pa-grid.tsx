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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
type PaItem = Database["public"]["Tables"]["price_analysis_items"]["Row"];
type Markup = Database["public"]["Tables"]["price_analysis_markup"]["Row"];
type ResourceType = Database["public"]["Enums"]["resource_type"];

const TYPE_LABEL: Record<ResourceType, string> = {
  material: "مواد",
  labor: "عمالة",
  equipment: "معدات",
  subcontractor: "مقاول باطن",
};
const TYPE_COLOR: Record<ResourceType, string> = {
  material: "bg-chart-2/10 text-chart-2",
  labor: "bg-chart-3/10 text-chart-3",
  equipment: "bg-primary/10 text-primary",
  subcontractor: "bg-chart-4/10 text-chart-4",
};

type CellStyles = Record<
  string,
  { bold?: boolean; italic?: boolean; align?: "right" | "center" | "left"; fontSize?: number }
>;

type Column = {
  key: string;
  label: string;
  width: number;
  align: "right" | "center" | "left";
};

const DEFAULT_COLS: Column[] = [
  { key: "type", label: "النوع", width: 110, align: "center" },
  { key: "description_ar", label: "الوصف", width: 360, align: "right" },
  { key: "unit", label: "الوحدة", width: 80, align: "center" },
  { key: "quantity", label: "الكمية", width: 100, align: "center" },
  { key: "unit_price", label: "سعر الوحدة", width: 120, align: "center" },
  { key: "total", label: "الإجمالي", width: 130, align: "center" },
  { key: "__actions", label: "", width: 60, align: "center" },
];

export function PaGrid({ boqItem }: { boqItem: BoqRow }) {
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const widthsKey = `pa-grid-widths:${boqItem.id}`;
  const heightsKey = `pa-grid-heights:${boqItem.id}`;

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(widthsKey) ?? "{}");
    } catch {
      return {};
    }
  });
  const [rowHeights, setRowHeights] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(heightsKey) ?? "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem(widthsKey, JSON.stringify(widths));
  }, [widths, widthsKey]);
  useEffect(() => {
    localStorage.setItem(heightsKey, JSON.stringify(rowHeights));
  }, [rowHeights, heightsKey]);

  const columns = useMemo(
    () => DEFAULT_COLS.map((c) => ({ ...c, width: widths[c.key] ?? c.width })),
    [widths],
  );

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

  // Group rows by type, with section headers + subtotals
  type GridRow =
    | { kind: "section"; type: ResourceType; subtotal: number; count: number }
    | { kind: "item"; item: PaItem }
    | { kind: "subtotal"; type: ResourceType; subtotal: number };

  const directCost = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);

  const gridRows: GridRow[] = useMemo(() => {
    const out: GridRow[] = [];
    (["material", "labor", "equipment", "subcontractor"] as ResourceType[]).forEach((t) => {
      const sub = items.filter((i) => i.resource_type === t);
      const subtotal = sub.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
      out.push({ kind: "section", type: t, subtotal, count: sub.length });
      sub.forEach((it) => out.push({ kind: "item", item: it }));
      if (sub.length > 0) out.push({ kind: "subtotal", type: t, subtotal });
    });
    return out;
  }, [items]);

  // Column resize
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const onResizeStart = (key: string, startW: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { key, startX: e.clientX, startW };
    const move = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const dx = resizingRef.current.startX - ev.clientX;
      const next = Math.max(50, resizingRef.current.startW + dx);
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

  // Row resize
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

  // Mutations
  const updateMut = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<PaItem> }) => {
      const { error } = await supabase
        .from("price_analysis_items")
        .update(vars.patch)
        .eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] }),
    onError: (e: Error) => toast.error(e.message),
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
        boq_item_id: boqItem.id,
        user_id: userId,
        project_id: projectId,
        resource_type: type,
        description_ar: "بند جديد",
        unit: "وحدة",
        quantity: 1,
        unit_price: 0,
        sort_order: maxSort + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pa_items", boqItem.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // Markup calc
  const indirect = Number(markup?.indirect_pct ?? 5);
  const overhead = Number(markup?.overhead_pct ?? 8);
  const risk = Number(markup?.risk_pct ?? 3);
  const profit = Number(markup?.profit_pct ?? 10);
  const indirectVal = (directCost * indirect) / 100;
  const s1 = directCost + indirectVal;
  const overheadVal = (s1 * overhead) / 100;
  const s2 = s1 + overheadVal;
  const riskVal = (s2 * risk) / 100;
  const s3 = s2 + riskVal;
  const profitVal = (s3 * profit) / 100;
  const selling = s3 + profitVal;

  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-mono">{boqItem.item_no}</span> · {boqItem.description_ar} ·
          الكمية: {fmtNumber(boqItem.quantity, 2)} {boqItem.unit} · سعر البيع:{" "}
          <span className="font-semibold text-primary">{fmtSAR(selling)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                إضافة صف
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["material", "labor", "equipment", "subcontractor"] as ResourceType[]).map((t) => (
                <DropdownMenuItem key={t} onClick={() => addMut.mutate(t)}>
                  {TYPE_LABEL[t]}
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
            تصدير Excel
          </Button>
        </div>
      </div>

      {/* Sheet */}
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: totalWidth }} className="text-xs tabular-nums select-text">
          {/* Header */}
          <div className="sticky top-0 z-10 flex border-b border-border bg-muted/50 backdrop-blur">
            {columns.map((c) => (
              <div
                key={c.key}
                style={{ width: c.width, minWidth: c.width }}
                className={cn(
                  "relative flex items-center border-l border-border/40 px-2 py-2 text-[11px] font-semibold text-muted-foreground",
                  c.align === "center" && "justify-center text-center",
                  c.align === "right" && "justify-end text-right",
                  c.align === "left" && "justify-start text-left",
                )}
              >
                <span className="whitespace-normal break-words leading-tight">{c.label}</span>
                {c.key !== "__actions" && (
                  <span
                    onMouseDown={onResizeStart(c.key, c.width)}
                    className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-primary/40"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Body */}
          {gridRows.length === 0 && (
            <div className="px-4 py-12 text-center text-muted-foreground">
              لا توجد بنود — أضف صفوفاً أو استورد من Excel.
            </div>
          )}
          {/* Totals footer row (sheet-level) */}
          {gridRows.length > 0 && (
            <div
              style={{ width: totalWidth }}
              className="sticky bottom-0 z-10 flex border-t-2 border-primary/40 bg-primary/10 text-[12px] font-bold backdrop-blur"
            >
              <div className="flex-1 px-3 py-2 text-right text-primary">
                إجمالي سعر الوحدة للبند ({boqItem.unit ?? "وحدة"})
              </div>
              <div
                style={{ width: columns[5].width, minWidth: columns[5].width }}
                className="border-r border-border/40 px-2 py-2 text-center text-primary tabular-nums"
              >
                {fmtSAR(selling)}
              </div>
              <div style={{ width: columns[6].width, minWidth: columns[6].width }} />
            </div>
          )}
          {gridRows.map((row, idx) => {
            if (row.kind === "section") {
              return (
                <div
                  key={`sec-${row.type}`}
                  style={{ width: totalWidth }}
                  className={cn(
                    "sticky-section flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] font-bold",
                    TYPE_COLOR[row.type],
                  )}
                >
                  <span>{TYPE_LABEL[row.type]}</span>
                  <span className="text-[10px] opacity-70">({row.count})</span>
                </div>
              );
            }
            if (row.kind === "subtotal") {
              return (
                <div
                  key={`sub-${row.type}`}
                  style={{ width: totalWidth }}
                  className="flex border-b border-border bg-muted/30 text-[11px] font-semibold"
                >
                  <div className="flex-1 px-3 py-1.5 text-left text-muted-foreground">
                    مجموع {TYPE_LABEL[row.type]}
                  </div>
                  <div
                    style={{ width: columns[5].width, minWidth: columns[5].width }}
                    className="border-r border-border/40 px-2 py-1.5 text-center text-foreground"
                  >
                    {fmtNumber(row.subtotal, 2)}
                  </div>
                  <div
                    style={{ width: columns[6].width, minWidth: columns[6].width }}
                  />
                </div>
              );
            }
            const it = row.item;
            const styles = ((it.cell_styles ?? {}) as CellStyles) || {};
            const customH = rowHeights[it.id];
            const total = Number(it.quantity) * Number(it.unit_price);

            return (
              <div
                key={it.id}
                style={customH ? { height: customH } : { minHeight: 30 }}
                className="group relative flex border-b border-border/60 hover:bg-muted/10"
              >
                {columns.map((c) => {
                  const st = styles[c.key];
                  const baseClass = cn(
                    "flex items-start gap-1 overflow-hidden whitespace-normal break-words border-l border-border/40 px-2 py-1.5",
                    c.align === "center" && "justify-center text-center",
                    c.align === "right" && "justify-end text-right",
                    c.align === "left" && "justify-start text-left",
                    st?.bold && "font-bold",
                    st?.italic && "italic",
                  );
                  const styleAttr: React.CSSProperties = {
                    width: c.width,
                    minWidth: c.width,
                    fontSize: st?.fontSize ? `${st.fontSize}px` : undefined,
                    textAlign: st?.align ?? c.align,
                  };

                  if (c.key === "__actions") {
                    return (
                      <div key={c.key} className={baseClass} style={styleAttr}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMut.mutate(it.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  }
                  if (c.key === "type") {
                    return (
                      <div key={c.key} className={baseClass} style={styleAttr}>
                        <Select
                          value={it.resource_type}
                          onValueChange={(v) =>
                            updateMut.mutate({ id: it.id, patch: { resource_type: v as ResourceType } })
                          }
                        >
                          <SelectTrigger className="h-6 w-full border-none bg-transparent px-1 text-[11px] shadow-none">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent dir="rtl">
                            {(["material", "labor", "equipment", "subcontractor"] as ResourceType[]).map((t) => (
                              <SelectItem key={t} value={t}>
                                {TYPE_LABEL[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  }
                  if (c.key === "description_ar") {
                    return (
                      <div key={c.key} className={baseClass} style={styleAttr}>
                        <EditableCell
                          value={it.description_ar}
                          onSave={(v) =>
                            updateMut.mutate({ id: it.id, patch: { description_ar: v || "—" } })
                          }
                        >
                          <span className="block w-full whitespace-pre-wrap break-words">
                            {it.description_ar}
                          </span>
                        </EditableCell>
                        <FormatPopover
                          styles={styles}
                          colKey={c.key}
                          onChange={(next) =>
                            updateMut.mutate({ id: it.id, patch: { cell_styles: next as unknown as never } })
                          }
                        />
                      </div>
                    );
                  }
                  if (c.key === "unit") {
                    return (
                      <EditableCell
                        key={c.key}
                        className={baseClass}
                        style={styleAttr}
                        value={it.unit}
                        onSave={(v) => updateMut.mutate({ id: it.id, patch: { unit: v || "وحدة" } })}
                      >
                        <span className="text-muted-foreground">{it.unit}</span>
                      </EditableCell>
                    );
                  }
                  if (c.key === "quantity") {
                    return (
                      <EditableCell
                        key={c.key}
                        className={baseClass}
                        style={styleAttr}
                        value={String(it.quantity)}
                        onSave={(v) =>
                          updateMut.mutate({ id: it.id, patch: { quantity: Number(v) || 0 } })
                        }
                      >
                        <span>{fmtNumber(it.quantity, 3)}</span>
                      </EditableCell>
                    );
                  }
                  if (c.key === "unit_price") {
                    return (
                      <EditableCell
                        key={c.key}
                        className={baseClass}
                        style={styleAttr}
                        value={String(it.unit_price)}
                        onSave={(v) =>
                          updateMut.mutate({ id: it.id, patch: { unit_price: Number(v) || 0 } })
                        }
                      >
                        <span>{fmtNumber(it.unit_price, 2)}</span>
                      </EditableCell>
                    );
                  }
                  if (c.key === "total") {
                    return (
                      <div
                        key={c.key}
                        className={cn(baseClass, "bg-primary/5 font-semibold text-foreground")}
                        style={styleAttr}
                      >
                        {fmtNumber(total, 2)}
                      </div>
                    );
                  }
                  return null;
                })}
                <div
                  onMouseDown={onRowResizeStart(it.id, customH ?? 30)}
                  className="absolute inset-x-0 bottom-0 z-10 h-1 cursor-row-resize opacity-0 hover:bg-primary/50 group-hover:opacity-100"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Markup footer (Excel-like total bar) */}
      <div className="border-t border-border bg-secondary/30 px-4 py-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs tabular-nums md:grid-cols-3">
          <SumLine label="التكلفة المباشرة" value={fmtSAR(directCost)} />
          <MarkupLine
            label="غير مباشرة"
            pct={indirect}
            value={indirectVal}
            field="indirect_pct"
            boqItemId={boqItem.id}
            markup={markup}
            projectId={projectId}
          />
          <MarkupLine
            label="مصاريف عامة"
            pct={overhead}
            value={overheadVal}
            field="overhead_pct"
            boqItemId={boqItem.id}
            markup={markup}
            projectId={projectId}
          />
          <MarkupLine
            label="المخاطر"
            pct={risk}
            value={riskVal}
            field="risk_pct"
            boqItemId={boqItem.id}
            markup={markup}
            projectId={projectId}
          />
          <MarkupLine
            label="الربح"
            pct={profit}
            value={profitVal}
            field="profit_pct"
            boqItemId={boqItem.id}
            markup={markup}
            projectId={projectId}
          />
          <div className="col-span-2 md:col-span-3 mt-1 flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 ring-1 ring-primary/30">
            <span className="text-sm font-bold text-primary">سعر البيع لكل {boqItem.unit}</span>
            <span className="text-lg font-bold tabular-nums text-primary">{fmtSAR(selling)}</span>
          </div>
          <div className="col-span-2 flex items-center justify-between text-muted-foreground md:col-span-3">
            <span>
              الإجمالي للكمية ({fmtNumber(boqItem.quantity, 2)} {boqItem.unit})
            </span>
            <span className="font-semibold text-foreground">
              {fmtSAR(selling * Number(boqItem.quantity ?? 0))}
            </span>
          </div>
        </div>
      </div>
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
  label,
  pct,
  value,
  field,
  boqItemId,
  markup,
  projectId,
}: {
  label: string;
  pct: number;
  value: number;
  field: "indirect_pct" | "overhead_pct" | "risk_pct" | "profit_pct";
  boqItemId: string;
  markup: Markup | null | undefined;
  projectId: string | null;
}) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async (newPct: number) => {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");
      if (markup) {
        const patch: Partial<Markup> = { [field]: newPct };
        const { error } = await supabase
          .from("price_analysis_markup")
          .update(patch)
          .eq("boq_item_id", boqItemId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("price_analysis_markup").insert({
          boq_item_id: boqItemId,
          user_id: userId,
          project_id: projectId,
          indirect_pct: field === "indirect_pct" ? newPct : 5,
          overhead_pct: field === "overhead_pct" ? newPct : 8,
          risk_pct: field === "risk_pct" ? newPct : 3,
          profit_pct: field === "profit_pct" ? newPct : 10,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pa_markup", boqItemId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {label}
        <Input
          type="number"
          step="0.5"
          defaultValue={pct}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v !== pct) mut.mutate(v);
          }}
          className="h-6 w-14 px-1.5 text-center text-xs"
        />
        <span className="text-[10px] text-muted-foreground">%</span>
      </span>
      <span className="font-semibold text-foreground">{fmtSAR(value)}</span>
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
        <textarea
          autoFocus
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
    onChange({ ...styles, [colKey]: { ...cur, ...patch } });
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
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.bold && "bg-muted")}
            onClick={() => set({ bold: !cur.bold })}
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.italic && "bg-muted")}
            onClick={() => set({ italic: !cur.italic })}
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-4 w-px bg-border" />
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.align === "right" && "bg-muted")}
            onClick={() => set({ align: "right" })}
          >
            <AlignRight className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.align === "center" && "bg-muted")}
            onClick={() => set({ align: "center" })}
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </button>
          <button
            className={cn("rounded p-1 hover:bg-muted", cur.align === "left" && "bg-muted")}
            onClick={() => set({ align: "left" })}
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-4 w-px bg-border" />
          <select
            value={cur.fontSize ?? 12}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="rounded border border-border bg-background px-1 py-0.5 text-xs"
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
