'use client'

import { useEffect, useState } from 'react'
import { buscarProductosPorIds, type Product } from '@/hooks/useProducts'

/**
 * Los productos de una lista de identificadores, frescos y en ese orden.
 *
 * Es lo que hay detras de "Frecuentes" y de los favoritos: del navegador
 * solo salen identificadores, y el nombre, el precio y el stock se vuelven a
 * pedir al servidor cada vez --y despues de cada venta, con `recarga`--.
 *
 * Un producto dado de baja no vuelve: `buscarProductosPorIds` solo trae
 * activos, y la lista simplemente lo saltea.
 */
export function useProductosPorIds(ids: readonly number[], recarga = 0) {
  const [productos, setProductos] = useState<Product[]>([])
  const [cargando, setCargando] = useState(false)

  const claveDeIds = ids.join(',')

  useEffect(() => {
    if (ids.length === 0) {
      setProductos([])
      return
    }
    let vivo = true
    setCargando(true)
    void buscarProductosPorIds([...ids])
      .then((frescos) => {
        if (!vivo) return
        const porId = new Map(frescos.map((p) => [p.id, p]))
        setProductos(ids.flatMap((id) => porId.get(id) ?? []))
      })
      .catch(() => {
        // Sin red la grilla queda como estaba: el escaneo sigue funcionando.
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
    // `ids` cambia de identidad en cada render del padre; la clave no.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver comentario
  }, [claveDeIds, recarga])

  return { productos, cargando }
}
