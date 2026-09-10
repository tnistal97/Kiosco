'use client'

import { type KeyboardEvent } from 'react'
import { cn } from '@/components/ui'
import type { Category } from '@/hooks/useProducts'

/**
 * Las secciones del catalogo como chips: "Frecuentes", "Todos" y una por
 * categoria.
 *
 * UN SOLO RENGLON (V3). Con nueve categorias se envolvian en dos, y esos
 * 40 px eran una fila de producto menos a la vista. Ahora se desplazan de
 * costado en todas las pantallas, telefono incluido.
 *
 * Vive fuera de la lista --y no adentro, como en la 2.1-- por dos motivos:
 * comparte renglon con el ultimo resultado del lector, y sobre todo NO
 * DESAPARECE al buscar. Antes se ocultaba, la lista subia 40 px y toda la
 * pantalla se movia con cada busqueda.
 *
 * Roving tabindex: un solo chip entra con Tab y las flechas cambian de
 * seccion. Ocho categorias serian ocho paradas de Tab entre el lector y la
 * lista, y eso es lo que hace que nadie use el teclado.
 */

/** Que se muestra cuando no se esta buscando. */
export type SeccionDelCatalogo = 'frecuentes' | 'todos' | number

export function Secciones({
  seccion,
  onSeccion,
  categorias,
  hayFrecuentes,
  deshabilitado = false,
  className,
}: {
  seccion: SeccionDelCatalogo
  onSeccion: (seccion: SeccionDelCatalogo) => void
  categorias: Category[]
  /** Si hay algo que mostrar en "Frecuentes" (favoritos o mas vendidos). */
  hayFrecuentes: boolean
  /** Mientras se busca, la seccion no filtra: los chips quedan apagados. */
  deshabilitado?: boolean
  className?: string
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
      className={cn(
        '-mx-1 flex shrink-0 flex-nowrap gap-1 overflow-x-auto px-1 [scrollbar-width:none]',
        '[&::-webkit-scrollbar]:hidden',
        // El ultimo chip se desvanece en el borde: es la seniial de que hay
        // mas de costado, sin ocupar lugar con una flecha.
        '[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]',
        deshabilitado && 'pointer-events-none opacity-45',
        className,
      )}
    >
      {opciones.map((o) => {
        const esActiva = !deshabilitado && o.clave === activa
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
              'min-h-touch shrink-0 rounded-md border px-3 text-sm whitespace-nowrap transition-colors lg:min-h-7',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
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
