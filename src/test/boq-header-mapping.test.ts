import { describe, expect, it } from "vitest";
import { separateCategoryAndRate } from "@/lib/boq-header-mapping";

describe("Excel category and unit rate", () => {
  it("preserves the category and maps the numeric price under a merged header", () => {
    const headers = [
      { label: "بالأرقام", field: null },
      { label: "بالأحرف", field: null },
      { label: "الفئة", field: "unit_rate" },
    ];
    const result = separateCategoryAndRate(headers, [["السعر الإفرادي بالريال السعودي", "", ""]]);
    expect(result.map((header) => header.field)).toEqual(["unit_rate", null, null]);
  });

  it("retains existing behavior when category is the only rate header", () => {
    const headers = [{ label: "الفئة", field: "unit_rate" }];
    expect(separateCategoryAndRate(headers)).toEqual(headers);
  });
});
