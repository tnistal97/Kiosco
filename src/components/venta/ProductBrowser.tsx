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
  Kbd,
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
import { esRepeticionIgnorada, esTeclaDeGrilla, moverEnGrilla } from './teclado'
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
 * El lector sigue siendo instantaneo con el foco en la lista: la primera
 * tecla imprimible lleva el foco al buscador y la rafaga termina ahi.
 *
 * Dos maneras de recorrerla, con las MISMAS teclas (V6):
 *
 *   desde el buscador    ↑ ↓ marcan el producto ELEGIDO sin mover el foco (el
 *                        lector sigue funcionando)
 *   Tab                  mete el foco de verdad en la lista, para lectores de
 *                        pantalla; ↑ ↓ lo mueven
 *
 * y en las dos, → suma una unidad del elegido, ← resta una, Enter pasa al
 * carrito (no agrega nada) y Escape vuelve al buscador. Tocar una fila con el
 * dedo o el mouse agrega una unidad, como en cualquier caja tactil.
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
  /** Indice de la fila ELEGIDA: la que suma → y resta ←. -1 si ninguna. */
  resaltado: number
  /**
   * La venta esta en la etapa de productos: la fila elegida se marca.
   *
   * En el carrito y en el cobro las flechas mandan en otro lado, y una marca
   * en la lista haria creer que → todavia suma aca.
   */
  listaActiva: boolean
  onResaltar: (indice: number) => void
  /** Un toque, un clic o la barra espaciadora sobre una fila: una unidad mas. */
  onElegir: (producto: Product) => void
  /** → (+1) o ← (-1) con el foco en una fila. */
  onAjustar: (producto: Product, delta: -1 | 1) => void
  /** Enter con el foco en una fila: pasar al carrito. */
  onContinuar: () => void
  /** Cuanto hay de cada producto en el carrito, ya escrito ("2 u.", "0,500 kg"). */
  enCarrito?: ReadonlyMap<number, string>
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
  'sm:grid-cols-[minmax(0,1fr)_auto_8.5rem]',
  '2xl:grid-cols-[minmax(0,1fr)_8.5rem_auto_8.5rem]',
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
  onAjustar,
  onContinuar,
  enCarrito,
  esFavorito,
  onFavorito,
  onVolverAlLector,
  className,
}: ProductBrowserProps) {
  const lista = useRef<HTMLDivElement>(null)
  const contenedor = useRef<HTMLDivElement>(null)
  // El lugar del "/ kg" se reserva solo si hay algo que se pesa a la vista:
  // alinea los precios sin dejar un hueco en una lista de puras unidades.
  const hayPorPeso = productos.some((p) => esFraccionable(p.saleUnit))
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
    // Un → o un Enter sostenidos no suman ni avanzan treinta veces.
    if (esRepeticionIgnorada(e.key, e.repeat)) {
      e.preventDefault()
      return
    }
    const boton = e.target instanceof HTMLElement ? e.target.closest('[data-fila]') : null
    const indice = Number(boton?.getAttribute('data-indice') ?? '-1')
    const producto = productos[indice]

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onVolverAlLector()
        return
      // Enter AVANZA al carrito, igual que desde el buscador. Se resuelve aca
      // y no por la activacion nativa del boton, que agregaria una unidad.
      case 'Enter':
        e.preventDefault()
        onContinuar()
        return
      case 'ArrowRight':
      case 'ArrowLeft':
        e.preventDefault()
        if (producto) onAjustar(producto, e.key === 'ArrowRight' ? 1 : -1)
        return
    }
    if (!esTeclaDeGrilla(e.key)) return
    e.preventDefault()
    // Una sola columna: ↑ ↓ mueven de a una fila, Inicio y Fin a los extremos.
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
              className="overflow-hidden rounded-lg border border-line bg-surface"
            >
              {productos.map((p, i) => (
                <FilaDeProducto
                  key={p.id}
                  producto={p}
                  indice={i}
                  elegida={i === resaltado && listaActiva}
                  enfocable={i === enfocada}
                  favorito={esFavorito(p.id)}
                  enCarrito={enCarrito?.get(p.id) ?? null}
                  lugarParaUnidad={hayPorPeso}
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
  /** "Hay", delante de la cantidad, cuando no hay nada que avisar. */
  etiqueta?: string
  texto: string
  tono: string
  agotado: boolean
} {
  const agotado = aMilesimas(producto.sellableStock) <= 0
  const porVencimiento = agotado && aMilesimas(producto.expiredStock) > 0
  const cantidad = formatearCantidadConUnidad(producto.sellableStock, producto.saleUnit)

  // UX V5: el stock acompania, no compite con el nombre ni con el precio. En
  // gris y chico cuando esta bien; con color --y en palabras-- solo cuando
  // pide atencion.
  if (agotado) {
    return {
      texto: porVencimiento ? 'Vencido' : 'Sin stock',
      tono: 'font-medium text-danger',
      agotado: true,
    }
  }
  if (producto.estado === 'LOW') {
    return { texto: `Quedan ${cantidad}`, tono: 'font-medium text-warning', agotado: false }
  }
  const porPeso = esFraccionable(producto.saleUnit)
  // "Hay" delante: sin la palabra, "10 u." se confundia con lo que ya esta en
  // el carrito, que se escribe igual. "Hay 10 u." / "Quedan 3 u." / "Sin stock".
  return {
    etiqueta: 'Hay',
    texto: porPeso ? `${cantidad} · se pesa` : cantidad,
    tono: 'text-ink-faint',
    agotado: false,
  }
}

const FilaDeProducto = memo(function FilaDeProducto({
  producto,
  indice,
  elegida,
  enfocable,
  favorito,
  enCarrito,
  lugarParaUnidad,
  onElegir,
  onFavorito,
}: {
  producto: Product
  indice: number
  /** Elegida: → suma y ← resta sobre esta fila. */
  elegida: boolean
  enfocable: boolean
  favorito: boolean
  /** Cuanto hay ya en el carrito, o null si no esta. */
  enCarrito: string | null
  /** Reservar el lugar del "/ kg" aunque este no lo use, para alinear los precios. */
  lugarParaUnidad: boolean
  onElegir: (producto: Product) => void
  onFavorito: (productId: number) => void
}) {
  const estado = estadoDelProducto(producto)
  const denominador = denominadorDePrecio(producto.saleUnit)

  function alClic(e: MouseEvent<HTMLButtonElement>) {
    // Enter no llega aca: lo frena la lista, porque Enter avanza al carrito.
    // Un toque, un clic o la barra espaciadora agregan una unidad.
    e.preventDefault()
    onElegir(producto)
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
        aria-label={`${producto.name}, ${estado.agotado ? estado.texto.toLowerCase() : formatearPrecio(producto)}${enCarrito ? `, ${enCarrito} en el carrito` : ''}`}
        onClick={alClic}
        className={cn(
          // Telefono: dos renglones y 56 px --el nombre entero arriba, estado
          // y precio abajo--. Desde `sm`, un solo renglon de 40 px; 48 con el
          // dedo, donde 40 no se acierta.
          // La linea que separa las filas es una SOMBRA y no un borde: un
          // borde de 1 px por fila son 14 px cada quince filas, y a 40 px por
          // fila eso es exactamente una fila menos a la vista.
          'w-full border-l-4 py-1 pr-2 pl-2 text-left transition-colors',
          'shadow-[inset_0_-1px_0_var(--color-line)]',
          'min-h-14 sm:min-h-10 [@media(pointer:coarse)]:min-h-12',
          'xl:pr-11',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
          COLUMNAS,
          // Sin stock: fondo apagado y el estado dicho en palabras ("Sin
          // stock"), no una opacidad que deja todo ilegible.
          estado.agotado && 'cursor-not-allowed bg-sunken',
          // Elegida: barra gruesa, fondo, contorno de 2 px y la pista "→
          // agregar". Se distingue sin depender del color (V6): es la fila
          // sobre la que → suma.
          elegida
            ? 'border-l-primary bg-selection outline-2 -outline-offset-2 outline-primary'
            : 'border-l-transparent hover:bg-raised focus-visible:border-l-primary focus-visible:bg-selection',
        )}
      >
        {/* EL NOMBRE MANDA: se lleva todo el ancho sobrante y, si no entra,
            usa un segundo renglon en vez de cortarse. "Aceite de girasol
            900 ml" no puede terminar en "Aceite de girasol 9…". */}
        <span className={cn(CELDA_NOMBRE, 'flex items-baseline gap-1.5')}>
          {/* Cuanto hay ya en el carrito, delante del nombre: es lo que
              cambian → y ←, y se ve sin mirar el otro panel. En el mismo
              renglon, para que agregar no haga crecer la fila (V6). */}
          {enCarrito && (
            <span
              aria-hidden="true"
              data-en-carrito=""
              title="En el carrito"
              className="shrink-0 rounded bg-primary px-1.5 text-xs leading-5 font-semibold text-ink-on-solid"
            >
              {enCarrito}
            </span>
          )}
          <span
            data-nombre=""
            className={cn(
              'line-clamp-2 min-w-0 text-base leading-tight font-semibold',
              estado.agotado ? 'font-medium text-ink-muted' : 'text-ink',
            )}
          >
            {producto.name}
          </span>
          {/* La pista de la fila elegida: que hace → aca. Desde 768 px, igual
              que la guia de teclas; en un telefono no hay flechas. */}
          {elegida && !estado.agotado && (
            <span
              aria-hidden="true"
              data-pista-elegida=""
              className="ml-auto hidden shrink-0 items-center gap-1 self-center text-xs whitespace-nowrap text-primary md:inline-flex"
            >
              <Kbd className="text-primary">→</Kbd> agregar
            </span>
          )}
        </span>

        <span className={cn(CELDA_CATEGORIA, 'truncate text-sm text-ink-faint')}>
          {producto.category.name}
        </span>

        <span
          className={cn(CELDA_ESTADO, 'text-xs whitespace-nowrap', estado.tono)}
          data-numeric=""
          data-stock=""
        >
          {estado.etiqueta && <span className="mr-1">{estado.etiqueta}</span>}
          <span>{estado.texto}</span>
        </span>

        {/* El precio, alineado a la derecha y en cifras tabulares: los pesos
            quedan uno debajo del otro. El "/ kg" va en su propio lugar fijo,
            asi un producto por peso no corre su precio a la izquierda. */}
        <span className={cn(CELDA_PRECIO, 'flex items-baseline justify-end gap-1')} data-numeric="">
          <Money
            amount={producto.price}
            size="md"
            tone={estado.agotado ? 'muted' : 'neutral'}
            className="font-semibold"
          />
          {(denominador || lugarParaUnidad) && (
            <span className="text-xs text-ink-faint sm:w-8 sm:shrink-0">{denominador}</span>
          )}
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
          favorito ? 'text-ink opacity-100' : 'text-ink-faint hover:text-ink',
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
