'use client'

import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Money,
  Textarea,
  aviso,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { usePermiso } from '@/components/shell/SessionProvider'
import { aMilesimas, cantidadDesdeTexto, compararCantidades } from '@/lib/cantidad'
import { esPositivo, montoDesdeTexto, type Monto } from '@/lib/money'
import { parseResumenDeCuenta } from '@/modules/suppliers/dto.cuenta'
import { descripcionDeConversion } from '@/modules/purchases/conversion'
import { NOMBRE_DE_UNIDAD_DE_COMPRA } from '@/modules/products/units'
import type { DetalleOrdenDTO, LineaDTO } from '@/modules/purchases/dto'

/**
 * Recibir mercaderia.
 *
 * Por linea muestra los tres numeros que hacen falta para decidir --pedido,
 * recibido, pendiente-- y propone recibir TODO lo pendiente, que es el caso
 * normal. Recibir menos es un cambio de un campo; recibir de mas no se puede,
 * y el dialogo lo dice antes de mandar en vez de dejar que el servidor
 * responda un 409 que el cajero no puede interpretar.
 *
 * El costo solo aparece para quien puede cambiarlo. Sin
 * `products.cost.update` la recepcion entra al costo de la orden, que es lo
 * que el servidor va a hacer de todos modos.
 *
 * Ver docs/PURCHASE_RECEIVING.md.
 */

interface PartidaEscrita {
  code: string
  quantity: string
  expirationDate: string
}

interface EntradaLinea {
  cantidad: string
  costo: string
  /**
   * Las partidas declaradas para esta línea, EN UNIDAD DE COMPRA.
   *
   * Vacío significa "sin partidas", que es lo normal en un producto `NONE` y es
   * una elección explícita en uno `OPTIONAL`. En un `REQUIRED` no puede quedar
   * vacío ni sumar distinto de lo recibido.
   */
  partidas: PartidaEscrita[]
}

const SIN_PARTIDAS: EntradaLinea = { cantidad: '', costo: '', partidas: [] }

/** Cuánto suman las partidas escritas, en milésimas para comparar sin punto flotante. */
function sumaDePartidas(partidas: PartidaEscrita[]): number {
  return partidas.reduce(
    (s, p) => s + aMilesimas(cantidadDesdeTexto(p.quantity === '' ? '0' : p.quantity) ?? '0.000'),
    0,
  )
}

