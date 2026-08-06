'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { esObjeto, texto } from '@/lib/api-client'

interface Producto {
  name: string
  brand: string
  image: string
}

/**
 * Lectura de la respuesta de OpenFoodFacts.
 *
 * Es un servicio externo y publico: su respuesta no la controla este
 * proyecto y puede cambiar de forma sin aviso. Por eso se lee campo por
 * campo en vez de confiar en `res.json()`, que devuelve `any` y deja pasar
 * cualquier cosa hasta que reviente al pintar.
 */
function leerProductoExterno(data: unknown): Producto | null {
  if (!esObjeto(data) || data.status !== 1 || !esObjeto(data.product)) return null
  const p = data.product
  return {
    name: texto(p.product_name, 'Sin nombre'),
    brand: texto(p.brands, 'Marca desconocida'),
    image: texto(p.image_front_url),
  }
}

export default function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [code, setCode] = useState<string | null>(null)
  const [product, setProduct] = useState<Producto | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Ultimo codigo consultado. En una ref, no en estado: cambiarlo no debe
   *  volver a montar el lector ni reiniciar la camara. */
  const ultimoCodigo = useRef<string | null>(null)

  const fetchProduct = useCallback(async (barcode: string) => {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v9/product/${barcode}.json`)
      if (!res.ok) {
        setProduct(null)
        return
      }
      setProduct(leerProductoExterno(await res.json()))
    } catch (e) {
      console.error(e)
      setError('No se pudo obtener información del producto')
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const reader = new BrowserMultiFormatReader()
    let controls: IScannerControls | null = null
    let cancelado = false

    /**
     * El efecto no depende de `code`.
     *
     * Antes si: cada lectura cambiaba el estado, el efecto se volvia a
     * ejecutar y se creaba un lector nuevo, apagando y encendiendo la camara
     * en cada escaneo. Ahora el lector se monta una vez y la comparacion con
     * el codigo anterior se hace contra una ref.
     */
    void reader
      .decodeFromVideoDevice(undefined, video, (result, err) => {
        if (result) {
          const barcode = result.getText()
          if (barcode !== ultimoCodigo.current) {
            ultimoCodigo.current = barcode
            setCode(barcode)
            void fetchProduct(barcode)
          }
        } else if (err && err.name !== 'NotFoundException') {
          setError('Error al escanear')
          console.error(err)
        }
      })
      .then((c) => {
        // Si el componente se desmonto mientras se pedia la camara, se apaga
        // en cuanto llega: si no, el permiso queda tomado y el led encendido.
        if (cancelado) c.stop()
        else controls = c
      })
      .catch((e: unknown) => {
        console.error(e)
        setError('No se pudo acceder a la camara')
      })

    return () => {
      cancelado = true
      controls?.stop()
      // `video` se captura al inicio del efecto a proposito: leer
      // videoRef.current dentro de la limpieza puede devolver otro elemento.
      const stream = video.srcObject
      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [fetchProduct])

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="border border-gray-300 rounded-md overflow-hidden">
        <video ref={videoRef} className="w-[280px] h-[200px] object-cover" muted autoPlay />
      </div>

      {code && (
        <div className="text-sm text-green-600 dark:text-green-400">
          Código escaneado: <strong>{code}</strong>
        </div>
      )}

      {product && (
        <div className="mt-2 text-center bg-white dark:bg-gray-800 p-4 rounded shadow w-full max-w-xs">
          {product.image && (
            // eslint-disable-next-line @next/next/no-img-element -- imagen de un dominio externo arbitrario; next/image exigiria declararlo en remotePatterns
            <img
              src={product.image}
              alt={product.name}
              className="w-24 h-24 mx-auto object-contain mb-2"
            />
          )}
          <h2 className="font-bold">{product.name}</h2>
          <p className="text-gray-500">{product.brand}</p>
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}
    </div>
  )
}
