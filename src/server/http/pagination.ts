/**
 * Contrato unico de paginacion.
 *
 * Toda respuesta que devuelva una coleccion que pueda crecer sin limite usa
 * esta forma:
 *
 *   { "data": [...],
 *     "pagination": { "page": 1, "pageSize": 25, "total": 200, "totalPages": 8 } }
 *
 * Antes cada endpoint devolvia un array pelado y el cliente se traia la tabla
 * entera. Con una sucursal y pocos meses de operacion eso funciona; con dos
 * anos de auditoria, no.
 */

import { z } from 'zod'

/** Tope duro. Ni siquiera pidiendolo explicitamente se devuelve mas. */
export const PAGE_SIZE_MAX = 100
export const PAGE_SIZE_DEFAULT = 25

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface Paginated<T> {
  data: T[]
  pagination: Pagination
}

/**
 * Esquema de `?page=&pageSize=`.
 *
 * `coerce` porque en la query todo llega como cadena. El maximo se aplica en
 * el esquema, no en la consulta: pedir pageSize=100000 es un error de
 * peticion, no algo que haya que recortar en silencio.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(100_000).default(1),
  pageSize: z.coerce.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

/** Convierte `?page=3&pageSize=25` en el `skip`/`take` de Prisma. */
export function toSkipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize }
}

export function paginado<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  return {
    data,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

/**
 * Construye un esquema de orden a partir de los campos permitidos.
 *
 * Lista blanca a proposito: pasar el nombre del campo directo a `orderBy`
 * deja que el cliente ordene por cualquier columna, incluidas las de tablas
 * relacionadas, y eso es tanto una fuga como una forma facil de tumbar la
 * base con un orden sin indice.
 */
export function sortSchema<const T extends readonly [string, ...string[]]>(
  campos: T,
  porDefecto: T[number],
) {
  return z.object({
    sortBy: z.enum(campos).default(porDefecto),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
}
