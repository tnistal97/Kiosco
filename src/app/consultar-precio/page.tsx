'use client'

import { PageContainer } from '@/components/ui'
import { ConsultarPrecio } from '@/components/precio/ConsultarPrecio'

/** `/consultar-precio`: escanea y mira el precio. No agrega nada al ticket. */
export default function ConsultarPrecioPage() {
  return (
    <PageContainer width="narrow">
      <ConsultarPrecio />
    </PageContainer>
  )
}
