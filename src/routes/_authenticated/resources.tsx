import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Pencil, Plus, Search, Trash2, X, Boxes, Hammer, Truck, FileText, Filter } from "lucide-react";
import { fmtSAR } from "@/lib/format";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { useActiveProjectId } from "@/lib/active-project";
import { Link } from "@tanstack/react-router";
import { FolderPlus } from "lucide-react";
import { useDivisions } from "@/lib/divisions";
import { useLanguage } from "@/lib/i18n";

type ResourceRow = Database["public"]["Tables"]["resources"]["Row"] & {
  division?: string | null;
};
type ResourceType = Database["public"]["Enums"]["resource_type"];
type QuotationTab = "subcontractor" | "equipment" | "labor" | "material" | "general_requirements";

export const Route = createFileRoute("/_authenticated/resources")({
  head: () => ({ meta: [{ title: 'عروض الأسعار — تقديري' }, { name: "description", content: 'منصة تقديري لإدارة عروض أسعار الموردين ومقاولي الباطن وتصنيف CSI MasterFormat في السوق السعودي.' }, { property: "og:title", content: 'عروض الأسعار — تقديري' }, { property: "og:description", content: 'منصة تقديري لإدارة عروض أسعار الموردين ومقاولي الباطن وتصنيف CSI MasterFormat في السوق السعودي.' }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: ResourcesPage,
});

const TAB_CONFIG: Record<QuotationTab, { labelKey: string; defaultLabel: string; icon: typeof Boxes; color: string; resourceType: ResourceType }> = {
  subcontractor: { labelKey: "resources.tabSubcontractor", defaultLabel: "مقاولو الباطن", icon: Truck, color: "text-chart-4", resourceType: "subcontractor" },
  equipment: { labelKey: "resources.tabEquipment", defaultLabel: "المعدات", icon: Truck, color: "text-primary", resourceType: "equipment" },
  labor: { labelKey: "resources.tabLabour", defaultLabel: "العمالة", icon: Hammer, color: "text-chart-3", resourceType: "labor" },
  material: { labelKey: "resources.tabMaterials", defaultLabel: "المواد", icon: Boxes, color: "text-chart-2", resourceType: "material" },
  general_requirements: { labelKey: "resources.tabGeneralRequirements", defaultLabel: "المتطلبات العامة للمشروع", icon: FileText, color: "text-amber-500", resourceType: "material" },
};

function ResourcesPage() {
  const { t, language } = useLanguage();
  const [tab, setTab] = useState<QuotationTab>("subcontractor");
  const [search, setSearch] = useState("");
  const [selectedDivisionFilter, setSelectedDivisionFilter] = useState<string>("all");
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const { divisions, rename, remove, labelFor } = useDivisions(projectId);

  const { data: resources = [], isLoading } = useQuery({
    queryKey: ["resources", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .eq("project_id", projectId)
        .order("division", { ascending: true, nullsFirst: false })
        .order("code", { ascending: true });
      if (error) throw error;
      return data as ResourceRow[];
    },
  });

  const ofType = useMemo(() => {
    if (tab === "general_requirements") {
      return resources.filter((r) => r.division === "01" || r.code?.startsWith("01-") || r.name_ar.includes("متطلبات عامة") || r.name_ar.includes("مكتب الموقع"));
    }
    return resources.filter((r) => r.type === tab);
  }, [resources, tab]);

  const filtered = useMemo(() => {
    return ofType.filter((r) => {
      const matchSearch =
        !search ||
        r.name_ar.includes(search) ||
        (r.name_en && r.name_en.toLowerCase().includes(search.toLowerCase())) ||
        (r.code ?? "").toLowerCase().includes(search.toLowerCase());

      const matchDiv = selectedDivisionFilter === "all" || r.division === selectedDivisionFilter;
      return matchSearch && matchDiv;
    });
  }, [ofType, search, selectedDivisionFilter]);

  // Group filtered by division, include every catalog division even when empty
  const grouped = useMemo(() => {
    const map = new Map<string, ResourceRow[]>();
    for (const d of divisions) {
      if (selectedDivisionFilter === "all" || d.code === selectedDivisionFilter) {
        map.set(d.code, []);
      }
    }
    for (const r of filtered) {
      const k = r.division ?? "";
      if (!map.has(k)) map.set(k, []);
      map.get(k)?.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  }, [filtered, divisions, selectedDivisionFilter]);

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("resources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("resources.deletedSuccess", "تم الحذف"));
      qc.invalidateQueries({ queryKey: ["resources"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">{t("resources.selectProjectPrompt", "اختر مشروعاً")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("resources.selectProjectDesc", "عروض الأسعار خاصة بكل مشروع. اختر مشروعاً من القائمة الجانبية للبدء.")}
          </p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>{t("boq.goToProjects", "الذهاب للمشاريع")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const currentTabConfig = TAB_CONFIG[tab];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={t("resources.title", "عروض الأسعار")}
        subtitle={t("resources.subtitle", "إدارة عروض أسعار الموردين ومقاولي الباطن وتصنيف CSI MasterFormat — تستخدم في تسعير البنود.")}
        action={
          <NewResourceDialog
            defaultType={currentTabConfig.resourceType}
            defaultDivision={tab === "general_requirements" ? "01" : undefined}
          />
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as QuotationTab)} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="bg-muted/50 p-1">
            {(Object.keys(TAB_CONFIG) as QuotationTab[]).map((tKey) => {
              const cfg = TAB_CONFIG[tKey];
              const Icon = cfg.icon;
              const count = tKey === "general_requirements"
                ? resources.filter((r) => r.division === "01" || r.code?.startsWith("01-")).length
                : resources.filter((r) => r.type === tKey).length;

              return (
                <TabsTrigger key={tKey} value={tKey} className="gap-2 text-xs font-medium">
                  <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  {t(cfg.labelKey as any, cfg.defaultLabel)}
                  <Badge
                    variant="secondary"
                    className="h-4 bg-background/80 px-1 text-[10px] font-mono"
                  >
                    {count}
                  </Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">CSI:</span>
              <Select value={selectedDivisionFilter} onValueChange={setSelectedDivisionFilter}>
                <SelectTrigger className="h-7 border-0 bg-transparent text-xs p-1 focus:ring-0">
                  <SelectValue placeholder={t("common.allDivisions", "جميع الأقسام")} />
                </SelectTrigger>
                <SelectContent className="max-h-60 text-xs">
                  <SelectItem value="all">{t("common.allDivisions", "جميع أقسام CSI")}</SelectItem>
                  {divisions.map((d) => (
                    <SelectItem key={d.code} value={d.code}>
                      Div {d.code} — {language === "en" && d.name_en ? d.name_en : d.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("resources.searchPlaceholder", "ابحث بالاسم، المورد، أو الكود…")}
                className="h-8 ps-8 text-xs"
              />
            </div>
          </div>
        </div>

        {(Object.keys(TAB_CONFIG) as QuotationTab[]).map((tKey) => (
          <TabsContent key={tKey} value={tKey} className="space-y-4">
            {isLoading && (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                {t("common.loading", "جاري التحميل…")}
              </div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
                {t("resources.emptySection", "لا توجد عناصر في هذا القسم بعد. أضف أول عنصر باستخدام زر «إضافة مورد».")}
              </div>
            )}
            {!isLoading &&
              grouped
                .filter(([_, rows]) => rows.length > 0 || selectedDivisionFilter !== "all")
                .map(([divCode, rows]) => (
                  <div key={divCode || "none"} className="overflow-hidden rounded-lg border border-border bg-card">
                    <DivisionHeader
                      code={divCode}
                      count={rows.length}
                      labelFor={labelFor}
                      onRename={rename}
                      onRemove={(c: string) => {
                        if (rows.length > 0) {
                          toast.error(t("resources.cannotDeleteDiv", "لا يمكن حذف قسم يحتوي على عناصر"));
                          return;
                        }
                        if (confirm(t("resources.deleteDivConfirm", `حذف القسم ${c}؟`))) remove(c);
                      }}
                    />
                    {rows.length > 0 ? (
                      <table className="w-full text-sm tabular-nums">
                        <thead className="bg-muted/20 text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2 text-start font-medium">{t("resources.colCode", "الكود")}</th>
                            <th className="px-4 py-2 text-start font-medium">{t("resources.colName", "الاسم / التوصيف")}</th>
                            <th className="px-4 py-2 text-start font-medium">{t("common.unit", "الوحدة")}</th>
                            <th className="px-4 py-2 text-start font-medium">{t("resources.colRate", "سعر الوحدة")}</th>
                            <th className="px-4 py-2 text-center font-medium">{t("resources.colActions", "إجراءات")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {rows.map((r) => (
                            <tr key={r.id} className="hover:bg-muted/20">
                              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                {r.code ?? "—"}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-foreground">
                                {language === "en" && r.name_en ? r.name_en : r.name_ar}
                              </td>
                              <td className="px-4 py-2.5 text-muted-foreground">{r.unit}</td>
                              <td className="px-4 py-2.5 font-semibold text-primary">
                                {fmtSAR(r.unit_price, language)}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center justify-center gap-1">
                                  <EditResourceDialog resource={r} />
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                      if (confirm(t("resources.deleteResourceConfirm", `حذف المورد «${r.name_ar}»؟`))) delMut.mutate(r.id);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-3 text-center text-xs text-muted-foreground">
                        لا توجد عناصر في هذا القسم
                      </div>
                    )}
                  </div>
                ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function NewResourceDialog({ defaultType, defaultDivision }: { defaultType: ResourceType; defaultDivision?: string | undefined }) {
  return <ResourceFormDialog mode="create" defaultType={defaultType} defaultDivision={defaultDivision} />;
}

function EditResourceDialog({ resource }: { resource: ResourceRow }) {
  return <ResourceFormDialog mode="edit" resource={resource} />;
}

function ResourceFormDialog({
  mode,
  resource,
  defaultType,
  defaultDivision,
}: {
  mode: "create" | "edit";
  resource?: ResourceRow;
  defaultType?: ResourceType;
  defaultDivision?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ResourceType>(resource?.type ?? defaultType ?? "material");
  const [division, setDivision] = useState<string>(resource?.division ?? defaultDivision ?? "");
  const [code, setCode] = useState(resource?.code ?? "");
  const [name, setName] = useState(resource?.name_ar ?? "");
  const [unit, setUnit] = useState(resource?.unit ?? "");
  const [price, setPrice] = useState<string>(String(resource?.unit_price ?? ""));
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const { divisions } = useDivisions(projectId);

  const mut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData.user?.id;
      if (!user_id) throw new Error("غير مسجل دخول");
      if (!projectId) throw new Error("اختر مشروعاً أولاً");
      const payload = {
        type,
        division: division || null,
        code: code || null,
        name_ar: name,
        unit,
        unit_price: Number(price) || 0,
      };
      if (mode === "edit" && resource) {
        const { error } = await supabase.from("resources").update(payload).eq("id", resource.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("resources").insert({ ...payload, user_id, project_id: projectId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(mode === "edit" ? "تم تحديث المورد" : "تمت إضافة المورد");
      qc.invalidateQueries({ queryKey: ["resources"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            إضافة مورد
          </Button>
        ) : (
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "تعديل المورد" : "إضافة مورد جديد"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>النوع</Label>
              <Select value={type} onValueChange={(v) => setType(v as ResourceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="material">مواد</SelectItem>
                  <SelectItem value="labor">عمالة</SelectItem>
                  <SelectItem value="equipment">معدات</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>الكود</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="M001" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>القسم</Label>
            <Select value={division || "none"} onValueChange={(v) => setDivision(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="اختر القسم" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="none">— بدون قسم —</SelectItem>
                {divisions.map((d) => (
                  <SelectItem key={d.code} value={d.code}>
                    القسم {d.code}{d.name_ar ? ` - ${d.name_ar}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>الاسم بالعربية</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>الوحدة</Label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="م³ / ساعة / طن"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>سعر الوحدة (ر.س)</Label>
              <Input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !name || !unit}>
            {mut.isPending ? "جاري الحفظ…" : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DivisionHeader({
  code,
  count,
  labelFor,
  onRename,
  onRemove,
}: {
  code: string;
  count: number;
  labelFor: (code: string | null | undefined) => string | null;
  onRename: (code: string, name: string) => void;
  onRemove: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const initial = labelFor(code) ?? "بدون قسم";
  // Extract just the name portion for editing
  const currentName = (() => {
    if (!code) return "";
    const label = labelFor(code);
    if (!label) return "";
    const dash = label.indexOf(" - ");
    return dash >= 0 ? label.slice(dash + 3) : "";
  })();
  const [value, setValue] = useState(currentName);

  if (!code) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">بدون قسم</h3>
        <Badge variant="secondary" className="h-5 bg-background/60 px-2 text-[10px] font-normal">
          {count}
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
      {editing ? (
        <div className="flex flex-1 items-center gap-2">
          <span className="text-sm font-semibold text-foreground">القسم {code}</span>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="اسم القسم (اختياري)"
            className="h-7 max-w-xs text-sm"
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-primary"
            onClick={() => {
              onRename(code, value.trim());
              setEditing(false);
            }}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => {
              setValue(currentName);
              setEditing(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <h3 className="text-sm font-semibold text-foreground">{initial}</h3>
      )}
      <div className="flex items-center gap-1">
        <Badge variant="secondary" className="h-5 bg-background/60 px-2 text-[10px] font-normal">
          {count}
        </Badge>
        {!editing && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => {
                setValue(currentName);
                setEditing(true);
              }}
              title="تعديل اسم القسم"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(code)}
              title="حذف القسم"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
