import { describe, it, expect } from "vitest";
import { csiDivisionCode, csiDivisionLabel } from "@/lib/csi-divisions";

describe("csiDivisionCode and Arabic ordinals", () => {
  it("resolves direct digits", () => {
    expect(csiDivisionCode("01")).toBe("01");
    expect(csiDivisionCode("القسم 03")).toBe("03");
    expect(csiDivisionCode("Div 26")).toBe("26");
  });

  it("resolves Arabic ordinal names from Saudi Ministry of Health sheets", () => {
    expect(csiDivisionCode("القسم الاول - المتطلبات العامة")).toBe("01");
    expect(csiDivisionCode("القسم الثاني-أعمال الموقع")).toBe("02");
    expect(csiDivisionCode("القسم الثالث-الاعمال الخرسانية")).toBe("03");
    expect(csiDivisionCode("القسم الرابع-اعمال البناء")).toBe("04");
    expect(csiDivisionCode("القسم الخامس-اعمال معدنية")).toBe("05");
    expect(csiDivisionCode("القسم السادس-اعمال الخشب و البل")).toBe("06");
    expect(csiDivisionCode("القسم السابع-حماية حرارة ورطوب")).toBe("07");
    expect(csiDivisionCode("القسم الثامن-الابواب والنوافذ")).toBe("08");
    expect(csiDivisionCode("القسم التاسع-التشطيبات")).toBe("09");
    expect(csiDivisionCode("القسم العاشر-أعمال الملحقات الخ")).toBe("10");
    expect(csiDivisionCode("القسم الثاني عشر-أثاث ومفروشا")).toBe("12");
    expect(csiDivisionCode("القسم الثالث-عشر تركيبات خا")).toBe("13");
    expect(csiDivisionCode("القسم الرابع عشر - أنظمة النقل")).toBe("14");
    expect(csiDivisionCode("القسم الخامس عشر (أ) التكييف")).toBe("23");
    expect(csiDivisionCode("القسم الخامس عشر(ب)مكافحةالحريق")).toBe("21");
    expect(csiDivisionCode("القسم الخامس عشر (جـ) الصحية")).toBe("22");
    expect(csiDivisionCode("القسم السادس عشر - الكهرباء")).toBe("26");
  });

  it("returns human-readable Arabic label", () => {
    const label = csiDivisionLabel("03", "ar");
    expect(label).toContain("03");
    expect(label).toContain("الخرسانة");
  });
});
