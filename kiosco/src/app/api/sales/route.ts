import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const sales = await prisma.sale.findMany({
    include: { items: true, user: true, branch: true },
  });
  return NextResponse.json(sales);
}

export async function POST(req: Request) {
  const { userId, branchId, items } = await req.json();

  const sale = await prisma.sale.create({
    data: {
      userId,
      branchId,
      items: {
        create: items.map((item: any) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
        })),
      },
    },
  });

  // Descontar stock
  for (const item of items) {
    await prisma.branchStock.update({
      where: {
        branchId_productId: {
          branchId,
          productId: item.productId,
        },
      },
      data: {
        quantity: { decrement: item.quantity },
      },
    });
  }

  return NextResponse.json(sale);
}
