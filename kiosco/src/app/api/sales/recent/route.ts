// src/app/api/sales/recent/route.ts
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET() {
  const sales = await prisma.sale.findMany({
    orderBy: { date: 'desc' },
    take: 5,
    include: { items: true },
  })

  const result = sales.map((s) => ({
    id: s.id,
    createdAt: s.date,
    total: s.items.reduce((sum, i) => sum + i.price * i.quantity, 0),
  }))

  return NextResponse.json(result)
}
