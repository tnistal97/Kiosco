'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, Money, Textarea, aviso } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { CERO, restarMontos, sumarMontos, type Monto } from '@/lib/money'
import type { ResumenDeCuentaDTO } from '@/modules/suppliers/dto.cuenta'

/**
 * Los dos movimientos que se escriben a mano.
 *
 * Un solo componente para los dos porque son la misma forma --importe, motivo,
 * referencia opcional-- y la diferencia es de vocabulario y de signo, no de
 * mecanica. Dos archivos casi iguales se desincronizan; uno con dos modos, no.
 *
 *   'credito'  el proveedor emitio una nota de credito. Siempre REDUCE.
 *   'ajuste'   correccion administrativa. El signo lo elige quien la hace.
 *
 * Los dos exigen MOTIVO, y no es una validacion de pantalla: la base tiene un
 * CHECK que rechaza la fila sin el. Son los dos unicos tipos del libro sin un
 * hecho propio detras --una recepcion tiene remito, un pago tiene
 * comprobante-- y sin el motivo, dentro de un anio son un numero sin
 * explicacion.
 *
 * Ver docs/SUPPLIER_ACCOUNT_LEDGER.md.
 */
export function DialogoAjusteProveedor({
  abierto,
  modo,
  cuenta,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean
  modo: 'credito' | 'ajuste'
  cuenta: ResumenDeCuentaDTO
  onCerrar: () => void
  onGuardado: () => void
}) {
  const esCredito = modo === 'credito'

  const [importe, setImporte] = useState('')
  const [signo, setSigno] = useState<'mas' | 'menos'>('mas')
  const [motivo, setMotivo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setImporte('')
    setSigno('mas')
    setMotivo('')
    setReferencia('')
    setError(null)
    setEnviando(false)
  }, [abierto, modo])

  const importeOk = /^\d+(\.\d{1,2})?$/.test(importe.trim()) && Number(importe) > 0
  const motivoOk = motivo.trim().length > 0

  // El credito SIEMPRE baja la deuda. El ajuste, lo que se haya elegido.
  const bajaLaDeuda = esCredito || signo === 'menos'
  const importeLimpio: Monto = importeOk ? importe.trim() : CERO
  const resultante = bajaLaDeuda
    ? restarMontos(cuenta.balance, importeLimpio)
    : sumarMontos(cuenta.balance, importeLimpio)

  async function guardar() {
    if (enviando || !importeOk || !motivoOk) return
    setEnviando(true)
    setError(null)
    try {
      const url = esCredito
        ? `/api/suppliers/${String(cuenta.supplierId)}/nota-credito`
        : `/api/suppliers/${String(cuenta.supplierId)}/ajuste`

      await apiRequest(url, {
        method: 'POST',
        body: esCredito
          ? { amount: importeLimpio, reason: motivo.trim(), reference: referencia.trim() }
          : {
              // El ajuste declara el DELTA con signo, no el saldo final. Es lo
              // que hace que se entienda dentro de dos anios: "sumale 2.000 por
              // deuda anterior a la migracion" dice de donde salieron los 2.000;
              // "poneme el saldo en 7.000" no.
              delta: bajaLaDeuda ? `-${importeLimpio}` : importeLimpio,
              reason: motivo.trim(),
            },
        parse: () => null,
      })

      aviso.ok(esCredito ? 'Nota de crédito registrada' : 'Ajuste registrado')
      onGuardado()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={
        esCredito ? `Nota de crédito de ${cuenta.name}` : `Ajustar la cuenta de ${cuenta.name}`
      }
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={!importeOk || !motivoOk}
            onClick={() => void guardar()}
          >
            {esCredito ? 'Registrar nota de crédito' : 'Registrar ajuste'}
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

        <Alert tone="info">
          {esCredito
            ? 'Una nota de crédito baja lo que le debemos. No modifica ninguna recepción anterior: se registra como un movimiento nuevo.'
            : 'Un ajuste escribe un movimiento que no responde a una entrega ni a un pago. Queda auditado con tu usuario y su motivo.'}
        </Alert>

        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Saldo actual</span>
            <span className="font-medium text-ink" data-numeric="">
              <Money amount={cuenta.balance} />
            </span>
          </div>
          {importeOk && (
            <div className="mt-1 flex justify-between">
              <span className="text-ink-muted">Quedaría en</span>
              <span className="font-medium text-ink" data-numeric="">
                <Money amount={resultante} />
              </span>
            </div>
          )}
        </div>

        {!esCredito && (
          <Field label="Qué hace" required>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={signo === 'mas' ? 'primary' : 'secondary'}
                disabled={enviando}
                onClick={() => {
                  setSigno('mas')
                }}
              >
                Aumenta lo que debemos
              </Button>
              <Button
                variant={signo === 'menos' ? 'primary' : 'secondary'}
                disabled={enviando}
                onClick={() => {
                  setSigno('menos')
                }}
              >
                Reduce lo que debemos
              </Button>
            </div>
          </Field>
        )}

        <Field
          label="Importe"
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
          hint={
            esCredito
              ? 'Faltante en la entrega del 12, bonificación de fin de mes…'
              : 'Deuda anterior a la migración, corrección administrativa…'
          }
          error={motivo !== '' && !motivoOk ? 'El motivo es obligatorio' : null}
        >
          <Textarea
            value={motivo}
            disabled={enviando}
            rows={2}
            onChange={(e) => {
              setMotivo(e.target.value)
            }}
          />
        </Field>

        {esCredito && (
          <Field label="Número de su documento" hint="El que figura en la nota de crédito">
            <Input
              value={referencia}
              disabled={enviando}
              onChange={(e) => {
                setReferencia(e.target.value)
              }}
            />
          </Field>
        )}
      </div>
    </Dialog>
  )
}
