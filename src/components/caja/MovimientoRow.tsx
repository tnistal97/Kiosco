'use client'

import { useState } from 'react'
import { Badge, Money, TD, TR, cn, tonoPorSigno } from '@/components/ui'
import { multiplicarMonto } from '@/lib/money'
import type { MovimientoDTO } from '@/modules/cash/dto'
import { describirMovimientoDeCaja } from '@/modules/cash/movement-types'
import { etiquetaDeMedio, normalizarMedio } from '@/modules/sales/payment-methods'

/**
 * Una fila del listado de caja.
 *
 * El tipo y el medio salen de los vocabularios centrales, no de una tabla
 * propia: hasta la Fase 1 de UX V2 este archivo solo conocia cinco tipos y los
 * tres medios viejos, y `customer_payment`, `CASH` y `DEBIT_CARD` llegaban a
 * la pantalla tal cual (auditoria, H-05). Las tres funciones exportadas se
 * conservan porque las usan Caja y Ventas.
 */

/** Como se ve un tipo de movimiento. Delegado al vocabulario de caja. */
export function tipoDe(type: string) {
  return describirMovimientoDeCaja(type)
}

/**
 * Nombre humano de un medio, tambien para los guardados con el vocabulario
 * anterior a la Fase 3 (`efectivo`, `tarjeta`, `mercado_pago`).
 */
export function medioLegible(m: string): string {
  return etiquetaDeMedio(normalizarMedio(m))
}

export function fechaCorta(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function MovimientoRow({ movimiento }: { movimiento: MovimientoDTO }) {
  const [abierto, setAbierto] = useState(false)
  const t = tipoDe(movimiento.type)
  const anulada = movimiento.saleStatus === 'canceled'
  const hayDetalle = (movimiento.saleItems?.length ?? 0) > 0

  return (
    <>
      <TR
        interactive={hayDetalle}
        onClick={
          hayDetalle
            ? () => {
                setAbierto((v) => !v)
              }
            : undefined
        }
      >
        <TD>
          <Badge tone={t.tono}>
            <span aria-hidden="true">{t.glifo}</span>
            {t.etiqueta}
          </Badge>
        </TD>
        <TD className="text-ink-muted">{fechaCorta(movimiento.date)}</TD>
        <TD>
          <span className={cn('block max-w-72 truncate', anulada && 'line-through opacity-70')}>
            {movimiento.description ?? '—'}
          </span>
          {/* La referencia a la venta solo si aporta algo: cuando la
              descripcion ya dice "Venta #482", repetirla debajo es ruido. */}
          {movimiento.saleId !== null &&
            movimiento.description !== `Venta #${movimiento.saleId}` && (
              <span className="text-xs text-ink-faint" data-numeric="">
                Venta #{movimiento.saleId}
                {anulada && ' · anulada'}
              </span>
            )}
          {movimiento.saleId !== null && anulada && (
            <span className="ml-1 text-xs text-danger">· anulada</span>
          )}
        </TD>
        <TD className="text-ink-muted">{medioLegible(movimiento.paymentMethod)}</TD>
        <TD className="text-ink-muted">{movimiento.user.name}</TD>
        <TD align="right">
          <Money
            amount={movimiento.amount}
            signed
            tone={tonoPorSigno(movimiento.amount)}
            size="md"
          />
        </TD>
        <TD align="center" className="w-10">
          {hayDetalle && (
            <span
              aria-hidden="true"
              className={cn(
                'inline-block text-ink-faint transition-transform',
                abierto && 'rotate-180',
              )}
            >
              ▾
            </span>
          )}
        </TD>
      </TR>

      {abierto && hayDetalle && (
        <tr>
          <td colSpan={7} className="bg-sunken px-6 py-3">
            <ul className="flex flex-col gap-1 text-sm">
              {movimiento.saleItems?.map((i) => (
                <li key={i.id} className="flex items-center gap-3">
                  <span className="w-10 shrink-0 text-ink-muted" data-numeric="">
                    ×{i.quantity}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">{i.product.name}</span>
                  <Money amount={multiplicarMonto(i.price, i.quantity)} size="sm" />
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}
