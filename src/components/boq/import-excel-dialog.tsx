import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileSpreadsheet, Upload, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useActiveProjectId } from "@/lib/active-project";

// Field keys (broader than ParsedRow — includes computed columns)
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

const HEADER_MAP: Record<string, FieldKey> = {
  "رقم البند": "item_no",
  "رقم": "item_no",
  "البند": "item_no",
  "كود": "item_no",
  "code": "item_no",
  "item": "item_no",
  "item no": "item_no",
  "item_no": "item_no",
  "no": "item_no",
  "#": "item_no",

  "الوصف": "description_ar",
  "وصف": "description_ar",
  "البيان": "description_ar",
  "بيان": "description_ar",
  "description": "description_ar",
  "desc": "description_ar",

  "الوحدة": "unit",
  "وحدة": "unit",
  "unit": "unit",
  "uom": "unit",

  "الكمية": "quantity",
  "كمية": "quantity",
  "quantity": "quantity",
  "qty": "quantity",

  "مواد": "material_cost",
  "تكلفة المواد": "material_cost",
  "المواد": "material_cost",
  "material": "material_cost",
  "materials": "material_cost",

  "عمالة": "labor_cost",
  "تكلفة العمالة": "labor_cost",
  "العمالة": "labor_cost",
  "labor": "labor_cost",
  "labour": "labor_cost",

  "معدات": "equipment_cost",
  "تكلفة المعدات": "equipment_cost",
  "المعدات": "equipment_cost",
  "equipment": "equipment_cost",

  "مقاول باطن": "subcontractor_cost",
  "مقاول": "subcontractor_cost",
  "باطن": "subcontractor_cost",
  "subcontractor": "subcontractor_cost",
  "sub": "subcontractor_cost",

  "سعر الوحدة": "unit_rate",
  "سعر": "unit_rate",
  "rate": "unit_rate",
  "rate sar": "unit_rate",
  "unit rate": "unit_rate",
  "unit price": "unit_rate",
  "price": "unit_rate",

  "الإجمالي": "total",
  "إجمالي": "total",
  "اجمالي": "total",
  "المبلغ": "total",
  "amount": "total",
  "amount sar": "total",
  "total": "total",
};

type ParsedRow = {
  item_no: string;
  description_ar: string;
  unit: string;
  quantity: number;
  material_cost: number;
  labor_cost: number;
  equipment_cost: number;
  subcontractor_cost: number;
  is_group: boolean;
  _raw: (string | number | null)[];
};

// Persisted on projects.excel_headers: original label + (optional) field mapping
export type ExcelHeader = { label: string; field: FieldKey | null };

