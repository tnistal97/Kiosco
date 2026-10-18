'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ResponsiveData,
  PageContainer,
  Button,
  ButtonLink,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  Metric,
  MetricRow,
  Money,
  tonoPorSigno,
  Pagination,
  Section,
  Select,
  Skeleton,
  SkeletonRows,
  TBody,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  aviso,
} from '@/components/ui'
import { DialogoArqueo } from '@/components/caja/DialogoArqueo'
import { HistorialTurnos } from '@/components/caja/HistorialTurnos'
import { DialogoMovimiento, type TipoDeMovimiento } from '@/components/caja/DialogoMovimiento'
import { MovimientoRow, fechaCorta, medioLegible, tipoDe } from '@/components/caja/MovimientoRow'
import { usePermiso, useSession } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { CERO, absMonto, esCero, esNegativo, type Monto } from '@/lib/money'
import {
  parseArqueos,
  parseEstadoDeCaja,
  parseMovimientos,
  type ArqueoDTO,
  type EstadoDeCajaDTO,
  type MovimientoDTO,
} from '@/modules/cash/dto'
import { parsePaginaVentas } from '@/modules/sales/dto'
import { esObjeto, numero } from '@/lib/api-client'

const POR_PAGINA = 25

interface Pagina {
  movimientos: MovimientoDTO[]
  total: number
  totalPages: number
}

function parsePaginaMovimientos(raw: unknown): Pagina {
  const movimientos = parseMovimientos(raw)
  const p = esObjeto(raw) && esObjeto(raw.pagination) ? raw.pagination : null
  return {
    movimientos,
    total: p ? numero(p.total) : movimientos.length,
    totalPages: p ? Math.max(1, numero(p.totalPages)) : 1,
  }
}

function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Caja. UX V5.
 *
 * Responde, de arriba hacia abajo, lo que se pregunta en el mostrador:
 *
 *   1. ¿Está abierta o cerrada? En grande, con palabra y simbolo.
 *   2. ¿Cuánta plata tiene que haber en el cajón? La cifra mas grande.
 *   3. ¿De dónde sale ese número? Ventas, ingresos y egresos, en una fila.
 *   4. ¿Qué puedo hacer? Registrar ingreso, registrar egreso, contar la
 *      caja, cerrarla. Botones con verbo, no un "Nuevo movimiento" generico.
 *
 * Todo lo demas --la lista de movimientos, las cajas anteriores, los
 * conteos-- esta detras de "Ver detalle": sirve para revisar, no para
 * atender.
 *
 * Las reglas no cambiaron: los numeros salen tal cual del turno abierto
 * (/api/cash/shift), y abrir y cerrar siguen siendo pantallas guiadas.
 */
