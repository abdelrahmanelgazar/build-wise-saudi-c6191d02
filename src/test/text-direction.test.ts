import { describe, expect, it } from "vitest";
import { getTextDirection } from "@/lib/text-direction";
import { fmtSAR } from "@/lib/format";

describe("Imported language behavior", () => {
  it("prioritizes Arabic in mixed text", () => {
    expect(getTextDirection("Concrete خرسانة", "ltr")).toBe("rtl");
  });
  it("detects English independently of the interface", () => {
    expect(getTextDirection("Concrete", "rtl")).toBe("ltr");
  });
  it("keeps the interface direction for numeric text", () => {
    expect(getTextDirection("123.45", "rtl")).toBe("rtl");
    expect(getTextDirection("123.45", "ltr")).toBe("ltr");
  });
  it("preserves Saudi currency formatting in both languages", () => {
    expect(fmtSAR(1234.5, "en")).toBe("1,234.50 SAR");
    expect(fmtSAR(1234.5, "ar")).toBe("1,234.50 ر.س");
  });
});