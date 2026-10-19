'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  Kbd,
  Money,
  MoneyInput,
  aviso,
  cn,
  formatMoney,
} from '@/components/ui'
import type { CartLine } from '@/store/cart'
import {
  CERO,
  absMonto,
  esCero,
  esNegativo,
  esPositivo,
  montoDesdeTexto,
  restarMontos,
  sumarMontos,
  textoLocalDeMonto,
  type Monto,
} from '@/lib/money'
import { precioPorCantidad } from '@/lib/cantidad'
import { formatearCantidadConUnidad } from '@/modules/products/units'
import {
  MEDIOS_COBRABLES,
  esCuenta,
  esEfectivo,
  type MedioCobrable,
} from '@/modules/sales/payment-methods'
import { usePermiso } from '@/components/shell/SessionProvider'
import { SelectorDeCliente } from './SelectorDeCliente'
import {
  OPCION_OTRO,
  PaymentSelector,
  etiquetaDePago,
  opcionDeTecla,
  type OpcionDeCobro,
} from './PaymentSelector'
import { pagoDeclarado, sugerenciasDeRecibido } from './cobro'
import { esEditable } from './foco'
import { enterAvanza } from './teclado'
import { apiRequest } from '@/lib/api-client'
import {
  parseEstadoDeCredito,
  type ClienteDTO,
  type EstadoDeCreditoDTO,
} from '@/modules/clients/dto'

/**
 * Cobro. V6 (sobre la V5 y la V2). Es la tercera etapa de la venta.
 *
 * Tres pasos, de arriba hacia abajo, y cada Enter avanza UNO:
 *
 *   1. TOTAL, grande.
 *   2. ¿Cómo paga? Seis botones grandes. Las flechas recorren; Enter elige
 *      y lleva al paso 3 (en efectivo, a "Recibido"; si no, a Confirmar).
 *   3. En efectivo: RECIBIDO y VUELTO. Enter en "Recibido" NO cobra (V6): si
 *      el importe alcanza, lleva el foco a CONFIRMAR VENTA y muestra el
 *      vuelto; si no se escribio nada, pone el importe justo. El Enter
 *      siguiente, ya sobre "Confirmar venta", registra la venta.
 *
 * Un Enter repetido (tecla sostenida) o demasiado pegado al anterior --menos
 * de `PAUSA_ENTRE_ETAPAS_MS`-- no hace nada: se descarta antes de que lo vea
 * cualquier control (`onKeyDownCapture`). Es lo que impide que un doble Enter
 * rapido elija la forma de pago y confirme la venta de un saque. El mouse no
 * tiene esa espera: un clic en "Confirmar venta" es siempre deliberado.
 *
 * Lo que casi nunca se usa --otro medio, dividir el pago, asignar la venta a
 * un cliente-- esta en "Más opciones". El cliente aparece solo si se elige
 * Fiado, que es cuando hace falta.
 *
 * Al terminar: si hay vuelto que dar, se muestra grande hasta que se apriete
 * Nueva venta (Enter). Si no hay vuelto, no hay nada que mirar: el cobro se
 * cierra solo, avisa "Venta registrada" y la caja queda lista.
 *
 * Lo que se ve: el total en grande, los medios como botones, y --en
 * efectivo-- "paga con" con el foco puesto, tres importes rapidos y el vuelto
 * en grande. El pie es fijo: "Cobrar" se ve siempre, en 1366 x 768 y en un
 * telefono (auditoria, H-01, H-16, H-17).
 *
 * Lo que NO cambio, porque esta probado y es dinero de verdad:
 *
 *  - una venta puede cobrarse con varios medios ("Dividir el pago"), y esta
 *    pantalla no deja enviar una cuyos pagos no sumen el total;
 *  - el restante se calcula en centavos enteros, nunca en punto flotante;
 *  - el boton se bloquea en cuanto se envia y no se libera si salio bien;
 *  - el dialogo no se cierra con la venta en vuelo;
 *  - el precio, el total y el reparto los decide el servidor.
 *
 * Teclado: E T M D C F O eligen el medio (tambien mientras se escribe con
 * cuanto paga), J pone el importe justo, Enter avanza un paso, Escape vuelve
 * al carrito sin perder nada.
 *
 * ENTER NO COBRA SI NADIE DIJO COMO SE PAGA (V3). El dialogo se abre con
 * efectivo por el total, y eso es una SUPOSICION comoda, no un importe
 * cargado: el "6.560,00" gris del campo era un placeholder y se leia como un
 * valor. Ahora hace falta declarar --escribir el importe, tocar Justo o un
 * billete, o elegir un medio-- y recien ahi Enter confirma; ver
 * `pagoDeclarado` en `cobro.ts`. El boton "Cobrar $ X" se puede apretar
 * igual: apretarlo YA es declarar que se cobra asi.
 */

