import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await prisma.analysis.findUnique({ where: { id }, include: { documents: true } });
  if (!analysis) return NextResponse.json({ error: "Анализ не найден." }, { status: 404 });
  return NextResponse.json({ id, status: analysis.status, stage: analysis.stage, error: analysis.error, result: analysis.result ? JSON.parse(analysis.result) : null, documents: analysis.documents.map(({ id, filename, side, type, size, chunks }) => ({ id, filename, side, type, size, chunks: JSON.parse(chunks) })) });
}
