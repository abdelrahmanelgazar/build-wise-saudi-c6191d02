import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/coming-soon";
import { useLanguage } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/financial")({
  component: FinancialPage,
});

function FinancialPage() {
  const { t } = useLanguage();
  return (
    <ComingSoon
      title={t("nav.financial")}
      description={t("comingSoon.financialDesc")}
    />
  );
}
