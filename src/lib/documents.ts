import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { DocumentChunk, DocumentType, ParsedDocument, Side, SourceReference } from "./types";

export function extractSection(text: string): string | undefined {
  return text.trim().match(/^(\d+(?:\.\d+)*)(?:\.|\s)(?=\s|\S)/)?.[1];
}
function makeChunk(documentId: string, text: string, extra: Partial<DocumentChunk> = {}): DocumentChunk {
  return { id: crypto.randomUUID(), documentId, text: text.trim(), ...extra };
}
export function chunkLines(documentId: string, text: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let section: string | undefined;
  let heading: string | undefined;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const found = extractSection(line);
    if (found) { section = found; if (line.length < 180) heading = line; }
    chunks.push(makeChunk(documentId, line, { section, heading, paragraph: index + 1 }));
  }
  return chunks;
}
export function chunkPdfPage(documentId: string, page: number, text: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let current = "";
  const flush = () => { if (current.trim()) chunks.push(makeChunk(documentId, current, { page, section: extractSection(current), paragraph: chunks.length + 1 })); current = ""; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const startsItem = /^(?:\d+(?:\.\d+)*\.|[а-я]\.|[–-]\s)/i.test(line);
    if (current && (startsItem || current.length + line.length > 1300)) flush();
    current += `${current ? " " : ""}${line}`;
  }
  flush();
  return chunks;
}
export async function parseDocument(id: string, filename: string, side: Side, buffer: Buffer): Promise<ParsedDocument> {
  const ext = filename.split(".").pop()?.toLowerCase() as DocumentType;
  if (!["pdf", "docx", "xlsx"].includes(ext)) throw new Error("Поддерживаются только PDF, DOCX и XLSX.");
  if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) throw new Error("Размер файла должен быть от 1 байта до 20 МБ.");
  let chunks: DocumentChunk[] = [];
  try {
    if (ext === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      chunks = chunkLines(id, result.value);
    } else if (ext === "xlsx") {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      for (const sheet of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheet];
        if (!worksheet["!ref"]) continue;
        const range = XLSX.utils.decode_range(worksheet["!ref"]);
        for (let row = range.s.r; row <= range.e.r; row++) {
          const cells: string[] = [];
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
            if (cell?.v !== undefined && cell?.v !== null) cells.push(String(cell.v).trim());
          }
          const value = cells.filter(Boolean).join(" | ");
          if (value) chunks.push(makeChunk(id, value, { sheet, rowStart: row + 1, rowEnd: row + 1, section: extractSection(value) }));
        }
      }
    } else {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        const pages = result.pages?.length ? result.pages : [{ num: 1, text: result.text }];
        for (const page of pages) chunks.push(...chunkPdfPage(id, page.num, page.text));
      } finally { await parser.destroy(); }
    }
  } catch (error) {
    throw new Error(ext === "pdf" ? "Не удалось извлечь текст из PDF. Проверьте текстовый слой файла." : `Не удалось прочитать ${ext.toUpperCase()}: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
  }
  if (!chunks.length) throw new Error("В документе не найден текст для анализа.");
  return { id, filename, side, type: ext, size: buffer.length, text: chunks.map((chunk) => chunk.text).join("\n"), chunks };
}
export function sourceRef(document: ParsedDocument, chunk: DocumentChunk, quote = chunk.text): SourceReference {
  return { documentId: document.id, chunkId: chunk.id, filename: document.filename, quote, section: chunk.section, heading: chunk.heading, page: chunk.page, paragraph: chunk.paragraph, sheet: chunk.sheet, row: chunk.rowStart };
}
