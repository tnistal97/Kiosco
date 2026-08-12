'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  IconButton,
  Input,
  Money,
  SearchInput,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  Textarea,
  aviso,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { DialogoAltaRapida } from '@/components/venta/DialogoAltaRapida'
import { parseCategorias, type CategoriaDTO } from '@/modules/products/dto'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaProveedores, type ProveedorDTO } from '@/modules/suppliers/dto'
import { parseDetalleOrden } from '@/modules/purchases/dto'
import { parsePaginaProductos, type ProductoDTO } from '@/modules/products/dto'
import { montoDesdeTexto, sumarMontos, type Monto } from '@/lib/money'
import { cantidadDesdeTexto, type TextoCantidad } from '@/lib/cantidad'
import {
  costoDeStockAproximado,
  descripcionDeConversion,
  motivoDeConversionInvalida,
  subtotalDeLinea,
} from '@/modules/purchases/conversion'
import {
  NOMBRE_DE_UNIDAD_DE_COMPRA,
  UNIDADES_DE_COMPRA,
  formatearCantidadConUnidad,
  type UnidadDeCompra,
} from '@/modules/products/units'

const ESPERA_MS = 250

interface Linea {
  producto: ProductoDTO
  cantidad: string
  purchaseUnit: UnidadDeCompra
  unitsPerPurchaseUnit: string
  costo: string
}

/**
 * Nueva compra.
 *
 * La busqueda de productos reutiliza el patron del punto de venta: se pide al
 * servidor con lo que se tipeo, no se descarga el catalogo. Con diez mil
 * productos, traerlos todos para filtrar en memoria es exactamente lo que la
 * Fase 1 vino a sacar.
 *
 * Los importes que se ven mientras se tipea son una PREVISUALIZACION. El
 * subtotal y el total que quedan guardados los recalcula el servidor.
 * Ver docs/PURCHASE_FLOW.md.
 */
