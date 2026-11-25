import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import {
  Building2,
  ArrowRight,
  FolderPlus,
  FileText,
  Calendar,
  Phone,
  Mail,
  UserPlus,
  Archive,
  ExternalLink,
  Plus,
  TrendingUp,
  FolderKanban,
  CheckCircle2,
  Clock,
  Briefcase,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { estimationClient } from "@/lib/estimation-client";
import { archiveClient } from "@/lib/client-tender-service";
import type { Client, Tender, ClientContact } from "@/types/client-tender";
import { CLIENT_TYPE_META, CLIENT_STATUS_META, TENDER_STATUS_META } from "@/types/client-tender";
import { fmtSAR, fmtNumber } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";

const clientDetailSearchSchema = z.object({
  company: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  head: () => ({
    meta: [
      { title: "ملف العميل والمشاريع — تقديري" },
      { name: "description", content: "عرض تفاصيل العميل والجهة المالكة والمشاريع والمنافسات المرتبطة به." },
    ],
  }),
  validateSearch: clientDetailSearchSchema,
  component: ClientDetailPage,
});

function ClientDetailPage() {
  const { clientId } = Route.useParams();
  const { company: companyFilter } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { language } = useLanguage();

  useRegisterPageActions({
    pageKey: `client-${clientId}`,
    hasEditableState: true,
    queryKeys: [["client", clientId], ["client_projects", clientId, companyFilter], ["client_tenders", clientId, companyFilter]],
  });

  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [newContact, setNewContact] = useState<Partial<ClientContact>>({
    name: "",
    role: "مسؤول المنافسات",
    email: "",
    phone: "",
  });

  // Fetch client details
  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("clients")
        .select("*")
        .eq("id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data as Client | null;
    },
  });

  // Fetch client projects (strictly scoped by selected company when navigating from a company branch)
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["client_projects", clientId, companyFilter ?? "all"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = ((data as unknown) as Array<Record<string, any>> | null) ?? [];
      return list.filter((p) => {
        const matchesClient = p["client_id"] === clientId || p["client_name"] === client?.name;
        if (!matchesClient) return false;
        if (companyFilter) {
          const pComp = String(p["company_name"] || "").trim() || "شركة غير محددة";
          return pComp === companyFilter;
        }
        return true;
      });
    },
  });

  // Fetch client tenders
  const { data: tenders = [] } = useQuery({
    queryKey: ["client_tenders", clientId],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("tenders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = ((data as unknown) as Tender[] | null) ?? [];
      const projectIds = new Set(projects.map((p) => String(p["id"])));
      return list.filter((t) => t.client_id === clientId || projectIds.has(t.project_id));
    },
  });

  // Add contact mutation
  const addContactMut = useMutation({
    mutationFn: async () => {
      if (!newContact.name?.trim()) throw new Error("اسم جهة الاتصال مطلوب");
      const currentContacts = client?.contacts || [];
      const contactObj: ClientContact = {
        id: crypto.randomUUID ? crypto.randomUUID() : `cnt-${Date.now()}`,
        name: newContact.name.trim(),
        role: newContact.role?.trim() || "جهة اتصال",
        ...(newContact.email?.trim() ? { email: newContact.email.trim() } : {}),
        ...(newContact.phone?.trim() ? { phone: newContact.phone.trim() } : {}),
        is_primary: currentContacts.length === 0,
      };

      const updated = [...currentContacts, contactObj];
      const { error } = await estimationClient
        .from("clients")
        .update({ contacts: updated } as any)
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تمت إضافة جهة الاتصال بنجاح");
      qc.invalidateQueries({ queryKey: ["client", clientId] });
      setContactDialogOpen(false);
      setNewContact({ name: "", role: "مسؤول المنافسات", email: "", phone: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: async () => {
      await archiveClient(clientId);
    },
    onSuccess: () => {
      toast.success("تم أرشفة العميل بنجاح");
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client", clientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (clientLoading) {
    return <div className="p-8 text-center text-muted-foreground animate-pulse">جاري تحميل ملف العميل…</div>;
  }

  if (!client) {
    return (
      <div className="p-12 text-center space-y-4 max-w-md mx-auto">
        <Building2 className="mx-auto h-12 w-12 text-muted-foreground opacity-40" />
        <h2 className="text-xl font-bold">العميل غير موجود</h2>
        <p className="text-sm text-muted-foreground">تعذر العثور على سجل العميل المطلوب أو تم حذفه.</p>
        <Button onClick={() => navigate({ to: "/clients" })}>العودة لسجل العملاء</Button>
      </div>
    );
  }

  const typeMeta = CLIENT_TYPE_META[client.type] ?? { label: client.type, cls: "bg-muted" };
  const statusMeta = CLIENT_STATUS_META[client.status] ?? { label: client.status, cls: "bg-muted" };
  const totalValue = projects.reduce((s, p) => s + Number(p["estimated_value"] || 0), 0);
  const activeTenders = tenders.filter(
    (t) => t.status === "registered" || t.status === "studying" || t.status === "review"
  );

  return (
    <div className="p-6 space-y-6">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/50 pb-4">
        <div className="flex items-center gap-3">
          <Link to="/clients">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                {client.code}
              </span>
              <h1 className="text-xl font-bold text-foreground">{client.name}</h1>
              <Badge variant="outline" className={typeMeta.cls}>
                {typeMeta.label}
              </Badge>
              <Badge variant="outline" className={statusMeta.cls}>
                {statusMeta.label}
              </Badge>
            </div>
            {client.sector && (
              <p className="text-xs text-muted-foreground mt-0.5">{client.sector}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {client.status !== "archived" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => archiveMut.mutate()}
              className="gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>أرشفة</span>
            </Button>
          )}

          <Link to="/projects">
            <Button size="sm" className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              <span>إضافة مشروع جديد</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Summary KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>مشاريع العميل</span>
              <FolderKanban className="h-4 w-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{projects.length}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">مشروع مسجل</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>المنافسات النشطة</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-500">{activeTenders.length}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">فرص قيد الدراسة والتقديم</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>إجمالي قيمة المشاريع</span>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold font-mono text-primary truncate" title={fmtSAR(totalValue, language)}>
              {fmtSAR(totalValue, language)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">ميزانية تقديرية</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>جهات الاتصال</span>
              <UserPlus className="h-4 w-4 text-blue-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-blue-500">
              {client.contacts?.length || 0}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">مسؤولين محددين</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="projects" className="space-y-4">
        <TabsList className="bg-muted/60 p-1">
          <TabsTrigger value="projects" className="gap-2 text-xs">
            <FolderKanban className="h-3.5 w-3.5" />
            <span>مشاريع العميل ({projects.length})</span>
          </TabsTrigger>
          <TabsTrigger value="tenders" className="gap-2 text-xs">
            <Clock className="h-3.5 w-3.5" />
            <span>سجل المنافسات ({tenders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="contacts" className="gap-2 text-xs">
            <UserPlus className="h-3.5 w-3.5" />
            <span>جهات الاتصال ({client.contacts?.length || 0})</span>
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2 text-xs">
            <FileText className="h-3.5 w-3.5" />
            <span>الملاحظات والملف</span>
          </TabsTrigger>
        </TabsList>

        {/* 1. Client Projects */}
        <TabsContent value="projects" className="space-y-3">
          {projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center space-y-2">
              <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground opacity-40" />
              <p className="text-xs text-muted-foreground">لا توجد مشاريع مسجلة لهذا العميل حتى الآن.</p>
              <Link to="/projects">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs mt-2">
                  <Plus className="h-3.5 w-3.5" />
                  <span>إضافة مشروع جديد</span>
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs text-start">
                <thead className="bg-muted/50 border-b border-border font-semibold text-muted-foreground">
                  <tr>
                    <th className="p-3 text-start">رقم المشروع</th>
                    <th className="p-3 text-start">اسم المشروع</th>
                    <th className="p-3 text-start">الكود</th>
                    <th className="p-3 text-start">الموقع</th>
                    <th className="p-3 text-start">نطاق العمل</th>
                    <th className="p-3 text-start">آخر موعد تقديم</th>
                    <th className="p-3 text-start">القيمة التقديرية</th>
                    <th className="p-3 text-end">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {projects.map((p: Record<string, any>) => (
                    <tr key={String(p["id"])} className="hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-mono">{String(p["project_no"] || "—")}</td>
                      <td className="p-3 font-medium text-foreground">
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: String(p["id"]) }}
                          className="hover:text-primary hover:underline flex items-center gap-1.5"
                        >
                          <span>{String(p["name"])}</span>
                          <ExternalLink className="h-3 w-3 opacity-60" />
                        </Link>
                      </td>
                      <td className="p-3 font-mono text-[11px] text-muted-foreground">
                        {String(p["code"] || "—")}
                      </td>
                      <td className="p-3 text-muted-foreground">{String(p["location"] || "—")}</td>
                      <td className="p-3 text-muted-foreground">{String(p["scope_of_work"] || "—")}</td>
                      <td className="p-3 font-mono text-muted-foreground">
                        {String(p["last_submit_date"] || "—")}
                      </td>
                      <td className="p-3 font-mono font-bold text-primary">
                        {fmtSAR(Number(p["estimated_value"] || 0), language)}
                      </td>
                      <td className="p-3 text-end">
                        <Link to="/projects/$projectId" params={{ projectId: String(p["id"]) }}>
                          <Button size="sm" variant="ghost" className="h-7 text-xs">
                            فتح
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* 2. Client Tenders */}
        <TabsContent value="tenders" className="space-y-3">
          {tenders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center space-y-2">
              <Clock className="mx-auto h-8 w-8 text-muted-foreground opacity-40" />
              <p className="text-xs text-muted-foreground">لا توجد منافسات مسجلة تحت هذا العميل.</p>
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs text-start">
                <thead className="bg-muted/50 border-b border-border font-semibold text-muted-foreground">
                  <tr>
                    <th className="p-3 text-start">رقم المنافسة</th>
                    <th className="p-3 text-start">اسم المنافسة</th>
                    <th className="p-3 text-start">الحزمة</th>
                    <th className="p-3 text-start">المسؤول</th>
                    <th className="p-3 text-start">موعد التقديم</th>
                    <th className="p-3 text-start">الحالة</th>
                    <th className="p-3 text-start">القيمة التقديرية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {tenders.map((t) => {
                    const statusMeta = TENDER_STATUS_META[t.status] ?? {
                      label: t.status,
                      cls: "bg-muted",
                    };
                    return (
                      <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-mono font-bold text-primary">{t.tender_no}</td>
                        <td className="p-3 font-medium text-foreground">{t.title}</td>
                        <td className="p-3 text-muted-foreground">{t.package_name || "—"}</td>
                        <td className="p-3 text-muted-foreground">{t.responsible_person || "—"}</td>
                        <td className="p-3 font-mono">{t.submission_deadline || "غير محدد"}</td>
                        <td className="p-3">
                          <Badge variant="outline" className={statusMeta.cls}>
                            {statusMeta.label}
                          </Badge>
                        </td>
                        <td className="p-3 font-mono font-bold text-foreground">
                          {t.estimated_value ? fmtSAR(t.estimated_value, language) : "غير محدد"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* 3. Contacts */}
        <TabsContent value="contacts" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">جهات الاتصال والمسؤولين</h3>
            <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>إضافة جهة اتصال</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md" dir="rtl">
                <DialogHeader>
                  <DialogTitle>إضافة جهة اتصال جديدة للعميل</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid gap-1">
                    <Label className="text-xs">الاسم *</Label>
                    <Input
                      value={newContact.name}
                      onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))}
                      placeholder="م. أحمد الشمري"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">المسمى الوظيفي</Label>
                    <Input
                      value={newContact.role}
                      onChange={(e) => setNewContact((c) => ({ ...c, role: e.target.value }))}
                      placeholder="مدير العقود والمنافسات"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">البريد الإلكتروني</Label>
                    <Input
                      type="email"
                      value={newContact.email}
                      onChange={(e) => setNewContact((c) => ({ ...c, email: e.target.value }))}
                      placeholder="contracting@client.gov.sa"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">رقم الهاتف</Label>
                    <Input
                      value={newContact.phone}
                      onChange={(e) => setNewContact((c) => ({ ...c, phone: e.target.value }))}
                      placeholder="+966 50 000 0000"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setContactDialogOpen(false)}>إلغاء</Button>
                  <Button onClick={() => addContactMut.mutate()} disabled={addContactMut.isPending}>
                    حفظ جهة الاتصال
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {!client.contacts || client.contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              لا توجد جهات اتصال مسجلة لهذا العميل.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {client.contacts.map((cnt) => (
                <Card key={cnt.id} className="bg-card/60">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-bold">{cnt.name}</CardTitle>
                      {cnt.is_primary && (
                        <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">
                          رئيسي
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{cnt.role}</p>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-xs text-muted-foreground">
                    {cnt.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-primary" />
                        <span className="font-mono">{cnt.phone}</span>
                      </div>
                    )}
                    {cnt.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-primary" />
                        <span className="truncate">{cnt.email}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 4. Notes */}
        <TabsContent value="notes">
          <Card className="bg-card/60">
            <CardHeader>
              <CardTitle className="text-sm">معلومات وملاحظات العميل</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs leading-relaxed">
              <div>
                <span className="font-semibold block text-foreground mb-1">الملاحظات والشروط:</span>
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {client.notes || "لا توجد ملاحظات مدونة."}
                </p>
              </div>
              <div className="border-t border-border/50 pt-3 text-[11px] text-muted-foreground flex items-center justify-between">
                <span>تاريخ التسجيل: {client.created_at ? new Date(client.created_at).toLocaleDateString("ar-SA") : "—"}</span>
                <span>معرف العميل الداخلي: <code className="font-mono">{client.id}</code></span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
