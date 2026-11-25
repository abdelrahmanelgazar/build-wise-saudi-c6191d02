import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { estimationClient } from "@/lib/estimation-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ShoppingBag, Check } from "lucide-react";
import { fmtSAR } from "@/lib/format";
import { toast } from "sonner";
import { roundTo } from "@/lib/estimation-calc";
import { csiDivisionCode } from "@/lib/csi-divisions";
import {
  convertQuoteToAnalysisLine,
  SCOPE_LABELS_AR,
  type AssemblyScopeTag,
  type RateKind,
} from "@/lib/csi-assemblies-engine";
import { syncBoqItemBreakdownFromPa } from "@/lib/pa-sync";
import type { Database } from "@/integrations/supabase/types";

type Resource = Database["public"]["Tables"]["resources"]["Row"] & {
  name_en?: string | null;
  division?: string | null;
};
type SupplierQuote = Database["public"]["Tables"]["supplier_quotes"]["Row"];
type SupplierQuoteItem = Database["public"]["Tables"]["supplier_quote_items"]["Row"];
type ResourceType = Database["public"]["Enums"]["resource_type"];

interface SelectQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boqItemId: string;
  projectId: string | null;
  defaultType?: ResourceType;
}

type CandidateEntry =
  | {
      sourceKind: "supplier_quote";
      key: string;
      title: string;
      subtitle: string;
      resourceType: ResourceType;
      resourceId: string | null;
      supplierQuoteId: string;
      quoteItemId: string;
      quoteVersion: number;
      quoteStatus: string;
      supplierName: string;
      code: string | null;
      unit: string;
      packagePrice: number;
      packageSize: number;
      wastePct: number;
      scopeTag: AssemblyScopeTag;
      minOrderCharge: number;
      minOrderQty: number;
      notes: string;
    }
  | {
      sourceKind: "resource";
      key: string;
      title: string;
      subtitle: string;
      resourceType: ResourceType;
      resourceId: string;
      supplierQuoteId: null;
      quoteItemId: null;
      quoteVersion: null;
      quoteStatus: "reference";
      supplierName: string;
      code: string | null;
      unit: string;
      packagePrice: number;
      packageSize: number;
      wastePct: number;
      scopeTag: AssemblyScopeTag;
      minOrderCharge: number;
      minOrderQty: number;
      notes: string;
    };

