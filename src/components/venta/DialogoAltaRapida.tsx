'use client'

import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, Select } from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { ApiError, apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  parseCategoria,
  parseProducto,
  type CategoriaDTO,
  type ProductoDTO,
} from '@/modules/products/dto'
import { motivoDeCodigoInvalido, normalizarCodigo } from '@/modules/products/barcode'
import {
  POLITICA_DE_UNIDAD,
  UNIDADES_DE_VENTA,
  esFraccionable,
  type UnidadDeVenta,
} from '@/modules/products/units'

/**
 * Alta rapida de un producto, desde el mostrador.
 *
 * Seis campos. La lista de lo que NO pide es la decision de diseno: proveedor,
 * costo, descripcion, margen, unidad de compra, stock minimo, codigos
 * alternativos, lotes y vencimiento se completan despues desde Productos. Un
 * formulario de once campos con el cliente esperando no lo llena nadie: lo que
 * pasaria de verdad es que el cajero venda otra cosa parecida, y eso descuadra
 * el stock de dos productos a la vez.
 *
 * El MISMO componente atiende los dos caminos --el que nace de un escaneo y el
 * alta manual-- porque son la misma operacion. La unica diferencia es de donde
 * sale el codigo, y eso se resuelve con una propiedad:
 *
 *   `codigo` con valor   viene del lector. Se muestra y NO se edita: el codigo
 *                        que se guarda tiene que ser el que se leyo, o el
 *                        proximo escaneo no va a encontrar el producto.
 *   `codigo` en null     alta manual. El campo se puede escribir y se puede
 *                        dejar vacio, para el producto artesanal o el
 *                        fraccionado que no tiene etiqueta.
 *
 * Ver docs/POS_QUICK_PRODUCT_CREATE.md.
 */

/** Lo que devuelve el alta: el producto creado, listo para el ticket. */
export type ProductoCreado = ProductoDTO

export interface DialogoAltaRapidaProps {
  abierto: boolean
  /** Codigo leido por el lector. `null` = alta manual, campo editable. */
  codigo: string | null
  categorias: CategoriaDTO[]
  onCerrar: () => void
  /** El producto quedo creado. La pantalla decide que hacer con el. */
  onCreado: (producto: ProductoCreado) => void
  /**
   * Otro usuario lo creo primero. Llega el producto que ya existe para poder
   * seguir vendiendo sin volver a escanear. Si la pantalla no lo maneja, el
   * dialogo muestra el aviso y ofrece cerrar.
   */
  onYaExistia?: (producto: ProductoCreado) => void
  /** Se recargan las categorias despues de crear una. */
  onCategoriaCreada?: () => void
}

/** Stock inicial por omision. Ver el comentario de `Field` mas abajo. */
const STOCK_POR_OMISION = '1'

