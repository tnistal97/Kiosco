'use client'

import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Money,
  Select,
  Textarea,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import type { CategoriaDTO, ProductoDTO, ProveedorDTO } from '@/modules/products/dto'

/**
 * Alta y edicion de un producto.
 *
 * Organizado en tres secciones porque son tres permisos distintos:
 *
 *   Información   products.update        nombre, código, categoría, proveedor
 *   Venta         products.price.update  precio, alta y baja
 *   Inventario    stock.adjust           cantidad, con motivo obligatorio
 *
 * Sin permiso de precio el campo NO es un input deshabilitado: es texto. Un
 * input gris invita a intentarlo; el texto dice que ese numero no es asunto
 * de quien esta mirando. El servidor lo comprueba igual — esconder un campo
 * no impide mandar el PUT a mano.
 *
 * El ajuste de stock esta separado del resto a proposito. Antes "Agregar al
 * stock" era un campo mas del formulario de edicion, sin motivo, y se
 * guardaba con el mismo boton que una correccion de descripcion.
 */
export function DialogoProducto({
  producto,
  abierto,
  onCerrar,
  onGuardado,
  categorias,
  proveedores,
}: {
  /** null = alta. */
  producto: ProductoDTO | null
  abierto: boolean
  onCerrar: () => void
  onGuardado: () => void
  categorias: CategoriaDTO[]
  proveedores: ProveedorDTO[]
}) {
  const puedeEditarPrecio = usePermiso('products.price.update')
  const puedeAjustarStock = usePermiso('stock.adjust')
  const esAlta = producto === null

  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [activo, setActivo] = useState(true)
  const [stock, setStock] = useState('')
  const [motivoStock, setMotivoStock] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setNombre(producto?.name ?? '')
    setCodigo(producto?.barcode ?? '')
    setCategoria(String(producto?.category.id ?? categorias[0]?.id ?? ''))
    setProveedor(String(producto?.supplier?.id ?? ''))
    setDescripcion(producto?.description ?? '')
    setPrecio(producto ? String(producto.price) : '')
    setActivo(producto?.isActive ?? true)
    setStock(producto ? String(producto.totalStock) : '0')
    setMotivoStock('')
    setError(null)
    setEnviando(false)
  }, [abierto, producto, categorias])

  const precioNum = Number(precio.replace(',', '.'))
  const stockNum = Number(stock)
  const stockCambio = producto !== null && stockNum !== producto.totalStock
  const precioValido = Number.isFinite(precioNum) && precioNum > 0

  const faltaMotivo = stockCambio && motivoStock.trim().length < 3
  const valido =
    nombre.trim().length > 0 && categoria !== '' && (esAlta ? precioValido : true) && !faltaMotivo

  async function guardar() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)

    try {
      if (esAlta) {
        await apiRequest('/api/products', {
          method: 'POST',
          body: {
            name: nombre.trim(),
            barcode: codigo.trim(),
            description: descripcion.trim(),
            price: precioNum,
            categoryId: Number(categoria),
            supplierId: proveedor === '' ? null : Number(proveedor),
            totalStock: Number.isFinite(stockNum) ? Math.max(0, Math.trunc(stockNum)) : 0,
          },
          parse: () => null,
        })
      } else {
        // Solo se mandan los campos que el usuario puede tocar. El precio no
        // viaja si no tiene el permiso: asi ni siquiera puede fallar por algo
        // que no eligio.
        const cuerpo: Record<string, unknown> = {
          name: nombre.trim(),
          barcode: codigo.trim(),
          description: descripcion.trim(),
          categoryId: Number(categoria),
          supplierId: proveedor === '' ? null : Number(proveedor),
        }
        if (puedeEditarPrecio && precioValido) cuerpo.price = precioNum
        if (puedeEditarPrecio) cuerpo.isActive = activo
        if (puedeAjustarStock && stockCambio) {
          cuerpo.totalStock = Math.max(0, Math.trunc(stockNum))
          cuerpo.stockReason = motivoStock.trim()
        }

        await apiRequest(`/api/products/${producto.id}`, {
          method: 'PUT',
          body: cuerpo,
          parse: () => null,
        })
      }
      onGuardado()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar el producto.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={esAlta ? 'Nuevo producto' : 'Editar producto'}
      size="lg"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={!valido}
            onClick={() => void guardar()}
          >
            {esAlta ? 'Crear' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {error && (
          <Alert tone="danger" title="No se guardó">
            {error}
          </Alert>
        )}

        <Seccion titulo="Información">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nombre" required className="sm:col-span-2">
              <Input
                value={nombre}
                disabled={enviando}
                onChange={(e) => {
                  setNombre(e.target.value)
                }}
              />
            </Field>

            <Field label="Código de barras" hint="Vacío si el producto no tiene etiqueta.">
              <Input
                value={codigo}
                disabled={enviando}
                className="font-mono"
                onChange={(e) => {
                  setCodigo(e.target.value)
                }}
              />
            </Field>

            <Field label="Categoría" required>
              <Select
                value={categoria}
                disabled={enviando}
                onChange={(e) => {
                  setCategoria(e.target.value)
                }}
              >
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Proveedor">
              <Select
                value={proveedor}
                disabled={enviando}
                onChange={(e) => {
                  setProveedor(e.target.value)
                }}
              >
                <option value="">Sin proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Descripción" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={descripcion}
                disabled={enviando}
                onChange={(e) => {
                  setDescripcion(e.target.value)
                }}
              />
            </Field>
          </div>
        </Seccion>

        <Seccion titulo="Venta">
          {puedeEditarPrecio || esAlta ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Precio" required={esAlta}>
                <Input
                  inputMode="decimal"
                  value={precio}
                  disabled={enviando}
                  onChange={(e) => {
                    setPrecio(e.target.value)
                  }}
                />
              </Field>
              {!esAlta && (
                <div className="flex items-end">
                  <Checkbox
                    checked={activo}
                    disabled={enviando}
                    label="En venta"
                    description="Un producto dado de baja no aparece en la caja."
                    onChange={(e) => {
                      setActivo(e.target.checked)
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between rounded-lg border border-line bg-sunken px-4 py-3">
                <span className="text-sm text-ink-muted">Precio</span>
                <Money amount={producto.price} size="lg" />
              </div>
              <p className="text-xs text-ink-faint">
                Cambiar precios necesita el permiso <code>products.price.update</code>. Podés editar
                el resto de la ficha.
              </p>
            </div>
          )}
        </Seccion>

        {!esAlta && (
          <Seccion titulo="Inventario">
            {puedeAjustarStock ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="Unidades"
                    hint={`Ahora hay ${producto.totalStock}. Escribí el total, no la diferencia.`}
                  >
                    <Input
                      inputMode="numeric"
                      value={stock}
                      disabled={enviando}
                      onChange={(e) => {
                        setStock(e.target.value.replace(/[^0-9]/g, ''))
                      }}
                    />
                  </Field>
                </div>

                {stockCambio && (
                  <Field
                    label="Motivo del ajuste"
                    required
                    hint="Obligatorio. Queda en la bitácora con tu nombre."
                    error={faltaMotivo && motivoStock.length > 0 ? 'Escribí un motivo.' : null}
                  >
                    <Input
                      value={motivoStock}
                      disabled={enviando}
                      placeholder="Ej: rotura, recuento, entrada de mercadería"
                      onChange={(e) => {
                        setMotivoStock(e.target.value)
                      }}
                    />
                  </Field>
                )}
              </div>
            ) : (
              <div className="flex items-baseline justify-between rounded-lg border border-line bg-sunken px-4 py-3">
                <span className="text-sm text-ink-muted">Unidades</span>
                <span className="text-lg font-semibold text-ink" data-numeric="">
                  {producto.totalStock}
                </span>
              </div>
            )}
          </Seccion>
        )}

        {esAlta && (
          <Seccion titulo="Inventario">
            <Field label="Stock inicial" hint="Cuántas unidades entran hoy.">
              <Input
                inputMode="numeric"
                value={stock}
                disabled={enviando}
                onChange={(e) => {
                  setStock(e.target.value.replace(/[^0-9]/g, ''))
                }}
              />
            </Field>
          </Seccion>
        )}
      </div>
    </Dialog>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 border-b border-line pb-1.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">
        {titulo}
      </h3>
      {children}
    </section>
  )
}
