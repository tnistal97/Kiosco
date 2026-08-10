// src/app/api/clients/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { crearClienteSchema, listarClientesQuerySchema } from '@/modules/clients/schemas'
import { crearCliente, listarClientes } from '@/modules/clients/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Clientes de la sucursal.
 *
 * Paginado en el servidor desde el primer dia: un comercio con diez mil
 * clientes no puede mandarlos todos, y el filtro "los que deben" tiene que
 * resolverse con un indice y no recorriendo la lista en el navegador.
 *
 * `clients.view` y no `accounts.view`: ver quien es un cliente y ver cuanto
 * debe son dos preguntas distintas. El saldo viaja igual en esta respuesta
 * --es una columna de la tabla y el listado se ordena y filtra por ella-- y por
 * eso los dos permisos van juntos en todos los roles que tienen alguno.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'clients.view',
    query: listarClientesQuerySchema,
    audit: 'GET /api/clients',
  },
  ({ session, query }) => listarClientes(session, query),
)

export const POST = handler(
  {
    auth: 'session',
    permission: 'clients.manage',
    body: crearClienteSchema,
    audit: 'POST /api/clients',
  },
  async ({ session, body }) =>
    NextResponse.json(await crearCliente(session, body), { status: 201 }),
)
