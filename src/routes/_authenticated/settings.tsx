import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Building2,
  Shield,
  Sliders,
  Save,
  CheckCircle2,
  Users,
  FileCheck,
  Percent,
  Coins,
  Globe,
  Database,
  Download,
  Upload,
  RefreshCw,
  FolderArchive,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";
import { useActiveProjectId } from "@/lib/active-project";
import { readWorkspaceSetting, writeWorkspaceSetting } from "@/lib/workspace-settings";
import { exportProjectBackup, restoreProjectBackup, type ProjectBackupSnapshot } from "@/lib/project-backup";
import { useRegisterPageActions } from "@/lib/workspace-page-actions";
import { runTransitionalDataMigration, type MigrationSummary } from "@/lib/cell-styles-migration";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات والصلاحيات — تقديري | Settings & Permissions" },
      { name: "description", content: "إدارة إعدادات الشركة، الصلاحيات والأدوار، ونسب الضريبة والعملة." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, language, setLanguage } = useLanguage();
  const [activeTab, setActiveTab] = useState("company");
  const activeProjectId = useActiveProjectId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState<MigrationSummary | null>(null);
  const queryClient = useQueryClient();

  useRegisterPageActions({
    pageKey: "settings",
    hasEditableState: true,
    queryKeys: [["projects"], ["clients"], ["boq_items"]],
    onSave: async () => {
      writeWorkspaceSetting("taqdiri:company_settings", JSON.stringify(company));
      writeWorkspaceSetting("taqdiri:preferences", JSON.stringify(preferences));
    },
  });

  async function handleExport() {
    if (!activeProjectId) {
      toast.error(t("settings.noActiveProject", "يرجى اختيار مشروع لتصدير نسخته الاحتياطية أولاً"));
      return;
    }
    try {
      setIsExporting(true);
      const snapshot = await exportProjectBackup(activeProjectId);
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${snapshot.project.name || "project"}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("settings.exportSuccess", "تم تصدير النسخة الاحتياطية بنجاح"));
    } catch (err: any) {
      toast.error(err.message || "فشل تصدير النسخة الاحتياطية");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsRestoring(true);
      const text = await file.text();
      const snapshot = JSON.parse(text) as ProjectBackupSnapshot;
      if (!snapshot.version || !snapshot.project) {
        throw new Error("ملف النسخة الاحتياطية غير صالح أو ناقص");
      }
      const res = await restoreProjectBackup(snapshot);
      await queryClient.invalidateQueries();
      toast.success(
        t(
          "settings.restoreSuccess",
          `تم استعادة المشروع "${snapshot.project.name}" بنجاح (${res.itemsRestored} بند، ${res.analysesRestored} سطر تحليل)`
        )
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      toast.error(err.message || "فشل استعادة النسخة الاحتياطية");
    } finally {
      setIsRestoring(false);
    }
  }

  // Company Profile State
  const [company, setCompany] = useState(() => {
    try {
      const saved = readWorkspaceSetting("taqdiri:company_settings");
      if (saved) return JSON.parse(saved);
    } catch { /* empty */ }
    return {
      name: "شركة الجابرية للمقاولات العامة",
      crNumber: "1010345678",
      taxNumber: "300123456700003",
      defaultVat: 15,
      city: "الرياض",
      classification: "الدرجة الأولى — مباني وأعمال إنشائية",
    };
  });

  // System Preferences
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = readWorkspaceSetting("taqdiri:system_preferences");
      if (saved) return JSON.parse(saved);
    } catch { /* empty */ }
    return {
      autoSave: true,
      decimals: 2,
      currency: "SAR",
      notifyTenderDeadline: true,
    };
  });

  async function saveCompanySettings(e: React.FormEvent) {
    e.preventDefault();
    try {
      await writeWorkspaceSetting("taqdiri:company_settings", JSON.stringify(company));
    } catch (error) {
      toast.error(String(error));
      return;
    }
    toast.success(t("settings.savedSuccess", "تم حفظ إعدادات الشركة بنجاح"));
  }

  async function savePreferences(e: React.FormEvent) {
    e.preventDefault();
    try {
      await writeWorkspaceSetting("taqdiri:system_preferences", JSON.stringify(preferences));
    } catch (error) {
      toast.error(String(error));
      return;
    }
    toast.success(t("settings.prefSaved", "تم حفظ تفضيلات النظام"));
  }

  const ROLES = [
    {
      title: t("roles.gm", "المدير العام (General Manager)"),
      desc: t("roles.gmDesc", "صلاحيات كاملة على كل المشاريع والاعتمادات النهائية وعروض الأسعار."),
      badge: "Full Access",
      badgeColor: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    },
    {
      title: t("roles.estimationManager", "مدير التسعير (Estimation Manager)"),
      desc: t("roles.estimationManagerDesc", "إنشاء المشاريع، تعديل نسب الأرباح، واعتماد أسعار بنود الكميات."),
      badge: "Management",
      badgeColor: "bg-primary/10 text-primary border-primary/30",
    },
    {
      title: t("roles.estimator", "مهندس التسعير (Senior Estimator)"),
      desc: t("roles.estimatorDesc", "تحرير بنود جدول الكميات، إعداد تحليل الأسعار، وإدخال بيانات الموارد."),
      badge: "Editor",
      badgeColor: "bg-blue-500/10 text-blue-500 border-blue-500/30",
    },
    {
      title: t("roles.auditor", "المراجع المالي (Financial Reviewer)"),
      desc: t("roles.auditorDesc", "مراجعة التكاليف، تدقيق الضرائب والربحية دون صلاحية تعديل الأسعار المباشرة."),
      badge: "Reviewer",
      badgeColor: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    },
    {
      title: t("roles.viewer", "مُشاهد فقط (Viewer)"),
      desc: t("roles.viewerDesc", "استعراض المشاريع والتقارير المكتملة دون صلاحيات تعديل."),
      badge: "Read Only",
      badgeColor: "bg-muted text-muted-foreground border-border",
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("nav.settings", "الإعدادات والصلاحيات")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("comingSoon.settingsDesc", "إدارة بيانات الشركة، ضريبة القيمة المضافة، الصلاحيات والأدوار، وتفضيلات النظام.")}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 max-w-lg">
          <TabsTrigger value="company" className="gap-2">
            <Building2 className="h-4 w-4" />
            {t("settings.tabCompany", "الشركة")}
          </TabsTrigger>
          <TabsTrigger value="permissions" className="gap-2">
            <Shield className="h-4 w-4" />
            {t("settings.tabPermissions", "الصلاحيات")}
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-2">
            <Sliders className="h-4 w-4" />
            {t("settings.tabPreferences", "التفضيلات")}
          </TabsTrigger>
          <TabsTrigger value="backup" className="gap-2">
            <FolderArchive className="h-4 w-4" />
            {t("settings.tabBackup", "النسخ الاحتياطي")}
          </TabsTrigger>
        </TabsList>

        {/* 1. Company Profile */}
        <TabsContent value="company">
          <form onSubmit={saveCompanySettings}>
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  {t("settings.companyProfileTitle", "بيانات المنشأة والمناقصات")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("settings.companyProfileDesc", "تُستخدم هذه البيانات في ترويسات تقارير العطاءات الرسمية وتصدير عروض الأسعار.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="comp-name">{t("settings.companyName", "اسم شركة المقاولات")}</Label>
                    <Input
                      id="comp-name"
                      value={company.name}
                      onChange={(e) => setCompany({ ...company, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="comp-city">{t("settings.city", "المدينة والمقر الرئيسي")}</Label>
                    <Input
                      id="comp-city"
                      value={company.city}
                      onChange={(e) => setCompany({ ...company, city: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="comp-cr">{t("settings.crNumber", "رقم السجل التجاري (CR)")}</Label>
                    <Input
                      id="comp-cr"
                      value={company.crNumber}
                      onChange={(e) => setCompany({ ...company, crNumber: e.target.value })}
                      placeholder="1010XXXXXX"
                      dir="ltr"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="comp-tax">{t("settings.taxNumber", "الرقم الضريبي (VAT ID)")}</Label>
                    <Input
                      id="comp-tax"
                      value={company.taxNumber}
                      onChange={(e) => setCompany({ ...company, taxNumber: e.target.value })}
                      placeholder="300XXXXXXXXXXXX"
                      dir="ltr"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="comp-class">{t("settings.classification", "تصنيف المقاول المعتمد")}</Label>
                    <Input
                      id="comp-class"
                      value={company.classification}
                      onChange={(e) => setCompany({ ...company, classification: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="comp-vat">{t("settings.defaultVat", "نسبة ضريبة القيمة المضافة الافتراضية (%)")}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="comp-vat"
                        type="number"
                        min="0"
                        max="100"
                        value={company.defaultVat}
                        onChange={(e) => setCompany({ ...company, defaultVat: Number(e.target.value) || 0 })}
                        className="w-24 text-center font-bold"
                      />
                      <span className="text-xs text-muted-foreground">% ({t("settings.vatStandardNote", "معتمدة بنسبة 15% في المملكة العربية السعودية")})</span>
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t border-border/60 bg-muted/20 px-6 py-3 flex justify-end">
                <Button type="submit" className="gap-2">
                  <Save className="h-4 w-4" />
                  {t("common.save", "حفظ التغييرات")}
                </Button>
              </CardFooter>
            </Card>
          </form>
        </TabsContent>

        {/* 2. Role-Based Access Control */}
        <TabsContent value="permissions">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                {t("settings.rbacTitle", "إدارة أدوار وصلاحيات فريق التسعير (RBAC)")}
              </CardTitle>
              <CardDescription className="text-xs">
                {t("settings.rbacDesc", "تحديد مستويات الوصول لكل دور في المنصة لمنع التعديل غير المصرح به على الأسعار.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="divide-y divide-border rounded-lg border border-border">
                {ROLES.map((role, idx) => (
                  <div key={idx} className="flex flex-wrap items-center justify-between gap-4 p-4 hover:bg-muted/20 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">{role.title}</span>
                        <Badge variant="outline" className={`text-[10px] ${role.badgeColor}`}>
                          {role.badge}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{role.desc}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("settings.roleActive", "مفعّل")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3. System Preferences */}
        <TabsContent value="preferences">
          <form onSubmit={savePreferences}>
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-primary" />
                  {t("settings.preferencesTitle", "تفضيلات واجهة التطبيق")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("settings.preferencesDesc", "تخصيص اللغة والعملة والحفظ التلقائي.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between gap-4 py-2">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{t("settings.language", "لغة الواجهة الأساسية")}</Label>
                    <p className="text-xs text-muted-foreground">{t("settings.languageDesc", "اختر لغة العرض والتسعير.")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={language === "ar" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setLanguage("ar")}
                    >
                      العربية (AR)
                    </Button>
                    <Button
                      type="button"
                      variant={language === "en" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setLanguage("en")}
                    >
                      English (EN)
                    </Button>
                  </div>
                </div>

                <div className="border-t border-border pt-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{t("settings.autoSave", "الحفظ التلقائي الفوري للخلايا")}</Label>
                    <p className="text-xs text-muted-foreground">{t("settings.autoSaveDesc", "حفظ أي تعديل في جدول الكميات وتحليل الأسعار بمجرد الخروج من الخلية.")}</p>
                  </div>
                  <Switch
                    checked={preferences.autoSave}
                    onCheckedChange={(c) => setPreferences({ ...preferences, autoSave: c })}
                  />
                </div>

                <div className="border-t border-border pt-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{t("settings.deadlineAlerts", "تنبيهات مواعيد تسليم العطاءات")}</Label>
                    <p className="text-xs text-muted-foreground">{t("settings.deadlineAlertsDesc", "تنبيه اقتراب موعد فتح المظاريف أو آخر موعد للاستفسارات.")}</p>
                  </div>
                  <Switch
                    checked={preferences.notifyTenderDeadline}
                    onCheckedChange={(c) => setPreferences({ ...preferences, notifyTenderDeadline: c })}
                  />
                </div>
              </CardContent>
              <CardFooter className="border-t border-border/60 bg-muted/20 px-6 py-3 flex justify-end">
                <Button type="submit" className="gap-2">
                  <Save className="h-4 w-4" />
                  {t("common.save", "حفظ التفضيلات")}
                </Button>
              </CardFooter>
            </Card>
          </form>
        </TabsContent>
        {/* 4. Backup & Restore */}
        <TabsContent value="backup">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FolderArchive className="h-4 w-4 text-primary" />
                {t("settings.backupTitle", "النسخ الاحتياطي واستعادة المشاريع")}
              </CardTitle>
              <CardDescription className="text-xs">
                {t("settings.backupDesc", "تصدير لقطة بيانات كاملة للمشروع النشط (شاملة بنود BOQ، تفكيك تحليل الأسعار، الهوامش، وعروض الأسعار) أو استعادة مشروع من ملف JSON سابق.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border border-border p-4 bg-muted/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold">{t("settings.exportTitle", "تصدير نسخة احتياطية (JSON Snapshot)")}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.exportHelp", "يحفظ جميع البيانات الحالية للمشروع المختار بتنسيق JSON قياسي مستقل.")}
                    </p>
                  </div>
                  <Button onClick={handleExport} disabled={isExporting || !activeProjectId} className="gap-2">
                    <Download className="h-4 w-4" />
                    {isExporting ? t("common.exporting", "جاري التصدير...") : t("settings.exportBtn", "تصدير لقطة المشروع")}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 bg-muted/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold">{t("settings.restoreTitle", "استعادة مشروع من نسخة احتياطية")}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.restoreHelp", "اختر ملف JSON للنسخة الاحتياطية لاستعادة المشروع مع كامل تحليلاته وهياكل الأسعار.")}
                    </p>
                  </div>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isRestoring}
                      className="gap-2"
                    >
                      <Upload className="h-4 w-4" />
                      {isRestoring ? t("settings.restoring", "جاري الاستعادة...") : t("settings.restoreBtn", "استعادة من ملف")}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4 bg-muted/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold">ترحيل البيانات الانتقالية والمصالحة (Migration & Reconciliation)</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      نقل مفاتيح cell_styles إلى حقول الأعمال الصريحة وتصنيف المشاريع القابلة للإعادة بنفس النتيجة.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const summary = await runTransitionalDataMigration();
                      setMigrationSummary(summary);
                      await queryClient.invalidateQueries();
                      toast.success("اكتمل فحص وترحيل البيانات الانتقالية بنجاح");
                    }}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    تشغيل الترحيل والمصالحة
                  </Button>
                </div>
                {migrationSummary && (
                  <div className="rounded border border-border bg-card p-3 text-xs space-y-1">
                    <div>بنود الكميات المفحوصة: {migrationSummary.boqItemsScanned} (تم ترحيل {migrationSummary.boqItemsMigrated})</div>
                    <div>أسطر التحليل المفحوصة: {migrationSummary.paItemsScanned} (تم ترحيل {migrationSummary.paItemsMigrated})</div>
                    <div>المشاريع المفحوصة: {migrationSummary.projectsScanned} (شركة غير محددة: {migrationSummary.projectsUnclassifiedCompany})</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
