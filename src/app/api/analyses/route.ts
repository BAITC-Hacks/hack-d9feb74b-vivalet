import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
export async function POST() {
  const analysis = await prisma.analysis.create({ data: {} });
  return NextResponse.json({ id: analysis.id });
}