/** Un renglon de pago mientras se arma. Los importes son texto: se tipean. */
interface LineaDePago {
  /** Identificador local, para poder quitar el renglon correcto. */
  clave: number
  method: MedioCobrable
  /** Referencia del pago: "Mercado Pago" es una transferencia con referencia. */
  referencia: string | null
  /** Vacio significa "lo que reste". Se resuelve al enviar. */
  importe: string
  /** Solo en efectivo: con cuanto paga. */
  recibido: string
}

export interface PagoParaEnviar {
  method: MedioCobrable
  amount: Monto
  cashReceived?: Monto
  reference?: string
}

export interface VentaHecha {
  id: number
  total: Monto
  pagos: Array<{ label: string; amount: Monto }>
  vuelto: Monto | null
}

function nuevaLinea(
  clave: number,
  method: MedioCobrable = 'CASH',
  referencia: string | null = null,
): LineaDePago {
  return { clave, method, referencia, importe: '', recibido: '' }
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

/** En que paso del cobro esta el foco: decide la ayuda de teclas que se muestra. */
type PasoDelCobro = 'medio' | 'recibido' | 'confirmar' | 'otro'

/** Lo que hacen las teclas en cada paso del cobro. Discreto: una linea. */
function AyudaDelCobro({ paso }: { paso: PasoDelCobro }) {
  switch (paso) {
    case 'medio':
      return (
        <>
          <Kbd>←</Kbd> <Kbd>→</Kbd> forma de pago · <Kbd>Enter</Kbd> continuar · <Kbd>Esc</Kbd>{' '}
          volver al carrito
        </>
      )
    case 'recibido':
      return (
        <>
          Escribí con cuánto paga · <Kbd>Enter</Kbd> continuar · <Kbd>Esc</Kbd> volver al carrito
        </>
      )
    case 'confirmar':
      return (
        <>
          <Kbd>Enter</Kbd> confirmar la venta · <Kbd>Esc</Kbd> volver al carrito
        </>
      )
    case 'otro':
      return (
        <>
          <Kbd>Esc</Kbd> volver al carrito
        </>
      )
  }
}

/** Lo que se esta por cobrar, linea por linea. */
function ArticulosDeLaVenta({ lineas }: { lineas: CartLine[] }) {
  return (
    <ul className="mt-2 max-h-40 divide-y divide-line overflow-y-auto">
      {lineas.map((l) => (
        <li key={l.productId} className="flex items-center gap-3 py-1.5">
          <span className="w-16 shrink-0 text-right text-ink-muted" data-numeric="">
            {formatearCantidadConUnidad(l.quantity, l.saleUnit)}
          </span>
          <span className="min-w-0 flex-1 truncate text-ink">{l.name}</span>
          <Money amount={precioPorCantidad(l.price, l.quantity)} size="sm" />
        </li>
      ))}
    </ul>
  )
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
  const [dividido, setDividido] = useState(false)
  const [siguienteClave, setSiguienteClave] = useState(1)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecha, setHecha] = useState<VentaHecha | null>(null)

  const [cliente, setCliente] = useState<ClienteDTO | null>(null)
  const [credito, setCredito] = useState<EstadoDeCreditoDTO | null>(null)
  const [autorizarExceso, setAutorizarExceso] = useState(false)
  const puedeAutorizar = usePermiso('accounts.overrideLimit')
  /** Alguien eligio el medio, aunque haya vuelto al que estaba puesto. */
  const [medioElegidoAMano, setMedioElegidoAMano] = useState(false)
  /** Se intento cobrar con Enter sin decir como se paga: se explica una vez. */
  const [faltaDeclarar, setFaltaDeclarar] = useState(false)
  /** "Más opciones": otro medio, dividir el pago, asignar a un cliente. */
  const [masOpciones, setMasOpciones] = useState(false)
  /** Se pidio asignar la venta a un cliente sin que sea fiado. */
  const [conCliente, setConCliente] = useState(false)

  const botonCobrar = useRef<HTMLButtonElement>(null)
  const campoPagaCon = useRef<HTMLInputElement>(null)
  /** El boton de la forma de pago elegida: recibe el foco al abrir. */
  const medioActivo = useRef<HTMLElement | null>(null)
  /**
   * Cuando avanzo el cobro por ultima vez: al abrir, al elegir la forma de
   * pago, al pasar de "Recibido" a "Confirmar", al mostrar el resultado. Un
   * Enter que llega antes de `PAUSA_ENTRE_ETAPAS_MS` no avanza otro paso.
   */
  const ultimoPaso = useRef<number | null>(null)
  /** Donde esta el foco, para la ayuda de teclas. */
  const [paso, setPaso] = useState<PasoDelCobro>('medio')

  // Cada apertura arranca limpia. Sin esto, el vuelto de la venta anterior
  // sigue escrito en el campo.
  useEffect(() => {
    if (!abierto) return
    ultimoPaso.current = performance.now()
    setPaso('medio')
    setPagos([nuevaLinea(0)])
    setDividido(false)
    setSiguienteClave(1)
    setError(null)
    setHecha(null)
    setEnviando(false)
    setCliente(null)
    setCredito(null)
    setAutorizarExceso(false)
    setMedioElegidoAMano(false)
    setFaltaDeclarar(false)
    setMasOpciones(false)
    setConCliente(false)
  }, [abierto])

  const principal = pagos[0] ?? nuevaLinea(0)

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

  /** Vuelto de cada renglon en efectivo con "recibido" declarado. Negativo: falta. */
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

  /**
   * Si alguien dijo COMO se paga. No es una regla de negocio --el boton
   * "Cobrar" no la usa-- sino la condicion para que la tecla Enter confirme.
   */
  const hayPagoDeclarado = pagoDeclarado(pagos, medioElegidoAMano)

  // Al cambiar de medio el campo "paga con" aparece o desaparece. Si
  // desaparece con el foco adentro, el foco cae al body y Enter deja de
  // cobrar; se lo lleva al boton. Si aparece, entra en el campo.
  const medioPrincipal = principal.method
  const medioAnterior = useRef<MedioCobrable | null>(null)
  useEffect(() => {
    if (!abierto || hecha) {
      medioAnterior.current = null
      return
    }
    // Recien abierto, el foco va a la forma de pago elegida (V5): las flechas
    // recorren y Enter elige; recien ahi se pasa a "Recibido". Se pone a mano
    // y no con `initialFocus`: la pantalla de venta deja el foco en el campo
    // del lector justo antes de abrir (para que vuelva ahi al cerrar), y la
    // trampa de foco del dialogo no siempre lo saca de ahi.
    const anterior = medioAnterior.current
    medioAnterior.current = medioPrincipal
    if (anterior === null) {
      const inicial = requestAnimationFrame(() => {
        // Si en ese cuadro alguien ya empezo a escribir DENTRO del cobro (en
        // "Recibido"), no se le saca el foco: las teclas siguientes caian en
        // las formas de pago. El campo del lector, que queda detras, no
        // cuenta: de ese si hay que sacarlo.
        const activo = document.activeElement
        if (
          activo instanceof HTMLElement &&
          esEditable(activo) &&
          activo.closest('[role="dialog"]')
        ) {
          return
        }
        medioActivo.current?.focus()
      })
      return () => {
        cancelAnimationFrame(inicial)
      }
    }
    const id = requestAnimationFrame(() => {
      const activo = document.activeElement
      if (activo instanceof HTMLElement) {
        // Quien escribe, o recorre los medios con las flechas, no pierde el foco.
        if (esEditable(activo)) return
        if (activo.closest('[role="radiogroup"]')) return
      }
      if (esEfectivo(medioPrincipal) && !dividido) campoPagaCon.current?.focus()
      else botonCobrar.current?.focus()
    })
    return () => {
      cancelAnimationFrame(id)
    }
  }, [abierto, hecha, medioPrincipal, dividido])

  // La ayuda de teclas sigue al foco: dice lo que hace Enter AHORA.
  useEffect(() => {
    if (!abierto || hecha) return
    function alEnfocar() {
      const activo = document.activeElement
      if (!(activo instanceof HTMLElement) || !activo.closest('[role="dialog"]')) return
      if (activo.closest('[role="radiogroup"]')) setPaso('medio')
      else if (activo === campoPagaCon.current) setPaso('recibido')
      else if (activo === botonCobrar.current) setPaso('confirmar')
      else setPaso('otro')
    }
    document.addEventListener('focusin', alEnfocar)
    return () => {
      document.removeEventListener('focusin', alEnfocar)
    }
  }, [abierto, hecha])

  function actualizar(clave: number, cambio: Partial<LineaDePago>) {
    setPagos((actuales) => actuales.map((p) => (p.clave === clave ? { ...p, ...cambio } : p)))
  }

  function elegirMedio(clave: number, opcion: OpcionDeCobro) {
    setMedioElegidoAMano(true)
    setFaltaDeclarar(false)
    actualizar(clave, { method: opcion.method, referencia: opcion.referencia, recibido: '' })
  }

  /**
   * Enter sobre una forma de pago: queda elegida y el foco pasa al paso
   * siguiente. En efectivo, a "Recibido"; en fiado, a elegir el cliente --sin
   * cliente no hay venta que confirmar--; en cualquier otra, a Confirmar.
   */
  function confirmarMedio(opcion: OpcionDeCobro) {
    ultimoPaso.current = performance.now()
    requestAnimationFrame(() => {
      if (esEfectivo(opcion.method)) {
        campoPagaCon.current?.focus()
        return
      }
      if (esCuenta(opcion.method)) {
        const selector = document.querySelector<HTMLElement>(
          '[role="dialog"] [data-selector-cliente] input, [role="dialog"] [data-selector-cliente] button',
        )
        if (selector) {
          selector.focus()
          return
        }
      }
      botonCobrar.current?.focus()
    })
  }

  /**
   * Enter en "Recibido" (o en un importe del pago dividido): NO cobra.
   *
   * Si lo recibido alcanza, el foco pasa a "Confirmar venta" con el vuelto ya
   * a la vista, y recien el Enter siguiente registra la venta. Sin nada
   * escrito, se toma el importe justo --y se ve escrito, para que nadie
   * confirme un numero que no esta en pantalla--. Si no alcanza, el foco se
   * queda: el cartel de "Falta" ya dice cuanto.
   */
  function pasarAConfirmar() {
    if (esEfectivo(principal.method) && !dividido && principal.recibido.trim() === '') {
      ponerRecibido(principal.clave, total)
    } else if (faltaEnAlgunEfectivo || !puedeCobrar) {
      return
    }
    ultimoPaso.current = performance.now()
    requestAnimationFrame(() => {
      botonCobrar.current?.focus()
    })
  }

  /**
   * El freno de Enter, antes de que lo vea ningun control.
   *
   * Un Enter sostenido no se repite, y uno que llega menos de
   * `PAUSA_ENTRE_ETAPAS_MS` despues del paso anterior no avanza otro. Sin
   * esto, "Enter Enter" rapido sobre la forma de pago la elegia y, con el foco
   * ya en "Confirmar venta", registraba la venta en el mismo gesto. El
   * buscador de clientes queda afuera de la espera: ahi Enter elige a una
   * persona, no avanza el cobro.
   */
  function frenarEnter(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter') return
    const enSelector =
      e.target instanceof HTMLElement && e.target.closest('[data-selector-cliente]') !== null
    if (e.repeat || (!enSelector && !enterAvanza(performance.now(), ultimoPaso.current))) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function dividir() {
    // El primer renglon queda con el importe vacio (= el resto) y el segundo
    // arranca en el medio mas usado despues del efectivo. Se puede corregir.
    const sugerido = MEDIOS_COBRABLES.find((m) => m !== principal.method) ?? 'OTHER'
    setDividido(true)
    setPagos((actuales) => [...actuales, nuevaLinea(siguienteClave, sugerido)])
    setSiguienteClave((n) => n + 1)
  }

  function agregarMedio() {
    const yaUsados = new Set(pagos.map((p) => p.method))
    const sugerido = MEDIOS_COBRABLES.find((m) => !yaUsados.has(m)) ?? 'OTHER'
    setPagos((actuales) => [...actuales, nuevaLinea(siguienteClave, sugerido)])
    setSiguienteClave((n) => n + 1)
  }

  function quitar(clave: number) {
    setPagos((actuales) => {
      const restantes = actuales.length === 1 ? actuales : actuales.filter((p) => p.clave !== clave)
      if (restantes.length === 1) {
        setDividido(false)
        // Un solo renglon vuelve a llevarse el total entero.
        return restantes.map((p) => ({ ...p, importe: '' }))
      }
      return restantes
    })
  }

  function ponerRecibido(clave: number, monto: Monto) {
    setFaltaDeclarar(false)
    actualizar(clave, { recibido: textoLocalDeMonto(monto) })
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
            ...(p.referencia === null ? {} : { reference: p.referencia }),
          }
        })

      const id = await onCobrar(aEnviar, {
        clientId: cliente?.id ?? null,
        // Solo se manda cuando de verdad hizo falta: mandarlo siempre
        // convertiria la autorizacion en un adorno, y el servidor la exige
        // igual --pedirla sin el permiso es un 403--.
        autorizarExcesoDeCredito: autorizarExceso && frenadoPorLimiteAlEnviar(credito),
      })
      // Sin vuelto que dar no hay nada que mirar: se avisa y la caja queda
      // lista para la proxima venta, sin una pantalla mas que cerrar.
      if (esCero(vueltoTotal)) {
        aviso.ok(`✓ Venta registrada · ${formatMoney(total)}`)
        onNuevaVenta()
        return
      }
      // El resultado tambien es un paso: el Enter que confirmo, si rebota o
      // se sostiene, no puede cerrar el VUELTO antes de que alguien lo lea.
      ultimoPaso.current = performance.now()
      setHecha({
        id,
        total,
        pagos: aEnviar.map((p) => ({
          label: etiquetaDePago(p.method, p.reference ?? null),
          amount: p.amount,
        })),
        vuelto: vueltoTotal,
      })
      // A proposito no se libera `enviando`: la venta ya existe y el boton no
      // debe volver a estar disponible.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta.')
      setEnviando(false)
    }
  }

  /**
   * Las teclas del cobro. Van en el cuerpo, no en la ventana: solo valen con
   * el dialogo abierto y no pisan lo que el selector de cliente hace con
   * Enter y con las letras.
   */
  function teclas(e: React.KeyboardEvent<HTMLDivElement>) {
    if (hecha || enviando) return
    const objetivo = e.target
    const elemento = objetivo instanceof HTMLElement ? objetivo : null
    if (elemento?.closest('[data-selector-cliente]')) return

    if (e.key === 'Enter') {
      // Un boton con el foco hace lo suyo con Enter (Volver, Justo, un medio).
      // Tambien "Confirmar venta": tener el foco puesto ahi y apretar Enter es
      // apretar el boton, y eso ya es declarar el pago. Es la UNICA forma de
      // registrar la venta con el teclado.
      if (elemento?.tagName === 'BUTTON' || elemento?.tagName === 'SUMMARY') return
      e.preventDefault()
      // Nadie dijo todavia como se paga: Enter no avanza. Se explica y se
      // lleva el cursor a donde hay que decirlo.
      if (!hayPagoDeclarado) {
        setFaltaDeclarar(true)
        campoPagaCon.current?.focus()
        return
      }
      pasarAConfirmar()
      return
    }

    if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return
    // En un campo de texto comun las letras son texto. En el de "paga con"
    // no pueden serlo --solo acepta numeros--, asi que ahi si eligen medio.
    const enCampoDeTexto = esEditable(objetivo) && !elemento?.hasAttribute('data-money-input')
    if (enCampoDeTexto) return

    if (e.key.toUpperCase() === 'J' && esEfectivo(principal.method) && !dividido) {
      e.preventDefault()
      ponerRecibido(principal.clave, total)
      return
    }
    const opcion = opcionDeTecla(e.key)
    if (opcion !== null && !dividido) {
      e.preventDefault()
      elegirMedio(principal.clave, opcion)
      // Si el foco estaba en las formas de pago, pasa a la elegida: el Enter
      // que sigue tiene que confirmar ESA, no la que tenia el foco antes.
      if (elemento?.closest('[role="radiogroup"]')) {
        requestAnimationFrame(() => {
          medioActivo.current?.focus()
        })
      }
    }
  }

  const sugerencias = useMemo(() => sugerenciasDeRecibido(total), [total])

  if (hecha) {
    return (
      <Dialog
        open={abierto}
        onClose={onNuevaVenta}
        title="Venta registrada"
        size="sm"
        rapido
        onKeyDownCapture={frenarEnter}
        footer={
          <Button variant="primary" size="xl" block autoFocus onClick={onNuevaVenta}>
            Nueva venta
            <Kbd>Enter</Kbd>
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 rounded-lg bg-success-quiet px-4 py-3 font-semibold text-success">
            <span aria-hidden="true">✓</span>
            Cobrado
            <span className="font-normal text-ink-muted" data-numeric="">
              · venta #{hecha.id}
            </span>
          </p>
          {hecha.vuelto !== null ? (
            <div className="flex flex-col items-center gap-1 py-2">
              <span className="text-base font-bold tracking-wide text-ink">VUELTO</span>
              <Money amount={hecha.vuelto} size="hero" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 py-2">
              <span className="text-base font-bold tracking-wide text-ink">COBRADO</span>
              <Money amount={hecha.total} size="hero" />
            </div>
          )}

          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Total</dt>
              <dd>
                <Money amount={hecha.total} size="sm" />
              </dd>
            </div>
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
          </dl>
        </div>
      </Dialog>
    )
  }

  const vueltoPrincipal = vueltos[0] ?? null

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Cobrar"
      description={
        <span className="hidden sm:inline" data-ayuda-cobro="">
          <AyudaDelCobro paso={paso} />
        </span>
      }
      size="lg"
      rapido
      dismissible={!enviando}
      initialFocus={medioActivo}
      fullScreenMobile
      onKeyDown={teclas}
      onKeyDownCapture={frenarEnter}
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Solo se habla cuando algo falta: "todo bien" no necesita cartel. */}
          <p className="text-sm font-semibold" aria-live="polite">
            {cuadra ? null : seFueDeMano ? (
              <span className="text-warning">
                ▲ Se pasa por <Money amount={absMonto(restante)} size="md" />
              </span>
            ) : (
              <span className="text-warning">
                ▲ Falta cubrir <Money amount={restante} size="md" />
              </span>
            )}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" size="lg" onClick={onCerrar} disabled={enviando}>
              Volver
              <Kbd>Esc</Kbd>
            </Button>
            <Button
              ref={botonCobrar}
              variant="primary"
              size="xl"
              loading={enviando}
              disabled={!puedeCobrar}
              onClick={() => void cobrar()}
              className="sm:min-w-64"
            >
              {enviando ? 'Registrando…' : 'Confirmar venta'}
              {!enviando && <Kbd>Enter</Kbd>}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" title="No se registró la venta">
            {error} Podés reintentar; no se cobró nada.
          </Alert>
        )}

        {/* 1. El total. Los articulos, plegados: ya se revisaron en el
            ticket, y aca lo que importa es la cifra. */}
        <details className="group border-b border-line pb-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 select-none">
            <span className="flex flex-col">
              <span className="text-lg font-bold tracking-wide text-ink">TOTAL</span>
              <span className="min-h-touch content-center text-ink-muted underline-offset-2 group-hover:underline">
                Ver los {lineas.length} {lineas.length === 1 ? 'artículo' : 'artículos'}
              </span>
            </span>
            <Money amount={total} size="hero" />
          </summary>
          <ArticulosDeLaVenta lineas={lineas} />
        </details>

        {!dividido && (
          <>
            {/* 2. Cómo paga. */}
            <div className="flex flex-col gap-2">
              <p className="text-base font-semibold text-ink" id="como-paga">
                ¿Cómo paga?
              </p>
              <PaymentSelector
                value={principal.method}
                referencia={principal.referencia}
                disabled={enviando}
                activoRef={medioActivo}
                onChange={(opcion) => {
                  elegirMedio(principal.clave, opcion)
                }}
                onConfirmar={confirmarMedio}
              />
            </div>

            {/* 3. En efectivo: recibido y vuelto. */}
            {esEfectivo(principal.method) && (
              <div className="grid gap-4 rounded-lg border border-line bg-raised p-4 sm:grid-cols-[minmax(18rem,1fr)_minmax(0,auto)] sm:items-start">
                <div className="flex min-w-0 flex-col gap-3">
                  <MoneyInput
                    ref={campoPagaCon}
                    label="Recibido"
                    labelVisible
                    labelClassName="text-lg font-bold tracking-wide uppercase"
                    size="lg"
                    /* El placeholder NO puede ser el total. En gris, alineado a
                     la derecha y con el signo $ delante, "6.560,00" se leia
                     como un importe ya cargado: es lo que hacia que Enter
                     pareciera confirmar algo que nadie habia dicho. */
                    placeholder="¿con cuánto?"
                    className={cn(
                      'placeholder:text-base',
                      faltaDeclarar && principal.recibido === '' && 'border-warning',
                    )}
                    value={principal.recibido}
                    disabled={enviando}
                    onChange={(texto) => {
                      setFaltaDeclarar(false)
                      actualizar(principal.clave, { recibido: texto })
                    }}
                  />
                  {!hayPagoDeclarado && faltaDeclarar && (
                    <p role="status" className="-mt-1 text-sm font-semibold text-warning">
                      ▲ Falta decir cómo paga: escribí cuánto te dio, tocá &quot;Justo&quot; o elegí
                      otra forma de pago.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={enviando}
                      onClick={() => {
                        ponerRecibido(principal.clave, total)
                      }}
                    >
                      Justo
                      <Kbd>J</Kbd>
                    </Button>
                    {sugerencias.map((s) => (
                      <Button
                        key={s}
                        variant="secondary"
                        disabled={enviando}
                        onClick={() => {
                          ponerRecibido(principal.clave, s)
                        }}
                      >
                        {formatMoney(s)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex min-w-0 items-baseline justify-between gap-3 border-t border-line pt-3 [overflow-wrap:anywhere] sm:min-w-56 sm:flex-col sm:items-end sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                  <span className="text-lg font-bold tracking-wide text-ink">VUELTO</span>
                  {vueltoPrincipal === null ? (
                    <span className="text-3xl text-ink-faint" data-numeric="">
                      —
                    </span>
                  ) : esNegativo(vueltoPrincipal) ? (
                    <span className="text-right text-base font-semibold text-warning" role="status">
                      ▲ Falta <Money amount={absMonto(vueltoPrincipal)} size="lg" />
                      <span className="block text-sm font-normal">Te dio menos que el total.</span>
                    </span>
                  ) : (
                    <Money amount={vueltoPrincipal} size="hero" />
                  )}
                </div>
              </div>
            )}

            {principal.method === 'TRANSFER' && (
              <p className="text-base text-ink-muted">
                Confirmá cuando veas el pago acreditado. No entra al cajón.
              </p>
            )}
            {(principal.method === 'DEBIT_CARD' || principal.method === 'CREDIT_CARD') && (
              <p className="text-base text-ink-muted">
                Pasá la tarjeta por el posnet y confirmá acá. No entra al cajón.
              </p>
            )}
            {principal.method === 'ACCOUNT' && (
              <p className="text-base text-ink-muted">
                Queda anotado en la cuenta del cliente. Elegí a quién se le fía.
              </p>
            )}
          </>
        )}

        {dividido && (
          <div className="flex flex-col gap-3">
            {/* Lo ya cargado y lo que falta, arriba de todo y en una linea:
                es lo unico que hay que mirar mientras se arma un pago
                combinado. */}
            <div
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-line bg-raised px-4 py-2.5 text-sm"
              aria-live="polite"
            >
              <span className="text-ink-muted">
                Cargado <Money amount={sumaDePagos} size="md" />
              </span>
              <span className={cuadra ? 'font-medium text-success' : 'font-medium text-warning'}>
                {cuadra ? (
                  '✓ Cubre el total'
                ) : seFueDeMano ? (
                  <>
                    Se pasa por <Money amount={absMonto(restante)} size="md" tone="out" />
                  </>
                ) : (
                  <>
                    Falta <Money amount={restante} size="md" tone="out" />
                  </>
                )}
              </span>
            </div>
            {resueltos.map((p, i) => {
              const vuelto = vueltos[i] ?? null
              return (
                <div
                  key={p.clave}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-sunken p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
                      Pago {i + 1}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={enviando}
                      onClick={() => {
                        quitar(p.clave)
                      }}
                    >
                      Quitar
                    </Button>
                  </div>
                  <PaymentSelector
                    compacto
                    label={`Medio del pago ${String(i + 1)}`}
                    value={p.method}
                    referencia={p.referencia}
                    disabled={enviando}
                    onChange={(opcion) => {
                      elegirMedio(p.clave, opcion)
                    }}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MoneyInput
                      label={`Importe del pago ${String(i + 1)}`}
                      labelVisible
                      value={p.importe}
                      placeholder={p.importe === '' ? textoLocalDeMonto(p.monto) : undefined}
                      disabled={enviando}
                      onChange={(texto) => {
                        actualizar(p.clave, { importe: texto })
                      }}
                    />
                    {esEfectivo(p.method) && (
                      <MoneyInput
                        label={`Paga con (pago ${String(i + 1)})`}
                        labelVisible
                        value={p.recibido}
                        disabled={enviando}
                        onChange={(texto) => {
                          actualizar(p.clave, { recibido: texto })
                        }}
                      />
                    )}
                  </div>
                  {vuelto !== null && !esNegativo(vuelto) && (
                    <p className="text-sm text-ink-muted">
                      Vuelto <Money amount={vuelto} size="md" tone="in" />
                    </p>
                  )}
                  {vuelto !== null && esNegativo(vuelto) && (
                    <p className="text-sm text-warning" role="status">
                      Falta <Money amount={absMonto(vuelto)} size="sm" tone="out" />: se recibió
                      menos que este pago.
                    </p>
                  )}
                </div>
              )
            })}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {pagos.length < MEDIOS_COBRABLES.length && (
                <Button size="sm" variant="secondary" disabled={enviando} onClick={agregarMedio}>
                  Agregar medio de pago
                </Button>
              )}
            </div>

            <dl className="flex flex-col gap-1 rounded-lg border border-line px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Total</dt>
                <dd>
                  <Money amount={total} size="sm" />
                </dd>
              </div>
              {resueltos.map((p) => (
                <div key={p.clave} className="flex justify-between gap-3">
                  <dt className="text-ink-muted">{etiquetaDePago(p.method, p.referencia)}</dt>
                  <dd>
                    <Money amount={p.monto} size="sm" />
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
                <dt className="text-ink-muted">{seFueDeMano ? 'Se pasa por' : 'Pendiente'}</dt>
                <dd>
                  <Money amount={absMonto(restante)} size="sm" tone={cuadra ? 'neutral' : 'out'} />
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/*
          El cliente. Cuando hay una linea a cuenta, elegirlo es obligatorio y
          el selector se abre solo: una deuda sin deudor no se puede cobrar.
          Si no, es opcional y discreto: la venta queda en su historial.
        */}
        {(hayFiado || conCliente || cliente !== null) && (
          <div
            data-selector-cliente=""
            className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <span className="shrink-0 text-base font-semibold text-ink">
              Cliente{hayFiado ? <span className="ml-1 text-danger">*</span> : ' (opcional)'}
            </span>
            <div className="min-w-0 sm:flex-1">
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
          </div>
        )}

        {/*
          Los cinco numeros del credito, mostrados ANTES de confirmar. Un 409
          pelado obliga a quien atiende a adivinar por que no se pudo, con el
          cliente enfrente.
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
                  <Money amount={absMonto(credito.balance)} size="sm" />
                  {esNegativo(credito.balance) && ' a favor'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Esta venta</dt>
                <dd data-numeric="">
                  <Money amount={aCuenta} size="sm" />
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-1 font-medium">
                <dt className="text-ink-muted">Saldo resultante</dt>
                <dd data-numeric="">
                  <Money amount={absMonto(credito.saldoResultante)} size="sm" />
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

        {/* Lo que casi nunca se usa, guardado: no compite con las seis
            formas de pago. */}
        {!dividido && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              aria-expanded={masOpciones}
              disabled={enviando}
              onClick={() => {
                setMasOpciones((v) => !v)
              }}
            >
              {masOpciones ? 'Menos opciones ▴' : 'Más opciones ▾'}
            </Button>
            {masOpciones && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={enviando}
                  onClick={() => {
                    elegirMedio(principal.clave, OPCION_OTRO)
                  }}
                >
                  Otro medio de pago
                </Button>
                <Button variant="secondary" disabled={enviando} onClick={dividir}>
                  Dividir el pago
                </Button>
                {!hayFiado && cliente === null && (
                  <Button
                    variant="secondary"
                    disabled={enviando}
                    onClick={() => {
                      setConCliente(true)
                    }}
                  >
                    Asignar a un cliente
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {faltaEnAlgunEfectivo && dividido && (
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
