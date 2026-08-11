'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Card, ErrorState, Money, SkeletonRows } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esNegativo, esPositivo } from '@/lib/money'
import { parseComprobanteDePago, type ComprobanteDePagoDTO } from '@/modules/suppliers/dto.cuenta'

/**
 * Comprobante de pago a proveedor.
 *
 * NO ES UNA FACTURA, y no lo dice en ninguna parte: este sistema todavia no
 * emite nada fiscal. Es el papel que queda archivado junto a la factura del
 * proveedor y el que se le manda cuando pregunta si se le pago.
 *
 * REIMPRIMIBLE a proposito, y que sea IDENTICO esta garantizado por la
 * inmutabilidad de `SupplierPayment` --un disparador en PostgreSQL-- y no por
 * una convencion.
 *
 * Lo que este comprobante tiene y el del cliente no: LAS OBLIGACIONES
 * CANCELADAS. Es lo que convierte "te pagamos $50.000" en "te pagamos la
 * entrega del 12 y parte de la del 14", que es exactamente lo que se discute
 * por telefono. Ver docs/SUPPLIER_PAYMENT_FLOW.md.
 */

function fechaHora(iso: string): string {
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

function Linea({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right font-medium text-ink" data-numeric="">
        {children}
      </span>
    </div>
  )
}

export default function ComprobanteDeProveedorPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [comprobante, setComprobante] = useState<ComprobanteDePagoDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setComprobante(
        await apiRequest(`/api/suppliers/pagos/${id}`, { parse: parseComprobanteDePago }),
      )
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar el comprobante.'))
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (cargando) return <SkeletonRows rows={6} />
  if (error !== null) return <ErrorState description={error} onRetry={() => void cargar()} />
  if (!comprobante) return null

  const c = comprobante

  return (
    <div className="flex flex-col gap-5">
      {/* Los controles NO se imprimen: sin esto el papel sale con dos botones. */}
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/proveedores/${String(c.supplier.id)}`}
          className="text-sm text-ink-muted hover:text-primary"
        >
          ← Volver a {c.supplier.name}
        </Link>
        <Button
          variant="primary"
          onClick={() => {
            window.print()
          }}
        >
          Imprimir
        </Button>
      </header>

      <Card className="mx-auto w-full max-w-md p-6 print:border-0 print:shadow-none">
        <div className="flex flex-col gap-4">
          {/* Comercio */}
          <div className="border-b border-line pb-3 text-center">
            <div className="text-lg font-semibold text-ink">{c.branch.name}</div>
            {c.branch.address !== null && (
              <div className="text-xs text-ink-muted">{c.branch.address}</div>
            )}
            {c.branch.phone !== null && (
              <div className="text-xs text-ink-muted" data-numeric="">
                {c.branch.phone}
              </div>
            )}
          </div>

          <div className="text-center">
            <div className="text-sm font-semibold uppercase tracking-wide text-ink">
              Comprobante de pago a proveedor
            </div>
            <div className="text-xs text-ink-muted">Documento no fiscal</div>
            <div className="mt-1 text-lg font-semibold text-ink" data-numeric="">
              {c.number}
            </div>
          </div>

          <div className="border-t border-line pt-3 text-sm">
            <Linea label="Fecha">{fechaHora(c.paidAt)}</Linea>
            <Linea label="Proveedor">{c.supplier.name}</Linea>
            {c.supplier.taxId !== null && <Linea label="CUIT">{c.supplier.taxId}</Linea>}
            <Linea label="Medio">{c.methodLabel}</Linea>
            {c.reference !== null && <Linea label="Referencia">{c.reference}</Linea>}
          </div>

          <div className="rounded-lg bg-surface-2 p-3 text-center">
            <div className="text-xs text-ink-muted">Importe entregado</div>
            <div className="text-3xl font-semibold text-ink" data-numeric="">
              <Money amount={c.amount} />
            </div>
          </div>

          {/*
            Las obligaciones canceladas. Es la mitad del valor de este papel:
            sin esto dice cuanto se pago y no contra que, que es justamente lo
            que el proveedor va a preguntar.
          */}
          {c.imputaciones.length > 0 && (
            <div className="border-t border-line pt-3 text-sm">
              <div className="mb-1 text-xs uppercase tracking-wide text-ink-faint">
                Obligaciones canceladas
              </div>
              {c.imputaciones.map((i) => (
                <Linea
                  key={i.receiptId}
                  label={`${i.orderNumber} · entrega #${String(i.receiptId)}`}
                >
                  <Money amount={i.amount} />
                </Linea>
              ))}
              {esPositivo(c.sinImputar) && (
                <Linea label="Sin imputar">
                  <Money amount={c.sinImputar} />
                </Linea>
              )}
            </div>
          )}

          {/*
            Los dos saldos. Es lo que convierte el papel en algo util: queda
            escrito de cuanto se venia y cuanto queda, y nadie tiene que
            confiar en la memoria del otro.
          */}
          <div className="border-t border-line pt-3 text-sm">
            <Linea label="Saldo anterior">
              <Money amount={c.previousBalance.replace('-', '')} />
              {esNegativo(c.previousBalance) && ' a favor nuestro'}
            </Linea>
            <Linea label="Saldo nuevo">
              <Money amount={c.resultingBalance.replace('-', '')} />
              {esNegativo(c.resultingBalance) && ' a favor nuestro'}
            </Linea>
          </div>

          {c.notes !== null && (
            <p className="border-t border-line pt-3 text-sm text-ink-muted">{c.notes}</p>
          )}

          <div className="border-t border-line pt-3 text-center text-xs text-ink-muted">
            Registró {c.paidBy.name}
            {!c.salioDeCaja && ' · no salió de la caja'}
          </div>
        </div>
      </Card>
    </div>
  )
}
