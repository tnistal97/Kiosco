'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  Money,
  Select,
  formatMoney,
} from '@/components/ui'
import type { CartLine } from '@/store/cart'
import {
  CERO,
  esCero,
  esNegativo,
  esPositivo,
  montoDesdeTexto,
  restarMontos,
  sumarMontos,
  type Monto,
} from '@/lib/money'
import { precioPorCantidad } from '@/lib/cantidad'
import { formatearCantidadConUnidad } from '@/modules/products/units'
import {
  MEDIOS_COBRABLES,
  esCuenta,
  esEfectivo,
  etiquetaDeMedio,
  type MedioCobrable,
} from '@/modules/sales/payment-methods'
import { usePermiso } from '@/components/shell/SessionProvider'
import { SelectorDeCliente } from './SelectorDeCliente'
import { apiRequest } from '@/lib/api-client'
import {
  parseEstadoDeCredito,
  type ClienteDTO,
  type EstadoDeCreditoDTO,
} from '@/modules/clients/dto'

/**
 * Cobro, con pago combinado.
 *
 * Desde la Fase 3 una venta puede cobrarse con varios medios. El caso que da
 * sentido a todo:
 *
 *   Total: $32.000     Efectivo $12.000 + Transferencia $20.000
 *
 * La caja fisica sube $12.000, NO $32.000. Eso lo decide el servidor; lo que
 * hace esta pantalla es no dejar enviar una venta cuyos pagos no sumen el
 * total, para que el rechazo no llegue con el cliente enfrente.
 *
 * El restante se calcula en centavos enteros. En punto flotante,
 * `32000 - 12000 - 19999.99` da 0.00999999999839929, y compararlo contra cero
 * para habilitar el boton dejaria pasar una venta con un centavo de menos.
 *
 * Proteccion contra el doble cobro, que es lo que de verdad importa aca:
 *
 *  - el boton se bloquea en cuanto se envia y no se libera si la peticion
 *    salio bien;
 *  - el dialogo deja de cerrarse mientras la venta esta en vuelo, asi que ni
 *    Escape ni un clic afuera dejan la pantalla en un estado ambiguo;
 *  - F12 y Enter pasan por el mismo camino que el boton.
 */

/** Un renglon de pago mientras se arma. Los importes son texto: se tipean. */
interface LineaDePago {
  /** Identificador local, para poder quitar el renglon correcto. */
  clave: number
  method: MedioCobrable
  /** Vacio significa "lo que reste". Se resuelve al enviar. */
  importe: string
  /** Solo en efectivo: con cuanto paga. */
  recibido: string
}

export interface PagoParaEnviar {
  method: MedioCobrable
  amount: Monto
  cashReceived?: Monto
}

export interface VentaHecha {
  id: number
  total: Monto
  pagos: Array<{ label: string; amount: Monto }>
  vuelto: Monto | null
}

function nuevaLinea(clave: number, method: MedioCobrable = 'CASH'): LineaDePago {
  return { clave, method, importe: '', recibido: '' }
}

/** Lo que acompania a los pagos: a quien se le vende y si se autorizo el exceso. */
export interface ExtraDeVenta {
  clientId: number | null
  autorizarExcesoDeCredito: boolean
}

/** Si el estado de credito consultado decia que no entraba. */
function frenadoPorLimiteAlEnviar(credito: EstadoDeCreditoDTO | null): boolean {
  return credito !== null && !credito.entra
}

