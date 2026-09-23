import { aiEnabled, embed, synthesize, verifyBatch, type VerificationCase, type VerificationDecision } from "../ai/client";
import { prisma } from "../db";
import type { AnalysisResult, Finding, FunctionItem, FunctionMatch, OrganizationalUnit, ParsedDocument } from "../types";
import { validateFinding } from "./evidence";
import { extractAi, extractRules } from "./extract";
import { confidence, cosine, functionSimilarity, mapUnits, similarity } from "./matching";

function resultReport(units: OrganizationalUnit[], findings: Finding[], mappingsCount: number) {
  const before = units.filter((unit) => unit.side === "before").length;
  const after = units.filter((unit) => unit.side === "after").length;
  const lost = findings.filter((finding) => finding.type === "lost_function").length;
  const duplicates = findings.filter((finding) => finding.type === "duplicated_function").length;
  const conflicts = findings.filter((finding) => finding.type === "conflict_of_interest").length;
  return {
    executiveSummary: `По предоставленным документам выявлено ${before} подразделений до и ${after} после реорганизации. Сформировано ${mappingsCount} сопоставлений.`,
    structuralChangesSummary: `Анализ показывает изменения в названиях и распределении функций. Подробности и источники приведены в сопоставлениях.`,
    keyRisks: [`Потенциально потерянных функций: ${lost}.`, `Возможных пересечений: ${duplicates}.`, `Потенциальных конфликтов интересов: ${conflicts}.`],
    recommendations: ["Проверить каждую потенциальную потерю по полному комплекту документов.", "Уточнить ответственность за пересекающиеся функции и документировать распределение полномочий."],
    conclusion: "Выводы сформированы по загруженным документам и требуют проверки ответственным сотрудником.",
  };
}
function finding(type: Finding["type"], title: string, summary: string, reasoning: string, before: FunctionItem | undefined, after: FunctionItem | undefined, beforeUnit?: string, afterUnit?: string, score = 0.7): Finding {
  const severity = type === "lost_function" || type === "conflict_of_interest" ? "high" as const : type === "duplicated_function" ? "medium" as const : "low" as const;
  return { id: crypto.randomUUID(), type, severity, title, summary, reasoning, confidence: score, beforeRefs: before?.sourceRefs ?? [], afterRefs: after?.sourceRefs ?? [], beforeUnit, afterUnit, recommendation: "Проверить вывод по указанным источникам и уточнить распределение ответственности." };
}
export async function runAnalysis(id: string): Promise<void> {
  const stage = async (name: string, reset = false) => prisma.analysis.update({ where: { id }, data: { status: "running", stage: name, error: null, ...(reset ? { result: null } : {}) } });
  try {
    await stage("Чтение и проверка документов", true);
    const records = await prisma.document.findMany({ where: { analysisId: id } });
    const documents: ParsedDocument[] = records.map((record) => ({ id: record.id, filename: record.filename, side: record.side as "before" | "after", type: record.type as "pdf" | "docx" | "xlsx", size: record.size, text: record.text, chunks: JSON.parse(record.chunks) }));
    if (!documents.some((document) => document.side === "before") || !documents.some((document) => document.side === "after")) throw new Error("Нужен хотя бы один документ для каждой стороны сравнения.");
    await stage("Извлечение структуры и функций");
    const mode: AnalysisResult["mode"] = aiEnabled() ? "ai" : "rules";
    const units: OrganizationalUnit[] = [];
    for (const [index, document] of documents.entries()) {
      const extracted = mode === "ai"
        ? await extractAi(document, async (done, total) => { await stage(`Извлечение структуры и функций: документ ${index + 1}/${documents.length}, пакет ${done}/${total}`); })
        : extractRules(document);
      units.push(...extracted);
    }
    if (!units.length) throw new Error("Не удалось выделить подразделения из документов.");
    const beforeUnits = units.filter((unit) => unit.side === "before"); const afterUnits = units.filter((unit) => unit.side === "after");
    await stage("Сопоставление подразделений и функций");
    const unitMappings = mapUnits(beforeUnits, afterUnits);
    const beforeItems = beforeUnits.flatMap((unit) => unit.functions.map((fn) => ({ fn, unit })));
    const afterItems = afterUnits.flatMap((unit) => unit.functions.map((fn) => ({ fn, unit })));
    const beforeVectors = mode === "ai" ? await embed(beforeItems.map(({ fn }) => fn.normalizedText)) : [];
    const afterVectors = mode === "ai" ? await embed(afterItems.map(({ fn }) => fn.normalizedText)) : [];
    const candidateRows = beforeItems.map((item, index) => afterItems.map((other, j) => ({ other, lexical: functionSimilarity(item.fn, other.fn), semantic: beforeVectors[index] && afterVectors[j] ? cosine(beforeVectors[index], afterVectors[j]) : 0 })).sort((a, b) => (b.lexical * 0.5 + b.semantic * 0.5) - (a.lexical * 0.5 + a.semantic * 0.5)).slice(0, 5));
    const decisions = new Map<string, VerificationDecision>();
    if (mode === "ai") {
      const cases: VerificationCase[] = beforeItems.flatMap((item, index) => {
        const candidates = candidateRows[index].filter((candidate) => candidate.lexical >= 0.35 || candidate.semantic >= 0.68).slice(0, 1);
        if (!candidates.length || (candidates[0].lexical >= 0.78 && item.fn.action === candidates[0].other.fn.action)) return [];
        return [{ beforeId: item.fn.id, before: item.fn.originalText.slice(0, 650), candidates: candidates.map((candidate) => ({ afterId: candidate.other.fn.id, after: candidate.other.fn.originalText.slice(0, 650) })) }];
      });
      const batches: VerificationCase[][] = [];
      for (let index = 0; index < cases.length; index += 10) batches.push(cases.slice(index, index + 10));
      for (let index = 0; index < batches.length; index += 3) {
        const wave = batches.slice(index, index + 3);
        const results = await Promise.all(wave.map((batch) => verifyBatch(batch)));
        for (const [position, output] of results.entries()) {
          const batch = wave[position];
          for (const decision of output) {
            const sourceCase = batch.find((item) => item.beforeId === decision.beforeId);
            if (sourceCase && (decision.afterId === "" || sourceCase.candidates.some((candidate) => candidate.afterId === decision.afterId))) decisions.set(decision.beforeId, decision);
          }
        }
        await stage(`Сопоставление подразделений и функций: проверено ${Math.min(index + wave.length, batches.length)}/${batches.length} групп`);
      }
    }
    const matches: FunctionMatch[] = []; const matchedAfter = new Set<string>();
    for (const [index, item] of beforeItems.entries()) {
      const candidates = candidateRows[index];
      let selected: typeof candidates[number] | undefined;
      let relation: "same" | "modified" | "unrelated" = "unrelated";
      let reasoning = "Явного функционального соответствия в документах после реорганизации не найдено.";
      if (mode === "ai") {
        const exact = candidates.find((candidate) => candidate.lexical >= 0.78 && item.fn.action === candidate.other.fn.action);
        const decision = decisions.get(item.fn.id);
        if (exact) { selected = exact; relation = "same"; reasoning = "Высокое текстовое сходство действия и объекта функции; требуется проверка контекста."; }
        else if (decision && decision.relation !== "unrelated") {
          selected = candidates.find((candidate) => candidate.other.fn.id === decision.afterId);
          if (selected) { relation = decision.relation; reasoning = decision.reasoning; }
        }
      } else {
        for (const candidate of candidates) {
          if (candidate.lexical >= 0.52 && item.fn.action === candidate.other.fn.action) {
            relation = candidate.lexical >= 0.82 ? "same" : "modified";
            reasoning = "Сходство действия и объекта функции по тексту документов. Требует проверки сотрудником.";
            selected = candidate; break;
          }
        }
      }
      const status = selected ? (item.unit.normalizedName !== selected.other.unit.normalizedName ? "moved" : relation === "same" ? "preserved" : "modified") : "possibly_lost";
      if (selected) matchedAfter.add(selected.other.fn.id);
      matches.push({ beforeId: item.fn.id, afterId: selected?.other.fn.id, beforeText: item.fn.originalText, afterText: selected?.other.fn.originalText, beforeUnit: item.unit.name, afterUnit: selected?.other.unit.name, status, confidence: selected ? confidence([selected.lexical, selected.semantic || selected.lexical], 2) : 0.72, reasoning, beforeRefs: item.fn.sourceRefs, afterRefs: selected?.other.fn.sourceRefs ?? [] });
    }
    for (const item of afterItems.filter(({ fn }) => !matchedAfter.has(fn.id))) matches.push({ afterId: item.fn.id, afterText: item.fn.originalText, afterUnit: item.unit.name, status: "new", confidence: 0.7, reasoning: "Соответствие до реорганизации явно не найдено.", beforeRefs: [], afterRefs: item.fn.sourceRefs });
    await stage("Проверка потерь, пересечений и конфликтов");
    const proposed: Finding[] = [];
    for (const match of matches) {
      const b = beforeItems.find(({ fn }) => fn.id === match.beforeId)?.fn;
      const a = afterItems.find(({ fn }) => fn.id === match.afterId)?.fn;
      if (match.status === "possibly_lost" && b) proposed.push(finding("lost_function", "Потенциальная потеря функции", b.originalText, match.reasoning, b, undefined, match.beforeUnit, undefined, match.confidence));
      if (match.status === "moved" && b && a) proposed.push(finding("moved_function", "Возможное перемещение функции", b.originalText, match.reasoning, b, a, match.beforeUnit, match.afterUnit, match.confidence));
      if (match.status === "modified" && b && a) proposed.push(finding("modified_function", "Изменение функции", b.originalText, match.reasoning, b, a, match.beforeUnit, match.afterUnit, match.confidence));
    }
    // structural_change findings from unit mappings
    const structuralLabels: Record<string, string> = { renamed: "Переименование", transformed: "Преобразование", split: "Разделение", merged: "Объединение", removed: "Ликвидация", created: "Создание" };
    for (const mapping of unitMappings) {
      if (mapping.transformation === "unchanged") continue;
      const bUnits = units.filter((u) => mapping.beforeUnitIds.includes(u.id));
      const aUnits = units.filter((u) => mapping.afterUnitIds.includes(u.id));
      const beforeName = bUnits.map((u) => u.name).join(", ") || "—";
      const afterName = aUnits.map((u) => u.name).join(", ") || "—";
      const severity = mapping.transformation === "removed" ? "high" as const : ["split", "merged", "created"].includes(mapping.transformation) ? "medium" as const : "low" as const;
      proposed.push({ id: crypto.randomUUID(), type: "structural_change", severity, title: `${structuralLabels[mapping.transformation] ?? mapping.transformation}: ${beforeName !== "—" ? beforeName : afterName}`, summary: mapping.explanation, reasoning: mapping.transformation === "removed" ? `Подразделение «${beforeName}» отсутствует в документах после реорганизации.` : mapping.transformation === "created" ? `Подразделение «${afterName}» отсутствует в документах до реорганизации.` : `${beforeName} → ${afterName}`, confidence: mapping.confidence, beforeRefs: bUnits.flatMap((u) => u.sourceRefs), afterRefs: aUnits.flatMap((u) => u.sourceRefs), beforeUnit: beforeName !== "—" ? beforeName : undefined, afterUnit: afterName !== "—" ? afterName : undefined, recommendation: "Проверить полноту документов и подтвердить реорганизацию ответственным сотрудником." });
    }
    // duplicated_function: left.fn in before slot, right.fn in after slot (so UI shows two distinct sources)
    for (let i = 0; i < afterItems.length; i++) for (let j = i + 1; j < afterItems.length; j++) {
      const left = afterItems[i]; const right = afterItems[j];
      const lexical = functionSimilarity(left.fn, right.fn);
      if (left.unit.id !== right.unit.id && lexical >= 0.72 && left.fn.action === right.fn.action) {
        proposed.push(finding("duplicated_function", "Возможное дублирование функций", `${left.fn.originalText} / ${right.fn.originalText}`, `Похожие действия закреплены за «${left.unit.name}» и «${right.unit.name}». Требует проверки.`, left.fn, right.fn, left.unit.name, right.unit.name, confidence([lexical], 2)));
      }
      if (left.unit.id === right.unit.id && left.fn.category !== right.fn.category && [left.fn.category, right.fn.category].includes("oversight") && similarity(left.fn.object ?? "", right.fn.object ?? "") >= 0.3) {
        proposed.push(finding("conflict_of_interest", "Потенциальный конфликт интересов", `${left.fn.originalText} / ${right.fn.originalText}`, `Одно подразделение «${left.unit.name}» возможно выполняет и проверяет связанную деятельность. Нужна проверка независимости.`, left.fn, right.fn, left.unit.name, right.unit.name, confidence([lexical], 2)));
      }
    }
    // new_function findings
    for (const match of matches) {
      if (match.status === "new" && match.afterId && match.afterRefs.length) {
        const a = afterItems.find(({ fn }) => fn.id === match.afterId)?.fn;
        if (a) proposed.push(finding("new_function", "Новая функция", a.originalText, "Явного соответствия до реорганизации не найдено. Функция отсутствовала или была перемещена из другого подразделения.", undefined, a, undefined, match.afterUnit, match.confidence));
      }
    }
    const findings = proposed.filter((item) => validateFinding(item, documents));
    const needsReview = proposed.filter((item) => !validateFinding(item, documents));
    await stage("Формирование аналитического заключения");
    const fallback = resultReport(units, findings, unitMappings.length);
    const report = mode === "ai" ? await synthesize({ unitMappings: unitMappings.map((item) => ({ transformation: item.transformation, explanation: item.explanation, sourceRefs: item.sourceRefs })), findings: findings.map(({ title, summary, reasoning, beforeRefs, afterRefs }) => ({ title, summary, reasoning, beforeRefs, afterRefs })), counts: fallback }) : fallback;
    const result: AnalysisResult = { mode, units, unitMappings, functionMatches: matches, findings, needsReview, report };
    await prisma.analysis.update({ where: { id }, data: { status: "complete", stage: "Готово", result: JSON.stringify(result) } });
  } catch (error) {
    await prisma.analysis.update({ where: { id }, data: { status: "failed", stage: "Ошибка", error: error instanceof Error ? error.message : "Неизвестная ошибка анализа" } });
  }
}
