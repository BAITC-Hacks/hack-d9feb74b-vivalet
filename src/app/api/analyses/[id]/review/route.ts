import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { AnalysisResult } from "@/lib/types";

export const runtime = "nodejs";
const reviewSchema = z.object({ changeId: z.string().min(1), status: z.enum(["confirmed", "rejected"]), note: z.string().trim().min(1).max(2000) });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Укажите решение и его обоснование (до 2000 символов)." }, { status: 400 });
  const analysis = await prisma.analysis.findUnique({ where: { id } });
  if (!analysis) return NextResponse.json({ error: "Анализ не найден." }, { status: 404 });
  if (analysis.status !== "complete" || !analysis.result) return NextResponse.json({ error: "Дождитесь завершения анализа." }, { status: 409 });
  const result: AnalysisResult = JSON.parse(analysis.result);
  const change = result.semanticChanges?.find((item) => item.id === parsed.data.changeId);
  if (!change) return NextResponse.json({ error: "Изменение не найдено." }, { status: 404 });
  change.review = { status: parsed.data.status, note: parsed.data.note, reviewedAt: new Date().toISOString() };
  const update = await prisma.analysis.updateMany({ where: { id, status: "complete", result: analysis.result }, data: { result: JSON.stringify(result) } });
  if (!update.count) return NextResponse.json({ error: "Анализ изменился. Обновите страницу и повторите сохранение." }, { status: 409 });
  return NextResponse.json({ review: change.review });
}
