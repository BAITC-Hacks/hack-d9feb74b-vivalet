import { extractWithAi } from "../ai/client";
import { sourceRef } from "../documents";
import type { DocumentChunk, FunctionItem, OrganizationalUnit, ParsedDocument } from "../types";
import { normalize } from "./matching";

const unitPattern = /(?:блок(?:а|у|ом)?|департамент(?:а|у|ом)?|дирекци[яи]|управлени[ея]|отдел(?:а|у)?|служб[аы]|сектор(?:а|у)?|центр(?:а|у)?)\s+[^.;:,()]{3,100}/i;
const structureLeadPattern = /(?:состоит из следующих структурных подразделений|в состав(?:е)? .{0,90}(?:входят|входили)|структурные подразделения(?:\s+[^:]{0,60})?:)/i;
const listUnitPattern = /^(?:(?:[а-я]|\d+)[.)]|[–-])\s*(?:Блок|Департамент|Дирекция|Управление|Отдел|Служба|Сектор|Центр)\s/u;
const actionPattern = /(осуществляет|проводит|организует|обеспечивает|контролирует|разрабатывает|утверждает|анализирует|оценивает|координирует|готовит|формирует|ведет|проверяет|выполняет|осуществление|проведение|организация|обеспечение|контроль|разработка|утверждение|анализ|оценка|координация|подготовка|формирование|ведение|проверка|аудит|мониторинг)/i;
const functionStart = /^(?:\d+(?:\.\d+)*\.|[а-я]\.|[–-])?\s*(?:осуществл|провод|проведен|организ|обеспеч|контрол|контроль|разраб|утвержд|анализ|оцен|координ|подготов|формир|веден|провер|выполн|аудит|монитор|содейств|участие)/i;
const abbreviationPattern = /\(([А-ЯЁ]{2,8})\)/;
function cleanName(name: string): string {
  return name.trim().replace(/^(Блока|Блоку|Блоком)\s/u, "Блок ").replace(/^(Департамента|Департаменту|Департаментом)\s/u, "Департамент ").replace(/^(Отдела|Отделу)\s/u, "Отдел ").replace(/[.!?;:,]+$/, "").slice(0, 120);
}
function extractAbbreviation(text: string): string | undefined { return text.match(abbreviationPattern)?.[1]; }
function findUnitName(text: string): string | undefined {
  const match = text.match(unitPattern)?.[0];
  if (!match) return undefined;
  return cleanName(match.split(/\s+(?:является|осуществляет|обеспечивает|проводит|входит|выполняет|состоит|создается|образуется)(?=\s|[.,;:])/i)[0]);
}
function structuralUnits(document: ParsedDocument): { chunk: DocumentChunk; name: string }[] {
  const lead = document.chunks.findIndex((chunk) => structureLeadPattern.test(chunk.text));
  if (lead < 0) return [];
  const found: { chunk: DocumentChunk; name: string }[] = [];
  for (let index = lead + 1; index < document.chunks.length; index++) {
    const chunk = document.chunks[index];
    if (/^\d+(?:\.\d+)*\./.test(chunk.text)) break;
    if (!listUnitPattern.test(chunk.text)) continue;
    const name = findUnitName(chunk.text);
    if (name) found.push({ chunk, name });
  }
  return found;
}
function classifyAction(action: string | undefined): "execution" | "oversight" | "approval" | "other" {
  if (!action) return "other";
  if (/(контрол|провер|аудит|оцен|монитор|надзор|анализ)/i.test(action)) return "oversight";
  if (/(утвержд|согласов|принимает)/i.test(action)) return "approval";
  if (/(разрабатыв|осуществл|исполн|провод|организ|выполн|обеспеч|готовит|формир)/i.test(action)) return "execution";
  return "other";
}
function addFunction(unit: OrganizationalUnit, document: ParsedDocument, chunk: DocumentChunk, quote: string): void {
  if (!chunk.text.includes(quote) || quote.length < 15) return;
  if (unit.functions.some((item) => item.sourceRefs.some((ref) => ref.chunkId === chunk.id))) return;
  const normalizedText = normalize(quote);
  const action = quote.match(actionPattern)?.[0]?.toLowerCase();
  const category = classifyAction(action);
  const item: FunctionItem = { id: crypto.randomUUID(), unitId: unit.id, originalText: quote, normalizedText, action, object: action ? normalize(quote.slice(quote.toLowerCase().indexOf(action) + action.length)) : normalizedText, category, sourceRefs: [sourceRef(document, chunk, quote)] };
  unit.functions.push(item);
}
export function extractRules(document: ParsedDocument): OrganizationalUnit[] {
  const units = new Map<string, OrganizationalUnit>();
  const structure = structuralUnits(document);
  const intro = document.chunks.slice(0, Math.max(1, document.chunks.findIndex((chunk) => structureLeadPattern.test(chunk.text))));
  const rootChunk = intro.find((chunk) => /(?:далее\s*[-–—]|является\s+(?:структурным|функциональным)|положение\s+о)/i.test(chunk.text) && !!findUnitName(chunk.text)) ?? document.chunks[0];
  const rootNameRaw = rootChunk === document.chunks[0] && !/далее\s*[-–—]/i.test(rootChunk.text) ? document.filename.replace(/\.[^.]+$/, "").replace(/_/g, " ") : findUnitName(rootChunk.text) ?? document.filename.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const mainName = cleanName(rootNameRaw);
  const main: OrganizationalUnit = { id: crypto.randomUUID(), documentId: document.id, side: document.side, name: mainName, normalizedName: normalize(mainName), isRoot: true, abbreviation: extractAbbreviation(rootChunk.text), roles: [], functions: [], sourceRefs: [sourceRef(document, rootChunk)] };
  units.set(main.normalizedName, main);
  for (const { chunk, name } of structure) {
    const key = normalize(name);
    if (!units.has(key)) units.set(key, { id: crypto.randomUUID(), documentId: document.id, side: document.side, name, normalizedName: key, isRoot: false, parentUnit: main.name, abbreviation: extractAbbreviation(chunk.text), roles: [], functions: [], sourceRefs: [sourceRef(document, chunk)] });
  }
  let current: OrganizationalUnit = main;
  for (const chunk of document.chunks) {
    if (/^\d+\.\s/.test(chunk.text)) current = main;
    if (/^\d+(?:\.\d+)*\.\s+Директор(?:у|ы)?\s+департамента\s/u.test(chunk.text)) {
      const name = findUnitName(chunk.text);
      if (name) current = units.get(normalize(name)) ?? main;
    }
    if (structure.some((item) => item.chunk.id === chunk.id)) continue;
    if (functionStart.test(chunk.text) && chunk.text.length < 1200) addFunction(current, document, chunk, chunk.text);
  }
  return [...units.values()];
}
export async function extractAi(document: ParsedDocument, onProgress?: (done: number, total: number) => Promise<void>): Promise<OrganizationalUnit[]> {
  const baseline = extractRules(document);
  const structural = structuralUnits(document);
  const structuralChunkIds = new Set(structural.map((item) => item.chunk.id));
  const knownFunctionChunks = new Set(baseline.flatMap((unit) => unit.functions.flatMap((fn) => fn.sourceRefs.map((ref) => ref.chunkId))));
  const chunks = document.chunks.filter((chunk) => chunk.text.length > 12 && (structuralChunkIds.has(chunk.id) || (functionStart.test(chunk.text) && !knownFunctionChunks.has(chunk.id))));
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
        const explicitName = structural.find(({ chunk }) => chunk.id === origin.id)?.name;
        if (!explicitName || normalize(explicitName) !== key) continue;
        unit = { id: crypto.randomUUID(), documentId: document.id, side: document.side, name: cleanName(item.name), normalizedName: key, isRoot: false, parentUnit: baseline[0].name, abbreviation: extractAbbreviation(origin.text), roles: [], functions: [], sourceRefs: [sourceRef(document, origin)] };
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
