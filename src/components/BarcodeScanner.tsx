'use client'

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'

interface Producto {
  name: string
  brand: string
  image: string
}

export default function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [code, setCode] = useState<string | null>(null)
  const [product, setProduct] = useState<Producto | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()

    reader.decodeFromVideoDevice(undefined, videoRef.current!, (result, err) => {
      if (result) {
        const barcode = result.getText()
        if (barcode !== code) {
          setCode(barcode)
          fetchProduct(barcode)
        }
      } else if (err && err.name !== 'NotFoundException') {
        setError('Error al escanear')
        console.error(err)
      }
    })

    return () => {
      const video = videoRef.current
      if (video?.srcObject) {
        const stream = video.srcObject as MediaStream
        stream.getTracks().forEach(track => track.stop())
      }
    }
  }, [code])

  const fetchProduct = async (barcode: string) => {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v9/product/${barcode}.json`)
      const data = await res.json()
      if (data.status === 1) {
        setProduct({
          name: data.product.product_name || 'Sin nombre',
          brand: data.product.brands || 'Marca desconocida',
          image: data.product.image_front_url || ''
        })
      } else {
        setProduct(null)
      }
    } catch (e) {
      console.error(e)
      setError('No se pudo obtener información del producto')
    }
  }

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
          <img src={product.image} alt={product.name} className="w-24 h-24 mx-auto object-contain mb-2" />
          <h2 className="font-bold">{product.name}</h2>
          <p className="text-gray-500">{product.brand}</p>
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}
    </div>
  )
}
