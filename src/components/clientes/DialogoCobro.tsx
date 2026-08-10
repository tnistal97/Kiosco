'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  Money,
  Select,
  Textarea,
  aviso,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esPositivo, restarMontos } from '@/lib/money'
import { MEDIOS_DE_COBRANZA, etiquetaDeMedio } from '@/modules/sales/payment-methods'
import { parsePagoDeCliente, type ClienteDTO } from '@/modules/clients/dto'

/**
 * Cobrar lo que el cliente debe.
 *
 * Dos cosas que la pantalla dice ANTES de confirmar, y las dos importan:
 *
 *   · si el pago entra al cajon o no. Efectivo si; transferencia no. Sin esto,
 *     quien cierra el turno no entiende por que la caja no subio.
 *   · si el pago deja SALDO A FAVOR. El servidor lo rechaza con un 409 si nadie
 *     lo confirmo, y este aviso es el que evita que ese rechazo sorprenda.
 *
 * Ver docs/CUSTOMER_PAYMENT_FLOW.md.
 */
export function DialogoCobro({
  abierto,
  cliente,
  onCerrar,
  onCobrado,
}: {
  abierto: boolean
  cliente: ClienteDTO
  onCerrar: () => void
  onCobrado: () => void
}) {
  const router = useRouter()

  const [importe, setImporte] = useState('')
  const [medio, setMedio] = useState<string>('CASH')
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    // Se propone lo que debe, que es lo que pasa nueve de cada diez veces.
    // Cuando tiene saldo a favor no se propone nada: no hay nada que cobrar.
    setImporte(esPositivo(cliente.balance) ? cliente.balance : '')
    setMedio('CASH')
    setReferencia('')
    setNotas('')
    setError(null)
    setEnviando(false)
  }, [abierto, cliente.balance])

  const importeOk = /^\d+(\.\d{1,2})?$/.test(importe.trim()) && Number(importe) > 0
  const enEfectivo = medio === 'CASH'

  // Cuanto quedaria a favor. Se calcula aca solo para AVISAR: la decision la
  // toma el servidor dentro de la transaccion, con el saldo real.
  const sobra = importeOk ? restarMontos(importe, cliente.balance) : '0.00'
  const dejaAFavor = importeOk && esPositivo(sobra)

  async function cobrar() {
    if (enviando || !importeOk) return
    setEnviando(true)
    setError(null)
    try {
      const pago = await apiRequest(`/api/clients/${String(cliente.id)}/pagos`, {
        method: 'POST',
        body: {
          amount: importe.trim(),
          method: medio,
          reference: referencia.trim(),
          notes: notas.trim(),
          // Se manda lo que la pantalla MOSTRO: si el aviso estaba, quien
          // confirmo lo vio. Mandarlo siempre en true convertiria el aviso en
          // un adorno.
          aceptarSaldoAFavor: dejaAFavor,
        },
        parse: parsePagoDeCliente,
      })

      aviso.ok(`Cobro ${pago.number} registrado`)
      onCobrado()
      // Se abre el comprobante: el cliente esta esperando el papel.
      router.push(`/comprobantes/${String(pago.id)}`)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar el pago.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={`Registrar pago de ${cliente.name}`}
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={!importeOk}
            onClick={() => void cobrar()}
          >
            Registrar pago
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

        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Debe</span>
            <span className="font-medium text-ink" data-numeric="">
              {esPositivo(cliente.balance) ? (
                <Money amount={cliente.balance} />
              ) : (
                <span className="text-ink-faint">Nada</span>
              )}
            </span>
          </div>
        </div>

        <Field
          label="Cuánto paga"
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

        <Field label="Medio">
          <Select
            value={medio}
            disabled={enviando}
            onChange={(e) => {
              setMedio(e.target.value)
            }}
          >
            {MEDIOS_DE_COBRANZA.map((m) => (
              <option key={m} value={m}>
                {etiquetaDeMedio(m)}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          Lo que pasa con la caja, dicho antes y no despues. Un cobro por
          transferencia que baja la deuda y no sube el cajon es correcto, pero
          si nadie lo dijo se lee como un error al cerrar el turno.
        */}
        <Alert tone="info">
          {enEfectivo
            ? 'Este pago entra a la caja y suma al turno abierto.'
            : 'Este pago baja la deuda pero NO entra a la caja: no es efectivo.'}
        </Alert>

        {dejaAFavor && (
          <Alert tone="warning" title="Va a quedar saldo a favor">
            Este pago deja <Money amount={sobra} /> a favor de {cliente.name}. Se le va a descontar
            de la próxima compra a cuenta.
          </Alert>
        )}

        <Field label="Referencia" hint="Número de operación, últimos dígitos del cupón">
          <Input
            value={referencia}
            disabled={enviando}
            onChange={(e) => {
              setReferencia(e.target.value)
            }}
          />
        </Field>

        <Field label="Notas">
          <Textarea
            value={notas}
            disabled={enviando}
            rows={2}
            onChange={(e) => {
              setNotas(e.target.value)
            }}
          />
        </Field>
      </div>
    </Dialog>
  )
}
