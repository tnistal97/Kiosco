'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  Money,
  Select,
  SkeletonRows,
  Textarea,
  aviso,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { CERO, sumarMontos, type Monto } from '@/lib/money'
import { NOMBRE_DE_UNIDAD_DE_COMPRA, unidadDeCompraODefecto } from '@/modules/products/units'
import {
  AYUDA_DE_MOTIVO,
  MOTIVOS_DE_DEVOLUCION,
  etiquetaDeMotivo,
  type MotivoDeDevolucion,
} from '@/modules/purchases/return-status'
import {
  parseRetornables,
  type RenglonRetornableDTO,
  type RetornablesDTO,
} from '@/modules/purchases/dto.returns'

/** Recorta los ceros de la derecha: "2" se lee y "2.000" hace dudar. */
function limpia(c: string): string {
  return c.includes('.') ? c.replace(/0+$/, '').replace(/\.$/, '') : c
}

/** El credito de un renglon: cantidad x costo original, redondeado a pesos. */
function creditoDe(linea: RenglonRetornableDTO, cantidad: string): Monto {
  const n = Number(cantidad)
  if (!Number.isFinite(n) || n <= 0) return CERO
  return (Math.round(n * Number(linea.unitCost) * 100) / 100).toFixed(2)
}

/**
 * Armar una devolucion desde una entrega. La pantalla del objetivo 19.
 *
 * MUESTRA LOS CUATRO NUMEROS que hacen falta para decidir, y los muestra juntos:
 * cuanto llego, cuanto ya se devolvio, cuanto queda disponible y cuanto hay HOY
 * en el deposito. Los dos ultimos son topes distintos --uno historico y otro
 * fisico-- y sin verlos por separado, un rechazo obliga a adivinar cual falto.
 *
 * Y el COSTO ORIGINAL junto al credito que genera. Es lo que el proveedor va a
 * acreditar, y no es el costo de hoy: una caja que entro a $1.100 se devuelve a
 * $1.100 aunque hoy salga $1.350.
 *
 * Crea la devolucion EN BORRADOR. Confirmarla --que es cuando la mercaderia sale
 * y nace el credito-- es otro paso, en la pantalla de la devolucion, y muchas
 * veces otra persona.
 */
