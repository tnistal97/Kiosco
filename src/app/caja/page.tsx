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
  cn,
} from '@/components/ui'
import { AyudaCaja } from '@/components/caja/AyudaCaja'
import { CuentaDeLaCaja } from '@/components/caja/CuentaDeLaCaja'
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
  parseTurnos,
  type ArqueoDTO,
  type EstadoDeCajaDTO,
  type MovimientoDTO,
  type TurnoDTO,
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
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * "Desde las 08:02", o con la fecha si la caja se abrio otro dia: una caja que
 * sigue abierta desde ayer tiene que notarse.
 */
function desdeCuando(iso: string): string {
  const abierta = new Date(iso)
  const esDeHoy = abierta.toDateString() === new Date().toDateString()
  return esDeHoy ? `Desde las ${horaCorta(iso)}` : `Abierta desde el ${fechaCorta(iso)}`
}

/**
 * Caja. UX V5, segunda vuelta.
 *
 * Responde, de arriba hacia abajo y SIN ABRIR NADA, lo que se pregunta en el
 * mostrador:
 *
 *   1. ¿Está abierta o cerrada? En grande, con palabra y simbolo.
 *   2. ¿Cuánta plata tiene que haber en el cajón? La cifra mas grande.
 *   3. ¿De dónde sale ese número? La cuenta completa: monto inicial, ventas
 *      en efectivo, ingresos, egresos y el saldo esperado.
 *   4. ¿Cuadra? La diferencia del ultimo conteo de esta caja, o el aviso de
 *      que todavia no se conto.
 *   5. ¿Qué puedo hacer? Registrar ingreso, registrar egreso, contar la caja,
 *      cerrarla.
 *
 * Debajo, a la vista y no detras de "Ver detalle" (pedido del dueño): los
 * movimientos de hoy, los ultimos conteos y las cajas anteriores. Con la caja
 * cerrada se muestra la cuenta del ultimo cierre, que es lo que se quiere
 * revisar al dia siguiente.
 *
 * "Cómo funciona" explica en cinco preguntas que es abrir y cerrar.
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
  const [ultimoConteo, setUltimoConteo] = useState<ArqueoDTO | null>(null)
  const [ultimoCierre, setUltimoCierre] = useState<TurnoDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [movimiento, setMovimiento] = useState<TipoDeMovimiento | null>(null)
  const [arqueoAbierto, setArqueoAbierto] = useState(false)
  const [recarga, setRecarga] = useState(0)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const d = hoy()
      const [estado, ventas, conteos, cierres] = await Promise.all([
        apiRequest('/api/cash/shift', { parse: parseEstadoDeCaja }),
        verVentasEnPesos
          ? apiRequest(`/api/admin/sales?start=${d}&end=${d}&page=1&pageSize=1`, {
              parse: parsePaginaVentas,
            }).catch(() => null)
          : Promise.resolve(null),
        // Lo que acompaña al estado no frena la pantalla: si falla, se omite.
        apiRequest('/api/cash/count?limite=1', { parse: parseArqueos }).catch(() => []),
        apiRequest('/api/cash/shifts?estado=closed&page=1&pageSize=1', {
          parse: parseTurnos,
        }).catch(() => []),
      ])
      setCaja(estado)
      setVentasDeHoy(
        ventas ? { total: ventas.totales.recaudado, cantidad: ventas.totales.ventas } : null,
      )
      setUltimoConteo(conteos[0] ?? null)
      setUltimoCierre(cierres[0] ?? null)
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
  const ayuda = (
    <AyudaCaja
      requiereTurno={caja?.politica.requiereTurno ?? false}
      umbralDiferencia={caja?.politica.umbralDiferencia ?? CERO}
    />
  )
  // El conteo solo dice algo de ESTA caja si se hizo despues de abrirla.
  const conteoDelTurno =
    turno !== null &&
    ultimoConteo !== null &&
    new Date(ultimoConteo.date).getTime() >= new Date(turno.openedAt).getTime()
      ? ultimoConteo
      : null

  return (
    <PageContainer>
      {turno === null ? (
        // ------------------------------------------------ CAJA CERRADA
        <section className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              className="inline-flex items-center gap-2 rounded-md bg-warning-quiet px-3 py-1.5 text-lg font-bold tracking-wide text-warning"
              data-estado-caja="cerrada"
            >
              <span aria-hidden="true">●</span> CAJA CERRADA
            </p>
            {ayuda}
          </div>
          <p className="max-w-xl text-lg text-ink">
            {caja?.politica.requiereTurno
              ? 'Para empezar a vender, abrí la caja contando la plata que hay en el cajón.'
              : 'Se puede vender igual, pero conviene abrir la caja para saber cuánta plata tendría que haber.'}
          </p>
          {puedeAbrir ? (
            <div>
              <ButtonLink href="/caja/abrir" variant="primary" size="xl">
                Abrir caja
              </ButtonLink>
            </div>
          ) : (
            <p className="text-base text-ink-muted">
              Tu usuario no puede abrir la caja. Pedíselo al encargado.
            </p>
          )}

          {ultimoCierre !== null && <UltimoCierre turno={ultimoCierre} />}
        </section>
      ) : (
        // ------------------------------------------------ CAJA ABIERTA
        <section className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p
                className="inline-flex items-center gap-2 rounded-md bg-success-quiet px-3 py-1.5 text-lg font-bold tracking-wide text-success"
                data-estado-caja="abierta"
              >
                <span aria-hidden="true">✓</span> CAJA ABIERTA
              </p>
              <p className="text-base text-ink-muted">
                {desdeCuando(turno.openedAt)} · abrió {turno.openedBy.name}
              </p>
            </div>
            {ayuda}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
            <div className="flex flex-col gap-4">
              <Metric
                size="lg"
                label="Tiene que haber en el cajón"
                value={<Money amount={turno.expectedAmount} size="hero" />}
                hint="Saldo esperado: solo el efectivo."
              />
              <EstadoDelConteo conteo={conteoDelTurno} puedeContar={puedeArquear} />
            </div>

            <div className="rounded-lg border border-line bg-sunken p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">De dónde sale</h2>
              <CuentaDeLaCaja
                inicial={turno.openingAmount}
                ventasEnEfectivo={turno.ventasEnEfectivo}
                cantidadDeVentas={turno.cantidadDeVentas}
                ingresos={turno.ingresos}
                egresos={turno.egresos}
                esperado={turno.expectedAmount}
              />
            </div>
          </div>

          {ventasDeHoy !== null && (
            <MetricRow className="border-t border-line pt-5">
              <Metric
                label="Ventas de hoy"
                value={<Money amount={ventasDeHoy.total} size="lg" />}
                hint={`${String(ventasDeHoy.cantidad)} ${ventasDeHoy.cantidad === 1 ? 'venta' : 'ventas'}, todas las formas de pago (no todo entra al cajón)`}
                href={verVentas ? '/ventas' : undefined}
              />
            </MetricRow>
          )}

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

      <div className="flex flex-col gap-8">
        <MovimientosDeCaja recarga={recarga} />
        <UltimosConteos recarga={recarga} />
        <HistorialTurnos recargar={recarga} />
      </div>

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

/**
 * ¿Cuadra? El ultimo conteo de esta caja contra lo que tenia que haber EN ESE
 * MOMENTO. Sin conteo, lo dice: una diferencia que nadie midio no es cero.
 */
