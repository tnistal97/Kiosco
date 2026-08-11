'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmationDialog,
  ErrorState,
  Field,
  Money,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  Textarea,
  aviso,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { NOMBRE_DE_UNIDAD_DE_COMPRA, unidadDeCompraODefecto } from '@/modules/products/units'
import {
  parseDevolucionDetallada,
  type DevolucionDetalladaDTO,
} from '@/modules/purchases/dto.returns'
import { TONO_DE_DEVOLUCION } from '@/modules/purchases/return-status'

function limpia(c: string): string {
  return c.includes('.') ? c.replace(/0+$/, '').replace(/\.$/, '') : c
}

function fechaLarga(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * El detalle de una devolución, y el botón que la hace real.
 *
 * CONFIRMAR ES UN CAMINO DE IDA y la pantalla lo dice antes, no después: saca la
 * mercadería del depósito y genera un crédito con el proveedor. Después la
 * devolución es inmutable; si el proveedor la devuelve, eso es una entrega
 * nueva, no un botón que borra ésta.
 */
export default function DevolucionPage() {
  const params = useParams<{ id: string }>()
  const id = Number(params.id)

  const puedeConfirmar = usePermiso('purchaseReturns.confirm')
  const puedeCrear = usePermiso('purchaseReturns.create')

  const [devolucion, setDevolucion] = useState<DevolucionDetalladaDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const [motivoCancelacion, setMotivoCancelacion] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setDevolucion(
        await apiRequest(`/api/devoluciones/${String(id)}`, { parse: parseDevolucionDetallada }),
      )
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar la devolución.'))
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function confirmar() {
    if (enviando) return
    setEnviando(true)
    try {
      await apiRequest(`/api/devoluciones/${String(id)}/confirmar`, {
        method: 'POST',
        parse: () => null,
      })
      aviso.ok('Devolución confirmada')
      setConfirmando(false)
      await cargar()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo confirmar.'))
    } finally {
      setEnviando(false)
    }
  }

  async function cancelar() {
    if (enviando || motivoCancelacion.trim() === '') return
    setEnviando(true)
    try {
      await apiRequest(`/api/devoluciones/${String(id)}/cancelar`, {
        method: 'POST',
        body: { reason: motivoCancelacion.trim() },
        parse: () => null,
      })
      aviso.ok('Borrador descartado')
      setCancelando(false)
      setMotivoCancelacion('')
      await cargar()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo cancelar.'))
    } finally {
      setEnviando(false)
    }
  }

  if (cargando && devolucion === null) return <SkeletonRows rows={6} />
  if (error !== null) return <ErrorState description={error} onRetry={() => void cargar()} />
  if (devolucion === null) return null

  const d = devolucion

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4">
        <CardHeader
          title={d.number}
          description={`${d.supplier.name} · entrega de ${d.orderNumber}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* Color Y palabra. Nunca solo el color. */}
              <Badge tone={TONO_DE_DEVOLUCION[d.status]}>{d.statusLabel}</Badge>
              {d.puede.cancelar && puedeCrear && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCancelando(true)
                  }}
                >
                  Descartar
                </Button>
              )}
              {d.puede.confirmar && puedeConfirmar && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setConfirmando(true)
                  }}
                >
                  Confirmar devolución
                </Button>
              )}
            </div>
          }
        />

        {d.status === 'DRAFT' && (
          <Alert tone="warning" className="mt-3">
            Todavía es un <strong>borrador</strong>. La mercadería sigue en el depósito y el
            proveedor no recibió ningún crédito.
          </Alert>
        )}

        {d.status === 'CONFIRMED' && (
          <Alert tone="success" className="mt-3">
            Confirmada el {fechaLarga(d.confirmedAt)}
            {d.confirmedBy === null ? '' : ` por ${d.confirmedBy.name}`}. La mercadería salió del
            depósito y se acreditaron <Money amount={d.total} /> con {d.supplier.name}.
          </Alert>
        )}

        {d.status === 'CANCELLED' && (
          <Alert tone="info" className="mt-3">
            Descartada el {fechaLarga(d.cancelledAt)}. Nunca movió nada.
            {d.cancelReason === null ? '' : ` Motivo: ${d.cancelReason}`}
          </Alert>
        )}

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-faint">Motivo</dt>
            <dd className="text-sm text-ink">{d.reasonLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Creada</dt>
            <dd className="text-sm text-ink" data-numeric="">
              {fechaLarga(d.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">La armó</dt>
            <dd className="text-sm text-ink">{d.createdBy.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Entrega</dt>
            <dd className="text-sm">
              <Link
                href={`/compras/recepcion/${String(d.receiptId)}`}
                className="text-ink hover:text-primary"
                data-numeric=""
              >
                #{d.receiptId}
              </Link>
            </dd>
          </div>
        </dl>

        {d.notes !== null && d.notes !== '' && (
          <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-ink-muted">{d.notes}</p>
        )}
      </Card>

      <Card className="p-4">
        <CardHeader
          title="Renglones"
          description="Al costo con el que entró cada producto, no al de hoy"
        />

        <TableWrap className="mt-3">
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH className="text-right">Cantidad</TH>
                <TH className="text-right">Sale del depósito</TH>
                <TH className="text-right">Costo original</TH>
                <TH className="text-right">Crédito</TH>
              </TR>
            </THead>
            <TBody>
              {d.lineas.map((l) => (
                <TR key={l.productId}>
                  <TD>
                    <Link
                      href={`/productos/${String(l.productId)}`}
                      className="text-ink hover:text-primary"
                    >
                      {l.productName}
                    </Link>
                  </TD>
                  <TD className="text-right" data-numeric="">
                    {limpia(l.quantity)}{' '}
                    <span className="text-xs text-ink-faint">
                      {NOMBRE_DE_UNIDAD_DE_COMPRA[unidadDeCompraODefecto(l.purchaseUnit)]}
                    </span>
                  </TD>
                  <TD className="text-right" data-numeric="">
                    {limpia(l.stockQuantity)}
                  </TD>
                  <TD className="text-right">
                    <Money amount={Number(l.unitCost).toFixed(2)} />
                  </TD>
                  <TD className="text-right">
                    <Money amount={l.amount} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>

        <div className="mt-3 flex justify-between rounded-lg bg-surface-2 p-3">
          <span className="text-ink-muted">Crédito total</span>
          <span className="text-lg font-semibold text-ink" data-numeric="">
            <Money amount={d.total} />
          </span>
        </div>
      </Card>

      <ConfirmationDialog
        open={confirmando}
        title={`Confirmar ${d.number}`}
        confirmLabel="Confirmar devolución"
        variant="primary"
        message={
          <>
            La mercadería sale del depósito y {d.supplier.name} nos acredita{' '}
            <Money amount={d.total} />. Después de esto la devolución no se puede editar ni
            cancelar.
          </>
        }
        onClose={() => {
          setConfirmando(false)
        }}
        onConfirm={() => confirmar()}
      />

      <ConfirmationDialog
        open={cancelando}
        title={`Descartar ${d.number}`}
        confirmLabel="Descartar"
        message="Nunca movió nada, así que no hay que revertir stock ni saldo."
        onClose={() => {
          setCancelando(false)
        }}
        onConfirm={() => cancelar()}
      >
        <Field label="Motivo" required>
          <Textarea
            value={motivoCancelacion}
            rows={2}
            onChange={(e) => {
              setMotivoCancelacion(e.target.value)
            }}
          />
        </Field>
      </ConfirmationDialog>
    </div>
  )
}
