import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useActiveProjectId } from "@/lib/active-project";
import type { Database } from "@/integrations/supabase/types";

type ResourceType = Database["public"]["Enums"]["resource_type"];

type ParsedRow = {
  resource_type: ResourceType;
  description_ar: string;
  unit: string;
  quantity: number;
  unit_price: number;
};

type ParsedMarkup = {
  indirect_pct?: number;
  overhead_pct?: number;
  risk_pct?: number;
  profit_pct?: number;
};

const TYPE_MAP: Record<string, ResourceType> = {
  مواد: "material",
  المواد: "material",
  material: "material",
  materials: "material",
  عمالة: "labor",
  العمالة: "labor",
  labor: "labor",
  labour: "labor",
  معدات: "equipment",
  المعدات: "equipment",
  equipment: "equipment",
  "مقاول باطن": "subcontractor",
  باطن: "subcontractor",
  subcontractor: "subcontractor",
  sub: "subcontractor",
};

const HEADER_KEYS: Record<string, keyof ParsedRow | "markup_indirect" | "markup_overhead" | "markup_risk" | "markup_profit"> = {
  النوع: "resource_type",
  نوع: "resource_type",
  type: "resource_type",
  الوصف: "description_ar",
  وصف: "description_ar",
  description: "description_ar",
  الوحدة: "unit",
  وحدة: "unit",
  unit: "unit",
  الكمية: "quantity",
  كمية: "quantity",
  quantity: "quantity",
  qty: "quantity",
  "سعر الوحدة": "unit_price",
  السعر: "unit_price",
  rate: "unit_price",
  price: "unit_price",
  "unit price": "unit_price",
};

const MARKUP_KEYS: Record<string, keyof ParsedMarkup> = {
  "غير مباشرة": "indirect_pct",
  indirect: "indirect_pct",
  "مصاريف عامة": "overhead_pct",
  overhead: "overhead_pct",
  المخاطر: "risk_pct",
  مخاطر: "risk_pct",
  risk: "risk_pct",
  الربح: "profit_pct",
  ربح: "profit_pct",
  profit: "profit_pct",
};

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function parseSheet(rows: unknown[][]): { items: ParsedRow[]; markup: ParsedMarkup } {
  // find header row
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] ?? [];
    const hits = r.filter((c) => HEADER_KEYS[norm(c)]).length;
    if (hits >= 3) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error("لم يتم العثور على رأس الجدول (النوع/الوصف/الوحدة/الكمية/سعر الوحدة)");

  const headers = (rows[headerIdx] ?? []).map((h) => HEADER_KEYS[norm(h)] ?? null);
  const items: ParsedRow[] = [];
  const markup: ParsedMarkup = {};

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;

    // markup row?
    const first = norm(r[0]);
    const mk = Object.keys(MARKUP_KEYS).find((k) => first.includes(k));
    if (mk) {
      const pctCell = r.find((c, idx) => idx > 0 && typeof c === "number");
      if (typeof pctCell === "number") markup[MARKUP_KEYS[mk]] = pctCell;
      continue;
    }

    const row: Partial<ParsedRow> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      const val = r[idx];
      if (h === "resource_type") {
        const t = TYPE_MAP[norm(val)] ?? null;
        if (t) row.resource_type = t;
      } else if (h === "quantity" || h === "unit_price") {
        row[h] = Number(val) || 0;
      } else if (h === "description_ar" || h === "unit") {
        row[h] = String(val ?? "").trim();
      }
    });
    if (!row.resource_type || !row.description_ar) continue;
    items.push({
      resource_type: row.resource_type,
      description_ar: row.description_ar,
      unit: row.unit ?? "",
      quantity: row.quantity ?? 0,
      unit_price: row.unit_price ?? 0,
    });
  }

  return { items, markup };
}

