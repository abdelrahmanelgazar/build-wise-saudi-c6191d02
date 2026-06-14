import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];

export const Route = createFileRoute("/_authenticated/boq")({
  head: () => ({ meta: [{ title: "جدول الكميات — تقديري" }] }),
  component: BoqPage,
});


function buildTree(
  rows: BoqRow[],
  paUnitRates: Map<string, number>,
): TreeNode[] {
  const map = new Map<string, TreeNode>();
  rows.forEach((r) =>
    map.set(r.id, { ...r, children: [], rolledTotal: 0, unitRate: 0 }),
  );
  const roots: TreeNode[] = [];
  rows.forEach((r) => {
    const node = map.get(r.id)!;
    if (r.parent_id && map.has(r.parent_id)) {
      map.get(r.parent_id)!.children.push(node);
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
      // Prefer the unit selling price computed from price analysis when present;
      // otherwise fall back to the per-row cost breakdown columns.
      const fromPa = paUnitRates.get(n.id);
      n.unitRate =
        typeof fromPa === "number" && fromPa > 0
          ? fromPa
          : Number(n.material_cost ?? 0) +
            Number(n.labor_cost ?? 0) +
            Number(n.equipment_cost ?? 0) +
            Number(n.subcontractor_cost ?? 0);
      n.rolledTotal = n.unitRate * Number(n.quantity ?? 0);
    }
    return n.rolledTotal;
  };
  roots.forEach(computeTotal);
  return roots;
}

function BoqPage() {
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: rows = [] } = useQuery({
    queryKey: ["boq_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boq_items")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data as BoqRow[];
    },
  });

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, excel_headers, excel_pre_headers")
        .eq("id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const extraHeaders = useMemo(() => {
    const h = (project?.excel_headers as unknown) ?? [];
    return Array.isArray(h) ? h : [];
  }, [project]);

  const extraPreHeaders = useMemo(() => {
    const h = (project?.excel_pre_headers as unknown) ?? [];
    return Array.isArray(h) ? h : [];
  }, [project]);

  // Pull all price-analysis rows + markup for this project to compute the
  // per-item unit selling price displayed in the BOQ "rate" column.
  const { data: paItems = [] } = useQuery({
    queryKey: ["pa_items_project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_analysis_items")
        .select("boq_item_id, quantity, unit_price")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data as { boq_item_id: string; quantity: number; unit_price: number }[];
    },
  });

  const { data: paMarkups = [] } = useQuery({
    queryKey: ["pa_markup_project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_analysis_markup")
        .select("boq_item_id, indirect_pct, overhead_pct, risk_pct, profit_pct")
        .eq("project_id", projectId!);
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

  const paUnitRates = useMemo(() => {
    const direct = new Map<string, number>();
    paItems.forEach((r) => {
      direct.set(
        r.boq_item_id,
        (direct.get(r.boq_item_id) ?? 0) + Number(r.quantity) * Number(r.unit_price),
      );
    });
    const markupBy = new Map(paMarkups.map((m) => [m.boq_item_id, m]));
    const out = new Map<string, number>();
    direct.forEach((cost, id) => {
      const m = markupBy.get(id);
      const indirect = Number(m?.indirect_pct ?? 5);
      const overhead = Number(m?.overhead_pct ?? 8);
      const risk = Number(m?.risk_pct ?? 3);
      const profit = Number(m?.profit_pct ?? 10);
      const s1 = cost * (1 + indirect / 100);
      const s2 = s1 * (1 + overhead / 100);
      const s3 = s2 * (1 + risk / 100);
      out.set(id, s3 * (1 + profit / 100));
    });
    return out;
  }, [paItems, paMarkups]);

  useMemo(() => {
    if (rows.length && expanded.size === 0) {
      setExpanded(new Set(rows.filter((r) => r.is_group).map((r) => r.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const tree = useMemo(() => buildTree(rows, paUnitRates), [rows, paUnitRates]);
  const grandTotal = tree.reduce((s, n) => s + n.rolledTotal, 0);
  const itemsCount = rows.filter((r) => !r.is_group).length;
  const groupsCount = rows.filter((r) => r.is_group).length;

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
          <h2 className="mt-3 text-lg font-semibold">اختر مشروعاً للبدء</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            بنود جدول الكميات تنتمي لمشروع. اختر مشروعاً من القائمة الجانبية أو أنشئ مشروعاً جديداً.
          </p>
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
        title="جدول الكميات (BOQ)"
        subtitle="جدول تفاعلي مشابه لإكسل — أعمدة قابلة للتغيير، خلايا قابلة للتحرير، وسعر الوحدة يفتح تحليل الأسعار."
        action={
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" disabled={flatRows.length === 0}>
                  <Download className="h-4 w-4" />
                  تصدير
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportBoq(project?.name || "BOQ", flatRows, extraHeaders as any, extraPreHeaders, "xlsx")}>
                  إلى إكسل (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportBoq(project?.name || "BOQ", flatRows, extraHeaders as any, extraPreHeaders, "csv")}>
                  إلى (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ImportExcelDialog />
            <NewBoqDialog isGroup parentOptions={tree} />
            <NewBoqDialog parentOptions={tree} />
          </div>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="إجمالي المجموعات" value={String(groupsCount)} />
        <KpiCard label="إجمالي البنود" value={String(itemsCount)} />
        <KpiCard label="إجمالي تكلفة المشروع" value={fmtSAR(grandTotal)} accent />
        <KpiCard
          label="متوسط تكلفة البند"
          value={itemsCount ? fmtSAR(grandTotal / itemsCount) : "—"}
        />
      </div>

      <div className="mt-5 flex flex-1 flex-col overflow-hidden">
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
          extraHeaders={extraHeaders}
          projectId={projectId}
        />
      </div>
    </div>
  );
}


function KpiCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3",
        accent && "border-primary/30 bg-primary/5",
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
