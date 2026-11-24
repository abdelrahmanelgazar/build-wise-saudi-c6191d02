import { useMemo, useState } from "react";
import { Search, CheckCircle2, Clock, Layers, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  width?: number;
  onToggleCollapse?: () => void;
}

export function BoqSidebar({
  items,
  selectedId,
  onSelect,
  isLoading = false,
  onAddDemoItem,
  width,
  onToggleCollapse,
}: BoqSidebarProps) {
  const { t, language, direction } = useLanguage();
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
      const query = search.trim().toLowerCase();
      const matchSearch =
        !query ||
        item.item_no.toLowerCase().includes(query) ||
        item.description_ar.toLowerCase().includes(query) ||
        (item.description_en && item.description_en.toLowerCase().includes(query));

      if (!matchSearch) return false;

      if (sheetFilter !== "all" && item.sheet_name !== sheetFilter) {
        return false;
      }

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
    <aside
      style={width ? { width: `${width}px` } : undefined}
      className={cn(
        "flex h-full w-full flex-col border-border bg-card/60 shrink-0 select-none",
        direction === "rtl" ? "border-l" : "border-r"
      )}
    >
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
            {onToggleCollapse && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground hidden lg:flex"
                onClick={onToggleCollapse}
                title="طي قائمة البنود"
              >
                {direction === "rtl" ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
              </Button>
            )}
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
              <SelectTrigger className="h-7 w-[105px] text-[10px] px-1.5 shrink-0 bg-background/50 truncate">
                <SelectValue placeholder="الورقة" />
              </SelectTrigger>
              <SelectContent className="text-xs max-h-56">
                <SelectItem value="all">كل الأوراق</SelectItem>
                {sheets.map((s) => (
                  <SelectItem key={s} value={s} className="truncate text-xs">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Item List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/40 select-text">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
            جاري تحميل البنود…
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-xs text-muted-foreground">
              {items.length === 0
                ? "لا توجد بنود بعد في هذا المشروع."
                : "لا توجد نتائج مطابقة لخيارات التصفية."}
            </p>
            {items.length === 0 && onAddDemoItem && (
              <Button
                variant="outline"
                size="sm"
                onClick={onAddDemoItem}
                className="text-xs gap-1.5 mt-2"
              >
                + إضافة بند خرسانة تجريبي
              </Button>
            )}
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = item.id === selectedId;
            const hasPrice =
              (item.material_cost ?? 0) > 0 ||
              (item.labor_cost ?? 0) > 0 ||
              (item.equipment_cost ?? 0) > 0 ||
              (item.subcontractor_cost ?? 0) > 0;

            const directUnitCost =
              (item.material_cost ?? 0) +
              (item.labor_cost ?? 0) +
              (item.equipment_cost ?? 0) +
              (item.subcontractor_cost ?? 0);

            const descText =
              isEn && item.description_en ? item.description_en : item.description_ar;

            return (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className={cn(
                  "flex w-full flex-col gap-1 p-3 text-start transition-colors hover:bg-muted/30 focus-visible:outline-none",
                  isSelected
                    ? "bg-primary/10 border-s-2 border-primary"
                    : "bg-transparent"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold text-foreground">
                    {item.item_no}
                  </span>
                  <div className="flex items-center gap-1">
                    {hasPrice ? (
                      <span className="flex items-center gap-0.5 text-[10px] text-emerald-500 font-medium">
                        <CheckCircle2 className="h-3 w-3" />
                        {fmtSAR(directUnitCost, language)}
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {t("pa.statusUnpriced", "غير مسعّر")}
                      </span>
                    )}
                  </div>
                </div>

                <p className="line-clamp-2 text-xs leading-relaxed text-foreground/80 font-normal">
                  {descText}
                </p>

                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="truncate max-w-[130px]" title={item.sheet_name || ""}>
                    {item.sheet_name || "—"}
                  </span>
                  <span className="font-mono">
                    {fmtNumber(item.quantity, 2)} {item.unit || ""}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
