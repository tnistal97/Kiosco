'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
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
import { DialogoRecepcion } from '@/components/compras/DialogoRecepcion'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parseDetalleOrden, type DetalleOrdenDTO } from '@/modules/purchases/dto'
import { TONO_DE_ESTADO } from '@/modules/purchases/status'
import { NOMBRE_DE_UNIDAD_DE_COMPRA, formatearCantidadConUnidad } from '@/modules/products/units'

function cuando(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{etiqueta}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  )
}

export default function CompraPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = Number(params.id)

  const puedeRecibir = usePermiso('purchases.receive')
  const puedeActualizar = usePermiso('purchases.update')
  const puedeCancelar = usePermiso('purchases.cancel')

  const [orden, setOrden] = useState<DetalleOrdenDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recibiendo, setRecibiendo] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enCurso, setEnCurso] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setOrden(await apiRequest(`/api/purchases/${String(id)}`, { parse: parseDetalleOrden }))
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar la orden.'))
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function confirmar() {
    setEnCurso(true)
    try {
      await apiRequest(`/api/purchases/${String(id)}/confirm`, {
        method: 'POST',
        parse: () => null,
      })
      aviso.ok('Orden confirmada')
      await cargar()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo confirmar.'))
    } finally {
      setEnCurso(false)
    }
  }

  async function cancelar() {
    try {
      await apiRequest(`/api/purchases/${String(id)}/cancel`, {
        method: 'POST',
        body: { reason: motivo.trim() },
        parse: () => null,
      })
      aviso.ok('Orden cancelada')
      setCancelando(false)
      setMotivo('')
      await cargar()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo cancelar.'))
      setCancelando(false)
    }
  }

  async function eliminar() {
    try {
      await apiRequest(`/api/purchases/${String(id)}`, { method: 'DELETE', parse: () => null })
      aviso.ok('Borrador eliminado')
      router.push('/compras')
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo eliminar.'))
    }
  }

  if (cargando) return <SkeletonRows rows={6} />
  if (error !== null) return <ErrorState description={error} onRetry={() => void cargar()} />
  if (!orden) return null

  const conCostos = orden.expectedTotal !== undefined

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/compras" className="text-sm text-ink-muted hover:text-ink">
            ← Compras
          </Link>
          {/* `h2`: el `h1` de la pagina lo pone la cabecera de la aplicacion. */}
          <h2
            className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-ink"
            data-numeric=""
          >
            {orden.number}
            <Badge tone={TONO_DE_ESTADO[orden.status]}>{orden.statusLabel}</Badge>
          </h2>
        </div>

        <div className="flex flex-wrap gap-2">
          {orden.puedeConfirmar && puedeActualizar && (
            <Button variant="primary" loading={enCurso} onClick={() => void confirmar()}>
              Confirmar orden
            </Button>
          )}
          {orden.puedeRecibir && puedeRecibir && (
            <Button
              variant="primary"
              onClick={() => {
                setRecibiendo(true)
              }}
            >
              Recibir mercadería
            </Button>
          )}
          {orden.puedeCancelar && puedeCancelar && (
            <Button
              variant="secondary"
              onClick={() => {
                setCancelando(true)
              }}
            >
              Cancelar
            </Button>
          )}
          {orden.puedeEditar && puedeActualizar && (
            <Button variant="secondary" onClick={() => void eliminar()}>
              Eliminar borrador
            </Button>
          )}
        </div>
      </header>

      {orden.status === 'CANCELLED' && (
        <Alert tone="warning" title="Orden cancelada">
          {orden.cancelReason ?? 'Sin motivo declarado.'}
          {orden.cancelledBy !== null && ` — ${orden.cancelledBy.name}`}
          {orden.receipts.length > 0 && (
            <p className="mt-2">
              Lo que ya se había recibido no se revirtió: la mercadería está en el depósito y el
              stock la refleja.
            </p>
          )}
        </Alert>
      )}

      <Card className="p-4">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Dato etiqueta="Proveedor">
            <Link href={`/proveedores/${String(orden.supplier.id)}`} className="hover:text-primary">
              {orden.supplier.name}
            </Link>
          </Dato>
          <Dato etiqueta="Creada">
            <span data-numeric="">{cuando(orden.createdAt)}</span>
          </Dato>
          <Dato etiqueta="Pedida">
            <span data-numeric="">
              {orden.orderedAt === null ? 'Todavía no' : cuando(orden.orderedAt)}
            </span>
          </Dato>
          <Dato etiqueta="Cargó">{orden.createdBy.name}</Dato>
        </dl>
        {orden.notes !== null && (
          <p className="mt-4 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-muted">
            {orden.notes}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <CardHeader
          title="Productos"
          description={`${String(orden.lineasCompletas)} de ${String(orden.lineas)} líneas completas`}
        />

        {orden.items.length === 0 ? (
          <EmptyState title="Esta orden no tiene productos" />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Producto</TH>
                  <TH className="text-right">Pedido</TH>
                  <TH className="text-right">Recibido</TH>
                  <TH className="text-right">Pendiente</TH>
                  {conCostos && <TH className="text-right">Costo</TH>}
                  {conCostos && <TH className="text-right">Subtotal</TH>}
                </TR>
              </THead>
              <TBody>
                {orden.items.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <div className="text-ink">{i.product.name}</div>
                      <div className="text-xs text-ink-faint" data-numeric="">
                        {NOMBRE_DE_UNIDAD_DE_COMPRA[i.purchaseUnit]} de{' '}
                        {formatearCantidadConUnidad(i.unitsPerPurchaseUnit, i.product.saleUnit)}
                      </div>
                    </TD>
                    <TD className="text-right" data-numeric="">
                      {i.orderedQuantity}
                    </TD>
                    <TD className="text-right" data-numeric="">
                      {i.receivedQuantity}
                    </TD>
                    <TD className="text-right" data-numeric="">
                      {i.pendingQuantity === '0.000' ? (
                        <Badge tone="success">Completa</Badge>
                      ) : (
                        <span className="text-warning">{i.pendingQuantity}</span>
                      )}
                    </TD>
                    {conCostos && (
                      <TD className="text-right">
                        {i.unitCost === undefined || i.unitCost === null ? (
                          '—'
                        ) : (
                          <Money amount={i.unitCost} />
                        )}
                      </TD>
                    )}
                    {conCostos && (
                      <TD className="text-right">
                        {i.subtotal === undefined || i.subtotal === null ? (
                          '—'
                        ) : (
                          <Money amount={i.subtotal} />
                        )}
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}

        {conCostos && orden.expectedTotal !== undefined && orden.expectedTotal !== null && (
          <div className="mt-4 flex items-baseline justify-between rounded-lg border border-line bg-sunken px-4 py-3">
            <span className="text-sm text-ink-muted">Total pedido</span>
            <Money amount={orden.expectedTotal} size="lg" />
          </div>
        )}
      </Card>

      <Card className="p-4">
        <CardHeader
          title="Recepciones"
          description={
            orden.receipts.length === 0
              ? 'Todavía no llegó nada.'
              : `${String(orden.receipts.length)} entrega(s)`
          }
        />

        {orden.receipts.length === 0 ? (
          <EmptyState
            title="Sin entregas"
            description="Cuando llegue mercadería, cada entrega queda registrada acá con su fecha, quién la recibió y a qué costo."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {orden.receipts.map((r, i) => (
              <div key={r.id} className="rounded-lg border border-line bg-sunken p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    Recepción #{i + 1}{' '}
                    <span className="font-normal text-ink-muted" data-numeric="">
                      · {cuando(r.receivedAt)}
                    </span>
                  </h3>
                  <span className="text-xs text-ink-faint">Recibió {r.receivedBy.name}</span>
                </div>

                {r.notes !== null && <p className="mt-1 text-xs text-ink-muted">{r.notes}</p>}

                <TableWrap className="mt-3">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Producto</TH>
                        <TH className="text-right">Llegó</TH>
                        <TH className="text-right">Entró al stock</TH>
                        {conCostos && <TH className="text-right">Esperado</TH>}
                        {conCostos && <TH className="text-right">Facturado</TH>}
                        {conCostos && <TH className="text-right">Diferencia</TH>}
                      </TR>
                    </THead>
                    <TBody>
                      {r.items.map((li) => (
                        <TR key={li.id}>
                          <TD className="text-ink">{li.product.name}</TD>
                          <TD className="text-right" data-numeric="">
                            {li.receivedQuantity}{' '}
                            {NOMBRE_DE_UNIDAD_DE_COMPRA[li.purchaseUnit].toLowerCase()}
                          </TD>
                          <TD className="text-right font-medium text-ink" data-numeric="">
                            +{formatearCantidadConUnidad(li.stockQuantity, li.product.saleUnit)}
                          </TD>
                          {conCostos && (
                            <TD className="text-right text-ink-muted">
                              {li.expectedUnitCost === undefined || li.expectedUnitCost === null ? (
                                '—'
                              ) : (
                                <Money amount={li.expectedUnitCost} />
                              )}
                            </TD>
                          )}
                          {conCostos && (
                            <TD className="text-right">
                              {li.unitCost === undefined || li.unitCost === null ? (
                                '—'
                              ) : (
                                <Money amount={li.unitCost} />
                              )}
                            </TD>
                          )}
                          {conCostos && (
                            <TD className="text-right">
                              {/*
                                La diferencia se muestra, no se esconde. Es la
                                unica pista de que el proveedor aumento, y
                                modificar la orden al recibir la haria
                                desaparecer. Ver docs/PURCHASE_RECEIVING.md.
                              */}
                              {li.diferencia === undefined ? (
                                '—'
                              ) : li.diferencia.hayDiferencia ? (
                                <span className="text-warning" data-numeric="">
                                  {/*
                                    `out` cuando nos cobraron de mas y `in`
                                    cuando de menos: es el mismo codigo de
                                    color que usa la caja, y quien lo lee ya
                                    sabe que rojo es plata que se va.
                                  */}
                                  <Money
                                    amount={li.diferencia.diferencia}
                                    signed
                                    tone={li.diferencia.diferencia.startsWith('-') ? 'in' : 'out'}
                                  />
                                  {li.diferencia.porcentaje !== null && (
                                    <span className="ml-1 text-xs">
                                      ({li.diferencia.porcentaje} %)
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-ink-faint">Sin diferencia</span>
                              )}
                            </TD>
                          )}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
            ))}
          </div>
        )}
      </Card>

      <DialogoRecepcion
        orden={orden}
        abierto={recibiendo}
        onCerrar={() => {
          setRecibiendo(false)
        }}
        onRecibido={() => {
          setRecibiendo(false)
          void cargar()
        }}
      />

      <ConfirmationDialog
        open={cancelando}
        onClose={() => {
          setCancelando(false)
        }}
        onConfirm={() => void cancelar()}
        title={`¿Cancelar ${orden.number}?`}
        confirmLabel="Cancelar orden"
        message={
          orden.receipts.length > 0
            ? 'Lo que ya llegó NO se revierte: la mercadería está en el depósito. Cancelar significa que el resto no va a llegar.'
            : 'La orden queda registrada como cancelada. No se borra.'
        }
      >
        <Field label="Motivo" required hint="Queda en la orden y en la bitácora.">
          <Input
            value={motivo}
            placeholder="El proveedor avisa que no lo consigue"
            onChange={(e) => {
              setMotivo(e.target.value)
            }}
          />
        </Field>
      </ConfirmationDialog>
    </div>
  )
}
