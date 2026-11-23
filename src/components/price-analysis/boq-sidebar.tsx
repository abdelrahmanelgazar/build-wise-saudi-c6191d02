import { useMemo, useState } from "react";
import { Search, CheckCircle2, Clock, Layers, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { fmtNumber, fmtSAR } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import type { Database } from "@/integrations/supabase/types";

type BoqRow = Database["public"]["Tables"]["boq_items"]["Row"];

interface BoqSidebarProps {
  items: BoqRow[];
  selectedId: string | null;
  onSelect: (item: BoqRow) => void;
  isLoading?: boolean;
  onAddDemoItem?: () => void;
}

export function BoqSidebar({
  items,
  selectedId,
  onSelect,
  isLoading = false,
  onAddDemoItem,
}: BoqSidebarProps) {
  const { t, language } = useLanguage();
  const isEn = language === "en";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "priced" | "unpriced">("all");
  const [sheetFilter, setSheetFilter] = useState<string>("all");

  // Distinct sheets
  const sheets = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.sheet_name) set.add(item.sheet_name);
    });
    return Array.from(set).sort();
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search check
      const query = search.trim().toLowerCase();
      const matchSearch =
        !query ||
        item.item_no.toLowerCase().includes(query) ||
        item.description_ar.toLowerCase().includes(query) ||
        (item.description_en && item.description_en.toLowerCase().includes(query));

      if (!matchSearch) return false;

      // Sheet check
      if (sheetFilter !== "all" && item.sheet_name !== sheetFilter) {
        return false;
      }

      // Priced status check
      const hasPrice =
        (item.material_cost ?? 0) > 0 ||
        (item.labor_cost ?? 0) > 0 ||
        (item.equipment_cost ?? 0) > 0 ||
        (item.subcontractor_cost ?? 0) > 0;

      if (statusFilter === "priced" && !hasPrice) return false;
      if (statusFilter === "unpriced" && hasPrice) return false;

      return true;
    });
  }, [items, search, statusFilter, sheetFilter]);

  const pricedCount = useMemo(() => {
    return items.filter(
      (i) =>
        (i.material_cost ?? 0) > 0 ||
        (i.labor_cost ?? 0) > 0 ||
        (i.equipment_cost ?? 0) > 0 ||
        (i.subcontractor_cost ?? 0) > 0
    ).length;
  }, [items]);

  return (
    <aside className="flex h-full w-full flex-col border-border bg-card/60 lg:w-[350px] lg:border-e shrink-0">
      {/* Header */}
      <div className="border-b border-border p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h2 className="text-xs font-semibold text-foreground">
              {t("pa.itemsSidebarTitle", "بنود جدول الكميات")}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
              {items.length} {t("common.items", "بنود")}
            </Badge>
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5 py-0 font-mono">
              {pricedCount} {t("pa.statusPriced", "مسعّر")}
            </Badge>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("nav.searchPlaceholder", "ابحث برقم البند أو الوصف…")}
            className="h-8 ps-8 text-xs bg-background/50"
          />
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-1.5">
          <Tabs
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as any)}
            className="flex-1"
          >
            <TabsList className="grid w-full grid-cols-3 h-7 p-0.5 bg-muted/60 text-[10px]">
              <TabsTrigger value="all" className="text-[10px] px-1 py-1">
                {t("common.all", "الكل")}
              </TabsTrigger>
              <TabsTrigger value="priced" className="text-[10px] px-1 py-1 text-emerald-500">
                {t("pa.statusPriced", "مسعّر")}
              </TabsTrigger>
              <TabsTrigger value="unpriced" className="text-[10px] px-1 py-1 text-muted-foreground">
                {t("pa.statusUnpriced", "غير مسعّر")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {sheets.length > 1 && (
            <Select value={sheetFilter} onValueChange={setSheetFilter}>
              <SelectTrigger className="h-7 w-[95px] text-[10px] px-1.5 shrink-0 bg-background/50">
                <SelectValue placeholder="الورقة" />
              </SelectTrigger>
              <SelectContent className="text-xs">
                <SelectItem value="all">كل الأوراق</SelectItem>
                {sheets.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {isLoading && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {t("common.loading", "جاري التحميل…")}
          </div>
        )}

        {!isLoading && filteredItems.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground space-y-3">
            <p>
              {items.length === 0
                ? t("pa.noItemsInBoq", "لا توجد بنود — أضف بنوداً في جدول الكميات أولاً.")
                : "لا توجد نتائج تطابق معايير البحث."}
            </p>
            {items.length === 0 && onAddDemoItem && (
              <Button
                variant="outline"
                size="sm"
                onClick={onAddDemoItem}
                className="w-full text-xs gap-1.5 border-dashed"
              >
                + إضافة بند خرسانة تجريبي
              </Button>
            )}
          </div>
        )}

        {!isLoading &&
          filteredItems.map((item) => {
            const isSelected = item.id === selectedId;
            const directCost =
              (item.material_cost ?? 0) +
              (item.labor_cost ?? 0) +
              (item.equipment_cost ?? 0) +
              (item.subcontractor_cost ?? 0);
            const isPriced = directCost > 0;
            const desc = isEn && item.description_en ? item.description_en : item.description_ar;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  "group w-full text-start rounded-lg border p-2.5 transition-all",
                  isSelected
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border/60 bg-card hover:border-border hover:bg-accent/40"
                )}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-mono text-[11px] font-bold text-foreground group-hover:text-primary">
                    {item.item_no}
                  </span>
                  {isPriced ? (
                    <Badge
                      variant="secondary"
                      className="h-4 gap-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-1 text-[10px] font-normal"
                    >
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      {fmtSAR(directCost, language)}/{item.unit || "وحدة"}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="h-4 gap-1 text-muted-foreground border-border/80 px-1 text-[10px] font-normal"
                    >
                      <Clock className="h-2.5 w-2.5" />
                      {t("pa.statusUnpriced", "غير مسعّر")}
                    </Badge>
                  )}
                </div>

                <p className="line-clamp-2 text-xs text-foreground/90 font-medium leading-relaxed">
                  {desc}
                </p>

                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                  <span>
                    {t("common.quantity", "الكمية")}:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {fmtNumber(item.quantity, 2)} {item.unit}
                    </span>
                  </span>
                  {item.sheet_name && (
                    <span className="truncate max-w-[100px] text-muted-foreground/80">
                      {item.sheet_name}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
      </div>
    </aside>
  );
}
