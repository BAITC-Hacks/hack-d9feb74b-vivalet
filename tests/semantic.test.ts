import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionItem, OrganizationalUnit, ParsedDocument, SemanticDecision } from "../src/lib/types";
import { compareFunctions, finalizeDecision, verifyChanges } from "../src/lib/analysis/semantic";
import { attachExtractedFunctions, extractAi } from "../src/lib/analysis/extract";
import { withHierarchy } from "../src/lib/analysis/hierarchy";
import { sourceRef } from "../src/lib/documents";
import { critique, extractFunctions } from "../src/lib/ai/client";
import { buildOrganizationGraph } from "../src/lib/analysis/semantic-report";
import { semanticMarkdown } from "../src/lib/analysis/export";

vi.mock("../src/lib/ai/client", () => ({ embed: vi.fn(async () => []), matchFunctions: vi.fn(), critique: vi.fn(), extractFunctions: vi.fn() }));
const config = { topCandidates: 5, reviewConfidence: .8, preservedCoverage: .9, partialCoverage: .6 };
const fn = (id: string, actor = "Директор", quote = "Проводит аудит информационных систем"): FunctionItem => ({ id, unitId: actor, originalText: quote, normalizedText: quote, action: "проводить", object: "аудит систем", sourceRefs: [], semantic: { actor, organizationalUnit: actor, action: "проводить", object: "аудит систем", authorityType: "duty", scope: ["информационные системы"], conditions: [], recipients: [], target: null, purpose: null, domain: "аудит", parentContext: "" } });
const decision = (oldFunctionIds: string[], newFunctionIds: string[], extra: Partial<SemanticDecision> = {}): SemanticDecision => ({ oldFunctionIds, newFunctionIds, changeTypes: ["REWORDING"], meaningPreserved: true, oldCoveredByNew: true, newCoveredByOld: true, actorChanged: false, authorityChanged: false, scopeChanged: false, conditionsChanged: false, purposeChanged: false, coverageScore: 1, confidence: .95, reasoning: "Смысл подтверждается исходными пунктами.", requiresHumanReview: false, ...extra });
const units = (before: FunctionItem[], after: FunctionItem[]): OrganizationalUnit[] => (["before", "after"] as const).map((side) => ({ id: side, documentId: side, side, name: side, normalizedName: side, roles: [], functions: side === "before" ? before : after, sourceRefs: [] }));
const docs = (): ParsedDocument[] => (["before", "after"] as const).map((side) => ({ id: side, filename: `${side}.docx`, side, type: "docx", size: 100, text: "", chunks: [{ id: `${side}-c`, documentId: side, text: "Директор проводит аудит систем", section: side === "before" ? "5.4.4" : "8.2.1" }] }));
beforeEach(() => vi.clearAllMocks());

