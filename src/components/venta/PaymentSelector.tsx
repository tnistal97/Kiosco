'use client'

import type { MutableRefObject } from 'react'
import { cn } from '@/components/ui'
import {
  MEDIOS_COBRABLES,
  REFERENCIA_MERCADO_PAGO,
  etiquetaDePagoHecho,
  type MedioCobrable,
} from '@/modules/sales/payment-methods'

/**
 * Las formas de pago como botones grandes. UX V5.
 *
 * Seis opciones a la vista, con el nombre que se usa en el mostrador:
 * Efectivo, Transferencia, Mercado Pago, Débito, Crédito y Fiado. "Otro"
 * existe pero no ocupa lugar: esta en "Más opciones" del cobro.
 *
 * MERCADO PAGO no es un medio nuevo del sistema. Para la caja y los reportes
 * es una TRANSFERENCIA --no entra al cajon, igual que una transferencia
 * bancaria--; lo que cambia es que el pago queda guardado con la referencia
 * "Mercado Pago", asi que se puede distinguir en el detalle de la venta sin
 * tocar el dominio ni la base.
 *
 * Es un `radiogroup` de verdad: un lector de pantalla anuncia "Efectivo,
 * seleccionado, 1 de 6", las flechas recorren el grupo y ENTER CONFIRMA la
 * forma elegida y pasa al paso siguiente (lo decide el cobro con
 * `onConfirmar`). Las letras --E, T, M, D, C, F, O-- siguen funcionando para
 * quien las sabe, pero no se dibujan: eran ruido para quien no.
 */
export interface OpcionDeCobro {
  id: string
  method: MedioCobrable
  /** Referencia que viaja con el pago (solo Mercado Pago). */
  referencia: string | null
  label: string
  /** Letra del atajo. */
  tecla: string
}

export { REFERENCIA_MERCADO_PAGO }

export const OPCIONES_DE_COBRO: readonly OpcionDeCobro[] = [
  { id: 'CASH', method: 'CASH', referencia: null, label: 'Efectivo', tecla: 'E' },
  { id: 'TRANSFER', method: 'TRANSFER', referencia: null, label: 'Transferencia', tecla: 'T' },
  {
    id: 'MERCADO_PAGO',
    method: 'TRANSFER',
    referencia: REFERENCIA_MERCADO_PAGO,
    label: 'Mercado Pago',
    tecla: 'M',
  },
  { id: 'DEBIT_CARD', method: 'DEBIT_CARD', referencia: null, label: 'Débito', tecla: 'D' },
  { id: 'CREDIT_CARD', method: 'CREDIT_CARD', referencia: null, label: 'Crédito', tecla: 'C' },
  { id: 'ACCOUNT', method: 'ACCOUNT', referencia: null, label: 'Fiado', tecla: 'F' },
]

/** "Otro": existe, pero no se muestra entre las seis principales. */
export const OPCION_OTRO: OpcionDeCobro = {
  id: 'OTHER',
  method: 'OTHER',
  referencia: null,
  label: 'Otro',
  tecla: 'O',
}

const TODAS = [...OPCIONES_DE_COBRO, OPCION_OTRO]

/** La opcion que corresponde a un medio y su referencia. */
export function opcionDe(method: MedioCobrable, referencia: string | null): OpcionDeCobro {
  return (
    TODAS.find((o) => o.method === method && o.referencia === referencia) ??
    TODAS.find((o) => o.method === method) ??
    OPCION_OTRO
  )
}

/**
 * La opcion que corresponde a una letra, o null. `R` sigue valiendo para
 * credito: era su letra hasta la V4 y hay dedos que la saben.
 */
export function opcionDeTecla(tecla: string): OpcionDeCobro | null {
  const letra = tecla.toUpperCase()
  if (letra === 'R') return TODAS.find((o) => o.id === 'CREDIT_CARD') ?? null
  return TODAS.find((o) => o.tecla === letra) ?? null
}

