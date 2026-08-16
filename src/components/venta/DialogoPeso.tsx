'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, Money } from '@/components/ui'
import {
  aMilesimas,
  cantidadDesdeTexto,
  precioPorCantidad,
  type TextoCantidad,
} from '@/lib/cantidad'
import { CERO, type Monto } from '@/lib/money'
import {
  denominadorDePrecio,
  formatearCantidadConUnidad,
  motivoDeCantidadInvalida,
  politicaDe,
  type UnidadDeVenta,
} from '@/modules/products/units'
import { balanzaActual } from '@/lib/scale'

/**
 * Cuanto pesa lo que se esta vendiendo.
 *
 * Se abre SOLO para productos fraccionables --`KG` y `L`--, y se abre solo:
 * al escanear un queso, lo que hace falta a continuacion es el peso, siempre.
 * Obligar a un clic mas antes de poder tipearlo seria pedirle al cajero que le
 * avise al sistema algo que el sistema ya sabe.
 *
 * Un producto por unidad NO pasa por aca: se agrega uno y listo.
 *
 * Decisiones que se notan en el mostrador:
 *
 *   · el foco entra en el campo y el texto queda seleccionado, asi que se
 *     puede escanear, tipear y confirmar sin tocar el mouse;
 *   · Enter confirma, Escape cancela;
 *   · el subtotal se actualiza en cada tecla, porque es lo que el cliente
 *     esta mirando por encima del mostrador;
 *   · los botones ocupan el ancho completo en pantallas chicas: en una
 *     tactil de mostrador se aprieta con el pulgar.
 *
 * El subtotal que se ve aca es una PREVISUALIZACION. El definitivo lo calcula
 * el servidor con el precio de la base. Ver docs/PHASE3_QUANTITY_MIGRATION.md.
 */
export function DialogoPeso({
  abierto,
  producto,
  onCerrar,
  onConfirmar,
}: {
  abierto: boolean
  producto: {
    name: string
    price: Monto
    saleUnit: UnidadDeVenta
    /** El techo: lo VENDIBLE, no el total. Ver src/modules/lots/vendible.ts. */
    sellableStock: TextoCantidad
  } | null
  onCerrar: () => void
  onConfirmar: (cantidad: TextoCantidad) => void
}) {
  const campo = useRef<HTMLInputElement>(null)
  const [texto, setTexto] = useState('')

  // Cada apertura arranca vacia. Conservar el peso anterior haria que confirmar
  // sin mirar cobrara el queso del cliente de antes.
  useEffect(() => {
    if (abierto) setTexto('')
  }, [abierto, producto])

  const unidad = producto?.saleUnit ?? 'KG'
  const politica = politicaDe(unidad)

  const cantidad = useMemo(() => cantidadDesdeTexto(texto), [texto])

  const problema = useMemo(() => {
    if (producto === null) return null
    if (texto.trim() === '') return null
    if (cantidad === null) return 'Escribí un número'

    const motivo = motivoDeCantidadInvalida(unidad, cantidad)
    if (motivo !== null) return motivo

    if (aMilesimas(cantidad) > aMilesimas(producto.sellableStock)) {
      return `Solo quedan ${formatearCantidadConUnidad(producto.sellableStock, unidad)}`
    }
    return null
  }, [cantidad, producto, texto, unidad])

  const subtotal: Monto =
    producto !== null && cantidad !== null && problema === null
      ? precioPorCantidad(producto.price, cantidad)
      : CERO

  const puedeConfirmar = cantidad !== null && problema === null

  function confirmar() {
    if (cantidad === null || problema !== null) return
    onConfirmar(cantidad)
  }

  // La balanza se consulta, no se asume. Hoy `balanzaActual()` devuelve null en
  // todos los equipos y el dialogo funciona igual: se tipea. El dia que haya
  // una conectada, este es el unico lugar que se entera.
  // Ver src/lib/scale.ts.
  const balanza = balanzaActual()

  return (
    <Dialog
      open={abierto && producto !== null}
      onClose={onCerrar}
      title={producto?.name ?? 'Peso'}
      description={
        producto && (
          <span className="flex items-baseline gap-1">
            <Money amount={producto.price} size="sm" />
            <span className="text-ink-faint">{denominadorDePrecio(unidad)}</span>
          </span>
        )
      }
      size="sm"
      initialFocus={campo}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="lg" onClick={onCerrar} className="sm:w-auto">
            Cancelar
          </Button>
          <Button
            variant="confirm"
            size="lg"
            disabled={!puedeConfirmar}
            onClick={confirmar}
            className="sm:w-auto"
          >
            Agregar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="peso-cantidad" className="block text-sm font-medium text-ink">
            {politica.nombre === 'Kilogramo' ? 'Peso' : 'Cantidad'}
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              ref={campo}
              id="peso-cantidad"
              type="text"
              // `decimal` es lo que abre el teclado numerico CON coma en un
              // telefono. Con `numeric` no hay forma de escribir 0,425.
              inputMode="decimal"
              autoComplete="off"
              value={texto}
              aria-invalid={problema !== null}
              aria-describedby={problema === null ? undefined : 'peso-problema'}
              onChange={(e) => {
                setTexto(e.target.value.replace(/[^0-9.,]/g, ''))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  confirmar()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  onCerrar()
                }
              }}
              className="h-14 w-full rounded-md border border-line bg-sunken px-3 text-2xl font-semibold text-ink outline-none focus:border-primary"
              data-numeric=""
            />
            <span className="text-lg text-ink-muted">{politica.simbolo}</span>
          </div>

          {problema !== null && (
            <p id="peso-problema" role="alert" className="mt-1.5 text-sm text-danger">
              {problema}
            </p>
          )}
        </div>

        <div className="flex items-baseline justify-between rounded-md bg-raised px-3 py-2.5">
          <span className="text-sm text-ink-muted">Subtotal</span>
          <Money amount={subtotal} size="xl" />
        </div>

        <p className="text-xs text-ink-faint">
          {balanza === null
            ? `Mínimo ${formatearCantidadConUnidad(politica.minimo, unidad)} · Enter para agregar`
            : `Balanza ${balanza.nombre} · Enter para agregar`}
        </p>
      </div>
    </Dialog>
  )
}
