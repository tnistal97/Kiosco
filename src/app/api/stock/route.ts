import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const stock = await prisma.branchStock.findMany({
    include: { product: true, branch: true },
  });
  return NextResponse.json(stock);
}

export async function POST(req: Request) {
  const data = await req.json();
  const updated = await prisma.branchStock.upsert({
    where: {
      branchId_productId: {
        branchId: data.branchId,
        productId: data.productId,
      },
    },
    update: {
      quantity: { increment: data.quantity },
    },
    create: data,
  });
  return NextResponse.json(updated);
}
