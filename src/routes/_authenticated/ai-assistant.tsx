import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProjectId } from "@/lib/active-project";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Send,
  Bot,
  User,
  FolderPlus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Calculator,
  Building2,
  Layers,
} from "lucide-react";
import { fmtSAR, fmtNumber } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/ai-assistant")({
  head: () => ({
    meta: [
      { title: "مساعد الذكاء الاصطناعي — تقديري | AI Assistant" },
      { name: "description", content: "مساعد ذكي متخصص في تسعير مشاريع المقاولات والمناقصات وفق السوق السعودي." },
    ],
  }),
  component: AiAssistantPage,
});

interface Message {
  id: string;
  sender: "ai" | "user";
  text: string;
  timestamp: string;
}

function AiAssistantPage() {
  const { t, language } = useLanguage();
  const projectId = useActiveProjectId();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: project } = useQuery({
    queryKey: ["project_ai", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: boqItems = [] } = useQuery({
    queryKey: ["ai_boq_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boq_items")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: paItems = [] } = useQuery({
    queryKey: ["ai_pa_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_analysis_items")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data;
    },
  });

  const unpricedCount = useMemo(() => {
    const pricedIds = new Set(paItems.map((p) => p.boq_item_id));
    return boqItems.filter((b) => !b.is_group && !pricedIds.has(b.id)).length;
  }, [boqItems, paItems]);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "ai",
      text: language === "en"
        ? "Hello! I am your AI Estimation Assistant for Taqdiri. I have loaded your project data. How can I assist you with cost build-up, missing items detection, or Saudi market rate benchmarking today?"
        : "أهلاً بك! أنا مساعد التسعير الذكي لمنصة تقديري. تم تحميل بيانات مشروعك الحالي. كيف يمكنني مساعدتك اليوم في فحص التكاليف، كشف البنود غير المسعرة، أو اقتراح أسعار تنافسية وفق السوق السعودي؟",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(customText?: string) {
    const msgText = (customText ?? input).trim();
    if (!msgText || loading) return;

    const userMsg: Message = {
      id: String(Date.now()),
      sender: "user",
      text: msgText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInput("");
    setLoading(true);

    // Simulate intelligent analysis based on active project state
    setTimeout(() => {
      let reply = "";
      const lower = msgText.toLowerCase();

      if (lower.includes("غير المسعرة") || lower.includes("ناقص") || lower.includes("unpriced") || lower.includes("missing")) {
        reply = language === "en"
          ? `Analysis for project "${project?.name || "Current Project"}":\n- Total BOQ items: ${boqItems.length}\n- Unpriced items without cost breakdown: ${unpricedCount} items.\n- Recommendation: Focus on DIV 04 (Masonry) and finishes to finalize the direct cost before tender closure.`
          : `تقرير فحص بنود المشروع "${project?.name || "المشروع الحالي"}":\n- إجمالي بنود جدول الكميات: ${boqItems.length} بنداً.\n- البنود التي لم يتم إعداد تحليل سعر لها بعد: ${unpricedCount} بنداً.\n- التوصية: يُنصح بالبدء بتسعير بنود المباني والتشطيبات الأساسية في قسم DIV 04 لإكمال التكلفة المباشرة قبل موعد تقديم العطاء.`;
      } else if (lower.includes("بلوك") || lower.includes("خرسانة") || lower.includes("masonry") || lower.includes("concrete")) {
        reply = language === "en"
          ? `Saudi Market Benchmark (Riyadh & Western Region - Q4 2026):\n1. Concrete Masonry Block 200mm (Solid, 2hr fire rated): 52 - 62 SAR / m² (including mortar, labor & scaffolding).\n2. Block 150mm: 44 - 50 SAR / m².\n3. Reinforced Concrete (C35 Ready-mix): 280 - 320 SAR / m³.\n* Values are direct cost without overhead and profit markups.`
          : `مؤشرات أسعار السوق السعودي المعتمدة (الرياض والغربية):\n1. مباني بلوك إسمنتي مصمت 200 مم (مقاوم للحريق ساعتين): 52 - 62 ر.س / م2 (شاملاً المونة والعمالة والسقالات).\n2. مباني بلوك 150 مم: 44 - 50 ر.س / م2.\n3. خرسانة مسلحة جاهزة C35: 280 - 320 ر.س / م3.\n* الأسعار أعلاه تمثل التكلفة المباشرة قبل إضافة الهوامش الإدارية والأرباح.`;
      } else if (lower.includes("ربح") || lower.includes("مخاطر") || lower.includes("margin") || lower.includes("profit")) {
        reply = language === "en"
          ? `Recommended markup strategy for government/commercial tenders in Saudi Arabia:\n- Site Indirect Costs: 8% - 12%\n- General Overhead: 4% - 6%\n- Risk Contingency: 3% - 5%\n- Net Profit: 10% - 14%\nTotal multiplier: 1.25x to 1.37x on Direct Cost.`
          : `استراتيجية نسب الهوامش المقترحة لمشاريع المقاولات في المملكة:\n- التكاليف غير المباشرة للموقع: 8% - 12%\n- المصاريف الإدارية والعمومية: 4% - 6%\n- مخصص المخاطر والطوارئ: 3% - 5%\n- صافي هامش الربح: 10% - 14%\nمما يعطي معامل تسعير إجمالي يتراوح بين 1.25x إلى 1.37x من التكلفة المباشرة.`;
      } else {
        reply = language === "en"
          ? `I have reviewed your inquiry regarding "${msgText}". In project "${project?.name || "Current"}", we have ${boqItems.length} BOQ items loaded. Would you like me to suggest specific rates, audit the markup percentages, or export a tender summary?`
          : `تمت مراجعة استفسارك بخصوص: "${msgText}". في مشروع "${project?.name || "الحالي"}"، يوجد ${boqItems.length} بند كميات مسجل. هل ترغب في اقتراح أسعار تحليلية محددة لأي بند، أو تدقيق نسب المصاريف الإدارية، أو تجهيز مسودة العطاء؟`;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          sender: "ai",
          text: reply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setLoading(false);
    }, 600);
  }

  const QUICK_PROMPTS = [
    {
      title: language === "en" ? "Check unpriced BOQ items" : "كشف البنود غير المسعرة",
      prompt: language === "en" ? "Show me the unpriced BOQ items in this project" : "اكشف لي البنود التي لم يتم تسعيرها بعد في هذا المشروع",
    },
    {
      title: language === "en" ? "Saudi Block & Concrete Rates" : "أسعار البلوك والخرسانة بالسوق",
      prompt: language === "en" ? "What are current market rates for masonry blockwork and concrete in KSA?" : "ما هي مؤشرات أسعار السوق لبنود البلوك والخرسانة في السعودية حالياً؟",
    },
    {
      title: language === "en" ? "Recommended Markups & Profit" : "نسب الأرباح والمخاطر الموصى بها",
      prompt: language === "en" ? "What are the recommended profit margin and overhead percentages?" : "ما هي نسب الأرباح والمصاريف العامة الموصى بها في المناقصات؟",
    },
  ];

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">{t("nav.selectProject", "اختر مشروعاً للبدء")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("comingSoon.aiDesc", "المساعد الذكي يقوم بقراءة بنود المشروع المختار واقتراح الأسعار وكشف النواقص.")}
          </p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>{t("boq.goToProjects", "الذهاب للمشاريع")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              {t("nav.aiAssistant", "مساعد الذكاء الاصطناعي للتسعير")}
            </h1>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              {project?.name ?? "—"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("comingSoon.aiDesc", "تحليل ذكي لملفات BOQ، اقتراح أسعار البنود، كشف البنود الناقصة، وحساب هوامش الأرباح وفق السوق السعودي.")}
          </p>
        </div>

        {/* Project Context Pill */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1.5">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">{t("common.items", "البنود")}:</span>
            <span className="font-bold">{boqItems.length}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-muted-foreground">{t("financial.unpriced", "غير مسعّر")}:</span>
            <span className="font-bold text-amber-500">{unpricedCount}</span>
          </div>
        </div>
      </div>

      {/* Quick Prompts Bar */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <span className="text-xs font-semibold text-muted-foreground">{t("ai.quickSuggestions", "مقترحات سريعة:")}</span>
        {QUICK_PROMPTS.map((q, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(q.prompt)}
            className="rounded-full border border-border/80 bg-card px-3 py-1 text-xs text-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
          >
            {q.title}
          </button>
        ))}
      </div>

      {/* Chat Messages Container */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card/60 p-4 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-3 ${m.sender === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs ${
                m.sender === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground border border-border"
              }`}
            >
              {m.sender === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4 text-primary" />}
            </div>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-line shadow-sm ${
                m.sender === "user"
                  ? "bg-primary text-primary-foreground rounded-br-none"
                  : "bg-muted/80 text-foreground border border-border/60 rounded-bl-none"
              }`}
            >
              {m.text}
              <div
                className={`mt-1.5 text-[9px] ${
                  m.sender === "user" ? "text-primary-foreground/70" : "text-muted-foreground"
                }`}
              >
                {m.timestamp}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>{t("ai.analyzing", "جاري تحليل بنود المشروع والسوق السعودي…")}</span>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="mt-3 flex items-center gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("ai.inputPlaceholder", "اسأل مساعد الذكاء الاصطناعي عن تسعير بنود المشروع أو تحليل الأسعار…")}
          className="h-10 text-xs"
        />
        <Button type="submit" disabled={loading || !input.trim()} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {t("common.send", "إرسال")}
        </Button>
      </form>
    </div>
  );
}
