'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Money,
  Pagination,
  Select,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  type BadgeTone,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esNegativo, esPositivo } from '@/lib/money'
import { AnticiposDeProveedor } from './AnticiposDeProveedor'
import { DevolucionesDeProveedor } from './DevolucionesDeProveedor'
import { DialogoAjusteProveedor } from './DialogoAjusteProveedor'
import { DialogoPagoProveedor } from './DialogoPagoProveedor'
import {
  parsePaginaDeudas,
  parsePaginaMovimientosDeProveedor,
  parseResumenDeCuenta,
  type DeudaDTO,
  type MovimientoDeProveedorDTO,
  type ResumenDeCuentaDTO,
} from '@/modules/suppliers/dto.cuenta'
import {
  TIPOS_DE_PROVEEDOR,
  etiquetaDeEstadoDeDeuda,
  etiquetaDeProveedor,
  type EstadoDeDeuda,
} from '@/modules/suppliers/movement-types'

const POR_PAGINA = 20

function fechaCorta(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * El color del estado, y su PALABRA.
 *
 * Nunca solo el color: quien no distingue rojo de verde --y cualquiera que
 * imprima la pantalla en blanco y negro-- necesita leerlo. Es lo que pide el
 * objetivo 20 y es criterio de WCAG 1.4.1.
 */
const TONO_DE_ESTADO: Record<EstadoDeDeuda, BadgeTone> = {
  PENDIENTE: 'neutral',
  PARCIAL: 'warning',
  VENCIDA: 'danger',
  PAGADA: 'success',
}

/** Un numero de la cabecera. */
function Metrica({
  etiqueta,
  children,
  detalle,
}: {
  etiqueta: string
  children: React.ReactNode
  detalle?: string
}) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-xs text-ink-faint">{etiqueta}</div>
      <div className="mt-0.5 text-lg font-semibold text-ink" data-numeric="">
        {children}
      </div>
      {detalle !== undefined && <div className="text-xs text-ink-muted">{detalle}</div>}
    </div>
  )
}

/**
 * La cuenta corriente de un proveedor: resumen, deudas abiertas y extracto.
 *
 * Vive aparte de la ficha porque son dos materias con dos permisos distintos:
 * quien puede ver a quien le compramos no necesariamente puede ver cuanto le
 * debemos. La pantalla monta este bloque solo con `supplierAccounts.view`.
 *
 * Ver docs/SUPPLIER_ACCOUNT_LEDGER.md.
 */
