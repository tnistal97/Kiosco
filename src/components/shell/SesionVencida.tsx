'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ButtonLink, Dialog } from '@/components/ui'
import { EVENTO_SESION_VENCIDA } from '@/lib/api-client'

/**
 * Sesion vencida. UX V2, Fase 2.1.
 *
 * EL PROBLEMA
 * -----------
 * La sesion dura doce horas y no se renueva. Cuando vence hay dos caminos y
 * ninguno de los dos estaba resuelto:
 *
 *  1. La persona NAVEGA a otra pantalla. El middleware la manda a /login con
 *     `?next=`, que ya funcionaba bien.
 *  2. La persona SIGUE en la pantalla que ya tenia abierta y toca algo que
 *     consulta al servidor. Ahi la API contesta 401 y hasta ahora cada
 *     pantalla lo mostraba como un error suyo: "Error al cargar productos",
 *     "No se pudo cobrar". Nadie decia que la sesion se habia terminado, y la
 *     aplicacion quedaba a medio andar --el ejemplo real que motivo la fase--.
 *
 *  3. Y un tercero, mas raro: el token todavia es valido pero la base dice
 *     otra cosa (usuario dado de baja, sesion revocada, sucursal cambiada).
 *     El middleware solo mira la firma, asi que deja pasar; el layout pide la
 *     sesion de verdad y recibe null. Antes eso dibujaba la pantalla SIN
 *     armazon: sin barra lateral, sin cabecera, sin explicacion. Es la
 *     "barra lateral que desaparece" del reporte.
 *
 * Los tres terminan en el mismo mensaje y en el mismo boton, y los tres
 * conservan a donde queria ir la persona.
 */

const TITULO = 'Tu sesión venció'
const EXPLICACION =
  'Por seguridad, la sesión se cierra sola después de un tiempo. Volvé a ingresar y seguís donde estabas.'

/** A donde volver despues de iniciar sesion, sin salir del sitio. */
function destino(pathname: string): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.startsWith('/login')) {
    return '/login'
  }
  return `/login?next=${encodeURIComponent(pathname)}`
}

/**
 * Pantalla completa: se usa cuando el servidor dibujo la pagina sin sesion.
 * Reemplaza al contenido, porque no hay contenido que mostrar.
 */
export function SesionVencida({ pathname }: { pathname: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
      <h1 className="text-xl font-semibold text-ink">{TITULO}</h1>
      <p className="max-w-prose text-sm text-ink-muted">{EXPLICACION}</p>
      <ButtonLink href={destino(pathname)} size="lg">
        Volver a ingresar
      </ButtonLink>
    </div>
  )
}

/**
 * El aviso para la pantalla que ya estaba abierta: aparece cuando CUALQUIER
 * consulta contesta 401. Vive en el armazon, asi que ninguna pantalla tiene
 * que acordarse de manejarlo.
 */
export function AvisoDeSesionVencida() {
  const pathname = usePathname()
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    function alVencer() {
      setAbierto(true)
    }
    window.addEventListener(EVENTO_SESION_VENCIDA, alVencer)
    return () => {
      window.removeEventListener(EVENTO_SESION_VENCIDA, alVencer)
    }
  }, [])

  // En el propio login no hay nada que avisar.
  if (pathname.startsWith('/login')) return null

  return (
    <Dialog
      open={abierto}
      onClose={() => {
        setAbierto(false)
      }}
      title={TITULO}
      size="sm"
      footer={
        <ButtonLink href={destino(pathname)} className="w-full sm:w-auto">
          Volver a ingresar
        </ButtonLink>
      }
    >
      <p className="text-sm text-ink-muted">{EXPLICACION}</p>
    </Dialog>
  )
}
