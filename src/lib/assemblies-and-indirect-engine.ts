/**
 * Taqdiri V3.0 Parametric Typical Standard Assemblies & Indirect Cost Allocation Engine
 * Implements DEV-305 (Typical Standard Assemblies: Fence, Underground Water Tank, Safe Formula Engine)
 * and DEV-306 (Indirect Cost Time-Phased Histograms, Single Recovery Path, Deterministic Pro-Rata Allocation).
 */

import { roundTo } from "@/lib/estimation-calc";

// ── 1. Safe Declarative Formula Evaluator (No eval, No dynamic code) ─────────

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" };

const ALLOWED_FUNCTIONS = new Set(["min", "max", "ceil", "floor", "round", "sqrt", "abs"]);

function tokenizeFormula(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (i < expr.length && /[0-9.]/.test(expr[i]!)) {
        numStr += expr[i++];
      }
      const num = Number(numStr);
      if (!Number.isFinite(num)) throw new Error(`رقم غير صالح في الصيغة: ${numStr}`);
      tokens.push({ type: "num", value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i]!)) {
        ident += expr[i++];
      }
      tokens.push({ type: "ident", value: ident });
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }
    if ("+-*/".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    throw new Error(`محرف أو دالة غير مسموحة في محرك الصيغ المقيّد: "${ch}"`);
  }
  return tokens;
}