function normHeader(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[:：()_\-/.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Detect group rows: itemNo like "01", "1", "A" (no dots) AND no quantity/unit → group.
function detectGroup(itemNo: string, qty: number, unit: string, costs: number[]): boolean {
  const totalCost = costs.reduce((s, c) => s + c, 0);
  if (qty === 0 && totalCost === 0 && !unit) return true;
  if (itemNo && !itemNo.includes(".") && qty === 0 && totalCost === 0) return true;
  return false;
}

function parseSheet(rows: unknown[][]): { headers: ExcelHeader[]; preHeaders: unknown[][]; data: ParsedRow[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!rows.length) return { headers: [], preHeaders: [], data: [], warnings: ["الملف فارغ"] };

  // Trim empty columns from the right
  let maxCol = -1;
  rows.forEach(r => {
    r.forEach((cell, idx) => {
      if (cell !== null && cell !== undefined && String(cell).trim() !== "") {
        if (idx > maxCol) maxCol = idx;
      }
    });
  });
  if (maxCol >= 0) {
    rows = rows.map(r => r.slice(0, maxCol + 1));
  }

  // find header row: first row with >=2 known headers
  let headerIdx = -1;
  let colMap: Record<number, FieldKey> = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i] || [];
    const map: Record<number, FieldKey> = {};
    const usedFields = new Set<FieldKey>();
    let hits = 0;
    r.forEach((cell, idx) => {
      const key = HEADER_MAP[normHeader(cell)];
      // first matching column for a field wins; later same-meaning columns stay raw
      if (key && !usedFields.has(key)) {
        map[idx] = key;
        usedFields.add(key);
        hits++;
      }
    });
    if (hits >= 2) {
      headerIdx = i;
      colMap = map;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      headers: [],
      preHeaders: [],
      data: [],
      warnings: ["لم يتم التعرف على رؤوس الأعمدة. تأكد من وجود أعمدة: رقم البند، الوصف، الوحدة، الكمية…"],
    };
  }

  const rawHeaders = (rows[headerIdx] as unknown[]).map((c) => String(c ?? ""));
  const headers: ExcelHeader[] = rawHeaders.map((label, idx) => ({
    label,
    field: colMap[idx] ?? null,
  }));
  const preHeaders = rows.slice(0, headerIdx);
  const data: ParsedRow[] = [];


  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.length || r.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;

    const get = (k: FieldKey): unknown => {
      const idx = Object.entries(colMap).find(([, v]) => v === k)?.[0];
      return idx !== undefined ? r[Number(idx)] : "";
    };

    const item_no = String(get("item_no") ?? "").trim();
    const description_ar = String(get("description_ar") ?? "").trim();
    if (!description_ar && !item_no) continue;

    const unit = String(get("unit") ?? "").trim();
    const quantity = toNum(get("quantity"));
    const material_cost = toNum(get("material_cost"));
    const labor_cost = toNum(get("labor_cost"));
    const equipment_cost = toNum(get("equipment_cost"));
    const subcontractor_cost = toNum(get("subcontractor_cost"));
    const is_group = detectGroup(item_no, quantity, unit, [
      material_cost,
      labor_cost,
      equipment_cost,
      subcontractor_cost,
    ]);

    let final_item_no = item_no || `AUTO-${data.length + 1}`;
    let suffix = 1;
    let base_no = final_item_no;
    while (data.some(d => d.item_no === final_item_no)) {
      final_item_no = `${base_no}-${suffix}`;
      suffix++;
    }

    data.push({
      item_no: final_item_no,
      description_ar,
      unit,
      quantity,
      material_cost,
      labor_cost,
      equipment_cost,
      subcontractor_cost,
      is_group,
      _raw: r as (string | number | null)[],
    });
  }

  if (!data.length) warnings.push("لم يتم العثور على بنود بعد رؤوس الأعمدة.");
  return { headers, preHeaders, data, warnings };
}

// Build parent linkage from item_no hierarchy (e.g. 01 → 01.01 → 01.01.01)
function linkParents(rows: ParsedRow[]) {
  type Prepared = ParsedRow & { _tmpId: string; _parentTmpId: string | null; _level: number };
  const prepared: Prepared[] = rows.map((r, i) => ({
    ...r,
    _tmpId: `t${i}`,
    _parentTmpId: null,
    _level: 0,
  }));

  // build by trimming last ".X" segment from item_no
  const byItemNo = new Map<string, Prepared>();
  prepared.forEach((r) => byItemNo.set(r.item_no, r));

  prepared.forEach((r) => {
    const parts = r.item_no.split(".");
    r._level = Math.max(0, parts.length - 1);
    if (parts.length > 1) {
      for (let cut = parts.length - 1; cut >= 1; cut--) {
        const cand = parts.slice(0, cut).join(".");
        const parent = byItemNo.get(cand);
        if (parent) {
          r._parentTmpId = parent._tmpId;
          r._level = (parent._level ?? 0) + 1;
          break;
        }
      }
    }
  });

  // Fallback: rows without explicit parent fall under nearest preceding group
  let lastGroupId: string | null = null;
  let lastGroupLevel = -1;
  prepared.forEach((r) => {
    if (r.is_group) {
      if (r._parentTmpId === null) {
        lastGroupId = r._tmpId;
        lastGroupLevel = r._level;
      } else {
        lastGroupId = r._tmpId;
        lastGroupLevel = r._level;
      }
    } else if (r._parentTmpId === null && lastGroupId) {
      r._parentTmpId = lastGroupId;
      r._level = lastGroupLevel + 1;
    }
  });
  return prepared;
}

