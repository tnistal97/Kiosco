/**
 * Preparacion extra para las pruebas de interfaz.
 *
 * Solo hace algo cuando el entorno es jsdom; en los archivos que corren en
 * Node no toca nada. Es lo que permite tener las dos clases de prueba en la
 * misma suite sin que una pague el costo de la otra.
 */

import { afterEach } from 'vitest'

const enJsdom = typeof window !== 'undefined' && typeof document !== 'undefined'

if (enJsdom) {
  // Este punto de entrada registra los matchers en vitest por su cuenta.
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')

  afterEach(() => {
    cleanup()
    // Cada prueba arranca con el almacenamiento vacio: si no, el ticket
    // guardado por una se restaura en la siguiente.
    window.localStorage.clear()
  })

  /**
   * jsdom no implementa estas dos y Headless UI las usa.
   *
   * Sin `matchMedia` el componente revienta al montar; sin `scrollIntoView`
   * falla al mover el foco dentro de un menu.
   *
   * La comprobacion va sobre una vista sin tipos a proposito: los tipos del
   * DOM dicen que las dos existen siempre, asi que preguntarlo directamente
   * seria "codigo muerto" para el compilador. En jsdom no existen.
   */
  const ventana = window as unknown as Record<string, unknown>
  if (typeof ventana.matchMedia !== 'function') {
    ventana.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })
  }

  const prototipo = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototipo.scrollIntoView !== 'function') {
    prototipo.scrollIntoView = () => undefined
  }
}
