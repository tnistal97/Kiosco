'use client'

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { EmptyState, ErrorState, Money, SkeletonRows, cn, formatMoney } from '@/components/ui'
import type { Category, Product } from '@/hooks/useProducts'
import { aMilesimas } from '@/lib/cantidad'
import {
  denominadorDePrecio,
  esFraccionable,
  formatearCantidadConUnidad,
} from '@/modules/products/units'
import { esTeclaDeGrilla, moverEnGrilla } from './teclado'

/**
 * El catalogo a la vista. UX V2, Fase 2 --lista operativa, Fase 2.1--.
 *
 * Antes de escribir nada, el punto de venta ya muestra productos: los mas
 * vendidos en esta caja, o una categoria, o todo. Con una letra en el campo,
 * la misma lista pasa a mostrar los resultados. Es lo que hace que se pueda
 * vender sin lector y sin saberse el nombre exacto (auditoria, H-29 y §22).
 *
 * POR QUE LISTA Y NO TARJETAS (2.1)
 * ---------------------------------
 * La fase 2 mostro el catalogo en tarjetas de 10rem. Funcionaba, pero se leia
 * como una tienda: cada producto ocupaba 176 x 88 px para decir dos datos, los
 * nombres largos se cortaban en dos lineas ("Aceite de girasol 900 / ml"),
 * todas las tarjetas se parecian y encontrar una exigia barrer la pantalla en
 * zigzag. Una lista con columnas fijas se lee en vertical: el ojo baja por los
 * nombres, y categoria, stock y precio estan siempre en la misma coordenada.
 *
 * Se cambio densidad por legibilidad, y conviene decirlo con los numeros
 * medidos en las capturas de docs/ux-v2-phase2_1-evidence: en 1366 px entran
 * 11 filas y media donde entraban 16 tarjetas. Cada fila, a cambio, dice el
 * nombre entero en un renglon y agrega dos datos que la tarjeta no mostraba.
 * En el telefono la densidad es la misma --siete filas donde entraban siete
 * tarjetas en 375 x 667-- pero el nombre entra entero en un renglon y el
 * precio se lee de un vistazo, sin cortes.
 *
 * Tres maneras de llegar a una fila, y las tres agregan:
 *
 *   un toque o un clic          → agrega, y el foco vuelve al lector
 *   ↑ ↓ desde el campo, buscando → resalta; Enter agrega
 *   Tab o ↓ con el ticket vacio  → el foco entra a la lista; ↑ ↓ la recorren;
 *                                 Enter agrega; Escape vuelve al lector
 *
 * El lector sigue siendo instantaneo con el foco en la lista: la rafaga del
 * lector USB la toma el escucha global, que solo se calla dentro de un campo
 * de texto.
 *
 * No hay imagenes: en un almacen no aportan y en una tablet pesan. Nombre,
 * categoria, stock, precio y --cuando importa-- "se pesa" y cuanto queda.
 */

/** Que se muestra cuando no se esta buscando. */
export type SeccionDelCatalogo = 'frecuentes' | 'todos' | number

export interface ProductBrowserHandle {
  /** Lleva el foco a la fila resaltada, o a la primera. */
  enfocar: () => void
}

export interface ProductBrowserProps {
  /** El termino buscado, o null si se muestra el catalogo. */
  busqueda: string | null
  seccion: SeccionDelCatalogo
  onSeccion: (seccion: SeccionDelCatalogo) => void
  categorias: Category[]
  /** Si hay algo que mostrar en "Frecuentes" (favoritos o mas vendidos). */
  hayFrecuentes: boolean
  productos: Product[]
  cargando: boolean
  error: string | null
  /** Cuantos hay en total, cuando la lista no los trae a todos. */
  total: number
  /** Indice de la fila resaltada desde el campo. -1 si ninguna. */
  resaltado: number
  onResaltar: (indice: number) => void
  /** `desdeElTeclado`: el foco se queda en la lista para seguir eligiendo. */
  onElegir: (producto: Product, desdeElTeclado: boolean) => void
  esFavorito: (productId: number) => boolean
  onFavorito: (productId: number) => void
  onVolverAlLector: () => void
  className?: string
}

