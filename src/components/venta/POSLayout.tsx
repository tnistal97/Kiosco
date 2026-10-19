'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Drawer, Money, PageContainer, cn } from '@/components/ui'
import type { Monto } from '@/lib/money'

/**
 * El armazon del punto de venta. UX V3.
 *
 * Escritorio (DESDE 1280, no desde 1024): dos columnas. A la izquierda el
 * lector, las secciones y el catalogo; a la derecha el ticket, siempre
 * visible, de `clamp(360px, 29vw, 440px)`. Nada de esto se desplaza como
 * pagina: el catalogo se desplaza por dentro, asi que el lector y el total
 * estan siempre en el mismo lugar.
 *
 * Telefono y tablet --y ahora tambien 1024-1279--: una sola columna con el
 * lector arriba y el catalogo en el medio; abajo, fija, la barra con el
 * ticket resumido y "Cobrar". Tocarla abre el ticket como hoja, que ES el
 * paso de revisar. El cobro es otra hoja, a pantalla completa.
 *
 * POR QUE 1280 Y NO 1024 (V3). Con dos paneles en 1024 el ticket se llevaba
 * 440 px de 1024, y al nombre del producto le quedaban 199: "Aceite de
 * girasol 9…". Con el ticket como hoja, esa misma pantalla le da 597 px al
 * nombre y muestra 13 filas. Cobrar sigue siempre a la vista.
 *
 * El alto se mide en FILAS DE PRODUCTO: cada 40 px de relleno es una fila
 * menos, y por eso el margen es de 8 px y los huecos de 4.
 */
export function POSLayout({
  cabecera,
  secciones,
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
  /** Las secciones del catalogo y el ultimo resultado del lector. */
  secciones?: ReactNode
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
      {/* El alto de esta columna se mide en FILAS DE PRODUCTO. Cada 40 px que
          se lleve el relleno es una fila menos a la vista, asi que el margen
          es de 8 px y los huecos de 6: lo justo para que no se toquen. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden p-2">
        {avisos}
        {cabecera}
        {secciones}
        <div className="flex min-h-0 flex-1 flex-col">{catalogo}</div>
      </div>

      {/* Dos paneles DESDE 1280, no desde 1024 (V3).
          El ticket es elastico --clamp(360, 29vw, 440)-- pero aun asi, en
          1024 los dos paneles dejaban al nombre del producto 199 px: "Aceite
          de girasol 9…". Con el ticket como hoja, esa misma pantalla le da
          600. Cobrar sigue siempre a la vista, en la barra de abajo.
          En columna: el ticket ocupa todo el ancho del panel tenga lo que
          tenga (en fila se achicaba a su contenido y dejaba una franja). */}
      <div className="hidden w-ticket shrink-0 flex-col border-l border-line xl:flex">{ticket}</div>

      <BarraDeTicket
        articulos={articulos}
        total={total}
        puedeCobrar={puedeCobrar}
        onAbrirTicket={onAbrirTicket}
        onCobrar={onCobrar}
      />

      {/* La hoja ES la revision: por eso se llama asi y no "Ticket", que ya
          dice el panel de adentro. */}
      <Drawer
        open={ticketAbierto}
        onClose={onCerrarTicket}
        title="Revisá el carrito"
        side="bottom"
        rapido
      >
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
  /**
   * Un destello al agregar.
   *
   * Con el dedo no hay foco ni cursor: sin esto, tocar una fila no confirma
   * nada --el ticket esta cerrado-- y se toca dos veces. Son 400 ms de borde
   * encendido, no una animacion.
   */
  const [destello, setDestello] = useState(false)
  const anterior = useRef(articulos)
  useEffect(() => {
    if (articulos === anterior.current) return
    const subio = articulos > anterior.current
    anterior.current = articulos
    if (!subio) return
    setDestello(true)
    const t = setTimeout(() => {
      setDestello(false)
    }, 400)
    return () => {
      clearTimeout(t)
    }
  }, [articulos])

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-2 border-t border-line bg-surface px-3 py-2 safe-bottom xl:hidden',
        className,
      )}
    >
      <button
        type="button"
        onClick={onAbrirTicket}
        className={cn(
          'flex min-h-control-lg min-w-0 flex-1 flex-col items-start justify-center rounded-lg border bg-raised px-3 text-left transition-colors',
          destello ? 'border-primary bg-primary-quiet' : 'border-line hover:border-line-strong',
        )}
      >
        <span className="text-xs text-ink-muted">
          Carrito
          {articulos > 0 && ` · ${String(articulos)} ${articulos === 1 ? 'artículo' : 'artículos'}`}
        </span>
        {/* En el telefono un punto mas chico: con el tamano grande, "$ 11.390,00"
            no entraba al lado de Cobrar y se cortaba. */}
        <Money amount={total} size="lg" className="sm:text-3xl" />
      </button>
      {/* Sin ticket es gris, no verde apagado: un boton principal
          semitransparente se sigue leyendo como apretable. */}
      <Button
        variant="primary"
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
