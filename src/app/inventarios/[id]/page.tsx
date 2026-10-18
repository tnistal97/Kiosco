'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Alert,
  Button,
  ButtonLink,
  CardList,
  CardListItem,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Field,
  Metric,
  MetricRow,
  NumericInput,
  PageContainer,
  Pagination,
  SkeletonRows,
  StatusBadge,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  Textarea,
  aviso,
  cn,
  formatQuantity,
} from '@/components/ui'
import { useFuncion, usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, ApiError, mensajeDeError } from '@/lib/api-client'
import { politicaDe, unidadDeVentaODefecto, type UnidadDeVenta } from '@/modules/products/units'
import {
  aMilesimas,
  cantidadDesdeTexto,
  desdeMilesimas,
  textoLocalDeCantidad,
  type TextoCantidad,
} from '@/lib/cantidad'
import { motivoDeCodigoInvalido, normalizarCodigo } from '@/modules/products/barcode'
import { parseProducto } from '@/modules/products/dto'
import {
  alcanceDeInventario,
  estadoDeInventario,
  fechaDeInventario,
} from '@/components/inventarios/textos'

/**
 * Un inventario. UX V5.
 *
 * Tres pasos, siempre a la vista arriba:
 *
 *   1. CONTAR. Lista de productos con lo que dice el sistema y un campo para
 *      lo que se conto. Cada numero se guarda en cuanto se escribe (Enter o
 *      al salir del campo): si se corta la luz, lo contado no se pierde. Con
 *      el lector, escanear un producto lo busca y deja el cursor en su
 *      cantidad. La lista se pagina: un negocio con 2.000 productos se puede
 *      contar entero (antes se cortaba en 100 y no se podia terminar).
 *   2. REVISAR. "Encontramos diferencias en X productos": cuantos faltan,
 *      cuantos sobran, y la lista de los que no coinciden. El color va solo
 *      en la diferencia: rojo falta, ambar sobra, nada si coincide.
 *   3. APLICAR. Con confirmacion. El sistema corrige el stock y cada
 *      correccion queda en Movimientos como "Ajuste de inventario".
 *
 * Las reglas no cambiaron: el conteo, el cierre y la aplicacion son los
 * mismos endpoints de siempre, con sus permisos separados (quien cuenta no
 * tiene por que poder aplicar).
 */

interface Sesion {
  id: number
  number: string
  status: string
  scope: string
  categoryName: string | null
  blindCount: boolean
  recountThreshold: string | null
  startedAt: string
  notes: string | null
  lineas: {
    total: number
    contadas: number
    pendientes: number
    sinResolver: number
    conDiferencia: number
  }
  conflictos?: Array<{
    lineId: number
    productName: string
    lotCode: string | null
    sessionNumber: string
  }>
}

interface Linea {
  id: number
  productId: number
  productName: string
  saleUnit: string
  lotId: number | null
  lotCode: string | null
  status: string
  countedQuantity: string | null
  snapshotQuantity: string
  expectedAtCount: string | null
  variance: string | null
}

interface Lineas {
  data: Linea[]
  pagination: { total: number; page: number; pageSize: number }
}

const POR_PAGINA = 100

/**
 * Un lector escribe cada digito con pocos milisegundos de diferencia; una
 * persona, no. Seis o mas digitos asi, terminados en Enter, son una lectura.
 */
const PAUSA_DE_LECTOR_MS = 40
const DIGITOS_DE_LECTURA = 6

type FiltroConteo = 'pendientes' | 'recontar' | 'contadas' | 'todas'
type FiltroRevision = 'con' | 'negativas' | 'positivas' | 'todas'

/** Lo que dice el sistema de una linea: lo que vio al contar, o al empezar. */
function sistemaDe(l: Linea): TextoCantidad {
  return l.expectedAtCount ?? l.snapshotQuantity
}

function contadoParaEditar(l: Linea): string {
  if (l.countedQuantity === null) return ''
  const unidad = unidadDeVentaODefecto(l.saleUnit)
  return textoLocalDeCantidad(l.countedQuantity, politicaDe(unidad).decimales)
}

/** La diferencia con signo y color. Solo aca va el color. */
function Diferencia({ valor, unidad }: { valor: TextoCantidad | null; unidad: UnidadDeVenta }) {
  if (valor === null) return <span className="text-ink-faint">—</span>
  const m = aMilesimas(valor)
  if (m === 0) {
    return (
      <span className="font-semibold text-ink-muted" data-numeric="">
        <span aria-hidden="true">✓ </span>0<span className="sr-only"> (coincide)</span>
      </span>
    )
  }
  const abs = desdeMilesimas(Math.abs(m))
  return (
    <span
      data-numeric=""
      className={cn('text-lg font-bold', m < 0 ? 'text-danger' : 'text-warning')}
    >
      {m < 0 ? '−' : '+'}
      {formatQuantity(abs, unidad)}
      <span className="sr-only">{m < 0 ? ' (falta)' : ' (sobra)'}</span>
    </span>
  )
}

