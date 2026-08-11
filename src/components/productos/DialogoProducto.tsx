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
import { minimoSugerido } from '@/modules/inventory/minimum'
import { aMilesimas, cantidadDesdeTexto } from '@/lib/cantidad'
import { montoDesdeTexto } from '@/lib/money'
import { calcularRentabilidad, formatearPorcentaje } from '@/modules/products/margen'
import {
  NOMBRE_DE_UNIDAD_DE_COMPRA,
  POLITICA_DE_UNIDAD,
  UNIDADES_DE_COMPRA,
  UNIDADES_DE_VENTA,
  esFraccionable,
  formatearCantidadConUnidad,
  politicaDe,
  type UnidadDeCompra,
  type UnidadDeVenta,
} from '@/modules/products/units'
import { ActividadReciente } from './ActividadReciente'
import { CodigosDeBarras } from './CodigosDeBarras'
import { Trazabilidad } from './Trazabilidad'

/**
 * Alta y edicion de un producto.
 *
 * Cinco secciones, y cada una responde una pregunta distinta:
 *
 *   Información     que es                nombre, categoria, estado, descripcion
 *   Identificación  como se lo encuentra  codigo principal y alternativos
 *   Venta           como se lo cobra      unidad de venta y precio
 *   Compra / costo  cuanto cuesta         unidad de compra, factor, costo, margen
 *   Inventario      cuanto hay            stock (solo lectura) y minimo
 *
 * **El stock actual NO se edita aca.** Cambio de la Fase 3B: antes "Unidades"
 * era un campo mas del formulario y se guardaba con el mismo boton que una
 * correccion de descripcion. Un movimiento de inventario es una operacion con
 * su motivo, su tipo y su fila en el libro, y ahora se hace donde corresponde:
 * el boton "Ajustar" de la pantalla de stock. Lo unico que se carga aca es el
 * stock INICIAL, y solo al dar de alta, porque ahi no hay ajuste: hay un
 * producto que nace.
 *
 * Sin permiso de precio el campo NO es un input deshabilitado: es texto. Un
 * input gris invita a intentarlo; el texto dice que ese numero no es asunto de
 * quien esta mirando. Con el costo pasa lo mismo, y ademas ni siquiera llega al
 * navegador: el servidor no lo manda. Ver docs/PERMISSIONS_MATRIX.md.
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
  const puedeVerCosto = usePermiso('products.cost.view')
  const puedeEditarCosto = usePermiso('products.cost.update')
  const esAlta = producto === null

  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [alternativos, setAlternativos] = useState<string[]>([])
  const [categoria, setCategoria] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precio, setPrecio] = useState('')
  const [costo, setCosto] = useState('')
  const [motivoCosto, setMotivoCosto] = useState('')
  const [unidadVenta, setUnidadVenta] = useState<UnidadDeVenta>('UNIT')
  const [unidadCompra, setUnidadCompra] = useState<UnidadDeCompra>('UNIT')
  const [porCompra, setPorCompra] = useState('1')
  const [activo, setActivo] = useState(true)
  const [stockInicial, setStockInicial] = useState('0')
  const [minimo, setMinimo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    const unidad = producto?.saleUnit ?? 'UNIT'
    setNombre(producto?.name ?? '')
    setCodigo(producto?.barcode ?? '')
    setAlternativos([])
    setCategoria(String(producto?.category.id ?? categorias[0]?.id ?? ''))
    setProveedor(String(producto?.supplier?.id ?? ''))
    setDescripcion(producto?.description ?? '')
    setPrecio(producto ? String(producto.price) : '')
    setCosto(producto?.cost ?? '')
    setMotivoCosto('')
    setUnidadVenta(unidad)
    setUnidadCompra(producto?.purchaseUnit ?? 'UNIT')
    setPorCompra(producto?.unitsPerPurchaseUnit ?? '1')
    setActivo(producto?.isActive ?? true)
    setStockInicial('0')
    setMinimo(producto ? producto.minimumStock : minimoSugerido(unidad))
    setError(null)
    setEnviando(false)
  }, [abierto, producto, categorias])

  // Al abrir la ficha de un producto que ya existe se traen sus codigos
  // alternativos, que el listado no manda: la caja pide hasta cien productos
  // por peticion y no los necesita.
  useEffect(() => {
    if (!abierto || producto === null) return
    let vivo = true
    void apiRequest(`/api/products/${producto.id}`, {
      parse: (raw): string[] => {
        if (typeof raw !== 'object' || raw === null) return []
        const lista = (raw as { alternateBarcodes?: unknown }).alternateBarcodes
        return Array.isArray(lista) ? lista.filter((c): c is string => typeof c === 'string') : []
      },
    })
      .then((lista) => {
        if (vivo) setAlternativos(lista)
      })
      .catch(() => {
        // Sin los alternativos la ficha sigue siendo utilizable. No se manda
        // `alternateBarcodes` en el PUT si no se pudieron leer, asi que un
        // fallo aca no los borra.
      })
    return () => {
      vivo = false
    }
  }, [abierto, producto])

  const precioMonto = montoDesdeTexto(precio)
  const costoMonto = costo.trim() === '' ? null : montoDesdeTexto(costo)
  const minimoCantidad = cantidadDesdeTexto(minimo === '' ? '0' : minimo)
  const stockCantidad = cantidadDesdeTexto(stockInicial === '' ? '0' : stockInicial)

  const rentabilidad = calcularRentabilidad(precioMonto ?? '0.00', costoMonto)

  const costoCambio = !esAlta && (producto.cost ?? '') !== costo.trim()
  const faltaMotivoCosto = costoCambio && motivoCosto.trim().length < 3

  const valido =
    nombre.trim().length > 0 &&
    categoria !== '' &&
    (esAlta ? precioMonto !== null : true) &&
    // Las dos cantidades tienen que parsear. Se puede llegar a `null` tipeando
    // "1.2.3": el campo filtra los caracteres, no la forma.
    minimoCantidad !== null &&
    stockCantidad !== null &&
    !faltaMotivoCosto

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
            alternateBarcodes: alternativos,
            description: descripcion.trim(),
            price: precioMonto,
            ...(puedeEditarCosto && costoMonto !== null ? { cost: costoMonto } : {}),
            categoryId: Number(categoria),
            supplierId: proveedor === '' ? null : Number(proveedor),
            saleUnit: unidadVenta,
            purchaseUnit: unidadCompra,
            unitsPerPurchaseUnit: porCompra === '' ? '1' : porCompra.replace(',', '.'),
            totalStock: stockCantidad,
            minimumStock: minimoCantidad,
          },
          parse: () => null,
        })
      } else {
        // Solo se mandan los campos que el usuario puede tocar. El precio y el
        // costo no viajan si no tiene el permiso: asi ni siquiera pueden fallar
        // por algo que no eligio.
        const cuerpo: Record<string, unknown> = {
          name: nombre.trim(),
          barcode: codigo.trim(),
          alternateBarcodes: alternativos,
          description: descripcion.trim(),
          categoryId: Number(categoria),
          supplierId: proveedor === '' ? null : Number(proveedor),
          purchaseUnit: unidadCompra,
          unitsPerPurchaseUnit: porCompra === '' ? '1' : porCompra.replace(',', '.'),
        }
        cuerpo.minimumStock = minimoCantidad
        if (puedeEditarPrecio && precioMonto !== null) cuerpo.price = precioMonto
        if (puedeEditarPrecio) cuerpo.isActive = activo
        if (puedeEditarCosto && costoCambio) {
          cuerpo.cost = costoMonto
          cuerpo.costReason = motivoCosto.trim()
        }
        // La unidad de venta solo viaja si el producto todavia no tiene
        // historial. El servidor lo rechaza igual --y la base tambien-- pero
        // mandarla siempre haria fallar cualquier edicion de un producto viejo.
        if (unidadVenta !== producto.saleUnit) cuerpo.saleUnit = unidadVenta

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

  const politicaVenta = politicaDe(unidadVenta)

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

            {!esAlta && puedeEditarPrecio && (
              <div className="flex items-end sm:col-span-2">
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

        <Seccion titulo="Identificación">
          <CodigosDeBarras
            principal={codigo}
            alternativos={alternativos}
            deshabilitado={enviando}
            onPrincipal={setCodigo}
            onAlternativos={setAlternativos}
          />
        </Seccion>

        <Seccion titulo="Venta">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Unidad de venta"
              hint={
                esAlta
                  ? 'Cómo se cobra: por unidad o por peso.'
                  : 'No se puede cambiar si el producto ya tiene movimientos.'
              }
            >
              <Select
                value={unidadVenta}
                disabled={enviando}
                onChange={(e) => {
                  const u = e.target.value as UnidadDeVenta
                  setUnidadVenta(u)
                  if (esAlta) setMinimo(minimoSugerido(u))
                }}
              >
                {UNIDADES_DE_VENTA.map((u) => (
                  <option key={u} value={u}>
                    {POLITICA_DE_UNIDAD[u].nombre} ({POLITICA_DE_UNIDAD[u].simbolo})
                  </option>
                ))}
              </Select>
            </Field>

            {puedeEditarPrecio || esAlta ? (
              <Field
                label={`Precio por ${politicaVenta.simbolo}`}
                required={esAlta}
                hint={esFraccionable(unidadVenta) ? 'Lo que sale un kilo entero.' : undefined}
              >
                <Input
                  inputMode="decimal"
                  value={precio}
                  disabled={enviando}
                  onChange={(e) => {
                    setPrecio(e.target.value)
                  }}
                />
              </Field>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between rounded-lg border border-line bg-sunken px-4 py-3">
                  <span className="text-sm text-ink-muted">Precio</span>
                  <Money amount={producto.price} size="lg" />
                </div>
                <p className="text-xs text-ink-faint">
                  Cambiar precios necesita el permiso <code>products.price.update</code>.
                </p>
              </div>
            )}
          </div>
        </Seccion>

        <Seccion titulo="Compra y costo">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Unidad de compra" hint="Cómo llega del proveedor.">
              <Select
                value={unidadCompra}
                disabled={enviando}
                onChange={(e) => {
                  setUnidadCompra(e.target.value as UnidadDeCompra)
                }}
              >
                {UNIDADES_DE_COMPRA.map((u) => (
                  <option key={u} value={u}>
                    {NOMBRE_DE_UNIDAD_DE_COMPRA[u]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Unidades por compra"
              hint={`Cuántos ${politicaVenta.simbolo} trae una ${NOMBRE_DE_UNIDAD_DE_COMPRA[unidadCompra].toLowerCase()}.`}
            >
              <Input
                inputMode="decimal"
                value={porCompra}
                disabled={enviando}
                onChange={(e) => {
                  setPorCompra(e.target.value.replace(/[^0-9.,]/g, ''))
                }}
              />
            </Field>

            {puedeVerCosto ? (
              <>
                <Field
                  label="Costo"
                  hint={
                    puedeEditarCosto
                      ? 'Vacío si no se sabe. No poner el precio: sería un margen falso.'
                      : `Necesita el permiso products.cost.update para cambiarlo.`
                  }
                >
                  <Input
                    inputMode="decimal"
                    value={costo}
                    disabled={enviando || !puedeEditarCosto}
                    onChange={(e) => {
                      setCosto(e.target.value)
                    }}
                  />
                </Field>

                <div className="flex flex-col justify-end gap-1 text-sm">
                  <Linea etiqueta="Ganancia">
                    {rentabilidad.ganancia === null ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      <Money amount={rentabilidad.ganancia} size="sm" />
                    )}
                  </Linea>
                  <Linea etiqueta="Margen">{formatearPorcentaje(rentabilidad.margen)}</Linea>
                  <Linea etiqueta="Markup">{formatearPorcentaje(rentabilidad.markup)}</Linea>
                  {rentabilidad.bajoCosto && (
                    <p className="text-xs text-danger">Se vende por debajo del costo.</p>
                  )}
                </div>

                {costoCambio && (
                  <Field
                    label="Motivo del cambio de costo"
                    required
                    className="sm:col-span-2"
                    hint="Obligatorio. Queda en el historial de costos, que no se puede editar."
                    error={faltaMotivoCosto && motivoCosto.length > 0 ? 'Escribí un motivo.' : null}
                  >
                    <Input
                      value={motivoCosto}
                      disabled={enviando}
                      placeholder="Ej: aumento del proveedor, lista de mayo"
                      onChange={(e) => {
                        setMotivoCosto(e.target.value)
                      }}
                    />
                  </Field>
                )}
              </>
            ) : (
              <p className="text-xs text-ink-faint sm:col-span-2">
                El costo y el margen necesitan el permiso <code>products.cost.view</code>.
              </p>
            )}
          </div>
        </Seccion>

        <Seccion titulo="Inventario">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {esAlta ? (
              <Field
                label={`Stock inicial (${politicaVenta.simbolo})`}
                hint="Cuánto entra hoy. Queda como movimiento inicial del libro."
              >
                <Input
                  inputMode={esFraccionable(unidadVenta) ? 'decimal' : 'numeric'}
                  value={stockInicial}
                  disabled={enviando}
                  onChange={(e) => {
                    const permitido = esFraccionable(unidadVenta) ? /[^0-9.,]/g : /[^0-9]/g
                    setStockInicial(e.target.value.replace(permitido, ''))
                  }}
                />
              </Field>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between rounded-lg border border-line bg-sunken px-4 py-3">
                  <span className="text-sm text-ink-muted">Stock actual</span>
                  <span className="text-lg font-semibold text-ink" data-numeric="">
                    {formatearCantidadConUnidad(producto.totalStock, producto.saleUnit)}
                  </span>
                </div>
                <p className="text-xs text-ink-faint">
                  El stock no se edita acá: se mueve con el botón <strong>Ajustar</strong> de la
                  pantalla de stock, que pide motivo y deja la operación en el libro.
                </p>
              </div>
            )}

            <CampoMinimo
              valor={minimo}
              onCambio={setMinimo}
              deshabilitado={enviando}
              unidad={unidadVenta}
              stock={producto?.totalStock ?? stockInicial}
            />
          </div>
        </Seccion>

        {/*
          Trazabilidad SOLO al editar, y con su propio botón.

          No al dar de alta porque un producto que todavía no existe no tiene
          stock que repartir ni id al que colgarle partidas. Y con botón propio
          porque cambiar la política NO es un campo más del formulario: activar
          lotes obligatorios sobre un producto con stock exige antes decir de
          qué partida es cada unidad, y eso es una operación con su motivo y su
          fila en el libro de atribuciones.
        */}
        {!esAlta && (
          <Seccion titulo="Trazabilidad">
            <Trazabilidad productId={producto.id} deshabilitado={enviando} />
          </Seccion>
        )}

        {!esAlta && <ActividadReciente productId={producto.id} abierto={abierto} />}
      </div>
    </Dialog>
  )
}