export function DialogoCobro({
  abierto,
  onCerrar,
  lineas,
  total,
  onCobrar,
  onNuevaVenta,
}: {
  abierto: boolean
  onCerrar: () => void
  lineas: CartLine[]
  total: Monto
  /** Devuelve el numero de venta. Lanza si el servidor la rechaza. */
  onCobrar: (pagos: PagoParaEnviar[], extra: ExtraDeVenta) => Promise<number>
  /** Cierra el resultado y deja la caja lista para la proxima. */
  onNuevaVenta: () => void
}) {
  const [pagos, setPagos] = useState<LineaDePago[]>([nuevaLinea(0)])
  const [siguienteClave, setSiguienteClave] = useState(1)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecha, setHecha] = useState<VentaHecha | null>(null)

  const [cliente, setCliente] = useState<ClienteDTO | null>(null)
  const [credito, setCredito] = useState<EstadoDeCreditoDTO | null>(null)
  const [autorizarExceso, setAutorizarExceso] = useState(false)
  const puedeAutorizar = usePermiso('accounts.overrideLimit')

  const botonCobrar = useRef<HTMLButtonElement>(null)

  // Cada apertura arranca limpia. Sin esto, el vuelto de la venta anterior
  // sigue escrito en el campo.
  useEffect(() => {
    if (!abierto) return
    setPagos([nuevaLinea(0)])
    setSiguienteClave(1)
    setError(null)
    setHecha(null)
    setEnviando(false)
    setCliente(null)
    setCredito(null)
    setAutorizarExceso(false)
  }, [abierto])

  /**
   * Importes resueltos.
   *
   * El renglon con el importe vacio se lleva lo que reste. Es el caso normal
   * --un solo pago por el total-- y evita que el cajero tenga que tipear el
   * total para cobrarlo entero.
   */
  const resueltos = useMemo(() => {
    const declarados = pagos.map((p) => montoDesdeTexto(p.importe))
    const sumaDeclarada = declarados.reduce<Monto>(
      (acc, m) => (m === null ? acc : sumarMontos(acc, m)),
      CERO,
    )
    const resto = restarMontos(total, sumaDeclarada)
    const sinDeclarar = declarados.filter((m) => m === null).length

    return pagos.map((p, i) => {
      const declarado = declarados[i]
      if (declarado !== null && declarado !== undefined) return { ...p, monto: declarado }
      // Si hay mas de un renglon sin importe, solo el PRIMERO toma el resto:
      // repartirlo seria adivinar.
      const esElPrimeroSinDeclarar = declarados.findIndex((m) => m === null) === i
      const monto = esElPrimeroSinDeclarar && sinDeclarar >= 1 && !esNegativo(resto) ? resto : CERO
      return { ...p, monto }
    })
  }, [pagos, total])

  const sumaDePagos = useMemo(() => sumarMontos(...resueltos.map((p) => p.monto)), [resueltos])
  const restante = restarMontos(total, sumaDePagos)
  const cuadra = esCero(restante)
  const seFueDeMano = esNegativo(restante)

  /** Vuelto de cada renglon en efectivo con "recibido" declarado. */
  const vueltos = useMemo(
    () =>
      resueltos.map((p) => {
        if (!esEfectivo(p.method)) return null
        const recibido = montoDesdeTexto(p.recibido)
        if (recibido === null || !esPositivo(recibido)) return null
        return restarMontos(recibido, p.monto)
      }),
    [resueltos],
  )

  const vueltoTotal = useMemo(
    () => sumarMontos(...vueltos.map((v) => (v === null || esNegativo(v) ? CERO : v))),
    [vueltos],
  )

  const faltaEnAlgunEfectivo = vueltos.some((v) => v !== null && esNegativo(v))

  /** Cuanto de esta venta se esta fiando. Cero si no hay ninguna linea a cuenta. */
  const aCuenta = useMemo(
    () => sumarMontos(...resueltos.filter((p) => esCuenta(p.method)).map((p) => p.monto)),
    [resueltos],
  )
  const hayFiado = esPositivo(aCuenta)

  // El servidor calcula el estado de credito, y la pantalla lo muestra. No se
  // replican las tres condiciones aca: replicarlas garantizaria que algun dia
  // digan cosas distintas. Es una PREVISUALIZACION, no una reserva: la
  // comprobacion que decide sigue estando dentro de la transaccion de la venta.
  useEffect(() => {
    if (!hayFiado || cliente === null) {
      setCredito(null)
      return
    }
    let vigente = true
    void apiRequest(
      `/api/clients/${String(cliente.id)}/credito?monto=${encodeURIComponent(aCuenta)}`,
      { parse: parseEstadoDeCredito },
    )
      .then((e) => {
        if (vigente) setCredito(e)
      })
      .catch(() => {
        if (vigente) setCredito(null)
      })
    return () => {
      vigente = false
    }
  }, [hayFiado, cliente, aCuenta])

  // Fiar sin cliente no se puede: el servidor lo rechaza con
  // ACCOUNT_SALE_NEEDS_CLIENT, y frenar el boton aca evita que el cajero lo
  // descubra recien al confirmar, con el cliente enfrente.
  const faltaCliente = hayFiado && cliente === null
  // Y si se pasa del limite, hace falta que alguien lo autorice.
  const frenadoPorLimite = credito !== null && !credito.entra && !autorizarExceso

  const puedeCobrar =
    cuadra && !faltaEnAlgunEfectivo && !faltaCliente && !frenadoPorLimite && !enviando

  function actualizar(clave: number, cambio: Partial<LineaDePago>) {
    setPagos((actuales) => actuales.map((p) => (p.clave === clave ? { ...p, ...cambio } : p)))
  }

  function agregarMedio() {
    // El renglon nuevo arranca con el restante ya escrito: es lo que se quiere
    // el 90 % de las veces, y se puede corregir.
    const yaUsados = new Set(pagos.map((p) => p.method))
    const sugerido = MEDIOS_COBRABLES.find((m) => !yaUsados.has(m)) ?? 'OTHER'
    setPagos((actuales) => [...actuales, { ...nuevaLinea(siguienteClave, sugerido), importe: '' }])
    setSiguienteClave((n) => n + 1)
  }

  function quitar(clave: number) {
    setPagos((actuales) =>
      actuales.length === 1 ? actuales : actuales.filter((p) => p.clave !== clave),
    )
  }

  async function cobrar() {
    if (!puedeCobrar || hecha) return
    setEnviando(true)
    setError(null)
    try {
      const aEnviar: PagoParaEnviar[] = resueltos
        .filter((p) => esPositivo(p.monto))
        .map((p) => {
          const recibido = esEfectivo(p.method) ? montoDesdeTexto(p.recibido) : null
          return {
            method: p.method,
            amount: p.monto,
            ...(recibido !== null && !esNegativo(restarMontos(recibido, p.monto))
              ? { cashReceived: recibido }
              : {}),
          }
        })

      const id = await onCobrar(aEnviar, {
        clientId: cliente?.id ?? null,
        // Solo se manda cuando de verdad hizo falta: mandarlo siempre
        // convertiria la autorizacion en un adorno, y el servidor la exige
        // igual --pedirla sin el permiso es un 403--.
        autorizarExcesoDeCredito: autorizarExceso && frenadoPorLimiteAlEnviar(credito),
      })
      setHecha({
        id,
        total,
        pagos: aEnviar.map((p) => ({ label: etiquetaDeMedio(p.method), amount: p.amount })),
        vuelto: esCero(vueltoTotal) ? null : vueltoTotal,
      })
      // A proposito no se libera `enviando`: la venta ya existe y el boton no
      // debe volver a estar disponible.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta.')
      setEnviando(false)
    }
  }

  if (hecha) {
    return (
      <Dialog
        open={abierto}
        onClose={onNuevaVenta}
        title="Venta registrada"
        size="sm"
        footer={
          <Button variant="confirm" size="lg" block onClick={onNuevaVenta}>
            Nueva venta
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-1 rounded-lg bg-success-quiet py-5">
            <span aria-hidden="true" className="text-3xl text-success">
              ✓
            </span>
            <p className="text-sm text-ink-muted">
              Venta{' '}
              <span className="font-semibold text-ink" data-numeric="">
                #{hecha.id}
              </span>
            </p>
            <Money amount={hecha.total} size="xl" />
          </div>

          <dl className="flex flex-col gap-2 text-sm">
            {hecha.pagos.map((p, i) => (
              // El indice como clave: dos pagos pueden compartir medio e
              // importe --$5.000 en efectivo y otros $5.000 en efectivo-- y no
              // hay nada mas que los distinga. La lista es de solo lectura y no
              // se reordena, asi que el indice es estable.
              // eslint-disable-next-line react/no-array-index-key
              <div key={`${p.label}-${i}`} className="flex justify-between gap-3">
                <dt className="text-ink-muted">{p.label}</dt>
                <dd>
                  <Money amount={p.amount} size="sm" />
                </dd>
              </div>
            ))}
            {hecha.vuelto !== null && (
              <div className="flex justify-between gap-3 border-t border-line pt-2">
                <dt className="text-ink-muted">Vuelto</dt>
                <dd>
                  <Money amount={hecha.vuelto} size="md" />
                </dd>
              </div>
            )}
          </dl>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Cobrar"
      size="md"
      dismissible={!enviando}
      initialFocus={botonCobrar}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Volver
          </Button>
          <Button
            ref={botonCobrar}
            variant="confirm"
            size="lg"
            loading={enviando}
            disabled={!puedeCobrar}
            onClick={() => void cobrar()}
            className="sm:min-w-48"
          >
            {enviando ? 'Registrando…' : `Cobrar ${formatMoney(total)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="No se registró la venta">
            {error} Podés reintentar; no se cobró nada.
          </Alert>
        )}

        <div className="rounded-lg border border-line bg-sunken">
          <ul className="max-h-40 divide-y divide-line overflow-y-auto px-3">
            {lineas.map((l) => (
              <li key={l.productId} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-16 shrink-0 text-right text-ink-muted" data-numeric="">
                  {formatearCantidadConUnidad(l.quantity, l.saleUnit)}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">{l.name}</span>
                <Money amount={precioPorCantidad(l.price, l.quantity)} size="sm" />
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-line px-3 py-3">
            <span className="text-sm text-ink-muted">Total</span>
            <Money amount={total} size="hero" />
          </div>
        </div>

        {/*
          El cliente. Va ARRIBA de los medios y no adentro: una venta puede
          tener cliente sin tener fiado --queda asociada a su historial-- y el
          fiado no es lo unico que lo justifica.

          Cuando hay una linea `ACCOUNT`, el selector pasa a ser obligatorio y
          se abre solo: una deuda sin deudor no se puede cobrar.
        */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">
            Cliente {hayFiado && <span className="text-danger">*</span>}
          </span>
          <SelectorDeCliente
            cliente={cliente}
            obligatorio={hayFiado}
            deshabilitado={enviando}
            onElegir={(c) => {
              setCliente(c)
              setAutorizarExceso(false)
            }}
          />
        </div>

        {/*
          Los cinco numeros del objetivo 23, mostrados ANTES de confirmar. Un
          409 pelado obliga a quien atiende a adivinar por que no se pudo, con
          el cliente enfrente.
        */}
        {credito !== null && (
          <div
            className={
              credito.entra
                ? 'rounded-lg border border-line bg-sunken p-3 text-sm'
                : 'rounded-lg border border-danger bg-danger-quiet p-3 text-sm'
            }
          >
            <div className="mb-1 font-medium text-ink">{credito.name}</div>
            <dl className="flex flex-col gap-1">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Saldo actual</dt>
                <dd data-numeric="">
                  <Money amount={credito.balance.replace('-', '')} size="sm" />
                  {esNegativo(credito.balance) && ' a favor'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Compra a cuenta</dt>
                <dd data-numeric="">
                  <Money amount={aCuenta} size="sm" />
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
                <dt className="text-ink-muted">Saldo resultante</dt>
                <dd data-numeric="">
                  <Money amount={credito.saldoResultante.replace('-', '')} size="sm" />
                  {esNegativo(credito.saldoResultante) && ' a favor'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Límite</dt>
                <dd data-numeric="">
                  {credito.creditLimit === null ? (
                    <span className="text-ink-faint">Sin límite</span>
                  ) : (
                    <Money amount={credito.creditLimit} size="sm" />
                  )}
                </dd>
              </div>
              {credito.disponible !== null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Disponible después</dt>
                  <dd data-numeric="">
                    <Money
                      amount={
                        credito.entra
                          ? restarMontos(credito.disponible, aCuenta)
                          : credito.disponible
                      }
                      size="sm"
                    />
                  </dd>
                </div>
              )}
            </dl>

            {!credito.entra && credito.motivo !== null && (
              <p className="mt-2 font-medium text-danger">{credito.motivo}</p>
            )}
          </div>
        )}

        {/*
          El override. NO es una casilla escondida: aparece solo cuando de
          verdad se necesita, dice que va a quedar registrado, y solo la ve
          quien tiene el permiso. Quien no lo tiene ve por que no se puede y a
          quien pedirselo.
        */}
        {credito !== null && !credito.entra && puedeAutorizar && (
          <Alert tone="warning" title="Se pasa del límite">
            <label className="mt-1 flex items-start gap-2">
              <input
                type="checkbox"
                checked={autorizarExceso}
                disabled={enviando}
                onChange={(e) => {
                  setAutorizarExceso(e.target.checked)
                }}
              />
              <span>
                Autorizo esta venta por encima del límite. Va a quedar registrado con mi nombre.
              </span>
            </label>
          </Alert>
        )}
        {credito !== null && !credito.entra && !puedeAutorizar && (
          <Alert tone="danger" title="Se pasa del límite">
            Hace falta que lo autorice un encargado.
          </Alert>
        )}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-ink">Cómo paga</legend>

          {resueltos.map((p, i) => (
            <div key={p.clave} className="flex flex-wrap items-end gap-2">
              <Field label="Medio" className="min-w-36 flex-1">
                <Select
                  value={p.method}
                  disabled={enviando}
                  onChange={(e) => {
                    actualizar(p.clave, { method: e.target.value as MedioCobrable, recibido: '' })
                  }}
                >
                  {MEDIOS_COBRABLES.map((m) => (
                    <option key={m} value={m}>
                      {etiquetaDeMedio(m)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Importe"
                className="min-w-28 flex-1"
                hint={pagos.length === 1 ? 'Vacío = el total' : undefined}
              >
                <Input
                  inputMode="decimal"
                  placeholder={p.monto}
                  value={p.importe}
                  disabled={enviando}
                  onChange={(e) => {
                    actualizar(p.clave, { importe: e.target.value })
                  }}
                />
              </Field>

              {esEfectivo(p.method) && (
                <Field label="Con cuánto paga" className="min-w-28 flex-1">
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={p.recibido}
                    disabled={enviando}
                    onChange={(e) => {
                      actualizar(p.clave, { recibido: e.target.value })
                    }}
                  />
                </Field>
              )}

              {pagos.length > 1 && (
                <IconButton
                  label={`Quitar el pago con ${etiquetaDeMedio(p.method)}`}
                  variant="danger"
                  disabled={enviando}
                  onClick={() => {
                    quitar(p.clave)
                  }}
                >
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14" />
                  </svg>
                </IconButton>
              )}

              {vueltos[i] !== null && vueltos[i] !== undefined && !esNegativo(vueltos[i]) && (
                <p className="w-full text-sm text-ink-muted">
                  Vuelto: <Money amount={vueltos[i]} size="sm" />
                </p>
              )}
            </div>
          ))}

          {pagos.length < MEDIOS_COBRABLES.length && (
            <Button
              variant="ghost"
              size="sm"
              disabled={enviando}
              onClick={agregarMedio}
              className="self-start"
            >
              + Agregar otro medio
            </Button>
          )}
        </fieldset>

        {/*
          El restante, siempre a la vista. Es lo unico que decide si el boton
          de cobrar esta habilitado, asi que tiene que poder leerse sin buscar.
        */}
        <div
          className={
            cuadra
              ? 'flex items-baseline justify-between rounded-lg border border-line bg-raised px-4 py-3'
              : 'flex items-baseline justify-between rounded-lg border border-warning/45 bg-warning-quiet px-4 py-3'
          }
        >
          <span className="text-sm text-ink-muted">
            {cuadra ? 'Cubierto' : seFueDeMano ? 'Se pasa por' : 'Restante'}
          </span>
          {cuadra ? (
            <span className="text-sm font-medium text-success">✓ Todo cubierto</span>
          ) : (
            <Money
              amount={seFueDeMano ? restarMontos(CERO, restante) : restante}
              size="xl"
              tone="out"
            />
          )}
        </div>

        {faltaEnAlgunEfectivo && (
          <Alert tone="warning">
            En un pago en efectivo se recibió menos de lo que ese pago cubre.
          </Alert>
        )}
      </div>
    </Dialog>
  )
}

/** Compat: la pantalla de venta todavia nombra el tipo del medio. */
export type { MedioCobrable as MedioDePago }
