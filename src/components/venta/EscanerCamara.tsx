'use client'

import { useEffect, useRef, useState } from 'react'
import { Alert, Dialog } from '@/components/ui'

/**
 * Lectura de codigo de barras con la camara.
 *
 * Para cuando no hay lector USB: un telefono o una tablet apuntando a la
 * etiqueta. El codigo leido se entrega al mismo camino que el del lector, asi
 * que la caja no distingue de donde vino.
 *
 * Dos diferencias con lo que habia:
 *
 *  - vivia en una pantalla suelta (`/camera`) que no tenia nada que ver con
 *    la venta: leia el codigo y lo mandaba a **OpenFoodFacts**, un servicio
 *    externo, para mostrar una foto. Ahora el codigo no sale de la
 *    aplicacion;
 *  - la camara se apaga al cerrar. Siempre: tambien si el dialogo se cierra
 *    mientras el navegador todavia esta pidiendo permiso.
 *
 * `@zxing/browser` se carga con `import()` dinamico: son ~200 kB que no tiene
 * por que descargar quien usa un lector USB, que es el caso normal.
 */
export function EscanerCamara({
  abierto,
  onCerrar,
  onCodigo,
}: {
  abierto: boolean
  onCerrar: () => void
  onCodigo: (codigo: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return

    const elemento = video.current
    if (!elemento) return

    let cerrado = false
    let detener: (() => void) | null = null
    let anterior: string | null = null

    /*
     * Se consulta con una funcion, no leyendo la variable.
     *
     * No es un rodeo estilistico: `arrancar` pregunta dos veces si el dialogo
     * sigue abierto --antes y despues de esperar a la camara-- y TypeScript,
     * al ver `let cerrado = false` sin asignaciones visibles en ese camino,
     * reduce la segunda comprobacion a "siempre falsa" y la marca como
     * muerta. No lo es: la limpieza corre en otra funcion, mientras esta
     * espera. El retorno de una llamada no se puede estrechar, asi que el
     * compilador vuelve a decir la verdad.
     */
    const yaSeCerro = () => cerrado

    async function arrancar(destino: HTMLVideoElement) {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (yaSeCerro()) return

        const lector = new BrowserMultiFormatReader()
        const controles = await lector.decodeFromVideoDevice(undefined, destino, (resultado) => {
          if (!resultado) return
          const codigo = resultado.getText()
          // El mismo codigo delante de la camara dispara muchas lecturas por
          // segundo. Se entrega una sola vez.
          if (codigo === anterior) return
          anterior = codigo
          setUltimo(codigo)
          onCodigo(codigo)
        })

        // Si el dialogo se cerro mientras el navegador pedia permiso, la
        // camara llega igual: hay que apagarla o queda el led encendido.
        if (yaSeCerro()) controles.stop()
        else detener = () => controles.stop()
      } catch {
        if (!yaSeCerro()) {
          setError('No se pudo acceder a la cámara. Revisá los permisos del navegador.')
        }
      }
    }

    void arrancar(elemento)

    return () => {
      cerrado = true
      detener?.()
      const flujo = elemento.srcObject
      if (flujo instanceof MediaStream) {
        flujo.getTracks().forEach((t) => {
          t.stop()
        })
      }
      elemento.srcObject = null
    }
  }, [abierto, onCodigo])

  useEffect(() => {
    if (!abierto) {
      setUltimo(null)
      setError(null)
    }
  }, [abierto])

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Escanear con la cámara"
      description="Apuntá al código de barras del producto."
      size="sm"
    >
      <div className="flex flex-col gap-3">
        {error ? (
          <Alert tone="danger" title="Cámara no disponible">
            {error}
          </Alert>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-sunken">
            <video
              ref={video}
              className="aspect-[4/3] w-full object-cover"
              muted
              playsInline
              autoPlay
            />
          </div>
        )}

        <p role="status" aria-live="polite" className="min-h-5 text-center text-sm text-ink-muted">
          {ultimo ? (
            <>
              Leído: <span className="font-mono text-ink">{ultimo}</span>
            </>
          ) : (
            'Buscando un código…'
          )}
        </p>
      </div>
    </Dialog>
  )
}
