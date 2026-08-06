/**
 * Datos de sesion tal como viajan por la API.
 *
 * `permissions` llega desde el servidor para que la navegacion pueda ocultar
 * lo que el usuario no puede usar. Ocultar es comodidad: la decision real la
 * sigue tomando cada endpoint contra la base.
 */

import { esObjeto, lista, numero, texto } from '@/lib/api-client'

export interface SesionDTO {
  valid: boolean
  user: {
    id: number
    name: string
    username: string
    role: string
    branchId: number
    permissions: string[]
  } | null
}

export function parseSesion(raw: unknown): SesionDTO {
  if (!esObjeto(raw) || raw.valid !== true || !esObjeto(raw.user)) {
    return { valid: false, user: null }
  }
  const u = raw.user
  return {
    valid: true,
    user: {
      id: numero(u.id),
      name: texto(u.name),
      username: texto(u.username),
      role: texto(u.role),
      branchId: numero(u.branchId),
      permissions: lista(u.permissions, (p) => texto(p)),
    },
  }
}
