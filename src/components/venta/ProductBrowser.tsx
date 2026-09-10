'use client'

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  Button,
  EmptyState,
  ErrorState,
  Money,
  SkeletonRows,
  cn,
  formatMoney,
} from '@/components/ui'
import type { Product } from '@/hooks/useProducts'
import { aMilesimas } from '@/lib/cantidad'
import {
  denominadorDePrecio,
  esFraccionable,
  formatearCantidadConUnidad,
} from '@/modules/products/units'
import { esTeclaDeGrilla, moverEnGrilla } from './teclado'
import type { SeccionDelCatalogo } from './Secciones'

/**
 * El catalogo a la vista: UNA COLUMNA, una fila por producto. UX V3.
 *
 * Antes de escribir nada, el punto de venta ya muestra productos: los mas
 * vendidos en esta caja, o una categoria, o todo. Con una letra en el campo,
 * la misma lista pasa a mostrar los resultados. Es lo que hace que se pueda
 * vender sin lector y sin saberse el nombre exacto (auditoria, H-29 y §22).
 *
 * QUE CAMBIO EN LA V3
 * -------------------
 * 1. NO ES UNA TABLA. La 2.1 tenia encabezado --PRODUCTO CATEGORIA STOCK
 *    PRECIO-- y cuatro columnas fijas. Se leia como una pantalla de
 *    administracion, y en 1024 px al nombre le quedaban 150 px: "Aceite de
 *    girasol 9…". Ahora la fila dice lo que hace falta para vender --nombre,
 *    estado, precio-- y el nombre se lleva todo el ancho sobrante, hasta dos
 *    renglones si hace falta. La categoria solo aparece desde 1536 px, donde
 *    sobra lugar.
 * 2. MAS FILAS A LA VISTA. Fila de 40 px con puntero fino, 48 tactil, 56 en
 *    el telefono --donde son dos renglones--. En 1366 x 768 entran quince
 *    donde entraban diez.
 * 3. NO HAY PARED A LAS 60 FILAS. El cartel "Se muestran 60 de 200: buscá por
 *    nombre" era un callejon sin salida. Ahora la lista sigue: al llegar al
 *    final se cargan las siguientes y se SUMAN, y ademas hay un boton por si
 *    el observador no dispara --teclado, lector de pantalla, un navegador
 *    viejo--.
 * 4. LA ESTRELLA NO VIVE EN EL TELEFONO. Ocupaba 44 px de cada fila para una
 *    accion que no es vender.
 *
 * El lector sigue siendo instantaneo con el foco en la lista: la rafaga del
 * lector USB la toma el escucha global, que solo se calla dentro de un campo
 * de texto.
 *
 * Dos maneras de recorrerla, y no compiten:
 *
 *   ↑ ↓ desde el campo   marcan la fila ELEGIDA sin mover el foco (el lector
 *                        sigue funcionando); → suma, Enter agrega
 *   Tab                  mete el foco de verdad en la lista, para lectores de
 *                        pantalla; las flechas lo mueven, Enter agrega,
 *                        Escape vuelve al campo
 */

export interface ProductBrowserProps {
  /** El termino buscado, o null si se muestra el catalogo. */
  busqueda: string | null
  /** Que seccion se esta mirando. Solo para el mensaje de lista vacia. */
  seccion: SeccionDelCatalogo
  productos: Product[]
  cargando: boolean
  error: string | null
  /** Cuantos hay en total, cuando la lista no los trae a todos. */
  total: number
  /** Quedan productos por traer: la lista sigue. */
  hayMas: boolean
  onCargarMas: () => void
  /** Indice de la fila marcada. -1 si ninguna. */
  resaltado: number
  /**
   * La fila marcada esta ELEGIDA: las flechas mandan aca.
   *
   * Sin esto, la marca es apenas una sugerencia --"Enter agrega esta"--
   * mientras se escribe. Es la diferencia visible entre estar escribiendo y
   * estar eligiendo un producto, y por eso no se dibuja igual (V3).
   */
  listaActiva: boolean
  onResaltar: (indice: number) => void
  /** `desdeElTeclado`: el foco se queda en la lista para seguir eligiendo. */
  onElegir: (producto: Product, desdeElTeclado: boolean) => void
  esFavorito: (productId: number) => boolean
  onFavorito: (productId: number) => void
  onVolverAlLector: () => void
  className?: string
}

/**
 * Las columnas de la fila, en un solo lugar.
 *
 * Tres formas, y en las tres el nombre se queda con lo que sobra:
 *
 *   telefono    dos renglones: nombre arriba; estado y precio abajo
 *   desde 640   un renglon: nombre · estado · precio
 *   desde 1536  aparece la categoria, que es lo primero que sobra
 */
const COLUMNAS = [
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3',
  'sm:grid-cols-[minmax(0,1fr)_auto_6.5rem]',
  '2xl:grid-cols-[minmax(0,1fr)_8.5rem_auto_6.5rem]',
].join(' ')

