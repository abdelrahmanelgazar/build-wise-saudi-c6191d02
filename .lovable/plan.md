## المشكلة
صفحة `/boq` تتعطل بخطأ `ReferenceError: props is not defined` يأتي من `src/components/boq/boq-grid.tsx` السطر 219.

السبب: المكوّن `BoqGrid` يعرّف الـ prop `onDeleteColumn?: (field: string) => void` في نوع الـ props، لكنه **لم يُفكَّك (destructure)** ضمن قائمة المعاملات (الأسطر 69–75). ومع ذلك يُستخدم الاسم `onDeleteColumn` مباشرةً داخل JSX في السطر 219، فيتحول في الـ build إلى مرجع غير معرّف ويُرمى الخطأ، فتظهر شاشة "تعذّر تحميل هذه الصفحة".

## الإصلاح
تعديل واحد في `src/components/boq/boq-grid.tsx`:
- إضافة `onDeleteColumn` إلى قائمة الـ destructuring في توقيع `BoqGrid` (السطر 75) بجانب `grandTotal`.

لا تغييرات أخرى مطلوبة — استخدامه في السطر 219 سيعمل بعد التفكيك، والـ guard `&& onDeleteColumn` الموجود سيخفي زر الحذف عندما لا يُمرَّر.

## التحقق
- تحميل `/boq` بدون انهيار.
- ظهور الشبكة والبنود طبيعياً.
