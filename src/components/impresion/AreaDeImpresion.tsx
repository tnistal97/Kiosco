'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { leerPreferencias } from './preferencias'

/**
 * Lo unico que sale por la impresora. V1 comercial.
 *
 * El armazon de la aplicacion ocupa la pantalla entera con `overflow:
 * hidden`, asi que imprimir "la pagina" imprime una pantalla recortada. En
 * vez de pelear con eso, lo que se imprime se dibuja en un portal aparte, al
 * final del `body`, y la hoja de estilos de impresion esconde todo lo demas
 * (ver `@media print` en globals.css).
 *
 * `window.print()` y nada mas: sin drivers, sin aplicacion nativa. Cualquier
 * termica de 58 u 80 mm instalada en el sistema operativo imprime lo que el
 * navegador le manda, y ese es todo el requisito.
 *
 * Cuando `contenido` deja de ser null se imprime; al terminar --`afterprint`,
 * o un plazo de gracia para los navegadores que no lo disparan-- se avisa
 * para que quien lo pidio vuelva a dejarlo en null.
 */
export function AreaDeImpresion({
  contenido,
  onTerminado,
}: {
  contenido: ReactNode | null
  onTerminado: () => void
}) {
  const [nodo, setNodo] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let elemento = document.getElementById('impresion')
    if (!elemento) {
      elemento = document.createElement('div')
      elemento.id = 'impresion'
      document.body.appendChild(elemento)
    }
    setNodo(elemento)
  }, [])

  useEffect(() => {
    if (contenido === null || nodo === null) return

    let terminado = false
    const terminar = () => {
      if (terminado) return
      terminado = true
      onTerminado()
    }

    window.addEventListener('afterprint', terminar)
    // Un cuadro despues, para que el portal ya este en el documento cuando
    // el navegador arme la vista previa.
    const cuadro = window.requestAnimationFrame(() => {
      if (typeof window.print === 'function') window.print()
      else terminar()
    })
    // Algunos navegadores moviles no disparan `afterprint`. Sin esto el
    // contenido quedaria "imprimiendose" para siempre.
    const plazo = window.setTimeout(terminar, 5000)

    return () => {
      window.cancelAnimationFrame(cuadro)
      window.clearTimeout(plazo)
      window.removeEventListener('afterprint', terminar)
    }
  }, [contenido, nodo, onTerminado])

  if (contenido === null || nodo === null) return null
  return createPortal(
    <div data-ancho={leerPreferencias().ancho} className="hoja-de-impresion">
      {contenido}
    </div>,
    nodo,
  )
}
