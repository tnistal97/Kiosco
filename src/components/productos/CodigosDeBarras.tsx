'use client'

import { useState } from 'react'
import { Button, Field, IconButton, Input } from '@/components/ui'

/**
 * Codigo principal y codigos alternativos de un producto.
 *
 * Un producto puede tener varios: el mismo yogur cambia de codigo entre
 * partidas, y el proveedor a veces manda el pack con un codigo distinto al de
 * la unidad. Con uno solo, el lector no encuentra la mitad de la mercaderia y
 * el cajero termina buscando por nombre.
 *
 * Para el lector los dos tipos son lo MISMO: escanear un alternativo encuentra
 * el mismo producto que escanear el principal. La distincion es de pantalla --
 * el principal es el que se muestra en los listados-- y nada mas.
 *
 * Un codigo se agrega con Enter, sin tener que apuntar a un boton: en la
 * practica esto se llena pasando el lector por cada etiqueta, una tras otra.
 */
export function CodigosDeBarras({
  principal,
  alternativos,
  deshabilitado,
  onPrincipal,
  onAlternativos,
}: {
  principal: string
  alternativos: string[]
  deshabilitado: boolean
  onPrincipal: (v: string) => void
  onAlternativos: (v: string[]) => void
}) {
  const [nuevo, setNuevo] = useState('')

  const yaEsta = (codigo: string) =>
    codigo === principal.trim() || alternativos.includes(codigo.trim())

  function agregar() {
    const codigo = nuevo.trim()
    if (codigo === '' || yaEsta(codigo)) {
      setNuevo('')
      return
    }
    onAlternativos([...alternativos, codigo])
    setNuevo('')
  }

  const repetido = nuevo.trim() !== '' && yaEsta(nuevo)

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Código principal"
        hint="El que se muestra en los listados. Vacío si el producto no tiene etiqueta."
      >
        <Input
          value={principal}
          disabled={deshabilitado}
          className="font-mono"
          onChange={(e) => {
            onPrincipal(e.target.value)
          }}
        />
      </Field>

      <Field
        label="Códigos alternativos"
        hint="El lector encuentra el producto con cualquiera de ellos."
        error={repetido ? 'Ese código ya está en la lista.' : null}
      >
        <div className="flex gap-2">
          <Input
            value={nuevo}
            disabled={deshabilitado}
            className="font-mono"
            placeholder="Escaneá o escribí y presioná Enter"
            onChange={(e) => {
              setNuevo(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                agregar()
              }
            }}
          />
          <Button
            variant="secondary"
            disabled={deshabilitado || nuevo.trim() === '' || repetido}
            onClick={agregar}
          >
            Agregar
          </Button>
        </div>
      </Field>

      {alternativos.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {alternativos.map((codigo) => (
            <li
              key={codigo}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-raised py-0.5 pr-0.5 pl-2.5"
            >
              <span className="font-mono text-xs text-ink">{codigo}</span>
              <IconButton
                label={`Quitar el código ${codigo}`}
                size="sm"
                variant="ghost"
                disabled={deshabilitado}
                onClick={() => {
                  onAlternativos(alternativos.filter((c) => c !== codigo))
                }}
                className="text-ink-faint hover:text-danger"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6 18 18M18 6 6 18" />
                </svg>
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
