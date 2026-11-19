import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/layout/coming-soon";
import { useLanguage } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useLanguage();
  return (
    <ComingSoon
      title={t("nav.settings")}
      description={t("comingSoon.settingsDesc")}
    />
  );
}
