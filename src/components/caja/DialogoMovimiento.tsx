'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, RadioGroup, Select, Textarea } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'

/**
 * Movimiento manual de caja.
 *
 * El monto se escribe siempre positivo: el signo lo pone el servidor segun el
 * tipo. Dejar escribir "-5000" permitiria registrar un "ingreso de -5000",
 * que en el listado se lee como un ingreso y en el saldo resta.
 *
 * Retiro y deposito solo existen en efectivo, porque mueven el dinero fisico
 * del cajon. Lo hace cumplir el servidor; aca el selector simplemente refleja
 * esa regla en vez de dejar elegir algo que va a fallar.
 */
type Tipo = 'ingreso' | 'retiro' | 'deposito'

const TIPOS = [
  { value: 'ingreso' as const, label: 'Ingreso', description: 'Entra plata' },
  { value: 'retiro' as const, label: 'Retiro', description: 'Sale del cajón' },
  { value: 'deposito' as const, label: 'Depósito', description: 'Va al banco' },
]

export function DialogoMovimiento({
  abierto,
  onCerrar,
  onHecho,
}: {
  abierto: boolean
  onCerrar: () => void
  onHecho: () => void
}) {
  const [tipo, setTipo] = useState<Tipo>('ingreso')
  const [monto, setMonto] = useState('')
  const [medio, setMedio] = useState('efectivo')
  const [detalle, setDetalle] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setTipo('ingreso')
    setMonto('')
    setMedio('efectivo')
    setDetalle('')
    setError(null)
    setEnviando(false)
  }, [abierto])

  // Cambiar a retiro o deposito fuerza efectivo: es la regla del servidor.
  useEffect(() => {
    if (tipo !== 'ingreso') setMedio('efectivo')
  }, [tipo])

  const importe = Number(monto.replace(',', '.'))
  const valido = Number.isFinite(importe) && importe > 0

  async function guardar() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest('/api/cash', {
        method: 'POST',
        body: {
          amount: importe,
          paymentMethod: medio,
          description: detalle.trim() === '' ? undefined : detalle.trim(),
          movementType: tipo,
        },
        parse: () => null,
      })
      onHecho()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar el movimiento.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Nuevo movimiento de caja"
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
            Registrar
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

        <RadioGroup
          legend="Tipo"
          name="tipo-movimiento"
          value={tipo}
          onChange={setTipo}
          options={TIPOS}
          columns={3}
        />

        <Field label="Monto" required hint="Siempre en positivo. El signo lo pone el sistema.">
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={monto}
            disabled={enviando}
            onChange={(e) => {
              setMonto(e.target.value)
            }}
          />
        </Field>

        <Field
          label="Medio"
          hint={
            tipo !== 'ingreso' ? 'Un retiro o un depósito mueve efectivo del cajón.' : undefined
          }
        >
          <Select
            value={medio}
            disabled={enviando || tipo !== 'ingreso'}
            onChange={(e) => {
              setMedio(e.target.value)
            }}
          >
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="mercado_pago">Mercado Pago</option>
          </Select>
        </Field>

        <Field label="Detalle" hint="Para qué fue. Queda en la bitácora.">
          <Textarea
            value={detalle}
            disabled={enviando}
            onChange={(e) => {
              setDetalle(e.target.value)
            }}
          />
        </Field>
      </div>
    </Dialog>
  )
}
