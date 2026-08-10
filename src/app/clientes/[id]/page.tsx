'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
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
  aviso,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { DialogoCliente } from '@/components/clientes/DialogoCliente'
import { DialogoCobro } from '@/components/clientes/DialogoCobro'
import { DialogoAjusteCuenta } from '@/components/clientes/DialogoAjusteCuenta'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esNegativo, esPositivo } from '@/lib/money'
import {
  parseDetalleCliente,
  parsePaginaMovimientos,
  parsePaginaVentasDeCliente,
  type DetalleClienteDTO,
  type MovimientoDeCuentaDTO,
  type VentaDeClienteDTO,
} from '@/modules/clients/dto'

const POR_PAGINA = 20

function fechaHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Una cifra del resumen, con su etiqueta. */
function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="text-lg font-semibold text-ink" data-numeric="">
        {children}
      </div>
    </div>
  )
}

export default function ClienteDetallePage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const puedeAdministrar = usePermiso('clients.manage')
  const puedeCobrar = usePermiso('accounts.payment')
  const puedeAjustar = usePermiso('accounts.adjust')
  const puedeVerCuenta = usePermiso('accounts.view')
  const puedeVerVentas = usePermiso('sales.view')

  const [cliente, setCliente] = useState<DetalleClienteDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [movimientos, setMovimientos] = useState<MovimientoDeCuentaDTO[]>([])
  const [paginaMov, setPaginaMov] = useState(1)
  const [totalPaginasMov, setTotalPaginasMov] = useState(1)

  const [ventas, setVentas] = useState<VentaDeClienteDTO[]>([])

  const [editando, setEditando] = useState(false)
  const [cobrando, setCobrando] = useState(false)
  const [ajustando, setAjustando] = useState(false)

  const cargarCliente = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setCliente(await apiRequest(`/api/clients/${id}`, { parse: parseDetalleCliente }))
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar el cliente.'))
    } finally {
      setCargando(false)
    }
  }, [id])

  const cargarMovimientos = useCallback(async () => {
    if (!puedeVerCuenta) return
    try {
      const res = await apiRequest(
        `/api/clients/${id}/cuenta?page=${String(paginaMov)}&pageSize=${String(POR_PAGINA)}`,
        { parse: parsePaginaMovimientos },
      )
      setMovimientos(res.data)
      setTotalPaginasMov(res.pagination.totalPages)
    } catch {
      // El extracto es secundario: si falla, la ficha sigue siendo util.
      setMovimientos([])
    }
  }, [id, paginaMov, puedeVerCuenta])

  const cargarVentas = useCallback(async () => {
    if (!puedeVerVentas) return
    try {
      const res = await apiRequest(`/api/clients/${id}/ventas?page=1&pageSize=10`, {
        parse: parsePaginaVentasDeCliente,
      })
      setVentas(res.data)
    } catch {
      setVentas([])
    }
  }, [id, puedeVerVentas])

  useEffect(() => {
    void cargarCliente()
  }, [cargarCliente])
  useEffect(() => {
    void cargarMovimientos()
  }, [cargarMovimientos])
  useEffect(() => {
    void cargarVentas()
  }, [cargarVentas])

  function recargarTodo() {
    void cargarCliente()
    void cargarMovimientos()
    void cargarVentas()
  }

  async function cambiarFiado() {
    if (!cliente) return
    try {
      await apiRequest(`/api/clients/${id}/fiado`, {
        method: 'PATCH',
        body: { isCreditEnabled: !cliente.isCreditEnabled },
        parse: () => null,
      })
      aviso.ok(cliente.isCreditEnabled ? 'Fiado cortado' : 'Fiado habilitado')
      recargarTodo()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo cambiar el fiado.'))
    }
  }

  if (cargando) return <SkeletonRows rows={6} />
  if (error !== null) return <ErrorState description={error} onRetry={() => void cargarCliente()} />
  if (!cliente) return null

  const debe = esPositivo(cliente.balance)
  const aFavor = esNegativo(cliente.balance)

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">{cliente.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {!cliente.isActive && <Badge tone="neutral">De baja</Badge>}
            {!cliente.isCreditEnabled && <Badge tone="warning">Fiado cortado</Badge>}
            <Link href="/clientes" className="text-sm text-ink-muted hover:text-primary">
              ← Todos los clientes
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {puedeCobrar && (
            <Button
              variant="primary"
              onClick={() => {
                setCobrando(true)
              }}
            >
              Registrar pago
            </Button>
          )}
          {puedeAdministrar && (
            <Button
              variant="secondary"
              onClick={() => {
                setEditando(true)
              }}
            >
              Editar
            </Button>
          )}
          {puedeAdministrar && (
            <Button variant="secondary" onClick={() => void cambiarFiado()}>
              {cliente.isCreditEnabled ? 'Cortar fiado' : 'Habilitar fiado'}
            </Button>
          )}
          {puedeAjustar && (
            <Button
              variant="secondary"
              onClick={() => {
                setAjustando(true)
              }}
            >
              Ajustar cuenta
            </Button>
          )}
        </div>
      </header>

      {/* Resumen */}
      {puedeVerCuenta && (
        <Card className="flex flex-col gap-4 p-4">
          <h3 className="text-sm font-semibold text-ink">Cuenta corriente</h3>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato label="Saldo actual">
              {debe && (
                <span className="text-danger">
                  <Money amount={cliente.balance} />
                </span>
              )}
              {aFavor && (
                <span className="text-success">
                  <Money amount={cliente.balance.replace('-', '')} />
                </span>
              )}
              {!debe && !aFavor && <span className="text-ink-faint">Al día</span>}
            </Dato>

            <Dato label="Límite">
              {cliente.creditLimit === null ? (
                <span className="text-base font-normal text-ink-faint">Sin límite</span>
              ) : (
                <Money amount={cliente.creditLimit} />
              )}
            </Dato>

            <Dato label="Crédito disponible">
              {cliente.disponible === null ? (
                <span className="text-base font-normal text-ink-faint">—</span>
              ) : (
                <Money amount={cliente.disponible} />
              )}
            </Dato>

            <Dato label="Compras a cuenta">{cliente.resumen.ventasACuenta}</Dato>
          </div>

          {aFavor && (
            <Alert tone="info" title="Tiene saldo a favor">
              Se le va a descontar de la próxima compra a cuenta.
            </Alert>
          )}
          {!cliente.isCreditEnabled && (
            <Alert tone="warning" title="El fiado está cortado">
              Puede seguir comprando de contado. No se le puede cargar nada a la cuenta.
            </Alert>
          )}
        </Card>
      )}

      {/* Datos */}
      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold text-ink">Datos</h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-faint">Teléfono</dt>
            <dd className="text-ink" data-numeric="">
              {cliente.phone ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Documento</dt>
            <dd className="text-ink" data-numeric="">
              {cliente.document ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Correo</dt>
            <dd className="truncate text-ink">{cliente.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Dirección</dt>
            <dd className="truncate text-ink">{cliente.address ?? '—'}</dd>
          </div>
        </dl>
        {cliente.notes !== null && <p className="text-sm text-ink-muted">{cliente.notes}</p>}
      </Card>

      {/* Extracto */}
      {puedeVerCuenta && (
        <Card className="flex flex-col gap-4 p-4">
          <h3 className="text-sm font-semibold text-ink">Movimientos</h3>

          {movimientos.length === 0 && (
            <EmptyState
              title="Sin movimientos"
              description="Todavía no se le fió nada ni registró ningún pago."
            />
          )}

          {movimientos.length > 0 && (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Fecha</TH>
                      <TH>Concepto</TH>
                      <TH className="text-right">Importe</TH>
                      <TH className="text-right">Saldo</TH>
                      <TH>Quién</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {movimientos.map((m) => (
                      <TR key={m.id}>
                        <TD className="text-ink-muted" data-numeric="">
                          {fechaHora(m.createdAt)}
                        </TD>
                        <TD>
                          {m.typeLabel}
                          {m.saleId !== null && (
                            <span className="ml-1 text-ink-faint" data-numeric="">
                              #{m.saleId}
                            </span>
                          )}
                          {m.paymentNumber !== null && (
                            <Link
                              href={`/comprobantes/${String(m.paymentId ?? 0)}`}
                              className="ml-1 text-primary hover:underline"
                              data-numeric=""
                            >
                              {m.paymentNumber}
                            </Link>
                          )}
                          {m.reason !== null && (
                            <div className="text-xs text-ink-faint">{m.reason}</div>
                          )}
                          {m.autorizadoPor !== null && (
                            <div className="text-xs text-warning">
                              Autorizado por {m.autorizadoPor}
                            </div>
                          )}
                        </TD>
                        <TD className="text-right" data-numeric="">
                          {/*
                            El signo se muestra tal cual esta en el libro: un
                            `+20.000` que sube la deuda y un `-8.000` que la
                            baja. Es la misma convencion del extracto que
                            recibe cualquiera de su banco.
                          */}
                          <span className={esPositivo(m.amount) ? 'text-danger' : 'text-success'}>
                            {esPositivo(m.amount) ? '+' : '−'}
                            <Money amount={m.amount.replace('-', '')} />
                          </span>
                        </TD>
                        <TD className="text-right font-medium" data-numeric="">
                          <Money amount={m.resultingBalance.replace('-', '')} />
                          {esNegativo(m.resultingBalance) && (
                            <span className="ml-1 text-xs text-success">a favor</span>
                          )}
                        </TD>
                        <TD className="text-ink-muted">{m.user.name}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <CardList className="md:hidden">
                {movimientos.map((m) => (
                  <CardListItem key={m.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{m.typeLabel}</div>
                        <div className="text-xs text-ink-faint" data-numeric="">
                          {fechaHora(m.createdAt)} · {m.user.name}
                        </div>
                      </div>
                      <div className="shrink-0 text-right" data-numeric="">
                        <div className={esPositivo(m.amount) ? 'text-danger' : 'text-success'}>
                          {esPositivo(m.amount) ? '+' : '−'}
                          <Money amount={m.amount.replace('-', '')} />
                        </div>
                        <div className="text-xs text-ink-faint">
                          Saldo <Money amount={m.resultingBalance.replace('-', '')} />
                        </div>
                      </div>
                    </div>
                  </CardListItem>
                ))}
              </CardList>

              <Pagination
                page={paginaMov}
                pageSize={POR_PAGINA}
                total={cliente.resumen.cuantosMovimientos}
                totalPages={totalPaginasMov}
                onPageChange={(p) => {
                  setPaginaMov(p)
                }}
              />
            </>
          )}
        </Card>
      )}

      {/* Ventas */}
      {puedeVerVentas && ventas.length > 0 && (
        <Card className="flex flex-col gap-4 p-4">
          <h3 className="text-sm font-semibold text-ink">Últimas compras</h3>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH className="text-right">Venta</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">A cuenta</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {ventas.map((v) => (
                  <TR key={v.id}>
                    <TD className="text-ink-muted" data-numeric="">
                      {fechaHora(v.date)}
                    </TD>
                    <TD className="text-right" data-numeric="">
                      #{v.id}
                    </TD>
                    <TD className="text-right" data-numeric="">
                      <Money amount={v.total} />
                    </TD>
                    <TD className="text-right" data-numeric="">
                      {esPositivo(v.aCuenta) ? <Money amount={v.aCuenta} /> : '—'}
                    </TD>
                    <TD>
                      {v.status === 'canceled' ? (
                        <Badge tone="danger">Anulada</Badge>
                      ) : (
                        <span className="text-ink-faint">Completada</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}

      <DialogoCliente
        abierto={editando}
        cliente={cliente}
        onCerrar={() => {
          setEditando(false)
        }}
        onGuardado={() => {
          setEditando(false)
          recargarTodo()
        }}
      />

      <DialogoCobro
        abierto={cobrando}
        cliente={cliente}
        onCerrar={() => {
          setCobrando(false)
        }}
        onCobrado={() => {
          setCobrando(false)
          recargarTodo()
        }}
      />

      <DialogoAjusteCuenta
        abierto={ajustando}
        cliente={cliente}
        onCerrar={() => {
          setAjustando(false)
        }}
        onAjustado={() => {
          setAjustando(false)
          recargarTodo()
        }}
      />
    </div>
  )
}
