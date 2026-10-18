'use client'

import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  NumericInput,
  RadioGroup,
  Select,
  Textarea,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { cantidadDesdeTexto } from '@/lib/cantidad'
import { problemaDeCantidad } from '@/components/ui'
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
  // V5: por omision SE VE el stock del sistema mientras se cuenta. Es el
  // flujo que se pidio ("mostrar stock del sistema, cargar lo contado, ver la
  // diferencia"). Contar sin verlo sigue disponible en "Más opciones".
  const [aCiegas, setACiegas] = useState(false)
  const [masOpciones, setMasOpciones] = useState(false)
  const [conRecuento, setConRecuento] = useState(false)
  const [umbral, setUmbral] = useState('1')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setAlcance('ALL')
    setCategoria('')
    setACiegas(false)
    setMasOpciones(false)
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
  const umbralCantidad = cantidadDesdeTexto(umbral)
  const problemaDelUmbral = conRecuento ? problemaDeCantidad(umbral) : null
  const umbralValido = !conRecuento || (umbralCantidad !== null && problemaDelUmbral === null)

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
          ...(conRecuento ? { recountThreshold: umbralCantidad } : {}),
          ...(notas.trim() === '' ? {} : { notes: notas.trim() }),
        },
        parse: (raw) => raw as { id: number },
      })
      onCreado(sesion.id)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo empezar el inventario. Probá de nuevo.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Nuevo inventario"
      description="Elegí qué vas a contar. Después cargás lo que encontrás de cada producto."
      size="md"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="lg"
            loading={enviando}
            disabled={enviando || falta || !umbralValido}
            onClick={() => void crear()}
          >
            Empezar a contar
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
          legend="¿Qué vas a contar?"
          name="alcance"
          value={alcance}
          onChange={setAlcance}
          options={alcancesOfrecidos.map((a) => ({
            value: a,
            label: a === 'ALL' ? 'Todo el negocio' : etiquetaDeAlcance(a),
            description:
              a === 'ALL' ? 'Todos los productos que están en venta' : 'Solo los de una categoría',
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

        <div className="border-t border-line pt-3">
          <Button
            variant="ghost"
            aria-expanded={masOpciones}
            onClick={() => {
              setMasOpciones((v) => !v)
            }}
          >
            {masOpciones ? 'Menos opciones ▴' : 'Más opciones ▾'}
          </Button>
        </div>

        {masOpciones && (
          <>
            <div className="rounded-md border border-line bg-raised p-3">
              <Checkbox
                checked={aCiegas}
                disabled={enviando}
                label="No mostrar el stock del sistema mientras se cuenta"
                description="Quien cuenta no ve cuánto debería haber. Las diferencias aparecen al terminar."
                onChange={(e) => {
                  setACiegas(e.target.checked)
                }}
              />
            </div>

            <div className="rounded-md border border-line bg-raised p-3">
              <Checkbox
                checked={conRecuento}
                disabled={enviando}
                label="Pedir que se cuente dos veces si hay mucha diferencia"
                description="El producto se vuelve a contar una vez. El primer conteo queda guardado."
                onChange={(e) => {
                  setConRecuento(e.target.checked)
                }}
              />
              {conRecuento && (
                <Field
                  className="mt-3"
                  label="A partir de qué diferencia"
                  hint="En unidades. Una diferencia menor no pide recuento."
                  error={problemaDelUmbral}
                >
                  <NumericInput
                    modo="cantidad"
                    value={umbral}
                    disabled={enviando}
                    onChange={setUmbral}
                  />
                </Field>
              )}
            </div>

            <Field label="Nota" hint="Opcional. Por ejemplo: quién cuenta.">
              <Textarea
                rows={2}
                value={notas}
                disabled={enviando}
                onChange={(e) => {
                  setNotas(e.target.value)
                }}
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  )
}
