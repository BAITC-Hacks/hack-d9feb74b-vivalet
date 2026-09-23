import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractFunctions } from "../src/lib/ai/client";
import { attachExtractedFunctions, extractAi } from "../src/lib/analysis/extract";
import { sourceQuote } from "../src/lib/analysis/quote";
import type { ParsedDocument } from "../src/lib/types";

vi.mock("../src/lib/ai/client", () => ({ extractFunctions: vi.fn() }));
const document: ParsedDocument = { id: "d", filename: "regulation.docx", side: "before", type: "docx", size: 100, text: "", chunks: [{ id: "c", documentId: "d", text: "Отдел\u00a0аудита\nпроводит проверки." }] };
const unit = { name: "Отдел аудита", chunkId: "c", quote: "Отдел аудита", abbreviation: null, parentUnit: null, leaderRole: null, roles: [] };
beforeEach(() => vi.resetAllMocks());

describe("extraction evidence recovery", () => {
  it("restores whitespace without accepting changed words, punctuation, or empty quotes", () => {
    expect(sourceQuote("А (Б)\n  В.", " А (Б) В. ")).toBe("А (Б)\n  В.");
    expect(sourceQuote("проводит проверки", "не проводит проверки")).toBeUndefined();
    expect(sourceQuote("А, Б", "А Б")).toBeUndefined();
    expect(sourceQuote("текст", " \n")).toBeUndefined();
  });
  it("stores literal source quotes for units and functions", async () => {
    vi.mocked(extractFunctions).mockResolvedValue({ units: [unit], functions: [] });
    const units = await extractAi(document);
    expect(extractFunctions).toHaveBeenCalledOnce();
    expect(units.flatMap((item) => item.sourceRefs).some((ref) => ref.quote === "Отдел\u00a0аудита")).toBe(true);
    attachExtractedFunctions(document, document.chunks, units, [{ chunkId: "c", quote: "Отдел аудита проводит проверки.", actor: "Отдел аудита", organizationalUnit: null, action: "проводит", object: "проверки", target: null, purpose: null, scope: [], authorityType: "duty", conditions: [], recipients: [], domain: null }]);
    expect(units[0].functions[0].originalText).toBe(document.chunks[0].text);
    expect(units[0].functions[0].sourceRefs[0].quote).toBe(document.chunks[0].text);
  });
  it("retries invalid evidence before applying any of the batch", async () => {
    vi.mocked(extractFunctions)
      .mockResolvedValueOnce({ units: [{ ...unit, quote: "Выдуманная цитата" }], functions: [] })
      .mockResolvedValueOnce({ units: [unit], functions: [] });
    const units = await extractAi(document);
    expect(extractFunctions).toHaveBeenCalledTimes(2);
    expect(vi.mocked(extractFunctions).mock.calls[1][0]).toHaveProperty("validationFeedback");
    expect(units.flatMap((item) => item.sourceRefs).every((ref) => document.chunks[0].text.includes(ref.quote))).toBe(true);
  });
  it("rejects foreign chunk IDs after a bounded retry", async () => {
    vi.mocked(extractFunctions).mockResolvedValue({ units: [{ ...unit, chunkId: "foreign" }], functions: [] });
    await expect(extractAi(document)).rejects.toThrow("regulation.docx");
    expect(extractFunctions).toHaveBeenCalledTimes(2);
  });
});
