import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  FolderKanban,
  ExternalLink,
  Layers,
  X,
} from "lucide-react";
import { estimationClient } from "@/lib/estimation-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { fmtSAR } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import { setActiveProjectId } from "@/lib/active-project";
import type { Client } from "@/types/client-tender";

export interface CompanyRow {
  id: string;
  workspace_id: string;
  name: string;
  code: string | null;
  created_at?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  code?: string | null;
  client_id: string | null;
  client_name: string | null;
  company_id: string | null;
  company_name: string | null;
  estimated_value: number | null;
}

const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

export function CompaniesManager({
  clients,
  selectedCompanyName,
  openNewCompany = false,
  openEditForSelected = false,
  onClearCompanyFilter,
}: {
  clients: Client[];
  selectedCompanyName?: string;
  openNewCompany?: boolean;
  openEditForSelected?: boolean;
  onClearCompanyFilter?: () => void;
}) {
  const qc = useQueryClient();
  const { language } = useLanguage();

  const [newCompanyOpen, setNewCompanyOpen] = useState(openNewCompany);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");

  const [editingCompany, setEditingCompany] = useState<{ id: string | null; originalName: string; name: string; code: string } | null>(null);
  const [linkingCompany, setLinkingCompany] = useState<{ id: string | null; name: string } | null>(null);

  // Link client + projects state
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientSector, setNewClientSector] = useState("إنشاءات عامة");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [newProjectTitle, setNewProjectTitle] = useState("");

  useEffect(() => {
    if (openNewCompany) setNewCompanyOpen(true);
  }, [openNewCompany]);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("companies")
        .select("*")
        .order("name", { ascending: true });
      if (error) return [] as CompanyRow[];
      return ((data as unknown) as CompanyRow[] | null) ?? [];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("projects")
        .select("id, name, code, client_id, client_name, company_id, company_name, estimated_value")
        .order("created_at", { ascending: false });
      if (error) return [] as ProjectRow[];
      return ((data as unknown) as ProjectRow[] | null) ?? [];
    },
  });

  // Merge registered companies + derived project companies + "شركة غير محددة" if needed
  const mergedCompanies = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string | null;
        name: string;
        code: string | null;
        isVirtualUnassigned: boolean;
        projects: ProjectRow[];
        owners: Map<string, { ownerName: string; clientId: string | null; projects: ProjectRow[] }>;
      }
    >();

    for (const c of companies) {
      map.set(c.name, {
        id: c.id,
        name: c.name,
        code: c.code,
        isVirtualUnassigned: false,
        projects: [],
        owners: new Map(),
      });
    }

    for (const p of projects) {
      const cName = (p.company_name || "").trim() || "شركة غير محددة";
      if (!map.has(cName)) {
        map.set(cName, {
          id: p.company_id ?? null,
          name: cName,
          code: null,
          isVirtualUnassigned: cName === "شركة غير محددة",
          projects: [],
          owners: new Map(),
        });
      }
      const entry = map.get(cName)!;
      entry.projects.push(p);

      const ownerName = (p.client_name || "مالك / عميل غير محدد").trim();
      const ownerKey = p.client_id || ownerName;
      if (!entry.owners.has(ownerKey)) {
        entry.owners.set(ownerKey, { ownerName, clientId: p.client_id, projects: [] });
      }
      entry.owners.get(ownerKey)!.projects.push(p);
    }

    const list = Array.from(map.values());
    if (selectedCompanyName) {
      return list.filter((c) => c.name === selectedCompanyName);
    }
    return list;
  }, [companies, projects, selectedCompanyName]);

  useEffect(() => {
    if (openEditForSelected && selectedCompanyName) {
      const match = mergedCompanies.find((c) => c.name === selectedCompanyName);
      if (match) {
        setEditingCompany({
          id: match.id,
          originalName: match.name,
          name: match.isVirtualUnassigned ? "" : match.name,
          code: match.code ?? "",
        });
      }
    }
  }, [openEditForSelected, selectedCompanyName, mergedCompanies]);

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["companies"] }),
      qc.invalidateQueries({ queryKey: ["projects"] }),
      qc.invalidateQueries({ queryKey: ["clients"] }),
      qc.invalidateQueries({ queryKey: ["project-switcher-projects"] }),
      qc.invalidateQueries({ queryKey: ["dashboard-projects"] }),
    ]);
  };

  const createCompanyMut = useMutation({
    mutationFn: async () => {
      const trimmed = newName.trim();
      if (!trimmed) throw new Error("اسم الشركة مطلوب");
      const { error } = await estimationClient.from("companies").insert({
        workspace_id: DEFAULT_WORKSPACE_ID,
        name: trimmed,
        code: newCode.trim() || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تمت إضافة الشركة بنجاح");
      setNewCompanyOpen(false);
      setNewName("");
      setNewCode("");
      await invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editCompanyMut = useMutation({
    mutationFn: async () => {
      if (!editingCompany) return;
      const nextName = editingCompany.name.trim();
      if (!nextName) throw new Error("يرجى إدخال اسم الشركة الجديد");

      let companyId = editingCompany.id;
      if (companyId) {
        const { error } = await estimationClient
          .from("companies")
          .update({ name: nextName, code: editingCompany.code.trim() || null } as any)
          .eq("id", companyId);
        if (error) throw error;
      } else {
        const { data: created, error } = await estimationClient
          .from("companies")
          .insert({
            workspace_id: DEFAULT_WORKSPACE_ID,
            name: nextName,
            code: editingCompany.code.trim() || null,
          } as any)
          .select("id")
          .single();
        if (error) throw error;
        companyId = (created as any)?.id ?? null;
      }

      // Update all projects belonging to the previous company name (or unassigned if originalName === "شركة غير محددة")
      const affected = projects.filter((p) => {
        const cur = (p.company_name || "").trim() || "شركة غير محددة";
        return cur === editingCompany.originalName;
      });

      for (const p of affected) {
        await estimationClient
          .from("projects")
          .update({ company_id: companyId, company_name: nextName } as any)
          .eq("id", p.id);
      }
    },
    onSuccess: async () => {
      toast.success("تم تحديث بيانات الشركة ومشاريعها بنجاح");
      setEditingCompany(null);
      await invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCompanyMut = useMutation({
    mutationFn: async (comp: { id: string | null; name: string }) => {
      // Unassign projects safely first
      const affected = projects.filter(
        (p) => ((p.company_name || "").trim() || "شركة غير محددة") === comp.name,
      );
      for (const p of affected) {
        await estimationClient
          .from("projects")
          .update({ company_id: null, company_name: null } as any)
          .eq("id", p.id);
      }
      if (comp.id) {
        const { error } = await estimationClient.from("companies").delete().eq("id", comp.id);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("تم حذف الشركة وفك ارتباط مشاريعها بنجاح");
      await invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linkClientAndProjectsMut = useMutation({
    mutationFn: async () => {
      if (!linkingCompany) return;

      // Ensure company record exists in `companies`
      let companyId = linkingCompany.id;
      const companyName = linkingCompany.name === "شركة غير محددة" ? "شركة غير محددة" : linkingCompany.name;
      if (!companyId && companyName !== "شركة غير محددة") {
        const { data: createdComp } = await estimationClient
          .from("companies")
          .insert({ workspace_id: DEFAULT_WORKSPACE_ID, name: companyName } as any)
          .select("id")
          .single();
        companyId = (createdComp as any)?.id ?? null;
      }

      // Resolve or create client
      let targetClientId = selectedClientId;
      let targetClientName = clients.find((c) => c.id === selectedClientId)?.name ?? "";

      if (clientMode === "new") {
        const trimmedClient = newClientName.trim();
        if (!trimmedClient) throw new Error("يرجى إدخال اسم العميل (المالك)");
        const newId = crypto.randomUUID ? crypto.randomUUID() : `cli-${Date.now()}`;
        const { error: cErr } = await estimationClient.from("clients").insert({
          id: newId,
          code: `CLI-${Math.floor(100 + Math.random() * 900)}`,
          name: trimmedClient,
          type: "private",
          sector: newClientSector.trim() || "إنشاءات عامة",
          status: "active",
          contacts: [],
        } as any);
        if (cErr) throw cErr;
        targetClientId = newId;
        targetClientName = trimmedClient;
      } else if (!targetClientId) {
        throw new Error("اختر عميلاً أو أنشئ عميلاً جديداً");
      }

      // Link company <-> client if real company and obtain link ID
      let linkId: string | null = null;
      if (companyId) {
        const { data: linkRow } = await estimationClient
          .from("company_client_links")
          .upsert(
            {
              workspace_id: DEFAULT_WORKSPACE_ID,
              company_id: companyId,
              client_id: targetClientId,
            } as any,
            { onConflict: "workspace_id,company_id,client_id" } as any,
          )
          .select("id")
          .maybeSingle();
        linkId = (linkRow as any)?.id ?? null;
      }

      // Attach selected existing projects to this company & client
      for (const pid of selectedProjectIds) {
        await estimationClient
          .from("projects")
          .update({
            company_id: companyId,
            company_client_link_id: linkId,
            company_name: companyName === "شركة غير محددة" ? null : companyName,
            client_id: targetClientId,
            client_name: targetClientName,
          } as any)
          .eq("id", pid);
      }

      // Optionally create a brand new project under this company & client
      if (newProjectTitle.trim()) {
        const { data: u } = await estimationClient.auth.getUser();
        const userId = u.user?.id || "00000000-0000-4000-8000-000000000001";
        await estimationClient.from("projects").insert({
          user_id: userId,
          name: newProjectTitle.trim(),
          company_id: companyId,
          company_client_link_id: linkId,
          company_name: companyName === "شركة غير محددة" ? null : companyName,
          client_id: targetClientId,
          client_name: targetClientName,
          status: "studying",
        } as any);
      }
    },
    onSuccess: async () => {
      toast.success("تم ربط العميل ومشاريعه بالشركة بنجاح");
      setLinkingCompany(null);
      setSelectedProjectIds(new Set());
      setNewClientName("");
      setNewProjectTitle("");
      await invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 p-4">
        <div className="flex items-center gap-2.5">
          <Layers className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-bold">
              {selectedCompanyName ? `شركة: ${selectedCompanyName}` : "إدارة الشركات (الجهات الدارسة) وعملائها"}
            </h2>
            <p className="text-xs text-muted-foreground">
              أضف شركة، عدّل اسمها أو بياناتها، احذفها، أو اربط بها عميلاً (مالكاً) مع مشاريعه.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedCompanyName && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onClearCompanyFilter?.()}
              className="gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              عرض عام (كل الشركات)
            </Button>
          )}
          <Button size="sm" onClick={() => setNewCompanyOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            إضافة شركة جديدة
          </Button>
        </div>
      </div>

      {/* Companies Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {mergedCompanies.map((comp) => {
          const totalVal = comp.projects.reduce((s, p) => s + Number(p.estimated_value ?? 0), 0);
          const ownersList = Array.from(comp.owners.values());

          return (
            <Card key={comp.name} className="border-border/70 bg-card/70">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <span>{comp.name}</span>
                        {comp.code && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {comp.code}
                          </Badge>
                        )}
                      </CardTitle>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {ownersList.length} عميل/مالك · {comp.projects.length} مشروع · {fmtSAR(totalVal, language)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => {
                        setLinkingCompany({ id: comp.id, name: comp.name });
                        setSelectedClientId(clients[0]?.id ?? "");
                      }}
                    >
                      <UserPlus className="h-3.5 w-3.5 text-primary" />
                      <span>إضافة عميل ومشاريع</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="تعديل اسم وبيانات الشركة"
                      onClick={() =>
                        setEditingCompany({
                          id: comp.id,
                          originalName: comp.name,
                          name: comp.isVirtualUnassigned ? "" : comp.name,
                          code: comp.code ?? "",
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {!comp.isVirtualUnassigned && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="حذف الشركة"
                        onClick={() => {
                          if (confirm(`هل أنت متأكد من حذف شركة "${comp.name}"؟ ستبقى المشاريع محفوظة بدون شركة.`)) {
                            deleteCompanyMut.mutate({ id: comp.id, name: comp.name });
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-2.5 pt-0">
                {ownersList.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    لا يوجد عملاء أو مشاريع مرتبطة بهذه الشركة بعد.
                  </div>
                ) : (
                  ownersList.map((owner) => (
                    <div key={owner.ownerName} className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>{owner.ownerName}</span>
                        {owner.clientId && (
                          <Link
                            to="/clients/$clientId"
                            params={{ clientId: owner.clientId }}
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-normal"
                          >
                            ملف العميل <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {owner.projects.map((p) => (
                          <Link
                            key={p.id}
                            to="/projects/$projectId"
                            params={{ projectId: p.id }}
                            onClick={() => setActiveProjectId(p.id)}
                          >
                            <Badge
                              variant="secondary"
                              className="gap-1 text-[11px] hover:bg-primary/15 hover:text-primary cursor-pointer"
                            >
                              <FolderKanban className="h-3 w-3" />
                              {p.name}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add New Company Dialog */}
      <Dialog open={newCompanyOpen} onOpenChange={setNewCompanyOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة شركة جديدة</DialogTitle>
            <DialogDescription className="text-xs">
              أضف اسم الشركة (مثل شركة العالمية أو شركة أوتاد الفهد) لتجميع العملاء والمشاريع تحتها.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1.5">
              <Label>اسم الشركة</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="مثال: شركة أوتاد الفهد للمقاولات"
              />
            </div>
            <div className="space-y-1.5">
              <Label>رمز الشركة (اختياري)</Label>
              <Input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="مثال: AWTAD"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setNewCompanyOpen(false)}>
              إلغاء
            </Button>
            <Button
              size="sm"
              disabled={!newName.trim() || createCompanyMut.isPending}
              onClick={() => createCompanyMut.mutate()}
            >
              {createCompanyMut.isPending ? "جاري الحفظ…" : "حفظ الشركة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Company Dialog */}
      <Dialog open={Boolean(editingCompany)} onOpenChange={(o) => { if (!o) setEditingCompany(null); }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تعديل اسم وبيانات الشركة</DialogTitle>
            <DialogDescription className="text-xs">
              سيتم تحديث اسم الشركة تلقائياً على جميع المشاريع والعملاء المرتبطين بـ ({editingCompany?.originalName}).
            </DialogDescription>
          </DialogHeader>
          {editingCompany && (
            <div className="space-y-3 py-2 text-xs">
              <div className="space-y-1.5">
                <Label>اسم الشركة</Label>
                <Input
                  value={editingCompany.name}
                  onChange={(e) => setEditingCompany({ ...editingCompany, name: e.target.value })}
                  placeholder="أدخل اسم الشركة الجديد"
                />
              </div>
              <div className="space-y-1.5">
                <Label>رمز الشركة</Label>
                <Input
                  value={editingCompany.code}
                  onChange={(e) => setEditingCompany({ ...editingCompany, code: e.target.value })}
                  placeholder="اختياري"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditingCompany(null)}>
              إلغاء
            </Button>
            <Button
              size="sm"
              disabled={!editingCompany?.name.trim() || editCompanyMut.isPending}
              onClick={() => editCompanyMut.mutate()}
            >
              {editCompanyMut.isPending ? "جاري الحفظ…" : "حفظ التعديلات"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Client & Projects to Company Dialog */}
      <Dialog open={Boolean(linkingCompany)} onOpenChange={(o) => { if (!o) setLinkingCompany(null); }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إضافة عميل ومشاريع للشركة ({linkingCompany?.name})</DialogTitle>
            <DialogDescription className="text-xs">
              اختر عميلاً حالياً أو أنشئ عميلاً جديداً، وحدد المشاريع التابعة له لربطها بهذه الشركة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 text-xs">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={clientMode === "existing" ? "default" : "outline"}
                onClick={() => setClientMode("existing")}
              >
                اختيار عميل حالي
              </Button>
              <Button
                type="button"
                size="sm"
                variant={clientMode === "new" ? "default" : "outline"}
                onClick={() => setClientMode("new")}
              >
                إنشاء عميل جديد
              </Button>
            </div>

            {clientMode === "existing" ? (
              <div className="space-y-1.5">
                <Label>العميل (المالك)</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر عميلاً…" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>اسم العميل الجديد</Label>
                  <Input
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="مثال: وزارة الصحة / شركة المطور"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>القطاع</Label>
                  <Input
                    value={newClientSector}
                    onChange={(e) => setNewClientSector(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>ربط مشاريع قائمة بهذا العميل والشركة</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1.5">
                {projects.length === 0 ? (
                  <div className="text-muted-foreground text-center py-2">لا توجد مشاريع قائمة</div>
                ) : (
                  projects.map((p) => {
                    const checked = selectedProjectIds.has(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded px-1.5 py-1">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            const next = new Set(selectedProjectIds);
                            if (v) next.add(p.id);
                            else next.delete(p.id);
                            setSelectedProjectIds(next);
                          }}
                        />
                        <span className="flex-1 truncate font-medium">{p.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {p.company_name || "غير محددة"}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>أو إنشاء مشروع جديد مباشرة داخل الشركة (اختياري)</Label>
              <Input
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                placeholder="اكتب اسم المشروع الجديد لإنشائه وربطه تلقائياً…"
              />
            </div>

            {selectedProjectIds.size > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1 text-[11px]">
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  معاينة أثر النقل ({selectedProjectIds.size} مشروع محدد):
                </div>
                {projects
                  .filter((p) => selectedProjectIds.has(p.id))
                  .map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span className="truncate font-medium text-foreground">{p.name}</span>
                      <span className="shrink-0">
                        {p.company_name || "غير محددة"} ({p.client_name || "—"}) ←{" "}
                        <strong className="text-primary">{linkingCompany?.name}</strong>
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setLinkingCompany(null)}>
              إلغاء
            </Button>
            <Button
              size="sm"
              disabled={linkClientAndProjectsMut.isPending}
              onClick={() => linkClientAndProjectsMut.mutate()}
            >
              {linkClientAndProjectsMut.isPending ? "جاري الربط…" : "حفظ وربط بالشركة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
