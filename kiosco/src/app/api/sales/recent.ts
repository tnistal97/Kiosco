import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
    const sales = await prisma.sale.findMany({
        orderBy: { date: 'desc' },
        take: 5,
        include: {
            items: true, // incluye los productos vendidos
        },
    })


  return NextResponse.json(sales)
}
