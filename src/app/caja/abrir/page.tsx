'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageContainer, Skeleton } from '@/components/ui'
import { AperturaDeCaja } from '@/components/caja/AperturaDeCaja'

/**
 * `/caja/abrir`. Desde la venta se llega con `?volver=/venta` y se vuelve
 * ahi en cuanto la caja queda abierta. Solo se aceptan rutas propias: un
 * `volver` con dominio se ignora.
 */
function Contenido() {
  const params = useSearchParams()
  const pedido = params.get('volver') ?? '/caja'
  const volver = /^\/(?!\/)/.test(pedido) ? pedido : '/caja'
  return <AperturaDeCaja volver={volver} />
}

export default function AbrirCajaPage() {
  return (
    <PageContainer width="narrow">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Contenido />
      </Suspense>
    </PageContainer>
  )
}
