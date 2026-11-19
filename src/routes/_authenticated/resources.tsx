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
import { useLanguage } from "@/lib/i18n";

type ResourceRow = Database["public"]["Tables"]["resources"]["Row"] & {
  division?: string | null;
  name_en?: string | null;
};
type ResourceType = Database["public"]["Enums"]["resource_type"];

export const Route = createFileRoute("/_authenticated/resources")({
  head: () => ({ meta: [{ title: "مكتبة البيانات — تقديري" }] }),
  component: ResourcesPage,
});

const TYPE_META: Record<ResourceType, { translationKey: string; icon: typeof Boxes; color: string }> = {
  material: { translationKey: "resources.tabMaterials", icon: Boxes, color: "text-chart-2" },
  labor: { translationKey: "resources.tabLabour", icon: Hammer, color: "text-chart-3" },
  equipment: { translationKey: "resources.tabEquipment", icon: Truck, color: "text-primary" },
  subcontractor: { translationKey: "resources.tabSubcontractor", icon: Truck, color: "text-chart-4" },
};

function ResourcesPage() {
  const [tab, setTab] = useState<ResourceType>("material");
  const [search, setSearch] = useState("");
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const { divisions, rename, remove, labelFor } = useDivisions(projectId);
  const { t, language, direction } = useLanguage();

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
      (r.name_ar && r.name_ar.includes(search)) ||
      (r.name_en && r.name_en.toLowerCase().includes(search.toLowerCase())) ||
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
      toast.success(t("resources.deletedSuccess"));
      qc.invalidateQueries({ queryKey: ["resources"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">{t("resources.selectProjectPrompt")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("resources.selectProjectDesc")}
          </p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>{t("boq.goToProjects")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title={t("resources.title")}
        subtitle={t("resources.subtitle")}
        action={<NewResourceDialog defaultType={tab} />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as ResourceType)} className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            {(Object.keys(TYPE_META) as ResourceType[]).map((tKey) => {
              const Icon = TYPE_META[tKey].icon;
              const count = resources.filter((r) => r.type === tKey).length;
              return (
                <TabsTrigger key={tKey} value={tKey} className="gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {t(TYPE_META[tKey].translationKey)}
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
            <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${direction === "rtl" ? "right-3" : "left-3"}`} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("resources.searchPlaceholder")}
              className={`h-9 ${direction === "rtl" ? "pr-9" : "pl-9"}`}
            />
          </div>
        </div>

        {(Object.keys(TYPE_META) as ResourceType[]).map((tKey) => (
          <TabsContent key={tKey} value={tKey} className="mt-4 space-y-6">
            {isLoading && (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                {t("common.loading")}
              </div>
            )}
            {!isLoading && grouped.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
                {t("resources.emptySection")}
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
                        toast.error(t("resources.cannotDeleteDiv"));
                        return;
                      }
                      if (confirm(`${t("resources.deleteDivConfirm")} ${c}?`)) remove(c);
                    }}
                    language={language}
                    t={t}
                  />
                  <table className="w-full text-sm tabular-nums">
                    <thead className="bg-muted/20 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-start font-medium">{t("resources.colCode")}</th>
                        <th className="px-4 py-2 text-start font-medium">{t("resources.colName")}</th>
                        <th className="px-4 py-2 text-start font-medium">{t("resources.colUnit")}</th>
                        <th className="px-4 py-2 text-start font-medium">{t("resources.colRate")}</th>
                        <th className="px-4 py-2 text-center font-medium">{t("resources.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => {
                        const displayName = language === "en" && r.name_en ? r.name_en : r.name_ar;
                        return (
                          <tr key={r.id} className="hover:bg-muted/20">
                            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                              {r.code ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-foreground">{displayName}</td>
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
                                    if (confirm(`${t("resources.deleteResourceConfirm")} «${displayName}»؟`)) delMut.mutate(r.id);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
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
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ResourceType>(resource?.type ?? defaultType ?? "material");
  const [division, setDivision] = useState<string>(resource?.division ?? defaultDivision ?? "");
  const [code, setCode] = useState(resource?.code ?? "");
  const [nameAr, setNameAr] = useState(resource?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(resource?.name_en ?? "");
  const [unit, setUnit] = useState(resource?.unit ?? "");
  const [price, setPrice] = useState<string>(String(resource?.unit_price ?? ""));
  const qc = useQueryClient();
  const projectId = useActiveProjectId();
  const { divisions } = useDivisions(projectId);

  const mut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user_id = userData.user?.id;
      if (!user_id) throw new Error("Not logged in");
      if (!projectId) throw new Error("Select project first");
      const payload: any = {
        type,
        division: division || null,
        code: code || null,
        name_ar: nameAr,
        name_en: nameEn.trim() || null,
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
      toast.success(mode === "edit" ? t("resources.updatedSuccess") : t("resources.addedSuccess"));
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
            {t("resources.addResource")}
          </Button>
        ) : (
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? t("resources.editResource") : t("resources.addResource")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("common.type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as ResourceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="material">{t("resources.tabMaterials")}</SelectItem>
                  <SelectItem value="labor">{t("resources.tabLabour")}</SelectItem>
                  <SelectItem value="equipment">{t("resources.tabEquipment")}</SelectItem>
                  <SelectItem value="subcontractor">{t("resources.tabSubcontractor")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.code")}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="M001" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("resources.divisionLabel")}</Label>
            <Select value={division || "none"} onValueChange={(v) => setDivision(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder={t("resources.divisionLabel")} />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="none">{t("resources.noDivision")}</SelectItem>
                {divisions.map((d) => (
                  <SelectItem key={d.code} value={d.code}>
                    {t("resources.divisionPrefix")} {d.code} - {language === "en" && d.name_en ? d.name_en : d.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("resources.nameAr")}</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t("resources.nameEn")}</Label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("common.unit")}</Label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="m³ / hr / ton"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("resources.unitPrice")} ({t("common.sar")})</Label>
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
            {t("common.cancel")}
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !nameAr || !unit}>
            {mut.isPending ? t("common.loading") : t("common.save")}
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
  language,
  t,
}: {
  code: string;
  count: number;
  labelFor: (code: string) => string | undefined;
  onRename: (code: string, newName: string) => void;
  onRemove: (code: string) => void;
  language: string;
  t: (k: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const initial = labelFor(code) ?? (language === "en" ? "No Division" : "بدون قسم");
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
        <h3 className="text-sm font-semibold text-foreground">{language === "en" ? "No Division" : "بدون قسم"}</h3>
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
          <span className="text-sm font-semibold text-foreground">{t("resources.divisionPrefix")} {code}</span>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={language === "en" ? "Division Name (optional)" : "اسم القسم (اختياري)"}
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
              title={language === "en" ? "Edit Division" : "تعديل اسم القسم"}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(code)}
              title={language === "en" ? "Delete Division" : "حذف القسم"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
