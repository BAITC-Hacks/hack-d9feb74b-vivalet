import { critique, embed, matchFunctions } from "../ai/client";
import type { FunctionItem, OrganizationalUnit, ParsedDocument, SemanticChange, SemanticDecision, SourceReference } from "../types";
import { sourceRef } from "../documents";
import { validRef } from "./evidence";
import { cosine, functionSimilarity, normalize, similarity } from "./matching";

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
  let embeddings: { before: number[][]; after: number[][] } = vectors ?? { before: [], after: [] };
  if (mode === "ai" && !vectors) try {
    const [old, next] = await Promise.all([embed(before.map(semanticText)), embed(after.map(semanticText))]);
    embeddings = { before: old, after: next };
  } catch { embeddings = { before: [], after: [] }; }
  const changes: SemanticChange[] = [];
  const allAfterIds = after.map((fn) => fn.id);
  const exactUsed = new Set<string>();
  for (let offset = 0; offset < before.length; offset += 4) {
    await Promise.all(before.slice(offset, offset + 4).map(async (fn, localIndex) => {
    const index = offset + localIndex;
    const exact = after.find((candidate) => !exactUsed.has(candidate.id)
      && normalize(fn.originalText) === normalize(candidate.originalText)
      && normalize(fn.semantic?.actor ?? "") === normalize(candidate.semantic?.actor ?? "")
      && normalize(fn.semantic?.organizationalUnit ?? "") === normalize(candidate.semantic?.organizationalUnit ?? "")
      && fn.semantic?.authorityType === candidate.semantic?.authorityType);
    if (exact && mode === "ai" && fn.semantic?.actor && fn.semantic.authorityType !== "unknown") {
      exactUsed.add(exact.id);
      const preserved = finalizeDecision({ oldFunctionIds: [fn.id], newFunctionIds: [exact.id], changeTypes: ["UNCHANGED"], meaningPreserved: true, oldCoveredByNew: true, newCoveredByOld: true, actorChanged: false, authorityChanged: false, scopeChanged: false, conditionsChanged: false, purposeChanged: false, coverageScore: 1, confidence: .99, reasoning: "Формулировка, исполнитель и полномочие совпадают дословно.", requiresHumanReview: false }, [fn], [exact], [exact.id], allAfterIds, config);
      preserved.verification = { status: "SUPPORTED", reason: "Совпали точный текст, исполнитель и тип полномочия.", evidence: [...preserved.beforeRefs, ...preserved.afterRefs] };
      changes.push(preserved);
      return;
    }
    const ranked = rankCandidates(fn, after, embeddings.before[index], embeddings.after);
    if (mode === "rules") {
      const candidate = ranked[0];
      const related = candidate && functionSimilarity(fn, candidate) >= .52;
      changes.push(finalizeDecision({ oldFunctionIds: [fn.id], newFunctionIds: related ? [candidate.id] : [], changeTypes: [], meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, actorChanged: related ? fn.semantic?.actor !== candidate.semantic?.actor : false, authorityChanged: related ? fn.semantic?.authorityType !== candidate.semantic?.authorityType : false, scopeChanged: false, conditionsChanged: false, purposeChanged: false, coverageScore: 0, confidence: .4, reasoning: "Предварительный поиск по словам. Смысл, покрытие и возможная потеря требуют проверки сотрудником или запуска AI-анализа.", requiresHumanReview: true }, [fn], related ? [candidate] : [], [], allAfterIds, config));
      return;
    }
    const candidates = ranked.slice(0, Math.max(config.topCandidates, 12));
    const searched = candidates.map((fn) => fn.id);
    try {
      const decision = await matcher({ before: [fn], candidates, organization });
      const change = finalizeDecision(decision, [fn], candidates, searched, allAfterIds, config);
      if (!change.newFunctionIds.length && !change.globalSearchComplete) change.requiresHumanReview = true;
      changes.push(change);
    } catch {
      changes.push(finalizeDecision({ oldFunctionIds: [fn.id], newFunctionIds: [], changeTypes: ["POTENTIAL_GAP"], meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, actorChanged: false, authorityChanged: false, scopeChanged: false, conditionsChanged: false, purposeChanged: false, coverageScore: 0, confidence: .3, reasoning: "Сопоставление не завершилось; требуется ручная проверка.", requiresHumanReview: true }, [fn], [], searched, allAfterIds, config));
    }
    await onProgress?.(`Сопоставление подразделений и функций: ${index + 1}/${before.length}`);
    }));
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
      try {
        const decision = await matcher({ before: old, candidates: next, organization });
        changes.push(finalizeDecision(decision, old, next, group.every((change) => change.globalSearchComplete) ? allAfterIds : [], allAfterIds, config));
      } catch { changes.push(...group.map((change) => ({ ...change, requiresHumanReview: true }))); }
    }
  }
  for (const fn of after.filter((fn) => !changes.some((change) => change.newFunctionIds.includes(fn.id)))) {
    const change = finalizeDecision({ oldFunctionIds: [], newFunctionIds: [fn.id], changeTypes: ["ADDED"], meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, actorChanged: false, authorityChanged: false, scopeChanged: false, conditionsChanged: false, purposeChanged: false, coverageScore: 0, confidence: .4, reasoning: "Соответствие в проверенных кандидатах не найдено; требуется проверка остальных функций старой редакции.", requiresHumanReview: true }, [], [fn], [], allAfterIds, config);
    changes.push(change);
  }
  return changes;
}

