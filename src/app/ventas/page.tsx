'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  Input,
  MetricCard,
  Money,
  Pagination,
  SaleStatusBadge,
  Select,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  aviso,
  cn,
} from '@/components/ui'
import { DialogoAnular } from '@/components/ventas/DialogoAnular'
import { usePermiso } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaVentas, type TotalesVentas, type VentaDTO } from '@/modules/sales/dto'
import { medioLegible } from '@/components/caja/MovimientoRow'

const POR_PAGINA = 25

/** YYYY-MM-DD de una fecha, en hora local. */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` // prettier-ignore
}

function haceDias(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return iso(d)
}

function fechaLarga(isoStr: string): string {
  return new Date(isoStr).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function VentasPage() {
  const puedeAnular = usePermiso('sales.cancel')

  const [desde, setDesde] = useState(() => haceDias(7))
  const [hasta, setHasta] = useState(() => iso(new Date()))
  const [estado, setEstado] = useState('todas')
  const [medio, setMedio] = useState('')
  const [numero, setNumero] = useState('')
  const [pagina, setPagina] = useState(1)

  const [ventas, setVentas] = useState<VentaDTO[]>([])
  const [paginas, setPaginas] = useState(1)
  const [totales, setTotales] = useState<TotalesVentas>({ ventas: 0, anuladas: 0, recaudado: 0 })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandida, setExpandida] = useState<number | null>(null)
  const [anulando, setAnulando] = useState<VentaDTO | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        start: desde,
        end: hasta,
        page: String(pagina),
        pageSize: String(POR_PAGINA),
        estado,
      })
      if (medio !== '') params.set('paymentMethod', medio)
      const n = Number(numero.trim())
      if (numero.trim() !== '' && Number.isInteger(n) && n > 0) params.set('saleId', String(n))

      const r = await apiRequest(`/api/admin/sales?${params.toString()}`, {
        parse: parsePaginaVentas,
      })
      setVentas(r.data)
      setPaginas(r.totalPages)
      setTotales(r.totales)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar las ventas.'))
    } finally {
      setCargando(false)
    }
  }, [desde, hasta, estado, medio, numero, pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Cambiar un filtro vuelve a la primera pagina: quedarse en la 7 de un
  // resultado que ahora tiene 2 muestra una lista vacia sin explicacion.
  const cambiarFiltro =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v)
      setPagina(1)
    }

  const totalPagina = useMemo(
    () => ventas.filter((v) => v.status !== 'canceled').reduce((s, v) => s + v.total, 0),
    [ventas],
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-3 sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Ventas vigentes" value={totales.ventas} />
        <MetricCard
          label="Anuladas"
          value={totales.anuladas}
          tone={totales.anuladas > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="Recaudado"
          value={<Money amount={totales.recaudado} size="lg" />}
          detail="No incluye las anuladas"
        />
      </div>

      <Card padded={false}>
        <div className="grid grid-cols-2 gap-3 border-b border-line p-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Desde">
            <Input
              type="date"
              value={desde}
              onChange={(e) => {
                cambiarFiltro(setDesde)(e.target.value)
              }}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={hasta}
              onChange={(e) => {
                cambiarFiltro(setHasta)(e.target.value)
              }}
            />
          </Field>
          <Field label="Estado">
            <Select
              value={estado}
              onChange={(e) => {
                cambiarFiltro(setEstado)(e.target.value)
              }}
            >
              <option value="todas">Todas</option>
              <option value="completed">Vigentes</option>
              <option value="canceled">Anuladas</option>
            </Select>
          </Field>
          <Field label="Medio de pago">
            <Select
              value={medio}
              onChange={(e) => {
                cambiarFiltro(setMedio)(e.target.value)
              }}
            >
              <option value="">Todos</option>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="mercado_pago">Mercado Pago</option>
            </Select>
          </Field>
          <Field label="N° de venta">
            <Input
              inputMode="numeric"
              placeholder="Ej: 128"
              value={numero}
              onChange={(e) => {
                cambiarFiltro(setNumero)(e.target.value.replace(/[^0-9]/g, ''))
              }}
            />
          </Field>
        </div>

        <div className="p-3">
          {error ? (
            <ErrorState description={error} onRetry={() => void cargar()} />
          ) : cargando ? (
            <SkeletonRows rows={6} />
          ) : ventas.length === 0 ? (
            <EmptyState
              title="No hay ventas con esos filtros"
              description="Probá con otro rango de fechas o quitá algún filtro."
            />
          ) : (
            <>
              <div className="hidden lg:block">
                <TableWrap className="border-0">
                  <Table caption="Ventas del período">
                    <THead>
                      <TR>
                        <TH>N°</TH>
                        <TH>Fecha</TH>
                        <TH>Estado</TH>
                        <TH>Cajero</TH>
                        <TH>Medio</TH>
                        <TH align="right">Total</TH>
                        <TH align="right">
                          <span className="sr-only">Acciones</span>
                        </TH>
                      </TR>
                    </THead>
                    <TBody>
                      {ventas.map((v) => {
                        const anulada = v.status === 'canceled'
                        const abierta = expandida === v.id
                        return [
                          <TR
                            key={v.id}
                            interactive
                            selected={abierta}
                            onClick={() => {
                              setExpandida(abierta ? null : v.id)
                            }}
                          >
                            <TD>
                              <span
                                className={cn('font-medium', anulada && 'line-through opacity-70')}
                                data-numeric=""
                              >
                                #{v.id}
                              </span>
                            </TD>
                            <TD className="text-ink-muted">{fechaLarga(v.date)}</TD>
                            <TD>
                              <SaleStatusBadge status={v.status} />
                            </TD>
                            <TD className="text-ink-muted">{v.user.name}</TD>
                            <TD className="text-ink-muted">
                              {v.paymentMethod ? medioLegible(v.paymentMethod) : '—'}
                            </TD>
                            <TD align="right">
                              <Money
                                amount={v.total}
                                tone={anulada ? 'muted' : 'neutral'}
                                className={cn(anulada && 'line-through')}
                              />
                            </TD>
                            <TD align="right">
                              {puedeAnular && !anulada && (
                                <Button
                                  size="xs"
                                  variant="danger"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setAnulando(v)
                                  }}
                                >
                                  Anular
                                </Button>
                              )}
                            </TD>
                          </TR>,
                          abierta ? (
                            <tr key={`${v.id}-detalle`}>
                              <td colSpan={7} className="bg-sunken px-6 py-3">
                                <DetalleVenta venta={v} />
                              </td>
                            </tr>
                          ) : null,
                        ]
                      })}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>

              <CardList className="lg:hidden">
                {ventas.map((v) => {
                  const anulada = v.status === 'canceled'
                  return (
                    <CardListItem key={v.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-medium text-ink">
                            <span data-numeric="">#{v.id}</span>
                            <SaleStatusBadge status={v.status} />
                          </p>
                          <p className="mt-1 text-xs text-ink-faint">
                            {fechaLarga(v.date)} · {v.user.name}
                            {v.paymentMethod ? ` · ${medioLegible(v.paymentMethod)}` : ''}
                          </p>
                        </div>
                        <Money amount={v.total} tone={anulada ? 'muted' : 'neutral'} />
                      </div>
                      <div className="mt-2">
                        <DetalleVenta venta={v} />
                      </div>
                      {puedeAnular && !anulada && (
                        <Button
                          size="sm"
                          variant="danger"
                          className="mt-3 w-full"
                          onClick={() => {
                            setAnulando(v)
                          }}
                        >
                          Anular
                        </Button>
                      )}
                    </CardListItem>
                  )
                })}
              </CardList>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-muted">
                  En esta página: <Money amount={totalPagina} size="sm" />
                </p>
                <Pagination
                  page={pagina}
                  pageSize={POR_PAGINA}
                  total={totales.ventas + totales.anuladas}
                  totalPages={paginas}
                  onPageChange={setPagina}
                  disabled={cargando}
                />
              </div>
            </>
          )}
        </div>
      </Card>

      <DialogoAnular
        venta={anulando}
        onCerrar={() => {
          setAnulando(null)
        }}
        onAnulada={() => {
          setAnulando(null)
          aviso.ok('Venta anulada. Volvió el stock y se revirtió la caja.')
          notificarCambioDeCaja()
          void cargar()
        }}
      />
    </div>
  )
}

function DetalleVenta({ venta }: { venta: VentaDTO }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1 text-sm">
        {venta.items.map((i) => (
          <li key={i.id} className="flex items-center gap-3">
            <span className="w-10 shrink-0 text-ink-muted" data-numeric="">
              ×{i.quantity}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink">{i.product.name}</span>
            <Money amount={i.price * i.quantity} size="sm" />
          </li>
        ))}
      </ul>

      {venta.status === 'canceled' && (
        <div className="rounded-md border border-danger/40 bg-danger-quiet px-3 py-2 text-sm">
          <p className="font-medium text-ink">
            <span aria-hidden="true" className="mr-1.5">
              ✕
            </span>
            Anulada
            {venta.canceledAt ? ` el ${fechaLarga(venta.canceledAt)}` : ''}
            {venta.canceledBy ? ` por ${venta.canceledBy.name}` : ''}
          </p>
          {venta.cancelReason && <p className="mt-0.5 text-ink-muted">{venta.cancelReason}</p>}
        </div>
      )}
    </div>
  )
}
