import { aiEnabled, critique, synthesize } from "../ai/client";
import { prisma } from "../db";
import type { AnalysisResult, Finding, OrganizationalUnit, ParsedDocument } from "../types";
import { validRef, validateFinding } from "./evidence";
import { sourceRef } from "../documents";
import { extractAi, extractRules } from "./extract";
import { withHierarchy } from "./hierarchy";
import { mapUnits } from "./matching";
import { compareFunctions, findFunctionalRisks, verifyChanges } from "./semantic";
import { buildOrganizationGraph, changeToFinding, changeToMatch, semanticReport } from "./semantic-report";

export async function analyzeDocuments(documents: ParsedDocument[], mode: AnalysisResult["mode"], stage: (name: string) => Promise<void> = async () => {}): Promise<AnalysisResult> {
  if (!documents.some((d) => d.side === "before") || !documents.some((d) => d.side === "after")) throw new Error("Нужен хотя бы один документ для каждой стороны сравнения.");
  documents = documents.map((document) => ({ ...document, chunks: withHierarchy(document.chunks) }));
  const units: OrganizationalUnit[] = [];
  for (const [index, document] of documents.entries()) {
    await stage(`Извлечение структуры и функций: документ ${index + 1}/${documents.length}`);
    units.push(...(mode === "ai" ? await extractAi(document, async (done, total) => stage(`Извлечение структуры и функций: документ ${index + 1}/${documents.length}, пакет ${done}/${total}`)) : extractRules(document)));
  }
  if (!units.some((unit) => unit.functions.length)) throw new Error("Не удалось извлечь функции из документов.");
  await stage("Сопоставление подразделений и функций");
  const unitMappings = mapUnits(units.filter((u) => u.side === "before"), units.filter((u) => u.side === "after"));
  const semanticChanges = await compareFunctions(units, mode, stage);
  semanticChanges.push(...await findFunctionalRisks(units, mode));
  await stage("Проверка потерь, пересечений и конфликтов");
  await verifyChanges(semanticChanges, documents, mode, stage);
  const proposed = semanticChanges.map((change) => changeToFinding(change, units)).filter((item): item is Finding => item !== null);
  const findings = proposed.filter((item) => !item.requiresHumanReview && validateFinding(item, documents));
  const needsReview = proposed.filter((item) => item.requiresHumanReview || !validateFinding(item, documents));
  await stage("Формирование аналитического заключения");
  const fallback = semanticReport(semanticChanges, units);
  const verified = semanticChanges.filter((change) => !change.requiresHumanReview && change.verification?.status === "SUPPORTED");
  const organizationGraph = buildOrganizationGraph(units);
  let report = fallback;
  if (mode === "ai" && verified.length) {
    const proposed = await synthesize({ verifiedChanges: verified, organization: units.map(({ name, side, parentUnit, roles }) => ({ name, side, parentUnit, roles })), unresolvedCount: needsReview.length, counts: fallback });
    const check = await critique({ claim: proposed, verifiedChanges: verified, instruction: "Verify EVERY report assertion and citation against verifiedChanges. Reject new unsupported organizational interpretations. Return exact supporting quotes." });
    const evidenceValid = check.evidence.length > 0 && check.evidence.every((ref) => {
      const document = documents.find((d) => d.id === ref.documentId);
      const chunk = document?.chunks.find((c) => c.id === ref.chunkId);
      return document && chunk && validRef(sourceRef(document, chunk, ref.quote), documents) && verified.some((change) => [...change.beforeRefs, ...change.afterRefs].some((r) => r.chunkId === ref.chunkId));
    });
    if (check.status === "SUPPORTED" && evidenceValid) report = proposed;
  }
  return { mode, units, unitMappings, semanticChanges, organizationGraph, functionMatches: semanticChanges.map((change) => changeToMatch(change, units)), findings, needsReview, report };
}
export async function runAnalysis(id: string): Promise<void> {
  const stage = async (name: string) => { await prisma.analysis.update({ where: { id }, data: { status: "running", stage: name, error: null } }); };
  const heartbeat = setInterval(() => {
    void prisma.analysis.updateMany({ where: { id, status: "running" }, data: { updatedAt: new Date() } }).catch(() => {});
  }, 30_000);
  try {
    await prisma.analysis.update({ where: { id }, data: { status: "running", stage: "Чтение и проверка документов", error: null, result: null } });
    const records = await prisma.document.findMany({ where: { analysisId: id }, orderBy: { createdAt: "asc" } });
    const documents: ParsedDocument[] = records.map((record) => ({ id: record.id, filename: record.filename, side: record.side as "before" | "after", type: record.type as "pdf" | "docx" | "xlsx", size: record.size, text: record.text, chunks: JSON.parse(record.chunks) }));
    const result = await analyzeDocuments(documents, aiEnabled() ? "ai" : "rules", stage);
    await prisma.analysis.update({ where: { id }, data: { status: "complete", stage: "Готово", result: JSON.stringify(result) } });
  } catch (error) {
    await prisma.analysis.update({ where: { id }, data: { status: "failed", stage: "Ошибка", error: error instanceof Error ? error.message : "Неизвестная ошибка анализа" } });
  } finally { clearInterval(heartbeat); }
}