export function evaluateRestrictedFormula(expr: string, vars: Record<string, number>): number {
  const tokens = tokenizeFormula(expr);
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpression(): number {
    let left = parseTerm();
    while (peek()?.type === "op" && (peek() as any).value in { "+": 1, "-": 1 }) {
      const op = (consume() as any).value;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseUnary();
    while (peek()?.type === "op" && (peek() as any).value in { "*": 1, "/": 1 }) {
      const op = (consume() as any).value;
      const right = parseUnary();
      if (op === "/") {
        if (Math.abs(right) < 1e-12) throw new Error("خطأ حسابي: القسمة على صفر ممنوعة في صيغ النماذج.");
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function parseUnary(): number {
    if (peek()?.type === "op" && ((peek() as any).value === "-" || (peek() as any).value === "+")) {
      const op = (consume() as any).value;
      const val = parseUnary();
      return op === "-" ? -val : val;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const tok = peek();
    if (!tok) throw new Error("صيغة غير مكتملة.");
    if (tok.type === "num") {
      consume();
      return tok.value;
    }
    if (tok.type === "paren" && tok.value === "(") {
      consume();
      const val = parseExpression();
      const close = consume();
      if (!close || close.type !== "paren" || close.value !== ")") {
        throw new Error("قوس إغلاق مفقود في الصيغة.");
      }
      return val;
    }
    if (tok.type === "ident") {
      consume();
      if (peek()?.type === "paren" && (peek() as any).value === "(") {
        if (!ALLOWED_FUNCTIONS.has(tok.value)) {
          throw new Error(`الدالة "${tok.value}" غير مسموحة في محرك الصيغ المقيّد (BR-L10).`);
        }
        consume(); // '('
        const args: number[] = [];
        if (!(peek()?.type === "paren" && (peek() as any).value === ")")) {
          args.push(parseExpression());
          while (peek()?.type === "comma") {
            consume();
            args.push(parseExpression());
          }
        }
        const close = consume();
        if (!close || close.type !== "paren" || close.value !== ")") {
          throw new Error("قوس إغلاق الدالة مفقود.");
        }
        switch (tok.value) {
          case "min":
            return Math.min(...args);
          case "max":
            return Math.max(...args);
          case "ceil":
            return Math.ceil(args[0] ?? 0);
          case "floor":
            return Math.floor(args[0] ?? 0);
          case "round":
            return roundTo(args[0] ?? 0, args[1] ?? 0);
          case "sqrt":
            if ((args[0] ?? 0) < 0) throw new Error("لا يمكن حساب الجذر التربيعي لعدد سالب.");
            return Math.sqrt(args[0] ?? 0);
          case "abs":
            return Math.abs(args[0] ?? 0);
        }
      }
      if (!Object.hasOwn(vars, tok.value)) {
        throw new Error(`معامل غير معرّف في الصيغة: ${tok.value}`);
      }
      return vars[tok.value]!;
    }
    throw new Error("تعبير غير صالح في الصيغة.");
  }

  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error("رمز زائد غير متوقع في نهاية الصيغة.");
  }
  return result;
}

export function detectCyclicAssemblyReferences(
  edges: Array<{ parentCode: string; childCode: string }>,
): string[] | null {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    const list = graph.get(e.parentCode) ?? [];
    list.push(e.childCode);
    graph.set(e.parentCode, list);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!visited.has(next)) {
        const cyc = dfs(next);
        if (cyc) return cyc;
      } else if (stack.has(next)) {
        return [...path.slice(path.indexOf(next)), next];
      }
    }
    stack.delete(node);
    path.pop();
    return null;
  }

  for (const key of graph.keys()) {
    if (!visited.has(key)) {
      const cyc = dfs(key);
      if (cyc) return cyc;
    }
  }
  return null;
}

// ── 2. Typical Standard Assemblies (DEV-305) ─────────────────────────────────

export interface PlywoodFenceAreaInput {
  length_m: number;
  height_m: number;
  gate_width_m?: number;
  waste_pct?: number;
  sheet_rate_sar_per_m2?: number;
  posts_allowance_sar?: number;
  accessories_allowance_sar?: number;
  install_labor_allowance_sar?: number;
  gate_cost_sar?: number;
  equipment_transport_sar?: number;
}

export interface PlywoodFenceDiscreteInput {
  length_m: number;
  height_m: number;
  post_spacing_m: number;
  sheet_width_m?: number;
  sheet_height_m?: number;
  waste_pct?: number;
  sheet_unit_price_sar?: number;
  post_unit_price_sar?: number;
}

/**
 * V3.0 §7.3 & Arabic Plan §10 Reference Assembly #1: 3m Plywood Site Fence.
 */
export function calculatePlywoodFenceAssembly(input: PlywoodFenceAreaInput) {
  if (input.length_m <= 0 || input.height_m <= 0 || input.height_m > 6) {
    throw new Error("OUT_OF_ENVELOPE: طول السور أو ارتفاعه خارج النطاق الهندسي المعتمد (0 < H <= 6m).");
  }
  const gateW = Math.max(0, input.gate_width_m ?? 4);
  const waste = Math.max(0, input.waste_pct ?? 5);
  const claddingAreaM2 = roundTo(
    evaluateRestrictedFormula("(L - G) * H * (1 + W / 100)", {
      L: input.length_m,
      G: gateW,
      H: input.height_m,
      W: waste,
    }),
    4,
  );
  const sheetCost = roundTo(claddingAreaM2 * (input.sheet_rate_sar_per_m2 ?? 45), 2);
  const postsCost = roundTo(input.posts_allowance_sar ?? 5000, 2);
  const accessoriesCost = roundTo(input.accessories_allowance_sar ?? 1800, 2);
  const laborCost = roundTo(input.install_labor_allowance_sar ?? 4200, 2);
  const gateCost = roundTo(input.gate_cost_sar ?? 3000, 2);
  const equipTransportCost = roundTo(input.equipment_transport_sar ?? 2400, 2);
  const totalDirectCost = roundTo(
    sheetCost + postsCost + accessoriesCost + laborCost + gateCost + equipTransportCost,
    2,
  );
  const directUnitCostPerM = roundTo(totalDirectCost / input.length_m, 4);

  return {
    claddingAreaM2,
    components: [
      { code: "PLYWOOD", title_ar: "كسوة Plywood", qty: claddingAreaM2, unit: "m2", cost: sheetCost },
      { code: "POSTS", title_ar: "القوائم والدعامات", qty: 1, unit: "LS", cost: postsCost },
      { code: "ACC", title_ar: "الإكسسوارات والتثبيت", qty: 1, unit: "LS", cost: accessoriesCost },
      { code: "LABOR", title_ar: "عمالة التركيب", qty: 1, unit: "LS", cost: laborCost },
      { code: "GATE", title_ar: "البوابة", qty: gateW > 0 ? 1 : 0, unit: "nr", cost: gateCost },
      { code: "TRANS", title_ar: "معدات ونقل", qty: 1, unit: "LS", cost: equipTransportCost },
    ],
    totalDirectCost,
    directUnitCostPerM,
  };
}

/**
 * Arabic Plan §10 Discrete Purchasing Test Case (111 sheets, 43 posts, 13,250 SAR materials-only).
 */
export function calculatePlywoodFenceDiscretePurchase(input: PlywoodFenceDiscreteInput) {
  if (input.length_m <= 0 || input.height_m <= 0 || input.post_spacing_m <= 0) {
    throw new Error("OUT_OF_ENVELOPE: مدخلات السور يجب أن تكون أكبر من صفر.");
  }
  const sheetArea = (input.sheet_width_m ?? 1.22) * (input.sheet_height_m ?? 2.44);
  const sheetsPerM = evaluateRestrictedFormula("H * (1 + W / 100) / SA", {
    H: input.height_m,
    W: input.waste_pct ?? 10,
    SA: sheetArea,
  });
  const totalSheetsRounded = evaluateRestrictedFormula("ceil(L * SPM)", {
    L: input.length_m,
    SPM: sheetsPerM,
  });
  const totalPosts = evaluateRestrictedFormula("ceil(L / S) + 1", {
    L: input.length_m,
    S: input.post_spacing_m,
  });
  const sheetsCost = roundTo(totalSheetsRounded * (input.sheet_unit_price_sar ?? 100), 2);
  const postsCost = roundTo(totalPosts * (input.post_unit_price_sar ?? 50), 2);
  const totalDirectCost = roundTo(sheetsCost + postsCost, 2);

  return {
    sheetsPerM: roundTo(sheetsPerM, 4),
    totalSheetsRounded,
    totalPosts,
    sheetsCost,
    postsCost,
    totalDirectCost,
    directCostPerM: roundTo(totalDirectCost / input.length_m, 4),
  };
}

export interface UndergroundTankInput {
  capacity_m3?: number | null;
  internal_depth_m?: number | null;
  wall_thickness_m?: number | null;
  slab_thickness_m?: number | null;
  rebar_kg_per_m3?: number | null;
  concrete_rate_sar?: number;
  rebar_rate_sar?: number;
  formwork_rate_sar?: number;
  waterproofing_rate_sar?: number;
}

/**
 * V3.0 §7.4 Reference Assembly #2: Parametric Underground Water Tank with strict design envelope checks.
 * Missing critical dimensions or out-of-envelope capacities return explicit `Pending Design Information`.
 */
export function calculateUndergroundTankAssembly(input: UndergroundTankInput): {
  status: "ready" | "Pending Design Information" | "OUT_OF_ENVELOPE";
  missingInputs: string[];
  footprint_m2?: number;
  concrete_volume_m3?: number;
  rebar_kg?: number;
  formwork_m2?: number;
  waterproofing_m2?: number;
  totalDirectCost?: number;
  directCostPerM3Capacity?: number;
} {
  const missingInputs: string[] = [];
  if (!input.capacity_m3 || input.capacity_m3 <= 0) missingInputs.push("السعة المطلوبة (م³)");
  if (!input.internal_depth_m || input.internal_depth_m <= 0) missingInputs.push("العمق الداخلي (م)");
  if (!input.wall_thickness_m || input.wall_thickness_m <= 0) missingInputs.push("سماكة الجدران الإنشائية (م)");
  if (!input.slab_thickness_m || input.slab_thickness_m <= 0) missingInputs.push("سماكة القاعدة والسقف (م)");

  if (missingInputs.length > 0) {
    return { status: "Pending Design Information", missingInputs };
  }

  const cap = input.capacity_m3!;
  if (cap < 20 || cap > 1000) {
    return {
      status: "OUT_OF_ENVELOPE",
      missingInputs: [`السعة (${cap} م³) خارج نطاق صلاحية النموذج النمطي [20 – 1000 م³].`],
    };
  }

  const depth = input.internal_depth_m!;
  const tw = input.wall_thickness_m!;
  const ts = input.slab_thickness_m!;
  // Assume square internal plan for initial parametric sizing unless QTO override supplied
  const footprint = evaluateRestrictedFormula("cap / depth", { cap, depth });
  const side = evaluateRestrictedFormula("sqrt(footprint)", { footprint });
  const extSide = side + 2 * tw;

  const baseAndRoofConcrete = 2 * (extSide * extSide * ts);
  const wallsConcrete = 4 * (side + tw) * depth * tw;
  const blindingConcrete = (extSide + 0.3) * (extSide + 0.3) * 0.1;
  const concrete_volume_m3 = roundTo(baseAndRoofConcrete + wallsConcrete + blindingConcrete, 2);

  const rebarKgPerM3 = input.rebar_kg_per_m3 ?? 135;
  const rebar_kg = roundTo(concrete_volume_m3 * rebarKgPerM3, 2);
  const formwork_m2 = roundTo(2 * (4 * side * depth) + extSide * extSide, 2);
  const waterproofing_m2 = roundTo(extSide * extSide + 4 * extSide * (depth + 2 * ts), 2);

  const totalDirectCost = roundTo(
    concrete_volume_m3 * (input.concrete_rate_sar ?? 330) +
      rebar_kg * (input.rebar_rate_sar ?? 3.15) +
      formwork_m2 * (input.formwork_rate_sar ?? 75) +
      waterproofing_m2 * (input.waterproofing_rate_sar ?? 55),
    2,
  );

  return {
    status: "ready",
    missingInputs: [],
    footprint_m2: roundTo(footprint, 2),
    concrete_volume_m3,
    rebar_kg,
    formwork_m2,
    waterproofing_m2,
    totalDirectCost,
    directCostPerM3Capacity: roundTo(totalDirectCost / cap, 2),
  };
}

export function compareAssemblyBuildupVsOffer(params: {
  buildupDirectCost: number;
  offerUnitOrTotalPrice: number;
  quantity: number;
  chosenBasis: "buildup" | "supplier_offer";
  rationale: string;
}) {
  const buildupTotal = roundTo(params.buildupDirectCost * params.quantity, 2);
  const offerTotal = roundTo(params.offerUnitOrTotalPrice, 2);
  const deltaSar = roundTo(offerTotal - buildupTotal, 2);
  return {
    buildupTotal,
    offerTotal,
    deltaSar,
    deltaPct: buildupTotal > 0 ? roundTo((deltaSar / buildupTotal) * 100, 2) : 0,
    chosenBasis: params.chosenBasis,
    selectedDirectTotal: params.chosenBasis === "buildup" ? buildupTotal : offerTotal,
    rationale: params.rationale,
  };
}

// ── 3. Indirect Cost Histogram & Deterministic Allocation Engine (DEV-306) ───

export interface HistogramPeriod {
  label: string;
  months: number;
  count: number;
  monthlyRate: number;
}

export function calculateTimePhasedHistogramCost(periods: HistogramPeriod[]): number {
  let total = 0;
  for (const p of periods) {
    total += Math.max(0, Number(p.months) || 0) * Math.max(0, Number(p.count) || 0) * Math.max(0, Number(p.monthlyRate) || 0);
  }
  return roundTo(total, 2);
}

/**
 * Allocates an indirect cost pool proportionally across eligible direct-cost items.
 * Assigns any rounding residual deterministically to the largest eligible item so sum(allocated) === totalPool exactly (TC-318).
 */
export function allocateIndirectCostPool(
  totalPool: number,
  eligibleItems: Array<{ boqItemId: string; directCostTotal: number }>,
): Array<{ boqItemId: string; weight: number; allocatedAmount: number }> {
  const pool = roundTo(Math.max(0, totalPool), 2);
  const positiveItems = eligibleItems.filter((i) => i.directCostTotal > 0);
  const totalBase = positiveItems.reduce((s, i) => s + i.directCostTotal, 0);
  if (pool === 0 || positiveItems.length === 0 || totalBase <= 0) {
    return eligibleItems.map((i) => ({ boqItemId: i.boqItemId, weight: 0, allocatedAmount: 0 }));
  }

  let runningSum = 0;
  let maxIdx = 0;
  const rows = positiveItems.map((item, idx) => {
    if (item.directCostTotal > positiveItems[maxIdx]!.directCostTotal) maxIdx = idx;
    const weight = item.directCostTotal / totalBase;
    const allocatedAmount = roundTo(pool * weight, 2);
    runningSum = roundTo(runningSum + allocatedAmount, 2);
    return {
      boqItemId: item.boqItemId,
      weight: roundTo(weight, 6),
      allocatedAmount,
    };
  });

  const diff = roundTo(pool - runningSum, 2);
  if (Math.abs(diff) > 0 && rows[maxIdx]) {
    rows[maxIdx]!.allocatedAmount = roundTo(rows[maxIdx]!.allocatedAmount + diff, 2);
  }
  return rows;
}

export function detectIndirectDoubleCounting(params: {
  indirectLines: Array<{
    costScopeId: string;
    title_ar: string;
    recovery_mode: "preliminaries_boq" | "distributed_overhead" | "separate_commercial";
    totalCost: number;
  }>;
  hasExplicitPrelimBoqItems: boolean;
  itemsHaveIndirectPct: boolean;
}): { hasDoubleCounting: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const seenScopes = new Set<string>();
  for (const line of params.indirectLines) {
    if (seenScopes.has(line.costScopeId)) {
      warnings.push(`ازدواج نطاق غير مباشر (${line.costScopeId}): مصروف "${line.title_ar}" محمّل بأكثر من مسار استرداد.`);
    }
    seenScopes.add(line.costScopeId);

    if (line.recovery_mode === "preliminaries_boq" && params.itemsHaveIndirectPct && line.totalCost > 0) {
      warnings.push(
        `ازدواج التحميل (TC-317): المصروف "${line.title_ar}" مدرج في بنود التمهيديات مع وجود نسبة تكلفة غير مباشرة (indirect_pct) على بنود المقايسة.`,
      );
    }
    if (line.recovery_mode === "distributed_overhead" && params.hasExplicitPrelimBoqItems && line.totalCost > 0) {
      warnings.push(
        `تنبيه تداخل (TC-317): "${line.title_ar}" موزع كنسبة غير مباشرة بينما توجد بنود تمهيديات صريحة بالقسم 01.`,
      );
    }
  }
  return {
    hasDoubleCounting: warnings.length > 0,
    warnings,
  };
}
