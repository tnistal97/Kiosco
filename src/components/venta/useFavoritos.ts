'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Favoritos del punto de venta: lo que no tiene codigo de barras.
 *
 * Pan, facturas, verdura, fiambre al corte: se vendian buscando por nombre,
 * cada vez. La auditoria los pidio como tiles (§22). Esta es la PRIMERA
 * version, y su limite esta puesto a proposito: se guardan EN ESTE EQUIPO,
 * en `localStorage`, por sucursal. No hay migracion ni modelo nuevo (la fase
 * lo prohibe), asi que otra caja no los ve. Compartirlos entre equipos es
 * trabajo de una fase siguiente, con esquema.
 *
 * Lo que se guarda son identificadores de producto. Nombre, precio y stock
 * se vuelven a pedir al servidor, como con el ticket guardado: nada del
 * navegador es fuente de verdad.
 */
const TOPE = 24

function clave(branchId: number): string {
  return `kiosco:favoritos:${String(branchId)}`
}

function leer(branchId: number): number[] {
  if (typeof window === 'undefined') return []
  try {
    const crudo = localStorage.getItem(clave(branchId))
    if (!crudo) return []
    const datos: unknown = JSON.parse(crudo)
    if (!Array.isArray(datos)) return []
    return datos
      .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
      .slice(0, TOPE)
  } catch {
    return []
  }
}

function guardar(branchId: number, ids: number[]): void {
  try {
    localStorage.setItem(clave(branchId), JSON.stringify(ids))
  } catch {
    // Modo privado o almacenamiento lleno: los favoritos duran la sesion.
  }
}

export function useFavoritos(branchId: number | null) {
  const [ids, setIds] = useState<number[]>([])

  useEffect(() => {
    if (branchId === null) return
    setIds(leer(branchId))
  }, [branchId])

  const alternar = useCallback(
    (productId: number) => {
      if (branchId === null) return
      setIds((actuales) => {
        const nuevos = actuales.includes(productId)
          ? actuales.filter((id) => id !== productId)
          : [...actuales, productId].slice(-TOPE)
        guardar(branchId, nuevos)
        return nuevos
      })
    },
    [branchId],
  )

  const esFavorito = useCallback((productId: number) => ids.includes(productId), [ids])

  return { ids, alternar, esFavorito }
}
