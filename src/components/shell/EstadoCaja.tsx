'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Money, Skeleton } from '@/components/ui'
import { apiRequest } from '@/lib/api-client'
import { parseSaldo } from '@/modules/cash/dto'
import { usePermiso } from './SessionProvider'

/**
 * Saldo de caja en la cabecera.
 *
 * Solo para quien tiene `cash.view`. Es el dato que el encargado mira mas
 * veces por dia y estaba a dos pantallas de distancia.
 *
 * Se refresca al volver a la pestania y al terminar una venta (por el evento
 * `kiosco:caja-cambio`), no cada pocos segundos: un sondeo permanente gasta
 * bateria en la tablet del mostrador para un numero que cambia cuando el
 * usuario hace algo.
 */
export function EstadoCaja() {
  const puedeVer = usePermiso('cash.view')
  const [saldo, setSaldo] = useState<number | null>(null)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    if (!puedeVer) return

    let vivo = true
    const control = new AbortController()

    async function consultar() {
      try {
        const r = await apiRequest('/api/cash/balance', {
          parse: parseSaldo,
          signal: control.signal,
        })
        if (vivo) {
          setSaldo(r.balance)
          setFallo(false)
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (vivo) setFallo(true)
      }
    }

    void consultar()

    function alVolver() {
      if (document.visibilityState === 'visible') void consultar()
    }
    function alCambiarLaCaja() {
      void consultar()
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('kiosco:caja-cambio', alCambiarLaCaja)

    return () => {
      vivo = false
      control.abort()
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('kiosco:caja-cambio', alCambiarLaCaja)
    }
  }, [puedeVer])

  if (!puedeVer) return null
  if (fallo) return null
  if (saldo === null) return <Skeleton className="hidden h-7 w-28 sm:block" />

  return (
    <Link
      href="/caja"
      // `min-h-touch`: es un enlace, no una etiqueta. Medía 30 px de alto y
      // quedaba por debajo del minimo tactil en la cabecera de todas las
      // pantallas.
      className="hidden min-h-touch items-center gap-2 rounded-md border border-line px-2.5 transition-colors hover:border-line-strong hover:bg-raised sm:flex"
      title="Saldo acumulado en efectivo de la sucursal"
    >
      <span className="text-xs text-ink-muted">Caja</span>
      <Money amount={saldo} size="sm" />
    </Link>
  )
}

/** Avisa a la cabecera de que el saldo cambio. */
export function notificarCambioDeCaja(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('kiosco:caja-cambio'))
}
