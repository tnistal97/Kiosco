'use client'

import { useEffect, useRef, useState } from 'react'
import { Alert, Button, aviso } from '@/components/ui'
import { apiRequest, esObjeto, mensajeDeError, texto } from '@/lib/api-client'
import { FotoDeProducto } from './FotoDeProducto'
import { achicarFoto } from './achicar-foto'

/**
 * La foto en la ficha de un producto que ya existe.
 *
 * Se guarda en el momento, no con «Guardar cambios»: es un archivo que se sube,
 * y esperar al boton del formulario obligaria a tenerlo en memoria y a explicar
 * que pasa si se cancela. La ficha lo dice debajo de los botones.
 *
 * Quien no puede editar productos ve la foto y nada mas.
 */
export function FotoEnFicha({
  productoId,
  nombre,
  imageUrl,
  fuente,
  puedeCambiar,
  onCambio,
}: {
  productoId: number
  nombre: string
  imageUrl: string | null
  /** Pagina de donde salio la foto, si salio de internet. */
  fuente: string | null
  puedeCambiar: boolean
  /** Para que el listado se recargue con la foto nueva. */
  onCambio: () => void
}) {
  const [actual, setActual] = useState(imageUrl)
  const [origen, setOrigen] = useState(fuente)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selector = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setActual(imageUrl)
    setError(null)
  }, [imageUrl, productoId])

  useEffect(() => {
    setOrigen(fuente)
  }, [fuente])

  async function subir(archivo: File) {
    setTrabajando(true)
    setError(null)
    try {
      const respuesta = await apiRequest(`/api/products/${String(productoId)}/imagen`, {
        method: 'PUT',
        body: await achicarFoto(archivo),
        parse: (raw) => (esObjeto(raw) ? texto(raw.imageUrl) : ''),
      })
      setActual(respuesta === '' ? null : respuesta)
      setOrigen(null)
      aviso.ok('Foto guardada.')
      onCambio()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar la foto.'))
    } finally {
      setTrabajando(false)
    }
  }

  async function quitar() {
    setTrabajando(true)
    setError(null)
    try {
      await apiRequest(`/api/products/${String(productoId)}/imagen`, {
        method: 'DELETE',
        parse: () => null,
      })
      setActual(null)
      setOrigen(null)
      aviso.ok('Foto quitada.')
      onCambio()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo quitar la foto.'))
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <FotoDeProducto
        src={actual}
        tamano="lg"
        alt={actual === null ? `${nombre}: sin foto` : `Foto de ${nombre}`}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-semibold text-ink">Foto</span>
        {origen !== null && (
          <p className="text-sm break-all text-ink-muted">
            Sacada de{' '}
            <a
              href={origen}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline underline-offset-2"
            >
              {dominioDe(origen)}
            </a>
          </p>
        )}
        {puedeCambiar && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={trabajando}
                onClick={() => {
                  selector.current?.click()
                }}
              >
                {actual === null ? 'Agregar foto' : 'Cambiar foto'}
              </Button>
              {actual !== null && (
                <Button variant="ghost" disabled={trabajando} onClick={() => void quitar()}>
                  Quitar foto
                </Button>
              )}
            </div>
            <p className="text-sm text-ink-muted">
              JPG, PNG o WebP. Se guarda en el momento, sin tocar «Guardar cambios».
            </p>
            <input
              ref={selector}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const archivo = e.target.files?.[0]
                // Vaciarlo permite elegir otra vez el mismo archivo.
                e.target.value = ''
                if (archivo) void subir(archivo)
              }}
            />
          </>
        )}
        {error && (
          <Alert tone="danger" title="La foto no cambió">
            {error}
          </Alert>
        )}
      </div>
    </div>
  )
}

function dominioDe(direccion: string): string {
  try {
    return new URL(direccion).hostname.replace(/^www\./, '')
  } catch {
    return direccion
  }
}