export function CuentaDeProveedor({ supplierId }: { supplierId: number }) {
  const puedePagar = usePermiso('supplierAccounts.payment')
  const puedeAcreditar = usePermiso('supplierAccounts.credit')
  const puedeAjustar = usePermiso('supplierAccounts.adjust')
  const puedeSobrepagar = usePermiso('supplierAccounts.overpay')
  const puedeImputar = usePermiso('supplierAccounts.allocate')
  const puedeVerDevoluciones = usePermiso('purchaseReturns.view')

  const [cuenta, setCuenta] = useState<ResumenDeCuentaDTO | null>(null)
  const [deudas, setDeudas] = useState<DeudaDTO[]>([])
  const [movimientos, setMovimientos] = useState<MovimientoDeProveedorDTO[]>([])
  const [paginaMov, setPaginaMov] = useState(1)
  const [totalMov, setTotalMov] = useState(0)
  const [tipo, setTipo] = useState<string>('todos')
  const [soloAbiertas, setSoloAbiertas] = useState(true)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [pagando, setPagando] = useState(false)
  const [acreditando, setAcreditando] = useState(false)
  const [ajustando, setAjustando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const base = `/api/suppliers/${String(supplierId)}`
      const [resumen, listaDeudas, extracto] = await Promise.all([
        apiRequest(`${base}/cuenta/resumen`, { parse: parseResumenDeCuenta }),
        apiRequest(`${base}/deudas?abiertas=${String(soloAbiertas)}&pageSize=50`, {
          parse: parsePaginaDeudas,
        }),
        apiRequest(
          `${base}/cuenta?page=${String(paginaMov)}&pageSize=${String(POR_PAGINA)}&tipo=${tipo}`,
          { parse: parsePaginaMovimientosDeProveedor },
        ),
      ])
      setCuenta(resumen)
      setDeudas(listaDeudas.data)
      setMovimientos(extracto.data)
      setTotalMov(extracto.pagination.total)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar la cuenta.'))
    } finally {
      setCargando(false)
    }
  }, [supplierId, paginaMov, tipo, soloAbiertas])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (cargando && cuenta === null) return <SkeletonRows rows={5} />
  if (error !== null) return <ErrorState description={error} onRetry={() => void cargar()} />
  if (!cuenta) return null

  const debemos = esPositivo(cuenta.balance)
  const aFavor = esNegativo(cuenta.balance)

  return (
    <div className="flex flex-col gap-5">
      {/* --------------------------------------------------------- resumen */}
      <Card className="p-4">
        <CardHeader
          title="Cuenta corriente"
          description="Lo que le debemos, cuándo vence y qué se le pagó"
          actions={
            <div className="flex flex-wrap gap-2">
              {puedePagar && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setPagando(true)
                  }}
                >
                  Registrar pago
                </Button>
              )}
              {puedeAcreditar && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAcreditando(true)
                  }}
                >
                  Nota de crédito
                </Button>
              )}
              {puedeAjustar && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAjustando(true)
                  }}
                >
                  Ajustar
                </Button>
              )}
            </div>
          }
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metrica
            etiqueta="Saldo pendiente"
            detalle={aFavor ? 'a favor nuestro' : debemos ? 'le debemos' : undefined}
          >
            {debemos || aFavor ? (
              <Money amount={cuenta.balance.replace('-', '')} tone={aFavor ? 'in' : 'neutral'} />
            ) : (
              <span className="text-ink-faint">Sin deuda</span>
            )}
          </Metrica>

          <Metrica etiqueta="Saldo vencido">
            {esPositivo(cuenta.vencido) ? (
              <Money amount={cuenta.vencido} tone="out" />
            ) : (
              <span className="text-ink-faint">Nada</span>
            )}
          </Metrica>

          <Metrica etiqueta="Próximo vencimiento">
            {cuenta.proximoVencimiento === null ? (
              <span className="text-ink-faint">Sin fecha</span>
            ) : (
              fechaCorta(cuenta.proximoVencimiento)
            )}
          </Metrica>

          <Metrica etiqueta="Última compra">{fechaCorta(cuenta.ultimaCompra)}</Metrica>
          <Metrica etiqueta="Último pago">{fechaCorta(cuenta.ultimoPago)}</Metrica>
          <Metrica etiqueta="Entregas sin saldar">{cuenta.deudasAbiertas}</Metrica>

          {/*
            Los dos numeros de la Fase 4C. El primero NO es lo mismo que un saldo
            negativo: el saldo puede estar en cero y haber igual un anticipo sin
            aplicar, porque la deuda que lo compensa esta en otra entrega.
          */}
          <Metrica
            etiqueta="Pagos sin imputar"
            detalle={
              cuenta.pagosConSaldo === 0
                ? undefined
                : `${String(cuenta.pagosConSaldo)} comprobante(s)`
            }
          >
            {esPositivo(cuenta.sinImputar) ? (
              <Money amount={cuenta.sinImputar} tone="in" />
            ) : (
              <span className="text-ink-faint">Nada</span>
            )}
          </Metrica>

          <Metrica
            etiqueta="Devuelto"
            detalle={
              cuenta.devoluciones === 0
                ? undefined
                : `${String(cuenta.devoluciones)} devolución(es)`
            }
          >
            {esPositivo(cuenta.devuelto) ? (
              <Money amount={cuenta.devuelto} />
            ) : (
              <span className="text-ink-faint">Nada</span>
            )}
          </Metrica>
        </div>

        {aFavor && (
          <Alert tone="info" className="mt-3">
            Tenemos <Money amount={cuenta.balance.replace('-', '')} /> a favor con {cuenta.name}. Se
            va a descontar de la próxima entrega.
          </Alert>
        )}
      </Card>

      {/* ---------------------------------------------------------- deudas */}
      <Card className="p-4">
        <CardHeader
          title="Deudas abiertas"
          description="Por entrega recibida. Una orden con dos entregas son dos obligaciones."
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setSoloAbiertas((v) => !v)
              }}
            >
              {soloAbiertas ? 'Ver todas' : 'Ver solo pendientes'}
            </Button>
          }
        />

        {deudas.length === 0 ? (
          <EmptyState
            className="mt-3"
            title={soloAbiertas ? 'No queda nada pendiente' : 'Todavía no se le recibió nada'}
            description={
              soloAbiertas
                ? 'Todas las entregas registradas están saldadas.'
                : 'La deuda nace al confirmar una recepción, no al crear la orden.'
            }
          />
        ) : (
          <TableWrap className="mt-3">
            <Table>
              <THead>
                <TR>
                  <TH>Documento</TH>
                  <TH>Fecha</TH>
                  <TH>Vencimiento</TH>
                  <TH className="text-right">Importe original</TH>
                  <TH className="text-right">Devuelto</TH>
                  <TH className="text-right">Obligación neta</TH>
                  <TH className="text-right">Pagado</TH>
                  <TH className="text-right">Pendiente</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {deudas.map((d) => (
                  <TR key={d.receiptId}>
                    <TD>
                      <Link
                        href={`/compras/${String(d.orderId)}`}
                        className="font-medium text-ink hover:text-primary"
                        data-numeric=""
                      >
                        {d.orderNumber}
                      </Link>
                      <span className="ml-1 text-xs text-ink-faint" data-numeric="">
                        entrega #{d.receiptId}
                      </span>
                    </TD>
                    <TD className="text-ink-muted" data-numeric="">
                      {fechaCorta(d.receivedAt)}
                    </TD>
                    <TD className="text-ink-muted" data-numeric="">
                      {d.dueDate === null ? (
                        <span className="text-ink-faint">Sin fecha</span>
                      ) : (
                        fechaCorta(d.dueDate)
                      )}
                    </TD>
                    <TD className="text-right">
                      <Money amount={d.total} />
                    </TD>
                    <TD className="text-right">
                      {esPositivo(d.devuelto) ? (
                        <Money amount={d.devuelto} />
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <Money amount={d.neto} />
                    </TD>
                    <TD className="text-right">
                      <Money amount={d.pagado} />
                    </TD>
                    <TD className="text-right">
                      <Money amount={d.pendiente} />
                      {/*
                        El exceso solo aparece devolviendo mercaderia que ya se
                        habia pagado. Va en su propia linea y con su palabra: un
                        pendiente en cero, solo, haria pensar que quedo justa.
                      */}
                      {esPositivo(d.exceso) && (
                        <div className="text-xs text-success">
                          <Money amount={d.exceso} /> a favor
                        </div>
                      )}
                    </TD>
                    <TD>
                      {/* Color Y palabra. Nunca solo el color. */}
                      <Badge tone={TONO_DE_ESTADO[d.estado]}>
                        {etiquetaDeEstadoDeDeuda(d.estado)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* ------------------------------------------------------- anticipos */}
      <AnticiposDeProveedor
        supplierId={supplierId}
        puedeImputar={puedeImputar}
        onImputado={() => {
          void cargar()
        }}
      />

      {/* ----------------------------------------------------- devoluciones */}
      {puedeVerDevoluciones && <DevolucionesDeProveedor supplierId={supplierId} />}

      {/* -------------------------------------------------------- extracto */}
      <Card className="p-4">
        <CardHeader
          title="Movimientos"
          description={totalMov === 0 ? undefined : `${String(totalMov)} en total`}
          actions={
            <Select
              value={tipo}
              aria-label="Filtrar por tipo de movimiento"
              onChange={(e) => {
                setTipo(e.target.value)
                setPaginaMov(1)
              }}
            >
              <option value="todos">Todos los tipos</option>
              {TIPOS_DE_PROVEEDOR.map((t) => (
                <option key={t} value={t}>
                  {etiquetaDeProveedor(t)}
                </option>
              ))}
            </Select>
          }
        />

        {movimientos.length === 0 ? (
          <EmptyState className="mt-3" title="Sin movimientos" />
        ) : (
          <>
            <TableWrap className="mt-3">
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Concepto</TH>
                    <TH>Documento</TH>
                    <TH className="text-right">Importe</TH>
                    <TH className="text-right">Saldo</TH>
                  </TR>
                </THead>
                <TBody>
                  {movimientos.map((m) => (
                    <TR key={m.id}>
                      <TD className="text-ink-muted" data-numeric="">
                        {fechaCorta(m.createdAt)}
                      </TD>
                      <TD>
                        <div className="text-ink">{m.typeLabel}</div>
                        {m.reason !== null && (
                          <div className="text-xs text-ink-faint">{m.reason}</div>
                        )}
                        {m.authorizedBy !== null && (
                          <div className="text-xs text-warning">Autorizó {m.authorizedBy.name}</div>
                        )}
                      </TD>
                      <TD className="text-ink-muted" data-numeric="">
                        {m.paymentNumber ?? m.orderNumber ?? m.reference ?? '—'}
                      </TD>
                      <TD className="text-right">
                        {/*
                          El signo se muestra tal cual sale del libro: positivo
                          aumenta lo que debemos, negativo lo reduce. Mostrar
                          todo en positivo con una flecha obligaria a mirar dos
                          columnas para saber que paso.

                          `signed` hace falta: sin el, `Money` dibuja el valor
                          ABSOLUTO y el unico indicio del signo era el color. Un
                          pago de -$15.000 se leia "$ 15.000,00" en verde, y en
                          blanco y negro no se leia nada. Ver el criterio de
                          WCAG 1.4.1, que este proyecto respeta en todos los
                          estados y se habia salteado en estas dos columnas.
                        */}
                        <Money
                          amount={m.amount}
                          signed
                          tone={esNegativo(m.amount) ? 'in' : 'neutral'}
                        />
                      </TD>
                      <TD className="text-right">
                        {/*
                          El saldo tambien con signo, y es donde mas importa: un
                          saldo de -$5.000 --credito a favor nuestro-- se veia
                          igual que uno de $5.000 de deuda. Con los anticipos de
                          la Fase 4C el saldo negativo pasa de raro a corriente.
                        */}
                        <Money
                          amount={m.resultingBalance}
                          signed
                          tone={esNegativo(m.resultingBalance) ? 'in' : 'neutral'}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <Pagination
              className="mt-3"
              page={paginaMov}
              pageSize={POR_PAGINA}
              total={totalMov}
              totalPages={Math.max(1, Math.ceil(totalMov / POR_PAGINA))}
              onPageChange={setPaginaMov}
            />
          </>
        )}
      </Card>

      <DialogoPagoProveedor
        abierto={pagando}
        cuenta={cuenta}
        puedeSobrepagar={puedeSobrepagar}
        puedeImputarAMano={puedePagar}
        onCerrar={() => {
          setPagando(false)
        }}
        onPagado={() => {
          setPagando(false)
          void cargar()
        }}
      />

      <DialogoAjusteProveedor
        abierto={acreditando || ajustando}
        modo={acreditando ? 'credito' : 'ajuste'}
        cuenta={cuenta}
        onCerrar={() => {
          setAcreditando(false)
          setAjustando(false)
        }}
        onGuardado={() => {
          setAcreditando(false)
          setAjustando(false)
          void cargar()
        }}
      />
    </div>
  )
}
