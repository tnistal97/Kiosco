'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, RadioGroup, Select } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import type { Product } from '@/hooks/useProducts'
import {
  AYUDA_DE_AJUSTE,
  SIGNO_DE_TIPO,
  TIPOS_DE_AJUSTE,
  etiquetaDeTipo,
  type TipoDeAjuste,
} from '@/modules/inventory/movement-types'

/**
 * Ajuste de inventario.
 *
 * Dos formas de escribirlo porque en el mostrador se piensa de las dos
 * maneras: "entraron 12" y "quedan 30". Cada una va por su verbo:
 *
 *   PATCH /api/stock/:id   delta      suma o resta
 *   PUT   /api/stock/:id   quantity   fija el total (recuento)
 *
 * No es lo mismo. "Entraron 12" sobre un stock que otro acaba de tocar sigue
 * siendo correcto; "quedan 30" pisa lo que haya. Mandar siempre el total
 * convertiria una entrada de mercaderia en un recuento a ciegas.
 *
 * Va contra `/api/stock`, que exige `stock.adjust`, y no contra
 * `/api/products/:id`, que exige `products.update`: un repositor tiene el
 * primero y no el segundo, y con el endpoint equivocado no podia ajustar nada.
 *
 * El motivo es obligatorio, y esa es la razon de que este dialogo exista: el
 * ajuste dejo de ser un campo escondido en la ficha del producto que se
 * guardaba junto con la descripcion, sin explicacion y con el texto fijo
 * "Ajuste desde la ficha del producto" en la bitacora.
 */
type Modo = 'delta' | 'total'

const MODOS = [
  { value: 'delta' as const, label: 'Entraron / salieron', description: 'Sumar o restar' },
  { value: 'total' as const, label: 'Recuento', description: 'Cuántas hay ahora' },
]

const MOTIVOS_FRECUENTES = [
  'Entrada de mercadería',
  'Rotura',
  'Vencimiento',
  'Recuento físico',
  'Error de carga',
]

/**
 * Tipos que restan unidades y por lo tanto se cargan en positivo.
 *
 * En el mostrador nadie dice "se rompieron menos tres". Se escribe 3 y el
 * diálogo manda -3, porque el servidor exige que el signo coincida con el
 * tipo: aceptar un positivo y negarlo allá sería ambiguo --¿+3 es "entraron
 * 3" o un error de tipeo?-- y eso en inventario se paga caro.
 */
function restaUnidades(tipo: TipoDeAjuste): boolean {
  return SIGNO_DE_TIPO[tipo] === 'sale'
}