export function SelectQuoteDialog({
  open,
  onOpenChange,
  boqItemId,
  projectId,
  defaultType = "material",
}: SelectQuoteDialogProps) {
  const qc = useQueryClient();
  const [sourceTab, setSourceTab] = useState<"all" | "supplier_quote" | "resource">("all");
  const [selectedType, setSelectedType] = useState<ResourceType>(defaultType);
  const [search, setSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateEntry | null>(null);

  // Consumption, conversion, single-waste & scope parameters per CSI plan §4.1 & §5
  const [materialCategory, setMaterialCategory] = useState<"primary" | "accessory">("primary");
  const [scopeTag, setScopeTag] = useState<AssemblyScopeTag>("general");
  const [rateKind, setRateKind] = useState<RateKind>("supply");
  const [packagePrice, setPackagePrice] = useState<number>(0);
  const [packageSize, setPackageSize] = useState<number>(1);
  const [consumptionUnit, setConsumptionUnit] = useState<string>("م³");
  const [thicknessMeters, setThicknessMeters] = useState<number>(0);
  const [consumptionRate, setConsumptionRate] = useState<number>(1);
  const [wastePct, setWastePct] = useState<number>(0);
  const [pourVolume, setPourVolume] = useState<number>(0);
  const [minOrderCharge, setMinOrderCharge] = useState<number>(0);
  const [isSplitPour, setIsSplitPour] = useState<boolean>(false);
  const [allocatedQty, setAllocatedQty] = useState<number>(0);
  const [note, setNote] = useState("");

  const { data: resources = [], isLoading: loadingRes } = useQuery({
    queryKey: ["quote_resources", projectId],
    enabled: open && !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("resources")
        .select("*")
        .eq("project_id", projectId!)
        .order("name_ar");
      if (error) throw error;
      return (data as Resource[]) ?? [];
    },
  });

  const { data: supplierQuotes = [], isLoading: loadingQuotes } = useQuery({
    queryKey: ["supplier_quotes_dialog", projectId],
    enabled: open && !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("supplier_quotes")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data as SupplierQuote[]) ?? [];
    },
  });

  const { data: quoteItems = [] } = useQuery({
    queryKey: ["supplier_quote_items_dialog", supplierQuotes.map((q) => q.id).join(",")],
    enabled: open && supplierQuotes.length > 0,
    queryFn: async () => {
      const quoteIds = supplierQuotes.map((q) => q.id);
      const { data, error } = await estimationClient
        .from("supplier_quote_items")
        .select("*");
      if (error) return [];
      return ((data as SupplierQuoteItem[]) ?? []).filter((it) => quoteIds.includes(it.quote_id));
    },
  });

  const candidates = useMemo<CandidateEntry[]>(() => {
    const quoteById = new Map(supplierQuotes.map((q) => [q.id, q]));
    const quoteEntries: CandidateEntry[] = quoteItems.map((qi) => {
      const parentQuote = quoteById.get(qi.quote_id);
      const effectivePrice = Number(qi.pack_price) > 0 ? Number(qi.pack_price) : Number(qi.unit_price);
      const effectivePack = Number(qi.pack_size) > 0 ? Number(qi.pack_size) : 1;
      const inferredScope = (qi.scope_tag as AssemblyScopeTag) || "concrete_supply";
      return {
        sourceKind: "supplier_quote",
        key: `qi:${qi.id}`,
        title: qi.specification,
        subtitle: `عرض #${parentQuote?.quote_no ?? "—"} (v${parentQuote?.version_no ?? 1}) · ${parentQuote?.supplier_name ?? "مورد"} · ${parentQuote?.city ?? "الرياض"}`,
        resourceType: selectedType,
        resourceId: qi.resource_id ?? null,
        supplierQuoteId: qi.quote_id,
        quoteItemId: qi.id,
        quoteVersion: parentQuote?.version_no ?? 1,
        quoteStatus: parentQuote?.status ?? "quoted",
        supplierName: parentQuote?.supplier_name ?? "",
        code: parentQuote?.quote_no ?? null,
        unit: qi.pricing_unit,
        packagePrice: effectivePrice,
        packageSize: effectivePack,
        wastePct: Number(qi.waste_pct ?? 0),
        scopeTag: inferredScope,
        minOrderCharge: Number(qi.min_order_charge ?? 0),
        minOrderQty: Number(qi.min_order_qty ?? 0),
        notes: qi.terms ?? "",
      };
    });

    const resourceEntries: CandidateEntry[] = resources
      .filter((r) => r.type === selectedType)
      .map((r) => ({
        sourceKind: "resource",
        key: `res:${r.id}`,
        title: r.name_ar,
        subtitle: `${r.supplier_name ? `المورد: ${r.supplier_name} · ` : ""}الوحدة: ${r.unit}${r.division ? ` · [${csiDivisionCode(r.division)}]` : ""}`,
        resourceType: r.type,
        resourceId: r.id,
        supplierQuoteId: null,
        quoteItemId: null,
        quoteVersion: null,
        quoteStatus: "reference",
        supplierName: r.supplier_name ?? "",
        code: r.code ?? null,
        unit: r.unit,
        packagePrice: Number(r.unit_price) || 0,
        packageSize: 1,
        wastePct: 0,
        scopeTag:
          r.type === "equipment"
            ? "pumping"
            : r.type === "labor"
              ? "pouring_compaction"
              : r.type === "subcontractor"
                ? "formwork"
                : "general",
        minOrderCharge: 0,
        minOrderQty: 0,
        notes: r.notes ?? "",
      }));

    const combined =
      sourceTab === "supplier_quote"
        ? quoteEntries
        : sourceTab === "resource"
          ? resourceEntries
          : [...quoteEntries, ...resourceEntries];

    if (!search.trim()) return combined;
    const q = search.toLowerCase();
    return combined.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        (c.code && c.code.toLowerCase().includes(q)) ||
        c.supplierName.toLowerCase().includes(q),
    );
  }, [quoteItems, supplierQuotes, resources, selectedType, sourceTab, search]);

  const handleSelectCandidate = (c: CandidateEntry) => {
    setSelectedCandidate(c);
    setPackagePrice(c.packagePrice);
    setPackageSize(c.packageSize);
    setConsumptionUnit(c.unit || "م³");
    setConsumptionRate(1);
    setWastePct(c.wastePct);
    setMinOrderCharge(c.minOrderCharge);
    setScopeTag(c.scopeTag);
    setRateKind(c.sourceKind === "supplier_quote" ? "supply" : "reference");
    setNote(c.notes);
  };

  // Single-waste normalized calculation + unit conversion + pump/min-order charge allocation
  const conversion = useMemo(
    () =>
      convertQuoteToAnalysisLine({
        packagePrice,
        packageSize,
        consumptionRate,
        wastePct,
        quoteUnit: selectedCandidate?.unit ?? consumptionUnit,
        consumptionUnit,
        ...(thicknessMeters > 0 ? { thicknessMeters } : {}),
        ...(minOrderCharge > 0 ? { minOrderCharge } : {}),
        ...(pourVolume > 0 ? { pourVolume } : {}),
        bakeWasteIntoQty: false,
      }),
    [packagePrice, packageSize, consumptionRate, wastePct, selectedCandidate, consumptionUnit, thicknessMeters, minOrderCharge, pourVolume],
  );

  const insertMut = useMutation({
    mutationFn: async () => {
      if (!selectedCandidate) throw new Error("اختر عرض سعر أو مورداً أولاً");
      const { data: u } = await estimationClient.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");

      const { data: existingItems = [] } = await estimationClient
        .from("price_analysis_items")
        .select("sort_order")
        .eq("boq_item_id", boqItemId);
      const maxSort = (existingItems as any[]).reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0);

      const cell_styles = {
        material_category: selectedCandidate.resourceType === "material" ? materialCategory : undefined,
        quote_code: selectedCandidate.code,
        supplier: selectedCandidate.supplierName,
        supplier_quote_id: selectedCandidate.supplierQuoteId,
        quote_item_id: selectedCandidate.quoteItemId,
        quote_status: selectedCandidate.quoteStatus,
        scope_tag: scopeTag,
        rate_kind: rateKind,
        consumption_rate: conversion.netConsumptionQty,
        waste_pct: conversion.appliedWastePct,
        unit_conversion_factor: conversion.unitConversionFactor,
        package_size: packageSize,
        package_price: packagePrice,
        min_order_charge: minOrderCharge > 0 ? minOrderCharge : undefined,
        is_split_pour: isSplitPour || undefined,
        allocated_qty: isSplitPour && allocatedQty > 0 ? allocatedQty : undefined,
        note: note.trim() || undefined,
      };

      const desc = selectedCandidate.supplierName
        ? `${selectedCandidate.title} (${selectedCandidate.supplierName})`
        : selectedCandidate.title;

      const { error } = await estimationClient.from("price_analysis_items").insert({
        boq_item_id: boqItemId,
        user_id: userId,
        project_id: projectId,
        resource_id: selectedCandidate.resourceId,
        supplier_quote_id: selectedCandidate.supplierQuoteId,
        quote_item_id: selectedCandidate.quoteItemId,
        quote_id: selectedCandidate.supplierQuoteId,
        quote_version: selectedCandidate.quoteVersion,
        scope_tag: scopeTag,
        rate_kind: rateKind,
        resource_type: selectedCandidate.resourceType,
        material_category: selectedCandidate.resourceType === "material" ? materialCategory : null,
        description_ar: desc,
        unit: consumptionUnit || selectedCandidate.unit || "وحدة",
        copied_unit: selectedCandidate.unit || "وحدة",
        copied_unit_price: roundTo(conversion.effectiveUnitPriceWithMinCharge, 4),
        consumption_rate: conversion.netConsumptionQty,
        waste_pct: conversion.appliedWastePct,
        quantity: conversion.netConsumptionQty,
        unit_price: roundTo(conversion.effectiveUnitPriceWithMinCharge, 2),
        line_note: note.trim() || null,
        sort_order: maxSort + 1,
        cell_styles: cell_styles as any,
      });

      if (error) throw error;
      await syncBoqItemBreakdownFromPa(boqItemId);
    },
    onSuccess: () => {
      toast.success("تم إدراج البند بربط عرض السعر وتحويل الوحدة بنجاح");
      qc.invalidateQueries({ queryKey: ["pa_items", boqItemId] });
      qc.invalidateQueries({ queryKey: ["pa_items_project", projectId] });
      qc.invalidateQueries({ queryKey: ["boq_items"] });
      onOpenChange(false);
      setSelectedCandidate(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isLoading = loadingRes || loadingQuotes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            استدعاء من عروض الموردين ومكتبة الموارد (مع تحويل الوحدات والنطاق)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Source Toggle & Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              {(
                [
                  ["all", "الكل"],
                  ["supplier_quote", `عروض الموردين (${quoteItems.length})`],
                  ["resource", `الموارد (${resources.length})`],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    setSourceTab(val);
                    setSelectedCandidate(null);
                  }}
                  className={`px-2.5 py-1 rounded ${
                    sourceTab === val ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ابحث بالاسم، رقم العرض، أو اسم المورد…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-8 text-xs"
              />
            </div>

            <Select
              value={selectedType}
              onValueChange={(v) => {
                setSelectedType(v as ResourceType);
                setSelectedCandidate(null);
              }}
            >
              <SelectTrigger className="w-[135px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="material">المواد</SelectItem>
                <SelectItem value="labor">العمالة</SelectItem>
                <SelectItem value="equipment">المعدات</SelectItem>
                <SelectItem value="subcontractor">مقاولو الباطن</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Candidate List */}
          <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border/50 text-xs">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">جاري تحميل عروض الأسعار…</div>
            ) : candidates.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                لا توجد عروض أسعار أو موارد مطابقة للبحث في هذا المشروع.
              </div>
            ) : (
              candidates.map((cand) => {
                const isSelected = selectedCandidate?.key === cand.key;
                const unitPrice = cand.packageSize > 0 ? cand.packagePrice / cand.packageSize : cand.packagePrice;
                return (
                  <div
                    key={cand.key}
                    onClick={() => handleSelectCandidate(cand)}
                    className={`flex items-center justify-between p-2.5 cursor-pointer transition-colors hover:bg-muted/30 ${
                      isSelected ? "bg-primary/10 border-s-4 border-s-primary" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground flex flex-wrap items-center gap-1.5">
                        <span>{cand.title}</span>
                        <Badge
                          variant={cand.sourceKind === "supplier_quote" ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {cand.sourceKind === "supplier_quote" ? "عرض مورد" : "مرجع مورد"}
                        </Badge>
                        {cand.quoteStatus === "expired" && (
                          <Badge variant="destructive" className="text-[10px]">
                            منتهي الصلاحية
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">{cand.subtitle}</div>
                    </div>
                    <div className="text-start shrink-0 ms-3">
                      <div className="font-bold text-primary">
                        {fmtSAR(unitPrice)} / {cand.unit}
                      </div>
                      {isSelected && (
                        <Badge className="bg-primary text-primary-foreground text-[10px] mt-0.5">
                          <Check className="h-2.5 w-2.5 me-1" /> تم الاختيار
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Consumption, Unit Conversion & Scope Form */}
          {selectedCandidate && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3 text-xs">
              <div className="font-semibold text-primary flex flex-wrap items-center justify-between gap-2">
                <span>تحديد الاستهلاك والنطاق والتحويل للبند: {selectedCandidate.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  وحدة العرض: {selectedCandidate.unit} · معامل التحويل: {conversion.unitConversionFactor}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">النطاق الهندسي (Scope Tag)</Label>
                  <Select value={scopeTag} onValueChange={(v) => setScopeTag(v as AssemblyScopeTag)}>
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SCOPE_LABELS_AR).map(([key, label]) => (
                        <SelectItem key={key} value={key} className="text-xs">
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-[11px] text-muted-foreground">تصنيف السعر</Label>
                  <Select value={rateKind} onValueChange={(v) => setRateKind(v as RateKind)}>
                    <SelectTrigger className="h-8 text-xs mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supply">توريد (Supply)</SelectItem>
                      <SelectItem value="install">مصنعية / تركيب (Install)</SelectItem>
                      <SelectItem value="composite">مركّب شامل (Composite)</SelectItem>
                      <SelectItem value="reference">مرجعي استرشادي (Reference)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedCandidate.resourceType === "material" && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">تصنيف المادة</Label>
                    <div className="flex items-center gap-3 mt-2">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="matCat"
                          checked={materialCategory === "primary"}
                          onChange={() => setMaterialCategory("primary")}
                        />
                        <span>أساسية</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="matCat"
                          checked={materialCategory === "accessory"}
                          onChange={() => setMaterialCategory("accessory")}
                        />
                        <span>إكسسوار</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">سعر العبوة / العرض (ر.س)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={packagePrice}
                    onChange={(e) => setPackagePrice(Number(e.target.value) || 0)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">حجم العبوة</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={packageSize}
                    onChange={(e) => setPackageSize(Number(e.target.value) || 1)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">وحدة التحليل (م³ / كجم / م²)</Label>
                  <Input
                    value={consumptionUnit}
                    onChange={(e) => setConsumptionUnit(e.target.value)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">الاستهلاك الصافي / وحدة بند</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={consumptionRate}
                    onChange={(e) => setConsumptionRate(Number(e.target.value) || 0)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">نسبة الهالك % (تُطبَّق مرة واحدة)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={wastePct}
                    onChange={(e) => setWastePct(Number(e.target.value) || 0)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">السمك م (لتحويل م² ↔ م³)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={thicknessMeters || ""}
                    placeholder="اختياري مثل 0.15"
                    onChange={(e) => setThicknessMeters(Number(e.target.value) || 0)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">حد أدنى للمضخة/الطلب (ر.س)</Label>
                  <Input
                    type="number"
                    step="10"
                    value={minOrderCharge || ""}
                    placeholder="0"
                    onChange={(e) => setMinOrderCharge(Number(e.target.value) || 0)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">حجم الصب لتوزيع الحد الأدنى</Label>
                  <Input
                    type="number"
                    step="1"
                    value={pourVolume || ""}
                    placeholder="مثلاً 30 م³"
                    onChange={(e) => setPourVolume(Number(e.target.value) || 0)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>

              <div>
                <Label className="text-[11px] text-muted-foreground">ملاحظات على السطر</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="ملاحظات المواصفة أو التوريد…"
                  className="h-8 text-xs mt-1"
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-primary/10">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSplitPour}
                    onChange={(e) => setIsSplitPour(e.target.checked)}
                  />
                  <span>تجزئة التوريد/الصب بين أكثر من مورد (Split-Pour)</span>
                </label>
                {isSplitPour && (
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-muted-foreground">الكمية المخصصة لهذا المورد:</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={allocatedQty || ""}
                      onChange={(e) => setAllocatedQty(Number(e.target.value) || 0)}
                      placeholder="مثلاً 60"
                      className="h-7 w-28 text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Calculated Preview */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-primary/10 text-xs">
                <div>
                  سعر الوحدة المحوّل: <strong>{fmtSAR(conversion.effectiveUnitPriceWithMinCharge)}</strong> ·
                  الصافي: <strong>{conversion.netConsumptionQty}</strong> + هالك{" "}
                  <strong>{conversion.appliedWastePct}%</strong> = فعلي{" "}
                  <strong>{conversion.grossEffectiveQty}</strong>
                </div>
                <div className="font-bold text-primary">
                  تكلفة مباشرة لوحدة البند: {fmtSAR(conversion.directCostPerBoqUnit)}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            size="sm"
            disabled={!selectedCandidate || insertMut.isPending}
            onClick={() => insertMut.mutate()}
          >
            {insertMut.isPending ? "جاري الإدراج…" : "إدراج المورد في التحليل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
