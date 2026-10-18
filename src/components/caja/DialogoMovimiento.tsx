'use client'

import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  Field,
  NumericInput,
  Select,
  Textarea,
  problemaDeImporte,
} from '@/components/ui'
import { montoDesdeTexto } from '@/lib/money'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { MEDIOS_DE_COBRANZA, etiquetaDeMedio } from '@/modules/sales/payment-methods'

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

/**
 * Lo que se ofrece en la caja (UX V5): un ingreso o un egreso, cada uno con
 * su boton. "Depósito" sigue existiendo en el sistema pero no se ofrece: su
 * efecto en los totales es confuso para quien atiende (ver el informe V5).
 */
export type TipoDeMovimiento = 'ingreso' | 'retiro'

const TITULOS: Record<TipoDeMovimiento, { titulo: string; boton: string; ayuda: string }> = {
  ingreso: {
    titulo: 'Registrar ingreso',
    boton: 'Registrar ingreso',
    ayuda: 'Plata que entra al cajón y no es una venta. Por ejemplo: cambio que trajiste.',
  },
  retiro: {
    titulo: 'Registrar egreso',
    boton: 'Registrar egreso',
    ayuda: 'Plata que sale del cajón. Por ejemplo: pago al proveedor del pan, o un retiro.',
  },
}

export function DialogoMovimiento({
  abierto,
  tipo: tipoFijo = 'ingreso',
  onCerrar,
  onHecho,
}: {
  abierto: boolean
  /** Ingreso o egreso. Se elige con el boton de la caja, no adentro. */
  tipo?: TipoDeMovimiento
  onCerrar: () => void
  onHecho: () => void
}) {
  const [tipo, setTipo] = useState<Tipo>(tipoFijo)
  const [monto, setMonto] = useState('')
  const [medio, setMedio] = useState<string>('CASH')
  const [detalle, setDetalle] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setTipo(tipoFijo)
    setMonto('')
    setMedio('CASH')
    setDetalle('')
    setError(null)
    setEnviando(false)
  }, [abierto, tipoFijo])

  // Cambiar a retiro o deposito fuerza efectivo: es la regla del servidor.
  useEffect(() => {
    if (tipo !== 'ingreso') setMedio('CASH')
  }, [tipo])

  // El importe lo interpreta @/lib/numero-local, que es el unico lugar donde
  // se decide que significa lo tipeado. Antes esto era
  // `Number(monto.replace(',', '.'))`, que leia "1.500" como uno y medio y
  // mandaba un `double` a la API.
  const importe = montoDesdeTexto(monto)
  const problema = problemaDeImporte(monto, { permitirCero: false })
  const valido = importe !== null && problema === null

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
      title={TITULOS[tipoFijo].titulo}
      description={TITULOS[tipoFijo].ayuda}
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
            {TITULOS[tipoFijo].boton}
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

        <Field label="Importe" required error={problema}>
          <NumericInput
            modo="dinero"
            placeholder="0,00"
            value={monto}
            disabled={enviando}
            onChange={setMonto}
          />
        </Field>

        <Field
          label="Forma de pago"
          hint={tipo !== 'ingreso' ? 'Un egreso siempre es efectivo del cajón.' : undefined}
        >
          <Select
            value={medio}
            disabled={enviando || tipo !== 'ingreso'}
            onChange={(e) => {
              setMedio(e.target.value)
            }}
          >
            {/* Los medios reales del sistema, con su nombre. Antes ofrecia los tres
                del vocabulario anterior a la Fase 3 (auditoria, D8). */}
            {MEDIOS_DE_COBRANZA.map((m) => (
              <option key={m} value={m}>
                {etiquetaDeMedio(m)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Motivo" hint="Para qué fue. Queda guardado con tu nombre.">
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
