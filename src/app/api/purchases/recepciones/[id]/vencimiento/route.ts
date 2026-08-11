// src/app/api/purchases/recepciones/[id]/vencimiento/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cambiarVencimientoSchema } from '@/modules/suppliers/schemas.cuenta'
import { cambiarVencimiento } from '@/modules/suppliers/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Corregir el vencimiento de una obligacion.
 *
 * Es la UNICA columna de una recepcion que se puede cambiar, y el disparador de
 * PostgreSQL lo hace cumplir comparando la fila entera menos esa. Se permite
 * porque el vencimiento no es un hecho sobre la mercaderia --no movio stock ni
 * cambio un costo-- sino una condicion comercial que puede cambiar.
 *
 * Exige `supplierAccounts.adjust`: correr un vencimiento cambia si una deuda
 * figura como vencida, que es informacion con la que se decide a quien pagarle
 * primero. Queda auditado con el antes y el despues.
 */
export const PATCH = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.adjust',
    body: cambiarVencimientoSchema,
    audit: 'PATCH /api/purchases/recepciones/:id/vencimiento',
  },
  ({ session, body, params }) => cambiarVencimiento(session, parseWith(idSchema, params.id), body),
)
