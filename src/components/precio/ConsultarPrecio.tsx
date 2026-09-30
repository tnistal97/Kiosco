'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  Kbd,
  Money,
  ScannerInput,
  formatQuantity,
  type BarcodeStatus,
  type TeclaDelLector,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { DialogoAltaRapida } from '@/components/venta/DialogoAltaRapida'
import { ApiError, apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  parseCategorias,
  parsePaginaProductos,
  parseProducto,
  type CategoriaDTO,
  type ProductoDTO,
} from '@/modules/products/dto'
import { denominadorDePrecio, esFraccionable } from '@/modules/products/units'

/**
 * Consultar precio. V1 comercial.
 *
 * Una pantalla para una sola pregunta: "¿cuanto sale esto?". Se escanea o se
 * escribe, y aparece el precio en grande. No agrega nada al ticket, no
 * necesita caja abierta y la puede usar el cajero: es la respuesta al cliente
 * que pregunta desde la gondola.
 *
 * Un codigo --lo que manda el lector, o numeros a mano-- se busca EXACTO
 * contra el indice de codigos, igual que en la caja. Un nombre se busca a
 * medida que se escribe y Enter toma el primero. Si no esta: lo dice y, con
 * permiso, ofrece cargarlo con el alta rapida de siempre.
 *
 *   Enter   buscar / elegir el primero
 *   Esc     limpiar y volver a empezar
 */

/** Lo que manda un lector: solo digitos, y varios. */
const CODIGO = /^\d{4,}$/

const DEBOUNCE_MS = 250
const CANDIDATOS = 6

export function esCodigo(texto: string): boolean {
  return CODIGO.test(texto.trim())
}

type Resultado =
  | { tipo: 'nada' }
  | { tipo: 'buscando' }
  | { tipo: 'producto'; producto: ProductoDTO }
  | { tipo: 'no_esta'; codigo: string | null; termino: string }
  | { tipo: 'error'; mensaje: string }

