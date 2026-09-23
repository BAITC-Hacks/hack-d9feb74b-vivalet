import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { askAssistant, aiEnabled } from "@/lib/ai/client";
export const runtime = "nodejs";
export const maxDuration = 60;
const bodySchema = z.object({ question: z.string().min(1).max(800) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!aiEnabled()) return NextResponse.json({ error: "AI-mode unavailable: OPENAI_API_KEY not set." }, { status: 400 });
    const { id } = await params;
    const analysis = await prisma.analysis.findUnique({ where: { id } });
    if (!analysis || analysis.status !== "complete" || !analysis.result) return NextResponse.json({ error: "Analysis not found or not complete." }, { status: 404 });
    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Question cannot be empty." }, { status: 400 });
    const result = JSON.parse(analysis.result);
    const context = [
      `Mode: ${result.mode}`,
      `Units before: ${result.units?.filter((u: {side: string}) => u.side === "before").length ?? 0}`,
      `Units after: ${result.units?.filter((u: {side: string}) => u.side === "after").length ?? 0}`,
      `\nUnit mappings:\n${(result.unitMappings ?? []).slice(0, 15).map((m: {transformation: string; explanation: string}) => `- ${m.transformation}: ${m.explanation}`).join("\n")}`,
      `\nFindings (${result.findings?.length ?? 0}):\n${(result.findings ?? []).slice(0, 20).map((f: {type: string; title: string; summary: string; confidence: number; beforeRefs: {filename: string; section?: string}[]; afterRefs: {filename: string; section?: string}[]}) => `[${f.type}] ${f.title}: ${f.summary} (confidence ${Math.round(f.confidence * 100)}%)\n  Sources: ${[...f.beforeRefs, ...f.afterRefs].slice(0, 2).map(r => `${r.filename}${r.section ? " s." + r.section : ""}`).join("; ")}`).join("\n")}`,
      result.report?.executiveSummary ? `\nSummary: ${result.report.executiveSummary}` : "",
    ].filter(Boolean).join("\n");
    const answer = await askAssistant(parsed.data.question, context);
    return NextResponse.json({ answer });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Assistant error." }, { status: 500 }); }
}