// src/app/api/branches/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { audit } from '@/server/audit/audit'
import { conflict, notFound } from '@/server/http/errors'
import { crearSucursalSchema, editarSucursalSchema } from '@/modules/catalog/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAMPOS = {
  id: true,
  name: true,
  address: true,
  email: true,
  phone: true,
  createdAt: true,
  currentCash: true,
} as const

/**
 * Sucursales.
 *
 * Quien tiene branches.manage ve todas; el resto ve solo la suya, y siempre
 * como una lista, para que el cliente no tenga que distinguir dos formas de
 * respuesta segun el rol (antes devolvia un array o un objeto).
 */
export const GET = handler(
  {
    auth: 'session',
    permission: ['branches.view', 'branches.manage'],
    audit: 'GET /api/branches',
  },
  async ({ session }) => {
    const puedeVerTodas = session.permissions.has('branches.manage')

    return prisma.branch.findMany({
      where: puedeVerTodas ? {} : { id: session.branchId },
      select: CAMPOS,
      orderBy: { id: 'asc' },
    })
  },
)

export const POST = handler(
  {
    auth: 'session',
    permission: 'branches.manage',
    body: crearSucursalSchema,
    audit: 'POST /api/branches',
  },
  async ({ session, body }) => {
    const existente = await prisma.branch.findUnique({ where: { name: body.name } })
    if (existente) throw conflict('Ya existe una sucursal con ese nombre')

    const sucursal = await prisma.$transaction(async (tx) => {
      const creada = await tx.branch.create({
        data: {
          name: body.name,
          address: body.address ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
        },
        select: CAMPOS,
      })
      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Branch',
        recordId: creada.id,
        action: 'create',
        after: creada,
        origin: 'POST /api/branches',
      })
      return creada
    })

    return NextResponse.json(sucursal, { status: 201 })
  },
)

export const PATCH = handler(
  {
    auth: 'session',
    permission: 'branches.manage',
    body: editarSucursalSchema,
    audit: 'PATCH /api/branches',
  },
  async ({ session, body }) => {
    const antes = await prisma.branch.findUnique({ where: { id: body.id }, select: CAMPOS })
    if (!antes) throw notFound('Sucursal no encontrada')

    return prisma.$transaction(async (tx) => {
      const despues = await tx.branch.update({
        where: { id: body.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.address !== undefined ? { address: body.address } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
        },
        select: CAMPOS,
      })

      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Branch',
        recordId: despues.id,
        action: 'update',
        before: antes,
        after: despues,
        origin: 'PATCH /api/branches',
      })

      return despues
    })
  },
)

/**
 * No existe DELETE en esta ruta.
 *
 * Borrar una sucursal significa borrar el ancla de sus ventas, movimientos de
 * caja, arqueos, stock y usuarios. La version anterior lo intentaba y solo se
 * salvaba porque PostgreSQL rechazaba la operacion por clave foranea; el dia
 * que una sucursal quedara vacia, habria funcionado.
 *
 * Dar de baja una sucursal sin destruir su historial requiere un campo de
 * estado, igual que con los productos. Queda para la fase siguiente.
 */
