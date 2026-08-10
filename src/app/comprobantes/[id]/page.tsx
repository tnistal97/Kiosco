'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Card, ErrorState, Money, SkeletonRows } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esNegativo } from '@/lib/money'
import { parseComprobante, type ComprobanteDTO } from '@/modules/clients/dto'

/**
 * Comprobante de pago de cuenta corriente.
 *
 * NO ES UNA FACTURA, y no lo dice en ninguna parte: este sistema todavia no
 * emite nada fiscal. Es el papel que el comercio le da al cliente para que
 * tenga constancia de que pago.
 *
 * La impresion usa el dialogo del navegador --`window.print()`-- y no una
 * biblioteca: cualquier impresora que el local tenga configurada ya funciona,
 * y el formato lo resuelve `@media print` en el estilo de abajo. Es
 * REIMPRIMIBLE a proposito: el papel se pierde, y quien reclama "yo te pague el
 * martes" tiene que poder recibir otra copia identica. Que sea identica esta
 * garantizado por la inmutabilidad de `CustomerPayment`, no por una convencion.
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

/** Una linea del comprobante. */
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

export default function ComprobantePage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [comprobante, setComprobante] = useState<ComprobanteDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setComprobante(await apiRequest(`/api/comprobantes/${id}`, { parse: parseComprobante }))
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
      {/*
        Los controles NO se imprimen: `print:hidden` los saca del papel. Sin
        esto, el comprobante sale con dos botones dibujados encima.
      */}
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/clientes/${String(c.client.id)}`}
          className="text-sm text-ink-muted hover:text-primary"
        >
          ← Volver a {c.client.name}
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

          {/*
            "Comprobante de pago", nunca "factura" ni "recibo oficial": este
            sistema no emite nada fiscal, y llamarlo de otra forma haria que
            alguien lo presente donde no corresponde.
          */}
          <div className="text-center">
            <div className="text-sm font-semibold uppercase tracking-wide text-ink">
              Comprobante de pago
            </div>
            <div className="text-xs text-ink-muted">Documento no fiscal</div>
            <div className="mt-1 text-lg font-semibold text-ink" data-numeric="">
              {c.number}
            </div>
          </div>

          <div className="border-t border-line pt-3 text-sm">
            <Linea label="Fecha">{fechaHora(c.createdAt)}</Linea>
            <Linea label="Cliente">{c.client.name}</Linea>
            {c.client.document !== null && <Linea label="Documento">{c.client.document}</Linea>}
            <Linea label="Medio">{c.methodLabel}</Linea>
            {c.reference !== null && <Linea label="Referencia">{c.reference}</Linea>}
          </div>

          <div className="rounded-lg bg-surface-2 p-3 text-center">
            <div className="text-xs text-ink-muted">Importe recibido</div>
            <div className="text-3xl font-semibold text-ink" data-numeric="">
              <Money amount={c.amount} />
            </div>
          </div>

          {/*
            Los dos saldos. Son lo que convierte el papel en algo util: el
            cliente se lleva escrito de cuanto venia y cuanto le queda, y no
            tiene que confiar en la memoria de nadie.
          */}
          <div className="border-t border-line pt-3 text-sm">
            {c.previousBalance !== null && (
              <Linea label="Saldo anterior">
                <Money amount={c.previousBalance.replace('-', '')} />
                {esNegativo(c.previousBalance) && ' a favor'}
              </Linea>
            )}
            {c.resultingBalance !== null && (
              <Linea label="Saldo nuevo">
                <Money amount={c.resultingBalance.replace('-', '')} />
                {esNegativo(c.resultingBalance) && ' a favor'}
              </Linea>
            )}
          </div>

          {c.notes !== null && (
            <p className="border-t border-line pt-3 text-sm text-ink-muted">{c.notes}</p>
          )}

          <div className="border-t border-line pt-3 text-center text-xs text-ink-muted">
            Atendió {c.receivedBy.name}
          </div>
        </div>
      </Card>
    </div>
  )
}
