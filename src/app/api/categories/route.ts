// src/app/api/categories/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { audit } from '@/server/audit/audit'
import { conflict } from '@/server/http/errors'
import { crearCategoriaSchema } from '@/modules/catalog/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'products.view',
    audit: 'GET /api/categories',
  },
  async () =>
    prisma.category.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
)

export const POST = handler(
  {
    auth: 'session',
    permission: 'categories.manage',
    body: crearCategoriaSchema,
    audit: 'POST /api/categories',
  },
  async ({ session, body }) => {
    const existente = await prisma.category.findUnique({ where: { name: body.name } })
    if (existente) throw conflict('Ya existe una categoria con ese nombre')

    const categoria = await prisma.$transaction(async (tx) => {
      const creada = await tx.category.create({
        data: { name: body.name },
        select: { id: true, name: true },
      })
      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Category',
        recordId: creada.id,
        action: 'create',
        after: creada,
        origin: 'POST /api/categories',
      })
      return creada
    })

    return NextResponse.json(categoria, { status: 201 })
  },
)
