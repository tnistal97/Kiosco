'use client'

import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Field, Input, RadioGroup, aviso } from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { aMilesimas, cantidadDesdeTexto, type TextoCantidad } from '@/lib/cantidad'
import { politicaDe, type UnidadDeVenta } from '@/modules/products/units'
import {
  AYUDA_DE_LOTE,
  AYUDA_DE_VENCIMIENTO,
  POLITICAS_DE_LOTE,
  POLITICAS_DE_VENCIMIENTO,
  etiquetaDePoliticaDeLote,
  etiquetaDePoliticaDeVencimiento,
  type PoliticaDeLote,
  type PoliticaDeVencimiento,
} from '@/modules/lots/politicas'

/**
 * Trazabilidad de un producto: si lleva partidas y si llevan vencimiento.
 *
 * Son DOS banderas y no una, y esa es la decision de fondo de la fase: la
 * lavandina necesita saber de que partida es cada bidon --por si hay que
 * retirarla-- y no tiene fecha que inventar. Una sola bandera obligaria a
 * elegir entre no rastrear la lavandina o inventarle un vencimiento.
 *
 * LA REGLA ENTRE LAS DOS, que la pantalla muestra en vez de dejar que el
 * servidor la rechace: un vencimiento sin partida no tiene donde guardarse, asi
 * que sin lotes no hay vencimiento. Hay un CHECK en la base que dice lo mismo.
 *
 * EXIGIR PARTIDAS SOBRE UN PRODUCTO QUE YA TIENE STOCK no se hace guardando el
 * producto. `REQUIRED` promete que toda unidad tiene partida conocida, y
 * activarlo con 12,500 kg sin atribuir convertiria esa promesa en una frase que
 * el sistema no cumple desde el primer dia. Por eso el boton abre la
 * inicializacion --que reparte lo que ya hay entre partidas-- y recien despues
 * deja guardar. El servidor lo rechaza igual con `LOT_TRACKING_NEEDS_ASSIGNMENT`:
 * la pantalla lo explica antes, no lo sustituye.
 */

interface DesgloseDeLotes {
  saleUnit: UnidadDeVenta
  lotTracking: PoliticaDeLote
  expirationTracking: PoliticaDeVencimiento
  total: TextoCantidad
  enLotes: TextoCantidad
  sinAsignar: TextoCantidad
  lotes: Array<{ id: number; code: string; quantity: TextoCantidad }>
}

function comoDesglose(raw: unknown): DesgloseDeLotes {
  const o = raw as DesgloseDeLotes
  return { ...o, lotes: o.lotes }
}

const OPCIONES_DE_LOTE = POLITICAS_DE_LOTE.map((v) => ({
  value: v,
  label: etiquetaDePoliticaDeLote(v),
  description: AYUDA_DE_LOTE[v],
}))

