'use client'

import { Money, StockBadge, cn } from '@/components/ui'
import type { Product } from '@/hooks/useProducts'
import { aMilesimas } from '@/lib/cantidad'
import {
  denominadorDePrecio,
  esFraccionable,
  formatearCantidadConUnidad,
} from '@/modules/products/units'

/**
 * Una fila de resultado de busqueda.
 *
 * Es un `button`, no un `div` con `onClick`: asi se llega con Tab, se
 * activa con Enter y un lector de pantalla lo anuncia como lo que es.
 *
 * `resaltada` marca el resultado seleccionado con el teclado. Se marca con
 * borde y fondo, no solo con color, porque es la fila que Enter va a agregar
 * y equivocarse ahi cuesta una linea de mas en el ticket.
 */
export function ResultadoBusqueda({
  producto,
  resaltada,
  onAgregar,
  onHover,
}: {
  producto: Product
  resaltada: boolean
  onAgregar: () => void
  onHover: () => void
}) {
  // Agotado es NO TENER NADA VENDIBLE, que no es lo mismo que no tener nada:
  // un producto con 10 unidades vencidas tiene stock y no se puede vender.
  const agotado = aMilesimas(producto.sellableStock) <= 0
  const hayVencido = aMilesimas(producto.expiredStock) > 0
  const porPeso = esFraccionable(producto.saleUnit)

  return (
    <li>
      <button
        type="button"
        disabled={agotado}
        onClick={onAgregar}
        onMouseEnter={onHover}
        // El foco lo maneja el buscador: mover el foco real a cada resultado
        // sacaria el cursor del campo y cortaria el escaneo.
        tabIndex={-1}
        aria-current={resaltada || undefined}
        className={cn(
          'flex w-full min-h-touch items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
          agotado && 'cursor-not-allowed opacity-55',
          resaltada
            ? 'border-primary bg-primary-quiet'
            : 'border-line bg-surface hover:border-line-strong hover:bg-raised',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{producto.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
            <span>{producto.category.name}</span>
            {producto.barcode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{producto.barcode}</span>
              </>
            )}
            {/* Un producto por peso avisa que va a pedir el peso: asi el
                cajero sabe que el diálogo que se abre no es un error. */}
            {porPeso && (
              <>
                <span aria-hidden="true">·</span>
                <span>se pesa</span>
              </>
            )}
          </p>

          {/* Los tres numeros, y SOLO cuando hay algo que explicar. Sin lotes
              vencidos --el catalogo entero, hoy-- la fila queda igual que
              antes. Con vencidos, la diferencia entre "hay 10" y "se pueden
              vender 3" deja de ser una sorpresa del momento de cobrar. */}
          {hayVencido && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
              <span className="text-ink-faint">
                Stock {formatearCantidadConUnidad(producto.totalStock, producto.saleUnit)}
              </span>
              <span aria-hidden="true" className="text-ink-faint">
                ·
              </span>
              <span className="font-medium text-ink">
                Vendible {formatearCantidadConUnidad(producto.sellableStock, producto.saleUnit)}
              </span>
              <span aria-hidden="true" className="text-ink-faint">
                ·
              </span>
              <span className="text-danger">
                Vencido {formatearCantidadConUnidad(producto.expiredStock, producto.saleUnit)}
              </span>
            </p>
          )}
        </div>

        {/* La chapa muestra lo VENDIBLE: es lo que el cajero puede prometer. */}
        <StockBadge quantity={producto.sellableStock} unit={producto.saleUnit} />
        <span className="w-28 text-right">
          <Money amount={producto.price} size="lg" />
          {porPeso && (
            <span className="block text-xs text-ink-faint">
              {denominadorDePrecio(producto.saleUnit)}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
