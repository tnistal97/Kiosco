'use client'

import Link from 'next/link'
import { PageContainer, Section } from '@/components/ui'
import { rolLegible } from '@/components/shell/UserMenu'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { useSession } from '@/components/shell/SessionProvider'
import { CambiarMiClave } from '@/components/usuarios/CambiarMiClave'
import type { Permission } from '@/server/authz/permissions'

/**
 * Configuracion. UX V5.
 *
 * Lo que una persona puede querer cambiar o consultar de vez en cuando: su
 * cuenta y contraseña, el aspecto, y --para quien administra-- los accesos a
 * Usuarios, Sucursales, Ventas y el historial de cambios, que salieron del
 * menu principal para no competir con las tareas de todos los dias.
 *
 * Se fue la lista de permisos con sus codigos internos (`sales.create`...):
 * era informacion tecnica que no le decia nada a quien atiende.
 */

const ADMINISTRACION: Array<{
  href: string
  titulo: string
  descripcion: string
  permiso: Permission
}> = [
  {
    href: '/ventas',
    titulo: 'Ventas',
    descripcion: 'Todas las ventas, con su detalle. Desde acá se anula una venta.',
    permiso: 'sales.view',
  },
  {
    href: '/usuarios',
    titulo: 'Usuarios',
    descripcion: 'Quién puede entrar al sistema y qué puede hacer.',
    permiso: 'users.view',
  },
  {
    href: '/sucursales',
    titulo: 'Sucursales',
    descripcion: 'Los locales del comercio.',
    permiso: 'branches.view',
  },
  {
    href: '/auditoria',
    titulo: 'Historial de cambios',
    descripcion: 'Quién hizo qué y cuándo.',
    permiso: 'audit.view',
  },
]

const NOMBRE_DE_FUNCION: Record<string, string> = {
  lotes: 'Lotes y vencimientos',
  compras: 'Compras, proveedores y devoluciones',
}

export default function ConfiguracionPage() {
  const { session, puede, comercio, funciones } = useSession()
  const accesos = ADMINISTRACION.filter((a) => puede(a.permiso))

  return (
    <PageContainer width="narrow" className="gap-10">
      <Section title="Tu cuenta">
        <dl className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-surface p-5 text-base sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-muted">Nombre</dt>
            <dd className="font-semibold text-ink">{session?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Usuario</dt>
            <dd className="font-semibold text-ink">{session?.username ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Rol</dt>
            <dd className="font-semibold text-ink">{session ? rolLegible(session.role) : '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Sucursal</dt>
            <dd className="font-semibold text-ink">{session?.branchName ?? '—'}</dd>
          </div>
        </dl>
      </Section>

      {session && <CambiarMiClave />}

      <Section title="Apariencia" description="Se guarda solo en esta computadora.">
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base text-ink">
            El tema claro es el de siempre. El oscuro sirve si atendés con poca luz.
          </p>
          <ThemeToggle />
        </div>
      </Section>

      {accesos.length > 0 && (
        <Section title="Administración">
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
            {accesos.map((a) => (
              <li key={a.href}>
                <Link
                  href={a.href}
                  className="flex min-h-16 items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-raised"
                >
                  <span>
                    <span className="block text-base font-semibold text-ink">{a.titulo}</span>
                    <span className="block text-sm text-ink-muted">{a.descripcion}</span>
                  </span>
                  <span aria-hidden="true" className="text-xl text-ink-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Comercio">
        <dl className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-surface p-5 text-base sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-muted">Nombre</dt>
            <dd className="font-semibold text-ink">{comercio}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Zona horaria</dt>
            <dd className="font-semibold text-ink">{session?.timeZone ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-ink-muted">Funciones adicionales</dt>
            <dd className="text-ink">
              {funciones.size === 0
                ? 'Ninguna: el sistema está en modo almacén.'
                : [...funciones].map((f) => NOMBRE_DE_FUNCION[f] ?? f).join(', ')}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-ink-muted">
          El nombre del comercio y las funciones adicionales los configura quien instaló el sistema.
        </p>
      </Section>
    </PageContainer>
  )
}
