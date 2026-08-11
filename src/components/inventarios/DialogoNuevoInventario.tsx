'use client'

import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  RadioGroup,
  Select,
  Textarea,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { ALCANCES, etiquetaDeAlcance, type Alcance } from '@/modules/inventory-counts/estados'

/**
 * Armar un inventario fisico.
 *
 * TRES decisiones, y ninguna es cosmetica:
 *
 * ALCANCE. Todo el catalogo, una categoria o una seleccion. Contar el deposito
 * entero es lo correcto una vez al ano; el resto del tiempo se cuenta la
 * gondola de lacteos un martes a la manana. Sin alcance, cada recuento parcial
 * volveria a ser un ajuste manual suelto.
 *
 * CONTEO A CIEGAS, encendido por omision. Ver "el sistema espera 18" antes de
 * contar hace que la respuesta sea 18: un conteo influido por el numero
 * esperado no es un conteo, es una confirmacion. Apagarlo es una decision
 * explicita, y la pantalla dice lo que se pierde.
 *
 * SEGUNDO CONTEO. Un numero y una comprobacion, no un motor de reglas: si la
 * diferencia absoluta supera el umbral, la linea vuelve a contarse UNA vez y el
 * primer conteo queda guardado. Pedirlo indefinidamente convertiria una
 * diferencia real en un bucle del que no se sale.
 *
 * Ver docs/PHYSICAL_INVENTORY.md.
 */

interface Categoria {
  id: number
  name: string
}

export function DialogoNuevoInventario({
  abierto,
  onCerrar,
  onCreado,
}: {
  abierto: boolean
  onCerrar: () => void
  onCreado: (id: number) => void
}) {
  const [alcance, setAlcance] = useState<Alcance>('ALL')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [aCiegas, setACiegas] = useState(true)
  const [conRecuento, setConRecuento] = useState(false)
  const [umbral, setUmbral] = useState('1')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setAlcance('ALL')
    setCategoria('')
    setACiegas(true)
    setConRecuento(false)
    setUmbral('1')
    setNotas('')
    setError(null)
    setEnviando(false)

    let vivo = true
    void apiRequest<Categoria[]>('/api/categories', {
      parse: (raw) => {
        const fuente = raw !== null && typeof raw === 'object' && 'data' in raw ? raw.data : raw
        return Array.isArray(fuente) ? (fuente as Categoria[]) : []
      },
    })
      .then((c) => {
        if (vivo) setCategorias(c)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [abierto])

  // La selección de productos no se ofrece acá: elegir doscientos productos de
  // a uno en un diálogo no es usable. `SELECTION` existe en la API y lo usan las
  // pruebas; la pantalla ofrece los dos alcances que se recorren de verdad.
  const alcancesOfrecidos = ALCANCES.filter((a) => a !== 'SELECTION')
  const falta = alcance === 'CATEGORY' && categoria === ''
  const umbralValido = !conRecuento || /^\d+([.,]\d{1,3})?$/.test(umbral.trim())

  async function crear() {
    setEnviando(true)
    setError(null)
    try {
      const sesion = await apiRequest<{ id: number }>('/api/inventarios', {
        method: 'POST',
        body: {
          scope: alcance,
          ...(alcance === 'CATEGORY' ? { categoryId: Number(categoria) } : {}),
          blindCount: aCiegas,
          ...(conRecuento ? { recountThreshold: umbral.replace(',', '.') } : {}),
          ...(notas.trim() === '' ? {} : { notes: notas.trim() }),
        },
        parse: (raw) => raw as { id: number },
      })
      onCreado(sesion.id)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo crear el inventario.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Nuevo inventario físico"
      size="md"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={enviando || falta || !umbralValido}
            onClick={() => void crear()}
          >
            Crear inventario
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error !== null && (
          <Alert tone="danger" title="No se creó">
            {error}
          </Alert>
        )}

        <RadioGroup
          legend="Qué se cuenta"
          name="alcance"
          value={alcance}
          onChange={setAlcance}
          options={alcancesOfrecidos.map((a) => ({
            value: a,
            label: etiquetaDeAlcance(a),
            disabled: enviando,
          }))}
          columns={2}
        />

        {alcance === 'CATEGORY' && (
          <Field
            label="Categoría"
            required
            error={falta ? 'Elegí la categoría que se va a contar.' : null}
          >
            <Select
              value={categoria}
              disabled={enviando}
              onChange={(e) => {
                setCategoria(e.target.value)
              }}
            >
              <option value="">Elegí una…</option>
              {categorias.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="rounded-md border border-line bg-sunken p-3">
          <Checkbox
            checked={aCiegas}
            disabled={enviando}
            label="Conteo a ciegas"
            description="Quien cuenta no ve lo que el sistema espera. Es lo que hace que el conteo sea un conteo y no una confirmación."
            onChange={(e) => {
              setACiegas(e.target.checked)
            }}
          />
          {!aCiegas && (
            <p className="mt-2 text-xs text-warning">
              Sin conteo a ciegas, quien recorre el depósito ve el número esperado antes de contar.
            </p>
          )}
        </div>

        <div className="rounded-md border border-line bg-sunken p-3">
          <Checkbox
            checked={conRecuento}
            disabled={enviando}
            label="Requerir segundo conteo si hay diferencia"
            description="La línea se vuelve a contar una vez. El primer conteo queda guardado."
            onChange={(e) => {
              setConRecuento(e.target.checked)
            }}
          />
          {conRecuento && (
            <Field
              className="mt-3"
              label="A partir de qué diferencia"
              hint="En unidades. Una diferencia menor no pide recuento."
              error={umbralValido ? null : 'Escribí un número.'}
            >
              <Input
                inputMode="decimal"
                value={umbral}
                disabled={enviando}
                onChange={(e) => {
                  setUmbral(e.target.value.replace(/[^0-9.,]/g, ''))
                }}
              />
            </Field>
          )}
        </div>

        <Field label="Notas" hint="Por qué se cuenta, quién recorre, lo que convenga anotar.">
          <Textarea
            rows={2}
            value={notas}
            disabled={enviando}
            onChange={(e) => {
              setNotas(e.target.value)
            }}
          />
        </Field>

        <Alert tone="info">
          Las líneas se generan al crear la sesión: una por producto y partida con unidades. Contar
          no cierra el local — lo esperado se lee en el momento de contar.
        </Alert>
      </div>
    </Dialog>
  )
}
