import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Building2, UserPlus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";
import { estimationClient } from "@/lib/estimation-client";
import { checkDuplicateClientName } from "@/lib/client-tender-service";
import type { Client, ClientType } from "@/types/client-tender";
import { useLanguage } from "@/lib/i18n";

export function NewClientDialog({
  onSuccess,
  trigger,
}: {
  onSuccess?: (c: Client) => void;
  trigger?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: "",
    name: "",
    type: "government" as ClientType,
    sector: "إنشاءات عامة",
    contactName: "",
    contactRole: "مسؤول المنافسات",
    contactEmail: "",
    contactPhone: "",
    notes: "",
  });

  const set = (k: keyof typeof form, v: any) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "name") setDuplicateWarning(null);
  };

  const handleNameBlur = async () => {
    if (!form.name.trim()) return;
    const isDup = await checkDuplicateClientName(form.name);
    if (isDup) {
      setDuplicateWarning(`تنبيه: يوجد عميل مسجل مسبقاً بنفس الاسم "${form.name.trim()}". يُرجى التأكد لتجنب التكرار.`);
    } else {
      setDuplicateWarning(null);
    }
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("اسم العميل أو الجهة مطلوب");

      const code =
        form.code.trim() ||
        `CLI-${Math.floor(100 + Math.random() * 900)}`;

      const newClient = {
        id: crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}`,
        code,
        name: form.name.trim(),
        type: form.type,
        sector: form.sector.trim() || null,
        status: "active",
        contacts: form.contactName.trim()
          ? [
              {
                id: "1",
                name: form.contactName.trim(),
                role: form.contactRole.trim() || "جهة اتصال",
                ...(form.contactEmail.trim() ? { email: form.contactEmail.trim() } : {}),
                ...(form.contactPhone.trim() ? { phone: form.contactPhone.trim() } : {}),
                is_primary: true,
              },
            ]
          : [],
        notes: form.notes.trim() || null,
        created_at: new Date().toISOString(),
      };

      const { data, error } = await estimationClient
        .from("clients")
        .insert(newClient as any)
        .select()
        .single();

      if (error) throw error;
      return ((data || newClient) as unknown) as Client;
    },
    onSuccess: (client) => {
      toast.success(`تمت إضافة العميل "${client.name}" بنجاح`);
      qc.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
      setForm({
        code: "",
        name: "",
        type: "government",
        sector: "إنشاءات عامة",
        contactName: "",
        contactRole: "مسؤول المنافسات",
        contactEmail: "",
        contactPhone: "",
        notes: "",
      });
      setDuplicateWarning(null);
      onSuccess?.(client);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            <span>عميل جديد</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <span>إضافة عميل أو جهة مالكة جديدة</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3.5 py-2">
          {duplicateWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{duplicateWarning}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>كود العميل (Code)</Label>
              <Input
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="MOH-SA"
              />
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label>اسم العميل / الجهة *</Label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                onBlur={handleNameBlur}
                placeholder="مثال: وزارة الصحة — الديوان العام"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>نوع الجهة</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v as ClientType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="government">حكومي</SelectItem>
                  <SelectItem value="semi_gov">شبه حكومي</SelectItem>
                  <SelectItem value="private">قطاع خاص</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>القطاع</Label>
              <Input
                value={form.sector}
                onChange={(e) => set("sector", e.target.value)}
                placeholder="صحي، تعليمي، تجاري…"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <UserPlus className="h-4 w-4 text-primary" />
              <span>جهة الاتصال الرئيسية (اختياري)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label className="text-xs">اسم المسؤول</Label>
                <Input
                  className="h-8 text-xs"
                  value={form.contactName}
                  onChange={(e) => set("contactName", e.target.value)}
                  placeholder="م. عبد الله المحمد"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">المسمى الوظيفي</Label>
                <Input
                  className="h-8 text-xs"
                  value={form.contactRole}
                  onChange={(e) => set("contactRole", e.target.value)}
                  placeholder="مدير العقود والمشتريات"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label className="text-xs">البريد الإلكتروني</Label>
                <Input
                  className="h-8 text-xs"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  placeholder="contracts@client.gov.sa"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">رقم الهاتف</Label>
                <Input
                  className="h-8 text-xs"
                  value={form.contactPhone}
                  onChange={(e) => set("contactPhone", e.target.value)}
                  placeholder="+966 11 000 0000"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>ملاحظات</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="شروط خاصة، متطلبات التقديم، معلومات الاعتماد…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "جاري الحفظ…" : "حفظ العميل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
