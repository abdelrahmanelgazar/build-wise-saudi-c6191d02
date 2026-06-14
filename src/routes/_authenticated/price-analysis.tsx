import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Boxes, Hammer, Truck, Plus, Trash2, TrendingUp } from "lucide-react";
import { PageHeader } from "./resources";
import { fmtNumber, fmtPct, fmtSAR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { useActiveProjectId } from "@/lib/active-project";
import { Link } from "@tanstack/react-router";
import { FolderPlus } from "lucide-react";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];
type ResourceRow = Database["public"]["Tables"]["resources"]["Row"];
type PaItem = Database["public"]["Tables"]["price_analysis_items"]["Row"];
type Markup = Database["public"]["Tables"]["price_analysis_markup"]["Row"];
type ResourceType = Database["public"]["Enums"]["resource_type"];

const searchSchema = z.object({ item: z.string().optional() });

export const Route = createFileRoute("/_authenticated/price-analysis")({
  head: () => ({ meta: [{ title: "تحليل الأسعار — تقديري" }] }),
  validateSearch: searchSchema,
  component: PriceAnalysisPage,
});

const TYPE_META: Record<
  ResourceType,
  { label: string; icon: typeof Boxes; color: string }
> = {
  material: { label: "المواد", icon: Boxes, color: "text-chart-2" },
  labor: { label: "العمالة", icon: Hammer, color: "text-chart-3" },
  equipment: { label: "المعدات", icon: Truck, color: "text-primary" },
  subcontractor: { label: "مقاول الباطن", icon: Truck, color: "text-chart-4" },
};

