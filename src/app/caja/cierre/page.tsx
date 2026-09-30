'use client'

import { PageContainer } from '@/components/ui'
import { CierreDelDia } from '@/components/caja/CierreDelDia'

/** `/caja/cierre`: cuanto vendi, como me pagaron, cuanto tiene que haber. */
export default function CierreDelDiaPage() {
  return (
    <PageContainer>
      <CierreDelDia />
    </PageContainer>
  )
}
