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
import { Search, ShoppingBag, Plus, Check } from "lucide-react";
import { fmtSAR, fmtNumber } from "@/lib/format";
import { toast } from "sonner";
import { roundTo } from "@/lib/estimation-calc";
import { csiDivisionCode, csiDivisionLabel } from "@/lib/csi-divisions";
import type { Database } from "@/integrations/supabase/types";

type Resource = Database["public"]["Tables"]["resources"]["Row"] & {
  name_en?: string | null;
  division?: string | null;
};
type ResourceType = Database["public"]["Enums"]["resource_type"];

interface SelectQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boqItemId: string;
  projectId: string | null;
  defaultType?: ResourceType;
}

export function SelectQuoteDialog({
  open,
  onOpenChange,
  boqItemId,
  projectId,
  defaultType = "material",
}: SelectQuoteDialogProps) {
  const qc = useQueryClient();
  const [selectedType, setSelectedType] = useState<ResourceType>(defaultType);
  const [search, setSearch] = useState("");
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);

  // Consumption and conversion parameters per plan §3 & §5
  const [materialCategory, setMaterialCategory] = useState<"primary" | "accessory">("primary");
  const [packagePrice, setPackagePrice] = useState<number>(0);
  const [packageSize, setPackageSize] = useState<number>(1);
  const [consumptionRate, setConsumptionRate] = useState<number>(1);
  const [wastePct, setWastePct] = useState<number>(0);
  const [note, setNote] = useState("");

  const { data: resources = [], isLoading } = useQuery({
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

  const filteredResources = useMemo(() => {
    return resources.filter((r) => {
      if (selectedType && r.type !== selectedType) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.name_ar.toLowerCase().includes(q) ||
        (r.name_en && r.name_en.toLowerCase().includes(q)) ||
        (r.code && r.code.toLowerCase().includes(q)) ||
        (r.supplier_name && r.supplier_name.toLowerCase().includes(q))
      );
    });
  }, [resources, selectedType, search]);

  const handleSelectResource = (res: Resource) => {
    setSelectedResource(res);
    setPackagePrice(Number(res.unit_price) || 0);
    setPackageSize(1);
    setConsumptionRate(1);
    setWastePct(0);
    setNote(res.notes || "");
  };

  // Preview unit cost calculation per plan §5:
  // cost per package unit = packagePrice / packageSize
  // effective qty = consumptionRate * (1 + wastePct / 100)
  // unit direct cost = effective qty * (packagePrice / packageSize)
  const unitRate = packageSize > 0 ? packagePrice / packageSize : packagePrice;
  const effectiveQty = roundTo(consumptionRate * (1 + (wastePct || 0) / 100), 4);
  const previewDirectCost = roundTo(effectiveQty * unitRate, 2);

  const insertMut = useMutation({
    mutationFn: async () => {
      if (!selectedResource) throw new Error("اختر مورداً أولاً");
      const { data: u } = await estimationClient.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");

      const { data: existingItems = [] } = await estimationClient
        .from("price_analysis_items")
        .select("sort_order")
        .eq("boq_item_id", boqItemId);
      const maxSort = (existingItems as any[]).reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0);

      const cell_styles = {
        material_category: selectedResource.type === "material" ? materialCategory : undefined,
        quote_id: selectedResource.id,
        quote_code: selectedResource.code,
        original_price: selectedResource.unit_price,
        supplier: selectedResource.supplier_name,
        consumption_rate: consumptionRate,
        waste_pct: wastePct,
        package_size: packageSize,
        package_price: packagePrice,
        note: note.trim() || undefined,
      };

      const desc = selectedResource.supplier_name
        ? `${selectedResource.name_ar} (${selectedResource.supplier_name})`
        : selectedResource.name_ar;

      const { error } = await estimationClient.from("price_analysis_items").insert({
        boq_item_id: boqItemId,
        user_id: userId,
        project_id: projectId,
        resource_id: selectedResource.id,
        resource_type: selectedResource.type,
        description_ar: desc,
        description_en: selectedResource.name_en || null,
        unit: selectedResource.unit || "وحدة",
        quantity: effectiveQty,
        unit_price: roundTo(unitRate, 2),
        sort_order: maxSort + 1,
        cell_styles: cell_styles as any,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم إدراج المورد من عرض السعر بنجاح");
      qc.invalidateQueries({ queryKey: ["pa_items", boqItemId] });
      onOpenChange(false);
      setSelectedResource(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            استدعاء مورد من عروض الأسعار
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="ابحث بالاسم، الكود، أو اسم المورد…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-8 text-xs"
              />
            </div>
            <Select
              value={selectedType}
              onValueChange={(v) => {
                setSelectedType(v as ResourceType);
                setSelectedResource(null);
              }}
            >
              <SelectTrigger className="w-[140px] text-xs">
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

          {/* Resources List */}
          <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border/50 text-xs">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">جاري تحميل عروض الأسعار…</div>
            ) : filteredResources.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                لا توجد موارد مسجلة مطابقة للبحث في هذا المشروع.
              </div>
            ) : (
              filteredResources.map((res) => {
                const isSelected = selectedResource?.id === res.id;
                return (
                  <div
                    key={res.id}
                    onClick={() => handleSelectResource(res)}
                    className={`flex items-center justify-between p-2.5 cursor-pointer transition-colors hover:bg-muted/30 ${
                      isSelected ? "bg-primary/10 border-s-4 border-s-primary" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground flex items-center gap-2">
                        {res.name_ar}
                        {res.code && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {res.code}
                          </Badge>
                        )}
                        {res.division && (
                          <span className="text-[10px] text-muted-foreground">
                            [{csiDivisionCode(res.division)}]
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {res.supplier_name ? `المورد: ${res.supplier_name}` : "—"} · الوحدة: {res.unit}
                      </div>
                    </div>
                    <div className="text-start shrink-0 ms-3">
                      <div className="font-bold text-primary">{fmtSAR(Number(res.unit_price) || 0)}</div>
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

          {/* Selected Resource Consumption & Conversion Form */}
          {selectedResource && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3 text-xs">
              <div className="font-semibold text-primary flex items-center justify-between">
                <span>تحديد مواصفات الاستهلاك للبند: {selectedResource.name_ar}</span>
                <span className="text-[11px] text-muted-foreground">
                  السعر التجاري: {fmtSAR(Number(selectedResource.unit_price))} / {selectedResource.unit}
                </span>
              </div>

              {selectedResource.type === "material" && (
                <div className="flex items-center gap-4">
                  <Label className="text-xs">تصنيف المادة:</Label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="matCat"
                      checked={materialCategory === "primary"}
                      onChange={() => setMaterialCategory("primary")}
                      className="accent-primary"
                    />
                    <span>مادة أساسية</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="matCat"
                      checked={materialCategory === "accessory"}
                      onChange={() => setMaterialCategory("accessory")}
                      className="accent-primary"
                    />
                    <span>إكسسوار / مستهلكات</span>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">سعر العبوة / الشراء (ر.س)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={packagePrice}
                    onChange={(e) => setPackagePrice(Number(e.target.value) || 0)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">حجم العبوة (بالوحدة)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={packageSize}
                    onChange={(e) => setPackageSize(Number(e.target.value) || 1)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">الاستهلاك الصافي / وحدة</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={consumptionRate}
                    onChange={(e) => setConsumptionRate(Number(e.target.value) || 0)}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">نسبة الهالك %</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={wastePct}
                    onChange={(e) => setWastePct(Number(e.target.value) || 0)}
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

              {/* Calculated Preview */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-primary/10 text-xs">
                <div>
                  سعر وحدة الاستهلاك: <strong>{fmtSAR(unitRate)}</strong> · الكمية الفعلية مع الهالك:{" "}
                  <strong>{effectiveQty}</strong> {selectedResource.unit}
                </div>
                <div className="font-bold text-primary">
                  تكلفة مباشرة لوحدة البند: {fmtSAR(previewDirectCost)}
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
            disabled={!selectedResource || insertMut.isPending}
            onClick={() => insertMut.mutate()}
          >
            {insertMut.isPending ? "جاري الإدراج…" : "إدراج المورد في التحليل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
