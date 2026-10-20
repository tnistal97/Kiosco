'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Button,
  ButtonLink,
  Drawer,
  EmptyState,
  ErrorState,
  Money,
  SaleStatusBadge,
  SkeletonRows,
  cn,
} from '@/components/ui'
import { medioLegible } from '@/components/caja/MovimientoRow'
import { usePermiso, useSession } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { multiplicarMonto, type Monto } from '@/lib/money'
import { formatearCantidadConUnidad } from '@/modules/products/units'
import { parsePaginaVentas, type VentaDTO } from '@/modules/sales/dto'
import { etiquetaDePagoHecho, esEfectivo } from '@/modules/sales/payment-methods'
import { ZONA_POR_DEFECTO } from '@/lib/tiempo'

/**
 * Ventas de hoy, sin salir de la caja. UX V5.
 *
 * Un cajon a la derecha con las ventas del dia --hora, total, medio, quien la
 * hizo y si sigue vigente-- y, al tocar una, su detalle completo: productos,
 * cantidades, precios, como se pago, con cuanto y el vuelto. Responde lo que
 * se pregunta en el mostrador ("¿le cobre la leche?", "¿cuanto le di de
 * vuelto?") sin perder el carrito que se esta armando.
 *
 * Es de consulta: anular sigue en el historial de Ventas, que tiene el
 * permiso y la confirmacion. El detalle lleva un enlace directo a esa venta.
 *
 * El total del dia en pesos sale solo para quien ve los reportes de ventas
 * (`reports.sales.view`), la misma regla que la pantalla de Caja.
 */

const POR_PAGINA = 50

/** Medios de una venta, como se dicen: "Efectivo", "Efectivo + Mercado Pago". */
export function medioDeLaVenta(venta: VentaDTO): string {
  if (venta.pagos.length > 0) {
    const nombres = venta.pagos.map((p) => etiquetaDePagoHecho(p.method, p.reference))
    return [...new Set(nombres)].join(' + ')
  }
  return venta.paymentMethod ? medioLegible(venta.paymentMethod) : '—'
}

function horaDelLocal(iso: string, zona: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zona,
  })
}

function fechaYHoraDelLocal(iso: string, zona: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zona,
  })
}

