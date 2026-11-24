import { describe, it, expect } from "vitest";
import { matchHeaderField, parseSheet, normHeader } from "@/components/boq/import-excel-dialog";

describe("Excel BOQ Header Matching and Parsing", () => {
  it("normalizes Arabic text with tatweel and various spellings", () => {
    expect(normHeader("وصــف")).toBe("وصف");
    expect(normHeader("  البند - ITEM  ")).toBe("البند item");
    expect(normHeader("وحدة القياس - UNIT")).toBe("وحده القياس unit");
  });

  it("matches diverse Saudi tender and hospital column headers", () => {
    expect(matchHeaderField("البند - ITEM")).toBe("item_no");
    expect(matchHeaderField("وصــف البند - ITEM DESCRIPTION")).toBe("description_ar");
    expect(matchHeaderField("وحدة القياس - UNIT")).toBe("unit");
    expect(matchHeaderField("الفئة")).toBe("unit_rate");
    expect(matchHeaderField("الكمية")).toBe("quantity");
    expect(matchHeaderField("إجمالي التكلفه بالريال السعودي")).toBe("total");
    expect(matchHeaderField("م.")).toBe("item_no");
    expect(matchHeaderField("مسلسل")).toBe("item_no");
    expect(matchHeaderField("بيان الأعمال")).toBe("description_ar");
  });

  it("picks the true table header over early title banner with 2 words", () => {
    const sheetRows = [
      ["المملكة العربية السعودية - وزارة الصحة"],
      ["", "رقم المشروع : ", "مشروع مستشفى فيفا عام 50 سرير"],
      ["", "رقم ", "الوصـــــــــف", " إجمالي التكلفه بالريال السـعودي"], // Banner row
      ["", "", ""], // Empty
      ["الفئة", "البند - ITEM", "وحدة القياس - UNIT", "وصــف البند - ITEM DESCRIPTION", "المواصفات - Specs"], // True table header (Row 4)
      [1500, "01.01", "شهر", "أعمال الإشراف والإدارة الموقعية للمشروع", "مواصفات عامة"],
      [2500, "01.02", "مقطوعية", "توفير مكاتب الموقع وتجهيزاتها", "شاملة الأثاث"],
    ];

    const result = parseSheet(sheetRows, "القسم الاول - المتطلبات العامة");

    // Must pick Row 4 (index 4) because it has the comprehensive set of table columns
    expect(result.detectedHeaderIdx).toBe(4);
    expect(result.warnings.length).toBe(0);
    expect(result.data.length).toBe(2);
    expect(result.data[0]?.item_no).toBe("01.01");
    expect(result.data[0]?.unit).toBe("شهر");
    expect(result.data[0]?.description_ar).toContain("أعمال الإشراف");
    // Qty defaults to 1 when missing for items with unit / unit_rate
    expect(result.data[0]?.quantity).toBe(1);
    expect(result.data[0]?.material_cost).toBe(1500);
  });
});
