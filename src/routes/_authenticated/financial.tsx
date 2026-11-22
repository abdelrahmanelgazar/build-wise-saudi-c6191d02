import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/coming-soon";

export const Route = createFileRoute("/_authenticated/financial")({
  head: () => ({ meta: [{ title: 'المراجعة المالية — تقديري' }, { name: "description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:title", content: 'المراجعة المالية — تقديري' }, { property: "og:description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: () => (
    <ComingSoon
      title="المراجعة المالية"
      description="ملخص شامل قبل تسليم العطاء: التكلفة المباشرة وغير المباشرة، المخاطر، الربح، وضريبة القيمة المضافة 15%."
    />
  ),
});
