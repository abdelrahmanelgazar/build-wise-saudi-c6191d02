import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Building2,
  Search,
  FolderKanban,
  FileText,
  TrendingUp,
  MoreVertical,
  Archive,
  Phone,
  Mail,
  ExternalLink,
  Plus,
  ShieldCheck,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { fetchClientsWithStats, archiveClient } from "@/lib/client-tender-service";
import type { ClientType, ClientStatus } from "@/types/client-tender";
import { CLIENT_TYPE_META, CLIENT_STATUS_META } from "@/types/client-tender";
import { NewClientDialog } from "@/components/clients/new-client-dialog";
import { MergeClientsDialog } from "@/components/clients/merge-clients-dialog";
import { fmtSAR } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/clients/")({
  head: () => ({
    meta: [
      { title: "سجل العملاء والجهات المالكة — تقديري" },
      {
        name: "description",
        content: "إدارة سجل العملاء والجهات المالكة، تجميع المشاريع والمنافسات، ومتابعة الفرص النشطة في السوق السعودي.",
      },
    ],
  }),
  component: ClientsIndexPage,
});

function ClientsIndexPage() {
  const { t, language } = useLanguage();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ClientType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "all">("active");

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClientsWithStats,
  });

  const archiveMut = useMutation({
    mutationFn: async (id: string) => {
      await archiveClient(id);
    },
    onSuccess: () => {
      toast.success("تم أرشفة العميل بنجاح");
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    return clients
      .filter((c) => statusFilter === "all" || c.status === statusFilter)
      .filter((c) => typeFilter === "all" || c.type === typeFilter)
      .filter((c) => {
        if (!search) return true;
        const s = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(s) ||
          c.code.toLowerCase().includes(s) ||
          (c.sector ?? "").toLowerCase().includes(s)
        );
      });
  }, [clients, search, typeFilter, statusFilter]);

  // Overall KPI metrics
  const totalCount = clients.length;
  const govCount = clients.filter((c) => c.type === "government").length;
  const privateCount = clients.filter((c) => c.type === "private" || c.type === "semi_gov").length;
  const totalPipelineVal = clients.reduce((s, c) => s + c.total_value, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Building2 className="h-7 w-7 text-primary" />
            <span>العملاء والجهات المالكة</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            إدارة سجل العملاء، تجميع المشاريع والمنافسات تحت كل جهة، ومتابعة الفرص والمواعيد.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MergeClientsDialog clients={clients} />
          <NewClientDialog />
        </div>
      </div>

      {/* KPI Stats Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              إجمالي العملاء
            </CardTitle>
            <Building2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{totalCount}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">جهات مسجلة بالنظام</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              جهات حكومية
            </CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-500">{govCount}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">وزارات وهيئات عامة</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              قطاع خاص وشبه حكومي
            </CardTitle>
            <Briefcase className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-blue-500">{privateCount}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">شركات ومطورين</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              قيمة مشاريع العملاء
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono text-primary truncate" title={fmtSAR(totalPipelineVal, language)}>
              {fmtSAR(totalPipelineVal, language)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">إجمالي الميزانيات التقديرية</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث باسم العميل أو الكود أو القطاع…"
            className="h-9 ps-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="نوع الجهة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="government">حكومي</SelectItem>
            <SelectItem value="semi_gov">شبه حكومي</SelectItem>
            <SelectItem value="private">قطاع خاص</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="inactive">غير نشط</SelectItem>
            <SelectItem value="archived">مؤرشف</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Clients Grid */}
      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground animate-pulse">
          جاري تحميل بيانات العملاء…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center space-y-3">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground opacity-40" />
          <h3 className="text-base font-semibold">لا يوجد عملاء مطابقين للبحث</h3>
          <p className="text-xs text-muted-foreground">
            يمكنك إضافة عميل جديد للبدء في تجميع المشاريع والمنافسات تحت ملفه.
          </p>
          <NewClientDialog />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((client) => {
            const typeMeta = CLIENT_TYPE_META[client.type] ?? { label: client.type, cls: "bg-muted" };
            const statusMeta = CLIENT_STATUS_META[client.status] ?? { label: client.status, cls: "bg-muted" };
            const primaryContact = client.contacts?.[0];

            return (
              <Card
                key={client.id}
                className="group relative flex flex-col justify-between transition-all hover:border-primary/50 hover:shadow-md bg-card/70"
              >
                <CardHeader className="pb-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                      {client.code}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className={typeMeta.cls}>
                        {typeMeta.label}
                      </Badge>
                      {client.status === "archived" && (
                        <Badge variant="outline" className={statusMeta.cls}>
                          {statusMeta.label}
                        </Badge>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <Link to="/clients/$clientId" params={{ clientId: client.id }}>
                            <DropdownMenuItem className="gap-2 cursor-pointer">
                              <ExternalLink className="h-3.5 w-3.5" />
                              <span>فتح ملف العميل</span>
                            </DropdownMenuItem>
                          </Link>
                          {client.status !== "archived" && (
                            <DropdownMenuItem
                              onClick={() => archiveMut.mutate(client.id)}
                              className="gap-2 text-destructive cursor-pointer"
                            >
                              <Archive className="h-3.5 w-3.5" />
                              <span>أرشفة العميل</span>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: client.id }}
                    className="block group-hover:text-primary transition-colors"
                  >
                    <CardTitle className="text-base font-bold leading-snug line-clamp-2">
                      {client.name}
                    </CardTitle>
                  </Link>

                  {client.sector && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/60 inline-block" />
                      <span>{client.sector}</span>
                    </p>
                  )}
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  {/* Primary contact if available */}
                  {primaryContact && (
                    <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground space-y-1">
                      <div className="font-medium text-foreground flex items-center justify-between">
                        <span>{primaryContact.name}</span>
                        <span className="text-[10px] text-muted-foreground">{primaryContact.role}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px]">
                        {primaryContact.phone && (
                          <span className="flex items-center gap-1 font-mono">
                            <Phone className="h-3 w-3" />
                            {primaryContact.phone}
                          </span>
                        )}
                        {primaryContact.email && (
                          <span className="flex items-center gap-1 truncate max-w-[150px]">
                            <Mail className="h-3 w-3" />
                            {primaryContact.email}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Metrics summary */}
                  <div className="grid grid-cols-2 gap-2 border-t border-border/50 pt-2.5 text-xs">
                    <div>
                      <span className="text-muted-foreground text-[11px] block">المشاريع:</span>
                      <span className="font-bold font-mono text-sm">
                        {client.projects_count} مشاريع
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-[11px] block">المنافسات النشطة:</span>
                      <span className="font-bold font-mono text-sm text-emerald-500">
                        {client.active_tenders_count} منافسة
                      </span>
                    </div>
                  </div>

                  {/* Footer actions */}
                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                    <span className="text-xs font-semibold font-mono text-primary">
                      {fmtSAR(client.total_value, language)}
                    </span>
                    <Link to="/clients/$clientId" params={{ clientId: client.id }}>
                      <Button size="sm" variant="ghost" className="gap-1 text-xs h-7 px-2">
                        <span>تفاصيل العميل</span>
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