export function ImportPaDialog({ boqItemId }: { boqItemId: string }) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<{ items: ParsedRow[]; markup: ParsedMarkup } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const qc = useQueryClient();
  const projectId = useActiveProjectId();

  const onFile = async (file: File) => {
    setError(null);
    setParsed(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
      const out = parseSheet(rows);
      if (out.items.length === 0) throw new Error("لم يتم العثور على عناصر صالحة");
      setParsed(out);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importMut = useMutation({
    mutationFn: async () => {
      if (!parsed) return;
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");

      if (replace) {
        const { error } = await supabase
          .from("price_analysis_items")
          .delete()
          .eq("boq_item_id", boqItemId);
        if (error) throw error;
      }

      if (parsed.items.length > 0) {
        const rows = parsed.items.map((it, idx) => ({
          boq_item_id: boqItemId,
          user_id: userId,
          project_id: projectId,
          resource_type: it.resource_type,
          description_ar: it.description_ar,
          unit: it.unit || "وحدة",
          quantity: it.quantity,
          unit_price: it.unit_price,
          sort_order: idx,
        }));
        const { error } = await supabase.from("price_analysis_items").insert(rows);
        if (error) throw error;
      }

      const hasMk = Object.keys(parsed.markup).length > 0;
      if (hasMk) {
        const { data: existing } = await supabase
          .from("price_analysis_markup")
          .select("boq_item_id")
          .eq("boq_item_id", boqItemId)
          .maybeSingle();
        if (existing) {
          await supabase.from("price_analysis_markup").update(parsed.markup).eq("boq_item_id", boqItemId);
        } else {
          await supabase.from("price_analysis_markup").insert({
            boq_item_id: boqItemId,
            user_id: userId,
            project_id: projectId,
            indirect_pct: parsed.markup.indirect_pct ?? 5,
            overhead_pct: parsed.markup.overhead_pct ?? 8,
            risk_pct: parsed.markup.risk_pct ?? 3,
            profit_pct: parsed.markup.profit_pct ?? 10,
          });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pa_items", boqItemId] });
      qc.invalidateQueries({ queryKey: ["pa_markup", boqItemId] });
      toast.success("تم الاستيراد");
      setOpen(false);
      setParsed(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Upload className="h-3.5 w-3.5" />
          استيراد Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>استيراد تحليل أسعار من Excel</DialogTitle>
          <DialogDescription>
            الأعمدة المتوقعة: النوع (مواد/عمالة/معدات/مقاول باطن)، الوصف، الوحدة، الكمية، سعر الوحدة.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />

        {!parsed && !error && (
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 hover:bg-muted/40"
          >
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">اضغط لاختيار ملف .xlsx</span>
          </button>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">فشل القراءة</div>
              <div>{error}</div>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => fileRef.current?.click()}>
                اختر ملف آخر
              </Button>
            </div>
          </div>
        )}

        {parsed && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              تم العثور على {parsed.items.length} عنصراً
              {Object.keys(parsed.markup).length > 0 && ` + هوامش (${Object.keys(parsed.markup).length})`}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              استبدال البنود الحالية للبند (بدلاً من الإضافة إليها)
            </label>
            <div className="max-h-60 overflow-auto rounded border border-border text-xs">
              <table className="w-full">
                <thead className="sticky top-0 bg-muted/50 text-[10px] uppercase">
                  <tr>
                    <th className="px-2 py-1 text-right">النوع</th>
                    <th className="px-2 py-1 text-right">الوصف</th>
                    <th className="px-2 py-1">الوحدة</th>
                    <th className="px-2 py-1">الكمية</th>
                    <th className="px-2 py-1">السعر</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.items.slice(0, 50).map((it, i) => (
                    <tr key={i} className={cn("border-t border-border/60")}>
                      <td className="px-2 py-1 text-right">{it.resource_type}</td>
                      <td className="px-2 py-1 text-right">{it.description_ar}</td>
                      <td className="px-2 py-1 text-center">{it.unit}</td>
                      <td className="px-2 py-1 text-center tabular-nums">{it.quantity}</td>
                      <td className="px-2 py-1 text-center tabular-nums">{it.unit_price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button onClick={() => importMut.mutate()} disabled={!parsed || importMut.isPending}>
            {importMut.isPending ? "جاري الاستيراد…" : "استيراد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
