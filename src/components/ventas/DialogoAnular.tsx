'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Money, Textarea } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import type { VentaDTO } from '@/modules/sales/dto'

/** Minimo del motivo. Un "x" no explica nada dentro de seis meses. */
const MOTIVO_MINIMO = 5

/**
 * Anulacion de una venta.
 *
 * Explica el efecto ANTES de confirmar, porque una anulacion mueve stock y
 * dinero a la vez y no se deshace.
 *
 * El motivo es obligatorio: sin el, dentro de un mes no hay forma de
 * distinguir un error de tipeo de un vaciamiento deliberado de la caja.
 *
 * Contra el doble clic: el boton se bloquea al enviar y el dialogo no se
 * puede cerrar mientras la peticion esta en vuelo.
 */
export function DialogoAnular({
  venta,
  onCerrar,
  onAnulada,
}: {
  venta: VentaDTO | null
  onCerrar: () => void
  onAnulada: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!venta) return
    setMotivo('')
    setError(null)
    setEnviando(false)
  }, [venta])

  const valido = motivo.trim().length >= MOTIVO_MINIMO

  async function anular() {
    if (!venta || enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest(`/api/sales/${venta.id}/cancel`, {
        method: 'POST',
        body: { reason: motivo.trim() },
        parse: () => null,
      })
      onAnulada()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo anular la venta.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={venta !== null}
      onClose={onCerrar}
      title={venta ? `Anular la venta #${venta.id}` : 'Anular'}
      size="md"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            No anular
          </Button>
          <Button
            variant="danger"
            loading={enviando}
            disabled={!valido}
            onClick={() => void anular()}
          >
            Anular la venta
          </Button>
        </>
      }
    >
      {venta && (
        <div className="flex flex-col gap-4">
          {error && (
            <Alert tone="danger" title="No se anuló">
              {error}
            </Alert>
          )}

          <Alert tone="warning" title="Qué va a pasar">
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
              <li>La venta queda marcada como anulada. No se borra.</li>
              <li>Vuelve el stock de los {venta.items.length} productos.</li>
              <li>Se registra un contramovimiento en la caja.</li>
              <li>Deja de contar en la recaudación.</li>
            </ul>
          </Alert>

          <div className="rounded-lg border border-line bg-sunken px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-muted">Total de la venta</span>
              <Money amount={venta.total} size="lg" />
            </div>
          </div>

          <Field
            label="Motivo"
            required
            hint="Queda en la bitácora, con tu nombre y la fecha."
            error={motivo.length > 0 && !valido ? 'Escribí al menos unas palabras.' : null}
          >
            <Textarea
              value={motivo}
              disabled={enviando}
              placeholder="Ej: el cliente devolvió la mercadería sin abrir"
              onChange={(e) => {
                setMotivo(e.target.value)
              }}
            />
          </Field>
        </div>
      )}
    </Dialog>
  )
}
