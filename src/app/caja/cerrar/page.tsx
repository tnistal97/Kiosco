'use client'

import { PageContainer } from '@/components/ui'
import { CierreDeCaja } from '@/components/caja/CierreDeCaja'

/** `/caja/cerrar`: contar la plata y confirmar si cierra. */
export default function CerrarCajaPage() {
  return (
    <PageContainer width="narrow">
      <CierreDeCaja />
    </PageContainer>
  )
}
