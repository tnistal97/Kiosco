'use client'

import { memo, useEffect, useId, useRef } from 'react'
import { Button, EmptyState, Kbd, Money, QuantityInput, cn, formatMoney } from '@/components/ui'
import type { CartLine } from '@/store/cart'
import type { Monto } from '@/lib/money'
import { aMilesimas, desdeMilesimas, precioPorCantidad, type TextoCantidad } from '@/lib/cantidad'
import {
  denominadorDePrecio,
  esFraccionable,
  formatearCantidadConUnidad,
  politicaDe,
} from '@/modules/products/units'
import { esEditable } from './foco'
import { moverSeleccion } from './teclado'

/**
 * El ticket en curso.
 *
 * Una linea por producto, densa: nombre y subtotal en el primer renglon,
 * "2 u. × $ 4.850" en el segundo. Los controles --cantidad y quitar-- solo se
 * dibujan en la linea SELECCIONADA: es lo que permite once lineas a la vista
 * en 1366 x 768 en vez de cuatro (auditoria, §22), y lo que hace que un toque
 * en una tablet sea "elegir" y el segundo "corregir".
 *
 * La seleccion es una idea de teclado, no de foco: se mueve con ↑ ↓ desde el
 * campo de escaneo sin que el cursor salga de ahi, y se marca con una barra y
 * un fondo, no solo con color. El foco real solo entra al ticket con Tab, y
 * entonces las mismas teclas funcionan desde aca.
 *
 * REVISAR (V3). Enter con el campo vacio no cobra: enciende `revisando`, y
 * entonces este panel es el que manda --se enmarca, dice que hacen las teclas
 * y el Enter siguiente abre el cobro--. Es el paso que faltaba entre "sigo
 * agregando" y "estoy por cobrar", y el que hace que dos Enter distraidos ya
 * no registren una venta.
 *
 * `memo` en la linea no es un adorno: con quince lineas y una cantidad que
 * cambia con cada tecla, volver a renderizar el ticket entero se nota en una
 * tablet. Solo se redibuja la linea que cambio.
 */

/**
 * La cantidad de una linea un paso mas arriba o abajo, o `null` si la linea
 * se pesa: para un producto por kilo no hay un "paso" que tenga sentido, y se
 * edita el peso entero.
 */
export function cantidadAjustada(linea: CartLine, delta: -1 | 1): TextoCantidad | null {
  if (esFraccionable(linea.saleUnit)) return null
  const paso = aMilesimas(politicaDe(linea.saleUnit).paso)
  return desdeMilesimas(aMilesimas(linea.quantity) + delta * paso)
}

