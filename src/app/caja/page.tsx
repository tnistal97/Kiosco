'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  MetricCard,
  Money,
  Pagination,
  Select,
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
import { DialogoMovimiento } from '@/components/caja/DialogoMovimiento'
import { MovimientoRow, fechaCorta, medioLegible, tipoDe } from '@/components/caja/MovimientoRow'
import { usePermiso } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  parseArqueos,
  parseMovimientos,
  parseSaldo,
  type ArqueoDTO,
  type MovimientoDTO,
} from '@/modules/cash/dto'
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

export default function CajaPage() {
  const puedeMover = usePermiso('cash.movement.create')
  const puedeArquear = usePermiso('cash.count.create')

  const [saldo, setSaldo] = useState<number | null>(null)
  const [efectivoHoy, setEfectivoHoy] = useState(0)
  const [movimientos, setMovimientos] = useState<MovimientoDTO[]>([])
  const [arqueos, setArqueos] = useState<ArqueoDTO[]>([])
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [total, setTotal] = useState(0)
  const [dias, setDias] = useState(2)
  const [tipo, setTipo] = useState('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [movimientoAbierto, setMovimientoAbierto] = useState(false)
  const [arqueoAbierto, setArqueoAbierto] = useState(false)

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
      const [pag, s, arq] = await Promise.all([
        apiRequest(`/api/cash?${params.toString()}`, { parse: parsePaginaMovimientos }),
        apiRequest('/api/cash/balance', { parse: parseSaldo }),
        apiRequest('/api/cash/count?limite=5', { parse: parseArqueos }),
      ])
      setMovimientos(pag.movimientos)
      setTotal(pag.total)
      setPaginas(pag.totalPages)
      setSaldo(s.balance)
      setEfectivoHoy(s.efectivoHoy)
      setArqueos(arq)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar los movimientos.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, dias, tipo])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const ultimoArqueo = arqueos[0]

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
      {/*
        Advertencia visible, no una nota al pie: el numero grande de arriba no
        es el de un turno. Esconderlo haria que un encargado creyera que la
        caja "cierra" cuando en realidad esta mirando un acumulado.
      */}
      <Alert tone="warning" title="Este saldo es acumulado, no el de un turno">
        Suma todo el efectivo de la sucursal desde que se instaló el sistema. Los turnos de caja,
        con apertura y cierre, llegan en la Fase&nbsp;3. Mientras tanto, el arqueo compara contra
        este total.
      </Alert>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Saldo en efectivo"
          value={saldo === null ? '—' : <Money amount={saldo} size="lg" />}
        />
        <MetricCard
          label="Movimiento de hoy"
          value={<Money amount={efectivoHoy} size="lg" signed tone={efectivoHoy < 0 ? 'out' : 'in'} />} // prettier-ignore
          detail="Solo efectivo"
        />
        <MetricCard
          label="Último arqueo"
          value={
            ultimoArqueo ? (
              <Money
                amount={ultimoArqueo.difference}
                size="lg"
                signed
                tone={ultimoArqueo.difference === 0 ? 'neutral' : ultimoArqueo.difference < 0 ? 'out' : 'in'} // prettier-ignore
              />
            ) : (
              '—'
            )
          }
          tone={!ultimoArqueo ? 'neutral' : ultimoArqueo.difference === 0 ? 'success' : 'warning'}
          detail={
            ultimoArqueo
              ? `${fechaCorta(ultimoArqueo.date)} · ${ultimoArqueo.user.name}`
              : 'Todavía no se hizo ninguno'
          }
        />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select
            aria-label="Rango de días"
            value={String(dias)}
            onChange={(e) => {
              setDias(Number(e.target.value))
              setPagina(1)
            }}
            className="w-auto"
          >
            <option value="1">Hoy</option>
            <option value="2">Ayer y hoy</option>
            <option value="7">Última semana</option>
            <option value="30">Último mes</option>
          </Select>

          <Select
            aria-label="Tipo de movimiento"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value)
              setPagina(1)
            }}
            className="w-auto"
          >
            <option value="todos">Todos los tipos</option>
            <option value="sale">Ventas</option>
            <option value="sale_cancel">Anulaciones</option>
            <option value="ingreso">Ingresos</option>
            <option value="retiro">Retiros</option>
            <option value="deposito">Depósitos</option>
          </Select>

          <div className="ml-auto flex gap-2">
            {puedeMover && (
              <Button
                variant="secondary"
                onClick={() => {
                  setMovimientoAbierto(true)
                }}
              >
                Nuevo movimiento
              </Button>
            )}
            {puedeArquear && (
              <Button
                variant="primary"
                onClick={() => {
                  setArqueoAbierto(true)
                }}
              >
                Hacer arqueo
              </Button>
            )}
          </div>
        </div>

        <div className="p-3">
          {error ? (
            <ErrorState description={error} onRetry={() => void cargar()} />
          ) : cargando ? (
            <SkeletonRows rows={6} />
          ) : movimientos.length === 0 ? (
            <EmptyState
              title="No hay movimientos en este rango"
              description="Probá con un rango más amplio o quitá el filtro de tipo."
            />
          ) : (
            <>
              {/* Escritorio: tabla. */}
              <div className="hidden lg:block">
                <TableWrap className="border-0">
                  <Table caption="Movimientos de caja">
                    <THead>
                      <TR>
                        <TH>Tipo</TH>
                        <TH>Fecha</TH>
                        <TH>Detalle</TH>
                        <TH>Medio</TH>
                        <TH>Usuario</TH>
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
              </div>

              {/* Móvil: tarjetas. Una tabla de siete columnas a 375 px no se
                  arregla achicando la fuente. */}
              <CardList className="lg:hidden">
                {movimientos.map((m) => {
                  const t = tipoDe(m.type)
                  return (
                    <CardListItem key={m.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            <span aria-hidden="true" className="mr-1.5">
                              {t.glifo}
                            </span>
                            {t.etiqueta}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {m.description ?? '—'}
                          </p>
                          <p className="mt-1 text-xs text-ink-faint">
                            {fechaCorta(m.date)} · {medioLegible(m.paymentMethod)} · {m.user.name}
                          </p>
                        </div>
                        <Money
                          amount={m.amount}
                          signed
                          tone={m.amount < 0 ? 'out' : 'in'}
                          size="md"
                        />
                      </div>
                    </CardListItem>
                  )
                })}
              </CardList>

              <Pagination
                className="mt-4"
                page={pagina}
                pageSize={POR_PAGINA}
                total={total}
                totalPages={paginas}
                onPageChange={setPagina}
                disabled={cargando}
              />
            </>
          )}
        </div>
      </Card>

      {arqueos.length > 0 && (
        <Card>
          <CardHeader title="Últimos arqueos" description="Lo contado contra lo esperado." />
          <ul className="flex flex-col divide-y divide-line">
            {arqueos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="w-28 shrink-0 text-sm text-ink-muted">{fechaCorta(a.date)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.user.name}</span>
                <span className="flex items-center gap-3 text-sm">
                  <span className="text-ink-muted">
                    contó <Money amount={a.amount} size="sm" tone="muted" />
                  </span>
                  <Money
                    amount={a.difference}
                    signed
                    size="md"
                    tone={a.difference === 0 ? 'neutral' : a.difference < 0 ? 'out' : 'in'}
                  />
                </span>
                {a.notes && (
                  <p className="w-full text-xs text-ink-faint sm:w-auto sm:basis-full">{a.notes}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <DialogoMovimiento
        abierto={movimientoAbierto}
        onCerrar={() => {
          setMovimientoAbierto(false)
        }}
        onHecho={() => {
          setMovimientoAbierto(false)
          aviso.ok('Movimiento registrado.')
          notificarCambioDeCaja()
          void cargar()
        }}
      />

      <DialogoArqueo
        abierto={arqueoAbierto}
        esperado={saldo ?? 0}
        onCerrar={() => {
          setArqueoAbierto(false)
        }}
        onHecho={() => {
          setArqueoAbierto(false)
          aviso.ok('Arqueo registrado.')
          void cargar()
        }}
      />
    </div>
  )
}
