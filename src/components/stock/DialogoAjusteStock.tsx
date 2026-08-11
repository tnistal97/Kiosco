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
import { aMilesimas, cantidadDesdeTexto, desdeMilesimas } from '@/lib/cantidad'
import {
  esFraccionable,
  formatearCantidad,
  formatearCantidadConUnidad,
  politicaDe,
} from '@/modules/products/units'
import {
  etiquetaDeVencimiento,
  type EstadoDeVencimiento,
  type PoliticaDeLote,
} from '@/modules/lots/politicas'

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

/** Lo que devuelve `GET /api/productos/:id/lotes`, en lo que este diálogo usa. */
interface DesglosePorLote {
  lotTracking: PoliticaDeLote
  sinAsignar: string
  lotes: Array<{
    id: number
    code: string
    quantity: string
    expirationDate: string | null
    estado: EstadoDeVencimiento
  }>
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
  /**
   * Las partidas del producto. Fase 4D.
   *
   * Se piden al abrir y no antes: la mayoría de los productos no lleva lotes, y
   * una consulta por cada fila de la pantalla de stock sería pagar por el caso
   * raro. Si falla, el bloque no aparece y el ajuste sigue funcionando como
   * antes --el servidor rechaza igual un `REQUIRED` sin partida--.
   */
  const [partidas, setPartidas] = useState<DesglosePorLote | null>(null)
  const [lote, setLote] = useState('')