/**
 * Las columnas, en un solo lugar: la cabecera y las filas tienen que estar
 * alineadas al pixel o la lista deja de leerse como tabla.
 *
 * Tres formas segun el ancho DISPONIBLE, que no es el de la pantalla:
 *
 *   hasta 768   dos renglones: nombre arriba, precio abajo (telefono)
 *   768 a 1024  cuatro columnas; la tablet no dibuja el ticket al costado,
 *               asi que el catalogo tiene la pantalla entera
 *   1024 a 1280 TRES columnas: aparece el ticket de 440 px y al catalogo le
 *               quedan unos 520; la categoria es lo primero que sobra
 *   desde 1280  cuatro otra vez, con lugar de sobra para el nombre
 */
const COLUMNAS = [
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3',
  'md:grid-cols-[minmax(0,1fr)_9rem_8rem_9.5rem]',
  'lg:grid-cols-[minmax(0,1fr)_7.5rem_9rem]',
  'xl:grid-cols-[minmax(0,1fr)_9rem_8rem_9.5rem]',
].join(' ')

/** La celda de categoria: se esconde cuando el ticket se come el ancho. */
const CELDA_CATEGORIA = 'hidden md:col-start-2 md:row-start-1 md:block lg:hidden xl:block'
/** El stock cambia de columna en cada forma. */
const CELDA_STOCK =
  'col-start-2 row-start-1 justify-self-end md:col-start-3 md:justify-self-start lg:col-start-2 xl:col-start-3'
/** El precio: segundo renglon en el telefono, ultima columna en el resto. */
const CELDA_PRECIO =
  'col-start-1 row-start-2 md:col-start-4 md:row-start-1 md:justify-end lg:col-start-3 xl:col-start-4'

