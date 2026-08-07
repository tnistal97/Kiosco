'use client'

import { useState } from 'react'
import { Badge, Money, TD, TR, cn } from '@/components/ui'
import type { MovimientoDTO } from '@/modules/cash/dto'

/**
 * Como se ve cada tipo de movimiento.
 *
 * El glifo y la palabra hacen el trabajo; el color acompania. Antes todos los
 * importes salian en verde --ingresos y egresos por igual-- y un retiro de
 * quince mil se veia igual que una venta de trece mil.
 */
export const TIPOS: Record<
  string,
  { etiqueta: string; glifo: string; tono: 'success' | 'danger' | 'neutral' | 'warning' }
> = {
  sale: { etiqueta: 'Venta', glifo: '↓', tono: 'success' },
  sale_cancel: { etiqueta: 'Anulación', glifo: '↺', tono: 'danger' },
  ingreso: { etiqueta: 'Ingreso', glifo: '↓', tono: 'success' },
  deposito: { etiqueta: 'Depósito', glifo: '↓', tono: 'success' },
  retiro: { etiqueta: 'Retiro', glifo: '↑', tono: 'warning' },
}

export function tipoDe(type: string) {
  return TIPOS[type] ?? { etiqueta: type, glifo: '•', tono: 'neutral' as const }
}

const MEDIOS: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  mercado_pago: 'Mercado Pago',
}

export function medioLegible(m: string): string {
  return MEDIOS[m] ?? m
}

export function fechaCorta(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
            tone={movimiento.amount < 0 ? 'out' : 'in'}
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
                  <Money amount={i.price * i.quantity} size="sm" />
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}