export function DialogoRecepcion({
  orden,
  abierto,
  onCerrar,
  onRecibido,
}: {
  orden: DetalleOrdenDTO | null
  abierto: boolean
  onCerrar: () => void
  onRecibido: () => void
}) {
  const puedeCambiarCosto = usePermiso('products.cost.update')
  const puedeVerCuenta = usePermiso('supplierAccounts.view')

  const [entradas, setEntradas] = useState<Record<number, EntradaLinea>>({})
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * El credito disponible del proveedor, y si se va a consumir. Objetivo 4.
   *
   * NO se aplica solo: la casilla arranca APAGADA. Aplicarlo en silencio hace
   * que el saldo baje sin que quien recibe entienda por que, y que un anticipo
   * reservado para otra compra desaparezca sin aviso.
   */
  const [credito, setCredito] = useState<Monto | null>(null)
  const [aplicarAnticipos, setAplicarAnticipos] = useState(false)

  // Solo las lineas que tienen algo pendiente: una que ya llego entera no
  // aporta nada al formulario y alarga la lista de la que hay que leer.
  const pendientes: LineaDTO[] =
    orden?.items.filter(
      (i) =>
        cantidadDesdeTexto(i.pendingQuantity) !== null &&
        compararCantidades(i.pendingQuantity, '0.000') > 0,
    ) ?? []

  useEffect(() => {
    if (!abierto || !orden) return
    const inicial: Record<number, EntradaLinea> = {}
    for (const i of orden.items) {
      if (compararCantidades(i.pendingQuantity, '0.000') <= 0) continue
      inicial[i.id] = {
        // Lo pendiente entero: es lo que pasa la mayoria de las veces.
        cantidad: i.pendingQuantity,
        costo: i.unitCost ?? '',
        // Un producto que EXIGE partidas arranca con una fila puesta: sin ella
        // la pantalla mostraría "faltan partidas" y un botón para agregarlas,
        // que es un paso de más para el caso normal --una entrega, una partida--.
        partidas:
          i.product.lotTracking === 'REQUIRED'
            ? [{ code: '', quantity: i.pendingQuantity, expirationDate: '' }]
            : [],
      }
    }
    setEntradas(inicial)
    setNotas('')
    setError(null)
    setEnviando(false)
    setAplicarAnticipos(false)
    setCredito(null)

    // El credito se pide al abrir y no antes: la mayoria de las recepciones no
    // tiene ninguno, y una consulta por cada pantalla de compra que se mira
    // seria pagar por el caso raro. Si falla, no se ofrece la casilla y la
    // recepcion sigue funcionando igual.
    if (!puedeVerCuenta) return
    let vivo = true
    void apiRequest(`/api/suppliers/${String(orden.supplier.id)}/cuenta/resumen`, {
      parse: parseResumenDeCuenta,
    })
      .then((cuenta) => {
        if (vivo && esPositivo(cuenta.sinImputar)) setCredito(cuenta.sinImputar)
      })
      // Silencio a proposito: es informacion adicional, no un requisito. Sin
      // credito la casilla no aparece y la recepcion funciona igual.
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [abierto, orden, puedeVerCuenta])

  function set(id: number, cambio: Partial<EntradaLinea>) {
    setEntradas((e) => ({ ...e, [id]: { ...(e[id] ?? SIN_PARTIDAS), ...cambio } }))
  }

  function setPartida(id: number, i: number, cambio: Partial<PartidaEscrita>) {
    setEntradas((e) => {
      const actual = e[id] ?? SIN_PARTIDAS
      return {
        ...e,
        [id]: {
          ...actual,
          partidas: actual.partidas.map((p, j) => (j === i ? { ...p, ...cambio } : p)),
        },
      }
    })
  }

  /** Que pasa con una linea segun lo que se escribio. */
  function estado(linea: LineaDTO) {
    const entrada = entradas[linea.id] ?? SIN_PARTIDAS
    const cantidad = cantidadDesdeTexto(entrada.cantidad)
    const costo = montoDesdeTexto(entrada.costo)
    const partidas = entrada.partidas

    // Las partidas, contra lo que se está recibiendo AHORA. La suma tiene que
    // cerrar exacta: una línea a medias asignar deja mercadería en el depósito
    // que el sistema no sabe de qué partida es.
    const asignado = sumaDePartidas(partidas)
    const recibiendo = cantidad === null ? 0 : aMilesimas(cantidad)
    const exigePartidas = linea.product.lotTracking === 'REQUIRED'
    const exigeFecha = linea.product.expirationTracking === 'REQUIRED'
    const partidasIncompletas = partidas.some(
      (p) =>
        p.code.trim() === '' || p.quantity.trim() === '' || (exigeFecha && p.expirationDate === ''),
    )
    const codigosRepetidos =
      new Set(partidas.map((p) => p.code.trim().toUpperCase()).filter((c) => c !== '')).size <
      partidas.filter((p) => p.code.trim() !== '').length
    const partidasMalSumadas = partidas.length > 0 && asignado !== recibiendo
    const faltanPartidas = exigePartidas && partidas.length === 0

    if (entrada.cantidad.trim() === '') {
      return {
        cantidad: null,
        costo,
        excede: false,
        vacia: true,
        partidas,
        asignado,
        recibiendo,
        exigePartidas,
        exigeFecha,
        partidasIncompletas,
        codigosRepetidos,
        partidasMalSumadas: false,
        faltanPartidas: false,
      }
    }
    return {
      cantidad,
      costo,
      // Se avisa ACA, no despues del 409: quien recibe tiene el camion en la
      // puerta y necesita saber el numero que si entra.
      excede: cantidad !== null && compararCantidades(cantidad, linea.pendingQuantity) > 0,
      vacia: false,
      partidas,
      asignado,
      recibiendo,
      exigePartidas,
      exigeFecha,
      partidasIncompletas,
      codigosRepetidos,
      partidasMalSumadas,
      faltanPartidas,
    }
  }

  const evaluadas = pendientes.map((l) => ({ linea: l, ...estado(l) }))
  const aRecibir = evaluadas.filter((e) => e.cantidad !== null && !e.excede)
  const hayExcesos = evaluadas.some((e) => e.excede)
  const hayInvalidas = evaluadas.some((e) => !e.vacia && e.cantidad === null)
  const hayPartidasMal = evaluadas.some(
    (e) =>
      !e.vacia &&
      (e.faltanPartidas || e.partidasMalSumadas || e.partidasIncompletas || e.codigosRepetidos),
  )
  const valido = aRecibir.length > 0 && !hayExcesos && !hayInvalidas && !hayPartidasMal

  async function confirmar() {
    if (!orden || enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest(`/api/purchases/${String(orden.id)}/receive`, {
        method: 'POST',
        body: {
          notes: notas.trim(),
          aplicarAnticipos,
          items: aRecibir.map((e) => ({
            orderItemId: e.linea.id,
            quantity: e.cantidad,
            // El costo solo viaja si se pudo tocar Y cambió. Mandarlo igual
            // no rompe nada, pero obligaria al servidor a exigir el permiso a
            // quien no cambió nada.
            ...(puedeCambiarCosto && e.costo !== null && e.costo !== e.linea.unitCost
              ? { unitCost: e.costo }
              : {}),
            // Las partidas viajan sólo si hay: `lots: []` no es lo mismo que
            // no mandar el campo, y el servidor distingue "sin partidas" de
            // "partidas vacías".
            ...(e.partidas.length > 0
              ? {
                  lots: e.partidas.map((p) => ({
                    code: p.code.trim(),
                    quantity: p.quantity,
                    ...(p.expirationDate === '' ? {} : { expirationDate: p.expirationDate }),
                  })),
                }
              : {}),
          })),
        },
        parse: () => null,
      })
      aviso.ok('Mercadería recibida')
      onRecibido()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar la recepción.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto && orden !== null}
      onClose={onCerrar}
      title={orden ? `Recibir mercadería — ${orden.number}` : 'Recibir mercadería'}
      size="lg"
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
            onClick={() => void confirmar()}
          >
            Confirmar recepción
          </Button>
        </>
      }
    >
      {orden && (
        <div className="flex flex-col gap-4">
          {error !== null && (
            <Alert tone="danger" title="No se recibió">
              {error}
            </Alert>
          )}

          {pendientes.length === 0 && (
            <Alert tone="info" title="No queda nada pendiente">
              Todas las líneas de esta orden ya llegaron.
            </Alert>
          )}

          {evaluadas.map((e) => (
            <div
              key={e.linea.id}
              className="flex flex-col gap-3 rounded-lg border border-line bg-sunken p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink">{e.linea.product.name}</span>
                <span className="text-xs text-ink-faint" data-numeric="">
                  Pedido {e.linea.orderedQuantity} · Recibido {e.linea.receivedQuantity} ·{' '}
                  <strong className="text-ink-muted">Pendiente {e.linea.pendingQuantity}</strong>{' '}
                  {NOMBRE_DE_UNIDAD_DE_COMPRA[e.linea.purchaseUnit].toLowerCase()}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`Recibir ahora (${NOMBRE_DE_UNIDAD_DE_COMPRA[e.linea.purchaseUnit].toLowerCase()})`}
                  error={
                    e.excede
                      ? `No se puede recibir más de lo pendiente (${e.linea.pendingQuantity})`
                      : !e.vacia && e.cantidad === null
                        ? 'No es una cantidad válida'
                        : null
                  }
                  hint={
                    e.cantidad === null || e.excede
                      ? undefined
                      : descripcionDeConversion(
                          e.linea.product.saleUnit,
                          e.linea.purchaseUnit,
                          e.cantidad,
                          e.linea.unitsPerPurchaseUnit,
                        ) || undefined
                  }
                >
                  <Input
                    inputMode="decimal"
                    value={entradas[e.linea.id]?.cantidad ?? ''}
                    disabled={enviando}
                    onChange={(ev) => {
                      set(e.linea.id, { cantidad: ev.target.value.replace(/[^0-9.,]/g, '') })
                    }}
                  />
                </Field>

                {puedeCambiarCosto && e.linea.unitCost !== undefined && (
                  <Field
                    label="Costo de factura"
                    hint={
                      e.costo !== null && e.linea.unitCost !== null && e.costo !== e.linea.unitCost
                        ? `La orden decía ${e.linea.unitCost}. La diferencia queda registrada.`
                        : 'Cambialo solo si la factura dice otra cosa.'
                    }
                  >
                    <Input
                      inputMode="decimal"
                      value={entradas[e.linea.id]?.costo ?? ''}
                      disabled={enviando}
                      onChange={(ev) => {
                        set(e.linea.id, { costo: ev.target.value.replace(/[^0-9.,]/g, '') })
                      }}
                    />
                  </Field>
                )}
              </div>

              {/*
                Las partidas de la línea. Fase 4D.

                Se declaran POR CÓDIGO y no eligiendo de una lista, y no es un
                descuido: la mercadería que está llegando trae partidas que el
                sistema no vio nunca. El operario lee el código del envase.
                Obligarlo a darlas de alta antes en otra pantalla es el camino
                seguro a que nadie use la función.

                En un producto `NONE` este bloque no existe. En uno `OPTIONAL`
                aparece con "Sin partida" ya elegido, y agregar partidas es una
                decisión explícita.
              */}
              {e.linea.product.lotTracking !== 'NONE' && !e.vacia && (
                <div className="flex flex-col gap-2 rounded-md border border-line-strong bg-raised p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                      Partidas
                    </span>
                    <span className="text-xs text-ink-faint" data-numeric="">
                      Asignado {(e.asignado / 1000).toFixed(3)} · Pendiente{' '}
                      <strong
                        className={
                          e.recibiendo - e.asignado === 0 ? 'text-success' : 'text-warning'
                        }
                      >
                        {((e.recibiendo - e.asignado) / 1000).toFixed(3)}
                      </strong>{' '}
                      {NOMBRE_DE_UNIDAD_DE_COMPRA[e.linea.purchaseUnit].toLowerCase()}
                    </span>
                  </div>

                  {e.partidas.length === 0 && (
                    <p className="text-xs text-ink-faint">
                      Sin partida. Esta entrega entra al stock sin identificar de qué lote es.
                    </p>
                  )}

                  {e.partidas.map((p, i) => (
                    <div
                      // La posición ES la identidad: las filas se agregan y se
                      // quitan por índice y no tienen ninguna clave propia.
                      // eslint-disable-next-line react/no-array-index-key
                      key={i}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem_9rem_auto]"
                    >
                      <Field label={`Código de la partida ${String(i + 1)}`} labelHidden>
                        <Input
                          value={p.code}
                          placeholder="Código del lote"
                          className="font-mono"
                          disabled={enviando}
                          onChange={(ev) => {
                            setPartida(e.linea.id, i, { code: ev.target.value })
                          }}
                        />
                      </Field>
                      <Field label={`Cantidad de la partida ${String(i + 1)}`} labelHidden>
                        <Input
                          inputMode="decimal"
                          value={p.quantity}
                          placeholder={NOMBRE_DE_UNIDAD_DE_COMPRA[e.linea.purchaseUnit]}
                          disabled={enviando}
                          onChange={(ev) => {
                            setPartida(e.linea.id, i, {
                              quantity: ev.target.value.replace(/[^0-9.,]/g, ''),
                            })
                          }}
                        />
                      </Field>
                      <Field label={`Vencimiento de la partida ${String(i + 1)}`} labelHidden>
                        <Input
                          type="date"
                          value={p.expirationDate}
                          disabled={enviando || e.linea.product.expirationTracking === 'NONE'}
                          onChange={(ev) => {
                            setPartida(e.linea.id, i, { expirationDate: ev.target.value })
                          }}
                        />
                      </Field>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={enviando}
                        onClick={() => {
                          set(e.linea.id, {
                            partidas: e.partidas.filter((_, j) => j !== i),
                          })
                        }}
                      >
                        Quitar
                      </Button>
                    </div>
                  ))}

                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={enviando || e.partidas.length >= 20}
                      onClick={() => {
                        set(e.linea.id, {
                          partidas: [
                            ...e.partidas,
                            {
                              code: '',
                              // La primera propone todo lo que se recibe; las
                              // siguientes, lo que falta.
                              quantity:
                                e.partidas.length === 0
                                  ? (entradas[e.linea.id]?.cantidad ?? '')
                                  : ((e.recibiendo - e.asignado) / 1000).toFixed(3),
                              expirationDate: '',
                            },
                          ],
                        })
                      }}
                    >
                      Agregar partida
                    </Button>
                  </div>

                  {e.faltanPartidas && (
                    <p role="alert" className="text-xs font-medium text-danger">
                      Este producto exige partidas: no se puede recibir sin decir de cuál es.
                    </p>
                  )}
                  {e.partidasMalSumadas && (
                    <p role="alert" className="text-xs font-medium text-danger">
                      Las partidas tienen que sumar exactamente lo que se recibe.
                    </p>
                  )}
                  {e.partidasIncompletas && (
                    <p role="alert" className="text-xs font-medium text-danger">
                      {e.exigeFecha
                        ? 'Cada partida necesita código, cantidad y vencimiento.'
                        : 'Cada partida necesita código y cantidad.'}
                    </p>
                  )}
                  {e.codigosRepetidos && (
                    <p role="alert" className="text-xs font-medium text-danger">
                      Hay dos partidas con el mismo código: sumalas en una sola línea.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}

          {/*
            El credito disponible del proveedor. Objetivo 4: se MUESTRA y se
            pregunta, nunca se aplica en silencio. Quien recibe tiene que
            enterarse de que está consumiendo un anticipo.
          */}
          {credito !== null && pendientes.length > 0 && (
            <div className="rounded-lg border border-primary/35 bg-primary-quiet p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-ink">Crédito disponible del proveedor</span>
                <span className="text-lg font-semibold text-ink" data-numeric="">
                  <Money amount={credito} />
                </span>
              </div>
              <Checkbox
                className="mt-2"
                checked={aplicarAnticipos}
                disabled={enviando}
                label="Aplicar automáticamente a esta entrega"
                description="Se consumen del pago más antiguo hacia el más nuevo. No cambia el saldo: esa plata ya se entregó."
                onChange={(e) => {
                  setAplicarAnticipos(e.target.checked)
                }}
              />
            </div>
          )}

          {pendientes.length > 0 && (
            <Field label="Notas" hint="Remito, transportista, lo que convenga anotar">
              <Textarea
                rows={2}
                value={notas}
                disabled={enviando}
                onChange={(e) => {
                  setNotas(e.target.value)
                }}
              />
            </Field>
          )}

          {aRecibir.length > 0 && (
            <Alert tone="info">
              Van a entrar {aRecibir.length} línea(s) al stock. La recepción no se puede editar
              después: un error se corrige con un ajuste de inventario.
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  )
}
