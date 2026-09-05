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
 * El catalogo a la vista. UX V2, Fase 2.
 *
 * Antes de escribir nada, el punto de venta ya muestra productos: los mas
 * vendidos en esta caja, o una categoria, o todo. Con una letra en el campo,
 * la misma grilla pasa a mostrar los resultados. Es lo que hace que se pueda
 * vender sin lector y sin saberse el nombre exacto (auditoria, H-29 y §22).
 *
 * Tres maneras de llegar a una tarjeta, y las tres agregan:
 *
 *   un toque o un clic          → agrega, y el foco vuelve al lector
 *   ↑ ↓ desde el campo, buscando → resalta; Enter agrega
 *   Tab o ↓ con el ticket vacio  → el foco entra a la grilla; las flechas la
 *                                 recorren; Enter agrega; Escape vuelve al
 *                                 lector
 *
 * El lector sigue siendo instantaneo con el foco en la grilla: la rafaga del
 * lector USB la toma el escucha global, que solo se calla dentro de un campo
 * de texto.
 *
 * No hay imagenes: en un almacen no aportan y en una tablet pesan. Nombre,
 * precio y --cuando importa-- "se pesa" y cuanto queda.
 */

/** Que se muestra cuando no se esta buscando. */
export type SeccionDelCatalogo = 'frecuentes' | 'todos' | number

export interface ProductBrowserHandle {
  /** Lleva el foco a la tarjeta resaltada, o a la primera. */
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
  /** Indice de la tarjeta resaltada desde el campo. -1 si ninguna. */
  resaltado: number
  onResaltar: (indice: number) => void
  /** `desdeElTeclado`: el foco se queda en la grilla para seguir eligiendo. */
  onElegir: (producto: Product, desdeElTeclado: boolean) => void
  esFavorito: (productId: number) => boolean
  onFavorito: (productId: number) => void
  onVolverAlLector: () => void
  className?: string
}

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
    const grilla = useRef<HTMLDivElement>(null)
    /** La tarjeta que recibe el foco con Tab. Sigue al resaltado. */
    const [enfocada, setEnfocada] = useState(0)
    const buscando = busqueda !== null

    useEffect(() => {
      if (resaltado >= 0) setEnfocada(resaltado)
    }, [resaltado])

    // Si la lista se achica, el foco no apunta a una tarjeta que ya no esta.
    useEffect(() => {
      if (enfocada >= productos.length) setEnfocada(Math.max(0, productos.length - 1))
    }, [productos.length, enfocada])

    const enfocarTarjeta = useCallback((indice: number) => {
      const boton = grilla.current?.querySelector<HTMLButtonElement>(
        `[data-tarjeta][data-indice="${String(indice)}"]`,
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
          enfocarTarjeta(indice)
        },
      }),
      [resaltado, enfocada, enfocarTarjeta],
    )

    /** Cuantas tarjetas entran por fila, leido del CSS: es lo que ↑ ↓ saltan. */
    function columnas(): number {
      const el = grilla.current
      if (!el) return 1
      return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length)
    }

    function alPresionarEnLaGrilla(e: KeyboardEvent<HTMLDivElement>) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onVolverAlLector()
        return
      }
      // Enter agrega la tarjeta enfocada. Se hace aca y no por la activacion
      // nativa del boton para que dependa de la tecla y no de como cada
      // navegador --o cada lector de pantalla-- sintetiza el clic.
      if (e.key === 'Enter') {
        const boton = e.target instanceof HTMLElement ? e.target.closest('[data-tarjeta]') : null
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
      const siguiente = moverEnGrilla(enfocada, e.key, productos.length, columnas())
      if (siguiente < 0) return
      setEnfocada(siguiente)
      onResaltar(siguiente)
      enfocarTarjeta(siguiente)
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
            <SkeletonRows rows={4} />
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
              <div
                ref={grilla}
                role="group"
                aria-label={buscando ? 'Resultados de la búsqueda' : 'Productos'}
                onKeyDown={alPresionarEnLaGrilla}
                className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2"
              >
                {productos.map((p, i) => (
                  <TarjetaDeProducto
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

// ---------------------------------------------------------------- categorias

/**
 * Las secciones como chips: "Frecuentes", "Todos" y una por categoria.
 *
 * Roving tabindex: un solo chip entra con Tab y las flechas cambian de
 * seccion. Ocho categorias serian ocho paradas de Tab entre el lector y la
 * grilla, y eso es lo que hace que nadie use el teclado.
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
      className="-mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] lg:flex-wrap lg:overflow-visible"
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
              'min-h-touch shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors',
              esActiva
                ? 'border-primary bg-primary-quiet text-ink'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {o.etiqueta}
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ tarjeta

const TarjetaDeProducto = memo(function TarjetaDeProducto({
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
  // no se puede vender.
  const agotado = aMilesimas(producto.sellableStock) <= 0
  const quedaPoco = !agotado && producto.estado === 'LOW'
  const porPeso = esFraccionable(producto.saleUnit)

  function alClic(e: MouseEvent<HTMLButtonElement>) {
    // `detail` es 0 cuando el clic lo disparo Enter o la barra: quien navega
    // con el teclado se queda en la grilla para seguir eligiendo; quien toca
    // vuelve al lector, que es donde va a caer el proximo codigo.
    onElegir(producto, e.detail === 0)
  }

  return (
    <div className="group relative">
      <button
        type="button"
        data-tarjeta=""
        data-indice={indice}
        tabIndex={enfocable ? 0 : -1}
        disabled={agotado}
        aria-current={resaltada || undefined}
        aria-label={`${producto.name}, ${agotado ? 'agotado' : formatearPrecio(producto)}`}
        onMouseEnter={() => {
          onHover(indice)
        }}
        onClick={alClic}
        className={cn(
          'flex min-h-[5.5rem] w-full flex-col justify-between gap-2 rounded-lg border p-3 text-left transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          agotado && 'cursor-not-allowed opacity-50',
          resaltada
            ? 'border-primary bg-primary-quiet'
            : 'border-line bg-surface hover:border-line-strong hover:bg-raised',
        )}
      >
        <span className="line-clamp-2 pr-9 text-sm leading-snug font-medium text-ink">
          {producto.name}
        </span>
        <span className="flex w-full items-end justify-between gap-2">
          <span className="text-xs text-ink-faint">
            {agotado
              ? 'Agotado'
              : quedaPoco
                ? `Quedan ${formatearCantidadConUnidad(producto.sellableStock, producto.saleUnit)}`
                : porPeso
                  ? 'Se pesa'
                  : ''}
          </span>
          <span className="text-right" data-numeric="">
            <Money amount={producto.price} size="md" />
            {porPeso && (
              <span className="block text-xs text-ink-faint">
                {denominadorDePrecio(producto.saleUnit)}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* La estrella: favorito de esta caja. Aparece al pasar por encima o
          al enfocar la tarjeta; en una pantalla tactil, siempre. 44 px de
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
          'absolute top-0 right-0 flex h-touch w-touch items-center justify-center rounded-lg text-lg leading-none transition-opacity',
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