export function DialogoAltaRapida({
  abierto,
  codigo,
  categorias,
  onCerrar,
  onCreado,
  onYaExistia,
  onCategoriaCreada,
}: DialogoAltaRapidaProps) {
  const puedeCargarCosto = usePermiso('products.cost.update')
  const puedeCrearCategoria = usePermiso('categories.manage')

  const [nombre, setNombre] = useState('')
  const [codigoManual, setCodigoManual] = useState('')
  const [precio, setPrecio] = useState('')
  const [categoria, setCategoria] = useState('')
  const [unidad, setUnidad] = useState<UnidadDeVenta>('UNIT')
  const [stock, setStock] = useState(STOCK_POR_OMISION)
  const [costo, setCosto] = useState('')
  const [nuevaCategoria, setNuevaCategoria] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Producto que ya existia, cuando la otra caja gano la carrera. */
  const [duplicado, setDuplicado] = useState<ProductoCreado | null>(null)
  /** Creado con cero unidades: no se puede vender todavia. */
  const [sinStock, setSinStock] = useState<ProductoCreado | null>(null)

  const campoNombre = useRef<HTMLInputElement>(null)

  /**
   * Formulario en blanco al ABRIR. Depende SOLO de `abierto`.
   *
   * Tenia tambien `categorias`, y eso era un error que encontro la prueba de
   * extremo a extremo numero 15: la lista de categorias llega por la red, y
   * cuando llega cambia de identidad. Con `categorias` en las dependencias, la
   * respuesta que llegaba mientras el cajero escribia le BORRABA el nombre y el
   * precio ya tipeados, y el boton volvia a quedar deshabilitado sin motivo
   * visible. Se reproducia abriendo el dialogo rapido, apenas cargada la
   * pantalla, que es exactamente lo que pasa en una caja.
   */
  useEffect(() => {
    if (!abierto) return
    setNombre('')
    setCodigoManual('')
    setPrecio('')
    setUnidad('UNIT')
    setStock(STOCK_POR_OMISION)
    setCosto('')
    setNuevaCategoria(null)
    setError(null)
    setDuplicado(null)
    setSinStock(null)
    setEnviando(false)
  }, [abierto])

  /**
   * La categoria por omision, aparte y sin pisar una eleccion.
   *
   * Solo actua si no hay ninguna elegida: asi da lo mismo que la lista llegue
   * antes o despues de que se abra el dialogo, y elegir una a mano no se
   * deshace cuando la lista se vuelve a leer --que es lo que pasa despues de
   * crear una categoria nueva--.
   */
  useEffect(() => {
    if (!abierto || categoria !== '') return
    const primera = categorias[0]
    if (primera) setCategoria(String(primera.id))
  }, [abierto, categorias, categoria])

  // El codigo ya lo leyo el lector: el foco arranca en lo primero que hay que
  // escribir. Sin esto el cajero tiene que agarrar el mouse, que es lo que esta
  // fase viene a evitar.
  useEffect(() => {
    if (!abierto) return
    const t = setTimeout(() => campoNombre.current?.focus(), 50)
    return () => {
      clearTimeout(t)
    }
  }, [abierto])

  const elCodigo = codigo ?? normalizarCodigo(codigoManual)
  const codigoRoto = elCodigo === '' ? null : motivoDeCodigoInvalido(elCodigo)
  const politica = POLITICA_DE_UNIDAD[unidad]

  async function crearCategoria(): Promise<void> {
    const nombreCat = (nuevaCategoria ?? '').trim()
    if (nombreCat === '') return
    setError(null)
    try {
      const creada = await apiRequest('/api/categories', {
        method: 'POST',
        body: { name: nombreCat },
        parse: parseCategoria,
      })
      setCategoria(String(creada.id))
      setNuevaCategoria(null)
      onCategoriaCreada?.()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo crear la categoría.'))
    }
  }

  async function guardar(): Promise<void> {
    if (enviando) return
    setError(null)

    if (codigoRoto !== null) {
      setError(codigoRoto)
      return
    }

    setEnviando(true)
    try {
      const producto = await apiRequest('/api/products/quick', {
        method: 'POST',
        // Solo lo que el mostrador decide. La sucursal y el usuario salen de la
        // sesion, y el esquema del servidor ni siquiera los declara: mandarlos
        // hace fallar la peticion.
        body: {
          ...(elCodigo === '' ? {} : { barcode: elCodigo }),
          name: nombre.trim(),
          price: precio.trim(),
          categoryId: Number(categoria),
          saleUnit: unidad,
          initialStock: stock.trim() === '' ? '0' : stock.trim(),
          // El costo solo viaja si se cargo. Mandar una cadena vacia sin
          // permiso daria un 403 por un campo que nadie completo.
          ...(puedeCargarCosto && costo.trim() !== '' ? { cost: costo.trim() } : {}),
        },
        parse: parseProducto,
      })

      // Cero unidades: el producto existe pero no se puede vender. Se dice, en
      // vez de agregarlo al ticket y que falle al cobrar.
      if (Number(producto.totalStock) <= 0) {
        setSinStock(producto)
        setEnviando(false)
        return
      }

      onCreado(producto)
    } catch (err) {
      // El servidor ya volvio a buscar el codigo: si otro lo creo primero, el
      // producto viene en el error y se puede vender igual.
      const yaExiste = productoDelError(err)
      if (yaExiste) {
        setDuplicado(yaExiste)
      } else {
        setError(mensajeDeError(err, 'No se pudo crear el producto.'))
      }
      setEnviando(false)
    }
  }

  const completo =
    nombre.trim() !== '' && precio.trim() !== '' && categoria !== '' && codigoRoto === null

  // --- Desenlaces que no son el formulario -----------------------------------

  if (duplicado) {
    return (
      <Dialog
        open={abierto}
        onClose={onCerrar}
        title="El producto ya existe"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onCerrar}>
              Cerrar
            </Button>
            {onYaExistia && duplicado.isActive && (
              <Button
                variant="confirm"
                onClick={() => {
                  onYaExistia(duplicado)
                }}
              >
                Agregar a la venta
              </Button>
            )}
          </>
        }
      >
        <Alert tone="info" title={duplicado.name}>
          Otro usuario acaba de registrar este producto. No se creó un duplicado.
        </Alert>
      </Dialog>
    )
  }

  if (sinStock) {
    return (
      <Dialog
        open={abierto}
        onClose={onCerrar}
        title="Producto creado"
        size="sm"
        footer={
          <Button variant="primary" onClick={onCerrar}>
            Cerrar
          </Button>
        }
      >
        <Alert tone="warning" title={`${sinStock.name} quedó sin stock`}>
          Se creó correctamente, pero declaraste cero unidades y todavía no se puede vender. Cargá
          el stock desde Stock → Ajustar.
        </Alert>
      </Dialog>
    )
  }

  // --- El formulario ---------------------------------------------------------

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={codigo === null ? 'Producto nuevo' : 'Producto nuevo desde el lector'}
      description={
        codigo === null
          ? 'Lo mínimo para poder venderlo. El resto se completa después desde Productos.'
          : 'El código escaneado ya está cargado. Falta lo mínimo para venderlo.'
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="confirm" onClick={() => void guardar()} disabled={!completo || enviando}>
            {enviando ? 'Creando…' : 'Crear y agregar'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (completo) void guardar()
        }}
      >
        {error && (
          <Alert tone="danger" title="No se creó el producto">
            {error}
          </Alert>
        )}

        <Field
          label="Código de barras"
          hint={
            codigo === null
              ? 'Opcional. Un producto sin código se busca por nombre.'
              : 'El que leyó el lector. No se edita: si se cambiara, el próximo escaneo no lo encontraría.'
          }
          error={codigoRoto}
        >
          {codigo === null ? (
            <Input
              value={codigoManual}
              onChange={(e) => {
                setCodigoManual(e.target.value)
              }}
              placeholder="Sin código"
              autoComplete="off"
              className="font-mono"
            />
          ) : (
            <Input value={codigo} readOnly className="font-mono" data-codigo-fijo="" />
          )}
        </Field>

        <Field label="Nombre" required>
          <Input
            ref={campoNombre}
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value)
            }}
            maxLength={150}
            autoComplete="off"
            placeholder="Cómo aparece en el ticket"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={
              esFraccionable(unidad) ? `Precio por ${politica.nombre.toLowerCase()}` : 'Precio'
            }
            required
            hint={esFraccionable(unidad) ? `Lo que sale un ${politica.simbolo}` : undefined}
          >
            <Input
              value={precio}
              onChange={(e) => {
                setPrecio(e.target.value)
              }}
              inputMode="decimal"
              placeholder="0,00"
              data-numeric=""
            />
          </Field>

          <Field label="Unidad de venta">
            <Select
              value={unidad}
              onChange={(e) => {
                setUnidad(e.target.value as UnidadDeVenta)
              }}
            >
              {UNIDADES_DE_VENTA.map((u) => (
                <option key={u} value={u}>
                  {POLITICA_DE_UNIDAD[u].nombre}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Categoría" required>
          <div className="flex gap-2">
            <Select
              value={categoria}
              onChange={(e) => {
                setCategoria(e.target.value)
              }}
              className="flex-1"
            >
              {categorias.length === 0 && <option value="">No hay categorías</option>}
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {puedeCrearCategoria && nuevaCategoria === null && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setNuevaCategoria('')
                }}
              >
                + Nueva
              </Button>
            )}
          </div>
        </Field>

        {/* Sin permiso de categorias este bloque no existe: el cajero elige
            entre las que hay. No se inventa una "Sin categoría" automatica,
            que seria una politica de catalogo decidida por descuido. */}
        {nuevaCategoria !== null && (
          <Field label="Nombre de la categoría nueva">
            <div className="flex gap-2">
              <Input
                value={nuevaCategoria}
                onChange={(e) => {
                  setNuevaCategoria(e.target.value)
                }}
                autoFocus
                maxLength={80}
                className="flex-1"
              />
              <Button type="button" variant="secondary" onClick={() => void crearCategoria()}>
                Crear
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setNuevaCategoria(null)
                }}
              >
                Cancelar
              </Button>
            </div>
          </Field>
        )}

        {/*
          Stock inicial VISIBLE y editable, con `1` por omision.
          Se evaluo dejarlo en cero con un "tengo una unidad para vender ahora":
          se descarto porque con cero el sistema --con razon-- no deja vender, y
          el flujo volveria a terminar en el mismo callejon que vino a cerrar.
          Uno es la suposicion mas chica que permite seguir, y esta a la vista
          para que sea una declaracion y no un supuesto silencioso.
        */}
        <Field
          label={`Stock inicial (${politica.simbolo})`}
          hint="Lo que hay para vender ahora. Queda registrado como movimiento de inventario."
        >
          <Input
            value={stock}
            onChange={(e) => {
              setStock(e.target.value)
            }}
            inputMode="decimal"
            data-numeric=""
          />
        </Field>

        {puedeCargarCosto && (
          <Field label="Costo" hint="Opcional. Se puede cargar después con su motivo.">
            <Input
              value={costo}
              onChange={(e) => {
                setCosto(e.target.value)
              }}
              inputMode="decimal"
              placeholder="0,00"
              data-numeric=""
            />
          </Field>
        )}

        {/* Enter envia. El boton real vive en el pie del dialogo. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
          Crear y agregar
        </button>
      </form>
    </Dialog>
  )
}

/**
 * El producto que venia dentro de un conflicto `PRODUCT_ALREADY_EXISTS`.
 *
 * Devuelve `null` para cualquier otro error. No se compara el texto del mensaje:
 * el codigo es lo que el contrato promete que no cambia.
 */
function productoDelError(err: unknown): ProductoCreado | null {
  if (!(err instanceof ApiError) || err.code !== 'PRODUCT_ALREADY_EXISTS') return null
  const detalle: unknown = err.details
  if (typeof detalle !== 'object' || detalle === null || !('producto' in detalle)) return null
  try {
    return parseProducto(detalle.producto)
  } catch {
    return null
  }
}
