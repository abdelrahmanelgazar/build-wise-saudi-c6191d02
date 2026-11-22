import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/coming-soon";

export const Route = createFileRoute("/_authenticated/ai-assistant")({
  head: () => ({ meta: [{ title: 'مساعد الذكاء الاصطناعي — تقديري' }, { name: "description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:title", content: 'مساعد الذكاء الاصطناعي — تقديري' }, { property: "og:description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: () => (
    <ComingSoon
      title="مساعد الذكاء الاصطناعي"
      description="قراءة ملفات BOQ، اقتراح أسعار البنود، كشف البنود الناقصة، حساب الربح، وإنشاء تحليل الأسعار تلقائياً عبر Lovable AI."
    />
  ),
});
