import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProjectId } from "@/lib/active-project";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ShieldCheck,
  Wallet,
  TrendingUp,
  Percent,
  Download,
  Printer,
  FolderPlus,
  Coins,
  Receipt,
  PieChart as PieIcon,
  Calculator,
} from "lucide-react";
import { fmtSAR, fmtNumber } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

export const Route = createFileRoute("/_authenticated/financial")({
  head: () => ({
    meta: [
      { title: "المراجعة المالية — تقديري | Financial Review" },
      { name: "description", content: "مراجعة مالية شاملة للعطاء: التكاليف المباشرة وغير المباشرة، هوامش الربح والمخاطر، وضريبة القيمة المضافة 15%." },
    ],
  }),
  component: FinancialPage,
});

function FinancialPage() {
  const { t, language } = useLanguage();
  const projectId = useActiveProjectId();
  const [vatRate, setVatRate] = useState<number>(15);

  const { data: project } = useQuery({
    queryKey: ["project_financial", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: boqItems = [] } = useQuery({
    queryKey: ["financial_boq", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("boq_items")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: paItems = [] } = useQuery({
    queryKey: ["financial_pa_items", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_analysis_items")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: markups = [] } = useQuery({
    queryKey: ["financial_markups", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_analysis_markup")
        .select("*")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data;
    },
  });

  // Calculate detailed financial totals
  const financials = useMemo(() => {
    let materialCost = 0;
    let laborCost = 0;
    let equipmentCost = 0;
    let subcontractorCost = 0;

    paItems.forEach((item) => {
      const amt = Number(item.quantity ?? 0) * Number(item.unit_price ?? 0);
      if (item.resource_type === "material") materialCost += amt;
      else if (item.resource_type === "labor") laborCost += amt;
      else if (item.resource_type === "equipment") equipmentCost += amt;
      else if (item.resource_type === "subcontractor") subcontractorCost += amt;
    });

    const totalDirect = materialCost + laborCost + equipmentCost + subcontractorCost;

    // Average or aggregate markup percentages
    const count = markups.length || 1;
    const avgIndirectPct = markups.reduce((s, m) => s + Number(m.indirect_pct ?? 0), 0) / count;
    const avgOverheadPct = markups.reduce((s, m) => s + Number(m.overhead_pct ?? 0), 0) / count;
    const avgRiskPct = markups.reduce((s, m) => s + Number(m.risk_pct ?? 0), 0) / count;
    const avgProfitPct = markups.reduce((s, m) => s + Number(m.profit_pct ?? 0), 0) / count;

    const indirectAmount = (totalDirect * avgIndirectPct) / 100;
    const overheadAmount = (totalDirect * avgOverheadPct) / 100;
    const riskAmount = (totalDirect * avgRiskPct) / 100;
    const profitAmount = (totalDirect * avgProfitPct) / 100;

    const netSellingPrice = totalDirect + indirectAmount + overheadAmount + riskAmount + profitAmount;
    const vatAmount = (netSellingPrice * (vatRate || 0)) / 100;
    const grandTotalWithVat = netSellingPrice + vatAmount;

    return {
      materialCost,
      laborCost,
      equipmentCost,
      subcontractorCost,
      totalDirect,
      avgIndirectPct,
      avgOverheadPct,
      avgRiskPct,
      avgProfitPct,
      indirectAmount,
      overheadAmount,
      riskAmount,
      profitAmount,
      netSellingPrice,
      vatAmount,
      grandTotalWithVat,
    };
  }, [paItems, markups, vatRate]);

  const costDistribution = [
    { name: t("pa.materials", "المواد"), value: financials.materialCost || 1, color: "#10b981" },
    { name: t("pa.labour", "العمالة"), value: financials.laborCost || 1, color: "#3b82f6" },
    { name: t("pa.equipment", "المعدات"), value: financials.equipmentCost || 1, color: "#f59e0b" },
    { name: t("pa.subcontractor", "مقاول باطن"), value: financials.subcontractorCost || 1, color: "#8b5cf6" },
  ];

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <FolderPlus className="mx-auto h-10 w-10 text-muted-foreground opacity-50" />
          <h2 className="mt-3 text-lg font-semibold">{t("nav.selectProject", "اختر مشروعاً للبدء")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("pa.selectProjectDesc", "المراجعة المالية تعتمد على بيانات وبنود المشروع المختار.")}
          </p>
          <Link to="/projects" className="mt-4 inline-block">
            <Button>{t("boq.goToProjects", "الذهاب للمشاريع")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {t("nav.financial", "المراجعة المالية للعطاء")}
            </h1>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              {project?.name ?? "—"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("comingSoon.financialDesc", "ملخص شامل قبل تسليم العطاء: التكاليف المباشرة وغير المباشرة، المخاطر، الأرباح، وضريبة القيمة المضافة 15%.")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            {t("reports.printPdf", "طباعة / PDF")}
          </Button>
          <Button size="sm" className="gap-1.5">
            <Download className="h-4 w-4" />
            {t("common.exportExcel", "تصدير التقرير المالي")}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("common.directCost", "التكلفة المباشرة")}</p>
                <h3 className="mt-1 text-xl font-bold tabular-nums text-foreground">
                  {fmtSAR(financials.totalDirect, language)}
                </h3>
              </div>
              <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-500">
                <Wallet className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {boqItems.length} {t("common.items", "بند كميات")} · {paItems.length} {t("resources.title", "عنصر تحليل")}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("pa.profitLabel", "صافي الربح المتوقع")}</p>
                <h3 className="mt-1 text-xl font-bold tabular-nums text-primary">
                  {fmtSAR(financials.profitAmount, language)}
                </h3>
              </div>
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                <TrendingUp className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("pa.profitPct", "نسبة الربح")}: {financials.avgProfitPct.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("financial.preVatTotal", "القيمة قبل الضريبة")}</p>
                <h3 className="mt-1 text-xl font-bold tabular-nums text-foreground">
                  {fmtSAR(financials.netSellingPrice, language)}
                </h3>
              </div>
              <div className="rounded-md bg-blue-500/10 p-2 text-blue-500">
                <Coins className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("financial.markupsTotal", "إجمالي الهوامش الإضافية")}: {fmtSAR(financials.indirectAmount + financials.overheadAmount + financials.riskAmount, language)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-primary">{t("financial.grandTotalWithVat", "إجمالي العطاء شامل الضريبة")}</p>
                <h3 className="mt-1 text-2xl font-black tabular-nums text-primary">
                  {fmtSAR(financials.grandTotalWithVat, language)}
                </h3>
              </div>
              <div className="rounded-md bg-primary/20 p-2 text-primary">
                <Receipt className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("financial.vatDue", "ضريبة القيمة المضافة")} ({vatRate}%): {fmtSAR(financials.vatAmount, language)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Breakdown Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Cost Elements Table */}
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              {t("financial.costStructureTitle", "هيكل تكاليف العطاء وهوامش التسعير")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t("financial.costStructureDesc", "تفصيل بنود التكلفة المباشرة وغير المباشرة وحساب سعر البيع النهائي.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">{t("financial.costElement", "عنصر التكلفة")}</th>
                    <th className="px-4 py-2.5 text-center font-medium">{t("financial.percentage", "النسبة %")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("financial.amount", "القيمة (ر.س)")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-xs">
                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      {t("pa.materials", "تكلفة المواد (Materials)")}
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">
                      {financials.totalDirect > 0 ? ((financials.materialCost / financials.totalDirect) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold">{fmtSAR(financials.materialCost, language)}</td>
                  </tr>

                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      {t("pa.labour", "تكلفة العمالة (Labour)")}
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">
                      {financials.totalDirect > 0 ? ((financials.laborCost / financials.totalDirect) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold">{fmtSAR(financials.laborCost, language)}</td>
                  </tr>

                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      {t("pa.equipment", "تكلفة المعدات (Equipment)")}
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">
                      {financials.totalDirect > 0 ? ((financials.equipmentCost / financials.totalDirect) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold">{fmtSAR(financials.equipmentCost, language)}</td>
                  </tr>

                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-purple-500" />
                      {t("pa.subcontractor", "مقاول باطن (Subcontractors)")}
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">
                      {financials.totalDirect > 0 ? ((financials.subcontractorCost / financials.totalDirect) * 100).toFixed(1) : 0}%
                    </td>
                    <td className="px-4 py-2.5 text-end font-semibold">{fmtSAR(financials.subcontractorCost, language)}</td>
                  </tr>

                  <tr className="bg-muted/30 font-bold">
                    <td className="px-4 py-2.5 text-foreground">{t("common.directCost", "إجمالي التكلفة المباشرة")}</td>
                    <td className="px-4 py-2.5 text-center text-foreground">100%</td>
                    <td className="px-4 py-2.5 text-end text-foreground">{fmtSAR(financials.totalDirect, language)}</td>
                  </tr>

                  {/* Markups */}
                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{t("pa.indirectLabel", "تكاليف غير مباشرة (Site Overhead)")}</td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">{financials.avgIndirectPct.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-end font-medium">{fmtSAR(financials.indirectAmount, language)}</td>
                  </tr>

                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{t("pa.overheadLabel", "مصاريف إدارية وعمومية (General Overhead)")}</td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">{financials.avgOverheadPct.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-end font-medium">{fmtSAR(financials.overheadAmount, language)}</td>
                  </tr>

                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{t("pa.riskLabel", "مخصص المخاطر والطوارئ (Contingency)")}</td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">{financials.avgRiskPct.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-end font-medium">{fmtSAR(financials.riskAmount, language)}</td>
                  </tr>

                  <tr className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-primary font-medium">{t("pa.profitLabel", "هامش الربح (Profit Margin)")}</td>
                    <td className="px-4 py-2.5 text-center text-primary font-medium">{financials.avgProfitPct.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-end font-bold text-primary">{fmtSAR(financials.profitAmount, language)}</td>
                  </tr>

                  <tr className="bg-primary/10 font-bold text-sm">
                    <td className="px-4 py-3 text-primary">{t("financial.netSellingPrice", "إجمالي قيمة العطاء (قبل الضريبة)")}</td>
                    <td className="px-4 py-3 text-center text-primary">—</td>
                    <td className="px-4 py-3 text-end text-primary">{fmtSAR(financials.netSellingPrice, language)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* VAT & Cost Distribution */}
        <div className="space-y-6">
          {/* VAT Setting Card */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Percent className="h-4 w-4 text-emerald-500" />
                {t("financial.vatCardTitle", "ضريبة القيمة المضافة (KSA VAT)")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <Label htmlFor="vat-input">{t("financial.vatPercentageLabel", "نسبة الضريبة المطبقة (%)")}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="vat-input"
                    type="number"
                    min="0"
                    max="100"
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value) || 0)}
                    className="h-9 w-24 text-center font-bold"
                  />
                  <span className="text-xs text-muted-foreground">% (النسبة النظامية المعتمدة هي 15%)</span>
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("financial.taxableAmount", "المبلغ الخاضع للضريبة:")}</span>
                  <span className="font-semibold">{fmtSAR(financials.netSellingPrice, language)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("financial.taxDue", "مبلغ الضريبة المستحق:")}</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtSAR(financials.vatAmount, language)}</span>
                </div>
                <div className="border-t border-border/60 pt-2 flex justify-between font-bold text-sm">
                  <span className="text-primary">{t("financial.totalDue", "الإجمالي النهائي:")}</span>
                  <span className="text-primary">{fmtSAR(financials.grandTotalWithVat, language)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chart Card */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PieIcon className="h-4 w-4 text-primary" />
                {t("financial.costDistribution", "توزيع التكلفة المباشرة")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={costDistribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                    >
                      {costDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtSAR(v, language)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