  useEffect(() => {
    if (!producto) return
    setModo('delta')
    setTipo('MANUAL_ADJUSTMENT')
    setValor('')
    setMotivo('')
    setError(null)
    setEnviando(false)
    setPartidas(null)
    setLote('')

    let vivo = true
    void apiRequest(`/api/productos/${String(producto.id)}/lotes`, {
      parse: (raw) => raw as DesglosePorLote,
    })
      .then((d) => {
        if (vivo) setPartidas(d)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [producto])

  const unidad = producto?.saleUnit ?? 'UNIT'
  const politica = politicaDe(unidad)
  const fraccionable = esFraccionable(unidad)

  // Toda la aritmetica en MILESIMAS enteras. En punto flotante, un ajuste de
  // 0,1 kg sobre un saldo de 0,2 kg daria 0,30000000000000004 y el servidor lo
  // rechazaria por una restriccion de la base que el usuario no puede entender.
  const actual = aMilesimas(producto?.totalStock ?? '0.000')
  const resta = restaUnidades(tipo)

  // El signo se parsea aparte: `cantidadDesdeTexto` rechaza los negativos a
  // proposito --nadie tipea un peso negativo en el diálogo de la balanza-- y
  // acá "−3" es una entrada legítima para un ajuste genérico.
  const negativo = valor.trim().startsWith('-')
  const escrito = cantidadDesdeTexto(valor.trim().replace(/^-/, ''))
  const numeroValido = escrito !== null
  const n = escrito === null ? 0 : (negativo ? -1 : 1) * aMilesimas(escrito)

  // El delta que de verdad se va a mandar. Con un tipo que resta, lo que el
  // usuario escribe en positivo viaja en negativo.
  const delta = !numeroValido ? 0 : resta ? -Math.abs(n) : n

  const nuevoTotal = !numeroValido
    ? actual
    : modo === 'total'
      ? Math.max(0, n)
      : Math.max(0, actual + delta)

  const cambia = numeroValido && nuevoTotal !== actual
  // Sacar mas de lo que hay no se manda: el servidor lo rechazaria igual, y
  // avisar antes evita el viaje.
  const alcanza = modo === 'total' || actual + delta >= 0
  // La fraccion tiene que respetar el paso de la unidad. Es la misma regla que
  // aplica el servidor, con la misma tabla: `1.235` en un producto por unidad
  // no llega a viajar.
  const enPaso = !numeroValido || n % aMilesimas(politica.paso) === 0

  // La partida. Fase 4D.
  //
  // Sólo en modo delta: el recuento (PUT) no lleva lote a propósito --contar
  // por partida es un inventario físico, que es otra pantalla con sus estados,
  // su conteo a ciegas y su revisión--.
  const pideLote = modo === 'delta' && (partidas?.lotTracking ?? 'NONE') !== 'NONE'
  const exigeLote = modo === 'delta' && partidas?.lotTracking === 'REQUIRED'
  const falta = exigeLote && lote === ''

  const valido = cambia && alcanza && enPaso && !falta && motivo.trim().length >= 3

  async function guardar() {
    if (!producto || enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      // Las cantidades viajan como cadena decimal, igual que los importes.
      const cuerpo =
        modo === 'delta'
          ? {
              delta: desdeMilesimas(delta),
              type: tipo,
              reason: motivo.trim(),
              // Sin partida elegida el campo no viaja: `lotId: null` no es lo
              // mismo que no mandarlo, y en un producto OPTIONAL "sin partida"
              // significa que sale del stock no atribuido.
              ...(lote === '' ? {} : { lotId: Number(lote) }),
            }
          : { quantity: desdeMilesimas(nuevoTotal), reason: motivo.trim() }

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
              {formatearCantidadConUnidad(desdeMilesimas(actual), unidad)}
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

          {/*
            La partida. Fase 4D.

            "Se rompieron 2 yogures" tiene que decir de cuál: el que se rompió
            ya no está y el que quedaba vence otro día. Por eso un producto
            `REQUIRED` no deja guardar sin elegir.

            NO se elige por FEFO en silencio. Una pérdida no es una venta:
            adivinar de qué partida se rompió una botella sería inventar el
            dato, y el número de lote quedaría escrito como si alguien lo
            hubiera leído.
          */}
          {pideLote && partidas && (
            <Field
              label="De qué partida"
              required={exigeLote}
              error={falta ? 'Este producto exige decir de qué partida sale.' : null}
              hint={
                exigeLote
                  ? undefined
                  : `Sin elegir, sale del stock sin asignar (${partidas.sinAsignar} ${politica.simbolo}).`
              }
            >
              <Select
                value={lote}
                disabled={enviando}
                onChange={(e) => {
                  setLote(e.target.value)
                }}
              >
                <option value="">
                  {exigeLote ? 'Elegí una partida…' : 'Sin partida (stock sin asignar)'}
                </option>
                {partidas.lotes.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.code} — {l.quantity} {politica.simbolo}
                    {l.expirationDate === null ? '' : ` · vence ${l.expirationDate}`} (
                    {etiquetaDeVencimiento(l.estado)})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label={
              modo === 'total'
                ? `Cuánto contaste (${politica.simbolo})`
                : resta
                  ? `Cuánto sale (${politica.simbolo})`
                  : `Cantidad en ${politica.simbolo} (negativa para restar)`
            }
            required
            hint={fraccionable ? `Se admiten decimales: mínimo ${politica.paso}` : undefined}
          >
            <Input
              inputMode={fraccionable ? 'decimal' : 'numeric'}
              placeholder={
                fraccionable
                  ? modo === 'total'
                    ? 'Ej: 3,250'
                    : 'Ej: 0,750'
                  : modo === 'total'
                    ? 'Ej: 30'
                    : resta
                      ? 'Ej: 3'
                      : 'Ej: 12  o  -3'
              }
              value={valor}
              disabled={enviando}
              onChange={(e) => {
                // Con un tipo que resta, el signo lo pone el diálogo: dejar
                // escribir "-3" en un campo que ya significa "cuántas se
                // rompieron" permitiría cargar +3 sin querer.
                //
                // La coma y el punto solo entran si la unidad admite
                // decimales: en un producto por unidad, tipear una coma
                // simplemente no hace nada.
                const digitos = fraccionable ? '0-9.,' : '0-9'
                const conSigno = modo === 'delta' && !resta ? `${digitos}-` : digitos
                setValor(e.target.value.replace(new RegExp(`[^${conSigno}]`, 'g'), ''))
              }}
            />
          </Field>

          {cambia && alcanza && enPaso && (
            <Alert tone="info">
              Va a quedar en{' '}
              <strong className="text-ink" data-numeric="">
                {formatearCantidadConUnidad(desdeMilesimas(nuevoTotal), unidad)}
              </strong>{' '}
              <span className="text-ink-faint">
                ({nuevoTotal > actual ? '+' : '−'}
                {formatearCantidad(desdeMilesimas(Math.abs(nuevoTotal - actual)), unidad)})
              </span>
            </Alert>
          )}

          {numeroValido && !enPaso && (
            <Alert tone="warning" title="Cantidad no válida">
              {politica.nombre === 'Unidad'
                ? 'Un producto por unidad no admite fracciones.'
                : `La cantidad tiene que ser múltiplo de ${politica.paso} ${politica.simbolo}.`}
            </Alert>
          )}

          {numeroValido && !alcanza && (
            <Alert tone="warning" title="No alcanza">
              Hay {formatearCantidadConUnidad(desdeMilesimas(actual), unidad)} y estás sacando{' '}
              {formatearCantidadConUnidad(desdeMilesimas(Math.abs(delta)), unidad)}. El stock no
              puede quedar negativo.
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
