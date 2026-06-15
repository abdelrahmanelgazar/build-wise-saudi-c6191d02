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
import { Check, Pencil, Plus, Search, Trash2, X, Boxes, Hammer, Truck } from "lucide-react";
import { fmtSAR } from "@/lib/format";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { useActiveProjectId } from "@/lib/active-project";
import { Link } from "@tanstack/react-router";
import { FolderPlus } from "lucide-react";
import { useDivisions } from "@/lib/divisions";

type ResourceRow = Database["public"]["Tables"]["resources"]["Row"] & {
  division?: string | null;
};
type ResourceType = Database["public"]["Enums"]["resource_type"];

export const Route = createFileRoute("/_authenticated/resources")({
  head: () => ({ meta: [{ title: "مكتبة البيانات — تقديري" }] }),
  component: ResourcesPage,
});

const TYPE_META: Record<ResourceType, { label: string; icon: typeof Boxes; color: string }> = {
  material: { label: "المواد", icon: Boxes, color: "text-chart-2" },
  labor: { label: "العمالة", icon: Hammer, color: "text-chart-3" },
  equipment: { label: "المعدات", icon: Truck, color: "text-primary" },
  subcontractor: { label: "مقاول الباطن", icon: Truck, color: "text-chart-4" },
};

function ResourcesPage() {
  const [tab, setTab] = useState<ResourceType>("material");
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const { divisions, rename, remove, labelFor } = useDivisions(projectId);

  const { data: resources = [], isLoading } = useQuery({
    queryKey: ["resources", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .eq("project_id", projectId!)
        .order("division", { ascending: true, nullsFirst: false })
        .order("code", { ascending: true });
      if (error) throw error;
      return data as ResourceRow[];
    },
  });

  const ofType = resources.filter((r) => r.type === tab);
  const filtered = ofType.filter(
    (r) =>
      !search ||
      r.name_ar.includes(search) ||
      (r.code ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  // Group filtered by division, include every catalog division even when empty
  const grouped = useMemo(() => {
    const map = new Map<string, ResourceRow[]>();
    for (const d of divisions) map.set(d.code, []);
    for (const r of filtered) {
      const k = r.division ?? "";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  }, [filtered, divisions]);


  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("resources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["resources"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">اختر مشروعاً</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            مكتبة الموارد خاصة بكل مشروع. اختر مشروعاً من القائمة الجانبية للبدء.
          </p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>الذهاب للمشاريع</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="مكتبة البيانات"
        subtitle="مكتبة المواد والعمالة والمعدات مقسّمة حسب أقسام MasterFormat — تستخدم في تحليل الأسعار."
        action={<NewResourceDialog defaultType={tab} />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as ResourceType)} className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            {(Object.keys(TYPE_META) as ResourceType[]).map((t) => {
              const Icon = TYPE_META[t].icon;
              const count = resources.filter((r) => r.type === t).length;
              return (
                <TabsTrigger key={t} value={t} className="gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {TYPE_META[t].label}
                  <Badge
                    variant="secondary"
                    className="h-5 bg-muted/60 px-1.5 text-[10px] font-normal"
                  >
                    {count}
                  </Badge>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الكود…"
              className="h-9 pr-9"
            />
          </div>
        </div>

        {(Object.keys(TYPE_META) as ResourceType[]).map((t) => (
          <TabsContent key={t} value={t} className="mt-4 space-y-6">
            {isLoading && (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                جاري التحميل…
              </div>
            )}
            {!isLoading && grouped.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
                لا توجد عناصر في هذا القسم بعد. أضف أول عنصر باستخدام زر «إضافة مورد».
              </div>
            )}
            {!isLoading &&
              grouped.map(([divCode, rows]) => (
                <div key={divCode || "none"} className="overflow-hidden rounded-lg border border-border bg-card">
                  <DivisionHeader
                    code={divCode}
                    count={rows.length}
                    labelFor={labelFor}
                    onRename={rename}
                    onRemove={(c: string) => {
                      if (rows.length > 0) {
                        toast.error("لا يمكن حذف قسم يحتوي على عناصر");
                        return;
                      }
                      if (confirm(`حذف القسم ${c}؟`)) remove(c);
                    }}
                  />
                  <table className="w-full text-sm tabular-nums">
                    <thead className="bg-muted/20 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-right font-medium">الكود</th>
                        <th className="px-4 py-2 text-right font-medium">الاسم</th>
                        <th className="px-4 py-2 text-right font-medium">الوحدة</th>
                        <th className="px-4 py-2 text-right font-medium">سعر الوحدة</th>
                        <th className="px-4 py-2 text-center font-medium">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => (
                        <tr key={r.id} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                            {r.code ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-foreground">{r.name_ar}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.unit}</td>
                          <td className="px-4 py-2.5 font-semibold text-primary">
                            {fmtSAR(r.unit_price)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-center gap-1">
                              <EditResourceDialog resource={r} />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  if (confirm(`حذف المورد «${r.name_ar}»؟`)) delMut.mutate(r.id);
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

function NewResourceDialog({ defaultType, defaultDivision }: { defaultType: ResourceType; defaultDivision?: string }) {
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
  defaultDivision?: string;
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
