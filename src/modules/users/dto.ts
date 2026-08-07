/**
 * Usuarios tal como viajan por la API.
 *
 * Nunca hay un hash aca porque nunca lo manda el servidor
 * (`CAMPOS_PUBLICOS`). Esto solo lee lo que llega.
 */

import { esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import type { Pagination } from '@/server/http/pagination'

export interface UsuarioDTO {
  id: number
  username: string
  name: string
  isActive: boolean
  createdAt: string
  role: { id: number; name: string }
  branch: { id: number; name: string }
}

export interface RolDTO {
  id: number
  name: string
}

function parseReferencia(raw: unknown): { id: number; name: string } {
  if (!esObjeto(raw)) return { id: 0, name: '—' }
  return { id: numero(raw.id), name: texto(raw.name, '—') }
}

export function parseUsuario(raw: unknown): UsuarioDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un usuario')
  }
  return {
    id: numero(raw.id),
    username: texto(raw.username),
    name: texto(raw.name),
    isActive: raw.isActive !== false,
    createdAt: textoOpcional(raw.createdAt) ?? '',
    role: parseReferencia(raw.role),
    branch: parseReferencia(raw.branch),
  }
}

export interface PaginaUsuarios {
  data: UsuarioDTO[]
  pagination: Pagination
}

export function parsePaginaUsuarios(raw: unknown): PaginaUsuarios {
  const data = lista(esObjeto(raw) && 'data' in raw ? raw.data : raw, parseUsuario)
  const p = esObjeto(raw) && esObjeto(raw.pagination) ? raw.pagination : {}
  return {
    data,
    pagination: {
      page: numero(p.page, 1),
      pageSize: numero(p.pageSize, data.length),
      total: numero(p.total, data.length),
      totalPages: Math.max(1, numero(p.totalPages, 1)),
    },
  }
}

export function parseRoles(raw: unknown): RolDTO[] {
  const fuente = esObjeto(raw) && 'data' in raw ? raw.data : raw
  return lista(fuente, (r) => {
    if (!esObjeto(r)) throw new Error('La respuesta no tiene la forma de un rol')
    return { id: numero(r.id), name: texto(r.name) }
  })
}
