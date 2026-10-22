'use client'

import Image from 'next/image'
import { useState } from 'react'
import { cn } from '@/components/ui'

/**
 * Tamanos, en px: `sm` la fila de la caja (40 px de alto), `md` el listado
 * de Productos, `lg` la ficha.
 */
const TAMANOS = {
  sm: { lado: 32, clase: 'size-8' },
  md: { lado: 48, clase: 'size-12' },
  lg: { lado: 160, clase: 'size-40' },
} as const

/**
 * La foto de un producto, en un cuadrado fijo.
 *
 * Sin foto --o si no carga-- queda el mismo cuadrado con un dibujo neutro: la
 * fila no salta de lugar y se ve a simple vista a cual le falta.
 *
 * Fondo blanco y no `surface`: las fotos de catalogo vienen sobre blanco, y en
 * un cuadrado gris se veria el recorte.
 *
 * `alt` vacio en los listados, que es el caso por omision: al lado esta el
 * nombre, y un lector de pantalla lo leeria dos veces. La ficha si la describe.
 *
 * `unoptimized`: la foto ya llega achicada y en WebP desde el servidor, y el
 * optimizador de Next la volveria a procesar para nada.
 */
export function FotoDeProducto({
  src,
  tamano = 'md',
  alt = '',
  className,
}: {
  src: string | null
  tamano?: keyof typeof TAMANOS
  alt?: string
  className?: string
}) {
  // La direccion que fallo, y no un booleano: si cambia la foto, la nueva se
  // intenta de nuevo sin que nadie tenga que acordarse de reiniciar nada.
  const [rota, setRota] = useState<string | null>(null)
  const { lado, clase } = TAMANOS[tamano]
  const caja = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line',
    clase,
    className,
  )

  if (src === null || rota === src) {
    return (
      <span
        className={cn(caja, 'bg-sunken text-ink-faint')}
        data-sin-foto=""
        {...(alt === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': alt })}
      >
        <svg
          className="size-1/2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m2.25 15.75 5.16-5.16a2.25 2.25 0 0 1 3.18 0l5.16 5.16m-1.5-1.5 1.41-1.41a2.25 2.25 0 0 1 3.18 0l2.91 2.91M3.75 21h16.5a1.5 1.5 0 0 0 1.5-1.5v-15a1.5 1.5 0 0 0-1.5-1.5H3.75a1.5 1.5 0 0 0-1.5 1.5v15a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V9.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
          />
        </svg>
      </span>
    )
  }

  return (
    <span className={cn(caja, 'bg-white')}>
      <Image
        src={src}
        alt={alt}
        width={lado}
        height={lado}
        unoptimized
        className="size-full object-contain"
        onError={() => {
          setRota(src)
        }}
      />
    </span>
  )
}