export const ProductBrowser = forwardRef<ProductBrowserHandle, ProductBrowserProps>(
  function ProductBrowser(
    {
      busqueda,
      seccion,
      onSeccion,
      categorias,
      hayFrecuentes,
      productos,
      cargando,
      error,
      total,
      resaltado,
      onResaltar,
      onElegir,
      esFavorito,
      onFavorito,
      onVolverAlLector,
      className,
    },
    ref,
  ) {
    const lista = useRef<HTMLDivElement>(null)
    /** La fila que recibe el foco con Tab. Sigue al resaltado. */
    const [enfocada, setEnfocada] = useState(0)
    const buscando = busqueda !== null

    useEffect(() => {
      if (resaltado >= 0) setEnfocada(resaltado)
    }, [resaltado])

    // Si la lista se achica, el foco no apunta a una fila que ya no esta.
    useEffect(() => {
      if (enfocada >= productos.length) setEnfocada(Math.max(0, productos.length - 1))
    }, [productos.length, enfocada])

    const enfocarFila = useCallback((indice: number) => {
      const boton = lista.current?.querySelector<HTMLButtonElement>(
        `[data-fila][data-indice="${String(indice)}"]`,
      )
      boton?.focus()
      boton?.scrollIntoView({ block: 'nearest' })
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        enfocar: () => {
          const indice = resaltado >= 0 ? resaltado : enfocada
          setEnfocada(indice)
          enfocarFila(indice)
        },
      }),
      [resaltado, enfocada, enfocarFila],
    )

    function alPresionarEnLaLista(e: KeyboardEvent<HTMLDivElement>) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onVolverAlLector()
        return
      }
      // Enter agrega la fila enfocada. Se hace aca y no por la activacion
      // nativa del boton para que dependa de la tecla y no de como cada
      // navegador --o cada lector de pantalla-- sintetiza el clic.
      if (e.key === 'Enter') {
        const boton = e.target instanceof HTMLElement ? e.target.closest('[data-fila]') : null
        const indice = Number(boton?.getAttribute('data-indice') ?? '-1')
        const producto = productos[indice]
        if (boton instanceof HTMLButtonElement && !boton.disabled && producto) {
          e.preventDefault()
          onElegir(producto, true)
        }
        return
      }
      if (!esTeclaDeGrilla(e.key)) return
      e.preventDefault()
      // Una sola columna: ↑ ↓ ← → mueven de a una fila, Inicio y Fin a los
      // extremos. La aritmetica es la misma que la de la grilla de la fase 2.
      const siguiente = moverEnGrilla(enfocada, e.key, productos.length, 1)
      if (siguiente < 0) return
      setEnfocada(siguiente)
      onResaltar(siguiente)
      enfocarFila(siguiente)
    }

    return (
      <div className={cn('flex min-h-0 flex-col gap-3', className)}>
        {!buscando && (
          <Categorias
            seccion={seccion}
            onSeccion={onSeccion}
            categorias={categorias}
            hayFrecuentes={hayFrecuentes}
          />
        )}

        {/* `pb-24` en el telefono: la barra fija de abajo no tapa la ultima fila. */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0">
          {error ? (
            <ErrorState title="No se pudo cargar el catálogo" description={error} />
          ) : cargando && productos.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : productos.length === 0 ? (
            buscando ? (
              <EmptyState
                title="Ningún producto coincide"
                description={`No hay resultados para "${busqueda.trim()}". Probá con otra palabra, o creá el producto.`}
              />
            ) : seccion === 'frecuentes' ? (
              <EmptyState
                title="Todavía no hay frecuentes"
                description="Se llenan solos con lo que más se vende en esta caja. Marcá con ★ lo que no tiene código —pan, verdura, fiambre— para tenerlo acá."
              />
            ) : (
              <EmptyState
                title="No hay productos acá"
                description="Esta categoría no tiene productos activos."
              />
            )
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-line bg-surface">
                <Encabezado />
                <div
                  ref={lista}
                  role="group"
                  aria-label={buscando ? 'Resultados de la búsqueda' : 'Productos'}
                  onKeyDown={alPresionarEnLaLista}
                  className="divide-y divide-line"
                >
                  {productos.map((p, i) => (
                    <FilaDeProducto
                      key={p.id}
                      producto={p}
                      indice={i}
                      resaltada={i === resaltado}
                      enfocable={i === enfocada}
                      favorito={esFavorito(p.id)}
                      onHover={onResaltar}
                      onElegir={onElegir}
                      onFavorito={onFavorito}
                    />
                  ))}
                </div>
              </div>
              {total > productos.length && (
                <p className="mt-3 text-center text-xs text-ink-faint">
                  Se muestran {productos.length} de {total}. Buscá por nombre para encontrar el
                  resto.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    )
  },
)

// ---------------------------------------------------------------- cabecera

/**
 * Los nombres de las columnas, solo en escritorio.
 *
 * `aria-hidden`: para quien escucha, cada fila ya dice nombre y precio en su
 * etiqueta; repetir los encabezados no agrega nada y alarga el recorrido.
 * Queda pegada arriba mientras la lista se desplaza.
 */
function Encabezado() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'sticky top-0 z-10 hidden border-b border-line bg-raised px-3 py-1.5 md:grid',
        'text-[11px] font-medium tracking-wide text-ink-faint uppercase',
        COLUMNAS,
      )}
    >
      <span className="col-start-1 row-start-1">Producto</span>
      <span className={CELDA_CATEGORIA}>Categoría</span>
      <span className={CELDA_STOCK}>Stock</span>
      <span className={cn(CELDA_PRECIO, 'text-right')}>Precio</span>
    </div>
  )
}

// ---------------------------------------------------------------- categorias

