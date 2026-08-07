'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Money,
  Pagination,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  tonoPorSigno,
} from '@/components/ui'
import { apiRequest, esObjeto, mensajeDeError, numero } from '@/lib/api-client'
import { esCero } from '@/lib/money'
import { parseTurnos, type TurnoDTO } from '@/modules/cash/dto'
import { fechaCorta } from './MovimientoRow'

const POR_PAGINA = 10

/** Estado del turno con palabra, no solo con color. */
function EstadoTurno({ turno }: { turno: TurnoDTO }) {
  if (turno.status === 'open') {
    return (
      <Badge tone="success">
        <span aria-hidden="true">●</span> Abierto
      </Badge>
    )
  }
  if (turno.status === 'legacy') {
    return (
      <Badge tone="neutral">
        <span aria-hidden="true">⌛</span> Histórico
      </Badge>
    )
  }
  if (turno.difference !== null && !esCero(turno.difference)) {
    return (
      <Badge tone="warning">
        <span aria-hidden="true">⚠</span> Con diferencia
      </Badge>
    )
  }
  return (
    <Badge tone="neutral">
      <span aria-hidden="true">✓</span> Cerrado
    </Badge>
  )
}

/**
 * Historial de turnos.
 *
 * Un turno cerrado es inmutable: no hay accion sobre las filas, solo lectura.
 * Lo que se busca aca es "¿cuando falto plata y quien estaba?", asi que la
 * diferencia va destacada y el estado dice si hubo una.
 */
export function HistorialTurnos({ recargar }: { recargar: number }) {
  const [turnos, setTurnos] = useState<TurnoDTO[]>([])
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(pagina), pageSize: String(POR_PAGINA) })
      const crudo = await apiRequest<unknown>(`/api/cash/shifts?${params.toString()}`, {
        parse: (r) => r,
      })
      setTurnos(parseTurnos(crudo))
      const p = esObjeto(crudo) && esObjeto(crudo.pagination) ? crudo.pagination : null
      setTotal(p ? numero(p.total) : 0)
      setPaginas(p ? Math.max(1, numero(p.totalPages)) : 1)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar el historial de turnos.'))
    } finally {
      setCargando(false)
    }
  }, [pagina])

  useEffect(() => {
    void cargar()
  }, [cargar, recargar])

  return (
    <Card padded={false}>
      <div className="p-3">
        <CardHeader
          title="Turnos de caja"
          description="Cada apertura con su cierre. Un turno cerrado no se modifica."
        />
      </div>

      <div className="p-3 pt-0">
        {error ? (
          <ErrorState description={error} onRetry={() => void cargar()} />
        ) : cargando ? (
          <SkeletonRows rows={4} />
        ) : turnos.length === 0 ? (
          <EmptyState
            title="Todavía no hay turnos"
            description="Cuando alguien abra la caja, el turno aparece acá."
          />
        ) : (
          <>
            {/* Escritorio: tabla. */}
            <div className="hidden lg:block">
              <TableWrap className="border-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Cajero</TH>
                      <TH>Apertura</TH>
                      <TH>Cierre</TH>
                      <TH align="right">Inicial</TH>
                      <TH align="right">Esperado</TH>
                      <TH align="right">Contado</TH>
                      <TH align="right">Diferencia</TH>
                      <TH align="right">Ventas</TH>
                      <TH>Estado</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {turnos.map((t) => (
                      <TR key={t.id}>
                        <TD>{t.openedBy.name}</TD>
                        <TD>{fechaCorta(t.openedAt)}</TD>
                        <TD>{t.closedAt ? fechaCorta(t.closedAt) : '—'}</TD>
                        <TD align="right">
                          <Money amount={t.openingAmount} size="sm" tone="muted" />
                        </TD>
                        <TD align="right">
                          <Money amount={t.expectedAmount} size="sm" />
                        </TD>
                        <TD align="right">
                          {t.countedAmount === null ? (
                            '—'
                          ) : (
                            <Money amount={t.countedAmount} size="sm" />
                          )}
                        </TD>
                        <TD align="right">
                          {t.difference === null ? (
                            '—'
                          ) : (
                            <Money
                              amount={t.difference}
                              size="sm"
                              signed
                              tone={tonoPorSigno(t.difference)}
                            />
                          )}
                        </TD>
                        <TD align="right" data-numeric="">
                          {t.cantidadDeVentas}
                        </TD>
                        <TD>
                          <EstadoTurno turno={t} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            {/* Móvil: tarjetas. Nueve columnas no entran en 375 px. */}
            <CardList className="lg:hidden">
              {turnos.map((t) => (
                <CardListItem key={t.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{t.openedBy.name}</span>
                    <EstadoTurno turno={t} />
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">
                    {fechaCorta(t.openedAt)} → {t.closedAt ? fechaCorta(t.closedAt) : 'en curso'}
                  </p>
                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    <div className="flex gap-1.5">
                      <dt className="text-ink-muted">Esperado</dt>
                      <dd>
                        <Money amount={t.expectedAmount} size="sm" />
                      </dd>
                    </div>
                    {t.countedAmount !== null && (
                      <div className="flex gap-1.5">
                        <dt className="text-ink-muted">Contado</dt>
                        <dd>
                          <Money amount={t.countedAmount} size="sm" />
                        </dd>
                      </div>
                    )}
                    {t.difference !== null && (
                      <div className="flex gap-1.5">
                        <dt className="text-ink-muted">Diferencia</dt>
                        <dd>
                          <Money
                            amount={t.difference}
                            size="sm"
                            signed
                            tone={tonoPorSigno(t.difference)}
                          />
                        </dd>
                      </div>
                    )}
                  </dl>
                  {t.closingNotes && (
                    <p className="mt-1 text-xs text-ink-faint">{t.closingNotes}</p>
                  )}
                </CardListItem>
              ))}
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
  )
}