export const LineaTicket = memo(function LineaTicket({
  linea,
  seleccionada,
  onSeleccionar,
  onCantidad,
  onQuitar,
  onEditando,
}: {
  linea: CartLine
  seleccionada: boolean
  onSeleccionar: (productId: number) => void
  onCantidad: (productId: number, cantidad: TextoCantidad) => void
  onQuitar: (productId: number) => void
  onEditando: (editando: boolean) => void
}) {
  const subtotal = precioPorCantidad(linea.price, linea.quantity)
  const enElTope = aMilesimas(linea.quantity) >= aMilesimas(linea.stock)
  const ref = useRef<HTMLLIElement>(null)

  // La seleccionada siempre a la vista: con veinte lineas, ↓ tiene que mostrar
  // la que eligio y no dejarla debajo del pliegue.
  useEffect(() => {
    if (seleccionada) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [seleccionada])

  return (
    <li
      ref={ref}
      id={`linea-${String(linea.productId)}`}
      data-linea={linea.productId}
      aria-current={seleccionada || undefined}
      onClick={() => {
        onSeleccionar(linea.productId)
      }}
      className={cn(
        'flex flex-col gap-1 border-b border-l-[3px] border-b-line px-3 py-2.5 transition-colors last:border-b-0',
        seleccionada ? 'border-l-primary bg-selection' : 'border-l-transparent hover:bg-raised/60',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{linea.name}</p>
        <Money amount={subtotal} size="md" />
      </div>
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink-muted" data-numeric="">
        <span>{formatearCantidadConUnidad(linea.quantity, linea.saleUnit)}</span>
        <span aria-hidden="true">×</span>
        <Money amount={linea.price} size="sm" tone="muted" />
        {denominadorDePrecio(linea.saleUnit) && <span>{denominadorDePrecio(linea.saleUnit)}</span>}
        {enElTope && <span className="text-warning">· sin más stock</span>}
      </p>

      {seleccionada && (
        <div className="flex items-center justify-between gap-2 pt-1.5">
          <QuantityInput
            value={linea.quantity}
            unit={linea.saleUnit}
            max={linea.stock}
            label={`Cantidad de ${linea.name}`}
            onChange={(q) => {
              onCantidad(linea.productId, q)
            }}
            onEditingChange={onEditando}
          />
          <Button
            size="sm"
            variant="ghost"
            className="text-ink-muted hover:text-danger"
            onClick={() => {
              onQuitar(linea.productId)
            }}
          >
            Quitar
            <Kbd>Supr</Kbd>
          </Button>
        </div>
      )}
    </li>
  )
})

export function Ticket({
  lineas,
  total,
  articulos,
  seleccionada,
  revisando = false,
  onSeleccionar,
  onCantidad,
  onAjustar,
  onQuitar,
  onEditarPeso,
  onEditando,
  onVaciar,
  onCobrar,
  onSalir,
  ultimaVenta = null,
  puedeCobrar,
  className,
}: {
  lineas: CartLine[]
  total: Monto
  /**
   * Cuantas LINEAS tiene el ticket, no cuantas unidades.
   *
   * Desde que hay productos por peso no puede ser otra cosa: sumar 3 gaseosas
   * con 0,425 kg de queso daria 3,425 de nada.
   */
  articulos: number
  /** Producto de la linea seleccionada con el teclado, o null. */
  seleccionada: number | null
  /**
   * El teclado esta puesto ACA: se esta revisando antes de cobrar.
   *
   * Se llega con Enter desde el campo vacio. El panel se enmarca y dice que
   * hacen las teclas; no es un dialogo ni un paso obligatorio --Escape vuelve
   * y el ticket queda igual-- pero es lo que separa "sigo agregando" de
   * "estoy por cobrar".
   */
  revisando?: boolean
  onSeleccionar: (productId: number | null) => void
  onCantidad: (productId: number, cantidad: TextoCantidad) => void
  /** Una unidad mas o menos. La pantalla decide que pasa al llegar a cero. */
  onAjustar: (linea: CartLine, delta: -1 | 1) => void
  onQuitar: (productId: number) => void
  /** Enter sobre una linea que se pesa: abre el peso para corregirlo. */
  onEditarPeso: (productId: number) => void
  onEditando: (editando: boolean) => void
  onVaciar: () => void
  onCobrar: () => void
  /** La venta anterior, para tenerla a mano sin salir de la caja. */
  ultimaVenta?: { id: number; total: Monto } | null
  /** Escape con el foco en el ticket: vuelve al campo de escaneo. */
  onSalir?: () => void
  puedeCobrar: boolean
  className?: string
}) {
  const vacio = lineas.length === 0
  const idAyuda = useId()
  const lineaSeleccionada = lineas.find((l) => l.productId === seleccionada) ?? null

  /**
   * Las mismas teclas que en el campo de escaneo, cuando el foco esta en el
   * ticket. Se ignoran con el foco en un campo de texto: dentro del campo de
   * cantidad las flechas ya suben y bajan el numero, y Supr borra un digito.
   *
   * El grupo enfocable es un `div` alrededor de la lista, y no la lista con
   * otro rol: un `ul` con `role="group"` deja a sus `li` sin lista que los
   * contenga, y eso es una falta de accesibilidad.
   */
  function alPresionar(e: React.KeyboardEvent<HTMLDivElement>) {
    if (esEditable(e.target)) return
    const ids = lineas.map((l) => l.productId)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        onSeleccionar(moverSeleccion(ids, seleccionada, 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        onSeleccionar(moverSeleccion(ids, seleccionada, -1))
        return
      case 'ArrowRight':
      case '+':
        if (lineaSeleccionada) {
          e.preventDefault()
          onAjustar(lineaSeleccionada, 1)
        }
        return
      case 'ArrowLeft':
      case '-':
      case '−':
        if (lineaSeleccionada) {
          e.preventDefault()
          onAjustar(lineaSeleccionada, -1)
        }
        return
      case 'Delete':
        if (lineaSeleccionada) {
          e.preventDefault()
          onQuitar(lineaSeleccionada.productId)
        }
        return
      case 'Enter':
        if (lineaSeleccionada) {
          e.preventDefault()
          if (esFraccionable(lineaSeleccionada.saleUnit)) {
            onEditarPeso(lineaSeleccionada.productId)
          } else {
            e.currentTarget
              .querySelector<HTMLInputElement>('[aria-current] input[role="spinbutton"]')
              ?.focus()
          }
        }
        return
      case 'Escape':
        e.preventDefault()
        onSalir?.()
        return
    }
  }

  return (
    <section
      aria-label="Ticket en curso"
      data-revisando={revisando || undefined}
      className={cn(
        'flex min-h-0 flex-col border-line bg-surface transition-colors',
        // Revisando, el panel entero se marca: es donde estan puestas las
        // teclas, y tiene que verse sin leer nada.
        revisando && 'ring-2 ring-primary ring-inset',
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">
          Ticket
          {!vacio && (
            <span className="ml-2 font-normal text-ink-muted" data-numeric="">
              {articulos} {articulos === 1 ? 'artículo' : 'artículos'}
            </span>
          )}
        </h2>
        {!vacio && (
          <Button size="sm" variant="ghost" onClick={onVaciar}>
            Vaciar
          </Button>
        )}
      </header>

      {/* Que hacen las teclas ahora. Solo mientras se revisa: el resto del
          tiempo el ticket es una lista y no tiene por que explicarse. */}
      {revisando && !vacio && (
        <p className="shrink-0 border-b border-line bg-primary-quiet px-4 py-1.5 text-xs text-ink-muted">
          Revisá el ticket · <Kbd>↑↓</Kbd> línea · <Kbd>←→</Kbd> cantidad · <Kbd>Supr</Kbd> quita ·{' '}
          <Kbd>Enter</Kbd> cobra · <Kbd>Esc</Kbd> seguir agregando
        </p>
      )}

      {/* Lo que se anuncia al elegir una linea con el teclado, para quien no
          la ve resaltarse. */}
      <p className="sr-only" aria-live="polite">
        {lineaSeleccionada
          ? `${lineaSeleccionada.name}, ${formatearCantidadConUnidad(lineaSeleccionada.quantity, lineaSeleccionada.saleUnit)}`
          : ''}
      </p>
      <p id={idAyuda} className="sr-only">
        Flechas arriba y abajo eligen una línea; izquierda y derecha cambian la cantidad; Suprimir
        la quita; Enter la edita.
      </p>

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
          <div
            role="group"
            tabIndex={0}
            aria-label="Líneas del ticket"
            aria-describedby={idAyuda}
            onKeyDown={alPresionar}
            className="outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          >
            <ul>
              {lineas.map((l) => (
                <LineaTicket
                  key={l.productId}
                  linea={l}
                  seleccionada={l.productId === seleccionada}
                  onSeleccionar={onSeleccionar}
                  onCantidad={onCantidad}
                  onQuitar={onQuitar}
                  onEditando={onEditando}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      {/*
        El total y el boton de cobro viven fuera del area que se desplaza.
        Antes quedaban al pie de una columna con scroll: con seis productos
        el total dejaba de verse, que es justo lo que no puede pasar.
      */}
      <footer className="shrink-0 border-t border-line px-4 py-3">
        {/* La venta anterior, discreta y solo con el ticket vacio: sirve para
            confirmar cuanto se cobro recien, no para mirarla mientras se
            arma la siguiente. */}
        {vacio && ultimaVenta && (
          <p className="mb-2 flex items-baseline justify-between gap-3 text-xs text-ink-faint">
            <span data-numeric="">Última venta #{ultimaVenta.id}</span>
            <Money amount={ultimaVenta.total} size="sm" tone="muted" />
          </p>
        )}
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-muted">Total</span>
          <Money amount={total} size="xl" />
        </div>
        {/* El importe VA en el boton: es lo ultimo que se mira antes de
            cobrar. Sin ticket no es un boton verde apagado --que se lee como
            "apretable"-- sino uno gris, que se lee como lo que es. */}
        <Button
          variant={puedeCobrar ? 'confirm' : 'secondary'}
          size="xl"
          block
          disabled={!puedeCobrar}
          onClick={onCobrar}
          className="text-lg"
        >
          {puedeCobrar ? `Cobrar ${formatMoney(total)}` : 'Cobrar'}
          {puedeCobrar && <Kbd>Enter</Kbd>}
        </Button>
      </footer>
    </section>
  )
}
