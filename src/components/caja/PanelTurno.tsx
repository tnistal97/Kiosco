'use client'

import { Alert, Button, Card, Money, Skeleton } from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import type { EstadoDeCajaDTO } from '@/modules/cash/dto'
import { fechaCorta } from './MovimientoRow'

/**
 * El turno de caja, arriba de todo.
 *
 * Es lo primero que se ve al entrar a la pantalla de caja, y responde la
 * pregunta que de verdad se hace en el mostrador: "¿esta abierta? ¿desde
 * cuando? ¿cuanto tiene que haber?".
 *
 * Cuando NO hay caja abierta lo dice claro y ofrece abrirla, en vez de mostrar
 * un cero que se lee como "no vendi nada".
 */
export function PanelTurno({
  estado,
  cargando,
  onAbrir,
  onCerrar,
}: {
  estado: EstadoDeCajaDTO | null
  cargando: boolean
  onAbrir: () => void
  onCerrar: () => void
}) {
  const puedeAbrir = usePermiso('cash.shift.open')
  const puedeCerrar = usePermiso('cash.shift.close')

  if (cargando && !estado) return <Skeleton className="h-24 w-full" />
  if (!estado) return null

  if (!estado.turno) {
    return (
      <Alert tone="warning" title="La caja está cerrada">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {estado.politica.requiereTurno
              ? 'No se puede vender hasta abrirla. Contá el efectivo del cajón y abrila.'
              : 'Se puede vender igual, pero sin turno el arqueo no compara contra nada.'}
          </span>
          {puedeAbrir && (
            <Button variant="primary" onClick={onAbrir}>
              Abrir la caja
            </Button>
          )}
        </div>
      </Alert>
    )
  }

  const t = estado.turno

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-success"
            />
            Caja abierta por <span className="font-medium text-ink">{t.openedBy.name}</span>
          </p>
          <p className="text-xs text-ink-faint">
            Desde {fechaCorta(t.openedAt)} · {t.cantidadDeVentas}{' '}
            {t.cantidadDeVentas === 1 ? 'venta' : 'ventas'} en efectivo
          </p>
          {t.openingNotes && <p className="mt-1 text-xs text-ink-faint">{t.openingNotes}</p>}
        </div>

        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <div className="flex flex-col">
            <dt className="text-xs text-ink-faint">Inicial</dt>
            <dd>
              <Money amount={t.openingAmount} size="sm" tone="muted" />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-ink-faint">Ventas</dt>
            <dd>
              <Money amount={t.ventasEnEfectivo} size="sm" tone="muted" />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-ink-faint">Tiene que haber</dt>
            <dd>
              <Money amount={t.expectedAmount} size="lg" />
            </dd>
          </div>
        </dl>

        {puedeCerrar && (
          <Button variant="secondary" onClick={onCerrar}>
            Cerrar la caja
          </Button>
        )}
      </div>
    </Card>
  )
}
