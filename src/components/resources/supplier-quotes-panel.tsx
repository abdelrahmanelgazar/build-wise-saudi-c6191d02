import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, FileText, Trash2, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { estimationClient } from "@/lib/estimation-client";
import { fmtSAR } from "@/lib/format";
import { SCOPE_LABELS_AR, type AssemblyScopeTag, type QuoteStatus } from "@/lib/csi-assemblies-engine";
import type { Database } from "@/integrations/supabase/types";

type SupplierQuote = Database["public"]["Tables"]["supplier_quotes"]["Row"];
type SupplierQuoteItem = Database["public"]["Tables"]["supplier_quote_items"]["Row"];
type ResourceRow = Database["public"]["Tables"]["resources"]["Row"];

export function SupplierQuotesPanel({
  projectId,
  resources,
}: {
  projectId: string;
  resources: ResourceRow[];
}) {
  const qc = useQueryClient();
  const [newQuoteOpen, setNewQuoteOpen] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [quoteNo, setQuoteNo] = useState("");
  const [city, setCity] = useState("الرياض");
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validityDate, setValidityDate] = useState("");
  const [status, setStatus] = useState<QuoteStatus>("quoted");
  const [vatIncluded, setVatIncluded] = useState(false);
  const [transportIncluded, setTransportIncluded] = useState(true);
  const [deliveryTerms, setDeliveryTerms] = useState("تسليم موقع المشروع");

  // New line item modal state
  const [addItemForQuoteId, setAddItemForQuoteId] = useState<string | null>(null);
  const [spec, setSpec] = useState("");
  const [pricingUnit, setPricingUnit] = useState("م³");
  const [packSize, setPackSize] = useState(1);
  const [packPrice, setPackPrice] = useState(0);
  const [wastePct, setWastePct] = useState(3);
  const [scopeTag, setScopeTag] = useState<AssemblyScopeTag>("concrete_supply");
  const [minOrderCharge, setMinOrderCharge] = useState(0);
  const [shiftHours, setShiftHours] = useState(8);
  const [linkedResourceId, setLinkedResourceId] = useState<string>("none");

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["supplier_quotes_project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await estimationClient
        .from("supplier_quotes")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as SupplierQuote[]) ?? [];
    },
  });

  const { data: quoteItems = [] } = useQuery({
    queryKey: ["supplier_quote_items_project", projectId, quotes.map((q) => q.id).join(",")],
    enabled: quotes.length > 0,
    queryFn: async () => {
      const ids = new Set(quotes.map((q) => q.id));
      const { data, error } = await estimationClient.from("supplier_quote_items").select("*");
      if (error) throw error;
      return ((data as SupplierQuoteItem[]) ?? []).filter((it) => ids.has(it.quote_id));
    },
  });

  const createQuoteMut = useMutation({
    mutationFn: async () => {
      if (!supplierName.trim()) throw new Error("أدخل اسم المورد / المقاول");
      const { data: u } = await estimationClient.auth.getUser();
      const userId = u.user?.id;
      if (!userId) throw new Error("غير مسجل دخول");

      const { error } = await estimationClient.from("supplier_quotes").insert({
        workspace_id: userId,
        project_id: projectId,
        supplier_name: supplierName.trim(),
        quote_no: quoteNo.trim() || `SQ-${Date.now().toString().slice(-5)}`,
        city: city.trim() || "الرياض",
        quote_date: quoteDate || null,
        validity_date: validityDate || null,
        status,
        vat_included: vatIncluded,
        transport_included: transportIncluded,
        delivery_terms: deliveryTerms.trim() || null,
        created_by: userId,
        version_no: 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل عرض المورد بنجاح");
      qc.invalidateQueries({ queryKey: ["supplier_quotes_project", projectId] });
      qc.invalidateQueries({ queryKey: ["supplier_quotes_dialog", projectId] });
      setNewQuoteOpen(false);
      setSupplierName("");
      setQuoteNo("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addItemMut = useMutation({
    mutationFn: async () => {
      if (!addItemForQuoteId || !spec.trim()) throw new Error("أدخل وصف بند العرض");
      const safePack = packSize > 0 ? packSize : 1;
      const computedUnitPrice = packPrice / safePack;
      const { error } = await estimationClient.from("supplier_quote_items").insert({
        quote_id: addItemForQuoteId,
        resource_id: linkedResourceId === "none" ? null : linkedResourceId,
        specification: spec.trim(),
        pricing_unit: pricingUnit.trim() || "م³",
        pack_size: safePack,
        pack_price: packPrice,
        unit_price: computedUnitPrice,
        waste_pct: wastePct,
        scope_tag: scopeTag,
        min_order_charge: minOrderCharge,
        shift_hours: shiftHours,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم إضافة سطر عرض السعر وربطه بقاموس الموارد");
      qc.invalidateQueries({ queryKey: ["supplier_quote_items_project", projectId] });
      qc.invalidateQueries({ queryKey: ["supplier_quote_items_dialog"] });
      setAddItemForQuoteId(null);
      setSpec("");
      setPackPrice(0);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateQuoteStatusMut = useMutation({
    mutationFn: async ({ id, nextStatus }: { id: string; nextStatus: QuoteStatus }) => {
      const { error } = await estimationClient
        .from("supplier_quotes")
        .update({ status: nextStatus })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier_quotes_project", projectId] });
      qc.invalidateQueries({ queryKey: ["supplier_quotes_dialog", projectId] });
      toast.success("تم تحديث حالة صلاحية العرض");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteQuoteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await estimationClient.from("supplier_quotes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier_quotes_project", projectId] });
      toast.success("تم حذف عرض المورد");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            سجل عروض الموردين الموثّقة (Supplier Quotes & Line Provenance)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            إدارة عروض الموردين بتواريخ الصلاحية والمدينة وشروط النقل والحد الأدنى للطلب/الوردية — متاحة مباشرة للاستدعاء في تحليل الأسعار.
          </p>
        </div>

        <Dialog open={newQuoteOpen} onOpenChange={setNewQuoteOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              إضافة عرض مورد موثّق
            </Button>
          </DialogTrigger>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader>
              <DialogTitle>تسجيل عرض سعر مورد / مقاول</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-xs py-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>اسم المورد / المحطة / المقاول</Label>
                  <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="مثلاً: شركة الخرسانة الجاهزة المتحدة" className="mt-1 h-8 text-xs" />
                </div>
                <div>
                  <Label>رقم العرض المرجعي</Label>
                  <Input value={quoteNo} onChange={(e) => setQuoteNo(e.target.value)} placeholder="SQ-2026-001" className="mt-1 h-8 text-xs" />
                </div>
                <div>
                  <Label>المدينة</Label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
                <div>
                  <Label>حالة العرض</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as QuoteStatus)}>
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quoted">عرض مورد معتمد (Quoted)</SelectItem>
                      <SelectItem value="reference">مرجعي استرشادي (Reference)</SelectItem>
                      <SelectItem value="expired">منتهي الصلاحية (Expired)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>تاريخ العرض</Label>
                  <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
                <div>
                  <Label>صالح حتى تاريخ</Label>
                  <Input type="date" value={validityDate} onChange={(e) => setValidityDate(e.target.value)} className="mt-1 h-8 text-xs" />
                </div>
              </div>
              <div>
                <Label>شروط التوريد والتسليم</Label>
                <Input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} className="mt-1 h-8 text-xs" />
              </div>
              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={transportIncluded} onChange={(e) => setTransportIncluded(e.target.checked)} />
                  <span>يشمل النقل والتوصيل للموقع</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={vatIncluded} onChange={(e) => setVatIncluded(e.target.checked)} />
                  <span>السعر شامل الضريبة VAT 15%</span>
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setNewQuoteOpen(false)}>إلغاء</Button>
              <Button size="sm" onClick={() => createQuoteMut.mutate()} disabled={createQuoteMut.isPending}>
                {createQuoteMut.isPending ? "جاري الحفظ…" : "حفظ العرض"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-xs text-muted-foreground">جاري تحميل عروض الموردين…</div>
      ) : quotes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-xs text-muted-foreground">
          لا توجد عروض موردين مسجلة لهذا المشروع بعد. اضغط «إضافة عرض مورد موثّق» للبدء.
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map((q) => {
            const items = quoteItems.filter((it) => it.quote_id === q.id);
            return (
              <Card key={q.id} className="border-border">
                <CardHeader className="p-4 pb-2 flex flex-row flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-bold flex flex-wrap items-center gap-2">
                      <span>{q.supplier_name}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">{q.quote_no ?? "—"} · v{q.version_no}</Badge>
                      {q.status === "quoted" && (
                        <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] gap-1">
                          <CheckCircle2 className="h-3 w-3" /> عرض معتمد
                        </Badge>
                      )}
                      {q.status === "reference" && (
                        <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px] gap-1">
                          <AlertTriangle className="h-3 w-3" /> مرجعي
                        </Badge>
                      )}
                      {q.status === "expired" && (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <Clock className="h-3 w-3" /> منتهي الصلاحية
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      المدينة: {q.city ?? "—"} · التاريخ: {q.quote_date ?? "—"} · الصلاحية: {q.validity_date ?? "مفتوحة"} ·{" "}
                      {q.transport_included ? "شامل النقل" : "غير شامل النقل"} · {q.vat_included ? "شامل الضريبة" : "غير شامل الضريبة"}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Select
                      value={q.status}
                      onValueChange={(v) => updateQuoteStatusMut.mutate({ id: q.id, nextStatus: v as QuoteStatus })}
                    >
                      <SelectTrigger className="h-7 w-[125px] text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quoted">عرض معتمد</SelectItem>
                        <SelectItem value="reference">مرجعي</SelectItem>
                        <SelectItem value="expired">منتهي</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => setAddItemForQuoteId(q.id)}>
                      <Plus className="h-3 w-3" /> سطر عرض
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteQuoteMut.mutate(q.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="p-4 pt-2">
                  {items.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground border rounded p-3 text-center">
                      لا توجد بنود داخل هذا العرض بعد — أضف سطراً لربطه بالتحليل والكميات.
                    </div>
                  ) : (
                    <table className="w-full text-xs border rounded">
                      <thead className="bg-muted/30 text-[11px]">
                        <tr>
                          <th className="p-2 text-start">المواصفة</th>
                          <th className="p-2 text-center">النطاق</th>
                          <th className="p-2 text-center">الوحدة / العبوة</th>
                          <th className="p-2 text-center">سعر الوحدة</th>
                          <th className="p-2 text-center">الهالك %</th>
                          <th className="p-2 text-center">حد أدنى / وردية</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {items.map((it) => (
                          <tr key={it.id}>
                            <td className="p-2 font-medium">{it.specification}</td>
                            <td className="p-2 text-center">
                              <Badge variant="outline" className="text-[10px]">
                                {SCOPE_LABELS_AR[(it.scope_tag as AssemblyScopeTag) ?? "general"] ?? it.scope_tag ?? "عام"}
                              </Badge>
                            </td>
                            <td className="p-2 text-center">{it.pack_size} {it.pricing_unit}</td>
                            <td className="p-2 text-center font-bold text-primary">{fmtSAR(it.unit_price)}</td>
                            <td className="p-2 text-center">{it.waste_pct}%</td>
                            <td className="p-2 text-center text-muted-foreground">
                              {it.min_order_charge > 0 ? `${fmtSAR(it.min_order_charge)}` : "—"} / {it.shift_hours} س
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Quote Line Item Modal */}
      <Dialog open={!!addItemForQuoteId} onOpenChange={(o) => { if (!o) setAddItemForQuoteId(null); }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إضافة سطر عرض سعر مورد</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs py-2">
            <div>
              <Label>وصف ومواصفة السطر</Label>
              <Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="مثلاً: خرسانة جاهزة C40 SRC محطة شمال الرياض" className="mt-1 h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>النطاق الهندسي (Scope Tag)</Label>
                <Select value={scopeTag} onValueChange={(v) => setScopeTag(v as AssemblyScopeTag)}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCOPE_LABELS_AR).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>ربط بمورد في القاموس (اختياري)</Label>
                <Select value={linkedResourceId} onValueChange={setLinkedResourceId}>
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون ربط مباشر</SelectItem>
                    {resources.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name_ar} ({r.unit})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>وحدة التسعير</Label>
                <Input value={pricingUnit} onChange={(e) => setPricingUnit(e.target.value)} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label>حجم العبوة</Label>
                <Input type="number" step="0.01" value={packSize} onChange={(e) => setPackSize(Number(e.target.value) || 1)} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label>سعر العبوة / الوحدة (ر.س)</Label>
                <Input type="number" step="0.01" value={packPrice} onChange={(e) => setPackPrice(Number(e.target.value) || 0)} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label>الهالك %</Label>
                <Input type="number" step="0.5" value={wastePct} onChange={(e) => setWastePct(Number(e.target.value) || 0)} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label>حد أدنى للطلب/المضخة (ر.س)</Label>
                <Input type="number" step="50" value={minOrderCharge} onChange={(e) => setMinOrderCharge(Number(e.target.value) || 0)} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label>ساعات الوردية</Label>
                <Input type="number" step="1" value={shiftHours} onChange={(e) => setShiftHours(Number(e.target.value) || 8)} className="mt-1 h-8 text-xs" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddItemForQuoteId(null)}>إلغاء</Button>
            <Button size="sm" onClick={() => addItemMut.mutate()} disabled={addItemMut.isPending}>
              {addItemMut.isPending ? "جاري الإضافة…" : "إضافة السطر"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
