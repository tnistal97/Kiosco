// src/app/api/cash/route.ts
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { amountSchema, optionalText, paymentMethodSchema } from '@/server/http/validate'
import { audit } from '@/server/audit/audit'
import { invalid } from '@/server/http/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Movimientos de caja de la sucursal, de ayer y de hoy.
 *
 * Cambios respecto de la version anterior:
 *
 *  - Los items de cada venta se traen con un `include` sobre la relacion
 *    `sale`, no con una consulta por movimiento. Con 26 movimientos eran 27
 *    consultas; ahora es una.
 *  - La relacion se resuelve por la clave foranea `saleId`, no parseando
 *    "Venta #123" del texto de la descripcion.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'cash.view',
    audit: 'GET /api/cash',
  },
  async ({ session }) => {
    const ahora = new Date()
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
    const finHoy = new Date(inicioHoy.getTime() + 24 * 60 * 60 * 1000 - 1)
    const inicioAyer = new Date(inicioHoy.getTime() - 24 * 60 * 60 * 1000)

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: {
        branchId: session.branchId,
        date: { gte: inicioAyer, lte: finHoy },
      },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        description: true,
        date: true,
        type: true,
        saleId: true,
        user: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        sale: {
          select: {
            id: true,
            status: true,
            items: {
              select: {
                id: true,
                quantity: true,
                price: true,
                product: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
    })

    return movimientos.map(({ sale, ...mov }) => ({
      ...mov,
      saleStatus: sale?.status ?? null,
      saleItems: sale?.items ?? null,
    }))
  },
)

/**
 * Movimiento manual de caja: ingreso, retiro o deposito.
 *
 * La version anterior guardaba el movimiento y no tocaba `currentCash`, asi
 * que el saldo que mostraba la pantalla nunca reflejaba los retiros. Ahora
 * el saldo se actualiza en la misma transaccion, con incremento atomico.
 */
const movimientoSchema = z
  .object({
    amount: amountSchema.refine((n) => n > 0, 'El monto debe ser mayor que cero'),
    paymentMethod: paymentMethodSchema,
    description: optionalText(300),
    movementType: z.enum(['ingreso', 'retiro', 'deposito']),
  })
  .strict()

export const POST = handler(
  {
    auth: 'session',
    permission: 'cash.movement.create',
    body: movimientoSchema,
    audit: 'POST /api/cash',
  },
  async ({ session, body }) => {
    // Un retiro o un deposito solo tienen sentido en efectivo: mueven el
    // dinero fisico del cajon.
    if (body.movementType !== 'ingreso' && body.paymentMethod !== 'efectivo') {
      throw invalid('Los retiros y depositos solo aplican a movimientos en efectivo')
    }

    // Signo segun el tipo: un retiro saca dinero del cajon.
    const signo = body.movementType === 'retiro' ? -1 : 1
    const importe = Math.round(body.amount * signo * 100) / 100

    const movimiento = await prisma.$transaction(async (tx) => {
      if (body.paymentMethod === 'efectivo') {
        const sucursal = await tx.branch.findUniqueOrThrow({
          where: { id: session.branchId },
          select: { currentCash: true },
        })

        if (signo < 0 && sucursal.currentCash + importe < 0) {
          throw invalid(
            `No se puede retirar ${body.amount}: el saldo en caja es ${sucursal.currentCash}`,
          )
        }

        await tx.branch.update({
          where: { id: session.branchId },
          data: { currentCash: { increment: importe } },
        })
      }

      const creado = await tx.cashRegisterMovement.create({
        data: {
          branchId: session.branchId,
          userId: session.userId,
          amount: importe,
          paymentMethod: body.paymentMethod,
          description: body.description ?? '',
          type: body.movementType,
        },
        select: {
          id: true,
          amount: true,
          paymentMethod: true,
          description: true,
          date: true,
          type: true,
        },
      })

      await audit(tx, {
        userId: session.userId,
        table: 'CashRegisterMovement',
        recordId: creado.id,
        action: 'create',
        after: creado,
        origin: 'POST /api/cash',
      })

      return creado
    })

    return NextResponse.json(movimiento, { status: 201 })
  },
)
