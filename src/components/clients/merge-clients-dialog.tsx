import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitMerge, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { mergeClients } from "@/lib/client-tender-service";
import type { ClientWithStats } from "@/lib/client-tender-service";

export function MergeClientsDialog({ clients }: { clients: ClientWithStats[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");

  const activeClients = clients.filter((c) => c.status !== "archived");

  const mut = useMutation({
    mutationFn: async () => {
      if (!sourceId || !targetId) throw new Error("يرجى اختيار العميلين المراد دمجهما");
      if (sourceId === targetId) throw new Error("لا يمكن دمج العميل مع نفسه");
      await mergeClients(sourceId, targetId, reason);
    },
    onSuccess: () => {
      toast.success("تم دمج العميلين بنجاح ونقل جميع المشاريع والمنافسات");
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tenders"] });
      setOpen(false);
      setSourceId("");
      setTargetId("");
      setReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <GitMerge className="h-4 w-4" />
          <span>دمج عملاء مكررين</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5 text-primary" />
            <span>دمج حسابين لعميل مكرر</span>
          </DialogTitle>
          <DialogDescription>
            سيتم نقل جميع المشاريع والمنافسات من الحساب المكرر إلى الحساب الأساسي وأرشفة الحساب القديم مع تسجيل سجل الحركة.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label className="text-destructive font-semibold">1. الحساب المكرر (سيتم أرشفته ونقل بياناته):</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر العميل المكرر…" />
              </SelectTrigger>
              <SelectContent>
                {activeClients.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.id === targetId}>
                    {c.name} ({c.code}) — {c.projects_count} مشاريع
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-primary font-semibold">2. الحساب الأساسي المستهدف (الذي سيبقى نشطاً):</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر العميل الأساسي…" />
              </SelectTrigger>
              <SelectContent>
                {activeClients.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.id === sourceId}>
                    {c.name} ({c.code}) — {c.projects_count} مشاريع
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>سبب الدمج / ملاحظات المراجع:</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: تصحيح تكرار اسم الوزارة مع اختلاف الهمزات…"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              هذه العملية ستنقل ارتباطات المشاريع وتوثّق سبب الدمج، ولن تحذف السجلات التاريخية.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !sourceId || !targetId}
            className="bg-primary text-primary-foreground"
          >
            {mut.isPending ? "جاري الدمج…" : "تأكيد الدمج والنقل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