export default function NuevaCompraPage() {
  const router = useRouter()

  const [proveedores, setProveedores] = useState<ProveedorDTO[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ProductoDTO[]>([])
  const [buscando, setBuscando] = useState(false)

  // El MISMO dialogo que usa la caja. Item 20 del pedido: una sola
  // implementacion. Aca el codigo va siempre en null --nadie escanea armando una
  // orden-- asi que el campo queda editable y se puede dejar vacio.
  const puedeCrearProducto = usePermiso('products.quickCreate')
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [categorias, setCategorias] = useState<CategoriaDTO[]>([])

  const cargarCategorias = useCallback(() => {
    apiRequest('/api/categories', { parse: parseCategorias })
      .then(setCategorias)
      .catch(() => {
        setCategorias([])
      })
  }, [])

  useEffect(() => {
    if (puedeCrearProducto) cargarCategorias()
  }, [puedeCrearProducto, cargarCategorias])

  useEffect(() => {
    // Solo los ACTIVOS: a uno dado de baja no se le puede comprar, y ofrecerlo
    // para que el servidor lo rechace despues es hacerle perder el tiempo a
    // quien esta cargando.
    apiRequest('/api/suppliers?activos=true&pageSize=100', { parse: parsePaginaProveedores })
      .then((r) => {
        setProveedores(r.data)
      })
      .catch(() => {
        setProveedores([])
      })
  }, [])

  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const termino = busqueda.trim()
    if (temporizador.current) clearTimeout(temporizador.current)
    if (termino.length < 2) {
      setResultados([])
      return
    }
    temporizador.current = setTimeout(() => {
      setBuscando(true)
      apiRequest(`/api/products?q=${encodeURIComponent(termino)}&pageSize=10&activos=true`, {
        parse: parsePaginaProductos,
      })
        .then((r) => {
          setResultados(r.data)
        })
        .catch(() => {
          setResultados([])
        })
        .finally(() => {
          setBuscando(false)
        })
    }, ESPERA_MS)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [busqueda])

  const agregar = useCallback((p: ProductoDTO) => {
    setLineas((actuales) => {
      if (actuales.some((l) => l.producto.id === p.id)) {
        aviso.error(`${p.name} ya está en la orden`)
        return actuales
      }
      return [
        ...actuales,
        {
          producto: p,
          cantidad: '1',
          // La unidad y el factor salen del producto. Se pueden cambiar --
          // comprar por caja una semana y por unidad la otra es real-- y la
          // linea los congela.
          purchaseUnit: p.purchaseUnit,
          unitsPerPurchaseUnit: p.unitsPerPurchaseUnit,
          costo: '',
        },
      ]
    })
    setBusqueda('')
    setResultados([])
  }, [])

  function actualizar(id: number, cambio: Partial<Linea>) {
    setLineas((ls) => ls.map((l) => (l.producto.id === id ? { ...l, ...cambio } : l)))
  }

  function quitar(id: number) {
    setLineas((ls) => ls.filter((l) => l.producto.id !== id))
  }

  /** Lo que se puede calcular de una linea, o el motivo por el que no. */
  function evaluar(l: Linea): {
    cantidad: TextoCantidad | null
    costo: Monto | null
    subtotal: Monto | null
    conversion: string
    motivo: string | null
  } {
    const cantidad = cantidadDesdeTexto(l.cantidad)
    const costo = montoDesdeTexto(l.costo)
    const factor = cantidadDesdeTexto(l.unitsPerPurchaseUnit)

    if (cantidad === null || factor === null) {
      return { cantidad: null, costo, subtotal: null, conversion: '', motivo: null }
    }

    const motivo = motivoDeConversionInvalida(l.producto.saleUnit, l.purchaseUnit, cantidad, factor)

    return {
      cantidad,
      costo,
      subtotal: costo === null || motivo !== null ? null : subtotalDeLinea(cantidad, costo),
      conversion:
        motivo !== null
          ? ''
          : descripcionDeConversion(l.producto.saleUnit, l.purchaseUnit, cantidad, factor),
      motivo,
    }
  }

  const evaluadas = lineas.map((l) => ({ linea: l, ...evaluar(l) }))
  const total = sumarMontos(
    ...evaluadas.map((e) => e.subtotal).filter((s): s is Monto => s !== null),
  )
  const hayProblemas = evaluadas.some((e) => e.motivo !== null)
  const completas = evaluadas.every((e) => e.cantidad !== null && e.costo !== null)
  const valido = supplierId !== '' && lineas.length > 0 && completas && !hayProblemas

  async function guardar(confirmar: boolean) {
    if (enviando || supplierId === '') return
    if (confirmar && !valido) return
    setEnviando(true)
    setError(null)
    try {
      const orden = await apiRequest('/api/purchases', {
        method: 'POST',
        body: {
          supplierId: Number(supplierId),
          notes: notas.trim(),
          items: evaluadas
            .filter((e) => e.cantidad !== null && e.costo !== null)
            .map((e) => ({
              productId: e.linea.producto.id,
              quantity: e.cantidad,
              unitCost: e.costo,
              purchaseUnit: e.linea.purchaseUnit,
              unitsPerPurchaseUnit: cantidadDesdeTexto(e.linea.unitsPerPurchaseUnit) ?? '1',
            })),
        },
        parse: parseDetalleOrden,
      })

      if (confirmar) {
        await apiRequest(`/api/purchases/${String(orden.id)}/confirm`, {
          method: 'POST',
          parse: () => null,
        })
      }

      aviso.ok(confirmar ? `Orden ${orden.number} confirmada` : `Borrador ${orden.number} guardado`)
      router.push(`/compras/${String(orden.id)}`)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar la orden.'))
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link href="/compras" className="text-sm text-ink-muted hover:text-ink">
          ← Compras
        </Link>
        {/* `h2`: el `h1` de la pagina lo pone la cabecera, que dice "Órdenes". */}
        <h2 className="mt-1 text-xl font-semibold text-ink">Nueva compra</h2>
      </header>

      {error !== null && (
        <Alert tone="danger" title="No se guardó">
          {error}
        </Alert>
      )}

      <Card className="p-4">
        <CardHeader title="Proveedor" />

        {/* Dead end de la Fase 5A.1: sin proveedores activos el selector queda
            con un solo renglón que no se puede elegir y el botón deshabilitado,
            sin decir por qué. Pasa la primera vez que alguien abre esta
            pantalla, que es justo cuando menos se sabe qué falta. */}
        {proveedores.length === 0 && (
          <Alert tone="info" title="No hay proveedores activos">
            Una orden de compra necesita a quién comprarle.{' '}
            <Link href="/proveedores" className="underline">
              Cargá un proveedor
            </Link>{' '}
            y volvé.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="A quién se le compra" required>
            <Select
              value={supplierId}
              disabled={enviando}
              onChange={(e) => {
                setSupplierId(e.target.value)
              }}
            >
              <option value="">Elegí un proveedor…</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Notas" hint="Condiciones, plazo de entrega, lo que haga falta">
            <Textarea
              rows={2}
              value={notas}
              disabled={enviando}
              onChange={(e) => {
                setNotas(e.target.value)
              }}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-4">
        <CardHeader title="Productos" description="Buscá por nombre o código." />

        <SearchInput
          label="Buscar productos para agregar"
          value={busqueda}
          loading={buscando}
          placeholder="Nombre o código de barras"
          onChange={(e) => {
            setBusqueda(e.target.value)
          }}
          onClear={() => {
            setBusqueda('')
          }}
        />

        {busqueda.trim().length >= 2 && (
          <div className="mt-2 rounded-md border border-line bg-sunken">
            {buscando && <p className="px-3 py-2 text-sm text-ink-faint">Buscando…</p>}
            {/* Dead end de la Fase 5A.1: antes esto era el final del camino.
                Quien arma la orden tiene delante la lista del proveedor con un
                producto que todavia no esta en el catalogo, y la unica salida
                era irse a Productos --perdiendo el borrador-- y volver. */}
            {!buscando && resultados.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <p className="text-sm text-ink-faint">Ningún producto coincide.</p>
                {puedeCrearProducto && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setAltaAbierta(true)
                    }}
                  >
                    Crear producto
                  </Button>
                )}
              </div>
            )}
            {resultados.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex min-h-touch w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-raised"
                onClick={() => {
                  agregar(p)
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{p.name}</span>
                  <span className="block text-xs text-ink-faint" data-numeric="">
                    {p.barcode ?? 'sin código'} · {NOMBRE_DE_UNIDAD_DE_COMPRA[p.purchaseUnit]} de{' '}
                    {p.unitsPerPurchaseUnit}
                  </span>
                </span>
                <span className="text-sm text-primary">Agregar</span>
              </button>
            ))}
          </div>
        )}

        {lineas.length === 0 ? (
          <EmptyState
            className="mt-4"
            title="Sin productos"
            description="Un borrador puede guardarse vacío y completarse después."
          />
        ) : (
          <TableWrap className="mt-4">
            <Table>
              <THead>
                <TR>
                  <TH>Producto</TH>
                  <TH className="w-28">Cantidad</TH>
                  <TH className="w-32">Unidad</TH>
                  <TH className="w-24">Contiene</TH>
                  <TH className="w-32">Costo</TH>
                  <TH className="w-32 text-right">Subtotal</TH>
                  <TH className="w-10" />
                </TR>
              </THead>
              <TBody>
                {evaluadas.map((e) => (
                  <TR key={e.linea.producto.id}>
                    <TD>
                      <div className="text-ink">{e.linea.producto.name}</div>
                      {e.conversion !== '' && (
                        <div className="text-xs text-ink-faint" data-numeric="">
                          {e.conversion}
                        </div>
                      )}
                      {e.motivo !== null && (
                        <div className="text-xs font-medium text-danger">{e.motivo}</div>
                      )}
                      {e.costo !== null && e.cantidad !== null && e.motivo === null && (
                        <div className="text-xs text-ink-faint" data-numeric="">
                          Sale{' '}
                          {costoDeStockAproximado(
                            e.costo,
                            cantidadDesdeTexto(e.linea.unitsPerPurchaseUnit) ?? '1',
                          )}{' '}
                          por {formatearCantidadConUnidad('1.000', e.linea.producto.saleUnit)}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Input
                        inputMode="decimal"
                        aria-label={`Cantidad de ${e.linea.producto.name}`}
                        value={e.linea.cantidad}
                        disabled={enviando}
                        onChange={(ev) => {
                          actualizar(e.linea.producto.id, {
                            cantidad: ev.target.value.replace(/[^0-9.,]/g, ''),
                          })
                        }}
                      />
                    </TD>
                    <TD>
                      <Select
                        aria-label={`Unidad de compra de ${e.linea.producto.name}`}
                        value={e.linea.purchaseUnit}
                        disabled={enviando}
                        onChange={(ev) => {
                          actualizar(e.linea.producto.id, {
                            purchaseUnit: ev.target.value as UnidadDeCompra,
                          })
                        }}
                      >
                        {UNIDADES_DE_COMPRA.map((u) => (
                          <option key={u} value={u}>
                            {NOMBRE_DE_UNIDAD_DE_COMPRA[u]}
                          </option>
                        ))}
                      </Select>
                    </TD>
                    <TD>
                      <Input
                        inputMode="decimal"
                        aria-label={`Unidades por unidad de compra de ${e.linea.producto.name}`}
                        value={e.linea.unitsPerPurchaseUnit}
                        disabled={enviando}
                        onChange={(ev) => {
                          actualizar(e.linea.producto.id, {
                            unitsPerPurchaseUnit: ev.target.value.replace(/[^0-9.,]/g, ''),
                          })
                        }}
                      />
                    </TD>
                    <TD>
                      <Input
                        inputMode="decimal"
                        aria-label={`Costo por unidad de compra de ${e.linea.producto.name}`}
                        placeholder="0,00"
                        value={e.linea.costo}
                        disabled={enviando}
                        onChange={(ev) => {
                          actualizar(e.linea.producto.id, {
                            costo: ev.target.value.replace(/[^0-9.,]/g, ''),
                          })
                        }}
                      />
                    </TD>
                    <TD className="text-right">
                      {e.subtotal === null ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <Money amount={e.subtotal} />
                      )}
                    </TD>
                    <TD className="text-right">
                      <IconButton
                        label={`Quitar ${e.linea.producto.name}`}
                        disabled={enviando}
                        onClick={() => {
                          quitar(e.linea.producto.id)
                        }}
                      >
                        ✕
                      </IconButton>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}

        {lineas.length > 0 && (
          <div className="mt-4 flex items-baseline justify-between rounded-lg border border-line bg-sunken px-4 py-3">
            <span className="text-sm text-ink-muted">
              Total estimado
              {/*
                "Estimado" no es modestia: el que se guarda lo recalcula el
                servidor contra la base. Ver docs/PURCHASE_FLOW.md.
              */}
            </span>
            <Money amount={total} size="lg" />
          </div>
        )}
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          loading={enviando}
          disabled={supplierId === ''}
          onClick={() => void guardar(false)}
        >
          Guardar borrador
        </Button>
        <Button
          variant="primary"
          loading={enviando}
          disabled={!valido}
          onClick={() => void guardar(true)}
        >
          Confirmar orden
        </Button>
      </div>

      <DialogoAltaRapida
        abierto={altaAbierta}
        codigo={null}
        categorias={categorias}
        onCerrar={() => {
          setAltaAbierta(false)
        }}
        onCreado={(p) => {
          setAltaAbierta(false)
          // Entra a la orden directamente: quien lo creo lo hizo para comprarlo.
          agregar(p)
        }}
        onCategoriaCreada={cargarCategorias}
      />
    </div>
  )
}