/**
 * Las secciones como chips: "Frecuentes", "Todos" y una por categoria.
 *
 * Roving tabindex: un solo chip entra con Tab y las flechas cambian de
 * seccion. Ocho categorias serian ocho paradas de Tab entre el lector y la
 * lista, y eso es lo que hace que nadie use el teclado.
 *
 * En 2.1 adelgazaron: el chip inactivo es texto sin borde --la fila de
 * secciones no tiene por que pesar mas que la lista que filtra-- y el activo
 * es el unico con fondo. En una pantalla tactil siguen midiendo 44 px.
 */
function Categorias({
  seccion,
  onSeccion,
  categorias,
  hayFrecuentes,
}: {
  seccion: SeccionDelCatalogo
  onSeccion: (seccion: SeccionDelCatalogo) => void
  categorias: Category[]
  hayFrecuentes: boolean
}) {
  const opciones: Array<{ clave: SeccionDelCatalogo; etiqueta: string }> = [
    ...(hayFrecuentes ? [{ clave: 'frecuentes' as const, etiqueta: 'Frecuentes' }] : []),
    { clave: 'todos' as const, etiqueta: 'Todos' },
    ...categorias.map((c) => ({ clave: c.id, etiqueta: c.name })),
  ]
  const activa = opciones.some((o) => o.clave === seccion) ? seccion : 'todos'

  function alPresionar(e: KeyboardEvent<HTMLDivElement>) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    const i = opciones.findIndex((o) => o.clave === activa)
    const siguiente = opciones[Math.min(opciones.length - 1, Math.max(0, i + delta))]
    if (!siguiente || siguiente.clave === activa) return
    onSeccion(siguiente.clave)
    e.currentTarget
      .querySelector<HTMLButtonElement>(`[data-seccion="${String(siguiente.clave)}"]`)
      ?.focus()
  }

  return (
    <div
      role="group"
      aria-label="Secciones del catálogo"
      onKeyDown={alPresionar}
      // En el telefono se desplazan de costado; en escritorio, con lugar de
      // sobra, se envuelven y se ven todas.
      className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] lg:flex-wrap lg:overflow-visible"
    >
      {opciones.map((o) => {
        const esActiva = o.clave === activa
        return (
          <button
            key={String(o.clave)}
            type="button"
            data-seccion={String(o.clave)}
            aria-pressed={esActiva}
            tabIndex={esActiva ? 0 : -1}
            onClick={() => {
              onSeccion(o.clave)
            }}
            className={cn(
              'min-h-touch shrink-0 rounded-md border px-3 text-sm whitespace-nowrap transition-colors lg:min-h-9',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              esActiva
                ? 'border-primary bg-primary-quiet font-medium text-ink'
                : 'border-transparent text-ink-muted hover:bg-raised hover:text-ink',
            )}
          >
            {o.etiqueta}
          </button>
        )
      })}
    </div>
  )
}

// --------------------------------------------------------------------- fila