export async function verifyChanges(changes: SemanticChange[], documents: ParsedDocument[], mode: "ai" | "rules", onProgress?: (message: string) => Promise<void>): Promise<void> {
  let completed = 0;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, changes.length) }, async () => {
    while (cursor < changes.length) {
      const change = changes[cursor++];
      const refs = [...change.beforeRefs, ...change.afterRefs];
      if (change.verification?.status === "SUPPORTED" && refs.every((ref) => validRef(ref, documents))) {
        completed++;
        continue;
      }
      const isGap = change.changeTypes.includes("POTENTIAL_GAP");
      if (mode === "rules" || !refs.length || refs.some((ref) => !validRef(ref, documents)) || (isGap && !change.globalSearchComplete)) {
        change.requiresHumanReview = true;
        change.verification = { status: "UNCERTAIN", reason: isGap ? "Поиск ограничен кандидатами; отсутствие функции в новом документе не доказано." : "Не выполнена смысловая проверка или недостаточно источников.", evidence: [] };
        completed++;
        continue;
      }
      const selected = uniqueRefs([change.beforeRefs[0], change.beforeRefs.at(-1), change.afterRefs[0], change.afterRefs.at(-1)].filter((ref): ref is SourceReference => !!ref));
      const chunks = (isGap ? documents.filter((document) => document.side === "after").flatMap((document) => document.chunks.map((chunk) => ({ documentId: document.id, chunkId: chunk.id, filename: document.filename }))) : selected).flatMap((ref) => {
        const chunk = documents.find((document) => document.id === ref.documentId)?.chunks.find((item) => item.id === ref.chunkId);
        return chunk ? [{ ...chunk, filename: ref.filename }] : [];
      });
      try {
        const output = await critique({ claim: change, chunks });
        const evidence = output.evidence.flatMap((ref) => {
          const document = documents.find((item) => item.id === ref.documentId);
          const chunk = document?.chunks.find((item) => item.id === ref.chunkId);
          return document && chunk && ref.quote.trim() && chunk.text.includes(ref.quote) ? [sourceRef(document, chunk, ref.quote)] : [];
        });
        const supported = output.status === "SUPPORTED" && evidence.length === output.evidence.length && evidence.length > 0
          && (!change.beforeRefs.length || evidence.some((ref) => change.beforeRefs.some((item) => item.chunkId === ref.chunkId)))
          && (!change.afterRefs.length || evidence.some((ref) => change.afterRefs.some((item) => item.chunkId === ref.chunkId)));
        change.verification = { status: supported ? "SUPPORTED" : output.status === "REFUTED" ? "REFUTED" : "UNCERTAIN", reason: output.reason, evidence: uniqueRefs(evidence) };
      } catch {
        change.verification = { status: "UNCERTAIN", reason: "Проверка источников не завершилась; требуется решение сотрудника.", evidence: [] };
      }
      if (change.verification.status !== "SUPPORTED") {
        change.requiresHumanReview = true;
        change.confidence = Math.min(change.confidence, .59);
      }
      completed++;
      if (completed % 5 === 0 || completed === changes.length) await onProgress?.(`Проверка потерь, пересечений и конфликтов: ${completed}/${changes.length}`);
    }
  }));
}

/** Retrieval proposes risk pairs; only the independent source-based critic can support them. */
export async function findFunctionalRisks(units: OrganizationalUnit[], mode: "ai" | "rules"): Promise<SemanticChange[]> {
  const after = units.filter((u) => u.side === "after").flatMap((u) => u.functions);
  let vectors: number[][] = [];
  if (mode === "ai") try { vectors = await embed(after.map(semanticText)); } catch { vectors = []; }
  const proposals: { change: SemanticChange; score: number }[] = [];
  for (const [index, left] of after.entries()) {
    const candidates = after.slice(index + 1).map((right, offset) => ({ right, score: Math.max(functionSimilarity(left, right), vectors[index] && vectors[index + offset + 1] ? cosine(vectors[index], vectors[index + offset + 1]) : 0) }))
      .filter(({ right, score }) => score >= .65 || similarity(left.object ?? "", right.object ?? "") >= .4).sort((a, b) => b.score - a.score).slice(0, 5);
    for (const { right, score } of candidates) {
      const conflict = left.unitId === right.unitId && left.category !== right.category && [left.category, right.category].includes("oversight");
      const overlap = left.semantic?.actor !== right.semantic?.actor;
      if (!conflict && !overlap) continue;
      proposals.push({ score, change: { id: crypto.randomUUID(), oldFunctionIds: [], newFunctionIds: [left.id, right.id], changeTypes: [conflict ? "POTENTIAL_CONFLICT" : "POTENTIAL_OVERLAP"], meaningPreserved: false, oldCoveredByNew: false, newCoveredByOld: false, actorChanged: false, authorityChanged: false, scopeChanged: false, conditionsChanged: false, purposeChanged: false,
        coverageScore: 0, confidence: mode === "ai" ? .8 : .4, requiresHumanReview: mode === "rules", searchedAfterIds: [], globalSearchComplete: false,
        reasoning: conflict ? "Возможное совмещение исполнения и контроля связанной деятельности. Необходимо проверить предмет контроля и независимость." : "Возможное пересечение ответственности разных исполнителей. Необходимо отличить дублирование от дополняющих функций и разных областей действия.",
        beforeRefs: left.sourceRefs, afterRefs: right.sourceRefs } });
    }
  }
  return proposals.sort((a, b) => b.score - a.score).slice(0, 30).map(({ change }) => change);
}