export function ImportExcelDialog() {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [parsed, setParsed] = useState<{ headers: ExcelHeader[]; preHeaders: unknown[][]; data: ParsedRow[]; warnings: string[] }>({
    headers: [],
    preHeaders: [],
    data: [],
    warnings: [],
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const projectId = useActiveProjectId();

  const reset = () => {
    setFileName("");
    setSheetNames([]);
    setActiveSheet("");
    setWorkbook(null);
    setParsed({ headers: [], preHeaders: [], data: [], warnings: [] });
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    try {
      if (file.size > 15 * 1024 * 1024) {
        toast.error("الحد الأقصى لحجم الملف 15 ميجابايت");
        return;
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      setWorkbook(wb);
      setFileName(file.name);
      setSheetNames(wb.SheetNames);
      const first = wb.SheetNames[0];
      if (!first) throw new Error("الملف لا يحتوي على صفحات");
      setActiveSheet(first);
      loadSheet(wb, first);
    } catch (err) {
      toast.error("تعذّر قراءة الملف. تأكد من أنه ملف Excel صالح.");
      console.error(err);
    }
  };

  const loadSheet = (wb: XLSX.WorkBook, name: string) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    setParsed(parseSheet(rows));
  };

  const switchSheet = (name: string) => {
    setActiveSheet(name);
    if (workbook) loadSheet(workbook, name);
  };

  const groupsCount = useMemo(() => parsed.data.filter((r) => r.is_group).length, [parsed.data]);
  const itemsCount = useMemo(() => parsed.data.filter((r) => !r.is_group).length, [parsed.data]);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData.user?.id;
      if (!user_id) throw new Error("غير مسجل دخول");
      if (!workbook) throw new Error("لم يتم تحميل الملف");
      
      let allHeaders: Record<string, ExcelHeader[]> = {};
      let allPreHeaders: Record<string, unknown[][]> = {};
      let totalImported = 0;

      for (const sheetName of workbook.SheetNames) {
        const ws = workbook.Sheets[sheetName];
        if (!ws) continue;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false });
        const sheetParsed = parseSheet(rows);
        
        allHeaders[sheetName] = sheetParsed.headers;
        allPreHeaders[sheetName] = sheetParsed.preHeaders;

        if (!sheetParsed.data.length) continue;
        
        const prepared = linkParents(sheetParsed.data);
        
        const tmpToDbId = new Map<string, string>();
        const indexOf = new Map<string, number>();
        prepared.forEach((r, i) => indexOf.set(r._tmpId, i));
        const byLevel = new Map<number, typeof prepared>();
        prepared.forEach((r) => {
          const arr = byLevel.get(r._level) ?? [];
          arr.push(r);
          byLevel.set(r._level, arr);
        });
        const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

        for (const lvl of levels) {
          const batch = byLevel.get(lvl);
          if (!batch) continue;
          const payload = batch.map((r) => ({
            user_id,
            project_id: projectId,
            sheet_name: sheetName,
            parent_id: r._parentTmpId ? tmpToDbId.get(r._parentTmpId) ?? null : null,
            item_no: r.item_no,
            description_ar: r.description_ar,
            unit: r.is_group ? null : r.unit || null,
            quantity: r.is_group ? 0 : r.quantity,
            material_cost: r.material_cost,
            labor_cost: r.labor_cost,
            equipment_cost: r.equipment_cost,
            subcontractor_cost: r.subcontractor_cost,
            is_group: r.is_group,
            level: r._level,
            sort_order: (indexOf.get(r._tmpId) ?? 0) + 1,
            raw_row: r._raw as unknown as never,
          }));
          const { data, error } = await supabase.from("boq_items").upsert(payload, { onConflict: "user_id,project_id,sheet_name,item_no" }).select("id");
          if (error) throw error;
          (data ?? []).forEach((row, i) => { const source = batch[i]; if (source) tmpToDbId.set(source._tmpId, row.id); });
        }
        totalImported += sheetParsed.data.length;
      }

      await supabase
        .from("projects")
        .update({ 
          excel_headers: allHeaders as unknown as never,
          excel_pre_headers: allPreHeaders as unknown as never,
          excel_sheets_order: workbook.SheetNames as unknown as never
        })
        .eq("id", projectId);

      return totalImported;
    },
    onSuccess: (totalImported) => {
      toast.success(`تم استيراد ${totalImported} بنداً بنجاح من جميع الصفحات`);
      qc.invalidateQueries({ queryKey: ["boq_items"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      reset();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileSpreadsheet className="h-4 w-4" />
          استيراد من Excel
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>استيراد جدول كميات من Excel</DialogTitle>
          <DialogDescription className="leading-relaxed">
            ارفع ملف .xlsx أو .xls — سيتم التعرّف تلقائياً على الأعمدة (رقم البند، الوصف، الوحدة،
            الكمية، تكاليف المواد/العمالة/المعدات/مقاول الباطن) وتوليد البنية الهرمية حسب ترقيم
            البنود (01، 01.01، …).
          </DialogDescription>
        </DialogHeader>

        {!workbook && (
          <label
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 p-10 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 cursor-pointer",
            )}
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">اسحب الملف هنا أو اضغط للاختيار</div>
            <div className="text-xs text-muted-foreground">.xlsx, .xls — حتى 15 ميجابايت</div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
        )}

        {workbook && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="font-medium">{fileName}</span>
                <Badge variant="outline">
                  {groupsCount} مجموعة · {itemsCount} بند
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={reset} className="gap-1">
                <X className="h-3.5 w-3.5" />
                تغيير الملف
              </Button>
            </div>

            {sheetNames.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {sheetNames.map((n) => (
                  <button
                    key={n}
                    onClick={() => switchSheet(n)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      activeSheet === n
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            {parsed.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}

            {parsed.data.length > 0 && (
              <>
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  تم التعرّف على {parsed.data.length} صفاً. معاينة (نفس تنسيق الملف):
                </div>
                <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[900px] text-xs tabular-nums">
                    <thead className="sticky top-0 z-10 bg-muted/60 text-[11px] text-muted-foreground backdrop-blur">
                      <tr className="border-b border-border">
                        {parsed.headers.map((h, i) => (
                          <th key={i} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                            {h.label || `عمود ${i + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.data.slice(0, 200).map((r, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-border/60",
                            r.is_group
                              ? "bg-secondary/40 font-semibold text-foreground"
                              : "hover:bg-muted/20",
                          )}
                        >
                          {r._raw.map((cell, j) => (
                            <td
                              key={j}
                              className="px-2 py-1.5 text-right align-top whitespace-pre-wrap"
                            >
                              {cell === null || cell === undefined ? "" : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.data.length > 200 && (
                    <div className="border-t border-border bg-muted/30 px-3 py-2 text-center text-[11px] text-muted-foreground">
                      عرض أول 200 صف فقط — سيتم استيراد {parsed.data.length} صفاً كاملةً.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            إلغاء
          </Button>
          <Button
            onClick={() => importMut.mutate()}
            disabled={!parsed.data.length || importMut.isPending || !projectId}
          >
            {importMut.isPending ? "جاري الاستيراد…" : `استيراد ${parsed.data.length || ""} بنداً`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