export function Trazabilidad({
  productId,
  deshabilitado,
}: {
  productId: number
  deshabilitado: boolean
}) {
  const puedeAdministrar = usePermiso('lots.manage')

  const [desglose, setDesglose] = useState<DesgloseDeLotes | null>(null)
  const [lote, setLote] = useState<PoliticaDeLote>('NONE')
  const [vencimiento, setVencimiento] = useState<PoliticaDeVencimiento>('NONE')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inicializando, setInicializando] = useState(false)

  /**
   * Relee el desglose.
   *
   * `conservarEleccion` existe por un caso concreto: después de repartir el
   * stock, la pantalla vuelve a leer para mostrar que no quedó nada sin
   * asignar. Si en esa relectura se pisaran las dos políticas con lo que dice
   * el servidor, la elección que el usuario acababa de hacer --"lotes
   * obligatorios"-- desaparecería, y el botón de guardar quedaría deshabilitado
   * porque ya no habría ningún cambio pendiente. Lo encontró la prueba de
   * extremo a extremo del flujo completo.
   */
  const cargar = useCallback(
    async (conservarEleccion = false) => {
      const d = await apiRequest(`/api/productos/${String(productId)}/lotes`, {
        parse: comoDesglose,
      })
      setDesglose(d)
      if (!conservarEleccion) {
        setLote(d.lotTracking)
        setVencimiento(d.expirationTracking)
      }
    },
    [productId],
  )

  useEffect(() => {
    void cargar().catch(() => {
      setError('No se pudo leer la trazabilidad del producto.')
    })
  }, [cargar])

  if (desglose === null) {
    return <p className="text-sm text-ink-faint">Cargando trazabilidad…</p>
  }

  const sinAsignar = aMilesimas(cantidadDesdeTexto(desglose.sinAsignar) ?? '0.000')
  const cambio = lote !== desglose.lotTracking || vencimiento !== desglose.expirationTracking
  // El caso del objetivo 4: pasar a REQUIRED con unidades que ninguna partida
  // explica. No se puede guardar hasta repartirlas.
  const faltaRepartir = lote === 'REQUIRED' && sinAsignar > 0
  const simbolo = politicaDe(desglose.saleUnit).simbolo

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      await apiRequest(`/api/productos/${String(productId)}/lotes`, {
        method: 'PUT',
        body: { lotTracking: lote, expirationTracking: vencimiento },
        parse: () => null,
      })
      aviso.ok('Se actualizó la trazabilidad.')
      await cargar()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cambiar la trazabilidad.'))
    } finally {
      setGuardando(false)
    }
  }

  const bloqueado = deshabilitado || guardando || !puedeAdministrar

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="danger" title="No se guardó">
          {error}
        </Alert>
      )}

      <RadioGroup
        legend="Lotes"
        name="lotTracking"
        value={lote}
        options={OPCIONES_DE_LOTE.map((o) => ({
          ...o,
          disabled: bloqueado,
        }))}
        columns={3}
        onChange={(v) => {
          setLote(v)
          // Sin lotes no hay donde guardar un vencimiento. En vez de dejar que
          // el servidor rechace la combinación, la pantalla la deshace sola.
          if (v === 'NONE') setVencimiento('NONE')
        }}
      />

      <RadioGroup
        legend="Vencimiento"
        name="expirationTracking"
        value={vencimiento}
        options={POLITICAS_DE_VENCIMIENTO.map((v) => ({
          value: v,
          label: etiquetaDePoliticaDeVencimiento(v),
          description: AYUDA_DE_VENCIMIENTO[v],
          disabled: bloqueado || (lote === 'NONE' && v !== 'NONE'),
        }))}
        columns={3}
        onChange={setVencimiento}
      />

      {lote === 'NONE' && (
        <p className="text-xs text-ink-faint">
          Sin lotes no hay vencimiento: una fecha necesita una partida donde vivir.
        </p>
      )}

      <div className="flex flex-col gap-1.5 rounded-md border border-line bg-sunken p-3 text-sm">
        <Renglon etiqueta="Stock actual">
          {desglose.total} {simbolo}
        </Renglon>
        <Renglon etiqueta="En partidas">
          {desglose.enLotes} {simbolo}
        </Renglon>
        <Renglon etiqueta="Sin asignar">
          <span className={sinAsignar > 0 ? 'text-warning' : undefined}>
            {desglose.sinAsignar} {simbolo}
          </span>
        </Renglon>
      </div>

      {faltaRepartir && (
        <Alert tone="warning" title="Falta decir de qué partidas son esas unidades">
          Exigir lotes promete que toda unidad tiene partida conocida. Hay{' '}
          <strong>
            {desglose.sinAsignar} {simbolo}
          </strong>{' '}
          sin asignar: repartilos antes de guardar. Esto no cambia el stock total, sólo identifica a
          qué partidas pertenece.
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {sinAsignar > 0 && puedeAdministrar && (
          <Button
            variant={faltaRepartir ? 'primary' : 'secondary'}
            disabled={bloqueado}
            onClick={() => {
              setInicializando(true)
            }}
          >
            Asignar el stock existente
          </Button>
        )}
        <Button
          variant={faltaRepartir ? 'secondary' : 'primary'}
          loading={guardando}
          disabled={bloqueado || !cambio || faltaRepartir}
          onClick={() => void guardar()}
        >
          Guardar trazabilidad
        </Button>
      </div>

      {!puedeAdministrar && (
        <p className="text-xs text-ink-faint">
          No tenés permiso para cambiar la trazabilidad de un producto.
        </p>
      )}

      <DialogoInicializacion
        abierto={inicializando}
        productId={productId}
        desglose={desglose}
        onCerrar={() => {
          setInicializando(false)
        }}
        onHecho={() => {
          setInicializando(false)
          // Conservando la elección: el usuario venía de pedir "obligatorios" y
          // repartió justamente para poder guardarlo.
          void cargar(true)
        }}
      />
    </div>
  )
}

