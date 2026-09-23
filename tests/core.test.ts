import { describe, expect, it } from "vitest";
import { chunkLines, chunkPdfPage, extractSection, parseDocument, sourceRef } from "../src/lib/documents";
import * as XLSX from "xlsx";
import { confidence, cosine, mapUnits, normalize } from "../src/lib/analysis/matching";
import { validRef, validateFinding } from "../src/lib/analysis/evidence";
import type { Finding, OrganizationalUnit, ParsedDocument } from "../src/lib/types";

describe("source locations", () => {
  it("extracts nested section numbers", () => { expect(extractSection("5.3.2. Проводит аудит")).toBe("5.3.2"); expect(extractSection("1. Общие положения")).toBe("1"); });
  it("keeps an exact quote and paragraph", () => {
    const chunks = chunkLines("doc", "1. Функции\n5.3.2. Проводит аудит систем");
    const doc: ParsedDocument = { id: "doc", filename: "x.docx", side: "before", type: "docx", size: 40, text: "", chunks };
    const ref = sourceRef(doc, chunks[1], "Проводит аудит систем");
    expect(ref.section).toBe("5.3.2"); expect(ref.paragraph).toBe(2); expect(validRef(ref, [doc])).toBe(true);
    expect(validRef({ ...ref, quote: "Несуществующая цитата" }, [doc])).toBe(false);
  });
  it("joins wrapped PDF lines while retaining page", () => {
    const chunks = chunkPdfPage("doc", 3, "2.4.1. проведение аудита\nинформационных систем;\n2.4.2. контроль качества");
    expect(chunks).toHaveLength(2); expect(chunks[0].page).toBe(3); expect(chunks[0].text).toContain("аудита информационных");
  });
  it("keeps physical XLSX row numbers after blanks", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Заголовок"], [], ["3.1. аудит систем"]]), "Лист1");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const parsed = await parseDocument("doc", "test.xlsx", "before", buffer);
    expect(parsed.chunks[1].rowStart).toBe(3);
  });
});
describe("matching and evidence", () => {
  it("calculates cosine and bounded confidence", () => { expect(cosine([1, 0], [1, 0])).toBe(1); expect(cosine([1, 0], [0, 1])).toBe(0); expect(confidence([1], 2)).toBeLessThan(1); expect(confidence([1], 0)).toBe(0); });
  it("maps equal units", () => {
    const unit = (id: string, side: "before" | "after"): OrganizationalUnit => ({ id, documentId: id, side, name: "Департамент аудита", normalizedName: normalize("Департамент аудита"), roles: [], functions: [], sourceRefs: [] });
    expect(mapUnits([unit("a", "before")], [unit("b", "after")])[0].transformation).toBe("unchanged");
  });
  it("rejects a loss without before evidence", () => {
    const finding: Finding = { id: "x", type: "lost_function", severity: "high", title: "x", summary: "x", reasoning: "x", confidence: 0.7, beforeRefs: [], afterRefs: [] };
    expect(validateFinding(finding, [])).toBe(false);
  });
  it("validates new_function with after evidence", () => {
    const doc: ParsedDocument = { id: "d2", filename: "after.docx", side: "after", type: "docx", size: 50, text: "", chunks: [{ id: "c1", documentId: "d2", text: "Осуществляет аудит кибербезопасности" }] };
    const ref = sourceRef(doc, doc.chunks[0], "Осуществляет аудит кибербезопасности");
    const finding: Finding = { id: "nf1", type: "new_function", severity: "info", title: "Новая функция", summary: "Аудит ИБ", reasoning: "Отсутствовала ранее", confidence: 0.75, beforeRefs: [], afterRefs: [ref] };
    expect(validateFinding(finding, [doc])).toBe(true);
  });
  it("requires both before and after evidence for duplicated_function and conflict_of_interest", () => {
    const doc1: ParsedDocument = { id: "d1", filename: "doc.docx", side: "after", type: "docx", size: 50, text: "", chunks: [{ id: "c1", documentId: "d1", text: "Контроль и аудит систем" }, { id: "c2", documentId: "d1", text: "Разработка и внедрение систем" }] };
    const ref1 = sourceRef(doc1, doc1.chunks[0], "Контроль и аудит систем");
    const ref2 = sourceRef(doc1, doc1.chunks[1], "Разработка и внедрение систем");
    const dupValid: Finding = { id: "dup1", type: "duplicated_function", severity: "medium", title: "Дублирование", summary: "Дублирование", reasoning: "Причина", confidence: 0.8, beforeRefs: [ref1], afterRefs: [ref2] };
    expect(validateFinding(dupValid, [doc1])).toBe(true);
    const dupInvalid: Finding = { ...dupValid, afterRefs: [] };
    expect(validateFinding(dupInvalid, [doc1])).toBe(false);
  });
  it("identifies unit removal and creation in mapUnits", () => {
    const beforeUnit: OrganizationalUnit = { id: "b1", documentId: "d1", side: "before", name: "Отдел аналитики", normalizedName: normalize("Отдел аналитики"), roles: [], functions: [], sourceRefs: [] };
    const afterUnit: OrganizationalUnit = { id: "a1", documentId: "d2", side: "after", name: "Служба роботизации", normalizedName: normalize("Служба роботизации"), roles: [], functions: [], sourceRefs: [] };
    const mappings = mapUnits([beforeUnit], [afterUnit]);
    const removed = mappings.find((m) => m.transformation === "removed");
    const created = mappings.find((m) => m.transformation === "created");
    expect(removed).toBeDefined();
    expect(created).toBeDefined();
  });
  it("utilizes unit abbreviations to enhance matching", () => {
    const beforeUnit: OrganizationalUnit = { id: "b1", documentId: "d1", side: "before", name: "Управление внутреннего контроля", normalizedName: normalize("Управление внутреннего контроля"), abbreviation: "УВК", roles: [], functions: [], sourceRefs: [] };
    const afterUnit: OrganizationalUnit = { id: "a1", documentId: "d2", side: "after", name: "Департамент комплаенс и контроля", normalizedName: normalize("Департамент комплаенс и контроля"), abbreviation: "УВК", roles: [], functions: [], sourceRefs: [] };
    const mappings = mapUnits([beforeUnit], [afterUnit]);
    expect(mappings.some((m) => m.beforeUnitIds.includes("b1") && m.afterUnitIds.includes("a1"))).toBe(true);
  });
  it("records every predecessor when two units merge", () => {
    const makeUnit = (id: string, side: "before" | "after"): OrganizationalUnit => ({ id, documentId: id, side, name: "Департамент аудита", normalizedName: normalize("Департамент аудита"), roles: [], functions: [], sourceRefs: [] });
    const mappings = mapUnits([makeUnit("b1", "before"), makeUnit("b2", "before")], [makeUnit("a1", "after")]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].transformation).toBe("merged");
    expect(mappings[0].beforeUnitIds).toEqual(["b1", "b2"]);
  });
});