export default function CajaPage() {
  const { hoy } = useSession()
  const puedeMover = usePermiso('cash.movement.create')
  const puedeArquear = usePermiso('cash.count.create')
  const puedeAbrir = usePermiso('cash.shift.open')
  const puedeCerrar = usePermiso('cash.shift.close')
  const verVentasEnPesos = usePermiso('reports.sales.view')
  const verVentas = usePermiso('sales.view')

  const [caja, setCaja] = useState<EstadoDeCajaDTO | null>(null)
  const [ventasDeHoy, setVentasDeHoy] = useState<{ total: Monto; cantidad: number } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [detalle, setDetalle] = useState(false)
  const [movimiento, setMovimiento] = useState<TipoDeMovimiento | null>(null)
  const [arqueoAbierto, setArqueoAbierto] = useState(false)
  const [recarga, setRecarga] = useState(0)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const d = hoy()
      const [estado, ventas] = await Promise.all([
        apiRequest('/api/cash/shift', { parse: parseEstadoDeCaja }),
        verVentasEnPesos
          ? apiRequest(`/api/admin/sales?start=${d}&end=${d}&page=1&pageSize=1`, {
              parse: parsePaginaVentas,
            }).catch(() => null)
          : Promise.resolve(null),
      ])
      setCaja(estado)
      setVentasDeHoy(
        ventas ? { total: ventas.totales.recaudado, cantidad: ventas.totales.ventas } : null,
      )
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo consultar la caja. Revisá la conexión y reintentá.'))
    } finally {
      setCargando(false)
    }
  }, [hoy, verVentasEnPesos])

  useEffect(() => {
    void cargar()
  }, [cargar])

  function despuesDeRegistrar(mensaje: string) {
    aviso.ok(mensaje)
    notificarCambioDeCaja()
    setRecarga((n) => n + 1)
    void cargar()
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState
          title="No se pudo cargar la caja"
          description={error}
          onRetry={() => void cargar()}
        />
      </PageContainer>
    )
  }

  if (cargando && caja === null) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </PageContainer>
    )
  }

  const turno = caja?.turno ?? null

  return (
    <PageContainer>
      {turno === null ? (
        // ------------------------------------------------ CAJA CERRADA
        <section className="flex flex-col items-start gap-4 rounded-lg border border-line bg-surface p-6 sm:p-8">
          <p
            className="inline-flex items-center gap-2 rounded-md bg-warning-quiet px-3 py-1.5 text-lg font-bold tracking-wide text-warning"
            data-estado-caja="cerrada"
          >
            <span aria-hidden="true">●</span> CAJA CERRADA
          </p>
          <p className="max-w-xl text-lg text-ink">
            {caja?.politica.requiereTurno
              ? 'Para empezar a vender, abrí la caja contando la plata que hay en el cajón.'
              : 'Se puede vender igual, pero conviene abrir la caja para saber cuánta plata tendría que haber.'}
          </p>
          {puedeAbrir ? (
            <ButtonLink href="/caja/abrir" variant="primary" size="xl">
              Abrir caja
            </ButtonLink>
          ) : (
            <p className="text-base text-ink-muted">
              Tu usuario no puede abrir la caja. Pedíselo al encargado.
            </p>
          )}
        </section>
      ) : (
        // ------------------------------------------------ CAJA ABIERTA
        <section className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p
              className="inline-flex items-center gap-2 rounded-md bg-success-quiet px-3 py-1.5 text-lg font-bold tracking-wide text-success"
              data-estado-caja="abierta"
            >
              <span aria-hidden="true">✓</span> CAJA ABIERTA
            </p>
            <p className="text-base text-ink-muted">
              Desde las {horaCorta(turno.openedAt)} · abrió {turno.openedBy.name}
            </p>
          </div>

          <Metric
            size="lg"
            label="Tiene que haber en el cajón"
            value={<Money amount={turno.expectedAmount} size="hero" />}
            hint={
              <>
                Empezó con <Money amount={turno.openingAmount} size="sm" tone="muted" />
              </>
            }
          />

          <MetricRow className="border-t border-line pt-5">
            {ventasDeHoy !== null && (
              <Metric
                label="Ventas de hoy"
                value={<Money amount={ventasDeHoy.total} size="lg" />}
                hint={`${String(ventasDeHoy.cantidad)} ${ventasDeHoy.cantidad === 1 ? 'venta' : 'ventas'}, todas las formas de pago`}
                href={verVentas ? '/ventas' : undefined}
              />
            )}
            <Metric
              label="Ventas en efectivo"
              value={<Money amount={turno.ventasEnEfectivo} size="lg" />}
              hint={`${String(turno.cantidadDeVentas)} ${turno.cantidadDeVentas === 1 ? 'venta' : 'ventas'} desde que se abrió`}
            />
            <Metric label="Ingresos" value={<Money amount={turno.ingresos} size="lg" />} />
            <Metric label="Egresos" value={<Money amount={turno.egresos} size="lg" />} />
          </MetricRow>

          <div className="flex flex-col gap-2 border-t border-line pt-5 sm:flex-row sm:flex-wrap">
            {puedeMover && (
              <>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => {
                    setMovimiento('ingreso')
                  }}
                >
                  Registrar ingreso
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => {
                    setMovimiento('retiro')
                  }}
                >
                  Registrar egreso
                </Button>
              </>
            )}
            {puedeArquear && (
              <Button
                size="lg"
                variant="secondary"
                onClick={() => {
                  setArqueoAbierto(true)
                }}
              >
                Contar caja
              </Button>
            )}
            {puedeCerrar && (
              <ButtonLink href="/caja/cerrar" variant="primary" size="lg" className="sm:ml-auto">
                Cerrar caja
              </ButtonLink>
            )}
          </div>
        </section>
      )}

      <div>
        <Button
          variant="ghost"
          aria-expanded={detalle}
          aria-controls="caja-detalle"
          onClick={() => {
            setDetalle((v) => !v)
          }}
        >
          {detalle ? 'Ocultar detalle ▴' : 'Ver detalle ▾'}
        </Button>
      </div>

      {detalle && (
        <div id="caja-detalle" className="flex flex-col gap-8">
          <MovimientosDeCaja recarga={recarga} />
          <UltimosConteos recarga={recarga} />
          <HistorialTurnos recargar={recarga} />
        </div>
      )}

      <DialogoMovimiento
        abierto={movimiento !== null}
        tipo={movimiento ?? 'ingreso'}
        onCerrar={() => {
          setMovimiento(null)
        }}
        onHecho={() => {
          const era = movimiento
          setMovimiento(null)
          despuesDeRegistrar(era === 'retiro' ? 'Egreso registrado.' : 'Ingreso registrado.')
        }}
      />

      <DialogoArqueo
        abierto={arqueoAbierto}
        esperado={turno?.expectedAmount ?? CERO}
        onCerrar={() => {
          setArqueoAbierto(false)
        }}
        onHecho={() => {
          setArqueoAbierto(false)
          despuesDeRegistrar('Conteo guardado.')
        }}
      />
    </PageContainer>
  )
}

