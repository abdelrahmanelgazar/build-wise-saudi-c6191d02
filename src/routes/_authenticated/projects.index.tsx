import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { ChevronLeft, ChevronRight, FolderPlus, Plus, Search, Trash2 } from "lucide-react";
import { fmtSAR } from "@/lib/format";
import { toast } from "sonner";
import { setActiveProjectId } from "@/lib/active-project";
import { useLanguage } from "@/lib/i18n";
import { STATUS_CONFIGS, ALL_STATUSES, type ProjectStatus } from "@/lib/status";
import type { Database } from "@/integrations/supabase/types";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Status = Database["public"]["Enums"]["project_status"];

const SCOPE_OPTIONS = ["Turnkey", "Civil", "MEP", "Finishing", "Infrastructure", "Other"];
const CONTRACT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Re-Measured", label: "Re-Measured" },
  { value: "Lump sum", label: "Lump sum" },
];

export const Route = createFileRoute("/_authenticated/projects/")({
  component: ProjectsIndex,
});

function ProjectsIndex() {
  const qc = useQueryClient();
  const { t, language, direction } = useLanguage();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("project_no", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  const updateNoMut = useMutation({
    mutationFn: async ({ id, project_no }: { id: string; project_no: number | null }) => {
      const { error } = await supabase.from("projects").update({ project_no } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("projects.updateNoSuccess"));
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("projects.deleteSuccess"));
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = projects
    .filter((p) => statusFilter === "all" || p.status === statusFilter)
    .filter((p) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(s) ||
        (p.client_name ?? "").toLowerCase().includes(s) ||
        (p.location ?? "").toLowerCase().includes(s) ||
        ((p as any).code ?? "").toLowerCase().includes(s) ||
        ((p as any).area ?? "").toLowerCase().includes(s)
      );
    });

  const ChevronIcon = direction === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("projects.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("projects.subtitle")}
          </p>
        </div>
        <NewProjectDialog />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${direction === "rtl" ? "right-3" : "left-3"}`} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("projects.searchPlaceholder")}
            className={`h-9 ${direction === "rtl" ? "pr-9" : "pl-9"}`}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as Status | "all")}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("projects.allStatuses")}</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(STATUS_CONFIGS[s].translationKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">
          {filtered.length} / {projects.length} {t("projects.countOf")}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[1400px] text-start text-xs">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colNo")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colCode")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colClient")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colName")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colLocation")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colArea")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colScope")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colContract")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colTenderDate")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colLastSubmit")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colLastRfi")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colDuration")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colStatus")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colNotes")}</th>
              <th className="px-3 py-3 font-medium text-start">{t("projects.colValue")}</th>
              <th className="px-3 py-3 font-medium text-center">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={16} className="px-4 py-8 text-center text-muted-foreground">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={16} className="px-4 py-12 text-center text-muted-foreground">
                  <FolderPlus className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  <div>{t("projects.emptyProjects")}</div>
                </td>
              </tr>
            )}
            {filtered.map((p: any) => {
              const cfg = STATUS_CONFIGS[p.status as ProjectStatus];
              const statusLabel = cfg ? t(cfg.translationKey) : (p.status ?? "—");
              const badgeCls = cfg ? cfg.badgeClass : "bg-muted/60 text-muted-foreground border-border/60";

              return (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <NoEditor
                      value={p.project_no}
                      onSave={(v) => updateNoMut.mutate({ id: p.id, project_no: v })}
                      editHint={t("common.clickToEdit")}
                    />
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px]">{p.code || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{p.client_name || "—"}</td>
                  <td className="px-3 py-3 font-medium">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: p.id }}
                      onClick={() => setActiveProjectId(p.id)}
                      className="text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{p.location || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{p.area || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{p.scope_of_work || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{p.contract_type || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{p.tender_entry_date || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{p.last_submit_date || p.submission_date || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{p.last_rfi_date || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{p.duration || "—"}</td>
                  <td className="px-3 py-3">
                    <Badge variant="outline" className={badgeCls}>{statusLabel}</Badge>
                  </td>
                  <td className="px-3 py-3 max-w-[200px] truncate text-muted-foreground" title={p.note || ""}>{p.note || "—"}</td>
                  <td className="px-3 py-3 tabular-nums">{fmtSAR(Number(p.estimated_value ?? 0), language)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: p.id }}
                        onClick={() => setActiveProjectId(p.id)}
                      >
                        <Button size="sm" variant="ghost" className="gap-1">
                          {t("common.open")}
                          <ChevronIcon className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`${t("projects.deleteConfirm")} ("${p.name}")`)) {
                            delMut.mutate(p.id);
                          }
                        }}
                        className="h-8 w-8 text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoEditor({
  value,
  onSave,
  editHint,
}: {
  value: number | null | undefined;
  onSave: (v: number | null) => void;
  editHint: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value != null ? String(value) : "");
  if (!editing) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setVal(value != null ? String(value) : ""); setEditing(true); }}
        className="tabular-nums text-muted-foreground hover:text-primary hover:underline"
        title={editHint}
      >
        {value ?? "—"}
      </button>
    );
  }
  return (
    <Input
      type="number"
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const n = val.trim() === "" ? null : Number(val);
        if (n !== (value ?? null)) onSave(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setVal(value != null ? String(value) : ""); setEditing(false); }
      }}
      className="h-7 w-20 text-xs"
    />
  );
}

function NewProjectDialog() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    project_no: "",
    code: "",
    client: "",
    name: "",
    location: "",
    area: "",
    scope_of_work: "",
    contract_type: "",
    tender_entry_date: "",
    last_submit_date: "",
    last_rfi_date: "",
    duration: "",
    status: "studying" as Status,
    note: "",
    estValue: "",
  });
  const qc = useQueryClient();

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const user_id = u.user?.id;
      if (!user_id) throw new Error("Not logged in");
      if (!form.name.trim()) throw new Error("Project name is required");
      const { data, error } = await supabase
        .from("projects")
        .insert({
          user_id,
          project_no: form.project_no.trim() === "" ? null : Number(form.project_no),
          name: form.name.trim(),
          code: form.code.trim() || null,
          client_name: form.client.trim() || null,
          location: form.location.trim() || null,
          area: form.area.trim() || null,
          scope_of_work: form.scope_of_work || null,
          contract_type: form.contract_type || null,
          tender_entry_date: form.tender_entry_date || null,
          last_submit_date: form.last_submit_date || null,
          last_rfi_date: form.last_rfi_date || null,
          duration: form.duration || null,
          status: form.status,
          note: form.note.trim() || null,
          estimated_value: Number(form.estValue) || 0,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (p) => {
      toast.success(t("projects.createSuccess"));
      qc.invalidateQueries({ queryKey: ["projects"] });
      setActiveProjectId(p.id);
      setOpen(false);
      setForm({
        project_no: "",
        code: "", client: "", name: "", location: "", area: "",
        scope_of_work: "", contract_type: "",
        tender_entry_date: "", last_submit_date: "", last_rfi_date: "",
        duration: "",
        status: "studying", note: "", estValue: "",
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          {t("projects.newProject")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("projects.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldProjectNo")}</Label>
              <Input type="number" value={form.project_no} onChange={(e) => set("project_no", e.target.value)} placeholder="675" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldCode")}</Label>
              <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="AFC-MAS-26-01" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldClient")}</Label>
              <Input value={form.client} onChange={(e) => set("client", e.target.value)} placeholder={t("projects.selectPlaceholder")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("projects.fieldName")}</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldLocation")}</Label>
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldArea")}</Label>
              <Input value={form.area} onChange={(e) => set("area", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldScope")}</Label>
              <Select value={form.scope_of_work} onValueChange={(v) => set("scope_of_work", v)}>
                <SelectTrigger><SelectValue placeholder={t("projects.selectPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldContract")}</Label>
              <Select value={form.contract_type} onValueChange={(v) => set("contract_type", v)}>
                <SelectTrigger><SelectValue placeholder={t("projects.selectPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {CONTRACT_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldTenderDate")}</Label>
              <Input type="date" value={form.tender_entry_date} onChange={(e) => set("tender_entry_date", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldLastSubmit")}</Label>
              <Input type="date" value={form.last_submit_date} onChange={(e) => set("last_submit_date", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldLastRfi")}</Label>
              <Input type="date" value={form.last_rfi_date} onChange={(e) => set("last_rfi_date", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldDuration")}</Label>
              <Input value={form.duration} onChange={(e) => set("duration", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldStatus")}</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as Status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{t(STATUS_CONFIGS[s].translationKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("projects.fieldEstValue")}</Label>
              <Input type="number" value={form.estValue} onChange={(e) => set("estValue", e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("projects.fieldNote")}</Label>
            <Textarea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? t("common.creating") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
