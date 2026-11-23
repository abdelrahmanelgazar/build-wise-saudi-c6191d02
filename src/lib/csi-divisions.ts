// Active MasterFormat divisions listed by SpecsIntact:
// https://nibs-s3-wbdg3-production.s3.us-east-1.amazonaws.com/tools/specsintact/Help/SIGeneral/CSIMasterFormat.htm
export const CSI_DIVISIONS = ([
  ["00", "متطلبات الشراء والتعاقد", "Procurement and Contracting Requirements"],
  ["01", "المتطلبات العامة", "General Requirements"],
  ["02", "الظروف القائمة", "Existing Conditions"],
  ["03", "الخرسانة", "Concrete"],
  ["04", "أعمال المباني", "Masonry"],
  ["05", "الأعمال المعدنية", "Metals"],
  ["06", "الخشب والبلاستيك والمواد المركبة", "Wood, Plastics, and Composites"],
  ["07", "الحماية من الحرارة والرطوبة", "Thermal and Moisture Protection"],
  ["08", "الفتحات", "Openings"],
  ["09", "التشطيبات", "Finishes"],
  ["10", "الأعمال التخصصية", "Specialties"],
  ["11", "المعدات", "Equipment"],
  ["12", "الأثاث والتجهيزات", "Furnishings"],
  ["13", "الإنشاءات الخاصة", "Special Construction"],
  ["14", "معدات النقل داخل المباني", "Conveying Equipment"],
  ["21", "أنظمة إخماد الحريق", "Fire Suppression"],
  ["22", "السباكة", "Plumbing"],
  ["23", "التدفئة والتهوية وتكييف الهواء", "Heating, Ventilating, and Air Conditioning (HVAC)"],
  ["25", "الأتمتة المتكاملة", "Integrated Automation"],
  ["26", "الأعمال الكهربائية", "Electrical"],
  ["27", "الاتصالات", "Communications"],
  ["28", "السلامة والأمن الإلكتروني", "Electronic Safety and Security"],
  ["31", "الأعمال الترابية", "Earthwork"],
  ["32", "التحسينات الخارجية", "Exterior Improvements"],
  ["33", "المرافق", "Utilities"],
  ["34", "النقل", "Transportation"],
  ["35", "الممرات المائية والإنشاءات البحرية", "Waterway and Marine Construction"],
  ["40", "الربط بين العمليات الصناعية", "Process Interconnections"],
  ["41", "معدات معالجة ومناولة المواد", "Material Processing and Handling Equipment"],
  ["42", "معدات التسخين والتبريد والتجفيف الصناعي", "Process Heating, Cooling, and Drying Equipment"],
  ["43", "معدات مناولة الغازات والسوائل وتنقيتها وتخزينها", "Process Gas and Liquid Handling, Purification, and Storage Equipment"],
  ["44", "معدات مكافحة التلوث وإدارة النفايات", "Pollution and Waste Control Equipment"],
  ["45", "معدات التصنيع المتخصصة حسب الصناعة", "Industry-Specific Manufacturing Equipment"],
  ["46", "معدات المياه والصرف الصحي", "Water and Wastewater Equipment"],
  ["48", "توليد الطاقة الكهربائية", "Electrical Power Generation"],
] as const).map(([code, name_ar, name_en]) => ({ code, name_ar, name_en }));

export function csiDivisionCode(value: string | null | undefined) {
  const normalized = value?.trim().replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const match = normalized?.match(/^(?:(?:div(?:ision)?\.?|القسم)\s*)?(\d{1,2})(?=$|[\s.\-–—:])/i);
  const code = match?.[1]?.padStart(2, "0");
  return CSI_DIVISIONS.some((division) => division.code === code) ? code : undefined;
}

export function csiDivisionLabel(value: string, language: "ar" | "en") {
  const match = csiDivisionCode(value);
  const division = CSI_DIVISIONS.find(({ code }) => code === match);
  return division
    ? `${division.code} — ${language === "ar" ? division.name_ar : division.name_en}`
    : value;
}