describe("semantic pipeline acceptance contracts (model responses are controlled)", () => {
  it("rewording: always calls the semantic matcher even for identical wording", async () => {
    const matcher = vi.fn(async () => decision(["b"], ["a"]));
    const changes = await compareFunctions(units([fn("b")], [fn("a")]), "ai", undefined, matcher, { before: [], after: [] });
    expect(matcher).toHaveBeenCalledOnce();
    expect(changes[0].changeTypes).toEqual(["REWORDING"]);
    expect(changes[0].meaningPreserved).toBe(true);
  });
  it("transfer: changed actor cannot become removal plus addition", async () => {
    const changes = await compareFunctions(units([fn("b", "Директор направления")], [fn("a", "Директор ДОА")]), "ai", undefined, async () => decision(["b"], ["a"], { actorChanged: true }), { before: [], after: [] });
    expect(changes).toHaveLength(1);
    expect(changes[0].changeTypes).toContain("TRANSFERRED");
    expect(changes[0].changeTypes).not.toContain("POTENTIAL_GAP");
  });
  it("split: retains all covering functions", async () => {
    const changes = await compareFunctions(units([fn("b")], [fn("a1", "ИТ-аудит"), fn("a2", "Операционный аудит")]), "ai", undefined, async () => decision(["b"], ["a1", "a2"], { actorChanged: true }), { before: [], after: [] });
    expect(changes).toHaveLength(1);
    expect(changes[0].changeTypes).toContain("SPLIT");
    expect(changes[0].newFunctionIds).toEqual(["a1", "a2"]);
  });
  it("narrowing and expansion follow directional meaning coverage", () => {
    const narrow = finalizeDecision(decision(["b"], ["a"], { meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: true, coverageScore: .5, scopeChanged: true }), [fn("b")], [fn("a")], ["a"], ["a"], config);
    expect(narrow.changeTypes).toContain("NARROWED");
    expect(narrow.requiresHumanReview).toBe(true);
    const expanded = finalizeDecision(decision(["b"], ["a"], { newCoveredByOld: false, scopeChanged: true }), [fn("b")], [fn("a")], ["a"], ["a"], config);
    expect(expanded.changeTypes).toContain("EXPANDED");
  });
  it("possible loss: scans every new function and keeps an evidence review requirement", async () => {
    const after = Array.from({ length: 8 }, (_, i) => fn(`a${i}`));
    const matcher = vi.fn(async ({ before }: { before: FunctionItem[] }) => decision(before.map((f) => f.id), [], { meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, coverageScore: 0 }));
    const changes = await compareFunctions(units([fn("b")], after), "ai", undefined, matcher, { before: [], after: [] });
    const gap = changes.find((change) => change.oldFunctionIds.includes("b"))!;
    expect(gap.changeTypes).toEqual(["POTENTIAL_GAP"]);
    expect(gap.searchedAfterIds).toHaveLength(8);
    expect(gap.globalSearchComplete).toBe(true);
    expect(gap.requiresHumanReview).toBe(true);
  });
  it("recovers an equivalent outside the top five instead of reporting a gap", async () => {
    const after = Array.from({ length: 6 }, (_, i) => fn(`a${i}`));
    const changes = await compareFunctions(units([fn("b")], after), "ai", undefined, async ({ before, candidates }) => decision(before.map((fn) => fn.id), candidates.some((fn) => fn.id === "a5") ? ["a5"] : [], { actorChanged: true }), { before: [], after: [] });
    const recovered = changes.find((change) => change.oldFunctionIds.includes("b"))!;
    expect(recovered.newFunctionIds).toEqual(["a5"]);
    expect(recovered.changeTypes).not.toContain("POTENTIAL_GAP");
    expect(recovered.globalSearchComplete).toBe(true);
  });
  it("authority: may becoming must is flagged even if the model overlooks it", () => {
    const before = fn("b"); before.semantic!.authorityType = "optional";
    const change = finalizeDecision(decision(["b"], ["a"]), [before], [fn("a")], ["a"], ["a"], config);
    expect(change.changeTypes).toContain("AUTHORITY_CHANGED");
    expect(change.meaningPreserved).toBe(false);
    expect(change.requiresHumanReview).toBe(true);
  });
  it("moved clause: section numbers do not restrict retrieval", async () => {
    const documents = docs(); const before = fn("b"), after = fn("a");
    before.sourceRefs = [sourceRef(documents[0], documents[0].chunks[0])];
    after.sourceRefs = [sourceRef(documents[1], documents[1].chunks[0])];
    const changes = await compareFunctions(units([before], [after]), "ai", undefined, async () => decision(["b"], ["a"]), { before: [], after: [] });
    expect(changes[0].meaningPreserved).toBe(true);
    expect(changes[0].afterRefs[0].section).toBe("8.2.1");
  });
  it("merge: reconciles shared targets in a separate semantic decision", async () => {
    const matcher = vi.fn(async ({ before }: { before: FunctionItem[] }) => decision(before.map((fn) => fn.id), ["a"]));
    const changes = await compareFunctions(units([fn("b1"), fn("b2")], [fn("a")]), "ai", undefined, matcher, { before: [], after: [] });
    expect(changes).toHaveLength(1);
    expect(changes[0].oldFunctionIds).toEqual(["b1", "b2"]);
    expect(changes[0].changeTypes).toContain("MERGED");
    expect(matcher).toHaveBeenCalledTimes(3);
  });
  it("rejects foreign IDs and nonfinite confidence", () => {
    expect(() => finalizeDecision(decision(["b"], ["invented"]), [fn("b")], [fn("a")], [], ["a"], config)).toThrow();
    expect(() => finalizeDecision(decision(["b"], ["a"], { confidence: NaN }), [fn("b")], [fn("a")], [], ["a"], config)).toThrow();
  });
  it("rules never claim semantic verification or global completeness", async () => {
    const changes = await compareFunctions(units([fn("b")], [fn("a")]), "rules");
    expect(changes.every((c) => c.requiresHumanReview && !c.globalSearchComplete)).toBe(true);
  });
});

