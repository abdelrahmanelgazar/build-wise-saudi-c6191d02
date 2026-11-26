import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Lock,
  GitCompare,
  Scale,
  FileSpreadsheet,
  ExternalLink,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { estimationClient } from "@/lib/estimation-client";
import { useActiveProjectId, useActiveTenderId } from "@/lib/active-project";
import { scopeRowsByTender } from "@/lib/tender-pricing-scope";
import { resolveBoqItemPricing, roundTo, type MarkupSettings, type ResourceCostInput } from "@/lib/estimation-calc";
import { fmtSAR } from "@/lib/format";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";
import {
  approveAndLockTenderSubmission,
  compareBoqRevisions,
  evaluateNormalizedComparisonPackage,
  evaluateTenderReadiness,
  reconcileExcelAgainstBoq,
  sanitizeExcelTextCell,
  transitionHoldState,
  type BoqRevisionLine,
  type HoldStatus,
  type TenderHoldRecord,
} from "@/lib/tender-assurance-engine";
import {
  allocateIndirectCostPool,
  calculateTimePhasedHistogramCost,
  detectIndirectDoubleCounting,
} from "@/lib/assemblies-and-indirect-engine";
import {
  downloadVerifiedSubmissionArtifact,
  executeUnifiedTenderSubmission,
  getSubmittedTenderSnapshots,
} from "@/lib/client-tender-service";
import type { Database } from "@/integrations/supabase/types";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];

export const Route = createFileRoute("/_authenticated/tender-assurance")({
  head: () => ({
    meta: [
      { title: "جاهزية العطاء والتعليقات — تقديري" },
      { name: "description", content: "مراجعة جاهزية العطاء، إدارة البنود المعلّقة، تسوية العروض، فروق المقايسات، واعتماد التقديم." },
    ],
  }),
  component: TenderAssurancePage,
});

