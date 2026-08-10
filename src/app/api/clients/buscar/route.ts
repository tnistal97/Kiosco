// src/app/api/clients/buscar/route.ts
import { handler } from '@/server/http/handler'
import { buscarClientesQuerySchema } from '@/modules/clients/schemas'
import { buscarClientes } from '@/modules/clients/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Busqueda rapida para el mostrador.
 *
 * Endpoint aparte del listado, y no un `pageSize=8`, por dos motivos que se
 * notan en el mostrador:
 *
 *   · EXIGE texto. Sin `q` el esquema rechaza la peticion, asi que no existe
 *     forma de pedirle "todos los clientes" desde el punto de venta. Con diez
 *     mil clientes, un desplegable que los trae todos deja de abrirse.
 *   · Devuelve una lista pelada y no `{ data, pagination }`: es un desplegable
 *     de ocho renglones, no una tabla que se navega.
 *
 * `clients.view` alcanza: el cajero tiene que poder encontrar a Juan.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'clients.view',
    query: buscarClientesQuerySchema,
    audit: 'GET /api/clients/buscar',
  },
  ({ session, query }) => buscarClientes(session, query),
)
