'use client'

import { useEffect, useState } from 'react'
import { IconButton } from '@/components/ui'

/**
 * Cambio de tema.
 *
 * El oscuro es el predeterminado y no sigue al sistema operativo: se elige y
 * queda elegido. El claro existe para quien trabaja frente a una ventana.
 *
 * La eleccion se guarda en `localStorage`. No es un dato privado --es una
 * preferencia visual-- y no se manda al servidor.
 */
const CLAVE = 'kiosco:tema'

export type Tema = 'dark' | 'light'

/**
 * Script que corre antes de pintar.
 *
 * Sin esto, quien eligio el tema claro ve un fogonazo oscuro en cada carga.
 * Va en el `<head>` como `dangerouslySetInnerHTML` porque tiene que ejecutarse
 * antes que React.
 */
export const SCRIPT_TEMA = `
try {
  var t = localStorage.getItem('${CLAVE}');
  if (t === 'light') document.documentElement.dataset.theme = 'light';
} catch (e) {}
`.trim()

function leerTema(): Tema {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>('dark')

  // El valor real lo pone el script del `<head>`; el estado se sincroniza al
  // montar para que el boton muestre el icono correcto.
  useEffect(() => {
    setTema(leerTema())
  }, [])

  function alternar() {
    const nuevo: Tema = tema === 'dark' ? 'light' : 'dark'
    setTema(nuevo)
    if (nuevo === 'light') {
      document.documentElement.dataset.theme = 'light'
    } else {
      delete document.documentElement.dataset.theme
    }
    try {
      localStorage.setItem(CLAVE, nuevo)
    } catch {
      // Modo privado o almacenamiento lleno: el tema vale para esta sesion.
    }
  }

  return (
    <IconButton
      label={tema === 'dark' ? 'Cambiar al tema claro' : 'Cambiar al tema oscuro'}
      size="sm"
      onClick={alternar}
    >
      {tema === 'dark' ? (
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M21 12h-2M5 12H3M18.4 5.6 17 7M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6" />
        </svg>
      ) : (
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </IconButton>
  )
}
