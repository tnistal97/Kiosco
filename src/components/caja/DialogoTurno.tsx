'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, Money, Textarea, tonoPorSigno } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  CERO,
  esCero,
  esNegativo,
  esPositivo,
  compararMontos,
  montoDesdeTexto,
  restarMontos,
  absMonto,
  type Monto,
} from '@/lib/money'
import { parseTurnoEnvuelto, type TurnoDTO } from '@/modules/cash/dto'

/**
 * Apertura de caja.
 *
 * Pide una sola cosa: cuanto hay en el cajon. Es el punto de partida contra el
 * que se va a comparar el cierre, asi que no puede quedar implicito ni salir
 * de un numero que el sistema traiga de antes.
 */
export function DialogoAbrirCaja({
  abierto,
  onCerrar,
  onHecho,
}: {
  abierto: boolean
  onCerrar: () => void
  onHecho: (turno: TurnoDTO) => void
}) {
  const [inicial, setInicial] = useState('')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setInicial('')
    setNotas('')
    setError(null)
    setEnviando(false)
  }, [abierto])

  const importe = useMemo(() => montoDesdeTexto(inicial), [inicial])
  const valido = importe !== null && !esNegativo(importe)

  async function guardar() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      const turno = await apiRequest('/api/cash/shift', {
        method: 'POST',
        body: { openingAmount: importe, notes: notas.trim() === '' ? undefined : notas.trim() },
        parse: parseTurnoEnvuelto,
      })
      onHecho(turno)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo abrir la caja.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Abrir la caja"
      description="Contá lo que hay en el cajón antes de empezar."
      size="sm"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="confirm"
            loading={enviando}
            disabled={!valido}
            onClick={() => void guardar()}
          >
            Abrir la caja
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="No se abrió">
            {error}
          </Alert>
        )}

        <Field
          label="Efectivo inicial"
          required
          hint="Lo que hay ahora en el cajón. Puede ser cero."
        >
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={inicial}
            disabled={enviando}
            autoFocus
            onChange={(e) => {
              setInicial(e.target.value)
            }}
          />
        </Field>

        <Field label="Notas" hint="Opcional.">
          <Textarea
            rows={2}
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

/**
 * Cierre de caja.
 *
 * Muestra el esperado ANTES de contar y la diferencia mientras se escribe.
 * Ver el esperado no invalida el cierre: quien cuenta ya tiene el dinero en la
 * mano. Lo que se gana es que el faltante se vea en el momento.
 *
 * Cuando la diferencia supera el umbral de la sucursal, el servidor rechaza el
 * cierre con un 409 y hay que confirmarlo de nuevo, esta vez autorizandolo.
 * La confirmacion es explicita a proposito: firmar un faltante grande no puede
 * ser el mismo clic que cerrar una caja que cuadra.
 */
export function DialogoCerrarCaja({
  abierto,
  turno,
  umbral,
  puedeAutorizar,
  onCerrar,
  onHecho,
}: {
  abierto: boolean
  turno: TurnoDTO
  umbral: Monto
  puedeAutorizar: boolean
  onCerrar: () => void
  onHecho: () => void
}) {
  const [contado, setContado] = useState('')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Se enciende cuando el servidor pide autorizacion. */
  const [pideAutorizacion, setPideAutorizacion] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setContado('')
    setNotas('')
    setError(null)
    setEnviando(false)
    setPideAutorizacion(false)
  }, [abierto])

  const importe = useMemo(() => montoDesdeTexto(contado), [contado])
  const diferencia = importe === null ? null : restarMontos(importe, turno.expectedAmount)
  const valido = importe !== null && !esNegativo(importe)

  const superaUmbral =
    diferencia !== null && esPositivo(umbral) && compararMontos(absMonto(diferencia), umbral) > 0

  async function guardar(autorizar: boolean) {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest(`/api/cash/shift/${turno.id}/close`, {
        method: 'POST',
        body: {
          countedAmount: importe,
          notes: notas.trim() === '' ? undefined : notas.trim(),
          autorizar,
        },
        parse: () => null,
      })
      onHecho()
    } catch (err) {
      const mensaje = mensajeDeError(err, 'No se pudo cerrar la caja.')
      // El servidor es el que decide si hace falta autorizacion: la pantalla
      // solo la anticipa. Si llega el rechazo, se muestra el segundo paso.
      if (/autoric/i.test(mensaje) && puedeAutorizar) setPideAutorizacion(true)
      setError(mensaje)
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Cerrar la caja"
      description="Contá el efectivo del cajón. El turno queda cerrado y no se puede reabrir."
      size="md"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          {pideAutorizacion ? (
            <Button
              variant="danger"
              loading={enviando}
              disabled={!valido}
              onClick={() => void guardar(true)}
            >
              Autorizar y cerrar
            </Button>
          ) : (
            <Button
              variant="confirm"
              loading={enviando}
              disabled={!valido}
              onClick={() => void guardar(false)}
            >
              Cerrar la caja
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone={pideAutorizacion ? 'warning' : 'danger'} title="No se cerró">
            {error}
          </Alert>
        )}

        <dl className="flex flex-col gap-2 rounded-lg border border-line bg-sunken px-4 py-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">Inicial</dt>
            <dd>
              <Money amount={turno.openingAmount} size="sm" tone="muted" />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">Ventas en efectivo</dt>
            <dd>
              <Money amount={turno.ventasEnEfectivo} size="sm" tone="muted" />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">Ingresos</dt>
            <dd>
              <Money amount={turno.ingresos} size="sm" tone="muted" />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-muted">Egresos y retiros</dt>
            <dd>
              <Money amount={turno.egresos} size="sm" tone="muted" />
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2">
            <dt className="font-medium text-ink">Tiene que haber</dt>
            <dd>
              <Money amount={turno.expectedAmount} size="lg" />
            </dd>
          </div>
        </dl>

        <Field label="Efectivo contado" required>
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={contado}
            disabled={enviando}
            autoFocus
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
            {superaUmbral && (
              <span className="mt-1 block">
                Supera el límite de <Money amount={umbral} size="sm" tone="muted" /> y necesita
                autorización.
              </span>
            )}
          </Alert>
        )}

        <Field
          label="Notas del cierre"
          hint={
            diferencia !== null && !esCero(diferencia)
              ? 'Escribí qué pasó: es lo que se va a leer mañana.'
              : 'Opcional.'
          }
        >
          <Textarea
            rows={2}
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

/** Cero como texto, para las pantallas que necesitan un importe de partida. */
export const SIN_PLATA: Monto = CERO