export function VentasDeHoy({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const { hoy, session } = useSession()
  const verPesos = usePermiso('reports.sales.view')
  const zona = session?.timeZone ?? ZONA_POR_DEFECTO

  const [ventas, setVentas] = useState<VentaDTO[]>([])
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [vigentes, setVigentes] = useState(0)
  const [anuladas, setAnuladas] = useState(0)
  const [recaudado, setRecaudado] = useState<Monto>('0.00')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elegida, setElegida] = useState<VentaDTO | null>(null)

  const lista = useRef<HTMLUListElement>(null)
  const volver = useRef<HTMLButtonElement>(null)
  /** La venta de la que se volvio: el foco regresa a su fila. */
  const ultimaVista = useRef<number | null>(null)

  const cargar = useCallback(
    async (n: number) => {
      setCargando(true)
      setError(null)
      try {
        const d = hoy()
        const params = new URLSearchParams({
          start: d,
          end: d,
          page: String(n),
          pageSize: String(POR_PAGINA),
          estado: 'todas',
        })
        const r = await apiRequest(`/api/admin/sales?${params.toString()}`, {
          parse: parsePaginaVentas,
        })
        setVentas((antes) => (n === 1 ? r.data : [...antes, ...r.data]))
        setPagina(r.page)
        setPaginas(r.totalPages)
        setVigentes(r.totales.ventas)
        setAnuladas(r.totales.anuladas)
        setRecaudado(r.totales.recaudado)
      } catch (err) {
        setError(mensajeDeError(err, 'No se pudieron cargar las ventas de hoy.'))
      } finally {
        setCargando(false)
      }
    },
    [hoy],
  )

  // Cada vez que se abre, la lista se vuelve a pedir: entre una apertura y la
  // siguiente se cobraron ventas.
  useEffect(() => {
    if (!abierto) return
    setElegida(null)
    ultimaVista.current = null
    void cargar(1)
  }, [abierto, cargar])

  // Al entrar al detalle el foco va a "Volver"; al volver, a la fila de esa venta.
  useEffect(() => {
    if (!abierto) return
    if (elegida) {
      volver.current?.focus()
      return
    }
    const id = ultimaVista.current
    if (id === null) return
    lista.current?.querySelector<HTMLButtonElement>(`[data-venta="${String(id)}"]`)?.focus()
  }, [abierto, elegida])

  /** ↑ ↓ recorren la lista, Inicio y Fin van a los extremos. */
  function alPresionarEnLaLista(e: KeyboardEvent<HTMLUListElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const botones = [...(lista.current?.querySelectorAll<HTMLButtonElement>('[data-venta]') ?? [])]
    if (botones.length === 0) return
    e.preventDefault()
    const actual = botones.findIndex((b) => b === document.activeElement)
    const siguiente =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? botones.length - 1
          : Math.min(botones.length - 1, Math.max(0, actual + (e.key === 'ArrowDown' ? 1 : -1)))
    botones[siguiente]?.focus()
  }

  return (
    <Drawer open={abierto} onClose={onCerrar} title="Ventas de hoy" side="right" ancho="amplio">
      {elegida ? (
        <div className="flex flex-col gap-4 p-4">
          <div>
            <Button
              ref={volver}
              variant="ghost"
              size="sm"
              onClick={() => {
                ultimaVista.current = elegida.id
                setElegida(null)
              }}
            >
              <span aria-hidden="true">←</span> Todas las ventas de hoy
            </Button>
          </div>
          <DetalleDeVenta venta={elegida} zona={zona} />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <ResumenDelDia
            vigentes={vigentes}
            anuladas={anuladas}
            recaudado={verPesos ? recaudado : null}
            cargando={cargando && ventas.length === 0}
          />

          {error ? (
            <ErrorState description={error} onRetry={() => void cargar(1)} />
          ) : cargando && ventas.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : ventas.length === 0 ? (
            <EmptyState
              title="Todavía no hay ventas hoy"
              description="Cada venta que se cobre aparece acá, con su hora y su detalle."
            />
          ) : (
            <>
              <p className="text-sm text-ink-muted">Tocá una venta para ver su detalle.</p>
              <ul
                ref={lista}
                aria-label="Ventas de hoy"
                onKeyDown={alPresionarEnLaLista}
                className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface"
              >
                {ventas.map((v) => (
                  <li key={v.id}>
                    <FilaDeVenta
                      venta={v}
                      zona={zona}
                      onElegir={() => {
                        setElegida(v)
                      }}
                    />
                  </li>
                ))}
              </ul>
              {pagina < paginas && (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={cargando}
                    onClick={() => void cargar(pagina + 1)}
                  >
                    {cargando ? 'Cargando…' : 'Ver más ventas'}
                  </Button>
                </div>
              )}
            </>
          )}

          <div className="pt-1">
            <ButtonLink href="/ventas" variant="ghost" size="sm">
              Ver el historial completo de ventas <span aria-hidden="true">→</span>
            </ButtonLink>
          </div>
        </div>
      )}
    </Drawer>
  )
}

function ResumenDelDia({
  vigentes,
  anuladas,
  recaudado,
  cargando,
}: {
  vigentes: number
  anuladas: number
  /** null sin permiso para ver la recaudacion. */
  recaudado: Monto | null
  cargando: boolean
}) {
  if (cargando) return null
  return (
    <dl
      data-resumen-ventas-hoy=""
      className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-sunken p-3 sm:grid-cols-3"
    >
      <div>
        <dt className="text-sm text-ink-muted">Ventas</dt>
        <dd className="text-2xl font-semibold text-ink" data-numeric="">
          {vigentes}
        </dd>
      </div>
      {recaudado !== null && (
        <div>
          <dt className="text-sm text-ink-muted">Total vendido</dt>
          <dd>
            <Money amount={recaudado} size="lg" className="text-2xl font-semibold" />
          </dd>
        </div>
      )}
      <div>
        <dt className="text-sm text-ink-muted">Anuladas</dt>
        <dd className="text-2xl font-semibold text-ink" data-numeric="">
          {anuladas}
        </dd>
      </div>
    </dl>
  )
}

function FilaDeVenta({
  venta,
  zona,
  onElegir,
}: {
  venta: VentaDTO
  zona: string
  onElegir: () => void
}) {
  const anulada = venta.status === 'canceled'
  return (
    <button
      type="button"
      data-venta={venta.id}
      onClick={onElegir}
      className={cn(
        'grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-left transition-colors',
        'hover:bg-raised focus-visible:bg-selection focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
      )}
    >
      <span className="row-span-2 text-base font-semibold text-ink" data-numeric="">
        {horaDelLocal(venta.date, zona)}
      </span>
      <span className="min-w-0 truncate text-base font-medium text-ink">
        {medioDeLaVenta(venta)}
      </span>
      <Money
        amount={venta.total}
        size="md"
        tone={anulada ? 'muted' : 'neutral'}
        className={cn('justify-self-end font-semibold', anulada && 'line-through')}
      />
      <span className="min-w-0 truncate text-sm text-ink-muted">
        <span data-numeric="">#{venta.id}</span> · {venta.user.name}
      </span>
      <span className="justify-self-end">
        <SaleStatusBadge status={venta.status} />
      </span>
    </button>
  )
}

