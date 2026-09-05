'use client'

import { useEffect, useState } from 'react'
import { Alert, ButtonLink } from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest } from '@/lib/api-client'
import { parseEstadoDeCaja } from '@/modules/cash/dto'

/**
 * Aviso de que la caja esta cerrada, arriba de la pantalla de venta.
 *
 * Sin turno abierto el servidor rechaza la venta, y el cajero se enteraria
 * recien al apretar "Cobrar" --con el cliente enfrente y el ticket armado--.
 * Esto lo dice al entrar y, desde la Fase 2, lleva DIRECTO a la apertura y
 * vuelve aca: antes mandaba a la pantalla de caja y de ahi habia que
 * encontrar el boton (auditoria, §6 08:00, "navegacion de ida y vuelta").
 *
 * Quien no puede abrirla ve a quien pedirselo, en vez de un boton que va a
 * fallar.
 *
 * Se consulta una sola vez al montar y cuando la caja cambia. No hay sondeo:
 * el estado de la caja cambia cuando alguien hace algo, no solo.
 */
export function AvisoCajaCerrada() {
  const [cerrada, setCerrada] = useState(false)
  const puedeAbrir = usePermiso('cash.shift.open')

  useEffect(() => {
    let vivo = true
    const control = new AbortController()

    async function consultar() {
      try {
        const r = await apiRequest('/api/cash/shift', {
          parse: parseEstadoDeCaja,
          signal: control.signal,
        })
        // Solo molesta cuando de verdad bloquea: si la sucursal no exige
        // turno, la venta pasa igual y el aviso seria ruido.
        if (vivo) setCerrada(r.turno === null && r.politica.requiereTurno)
      } catch {
        // Sin permiso de caja --un cajero de una sucursal sin turnos-- o sin
        // red. En cualquiera de los dos casos, callarse: el error real, si lo
        // hay, aparece al cobrar y con su mensaje.
        if (vivo) setCerrada(false)
      }
    }

    void consultar()
    function alCambiarLaCaja() {
      void consultar()
    }
    window.addEventListener('kiosco:caja-cambio', alCambiarLaCaja)

    return () => {
      vivo = false
      control.abort()
      window.removeEventListener('kiosco:caja-cambio', alCambiarLaCaja)
    }
  }, [])

  if (!cerrada) return null

  return (
    <Alert
      tone="warning"
      title="La caja está cerrada"
      action={
        puedeAbrir ? (
          <ButtonLink href="/caja/abrir?volver=/venta" size="sm" variant="primary">
            Abrir caja
          </ButtonLink>
        ) : undefined
      }
    >
      {puedeAbrir
        ? 'Se puede armar el ticket, pero no cobrar. Contá el efectivo del cajón y abrila: es un minuto.'
        : 'Se puede armar el ticket, pero no cobrar. Pedile a un encargado que abra la caja.'}
    </Alert>
  )
}
