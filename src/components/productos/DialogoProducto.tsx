'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Money,
  NumericInput,
  Select,
  Textarea,
  problemaDeCantidad,
  problemaDeImporte,
} from '@/components/ui'
import { useFuncion, usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  parseCategoria,
  type CategoriaDTO,
  type ProductoDTO,
  type ProveedorDTO,
} from '@/modules/products/dto'
import { minimoSugerido } from '@/modules/inventory/minimum'
import { aMilesimas, cantidadDesdeTexto } from '@/lib/cantidad'
import { aCentavos, desdeCentavos, montoDesdeTexto, textoLocalDeMonto } from '@/lib/money'
import { REGLAS_DE_COSTO, textoLocalDeNumero, valorNumerico } from '@/lib/numero-local'
import { calcularRentabilidad, formatearPorcentaje } from '@/modules/products/margen'
import {
  formatearCantidadParaEditar,
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
import { CampoCodigoDeBarras } from './CampoCodigoDeBarras'
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
  onCategoriaCreada,
}: {
  /** null = alta. */
  producto: ProductoDTO | null
  abierto: boolean
  onCerrar: () => void
  onGuardado: () => void
  categorias: CategoriaDTO[]
  proveedores: ProveedorDTO[]
  /** Se recargan las categorias despues de crear una desde aca. */
  onCategoriaCreada?: () => void
}) {
  const puedeEditarPrecio = usePermiso('products.price.update')
  const puedeVerCosto = usePermiso('products.cost.view')
  const puedeEditarCosto = usePermiso('products.cost.update')
  const puedeCrearCategoria = usePermiso('categories.manage')
  const usaLotes = useFuncion('lotes')
  const esAlta = producto === null
  const botonGuardar = useRef<HTMLButtonElement>(null)
  /** "Más opciones": unidad, costo, mínimo, proveedor, otros códigos. */
  const [masOpciones, setMasOpciones] = useState(false)
  /** Nombre de una categoria nueva mientras se escribe; null si no se crea. */
  const [nuevaCategoria, setNuevaCategoria] = useState<string | null>(null)

  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [alternativos, setAlternativos] = useState<string[]>([])
  /**
   * Los alternativos ya se leyeron del servidor. Hasta entonces la lista vacia
   * no quiere decir "sin codigos": guardar antes mandaba [] y los borraba.
   */
  const [alternativosLeidos, setAlternativosLeidos] = useState(false)
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
    setAlternativosLeidos(producto === null)
    setCategoria(String(producto?.category.id ?? ''))
    setProveedor(String(producto?.supplier?.id ?? ''))
    setDescripcion(producto?.description ?? '')
    // Los importes se rellenan YA ESCRITOS como se escriben --"1.234,56"-- y
    // no con la cadena del cable. Mostrar "1234.56" en un campo obligaba a
    // tipear en el formato del sistema para que lo aceptara.
    setPrecio(producto ? textoLocalDeMonto(producto.price) : '')
    setCosto(
      producto?.cost === null || producto?.cost === undefined
        ? ''
        : textoLocalDeNumero(producto.cost, { decimales: 4, decimalesMinimos: 2 }),
    )
    setMotivoCosto('')
    setUnidadVenta(unidad)
    setUnidadCompra(producto?.purchaseUnit ?? 'UNIT')
    // Formateados para leer: "8", no "8.000" (auditoria, H-02). Al guardar se
    // vuelven a interpretar con `cantidadDesdeTexto`, que acepta la coma.
    setPorCompra(
      producto ? formatearCantidadParaEditar(producto.unitsPerPurchaseUnit, unidad) : '1',
    )
    setActivo(producto?.isActive ?? true)
    setStockInicial('0')
    setMinimo(
      formatearCantidadParaEditar(
        producto ? producto.minimumStock : minimoSugerido(unidad),
        unidad,
      ),
    )
    setError(null)
    setEnviando(false)
    setMasOpciones(false)
    setNuevaCategoria(null)
  }, [abierto, producto])

  // La categoria de un alta arranca en la primera de la lista. Va aparte del
  // reinicio: crear una categoria desde aca recarga la lista, y eso no tiene
  // que borrar lo que ya se escribio. Solo en un alta, y con la forma
  // funcional: corre en el mismo paso que el reinicio, y tiene que ver la
  // categoria que el reinicio acaba de poner, no la del render anterior (en
  // una edicion, eso pasaba el producto a la primera categoria).
  useEffect(() => {
    const primera = categorias[0]
    if (!abierto || producto !== null || !primera) return
    setCategoria((actual) => (actual === '' ? String(primera.id) : actual))
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
        if (!vivo) return
        setAlternativos(lista)
        setAlternativosLeidos(true)
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

  const porCompraCantidad = cantidadDesdeTexto(porCompra === '' ? '1' : porCompra)
  const precioMonto = montoDesdeTexto(precio)
  const minimoCantidad = cantidadDesdeTexto(minimo === '' ? '0' : minimo)
  const stockCantidad = cantidadDesdeTexto(stockInicial === '' ? '0' : stockInicial)

  // El costo se guarda con CUATRO decimales --sale de dividir una caja entre
  // sus unidades-- asi que se lee con la escala del costo y no con la del
  // dinero. Con dos, un costo de 1.543,125 se leia como "no es un importe" y
  // el campo se marcaba en rojo mostrando el valor que el propio sistema habia
  // guardado.
  const costoCanonico = valorNumerico(costo, REGLAS_DE_COSTO)
  const costoMonto = costoCanonico === null ? null : desdeCentavos(aCentavos(costoCanonico))

  const rentabilidad = calcularRentabilidad(precioMonto ?? '0.00', costoMonto)

  // Se compara valor con valor, no texto con texto: "1.543,125" y "1543.1250"
  // son el mismo costo escrito de dos maneras.
  const costoCambio = !esAlta && costoCanonico !== valorNumerico(producto.cost, REGLAS_DE_COSTO)
  const faltaMotivoCosto = costoCambio && motivoCosto.trim().length < 3

  const valido =
    nombre.trim().length > 0 &&
    categoria !== '' &&
    (esAlta ? precioMonto !== null : true) &&
    problemaDeImporte(precio, { permitirCero: true }) === null &&
    problemaDeImporte(costo, { permitirCero: true }) === null &&
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
            ...(puedeEditarCosto && costoCanonico !== null ? { cost: costoCanonico } : {}),
            categoryId: Number(categoria),
            supplierId: proveedor === '' ? null : Number(proveedor),
            saleUnit: unidadVenta,
            purchaseUnit: unidadCompra,
            unitsPerPurchaseUnit: porCompraCantidad ?? '1',
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
          // Sin leerlos no se mandan: el servidor deja los que ya tenia.
          ...(alternativosLeidos ? { alternateBarcodes: alternativos } : {}),
          description: descripcion.trim(),
          categoryId: Number(categoria),
          supplierId: proveedor === '' ? null : Number(proveedor),
          purchaseUnit: unidadCompra,
          unitsPerPurchaseUnit: porCompraCantidad ?? '1',
        }
        cuerpo.minimumStock = minimoCantidad
        if (puedeEditarPrecio && precioMonto !== null) cuerpo.price = precioMonto
        if (puedeEditarPrecio) cuerpo.isActive = activo
        if (puedeEditarCosto && costoCambio) {
          cuerpo.cost = costoCanonico
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
      setError(mensajeDeError(err, 'No se pudo crear la categoría. Probá con otro nombre.'))
    }
  }

  const campoPrecio =
    puedeEditarPrecio || esAlta ? (
      <Field
        label={esFraccionable(unidadVenta) ? 'Precio por kilo' : 'Precio de venta'}
        required={esAlta}
        error={problemaDeImporte(precio, { permitirCero: true })}
      >
        <NumericInput
          modo="dinero"
          placeholder="0,00"
          value={precio}
          disabled={enviando}
          onChange={setPrecio}
        />
      </Field>
    ) : (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink">Precio de venta</span>
        <div className="flex h-control items-center justify-end rounded-md border border-line bg-sunken px-3">
          <Money amount={producto.price} size="lg" />
        </div>
        <p className="text-sm text-ink-muted">Tu usuario no puede cambiar precios.</p>
      </div>
    )

  const campoStock = esAlta ? (
    <Field
      label={esFraccionable(unidadVenta) ? 'Kilos que tenés ahora' : 'Unidades que tenés ahora'}
      hint="Lo que hay hoy en el negocio. Si no sabés, dejá 0."
      error={problemaDeCantidad(stockInicial, { unidad: unidadVenta })}
    >
      <NumericInput
        modo="cantidad"
        unidad={unidadVenta}
        value={stockInicial}
        disabled={enviando}
        onChange={setStockInicial}
      />
    </Field>
  ) : (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink">Stock actual</span>
      <div
        className="flex h-control items-center justify-end rounded-md border border-line bg-sunken px-3 text-lg font-semibold text-ink"
        data-numeric=""
      >
        {formatearCantidadConUnidad(producto.totalStock, producto.saleUnit)}
      </div>
      <p className="text-sm text-ink-muted">
        Para corregirlo, usá «Ajustar» en la pantalla de Stock.
      </p>
    </div>
  )

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={esAlta ? 'Nuevo producto' : 'Editar producto'}
      size="lg"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            ref={botonGuardar}
            variant="primary"
            size="lg"
            loading={enviando}
            disabled={!valido}
            onClick={() => void guardar()}
          >
            {esAlta ? 'Guardar producto' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="No se guardó">
            {error}
          </Alert>
        )}

        {/* Lo justo para crear un producto: nombre, categoría, precio,
            cuántos hay y su código. Todo lo demás, en "Más opciones". */}
        <Field label="Nombre" required>
          <Input
            value={nombre}
            disabled={enviando}
            placeholder="Por ejemplo: Yerba mate 1 kg"
            autoFocus={esAlta}
            onChange={(e) => {
              setNombre(e.target.value)
            }}
          />
        </Field>

        <Field
          label="Categoría"
          required
          hint={categorias.length === 0 ? 'Todavía no hay categorías: creá la primera.' : undefined}
        >
          <div className="flex gap-2">
            <Select
              value={categoria}
              disabled={enviando}
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
                variant="secondary"
                disabled={enviando}
                onClick={() => {
                  setNuevaCategoria('')
                }}
              >
                + Nueva
              </Button>
            )}
          </div>
        </Field>

        {nuevaCategoria !== null && (
          <Field label="Nombre de la categoría nueva">
            <div className="flex gap-2">
              <Input
                value={nuevaCategoria}
                autoFocus
                maxLength={80}
                className="flex-1"
                onChange={(e) => {
                  setNuevaCategoria(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void crearCategoria()
                  }
                }}
              />
              <Button variant="secondary" onClick={() => void crearCategoria()}>
                Crear
              </Button>
              <Button
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

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {campoPrecio}
          {campoStock}
        </div>

        <CampoCodigoDeBarras
          value={codigo}
          onChange={setCodigo}
          productoId={producto?.id ?? null}
          deshabilitado={enviando}
          onConfirmado={() => {
            requestAnimationFrame(() => {
              botonGuardar.current?.focus()
            })
          }}
        />

        {!esAlta && puedeEditarPrecio && (
          <Checkbox
            checked={activo}
            disabled={enviando}
            label="En venta"
            description="Si lo sacás de venta, deja de aparecer en Vender."
            onChange={(e) => {
              setActivo(e.target.checked)
            }}
          />
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
          <div className="flex flex-col gap-6">
            <Seccion titulo="Cómo se vende">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Se vende por"
                  hint={
                    esAlta
                      ? 'Por unidad, o por peso si se pesa en la balanza.'
                      : 'No se puede cambiar si el producto ya tiene ventas o movimientos.'
                  }
                >
                  <Select
                    value={unidadVenta}
                    disabled={enviando}
                    onChange={(e) => {
                      const u = e.target.value as UnidadDeVenta
                      setUnidadVenta(u)
                      if (esAlta) setMinimo(formatearCantidadParaEditar(minimoSugerido(u), u))
                    }}
                  >
                    {UNIDADES_DE_VENTA.map((u) => (
                      <option key={u} value={u}>
                        {POLITICA_DE_UNIDAD[u].nombre} ({POLITICA_DE_UNIDAD[u].simbolo})
                      </option>
                    ))}
                  </Select>
                </Field>
                <CampoMinimo
                  valor={minimo}
                  onCambio={setMinimo}
                  deshabilitado={enviando}
                  unidad={unidadVenta}
                  stock={producto?.totalStock ?? stockInicial}
                />
              </div>
            </Seccion>

            <Seccion titulo="Costo">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {puedeVerCosto ? (
                  <>
                    <Field
                      label="Costo"
                      hint={
                        puedeEditarCosto
                          ? 'Lo que te cuesta a vos. Vacío si no lo sabés.'
                          : 'Tu usuario no puede cambiar el costo.'
                      }
                      error={problemaDeImporte(costo, { permitirCero: true })}
                    >
                      <NumericInput
                        modo="costo"
                        value={costo}
                        disabled={enviando || !puedeEditarCosto}
                        onChange={setCosto}
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
                      <Linea etiqueta="Recargo sobre el costo">
                        {formatearPorcentaje(rentabilidad.markup)}
                      </Linea>
                      {rentabilidad.bajoCosto && (
                        <p className="text-sm font-semibold text-danger">
                          ✕ Se vende por debajo del costo.
                        </p>
                      )}
                    </div>

                    {costoCambio && (
                      <Field
                        label="¿Por qué cambia el costo?"
                        required
                        className="sm:col-span-2"
                        hint="Queda guardado en el historial de costos."
                        error={
                          faltaMotivoCosto && motivoCosto.length > 0 ? 'Escribí un motivo.' : null
                        }
                      >
                        <Input
                          value={motivoCosto}
                          disabled={enviando}
                          placeholder="Por ejemplo: aumento del proveedor"
                          onChange={(e) => {
                            setMotivoCosto(e.target.value)
                          }}
                        />
                      </Field>
                    )}

                    <Field label="Viene en" hint="Cómo te lo trae el proveedor.">
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
                      label={`${politicaVenta.simbolo} por ${NOMBRE_DE_UNIDAD_DE_COMPRA[unidadCompra].toLowerCase()}`}
                      error={problemaDeCantidad(porCompra, { permitirCero: false })}
                    >
                      <NumericInput
                        modo="cantidad"
                        value={porCompra}
                        disabled={enviando}
                        onChange={setPorCompra}
                      />
                    </Field>
                  </>
                ) : (
                  <p className="text-sm text-ink-muted sm:col-span-2">
                    Tu usuario no puede ver costos.
                  </p>
                )}
              </div>
            </Seccion>

            <Seccion titulo="Otros datos">
              <div className="grid grid-cols-1 gap-4">
                {proveedores.length > 0 && (
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
                )}
                <Field label="Descripción">
                  <Textarea
                    rows={2}
                    value={descripcion}
                    disabled={enviando}
                    onChange={(e) => {
                      setDescripcion(e.target.value)
                    }}
                  />
                </Field>
                <CodigosDeBarras
                  principal={codigo}
                  alternativos={alternativos}
                  deshabilitado={enviando}
                  onPrincipal={setCodigo}
                  onAlternativos={setAlternativos}
                  soloAlternativos
                />
              </div>
            </Seccion>

            {/*
              Lotes SOLO al editar, con su propio boton, y solo si la
              instalacion usa lotes (`KIOSCO_FUNCIONES=lotes`).
            */}
            {!esAlta && usaLotes && (
              <Seccion titulo="Lotes y vencimientos">
                <Trazabilidad productId={producto.id} deshabilitado={enviando} />
              </Seccion>
            )}

            {!esAlta && <ActividadReciente productId={producto.id} abierto={abierto} />}
          </div>
        )}
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
      label={`Avisar cuando queden (${politicaDe(unidad).simbolo})`}
      error={problemaDeCantidad(valor, { unidad })}
      hint={
        minimo <= 0
          ? 'Con 0 no avisa nunca que queda poco.'
          : hay > 0 && hay <= minimo
            ? 'Con lo que hay hoy ya figura como «Stock bajo».'
            : 'Cuando quede esta cantidad o menos, figura como «Stock bajo».'
      }
    >
      <NumericInput
        modo="cantidad"
        unidad={unidad}
        value={valor}
        disabled={deshabilitado}
        onChange={onCambio}
      />
    </Field>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 border-b border-line pb-1.5 text-base font-semibold text-ink">
        {titulo}
      </h3>
      {children}
    </section>
  )
}
