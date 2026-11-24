export function separateCategoryAndRate(
  headers: { label: string; field: string | null }[],
  preHeaders: unknown[][] = [],
) {
  const categoryIndex = headers.findIndex((header, index) =>
    [header.label, ...preHeaders.slice(-2).map((row) => row?.[index])]
      .some((value) => /^(الفئة|الفئه|فئة|فئه)$/.test(String(value ?? "").trim())),
  );
  const rateIndex = headers.findIndex((header, index) => {
    const labels = [header.label, ...preHeaders.slice(-2).map((row) => row?.[index])]
      .filter(Boolean)
      .join(" ");
    return /السعر\s+الإفرادي|السعر\s+الافرادي|سعر\s+الوحدة|unit\s+(price|rate)/i.test(labels)
      && !/بالأحرف|بالحروف|بالاحرف/i.test(header.label);
  });
  if (categoryIndex < 0 || rateIndex < 0 || categoryIndex === rateIndex) return headers;
  return headers.map((header, index) => {
    if (index === categoryIndex) {
      return { ...header, label: header.label || "الفئة", field: header.field === "unit_rate" ? null : header.field };
    }
    if (index === rateIndex) return { ...header, field: "unit_rate" };
    return header;
  });
}