export function DialogoAjusteStock({
  producto,
  onCerrar,
  onAjustado,
}: {
  producto: Product | null
  onCerrar: () => void
  onAjustado: () => void
}) {
  const [modo, setModo] = useState<Modo>('delta')
  const [tipo, setTipo] = useState<TipoDeAjuste>('MANUAL_ADJUSTMENT')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!producto) return
    setModo('delta')
    setTipo('MANUAL_ADJUSTMENT')
    setValor('')
    setMotivo('')
    setError(null)
    setEnviando(false)
  }, [producto])

  const actual = producto?.totalStock ?? 0
  const resta = restaUnidades(tipo)
  const n = Number(valor)
  const numeroValido = valor.trim() !== '' && Number.isFinite(n)

  // El delta que de verdad se va a mandar. Con un tipo que resta, lo que el
  // usuario escribe en positivo viaja en negativo.
  const delta = !numeroValido ? 0 : resta ? -Math.abs(Math.trunc(n)) : Math.trunc(n)

  const nuevoTotal = !numeroValido
    ? actual
    : modo === 'total'
      ? Math.max(0, Math.trunc(n))
      : Math.max(0, actual + delta)

  const cambia = numeroValido && nuevoTotal !== actual
  // Sacar mas de lo que hay no se manda: el servidor lo rechazaria igual, y
  // avisar antes evita el viaje.
  const alcanza = modo === 'total' || actual + delta >= 0
  const valido = cambia && alcanza && motivo.trim().length >= 3

  async function guardar() {
    if (!producto || enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      const cuerpo =
        modo === 'delta'
          ? { delta, type: tipo, reason: motivo.trim() }
          : { quantity: nuevoTotal, reason: motivo.trim() }

      await apiRequest(`/api/stock/${producto.id}`, {
        method: modo === 'delta' ? 'PATCH' : 'PUT',
        body: cuerpo,
        parse: () => null,
      })
      onAjustado()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo ajustar el stock.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={producto !== null}
      onClose={onCerrar}
      title={producto ? `Ajustar ${producto.name}` : 'Ajustar stock'}
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
            Guardar ajuste
          </Button>
        </>
      }
    >
      {producto && (
        <div className="flex flex-col gap-5">
          {error && (
            <Alert tone="danger" title="No se ajustó">
              {error}
            </Alert>
          )}

          <div className="flex items-baseline justify-between rounded-lg border border-line bg-sunken px-4 py-3">
            <span className="text-sm text-ink-muted">Ahora hay</span>
            <span className="text-2xl font-semibold text-ink" data-numeric="">
              {actual}
            </span>
          </div>

          <RadioGroup
            legend="Cómo lo querés cargar"
            name="modo-ajuste"
            value={modo}
            onChange={(m) => {
              setModo(m)
              setValor('')
            }}
            options={MODOS}
            columns={2}
          />

          {modo === 'delta' && (
            <Field
              label="Qué pasó"
              required
              hint="Queda registrado en el libro de inventario. Es lo que después permite preguntar cuánto se rompió en el mes."
            >
              <Select
                value={tipo}
                disabled={enviando}
                onChange={(e) => {
                  setTipo(e.target.value as TipoDeAjuste)
                  setValor('')
                }}
              >
                {TIPOS_DE_AJUSTE.map((t) => (
                  <option key={t} value={t}>
                    {etiquetaDeTipo(t)} — {AYUDA_DE_AJUSTE[t]}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label={
              modo === 'total'
                ? 'Unidades contadas'
                : resta
                  ? 'Cuántas unidades'
                  : 'Cantidad (negativa para restar)'
            }
            required
          >
            <Input
              inputMode="numeric"
              placeholder={modo === 'total' ? 'Ej: 30' : resta ? 'Ej: 3' : 'Ej: 12  o  -3'}
              value={valor}
              disabled={enviando}
              onChange={(e) => {
                // Con un tipo que resta, el signo lo pone el diálogo: dejar
                // escribir "-3" en un campo que ya significa "cuántas se
                // rompieron" permitiría cargar +3 sin querer.
                const limpio =
                  modo === 'delta' && !resta
                    ? e.target.value.replace(/[^0-9-]/g, '')
                    : e.target.value.replace(/[^0-9]/g, '')
                setValor(limpio)
              }}
            />
          </Field>

          {cambia && alcanza && (
            <Alert tone="info">
              Va a quedar en{' '}
              <strong className="text-ink" data-numeric="">
                {nuevoTotal}
              </strong>{' '}
              {nuevoTotal === 1 ? 'unidad' : 'unidades'}{' '}
              <span className="text-ink-faint">
                ({nuevoTotal > actual ? '+' : '−'}
                {Math.abs(nuevoTotal - actual)})
              </span>
            </Alert>
          )}

          {numeroValido && !alcanza && (
            <Alert tone="warning" title="No alcanza">
              Hay {actual} {actual === 1 ? 'unidad' : 'unidades'} y estás sacando {Math.abs(delta)}.
              El stock no puede quedar negativo.
            </Alert>
          )}

          <Field
            label="Motivo"
            required
            hint="Obligatorio. Queda en la bitácora con tu nombre y la fecha."
          >
            <Input
              value={motivo}
              disabled={enviando}
              onChange={(e) => {
                setMotivo(e.target.value)
              }}
            />
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_FRECUENTES.map((m) => (
              <Button
                key={m}
                size="sm"
                variant="secondary"
                disabled={enviando}
                onClick={() => {
                  setMotivo(m)
                }}
              >
                {m}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  )
}
