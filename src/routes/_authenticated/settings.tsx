import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/coming-soon";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: 'الإعدادات والصلاحيات — تقديري' }, { name: "description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:title", content: 'الإعدادات والصلاحيات — تقديري' }, { property: "og:description", content: 'منصة تقديري لتسعير المقاولات وإدارة المشاريع والمناقصات وتحليل الأسعار في السوق السعودي.' }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: () => (
    <ComingSoon
      title="الإعدادات والصلاحيات"
      description="إدارة المستخدمين والأدوار: مدير عام، مدير تسعير، مُسعّر، مُشاهد فقط (RBAC)."
    />
  ),
});
