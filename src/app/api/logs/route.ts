import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const logs = await prisma.auditLog.findMany({
    include: { user: true },
    orderBy: { timestamp: 'desc' },
  });
  return NextResponse.json(logs);
}

export async function POST(req: Request) {
  const data = await req.json();
  const log = await prisma.auditLog.create({ data });
  return NextResponse.json(log);
}
