'use client'

import { Alert, Badge, Card, CardHeader } from '@/components/ui'
import { rolLegible } from '@/components/shell/UserMenu'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { useSession } from '@/components/shell/SessionProvider'

const COMERCIO = process.env.NEXT_PUBLIC_COMMERCE_NAME ?? 'Almacén'

/**
 * Configuración.
 *
 * Lo que hay hoy y nada mas: preferencia de tema y los datos de la sesion.
 * No se dibujan interruptores para cosas que el sistema todavia no sabe
 * hacer; un boton que no hace nada es peor que la ausencia del boton, porque
 * hace creer que la funcion existe.
 */
export default function ConfiguracionPage() {
  const { session, permisos } = useSession()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3 sm:p-5">
      <Card>
        <CardHeader title="Apariencia" description="Se guarda solo en este navegador." />
        <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-sunken px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink">Tema</p>
            <p className="text-xs text-ink-muted">
              El oscuro es el predeterminado. No sigue al sistema operativo: se elige y queda
              elegido.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </Card>

      <Card>
        <CardHeader title="Tu sesión" />
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-faint">Nombre</dt>
            <dd className="text-ink">{session?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Usuario</dt>
            <dd className="text-ink">@{session?.username ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Rol</dt>
            <dd className="text-ink">{session ? rolLegible(session.role) : '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Sucursal</dt>
            <dd className="text-ink">{session?.branchName ?? '—'}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
            Permisos ({permisos.size})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...permisos].sort().map((p) => (
              <Badge key={p} tone="neutral">
                {p}
              </Badge>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Comercio" />
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-faint">Nombre</dt>
            <dd className="text-ink">{COMERCIO}</dd>
          </div>
        </dl>
        <Alert tone="info" className="mt-4">
          El nombre sale de <code>NEXT_PUBLIC_COMMERCE_NAME</code>. Se cambia en el archivo de
          entorno del servidor y hace falta reiniciar la aplicación.
        </Alert>
      </Card>

      <Card>
        <CardHeader title="Lo que todavía no está" />
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-muted">
          <li>Turnos de caja con apertura y cierre. El saldo de hoy es acumulado.</li>
          <li>Cambio de contraseña desde la aplicación.</li>
          <li>Edición de permisos por rol: hoy viven en el código.</li>
          <li>Compras, proveedores y clientes.</li>
          <li>Venta sin conexión.</li>
        </ul>
      </Card>
    </div>
  )
}
