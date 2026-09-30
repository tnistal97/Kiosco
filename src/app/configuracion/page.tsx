'use client'

import { PageContainer, Alert, Badge, Card, CardHeader } from '@/components/ui'
import { rolLegible } from '@/components/shell/UserMenu'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { useSession } from '@/components/shell/SessionProvider'
import { CambiarMiClave } from '@/components/usuarios/CambiarMiClave'
import { PreferenciasDeImpresion } from '@/components/impresion/PreferenciasDeImpresion'

/**
 * Configuración.
 *
 * Lo que hay hoy y nada mas: preferencia de tema y los datos de la sesion.
 * No se dibujan interruptores para cosas que el sistema todavia no sabe
 * hacer; un boton que no hace nada es peor que la ausencia del boton, porque
 * hace creer que la funcion existe.
 */
export default function ConfiguracionPage() {
  const { session, permisos, comercio } = useSession()

  return (
    <PageContainer width="narrow">
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

      {session && <CambiarMiClave />}

      <Card>
        <CardHeader title="Comercio" />
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-faint">Nombre</dt>
            <dd className="text-ink">{comercio}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Zona horaria</dt>
            <dd className="text-ink">{session?.timeZone ?? '—'}</dd>
          </div>
        </dl>
        <Alert tone="info" className="mt-4">
          El nombre sale de <code>COMMERCE_NAME</code>, en el archivo de entorno del servidor: se
          cambia ahí y alcanza con reiniciar la aplicación, sin recompilar. La sucursal y su zona
          horaria salen de la base de datos.
        </Alert>
      </Card>

      <Card>
        <CardHeader
          title="Impresión"
          description="Para la impresora térmica conectada a esta máquina. Se guarda solo en este navegador."
        />
        <PreferenciasDeImpresion />
      </Card>

      <Card>
        <CardHeader title="Lo que todavía no está" />
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-muted">
          <li>Edición de permisos por rol: hoy viven en el código.</li>
          <li>Venta sin conexión.</li>
          <li>Factura electrónica: el ticket que se imprime es un comprobante interno.</li>
        </ul>
      </Card>
    </PageContainer>
  )
}
