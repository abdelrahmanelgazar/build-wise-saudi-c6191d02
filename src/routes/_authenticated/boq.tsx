import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderPlus, Plus, Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportBoq } from "@/lib/boq-export";
import { PageHeader } from "./resources";
import { fmtSAR } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";
import { useActiveProjectId } from "@/lib/active-project";
import { ImportExcelDialog } from "@/components/boq/import-excel-dialog";
import { BoqGrid, type TreeNode } from "@/components/boq/boq-grid";
import { useLanguage } from "@/lib/i18n";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];

export const Route = createFileRoute("/_authenticated/boq")({
  head: () => ({ meta: [{ title: 'جدول الكميات — تقديري' }, { name: "description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:title", content: 'جدول الكميات — تقديري' }, { property: "og:description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: BoqPage,
});


function buildTree(
  rows: BoqRow[],
  paSellingRates: Map<string, number>,
  sheetTotals?: Record<string, number>
): TreeNode[] {
  const map = new Map<string, TreeNode>();
  rows.forEach((r) =>
    map.set(r.id, { ...r, children: [], rolledTotal: 0, unitRate: 0 }),
  );
  const roots: TreeNode[] = [];
  rows.forEach((r) => {
    const node = map.get(r.id);
    if (!node) return;
    if (r.parent_id && map.has(r.parent_id)) {
      map.get(r.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (arr: TreeNode[]) => {
    arr.sort((a, b) => a.sort_order - b.sort_order);
    arr.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  const computeTotal = (n: TreeNode): number => {
    if (n.is_group) {
      n.unitRate = 0;
      n.rolledTotal = n.children.reduce((s, c) => s + computeTotal(c), 0);
    } else {
      if (sheetTotals && n.description_ar && sheetTotals[n.description_ar] !== undefined) {
        n.rolledTotal = sheetTotals[n.description_ar] ?? 0;
        n.unitRate = Number(n.quantity) ? n.rolledTotal / Number(n.quantity) : n.rolledTotal;
      } else {
        // Prefer the unit selling price computed from price analysis when present;
        // otherwise fall back to the per-row cost breakdown columns.
        const fromPa = paSellingRates.get(n.id);
        n.unitRate =
          typeof fromPa === "number" && fromPa > 0
            ? fromPa
            : Number(n.material_cost ?? 0) +
              Number(n.labor_cost ?? 0) +
              Number(n.equipment_cost ?? 0) +
              Number(n.subcontractor_cost ?? 0);
        n.rolledTotal = n.unitRate * Number(n.quantity ?? 0);
      }
    }
    return n.rolledTotal;
  };
  roots.forEach(computeTotal);
  return roots;
}

function BoqPage() {
  const { t, language } = useLanguage();
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeSheet, setActiveSheet] = useState<string>("");

  const { data: rows = [] } = useQuery({
    queryKey: ["boq_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data, error } = await supabase
        .from("boq_items")
        .select("*")
        .eq("project_id", projectId);
      if (error) throw error;
      return data as BoqRow[];
    },
  });

  const { isLoading: isProjLoading, data: project } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, excel_headers, excel_pre_headers, excel_sheets_order")
        .eq("id", projectId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const sheetNames = useMemo(() => {
    let names = Array.from(new Set(rows.map((r) => r.sheet_name || "Sheet1")));
    if (names.length === 0) names.push("Sheet1");
    
    // Sort based on original excel_sheets_order if available
    const order = project?.excel_sheets_order;
    if (Array.isArray(order) && order.length > 0) {
      names.sort((a, b) => {
        const idxA = order.indexOf(a);
        const idxB = order.indexOf(b);
        // If not found in order array, put them at the end
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    }
    return names;
  }, [rows, project?.excel_sheets_order]);

  useEffect(() => {
    if (!activeSheet && sheetNames.length > 0) {
      setActiveSheet(sheetNames[0] ?? "Sheet1");
    } else if (activeSheet && !sheetNames.includes(activeSheet) && sheetNames.length > 0) {
      setActiveSheet(sheetNames[0] ?? "Sheet1");
    }
  }, [sheetNames, activeSheet]);

  const activeRows = useMemo(() => rows.filter(r => (r.sheet_name || "Sheet1") === activeSheet), [rows, activeSheet]);

  const extraHeaders = useMemo(() => {
    const h = (project?.excel_headers as any);
    if (!h) return [];
    if (Array.isArray(h)) return h;
    return Array.isArray(h[activeSheet]) ? h[activeSheet] : [];
  }, [project, activeSheet]);

  const extraPreHeaders = useMemo(() => {
    const h = (project?.excel_pre_headers as any);
    if (!h) return [];
    if (Array.isArray(h)) return h;
    return Array.isArray(h[activeSheet]) ? h[activeSheet] : [];
  }, [project, activeSheet]);

  // Pull all price-analysis rows + markup for this project to compute the
  // per-item unit selling price displayed in the BOQ "rate" column.
  const { data: paItems = [] } = useQuery({
    queryKey: ["pa_items_project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data, error } = await supabase
        .from("price_analysis_items")
        .select("boq_item_id, quantity, unit_price")
        .eq("project_id", projectId);
      if (error) throw error;
      return data as { boq_item_id: string; quantity: number; unit_price: number }[];
    },
  });

  const { data: paMarkups = [] } = useQuery({
    queryKey: ["pa_markup_project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data, error } = await supabase
        .from("price_analysis_markup")
        .select("boq_item_id, indirect_pct, overhead_pct, risk_pct, profit_pct")
        .eq("project_id", projectId);
      if (error) throw error;
      return data as {
        boq_item_id: string;
        indirect_pct: number;
        overhead_pct: number;
        risk_pct: number;
        profit_pct: number;
      }[];
    },
  });

  const paRates = useMemo(() => {
    const direct = new Map<string, number>();
    paItems.forEach((r) => {
      direct.set(
        r.boq_item_id,
        (direct.get(r.boq_item_id) ?? 0) + Number(r.quantity) * Number(r.unit_price),
      );
    });
    const markupBy = new Map(paMarkups.map((m) => [m.boq_item_id, m]));
    const selling = new Map<string, number>();
    direct.forEach((cost, id) => {
      const m = markupBy.get(id);
      const indirect = Number(m?.indirect_pct ?? 0);
      const overhead = Number(m?.overhead_pct ?? 0);
      const risk = Number(m?.risk_pct ?? 0);
      const profit = Number(m?.profit_pct ?? 0);
      const s1 = cost * (1 + indirect / 100);
      const s2 = s1 * (1 + overhead / 100);
      const s3 = s2 * (1 + risk / 100);
      selling.set(id, s3 * (1 + profit / 100));
    });
    return { direct, selling };
  }, [paItems, paMarkups]);

  const sheetTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const name of sheetNames) {
      const rowsForSheet = rows.filter(r => (r.sheet_name || "Sheet1") === name);
      const builtTree = buildTree(rowsForSheet, paRates.selling);
      totals[name] = builtTree.reduce((s, n) => s + n.rolledTotal, 0);
    }
    return totals;
  }, [rows, sheetNames, paRates.selling]);

  useMemo(() => {
    if (activeRows.length && expanded.size === 0) {
      setExpanded(new Set(activeRows.filter((r) => r.is_group).map((r) => r.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRows.length]);

  const tree = useMemo(() => buildTree(activeRows, paRates.selling, sheetTotals), [activeRows, paRates.selling, sheetTotals]);
  const grandTotal = tree.reduce((s, n) => s + n.rolledTotal, 0);
  const itemsCount = activeRows.filter((r) => !r.is_group).length;
  const groupsCount = activeRows.filter((r) => r.is_group).length;

  const totalDirectCost = useMemo(() => {
    return activeRows
      .filter((r) => !r.is_group)
      .reduce((sum, r) => {
        const paDirect = paRates.direct.get(r.id);
        const unitCost =
          typeof paDirect === "number" && paDirect > 0
            ? paDirect
            : Number(r.material_cost ?? 0) +
              Number(r.labor_cost ?? 0) +
              Number(r.equipment_cost ?? 0) +
              Number(r.subcontractor_cost ?? 0);
        return sum + unitCost * Number(r.quantity ?? 0);
      }, 0);
  }, [activeRows, paRates.direct]);

  const markupMargin = totalDirectCost > 0 ? ((grandTotal - totalDirectCost) / totalDirectCost) * 100 : 0;

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("boq_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["boq_items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const flatRows = useMemo(() => {
    const out: { node: TreeNode; depth: number; visible: boolean }[] = [];
    const walk = (nodes: TreeNode[], depth: number, parentVisible: boolean) => {
      nodes.forEach((n) => {
        out.push({ node: n, depth, visible: parentVisible });
        const childVisible = parentVisible && (n.is_group ? expanded.has(n.id) : true);
        walk(n.children, depth + 1, childVisible);
      });
    };
    walk(tree, 0, true);
    return out.filter((r) => r.visible).map(({ node, depth }) => ({ node, depth }));
  }, [tree, expanded]);

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">{t("boq.selectProjectPrompt", "اختر مشروعاً للبدء")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("boq.selectProjectDesc", "بنود جدول الكميات تنتمي لمشروع. اختر مشروعاً من القائمة الجانبية أو أنشئ مشروعاً جديداً.")}
          </p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>{t("boq.goToProjects", "الذهاب للمشاريع")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col p-6">
      <PageHeader
        title={t("boq.title", "جدول الكميات (BOQ)")}
        subtitle={t("boq.subtitle", "جدول تفاعلي مشابه لإكسل — أعمدة قابلة للتغيير، خلايا قابلة للتحرير، وسعر الوحدة يفتح تحليل الأسعار.")}
        action={
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" disabled={flatRows.length === 0}>
                  <Download className="h-4 w-4" />
                  {t("common.export", "تصدير")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportBoq(project?.name || "BOQ", rows, paRates.selling, project?.excel_headers, project?.excel_pre_headers, "xlsx")}>
                  {t("common.toExcel", "إلى إكسل (.xlsx)")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportBoq(project?.name || "BOQ", rows, paRates.selling, project?.excel_headers, project?.excel_pre_headers, "csv")}>
                  {t("common.toCsv", "إلى (.csv)")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ImportExcelDialog />
            <NewBoqDialog isGroup parentOptions={tree} />
            <NewBoqDialog parentOptions={tree} />
          </div>
        }
      />

      <div className="mt-2 flex flex-col gap-3">
        {sheetNames.length > 1 && (
          <div className="flex w-full md:w-80">
            <Select value={activeSheet || ""} onValueChange={(v) => setActiveSheet(v)}>
              <SelectTrigger className="w-full font-bold bg-card border-border/50">
                <SelectValue placeholder={t("boq.selectSheet", "اختر الصفحة (Sheet)")} />
              </SelectTrigger>
              <SelectContent>
                {sheetNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 bg-muted/30 p-2.5 rounded-lg border border-border/50">
          <div className="flex flex-wrap items-center gap-6 px-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("boq.sellingPrice", "سعر البيع")}:</span>
              <span className="font-bold tabular-nums text-base text-primary">{fmtSAR(grandTotal, language)}</span>
            </div>
            <div className="w-px h-6 bg-border/60 hidden sm:block"></div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("common.directCost", "التكلفة المباشرة")}:</span>
              <span className="font-bold tabular-nums text-sm">{fmtSAR(totalDirectCost, language)}</span>
            </div>
            <div className="w-px h-6 bg-border/60 hidden sm:block"></div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("boq.markupRate", "هامش الزيادة")}:</span>
              <span className="font-bold tabular-nums text-sm text-emerald-600 dark:text-emerald-400">{markupMargin.toFixed(2)}%</span>
            </div>
            <div className="w-px h-6 bg-border/60 hidden sm:block"></div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("common.rows", "الصفوف")}:</span>
              <span className="font-medium tabular-nums text-sm">{itemsCount + groupsCount}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col overflow-hidden">
        <BoqGrid
          flatRows={flatRows}
          expanded={expanded}
          onToggle={toggle}
          onDelete={(n) => {
            if (
              confirm(`حذف ${n.is_group ? "المجموعة" : "البند"} «${n.description_ar}»؟`)
            ) {
              delMut.mutate(n.id);
            }
          }}
          extraHeaders={extraHeaders as any}
          projectId={projectId}
          grandTotal={grandTotal}
        />
      </div>
    </div>
  );
}


function KpiCard({ label, value, accent, className }: { label: string; value: string; accent?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3 flex flex-col justify-center",
        accent && "border-primary/30 bg-primary/5",
        className
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}


function NewBoqDialog({
  isGroup = false,
  parentOptions,
}: {
  isGroup?: boolean;
  parentOptions: TreeNode[];
}) {
  const [open, setOpen] = useState(false);
  const [itemNo, setItemNo] = useState("");
  const [desc, setDesc] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("");
  const [mc, setMc] = useState("");
  const [lc, setLc] = useState("");
  const [ec, setEc] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const qc = useQueryClient();

  const projectId = useActiveProjectId();

  const mut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData.user?.id;
      if (!user_id) throw new Error("غير مسجل دخول");
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const level = parentId ? 1 : 0;
      const { error } = await supabase.from("boq_items").insert({
        user_id,
        project_id: projectId,
        parent_id: parentId || null,
        item_no: itemNo,
        description_ar: desc,
        unit: isGroup ? null : unit,
        quantity: isGroup ? 0 : Number(qty) || 0,
        material_cost: Number(mc) || 0,
        labor_cost: Number(lc) || 0,
        equipment_cost: Number(ec) || 0,
        is_group: isGroup,
        level,
        sort_order: 999,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isGroup ? "تمت إضافة المجموعة" : "تمت إضافة البند");
      qc.invalidateQueries({ queryKey: ["boq_items"] });
      setOpen(false);
      setItemNo(""); setDesc(""); setUnit(""); setQty(""); setMc(""); setLc(""); setEc("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={isGroup ? "outline" : "default"} className="gap-1.5">
          {isGroup ? <FolderPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {isGroup ? "مجموعة جديدة" : "بند جديد"}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isGroup ? "إضافة مجموعة" : "إضافة بند"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>رقم البند</Label>
              <Input value={itemNo} onChange={(e) => setItemNo(e.target.value)} placeholder="01.05" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>المجموعة الأم</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger>
                  <SelectValue placeholder={isGroup ? "بدون (مستوى أعلى)" : "اختر مجموعة"} />
                </SelectTrigger>
                <SelectContent>
                  {parentOptions.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.item_no} — {g.description_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>الوصف</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} required />
          </div>
          {!isGroup && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>الوحدة</Label>
                  <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="م³" />
                </div>
                <div className="space-y-1.5">
                  <Label>الكمية</Label>
                  <Input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>تكلفة المواد</Label>
                  <Input type="number" step="0.01" value={mc} onChange={(e) => setMc(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>تكلفة العمالة</Label>
                  <Input type="number" step="0.01" value={lc} onChange={(e) => setLc(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>تكلفة المعدات</Label>
                  <Input type="number" step="0.01" value={ec} onChange={(e) => setEc(e.target.value)} />
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !itemNo || !desc}>
            {mut.isPending ? "جاري الحفظ…" : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
