'use client'

import { useEffect } from 'react'
import { Button, ButtonLink, PageContainer } from '@/components/ui'

/**
 * Cuando una pantalla falla al dibujarse. UX V2, Fase 2.1.
 *
 * Sin este archivo, un error en cualquier pagina --una consulta que no
 * responde, un dato con una forma inesperada-- dejaba el marco de la
 * aplicacion con el contenido en blanco y ninguna explicacion. Era una de las
 * dos formas de "queda medio rota" que reporto la fase.
 *
 * El armazon sigue arriba: la barra lateral y la cabecera viven en el layout,
 * asi que desde aca se puede ir a otra pantalla sin recargar nada.
 *
 * `reset()` vuelve a intentar dibujar el mismo segmento. Si el problema era
 * pasajero --la base tardo demasiado-- alcanza; si no, el boton se puede
 * apretar de nuevo sin perder la sesion.
 */
export default function ErrorDePantalla({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // El detalle va a la consola del navegador, no a la pantalla: al que esta
    // en la caja no le sirve un stack, y a quien lo tenga que mirar si.
    console.error(error)
  }, [error])

  return (
    <PageContainer width="narrow">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <h2 className="text-xl font-semibold text-ink">No se pudo mostrar esta pantalla</h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Algo falló al cargar los datos. No se perdió nada de lo que ya estaba guardado. Probá de
          nuevo; si vuelve a pasar, avisá y mostrá este código.
        </p>
        {error.digest && (
          <p className="text-xs text-ink-faint" data-numeric="">
            Código: {error.digest}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>Probar de nuevo</Button>
          <ButtonLink href="/" variant="secondary">
            Ir al inicio
          </ButtonLink>
        </div>
      </div>
    </PageContainer>
  )
}
