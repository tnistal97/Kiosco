import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const suppliers = await prisma.supplier.findMany({ include: { products: true } });
  return NextResponse.json(suppliers);
}

export async function POST(req: Request) {
  const data = await req.json();
  const supplier = await prisma.supplier.create({ data });
  return NextResponse.json(supplier);
}
