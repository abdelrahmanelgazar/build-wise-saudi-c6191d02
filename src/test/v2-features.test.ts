import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  arrayBufferToBase64,
  computeBoqReimportDiff,
  computeFileSha256,
  detectCarryForwardRowKind,
  writeBoqIntoOriginalWorkbook,
} from "../lib/excel-roundtrip";
import { scopeRowsByTender } from "../lib/tender-pricing-scope";
import { CSI_V2_EXPANSION_ASSEMBLIES } from "../lib/csi-v2-expansion-assemblies";
import { calculateBreakdownCost, DEFAULT_BREAKDOWN_TEMPLATES } from "../lib/breakdown-library";

describe("V2 Excel Roundtrip, Diff & Carry-Forward Detection", () => {
  it("computes deterministic SHA-256 hex digest for workbook buffer", async () => {
    const buf = new TextEncoder().encode("Taqdiri-BOQ-v2").buffer;
    const h1 = await computeFileSha256(buf);
    const h2 = await computeFileSha256(buf);
    expect(h1).toBe(h2);
    expect(h1.length).toBeGreaterThanOrEqual(16);
  });

  it("detects carry-forward, brought-forward, and summary rows in Arabic & English", () => {
    expect(detectCarryForwardRowKind("المجموع المرحل ما بعده", "", "", 0, false)).toBe("carry_forward");
    expect(detectCarryForwardRowKind("منقول من الصفحة السابقة ما قبله", "", "", 0, false)).toBe("brought_forward");
    expect(detectCarryForwardRowKind("Grand Total Section 03", "", "", 0, false)).toBe("summary");
    expect(detectCarryForwardRowKind("خرسانة مسلحة C35 للأساسات", "03-01-01", "م³", 715, false)).toBe("item");
  });

  it("matches re-imported BOQ rows across reordering and duplicate client numbers while preserving analysis links", () => {
    const existing = [
      { id: "id-a", item_no: "1", description_ar: "خرسانة مسلحة للأساسات C35", quantity: 100, sheet_name: "Concrete", sort_order: 1, manual_unit_price: null, note: null },
      { id: "id-b", item_no: "1", description_ar: "خرسانة عادية تحت القواعد C15", quantity: 50, sheet_name: "Concrete", sort_order: 2, manual_unit_price: 250, note: "سعر معتمد" },
      { id: "id-c", item_no: "2", description_ar: "أعمال مباني بلوك مصمت 20 سم", quantity: 200, sheet_name: "Concrete", sort_order: 3, manual_unit_price: null, note: null },
    ];
    const incoming = [
      { _tmpId: "t0", item_no: "1", description_ar: "خرسانة عادية تحت القواعد C15", quantity: 60, sheet_name: "Concrete", sort_order: 1 },
      { _tmpId: "t1", item_no: "1", description_ar: "خرسانة مسلحة للأساسات C35", quantity: 100, sheet_name: "Concrete", sort_order: 2 },
      { _tmpId: "t2", item_no: "3", description_ar: "عزل بيتوميني بارد للأساسات", quantity: 300, sheet_name: "Concrete", sort_order: 3 },
    ];

    const diff = computeBoqReimportDiff(existing, incoming, new Set(["id-a"]));
    expect(diff.matchedCount).toBe(2);
    expect(diff.qtyChangedCount).toBe(1); // id-b 50 -> 60
    expect(diff.reorderedCount).toBe(1); // id-a sort 1 -> 2
    expect(diff.addedCount).toBe(1); // item 3
    expect(diff.removedCount).toBe(1); // id-c
    expect(diff.preservedPricingCount).toBe(2); // id-a (analysis) + id-b (manual rate + note)
    expect(diff.matchedIdByIncomingKey.get("t0")).toBe("id-b");
    expect(diff.matchedIdByIncomingKey.get("t1")).toBe("id-a");
  });

  it("writes rates back into original Excel template while preserving formulas and hidden sheets", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["رقم البند", "الوصف", "الكمية", "السعر الإفرادي", "الإجمالي"],
      ["03-01-01", "خرسانة مسلحة C35", 715, "", ""],
    ]);
    ws["E2"] = { t: "n", f: "C2*D2", v: 0, z: "#,##0.00" };
    XLSX.utils.book_append_sheet(wb, ws, "Concrete");

    const hiddenWs = XLSX.utils.aoa_to_sheet([["RefNote", "Internal Rate Sheet"]]);
    XLSX.utils.book_append_sheet(wb, hiddenWs, "InternalRef");
    wb.Workbook = {
      Sheets: [{ name: "Concrete", Hidden: 0 }, { name: "InternalRef", Hidden: 1 }],
    };

    const outBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const b64 = arrayBufferToBase64(outBuf);

    const written = writeBoqIntoOriginalWorkbook({
      originalWorkbookB64: b64,
      rows: [
        {
          id: "row-1",
          item_no: "03-01-01",
          description_ar: "خرسانة مسلحة C35",
          quantity: 715,
          is_group: false,
          sheet_name: "Concrete",
          rate_cell_ref: "D2",
          total_cell_ref: "E2",
        },
      ],
      paSellingRates: new Map([["row-1", 100]]),
    });

    const outSheet = written.workbook.Sheets["Concrete"];
    expect(outSheet?.["D2"]?.v).toBe(100);
    expect(outSheet?.["E2"]?.f).toBe("C2*D2"); // Formula preserved
    expect(outSheet?.["E2"]?.v).toBe(71500); // Cached total updated
    expect(written.preservedFormulaCells).toBe(1);
    expect(written.workbook.Workbook?.Sheets?.[1]?.Hidden).toBe(1); // Hidden sheet preserved
  });
});

describe("Per-Tender Pricing Isolation & CSI V2 Expansion", () => {
  it("isolates baseline rows (tender_id=null) from specific tender opportunities", () => {
    const rows = [
      { id: "b1", tender_id: null },
      { id: "t1", tender_id: "tender-alpha" },
      { id: "t2", tender_id: "tender-beta" },
    ];
    expect(scopeRowsByTender(rows, null).map((r) => r.id)).toEqual(["b1"]);
    expect(scopeRowsByTender(rows, "tender-alpha").map((r) => r.id)).toEqual(["t1"]);
    expect(scopeRowsByTender(rows, "tender-beta").map((r) => r.id)).toEqual(["t2"]);
  });

  it("includes curated V2 expansion assemblies in DEFAULT_BREAKDOWN_TEMPLATES with valid direct & selling rates", () => {
    expect(CSI_V2_EXPANSION_ASSEMBLIES.length).toBeGreaterThanOrEqual(12);
    const allIds = new Set(DEFAULT_BREAKDOWN_TEMPLATES.map((t) => t.id));
    for (const tpl of CSI_V2_EXPANSION_ASSEMBLIES) {
      expect(allIds.has(tpl.id)).toBe(true);
      const calc = calculateBreakdownCost(tpl);
      expect(calc.directUnitCost).toBeGreaterThan(0);
      expect(calc.unitSellingPrice).toBeGreaterThanOrEqual(calc.directUnitCost);
    }
  });
});