/** Compat: el medio de una letra (lo usan las pruebas de la V2). */
export function medioDeTecla(tecla: string): MedioCobrable | null {
  return opcionDeTecla(tecla)?.method ?? null
}

/** Etiqueta de un pago ya hecho, con Mercado Pago por su nombre. */
export function etiquetaDePago(method: MedioCobrable, referencia: string | null): string {
  return etiquetaDePagoHecho(method, referencia)
}

export function PaymentSelector({
  value,
  referencia = null,
  onChange,
  onConfirmar,
  activoRef,
  disabled = false,
  label = 'Cómo paga',
  compacto = false,
  className,
}: {
  value: MedioCobrable
  referencia?: string | null
  onChange: (opcion: OpcionDeCobro) => void
  /** Enter sobre una opcion: se elige y se pasa al paso siguiente. */
  onConfirmar?: (opcion: OpcionDeCobro) => void
  /** Recibe el boton de la opcion elegida, para darle el foco al abrir. */
  activoRef?: MutableRefObject<HTMLElement | null>
  disabled?: boolean
  label?: string
  /** Botones mas bajos y las siete opciones, para un renglon de pago dividido. */
  compacto?: boolean
  className?: string
}) {
  const opciones = compacto ? TODAS : OPCIONES_DE_COBRO
  const actual = opcionDe(value, referencia)
  // Si la elegida es "Otro" y no esta entre las visibles, se agrega al final
  // para que se vea cual es.
  const visibles = opciones.some((o) => o.id === actual.id) ? opciones : [...opciones, actual]

  function alPresionar(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      if (e.repeat) {
        e.preventDefault()
        return
      }
      const boton = e.target instanceof HTMLElement ? e.target.closest('[data-medio]') : null
      const elegida = visibles.find((o) => o.id === boton?.getAttribute('data-opcion'))
      if (elegida) {
        // preventDefault: que el navegador no sintetice ademas un clic.
        e.preventDefault()
        onChange(elegida)
        onConfirmar?.(elegida)
      }
      return
    }
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (delta === 0) return
    e.preventDefault()
    const i = visibles.findIndex((o) => o.id === actual.id)
    const siguiente = visibles[(i + delta + visibles.length) % visibles.length]
    if (siguiente) {
      onChange(siguiente)
      const boton = e.currentTarget.querySelector<HTMLButtonElement>(
        `[data-opcion="${siguiente.id}"]`,
      )
      boton?.focus()
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={alPresionar}
      className={cn(
        'grid gap-2',
        compacto ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3',
        className,
      )}
    >
      {visibles.map((opcion) => {
        const activo = opcion.id === actual.id
        return (
          <button
            key={opcion.id}
            ref={
              activo && activoRef
                ? (el) => {
                    activoRef.current = el
                  }
                : undefined
            }
            type="button"
            role="radio"
            aria-checked={activo}
            data-medio={opcion.method}
            data-opcion={opcion.id}
            tabIndex={activo ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              onChange(opcion)
            }}
            className={cn(
              'relative flex items-center justify-center rounded-lg px-3 text-center font-semibold transition-colors',
              compacto ? 'min-h-touch text-sm' : 'min-h-control-xl text-lg',
              // Elegida: borde doble, fondo azul suave y un ✓. No solo color.
              activo
                ? 'border-2 border-primary bg-primary-quiet text-ink'
                : 'border border-line-strong bg-surface text-ink hover:bg-raised',
              'disabled:pointer-events-none disabled:bg-disabled-bg disabled:text-disabled-ink',
            )}
          >
            {activo && (
              <span aria-hidden="true" className="absolute top-1.5 right-2 text-sm text-primary">
                ✓
              </span>
            )}
            {opcion.label}
          </button>
        )
      })}
    </div>
  )
}

/** Compat: la lista de medios que el resto del sistema ya conoce. */
export { MEDIOS_COBRABLES }
