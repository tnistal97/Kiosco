'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, Money, Textarea } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esCero, esNegativo, montoDesdeTexto, restarMontos, type Monto } from '@/lib/money'
import { tonoPorSigno } from '@/components/ui'

/**
 * Arqueo: cuanto hay fisicamente en el cajon.
 *
 * Muestra el saldo esperado ANTES de contar, y la diferencia mientras se
 * escribe. La pantalla anterior pedia un numero a ciegas y no comparaba con
 * nada, asi que un faltante no se detectaba nunca.
 *
 * Ver el esperado no invalida el arqueo: quien cuenta el cajon ya tiene el
 * dinero en la mano. Lo que se gana es que el faltante se vea en el momento y
 * no dos dias despues.
 */
export function DialogoArqueo({
  abierto,
  onCerrar,
  onHecho,
  esperado,
}: {
  abierto: boolean
  onCerrar: () => void
  onHecho: () => void
  esperado: Monto
}) {
  const [contado, setContado] = useState('')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setContado('')
    setNotas('')
    setError(null)
    setEnviando(false)
  }, [abierto])

  // Lo que se tipea se lee como importe exacto, no como `Number`: con
  // "1234,56" el camino viejo daba 1234.56 en punto flotante y la diferencia
  // contra el esperado podia salir por un centavo.
  const importe = useMemo(() => montoDesdeTexto(contado), [contado])

  const diferencia = importe === null ? null : restarMontos(importe, esperado)
  const valido = importe !== null && !esNegativo(importe)

  async function guardar() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest('/api/cash/count', {
        method: 'POST',
        // La diferencia NO se manda: la calcula el servidor. Si la mandara el
        // cliente, se podria declarar un arqueo cuadrado sobre una caja que
        // no lo esta, que es justo lo que un arqueo tiene que detectar.
        body: { amount: importe, notes: notas.trim() === '' ? undefined : notas.trim() },
        parse: () => null,
      })
      onHecho()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar el arqueo.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Arqueo de caja"
      description="Contá el efectivo del cajón y anotá cuánto hay."
      size="md"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={!valido}
            onClick={() => void guardar()}
          >
            Registrar arqueo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="No se registró">
            {error}
          </Alert>
        )}

        <div className="flex items-baseline justify-between rounded-lg border border-line bg-sunken px-4 py-3">
          <span className="text-sm text-ink-muted">El sistema espera</span>
          <Money amount={esperado} size="lg" />
        </div>

        <Field label="Efectivo contado" required>
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={contado}
            disabled={enviando}
            onChange={(e) => {
              setContado(e.target.value)
            }}
          />
        </Field>

        {diferencia !== null && contado.trim() !== '' && (
          <Alert
            tone={esCero(diferencia) ? 'success' : esNegativo(diferencia) ? 'danger' : 'warning'}
            title={
              esCero(diferencia) ? 'Cuadra' : esNegativo(diferencia) ? 'Falta plata' : 'Sobra plata'
            }
          >
            <span className="flex items-center gap-2">
              Diferencia:
              <Money amount={diferencia} signed size="sm" tone={tonoPorSigno(diferencia)} />
            </span>
          </Alert>
        )}

        <Field label="Observaciones" hint="Qué explica la diferencia, si la hay.">
          <Textarea
            value={notas}
            disabled={enviando}
            onChange={(e) => {
              setNotas(e.target.value)
            }}
          />
        </Field>
      </div>
    </Dialog>
  )
}
