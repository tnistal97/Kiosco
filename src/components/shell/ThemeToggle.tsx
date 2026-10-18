'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Cambio de tema.
 *
 * Desde la V5 el CLARO es el predeterminado: es el que se entiende de entrada
 * y el que se lee bien con luz de dia. El oscuro queda para quien atiende de
 * noche o con poca luz. No sigue al sistema operativo: se elige y queda
 * elegido.
 *
 * Vive en Configuracion, no en la cabecera: es una preferencia que se toca
 * una vez, y en la cabecera era un icono mas compitiendo con la caja.
 *
 * La eleccion se guarda en `localStorage`. No es un dato privado --es una
 * preferencia visual-- y no se manda al servidor.
 */
const CLAVE = 'kiosco:tema'

export type Tema = 'dark' | 'light'

/**
 * Script que corre antes de pintar.
 *
 * Sin esto, quien eligio el tema oscuro ve un fogonazo claro en cada carga.
 * Va en el `<head>` como `dangerouslySetInnerHTML` porque tiene que ejecutarse
 * antes que React.
 */
export const SCRIPT_TEMA = `
try {
  var t = localStorage.getItem('${CLAVE}');
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
} catch (e) {}
`.trim()

function leerTema(): Tema {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>('light')

  // El valor real lo pone el script del `<head>`; el estado se sincroniza al
  // montar para que el boton diga lo correcto.
  useEffect(() => {
    setTema(leerTema())
  }, [])

  function alternar() {
    const nuevo: Tema = tema === 'dark' ? 'light' : 'dark'
    setTema(nuevo)
    if (nuevo === 'dark') {
      document.documentElement.dataset.theme = 'dark'
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
    <Button variant="secondary" onClick={alternar} aria-pressed={tema === 'dark'}>
      {tema === 'dark' ? 'Cambiar al tema claro' : 'Cambiar al tema oscuro'}
    </Button>
  )
}
