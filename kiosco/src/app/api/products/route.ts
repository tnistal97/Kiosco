import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const products = await prisma.product.findMany({
    include: { category: true },
  })
  return NextResponse.json(products)
}

export async function POST(req: Request) {
  const data = await req.json()

  const product = await prisma.product.create({
    data: {
      name: data.name,
      barcode: data.barcode,
      description: data.description,
      price: data.price,
      categoryId: data.categoryId,
    },
  })

  return NextResponse.json(product)
}