export function ConsultarPrecio() {
  const puedeCargar = usePermiso('products.quickCreate')

  const [texto, setTexto] = useState('')
  const [resultado, setResultado] = useState<Resultado>({ tipo: 'nada' })
  const [candidatos, setCandidatos] = useState<ProductoDTO[]>([])
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [categorias, setCategorias] = useState<CategoriaDTO[]>([])

  const campo = useRef<HTMLInputElement>(null)
  const enCurso = useRef<AbortController | null>(null)

  const enfocar = useCallback(() => {
    campo.current?.focus()
    campo.current?.select()
  }, [])

  useEffect(() => {
    enfocar()
  }, [enfocar])

  const limpiar = useCallback(() => {
    enCurso.current?.abort()
    setTexto('')
    setCandidatos([])
    setResultado({ tipo: 'nada' })
    enfocar()
  }, [enfocar])

  const mostrar = useCallback((producto: ProductoDTO) => {
    setResultado({ tipo: 'producto', producto })
    setCandidatos([])
  }, [])

  /** Busqueda por nombre, a medida que se escribe. */
  useEffect(() => {
    const termino = texto.trim()
    if (termino.length < 2 || esCodigo(termino)) {
      setCandidatos([])
      return
    }
    const control = new AbortController()
    const t = setTimeout(() => {
      const params = new URLSearchParams({
        q: termino,
        estado: 'activos',
        pageSize: String(CANDIDATOS),
        sortBy: 'name',
      })
      apiRequest(`/api/products?${params.toString()}`, {
        parse: parsePaginaProductos,
        signal: control.signal,
      })
        .then((p) => {
          setCandidatos(p.data)
        })
        .catch(() => undefined)
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      control.abort()
    }
  }, [texto])

  async function buscar(termino: string) {
    const t = termino.trim()
    if (t === '') return
    enCurso.current?.abort()
    const control = new AbortController()
    enCurso.current = control
    setResultado({ tipo: 'buscando' })

    try {
      if (esCodigo(t)) {
        try {
          const producto = await apiRequest(`/api/products/barcode/${encodeURIComponent(t)}`, {
            parse: parseProducto,
            signal: control.signal,
          })
          mostrar(producto)
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            setResultado({ tipo: 'no_esta', codigo: t, termino: t })
            return
          }
          throw err
        }
        return
      }

      const primero = candidatos[0]
      if (primero) {
        mostrar(primero)
        return
      }
      const params = new URLSearchParams({ q: t, estado: 'activos', pageSize: '1' })
      const pagina = await apiRequest(`/api/products?${params.toString()}`, {
        parse: parsePaginaProductos,
        signal: control.signal,
      })
      const encontrado = pagina.data[0]
      if (encontrado) mostrar(encontrado)
      else setResultado({ tipo: 'no_esta', codigo: null, termino: t })
    } catch (err) {
      if (control.signal.aborted) return
      setResultado({ tipo: 'error', mensaje: mensajeDeError(err, 'No se pudo consultar.') })
    }
  }

  function tecla(t: TeclaDelLector, actual: string): boolean {
    if (t === 'Enter') {
      void buscar(actual)
      return true
    }
    if (t === 'Escape') {
      limpiar()
      return true
    }
    return false
  }

  async function abrirAlta() {
    try {
      setCategorias(await apiRequest('/api/categories', { parse: parseCategorias }))
    } catch {
      setCategorias([])
    }
    setAltaAbierta(true)
  }

  const estado: BarcodeStatus =
    resultado.tipo === 'buscando'
      ? 'reading'
      : resultado.tipo === 'producto'
        ? 'ok'
        : resultado.tipo === 'no_esta' || resultado.tipo === 'error'
          ? 'error'
          : 'idle'

  return (
    <div className="flex flex-col gap-4" data-consultar-precio="">
      <ScannerInput
        ref={campo}
        value={texto}
        onValueChange={(v) => {
          setTexto(v)
          if (resultado.tipo !== 'nada' && resultado.tipo !== 'buscando') {
            setResultado({ tipo: 'nada' })
          }
        }}
        onKey={tecla}
        status={estado}
        loading={resultado.tipo === 'buscando'}
        label="Escaneá o escribí un producto"
        placeholder="Escaneá o escribí un producto"
        hint={
          <span className="flex flex-wrap gap-x-3">
            <span>
              <Kbd>Enter</Kbd> buscar
            </span>
            <span>
              <Kbd>Esc</Kbd> limpiar
            </span>
          </span>
        }
      />

      {candidatos.length > 0 && resultado.tipo !== 'producto' && (
        <ul
          className="divide-y divide-line rounded-lg border border-line bg-surface"
          aria-label="Coincidencias"
        >
          {candidatos.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-raised"
                onClick={() => {
                  mostrar(p)
                }}
              >
                <span className="min-w-0 truncate text-ink">
                  {p.name}
                  {i === 0 && <span className="ml-2 text-xs text-ink-faint">Enter</span>}
                </span>
                <Money amount={p.price} size="md" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {resultado.tipo === 'producto' && (
        <Card className="flex flex-col items-center gap-2 py-8 text-center" aria-live="polite">
          <p className="text-xl font-medium text-ink sm:text-2xl">{resultado.producto.name}</p>
          <p className="flex items-baseline justify-center gap-1">
            <Money amount={resultado.producto.price} size="hero" />
            {esFraccionable(resultado.producto.saleUnit) && (
              <span className="text-lg text-ink-muted">
                {denominadorDePrecio(resultado.producto.saleUnit)}
              </span>
            )}
          </p>
          <p className="text-base text-ink-muted" data-numeric="">
            Stock: {formatQuantity(resultado.producto.sellableStock, resultado.producto.saleUnit)}
          </p>
          {resultado.producto.barcode && (
            <p className="text-xs text-ink-faint" data-numeric="">
              {resultado.producto.barcode}
            </p>
          )}
        </Card>
      )}

      {resultado.tipo === 'no_esta' && (
        <Card className="flex flex-col items-center gap-3 py-8 text-center" aria-live="polite">
          <p className="text-xl font-medium text-ink">No está cargado</p>
          <p className="text-sm text-ink-muted" data-numeric="">
            {resultado.codigo !== null
              ? `Ningún producto tiene el código ${resultado.codigo}.`
              : `No hay ningún producto que se llame "${resultado.termino}".`}
          </p>
          {puedeCargar && (
            <Button variant="primary" onClick={() => void abrirAlta()}>
              Cargar producto
            </Button>
          )}
        </Card>
      )}

      {resultado.tipo === 'error' && (
        <Card className="py-6 text-center" aria-live="assertive">
          <p className="text-sm text-danger">{resultado.mensaje}</p>
        </Card>
      )}

      {resultado.tipo === 'nada' && candidatos.length === 0 && texto.trim() === '' && (
        <p className="text-center text-sm text-ink-faint">
          Pasá el lector por el código, o escribí parte del nombre.
        </p>
      )}

      {puedeCargar && (
        <DialogoAltaRapida
          abierto={altaAbierta}
          codigo={resultado.tipo === 'no_esta' ? resultado.codigo : null}
          categorias={categorias}
          onCerrar={() => {
            setAltaAbierta(false)
            enfocar()
          }}
          onCreado={(p) => {
            setAltaAbierta(false)
            mostrar(p)
          }}
          onYaExistia={(p) => {
            setAltaAbierta(false)
            mostrar(p)
          }}
        />
      )}
    </div>
  )
}
