/**
 * Taqdiri V3.0 Tender Assurance, Hold Management, Normalized Quote Comparison,
 * BOQ Revision Diff & Submission Governance Engine
 * Implements DEV-307, DEV-308, DEV-309, DEV-310, DEV-311 and V3.0 §9–§16.
 */

import { estimationClient } from "@/lib/estimation-client";
import { computePricingPhase2, resolveBoqItemPricing, roundTo, type MarkupSettings, type ResourceCostInput } from "@/lib/estimation-calc";
import {
  executeUnifiedTenderSubmission,
  submitTenderVersion,
  type SubmittedTenderSnapshot,
} from "@/lib/client-tender-service";
import type { WorkspaceGovernanceRole } from "@/lib/knowledge-library-service";

// ── 1. Hold State Machine & Impact Consolidation (DEV-308) ────────────────────

export type HoldStatus =
  | "Open"
  | "InProgress"
  | "AwaitingResponse"
  | "PendingReview"
  | "Closed"
  | "AcceptedRisk"
  | "Cancelled";

export interface TenderHoldRecord {
  id: string;
  project_id: string;
  tender_id: string;
  estimate_version_id?: string | null;
  hold_ref: string;
  subject: string;
  reason_code: string;
  severity: "blocker" | "high" | "medium" | "low";
  impact_type: "add" | "deduct" | "range" | "unknown";
  impact_group?: string | null;
  direct_cost_impact?: number | null;
  direct_cost_max?: number | null;
  selling_impact?: number | null;
  included_in_current_price: boolean;
  currency: string;
  assignee: string;
  due_date?: string | null;
  target_boq_item_ids: string[];
  evidence_links: string[];
  proposed_resolution?: string | null;
  status: HoldStatus;
  resolved_by?: string | null;
  accepted_by?: string | null;
  approval_reason?: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_HOLD_TRANSITIONS: Record<HoldStatus, HoldStatus[]> = {
  Open: ["InProgress", "AcceptedRisk", "Cancelled"],
  InProgress: ["AwaitingResponse", "PendingReview", "AcceptedRisk"],
  AwaitingResponse: ["InProgress"],
  PendingReview: ["Closed", "InProgress"],
  Closed: ["Open"],
  AcceptedRisk: ["Open"],
  Cancelled: [],
};

export function transitionHoldState(params: {
  hold: TenderHoldRecord;
  toStatus: HoldStatus;
  actorId: string;
  actorRole: WorkspaceGovernanceRole;
  reason?: string;
  evidenceLinks?: string[];
}): TenderHoldRecord {
  const allowedTargets = VALID_HOLD_TRANSITIONS[params.hold.status] ?? [];
  if (!allowedTargets.includes(params.toStatus)) {
    throw new Error(`انتقال غير مسموح لحالة التعليق من ${params.hold.status} إلى ${params.toStatus}.`);
  }
  const mergedEvidence = [...params.hold.evidence_links, ...(params.evidenceLinks ?? [])];
  if (params.toStatus === "AcceptedRisk") {
    if (!["approver", "data_admin"].includes(params.actorRole)) {
      throw new Error("NOT_AUTHORIZED: قبول المخاطر (AcceptedRisk) يتطلب صلاحية مدير العطاء / المعتمد التجاري (TC-328).");
    }
    if (!params.reason?.trim()) {
      throw new Error("VALIDATION_FAILED: يجب توثيق سبب ومبرر قبول المخاطرة.");
    }
  }
  if (params.toStatus === "Closed") {
    if (mergedEvidence.length === 0) {
      throw new Error("VALIDATION_FAILED: لا يمكن إغلاق التعليق (Closed) بدون إرفاق دليل مراجعة (TC-329).");
    }
    if (!["discipline_reviewer", "approver", "data_admin"].includes(params.actorRole)) {
      throw new Error("NOT_AUTHORIZED: إغلاق التعليق بعد المراجعة يتطلب صلاحية مراجع أو معتمد.");
    }
  }
  if (params.toStatus === "Cancelled" && !params.reason?.trim()) {
    throw new Error("VALIDATION_FAILED: يلزم إدخال سبب مصرح به عند إلغاء التعليق.");
  }

  return {
    ...params.hold,
    status: params.toStatus,
    evidence_links: mergedEvidence,
    resolved_by: params.toStatus === "Closed" ? params.actorId : params.hold.resolved_by ?? null,
    accepted_by: params.toStatus === "AcceptedRisk" ? params.actorId : params.hold.accepted_by ?? null,
    approval_reason: params.reason?.trim() || params.hold.approval_reason || null,
    updated_at: new Date().toISOString(),
  };
}

export interface HoldsExposureConsolidation {
  openCount: number;
  acceptedRiskCount: number;
  affectedBoqValueSar: number;
  knownDirectCostImpactSar: number;
  knownSellingImpactSar: number;
  unknownImpactCount: number;
  overlappingGroups: Array<{ impactGroup: string; holdRefs: string[]; maxDirectSar: number }>;
}

/**
 * Consolidates active holds (Open, InProgress, AwaitingResponse, PendingReview, AcceptedRisk)
 * without double-counting either multi-item holds or overlapping `impact_group` holds (TC-324..TC-327).
 */
export function consolidateHoldsFinancialExposure(params: {
  holds: TenderHoldRecord[];
  boqItemsById: Map<string, { lineSellingPrice: number }>;
  markups?: MarkupSettings;
}): HoldsExposureConsolidation {
  const activeStatuses = new Set<HoldStatus>(["Open", "InProgress", "AwaitingResponse", "PendingReview", "AcceptedRisk"]);
  const activeHolds = params.holds.filter((h) => activeStatuses.has(h.status));

  const affectedItemIds = new Set<string>();
  let unknownImpactCount = 0;
  let knownDirectNonGrouped = 0;
  const groups = new Map<string, TenderHoldRecord[]>();

  for (const h of activeHolds) {
    for (const id of h.target_boq_item_ids) affectedItemIds.add(id);
    if (h.status === "Closed" || h.status === "Cancelled") continue;

    if (h.impact_type === "unknown") {
      unknownImpactCount++;
      continue;
    }
    if (h.included_in_current_price) {
      // Cost allowance already included in BOQ price -> net extra exposure is 0 while hold stays open (TC-325)
      continue;
    }
    const rawDirect = Number(h.direct_cost_impact ?? 0);
    const signedDirect = h.impact_type === "deduct" ? -Math.abs(rawDirect) : Math.abs(rawDirect);

    if (h.impact_group?.trim()) {
      const key = h.impact_group.trim();
      const arr = groups.get(key) ?? [];
      arr.push(h);
      groups.set(key, arr);
    } else {
      knownDirectNonGrouped += signedDirect;
    }
  }

  let groupedDirectTotal = 0;
  const overlappingGroups: Array<{ impactGroup: string; holdRefs: string[]; maxDirectSar: number }> = [];
  for (const [groupName, list] of groups.entries()) {
    // Pick worst-case conservative direct impact once per overlapping group instead of summing twice (TC-327)
    const maxDirect = list.reduce((best, h) => {
      const val = Number(h.direct_cost_impact ?? 0);
      return Math.abs(val) > Math.abs(best) ? (h.impact_type === "deduct" ? -Math.abs(val) : Math.abs(val)) : best;
    }, 0);
    groupedDirectTotal += maxDirect;
    if (list.length > 1) {
      overlappingGroups.push({
        impactGroup: groupName,
        holdRefs: list.map((x) => x.hold_ref),
        maxDirectSar: roundTo(maxDirect, 2),
      });
    }
  }

  let affectedBoqValueSar = 0;
  for (const id of affectedItemIds) {
    affectedBoqValueSar += Number(params.boqItemsById.get(id)?.lineSellingPrice ?? 0);
  }

  const knownDirectCostImpactSar = roundTo(knownDirectNonGrouped + groupedDirectTotal, 2);
  const pctSum =
    Number(params.markups?.indirect_pct ?? 0) +
    Number(params.markups?.overhead_pct ?? 0) +
    Number(params.markups?.risk_pct ?? 0) +
    Number(params.markups?.profit_pct ?? 0);
  const sign = knownDirectCostImpactSar < 0 ? -1 : 1;
  const absSell = computePricingPhase2({
    directUnitCost: Math.abs(knownDirectCostImpactSar),
    quantity: 1,
    markups: { ...params.markups, round_up_rate: false },
  });
  const knownSellingImpactSar = roundTo(
    sign * (pctSum > 0 ? absSell.rawUnitSellingPrice : Math.abs(knownDirectCostImpactSar)),
    2,
  );

  return {
    openCount: activeHolds.filter((h) => h.status !== "AcceptedRisk").length,
    acceptedRiskCount: activeHolds.filter((h) => h.status === "AcceptedRisk").length,
    affectedBoqValueSar: roundTo(affectedBoqValueSar, 2),
    knownDirectCostImpactSar,
    knownSellingImpactSar,
    unknownImpactCount,
    overlappingGroups,
  };
}

// ── 2. Tender Readiness Engine RD-01..RD-16 (DEV-307) ─────────────────────────

export type ReadinessOverallState = "NOT_READY" | "READY_WITH_APPROVED_QUALIFICATIONS" | "READY";

export interface ReadinessFinding {
  fingerprint: string;
  ruleCode: string;
  severity: "blocker" | "warning";
  title_ar: string;
  title_en: string;
  boqItemId?: string | null;
  itemNo?: string | null;
  financialImpactSar: number | null;
  assignee: string;
  waivable: boolean;
  waived?: boolean;
}

export interface ReadinessEvaluationResult {
  inputHash: string;
  asOfDate: string;
  overallState: ReadinessOverallState;
  blockersCount: number;
  warningsCount: number;
  findings: ReadinessFinding[];
  holdsConsolidation: HoldsExposureConsolidation;
  netSellingPriceSar: number;
  totalDirectCostSar: number;
}

export function computeEstimateInputHash(params: {
  tenderId: string;
  boqItems: Array<Record<string, any>>;
  holds: TenderHoldRecord[];
  exportSha256?: string | null;
}): string {
  const payload = JSON.stringify({
    tenderId: params.tenderId,
    boq: params.boqItems
      .filter((b) => !b["is_group"])
      .map((b) => [b["id"], b["quantity"], b["material_cost"], b["labor_cost"], b["equipment_cost"], b["subcontractor_cost"], b["manual_unit_price"], b["pricing_status"], b["is_included_elsewhere"]]),
    holds: params.holds.map((h) => [h.id, h.status, h.direct_cost_impact, h.included_in_current_price]),
    exportSha256: params.exportSha256 ?? null,
  });
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

export function evaluateTenderReadiness(params: {
  tenderId: string;
  asOfDate?: string;
  boqItems: Array<Record<string, any>>;
  paItemsByBoqId?: Map<string, Array<ResourceCostInput & { quote_status?: string | null; valid_until?: string | null; scope_tag?: string | null }>>;
  markupsByBoqId?: Map<string, MarkupSettings>;
  holds?: TenderHoldRecord[];
  unresolvedBoqDiffCount?: number;
  indirectDoubleCountWarnings?: string[];
  exportMatched?: boolean;
  exportSha256?: string | null;
  zeroRateJustifiedItemIds?: Set<string>;
  includedCarrierByItemId?: Map<string, string>;
}): ReadinessEvaluationResult {
  const asOfDate = params.asOfDate ?? new Date().toISOString().slice(0, 10);
  const findingsMap = new Map<string, ReadinessFinding>();
  const addFinding = (f: ReadinessFinding) => {
    if (!findingsMap.has(f.fingerprint)) findingsMap.set(f.fingerprint, f);
  };

  const leafItems = params.boqItems.filter((b) => !b["is_group"]);
  const boqSellById = new Map<string, { lineSellingPrice: number }>();
  let netSellingPriceSar = 0;
  let totalDirectCostSar = 0;

  for (const item of leafItems) {
    const id = String(item["id"]);
    const itemNo = String(item["item_no"] ?? "—");
    const paLines = params.paItemsByBoqId?.get(id);
    const markup = params.markupsByBoqId?.get(id);
    const resolved = resolveBoqItemPricing({
      item: item as any,
      ...(paLines ? { paLines } : {}),
      hasAnalysisFlag: (paLines?.length ?? 0) > 0 || item["rate_source"] === "analysis",
      ...(markup ? { markup } : {}),
    });
    boqSellById.set(id, { lineSellingPrice: resolved.lineSellingPrice });
    netSellingPriceSar = roundTo(netSellingPriceSar + resolved.lineSellingPrice, 2);
    totalDirectCostSar = roundTo(totalDirectCostSar + resolved.lineDirectCost, 2);

    // RD-07: Included elsewhere carrier validation + circular check (TC-321, TC-322)
    if (item["is_included_elsewhere"] || item["pricing_status"] === "included") {
      const carrier = params.includedCarrierByItemId?.get(id) ?? item["included_carrier_id"];
      if (!carrier) {
        addFinding({
          fingerprint: `RD-07:${id}`,
          ruleCode: "RD-07",
          severity: "blocker",
          title_ar: `البند [${itemNo}] محدد "مشمول في غيره" بدون ربط بند حامل معتمد`,
          title_en: `Item [${itemNo}] marked Included Elsewhere without carrier item`,
          boqItemId: id,
          itemNo,
          financialImpactSar: null,
          assignee: "مهندس التسعير",
          waivable: false,
        });
      } else {
        // Detect circular Included Elsewhere
        const seen = new Set<string>([id]);
        let cur: string | undefined = String(carrier);
        while (cur) {
          if (seen.has(cur)) {
            addFinding({
              fingerprint: `RD-07-CYCLE:${id}`,
              ruleCode: "RD-07",
              severity: "blocker",
              title_ar: `مرجع دائري في "مشمول في غيره" للبند [${itemNo}]`,
              title_en: `Circular Included Elsewhere reference on [${itemNo}]`,
              boqItemId: id,
              itemNo,
              financialImpactSar: null,
              assignee: "مهندس التسعير",
              waivable: false,
            });
            break;
          }
          seen.add(cur);
          cur = params.includedCarrierByItemId?.get(cur);
        }
      }
      continue;
    }

    // RD-02: Explicit 0 price without justification (TC-320)
    if (resolved.approvedUnitRate === 0 && item["pricing_status"] === "priced") {
      if (!params.zeroRateJustifiedItemIds?.has(id) && !item["note"]) {
        addFinding({
          fingerprint: `RD-02:${id}`,
          ruleCode: "RD-02",
          severity: "blocker",
          title_ar: `البند [${itemNo}] بسعر صفري بدون مبرر أو حالة تعاقدية موثقة`,
          title_en: `Zero rate on [${itemNo}] without justification`,
          boqItemId: id,
          itemNo,
          financialImpactSar: null,
          assignee: "مهندس التسعير",
          waivable: false,
        });
      }
      continue;
    }

    // RD-01: Unpriced mandatory BOQ item (TC-319)
    if (resolved.isUnpriced) {
      addFinding({
        fingerprint: `RD-01:${id}`,
        ruleCode: "RD-01",
        severity: "blocker",
        title_ar: `بند إلزامي غير مسعّر [${itemNo}]: ${item["description_ar"] ?? ""}`,
        title_en: `Mandatory item unpriced [${itemNo}]`,
        boqItemId: id,
        itemNo,
        financialImpactSar: null,
        assignee: "مهندس التسعير",
        waivable: false,
      });
    }

    // RD-04 & RD-03/15: Quote expiry as of assessment date & reference-only source warnings
    for (const line of paLines ?? []) {
      const expiredByStatus = line.quote_status === "expired";
      const expiredByDate = line.valid_until ? new Date(line.valid_until).getTime() < new Date(asOfDate).getTime() : false;
      if (expiredByStatus || expiredByDate) {
        addFinding({
          fingerprint: `RD-04:${id}:${line.scope_tag ?? "line"}`,
          ruleCode: "RD-04",
          severity: "warning",
          title_ar: `عرض المورد للبند [${itemNo}] منتهي الصلاحية بتاريخ الأساس (${asOfDate})`,
          title_en: `Expired supplier quote on [${itemNo}] as of ${asOfDate}`,
          boqItemId: id,
          itemNo,
          financialImpactSar: resolved.lineSellingPrice,
          assignee: "المشتريات",
          waivable: true,
        });
      }
    }
  }

  // RD-08: Blocking or open unresolved holds
  const holds = params.holds ?? [];
  for (const h of holds) {
    if (["Open", "InProgress", "AwaitingResponse", "PendingReview"].includes(h.status)) {
      addFinding({
        fingerprint: `RD-08:${h.id}`,
        ruleCode: "RD-08",
        severity: h.severity === "blocker" || h.severity === "high" ? "blocker" : "warning",
        title_ar: `تعليق مفتوح [${h.hold_ref}]: ${h.subject}`,
        title_en: `Open Hold [${h.hold_ref}]: ${h.subject}`,
        boqItemId: h.target_boq_item_ids[0] ?? null,
        financialImpactSar: h.impact_type === "unknown" ? null : Number(h.direct_cost_impact ?? 0),
        assignee: h.assignee,
        waivable: true,
      });
    }
  }

  // RD-09: Unresolved BOQ Revision mapping diffs
  if ((params.unresolvedBoqDiffCount ?? 0) > 0) {
    addFinding({
      fingerprint: `RD-09:${params.tenderId}`,
      ruleCode: "RD-09",
      severity: "blocker",
      title_ar: `توجد (${params.unresolvedBoqDiffCount}) مطابقات ملتبسة في مراجعة المقايسة بانتظار قرار المهندس`,
      title_en: `${params.unresolvedBoqDiffCount} unresolved BOQ diff mappings`,
      financialImpactSar: null,
      assignee: "مهندس الحصر",
      waivable: false,
    });
  }

  // RD-06: Indirect double-counting
  for (const w of params.indirectDoubleCountWarnings ?? []) {
    addFinding({
      fingerprint: `RD-06:${w}`,
      ruleCode: "RD-06",
      severity: "blocker",
      title_ar: w,
      title_en: "Indirect cost double counting detected",
      financialImpactSar: null,
      assignee: "رئيس التسعير",
      waivable: false,
    });
  }

  // RD-10: Excel export mismatch
  if (params.exportMatched === false) {
    addFinding({
      fingerprint: `RD-10:${params.tenderId}`,
      ruleCode: "RD-10",
      severity: "blocker",
      title_ar: "يوجد اختلاف بين قيم المقايسة وملف التسليم Excel — يمنع التقديم (EXPORT_MISMATCH)",
      title_en: "Excel submission workbook mismatch (EXPORT_MISMATCH)",
      financialImpactSar: null,
      assignee: "مدير العطاء",
      waivable: false,
    });
  }

  const findings = Array.from(findingsMap.values());
  const blockersCount = findings.filter((f) => f.severity === "blocker").length;
  const warningsCount = findings.filter((f) => f.severity === "warning").length;
  const firstMarkup = Array.from(params.markupsByBoqId?.values() ?? [])[0];
  const holdsConsolidation = consolidateHoldsFinancialExposure({
    holds,
    boqItemsById: boqSellById,
    ...(firstMarkup ? { markups: firstMarkup } : {}),
  });

  const overallState: ReadinessOverallState =
    blockersCount > 0
      ? "NOT_READY"
      : holdsConsolidation.acceptedRiskCount > 0 || warningsCount > 0
        ? "READY_WITH_APPROVED_QUALIFICATIONS"
        : "READY";

  return {
    inputHash: computeEstimateInputHash({
      tenderId: params.tenderId,
      boqItems: leafItems,
      holds,
      ...(params.exportSha256 !== undefined ? { exportSha256: params.exportSha256 } : {}),
    }),
    asOfDate,
    overallState,
    blockersCount,
    warningsCount,
    findings,
    holdsConsolidation,
    netSellingPriceSar,
    totalDirectCostSar,
  };
}

// ── 3. Scope-Normalized Supplier Quote Comparison (DEV-309) ───────────────────

export type ComplianceState = "Compliant" | "Deviation" | "Excluded" | "Unknown" | "NotApplicable";

export interface ComparisonAdjustment {
  key: string;
  label_ar: string;
  kind: "addition" | "deduction";
  unitRateOrAmount: number | null;
  basis: "per_unit" | "lump_sum";
  includedInOffer: boolean;
  isUnknown?: boolean;
  sourceNote?: string;
}

export interface ComparisonOfferEvaluation {
  offerId: string;
  supplierName: string;
  quotedUnitRate: number;
  requiredQuantity: number;
  adjustments: ComparisonAdjustment[];
  compliance: Record<string, ComplianceState>;
  isTechnicallyCompliant: boolean;
  isComplete: boolean;
  baseComparableAmount: number;
  normalizedAmount: number;
  comparableUnitRate: number | null;
  knownPartialAmount: number;
  unknownScopes: string[];
  rank: number | null;
  decision?: "Selected" | "Alternative" | "Rejected" | "Pending";
  decisionRationale?: string;
}

/**
 * Evaluates & normalizes supplier offers onto one commercial scope baseline (V3.0 §11.2 & TC-331..334).
 * Incomplete offers (e.g. pumping = Unknown) NEVER rank #1 over complete comparable offers.
 */
export function evaluateNormalizedComparisonPackage(params: {
  requiredQuantity: number;
  offers: Array<{
    offerId: string;
    supplierName: string;
    quotedUnitRate: number;
    compliance?: Record<string, ComplianceState>;
    adjustments: ComparisonAdjustment[];
  }>;
}): ComparisonOfferEvaluation[] {
  const qty = Math.max(0.0001, Number(params.requiredQuantity) || 1);

  const evaluated: ComparisonOfferEvaluation[] = params.offers.map((offer) => {
    const baseComparableAmount = roundTo(offer.quotedUnitRate * qty, 2);
    let knownDelta = 0;
    const unknownScopes: string[] = [];

    for (const adj of offer.adjustments) {
      if (adj.includedInOffer) continue; // Do not double-add already included scope (TC-332)
      if (adj.isUnknown || adj.unitRateOrAmount === null) {
        unknownScopes.push(adj.label_ar);
        continue;
      }
      const amt = adj.basis === "per_unit" ? adj.unitRateOrAmount * qty : adj.unitRateOrAmount;
      knownDelta += adj.kind === "deduction" ? -amt : amt;
    }

    const complianceValues = Object.values(offer.compliance ?? {});
    const isTechnicallyCompliant = !complianceValues.includes("Deviation");
    const isComplete = unknownScopes.length === 0;
    const knownPartialAmount = roundTo(baseComparableAmount + knownDelta, 2);
    const comparableUnitRate = isComplete ? roundTo(knownPartialAmount / qty, 2) : null;

    return {
      offerId: offer.offerId,
      supplierName: offer.supplierName,
      quotedUnitRate: offer.quotedUnitRate,
      requiredQuantity: qty,
      adjustments: offer.adjustments,
      compliance: offer.compliance ?? {},
      isTechnicallyCompliant,
      isComplete,
      baseComparableAmount,
      normalizedAmount: knownPartialAmount,
      comparableUnitRate,
      knownPartialAmount,
      unknownScopes,
      rank: null,
      decision: "Pending",
    };
  });

  const rankable = evaluated
    .filter((o) => o.isComplete && o.isTechnicallyCompliant && o.comparableUnitRate !== null)
    .sort((a, b) => (a.comparableUnitRate ?? Infinity) - (b.comparableUnitRate ?? Infinity));
  rankable.forEach((o, idx) => {
    o.rank = idx + 1;
  });

  return evaluated;
}

// ── 4. BOQ Revision Diff & Reconciliation Engine (DEV-310) ────────────────────

export type BoqDiffChangeType =
  | "Unchanged"
  | "Moved"
  | "QuantityChanged"
  | "DescriptionChanged"
  | "UnitChanged"
  | "Added"
  | "Deleted"
  | "SplitMerge"
  | "Ambiguous";

export interface BoqRevisionLine {
  id: string;
  stableKey?: string | null;
  item_no: string;
  section?: string | null;
  description_ar: string;
  unit: string;
  quantity: number;
  unitRate: number;
  rowIndex?: number;
}

export interface BoqDiffMappingRow {
  mappingId: string;
  oldItem: BoqRevisionLine | null;
  newItem: BoqRevisionLine | null;
  changeType: BoqDiffChangeType;
  confidence: number;
  oldValue: number;
  newValue: number;
  quantityEffect: number;
  rateEffect: number;
  totalDelta: number;
  requiresEngineerDecision: boolean;
  engineerDecision?: "approved_transfer" | "new_analysis" | "rejected" | "pending";
}

function normBoqText(s: string): string {
  return s.trim().toLowerCase().replace(/[\u064B-\u065F]/g, "").replace(/\s+/g, " ");
}

/**
 * Matches Rev.N vs Rev.N+1 BOQ rows and separates Quantity Effect `(Q1 - Q0) * R0`
 * from Rate Effect `Q1 * (R1 - R0)` per V3.0 §12.3 (800*300 -> 900*315 => +30,000 + 13,500 = +43,500).
 */
export function compareBoqRevisions(
  oldLines: BoqRevisionLine[],
  newLines: BoqRevisionLine[],
): {
  mappings: BoqDiffMappingRow[];
  summary: {
    oldTotal: number;
    newTotal: number;
    quantityEffectTotal: number;
    rateEffectTotal: number;
    addedTotal: number;
    deletedTotal: number;
    netDelta: number;
    unresolvedCount: number;
  };
} {
  const unmatchedNew = new Set(newLines.map((n) => n.id));
  const newById = new Map(newLines.map((n) => [n.id, n]));
  const mappings: BoqDiffMappingRow[] = [];

  for (const oldIt of oldLines) {
    // 1. Try stableKey exact match -> item_no + normalized desc match -> moved item match
    let matchedNew: BoqRevisionLine | undefined;
    let confidence = 0;

    for (const newId of unmatchedNew) {
      const candidate = newById.get(newId)!;
      if (oldIt.stableKey && candidate.stableKey && oldIt.stableKey === candidate.stableKey) {
        matchedNew = candidate;
        confidence = 1.0;
        break;
      }
      if (oldIt.item_no && candidate.item_no && oldIt.item_no === candidate.item_no) {
        matchedNew = candidate;
        confidence = normBoqText(oldIt.description_ar) === normBoqText(candidate.description_ar) ? 0.98 : 0.72;
        break;
      }
      if (normBoqText(oldIt.description_ar) === normBoqText(candidate.description_ar) && oldIt.unit === candidate.unit) {
        matchedNew = candidate;
        confidence = 0.9;
        break;
      }
    }

    const oldVal = roundTo(oldIt.quantity * oldIt.unitRate, 2);

    if (!matchedNew) {
      mappings.push({
        mappingId: `diff-del-${oldIt.id}`,
        oldItem: oldIt,
        newItem: null,
        changeType: "Deleted",
        confidence: 1,
        oldValue: oldVal,
        newValue: 0,
        quantityEffect: roundTo(-oldVal, 2),
        rateEffect: 0,
        totalDelta: roundTo(-oldVal, 2),
        requiresEngineerDecision: false,
        engineerDecision: "approved_transfer",
      });
      continue;
    }

    unmatchedNew.delete(matchedNew.id);
    const newVal = roundTo(matchedNew.quantity * matchedNew.unitRate, 2);

    const sameDesc = normBoqText(oldIt.description_ar) === normBoqText(matchedNew.description_ar);
    const sameUnit = oldIt.unit.trim() === matchedNew.unit.trim();
    const sameQty = Math.abs(oldIt.quantity - matchedNew.quantity) < 1e-6;
    const sameRate = Math.abs(oldIt.unitRate - matchedNew.unitRate) < 1e-6;
    const movedRow = oldIt.rowIndex !== undefined && matchedNew.rowIndex !== undefined && oldIt.rowIndex !== matchedNew.rowIndex;

    let changeType: BoqDiffChangeType = "Unchanged";
    let requiresEngineerDecision = false;

    if (!sameUnit) {
      changeType = "UnitChanged";
      requiresEngineerDecision = true;
    } else if (!sameDesc) {
      changeType = confidence < 0.75 ? "Ambiguous" : "DescriptionChanged";
      requiresEngineerDecision = true;
    } else if (!sameQty || !sameRate) {
      changeType = "QuantityChanged";
    } else if (movedRow) {
      changeType = "Moved";
    }

    // Sequence: Quantity Effect first at R0, then Rate Effect at Q1
    const quantityEffect = sameUnit ? roundTo((matchedNew.quantity - oldIt.quantity) * oldIt.unitRate, 2) : 0;
    const rateEffect = sameUnit ? roundTo(matchedNew.quantity * (matchedNew.unitRate - oldIt.unitRate), 2) : roundTo(newVal - oldVal, 2);
    const totalDelta = roundTo(newVal - oldVal, 2);

    mappings.push({
      mappingId: `diff-${oldIt.id}-${matchedNew.id}`,
      oldItem: oldIt,
      newItem: matchedNew,
      changeType,
      confidence,
      oldValue: oldVal,
      newValue: newVal,
      quantityEffect,
      rateEffect,
      totalDelta,
      requiresEngineerDecision,
      engineerDecision: requiresEngineerDecision ? "pending" : "approved_transfer",
    });
  }

  for (const newId of unmatchedNew) {
    const newIt = newById.get(newId)!;
    const newVal = roundTo(newIt.quantity * newIt.unitRate, 2);
    mappings.push({
      mappingId: `diff-add-${newIt.id}`,
      oldItem: null,
      newItem: newIt,
      changeType: "Added",
      confidence: 1,
      oldValue: 0,
      newValue: newVal,
      quantityEffect: newVal,
      rateEffect: 0,
      totalDelta: newVal,
      requiresEngineerDecision: false,
      engineerDecision: "new_analysis",
    });
  }

  const oldTotal = roundTo(oldLines.reduce((s, r) => s + r.quantity * r.unitRate, 0), 2);
  const newTotal = roundTo(newLines.reduce((s, r) => s + r.quantity * r.unitRate, 0), 2);
  const quantityEffectTotal = roundTo(mappings.reduce((s, m) => s + m.quantityEffect, 0), 2);
  const rateEffectTotal = roundTo(mappings.reduce((s, m) => s + m.rateEffect, 0), 2);
  const addedTotal = roundTo(mappings.filter((m) => m.changeType === "Added").reduce((s, m) => s + m.newValue, 0), 2);
  const deletedTotal = roundTo(mappings.filter((m) => m.changeType === "Deleted").reduce((s, m) => s + m.oldValue, 0), 2);
  const netDelta = roundTo(newTotal - oldTotal, 2);
  const unresolvedCount = mappings.filter((m) => m.requiresEngineerDecision && m.engineerDecision === "pending").length;

  return {
    mappings,
    summary: { oldTotal, newTotal, quantityEffectTotal, rateEffectTotal, addedTotal, deletedTotal, netDelta, unresolvedCount },
  };
}

// ── 5. Excel Security, Reconciliation & Submission Lock Gate (DEV-311) ────────

/** Neutralizes formula-injection risks in exported text cells without breaking approved numeric formulas (TC-352). */
export function sanitizeExcelTextCell(value: string): string {
  const trimmed = String(value ?? "");
  if (/^[=+\-@]/.test(trimmed.trimStart())) {
    return `'${trimmed}`;
  }
  return trimmed;
}

export function reconcileExcelAgainstBoq(params: {
  boqItems: Array<{ item_no: string; quantity: number; approvedUnitRate: number; lineSellingPrice: number }>;
  excelRows: Array<{ item_no: string; quantity: number; unitRate: number; lineTotal: number }>;
  toleranceSar?: number;
}): { matched: boolean; mismatches: Array<{ itemNo: string; reason: string }>; boqTotal: number; excelTotal: number } {
  const tol = params.toleranceSar ?? 0.01;
  const excelByItem = new Map(params.excelRows.map((r) => [r.item_no.trim(), r]));
  const mismatches: Array<{ itemNo: string; reason: string }> = [];

  for (const boq of params.boqItems) {
    const ex = excelByItem.get(boq.item_no.trim());
    if (!ex) {
      mismatches.push({ itemNo: boq.item_no, reason: "البند مفقود من ملف Excel المصدر" });
      continue;
    }
    if (Math.abs(ex.unitRate - boq.approvedUnitRate) > tol) {
      mismatches.push({
        itemNo: boq.item_no,
        reason: `اختلاف سعر الوحدة: المقايسة ${boq.approvedUnitRate} مقابل Excel ${ex.unitRate}`,
      });
    }
    if (Math.abs(ex.lineTotal - boq.lineSellingPrice) > tol) {
      mismatches.push({
        itemNo: boq.item_no,
        reason: `اختلاف إجمالي السطر: المقايسة ${boq.lineSellingPrice} مقابل Excel ${ex.lineTotal}`,
      });
    }
  }

  const boqTotal = roundTo(params.boqItems.reduce((s, r) => s + r.lineSellingPrice, 0), 2);
  const excelTotal = roundTo(params.excelRows.reduce((s, r) => s + r.lineTotal, 0), 2);
  if (Math.abs(boqTotal - excelTotal) > tol) {
    mismatches.push({ itemNo: "TOTAL", reason: `اختلاف المجموع العام: ${boqTotal} مقابل Excel ${excelTotal}` });
  }

  return {
    matched: mismatches.length === 0,
    mismatches,
    boqTotal,
    excelTotal,
  };
}

/**
 * Final Pre-Submission Gate (DEV-311):
 * Verifies role authorization, fresh readiness hash, Excel reconciliation, optimistic version,
 * then calls atomic `submitTenderVersion` to freeze an immutable Submission Snapshot.
 */
export async function approveAndLockTenderSubmission(params: {
  tenderId: string;
  projectId: string;
  companyId?: string | null;
  companyName?: string | null;
  clientName?: string | null;
  actorId: string;
  actorRole: WorkspaceGovernanceRole;
  expectedDraftVersion: number;
  currentDraftVersion: number;
  readiness: ReadinessEvaluationResult;
  currentEstimateInputHash: string;
  exportReconciled?: boolean;
  exportSha256?: string;
  idempotencyKey: string;
  vatRate?: number;
  useOriginalWorkbook?: boolean;
  boqItems: Array<Record<string, any>>;
  paItemsByBoqId?: Map<string, ResourceCostInput[]>;
  markupsByBoqId?: Map<string, MarkupSettings>;
}): Promise<SubmittedTenderSnapshot & { exportSha256: string; readinessInputHash: string }> {
  if (!["approver", "data_admin"].includes(params.actorRole)) {
    throw new Error("NOT_AUTHORIZED: اعتماد وقفل نسخة التقديم النهائية يتطلب صلاحية مدير العطاء أو المعتمد التجاري.");
  }
  if (params.readiness.inputHash !== params.currentEstimateInputHash) {
    throw new Error("STALE_VERSION: تغيّرت أسعار أو بيانات التقدير بعد آخر فحص جاهزية؛ أعد فحص الجاهزية أولاً (TC-343).");
  }
  if (params.expectedDraftVersion !== params.currentDraftVersion) {
    throw new Error(
      `STALE_VERSION: تعارض في إصدار المسودة (${params.expectedDraftVersion} مقابل ${params.currentDraftVersion}).`,
    );
  }
  if (params.readiness.overallState === "NOT_READY") {
    throw new Error("READINESS_BLOCKED: توجد موانع جاهزية لم تُغلق بعد؛ لا يمكن اعتماد التقديم.");
  }
  if (params.exportReconciled === false) {
    throw new Error("EXPORT_MISMATCH: يجب مطابقة ملف Excel وتثبيت بصمته قبل اعتماد التقديم (TC-341).");
  }

  let snap: SubmittedTenderSnapshot;
  let resolvedSha = params.exportSha256 ?? "";

  if (!params.exportSha256) {
    const unified = await executeUnifiedTenderSubmission({
      tenderId: params.tenderId,
      projectId: params.projectId,
      companyId: params.companyId ?? null,
      companyName: params.companyName ?? null,
      clientName: params.clientName ?? null,
      actorId: params.actorId,
      actorRole: params.actorRole,
      ...(params.vatRate !== undefined ? { vatRate: params.vatRate } : {}),
      idempotencyKey: params.idempotencyKey,
      readinessInputHash: params.readiness.inputHash,
      readinessOverallState: params.readiness.overallState,
      boqItems: params.boqItems,
      ...(params.paItemsByBoqId ? { paItemsByBoqId: params.paItemsByBoqId } : {}),
      ...(params.markupsByBoqId ? { markupsByBoqId: params.markupsByBoqId } : {}),
      ...(params.useOriginalWorkbook !== undefined ? { useOriginalWorkbook: params.useOriginalWorkbook } : {}),
    });
    snap = unified.snapshot;
    resolvedSha = unified.staging.exportSha256;
  } else {
    snap = await submitTenderVersion({
      tenderId: params.tenderId,
      projectId: params.projectId,
      companyId: params.companyId ?? null,
      companyName: params.companyName ?? null,
      clientName: params.clientName ?? null,
      expectedDraftVersion: params.expectedDraftVersion,
      currentDraftVersion: params.currentDraftVersion,
      idempotencyKey: params.idempotencyKey,
      userId: params.actorId,
      actorRole: params.actorRole,
      readinessInputHash: params.readiness.inputHash,
      exportSha256: params.exportSha256,
      documentRef: `SHA256:${params.exportSha256}`,
      vatRate: params.vatRate ?? 15,
      boqItems: params.boqItems as any,
      ...(params.paItemsByBoqId ? { paItemsByBoqId: params.paItemsByBoqId } : {}),
      ...(params.markupsByBoqId ? { markupsByBoqId: params.markupsByBoqId } : {}),
    });
  }

  try {
    await (estimationClient as any).from("knowledge_audit_logs").insert({
      workspace_id: params.actorId,
      company_id: params.companyId ?? null,
      actor_id: params.actorId,
      action: "submission_locked",
      entity_type: "tender_submission",
      entity_id: snap.id,
      metadata: {
        tenderId: params.tenderId,
        versionNo: snap.versionNo,
        exportSha256: resolvedSha,
        readinessInputHash: params.readiness.inputHash,
        netSellingPrice: snap.netSellingPrice,
      },
    });
  } catch {
    // non-fatal audit sync in offline unit specs
  }

  return {
    ...snap,
    exportSha256: resolvedSha,
    readinessInputHash: params.readiness.inputHash,
  };
}