/** La lista de movimientos de caja, con sus filtros. Solo dentro de "Ver detalle". */
function MovimientosDeCaja({ recarga }: { recarga: number }) {
  const [movimientos, setMovimientos] = useState<MovimientoDTO[]>([])
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [total, setTotal] = useState(0)
  const [dias, setDias] = useState(1)
  const [tipo, setTipo] = useState('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(pagina),
        pageSize: String(POR_PAGINA),
        dias: String(dias),
        tipo,
      })
      const pag = await apiRequest(`/api/cash?${params.toString()}`, {
        parse: parsePaginaMovimientos,
      })
      setMovimientos(pag.movimientos)
      setTotal(pag.total)
      setPaginas(pag.totalPages)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar los movimientos.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, dias, tipo])

  useEffect(() => {
    void cargar()
  }, [cargar, recarga])

  return (
    <Section title="Movimientos de caja" description="Cada venta, ingreso y egreso, con su hora.">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Período" className="w-full sm:w-48">
          <Select
            value={String(dias)}
            onChange={(e) => {
              setDias(Number(e.target.value))
              setPagina(1)
            }}
          >
            <option value="1">Hoy</option>
            <option value="2">Ayer y hoy</option>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
          </Select>
        </Field>
        <Field label="Tipo" className="w-full sm:w-48">
          <Select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value)
              setPagina(1)
            }}
          >
            <option value="todos">Todos</option>
            <option value="sale">Ventas</option>
            <option value="sale_cancel">Ventas anuladas</option>
            <option value="ingreso">Ingresos</option>
            <option value="retiro">Egresos</option>
          </Select>
        </Field>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={() => void cargar()} />
      ) : cargando ? (
        <SkeletonRows rows={5} />
      ) : movimientos.length === 0 ? (
        <EmptyState
          title="No hay movimientos en este período"
          description="Probá con un período más largo."
        />
      ) : (
        <>
          <ResponsiveData
            table={
              <TableWrap>
                <Table caption="Movimientos de caja">
                  <THead>
                    <TR>
                      <TH>Tipo</TH>
                      <TH>Fecha</TH>
                      <TH>Detalle</TH>
                      <TH secondary>Forma de pago</TH>
                      <TH secondary>Usuario</TH>
                      <TH align="right">Importe</TH>
                      <TH align="center">
                        <span className="sr-only">Ver detalle</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {movimientos.map((m) => (
                      <MovimientoRow key={m.id} movimiento={m} />
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            }
            cards={
              <CardList>
                {movimientos.map((m) => {
                  const t = tipoDe(m.type)
                  return (
                    <CardListItem key={m.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-ink">
                            <span aria-hidden="true" className="mr-1.5">
                              {t.glifo}
                            </span>
                            {t.etiqueta}
                          </p>
                          <p className="mt-0.5 truncate text-sm text-ink-muted">
                            {m.description ?? '—'}
                          </p>
                          <p className="mt-1 text-sm text-ink-muted">
                            {fechaCorta(m.date)} · {medioLegible(m.paymentMethod)} · {m.user.name}
                          </p>
                        </div>
                        <Money amount={m.amount} signed tone={tonoPorSigno(m.amount)} size="md" />
                      </div>
                    </CardListItem>
                  )
                })}
              </CardList>
            }
          />
          <Pagination
            page={pagina}
            pageSize={POR_PAGINA}
            total={total}
            totalPages={paginas}
            onPageChange={setPagina}
            disabled={cargando}
          />
        </>
      )}
    </Section>
  )
}

/** Los ultimos conteos de la caja: lo contado contra lo que tendria que haber. */
function UltimosConteos({ recarga }: { recarga: number }) {
  const [arqueos, setArqueos] = useState<ArqueoDTO[]>([])

  useEffect(() => {
    let vivo = true
    apiRequest('/api/cash/count?limite=5', { parse: parseArqueos })
      .then((a) => {
        if (vivo) setArqueos(a)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [recarga])

  if (arqueos.length === 0) return null

  return (
    <Section title="Últimos conteos" description="Lo contado contra lo que tendría que haber.">
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
        {arqueos.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <span className="w-28 shrink-0 text-sm text-ink-muted">{fechaCorta(a.date)}</span>
            <span className="min-w-0 flex-1 truncate text-base text-ink">{a.user.name}</span>
            <span className="flex items-center gap-3 text-sm">
              <span className="text-ink-muted">
                contó <Money amount={a.amount} size="sm" tone="muted" />
              </span>
              {esCero(a.difference) ? (
                <span className="font-semibold text-success">✓ Cuadró</span>
              ) : (
                <span className="font-semibold text-warning">
                  ▲ {esNegativo(a.difference) ? 'Faltó' : 'Sobró'}{' '}
                  <Money amount={absMonto(a.difference)} size="md" />
                </span>
              )}
            </span>
            {a.notes && <p className="w-full text-sm text-ink-muted">{a.notes}</p>}
          </li>
        ))}
      </ul>
    </Section>
  )
}
