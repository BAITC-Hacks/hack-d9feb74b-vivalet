import { extractFunctions } from "../ai/client";
import type { ExtractedFunction } from "../ai/schemas";
import { withHierarchy } from "./hierarchy";
import { sourceRef } from "../documents";
import type { DocumentChunk, FunctionItem, OrganizationalUnit, ParsedDocument } from "../types";
import { normalize } from "./matching";
import { sourceQuote } from "./quote";

const unitPattern = /(?:блок(?:а|у|ом)?|департамент(?:а|у|ом)?|дирекци[яи]|управлени[ея]|отдел(?:а|у)?|служб[аы]|сектор(?:а|у)?|центр(?:а|у)?)\s+[^.;:,()]{3,100}/i;
const structureLeadPattern = /(?:состоит из следующих структурных подразделений|в состав(?:е)? .{0,90}(?:входят|входили)|структурные подразделения(?:\s+[^:]{0,60})?:)/i;
const listUnitPattern = /^(?:(?:[а-я]|\d+)[.)]|[–-])\s*(?:Блок|Департамент|Дирекция|Управление|Отдел|Служба|Сектор|Центр)\s/u;
const actionPattern = /(осуществляет|проводит|организует|обеспечивает|контролирует|разрабатывает|утверждает|анализирует|оценивает|координирует|готовит|формирует|ведет|проверяет|выполняет|представляет|предлагает|запрашивает|рассматривает|информирует|согласовывает|участвует|назначает|планирует|осуществление|проведение|организация|обеспечение|контроль|разработка|утверждение|анализ|оценка|координация|подготовка|формирование|ведение|проверка|аудит|мониторинг)/i;
const functionStart = /^(?:\d+(?:\.\d+)*\.|[а-я]\.|[–-])?\s*(?:осуществл|провод|проведен|организ|обеспеч|контрол|контроль|разраб|утвержд|анализ|оцен|координ|подготов|формир|веден|провер|выполн|аудит|монитор|содейств|участие|участв|предлага|представл|запрашива|рассматрива|информир|согласов|внос|вынос|назнач|отвеча|исполн|планир|реализ)/i;
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
  if (unit.functions.some((item) => item.originalText === quote && item.sourceRefs.some((ref) => ref.chunkId === chunk.id))) return;
  const normalizedText = normalize(quote);
  const action = quote.match(actionPattern)?.[0]?.toLowerCase();
  const category = classifyAction(action);
  const item: FunctionItem = { id: crypto.randomUUID(), unitId: unit.id, originalText: quote, normalizedText, action, object: action ? normalize(quote.slice(quote.toLowerCase().indexOf(action) + action.length)) : normalizedText, category, sourceRefs: [sourceRef(document, chunk, quote)] };
  unit.functions.push(item);
}
export function extractRules(document: ParsedDocument): OrganizationalUnit[] {
  document = { ...document, chunks: withHierarchy(document.chunks) };
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
    if (/^\d+(?:\.\d+)*\.\s+(?:Директор|Руководитель|Работники|Департамент)/iu.test(chunk.text)) {
      const name = findUnitName(chunk.text);
      const named = name ? units.get(normalize(name)) : undefined;
      const abbreviated = [...units.values()].find((unit) => unit.abbreviation && new RegExp(`(?:^|[^А-ЯЁ])${unit.abbreviation}(?=$|[^А-ЯЁ])`, "u").test(chunk.text));
      current = named ?? abbreviated ?? main;
    }
    if (structure.some((item) => item.chunk.id === chunk.id)) continue;
    if (functionStart.test(chunk.text) && chunk.text.length < 1200) addFunction(current, document, chunk, chunk.text);
  }
  for (const unit of units.values()) for (const fn of unit.functions) {
    const chunk = document.chunks.find((item) => item.id === fn.sourceRefs[0].chunkId)!;
    const context = `${chunk.parentContext ?? ""}\n${fn.originalText}`;
    fn.semantic = {
      actor: chunk.sectionActor ?? unit.name, organizationalUnit: unit.name,
      action: fn.action ?? "", object: fn.object ?? "", target: null, purpose: null,
      scope: [], conditions: [], recipients: [], domain: null, parentContext: chunk.parentContext ?? "",
      authorityType: /запрещ|не вправе/i.test(context) ? "prohibition" : /обязан/i.test(context) ? "duty" : /име[ею]т право/i.test(context) ? "right" : /может|могут/i.test(context) ? "optional" : "unknown",
    };
  }
  return [...units.values()];
}
export function attachExtractedFunctions(document: ParsedDocument, chunks: DocumentChunk[], units: OrganizationalUnit[], functions: ExtractedFunction[]): void {
  for (const extracted of functions) {
    const fact = { ...extracted };
    const chunk = chunks.find((item) => item.id === fact.chunkId);
    const quote = chunk && sourceQuote(chunk.text, fact.quote);
    if (!chunk || !quote) throw new Error("Извлеченная функция не подтверждается точной цитатой.");
    fact.quote = quote;
    const unit = units.find((item) => fact.organizationalUnit && (normalize(item.name) === normalize(fact.organizationalUnit) || item.abbreviation === fact.organizationalUnit)) ?? units[0];
    if (!unit) throw new Error("Не найден организационный контекст функции.");
    const parentRefs = (chunk.parentChunkIds ?? []).flatMap((id) => {
      const parent = document.chunks.find((item) => item.id === id);
      return parent ? [sourceRef(document, parent)] : [];
    });
    const semantic = { actor: fact.actor, organizationalUnit: fact.organizationalUnit, action: fact.action, object: fact.object, target: fact.target, purpose: fact.purpose, scope: fact.scope, authorityType: fact.authorityType, conditions: fact.conditions, recipients: fact.recipients, domain: fact.domain, parentContext: chunk.parentContext ?? "" };
    unit.functions.push({ id: crypto.randomUUID(), unitId: unit.id, originalText: fact.quote, normalizedText: normalize([fact.action, fact.object, fact.purpose, ...fact.scope].filter(Boolean).join(" ")), action: fact.action, object: fact.object, category: classifyAction(fact.action), semantic, sourceRefs: [sourceRef(document, chunk, fact.quote), ...parentRefs] });
    if (fact.actor && !unit.roles.includes(fact.actor)) unit.roles.push(fact.actor);
  }
}

