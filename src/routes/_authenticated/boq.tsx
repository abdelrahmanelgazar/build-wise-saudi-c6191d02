import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { estimationClient } from "@/lib/estimation-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { FolderPlus, Plus, Download, Layers, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import { CSI_DIVISIONS } from "@/lib/csi-divisions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportBoq } from "@/lib/boq-export";
import { separateCategoryAndRate } from "@/lib/boq-header-mapping";
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
import { computeDirectUnitCost, computeUnitSellingPrice, type ResourceCostInput } from "@/lib/estimation-calc";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";

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
        // Prefer the unit selling price computed from price analysis when present (even if 0);
        // otherwise fall back to the per-row cost breakdown columns.
        const fromPa = paSellingRates.get(n.id);
        n.unitRate =
          typeof fromPa === "number"
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

  useRegisterPageActions({
    pageKey: "boq",
    hasEditableState: true,
    queryKeys: [["boq_items", projectId], ["pa_items_project", projectId], ["pa_markup_project", projectId], ["project", projectId]],
    onSave: async () => {
      await qc.invalidateQueries({ queryKey: ["boq_items", projectId] });
      await qc.invalidateQueries({ queryKey: ["pa_items_project", projectId] });
    },
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["boq_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data, error } = await estimationClient
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
      const { data, error } = await estimationClient
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
    const headers = Array.isArray(h) ? h : Array.isArray(h[activeSheet]) ? h[activeSheet] : [];
    const storedPreHeaders = project?.excel_pre_headers as any;
    const preHeaders = Array.isArray(storedPreHeaders) ? storedPreHeaders : storedPreHeaders?.[activeSheet] ?? [];
    if (!headers.every((header: any) => typeof header === "object" && header !== null)) return headers;
    return separateCategoryAndRate(headers, preHeaders);
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
      const { data, error } = await estimationClient
        .from("price_analysis_items")
        .select("boq_item_id, resource_type, quantity, unit_price, waste_pct, productivity, cell_styles")
        .eq("project_id", projectId);
      if (error) throw error;
      return data as Array<ResourceCostInput & { boq_item_id: string }>;
    },
  });

  const { data: paMarkups = [] } = useQuery({
    queryKey: ["pa_markup_project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data, error } = await estimationClient
        .from("price_analysis_markup")
        .select("boq_item_id, indirect_pct, overhead_pct, risk_pct, profit_pct, manual_unit_price, round_up_rate, pricing_policy")
        .eq("project_id", projectId);
      if (error) throw error;
      return data as {
        boq_item_id: string;
        indirect_pct: number;
        overhead_pct: number;
        risk_pct: number;
        profit_pct: number;
        manual_unit_price?: number | null;
        round_up_rate?: boolean;
        pricing_policy?: string;
      }[];
    },
  });

  const paRates = useMemo(() => {
    const grouped = new Map<string, Array<ResourceCostInput>>();
    paItems.forEach((r) => {
      const list = grouped.get(r.boq_item_id) ?? [];
      list.push(r);
      grouped.set(r.boq_item_id, list);
    });
    const direct = new Map<string, number>();
    grouped.forEach((list, id) => {
      direct.set(id, computeDirectUnitCost(list).directUnitCost);
    });
    const markupBy = new Map(paMarkups.map((m) => [m.boq_item_id, m]));
    const selling = new Map<string, number>();
    direct.forEach((cost, id) => {
      const m = markupBy.get(id);
      const res = computeUnitSellingPrice(cost, {
        ...(m as any),
        pricing_policy: (m as any)?.pricing_policy ?? "additive_v2",
        round_up_rate: (m as any)?.round_up_rate ?? true,
      });
      selling.set(id, res.unitSellingPrice);
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
          typeof paDirect === "number"
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
      const { error } = await estimationClient.from("boq_items").delete().eq("id", id);
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

  const [isInitializingCsi, setIsInitializingCsi] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await qc.invalidateQueries();
      toast.success("تم تحديث البيانات وتطبيق التعديلات بنجاح");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleClearCurrentBoq = async () => {
    if (!projectId) return;
    setIsClearing(true);
    try {
      const { error } = await estimationClient
        .from("boq_items")
        .delete()
        .eq("project_id", projectId);
      if (error) throw error;

      await estimationClient
        .from("projects")
        .update({
          excel_headers: {} as unknown as never,
          excel_pre_headers: {} as unknown as never,
          excel_sheets_order: [] as unknown as never,
        })
        .eq("id", projectId);

      toast.success("تم إفراغ جدول الكميات بالكامل بنجاح");
      setClearDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["boq_items"] });
      qc.invalidateQueries({ queryKey: ["project_stats"] });
      qc.invalidateQueries({ queryKey: ["pa_rates"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsClearing(false);
    }
  };

  async function handleInitCsiDivisions() {
    if (!projectId) {
      toast.error(t("boq.selectProjectFirst", "اختر مشروعاً أولاً"));
      return;
    }
    const standardMainDivisions = [
      { code: "01", name_ar: "القسم الأول — المتطلبات العامة للمشروع", name_en: "General Requirements" },
      { code: "02", name_ar: "القسم الثاني — أعمال الموقع والظروف القائمة", name_en: "Existing Conditions" },
      { code: "03", name_ar: "القسم الثالث — الأعمال الخرسانية", name_en: "Concrete Works" },
      { code: "04", name_ar: "القسم الرابع — أعمال المباني والبلوك", name_en: "Masonry Works" },
      { code: "05", name_ar: "القسم الخامس — الأعمال المعدنية والإنشائية", name_en: "Metals" },
      { code: "06", name_ar: "القسم السادس — أعمال الخشب والبلاستيك", name_en: "Wood & Plastics" },
      { code: "07", name_ar: "القسم السابع — العزل وحماية الحرارة والرطوبة", name_en: "Thermal & Moisture" },
      { code: "08", name_ar: "القسم الثامن — الأبواب والنوافذ والواجهات", name_en: "Openings & Windows" },
      { code: "09", name_ar: "القسم التاسع — أعمال التشطيبات والدهانات", name_en: "Finishes" },
      { code: "10", name_ar: "القسم العاشر — الأعمال التخصصية", name_en: "Specialties" },
      { code: "11", name_ar: "القسم الحادي عشر — المعدات والأجهزة", name_en: "Equipment" },
      { code: "12", name_ar: "القسم الثاني عشر — التأثيث والمفروشات", name_en: "Furnishings" },
      { code: "14", name_ar: "القسم الرابع عشر — أنظمة النقل والمصاعد", name_en: "Conveying Systems" },
      { code: "21", name_ar: "القسم الحادي والعشرون — أنظمة مكافحة الحريق", name_en: "Fire Suppression" },
      { code: "22", name_ar: "القسم الثاني والعشرون — الأعمال الصحية والسباكة", name_en: "Plumbing" },
      { code: "23", name_ar: "القسم الثالث والعشرون — التكييف والتهوية (HVAC)", name_en: "HVAC" },
      { code: "26", name_ar: "القسم السادس والعشرون — الأعمال الكهربائية والإنارة", name_en: "Electrical" },
    ];

    try {
      setIsInitializingCsi(true);
      const { data: userData } = await estimationClient.auth.getUser();
      const user_id = userData.user?.id || "00000000-0000-0000-0000-000000000000";

      const { data: existing } = await estimationClient
        .from("boq_items")
        .select("item_no")
        .eq("project_id", projectId)
        .eq("is_group", true);

      const existingCodes = new Set((existing || []).map((e) => e.item_no));
      const toInsert = standardMainDivisions
        .filter((d) => !existingCodes.has(d.code))
        .map((d, idx) => ({
          user_id,
          project_id: projectId,
          item_no: d.code,
          description_ar: d.name_ar,
          description_en: d.name_en,
          is_group: true,
          level: 0,
          sort_order: Number(d.code) * 10 || (idx + 1) * 10,
        }));

      if (toInsert.length === 0) {
        toast.info("جميع أقسام CSI الرئيسية موجودة بالفعل في هذا المشروع.");
        return;
      }

      const { error } = await estimationClient.from("boq_items").insert(toInsert);
      if (error) throw error;

      await qc.invalidateQueries({ queryKey: ["boq_items"] });
      toast.success(`تمت إضافة ${toInsert.length} قسم من أقسام CSI بنجاح!`);
    } catch (err: any) {
      toast.error(err.message || "فشل تهيئة أقسام CSI");
    } finally {
      setIsInitializingCsi(false);
    }
  }

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

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-1.5"
              title="تحديث البيانات وحفظ التعديلات"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
              {isRefreshing ? "جاري التحديث..." : "تحديث وحفظ"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearDialogOpen(true)}
              disabled={rows.length === 0 || !projectId}
              className="gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30"
              title="تفريغ أو إزالة جدول الكميات الحالي لهذا المشروع"
            >
              <Trash2 className="h-4 w-4" />
              إزالة الجدول الحالي
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleInitCsiDivisions}
              disabled={isInitializingCsi || !projectId}
              className="gap-1.5"
              title="إنشاء كافة مجموعات أقسام CSI القياسية دفعة واحدة في جدول الكميات"
            >
              <Layers className="h-4 w-4 text-primary" />
              {isInitializingCsi ? "جاري التهيئة..." : "تهيئة أقسام CSI"}
            </Button>
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

      {/* Clear BOQ Confirmation Dialog */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              إفراغ جدول الكميات الحالي
            </DialogTitle>
            <DialogDescription className="leading-relaxed text-xs pt-2">
              هل أنت متأكد من حذف كافة بنود جدول الكميات لمشروع ({project?.name || "المشروع"})؟
              <br />
              <span className="font-semibold text-foreground mt-1 inline-block">
                سيتم حذف {rows.length} بند ومجموعة مع كافة تحليلات الأسعار المرتبطة بها.
              </span>
              <br />
              <span className="text-[11px] text-muted-foreground mt-1 block">
                لا يمكن التراجع عن هذا الإجراء. يمكنك بعد ذلك إضافة بنود جديدة أو استيراد ملف إكسل نظيف.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setClearDialogOpen(false)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isClearing}
              onClick={handleClearCurrentBoq}
              className="gap-1.5 font-semibold"
            >
              <Trash2 className="h-4 w-4" />
              {isClearing ? "جاري الحذف..." : "تأكيد إفراغ الجدول"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const [unit, setUnit] = useState("م³");
  const [qty, setQty] = useState("");
  const [mc, setMc] = useState("");
  const [lc, setLc] = useState("");
  const [ec, setEc] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const qc = useQueryClient();

  const projectId = useActiveProjectId();

  const handleParentSelect = (val: string) => {
    setParentId(val);
    if (!itemNo || itemNo === "1" || /^\d{2}\.\d{2}$/.test(itemNo)) {
      if (val.startsWith("csi_")) {
        const code = val.replace("csi_", "");
        setItemNo(`${code}.01`);
      } else if (val && val !== "none") {
        const found = parentOptions.find((p) => p.id === val);
        if (found?.item_no) {
          setItemNo(`${found.item_no}.01`);
        }
      }
    }
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data: userData } = await estimationClient.auth.getUser();
      const user_id = userData.user?.id || "00000000-0000-0000-0000-000000000000";

      let finalParentId: string | null = null;
      let level = 0;

      if (parentId && parentId !== "none") {
        if (parentId.startsWith("csi_")) {
          const code = parentId.replace("csi_", "");
          const div = CSI_DIVISIONS.find((d) => d.code === code);

          // Check if this CSI group already exists in the project
          const { data: allGroups } = await estimationClient
            .from("boq_items")
            .select("id, item_no")
            .eq("project_id", projectId)
            .eq("is_group", true);

          const existingGroup = (allGroups as Array<{ id: string; item_no: string }> | null)?.find(
            (g) => g.item_no === code || g.item_no?.startsWith(code + " ") || g.item_no?.startsWith(code + "-")
          );

          if (existingGroup) {
            finalParentId = existingGroup.id;
          } else {
            // Auto-create the CSI division group
            const { data: createdGroup, error: grpErr } = await estimationClient
              .from("boq_items")
              .insert({
                user_id,
                project_id: projectId,
                item_no: code,
                description_ar: `القسم ${code} — ${div?.name_ar || "أعمال المشروع"}`,
                description_en: div?.name_en || null,
                is_group: true,
                level: 0,
                sort_order: Number(code) * 10 || 100,
              })
              .select("id")
              .single();
            if (grpErr) throw grpErr;
            finalParentId = (createdGroup as any)?.id;
          }
          level = 1;
        } else {
          finalParentId = parentId;
          level = 1;
        }
      }

      const { error } = await estimationClient.from("boq_items").insert({
        user_id,
        project_id: projectId,
        parent_id: finalParentId,
        item_no: itemNo,
        description_ar: desc,
        unit: isGroup ? null : unit || null,
        quantity: isGroup ? 0 : Number(qty) || 0,
        material_cost: Number(mc) || 0,
        labor_cost: Number(lc) || 0,
        equipment_cost: Number(ec) || 0,
        is_group: isGroup,
        level: isGroup ? 0 : level,
        sort_order: 999,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isGroup ? "تمت إضافة المجموعة" : "تمت إضافة البند بنجاح");
      qc.invalidateQueries({ queryKey: ["boq_items"] });
      setOpen(false);
      setItemNo(""); setDesc(""); setUnit("م³"); setQty(""); setMc(""); setLc(""); setEc(""); setParentId("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Filter custom groups not matching CSI codes
  const customGroups = parentOptions.filter((p) => !CSI_DIVISIONS.some((d) => d.code === p.item_no));

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
              <Label>المجموعة الأم (جميع أقسام الـ CSI = المجموعات)</Label>
              <Select value={parentId} onValueChange={handleParentSelect}>
                <SelectTrigger>
                  <SelectValue placeholder={isGroup ? "بدون (مستوى أعلى)" : "اختر قسم CSI أو مجموعة"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">
                    {isGroup ? "بدون مجموعة (مستوى رئيسي أعلى)" : "بدون مجموعة (بند مستقل)"}
                  </SelectItem>

                  {/* Standard CSI Divisions */}
                  <div className="px-2 py-1 text-[11px] font-bold text-primary bg-primary/10 rounded my-1">
                    جميع أقسام الـ CSI القياسية (المجموعات MasterFormat)
                  </div>
                  {CSI_DIVISIONS.map((div) => {
                    const existing = parentOptions.find(
                      (p) => p.item_no === div.code || p.item_no?.startsWith(div.code + " ") || p.item_no?.startsWith(div.code + "-")
                    );
                    const val = existing ? existing.id : `csi_${div.code}`;
                    return (
                      <SelectItem key={`csi_${div.code}`} value={val}>
                        القسم {div.code} — {div.name_ar} {existing ? "✓ (موجودة)" : ""}
                      </SelectItem>
                    );
                  })}

                  {/* Other Custom Groups in Project */}
                  {customGroups.length > 0 && (
                    <>
                      <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground bg-muted/40 rounded my-1">
                        مجموعات مخصصة أخرى بالمشروع
                      </div>
                      {customGroups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.item_no} — {g.description_ar}
                        </SelectItem>
                      ))}
                    </>
                  )}
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