describe("hierarchy and extraction", () => {
  it("inherits actor across pages, resets siblings and preserves exact source text", () => {
    const chunks = withHierarchy(["5. Права и обязанности", "5.3. Директоры ДОА обязаны:", "5.3.3. готовить предложения", "5.4. Аудитор вправе:", "5.4.1. участвовать в проверке"].map((text, i) => ({ id: String(i), documentId: "d", text, page: i + 1 })));
    expect(chunks[2].parentChunkIds).toEqual(["0", "1"]);
    expect(chunks[2].sectionActor).toContain("Директоры ДОА");
    expect(chunks[4].parentContext).not.toContain("Директоры ДОА");
    expect(chunks[2].text).toBe("5.3.3. готовить предложения");
  });
  it("extracts multiple functions from the same clause and retains actor evidence", () => {
    const document = docs()[0];
    const extracted = units([], [])[0];
    const fact = { ...fn("f").semantic!, quote: document.chunks[0].text, chunkId: document.chunks[0].id };
    attachExtractedFunctions(document, document.chunks, [extracted], [fact, { ...fact, action: "контролировать" }]);
    expect(extracted.functions).toHaveLength(2);
    expect(extracted.functions[0].semantic?.authorityType).toBe("duty");
    expect(() => attachExtractedFunctions(document, document.chunks, [extracted], [{ ...fact, quote: "Выдуманная цитата" }])).toThrow();
  });
  it("AI processes rule-recognized and long chunks without truncation", async () => {
    const document = docs()[0];
    document.chunks[0].text = "5.1. Проведение аудита " + "систем ".repeat(300);
    vi.mocked(extractFunctions).mockResolvedValue({ functions: [], units: [] });
    await extractAi(document);
    expect(extractFunctions).toHaveBeenCalledOnce();
    const payload = vi.mocked(extractFunctions).mock.calls[0][0] as { chunks: { text: string }[] };
    expect(payload.chunks[0].text).toBe(document.chunks[0].text);
  });
});

describe("independent evidence verification", () => {
  it("demotes a refuted gap with a real counterexample", async () => {
    const documents = docs(), before = fn("b");
    before.sourceRefs = [sourceRef(documents[0], documents[0].chunks[0])];
    const change = finalizeDecision(decision(["b"], []), [before], [], ["a"], ["a"], config);
    vi.mocked(critique).mockResolvedValue({ status: "REFUTED", reason: "Функция закреплена в другом разделе.", evidence: [{ documentId: "after", chunkId: "after-c", quote: documents[1].chunks[0].text }] });
    await verifyChanges([change], documents, "ai");
    expect(change.verification?.status).toBe("REFUTED");
    expect(change.requiresHumanReview).toBe(true);
    expect(change.confidence).toBeLessThan(.6);
  });
  it("does not accept hallucinated evidence from the critic", async () => {
    const documents = docs(), before = fn("b"), after = fn("a");
    before.sourceRefs = [sourceRef(documents[0], documents[0].chunks[0])]; after.sourceRefs = [sourceRef(documents[1], documents[1].chunks[0])];
    const change = finalizeDecision(decision(["b"], ["a"]), [before], [after], ["a"], ["a"], config);
    vi.mocked(critique).mockResolvedValue({ status: "SUPPORTED", reason: "Есть цитата", evidence: [{ documentId: "after", chunkId: "after-c", quote: "Несуществующий текст" }] });
    await verifyChanges([change], documents, "ai");
    expect(change.verification?.status).toBe("UNCERTAIN");
    expect(change.requiresHumanReview).toBe(true);
  });
  it("exports semantic results and builds explicit functional edges", () => {
    const model = units([fn("b")], [fn("a")]);
    model[0].functions[0].semantic!.organizationalUnit = model[0].name;
    const graph = buildOrganizationGraph(model);
    expect(graph.edges.some((edge) => edge.relation === "performs" && edge.to === "b")).toBe(true);
    expect(graph.edges.some((edge) => edge.relation === "belongs_to")).toBe(true);
    const change = finalizeDecision(decision(["b"], ["a"]), [fn("b")], [fn("a")], ["a"], ["a"], config);
    expect(semanticMarkdown({ mode: "ai", units: model, semanticChanges: [change], functionMatches: [], unitMappings: [], findings: [], needsReview: [], report: { executiveSummary: "", structuralChangesSummary: "", keyRisks: [], recommendations: [], conclusion: "" } })).toContain("Переформулирована");
  });
});
