'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, Money, Select, aviso } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esNegativo, esPositivo, restarMontos, sumarMontos } from '@/lib/money'
import type { ClienteDTO } from '@/modules/clients/dto'

/**
 * Ajuste manual de cuenta.
 *
 * Se declara el DELTA y no el saldo final, y la pantalla lo refuerza: pide
 * "cuánto" y "en qué dirección" por separado, y muestra a cuánto va a quedar.
 * "Poneme el saldo en 7.000" no dice de dónde salieron los 2.000; "sumale
 * 2.000 por deuda anterior a la migración" deja un movimiento que se entiende
 * dentro de dos años.
 *
 * El motivo es obligatorio en los tres lugares: acá, en el servicio y en una
 * restricción CHECK de la base.
 */
export function DialogoAjusteCuenta({
  abierto,
  cliente,
  onCerrar,
  onAjustado,
}: {
  abierto: boolean
  cliente: ClienteDTO
  onCerrar: () => void
  onAjustado: () => void
}) {
  const [importe, setImporte] = useState('')
  const [direccion, setDireccion] = useState<'sube' | 'baja'>('sube')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setImporte('')
    setDireccion('sube')
    setMotivo('')
    setError(null)
    setEnviando(false)
  }, [abierto])

  const importeOk = /^\d+(\.\d{1,2})?$/.test(importe.trim()) && Number(importe) > 0
  const motivoOk = motivo.trim().length > 0
  const valido = importeOk && motivoOk

  const resultante = importeOk
    ? direccion === 'sube'
      ? sumarMontos(cliente.balance, importe)
      : restarMontos(cliente.balance, importe)
    : cliente.balance

  async function ajustar() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest(`/api/clients/${String(cliente.id)}/ajuste`, {
        method: 'POST',
        body: {
          // El signo lo arma la pantalla a partir de la direccion elegida, no
          // se le pide a nadie que tipee un menos: un "-2000" mal copiado es un
          // ajuste al reves.
          delta: direccion === 'sube' ? importe.trim() : `-${importe.trim()}`,
          reason: motivo.trim(),
        },
        parse: () => null,
      })
      aviso.ok('Cuenta ajustada')
      onAjustado()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo ajustar la cuenta.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={`Ajustar la cuenta de ${cliente.name}`}
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
            onClick={() => void ajustar()}
          >
            Registrar ajuste
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="No se ajustó">
            {error}
          </Alert>
        )}

        <Alert tone="warning" title="Esto no es un cobro">
          Un ajuste escribe un movimiento que no responde a ninguna venta ni a ningún pago. Queda
          registrado con tu nombre y con el motivo. Para registrar plata que entró, usá
          <strong> Registrar pago</strong>.
        </Alert>

        <Field label="En qué dirección">
          <Select
            value={direccion}
            disabled={enviando}
            onChange={(e) => {
              setDireccion(e.target.value === 'baja' ? 'baja' : 'sube')
            }}
          >
            <option value="sube">Aumentar lo que debe</option>
            <option value="baja">Reducir lo que debe</option>
          </Select>
        </Field>

        <Field
          label="Cuánto"
          required
          error={importe !== '' && !importeOk ? 'Un importe mayor que cero' : null}
        >
          <Input
            value={importe}
            disabled={enviando}
            autoFocus
            inputMode="decimal"
            onChange={(e) => {
              setImporte(e.target.value)
            }}
          />
        </Field>

        <Field
          label="Motivo"
          required
          hint="“Deuda anterior a la migración”, “se cargó dos veces la venta #182”"
          error={motivo !== '' && !motivoOk ? 'El motivo es obligatorio' : null}
        >
          <Input
            value={motivo}
            disabled={enviando}
            onChange={(e) => {
              setMotivo(e.target.value)
            }}
          />
        </Field>

        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Saldo actual</span>
            <span data-numeric="">
              <Money amount={cliente.balance.replace('-', '')} />
              {esNegativo(cliente.balance) && ' a favor'}
            </span>
          </div>
          <div className="mt-1 flex justify-between font-medium">
            <span className="text-ink-muted">Va a quedar en</span>
            <span
              data-numeric=""
              className={esPositivo(resultante) ? 'text-danger' : 'text-success'}
            >
              <Money amount={resultante.replace('-', '')} />
              {esNegativo(resultante) && ' a favor'}
            </span>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
