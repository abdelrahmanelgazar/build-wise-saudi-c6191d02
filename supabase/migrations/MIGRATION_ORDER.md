# سجل ترتيب الترحيلات وخطة المطابقة (CLOUD_RELEASE_PLAN §1)

تقرأ أداة Supabase CLI رقم الإصدار من الجزء الرقمي قبل أول شرطة سفلية (`_`). لتجنّب تصادم الإصدارين `002` و`003` على البادئة `20261125`، تم تثبيت معرفات زمنية فريدة ومرتبة:

| الترتيب | الاسم السابق | الاسم النهائي المعتمد | الحالة البعيدة |
|---|---|---|---|
| 1 | `20261124_001_independence_schema_and_rls.sql` | `20261124_001_independence_schema_and_rls.sql` | يُفحص بـ `supabase migration list --linked` قبل الدفع |
| 2 | `20261125_002_csi_01_10_assemblies_and_quotes.sql` | `20261125000002_csi_01_10_assemblies_and_quotes.sql` | يُطبّق بعد 001 |
| 3 | `20261125_003_v2_excel_tender_rfi_ai.sql` | `20261125000003_v2_excel_tender_rfi_ai.sql` | يُطبّق بعد 002 |
| 4 | — (جديد لتغطية فحص §2) | `20261126000004_rls_completeness_and_atomic_submit_rpc.sql` | يستكمل سياسات RLS للجداول الأربعة ويضيف دالة التقديم الذرية `submit_tender_version` |

## أوامر التنفيذ في بيئة التجربة ثم الإنتاج

```bash
# 1. التحقق من المشروع المرتبط ومقارنة السجل
supabase link --project-ref <STAGING_OR_PROD_PROJECT_REF>
supabase migration list --linked

# 2. معاينة التغييرات قبل الدفع
supabase db push --dry-run

# 3. التطبيق على التجربة أولاً ثم الإنتاج بعد استيفاء بوابات الاستلام
supabase db push
```
