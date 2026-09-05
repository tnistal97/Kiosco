'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Lo que mas se vende EN ESTA CAJA. UX V2, Fase 2.
 *
 * La grilla del punto de venta arranca con algo util en vez de vacia: los
 * productos que este equipo mas veces puso en un ticket. Se cuentan aca, en
 * `localStorage` y por sucursal, con el mismo limite --deliberado-- que los
 * favoritos: no hay esquema nuevo ni consulta al servidor, asi que otra caja
 * no los ve y un equipo recien instalado arranca sin frecuentes (y muestra
 * "Todos"). El ranking real de ventas existe en Reportes, pero pide un
 * permiso que el cajero no tiene, y esto es para el cajero.
 *
 * Lo que se guarda son identificadores y cuentas. Nombre, precio y stock se
 * vuelven a pedir al servidor cada vez, como con los favoritos y el ticket
 * guardado: nada del navegador es fuente de verdad.
 */
const TOPE = 24

/** Cuantos productos distintos se recuerdan antes de olvidar los menos usados. */
const MEMORIA = 200

interface Uso {
  /** Veces que entro a un ticket. */
  n: number
  /** Ultima vez, en milisegundos. Desempata. */
  t: number
}

type Usos = Record<string, Uso>

function clave(branchId: number): string {
  return `kiosco:frecuentes:${String(branchId)}`
}

function leer(branchId: number): Usos {
  if (typeof window === 'undefined') return {}
  try {
    const crudo = localStorage.getItem(clave(branchId))
    if (!crudo) return {}
    const datos: unknown = JSON.parse(crudo)
    if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return {}
    const salida: Usos = {}
    for (const [id, uso] of Object.entries(datos as Record<string, unknown>)) {
      if (!/^\d+$/.test(id)) continue
      if (typeof uso !== 'object' || uso === null) continue
      const { n, t } = uso as { n?: unknown; t?: unknown }
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
      salida[id] = { n: Math.floor(n), t: typeof t === 'number' && Number.isFinite(t) ? t : 0 }
    }
    return salida
  } catch {
    return {}
  }
}

function guardar(branchId: number, usos: Usos): void {
  try {
    localStorage.setItem(clave(branchId), JSON.stringify(usos))
  } catch {
    // Modo privado o almacenamiento lleno: los frecuentes duran la sesion.
  }
}

/** Los mas usados primero; a igual uso, el mas reciente. */
export function ordenarFrecuentes(usos: Usos, tope = TOPE): number[] {
  return Object.entries(usos)
    .sort(([, a], [, b]) => b.n - a.n || b.t - a.t)
    .slice(0, tope)
    .map(([id]) => Number(id))
}

/** Suma un uso, y olvida los menos usados si la memoria se pasa. */
export function registrarUso(usos: Usos, productId: number, ahora: number): Usos {
  const id = String(productId)
  const actual = usos[id]
  const nuevos: Usos = { ...usos, [id]: { n: (actual?.n ?? 0) + 1, t: ahora } }
  const ids = Object.keys(nuevos)
  if (ids.length <= MEMORIA) return nuevos
  const conservar = new Set(ordenarFrecuentes(nuevos, MEMORIA).map(String))
  return Object.fromEntries(Object.entries(nuevos).filter(([k]) => conservar.has(k)))
}

export function useFrecuentes(branchId: number | null) {
  const [usos, setUsos] = useState<Usos>({})

  useEffect(() => {
    if (branchId === null) return
    setUsos(leer(branchId))
  }, [branchId])

  const registrar = useCallback(
    (productId: number) => {
      if (branchId === null) return
      setUsos((actuales) => {
        const nuevos = registrarUso(actuales, productId, Date.now())
        guardar(branchId, nuevos)
        return nuevos
      })
    },
    [branchId],
  )

  const ids = useMemo(() => ordenarFrecuentes(usos), [usos])

  return { ids, registrar }
}
