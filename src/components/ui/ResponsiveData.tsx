'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { cn } from './cn'

/**
 * Una tabla en escritorio, una lista de tarjetas en el telefono. UNA de las
 * dos, nunca las dos.
 *
 * La auditoria encontro tres pantallas que dibujaban la tabla Y las tarjetas
 * con los mismos datos (H-10): en escritorio parecia que habia el doble de
 * registros. Y las que lo hacian bien lo hacian con `hidden lg:block`, que
 * esconde pero deja en el DOM dos representaciones completas de cada fila.
 *
 * Aca se decide con `matchMedia`. El primer dibujo --el del servidor, que no
 * sabe el ancho-- deja las dos con las clases de siempre para que no haya un
 * salto; en cuanto se sabe el ancho, queda una sola.
 */

/** El punto de corte de la barra lateral: por debajo, la pantalla es un telefono o una tablet. */
export const CONSULTA_ESCRITORIO = '(min-width: 64rem)'

/** `null` hasta saber el ancho. */
export function useEsEscritorio(consulta: string = CONSULTA_ESCRITORIO): boolean | null {
  const [es, setEs] = useState<boolean | null>(null)

  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const leer = () => {
      setEs(mq.matches)
    }
    leer()
    mq.addEventListener('change', leer)
    return () => {
      mq.removeEventListener('change', leer)
    }
  }, [consulta])

  return es
}

export function ResponsiveData({
  table,
  cards,
  className,
}: {
  /** La tabla, ya envuelta en `TableWrap`. */
  table: ReactNode
  /** La lista de tarjetas, normalmente un `CardList`. */
  cards: ReactNode
  className?: string
}) {
  const escritorio = useEsEscritorio()

  if (escritorio === null) {
    return (
      <>
        <div className={cn('hidden lg:block', className)}>{table}</div>
        <div className={cn('lg:hidden', className)}>{cards}</div>
      </>
    )
  }

  return <div className={className}>{escritorio ? table : cards}</div>
}
