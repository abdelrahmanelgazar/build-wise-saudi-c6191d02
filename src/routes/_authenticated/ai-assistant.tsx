import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/coming-soon";
import { useLanguage } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/ai-assistant")({
  component: AiAssistantPage,
});

function AiAssistantPage() {
  const { t } = useLanguage();
  return (
    <ComingSoon
      title={t("nav.aiAssistant")}
      description={t("comingSoon.aiDesc")}
    />
  );
}
