import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractFunctions } from "../src/lib/ai/client";
import { extractAi } from "../src/lib/analysis/extract";
import { sourceQuote } from "../src/lib/analysis/quote";
import type { ParsedDocument } from "../src/lib/types";

vi.mock("../src/lib/ai/client", () => ({ extractFunctions: vi.fn() }));
const document: ParsedDocument = { id: "d", filename: "regulation.docx", side: "before", type: "docx", size: 100, text: "", chunks: [
  { id: "intro", documentId: "d", text: "1. Положение о Блоке внутреннего аудита (далее – БВА)." },
  { id: "lead", documentId: "d", text: "1.1. Блок внутреннего аудита состоит из следующих структурных подразделений:" },
  { id: "unit", documentId: "d", text: "а. Отдел аудита (ОА)." },
  { id: "function", documentId: "d", text: "2.1. проводит\u00a0проверки." },
] };
const fact = { chunkId: "function", quote: "проводит проверки.", actor: "Отдел аудита", organizationalUnit: "Отдел аудита", action: "проводит", object: "проверки", target: null, purpose: null, scope: [], authorityType: "duty" as const, conditions: [], recipients: [], domain: null };
beforeEach(() => vi.resetAllMocks());

describe("extraction evidence recovery", () => {
  it("restores whitespace without accepting changed words, punctuation, or empty quotes", () => {
    expect(sourceQuote("А (Б)\n  В.", " А (Б) В. ")).toBe("А (Б)\n  В.");
    expect(sourceQuote("проводит проверки", "не проводит проверки")).toBeUndefined();
    expect(sourceQuote("А, Б", "А Б")).toBeUndefined();
    expect(sourceQuote("текст", " \n")).toBeUndefined();
  });
  it("keeps only explicitly listed units and literal function evidence", async () => {
    vi.mocked(extractFunctions).mockResolvedValue({ units: [{ name: "Выдуманный отдел", chunkId: "function", quote: "проводит проверки.", abbreviation: null, parentUnit: null, leaderRole: null, roles: [] }], functions: [fact] });
    const units = await extractAi(document);
    expect(extractFunctions).toHaveBeenCalledOnce();
    expect(units.filter((item) => !item.isRoot).map((item) => item.name)).toEqual(["Отдел аудита"]);
    const fn = units.flatMap((item) => item.functions).find((item) => item.semantic?.action === "проводит");
    expect(fn?.sourceRefs[0].quote).toBe("проводит\u00a0проверки.");
  });
  it("keeps rule extraction when a model fact has a foreign chunk ID", async () => {
    vi.mocked(extractFunctions).mockResolvedValue({ units: [], functions: [{ ...fact, chunkId: "foreign" }] });
    const units = await extractAi(document);
    expect(extractFunctions).toHaveBeenCalledOnce();
    expect(units.flatMap((item) => item.functions).some((item) => item.originalText === document.chunks[3].text)).toBe(true);
  });
  it("keeps rule extraction if the AI request fails", async () => {
    vi.mocked(extractFunctions).mockRejectedValue(new Error("service unavailable"));
    const units = await extractAi(document);
    expect(units.flatMap((item) => item.functions)).not.toHaveLength(0);
  });
});
