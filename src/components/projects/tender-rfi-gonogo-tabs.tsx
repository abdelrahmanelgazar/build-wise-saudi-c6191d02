import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { estimationClient } from "@/lib/estimation-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmtSAR } from "@/lib/format";
import { CheckCircle2, ClipboardCheck, FileWarning, Plus, Trash2 } from "lucide-react";
import type { Tender } from "@/types/client-tender";

type RfiEntryType = "rfi" | "addendum" | "clarification";
type RfiStatus = "draft" | "submitted" | "answered" | "incorporated" | "closed";

const ENTRY_TYPE_META: Record<RfiEntryType, { label: string; cls: string }> = {
  rfi: { label: "استفسار فني (RFI)", cls: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30" },
  addendum: { label: "ملحق تعديل (Addendum)", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  clarification: { label: "توضيح عميل", cls: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30" },
};

const RFI_STATUS_META: Record<RfiStatus, { label: string; cls: string }> = {
  draft: { label: "مسودة", cls: "bg-muted text-muted-foreground border-border" },
  submitted: { label: "مرسل للعميل", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  answered: { label: "تم الرد", cls: "bg-purple-500/15 text-purple-600 border-purple-500/30" },
  incorporated: { label: "مدمج في التسعير", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  closed: { label: "مغلق", cls: "bg-muted text-muted-foreground border-border" },
};

export function ProjectRfiAddendaTab({
  projectId,
  tenders,
}: {
  projectId: string;
  tenders: Tender[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [entryType, setEntryType] = useState<RfiEntryType>("rfi");
  const [tenderId, setTenderId] = useState<string>("none");
  const [refNo, setRefNo] = useState("");
  const [title, setTitle] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [responseText, setResponseText] = useState("");
  const [costImpactSar, setCostImpactSar] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<RfiStatus>("draft");

  const { data: rows = [] } = useQuery({
    queryKey: ["project_rfi_addenda", projectId],
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("project_rfi_addenda")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("أدخل عنوان الاستفسار أو الملحق");
      const { data: userData } = await estimationClient.auth.getUser();
      const userId = userData.user?.id || "00000000-0000-0000-0000-000000000000";
      const { error } = await estimationClient.from("project_rfi_addenda").insert({
        project_id: projectId,
        tender_id: tenderId !== "none" ? tenderId : null,
        user_id: userId,
        entry_type: entryType,
        ref_no: refNo.trim() || `${entryType.toUpperCase()}-${rows.length + 1}`,
        title: title.trim(),
        question_text: questionText.trim() || null,
        response_text: responseText.trim() || null,
        cost_impact_sar: Number(costImpactSar) || 0,
        status,
        due_date: dueDate || null,
        answered_at: status === "answered" || status === "incorporated" ? new Date().toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل البند في سجل الاستفسارات والملحقات");
      qc.invalidateQueries({ queryKey: ["project_rfi_addenda", projectId] });
      setOpen(false);
      setRefNo("");
      setTitle("");
      setQuestionText("");
      setResponseText("");
      setCostImpactSar("0");
      setDueDate("");
      setStatus("draft");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = async (id: string, nextStatus: RfiStatus) => {
    const { error } = await estimationClient
      .from("project_rfi_addenda")
      .update({
        status: nextStatus,
        answered_at: nextStatus === "answered" || nextStatus === "incorporated" ? new Date().toISOString() : null,
      })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("تم تحديث حالة الاستفسار / الملحق");
    qc.invalidateQueries({ queryKey: ["project_rfi_addenda", projectId] });
  };

  const deleteEntry = async (id: string) => {
    if (!confirm("حذف هذا السجل من سجل الاستفسارات والملحقات؟")) return;
    const { error } = await estimationClient.from("project_rfi_addenda").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["project_rfi_addenda", projectId] });
  };

  const totalCostImpact = useMemo(
    () => rows.reduce((s, r) => s + Number(r.cost_impact_sar ?? 0), 0),
    [rows],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-primary" />
            سجل الاستفسارات والملحقات (RFI & Addenda Log)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            توثيق الأسئلة الفنية الموجهة للعميل وملحقات تعديل المواصفات أو الكميات وأثرها المالي على المقايسة.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            إجمالي الأثر المالي المسجل: <strong className="mr-1 tabular-nums">{fmtSAR(totalCostImpact)}</strong>
          </Badge>
          <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            إضافة استفسار / ملحق
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground border rounded-lg bg-muted/10">
          لا توجد استفسارات أو ملحقات مسجلة لهذا المشروع حتى الآن.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs text-right">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">المرجع</th>
                <th className="px-3 py-2 font-medium">النوع</th>
                <th className="px-3 py-2 font-medium">الموضوع والتفاصيل</th>
                <th className="px-3 py-2 font-medium">رد العميل</th>
                <th className="px-3 py-2 font-medium">الأثر المالي</th>
                <th className="px-3 py-2 font-medium">الحالة</th>
                <th className="px-3 py-2 font-medium text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => {
                const tMeta = ENTRY_TYPE_META[(r.entry_type as RfiEntryType) || "rfi"];
                return (
                  <tr key={r.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-mono font-semibold">{r.ref_no}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${tMeta.cls}`}>{tMeta.label}</Badge>
                    </td>
                    <td className="px-3 py-2.5 max-w-xs">
                      <div className="font-semibold text-foreground">{r.title}</div>
                      {r.question_text && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{r.question_text}</div>}
                    </td>
                    <td className="px-3 py-2.5 max-w-xs text-[11px] text-muted-foreground">
                      {r.response_text || "—"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums font-medium">{fmtSAR(Number(r.cost_impact_sar ?? 0))}</td>
                    <td className="px-3 py-2.5">
                      <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v as RfiStatus)}>
                        <SelectTrigger className="h-7 w-36 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(RFI_STATUS_META) as RfiStatus[]).map((st) => (
                            <SelectItem key={st} value={st}>{RFI_STATUS_META[st].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteEntry(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إضافة استفسار فني (RFI) أو ملحق عطاء</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>النوع</Label>
                <Select value={entryType} onValueChange={(v) => setEntryType(v as RfiEntryType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rfi">استفسار فني (RFI)</SelectItem>
                    <SelectItem value="addendum">ملحق تعديل (Addendum)</SelectItem>
                    <SelectItem value="clarification">توضيح عميل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>رقم المرجع</Label>
                <Input value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="مثال: RFI-001" />
              </div>
            </div>
            {tenders.length > 0 && (
              <div className="space-y-1">
                <Label>الفرصة المرتبطة (اختياري)</Label>
                <Select value={tenderId} onValueChange={setTenderId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">عام على المشروع</SelectItem>
                    {tenders.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.tender_no} — {t.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>عنوان البند / الموضوع</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: مواصفة سماكة العزل المائي للأسطح" />
            </div>
            <div className="space-y-1">
              <Label>نص الاستفسار / التعديل</Label>
              <Textarea rows={2} value={questionText} onChange={(e) => setQuestionText(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>رد العميل أو القرار الهندسي</Label>
              <Textarea rows={2} value={responseText} onChange={(e) => setResponseText(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>الأثر المالي (ر.س)</Label>
                <Input type="number" value={costImpactSar} onChange={(e) => setCostImpactSar(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>تاريخ الاستحقاق</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>الحالة</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as RfiStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RFI_STATUS_META) as RfiStatus[]).map((st) => (
                      <SelectItem key={st} value={st}>{RFI_STATUS_META[st].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button size="sm" onClick={() => addMut.mutate()} disabled={addMut.isPending}>حفظ في السجل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type GoDecision = "pending" | "go" | "conditional_go" | "no_go";

export function TenderGoNoGoTab({
  projectId,
  tenders,
}: {
  projectId: string;
  tenders: Tender[];
}) {
  const qc = useQueryClient();
  const [selectedTenderId, setSelectedTenderId] = useState<string>("__project__");
  const targetTenderId = selectedTenderId === "__project__" ? null : selectedTenderId;

  const { data: existingEval } = useQuery({
    queryKey: ["tender_evaluation", projectId, targetTenderId],
    queryFn: async () => {
      const { data } = await estimationClient
        .from("tender_evaluations")
        .select("*")
        .eq("project_id", projectId);
      const list = (data as any[]) ?? [];
      return list.find((e) => (targetTenderId ? e.tender_id === targetTenderId : !e.tender_id)) ?? null;
    },
  });

  const [techFit, setTechFit] = useState<number>(3);
  const [commCap, setCommCap] = useState<number>(3);
  const [clientRel, setClientRel] = useState<number>(3);
  const [marginAttr, setMarginAttr] = useState<number>(3);
  const [riskCtrl, setRiskCtrl] = useState<number>(3);
  const [decision, setDecision] = useState<GoDecision>("pending");
  const [rationale, setRationale] = useState<string>("");

  const effectiveScores = useMemo(() => {
    const t = existingEval ? Number(existingEval.technical_fit_score ?? techFit) : techFit;
    const c = existingEval ? Number(existingEval.commercial_capacity_score ?? commCap) : commCap;
    const cl = existingEval ? Number(existingEval.client_relationship_score ?? clientRel) : clientRel;
    const m = existingEval ? Number(existingEval.margin_attractiveness_score ?? marginAttr) : marginAttr;
    const r = existingEval ? Number(existingEval.risk_exposure_score ?? riskCtrl) : riskCtrl;
    return { t, c, cl, m, r };
  }, [existingEval, techFit, commCap, clientRel, marginAttr, riskCtrl]);

  const currentOverallPct = useMemo(() => {
    const weighted =
      techFit * 0.25 +
      commCap * 0.25 +
      clientRel * 0.15 +
      marginAttr * 0.2 +
      riskCtrl * 0.15;
    return Math.round((weighted / 5) * 100);
  }, [techFit, commCap, clientRel, marginAttr, riskCtrl]);

  const recommendedDecision: GoDecision =
    currentOverallPct >= 75 ? "go" : currentOverallPct >= 55 ? "conditional_go" : "no_go";

  const saveMut = useMutation({
    mutationFn: async () => {
      const { data: userData } = await estimationClient.auth.getUser();
      const userId = userData.user?.id || "00000000-0000-0000-0000-000000000000";
      const payload = {
        project_id: projectId,
        tender_id: targetTenderId,
        user_id: userId,
        technical_fit_score: techFit,
        commercial_capacity_score: commCap,
        client_relationship_score: clientRel,
        margin_attractiveness_score: marginAttr,
        risk_exposure_score: riskCtrl,
        overall_score: currentOverallPct,
        decision,
        decision_rationale: rationale.trim() || null,
        decided_by: userData.user?.email || userId,
        decided_at: new Date().toISOString(),
      };
      if (existingEval?.id) {
        const { error } = await estimationClient
          .from("tender_evaluations")
          .update(payload)
          .eq("id", existingEval.id);
        if (error) throw error;
      } else {
        const { error } = await estimationClient.from("tender_evaluations").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("تم حفظ بطاقة تقييم القرار (Go / No-Go) بنجاح");
      qc.invalidateQueries({ queryKey: ["tender_evaluation", projectId, targetTenderId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const criteria = [
    { label: "الملاءمة الفنية والخبرة السابقة (25%)", val: techFit, set: setTechFit },
    { label: "القدرة المالية والسيولة والتشغيلية (25%)", val: commCap, set: setCommCap },
    { label: "علاقة العميل وفرصة المنافسة (15%)", val: clientRel, set: setClientRel },
    { label: "جاذبية هامش الربح المتوقع (20%)", val: marginAttr, set: setMarginAttr },
    { label: "انخفاض المخاطر التعاقدية والشروط (15%)", val: riskCtrl, set: setRiskCtrl },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-base flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            تقييم جدوى الدخول في المنافسة (Go / No-Go Scorecard)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            مقياس موضوعي موزون من 5 معايير لاعتماد قرار التقدم للعطاء أو الاعتذار وتوثيق المبررات.
          </p>
        </div>
        {tenders.length > 0 && (
          <Select value={selectedTenderId} onValueChange={setSelectedTenderId}>
            <SelectTrigger className="h-8 w-64 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__project__">التقييم العام للمشروع</SelectItem>
              {tenders.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.tender_no} — {t.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {existingEval && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            آخر تقييم محفوظ: درجة <strong>{existingEval.overall_score}%</strong> — القرار:{" "}
            <strong>
              {existingEval.decision === "go"
                ? "موافق (Go)"
                : existingEval.decision === "conditional_go"
                  ? "موافق بشروط (Conditional)"
                  : existingEval.decision === "no_go"
                    ? "اعتذار (No-Go)"
                    : "قيد المراجعة"}
            </strong>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => {
              setTechFit(effectiveScores.t);
              setCommCap(effectiveScores.c);
              setClientRel(effectiveScores.cl);
              setMarginAttr(effectiveScores.m);
              setRiskCtrl(effectiveScores.r);
              setDecision((existingEval.decision as GoDecision) || "pending");
              setRationale(existingEval.decision_rationale || "");
            }}
          >
            تحميل القيم المحفوظة للتعديل
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {criteria.map((item) => (
          <div key={item.label} className="rounded-md border border-border/80 bg-muted/20 p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">{item.label}</span>
              <Badge variant="secondary" className="tabular-nums">{item.val} / 5</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => item.set(n)}
                  className={`flex-1 rounded border py-1 text-center font-semibold transition-colors ${
                    item.val === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">النتيجة الموزونة المحسوبة</div>
          <div className="text-2xl font-bold tabular-nums text-primary">{currentOverallPct}%</div>
          <div className="text-[11px] text-muted-foreground">
            التوصية الآلية:{" "}
            <strong className="text-foreground">
              {recommendedDecision === "go"
                ? "التقدم للعطاء (Go)"
                : recommendedDecision === "conditional_go"
                  ? "التقدم مع ضوابط مخاطر (Conditional Go)"
                  : "عدم التقدم (No-Go)"}
            </strong>
          </div>
        </div>
        <div className="flex-1 min-w-[240px] space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>قرار اللجنة المعتمد</Label>
              <Select value={decision} onValueChange={(v) => setDecision(v as GoDecision)}>
                <SelectTrigger className="h-8 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">قيد الدراسة</SelectItem>
                  <SelectItem value="go">موافق (Go)</SelectItem>
                  <SelectItem value="conditional_go">موافق بشروط (Conditional Go)</SelectItem>
                  <SelectItem value="no_go">اعتذار / عدم التقدم (No-Go)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>مبررات القرار والملاحظات التعاقدية</Label>
            <Textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="سجل اشتراطات الدفعة المقدمة، الضمانات، أو أسباب الاعتذار..." />
          </div>
        </div>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? "جاري الحفظ..." : "حفظ التقييم والقرار"}
        </Button>
      </div>
    </div>
  );
}
