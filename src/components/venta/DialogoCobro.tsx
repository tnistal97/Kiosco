'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  Money,
  RadioGroup,
  formatMoney,
} from '@/components/ui'
import type { CartLine } from '@/store/cart'

/**
 * Cobro.
 *
 * Se conservan los tres medios que el backend sabe registrar hoy: efectivo,
 * tarjeta y Mercado Pago. **No hay pago combinado.** El modelo actual guarda
 * un solo `paymentMethod` por venta, asi que ofrecer "mitad efectivo, mitad
 * tarjeta" seria un boton que miente. Queda anotado para la Fase 3 en
 * docs/PHASE2_VISUAL_REPORT.md.
 *
 * Proteccion contra el doble cobro, que es lo que de verdad importa aca:
 *
 *  - el boton se bloquea en cuanto se envia y no se libera si la peticion
 *    salio bien;
 *  - el dialogo deja de cerrarse mientras la venta esta en vuelo, asi que ni
 *    Escape ni un clic afuera dejan la pantalla en un estado ambiguo;
 *  - F12 y Enter pasan por el mismo camino que el boton.
 */

export type MedioDePago = 'efectivo' | 'tarjeta' | 'mercado_pago'

const MEDIOS = [
  { value: 'efectivo' as const, label: 'Efectivo' },
  { value: 'tarjeta' as const, label: 'Tarjeta' },
  { value: 'mercado_pago' as const, label: 'Mercado Pago' },
]

export interface VentaHecha {
  id: number
  total: number
  medio: MedioDePago
  vuelto: number | null
}

export function DialogoCobro({
  abierto,
  onCerrar,
  lineas,
  total,
  onCobrar,
  onNuevaVenta,
}: {
  abierto: boolean
  onCerrar: () => void
  lineas: CartLine[]
  total: number
  /** Devuelve el numero de venta. Lanza si el servidor la rechaza. */
  onCobrar: (medio: MedioDePago) => Promise<number>
  /** Cierra el resultado y deja la caja lista para la proxima. */
  onNuevaVenta: () => void
}) {
  const [medio, setMedio] = useState<MedioDePago>('efectivo')
  const [recibido, setRecibido] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecha, setHecha] = useState<VentaHecha | null>(null)

  const botonCobrar = useRef<HTMLButtonElement>(null)

  // Cada apertura arranca limpia. Sin esto, el vuelto de la venta anterior
  // sigue escrito en el campo.
  useEffect(() => {
    if (!abierto) return
    setMedio('efectivo')
    setRecibido('')
    setError(null)
    setHecha(null)
    setEnviando(false)
  }, [abierto])

  const montoRecibido = useMemo(() => {
    const n = Number(recibido.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }, [recibido])

  const vuelto = medio === 'efectivo' && montoRecibido > 0 ? montoRecibido - total : null
  const faltaPlata = medio === 'efectivo' && montoRecibido > 0 && montoRecibido < total

  async function cobrar() {
    if (enviando || hecha) return
    setEnviando(true)
    setError(null)
    try {
      const id = await onCobrar(medio)
      setHecha({ id, total, medio, vuelto: medio === 'efectivo' ? vuelto : null })
      // A proposito no se libera `enviando`: la venta ya existe y el boton no
      // debe volver a estar disponible.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta.')
      setEnviando(false)
    }
  }

  if (hecha) {
    return (
      <Dialog
        open={abierto}
        onClose={onNuevaVenta}
        title="Venta registrada"
        size="sm"
        footer={
          <Button variant="confirm" size="lg" block onClick={onNuevaVenta}>
            Nueva venta
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-1 rounded-lg bg-success-quiet py-5">
            <span aria-hidden="true" className="text-3xl text-success">
              ✓
            </span>
            <p className="text-sm text-ink-muted">
              Venta{' '}
              <span className="font-semibold text-ink" data-numeric="">
                #{hecha.id}
              </span>
            </p>
            <Money amount={hecha.total} size="xl" />
          </div>

          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Medio de pago</dt>
              <dd className="text-ink">{MEDIOS.find((m) => m.value === hecha.medio)?.label}</dd>
            </div>
            {hecha.vuelto !== null && hecha.vuelto >= 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Vuelto</dt>
                <dd>
                  <Money amount={hecha.vuelto} size="md" />
                </dd>
              </div>
            )}
          </dl>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Cobrar"
      size="md"
      dismissible={!enviando}
      initialFocus={botonCobrar}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Volver
          </Button>
          <Button
            ref={botonCobrar}
            variant="confirm"
            size="lg"
            loading={enviando}
            onClick={() => void cobrar()}
            className="sm:min-w-48"
          >
            {enviando ? 'Registrando…' : `Cobrar ${formatMoney(total)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="No se registró la venta">
            {error} Podés reintentar; no se cobró nada.
          </Alert>
        )}

        <div className="rounded-lg border border-line bg-sunken">
          <ul className="max-h-52 divide-y divide-line overflow-y-auto px-3">
            {lineas.map((l) => (
              <li key={l.productId} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-8 shrink-0 text-ink-muted" data-numeric="">
                  ×{l.quantity}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">{l.name}</span>
                <Money amount={l.price * l.quantity} size="sm" />
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-line px-3 py-3">
            <span className="text-sm text-ink-muted">Total</span>
            <Money amount={total} size="hero" />
          </div>
        </div>

        <RadioGroup
          legend="Medio de pago"
          name="medio-de-pago"
          value={medio}
          onChange={setMedio}
          options={MEDIOS}
          columns={3}
        />

        {medio === 'efectivo' && (
          <div className="flex flex-col gap-3">
            <Field label="Con cuánto paga" hint="Opcional. Sirve para calcular el vuelto.">
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={recibido}
                disabled={enviando}
                onChange={(e) => {
                  setRecibido(e.target.value)
                }}
              />
            </Field>

            {faltaPlata && (
              <Alert tone="warning">
                Faltan <Money amount={total - montoRecibido} size="sm" tone="out" />
              </Alert>
            )}
            {vuelto !== null && vuelto >= 0 && (
              <div className="flex items-baseline justify-between rounded-lg border border-line bg-raised px-4 py-3">
                <span className="text-sm text-ink-muted">Vuelto</span>
                <Money amount={vuelto} size="xl" />
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