function PriceAnalysisPage() {
  const { item } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(item ?? null);
  const projectId = useActiveProjectId();

  const { data: boqItems = [] } = useQuery({
    queryKey: ["boq_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boq_items")
        .select("*")
        .eq("project_id", projectId!)
        .eq("is_group", false)
        .order("item_no");
      if (error) throw error;
      return data as BoqRow[];
    },
  });

  useEffect(() => {
    if (!selectedId && boqItems.length > 0) {
      setSelectedId(boqItems[0].id);
    }
  }, [boqItems, selectedId]);

  const selected = boqItems.find((b) => b.id === selectedId) ?? null;

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">اختر مشروعاً</h2>
          <p className="mt-1 text-sm text-muted-foreground">تحليل الأسعار يعتمد على بنود مشروع.</p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>الذهاب للمشاريع</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col p-6">
      <PageHeader
        title="تحليل الأسعار (Price Build-up)"
        subtitle="تفكيك كل بند إلى مواد، عمالة، ومعدات — مع حساب الهوامش وسعر البيع آلياً."
      />

      <div className="mt-5 grid flex-1 grid-cols-12 gap-4 overflow-hidden">
        {/* Master: BOQ list */}
        <aside className="col-span-4 flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            بنود الجدول ({boqItems.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            {boqItems.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                لا توجد بنود. أضف بنوداً في جدول الكميات أولاً.
              </div>
            )}
            {boqItems.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setSelectedId(b.id);
                  navigate({ search: { item: b.id }, replace: true });
                }}
                className={cn(
                  "block w-full border-b border-border/60 px-3 py-2.5 text-right text-xs transition-colors",
                  selectedId === b.id
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">{b.item_no}</span>
                  {selectedId === b.id && (
                    <Badge className="h-4 bg-primary/20 px-1.5 text-[9px] text-primary hover:bg-primary/20">
                      محدّد
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 line-clamp-2 text-foreground/90">{b.description_ar}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  الكمية: {fmtNumber(b.quantity, 2)} {b.unit}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Detail */}
        <section className="col-span-8 flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          {selected ? (
            <PriceAnalysisDetail boqItem={selected} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              اختر بنداً من القائمة لعرض تحليله السعري.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PriceAnalysisDetail({ boqItem }: { boqItem: BoqRow }) {
  const { data: paItems = [] } = useQuery({
    queryKey: ["pa_items", boqItem.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_analysis_items")
        .select("*")
        .eq("boq_item_id", boqItem.id);
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

  const directCost = paItems.reduce(
    (s, i) => s + Number(i.quantity) * Number(i.unit_price),
    0,
  );
  const indirect = markup?.indirect_pct ?? 5;
  const overhead = markup?.overhead_pct ?? 8;
  const risk = markup?.risk_pct ?? 3;
  const profit = markup?.profit_pct ?? 10;

  const indirectVal = (directCost * Number(indirect)) / 100;
  const subtotal1 = directCost + indirectVal;
  const overheadVal = (subtotal1 * Number(overhead)) / 100;
  const subtotal2 = subtotal1 + overheadVal;
  const riskVal = (subtotal2 * Number(risk)) / 100;
  const subtotal3 = subtotal2 + riskVal;
  const profitVal = (subtotal3 * Number(profit)) / 100;
  const sellingRate = subtotal3 + profitVal;

  return (
    <>
      <div className="border-b border-border bg-muted/20 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-muted-foreground">{boqItem.item_no}</span>
          <h2 className="text-base font-bold text-foreground">{boqItem.description_ar}</h2>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          الكمية: {fmtNumber(boqItem.quantity, 2)} {boqItem.unit} ·
          سعر الوحدة المُحلَّل:{" "}
          <span className="font-semibold text-primary">{fmtSAR(sellingRate)}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {(["material", "labor", "equipment", "subcontractor"] as ResourceType[]).map((t) => (
          <ResourceSection
            key={t}
            boqItemId={boqItem.id}
            type={t}
            items={paItems.filter((i) => i.resource_type === t)}
          />
        ))}
      </div>

      {/* Calculation summary */}
      <div className="border-t border-border bg-secondary/30 p-5">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">ملخص التسعير</h3>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs tabular-nums md:grid-cols-3">
          <SummaryRow label="التكلفة المباشرة" value={fmtSAR(directCost)} />
          <MarkupInput
            label="غير مباشرة"
            pct={Number(indirect)}
            value={indirectVal}
            field="indirect_pct"
            boqItemId={boqItem.id}
            markup={markup}
          />
          <MarkupInput
            label="مصاريف عامة"
            pct={Number(overhead)}
            value={overheadVal}
            field="overhead_pct"
            boqItemId={boqItem.id}
            markup={markup}
          />
          <MarkupInput
            label="المخاطر"
            pct={Number(risk)}
            value={riskVal}
            field="risk_pct"
            boqItemId={boqItem.id}
            markup={markup}
          />
          <MarkupInput
            label="الربح"
            pct={Number(profit)}
            value={profitVal}
            field="profit_pct"
            boqItemId={boqItem.id}
            markup={markup}
          />
          <div className="col-span-2 md:col-span-3">
            <Separator className="my-2" />
          </div>
          <div className="col-span-2 flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 ring-1 ring-primary/30 md:col-span-3">
            <span className="text-sm font-bold text-primary">سعر البيع لكل {boqItem.unit}</span>
            <span className="text-lg font-bold tabular-nums text-primary">
              {fmtSAR(sellingRate)}
            </span>
          </div>
          <div className="col-span-2 flex items-center justify-between text-muted-foreground md:col-span-3">
            <span>الإجمالي للكمية ({fmtNumber(boqItem.quantity, 2)} {boqItem.unit})</span>
            <span className="font-semibold text-foreground">
              {fmtSAR(sellingRate * Number(boqItem.quantity ?? 0))}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function MarkupInput({
  label,
  pct,
  value,
  field,
  boqItemId,
  markup,
}: {
  label: string;
  pct: number;
  value: number;
  field: "indirect_pct" | "overhead_pct" | "risk_pct" | "profit_pct";
  boqItemId: string;
  markup: Markup | null | undefined;
}) {
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const mut = useMutation({
    mutationFn: async (newPct: number) => {
      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData.user?.id;
      if (!user_id) throw new Error("غير مسجل دخول");
      if (markup) {
        const payload: Partial<Markup> = { [field]: newPct };
        const { error } = await supabase
          .from("price_analysis_markup")
          .update(payload)
          .eq("boq_item_id", boqItemId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("price_analysis_markup").insert({
          boq_item_id: boqItemId,
          user_id,
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

function ResourceSection({
  boqItemId,
  type,
  items,
}: {
  boqItemId: string;
  type: ResourceType;
  items: PaItem[];
}) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  const subtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", meta.color)} />
          <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {items.length}
          </Badge>
        </div>
        <AddPaItemDialog boqItemId={boqItemId} type={type} />
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-right font-medium">الوصف</th>
              <th className="w-[70px] px-2 py-1.5 text-center font-medium">الوحدة</th>
              <th className="w-[90px] px-2 py-1.5 text-left font-medium">الكمية</th>
              <th className="w-[110px] px-2 py-1.5 text-left font-medium">سعر الوحدة</th>
              <th className="w-[110px] px-2 py-1.5 text-left font-medium">الإجمالي</th>
              <th className="w-[40px]"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                  لا توجد عناصر — أضف من قاعدة الموارد.
                </td>
              </tr>
            )}
            {items.map((i) => (
              <PaItemRow key={i.id} item={i} />
            ))}
            {items.length > 0 && (
              <tr className="border-t border-border bg-muted/20 font-semibold">
                <td colSpan={4} className="px-3 py-1.5 text-left text-muted-foreground">
                  المجموع الفرعي
                </td>
                <td className="px-2 py-1.5 text-left text-foreground">{fmtNumber(subtotal, 2)}</td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaItemRow({ item }: { item: PaItem }) {
  const qc = useQueryClient();
  const total = Number(item.quantity) * Number(item.unit_price);
  const delMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("price_analysis_items").delete().eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pa_items", item.boq_item_id] }),
  });
  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-1.5 text-foreground/90">{item.description_ar}</td>
      <td className="px-2 py-1.5 text-center text-muted-foreground">{item.unit}</td>
      <td className="px-2 py-1.5 text-left text-muted-foreground">
        {fmtNumber(item.quantity, 3)}
      </td>
      <td className="px-2 py-1.5 text-left text-muted-foreground">
        {fmtNumber(item.unit_price, 2)}
      </td>
      <td className="px-2 py-1.5 text-left font-semibold text-foreground">
        {fmtNumber(total, 2)}
      </td>
      <td className="px-1 py-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => delMut.mutate()}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </td>
    </tr>
  );
}

function AddPaItemDialog({ boqItemId, type }: { boqItemId: string; type: ResourceType }) {
  const [resourceId, setResourceId] = useState<string>("");
  const [qty, setQty] = useState("");
  const qc = useQueryClient();
  const projectId = useActiveProjectId();

  const { data: resources = [] } = useQuery({
    queryKey: ["resources", projectId, type],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .eq("project_id", projectId!)
        .eq("type", type)
        .order("name_ar");
      if (error) throw error;
      return data as ResourceRow[];
    },
  });

  const selected = useMemo(
    () => resources.find((r) => r.id === resourceId),
    [resources, resourceId],
  );

  const mut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData.user?.id;
      if (!user_id || !selected) throw new Error("اختر مورداً");
      const { error } = await supabase.from("price_analysis_items").insert({
        user_id,
        project_id: projectId,
        boq_item_id: boqItemId,
        resource_id: selected.id,
        resource_type: type,
        description_ar: selected.name_ar,
        unit: selected.unit,
        quantity: Number(qty) || 0,
        unit_price: selected.unit_price,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pa_items", boqItemId] });
      setResourceId("");
      setQty("");
      toast.success("تمت الإضافة");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex items-center gap-1.5">
      <Select value={resourceId} onValueChange={setResourceId}>
        <SelectTrigger className="h-7 w-[180px] text-xs">
          <SelectValue placeholder="اختر مورد…" />
        </SelectTrigger>
        <SelectContent>
          {resources.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name_ar} ({fmtNumber(r.unit_price, 2)} ر.س/{r.unit})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        step="0.001"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="الكمية"
        className="h-7 w-20 text-xs"
      />
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => mut.mutate()}
        disabled={!resourceId || !qty}
      >
        <Plus className="h-3 w-3" />
        إضافة
      </Button>
    </div>
  );
}

// keep fmtPct referenced to avoid unused warning if needed elsewhere
void fmtPct;
