'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/components/ui'
import { esActiva, navegacionPara, type GrupoNav } from './navigation'
import { IconoDe } from './icons'

/**
 * Barra lateral.
 *
 * Contenida en escritorio, con la seccion activa marcada por color y por una
 * barra a la izquierda --el color solo no alcanza--. Se puede contraer a
 * iconos para ganar ancho en la caja, que es donde el espacio hace falta.
 *
 * Solo dibuja lo que el usuario puede abrir.
 */
export function Sidebar({
  permisos,
  collapsed,
  onToggle,
  comercio,
}: {
  permisos: ReadonlySet<string>
  collapsed: boolean
  onToggle: () => void
  comercio: string
}) {
  const grupos = navegacionPara(permisos)

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150 lg:flex',
        collapsed ? 'w-sidebar-tight' : 'w-sidebar',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-line',
          collapsed ? 'justify-center px-2' : 'gap-2.5 px-4',
        )}
      >
        <Marca compacta={collapsed} nombre={comercio} />
      </div>

      <nav aria-label="Principal" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <ListaGrupos grupos={grupos} collapsed={collapsed} />
      </nav>

      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className={cn(
            'flex h-touch w-full items-center gap-2.5 rounded-md px-3 text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
        >
          <svg
            className={cn('h-4 w-4 shrink-0 transition-transform', collapsed && 'rotate-180')}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m14 6-6 6 6 6" />
          </svg>
          {!collapsed && <span>Contraer</span>}
          <span className="sr-only">{collapsed ? 'Expandir el menú' : 'Contraer el menú'}</span>
        </button>
      </div>
    </aside>
  )
}

export function ListaGrupos({
  grupos,
  collapsed = false,
  onNavigate,
}: {
  grupos: GrupoNav[]
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col gap-4">
      {grupos.map((grupo, i) => (
        <div key={grupo.title ?? `grupo-${i}`} className="flex flex-col gap-0.5">
          {grupo.title && !collapsed && (
            <p className="mb-1 px-3 text-xs font-semibold tracking-wide text-ink-faint uppercase">
              {grupo.title}
            </p>
          )}
          {grupo.title && collapsed && <div className="mx-2 mb-1 h-px bg-line" />}

          {grupo.items.map((item) => {
            const activa = esActiva(item, pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={activa ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'relative flex min-h-touch items-center gap-3 rounded-md px-3 text-sm transition-colors',
                  collapsed && 'justify-center px-0',
                  activa
                    ? 'bg-primary-quiet font-semibold text-ink'
                    : 'text-ink-muted hover:bg-raised hover:text-ink',
                )}
              >
                {/* La marca de activo no depende solo del color. */}
                {activa && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                  />
                )}
                <IconoDe href={item.href} />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {collapsed && <span className="sr-only">{item.label}</span>}
              </Link>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function Marca({ compacta = false, nombre }: { compacta?: boolean; nombre: string }) {
  return (
    <Link
      href="/"
      // Es un enlace de verdad --lleva al inicio-- y en un telefono se toca
      // con el dedo. El cuadrado de color mide 32 px por estetica; el area
      // sensible mide 44 de alto Y de ancho. Sin `min-w-touch` en la version
      // compacta el area quedaba en 32 de ancho, que es lo que medía la
      // prueba de objetivos tactiles.
      className={cn(
        'flex min-h-touch items-center justify-center gap-2.5',
        compacta ? 'min-w-touch' : 'min-w-0 justify-start',
      )}
      aria-label={`${nombre} — inicio`}
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-ink-on-solid"
      >
        {nombre.trim().charAt(0).toUpperCase() || 'A'}
      </span>
      {!compacta && <span className="truncate font-semibold text-ink">{nombre}</span>}
    </Link>
  )
}