export function DialogoDevolucion({
  abierto,
  receiptId,
  onCerrar,
}: {
  abierto: boolean
  receiptId: number
  onCerrar: () => void
}) {
  const router = useRouter()

  const [datos, setDatos] = useState<RetornablesDTO | null>(null)
  /**
   * Lo que se devuelve, por RENGLÓN Y PARTIDA. Fase 4D.
   *
   * La clave es `"receiptItemId:lotId"` --con `0` para "sin partida"-- y no el
   * renglón solo: una misma línea de recepción pudo llegar en dos partidas, y
   * cada una se devuelve por separado. Es la misma clave que usa el servidor
   * para comprobar que no se repita un par.
   */
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState<MotivoDeDevolucion>('DAMAGED')
  const [nota, setNota] = useState('')
  const [cargando, setCargando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const datos = await apiRequest(
        `/api/purchases/recepciones/${String(receiptId)}/retornables`,
        { parse: parseRetornables },
      )
      setDatos(datos)
      setCantidades({})
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar la entrega.'))
    } finally {
      setCargando(false)
    }
  }, [receiptId])

  useEffect(() => {
    if (!abierto) return
    setMotivo('DAMAGED')
    setNota('')
    setEnviando(false)
    void cargar()
  }, [abierto, cargar])

  const lineas = datos?.lineas ?? []

  /**
   * Cada casilla que se puede llenar: una por partida, o UNA sola sin partida.
   *
   * Una línea sin rastreo tiene exactamente una casilla, igual que antes de la
   * Fase 4D. Una con dos partidas tiene dos, con sus propios topes: devolver de
   * otra partida sacaría mercadería que el proveedor nunca mandó.
   */
  const casillas = lineas.flatMap((l) =>
    l.lotes.length === 0
      ? [{ linea: l, lotId: 0, code: null as string | null, disponible: l.disponible }]
      : l.lotes.map((p) => ({
          linea: l,
          lotId: p.lotId,
          code: p.code,
          disponible: p.disponible,
        })),
  )

  const clave = (receiptItemId: number, lotId: number) =>
    `${String(receiptItemId)}:${String(lotId)}`

  const elegidas = casillas
    .map((c) => ({
      ...c,
      cantidad: (cantidades[clave(c.linea.receiptItemId, c.lotId)] ?? '').trim(),
    }))
    .filter((x) => x.cantidad !== '' && Number(x.cantidad) > 0)

  const credito = elegidas.reduce(
    (total, x) => sumarMontos(total, creditoDe(x.linea, x.cantidad)),
    CERO,
  )

  /**
   * Que renglon esta mal, y por que.
   *
   * Se comprueba en la pantalla ADEMAS del servidor, y no en su lugar: el
   * servidor lo vuelve a mirar bajo bloqueo de fila, que es lo unico que resiste
   * dos devoluciones simultaneas. Esto es para no hacer viajar un formulario que
   * ya se sabe que no entra.
   */
  const problema = elegidas
    .map(({ linea, cantidad, code, disponible }) => {
      const de = code === null ? `"${linea.productName}"` : `"${linea.productName}" (${code})`
      const n = Number(cantidad)
      if (!Number.isFinite(n)) return `${de}: esa cantidad no es un número.`
      if (n > Number(disponible)) {
        return (
          `De ${de} quedan ${limpia(disponible)} sin devolver de ` +
          `${limpia(code === null ? linea.recibido : (linea.lotes.find((p) => p.code === code)?.recibido ?? linea.recibido))} recibidas.`
        )
      }
      // El otro tope: lo que hay HOY. En unidad de venta, que es como se guarda
      // el stock, convertido con el factor de esta entrega. Se mira POR LÍNEA:
      // el stock del producto es uno solo aunque haya varias partidas.
      const sale = n * Number(linea.unitsPerPurchaseUnit)
      if (sale > Number(linea.stockActual)) {
        return (
          `De ${de} quedan ${limpia(linea.stockActual)} en el depósito y esta ` +
          `devolución saca ${limpia(String(sale))}.`
        )
      }
      return null
    })
    .find((m) => m !== null)

  const notaObligatoria = motivo === 'OTHER'
  const puedeGuardar =
    elegidas.length > 0 &&
    problema === undefined &&
    (!notaObligatoria || nota.trim().length > 0) &&
    !enviando

  async function guardar() {
    if (!puedeGuardar || datos === null) return
    setEnviando(true)
    setError(null)
    try {
      const creada = await apiRequest<{ id: number; number: string }>('/api/devoluciones', {
        method: 'POST',
        body: {
          purchaseReceiptId: datos.receiptId,
          reason: motivo,
          notes: nota.trim(),
          items: elegidas.map((x) => ({
            receiptItemId: x.linea.receiptItemId,
            quantity: x.cantidad,
            // `lotId: 0` es la casilla "sin partida": no viaja.
            ...(x.lotId === 0 ? {} : { lotId: x.lotId }),
          })),
        },
        parse: (raw) => {
          const r = raw as { id?: unknown; number?: unknown }
          return { id: Number(r.id), number: String(r.number) }
        },
      })

      aviso.ok(`Devolución ${creada.number} creada en borrador`)
      onCerrar()
      router.push(`/devoluciones/${String(creada.id)}`)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo crear la devolución.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={datos === null ? 'Devolver mercadería' : `Devolver de ${datos.orderNumber}`}
      description={datos?.supplier.name}
      dismissible={!enviando}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={!puedeGuardar}
            onClick={() => void guardar()}
          >
            Crear borrador
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error !== null && (
          <Alert tone="danger" title="No se creó">
            {error}
          </Alert>
        )}

        <Alert tone="info">
          Esto crea un <strong>borrador</strong>. La mercadería no sale del depósito y el proveedor
          no recibe ningún crédito hasta que alguien lo confirme.
        </Alert>

        {cargando && datos === null ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="flex flex-col gap-3">
            {lineas.map((l) => {
              const unidad = unidadDeCompraODefecto(l.purchaseUnit)
              const cantidad = cantidades[clave(l.receiptItemId, 0)] ?? ''
              const sinNada = Number(l.disponible) <= 0
              return (
                <div
                  key={l.receiptItemId}
                  className="rounded-lg border border-line p-3"
                  data-testid="renglon-devolucion"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">{l.productName}</span>
                    <span className="text-xs text-ink-faint">
                      {NOMBRE_DE_UNIDAD_DE_COMPRA[unidad]} de {limpia(l.unitsPerPurchaseUnit)}
                    </span>
                  </div>

                  {/* Los cuatro numeros, juntos. Los dos topes son distintos. */}
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-ink-faint">Recibido</dt>
                      <dd className="text-ink" data-numeric="">
                        {limpia(l.recibido)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Devuelto</dt>
                      <dd className="text-ink" data-numeric="">
                        {limpia(l.devuelto)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Disponible</dt>
                      <dd className="font-medium text-ink" data-numeric="">
                        {limpia(l.disponible)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">En depósito</dt>
                      <dd className="text-ink" data-numeric="">
                        {limpia(l.stockActual)}
                      </dd>
                    </div>
                  </dl>

                  {/*
                    Sin partidas: una sola casilla, como antes de la Fase 4D.

                    Con partidas: una por cada una, con SU disponible. Devolver
                    de otra partida sacaría del depósito mercadería que el
                    proveedor nunca mandó, y el costo histórico dejaría de
                    corresponder con lo que se devuelve.
                  */}
                  {l.lotes.length === 0 ? (
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <Field label="Devolver ahora" className="w-32">
                        <Input
                          value={cantidad}
                          inputMode="decimal"
                          disabled={enviando || sinNada}
                          aria-label={`Cantidad a devolver de ${l.productName}`}
                          onChange={(e) => {
                            setCantidades((prev) => ({
                              ...prev,
                              [clave(l.receiptItemId, 0)]: e.target.value,
                            }))
                          }}
                        />
                      </Field>

                      <div className="text-sm">
                        <div className="text-xs text-ink-faint">Costo original</div>
                        <div className="text-ink" data-numeric="">
                          <Money amount={Number(l.unitCost).toFixed(2)} />
                        </div>
                      </div>

                      <div className="text-sm">
                        <div className="text-xs text-ink-faint">Crédito</div>
                        <div className="font-medium text-ink" data-numeric="">
                          <Money amount={creditoDe(l, cantidad)} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-2">
                      {l.lotes.map((p) => {
                        const escrito = cantidades[clave(l.receiptItemId, p.lotId)] ?? ''
                        const agotada = Number(p.disponible) <= 0
                        return (
                          <li
                            key={p.lotId}
                            className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-sunken p-2.5"
                            data-testid="renglon-partida"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-mono text-sm text-ink">{p.code}</span>
                                {p.expirationDate !== null && (
                                  <span className="text-xs text-ink-faint">
                                    vence {p.expirationDate}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-ink-faint" data-numeric="">
                                Recibido {limpia(p.recibido)} · Devuelto {limpia(p.devuelto)} ·{' '}
                                <strong className="text-ink-muted">
                                  Disponible {limpia(p.disponible)}
                                </strong>
                              </div>
                            </div>

                            <Field label={`Devolver de ${p.code}`} labelHidden className="w-28">
                              <Input
                                value={escrito}
                                inputMode="decimal"
                                disabled={enviando || agotada}
                                aria-label={`Cantidad a devolver de ${l.productName}, partida ${p.code}`}
                                onChange={(e) => {
                                  setCantidades((prev) => ({
                                    ...prev,
                                    [clave(l.receiptItemId, p.lotId)]: e.target.value,
                                  }))
                                }}
                              />
                            </Field>

                            <div className="text-sm">
                              <div className="text-xs text-ink-faint">Crédito</div>
                              <div className="font-medium text-ink" data-numeric="">
                                <Money amount={creditoDe(l, escrito)} />
                              </div>
                            </div>
                          </li>
                        )
                      })}
                      <li className="text-xs text-ink-faint">
                        Costo original <Money amount={Number(l.unitCost).toFixed(2)} /> por{' '}
                        {NOMBRE_DE_UNIDAD_DE_COMPRA[unidad].toLowerCase()}. No cambia: se devuelve
                        al costo con el que entró.
                      </li>
                    </ul>
                  )}

                  {sinNada && (
                    <p className="mt-2 text-xs text-ink-muted">
                      Ya se devolvió todo lo que llegó de este producto.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {problema !== undefined && <Alert tone="warning">{problema}</Alert>}

        <Field label="Motivo" required hint={AYUDA_DE_MOTIVO[motivo]}>
          <Select
            value={motivo}
            disabled={enviando}
            onChange={(e) => {
              setMotivo(e.target.value as MotivoDeDevolucion)
            }}
          >
            {MOTIVOS_DE_DEVOLUCION.map((m) => (
              <option key={m} value={m}>
                {etiquetaDeMotivo(m)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Nota"
          required={notaObligatoria}
          hint="Lo que el motivo no alcanza a decir"
          error={notaObligatoria && nota.trim() === '' ? 'Con motivo "Otro", escribí cuál' : null}
        >
          <Textarea
            value={nota}
            rows={2}
            disabled={enviando}
            onChange={(e) => {
              setNota(e.target.value)
            }}
          />
        </Field>

        <div className="flex justify-between rounded-lg bg-surface-2 p-3">
          <span className="text-ink-muted">Crédito total</span>
          <span className="text-lg font-semibold text-ink" data-numeric="">
            <Money amount={credito} />
          </span>
        </div>
      </div>
    </Dialog>
  )
}
