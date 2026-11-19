import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FolderPlus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "./resources";
import { useActiveProjectId } from "@/lib/active-project";
import { PaGrid } from "@/components/price-analysis/pa-grid";
import { useLanguage } from "@/lib/i18n";
import type { Database } from "@/integrations/supabase/types";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];

const searchSchema = z.object({ item: z.string().optional() });

export const Route = createFileRoute("/_authenticated/price-analysis")({
  head: () => ({ meta: [{ title: "تحليل الأسعار — تقديري" }] }),
  validateSearch: searchSchema,
  component: PriceAnalysisPage,
});

function PriceAnalysisPage() {
  const { item } = Route.useSearch();
  const navigate = Route.useNavigate();
  const projectId = useActiveProjectId();
  const { t, language } = useLanguage();
  const [selectedId, setSelectedId] = useState<string | null>(item ?? null);

  const { data: boqItems = [] } = useQuery({
    queryKey: ["boq_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boq_items")
        .select("*")
        .eq("project_id", projectId!)
        .eq("is_group", false)
        .order("sort_order")
        .order("item_no");
      if (error) throw error;
      return data as BoqRow[];
    },
  });

  useEffect(() => {
    if (!selectedId && boqItems.length > 0) setSelectedId(boqItems[0].id);
  }, [boqItems, selectedId]);

  useEffect(() => {
    if (item && item !== selectedId) setSelectedId(item);
  }, [item, selectedId]);

  const selected = boqItems.find((b) => b.id === selectedId) ?? null;

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">{t("pa.selectProjectPrompt")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("pa.selectProjectDesc")}
          </p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>{t("boq.goToProjects")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col p-4">
      <PageHeader
        title={t("pa.title")}
        subtitle={t("pa.subtitle")}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground">{t("pa.itemLabel")}</span>
        <Select
          value={selectedId ?? ""}
          onValueChange={(v) => {
            setSelectedId(v);
            navigate({ search: { item: v }, replace: true });
          }}
        >
          <SelectTrigger className="h-8 w-[420px] max-w-full text-xs">
            <SelectValue placeholder={t("pa.selectItemPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {boqItems.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {t("pa.noItemsInBoq")}
              </div>
            )}
            {boqItems.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <span className="font-mono text-[10px] text-muted-foreground">{b.item_no}</span>
                {" — "}
                {language === "en" && b.description_en ? b.description_en : b.description_ar}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {selected ? (
          <PaGrid boqItem={selected} key={selected.id} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("pa.selectItemPromptEmpty")}
          </div>
        )}
      </div>
    </div>
  );
}
