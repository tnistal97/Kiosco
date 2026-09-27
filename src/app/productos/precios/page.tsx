'use client'

import Link from 'next/link'
import { Alert, PageContainer } from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { CambioMasivoDePrecios } from '@/components/productos/CambioMasivoDePrecios'

/**
 * Productos → Cambiar precios. Fase P0-B.
 *
 * La pantalla solo pone el marco; el cambio masivo vive en
 * `@/components/productos/CambioMasivoDePrecios`. El permiso se mira aca para
 * no ofrecer un camino que el servidor va a rechazar.
 */
export default function CambiarPreciosPage() {
  const puede = usePermiso('products.price.update')

  return (
    <PageContainer className="gap-5">
      <header>
        <Link href="/productos" className="text-sm text-ink-muted hover:text-ink">
          ← Productos
        </Link>
        {/* `h2`: el `h1` de la pagina lo pone la cabecera, que dice "Productos". */}
        <h2 className="mt-1 text-xl font-semibold text-ink">Cambiar precios</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Actualizá muchos precios de una vez. Nada cambia hasta que confirmes.
        </p>
      </header>

      {puede ? (
        <CambioMasivoDePrecios />
      ) : (
        <Alert tone="warning" title="Tu usuario no puede cambiar precios">
          Pedile a quien administra el comercio que lo haga, o que te dé permiso.
        </Alert>
      )}
    </PageContainer>
  )
}
