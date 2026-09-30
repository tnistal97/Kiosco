'use client'

import { Alert, ButtonLink, Card, Money, Skeleton } from '@/components/ui'
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
 * un cero que se lee como "no vendi nada". Abrir y cerrar son pantallas
 * propias desde la Fase 2 --`/caja/abrir` y `/caja/cerrar`--: un flujo
 * guiado, no un dialogo encima del listado.
 *
 * Los cuatro renglones de la suma van a la vista: inicial, ventas, entradas y
 * salidas. Con solo tres, "Inicial 25.000 · Ventas 102.495 · Tiene que haber
 * 99.725" parecia una cuenta mal hecha (auditoria, H-12).
 */
export function PanelTurno({
  estado,
  cargando,
}: {
  estado: EstadoDeCajaDTO | null
  cargando: boolean
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
              ? 'No se puede cobrar hasta abrirla. Contá el efectivo del cajón y abrila.'
              : 'Se puede vender igual, pero sin caja abierta el conteo no compara contra nada.'}
          </span>
          {puedeAbrir && (
            <ButtonLink href="/caja/abrir" variant="primary">
              Abrir caja
            </ButtonLink>
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
            <dt className="text-xs text-ink-faint">Ventas en efectivo</dt>
            <dd>
              <Money amount={t.ventasEnEfectivo} size="sm" tone="muted" />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-ink-faint">Entradas</dt>
            <dd>
              <Money amount={t.ingresos} size="sm" tone="muted" />
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-ink-faint">Salidas</dt>
            <dd>
              <Money amount={t.egresos} size="sm" tone="muted" />
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
          <ButtonLink href="/caja/cerrar" variant="primary">
            Cerrar la caja
          </ButtonLink>
        )}
      </div>
    </Card>
  )
}
