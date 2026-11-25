import { createServerFn } from "@tanstack/react-start";

export interface AiBoqItemDigest {
  item_no: string;
  description_ar: string;
  unit?: string | null;
  quantity?: number | null;
  hasAnalysis: boolean;
}

export interface AiEstimationRequest {
  projectId?: string;
  language: "ar" | "en";
  projectName: string;
  clientName?: string | null;
  prompt: string;
  boqItems: AiBoqItemDigest[];
  totalDirectCost: number;
  unpricedCount: number;
}

export interface AiEstimationResponse {
  reply: string;
  provider: "openai" | "gemini" | "taqdiri-server-engine" | "taqdiri-edge-audit";
  generatedAt: string;
}

const MAX_PROMPT_CHARS = 2000;
const MAX_BOQ_DIGEST_ITEMS = 150;

export const askAiEstimationServer = createServerFn({ method: "POST" })
  .inputValidator((input: AiEstimationRequest) => input)
  .handler(async ({ data }): Promise<AiEstimationResponse> => {
    const [
      { DEFAULT_BREAKDOWN_TEMPLATES, calculateBreakdownCost },
      { csiDivisionCode },
      { getRequestHeader },
    ] = await Promise.all([
      import("./breakdown-library"),
      import("./csi-divisions"),
      import("@tanstack/react-start/server"),
    ]);

    const cleanPrompt = String(data.prompt ?? "").trim().slice(0, MAX_PROMPT_CHARS);
    if (!cleanPrompt) {
      throw new Error("يرجى إدخال نص السؤال أولاً.");
    }
    const boundedItems = Array.isArray(data.boqItems) ? data.boqItems.slice(0, MAX_BOQ_DIGEST_ITEMS) : [];

    // Verify caller identity & project scope in hosted production or when Bearer JWT is supplied
    const authHeader = getRequestHeader("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const isProd = process.env["NODE_ENV"] === "production";

    if (isProd || bearerToken) {
      if (!bearerToken) {
        throw new Error("Unauthorized: يرجى تسجيل الدخول لاستخدام المساعد الذكي.");
      }
      const supabaseUrl = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
      const supabaseKey =
        process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
      if (supabaseUrl && supabaseKey) {
        const { createClient } = await import("@supabase/supabase-js");
        const scopedSupabase = createClient(supabaseUrl, supabaseKey, {
          global: { headers: { Authorization: `Bearer ${bearerToken}` } },
        });
        const { data: userRes, error: userErr } = await scopedSupabase.auth.getUser(bearerToken);
        if (userErr || !userRes?.user) {
          throw new Error("Unauthorized: جلسة المستخدم غير صالحة أو منتهية.");
        }
        if (data.projectId) {
          const { data: projRow, error: projErr } = await scopedSupabase
            .from("projects")
            .select("id")
            .eq("id", data.projectId)
            .maybeSingle();
          if (projErr || !projRow) {
            throw new Error("Forbidden: المشروع المحدد خارج نطاق صلاحياتك.");
          }
        }
      }
    }

    const openAiKey = process.env["OPENAI_API_KEY"];
    const geminiKey = process.env["GEMINI_API_KEY"] || process.env["AI_API_KEY"];

    const systemContext = [
      "You are Taqdiri AI Estimation Engineer specializing in Saudi Arabian construction tenders, CSI MasterFormat 01-33, and SAR cost buildup.",
      `Project: ${String(data.projectName).slice(0, 160)}${data.clientName ? ` (Client: ${String(data.clientName).slice(0, 120)})` : ""}`,
      `BOQ Items: ${boundedItems.length}, Unpriced: ${data.unpricedCount}, Direct Cost SAR: ${Math.round(data.totalDirectCost)}`,
      `Respond concisely in ${data.language === "en" ? "English" : "Arabic"} with practical Saudi contracting numbers.`,
    ].join("\n");

    if (openAiKey) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: process.env["OPENAI_MODEL"] || "gpt-4o-mini",
            messages: [
              { role: "system", content: systemContext },
              { role: "user", content: cleanPrompt },
            ],
            temperature: 0.3,
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as any;
          const reply = json?.choices?.[0]?.message?.content?.trim();
          if (reply) {
            return { reply, provider: "openai", generatedAt: new Date().toISOString() };
          }
        }
      } catch {
        // Fall through cleanly to deterministic server audit engine
      }
    }

    if (geminiKey) {
      try {
        const model = process.env["GEMINI_MODEL"] || "gemini-2.5-flash";
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: `${systemContext}\n\nQuestion: ${cleanPrompt}` }] }],
            }),
          },
        );
        if (res.ok) {
          const json = (await res.json()) as any;
          const reply = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (reply) {
            return { reply, provider: "gemini", generatedAt: new Date().toISOString() };
          }
        }
      } catch {
        // Fall through cleanly to deterministic server audit engine
      }
    }

    // Server-side deterministic estimation audit engine fallback
    const isEn = data.language === "en";
    const lower = cleanPrompt.toLowerCase();
    const unpriced = boundedItems.filter((i) => !i.hasAnalysis);
    const searchTerms = cleanPrompt
      .toLowerCase()
      .split(/[\s،,./-]+/)
      .filter((w) => w.length >= 3);

    const matchedTemplates = DEFAULT_BREAKDOWN_TEMPLATES.filter((tpl) => {
      const haystack = `${tpl.title_ar} ${tpl.title_en} ${tpl.description_ar} ${tpl.code}`.toLowerCase();
      return searchTerms.some((term) => haystack.includes(term));
    }).slice(0, 4);

    let reply = "";
    if (
      lower.includes("غير المسعرة") ||
      lower.includes("ناقص") ||
      lower.includes("فجوة") ||
      lower.includes("unpriced") ||
      lower.includes("missing") ||
      lower.includes("gap")
    ) {
      const sample = unpriced
        .slice(0, 5)
        .map((u) => `• [${u.item_no}] ${u.description_ar} (${u.quantity ?? 0} ${u.unit ?? ""})`)
        .join("\n");
      reply = isEn
        ? `Server BOQ Audit for "${data.projectName}":\n- Total BOQ lines: ${boundedItems.length}\n- Unpriced items lacking breakdown analysis: ${unpriced.length}\n${sample ? `\nPriority items to price next:\n${sample}` : "\nAll BOQ items currently have cost analysis coverage."}`
        : `تقرير التدقيق الخادمي لمشروع "${data.projectName}":\n• إجمالي البنود المحمّلة: ${boundedItems.length} بنداً.\n• البنود غير المسعرة (بدون تحليل سعر): ${unpriced.length} بنداً.\n${sample ? `\nأبرز البنود المطلوب استكمال تحليلها:\n${sample}` : "\nجميع بنود المقايسة مغطاة بتحليلات سعر حالياً."}`;
    } else if (matchedTemplates.length > 0) {
      const lines = matchedTemplates
        .map((tpl) => {
          const calc = calculateBreakdownCost(tpl);
          const div = csiDivisionCode(tpl.division) || tpl.division;
          return isEn
            ? `• [${tpl.code} / DIV ${div}] ${tpl.title_en}: Direct ${calc.directUnitCost.toFixed(2)} SAR / ${tpl.unit} → Suggested Selling ${calc.unitSellingPrice.toFixed(2)} SAR`
            : `• [${tpl.code} / قسم ${div}] ${tpl.title_ar}: تكلفة مباشرة ${calc.directUnitCost.toFixed(2)} ر.س/${tpl.unit} ← سعر بيع مقترح ${calc.unitSellingPrice.toFixed(2)} ر.س`;
        })
        .join("\n");
      reply = isEn
        ? `Saudi CSI Library Benchmark Matches for "${data.projectName}":\n${lines}\n\n* Calculated on the server from Taqdiri's reviewed KSA assemblies.`
        : `مؤشرات التسعير المطابقة من مكتبة تقديري السعودية لمشروع "${data.projectName}":\n${lines}\n\n* تم الحساب على الخادم وفق نماذج CSI المعتمدة شاملة التكلفة المباشرة وسعر البيع المقترح.`;
    } else if (lower.includes("ربح") || lower.includes("مخاطر") || lower.includes("هامش") || lower.includes("margin") || lower.includes("profit")) {
      const baseDirect = data.totalDirectCost;
      reply = isEn
        ? `Markup & Risk Guidance for "${data.projectName}" (Current Direct Cost: ${baseDirect.toLocaleString()} SAR):\n• Competitive Bid (~21% total load): ~${Math.round(baseDirect * 1.21).toLocaleString()} SAR before VAT\n• Balanced Commercial Bid (~28% total load: 10% Indirect + 5% G&A + 3% Risk + 10% Profit): ~${Math.round(baseDirect * 1.28).toLocaleString()} SAR before VAT`
        : `توصية الهوامش والمخاطر لمشروع "${data.projectName}" (التكلفة المباشرة الحالية: ${Math.round(baseDirect).toLocaleString()} ر.س):\n• عرض تنافسي (~21% تحميل إجمالي): قرابة ${Math.round(baseDirect * 1.21).toLocaleString()} ر.س قبل الضريبة.\n• عرض متوازن (~28% تحميل: 10% غير مباشر + 5% إداري + 3% مخاطر + 10% ربح): قرابة ${Math.round(baseDirect * 1.28).toLocaleString()} ر.س قبل الضريبة.`;
    } else {
      const divCounts = new Map<string, number>();
      for (const item of boundedItems) {
        const code = csiDivisionCode(item.item_no) || "00";
        divCounts.set(code, (divCounts.get(code) ?? 0) + 1);
      }
      const topDivs = Array.from(divCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([code, count]) => `DIV ${code} (${count})`)
        .join("، ");

      reply = isEn
        ? `Server Analysis Summary for "${data.projectName}":\n• Items: ${boundedItems.length} (${unpriced.length} unpriced)\n• Direct Cost Loaded: ${Math.round(data.totalDirectCost).toLocaleString()} SAR\n• Major CSI Divisions: ${topDivs || "N/A"}`
        : `ملخص التدقيق الخادمي لمشروع "${data.projectName}":\n• إجمالي البنود: ${boundedItems.length} بنداً (منها ${unpriced.length} بدون تحليل سعر).\n• إجمالي التكلفة المباشرة المسجلة: ${Math.round(data.totalDirectCost).toLocaleString()} ر.س.\n• أبرز أقسام CSI: ${topDivs || "غير مصنف"}.`;
    }

    return {
      reply,
      provider: "taqdiri-server-engine",
      generatedAt: new Date().toISOString(),
    };
  });