function Linea({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-muted">{etiqueta}</span>
      <span className="font-medium text-ink" data-numeric="">
        {children}
      </span>
    </div>
  )
}

/**
 * Mínimo de reposición.
 *
 * Cero significa SIN MÍNIMO, y el campo lo dice con todas las letras en vez de
 * dejar que se lea como "el mínimo es cero unidades". Es la diferencia entre
 * "no hace falta reponer nunca" y "nadie configuró esto todavía", y de esa
 * diferencia depende que el aviso de stock bajo signifique algo.
 */
function CampoMinimo({
  valor,
  onCambio,
  deshabilitado,
  unidad,
  stock,
}: {
  valor: string
  onCambio: (v: string) => void
  deshabilitado: boolean
  unidad: UnidadDeVenta
  stock: string
}) {
  const cantidad = cantidadDesdeTexto(valor === '' ? '0' : valor)
  const minimo = cantidad === null ? 0 : aMilesimas(cantidad)
  const hay = aMilesimas(cantidadDesdeTexto(stock === '' ? '0' : stock) ?? '0.000')

  return (
    <Field
      label={`Mínimo de reposición (${politicaDe(unidad).simbolo})`}
      hint={
        minimo <= 0
          ? 'Cero: sin mínimo. No va a avisar cuando quede poco.'
          : hay > 0 && hay <= minimo
            ? 'Con el stock actual ya está bajo mínimo.'
            : 'Avisa cuando quede esta cantidad o menos.'
      }
    >
      <Input
        inputMode={esFraccionable(unidad) ? 'decimal' : 'numeric'}
        value={valor}
        disabled={deshabilitado}
        onChange={(e) => {
          const permitido = esFraccionable(unidad) ? /[^0-9.,]/g : /[^0-9]/g
          onCambio(e.target.value.replace(permitido, ''))
        }}
      />
    </Field>
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