export default function InventarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const usaLotes = useFuncion('lotes')
  const puedeContar = usePermiso('inventoryCounts.count')
  const puedeRevisar = usePermiso('inventoryCounts.review')
  const puedeAplicar = usePermiso('inventoryCounts.apply')

  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [lineas, setLineas] = useState<Lineas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(1)
  const [filtroConteo, setFiltroConteo] = useState<FiltroConteo>('pendientes')
  const [filtroRevision, setFiltroRevision] = useState<FiltroRevision>('con')
  const [borradores, setBorradoresEstado] = useState<Record<number, string>>({})
  /**
   * Los borradores, al dia en el mismo instante. Enter guarda y mueve el foco
   * antes de que React vuelva a dibujar: el "al salir" de la linea anterior
   * leia el borrador viejo del render anterior y lo mandaba de nuevo (con
   * "contar dos veces", ese reenvio contaba como segundo conteo).
   */
  const borradoresRef = useRef<Record<number, string>>({})
  const ponerBorrador = useCallback((lineId: number, texto: string | null) => {
    const { [lineId]: _anterior, ...resto } = borradoresRef.current
    const nuevos = texto === null ? resto : { ...resto, [lineId]: texto }
    borradoresRef.current = nuevos
    setBorradoresEstado(nuevos)
  }, [])
  const [guardando, setGuardando] = useState<Record<number, boolean>>({})
  const [resumen, setResumen] = useState<{ faltan: number; sobran: number } | null>(null)
  const [confirmar, setConfirmar] = useState<'cerrar' | 'aplicar' | 'cancelar' | null>(null)
  const [motivoCancelar, setMotivoCancelar] = useState('')
  const [buscandoCodigo, setBuscandoCodigo] = useState(false)
  const [aviso_, setAviso] = useState<string | null>(null)

  const campoLector = useRef<HTMLInputElement>(null)
  /** Los campos de cantidad: los de la tabla y los de las tarjetas del telefono. */
  const entradas = useRef(new Map<number, HTMLInputElement>())
  const entradasMovil = useRef(new Map<number, HTMLInputElement>())
  /** Las teclas de digitos recientes y seguidas de cada cantidad: un lector. */
  const rafagas = useRef(new Map<number, number[]>())
  /** La linea a la que se llego escaneando: al guardarla se vuelve al lector. */
  const desdeElLector = useRef<number | null>(null)
  const peticion = useRef(0)
  /**
   * Lo que se esta mandando de cada linea. Si se sale del campo mientras el
   * Enter todavia esta guardando, el mismo numero no viaja dos veces.
   */
  const enCurso = useRef(new Map<number, string>())

  const contando = sesion?.status === 'DRAFT' || sesion?.status === 'COUNTING'
  const enRevision = sesion?.status === 'REVIEW'
  const aCiegas = (sesion?.blindCount ?? false) && contando

  const cargarSesion = useCallback(async () => {
    const s = await apiRequest<Sesion>(`/api/inventarios/${id}`, { parse: (d) => d as Sesion })
    setSesion(s)
    return s
  }, [id])

  const cargarLineas = useCallback(
    async (s: Sesion) => {
      const mia = ++peticion.current
      const abierto = s.status === 'DRAFT' || s.status === 'COUNTING'
      const p = new URLSearchParams({ page: String(pagina), pageSize: String(POR_PAGINA) })
      if (q.trim() !== '') p.set('q', q.trim())
      if (abierto) {
        if (filtroConteo === 'pendientes') p.set('estado', 'PENDING')
        if (filtroConteo === 'recontar') p.set('estado', 'RECOUNT')
        if (filtroConteo === 'contadas') p.set('estado', 'COUNTED')
      } else if (filtroRevision !== 'todas') {
        p.set('diferencia', filtroRevision)
      }
      const l = await apiRequest<Lineas>(`/api/inventarios/${id}/lineas?${p.toString()}`, {
        parse: (d) => d as Lineas,
      })
      if (mia === peticion.current) setLineas(l)
    },
    [id, pagina, q, filtroConteo, filtroRevision],
  )

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const s = await cargarSesion()
      await cargarLineas(s)
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo cargar el inventario. Revisá la conexión.'))
    } finally {
      setCargando(false)
    }
  }, [cargarSesion, cargarLineas])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 200)
    return () => {
      clearTimeout(t)
    }
  }, [cargar])

  // Con segundo conteo: cuantos hay que volver a contar. Se cuentan aparte
  // porque "Faltan" los incluye y la lista de "Sin contar" no.
  const [aRecontar, setARecontar] = useState(0)
  useEffect(() => {
    if (!contando || sesion.recountThreshold === null) {
      setARecontar(0)
      return
    }
    let vivo = true
    apiRequest<Lineas>(`/api/inventarios/${id}/lineas?estado=RECOUNT&pageSize=1`, {
      parse: (r) => r as Lineas,
    })
      .then((r) => {
        if (vivo) setARecontar(r.pagination.total)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
    // Depende de la sesion entera: una linea que pasa de "sin contar" a
    // "volver a contar" no cambia el total de pendientes, que cuenta las dos.
  }, [contando, id, sesion])

  // En revision: cuantos productos faltan y cuantos sobran, para el resumen.
  useEffect(() => {
    if (!enRevision) return
    let vivo = true
    const contar = (d: string) =>
      apiRequest<Lineas>(`/api/inventarios/${id}/lineas?diferencia=${d}&pageSize=1`, {
        parse: (r) => r as Lineas,
      }).then((r) => r.pagination.total)
    void Promise.all([contar('negativas'), contar('positivas')])
      .then(([faltan, sobran]) => {
        if (vivo) setResumen({ faltan, sobran })
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [enRevision, id, sesion?.lineas.conDiferencia])

  /** Guarda lo contado de UNA linea. Devuelve si se guardo. */
  async function guardarLinea(l: Linea): Promise<boolean> {
    const texto = borradoresRef.current[l.id]
    if (texto === undefined) return true
    if (texto.trim() === '') return true
    const cantidad = cantidadDesdeTexto(texto)
    if (cantidad === null) {
      aviso.error(`La cantidad de ${l.productName} no es un número. Corregila.`)
      return false
    }
    // Se esta mandando exactamente esto: no se repite.
    if (enCurso.current.get(l.id) === cantidad) return true
    enCurso.current.set(l.id, cantidad)
    setGuardando((g) => ({ ...g, [l.id]: true }))
    try {
      const r = await apiRequest<{
        lineas: Array<{
          id: number
          status: string
          expectedAtCount: string | null
          variance: string | null
        }>
      }>(`/api/inventarios/${id}/conteo`, {
        method: 'POST',
        body: { lineas: [{ lineId: l.id, countedQuantity: cantidad }] },
        parse: (d) => d as never,
      })
      const hecha = r.lineas[0]
      setLineas((actual) =>
        actual === null
          ? actual
          : {
              ...actual,
              data: actual.data.map((x) =>
                x.id === l.id
                  ? {
                      ...x,
                      countedQuantity: cantidad,
                      status: hecha?.status ?? 'COUNTED',
                      expectedAtCount: hecha?.expectedAtCount ?? x.expectedAtCount,
                      variance: hecha?.variance ?? x.variance,
                    }
                  : x,
              ),
            },
      )
      // El borrador se va solo si sigue diciendo lo que se guardo: si mientras
      // tanto escribieron otro numero, ese queda para guardar.
      const actual = borradoresRef.current[l.id]
      if (actual !== undefined && cantidadDesdeTexto(actual) === cantidad) {
        ponerBorrador(l.id, null)
      }
      if (hecha?.status === 'RECOUNT') {
        setAviso(`${l.productName}: la diferencia es grande. Contalo de nuevo y volvé a cargarlo.`)
      }
      void cargarSesion()
      return true
    } catch (e) {
      aviso.error(mensajeDeError(e, `No se pudo guardar ${l.productName}. Probá de nuevo.`))
      return false
    } finally {
      enCurso.current.delete(l.id)
      setGuardando((g) => ({ ...g, [l.id]: false }))
    }
  }

  /** El campo de cantidad de una linea que se ve: la tabla o, en el telefono, la tarjeta. */
  function entradaDe(lineId: number): HTMLInputElement | undefined {
    for (const mapa of [entradas.current, entradasMovil.current]) {
      const campo = mapa.get(lineId)
      if (campo && campo.getClientRects().length > 0) return campo
    }
    return undefined
  }

  /**
   * Enter en una cantidad: el cursor pasa YA a la proxima (o al lector) y la
   * cantidad se guarda en segundo plano. Esperar la respuesta del servidor
   * antes de moverlo dejaba que lo que se tecleaba rapido cayera en la linea
   * recien confirmada, y se guardara ahi.
   */
  function alConfirmarLinea(l: Linea, indice: number) {
    const texto = borradoresRef.current[l.id]
    if (texto !== undefined && texto.trim() !== '' && cantidadDesdeTexto(texto) === null) {
      aviso.error(`La cantidad de ${l.productName} no es un número. Corregila.`)
      return
    }
    if (desdeElLector.current === l.id) {
      desdeElLector.current = null
      setQ('')
      campoLector.current?.focus()
    } else {
      const siguiente = lineas?.data[indice + 1]
      const destino = (siguiente ? entradaDe(siguiente.id) : undefined) ?? campoLector.current
      destino?.focus()
    }
    // Salir del campo ya lo esta guardando; si el foco no se pudo mover, se
    // guarda aca. El mismo numero no viaja dos veces (`enCurso`).
    void guardarLinea(l)
  }

  /**
   * Las teclas de un campo de cantidad.
   *
   * Un lector que lee con el cursor en una cantidad manda los digitos en
   * rafaga y Enter: eso es un producto para buscar, no 7.790.001.000.011
   * unidades. Se saca de la cantidad lo que escribio el lector y se busca el
   * producto, como en el campo de arriba.
   */
  function alTeclaEnCantidad(e: KeyboardEvent<HTMLInputElement>, l: Linea, indice: number) {
    const ahora = performance.now()
    if (/^[0-9]$/.test(e.key)) {
      const previas = rafagas.current.get(l.id) ?? []
      const ultima = previas.at(-1)
      rafagas.current.set(
        l.id,
        ultima !== undefined && ahora - ultima <= PAUSA_DE_LECTOR_MS
          ? [...previas, ahora]
          : [ahora],
      )
      return
    }
    if (e.key !== 'Enter') {
      if (e.key !== 'Shift') rafagas.current.delete(l.id)
      return
    }
    e.preventDefault()
    if (e.repeat) return
    const enRafaga = rafagas.current.get(l.id)?.length ?? 0
    rafagas.current.delete(l.id)
    const texto = e.currentTarget.value
    if (enRafaga >= DIGITOS_DE_LECTURA && texto.length >= enRafaga) {
      const resto = texto.slice(0, texto.length - enRafaga)
      ponerBorrador(l.id, resto.trim() === '' ? null : resto)
      void buscarProducto(texto.slice(-enRafaga))
      return
    }
    alConfirmarLinea(l, indice)
  }

  /** Escanear o escribir un producto: lo busca y deja el cursor en su cantidad. */
  async function buscarProducto(texto: string) {
    const t = texto.trim()
    if (t === '') return
    setAviso(null)
    const esCodigo = /^[0-9 ]+$/.test(t)
    if (!esCodigo) {
      setQ(t)
      setPagina(1)
      setFiltroConteo('todas')
      return
    }
    const codigo = normalizarCodigo(t)
    const roto = motivoDeCodigoInvalido(codigo)
    if (roto !== null) {
      setAviso(roto)
      return
    }
    setBuscandoCodigo(true)
    try {
      const producto = await apiRequest(
        `/api/products/barcode/${encodeURIComponent(codigo)}?estado=todos`,
        { parse: parseProducto },
      )
      // Por el producto, no por el nombre: con muchos parecidos ("Yerba ...")
      // el que se escaneo podia quedar fuera de la primera pagina.
      const r = await apiRequest<Lineas>(
        `/api/inventarios/${id}/lineas?productId=${String(producto.id)}&pageSize=${String(POR_PAGINA)}`,
        { parse: (d) => d as Lineas },
      )
      const suyas = r.data
      if (suyas.length === 0) {
        setAviso(`${producto.name} no está en este inventario.`)
        return
      }
      setQ(producto.name)
      setPagina(1)
      setFiltroConteo('todas')
      setLineas({ ...r, data: suyas })
      const primera = suyas[0]
      if (primera) {
        desdeElLector.current = primera.id
        requestAnimationFrame(() => {
          const entrada = entradaDe(primera.id)
          entrada?.focus()
          entrada?.select()
        })
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setAviso(`No hay ningún producto con el código ${codigo}.`)
      } else {
        setAviso(mensajeDeError(e, 'No se pudo buscar el código. Probá de nuevo.'))
      }
    } finally {
      setBuscandoCodigo(false)
    }
  }

  async function accion(ruta: string, exito: string, body?: unknown) {
    try {
      await apiRequest(`/api/inventarios/${id}/${ruta}`, {
        method: 'POST',
        ...(body === undefined ? {} : { body }),
        parse: (d) => d,
      })
      aviso.ok(exito)
      setConfirmar(null)
      setFiltroRevision('con')
      setPagina(1)
      await cargar()
    } catch (e) {
      aviso.error(mensajeDeError(e, 'No se pudo completar. Probá de nuevo.'))
      setConfirmar(null)
    }
  }

  if (error !== null) {
    return (
      <PageContainer>
        <ErrorState description={error} onRetry={() => void cargar()} />
      </PageContainer>
    )
  }
  if (cargando || sesion === null || lineas === null) {
    return (
      <PageContainer>
        <SkeletonRows rows={8} />
      </PageContainer>
    )
  }

  const estado = estadoDeInventario(sesion.status)
  const paso = contando ? 1 : enRevision ? 2 : 3
  const conDiferencia = sesion.lineas.conDiferencia
  const hayBorradores = Object.values(borradores).some((v) => v.trim() !== '')

  return (
    <PageContainer className="gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-ink-muted">
            <Link
              href="/inventarios"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              ← Inventarios
            </Link>
          </p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold text-ink">
            Inventario del {fechaDeInventario(sesion.startedAt)}
            <StatusBadge tone={estado.tono} glyph={estado.glifo}>
              {estado.etiqueta}
            </StatusBadge>
          </h2>
          <p className="mt-1 text-base text-ink-muted">
            {alcanceDeInventario(sesion.scope, sesion.categoryName)}
            {sesion.blindCount ? ' · sin mostrar el stock del sistema mientras se cuenta' : ''}
          </p>
        </div>
      </header>

      {sesion.status !== 'CANCELLED' && (
        <ol className="grid grid-cols-3 gap-2" aria-label="Pasos del inventario">
          {['Contar', 'Revisar diferencias', 'Listo'].map((nombre, i) => {
            const n = i + 1
            const actual = n === paso
            const hecho = n < paso || (n === 3 && paso === 3)
            return (
              <li
                key={nombre}
                aria-current={actual ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold sm:text-base',
                  actual
                    ? 'border-2 border-primary bg-primary-quiet text-ink'
                    : hecho
                      ? 'border-line bg-surface text-ink'
                      : 'border-line bg-surface text-ink-muted',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm',
                    actual
                      ? 'bg-primary text-ink-on-solid'
                      : hecho
                        ? 'bg-success-quiet text-success'
                        : 'bg-raised text-ink-muted',
                  )}
                >
                  {hecho && !actual ? '✓' : n}
                </span>
                {nombre}
              </li>
            )
          })}
        </ol>
      )}

      {sesion.status === 'CANCELLED' && (
        <Alert tone="info" title="Este inventario se canceló">
          No cambió el stock. Podés empezar uno nuevo desde Inventarios.
        </Alert>
      )}

      {sesion.lineas.sinResolver > 0 &&
        (usaLotes ? (
          <Alert tone="warning" title="Falta indicar el lote de algunos productos">
            {sesion.lineas.sinResolver} producto(s) se contaron sin decir de qué lote son. Hasta
            resolverlo no se puede aplicar.
          </Alert>
        ) : (
          <Alert tone="warning" title="Hay productos que piden lote">
            {sesion.lineas.sinResolver} producto(s) están marcados para llevar lote, pero los lotes
            no están activados en este negocio. Hasta resolverlo no se puede aplicar: pedí ayuda a
            quien instaló el sistema.
          </Alert>
        ))}

      {(sesion.conflictos ?? []).length > 0 && (
        <Alert tone="danger" title="Otro inventario ya corrigió parte de esto">
          <p>
            Estos productos se contaron antes de que otro inventario los corrigiera. Aplicar ahora
            los corregiría dos veces: hay que volver a contarlos.
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {(sesion.conflictos ?? []).map((c) => (
              <li key={c.lineId}>
                {c.productName} — corregido por {c.sessionNumber}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* --------------------------------------------------- 1. CONTAR */}
      {contando && (
        <>
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-lg font-semibold text-ink" data-numeric="">
                Contaste {sesion.lineas.contadas} de {sesion.lineas.total} productos
              </p>
              {sesion.lineas.pendientes > 0 && (
                <p className="text-base text-ink-muted" data-numeric="">
                  Faltan {sesion.lineas.pendientes}
                </p>
              )}
            </div>
            <div
              className="h-3 w-full overflow-hidden rounded-full bg-raised"
              role="progressbar"
              aria-label="Avance del conteo"
              aria-valuemin={0}
              aria-valuemax={sesion.lineas.total}
              aria-valuenow={sesion.lineas.contadas}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${String(sesion.lineas.total === 0 ? 0 : Math.round((sesion.lineas.contadas / sesion.lineas.total) * 100))}%`,
                }}
              />
            </div>
            {puedeContar && (
              <form
                className="mt-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const valor = campoLector.current?.value ?? ''
                  if (campoLector.current) campoLector.current.value = ''
                  void buscarProducto(valor)
                }}
              >
                <label htmlFor="inventario-lector" className="text-sm font-semibold text-ink">
                  Escaneá o escribí el producto que estás contando
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    ref={campoLector}
                    id="inventario-lector"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Código de barras o nombre"
                    className="h-control-lg w-full min-w-0 rounded-lg border border-line-strong bg-field px-4 text-lg text-ink placeholder:text-ink-faint hover:border-ink-faint"
                  />
                  <Button type="submit" variant="secondary" size="lg" loading={buscandoCodigo}>
                    Buscar
                  </Button>
                </div>
              </form>
            )}
            {aviso_ !== null && (
              <p role="status" className="text-base font-semibold text-warning">
                ▲ {aviso_}
              </p>
            )}
          </section>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div role="group" aria-label="Mostrar" className="flex flex-wrap gap-2">
              {(
                [
                  ['pendientes', `Sin contar (${String(sesion.lineas.pendientes - aRecontar)})`],
                  ...(aRecontar > 0
                    ? ([['recontar', `Volver a contar (${String(aRecontar)})`]] as const)
                    : []),
                  ['contadas', `Contados (${String(sesion.lineas.contadas)})`],
                  ['todas', 'Todos'],
                ] as const
              ).map(([valor, etiqueta]) => (
                <BotonFiltro
                  key={valor}
                  activo={filtroConteo === valor}
                  onClick={() => {
                    setFiltroConteo(valor)
                    setPagina(1)
                  }}
                >
                  {etiqueta}
                </BotonFiltro>
              ))}
            </div>
            {q !== '' && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQ('')
                  desdeElLector.current = null
                }}
              >
                Mostrando «{q}» · Ver todos
              </Button>
            )}
          </div>
        </>
      )}

      {/* ------------------------------------------------- 2. REVISAR */}
      {enRevision && (
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <p className="text-xl font-semibold text-ink">
            {conDiferencia === 0
              ? 'Todo coincide: no encontramos diferencias.'
              : `Encontramos diferencias en ${String(conDiferencia)} ${conDiferencia === 1 ? 'producto' : 'productos'}.`}
          </p>
          <MetricRow>
            <Metric
              label="Faltan"
              value={resumen === null ? '—' : String(resumen.faltan)}
              hint="productos con menos de lo que dice el sistema"
              tone={resumen !== null && resumen.faltan > 0 ? 'danger' : 'neutral'}
            />
            <Metric
              label="Sobran"
              value={resumen === null ? '—' : String(resumen.sobran)}
              hint="productos con más de lo que dice el sistema"
              tone={resumen !== null && resumen.sobran > 0 ? 'warning' : 'neutral'}
            />
            <Metric
              label="Coinciden"
              value={String(sesion.lineas.total - conDiferencia)}
              hint="productos"
            />
          </MetricRow>
          <div role="group" aria-label="Mostrar" className="flex flex-wrap gap-2">
            {(
              [
                ['con', 'Con diferencia'],
                ['negativas', 'Faltan'],
                ['positivas', 'Sobran'],
                ['todas', 'Todos'],
              ] as const
            ).map(([valor, etiqueta]) => (
              <BotonFiltro
                key={valor}
                activo={filtroRevision === valor}
                onClick={() => {
                  setFiltroRevision(valor)
                  setPagina(1)
                }}
              >
                {etiqueta}
              </BotonFiltro>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------- 3. LISTO */}
      {sesion.status === 'APPLIED' && (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-5">
          <p className="inline-flex items-center gap-2 rounded-md bg-success-quiet px-3 py-1.5 text-lg font-bold text-success">
            <span aria-hidden="true">✓</span> Inventario aplicado
          </p>
          <p className="text-base text-ink">
            {conDiferencia === 0
              ? 'Todo coincidía: el stock no cambió.'
              : `Se corrigió el stock de ${String(conDiferencia)} ${conDiferencia === 1 ? 'producto' : 'productos'}. Cada corrección quedó en Movimientos como «Ajuste de inventario».`}
          </p>
          <ButtonLink href="/stock/movimientos" variant="secondary">
            Ver movimientos
          </ButtonLink>
        </section>
      )}

      {/* --------------------------------------------- la lista de productos */}
      {lineas.data.length === 0 ? (
        <EmptyState
          title={
            contando && filtroConteo === 'pendientes' && q === '' && aRecontar === 0
              ? '¡Contaste todo!'
              : 'No hay productos para mostrar'
          }
          description={
            contando && filtroConteo === 'pendientes' && q === '' && aRecontar === 0
              ? 'Cuando quieras, tocá «Terminé de contar» para revisar las diferencias.'
              : aRecontar > 0
                ? 'Quedan productos para volver a contar: tocá «Volver a contar».'
                : 'Probá con otro filtro.'
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <TableWrap>
              <Table caption="Productos del inventario">
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    {!aCiegas && <TH align="right">Sistema</TH>}
                    <TH align="right">Contado</TH>
                    {!aCiegas && <TH align="right">Diferencia</TH>}
                  </TR>
                </THead>
                <TBody>
                  {lineas.data.map((l, i) => {
                    const unidad = unidadDeVentaODefecto(l.saleUnit)
                    const borrador = borradores[l.id]
                    const contadoTexto = borrador ?? contadoParaEditar(l)
                    // Mientras se escribe, la diferencia se adelanta; al
                    // guardar manda la del servidor.
                    const contadoVivo =
                      borrador !== undefined && borrador.trim() !== ''
                        ? cantidadDesdeTexto(borrador)
                        : null
                    const diferencia: TextoCantidad | null =
                      contadoVivo !== null
                        ? desdeMilesimas(aMilesimas(contadoVivo) - aMilesimas(sistemaDe(l)))
                        : l.variance
                    return (
                      <TR key={l.id} selected={desdeElLector.current === l.id}>
                        <TD>
                          <p className="font-semibold text-ink">{l.productName}</p>
                          {usaLotes && l.lotCode !== null && (
                            <p className="text-sm text-ink-muted">Lote {l.lotCode}</p>
                          )}
                          {l.status === 'RECOUNT' && (
                            <p className="text-sm font-semibold text-warning">▲ Volver a contar</p>
                          )}
                        </TD>
                        {!aCiegas && (
                          <TD align="right" className="text-lg" data-numeric="">
                            {formatQuantity(sistemaDe(l), unidad)}
                          </TD>
                        )}
                        <TD align="right">
                          {contando && puedeContar ? (
                            <span className="inline-flex items-center gap-2">
                              <NumericInput
                                ref={(el) => {
                                  if (el) entradas.current.set(l.id, el)
                                  else entradas.current.delete(l.id)
                                }}
                                modo="cantidad"
                                unidad={unidad}
                                aria-label={`Contado de ${l.productName}`}
                                className="w-28 text-right text-lg font-semibold"
                                value={contadoTexto}
                                onChange={(texto, _valor, origen) => {
                                  // El formato al salir solo retoca lo que se
                                  // esta escribiendo: sobre una linea ya
                                  // guardada no inventa un borrador.
                                  if (
                                    origen === 'salida' &&
                                    borradoresRef.current[l.id] === undefined
                                  )
                                    return
                                  ponerBorrador(l.id, texto)
                                }}
                                onKeyDown={(e) => {
                                  alTeclaEnCantidad(e, l, i)
                                }}
                                onBlur={() => {
                                  void guardarLinea(l)
                                }}
                              />
                              <span className="w-5 text-success" aria-live="polite">
                                {guardando[l.id] ? (
                                  <span className="text-ink-faint">…</span>
                                ) : l.countedQuantity !== null && borrador === undefined ? (
                                  <span role="img" aria-label="Guardado">
                                    ✓
                                  </span>
                                ) : null}
                              </span>
                            </span>
                          ) : (
                            <span className="text-lg font-semibold" data-numeric="">
                              {l.countedQuantity === null
                                ? '—'
                                : formatQuantity(l.countedQuantity, unidad)}
                            </span>
                          )}
                        </TD>
                        {!aCiegas && (
                          <TD align="right">
                            <Diferencia valor={diferencia} unidad={unidad} />
                          </TD>
                        )}
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </TableWrap>
          </div>

          <CardList className="md:hidden">
            {lineas.data.map((l, i) => {
              const unidad = unidadDeVentaODefecto(l.saleUnit)
              const borrador = borradores[l.id]
              return (
                <CardListItem key={l.id}>
                  <p className="text-base font-semibold text-ink">{l.productName}</p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    {!aCiegas && (
                      <p className="text-sm text-ink-muted">
                        Sistema:{' '}
                        <span className="text-base font-semibold text-ink" data-numeric="">
                          {formatQuantity(sistemaDe(l), unidad)}
                        </span>
                      </p>
                    )}
                    {contando && puedeContar ? (
                      <Field label="Contado" className="w-32">
                        <NumericInput
                          ref={(el) => {
                            if (el) entradasMovil.current.set(l.id, el)
                            else entradasMovil.current.delete(l.id)
                          }}
                          aria-label={`Contado de ${l.productName}`}
                          modo="cantidad"
                          unidad={unidad}
                          className="text-right text-lg font-semibold"
                          value={borrador ?? contadoParaEditar(l)}
                          onChange={(texto, _valor, origen) => {
                            if (origen === 'salida' && borradoresRef.current[l.id] === undefined)
                              return
                            ponerBorrador(l.id, texto)
                          }}
                          onKeyDown={(e) => {
                            alTeclaEnCantidad(e, l, i)
                          }}
                          onBlur={() => {
                            void guardarLinea(l)
                          }}
                        />
                        <span className="min-h-5 text-sm text-success" aria-live="polite">
                          {guardando[l.id] ? (
                            <span className="text-ink-muted">Guardando…</span>
                          ) : l.countedQuantity !== null && borrador === undefined ? (
                            <span role="img" aria-label="Guardado">
                              ✓ Guardado
                            </span>
                          ) : null}
                        </span>
                      </Field>
                    ) : (
                      <p className="text-sm text-ink-muted">
                        Contado:{' '}
                        <span className="text-base font-semibold text-ink" data-numeric="">
                          {l.countedQuantity === null
                            ? '—'
                            : formatQuantity(l.countedQuantity, unidad)}
                        </span>
                      </p>
                    )}
                    {!aCiegas && <Diferencia valor={l.variance} unidad={unidad} />}
                  </div>
                </CardListItem>
              )
            })}
          </CardList>

          <Pagination
            page={lineas.pagination.page}
            pageSize={lineas.pagination.pageSize}
            total={lineas.pagination.total}
            totalPages={Math.max(
              1,
              Math.ceil(lineas.pagination.total / lineas.pagination.pageSize),
            )}
            onPageChange={(p) => {
              // "Sin contar" y "Volver a contar" se achican mientras se cuenta:
              // lo contado sale de la lista y el resto se corre para adelante.
              // Pasar a la pagina siguiente con el mismo salto salteaba
              // productos; se vuelve a pedir la misma pagina, que ahora trae
              // los que seguian.
              const estadoDelFiltro =
                filtroConteo === 'pendientes'
                  ? 'PENDING'
                  : filtroConteo === 'recontar'
                    ? 'RECOUNT'
                    : null
              const salieron =
                contando &&
                estadoDelFiltro !== null &&
                lineas.data.some((l) => l.status !== estadoDelFiltro)
              if (p > pagina && salieron) void cargar()
              else setPagina(p)
            }}
          />
        </>
      )}

      {/* ---------------------------------------------- acciones del paso */}
      {(contando || enRevision) && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-surface px-4 py-3 sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="text-sm text-ink-muted">
            {contando && hayBorradores && 'Hay cantidades sin guardar: tocá Enter en cada una.'}
            {contando &&
              !hayBorradores &&
              sesion.lineas.pendientes > 0 &&
              `Para terminar, falta contar ${String(sesion.lineas.pendientes)} producto(s). Si no hay, poné 0.`}
            {contando && !puedeRevisar && ' Cuando termines, avisale al encargado.'}
            {enRevision && !puedeAplicar && 'Un encargado tiene que aplicar el inventario.'}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => {
                setMotivoCancelar('')
                setConfirmar('cancelar')
              }}
            >
              Cancelar inventario
            </Button>
            {contando && puedeRevisar && (
              <Button
                variant="primary"
                size="lg"
                disabled={sesion.lineas.pendientes > 0 || hayBorradores}
                onClick={() => {
                  setConfirmar('cerrar')
                }}
              >
                Terminé de contar
              </Button>
            )}
            {enRevision && puedeAplicar && (
              <Button
                variant="primary"
                size="xl"
                disabled={(sesion.conflictos ?? []).length > 0 || sesion.lineas.sinResolver > 0}
                onClick={() => {
                  setConfirmar('aplicar')
                }}
              >
                APLICAR INVENTARIO
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={confirmar === 'cerrar'}
        onClose={() => {
          setConfirmar(null)
        }}
        onConfirm={() => accion('revision', 'Listo. Ahora revisá las diferencias.')}
        title="¿Terminaste de contar?"
        confirmLabel="Sí, terminé"
        cancelLabel="Seguir contando"
        variant="primary"
        message="Después vas a ver las diferencias con lo que dice el sistema. Ya no se puede volver a cambiar lo contado."
      />

      <ConfirmationDialog
        open={confirmar === 'aplicar'}
        onClose={() => {
          setConfirmar(null)
        }}
        onConfirm={() =>
          accion(
            'aplicar',
            conDiferencia === 0
              ? 'Inventario terminado. El stock no cambió.'
              : 'Inventario aplicado: el stock quedó corregido.',
          )
        }
        title="Aplicar el inventario"
        confirmLabel="Aplicar inventario"
        cancelLabel="Volver a revisar"
        variant="primary"
        message={
          conDiferencia === 0 ? (
            'No hay diferencias. El inventario queda terminado y el stock no cambia.'
          ) : (
            <>
              Se va a corregir el stock de{' '}
              <strong>
                {conDiferencia} {conDiferencia === 1 ? 'producto' : 'productos'}
              </strong>{' '}
              para que coincida con lo contado
              {resumen !== null &&
                ` (faltan en ${String(resumen.faltan)}, sobran en ${String(resumen.sobran)})`}
              . <strong>Esto no se puede deshacer.</strong>
            </>
          )
        }
      />

      <ConfirmationDialog
        open={confirmar === 'cancelar'}
        onClose={() => {
          setConfirmar(null)
        }}
        onConfirm={async () => {
          if (motivoCancelar.trim().length < 3) {
            aviso.error('Escribí por qué se cancela (por lo menos 3 letras).')
            return
          }
          await accion('cancelar', 'Inventario cancelado. El stock no cambió.', {
            reason: motivoCancelar.trim(),
          })
        }}
        title="Cancelar el inventario"
        confirmLabel="Cancelar inventario"
        cancelLabel="No, volver"
        message="Lo contado se descarta y el stock no cambia. Esto no se puede deshacer."
      >
        <Field label="¿Por qué se cancela?" required>
          <Textarea
            rows={2}
            value={motivoCancelar}
            onChange={(e) => {
              setMotivoCancelar(e.target.value)
            }}
          />
        </Field>
      </ConfirmationDialog>
    </PageContainer>
  )
}

function BotonFiltro({
  activo,
  onClick,
  children,
}: {
  activo: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        'min-h-control rounded-md px-4 text-[0.9375rem] font-semibold transition-colors',
        activo
          ? 'border-2 border-primary bg-primary-quiet text-ink'
          : 'border border-line-strong bg-surface text-ink hover:bg-raised',
      )}
    >
      {children}
    </button>
  )
}
