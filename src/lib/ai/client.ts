import OpenAI from "openai";
import { extractionPrompt, reportPrompt, verificationPrompt } from "./prompts";

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
export const aiEnabled = () => !!client;
async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await work(); } catch (error) {
      last = error;
      const status = (error as { status?: number }).status;
      if (status !== 429 && status !== 500 && status !== 502 && status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
    }
  }
  throw last;
}
async function structured<T>(name: string, system: string, payload: unknown, schema: Record<string, unknown>): Promise<T> {
  if (!client) throw new Error("OPENAI_API_KEY не задан.");
  const response = await withRetry(() => client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    stream: false,
    input: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }],
    text: { format: { type: "json_schema", name, strict: true, schema } },
  }));
  if (!response.output_text) throw new Error("Модель не вернула структурированный ответ.");
  try { return JSON.parse(response.output_text) as T; } catch { throw new Error("Модель вернула некорректный JSON."); }
}
export interface ExtractedItem { name: string; chunkId: string; functions: { quote: string; chunkId: string }[] }
export async function extractWithAi(filename: string, chunks: { id: string; text: string }[]): Promise<ExtractedItem[]> {
  const schema = { type: "object", additionalProperties: false, required: ["units"], properties: { units: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "chunkId", "functions"], properties: { name: { type: "string" }, chunkId: { type: "string" }, functions: { type: "array", items: { type: "object", additionalProperties: false, required: ["quote", "chunkId"], properties: { quote: { type: "string" }, chunkId: { type: "string" } } } } } } } } };
  const output = await structured<{ units: ExtractedItem[] }>("organization_extraction", extractionPrompt, { filename, chunks }, schema);
  return output.units;
}
export async function verifyPair(before: string, after: string): Promise<{ relation: "same" | "modified" | "unrelated"; reasoning: string }> {
  const schema = { type: "object", additionalProperties: false, required: ["relation", "reasoning"], properties: { relation: { type: "string", enum: ["same", "modified", "unrelated"] }, reasoning: { type: "string" } } };
  return structured("function_verification", verificationPrompt, { before, after }, schema);
}
export async function embed(texts: string[]): Promise<number[][]> {
  if (!client || !texts.length) return [];
  const result = await withRetry(() => client.embeddings.create({ model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small", input: texts }));
  return result.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
export async function synthesize(payload: unknown): Promise<{ executiveSummary: string; structuralChangesSummary: string; keyRisks: string[]; recommendations: string[]; conclusion: string }> {
  const schema = { type: "object", additionalProperties: false, required: ["executiveSummary", "structuralChangesSummary", "keyRisks", "recommendations", "conclusion"], properties: { executiveSummary: { type: "string" }, structuralChangesSummary: { type: "string" }, keyRisks: { type: "array", items: { type: "string" } }, recommendations: { type: "array", items: { type: "string" } }, conclusion: { type: "string" } } };
  return structured("analysis_report", reportPrompt, payload, schema);
}
