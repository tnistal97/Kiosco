'use client'

import Link from 'next/link'
import { Alert, PageContainer } from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { ImportarProductos } from '@/components/productos/ImportarProductos'

/**
 * Productos → Importar. Fase P0-B.
 *
 * La pantalla solo pone el marco; el asistente vive en
 * `@/components/productos/ImportarProductos`. El permiso se mira aca para no
 * ofrecer un camino que el servidor va a rechazar --la defensa de verdad esta
 * en la ruta--.
 */
export default function ImportarProductosPage() {
  const puedeCrear = usePermiso('products.create')
  const puedeEditar = usePermiso('products.update')

  return (
    <PageContainer className="gap-5">
      <header>
        <Link href="/productos" className="text-sm text-ink-muted hover:text-ink">
          ← Productos
        </Link>
        {/* `h2`: el `h1` de la pagina lo pone la cabecera, que dice "Productos". */}
        <h2 className="mt-1 text-xl font-semibold text-ink">Importar productos</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Cargá o actualizá el catálogo desde una planilla de Excel o un CSV.
        </p>
      </header>

      {puedeCrear || puedeEditar ? (
        <ImportarProductos />
      ) : (
        <Alert tone="warning" title="Tu usuario no puede importar productos">
          Pedile a quien administra el comercio que lo haga, o que te dé permiso.
        </Alert>
      )}
    </PageContainer>
  )
}
