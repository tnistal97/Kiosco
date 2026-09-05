'use client'

import type { ReactNode } from 'react'
import { Button, Drawer, Money, PageContainer, cn } from '@/components/ui'
import type { Monto } from '@/lib/money'

/**
 * El armazon del punto de venta. UX V2, Fase 2.
 *
 * Escritorio (desde `lg`): dos columnas. A la izquierda el lector, el
 * catalogo y los avisos; a la derecha el ticket, fijo, de 440 px. Nada de
 * esto se desplaza como pagina: el catalogo se desplaza por dentro, asi que el
 * lector y el total estan siempre en el mismo lugar.
 *
 * Telefono y tablet: una sola columna con el lector arriba y el catalogo en
 * el medio; abajo, fija, la barra con el ticket resumido y "Cobrar". Tocar el
 * ticket lo abre como hoja. El cobro es otra hoja, a pantalla completa. Es la
 * estructura que pidio la fase: buscar/escanear arriba, productos en el medio,
 * ticket y cobro al alcance del pulgar.
 */
export function POSLayout({
  cabecera,
  avisos,
  catalogo,
  ticket,
  articulos,
  total,
  puedeCobrar,
  ticketAbierto,
  onAbrirTicket,
  onCerrarTicket,
  onCobrar,
}: {
  /** El lector y sus botones. */
  cabecera: ReactNode
  /** Caja cerrada, ticket recuperado, codigo sin resolver. */
  avisos?: ReactNode
  catalogo: ReactNode
  /** El panel del ticket. Se dibuja fijo en escritorio y como hoja en el telefono. */
  ticket: ReactNode
  articulos: number
  total: Monto
  puedeCobrar: boolean
  ticketAbierto: boolean
  onAbrirTicket: () => void
  onCerrarTicket: () => void
  onCobrar: () => void
}) {
  return (
    <PageContainer width="operational">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
        {avisos}
        {cabecera}
        <div className="min-h-0 flex-1">{catalogo}</div>
      </div>

      {/* Escritorio: el ticket vive en el layout, siempre visible. */}
      <div className="hidden w-ticket shrink-0 border-l border-line lg:flex">{ticket}</div>

      <BarraDeTicket
        articulos={articulos}
        total={total}
        puedeCobrar={puedeCobrar}
        onAbrirTicket={onAbrirTicket}
        onCobrar={onCobrar}
      />

      <Drawer open={ticketAbierto} onClose={onCerrarTicket} title="Ticket" side="bottom">
        <div className="flex h-[70dvh] flex-col">{ticket}</div>
      </Drawer>
    </PageContainer>
  )
}

/**
 * La barra fija de abajo, en el telefono y la tablet: cuantos articulos,
 * cuanto es, y "Cobrar". Es lo que hace que terminar la venta nunca dependa
 * del scroll.
 */
export function BarraDeTicket({
  articulos,
  total,
  puedeCobrar,
  onAbrirTicket,
  onCobrar,
  className,
}: {
  articulos: number
  total: Monto
  puedeCobrar: boolean
  onAbrirTicket: () => void
  onCobrar: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-2 border-t border-line bg-surface px-3 py-2 safe-bottom lg:hidden',
        className,
      )}
    >
      <button
        type="button"
        onClick={onAbrirTicket}
        className="flex min-h-control-lg min-w-0 flex-1 flex-col items-start justify-center rounded-lg border border-line bg-raised px-3 text-left transition-colors hover:border-line-strong"
      >
        <span className="text-xs text-ink-muted">
          Ticket
          {articulos > 0 && ` · ${String(articulos)} ${articulos === 1 ? 'artículo' : 'artículos'}`}
        </span>
        <Money amount={total} size="lg" />
      </button>
      <Button
        variant="confirm"
        size="lg"
        className="flex-[1.1]"
        disabled={!puedeCobrar}
        onClick={onCobrar}
      >
        Cobrar
      </Button>
    </div>
  )
}
