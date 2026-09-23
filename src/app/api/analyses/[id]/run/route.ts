import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runAnalysis } from "@/lib/analysis/pipeline";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await prisma.analysis.findUnique({ where: { id } });
  if (!analysis) return NextResponse.json({ error: "Анализ не найден." }, { status: 404 });
  if (analysis.status === "running") return NextResponse.json({ error: "Анализ уже выполняется." }, { status: 409 });
  await runAnalysis(id);
  const current = await prisma.analysis.findUnique({ where: { id } });
  return NextResponse.json({ status: current?.status, error: current?.error });
}
