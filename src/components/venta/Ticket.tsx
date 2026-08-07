'use client'

import { memo } from 'react'
import { Button, EmptyState, IconButton, Money, QuantityInput, cn } from '@/components/ui'
import type { CartLine } from '@/store/cart'
import { multiplicarMonto, type Monto } from '@/lib/money'

/**
 * El ticket en curso.
 *
 * Cada linea muestra lo que hay que poder comprobar de un vistazo: producto,
 * precio unitario, cantidad, subtotal y cuanto stock queda.
 *
 * `memo` en la linea no es un adorno: con quince lineas y una cantidad que
 * cambia con cada tecla, volver a renderizar el ticket entero se nota en una
 * tablet. Solo se redibuja la linea que cambio.
 */

export const LineaTicket = memo(function LineaTicket({
  linea,
  onCantidad,
  onQuitar,
  onEditando,
}: {
  linea: CartLine
  onCantidad: (productId: number, cantidad: number) => void
  onQuitar: (productId: number) => void
  onEditando: (editando: boolean) => void
}) {
  const subtotal = multiplicarMonto(linea.price, linea.quantity)
  const enElTope = linea.quantity >= linea.stock

  /**
   * Atajos de la linea, activos mientras el foco esta dentro de ella.
   *
   *   +  y  −   cambian la cantidad. En el campo numerico no hacen nada por
   *             su cuenta (filtra todo lo que no sea un digito), asi que
   *             interceptarlos no le quita nada al usuario.
   *   Supr      quita la linea. Backspace sigue editando el numero: son dos
   *             teclas distintas y hacen dos cosas distintas.
   */
  function atajos(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.key === '+') {
      e.preventDefault()
      onCantidad(linea.productId, linea.quantity + 1)
      return
    }
    if (e.key === '-' || e.key === '−') {
      e.preventDefault()
      onCantidad(linea.productId, linea.quantity - 1)
      return
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      onQuitar(linea.productId)
    }
  }

  return (
    <li
      onKeyDown={atajos}
      className="flex flex-col gap-2 border-b border-line px-3 py-3 last:border-b-0"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{linea.name}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            <Money amount={linea.price} size="sm" tone="muted" /> c/u
            {enElTope && <span className="ml-2 text-warning">· sin más stock</span>}
          </p>
        </div>
        <IconButton
          label={`Quitar ${linea.name} del ticket`}
          size="sm"
          variant="ghost"
          onClick={() => {
            onQuitar(linea.productId)
          }}
          className="-mt-1 -mr-1 shrink-0 text-ink-faint hover:text-danger"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6 18 18M18 6 6 18" />
          </svg>
        </IconButton>
      </div>

      <div className="flex items-center justify-between gap-2">
        <QuantityInput
          size="sm"
          value={linea.quantity}
          max={linea.stock}
          label={`Cantidad de ${linea.name}`}
          onChange={(q) => {
            onCantidad(linea.productId, q)
          }}
          onEditingChange={onEditando}
        />
        <Money amount={subtotal} size="lg" />
      </div>
    </li>
  )
})

export function Ticket({
  lineas,
  total,
  unidades,
  onCantidad,
  onQuitar,
  onEditando,
  onVaciar,
  onCobrar,
  puedeCobrar,
  className,
}: {
  lineas: CartLine[]
  total: Monto
  unidades: number
  onCantidad: (productId: number, cantidad: number) => void
  onQuitar: (productId: number) => void
  onEditando: (editando: boolean) => void
  onVaciar: () => void
  onCobrar: () => void
  puedeCobrar: boolean
  className?: string
}) {
  const vacio = lineas.length === 0

  return (
    <section
      aria-label="Ticket en curso"
      className={cn('flex min-h-0 flex-col border-line bg-surface', className)}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">
          Ticket
          {!vacio && (
            <span className="ml-2 font-normal text-ink-muted" data-numeric="">
              {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
            </span>
          )}
        </h2>
        {!vacio && (
          <Button size="sm" variant="ghost" onClick={onVaciar}>
            Vaciar
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {vacio ? (
          <div className="p-4">
            <EmptyState
              title="El ticket está vacío"
              description="Escaneá un código o buscá un producto para empezar."
              className="border-0"
            />
          </div>
        ) : (
          <ul>
            {lineas.map((l) => (
              <LineaTicket
                key={l.productId}
                linea={l}
                onCantidad={onCantidad}
                onQuitar={onQuitar}
                onEditando={onEditando}
              />
            ))}
          </ul>
        )}
      </div>

      {/*
        El total y el boton de cobro viven fuera del area que se desplaza.
        Antes quedaban al pie de una columna con scroll: con seis productos
        el total dejaba de verse, que es justo lo que no puede pasar.
      */}
      <footer className="shrink-0 border-t border-line px-4 py-3">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-muted">Total</span>
          <Money amount={total} size="xl" />
        </div>
        <Button
          variant="confirm"
          size="lg"
          block
          disabled={!puedeCobrar}
          onClick={onCobrar}
          className="text-lg"
        >
          Cobrar
          <kbd className="ml-2 rounded border border-current/30 px-1.5 py-0.5 text-xs font-normal opacity-75">
            F12
          </kbd>
        </Button>
      </footer>
    </section>
  )
}