function TenderAssurancePage() {
  const projectId = useActiveProjectId();
  const activeTenderId = useActiveTenderId();
  const qc = useQueryClient();

  useRegisterPageActions({
    pageKey: "tender-assurance",
    hasEditableState: false,
    queryKeys: [["assurance_boq", projectId, activeTenderId], ["assurance_holds", projectId, activeTenderId]],
  });

  const [tab, setTab] = useState("readiness");
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));

  // New Hold state
  const [holdSubject, setHoldSubject] = useState("");
  const [holdReasonCode, setHoldReasonCode] = useState("pumping_excluded");
  const [holdImpactType, setHoldImpactType] = useState<"add" | "deduct" | "unknown">("add");
  const [holdDirectImpact, setHoldDirectImpact] = useState<number>(0);
  const [holdImpactGroup, setHoldImpactGroup] = useState("");
  const [holdAssignee, setHoldAssignee] = useState("مهندس التسعير الإنشائي");
  const [holdTargetBoqId, setHoldTargetBoqId] = useState<string>("");
  const [localHolds, setLocalHolds] = useState<TenderHoldRecord[]>([]);

  // Normalized Supplier Comparison Workbench state (DEV-309)
  const [cmpQty, setCmpQty] = useState(800);
  const [cmpOfferARate, setCmpOfferARate] = useState(250);
  const [cmpOfferAPump, setCmpOfferAPump] = useState(18);
  const [cmpOfferATrans, setCmpOfferATrans] = useState(6);
  const [cmpOfferBRate, setCmpOfferBRate] = useState(260);
  const [cmpOfferCRate, setCmpOfferCRate] = useState(245);
  const [selectedOfferChoice, setSelectedOfferChoice] = useState<string>("offer-b");
  const [selectionRationale, setSelectionRationale] = useState("مطابقة فنية كاملة وأقل تكلفة مقارنة موحّدة (260 ر.س/م³).");

  // BOQ Revision Diff Sandbox / Live Excel Rev.N+1 Upload (DEV-310)
  const [diffQtyFactor, setDiffQtyFactor] = useState<number>(1.0);
  const [uploadedRevLines, setUploadedRevLines] = useState<BoqRevisionLine[] | null>(null);
  const [uploadedRevName, setUploadedRevName] = useState<string>("");
  const [diffDecisionMap, setDiffDecisionMap] = useState<Record<string, "approved_transfer" | "new_analysis">>({});
  const [isLocking, setIsLocking] = useState(false);
  const [submissionTick, setSubmissionTick] = useState(0);

  // Indirect Cost Builder State (DEV-306)
  const [indTitle, setIndTitle] = useState("طاقم الإشراف الهندسي للموقع");
  const [indScopeId, setIndScopeId] = useState("site_staff");
  const [indRecoveryMode, setIndRecoveryMode] = useState<"preliminaries_boq" | "distributed_overhead" | "separate_commercial">("preliminaries_boq");
  const [indMonths, setIndMonths] = useState(12);
  const [indCount, setIndCount] = useState(2);
  const [indMonthlyRate, setIndMonthlyRate] = useState(15000);
  const [localIndirectLines, setLocalIndirectLines] = useState<Array<{
    id: string;
    costScopeId: string;
    title_ar: string;
    recovery_mode: "preliminaries_boq" | "distributed_overhead" | "separate_commercial";
    totalCost: number;
  }>>([]);

  const { data: project } = useQuery({
    queryKey: ["assurance_project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await estimationClient.from("projects").select("*").eq("id", projectId!).maybeSingle();
      return data;
    },
  });

  const { data: allBoq = [] } = useQuery({
    queryKey: ["assurance_boq", projectId, activeTenderId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient.from("boq_items").select("*").eq("project_id", projectId!).order("sort_order");
      if (error) throw error;
      return (data as BoqRow[]) ?? [];
    },
  });

  const { data: allPa = [] } = useQuery({
    queryKey: ["assurance_pa", projectId, activeTenderId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await estimationClient.from("price_analysis_items").select("*").eq("project_id", projectId!);
      return (data as any[]) ?? [];
    },
  });

  const { data: allMarkups = [] } = useQuery({
    queryKey: ["assurance_markups", projectId, activeTenderId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await estimationClient.from("price_analysis_markup").select("*").eq("project_id", projectId!);
      return (data as any[]) ?? [];
    },
  });

  const { data: dbHolds = [] } = useQuery({
    queryKey: ["assurance_holds", projectId, activeTenderId],
    enabled: !!projectId,
    queryFn: async () => {
      try {
        const { data } = await (estimationClient as any)
          .from("tender_holds")
          .select("*")
          .eq("project_id", projectId!);
        return ((data as TenderHoldRecord[]) ?? []).filter((h) => !activeTenderId || h.tender_id === activeTenderId);
      } catch {
        return [] as TenderHoldRecord[];
      }
    },
  });

  const boqItems = useMemo(() => scopeRowsByTender(allBoq as any[], activeTenderId) as BoqRow[], [allBoq, activeTenderId]);
  const paItems = useMemo(() => scopeRowsByTender(allPa, activeTenderId), [allPa, activeTenderId]);
  const markups = useMemo(() => scopeRowsByTender(allMarkups, activeTenderId), [allMarkups, activeTenderId]);
  const holds = useMemo(() => {
    const map = new Map<string, TenderHoldRecord>();
    for (const h of dbHolds) map.set(h.id, h);
    for (const h of localHolds) map.set(h.id, h);
    const tid = activeTenderId ?? projectId ?? "baseline";
    return Array.from(map.values()).filter((h) => h.tender_id === tid);
  }, [dbHolds, localHolds, activeTenderId, projectId]);

  const paByBoq = useMemo(() => {
    const m = new Map<string, Array<ResourceCostInput & { quote_status?: string | null; scope_tag?: string | null }>>();
    for (const p of paItems) {
      if (!p.boq_item_id) continue;
      const arr = m.get(p.boq_item_id) ?? [];
      arr.push(p);
      m.set(p.boq_item_id, arr);
    }
    return m;
  }, [paItems]);

  const markupsByBoq = useMemo(() => {
    const m = new Map<string, MarkupSettings>();
    for (const mk of markups) {
      if (!mk.boq_item_id) continue;
      m.set(mk.boq_item_id, {
        indirect_pct: Number(mk.indirect_pct ?? 0),
        overhead_pct: Number(mk.overhead_pct ?? 0),
        risk_pct: Number(mk.risk_pct ?? 0),
        profit_pct: Number(mk.profit_pct ?? 0),
        pricing_policy: mk.pricing_policy ?? "additive_v2",
        round_up_rate: mk.round_up_rate ?? true,
      });
    }
    return m;
  }, [markups]);

  const boqDiffResult = useMemo(() => {
    const leaf = boqItems.filter((b) => !b.is_group);
    const oldLines: BoqRevisionLine[] = leaf.map((b, idx) => {
      const resolved = resolveBoqItemPricing({
        item: b as any,
        ...(paByBoq.get(b.id) ? { paLines: paByBoq.get(b.id)! } : {}),
        hasAnalysisFlag: paByBoq.has(b.id) || b.rate_source === "analysis",
        ...(markupsByBoq.get(b.id) ? { markup: markupsByBoq.get(b.id)! } : {}),
      });
      return {
        id: b.id,
        stableKey: b.id,
        item_no: b.item_no,
        description_ar: b.description_ar,
        unit: b.unit || "وحدة",
        quantity: Number(b.quantity ?? 0),
        unitRate: resolved.approvedUnitRate,
        rowIndex: idx + 1,
      };
    });
    const newLines: BoqRevisionLine[] = uploadedRevLines ?? oldLines.map((o) => ({
      ...o,
      quantity: roundTo(o.quantity * diffQtyFactor, 2),
    }));
    const rawDiff = compareBoqRevisions(oldLines, newLines);
    const mappings = rawDiff.mappings.map((m) => ({
      ...m,
      engineerDecision: diffDecisionMap[m.mappingId] ?? m.engineerDecision,
    }));
    const unresolvedCount = mappings.filter((m) => m.requiresEngineerDecision && m.engineerDecision === "pending").length;
    return { mappings, summary: { ...rawDiff.summary, unresolvedCount } };
  }, [boqItems, paByBoq, markupsByBoq, diffQtyFactor, uploadedRevLines, diffDecisionMap]);

  const effectiveTenderId = activeTenderId ?? projectId ?? "baseline";

  const indirectAudit = useMemo(() => {
    const hasExplicitPrelim = boqItems.some((b) => !b.is_group && (b.item_no?.startsWith("01") || b.sheet_name?.includes("01")));
    const hasIndirectPct = Array.from(markupsByBoq.values()).some((m) => Number(m.indirect_pct ?? 0) > 0);
    return detectIndirectDoubleCounting({
      indirectLines: localIndirectLines,
      hasExplicitPrelimBoqItems: hasExplicitPrelim,
      itemsHaveIndirectPct: hasIndirectPct,
    });
  }, [localIndirectLines, boqItems, markupsByBoq]);

  const indirectPoolTotal = useMemo(
    () => localIndirectLines.reduce((s, l) => s + l.totalCost, 0),
    [localIndirectLines],
  );

  const indirectAllocations = useMemo(
    () =>
      allocateIndirectCostPool(
        indirectPoolTotal,
        boqItems
          .filter((b) => !b.is_group)
          .map((b) => ({
            boqItemId: b.id,
            directCostTotal:
              Number(b.quantity ?? 0) *
              (Number(b.material_cost ?? 0) + Number(b.labor_cost ?? 0) + Number(b.equipment_cost ?? 0) + Number(b.subcontractor_cost ?? 0)),
          })),
      ),
    [indirectPoolTotal, boqItems],
  );

  const readiness = useMemo(
    () =>
      evaluateTenderReadiness({
        tenderId: effectiveTenderId,
        asOfDate,
        boqItems: boqItems as any[],
        paItemsByBoqId: paByBoq,
        markupsByBoqId: markupsByBoq,
        holds,
        unresolvedBoqDiffCount: boqDiffResult.summary.unresolvedCount,
        indirectDoubleCountWarnings: indirectAudit.warnings,
      }),
    [effectiveTenderId, asOfDate, boqItems, paByBoq, markupsByBoq, holds, boqDiffResult.summary.unresolvedCount, indirectAudit.warnings],
  );

  const comparisonOffers = useMemo(
    () =>
      evaluateNormalizedComparisonPackage({
        requiredQuantity: cmpQty,
        offers: [
          {
            offerId: "offer-a",
            supplierName: "مورّد A (توريد فقط + ضخ ونقل منفصل)",
            quotedUnitRate: cmpOfferARate,
            compliance: { technical: "Compliant", concrete: "Compliant" },
            adjustments: [
              { key: "pump", label_ar: "ضخ خرسانة", kind: "addition", unitRateOrAmount: cmpOfferAPump, basis: "per_unit", includedInOffer: false },
              { key: "trans", label_ar: "نقل", kind: "addition", unitRateOrAmount: cmpOfferATrans, basis: "per_unit", includedInOffer: false },
            ],
          },
          {
            offerId: "offer-b",
            supplierName: "مورّد B (شامل التوريد والضخ والنقل)",
            quotedUnitRate: cmpOfferBRate,
            compliance: { technical: "Compliant", concrete: "Compliant" },
            adjustments: [
              { key: "pump", label_ar: "ضخ خرسانة", kind: "addition", unitRateOrAmount: 0, basis: "per_unit", includedInOffer: true },
              { key: "trans", label_ar: "نقل", kind: "addition", unitRateOrAmount: 0, basis: "per_unit", includedInOffer: true },
            ],
          },
          {
            offerId: "offer-c",
            supplierName: "مورّد C (الضخ غير محدد — ناقص)",
            quotedUnitRate: cmpOfferCRate,
            compliance: { technical: "Compliant", pumping: "Unknown" },
            adjustments: [
              { key: "pump", label_ar: "ضخ خرسانة", kind: "addition", unitRateOrAmount: null, basis: "per_unit", includedInOffer: false, isUnknown: true },
              { key: "trans", label_ar: "نقل", kind: "addition", unitRateOrAmount: 0, basis: "per_unit", includedInOffer: true },
            ],
          },
        ],
      }),
    [cmpQty, cmpOfferARate, cmpOfferAPump, cmpOfferATrans, cmpOfferBRate, cmpOfferCRate],
  );

  const handleCreateHold = async () => {
    if (!projectId || !holdSubject.trim()) {
      toast.error("أدخل عنوان التعليق واختر مشروعاً نشطاً.");
      return;
    }
    const { data: u } = await estimationClient.auth.getUser();
    const userId = u.user?.id || "local-estimator";
    const newHold: TenderHoldRecord = {
      id: crypto.randomUUID(),
      project_id: projectId,
      tender_id: effectiveTenderId,
      hold_ref: `H-${String(holds.length + 1).padStart(3, "0")}`,
      subject: holdSubject.trim(),
      reason_code: holdReasonCode,
      severity: "high",
      impact_type: holdImpactType,
      impact_group: holdImpactGroup.trim() || null,
      direct_cost_impact: holdImpactType === "unknown" ? null : holdDirectImpact,
      included_in_current_price: false,
      currency: "SAR",
      assignee: holdAssignee,
      due_date: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
      target_boq_item_ids: holdTargetBoqId ? [holdTargetBoqId] : [],
      evidence_links: [],
      status: "Open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setLocalHolds((prev) => [newHold, ...prev]);
    try {
      await (estimationClient as any).from("tender_holds").insert({
        ...newHold,
        workspace_id: userId,
        created_by: userId,
      });
      qc.invalidateQueries({ queryKey: ["assurance_holds", projectId, activeTenderId] });
    } catch {
      // local state holds immediately visible
    }
    setHoldSubject("");
    setHoldDirectImpact(0);
    toast.success(`تم تسجيل التعليق ${newHold.hold_ref} وربطه بالمنافسة الحالية دون تعديل سعر البند.`);
  };

  const handleHoldTransition = async (hold: TenderHoldRecord, toStatus: HoldStatus) => {
    try {
      const { data: u } = await estimationClient.auth.getUser();
      const userId = u.user?.id || "approver-1";
      const updated = transitionHoldState({
        hold,
        toStatus,
        actorId: userId,
        actorRole: "approver",
        reason: toStatus === "AcceptedRisk" ? "قبول مخاطرة معتمد من مدير العطاء" : "تم استيفاء الدليل",
        evidenceLinks: toStatus === "Closed" ? ["RFI-EVIDENCE-01"] : [],
      });
      setLocalHolds((prev) => [updated, ...prev.filter((h) => h.id !== hold.id)]);
      try {
        await (estimationClient as any).from("tender_holds").update(updated).eq("id", hold.id);
      } catch {
        // local state updated
      }
      toast.success(`تم نقل التعليق ${hold.hold_ref} إلى حالة ${toStatus}`);
    } catch (err: any) {
      toast.error(err?.message || "تعذر تغيير حالة التعليق");
    }
  };

  const submittedSnapshots = useMemo(
    () => getSubmittedTenderSnapshots(effectiveTenderId),
    [effectiveTenderId, submissionTick],
  );

  const handleVerifyExcelAndSubmit = async () => {
    if (!projectId) return;
    setIsLocking(true);
    try {
      const { data: u } = await estimationClient.auth.getUser();
      const actorId = u.user?.id || "approver-1";

      const { snapshot, estimateVersion, staging } = await executeUnifiedTenderSubmission({
        tenderId: effectiveTenderId,
        projectId,
        companyId: (project as any)?.company_id ?? null,
        companyName: (project as any)?.company_name ?? null,
        clientName: project?.client_name ?? null,
        actorId,
        actorRole: "approver",
        readinessInputHash: readiness.inputHash,
        readinessOverallState: readiness.overallState,
        holdsSnapshot: holds.filter((h) => h.status === "AcceptedRisk" || h.status === "Open"),
        qualifications: holds.filter((h) => h.status === "AcceptedRisk").map((h) => h.approval_reason || h.subject),
        boqItems: boqItems as any[],
        paItemsByBoqId: paByBoq,
        markupsByBoqId: markupsByBoq,
      });

      const cleanBytes = new Uint8Array(staging.bytes.byteLength);
      cleanBytes.set(staging.bytes);
      const blob = new Blob([cleanBytes.buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Taqdiri_Approved_v${snapshot.versionNo}_${staging.exportSha256.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      setSubmissionTick((n) => n + 1);
      await qc.invalidateQueries({ queryKey: ["assurance_boq", projectId, activeTenderId] });
      toast.success(
        `تم اعتماد وقفل تقديم #${snapshot.versionNo} (إصدار تقدير v${estimateVersion.version_no}، ${fmtSAR(snapshot.netSellingPrice)}) ومطابقة ${staging.verification.totalRowsChecked} سطر وبصمة SHA-256 (${staging.exportSha256.slice(0, 12)})!`,
      );
    } catch (err: any) {
      toast.error(err?.message || "تعذر قفل واعتماد التقديم");
    } finally {
      setIsLocking(false);
    }
  };

  if (!projectId) {
    return (
      <div className="p-6">
        <Card className="border-dashed p-10 text-center text-sm text-muted-foreground">
          اختر مشروعاً من الشريط العلوي لتقييم جاهزية العطاء والتعليقات.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">مراجعة جاهزية العطاء والتعليقات (Tender Assurance V3.0)</h1>
            <Badge
              variant={
                readiness.overallState === "READY"
                  ? "default"
                  : readiness.overallState === "READY_WITH_APPROVED_QUALIFICATIONS"
                    ? "secondary"
                    : "destructive"
              }
            >
              {readiness.overallState}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            المشروع: <strong>{project?.name}</strong> · العميل: <strong>{project?.client_name || "—"}</strong> · الموانع:{" "}
            <strong className="text-destructive">{readiness.blockersCount}</strong> · التحفظات/التحذيرات:{" "}
            <strong className="text-amber-500">{readiness.warningsCount}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Label>تاريخ الأساس:</Label>
          <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="h-8 w-36 text-xs" />
        </div>
      </div>

      {/* Top Financial & Exposure Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">إجمالي التكلفة المباشرة</div>
          <div className="font-mono font-bold text-base mt-0.5">{fmtSAR(readiness.totalDirectCostSar)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">سعر العطاء قبل الضريبة</div>
          <div className="font-mono font-bold text-base text-primary mt-0.5">{fmtSAR(readiness.netSellingPriceSar)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">قيمة البنود المتأثرة بتعليق</div>
          <div className="font-mono font-bold text-base mt-0.5">{fmtSAR(readiness.holdsConsolidation.affectedBoqValueSar)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">أثر التعليقات (مباشر / بيع)</div>
          <div className="font-mono font-bold text-sm text-amber-600 mt-0.5">
            {fmtSAR(readiness.holdsConsolidation.knownDirectCostImpactSar)} / {fmtSAR(readiness.holdsConsolidation.knownSellingImpactSar)}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">تعليقات بأثر غير مقدّر</div>
          <div className="font-mono font-bold text-base text-destructive mt-0.5">{readiness.holdsConsolidation.unknownImpactCount}</div>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex-wrap h-auto p-1">
          <TabsTrigger value="readiness" className="text-xs">1. نتائج الجاهزية (RD-01..16)</TabsTrigger>
          <TabsTrigger value="holds" className="text-xs">2. البنود المعلّقة Holds ({holds.length})</TabsTrigger>
          <TabsTrigger value="comparison" className="text-xs">3. تسوية ومقارنة العروض</TabsTrigger>
          <TabsTrigger value="boq-diff" className="text-xs">4. فروق مراجعات المقايسة</TabsTrigger>
          <TabsTrigger value="indirects" className="text-xs">5. التكاليف غير المباشرة وتوزيعها</TabsTrigger>
          <TabsTrigger value="submission" className="text-xs">6. الاعتماد ومطابقة Excel</TabsTrigger>
        </TabsList>

        <TabsContent value="readiness" className="space-y-3">
          {readiness.findings.length === 0 ? (
            <Card className="p-8 text-center text-xs text-emerald-600">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
              لا توجد موانع أو تحذيرات على هذا الإصدار — العطاء جاهز للاعتماد ومطابقة Excel!
            </Card>
          ) : (
            <div className="rounded-lg border overflow-hidden bg-card">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="p-2.5 text-start">القاعدة</th>
                    <th className="p-2.5 text-start">البيان</th>
                    <th className="p-2.5 text-center">الشدة</th>
                    <th className="p-2.5 text-center">المسؤول</th>
                    <th className="p-2.5 text-center">الأثر المالي</th>
                    <th className="p-2.5 text-center">فتح البند</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {readiness.findings.map((f) => (
                    <tr key={f.fingerprint}>
                      <td className="p-2.5 font-mono font-bold">{f.ruleCode}</td>
                      <td className="p-2.5">{f.title_ar}</td>
                      <td className="p-2.5 text-center">
                        <Badge variant={f.severity === "blocker" ? "destructive" : "secondary"} className="text-[10px]">
                          {f.severity === "blocker" ? "مانع (Blocker)" : "تحذير"}
                        </Badge>
                      </td>
                      <td className="p-2.5 text-center">{f.assignee}</td>
                      <td className="p-2.5 text-center font-mono">
                        {f.financialImpactSar === null ? "غير مقدّر" : fmtSAR(f.financialImpactSar)}
                      </td>
                      <td className="p-2.5 text-center">
                        {f.boqItemId ? (
                          <Link to="/price-analysis" search={{ item: f.boqItemId }}>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-primary">
                              <ExternalLink className="h-3 w-3" />
                              فتح التحليل
                            </Button>
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="holds" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">إضافة تعليق / مخاطرة (Hold) على بند أو حزمة</CardTitle>
              <CardDescription className="text-[11px]">
                التعليق لا يغيّر سعر البند تلقائياً بل يُظهر التعرض المالي الموحد (دون تكرار النطاقات المتداخلة).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
              <div className="col-span-2">
                <Label className="text-[10px]">موضوع التعليق</Label>
                <Input value={holdSubject} onChange={(e) => setHoldSubject(e.target.value)} placeholder="مثال: ضخ الخرسانة مستثنى من العرض" className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">نوع الأثر</Label>
                <Select value={holdImpactType} onValueChange={(v) => setHoldImpactType(v as any)}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">إضافة متوقعة (+)</SelectItem>
                    <SelectItem value="deduct">وفر متوقع (-)</SelectItem>
                    <SelectItem value="unknown">غير مقدّر (Unknown)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">الأثر المباشر (ر.س)</Label>
                <Input type="number" value={holdDirectImpact} onChange={(e) => setHoldDirectImpact(Number(e.target.value) || 0)} disabled={holdImpactType === "unknown"} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">مجموعة التداخل</Label>
                <Input value={holdImpactGroup} onChange={(e) => setHoldImpactGroup(e.target.value)} placeholder="pumping" className="mt-1 h-8 text-xs" />
              </div>
              <div className="flex items-end">
                <Button size="sm" onClick={handleCreateHold} className="w-full h-8 text-xs gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  إنشاء Hold
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-lg border overflow-hidden bg-card">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-2.5 text-start">المرجع</th>
                  <th className="p-2.5 text-start">الموضوع</th>
                  <th className="p-2.5 text-center">الحالة</th>
                  <th className="p-2.5 text-center">الأثر المباشر</th>
                  <th className="p-2.5 text-center">انتقالات الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {holds.map((h) => (
                  <tr key={h.id}>
                    <td className="p-2.5 font-mono font-bold">{h.hold_ref}</td>
                    <td className="p-2.5">{h.subject}</td>
                    <td className="p-2.5 text-center"><Badge variant="outline">{h.status}</Badge></td>
                    <td className="p-2.5 text-center font-mono">
                      {h.impact_type === "unknown" ? "غير مقدّر" : fmtSAR(Number(h.direct_cost_impact ?? 0))}
                    </td>
                    <td className="p-2.5 text-center space-x-1">
                      {h.status === "Open" && (
                        <>
                          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => handleHoldTransition(h, "InProgress")}>بدء</Button>
                          <Button size="sm" variant="secondary" className="h-6 text-[10px]" onClick={() => handleHoldTransition(h, "AcceptedRisk")}>قبول مخاطر</Button>
                        </>
                      )}
                      {h.status === "InProgress" && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => handleHoldTransition(h, "PendingReview")}>رفع للمراجعة</Button>
                      )}
                      {h.status === "PendingReview" && (
                        <Button size="sm" variant="default" className="h-6 text-[10px]" onClick={() => handleHoldTransition(h, "Closed")}>إغلاق بدليل</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="comparison" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Scale className="h-4 w-4 text-primary" />
                حزمة مقارنة وتسوية عروض الموردين على نطاق موحّد (DEV-309)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <div><Label className="text-[10px]">الكمية (م³)</Label><Input type="number" value={cmpQty} onChange={(e) => setCmpQty(Number(e.target.value) || 1)} className="mt-1 h-7 text-xs" /></div>
                <div><Label className="text-[10px]">سعر عرض A</Label><Input type="number" value={cmpOfferARate} onChange={(e) => setCmpOfferARate(Number(e.target.value) || 0)} className="mt-1 h-7 text-xs" /></div>
                <div><Label className="text-[10px]">+ ضخ A</Label><Input type="number" value={cmpOfferAPump} onChange={(e) => setCmpOfferAPump(Number(e.target.value) || 0)} className="mt-1 h-7 text-xs" /></div>
                <div><Label className="text-[10px]">+ نقل A</Label><Input type="number" value={cmpOfferATrans} onChange={(e) => setCmpOfferATrans(Number(e.target.value) || 0)} className="mt-1 h-7 text-xs" /></div>
                <div><Label className="text-[10px]">سعر عرض B (شامل)</Label><Input type="number" value={cmpOfferBRate} onChange={(e) => setCmpOfferBRate(Number(e.target.value) || 0)} className="mt-1 h-7 text-xs" /></div>
                <div><Label className="text-[10px]">سعر عرض C (ناقص)</Label><Input type="number" value={cmpOfferCRate} onChange={(e) => setCmpOfferCRate(Number(e.target.value) || 0)} className="mt-1 h-7 text-xs" /></div>
              </div>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs tabular-nums">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="p-2 text-start">العرض</th>
                      <th className="p-2 text-center">المعلن</th>
                      <th className="p-2 text-center">الموحّد للوحدة</th>
                      <th className="p-2 text-center">القيمة الكلية</th>
                      <th className="p-2 text-center">الحالة والترتيب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {comparisonOffers.map((o) => (
                      <tr key={o.offerId}>
                        <td className="p-2 font-medium">{o.supplierName}</td>
                        <td className="p-2 text-center font-mono">{fmtSAR(o.quotedUnitRate)}</td>
                        <td className="p-2 text-center font-mono font-bold text-primary">
                          {o.comparableUnitRate !== null ? fmtSAR(o.comparableUnitRate) : "غير مكتمل"}
                        </td>
                        <td className="p-2 text-center font-mono">
                          {fmtSAR(o.knownPartialAmount)}
                          {!o.isComplete && <span className="text-[10px] text-amber-600 block">+ أثر غير مقدّر</span>}
                        </td>
                        <td className="p-2 text-center">
                          {o.isComplete ? (
                            <Badge variant={o.rank === 1 ? "default" : "secondary"}>#{o.rank} Complete</Badge>
                          ) : (
                            <Badge variant="destructive">Incomplete</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boq-diff" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-primary" />
                مقارنة إصدارات المقايسة وتحليل أثر الكمية عن السعر (DEV-310)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">معامل محاكاة:</Label>
                    <Input
                      type="number"
                      step="0.05"
                      value={diffQtyFactor}
                      onChange={(e) => {
                        setUploadedRevLines(null);
                        setDiffQtyFactor(Number(e.target.value) || 1);
                      }}
                      className="h-7 w-20 text-xs"
                    />
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-accent">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
                    <span>رفع ملف Excel Rev.N+1</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        try {
                          const buf = await file.arrayBuffer();
                          const wb = XLSX.read(buf);
                          const sheet = wb.Sheets[wb.SheetNames[0]!];
                          if (!sheet) throw new Error("ملف فارغ");
                          const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
                          const parsed: BoqRevisionLine[] = rawRows
                            .map((r, idx) => ({
                              id: `rev2-${idx + 1}`,
                              item_no: String(r["رقم البند"] ?? r["Item No"] ?? r["item_no"] ?? `${idx + 1}`),
                              description_ar: String(r["التوصيف"] ?? r["Description"] ?? r["description_ar"] ?? ""),
                              unit: String(r["الوحدة"] ?? r["Unit"] ?? r["unit"] ?? "وحدة"),
                              quantity: Number(r["الكمية"] ?? r["Quantity"] ?? r["qty"] ?? 0) || 0,
                              unitRate: Number(r["الفئة"] ?? r["Rate"] ?? r["unit_rate"] ?? 0) || 0,
                              rowIndex: idx + 1,
                            }))
                            .filter((r) => r.description_ar.trim().length > 0);
                          setUploadedRevLines(parsed);
                          setUploadedRevName(file.name);
                          toast.success(`تم استيراد (${parsed.length}) بنداً من مراجعة ${file.name} للمطابقة.`);
                        } catch (err: any) {
                          toast.error(err?.message || "تعذر قراءة ملف مراجعة المقايسة");
                        }
                      }}
                    />
                  </label>
                  {uploadedRevName && <Badge variant="secondary">{uploadedRevName}</Badge>}
                </div>
                <div className="flex flex-wrap gap-3">
                  <span>أثر الكمية: <strong className="font-mono text-primary">{fmtSAR(boqDiffResult.summary.quantityEffectTotal)}</strong></span>
                  <span>أثر السعر: <strong className="font-mono">{fmtSAR(boqDiffResult.summary.rateEffectTotal)}</strong></span>
                  <span>صافي الفرق: <strong className="font-mono">{fmtSAR(boqDiffResult.summary.netDelta)}</strong></span>
                  <span>معلق للمهندس: <strong className="font-mono text-amber-600">{boqDiffResult.summary.unresolvedCount}</strong></span>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="p-2 text-start">البند</th>
                      <th className="p-2 text-center">التصنيف</th>
                      <th className="p-2 text-center">Q0 → Q1</th>
                      <th className="p-2 text-center">أثر الكمية</th>
                      <th className="p-2 text-center">أثر السعر</th>
                      <th className="p-2 text-center">إجمالي الفرق</th>
                      <th className="p-2 text-center">قرار المهندس</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {boqDiffResult.mappings.slice(0, 30).map((m) => (
                      <tr key={m.mappingId}>
                        <td className="p-2">{m.newItem?.item_no ?? m.oldItem?.item_no} — {m.newItem?.description_ar ?? m.oldItem?.description_ar}</td>
                        <td className="p-2 text-center"><Badge variant="outline" className="text-[9px]">{m.changeType}</Badge></td>
                        <td className="p-2 text-center font-mono">{m.oldItem?.quantity ?? 0} → {m.newItem?.quantity ?? 0}</td>
                        <td className="p-2 text-center font-mono">{fmtSAR(m.quantityEffect)}</td>
                        <td className="p-2 text-center font-mono">{fmtSAR(m.rateEffect)}</td>
                        <td className="p-2 text-center font-mono font-bold">{fmtSAR(m.totalDelta)}</td>
                        <td className="p-2 text-center">
                          {m.requiresEngineerDecision ? (
                            <div className="flex justify-center gap-1">
                              <Button
                                size="sm"
                                variant={m.engineerDecision === "approved_transfer" ? "default" : "outline"}
                                className="h-5 text-[9px] px-1.5"
                                onClick={() => setDiffDecisionMap((p) => ({ ...p, [m.mappingId]: "approved_transfer" }))}
                              >
                                اعتماد النقل
                              </Button>
                              <Button
                                size="sm"
                                variant={m.engineerDecision === "new_analysis" ? "secondary" : "outline"}
                                className="h-5 text-[9px] px-1.5"
                                onClick={() => setDiffDecisionMap((p) => ({ ...p, [m.mappingId]: "new_analysis" }))}
                              >
                                تحليل جديد
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">تلقائي</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="indirects" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">إعداد وتوزيع التكاليف غير المباشرة ومنع الازدواج (DEV-306)</CardTitle>
              <CardDescription className="text-[11px]">
                تُحسب من المعدل × العدد × المدة، وتُمنع من التكرار إذا كان البند مدرجاً في التمهيديات مع نسبة indirect_pct.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                <div className="col-span-2">
                  <Label className="text-[10px]">بيان التكلفة غير المباشرة</Label>
                  <Input value={indTitle} onChange={(e) => setIndTitle(e.target.value)} className="mt-1 h-7 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px]">مسار الاسترداد</Label>
                  <Select value={indRecoveryMode} onValueChange={(v) => setIndRecoveryMode(v as any)}>
                    <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preliminaries_boq">بنود تمهيديات BOQ</SelectItem>
                      <SelectItem value="distributed_overhead">توزيع على المباشر</SelectItem>
                      <SelectItem value="separate_commercial">بند تجاري مستقل</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">الشهور</Label>
                  <Input type="number" value={indMonths} onChange={(e) => setIndMonths(Number(e.target.value) || 0)} className="mt-1 h-7 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px]">العدد</Label>
                  <Input type="number" value={indCount} onChange={(e) => setIndCount(Number(e.target.value) || 0)} className="mt-1 h-7 text-xs" />
                </div>
                <div className="flex items-end gap-1">
                  <div className="flex-1">
                    <Label className="text-[10px]">المعدل الشهري</Label>
                    <Input type="number" value={indMonthlyRate} onChange={(e) => setIndMonthlyRate(Number(e.target.value) || 0)} className="mt-1 h-7 text-xs" />
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const totalCost = calculateTimePhasedHistogramCost([
                        { label: indTitle, months: indMonths, count: indCount, monthlyRate: indMonthlyRate },
                      ]);
                      setLocalIndirectLines((prev) => [
                        ...prev,
                        {
                          id: crypto.randomUUID(),
                          costScopeId: `${indScopeId}-${prev.length + 1}`,
                          title_ar: indTitle,
                          recovery_mode: indRecoveryMode,
                          totalCost,
                        },
                      ]);
                      setIndScopeId("site_staff");
                      toast.success(`أُضيف بند تكلفة غير مباشرة بقيمة ${fmtSAR(totalCost)}`);
                    }}
                  >
                    إضافة
                  </Button>
                </div>
              </div>

              {indirectAudit.hasDoubleCounting && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-destructive space-y-1">
                  {indirectAudit.warnings.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between rounded bg-muted/30 p-2.5">
                <span>إجمالي وعاء التكاليف غير المباشرة: <strong className="font-mono text-primary">{fmtSAR(indirectPoolTotal)}</strong></span>
                <span>مجموع التوزيع المطابق على البنود المؤهلة: <strong className="font-mono">{fmtSAR(indirectAllocations.reduce((s, a) => s + a.allocatedAmount, 0))}</strong></span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="submission" className="space-y-4">
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                بوابة قفل واعتماد العطاء ومطابقة ملف Excel (DEV-311)
              </CardTitle>
              <CardDescription className="text-xs">
                يتحقق النظام من hash فحص الجاهزية، ويطابق كل سطر في Excel، ويجمّد لقطة التقديم ضد أي تعديل مستقبلي.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="rounded-md bg-muted/40 p-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  بصمة المدخلات الحالية: <strong className="font-mono">{readiness.inputHash}</strong> · حالة الجاهزية:{" "}
                  <strong>{readiness.overallState}</strong>
                </div>
                <Button
                  size="sm"
                  disabled={isLocking || readiness.overallState === "NOT_READY"}
                  onClick={handleVerifyExcelAndSubmit}
                  className="gap-1.5"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {isLocking ? "جاري التحقق والقفل…" : "مطابقة Excel واعتماد وقفل التقديم"}
                </Button>
              </div>
              {readiness.overallState === "NOT_READY" && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>يوجد ({readiness.blockersCount}) مانع في تبويب الجاهزية يجب إغلاقه قبل تفعيل الاعتماد النهائي.</span>
                </div>
              )}

              {submittedSnapshots.length > 0 && (
                <div className="rounded-md border border-border overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="p-2 text-start">التقديم</th>
                        <th className="p-2 text-center">إصدار التقدير</th>
                        <th className="p-2 text-center">صافي العطاء</th>
                        <th className="p-2 text-center">SHA-256 ودليل التخزين</th>
                        <th className="p-2 text-center">استرجاع</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {submittedSnapshots.map((snap) => (
                        <tr key={snap.id}>
                          <td className="p-2 font-mono font-bold text-primary">v{snap.versionNo}</td>
                          <td className="p-2 text-center font-mono">est v{snap.estimateVersionNo ?? 1}</td>
                          <td className="p-2 text-center font-semibold">{fmtSAR(snap.netSellingPrice)}</td>
                          <td className="p-2 text-center">
                            {snap.hasVerifiedFileProof && snap.exportSha256 ? (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {snap.exportSha256.slice(0, 12)}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">قديم بدون ملف مخزن</Badge>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!snap.hasVerifiedFileProof}
                              className="h-6 text-[10px]"
                              onClick={() => {
                                downloadVerifiedSubmissionArtifact(snap)
                                  .then((r) => toast.success(`تم تنزيل الملف الموثق ومطابقة SHA-256 (${r.sha256.slice(0, 10)})`))
                                  .catch((err) => toast.error(err?.message || "تعذر الاسترجاع"));
                              }}
                            >
                              تنزيل ومطابقة البصمة
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
