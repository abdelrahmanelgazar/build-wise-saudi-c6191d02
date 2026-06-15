export type Division = { code: string; name_ar: string };

export const DIVISIONS: Division[] = [
  { code: "01", name_ar: "المتطلبات العامة" },
  { code: "02", name_ar: "الظروف الحالية" },
  { code: "03", name_ar: "أعمال الخرسانة" },
  { code: "04", name_ar: "المباني" },
  { code: "05", name_ar: "الأعمال المعدنية" },
  { code: "06", name_ar: "الخشب والبلاستيك والمواد المركبة" },
  { code: "07", name_ar: "عزل الحرارة والرطوبة" },
  { code: "08", name_ar: "الأبواب والنوافذ" },
  { code: "09", name_ar: "التشطيبات" },
  { code: "10", name_ar: "أعمال اختصاصية" },
  { code: "11", name_ar: "الأجهزة" },
  { code: "12", name_ar: "الفرش" },
  { code: "13", name_ar: "المنشآت الخاصة" },
  { code: "14", name_ar: "معدات الانتقال (المصاعد)" },
  { code: "21", name_ar: "مكافحة الحرائق" },
  { code: "22", name_ar: "السباكة" },
  { code: "23", name_ar: "التدفئة والتهوية وتكييف الهواء (HVAC)" },
  { code: "26", name_ar: "الكهرباء" },
  { code: "27", name_ar: "أنظمة خاصة" },
  { code: "28", name_ar: "الأمن والسلامة الإلكترونية" },
  { code: "31", name_ar: "أعمال الحفر والردم" },
  { code: "32", name_ar: "التحسينات الخارجية" },
  { code: "48-1", name_ar: "نظام الطاقة الشمسية الرئيسي على السطح" },
  { code: "48-2", name_ar: "نظام الطاقة الشمسية للمأذنة والواجهة" },
];

export const DIVISION_LABEL = (code: string | null | undefined) => {
  if (!code) return null;
  const d = DIVISIONS.find((x) => x.code === code);
  return d ? `القسم ${d.code} - ${d.name_ar}` : `القسم ${code}`;
};
