import type { FunctionItem, OrganizationalUnit, UnitMapping } from "../types";

const STOP = new Set(["и", "в", "во", "на", "по", "для", "с", "со", "из", "к", "от", "до", "об", "о", "the", "of"]);
export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[«»"'(),.;:—–-]/g, " ").replace(/\s+/g, " ").trim();
}
export function tokens(text: string): string[] {
  return normalize(text).split(" ").filter((token) => token.length > 2 && !STOP.has(token));
}
export function similarity(a: string, b: string): number {
  const left = new Set(tokens(a)); const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / (left.size + right.size - shared);
}
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  const am = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  const bm = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
  return am && bm ? dot / (am * bm) : 0;
}
export function confidence(scores: number[], evidenceCount: number): number {
  if (!scores.length || evidenceCount < 1) return 0;
  const mean = scores.reduce((a, b) => a + Math.max(0, Math.min(1, b)), 0) / scores.length;
  return Math.max(0, Math.min(0.99, Math.round((mean * 0.85 + Math.min(evidenceCount, 2) * 0.075) * 100) / 100));
}
export function functionSimilarity(a: FunctionItem, b: FunctionItem): number {
  const lexical = similarity(a.normalizedText, b.normalizedText);
  const action = a.action && b.action ? (normalize(a.action) === normalize(b.action) ? 1 : 0) : 0.5;
  return 0.8 * lexical + 0.2 * action;
}
export function mapUnits(before: OrganizationalUnit[], after: OrganizationalUnit[]): UnitMapping[] {
  const edges = before.flatMap((a) => after.map((b) => {
    const name = similarity(a.name, b.name);
    const abbrev = (a.abbreviation && b.abbreviation && a.abbreviation === b.abbreviation) ? 1 : 0;
    const overlap = a.functions.length && b.functions.length ? a.functions.reduce((sum, f) => sum + Math.max(0, ...b.functions.map((g) => functionSimilarity(f, g))), 0) / a.functions.length : 0;
    return { a, b, score: 0.40 * name + 0.35 * overlap + 0.25 * abbrev, name };
  })).filter((edge) => edge.score >= 0.22).sort((a, b) => b.score - a.score);
  const byBefore = new Map<string, typeof edges>(); const byAfter = new Map<string, typeof edges>();
  for (const edge of edges) {
    const x = byBefore.get(edge.a.id) ?? []; x.push(edge); byBefore.set(edge.a.id, x);
    const y = byAfter.get(edge.b.id) ?? []; y.push(edge); byAfter.set(edge.b.id, y);
  }
  const mappings: UnitMapping[] = []; const usedBefore = new Set<string>(); const usedAfter = new Set<string>();
  for (const a of before) {
    if (usedBefore.has(a.id)) continue;
    const candidates = (byBefore.get(a.id) ?? []).filter((edge) => edge.score >= Math.max(0.24, (byBefore.get(a.id)?.[0]?.score ?? 0) - 0.12));
    if (!candidates.length) continue;
    const eligible = candidates.filter((edge) => !usedAfter.has(edge.b.id));
    if (!eligible.length) continue;
    const targets = eligible.slice(0, 3);
    const sources = targets.length === 1 ? (byAfter.get(targets[0].b.id) ?? []).filter((edge) => !usedBefore.has(edge.a.id) && edge.score >= Math.max(.24, targets[0].score - .1)).map((edge) => edge.a) : [a];
    const merge = targets.length === 1 && sources.length > 1;
    const transformation = targets.length > 1 ? "split" : merge ? "merged" : targets[0].name >= 0.98 ? "unchanged" : targets[0].name >= 0.45 ? "renamed" : "transformed";
    mappings.push({ beforeUnitIds: sources.map((source) => source.id), afterUnitIds: targets.map((edge) => edge.b.id), transformation, confidence: confidence(targets.map((edge) => edge.score), 2), explanation: `Сопоставление по названию и пересечению функций: ${targets.map((edge) => edge.b.name).join(", ")}. Требует проверки сотрудником.`, sourceRefs: [...sources.flatMap((source) => source.sourceRefs), ...targets.flatMap((edge) => edge.b.sourceRefs)] });
    sources.forEach((source) => usedBefore.add(source.id)); targets.forEach((edge) => usedAfter.add(edge.b.id));
  }
  for (const a of before.filter((unit) => !usedBefore.has(unit.id))) mappings.push({ beforeUnitIds: [a.id], afterUnitIds: [], transformation: "removed", confidence: 0.7, explanation: "Явного соответствия подразделению после реорганизации не найдено.", sourceRefs: a.sourceRefs });
  for (const b of after.filter((unit) => !usedAfter.has(unit.id))) mappings.push({ beforeUnitIds: [], afterUnitIds: [b.id], transformation: "created", confidence: 0.7, explanation: "Явного соответствия подразделению до реорганизации не найдено.", sourceRefs: b.sourceRefs });
  return mappings;
}
