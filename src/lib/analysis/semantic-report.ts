import type { AnalysisReport, Finding, FunctionMatch, OrganizationGraph, OrganizationalUnit, SemanticChange } from "../types";

export const changeLabels = {
  UNCHANGED: "Без изменений", REWORDING: "Переформулирована", CLARIFIED: "Уточнена", EXPANDED: "Расширена",
  NARROWED: "Сужена", ADDED: "Добавлена", REMOVED: "Удалена", TRANSFERRED: "Передана", SPLIT: "Разделена",
  MERGED: "Объединена", DUPLICATED: "Дублирование", RESPONSIBILITY_CHANGED: "Изменена ответственность",
  AUTHORITY_CHANGED: "Изменены полномочия", SCOPE_CHANGED: "Изменена область действия", CONDITION_CHANGED: "Изменены условия",
  POTENTIAL_GAP: "Возможный пробел", POTENTIAL_OVERLAP: "Возможное пересечение", POTENTIAL_CONFLICT: "Возможный конфликт", SPECIALIZED: "Специализирована",
};
export function changeToMatch(change: SemanticChange, units: OrganizationalUnit[]): FunctionMatch {
  const functions = units.flatMap((unit) => unit.functions);
  const before = functions.filter((fn) => change.oldFunctionIds.includes(fn.id));
  const after = functions.filter((fn) => change.newFunctionIds.includes(fn.id));
  const status = change.requiresHumanReview ? "review" : change.changeTypes.includes("POTENTIAL_GAP") ? "possibly_lost" : change.changeTypes.includes("ADDED") ? "new" : change.changeTypes.includes("TRANSFERRED") ? "moved" : change.changeTypes.every((type) => ["UNCHANGED", "REWORDING"].includes(type)) ? "preserved" : "modified";
  return { semanticChangeId: change.id, changeTypes: change.changeTypes, coverageScore: change.coverageScore, requiresHumanReview: change.requiresHumanReview,
    beforeId: before[0]?.id, afterId: after[0]?.id, beforeText: before.map((fn) => fn.originalText).join("\n"), afterText: after.map((fn) => fn.originalText).join("\n"),
    beforeUnit: [...new Set(before.map((fn) => fn.semantic?.actor || units.find((u) => u.id === fn.unitId)?.name))].join("; "),
    afterUnit: [...new Set(after.map((fn) => fn.semantic?.actor || units.find((u) => u.id === fn.unitId)?.name))].join("; "),
    status, confidence: change.confidence, reasoning: change.reasoning, beforeRefs: change.beforeRefs, afterRefs: change.afterRefs };
}
export function changeToFinding(change: SemanticChange, units: OrganizationalUnit[]): Finding | null {
  if (change.changeTypes.every((type) => ["UNCHANGED", "REWORDING"].includes(type)) && !change.requiresHumanReview) return null;
  const match = changeToMatch(change, units);
  const types = change.changeTypes;
  const type = types.includes("POTENTIAL_GAP") ? "lost_function" : types.includes("POTENTIAL_CONFLICT") ? "conflict_of_interest" : types.some((type) => ["DUPLICATED", "POTENTIAL_OVERLAP"].includes(type)) ? "duplicated_function" : types.includes("ADDED") ? "new_function" : types.includes("TRANSFERRED") ? "moved_function" : "modified_function";
  return { id: change.id, semanticChangeId: change.id, type, severity: type === "lost_function" || type === "conflict_of_interest" ? "high" : type === "duplicated_function" ? "medium" : "low",
    title: types.map((type) => changeLabels[type]).join(" + "), summary: match.beforeText || match.afterText || "Функция требует проверки",
    reasoning: change.reasoning, confidence: change.confidence, beforeRefs: change.beforeRefs, afterRefs: change.afterRefs,
    beforeUnit: match.beforeUnit, afterUnit: match.afterUnit, requiresHumanReview: change.requiresHumanReview, verification: change.verification,
    recommendation: change.requiresHumanReview ? "Проверьте цитаты, контекст и полноту покрытия функции. Зафиксируйте решение сотрудника." : "Подтвердите распределение ответственности по указанным источникам." };
}
export function buildOrganizationGraph(units: OrganizationalUnit[]): OrganizationGraph {
  const graph: OrganizationGraph = { nodes: [], edges: [] };
  for (const unit of units) {
    graph.nodes.push({ id: unit.id, label: unit.name, kind: "unit", side: unit.side });
    const parent = units.find((item) => item.documentId === unit.documentId && item.name === unit.parentUnit);
    if (parent) graph.edges.push({ from: unit.id, to: parent.id, relation: "reports_to", sourceRefs: unit.sourceRefs });
    const actors = new Map<string, string>();
    for (const fn of unit.functions) {
      graph.nodes.push({ id: fn.id, label: [fn.semantic?.action ?? fn.action, fn.semantic?.object ?? fn.object].filter(Boolean).join(" → "), kind: "function", side: unit.side });
      const actor = fn.semantic?.actor;
      if (!actor) continue;
      let actorId = actor === unit.name ? unit.id : actors.get(actor);
      if (!actorId) {
        actorId = `${unit.id}:role:${actors.size}`; actors.set(actor, actorId);
        graph.nodes.push({ id: actorId, label: actor, kind: "role", side: unit.side });
        // Unknown unit assignment is not promoted to a factual belongs_to edge.
        if (fn.semantic?.organizationalUnit === unit.name) graph.edges.push({ from: actorId, to: unit.id, relation: "belongs_to", sourceRefs: fn.sourceRefs });
      }
      graph.edges.push({ from: actorId, to: fn.id, relation: "performs", sourceRefs: fn.sourceRefs });
    }
  }
  return graph;
}
export function semanticReport(changes: SemanticChange[], units: OrganizationalUnit[]): AnalysisReport {
  const verified = changes.filter((change) => !change.requiresHumanReview && change.verification?.status === "SUPPORTED");
  const review = changes.length - verified.length;
  const count = (type: string) => verified.filter((change) => change.changeTypes.some((item) => item === type)).length;
  const citations = verified.flatMap((change) => [...change.beforeRefs, ...change.afterRefs]).slice(0, 6).map((ref) => `${ref.filename}, ${ref.section ? `п. ${ref.section}` : `фрагмент ${ref.chunkId}`}`).join("; ");
  return {
    executiveSummary: `Извлечено ${units.flatMap((u) => u.functions).length} функций. Проверено изменений: ${verified.length}. Требуют проверки сотрудником: ${review}.`,
    structuralChangesSummary: `По проверенным функциям: передач — ${count("TRANSFERRED")}, разделений — ${count("SPLIT")}, объединений — ${count("MERGED")}, расширений — ${count("EXPANDED")}, сужений — ${count("NARROWED")}.${citations ? ` Источники: ${citations}.` : " Недостаточно подтвержденных данных для системного вывода."}`,
    keyRisks: [`Возможных пробелов с проверенными источниками: ${count("POTENTIAL_GAP")}.`, `Спорных или неполных выводов: ${review}.`],
    recommendations: ["Проверить спорные функции и зафиксировать решение по каждой из них.", "Уточнить распределение полномочий и полноту комплекта документов."],
    conclusion: "Отсутствие формулировки или подразделения само по себе не подтверждает потерю функции. Итог опирается на проверенные смысловые связи и первоисточники.",
  };
}
