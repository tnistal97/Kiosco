// src/app/api/comprobantes/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { obtenerComprobante } from '@/modules/clients/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Un comprobante de pago, para imprimirlo o reimprimirlo. Objetivo 24.
 *
 * NO es una factura y no lo dice en ninguna parte: este sistema todavia no
 * emite nada fiscal. Es el papel que el comercio le da al cliente para que
 * tenga constancia de que pago, con el numero de operacion, los dos saldos y
 * quien cobro.
 *
 * Reimprimible a proposito: el papel se pierde, y el cliente que reclama "yo te
 * pague el martes" tiene que poder recibir otra copia identica. Que sea
 * identica esta garantizado por la inmutabilidad de `CustomerPayment`, no por
 * una convencion.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'accounts.view',
    audit: 'GET /api/comprobantes/:id',
  },
  ({ session, params }) => obtenerComprobante(session, parseWith(idSchema, params.id)),
)
