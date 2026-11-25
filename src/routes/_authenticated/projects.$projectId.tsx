import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { estimationClient } from "@/lib/estimation-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowRight,
  Calculator,
  Database as DatabaseIcon,
  Download,
  FileText,
  Save,
  TrendingUp,
  Trash2,
  Upload,
  Building2,
  Clock,
  Plus,
  ExternalLink,
  Kanban,
  CheckCircle,
} from "lucide-react";
import { fmtSAR } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Tender, TenderStatus } from "@/types/client-tender";
import { TENDER_STATUS_META } from "@/types/client-tender";
import { transitionTenderStatus } from "@/lib/client-tender-service";
import { setActiveProjectId, setActiveTenderId } from "@/lib/active-project";
import type { Database } from "@/integrations/supabase/types";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";
import { ProjectRfiAddendaTab, TenderGoNoGoTab } from "@/components/projects/tender-rfi-gonogo-tabs";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type Status = Database["public"]["Enums"]["project_status"];
type ProjectFile = Database["public"]["Tables"]["project_files"]["Row"];

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  studying: { label: "قيد الدراسة", cls: "bg-muted/60 text-muted-foreground border-border/60" },
  submitted_to_medial_man: { label: "مُرسل للوسيط (GM)", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  submitted_to_client: { label: "مُرسل للعميل", cls: "bg-primary/15 text-primary border-primary/30" },
  waiting_for_reply: { label: "بانتظار الرد", cls: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" },
  inquiries_sent: { label: "استفسارات للعميل", cls: "bg-cyan-500/15 text-cyan-500 border-cyan-500/30" },
  answers_received: { label: "ردود مستلمة - دراسة", cls: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30" },
  on_hold: { label: "مُعلّق", cls: "bg-orange-500/15 text-orange-500 border-orange-500/30" },
  client_rejected: { label: "رفض العميل", cls: "bg-red-500/15 text-red-500 border-red-500/30" },
  construction_ongoing: { label: "تنفيذ جاري", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  construction_complete: { label: "تنفيذ مكتمل", cls: "bg-teal-500/15 text-teal-500 border-teal-500/30" },
  finished: { label: "منتهي", cls: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  closed: { label: "مغلق", cls: "bg-muted/60 text-muted-foreground border-border/60" },
};

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({ meta: [{ title: 'تفاصيل المشروع — تقديري' }, { name: "description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:title", content: 'تفاصيل المشروع — تقديري' }, { property: "og:description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: ProjectDetail,
  errorComponent: ({ error, reset }) => (
    <div className="p-8 max-w-lg mx-auto text-center space-y-4">
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-5 text-destructive">
        <h2 className="font-semibold text-lg">تعذّر تحميل بيانات المشروع</h2>
        <p className="text-xs mt-2 text-muted-foreground">{String((error as any)?.message || error)}</p>
      </div>
      <div className="flex justify-center gap-3">
        <Button onClick={() => reset()}>إعادة المحاولة</Button>
        <Link to="/projects"><Button variant="outline">العودة لقائمة المشاريع</Button></Link>
      </div>
    </div>
  ),
});

function ProjectDetail() {
  const { projectId: rawProjectId } = Route.useParams();
  const projectId = rawProjectId?.replace(/\//g, "7") ?? rawProjectId;
  const navigate = useNavigate();

  useEffect(() => {
    setActiveProjectId(projectId);
  }, [projectId]);

  useRegisterPageActions({
    pageKey: `project-${projectId}`,
    hasEditableState: true,
    queryKeys: [["project", projectId], ["project_stats", projectId], ["project_tenders", projectId], ["project_files", projectId]],
  });

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await estimationClient.from("projects").select("*").eq("id", projectId).maybeSingle();
      if (error) throw error;
      return data as Project | null;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["project_stats", projectId],
    queryFn: async () => {
      const [boq, res] = await Promise.all([
        estimationClient.from("boq_items").select("quantity, material_cost, labor_cost, equipment_cost, subcontractor_cost, is_group").eq("project_id", projectId),
        estimationClient.from("resources").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      ]);
      const items = (boq.data ?? []).filter((b) => !b.is_group);
      const total = items.reduce(
        (s, b) =>
          s +
          Number(b.quantity ?? 0) *
            (Number(b.material_cost ?? 0) +
              Number(b.labor_cost ?? 0) +
              Number(b.equipment_cost ?? 0) +
              Number(b.subcontractor_cost ?? 0)),
        0,
      );
      return {
        boqCount: items.length,
        boqTotal: total,
        resourcesCount: res.count ?? 0,
      };
    },
  });

  const { data: projectTenders = [] } = useQuery({
    queryKey: ["project_tenders", projectId],
    queryFn: async () => {
      const { data, error } = await (estimationClient as any)
        .from("tenders")
        .select("*")
        .eq("project_id", projectId);
      if (error) return [] as Tender[];
      return (data as Tender[]) ?? [];
    },
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">جاري التحميل…</div>;
  }

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">المشروع غير موجود.</p>
        <Button variant="link" onClick={() => navigate({ to: "/projects" })}>
          العودة للمشاريع
        </Button>
      </div>
    );
  }

  const statusMeta = (project.status && STATUS_META[project.status]) || {
    label: project.status || "قيد الدراسة",
    cls: "bg-muted/60 text-muted-foreground border-border/60",
  };

  const clientId = (project as any).client_id;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{project.name}</h1>
              <Badge variant="outline" className={statusMeta.cls}>
                {statusMeta.label}
              </Badge>
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
              {clientId ? (
                <Link
                  to="/clients/$clientId"
                  params={{ clientId }}
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  {project.client_name || "ملف العميل"}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  {project.client_name || "—"}
                </span>
              )}
              <span>·</span>
              <span>{project.location || "—"}</span>
              {project.code && (
                <>
                  <span>·</span>
                  <Badge variant="outline" className="font-mono text-xs">{project.code}</Badge>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
          <TabsTrigger value="tenders" className="gap-1.5">
            سجل المنافسات
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {projectTenders.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="info">البيانات الأساسية</TabsTrigger>
          <TabsTrigger value="rfi">الاستفسارات والملحقات</TabsTrigger>
          <TabsTrigger value="gonogo">تقييم Go/No-Go</TabsTrigger>
          <TabsTrigger value="requirements">المتطلبات</TabsTrigger>
          <TabsTrigger value="files">الملفات</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="القيمة التقديرية" value={fmtSAR(Number(project.estimated_value ?? 0))} />
            <StatCard label="الميزانية" value={fmtSAR(Number(project.budget ?? 0))} />
            <StatCard label="إجمالي تكلفة الكميات" value={fmtSAR(stats?.boqTotal ?? 0)} hl />
            <StatCard label="بنود الكميات" value={String(stats?.boqCount ?? 0)} sub={`${stats?.resourcesCount ?? 0} مورد`} />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <QuickLink to="/boq" icon={Calculator} title="جدول الكميات" desc="بنود الـ BOQ الخاصة بالمشروع" />
            <QuickLink to="/price-analysis" icon={TrendingUp} title="تحليل الأسعار" desc="موارد وتكاليف كل بند" />
            <QuickLink to="/resources" icon={DatabaseIcon} title="عروض الأسعار" desc="الموردين ومقاولي الباطن وتصنيف CSI" />
          </div>
        </TabsContent>

        <TabsContent value="tenders" className="mt-4">
          <ProjectTendersTab
            projectId={project.id}
            projectName={project.name}
            clientId={clientId}
            clientName={project.client_name || ""}
            tenders={projectTenders}
          />
        </TabsContent>

        <TabsContent value="info" className="mt-4">
          <ProjectInfoForm project={project} />
        </TabsContent>

        <TabsContent value="rfi" className="mt-4">
          <ProjectRfiAddendaTab projectId={project.id} tenders={projectTenders} />
        </TabsContent>

        <TabsContent value="gonogo" className="mt-4">
          <TenderGoNoGoTab projectId={project.id} tenders={projectTenders} />
        </TabsContent>

        <TabsContent value="requirements" className="mt-4">
          <RequirementsForm project={project} />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <ProjectFiles projectId={project.id} userId={project.user_id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, sub, hl }: { label: string; value: string; sub?: string; hl?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${hl ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${hl ? "text-primary" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: "/boq" | "/price-analysis" | "/resources";
  icon: typeof Calculator;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to} className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5">
      <Icon className="h-5 w-5 text-primary" />
      <div className="mt-2 font-semibold group-hover:text-primary">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </Link>
  );
}

function ProjectInfoForm({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    project_no: project.project_no != null ? String(project.project_no) : "",
    code: project.code ?? "",
    name: project.name,
    client_name: project.client_name ?? "",
    location: project.location ?? "",
    area: project.area ?? "",
    scope_of_work: project.scope_of_work ?? "",
    contract_type: project.contract_type ?? "",
    status: (project.status && STATUS_META[project.status]) ? project.status : "studying",
    estimated_value: String(project.estimated_value ?? ""),
    budget: String(project.budget ?? ""),
    tender_entry_date: project.tender_entry_date ?? "",
    last_submit_date: project.last_submit_date ?? "",
    last_rfi_date: project.last_rfi_date ?? "",
    submission_date: project.submission_date ?? "",
    duration: (project as any).duration ?? "",
    note: project.note ?? "",
    notes: project.notes ?? "",
  });

  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await estimationClient
        .from("projects")
        .update({
          project_no: form.project_no === "" ? null : Number(form.project_no),
          code: form.code || null,
          name: form.name,
          client_name: form.client_name || null,
          location: form.location || null,
          area: form.area || null,
          scope_of_work: form.scope_of_work || null,
          contract_type: form.contract_type || null,
          status: form.status as Status,
          estimated_value: Number(form.estimated_value) || 0,
          budget: Number(form.budget) || 0,
          tender_entry_date: form.tender_entry_date || null,
          last_submit_date: form.last_submit_date || null,
          last_rfi_date: form.last_rfi_date || null,
          submission_date: form.submission_date || null,
          duration: form.duration || null,
          note: form.note || null,
          notes: form.notes || null,
        })
        .eq("id", project.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="رقم المشروع">
          <Input type="number" value={form.project_no} onChange={(e) => setForm({ ...form, project_no: e.target.value })} />
        </Field>
        <Field label="الكود">
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
        <Field label="اسم المشروع">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="الحالة">
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Status })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_META) as Status[]).map((s) => (
                <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="العميل">
          <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
        </Field>
        <Field label="الموقع">
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label="المنطقة">
          <Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        </Field>
        <Field label="نوع العقد">
          <Input value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })} />
        </Field>
        <Field label="القيمة التقديرية (ر.س)">
          <Input type="number" value={form.estimated_value} onChange={(e) => setForm({ ...form, estimated_value: e.target.value })} />
        </Field>
        <Field label="الميزانية (ر.س)">
          <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
        </Field>
        <Field label="تاريخ استلام المناقصة">
          <Input type="date" value={form.tender_entry_date} onChange={(e) => setForm({ ...form, tender_entry_date: e.target.value })} />
        </Field>
        <Field label="تاريخ آخر تقديم">
          <Input type="date" value={form.last_submit_date} onChange={(e) => setForm({ ...form, last_submit_date: e.target.value })} />
        </Field>
        <Field label="تاريخ آخر استفسار (RFI)">
          <Input type="date" value={form.last_rfi_date} onChange={(e) => setForm({ ...form, last_rfi_date: e.target.value })} />
        </Field>
        <Field label="تاريخ التسليم">
          <Input type="date" value={form.submission_date} onChange={(e) => setForm({ ...form, submission_date: e.target.value })} />
        </Field>
        <Field label="مدة المشروع">
          <Input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="مثال: 12 شهر" />
        </Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="نطاق العمل">
          <Textarea rows={3} value={form.scope_of_work} onChange={(e) => setForm({ ...form, scope_of_work: e.target.value })} />
        </Field>
        <Field label="ملاحظة (Note)">
          <Textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="ملاحظات إضافية">
          <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          {mut.isPending ? "جاري الحفظ…" : "حفظ التغييرات"}
        </Button>
      </div>
    </div>
  );
}

function RequirementsForm({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [tech, setTech] = useState(project.technical_requirements ?? "");
  const [fin, setFin] = useState(project.financial_requirements ?? "");

  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await estimationClient
        .from("projects")
        .update({ technical_requirements: tech || null, financial_requirements: fin || null })
        .eq("id", project.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-3 font-semibold">متطلبات العرض الفني</h3>
        <Textarea
          rows={12}
          value={tech}
          onChange={(e) => setTech(e.target.value)}
          placeholder="اكتب متطلبات العرض الفني للمشروع (المواصفات، المعايير، الجودة، الجدول الزمني المطلوب…)"
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-3 font-semibold">متطلبات العرض المالي</h3>
        <Textarea
          rows={12}
          value={fin}
          onChange={(e) => setFin(e.target.value)}
          placeholder="اكتب متطلبات العرض المالي (شروط الدفع، الضمانات، نسبة الدفعة المقدمة، الغرامات…)"
        />
      </div>
      <div className="lg:col-span-2 flex justify-end">
        <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          {mut.isPending ? "جاري الحفظ…" : "حفظ المتطلبات"}
        </Button>
      </div>
    </div>
  );
}


function ProjectFiles({ projectId, userId }: { projectId: string; userId?: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: files = [] } = useQuery({
    queryKey: ["project_files", projectId],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("project_files")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProjectFile[];
    },
  });

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const effectiveUserId = userId || "default-user";
      const path = `${effectiveUserId}/${projectId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await estimationClient.storage.from("project-files").upload(path, file);
      if (upErr) throw upErr;
      const { error: insErr } = await estimationClient.from("project_files").insert({
        user_id: effectiveUserId,
        project_id: projectId,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        file_type: file.type,
      });
      if (insErr) throw insErr;
      toast.success("تم رفع الملف");
      qc.invalidateQueries({ queryKey: ["project_files", projectId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDownload(f: ProjectFile) {
    const { data, error } = await estimationClient.storage.from("project-files").createSignedUrl(f.file_path, 60);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function handleDelete(f: ProjectFile) {
    if (!confirm(`حذف الملف "${f.file_name}"؟`)) return;
    await estimationClient.storage.from("project-files").remove([f.file_path]);
    await estimationClient.from("project_files").delete().eq("id", f.id);
    toast.success("تم الحذف");
    qc.invalidateQueries({ queryKey: ["project_files", projectId] });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">ملفات المشروع</h3>
          <p className="mt-1 text-xs text-muted-foreground">ارفع كراسة الشروط، المخططات، العروض، وأي ملفات مرفقة.</p>
        </div>
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          {uploading ? "جاري الرفع…" : "رفع ملف"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
          }}
        />
      </div>

      <div className="mt-4 divide-y divide-border">
        {files.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">لا توجد ملفات مرفوعة بعد.</div>
        )}
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{f.file_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {f.file_size ? `${(f.file_size / 1024).toFixed(1)} KB` : ""} · {f.created_at ? new Date(f.created_at).toLocaleDateString("ar-SA") : "—"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDownload(f)}>
                <Download className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => handleDelete(f)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ProjectTendersTab({
  projectId,
  projectName,
  clientId,
  clientName,
  tenders,
}: {
  projectId: string;
  projectName: string;
  clientId?: string;
  clientName?: string;
  tenders: Tender[];
}) {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [transitionTender, setTransitionTender] = useState<Tender | null>(null);
  const [newStatus, setNewStatus] = useState<TenderStatus>("studying");
  const [decisionReason, setDecisionReason] = useState("");
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Form for new tender
  const [refNo, setRefNo] = useState("");
  const [title, setTitle] = useState(projectName ? `منافسة: ${projectName}` : "");
  const [pkgScope, setPkgScope] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [estVal, setEstVal] = useState("");

  const addMut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await estimationClient.auth.getUser();
      const user_id = userData.user?.id || "00000000-0000-0000-0000-000000000000";

      const { data, error } = await (estimationClient as any)
        .from("tenders")
        .insert({
          user_id,
          project_id: projectId,
          client_id: clientId || null,
          tender_no: refNo || `TND-${Date.now().toString().slice(-4)}`,
          title: title || projectName,
          client_name: clientName || null,
          package_name: pkgScope || null,
          responsible_person: assignedTo || null,
          submission_deadline: deadline || null,
          estimated_value: Number(estVal) || 0,
          status: "registered",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("تم تسجيل المنافسة بنجاح");
      qc.invalidateQueries({ queryKey: ["project_tenders", projectId] });
      qc.invalidateQueries({ queryKey: ["tenders"] });
      setNewOpen(false);
      setRefNo("");
      setTitle("");
      setPkgScope("");
      setAssignedTo("");
      setDeadline("");
      setEstVal("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleApplyTransition = async () => {
    if (!transitionTender) return;
    setIsTransitioning(true);
    try {
      const { data: userData } = await estimationClient.auth.getUser();
      const user_id = userData.user?.id || "00000000-0000-0000-0000-000000000000";
      await transitionTenderStatus(
        transitionTender.id,
        transitionTender.status as TenderStatus,
        newStatus,
        decisionReason || "",
        user_id,
      );
      toast.success("تم تحديث حالة المنافسة وتوثيق القرار بنجاح");
      qc.invalidateQueries({ queryKey: ["project_tenders", projectId] });
      qc.invalidateQueries({ queryKey: ["tenders"] });
      setTransitionTender(null);
      setDecisionReason("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsTransitioning(false);
    }
  };

  const deleteTender = async (tenderId: string) => {
    if (!confirm("هل أنت متأكد من حذف هذه المنافسة؟")) return;
    try {
      const { error } = await (estimationClient as any).from("tenders").delete().eq("id", tenderId);
      if (error) throw error;
      toast.success("تم حذف المنافسة");
      qc.invalidateQueries({ queryKey: ["project_tenders", projectId] });
      qc.invalidateQueries({ queryKey: ["tenders"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base">سجل المنافسات والعطاءات للمشروع</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            إدارة كافة المنافسات المرتبطة بالمشروع ومراحل تقديم العطاءات والقرارات الموثقة.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          إضافة منافسة لهذا المشروع
        </Button>
      </div>

      {tenders.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground border rounded-lg bg-muted/10">
          لا توجد منافسات مسجلة لهذا المشروع حتى الآن.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs text-right">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">رقم المنافسة / المرجع</th>
                <th className="px-3 py-2.5 font-medium">عنوان العطاء</th>
                <th className="px-3 py-2.5 font-medium">حزمة العمل</th>
                <th className="px-3 py-2.5 font-medium">المسؤول</th>
                <th className="px-3 py-2.5 font-medium">موعد التقديم</th>
                <th className="px-3 py-2.5 font-medium">القيمة التقديرية</th>
                <th className="px-3 py-2.5 font-medium">الحالة</th>
                <th className="px-3 py-2.5 font-medium text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenders.map((t) => {
                const meta = TENDER_STATUS_META[t.status as TenderStatus] || {
                  label: t.status,
                  color: "bg-muted text-muted-foreground",
                };
                return (
                  <tr key={t.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-mono font-medium">{t.tender_no}</td>
                    <td className="px-3 py-2.5 font-semibold">{t.title}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.package_name || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{t.responsible_person || "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {t.submission_deadline ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {t.submission_deadline}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono">
                      {t.estimated_value ? fmtSAR(Number(t.estimated_value)) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={cn("text-[11px]", meta.cls)}>
                        {meta.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Link
                          to="/boq"
                          onClick={() => {
                            setActiveProjectId(projectId);
                            setActiveTenderId(t.id);
                          }}
                        >
                          <Button variant="secondary" size="sm" className="h-7 text-[11px] gap-1">
                            <Calculator className="h-3 w-3" />
                            تسعير الفرصة
                          </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => {
                            setTransitionTender(t);
                            setNewStatus(t.status as TenderStatus);
                            setDecisionReason("");
                          }}
                        >
                          تغيير المرحلة
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteTender(t.id)}
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
      )}

      {/* New Tender Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة منافسة جديدة</DialogTitle>
            <DialogDescription className="text-xs">
              تسجيل عطاء أو منافسة جديدة مرتبطة بمشروع ({projectName})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <Field label="المرجع / رقم المنافسة">
              <Input
                value={refNo}
                onChange={(e) => setRefNo(e.target.value)}
                placeholder="MOH-2026-TND-01"
              />
            </Field>
            <Field label="عنوان المنافسة">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="عنوان العطاء أو المنافسة"
              />
            </Field>
            <Field label="نطاق العمل / حزمة العطاء">
              <Input
                value={pkgScope}
                onChange={(e) => setPkgScope(e.target.value)}
                placeholder="مثال: الأعمال الكهروميكانيكية والتشطيبات"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="المسؤول">
                <Input
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  placeholder="مهندس التسعير"
                />
              </Field>
              <Field label="القيمة التقديرية (ر.س)">
                <Input
                  type="number"
                  value={estVal}
                  onChange={(e) => setEstVal(e.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>
            <Field label="آخر موعد لتقديم العطاء">
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setNewOpen(false)}>
              إلغاء
            </Button>
            <Button
              size="sm"
              onClick={() => addMut.mutate()}
              disabled={addMut.isPending}
            >
              {addMut.isPending ? "جاري الحفظ…" : "تسجيل المنافسة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tender Status Transition Dialog */}
      <Dialog
        open={Boolean(transitionTender)}
        onOpenChange={(o) => {
          if (!o) setTransitionTender(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تغيير مرحلة المنافسة وتوثيق القرار</DialogTitle>
            <DialogDescription className="text-xs">
              منافسة: {transitionTender?.title} ({transitionTender?.tender_no})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <Field label="المرحلة الجديدة">
              <Select
                value={newStatus}
                onValueChange={(v) => setNewStatus(v as TenderStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TENDER_STATUS_META) as TenderStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {TENDER_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="مبررات / سبب الانتقال وتوثيق القرار">
              <Textarea
                rows={3}
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
                placeholder="اكتب أسباب أو مبررات هذا القرار (مثال: تم اكتمال العرض الفني والمالي والتقديم، فوز بالعطاء بأفضل سعر…)"
              />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTransitionTender(null)}
            >
              إلغاء
            </Button>
            <Button
              size="sm"
              onClick={handleApplyTransition}
              disabled={isTransitioning}
            >
              {isTransitioning ? "جاري التوثيق…" : "تأكيد وتوثيق القرار"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