export async function extractAi(document: ParsedDocument, onProgress?: (done: number, total: number) => Promise<void>): Promise<OrganizationalUnit[]> {
  document = { ...document, chunks: withHierarchy(document.chunks) };
  // The explicit structure list is the source of truth for units. Model-supplied
  // names may refer to counterparties or roles and must not change unit counts.
  const units = extractRules(document);
  const candidateIds = new Set(units.flatMap((unit) => unit.functions.flatMap((fn) => fn.sourceRefs.map((ref) => ref.chunkId))));
  const candidates = document.chunks.filter((chunk) => candidateIds.has(chunk.id) || functionStart.test(chunk.text));
  const groups: DocumentChunk[][] = [];
  let group: DocumentChunk[] = [];
  let size = 0;
  for (const chunk of candidates) {
    const length = chunk.text.length + (chunk.parentContext?.length ?? 0);
    if (group.length && (size + length > 14000 || group.length >= 12)) { groups.push(group); group = []; size = 0; }
    group.push(chunk); size += length;
  }
  if (group.length) groups.push(group);
  for (let index = 0; index < groups.length; index += 3) {
    const wave = groups.slice(index, index + 3);
    const results = await Promise.all(wave.map(async (chunks) => {
      const payload = { filename: document.filename, units: units.map(({ name, abbreviation, parentUnit }) => ({ name, abbreviation, parentUnit })), chunks };
      try { return await extractFunctions(payload); }
      catch { return null; }
    }));
    for (const [position, output] of results.entries()) {
      if (!output) continue;
      const accepted = output.functions.flatMap((fact) => {
        const chunk = wave[position].find((item) => item.id === fact.chunkId);
        const quote = chunk && sourceQuote(chunk.text, fact.quote);
        return quote ? [{ ...fact, quote }] : [];
      });
      const enriched = new Set(accepted.map((fact) => fact.chunkId));
      for (const unit of units) unit.functions = unit.functions.filter((fn) => !fn.sourceRefs.some((ref) => enriched.has(ref.chunkId)));
      attachExtractedFunctions(document, wave[position], units, accepted);
    }
    await onProgress?.(Math.min(index + wave.length, groups.length), groups.length);
  }
  // A unit definition may occur later than its functions or in another extraction batch.
  const functions = units.flatMap((unit) => unit.functions);
  for (const unit of units) unit.functions = [];
  for (const fn of functions) {
    const owner = units.find((unit) => fn.semantic?.organizationalUnit && (normalize(unit.name) === normalize(fn.semantic.organizationalUnit) || unit.abbreviation === fn.semantic.organizationalUnit)) ?? units[0];
    fn.unitId = owner.id;
    owner.functions.push(fn);
  }
  return units;
}