function Renglon({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-muted">{etiqueta}</span>
      <span className="font-medium text-ink" data-numeric="">
        {children}
      </span>
    </div>
  )
}

/**
 * Repartir el stock que YA existe entre partidas.
 *
 * Lo que hace y lo que no, dicho en la pantalla porque es la confusion natural:
 * **no cambia el stock total**. Habia 12,500 kg y siguen habiendo 12,500 kg; lo
 * que cambia es que ahora se sabe que 5,000 son del lote ABC y 7,500 del DEF.
 *
 * Por eso no emite movimientos de inventario --no entro ni salio mercaderia--
 * sino atribuciones, que son un libro aparte con su motivo y su responsable.
 *
 * Se puede repartir de a poco: un producto OPTIONAL puede quedar con parte del
 * stock sin asignar. Lo que no se puede es activar REQUIRED sin cerrar la suma,
 * y por eso el total y el pendiente estan siempre a la vista.
 */
function DialogoInicializacion({
  abierto,
  productId,
  desglose,
  onCerrar,
  onHecho,
}: {
  abierto: boolean
  productId: number
  desglose: DesgloseDeLotes
  onCerrar: () => void
  onHecho: () => void
}) {
  const [lineas, setLineas] = useState<Array<{ code: string; quantity: string }>>([])
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setLineas([{ code: '', quantity: '' }])
    setMotivo('Inicialización de partidas')
    setError(null)
  }, [abierto])

  if (!abierto) return null

  const simbolo = politicaDe(desglose.saleUnit).simbolo
  const disponible = aMilesimas(cantidadDesdeTexto(desglose.sinAsignar) ?? '0.000')
  const asignado = lineas.reduce(
    (s, l) => s + aMilesimas(cantidadDesdeTexto(l.quantity === '' ? '0' : l.quantity) ?? '0.000'),
    0,
  )
  const pendiente = disponible - asignado
  const excede = pendiente < 0
  const completas = lineas.every((l) => l.code.trim() !== '' && l.quantity.trim() !== '')

  function cambiar(i: number, campo: 'code' | 'quantity', valor: string) {
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))
  }

  async function confirmar() {
    setEnviando(true)
    setError(null)
    try {
      /*
        PRIMERO, si el producto todavía no admite lotes, se lo pasa a OPCIONAL.

        Un producto `NONE` no puede tener partidas --el servidor lo rechaza con
        `LOT_NOT_TRACKED`, y con razón: una partida de un producto que no se
        rastrea es un dato que nadie va a mirar--. Así que el camino
        `NONE → REQUIRED` no existe de un salto, y no debería: pasa por
        opcional, que es exactamente lo que es la verdad mientras se reparte
        --el producto YA admite partidas, todavía no las exige todas--.

        Esto lo encontró la prueba de extremo a extremo del flujo completo: la
        pantalla dejaba apretar "Asignar" y la asignación fallaba en silencio.
      */
      if (desglose.lotTracking === 'NONE') {
        await apiRequest(`/api/productos/${String(productId)}/lotes`, {
          method: 'PUT',
          body: { lotTracking: 'OPTIONAL', expirationTracking: 'NONE' },
          parse: () => null,
        })
      }

      // Las partidas se resuelven o se crean POR CODIGO: la mercadería que ya
      // está en el estante trae códigos que el sistema no vio nunca.
      const conId: Array<{ lotId: number; quantity: string }> = []
      for (const linea of lineas) {
        const existente = desglose.lotes.find(
          (l) => l.code.trim().toUpperCase() === linea.code.trim().toUpperCase(),
        )
        const lotId =
          existente?.id ??
          (
            await apiRequest<{ id: number }>('/api/lotes', {
              method: 'POST',
              body: { productId, code: linea.code.trim() },
              parse: (raw) => raw as { id: number },
            })
          ).id
        conId.push({ lotId, quantity: linea.quantity })
      }

      await apiRequest('/api/lotes/atribuir', {
        method: 'POST',
        body: { productId, reason: motivo, lineas: conId },
        parse: () => null,
      })
      aviso.ok('Se asignaron las unidades a sus partidas.')
      onHecho()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo asignar el stock.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary-quiet/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">Asignar el stock existente</h4>
        <Badge tone="neutral">no cambia el total</Badge>
      </div>

      <p className="text-xs text-ink-muted">
        Esto no cambia el stock total. Sólo identifica a qué partidas pertenecen las unidades que ya
        están en el depósito.
      </p>

      {error && (
        <Alert tone="danger" title="No se asignó">
          {error}
        </Alert>
      )}

      <ul className="flex flex-col gap-2">
        {lineas.map((linea, i) => (
          // El índice ES la identidad acá: las filas se agregan y se quitan por
          // posición y no tienen ninguna clave estable propia.
          // eslint-disable-next-line react/no-array-index-key
          <li key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <Field label={`Partida ${String(i + 1)}`} labelHidden>
              <Input
                value={linea.code}
                placeholder="Código de la partida"
                className="font-mono"
                disabled={enviando}
                onChange={(e) => {
                  cambiar(i, 'code', e.target.value)
                }}
              />
            </Field>
            <Field label={`Cantidad de la partida ${String(i + 1)}`} labelHidden>
              <Input
                value={linea.quantity}
                inputMode="decimal"
                placeholder={simbolo}
                disabled={enviando}
                onChange={(e) => {
                  cambiar(i, 'quantity', e.target.value.replace(/[^0-9.,]/g, ''))
                }}
              />
            </Field>
            <Button
              variant="ghost"
              disabled={enviando || lineas.length === 1}
              onClick={() => {
                setLineas((prev) => prev.filter((_, j) => j !== i))
              }}
            >
              Quitar
            </Button>
          </li>
        ))}
      </ul>

      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={enviando}
          onClick={() => {
            setLineas((prev) => [...prev, { code: '', quantity: '' }])
          }}
        >
          Agregar partida
        </Button>
      </div>

      <Field label="Motivo" hint="Queda en el libro de atribuciones. Es la única explicación.">
        <Input
          value={motivo}
          disabled={enviando}
          onChange={(e) => {
            setMotivo(e.target.value)
          }}
        />
      </Field>

      <div className="flex flex-col gap-1 rounded-md border border-line bg-sunken p-2.5 text-sm">
        <Renglon etiqueta="Sin asignar">
          {desglose.sinAsignar} {simbolo}
        </Renglon>
        <Renglon etiqueta="Asignado ahora">
          {asignado.toFixed(3)} {simbolo}
        </Renglon>
        <Renglon etiqueta="Queda sin asignar">
          <span className={excede ? 'text-danger' : pendiente === 0 ? 'text-success' : undefined}>
            {pendiente.toFixed(3)} {simbolo}
          </span>
        </Renglon>
      </div>

      {excede && (
        <Alert tone="danger" title="Se asignó de más">
          No se puede atribuir más de lo que hay sin asignar.
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={enviando} onClick={onCerrar}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          loading={enviando}
          disabled={enviando || excede || !completas || motivo.trim() === ''}
          onClick={() => void confirmar()}
        >
          Asignar
        </Button>
      </div>
    </div>
  )
}
