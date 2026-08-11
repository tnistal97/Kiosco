// src/app/api/suppliers/[id]/pagos/[pagoId]/imputar/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { imputarPagoSchema } from '@/modules/suppliers/schemas.cuenta'
import { imputarPagoAObligaciones } from '@/modules/suppliers/service.pagos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Aplicar un pago ya registrado a obligaciones concretas.
 *
 * ES LA OPERACION QUE CIERRA EL CIRCUITO DEL ANTICIPO: la plata se entrego en
 * marzo, la mercaderia llego en agosto, y esto es lo que las une.
 *
 * NO MUEVE EL SALDO del proveedor. El saldo bajo cuando se registro el pago;
 * volver a bajarlo aca restaria dos veces la misma plata. Lo que cambia es que
 * entrega figura como saldada.
 *
 * Permiso propio (`supplierAccounts.allocate`) y no el de pagar: pagar entrega
 * dinero y deja rastro en la caja o en el banco; esto no mueve un peso, y
 * justamente por eso puede pasar desapercibido.
 *
 * Los dos topes --lo que le queda al pago y lo que le falta a la entrega-- se
 * comprueban DENTRO de la transaccion y bajo bloqueo de fila. Dos personas
 * repartiendo el mismo anticipo a la vez no pueden imputar dos veces la misma
 * plata: la segunda recibe 409 `ALLOCATION_EXCEEDS_AVAILABLE`.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.allocate',
    body: imputarPagoSchema,
    audit: 'POST /api/suppliers/:id/pagos/:pagoId/imputar',
  },
  async ({ session, body, params }) =>
    NextResponse.json(
      await imputarPagoAObligaciones(
        session,
        parseWith(idSchema, params.id),
        parseWith(idSchema, params.pagoId),
        body,
      ),
      { status: 201 },
    ),
)