const FilaDeProducto = memo(function FilaDeProducto({
  producto,
  indice,
  resaltada,
  enfocable,
  favorito,
  onHover,
  onElegir,
  onFavorito,
}: {
  producto: Product
  indice: number
  resaltada: boolean
  enfocable: boolean
  favorito: boolean
  onHover: (indice: number) => void
  onElegir: (producto: Product, desdeElTeclado: boolean) => void
  onFavorito: (productId: number) => void
}) {
  // Agotado es no tener NADA VENDIBLE: con diez unidades vencidas hay stock y
  // no se puede vender. Cuando es por vencimiento se dice asi --"Vencido"--,
  // que no es lo mismo para el que repone: uno hay que pedirlo y el otro hay
  // que sacarlo de la gondola.
  const agotado = aMilesimas(producto.sellableStock) <= 0
  const porVencimiento = agotado && aMilesimas(producto.expiredStock) > 0
  const quedaPoco = !agotado && producto.estado === 'LOW'
  const porPeso = esFraccionable(producto.saleUnit)
  const denominador = denominadorDePrecio(producto.saleUnit)

  function alClic(e: MouseEvent<HTMLButtonElement>) {
    // `detail` es 0 cuando el clic lo disparo Enter o la barra: quien navega
    // con el teclado se queda en la lista para seguir eligiendo; quien toca
    // vuelve al lector, que es donde va a caer el proximo codigo.
    onElegir(producto, e.detail === 0)
  }

  const cantidad = formatearCantidadConUnidad(producto.sellableStock, producto.saleUnit)

  return (
    <div className="group relative">
      <button
        type="button"
        data-fila=""
        data-indice={indice}
        tabIndex={enfocable ? 0 : -1}
        disabled={agotado}
        aria-current={resaltada || undefined}
        aria-label={`${producto.name}, ${agotado ? (porVencimiento ? 'vencido' : 'agotado') : formatearPrecio(producto)}`}
        onMouseEnter={() => {
          onHover(indice)
        }}
        onClick={alClic}
        className={cn(
          // Telefono: dos renglones --nombre y estado arriba, precio abajo--.
          // Desde `md`, una sola linea con las columnas de la cabecera.
          // Cada dato se dibuja UNA sola vez y cambia de celda con el ancho:
          // duplicar el precio para "la version movil" es como se termina
          // arreglando uno y olvidando el otro.
          'min-h-touch w-full border-l-[3px] py-1.5 pr-13 pl-2 text-left transition-colors',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
          COLUMNAS,
          agotado && 'cursor-not-allowed opacity-55',
          resaltada
            ? 'border-l-primary bg-selection'
            : 'border-l-transparent hover:bg-raised focus-visible:border-l-primary focus-visible:bg-selection',
        )}
      >
        <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{producto.name}</span>
          {porPeso && (
            <span className="shrink-0 rounded bg-raised px-1.5 py-px text-[11px] text-ink-muted">
              Se pesa
            </span>
          )}
        </span>

        {/* La categoria nunca en el telefono: en el mostrador no se elige por
            categoria --para eso estan los chips de arriba--, se elige por
            nombre. Y tampoco cuando el ticket se lleva el ancho. */}
        <span className={cn(CELDA_CATEGORIA, 'truncate text-sm text-ink-muted')}>
          {producto.category.name}
        </span>

        <span
          className={cn(
            CELDA_STOCK,
            'text-sm',
            // En el telefono el stock solo aparece cuando cambia una decision:
            // no queda, o queda poco.
            !agotado && !quedaPoco && 'hidden md:block',
            agotado ? 'text-danger' : quedaPoco ? 'text-warning' : 'text-ink-muted',
          )}
          data-numeric=""
        >
          {agotado
            ? porVencimiento
              ? 'Vencido'
              : 'Agotado'
            : quedaPoco
              ? `Quedan ${cantidad}`
              : cantidad}
        </span>

        <span className={cn(CELDA_PRECIO, 'flex items-baseline gap-1')} data-numeric="">
          <Money amount={producto.price} size="md" />
          {porPeso && <span className="text-xs text-ink-faint">{denominador}</span>}
        </span>
      </button>

      {/* La estrella: favorito de esta caja. Aparece al pasar por encima o
          al enfocar la fila; en una pantalla tactil, siempre. 44 px de
          objetivo aunque el simbolo sea chico. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={
          favorito
            ? `Quitar ${producto.name} de favoritos`
            : `Marcar ${producto.name} como favorito`
        }
        aria-pressed={favorito}
        onClick={() => {
          onFavorito(producto.id)
        }}
        className={cn(
          'absolute inset-y-0 right-0 flex w-touch items-center justify-center text-lg leading-none transition-opacity',
          'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          favorito ? 'text-warning opacity-100' : 'text-ink-faint hover:text-warning',
        )}
      >
        <span aria-hidden="true">{favorito ? '★' : '☆'}</span>
      </button>
    </div>
  )
})

function formatearPrecio(p: Product): string {
  return `${formatMoney(p.price)} ${denominadorDePrecio(p.saleUnit)}`.trim()
}
