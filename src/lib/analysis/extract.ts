import { extractWithAi } from "../ai/client";
import { sourceRef } from "../documents";
import type { DocumentChunk, FunctionItem, OrganizationalUnit, ParsedDocument } from "../types";
import { normalize } from "./matching";

const unitPattern = /(?:блок|департамент|дирекци[яи]|управлени[ея]|отдел|служб[аы]|сектор|центр|комитет|групп[аы])\s+[^.;:,()]{3,100}/i;
const actionPattern = /(осуществляет|проводит|организует|обеспечивает|контролирует|разрабатывает|утверждает|анализирует|оценивает|координирует|готовит|формирует|ведет|проверяет|выполняет|осуществление|проведение|организация|обеспечение|контроль|разработка|утверждение|анализ|оценка|координация|подготовка|формирование|ведение|проверка|аудит|мониторинг)/i;
const functionStart = /^(?:\d+(?:\.\d+)*\.|[а-я]\.|[–-])?\s*(?:осуществл|провод|проведен|организ|обеспеч|контрол|контроль|разраб|утвержд|анализ|оцен|координ|подготов|формир|веден|провер|выполн|аудит|монитор|содейств|участие)/i;
function cleanName(name: string): string { return name.trim().replace(/[.!?;:,]+$/, "").slice(0, 120); }
function findUnitName(text: string): string | undefined {
  const match = text.match(unitPattern)?.[0];
  if (!match) return undefined;
  return cleanName(match.split(/\s+(?:является|осуществляет|обеспечивает|проводит|входит|выполняет|состоит|создается|образуется)\b/i)[0]);
}
function addFunction(unit: OrganizationalUnit, document: ParsedDocument, chunk: DocumentChunk, quote: string): void {
  if (!chunk.text.includes(quote) || quote.length < 15) return;
  if (unit.functions.some((item) => item.sourceRefs.some((ref) => ref.chunkId === chunk.id))) return;
  const normalizedText = normalize(quote);
  const action = quote.match(actionPattern)?.[0]?.toLowerCase();
  const item: FunctionItem = { id: crypto.randomUUID(), unitId: unit.id, originalText: quote, normalizedText, action, object: action ? normalize(quote.slice(quote.toLowerCase().indexOf(action) + action.length)) : normalizedText, sourceRefs: [sourceRef(document, chunk, quote)] };
  unit.functions.push(item);
}
export function extractRules(document: ParsedDocument): OrganizationalUnit[] {
  const units = new Map<string, OrganizationalUnit>();
  const mainChunk = document.chunks.find((chunk) => /блок[а-я]* внутреннего аудита/i.test(chunk.text)) ?? document.chunks[0];
  const mainName = /блок[а-я]* внутреннего аудита/i.test(mainChunk.text) ? "Блок внутреннего аудита" : document.filename.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const main: OrganizationalUnit = { id: crypto.randomUUID(), documentId: document.id, side: document.side, name: mainName, normalizedName: normalize(mainName), roles: [], functions: [], sourceRefs: [sourceRef(document, mainChunk)] };
  units.set(main.normalizedName, main);
  let current: OrganizationalUnit = main;
  for (const chunk of document.chunks) {
    const name = findUnitName(chunk.text);
    const looksHeading = !!name && chunk.text.length < 170 && /^(?:(?:\d+(?:\.\d+)*\.|[а-я]\.)\s*)?(?:Блок|Департамент|Дирекция|Управление|Отдел|Служба|Сектор|Центр)\s/u.test(chunk.text);
    if (name && looksHeading) {
      const key = normalize(name);
      let candidate = units.get(key);
      if (!candidate) {
        candidate = { id: crypto.randomUUID(), documentId: document.id, side: document.side, name, normalizedName: key, roles: [], functions: [], sourceRefs: [sourceRef(document, chunk)] };
        units.set(key, candidate);
      }
      current = candidate;
    }
    if (functionStart.test(chunk.text) && chunk.text.length < 1200) addFunction(current, document, chunk, chunk.text);
  }
  return [...units.values()];
}
export async function extractAi(document: ParsedDocument, onProgress?: (done: number, total: number) => Promise<void>): Promise<OrganizationalUnit[]> {
  const baseline = extractRules(document);
  const knownFunctionChunks = new Set(baseline.flatMap((unit) => unit.functions.flatMap((fn) => fn.sourceRefs.map((ref) => ref.chunkId))));
  const chunks = document.chunks.filter((chunk) => chunk.text.length > 12 && ((chunk.text.length < 170 && /^(?:(?:\d+(?:\.\d+)*\.|[а-я]\.)\s*)?(?:Блок|Департамент|Дирекция|Управление|Отдел|Служба|Сектор|Центр)\s/u.test(chunk.text)) || (functionStart.test(chunk.text) && !knownFunctionChunks.has(chunk.id))));
  const units = new Map(baseline.map((unit) => [unit.normalizedName, unit]));
  const groups: DocumentChunk[][] = [];
  for (let index = 0; index < chunks.length; index += 12) groups.push(chunks.slice(index, index + 12));
  for (let index = 0; index < groups.length; index += 3) {
    const wave = groups.slice(index, index + 3);
    const results = await Promise.all(wave.map((group) => extractWithAi(document.filename, group.map(({ id, text }) => ({ id, text: text.slice(0, 1200) })))));
    for (const [position, extracted] of results.entries()) {
      const group = wave[position];
      for (const item of extracted) {
      const origin = group.find((chunk) => chunk.id === item.chunkId);
      if (!origin || !item.name.trim()) continue;
      const key = normalize(item.name);
      let unit = units.get(key);
      if (!unit) {
        const explicitName = findUnitName(origin.text);
        if (!explicitName || normalize(explicitName) !== key || origin.text.length >= 170) continue;
        unit = { id: crypto.randomUUID(), documentId: document.id, side: document.side, name: cleanName(item.name), normalizedName: key, roles: [], functions: [], sourceRefs: [sourceRef(document, origin)] };
        units.set(key, unit);
      }
      for (const fn of item.functions) {
        const chunk = group.find((candidate) => candidate.id === fn.chunkId);
        if (chunk) addFunction(unit, document, chunk, fn.quote.trim());
      }
      }
    }
    await onProgress?.(Math.min(index + wave.length, groups.length), groups.length);
  }
  return [...units.values()];
}
