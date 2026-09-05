'use client'

import { useEffect, useState } from 'react'
import { Button, Money, cn } from '@/components/ui'
import { buscarProductosPorIds, type Product } from '@/hooks/useProducts'
import { aMilesimas } from '@/lib/cantidad'
import { denominadorDePrecio, esFraccionable } from '@/modules/products/units'

/**
 * La grilla de favoritos del punto de venta.
 *
 * Ocupa el lugar que antes estaba vacio la mayor parte del dia (auditoria,
 * H-29): un toque agrega el producto, o abre el peso si se pesa. Con la
 * estrella de los resultados se marcan y se desmarcan; con "Editar" se quitan
 * desde aca, que es lo que hace falta en una tablet sin teclado.
 */
export function Favoritos({
  ids,
  onElegir,
  onQuitar,
  recarga,
}: {
  ids: number[]
  onElegir: (p: Product) => void
  onQuitar: (productId: number) => void
  /** Cambia cuando hay que volver a pedir precio y stock (tras una venta). */
  recarga: number
}) {
  const [productos, setProductos] = useState<Product[]>([])
  const [editando, setEditando] = useState(false)

  const claveDeIds = ids.join(',')

  useEffect(() => {
    if (ids.length === 0) {
      setProductos([])
      return
    }
    let vivo = true
    void buscarProductosPorIds(ids)
      .then((frescos) => {
        if (!vivo) return
        // En el orden en que se marcaron, no en el que los devolvio el servidor.
        const porId = new Map(frescos.map((p) => [p.id, p]))
        setProductos(ids.flatMap((id) => porId.get(id) ?? []))
      })
      .catch(() => {
        // Sin red la grilla queda como estaba: el escaneo sigue funcionando.
      })
    return () => {
      vivo = false
    }
    // `ids` cambia de identidad en cada render del padre; la clave no.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver comentario
  }, [claveDeIds, recarga])

  if (ids.length === 0) return null

  return (
    <section aria-label="Favoritos" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Favoritos</h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditando((v) => !v)
          }}
        >
          {editando ? 'Listo' : 'Editar'}
        </Button>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {productos.map((p) => {
          const agotado = aMilesimas(p.sellableStock) <= 0
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={agotado && !editando}
                aria-label={editando ? `Quitar ${p.name} de favoritos` : undefined}
                onClick={() => {
                  if (editando) onQuitar(p.id)
                  else onElegir(p)
                }}
                className={cn(
                  'flex min-h-touch w-full flex-col items-start justify-between gap-1 rounded-lg border px-3 py-2 text-left transition-colors',
                  editando
                    ? 'border-danger/45 hover:bg-danger-quiet'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-raised',
                  agotado && !editando && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="line-clamp-2 text-sm font-medium text-ink">{p.name}</span>
                <span className="flex w-full items-baseline justify-between gap-2 text-xs text-ink-faint">
                  <span>
                    {editando
                      ? 'Quitar'
                      : agotado
                        ? 'Agotado'
                        : esFraccionable(p.saleUnit)
                          ? 'se pesa'
                          : ''}
                  </span>
                  <span>
                    <Money amount={p.price} size="sm" />
                    {esFraccionable(p.saleUnit) && ` ${denominadorDePrecio(p.saleUnit)}`}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
