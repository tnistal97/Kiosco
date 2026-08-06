// src/app/api/cash/count/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { audit } from '@/server/audit/audit'
import { arqueoSchema } from '@/modules/cash/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Arqueo de caja: cuanto dinero hay fisicamente en el cajon.
 *
 * Se guarda ademas el saldo que el sistema esperaba y la diferencia. Antes se
 * registraba solo el importe contado y nadie lo comparaba con nada, asi que
 * un faltante no se detectaba nunca.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'cash.count.create',
    body: arqueoSchema,
    audit: 'POST /api/cash/count',
  },
  async ({ session, body }) => {
    const resultado = await prisma.$transaction(async (tx) => {
      const sucursal = await tx.branch.findUniqueOrThrow({
        where: { id: session.branchId },
        select: { currentCash: true },
      })

      const esperado = sucursal.currentCash
      const diferencia = Math.round((body.amount - esperado) * 100) / 100

      const notas = [
        body.notes,
        `Esperado: ${esperado}. Contado: ${body.amount}. Diferencia: ${diferencia}.`,
      ]
        .filter(Boolean)
        .join(' | ')

      const arqueo = await tx.cashCount.create({
        data: {
          userId: session.userId,
          branchId: session.branchId,
          amount: body.amount,
          notes: notas,
        },
        select: { id: true, amount: true, date: true, notes: true },
      })

      await audit(tx, {
        userId: session.userId,
        table: 'CashCount',
        recordId: arqueo.id,
        action: 'create',
        after: { contado: body.amount, esperado, diferencia, branchId: session.branchId },
        origin: 'POST /api/cash/count',
      })

      return { ...arqueo, esperado, diferencia }
    })

    return NextResponse.json({ ok: true, cashCount: resultado }, { status: 201 })
  },
)
