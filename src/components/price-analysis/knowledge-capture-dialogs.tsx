import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookmarkPlus, Database, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { CSI_DIVISIONS } from "@/lib/csi-divisions";
import { fmtSAR } from "@/lib/format";
import {
  previewSaveAnalysisAsTemplate,
  saveAnalysisAsTemplate,
  publishSelectedResourcesToPriceLibrary,
  type SaveTemplatePreview,
} from "@/lib/knowledge-library-service";
import { estimationClient } from "@/lib/estimation-client";
import type { Database as DbTypes } from "@/integrations/supabase/types";

type BoqRow = DbTypes["public"]["Tables"]["boq_items"]["Row"];
type PaItem = DbTypes["public"]["Tables"]["price_analysis_items"]["Row"];

export function SaveAnalysisTemplateDialog({
  open,
  onOpenChange,
  boqItem,
  projectId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boqItem: BoqRow;
  projectId: string | null;
  onSaved?: () => void;
}) {
  const [preview, setPreview] = useState<SaveTemplatePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [code, setCode] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [csiDivision, setCsiDivision] = useState("03");
  const [categoryType, setCategoryType] = useState<"project_item" | "section_item" | "indirect_cost" | "typical_assembly">("project_item");
  const [assumptions, setAssumptions] = useState("");
  const [targetTemplateId, setTargetTemplateId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadPreview = () => {
    if (!projectId) return;
    setLoadingPreview(true);
    setSaveError(null);
    previewSaveAnalysisAsTemplate({
      boqItemId: boqItem.id,
      projectId,
      tenderId: boqItem.tender_id ?? null,
    })
      .then((res) => {
        setPreview(res);
        setCode(`PA-${res.csiDivision}-${boqItem.item_no.replace(/[^a-zA-Z0-9-]/g, "")}`);
        setTitleAr(res.titleAr);
        setTitleEn(res.titleEn);
        setCsiDivision(res.csiDivision);
        setCategoryType(res.csiDivision === "01" ? "indirect_cost" : "project_item");
        setTargetTemplateId("");
      })
      .catch((err) => {
        const msg = err?.message || "تعذر معاينة بيانات النموذج";
        setSaveError(msg);
        toast.error(msg);
      })
      .finally(() => setLoadingPreview(false));
  };

  useEffect(() => {
    if (!open || !projectId) return;
    loadPreview();
  }, [open, boqItem.id, boqItem.item_no, boqItem.tender_id, projectId]);

  const handleSave = async () => {
    if (!preview || !projectId) return;
    if (preview.validationErrors.length > 0) {
      toast.error(preview.validationErrors[0]);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const { data: u } = await estimationClient.auth.getUser();
      const userId = u.user?.id || "local-estimator";
      const record = await saveAnalysisAsTemplate({
        code,
        titleAr,
        titleEn,
        csiDivision,
        unit: preview.unit,
        categoryType,
        scope: "project",
        assumptions,
        resources: preview.resources,
        sourceContext: preview.sourceContext,
        ...(preview.boqUpdatedAt ? { expectedBoqUpdatedAt: preview.boqUpdatedAt } : {}),
        ...(targetTemplateId ? { targetTemplateId } : {}),
        userId,
        workspaceId: userId,
      });
      toast.success(
        `تم حفظ النموذج «${record.template.code}» (v${record.versionNo}) بالتكلفة المباشرة (${fmtSAR(record.directUnitCost)}) مع توثيق المشروع المصدر!`,
      );
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      const msg = err?.message || "تعذر حفظ النموذج في المكتبة";
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookmarkPlus className="h-4 w-4 text-primary" />
            حفظ تحليل البند في مكتبة النماذج (Direct Cost Only)
          </DialogTitle>
          <DialogDescription className="text-xs">
            يُحفظ النموذج بالتكلفة المباشرة فقط مع توثيق المشروع المصدر والوحدة، وتُعزل تحميلات المنافسة الحالية في سجل المصدر التاريخي.
          </DialogDescription>
        </DialogHeader>

        {loadingPreview ? (
          <div className="py-8 text-center text-xs text-muted-foreground">جاري فحص سطور التحليل والتكرار…</div>
        ) : preview ? (
          <div className="space-y-3 text-xs py-1">
            {saveError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-destructive space-y-1.5">
                <div className="font-semibold">تعذر تأكيد الحفظ: {saveError}</div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-6 text-[11px]" onClick={loadPreview}>
                    إعادة قراءة التحليل ومقارنة الفروق
                  </Button>
                  <Button type="button" size="sm" variant="default" className="h-6 text-[11px]" onClick={handleSave}>
                    إعادة المحاولة
                  </Button>
                </div>
              </div>
            )}

            {preview.validationErrors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-destructive space-y-1">
                {preview.validationErrors.map((err) => (
                  <div key={err} className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-md border border-primary/25 bg-primary/5 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-primary">معاينة المصدر والتكلفة المباشرة</span>
                <Badge variant="outline" className="font-mono text-[10px]">direct_cost</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>المشروع المصدر: <strong>{preview.sourceContext.project_name}</strong></div>
                <div>المالك/العميل: <strong>{preview.sourceContext.owner_name || "—"}</strong></div>
                <div>رقم البند: <strong className="font-mono">{preview.sourceContext.boq_item_no}</strong> ({preview.unit})</div>
                <div>التكلفة المباشرة للوحدة: <strong className="font-mono text-primary">{fmtSAR(preview.directUnitCost)}</strong></div>
              </div>
            </div>

            {preview.duplicateCandidates.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1.5">
                <div className="font-semibold text-amber-600 dark:text-amber-300">
                  تنبيه تشابه (BR-L05): توجد نماذج قريبة في المكتبة
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.duplicateCandidates.map((cand) => (
                    <Button
                      key={cand.id}
                      type="button"
                      size="sm"
                      variant={targetTemplateId === cand.id ? "default" : "outline"}
                      className="h-6 text-[10px]"
                      onClick={() => setTargetTemplateId(targetTemplateId === cand.id ? "" : cand.id)}
                    >
                      {targetTemplateId === cand.id ? "✓ إصدار جديد لـ " : "إصدار تابع لـ "} {cand.code} (v{cand.version_no})
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">كود النموذج</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 h-8 text-xs font-mono" />
              </div>
              <div>
                <Label className="text-[11px]">قسم المكتبة</Label>
                <Select value={categoryType} onValueChange={(v) => setCategoryType(v as any)}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project_item">نماذج البنود حسب المشاريع</SelectItem>
                    <SelectItem value="section_item">نماذج البنود حسب الأقسام (يتطلب اعتماداً)</SelectItem>
                    <SelectItem value="indirect_cost">التكلفة غير المباشرة</SelectItem>
                    <SelectItem value="typical_assembly">نماذج تسعير نمطية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">تصنيف CSI</Label>
                <Select value={csiDivision} onValueChange={setCsiDivision}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-56">
                    {CSI_DIVISIONS.map((d) => (
                      <SelectItem key={d.code} value={d.code} className="text-xs">{d.code} — {d.name_ar}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">وحدة القياس</Label>
                <Input value={preview.unit} readOnly className="mt-1 h-8 text-xs bg-muted/40" />
              </div>
            </div>

            <div>
              <Label className="text-[11px]">اسم النموذج بالعربية</Label>
              <Input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>

            <div>
              <Label className="text-[11px]">الافتراضات والمشمول والاستثناءات (Engineering Scope)</Label>
              <Input
                value={assumptions}
                onChange={(e) => setAssumptions(e.target.value)}
                placeholder="مثال: يشمل الخرسانة والضخ والصب، ويستثني الشدة والحديد"
                className="mt-1 h-8 text-xs"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            size="sm"
            disabled={saving || loadingPreview || !preview || preview.validationErrors.length > 0}
            onClick={handleSave}
          >
            {saving ? "جاري الحفظ…" : "حفظ النموذج (بالتكلفة المباشرة)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PublishPriceEvidenceDialog({
  open,
  onOpenChange,
  boqItem,
  projectId,
  selectedLines,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boqItem: BoqRow;
  projectId: string | null;
  selectedLines: PaItem[];
  onPublished?: () => void;
}) {
  const [csiDivision, setCsiDivision] = useState("03");
  const [scope, setScope] = useState<"project" | "general" | "typical_assembly">("project");
  const [linkedAssemblyCode, setLinkedAssemblyCode] = useState("ASM-FENCE-PLY-3M");
  const [taxBasis, setTaxBasis] = useState<"excluded" | "included" | "unknown">("unknown");
  const [publishing, setPublishing] = useState(false);

  const handlePublish = async () => {
    if (!projectId || selectedLines.length === 0) return;
    setPublishing(true);
    try {
      const [{ data: u }, { data: proj }] = await Promise.all([
        estimationClient.auth.getUser(),
        estimationClient.from("projects").select("name, client_name").eq("id", projectId).maybeSingle(),
      ]);
      const userId = u.user?.id || "local-estimator";

      const result = await publishSelectedResourcesToPriceLibrary({
        boqItemId: boqItem.id,
        projectId,
        projectName: proj?.name || "المشروع النشط",
        clientName: proj?.client_name ?? null,
        tenderId: boqItem.tender_id ?? null,
        csiDivision,
        scope,
        ...(scope === "typical_assembly" ? { linkedAssemblyCode } : {}),
        taxBasis,
        reusable: scope === "general",
        lines: selectedLines.map((l) => ({
          id: l.id,
          resource_id: l.resource_id ?? null,
          supplier_quote_id: l.supplier_quote_id ?? null,
          quote_item_id: l.quote_item_id ?? null,
          resource_type: l.resource_type,
          material_category: (l.material_category as "primary" | "accessory" | null) ?? null,
          description_ar: l.description_ar,
          description_en: l.description_en ?? null,
          unit: l.unit,
          unit_price: Number(l.unit_price) || 0,
        })),
        userId,
        workspaceId: userId,
      });

      toast.success(
        `تمت إضافة (${result.created.length - result.skippedDuplicates}) مورد إلى مكتبة الأسعار` +
          (result.skippedDuplicates > 0 ? ` (تخطي ${result.skippedDuplicates} مكرر منعاً للازدواج).` : " مع وسم المصدر والمشروع!"),
      );
      onPublished?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "تعذر ترحيل الموارد إلى مكتبة الأسعار");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-primary" />
            إضافة موارد التحليل المختارة إلى مكتبة الأسعار (M-02)
          </DialogTitle>
          <DialogDescription className="text-xs">
            الموارد غير المرتبطة بعرض مورّد موثّق تُحفظ بوسم «مرجع داخلي من تحليل» ولا تدخل ضمن ترتيب عروض الموردين.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-xs py-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">التصنيف الإلزامي (CSI)</Label>
              <Select value={csiDivision} onValueChange={setCsiDivision}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {CSI_DIVISIONS.map((d) => (
                    <SelectItem key={d.code} value={d.code} className="text-xs">{d.code} — {d.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">نطاق العرض في المكتبة</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as any)}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">عروض حسب المشروع</SelectItem>
                  <SelectItem value="general">مكتبة الأسعار العامة (تتطلب مراجعة)</SelectItem>
                  <SelectItem value="typical_assembly">عروض النماذج النمطية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">حالة ضريبة القيمة المضافة</Label>
              <Select value={taxBasis} onValueChange={(v) => setTaxBasis(v as any)}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">غير محدد (لا يُفترض)</SelectItem>
                  <SelectItem value="excluded">غير شامل الضريبة (قبل VAT)</SelectItem>
                  <SelectItem value="included">شامل الضريبة 15%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "typical_assembly" && (
              <div>
                <Label className="text-[11px]">النموذج النمطي المرتبط</Label>
                <Select value={linkedAssemblyCode} onValueChange={setLinkedAssemblyCode}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ASM-FENCE-PLY-3M">توريد تسوير Plywood 3 م</SelectItem>
                    <SelectItem value="ASM-SIGNAGE">توريد لافتات مشروع</SelectItem>
                    <SelectItem value="ASM-TANK-UG">خزان أرضي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-2 text-start">المورد</th>
                  <th className="p-2 text-center">الوحدة</th>
                  <th className="p-2 text-center">سعر الشراء المباشر</th>
                  <th className="p-2 text-center">الأصل</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {selectedLines.map((line) => (
                  <tr key={line.id}>
                    <td className="p-2 font-medium">{line.description_ar}</td>
                    <td className="p-2 text-center">{line.unit}</td>
                    <td className="p-2 text-center font-mono">{fmtSAR(line.unit_price)}</td>
                    <td className="p-2 text-center">
                      <Badge variant={line.quote_item_id ? "default" : "secondary"} className="text-[9px]">
                        {line.quote_item_id ? "عرض مورد" : "مرجع داخلي من تحليل"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button size="sm" disabled={publishing || selectedLines.length === 0} onClick={handlePublish}>
            <CheckCircle2 className="h-3.5 w-3.5 me-1" />
            {publishing ? "جاري الترحيل…" : `إضافة (${selectedLines.length}) سطر للمكتبة`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
