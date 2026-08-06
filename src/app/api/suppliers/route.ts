// src/app/api/suppliers/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { audit } from '@/server/audit/audit'
import { conflict } from '@/server/http/errors'
import { crearProveedorSchema } from '@/modules/catalog/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Proveedores.
 *
 * El `include: { products: true }` anterior devolvia el catalogo entero de
 * TODAS las sucursales colgando de cada proveedor, con precios y costos. Se
 * reemplaza por el conteo.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'suppliers.view',
    audit: 'GET /api/suppliers',
  },
  async ({ session }) =>
    prisma.supplier.findMany({
      select: {
        id: true,
        name: true,
        contact: true,
        _count: { select: { products: { where: { branchId: session.branchId } } } },
      },
      orderBy: { name: 'asc' },
    }),
)

export const POST = handler(
  {
    auth: 'session',
    permission: 'suppliers.manage',
    body: crearProveedorSchema,
    audit: 'POST /api/suppliers',
  },
  async ({ session, body }) => {
    const existente = await prisma.supplier.findUnique({ where: { name: body.name } })
    if (existente) throw conflict('Ya existe un proveedor con ese nombre')

    const proveedor = await prisma.$transaction(async (tx) => {
      const creado = await tx.supplier.create({
        data: { name: body.name, contact: body.contact ?? null },
        select: { id: true, name: true, contact: true },
      })
      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Supplier',
        recordId: creado.id,
        action: 'create',
        after: creado,
        origin: 'POST /api/suppliers',
      })
      return creado
    })

    return NextResponse.json(proveedor, { status: 201 })
  },
)