/** El detalle completo de una venta: lo que se llevo, cuanto y como pago. */
export function DetalleDeVenta({ venta, zona }: { venta: VentaDTO; zona: string }) {
  const anulada = venta.status === 'canceled'
  return (
    <article className="flex flex-col gap-4" aria-labelledby={`venta-${String(venta.id)}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`venta-${String(venta.id)}`} className="text-xl font-semibold text-ink">
          Venta <span data-numeric="">#{venta.id}</span>
        </h3>
        <SaleStatusBadge status={venta.status} />
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-base sm:grid-cols-2">
        <div>
          <dt className="text-sm text-ink-muted">Fecha y hora</dt>
          <dd className="text-ink first-letter:uppercase">
            {fechaYHoraDelLocal(venta.date, zona)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-muted">Cobró</dt>
          <dd className="text-ink">{venta.user.name}</dd>
        </div>
        {venta.cliente && (
          <div>
            <dt className="text-sm text-ink-muted">Cliente</dt>
            <dd className="text-ink">{venta.cliente.name}</dd>
          </div>
        )}
      </dl>

      <section aria-label="Productos" className="rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Productos de la venta</caption>
          <thead className="border-b border-line bg-sunken text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Producto
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Cantidad
              </th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                Precio
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Subtotal
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {venta.items.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2 text-base text-ink">
                  {i.product.name}
                  <span className="block text-sm text-ink-muted sm:hidden">
                    <Money amount={i.price} size="sm" tone="muted" /> c/u
                  </span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-ink" data-numeric="">
                  {formatearCantidadConUnidad(i.cantidad, i.saleUnit)}
                </td>
                <td className="hidden px-3 py-2 text-right sm:table-cell">
                  <Money amount={i.price} size="sm" tone="muted" />
                </td>
                <td className="px-3 py-2 text-right">
                  <Money amount={multiplicarMonto(i.price, i.quantity)} size="sm" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line-strong">
            <tr>
              <th scope="row" colSpan={2} className="px-3 py-2.5 text-base font-semibold text-ink">
                Total
              </th>
              <td className="hidden sm:table-cell" />
              <td className="px-3 py-2.5 text-right">
                <Money
                  amount={venta.total}
                  size="lg"
                  className={cn('font-semibold', anulada && 'line-through')}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section aria-label="Pago" className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-ink">Cómo se pagó</h4>
        {venta.pagos.length === 0 ? (
          <p className="text-base text-ink">{medioDeLaVenta(venta)}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {venta.pagos.map((p, i) => (
              <li
                // Las lineas de pago no tienen identidad propia en la respuesta.
                key={`${p.method}-${String(i)}`}
                className="rounded-lg border border-line bg-sunken px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-medium text-ink">
                    {etiquetaDePagoHecho(p.method, p.reference)}
                  </span>
                  <Money amount={p.amount} size="md" />
                </div>
                {esEfectivo(p.method) && p.cashReceived !== null && (
                  <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-muted">
                    <span>
                      Recibido <Money amount={p.cashReceived} size="sm" />
                    </span>
                    <span>
                      Vuelto <Money amount={p.changeGiven ?? '0.00'} size="sm" />
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {anulada && (
        <div className="rounded-md border border-danger/40 bg-danger-quiet px-3 py-2 text-sm">
          <p className="font-medium text-ink">
            <span aria-hidden="true" className="mr-1.5">
              ✕
            </span>
            Anulada
            {venta.canceledAt ? ` a las ${horaDelLocal(venta.canceledAt, zona)}` : ''}
            {venta.canceledBy ? ` por ${venta.canceledBy.name}` : ''}
          </p>
          {venta.cancelReason && <p className="mt-0.5 text-ink-muted">{venta.cancelReason}</p>}
        </div>
      )}

      <div>
        <ButtonLink href={`/ventas?venta=${String(venta.id)}`} variant="secondary" size="sm">
          Abrir en el historial de ventas
        </ButtonLink>
      </div>
    </article>
  )
}
