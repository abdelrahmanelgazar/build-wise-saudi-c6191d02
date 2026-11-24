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

// Compound ordinals must be listed first so "الثاني عشر" is not matched by "الثاني"
const ARABIC_ORDINALS: [string, string][] = [
  ["الحادي عشر", "11"],
  ["حادي عشر", "11"],
  ["الثاني عشر", "12"],
  ["ثاني عشر", "12"],
  ["الثالث عشر", "13"],
  ["الثالث-عشر", "13"],
  ["ثالث عشر", "13"],
  ["الرابع عشر", "14"],
  ["رابع عشر", "14"],
  ["الخامس عشر", "15"],
  ["خامس عشر", "15"],
  ["السادس عشر", "26"],
  ["سادس عشر", "26"],
  ["الاول", "01"],
  ["الأول", "01"],
  ["اول", "01"],
  ["أول", "01"],
  ["الثاني", "02"],
  ["ثاني", "02"],
  ["الثالث", "03"],
  ["ثالث", "03"],
  ["الرابع", "04"],
  ["رابع", "04"],
  ["الخامس", "05"],
  ["خامس", "05"],
  ["السادس", "06"],
  ["سادس", "06"],
  ["السابع", "07"],
  ["سابع", "07"],
  ["الثامن", "08"],
  ["ثامن", "08"],
  ["التاسع", "09"],
  ["تاسع", "09"],
  ["العاشر", "10"],
  ["عاشر", "10"],
];

export function csiDivisionCode(value: string | null | undefined) {
  if (!value) return undefined;
  const raw = value.trim();
  const normalized = raw.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

  // 1. Direct digits (e.g. "01", "القسم 03", "Div 09")
  const match = normalized.match(/^(?:(?:div(?:ision)?\.?|القسم)\s*)?(\d{1,2})(?=$|[\s.\-–—:])/i);
  const code = match?.[1]?.padStart(2, "0");
  if (code && CSI_DIVISIONS.some((division) => division.code === code)) {
    return code;
  }

  // 2. Arabic words (e.g. "القسم الاول", "القسم الثالث-الاعمال الخرسانية")
  const clean = raw.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[\u064B-\u065F\u0640]/g, "");
  for (const [ordinal, divCode] of ARABIC_ORDINALS) {
    const cleanOrdinal = ordinal.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    if (clean.includes(cleanOrdinal)) {
      // Check trade-specific overrides within Division 15 in classical 16-division format
      if (divCode === "15") {
        if (clean.includes("تكييف") || clean.includes("hvac")) return "23";
        if (clean.includes("حريق") || clean.includes("اطفاء") || clean.includes("مكافحة")) return "21";
        if (clean.includes("صحي") || clean.includes("سباكه") || clean.includes("غازات")) return "22";
      }
      return divCode;
    }
  }

  // 3. Trade keyword match
  if (clean.includes("كهرب") || clean.includes("اناره")) return "26";
  if (clean.includes("تكييف") || clean.includes("تهويه")) return "23";
  if (clean.includes("خرسان")) return "03";
  if (clean.includes("مبان") || clean.includes("بلوك")) return "04";
  if (clean.includes("معدن") || clean.includes("حديد")) return "05";
  if (clean.includes("تشطيب") || clean.includes("دهان") || clean.includes("ارضيات")) return "09";
  if (clean.includes("ابواب") || clean.includes("نوافذ")) return "08";
  if (clean.includes("عزل") || clean.includes("رطوب")) return "07";
  if (clean.includes("موقع") || clean.includes("حفر") || clean.includes("تراب")) return "02";
  if (clean.includes("متطلبات عامه") || clean.includes("عام")) return "01";

  return undefined;
}

export function csiDivisionLabel(value: string, language: "ar" | "en") {
  const match = csiDivisionCode(value);
  const division = CSI_DIVISIONS.find(({ code }) => code === match);
  return division
    ? `${division.code} — ${language === "ar" ? division.name_ar : division.name_en}`
    : value;
}
