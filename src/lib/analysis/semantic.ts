import { critique, embed, matchFunctions } from "../ai/client";
import type { FunctionItem, OrganizationalUnit, ParsedDocument, SemanticChange, SemanticDecision, SourceReference, Verification } from "../types";
import { sourceRef } from "../documents";
import { validRef } from "./evidence";
import { cosine, functionSimilarity, similarity } from "./matching";

export type Matcher = (payload: { before: FunctionItem[]; candidates: FunctionItem[]; organization: unknown }) => Promise<SemanticDecision>;
export interface SemanticConfig { topCandidates: number; reviewConfidence: number; preservedCoverage: number; partialCoverage: number; }
export function semanticConfig(): SemanticConfig {
  const number = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Некорректная настройка ${name}.`);
    return value;
  };
  const config = { topCandidates: Math.floor(number("SEMANTIC_TOP_CANDIDATES", 5, 1, 50)), reviewConfidence: number("SEMANTIC_REVIEW_CONFIDENCE", .8, 0, 1), preservedCoverage: number("SEMANTIC_PRESERVED_COVERAGE", .9, 0, 1), partialCoverage: number("SEMANTIC_PARTIAL_COVERAGE", .6, 0, 1) };
  if (config.partialCoverage > config.preservedCoverage) throw new Error("Порог частичного покрытия превышает порог сохранения.");
  return config;
}
export function semanticText(fn: FunctionItem): string {
  const fact = fn.semantic;
  return fact ? [fact.action, fact.object, fact.target, fact.purpose, ...fact.scope, ...fact.conditions, fact.domain].filter(Boolean).join("; ") : fn.normalizedText;
}
export function rankCandidates(before: FunctionItem, after: FunctionItem[], vector?: number[], vectors: number[][] = []): FunctionItem[] {
  return after.map((fn, index) => ({ fn, score: .35 * functionSimilarity(before, fn) + .65 * (vector && vectors[index] ? cosine(vector, vectors[index]) : 0) }))
    .sort((a, b) => b.score - a.score).map(({ fn }) => fn);
}
function uniqueRefs(refs: SourceReference[]): SourceReference[] {
  return refs.filter((ref, index) => refs.findIndex((other) => other.documentId === ref.documentId && other.chunkId === ref.chunkId && other.quote === ref.quote) === index);
}
export function finalizeDecision(decision: SemanticDecision, before: FunctionItem[], candidates: FunctionItem[], searched: string[], allAfterIds: string[], config = semanticConfig()): SemanticChange {
  if (new Set(decision.oldFunctionIds).size !== before.length || before.some((fn) => !decision.oldFunctionIds.includes(fn.id)) || decision.oldFunctionIds.some((id) => !before.some((fn) => fn.id === id)) || new Set(decision.newFunctionIds).size !== decision.newFunctionIds.length || decision.newFunctionIds.some((id) => !candidates.some((fn) => fn.id === id))) throw new Error("Модель вернула неподтвержденные идентификаторы функций.");
  if (![decision.confidence, decision.coverageScore].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("Некорректная оценка семантического сопоставления.");
  const selected = candidates.filter((fn) => decision.newFunctionIds.includes(fn.id));
  const types = new Set(decision.changeTypes);
  const globalSearchComplete = allAfterIds.every((id) => searched.includes(id));
  if (before.length && !selected.length) {
    types.clear(); types.add("POTENTIAL_GAP");
    decision = { ...decision, meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, coverageScore: 0 };
  } else if (!before.length) {
    types.clear(); types.add("ADDED");
  } else {
    types.delete("POTENTIAL_GAP"); types.delete("REMOVED"); types.delete("ADDED");
    if (decision.actorChanged) types.add("TRANSFERRED");
    const oldAuthority = [...new Set(before.map((fn) => fn.semantic?.authorityType))].sort().join();
    const newAuthority = [...new Set(selected.map((fn) => fn.semantic?.authorityType))].sort().join();
    if (decision.authorityChanged || oldAuthority !== newAuthority) { types.add("AUTHORITY_CHANGED"); decision = { ...decision, authorityChanged: true }; }
    if (decision.conditionsChanged) types.add("CONDITION_CHANGED");
    if (decision.scopeChanged) types.add("SCOPE_CHANGED");
    if (decision.oldCoveredByNew && !decision.newCoveredByOld) types.add("EXPANDED");
    if (!decision.oldCoveredByNew && decision.newCoveredByOld) types.add("NARROWED");
    if (before.length === 1 && selected.length > 1 && !types.has("DUPLICATED") && !types.has("POTENTIAL_OVERLAP")) types.add("SPLIT");
    if (before.length > 1 && selected.length === 1 && decision.oldCoveredByNew) types.add("MERGED");
    if (types.size > 1) { types.delete("UNCHANGED"); types.delete("REWORDING"); }
    if (!types.size) types.add(decision.oldCoveredByNew && decision.newCoveredByOld ? "REWORDING" : "SCOPE_CHANGED");
  }
  const unknown = [...before, ...selected].some((fn) => !fn.semantic?.actor || fn.semantic.authorityType === "unknown");
  const inconsistent = decision.meaningPreserved && (!decision.oldCoveredByNew || decision.authorityChanged || decision.conditionsChanged);
  return { ...decision, id: crypto.randomUUID(), changeTypes: [...types], meaningPreserved: decision.meaningPreserved && !inconsistent,
    requiresHumanReview: decision.requiresHumanReview || unknown || inconsistent || decision.confidence < config.reviewConfidence || (before.length > 0 && decision.coverageScore < config.preservedCoverage) || (!selected.length && !globalSearchComplete),
    beforeRefs: uniqueRefs(before.flatMap((fn) => fn.sourceRefs)), afterRefs: uniqueRefs(selected.flatMap((fn) => fn.sourceRefs)),
    searchedAfterIds: [...new Set(searched)], globalSearchComplete };
}
export async function compareFunctions(units: OrganizationalUnit[], mode: "ai" | "rules", onProgress?: (message: string) => Promise<void>, matcher: Matcher = matchFunctions, vectors?: { before: number[][]; after: number[][] }): Promise<SemanticChange[]> {
  const before = units.filter((u) => u.side === "before").flatMap((u) => u.functions);
  const after = units.filter((u) => u.side === "after").flatMap((u) => u.functions);
  const organization = units.map(({ id, name, side, parentUnit, roles }) => ({ id, name, side, parentUnit, roles }));
  const config = semanticConfig();
  const embeddings = vectors ?? (mode === "ai" ? { before: await embed(before.map(semanticText)), after: await embed(after.map(semanticText)) } : { before: [], after: [] });
  const changes: SemanticChange[] = [];
  const allAfterIds = after.map((fn) => fn.id);
  for (const [index, fn] of before.entries()) {
    const ranked = rankCandidates(fn, after, embeddings.before[index], embeddings.after);
    if (mode === "rules") {
      const candidate = ranked[0];
      const related = candidate && functionSimilarity(fn, candidate) >= .52;
      changes.push(finalizeDecision({ oldFunctionIds: [fn.id], newFunctionIds: related ? [candidate.id] : [], changeTypes: [], meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, actorChanged: related ? fn.semantic?.actor !== candidate.semantic?.actor : false, authorityChanged: related ? fn.semantic?.authorityType !== candidate.semantic?.authorityType : false, scopeChanged: false, conditionsChanged: false, purposeChanged: false, coverageScore: 0, confidence: .4, reasoning: "Предварительный поиск по словам. Смысл, покрытие и возможная потеря требуют проверки сотрудником или запуска AI-анализа.", requiresHumanReview: true }, [fn], related ? [candidate] : [], [], allAfterIds, config));
      continue;
    }
    let candidates = ranked.slice(0, config.topCandidates);
    const searched = candidates.map((fn) => fn.id);
    let decision = await matcher({ before: [fn], candidates, organization });
    finalizeDecision(decision, [fn], candidates, searched, allAfterIds, config);
    // A shortlist can never establish absence. Scan every remaining function for gaps and partial coverage.
    if (!decision.newFunctionIds.length || !decision.oldCoveredByNew || decision.requiresHumanReview) {
      const relevant = new Set(decision.newFunctionIds);
      for (let offset = config.topCandidates; offset < ranked.length; offset += 20) {
        const batch = ranked.slice(offset, offset + 20);
        const found = await matcher({ before: [fn], candidates: batch, organization });
        finalizeDecision(found, [fn], batch, batch.map((item) => item.id), allAfterIds, config);
        found.newFunctionIds.forEach((id) => relevant.add(id));
        searched.push(...batch.map((item) => item.id));
        await onProgress?.(`Глобальная проверка функции ${index + 1}/${before.length}: ${searched.length}/${after.length}`);
      }
      candidates = after.filter((item) => relevant.has(item.id));
      decision = await matcher({ before: [fn], candidates, organization });
    }
    changes.push(finalizeDecision(decision, [fn], candidates, searched, allAfterIds, config));
    await onProgress?.(`Сопоставление подразделений и функций: ${index + 1}/${before.length}`);
  }
  if (mode === "ai") {
    // Reconcile connected groups: shared targets may represent merging, not repeated additions.
    const pending = [...changes];
    changes.length = 0;
    while (pending.length) {
      const group = [pending.shift()!];
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (let index = pending.length - 1; index >= 0; index--) if (pending[index].newFunctionIds.some((id) => group.some((change) => change.newFunctionIds.includes(id)))) {
          group.push(...pending.splice(index, 1)); expanded = true;
        }
      }
      if (group.length === 1) { changes.push(group[0]); continue; }
      const old = before.filter((fn) => group.some((change) => change.oldFunctionIds.includes(fn.id)));
      const next = after.filter((fn) => group.some((change) => change.newFunctionIds.includes(fn.id)));
      const decision = await matcher({ before: old, candidates: next, organization });
      changes.push(finalizeDecision(decision, old, next, group.every((change) => change.globalSearchComplete) ? allAfterIds : [], allAfterIds, config));
    }
  }
  for (const fn of after.filter((fn) => !changes.some((change) => change.newFunctionIds.includes(fn.id)))) {
    // A reverse global check prevents an unselected equivalent being mislabeled as a new function.
    let related = false;
    if (mode === "ai") for (let index = 0; index < before.length; index += 20) {
      const batch = before.slice(index, index + 20);
      const reverse = await matcher({ before: [fn], candidates: batch, organization });
      finalizeDecision(reverse, [fn], batch, batch.map((item) => item.id), before.map((item) => item.id), config);
      if (reverse.newFunctionIds.length) related = true;
    }
    const change = finalizeDecision({ oldFunctionIds: [], newFunctionIds: [fn.id], changeTypes: ["ADDED"], meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, actorChanged: false, authorityChanged: false, scopeChanged: false, conditionsChanged: false, purposeChanged: false, coverageScore: 0, confidence: mode === "ai" && !related ? .85 : .4, reasoning: related ? "Найдено обратное соответствие старым функциям; необходимо проверить пересечение или распределение ответственности." : "Смыслового соответствия в старой редакции не найдено.", requiresHumanReview: mode === "rules" || related }, [], [fn], [], allAfterIds, config);
    if (related) change.changeTypes = ["POTENTIAL_OVERLAP"];
    changes.push(change);
  }
  return changes;
}

export async function verifyChanges(changes: SemanticChange[], documents: ParsedDocument[], mode: "ai" | "rules", onProgress?: (message: string) => Promise<void>): Promise<void> {
  const afterChunks = documents.filter((d) => d.side === "after").flatMap((document) => document.chunks.map((chunk) => ({ filename: document.filename, ...chunk })));
  for (const [index, change] of changes.entries()) {
    const refs = [...change.beforeRefs, ...change.afterRefs];
    if (mode === "rules" || !refs.length || refs.some((ref) => !validRef(ref, documents))) {
      change.requiresHumanReview = true;
      change.verification = { status: "UNCERTAIN", reason: "Не выполнена смысловая проверка или недостаточно источников.", evidence: [] };
      continue;
    }
    const isGap = change.changeTypes.includes("POTENTIAL_GAP");
    const chunks = isGap ? afterChunks : refs.flatMap((ref) => {
      const chunk = documents.find((d) => d.id === ref.documentId)?.chunks.find((c) => c.id === ref.chunkId);
      return chunk ? [{ ...chunk, filename: ref.filename }] : [];
    });
    const batches: typeof chunks[] = [];
    let batch: typeof chunks = [], size = 0;
    for (const chunk of chunks) {
      if (batch.length && size + chunk.text.length > 18000) { batches.push(batch); batch = []; size = 0; }
      batch.push(chunk); size += chunk.text.length;
    }
    batches.push(batch);
    const checks: Verification[] = [];
    for (const [batchIndex, sourceChunks] of batches.entries()) {
      const output = await critique({ claim: change, chunks: sourceChunks, batch: batchIndex + 1, totalBatches: batches.length });
      const evidence = output.evidence.flatMap((ref) => {
        const document = documents.find((d) => d.id === ref.documentId);
        const chunk = document?.chunks.find((c) => c.id === ref.chunkId);
        return document && chunk && ref.quote.trim() && chunk.text.includes(ref.quote) ? [sourceRef(document, chunk, ref.quote)] : [];
      });
      const invalid = evidence.length !== output.evidence.length;
      const missingBefore = change.beforeRefs.length > 0 && !evidence.some((r) => change.beforeRefs.some((b) => b.chunkId === r.chunkId));
      const missingAfter = change.afterRefs.length > 0 && !evidence.some((r) => change.afterRefs.some((a) => a.chunkId === r.chunkId));
      const missing = output.status !== "UNCERTAIN" && (!evidence.length || (!isGap && (missingBefore || missingAfter)));
      checks.push({ status: invalid || missing ? "UNCERTAIN" : output.status, reason: invalid || missing ? "Проверка не предоставила достаточные точные источники. " + output.reason : output.reason, evidence });
      await onProgress?.(`Проверка потерь, пересечений и конфликтов: ${index + 1}/${changes.length}, пакет ${batchIndex + 1}/${batches.length}`);
    }
    const status = checks.some((c) => c.status === "REFUTED") ? "REFUTED" : checks.some((c) => c.status === "UNCERTAIN") ? "UNCERTAIN" : "SUPPORTED";
    change.verification = { status, reason: checks.map((c) => c.reason).join("\n"), evidence: uniqueRefs(checks.flatMap((c) => c.evidence)) };
    if (status !== "SUPPORTED" || (isGap && !change.globalSearchComplete)) {
      change.requiresHumanReview = true; change.confidence = Math.min(change.confidence, .59);
    }
  }
}

/** Retrieval proposes risk pairs; only the independent source-based critic can support them. */
export async function findFunctionalRisks(units: OrganizationalUnit[], mode: "ai" | "rules"): Promise<SemanticChange[]> {
  const after = units.filter((u) => u.side === "after").flatMap((u) => u.functions);
  const vectors = mode === "ai" ? await embed(after.map(semanticText)) : [];
  const proposals: SemanticChange[] = [];
  for (const [index, left] of after.entries()) {
    const candidates = after.slice(index + 1).map((right, offset) => ({ right, score: Math.max(functionSimilarity(left, right), vectors[index] && vectors[index + offset + 1] ? cosine(vectors[index], vectors[index + offset + 1]) : 0) }))
      .filter(({ right, score }) => score >= .65 || similarity(left.object ?? "", right.object ?? "") >= .4).sort((a, b) => b.score - a.score).slice(0, 5);
    for (const { right } of candidates) {
      const conflict = left.unitId === right.unitId && left.category !== right.category && [left.category, right.category].includes("oversight");
      const overlap = left.semantic?.actor !== right.semantic?.actor;
      if (!conflict && !overlap) continue;
      proposals.push({ id: crypto.randomUUID(), oldFunctionIds: [], newFunctionIds: [left.id, right.id], changeTypes: [conflict ? "POTENTIAL_CONFLICT" : "POTENTIAL_OVERLAP"], meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, actorChanged: false, authorityChanged: false, scopeChanged: false, conditionsChanged: false, purposeChanged: false,
        coverageScore: 0, confidence: mode === "ai" ? .8 : .4, requiresHumanReview: mode === "rules", searchedAfterIds: [], globalSearchComplete: false,
        reasoning: conflict ? "Возможное совмещение исполнения и контроля связанной деятельности. Необходимо проверить предмет контроля и независимость." : "Возможное пересечение ответственности разных исполнителей. Необходимо отличить дублирование от дополняющих функций и разных областей действия.",
        beforeRefs: left.sourceRefs, afterRefs: right.sourceRefs });
    }
  }
  return proposals;
}