const CELDA_NOMBRE = 'col-span-2 col-start-1 row-start-1 min-w-0 sm:col-span-1'
/** La categoria: solo donde sobra ancho de verdad. */
const CELDA_CATEGORIA = 'hidden 2xl:col-start-2 2xl:row-start-1 2xl:block'
const CELDA_ESTADO =
  'col-start-1 row-start-2 sm:col-start-2 sm:row-start-1 sm:justify-self-end 2xl:col-start-3'
const CELDA_PRECIO =
  'col-start-2 row-start-2 justify-self-end sm:col-start-3 sm:row-start-1 2xl:col-start-4'

export function ProductBrowser({
  busqueda,
  seccion,
  productos,
  cargando,
  error,
  total,
  hayMas,
  onCargarMas,
  resaltado,
  listaActiva,
  onResaltar,
  onElegir,
  esFavorito,
  onFavorito,
  onVolverAlLector,
  className,
}: ProductBrowserProps) {
  const lista = useRef<HTMLDivElement>(null)
  const contenedor = useRef<HTMLDivElement>(null)
  const centinela = useRef<HTMLDivElement>(null)
  /** La fila que recibe el foco con Tab. Sigue a la marcada. */
  const [enfocada, setEnfocada] = useState(0)
  const buscando = busqueda !== null

  useEffect(() => {
    if (resaltado >= 0) setEnfocada(resaltado)
  }, [resaltado])

  // Si la lista se achica, el foco no apunta a una fila que ya no esta.
  useEffect(() => {
    if (enfocada >= productos.length) setEnfocada(Math.max(0, productos.length - 1))
  }, [productos.length, enfocada])

  // La fila elegida con el teclado, siempre a la vista: el foco no se mueve,
  // asi que el navegador no la desplaza solo.
  useEffect(() => {
    if (!listaActiva || resaltado < 0) return
    lista.current
      ?.querySelector<HTMLElement>(`[data-fila][data-indice="${String(resaltado)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [listaActiva, resaltado])

  /**
   * Al llegar al final, la lista sigue.
   *
   * `rootMargin` de 300 px: se pide la pagina siguiente ANTES de tocar el
   * fondo, asi el desplazamiento no se frena. Si el navegador no tiene
   * observador --o nadie se desplaza porque se navega con el teclado-- queda
   * el boton, que hace lo mismo.
   */
  useEffect(() => {
    const el = centinela.current
    if (!el || !hayMas || cargando) return
    if (typeof IntersectionObserver === 'undefined') return
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) onCargarMas()
      },
      { root: contenedor.current, rootMargin: '300px' },
    )
    observador.observe(el)
    return () => {
      observador.disconnect()
    }
  }, [hayMas, cargando, onCargarMas, productos.length])

  const enfocarFila = useCallback((indice: number) => {
    const boton = lista.current?.querySelector<HTMLButtonElement>(
      `[data-fila][data-indice="${String(indice)}"]`,
    )
    boton?.focus()
    boton?.scrollIntoView({ block: 'nearest' })
  }, [])

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
    // extremos.
    const siguiente = moverEnGrilla(enfocada, e.key, productos.length, 1)
    if (siguiente < 0) return
    // Bajar desde la ultima fila trae mas, en vez de quedarse trabado.
    if (siguiente === enfocada && e.key === 'ArrowDown' && hayMas) onCargarMas()
    setEnfocada(siguiente)
    onResaltar(siguiente)
    enfocarFila(siguiente)
  }

  return (
    /* `pb-24` en el telefono: la barra fija de abajo no tapa la ultima fila. */
    <div ref={contenedor} className={cn('min-h-0 overflow-y-auto pb-24 xl:pb-0', className)}>
      <>
        {error ? (
          <ErrorState title="No se pudo cargar el catálogo" description={error} />
        ) : cargando && productos.length === 0 ? (
          <SkeletonRows rows={8} />
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
              ref={lista}
              role="group"
              aria-label={buscando ? 'Resultados de la búsqueda' : 'Productos'}
              onKeyDown={alPresionarEnLaLista}
              className="border-y border-line bg-surface"
            >
              {productos.map((p, i) => (
                <FilaDeProducto
                  key={p.id}
                  producto={p}
                  indice={i}
                  resaltada={i === resaltado}
                  elegida={i === resaltado && listaActiva}
                  enfocable={i === enfocada}
                  favorito={esFavorito(p.id)}
                  onElegir={onElegir}
                  onFavorito={onFavorito}
                />
              ))}
            </div>

            <div ref={centinela} aria-hidden="true" className="h-px" />

            {hayMas && (
              <div className="mt-2 flex flex-col items-center gap-1 pb-2">
                <Button size="sm" variant="secondary" onClick={onCargarMas} disabled={cargando}>
                  {cargando ? 'Cargando…' : 'Ver más productos'}
                </Button>
                <p className="text-xs text-ink-faint" data-numeric="" aria-live="polite">
                  {productos.length} de {total}
                </p>
              </div>
            )}
          </>
        )}
      </>
    </div>
  )
}

// --------------------------------------------------------------------- fila

/**
 * Que decir del stock, en palabras.
 *
 * Agotado es no tener NADA VENDIBLE: con diez unidades vencidas hay stock y
 * no se puede vender. Cuando es por vencimiento se dice asi --"Vencido"--,
 * que no es lo mismo para el que repone: uno hay que pedirlo y el otro hay
 * que sacarlo de la gondola.
 */
function estadoDelProducto(producto: Product): {
  texto: string
  tono: string
  agotado: boolean
} {
  const agotado = aMilesimas(producto.sellableStock) <= 0
  const porVencimiento = agotado && aMilesimas(producto.expiredStock) > 0
  const cantidad = formatearCantidadConUnidad(producto.sellableStock, producto.saleUnit)

  if (agotado) {
    return { texto: porVencimiento ? 'Vencido' : 'Agotado', tono: 'text-danger', agotado: true }
  }
  if (producto.estado === 'LOW') {
    return { texto: `Quedan ${cantidad}`, tono: 'text-warning', agotado: false }
  }
  const porPeso = esFraccionable(producto.saleUnit)
  return {
    texto: porPeso ? `${cantidad} · se pesa` : cantidad,
    tono: 'text-ink-muted',
    agotado: false,
  }
}

const FilaDeProducto = memo(function FilaDeProducto({
  producto,
  indice,
  resaltada,
  elegida,
  enfocable,
  favorito,
  onElegir,
  onFavorito,
}: {
  producto: Product
  indice: number
  /** Marcada: o bien elegida, o bien la que agregaria Enter. */
  resaltada: boolean
  /** Elegida de verdad: las flechas actuan sobre esta fila. */
  elegida: boolean
  enfocable: boolean
  favorito: boolean
  onElegir: (producto: Product, desdeElTeclado: boolean) => void
  onFavorito: (productId: number) => void
}) {
  const estado = estadoDelProducto(producto)
  const denominador = denominadorDePrecio(producto.saleUnit)

  function alClic(e: MouseEvent<HTMLButtonElement>) {
    // `detail` es 0 cuando el clic lo disparo Enter o la barra: quien navega
    // con el teclado se queda en la lista para seguir eligiendo; quien toca
    // vuelve al lector, que es donde va a caer el proximo codigo.
    onElegir(producto, e.detail === 0)
  }

  return (
    <div className="group relative">
      <button
        type="button"
        data-fila=""
        data-indice={indice}
        data-elegida={elegida || undefined}
        tabIndex={enfocable ? 0 : -1}
        disabled={estado.agotado}
        aria-current={elegida || undefined}
        aria-label={`${producto.name}, ${estado.agotado ? estado.texto.toLowerCase() : formatearPrecio(producto)}`}
        onClick={alClic}
        className={cn(
          // Telefono: dos renglones y 56 px --el nombre entero arriba, estado
          // y precio abajo--. Desde `sm`, un solo renglon de 40 px; 48 con el
          // dedo, donde 40 no se acierta.
          // La linea que separa las filas es una SOMBRA y no un borde: un
          // borde de 1 px por fila son 14 px cada quince filas, y a 40 px por
          // fila eso es exactamente una fila menos a la vista.
          'w-full border-l-[3px] py-1 pr-2 pl-2 text-left transition-colors',
          'shadow-[inset_0_-1px_0_var(--color-line)]',
          'min-h-14 sm:min-h-10 [@media(pointer:coarse)]:min-h-12',
          'xl:pr-11',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
          COLUMNAS,
          estado.agotado && 'cursor-not-allowed opacity-55',
          // Tres estados bien distintos: elegida --las flechas actuan aca--,
          // apenas marcada --Enter la agregaria-- y el resto.
          elegida
            ? 'border-l-primary bg-selection'
            : resaltada
              ? 'border-l-primary/50 hover:bg-raised'
              : 'border-l-transparent hover:bg-raised focus-visible:border-l-primary focus-visible:bg-selection',
        )}
      >
        {/* EL NOMBRE MANDA: se lleva todo el ancho sobrante y, si no entra,
            usa un segundo renglon en vez de cortarse. "Aceite de girasol
            900 ml" no puede terminar en "Aceite de girasol 9…". */}
        <span className={CELDA_NOMBRE}>
          <span
            data-nombre=""
            className="line-clamp-2 text-[0.9375rem] leading-tight font-medium text-ink"
          >
            {producto.name}
          </span>
        </span>

        <span className={cn(CELDA_CATEGORIA, 'truncate text-sm text-ink-faint')}>
          {producto.category.name}
        </span>

        <span className={cn(CELDA_ESTADO, 'text-[0.8125rem]', estado.tono)} data-numeric="">
          {estado.texto}
        </span>

        <span className={cn(CELDA_PRECIO, 'flex items-baseline justify-end gap-1')} data-numeric="">
          <Money amount={producto.price} size="md" />
          {denominador && <span className="text-xs text-ink-faint">{denominador}</span>}
        </span>
      </button>

      {/* La estrella: favorito de esta caja. Solo en escritorio, y solo al
          pasar por encima o enfocar la fila. En el telefono no: ocupaba
          44 px de cada fila para algo que no es vender, y ahi el ancho es
          justo lo que falta (V3). */}
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
          'absolute inset-y-0 right-0 hidden w-10 items-center justify-center text-base leading-none transition-opacity xl:flex',
          'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
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
