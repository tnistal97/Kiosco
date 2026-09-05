import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/server/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `/compras/recepcion/:id` no es una pantalla: es la DIRECCION de una
 * recepcion, que vive dentro del detalle de su orden.
 *
 * El libro de movimientos y las devoluciones enlazan aca porque de una
 * recepcion solo conocen su numero, no el de la orden. Hasta la Fase 1 de UX
 * V2 ese enlace daba 404 (auditoria, H-04). Esto averigua la orden y manda al
 * lugar correcto, con el ancla que deja la recepcion a la vista.
 *
 * No se confirma la existencia de una recepcion a quien no puede ver compras,
 * ni de otra sucursal: en los dos casos, "no encontrada".
 */
export default async function RecepcionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const numero = Number(id)
  if (!Number.isInteger(numero) || numero <= 0) notFound()

  const session = await getSession(new Request('http://localhost/', { headers: await headers() }))
  if (!session?.permissions.has('purchases.view')) notFound()

  const recepcion = await prisma.purchaseReceipt.findUnique({
    where: { id: numero },
    select: { purchaseOrderId: true, branchId: true },
  })
  if (!recepcion || recepcion.branchId !== session.branchId) notFound()

  redirect(`/compras/${String(recepcion.purchaseOrderId)}#recepcion-${String(numero)}`)
}
