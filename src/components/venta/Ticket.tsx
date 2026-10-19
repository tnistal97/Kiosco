'use client'

import { memo, useEffect, useId, useRef } from 'react'
import { Button, EmptyState, Kbd, Money, QuantityInput, cn } from '@/components/ui'
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
import { esRepeticionIgnorada, moverSeleccion } from './teclado'

/**
 * El carrito: el ticket en curso. Es la segunda etapa de la venta (V6).
 *
 * Una linea por producto: nombre y subtotal en el primer renglon; en el
 * segundo, los botones − y + con la cantidad en el medio, el precio unitario
 * y "Quitar". Desde la V5 los controles estan en TODAS las lineas: en la V3
 * solo aparecian al tocar la linea, y quien entraba por primera vez no
 * encontraba como llevar dos. Cuesta un renglon por linea; a cambio, cambiar
 * la cantidad no hay que descubrirlo.
 *
 * La seleccion es una idea de teclado, no de foco: se mueve con ↑ ↓ desde el
 * buscador sin que el cursor salga de ahi, y se marca con una barra y un
 * fondo, no solo con color. El foco real solo entra al carrito con Tab (o al
 * abrirlo como hoja), y entonces las mismas teclas funcionan desde aca.
 *
 * REVISAR (V3, V6). Enter en productos no cobra: enciende `revisando`, y
 * entonces este panel es el que manda --se enmarca, dice que hacen las teclas
 * y el Enter siguiente abre el cobro--. Revisando, ↑ ↓ eligen linea, → suma
 * una unidad, ← resta una (en cero, quita la linea), Enter cobra y Esc vuelve
 * a productos.
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
  onVolverAlCampo,
  onCantidad,
  onQuitar,
  onEditando,
}: {
  linea: CartLine
  seleccionada: boolean
  onSeleccionar: (productId: number) => void
  /** Despues de tocar la linea o uno de sus botones, el foco vuelve al lector. */
  onVolverAlCampo?: () => void
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
      onClick={(e) => {
        onSeleccionar(linea.productId)
        // Escribiendo una cantidad a mano, el foco se queda en ese campo.
        if (!esEditable(e.target)) onVolverAlCampo?.()
      }}
      className={cn(
        'flex flex-col gap-1.5 border-b border-l-4 border-b-line px-3 py-2.5 transition-colors last:border-b-0',
        seleccionada ? 'border-l-primary bg-selection' : 'border-l-transparent hover:bg-raised',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">
          {linea.name}
        </p>
        <Money amount={subtotal} size="md" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
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
          <p
            className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm text-ink-muted"
            data-numeric=""
          >
            <span aria-hidden="true">×</span>
            <Money amount={linea.price} size="sm" tone="muted" />
            {denominadorDePrecio(linea.saleUnit) && (
              <span>{denominadorDePrecio(linea.saleUnit)}</span>
            )}
            {enElTope && <span className="font-medium text-warning">· no hay más stock</span>}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 px-2 hover:text-danger"
          aria-label={`Quitar ${linea.name}`}
          onClick={(e) => {
            // No sube a la linea: si subiera, la volveria a seleccionar
            // despues de quitarla.
            e.stopPropagation()
            onQuitar(linea.productId)
            onVolverAlCampo?.()
          }}
        >
          Quitar
        </Button>
      </div>
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
  onVolverAlCampo,
  onCantidad,
  onAjustar,
  onQuitar,
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
  /** Despues de tocar una linea, el foco vuelve al campo del lector. */
  onVolverAlCampo?: () => void
  onCantidad: (productId: number, cantidad: TextoCantidad) => void
  /** Una unidad mas o menos. La pantalla decide que pasa al llegar a cero. */
  onAjustar: (linea: CartLine, delta: -1 | 1) => void
  onQuitar: (productId: number) => void
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
  const grupo = useRef<HTMLDivElement>(null)

  // Abierto como hoja (telefono, tablet, menos de 1280 px), el carrito tapa
  // el buscador: revisar pone el foco en las lineas para que las flechas
  // sigan funcionando. En escritorio el foco se queda en el buscador.
  useEffect(() => {
    if (!revisando) return
    const id = requestAnimationFrame(() => {
      const el = grupo.current
      if (el?.closest('[role="dialog"]') && !el.contains(document.activeElement)) el.focus()
    })
    return () => {
      cancelAnimationFrame(id)
    }
  }, [revisando])

  /**
   * Las mismas teclas que en el buscador durante la etapa del carrito, cuando
   * el foco esta aca. Se ignoran con el foco en un campo de texto: dentro del
   * campo de cantidad las flechas ya suben y bajan el numero, y Supr borra un
   * digito.
   *
   * El grupo enfocable es un `div` alrededor de la lista, y no la lista con
   * otro rol: un `ul` con `role="group"` deja a sus `li` sin lista que los
   * contenga, y eso es una falta de accesibilidad.
   */
  function alPresionar(e: React.KeyboardEvent<HTMLDivElement>) {
    if (esEditable(e.target)) return
    const ids = lineas.map((l) => l.productId)
    // Un →, un Enter o un Supr sostenidos no se repiten: treinta unidades de
    // mas por dejar el dedo apoyado no es una forma de vender.
    if (esRepeticionIgnorada(e.key, e.repeat)) {
      e.preventDefault()
      return
    }
    // Enter sobre un boton de la linea (−, +, Quitar) es ese boton, no el
    // carrito.
    const enBoton = e.target instanceof HTMLElement && e.target.closest('button') !== null

    switch (e.key) {
      // ↑ ↓ recorren las lineas. Nunca cambian una cantidad.
      case 'ArrowDown':
        e.preventDefault()
        onSeleccionar(moverSeleccion(ids, seleccionada, 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        onSeleccionar(moverSeleccion(ids, seleccionada, -1))
        return
      // → y ← cambian la cantidad de la elegida, de a una. + y - son lo mismo.
      case 'ArrowRight':
      case '+':
        e.preventDefault()
        if (lineaSeleccionada) onAjustar(lineaSeleccionada, 1)
        return
      case 'ArrowLeft':
      case '-':
      case '−':
        e.preventDefault()
        if (lineaSeleccionada) onAjustar(lineaSeleccionada, -1)
        return
      case 'Delete':
        if (lineaSeleccionada) {
          e.preventDefault()
          onQuitar(lineaSeleccionada.productId)
        }
        return
      case 'Enter':
        // Enter avanza: del carrito, al cobro. Siempre, tambien sobre una
        // linea que se pesa: el peso se corrige con → o ←.
        if (enBoton) return
        e.preventDefault()
        if (puedeCobrar) onCobrar()
        return
      case 'Escape':
        e.preventDefault()
        onSalir?.()
        return
    }
  }

  return (
    <section
      aria-label="Carrito"
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
          Carrito
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
        <p
          data-revisando-ayuda=""
          className="shrink-0 border-b border-line bg-primary-quiet px-4 py-2 text-sm text-ink"
        >
          <strong className="font-semibold">Revisá el carrito.</strong> <Kbd>↑</Kbd> <Kbd>↓</Kbd>{' '}
          revisar · <Kbd>→</Kbd> +1 · <Kbd>←</Kbd> −1 · <Kbd>Enter</Kbd> cobrar · <Kbd>Esc</Kbd>{' '}
          volver
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
        Flecha arriba y abajo eligen una línea; derecha suma una unidad e izquierda resta una;
        Suprimir la quita; Enter pasa a cobrar; Escape vuelve a los productos.
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {vacio ? (
          <div className="p-4">
            <EmptyState
              title="El carrito está vacío"
              description="Escaneá un código o buscá un producto para empezar."
              className="border-0"
            />
          </div>
        ) : (
          <div
            ref={grupo}
            role="group"
            tabIndex={0}
            aria-label="Líneas del carrito"
            aria-describedby={idAyuda}
            onKeyDown={alPresionar}
            className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          >
            <ul>
              {lineas.map((l) => (
                <LineaTicket
                  key={l.productId}
                  linea={l}
                  seleccionada={l.productId === seleccionada}
                  onSeleccionar={onSeleccionar}
                  onVolverAlCampo={onVolverAlCampo}
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
        {/* El TOTAL es la cifra mas grande de la pantalla: es lo que se le
            dice al cliente y lo que se mira desde el otro lado del
            mostrador. */}
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-base font-bold tracking-wide text-ink">TOTAL</span>
          <Money amount={total} size="hero" />
        </div>
        {/* Sin ticket no es un boton azul apagado --que se lee como
            "apretable"-- sino uno gris, que se lee como lo que es. */}
        <Button
          variant="primary"
          size="xl"
          block
          disabled={!puedeCobrar}
          onClick={onCobrar}
          className="text-xl"
        >
          Cobrar
          {puedeCobrar && <Kbd>Enter</Kbd>}
        </Button>
      </footer>
    </section>
  )
}
