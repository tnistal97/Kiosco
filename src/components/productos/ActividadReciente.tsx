'use client'

import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api-client'
import { parseActividad, type EventoDeProductoDTO } from '@/modules/products/dto'

/**
 * Ultimos movimientos de este producto.
 *
 * NO duplica la auditoria: la bitacora completa sigue estando en `/auditoria`
 * con sus filtros, sus rangos de fecha y su paginacion. Esto responde una
 * pregunta mas chica y mucho mas frecuente, que hasta ahora obligaba a irse a
 * otra pantalla y filtrar a mano: "¿que le paso a este producto ultimamente?".
 *
 * Tres fuentes --precio, costo y stock-- en una sola lista corta. Los cambios
 * de costo solo aparecen para quien puede verlos; el servidor no los manda al
 * resto.
 *
 * Si la consulta falla no se muestra nada. Es informacion de contexto: hacer
 * ruido por no poder cargarla distraeria de lo que la persona vino a hacer.
 */
const ICONO: Record<EventoDeProductoDTO['tipo'], string> = {
  precio: '$',
  costo: '⌁',
  stock: '⇅',
}

export function ActividadReciente({ productId, abierto }: { productId: number; abierto: boolean }) {
  const [eventos, setEventos] = useState<EventoDeProductoDTO[] | null>(null)

  useEffect(() => {
    if (!abierto) return
    let vivo = true
    void apiRequest(`/api/products/${productId}/activity`, { parse: parseActividad })
      .then((filas) => {
        if (vivo) setEventos(filas)
      })
      .catch(() => {
        if (vivo) setEventos([])
      })
    return () => {
      vivo = false
    }
  }, [productId, abierto])

  if (eventos === null || eventos.length === 0) return null

  return (
    <section>
      <h3 className="mb-3 border-b border-line pb-1.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">
        Actividad reciente
      </h3>
      <ul className="flex flex-col gap-2">
        {eventos.slice(0, 8).map((e, i) => (
          <li
            key={`${e.fecha}-${e.tipo}-${String(i)}`}
            className="flex items-start gap-2.5 text-sm"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-xs text-ink-muted"
            >
              {ICONO[e.tipo]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ink">{e.texto}</p>
              <p className="text-xs text-ink-faint">
                {formatearFecha(e.fecha)} · {e.usuario}
                {e.motivo !== null && ` · ${e.motivo}`}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function formatearFecha(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return fecha.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