function EstadoDelConteo({
  conteo,
  puedeContar,
}: {
  conteo: ArqueoDTO | null
  puedeContar: boolean
}) {
  if (conteo === null) {
    return (
      <p
        data-diferencia-caja="sin-contar"
        className="rounded-md border border-line px-3 py-2 text-base text-ink-muted"
      >
        <strong className="font-semibold text-ink">Diferencia:</strong> todavía no se contó esta
        caja.
        {puedeContar && ' Usá “Contar caja” para ver si falta o sobra plata.'}
      </p>
    )
  }

  const cuadra = esCero(conteo.difference)
  const falta = esNegativo(conteo.difference)
  return (
    <div
      data-diferencia-caja={cuadra ? 'cuadra' : falta ? 'falta' : 'sobra'}
      className={cn(
        'rounded-md border px-3 py-2',
        cuadra ? 'border-success/40 bg-success-quiet' : 'border-warning/40 bg-warning-quiet',
      )}
    >
      <p className={cn('text-base font-semibold', cuadra ? 'text-success' : 'text-warning')}>
        {cuadra ? (
          <>
            <span aria-hidden="true">✓ </span>Diferencia: ninguna, cuadró
          </>
        ) : (
          <>
            <span aria-hidden="true">▲ </span>Diferencia: {falta ? 'faltan' : 'sobran'}{' '}
            <Money amount={absMonto(conteo.difference)} size="md" />
          </>
        )}
      </p>
      <p className="mt-0.5 text-sm text-ink-muted">
        Último conteo a las {horaCorta(conteo.date)} ({conteo.user.name}): contó{' '}
        <Money amount={conteo.amount} size="sm" tone="muted" /> y tenía que haber{' '}
        <Money amount={conteo.expected} size="sm" tone="muted" />.
      </p>
    </div>
  )
}

/** La cuenta de la ultima caja cerrada, para revisarla al dia siguiente. */
function UltimoCierre({ turno }: { turno: TurnoDTO }) {
  const diferencia = turno.difference
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Último cierre</h2>
        <p className="text-sm text-ink-muted">
          Abrió {turno.openedBy.name} el {fechaCorta(turno.openedAt)}
          {turno.closedAt && (
            <>
              {' '}
              · cerró {turno.closedBy?.name ?? '—'} el {fechaCorta(turno.closedAt)}
            </>
          )}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-10">
        <CuentaDeLaCaja
          className="rounded-lg border border-line bg-sunken p-4"
          inicial={turno.openingAmount}
          ventasEnEfectivo={turno.ventasEnEfectivo}
          cantidadDeVentas={turno.cantidadDeVentas}
          ingresos={turno.ingresos}
          egresos={turno.egresos}
          esperado={turno.expectedAmount}
        />
        <dl className="flex flex-col gap-1.5 self-start text-base">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">Contado al cerrar</dt>
            <dd>{turno.countedAmount === null ? '—' : <Money amount={turno.countedAmount} />}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">Diferencia</dt>
            <dd>
              {diferencia === null ? (
                '—'
              ) : esCero(diferencia) ? (
                <span className="font-semibold text-success">✓ Cuadró</span>
              ) : (
                <span className="font-semibold text-warning">
                  ▲ {esNegativo(diferencia) ? 'Faltó' : 'Sobró'}{' '}
                  <Money amount={absMonto(diferencia)} size="md" />
                </span>
              )}
            </dd>
          </div>
          {turno.closingNotes && (
            <p className="mt-1 text-sm text-ink-muted">“{turno.closingNotes}”</p>
          )}
        </dl>
      </div>
    </div>
  )
}

/** La lista de movimientos de caja, con sus filtros. */
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
