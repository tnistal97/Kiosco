'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Drawer,
  EmptyState,
  IconButton,
  Money,
  PageContainer,
  ScannerInput,
  SkeletonRows,
  aviso,
  type BarcodeStatus,
  type TeclaDelLector,
} from '@/components/ui'
import { ResultadoBusqueda } from '@/components/venta/ResultadoBusqueda'
import { Ticket, cantidadAjustada } from '@/components/venta/Ticket'
import { DialogoPeso } from '@/components/venta/DialogoPeso'
import {
  DialogoCobro,
  type ExtraDeVenta,
  type PagoParaEnviar,
} from '@/components/venta/DialogoCobro'
import { AyudaAtajos } from '@/components/venta/AyudaAtajos'
import { AvisoCajaCerrada } from '@/components/venta/AvisoCajaCerrada'
import { EscanerCamara } from '@/components/venta/EscanerCamara'
import { DialogoAltaRapida } from '@/components/venta/DialogoAltaRapida'
import { CodigoSinResolver, type EstadoDelCodigo } from '@/components/venta/CodigoSinResolver'
import { Favoritos } from '@/components/venta/Favoritos'
import { useFavoritos } from '@/components/venta/useFavoritos'
import { devolverFocoA } from '@/components/venta/foco'
import {
  accionDeTecla,
  modoDelCampo,
  moverSeleccion,
  seleccionTrasQuitar,
} from '@/components/venta/teclado'
import { useSession, usePermiso } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { buscarProductosPorIds, useProducts, type Product } from '@/hooks/useProducts'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parseVenta } from '@/modules/sales/dto'
import { useHayCapaAbierta } from '@/store/overlays'
import { articulosDelTicket, totalDelTicket, useCartStore, type CartLine } from '@/store/cart'
import { aMilesimas, type TextoCantidad } from '@/lib/cantidad'
import { esFraccionable, formatearCantidadConUnidad } from '@/modules/products/units'
import { motivoDeCodigoInvalido, normalizarCodigo } from '@/modules/products/barcode'

/** Cuantos resultados se muestran. Mas no entran en pantalla sin scroll. */
const RESULTADOS_VISIBLES = 8

/**
 * Lo minimo que hace falta saber de un producto para ponerlo en el ticket.
 * Es lo que tiene un resultado de busqueda, un favorito y --reconstruido-- una
 * linea que se vuelve a pesar.
 */
type ProductoVendible = Pick<
  Product,
  'id' | 'name' | 'barcode' | 'price' | 'sellableStock' | 'expiredStock' | 'saleUnit'
>

/**
 * Por que un producto no entra al ticket, en palabras.
 *
 * UNO SOLO para el aviso y para la linea del campo. Estaban separados y decian
 * cosas distintas: la linea decia "sin stock disponible" --que con doce
 * unidades vencidas en el deposito es mentira-- mientras el aviso, que dura
 * cuatro segundos, daba los numeros. El cajero se quedaba con la mitad
 * equivocada.
 */
function motivoDeStock(p: ProductoVendible, caso: 'sin-stock' | 'tope-de-stock'): string {
  const con = (c: TextoCantidad) => formatearCantidadConUnidad(c, p.saleUnit)
  const hayVencido = aMilesimas(p.expiredStock) > 0

  if (caso === 'sin-stock') {
    return hayVencido
      ? `lo que queda está vencido (${con(p.expiredStock)}) y no se puede vender`
      : 'está agotado'
  }
  return hayVencido
    ? `solo hay ${con(p.sellableStock)} vendibles, ${con(p.expiredStock)} están vencidos`
    : 'no queda más stock'
}

/** Lo que el dialogo de peso necesita saber de una linea que ya esta en el ticket. */
function productoDeLinea(linea: CartLine): ProductoVendible {
  return {
    id: linea.productId,
    name: linea.name,
    barcode: linea.barcode,
    price: linea.price,
    saleUnit: linea.saleUnit,
    sellableStock: linea.stock,
    expiredStock: '0.000',
  }
}

/**
 * El punto de venta. UX V2, Fase 1.
 *
 * Un solo campo --"Escaneá o buscá un producto"--, el ticket siempre a la
 * vista con una linea seleccionada que se mueve con las flechas, y Enter para
 * cobrar. La gramatica entera esta en `teclado.ts`; esta pantalla ejecuta.
 *
 * Lo que no cambio: el lector escribe en el campo y manda Enter, sin ningun
 * clic previo; el precio, el stock y el credito los decide el servidor; el
 * ticket sobrevive a un F5 y se restaura con precios frescos.
 */
export default function VentaPage() {
  const { session } = useSession()
  const hayCapa = useHayCapaAbierta()
  const puedeCrearProducto = usePermiso('products.quickCreate')
  const puedeReactivar = usePermiso('products.update')

  const {
    products,
    categories,
    searchTerm,
    setSearchTerm,
    buscarPorCodigo,
    isLoading,
    error,
    fetchProducts,
    fetchCategories,
  } = useProducts({
    enServidor: true,
    pageSize: RESULTADOS_VISIBLES,
    // Un producto dado de baja no se vende, asi que tampoco aparece entre
    // los resultados de la caja.
    filtrosIniciales: { estado: 'activos' },
  })

  const items = useCartStore((s) => s.items)
  const agregar = useCartStore((s) => s.add)
  const cambiarCantidad = useCartStore((s) => s.setQuantity)
  const quitar = useCartStore((s) => s.remove)
  const vaciar = useCartStore((s) => s.clear)
  const hidratar = useCartStore((s) => s.hidratar)
  const usarSucursal = useCartStore((s) => s.usarSucursal)

  /** Lo escrito en el campo unico. Digitos: codigo. Letras: busqueda. */
  const [texto, setTexto] = useState('')
  const [resaltado, setResaltado] = useState(0)
  /** Producto de la linea del ticket elegida con el teclado. */
  const [seleccionada, setSeleccionada] = useState<number | null>(null)
  const [editandoCantidad, setEditandoCantidad] = useState(false)
  const [escribiendo, setEscribiendo] = useState(false)
  const [cobroAbierto, setCobroAbierto] = useState(false)
  const [ticketAbierto, setTicketAbierto] = useState(false)
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  /** Lo que se esta pesando: un producto nuevo, o una linea que se corrige. */
  const [pesando, setPesando] = useState<{
    producto: ProductoVendible
    linea: CartLine | null
  } | null>(null)
  const [estadoCodigo, setEstadoCodigo] = useState<BarcodeStatus>('idle')
  const [mensajeCodigo, setMensajeCodigo] = useState<string | null>(null)
  /** Solo cuando la restauracion CAMBIO algo; si no, un aviso efimero alcanza. */
  const [avisoRestauracion, setAvisoRestauracion] = useState<string | null>(null)
  /**
   * El ultimo codigo que NO se resolvio en una linea del ticket.
   *
   * Null mientras todo va bien: el camino del producto encontrado no muestra
   * nada extra y sigue siendo instantaneo.
   */
  const [sinResolver, setSinResolver] = useState<EstadoDelCodigo | null>(null)
  const [altaAbierta, setAltaAbierta] = useState(false)
  /** Codigo con el que se abre el alta rapida. `null` = alta manual. */
  const [codigoDelAlta, setCodigoDelAlta] = useState<string | null>(null)
  /** Cambia tras cada venta: los favoritos vuelven a pedir precio y stock. */
  const [recargaFavoritos, setRecargaFavoritos] = useState(0)

  const campo = useRef<HTMLInputElement>(null)

  const total = useMemo(() => totalDelTicket(items), [items])
  const articulos = articulosDelTicket(items)
  const favoritos = useFavoritos(session?.branchId ?? null)

  const buscando = modoDelCampo(texto) === 'busqueda'
  const visibles = buscando ? products.slice(0, RESULTADOS_VISIBLES) : []

  /**
   * El escaner global escucha salvo cuando molestaria.
   *
   * Con un dialogo o un cajon abierto, mientras se edita una cantidad y
   * mientras el cursor esta en el campo --que se maneja solo--. Es lo que
   * impide que un escaneo agregue productos detras de la pantalla de cobro.
   */
  const escanerActivo =
    !hayCapa &&
    !editandoCantidad &&
    !escribiendo &&
    !cobroAbierto &&
    pesando === null &&
    !altaAbierta

  const devolverFoco = useCallback(() => {
    devolverFocoA(() => campo.current)
  }, [])

  // ---------------------------------------------------------------- ticket

  const agregarProducto = useCallback(
    (p: ProductoVendible, cantidad?: TextoCantidad): string | null => {
      const r = agregar(
        {
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          price: p.price,
          sellableStock: p.sellableStock,
          saleUnit: p.saleUnit,
        },
        cantidad,
      )
      if (r === 'sin-stock') return motivoDeStock(p, 'sin-stock')
      if (r === 'tope-de-stock') return motivoDeStock(p, 'tope-de-stock')
      // Lo que se acaba de agregar queda elegido: → suma una, Supr lo quita.
      setSeleccionada(p.id)
      return null
    },
    [agregar],
  )

  /**
   * Lo que pasa al elegir un producto, por escaneo, busqueda o favorito.
   *
   * Un producto por unidad se agrega y listo. Uno que se pesa abre el dialogo
   * INMEDIATAMENTE, sin pasos intermedios: despues de pasar un queso por el
   * lector, lo unico que puede seguir es el peso.
   */
  const elegirProducto = useCallback(
    (p: Product): string | null => {
      // Lo VENDIBLE, no el total: con 10 unidades de las que 7 estan vencidas
      // hay 3 para vender, y dejar armar el ticket con 10 solo mueve el
      // rechazo al momento de cobrar.
      if (aMilesimas(p.sellableStock) <= 0) {
        const motivo = motivoDeStock(p, 'sin-stock')
        aviso.atencion(`${p.name}: ${motivo}.`)
        return motivo
      }
      if (esFraccionable(p.saleUnit)) {
        setPesando({ producto: p, linea: null })
        return null
      }
      const motivo = agregarProducto(p)
      if (motivo !== null) aviso.atencion(`${p.name}: ${motivo}.`)
      return motivo
    },
    [agregarProducto],
  )

  const limpiarBusqueda = useCallback(() => {
    setTexto('')
    setResaltado(0)
    setSearchTerm('')
  }, [setSearchTerm])

  // --------------------------------------------------------------- escaneo

  /**
   * Que hacer con un codigo leido.
   *
   * UNA sola consulta, con `soloActivos: false`. Los cinco desenlaces se
   * distinguen, y cada uno tiene su siguiente paso:
   *
   *   invalido      el codigo no puede existir. Ni se consulta.
   *   encontrado    se agrega, o se pide el peso. Sin ruido.
   *   sin stock     se dice y no se agrega.
   *   inactivo      se nombra el producto y se ofrece reactivarlo.
   *   no registrado se ofrece darlo de alta.
   *   sin red       se ofrece reintentar, y se aclara que no se creo nada.
   */
  const procesarCodigo = useCallback(
    async (crudo: string) => {
      const codigo = normalizarCodigo(crudo)
      setSinResolver(null)

      const roto = motivoDeCodigoInvalido(codigo)
      if (roto !== null) {
        setEstadoCodigo('error')
        setMensajeCodigo(roto)
        setSinResolver({ tipo: 'invalido', codigo, motivo: roto })
        return
      }

      setEstadoCodigo('reading')
      setMensajeCodigo(null)
      try {
        const producto = await buscarPorCodigo(codigo, { soloActivos: false })

        if (!producto) {
          setEstadoCodigo('error')
          setMensajeCodigo(`${codigo} · sin resultado`)
          setSinResolver({ tipo: 'no-registrado', codigo })
          return
        }

        // Existe pero esta de baja: no es lo mismo "no existe" que "lo sacamos
        // de venta", y el cajero necesita poder decirselo al cliente.
        if (!producto.isActive) {
          setEstadoCodigo('error')
          setMensajeCodigo(`${producto.name} · dado de baja`)
          setSinResolver({
            tipo: 'inactivo',
            codigo,
            nombre: producto.name,
            productId: producto.id,
          })
          return
        }

        const motivo = elegirProducto(producto)
        setEstadoCodigo(motivo === null ? 'ok' : 'error')
        setMensajeCodigo(
          motivo === null
            ? esFraccionable(producto.saleUnit)
              ? `${producto.name} · ingresá el peso`
              : `${producto.name} · agregado`
            : `${producto.name} · ${motivo}`,
        )
      } catch (err) {
        const mensaje = mensajeDeError(err, 'No hubo respuesta del servidor.')
        setEstadoCodigo('error')
        setMensajeCodigo(mensaje)
        setSinResolver({ tipo: 'sin-red', codigo, mensaje })
      }
    },
    [elegirProducto, buscarPorCodigo],
  )

  /** El producto recien creado entra al ticket por el MISMO camino que uno viejo. */
  const usarProductoNuevo = useCallback(
    (p: Product) => {
      setAltaAbierta(false)
      setSinResolver(null)
      const motivo = elegirProducto(p)
      setEstadoCodigo(motivo === null ? 'ok' : 'error')
      setMensajeCodigo(
        motivo === null
          ? esFraccionable(p.saleUnit)
            ? `${p.name} · ingresá el peso`
            : `${p.name} · agregado`
          : `${p.name} · ${motivo}`,
      )
      void fetchProducts()
      devolverFoco()
    },
    [elegirProducto, fetchProducts, devolverFoco],
  )

  /** Reactivar un producto dado de baja, sin salir de la caja. */
  const reactivar = useCallback(
    async (productId: number, codigo: string) => {
      try {
        await apiRequest(`/api/products/${String(productId)}`, {
          method: 'PUT',
          body: { isActive: true },
          parse: () => null,
        })
        setSinResolver(null)
        await procesarCodigo(codigo)
      } catch (err) {
        aviso.error(mensajeDeError(err, 'No se pudo reactivar el producto.'))
      }
    },
    [procesarCodigo],
  )

  useBarcodeScanner({
    enabled: escanerActivo,
    onScan: (codigo) => {
      void procesarCodigo(codigo)
    },
  })

  // ------------------------------------------------------- carrito guardado

  useEffect(() => {
    if (!session) return
    usarSucursal(session.branchId)
  }, [session, usarSucursal])

  const sucursal = session?.branchId ?? null

  useEffect(() => {
    if (sucursal === null) return

    let vivo = true

    async function restaurar(branchId: number) {
      const guardadas = hidratar(branchId)
      if (guardadas.length === 0) return

      try {
        const frescos = await buscarProductosPorIds(guardadas.map((l) => l.p))
        if (!vivo) return

        const porId = new Map(frescos.map((p) => [p.id, p]))
        const cambios: string[] = []
        let restauradas = 0

        for (const linea of guardadas) {
          const p = porId.get(linea.p)
          if (!p) {
            cambios.push('se quitó un producto que ya no está disponible')
            continue
          }
          if (aMilesimas(p.sellableStock) <= 0) {
            cambios.push(
              aMilesimas(p.expiredStock) > 0
                ? `${p.name} quedó sin stock vendible: lo que hay está vencido`
                : `${p.name} quedó sin stock`,
            )
            continue
          }
          if (aMilesimas(linea.q) > aMilesimas(p.sellableStock)) {
            cambios.push(
              `${p.name}: solo quedan ${formatearCantidadConUnidad(p.sellableStock, p.saleUnit)} vendibles`,
            )
          }
          agregar(
            {
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              price: p.price,
              sellableStock: p.sellableStock,
              saleUnit: p.saleUnit,
            },
            linea.q,
          )
          restauradas++
        }

        if (restauradas > 0) {
          if (cambios.length > 0) {
            // Algo cambio: se queda en pantalla hasta que alguien lo lea.
            setAvisoRestauracion(`Cambios: ${cambios.join('; ')}.`)
          } else {
            // Todo igual: un aviso que se va solo, no un cartel con boton.
            aviso.info(
              `Ticket recuperado: ${String(restauradas)} ${restauradas === 1 ? 'artículo' : 'artículos'}.`,
            )
          }
        }
      } catch {
        setAvisoRestauracion('No se pudo recuperar el ticket anterior: no hubo respuesta del servidor.') // prettier-ignore
      }
    }

    void restaurar(sucursal)
    return () => {
      vivo = false
    }
    // Depende SOLO de la sucursal: restaurar dos veces duplicaria las lineas.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver comentario
  }, [sucursal])

  // El foco arranca en el campo: es lo que hace que el lector funcione sin
  // ningun click previo.
  useEffect(() => {
    campo.current?.focus()
  }, [])

  // ------------------------------------------------------------- seleccion

  const ids = useMemo(() => items.map((l) => l.productId), [items])

  // Si la linea elegida desaparece (vaciar, sincronizar), no queda apuntando
  // a la nada.
  useEffect(() => {
    if (seleccionada !== null && !ids.includes(seleccionada)) setSeleccionada(null)
  }, [ids, seleccionada])

  const abrirCobro = useCallback(() => {
    if (items.length > 0 && !cobroAbierto) setCobroAbierto(true)
  }, [items.length, cobroAbierto])

  const editarPeso = useCallback(
    (productId: number) => {
      const linea = items.find((l) => l.productId === productId)
      if (!linea) return
      setPesando({ producto: productoDeLinea(linea), linea })
    },
    [items],
  )

  const ajustarSeleccionada = useCallback(
    (delta: -1 | 1) => {
      const linea = items.find((l) => l.productId === seleccionada)
      if (!linea) return
      const cantidad = cantidadAjustada(linea, delta)
      // Un producto que se pesa no tiene "una unidad mas": se abre el peso.
      if (cantidad === null) editarPeso(linea.productId)
      else cambiarCantidad(linea.productId, cantidad)
    },
    [items, seleccionada, cambiarCantidad, editarPeso],
  )

  const quitarLinea = useCallback(
    (productId: number) => {
      const siguiente = seleccionTrasQuitar(ids, productId)
      quitar(productId)
      setSeleccionada(siguiente)
    },
    [ids, quitar],
  )

  // --------------------------------------------------------------- teclado

  /** Lo que se escribe en el campo unico: letras buscan, digitos esperan Enter. */
  function alEscribir(t: string) {
    setTexto(t)
    if (sinResolver !== null) setSinResolver(null)
    if (modoDelCampo(t) === 'busqueda') {
      setSearchTerm(t)
      setResaltado(0)
    } else if (searchTerm !== '') {
      setSearchTerm('')
      setResaltado(0)
    }
  }

  function alPresionarEnElCampo(tecla: TeclaDelLector, textoActual: string): boolean {
    const accion = accionDeTecla(tecla, {
      texto: textoActual,
      hayLineas: items.length > 0,
      haySeleccion: seleccionada !== null,
      hayResultados: visibles.length > 0,
      hayAviso: sinResolver !== null,
    })

    switch (accion) {
      case 'buscar-codigo':
        setTexto('')
        void procesarCodigo(textoActual)
        return true
      case 'agregar-resultado': {
        const elegido = visibles[resaltado]
        if (elegido) {
          elegirProducto(elegido)
          limpiarBusqueda()
        }
        return true
      }
      case 'cobrar':
        abrirCobro()
        return true
      case 'resultado-anterior':
        setResaltado((i) => Math.max(0, i - 1))
        return true
      case 'resultado-siguiente':
        setResaltado((i) => Math.min(i + 1, Math.max(0, visibles.length - 1)))
        return true
      case 'linea-anterior':
        setSeleccionada(moverSeleccion(ids, seleccionada, -1))
        return true
      case 'linea-siguiente':
        setSeleccionada(moverSeleccion(ids, seleccionada, 1))
        return true
      case 'cantidad-menos':
        ajustarSeleccionada(-1)
        return true
      case 'cantidad-mas':
        ajustarSeleccionada(1)
        return true
      case 'quitar-linea':
        if (seleccionada !== null) quitarLinea(seleccionada)
        return true
      case 'limpiar-campo':
        limpiarBusqueda()
        return true
      case 'deseleccionar':
        setSeleccionada(null)
        return true
      case 'cerrar-aviso':
        setSinResolver(null)
        setEstadoCodigo('idle')
        setMensajeCodigo(null)
        return true
      case 'nada':
        return false
    }
  }

  /**
   * Los alias de siempre, para quien ya los tenia en los dedos. No se
   * muestran en ningun boton: la gramatica principal se descubre sola.
   */
  useEffect(() => {
    function alPresionar(e: KeyboardEvent) {
      const enCampo =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)

      // F12 cobra desde cualquier lado. El navegador lo usa para las
      // herramientas de desarrollo, y en una caja eso no le sirve a nadie.
      if (e.key === 'F12') {
        e.preventDefault()
        abrirCobro()
        return
      }

      if (hayCapa || cobroAbierto) return

      // Alt+N abre el alta rapida manual. Sin permiso no hace nada, en vez de
      // abrir un formulario que el servidor va a rechazar.
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (puedeCrearProducto) {
          setCodigoDelAlta(null)
          setAltaAbierta(true)
        }
        return
      }

      // Ctrl+K y "/" llevan al campo unico. La barra sola no, si se esta
      // escribiendo en otro campo.
      if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !enCampo)) {
        e.preventDefault()
        campo.current?.focus()
      }
    }

    window.addEventListener('keydown', alPresionar)
    return () => {
      window.removeEventListener('keydown', alPresionar)
    }
  }, [abrirCobro, cobroAbierto, hayCapa, puedeCrearProducto])

  // ---------------------------------------------------------------- cobro

  async function cobrar(pagos: PagoParaEnviar[], extra: ExtraDeVenta): Promise<number> {
    const venta = await apiRequest('/api/sales', {
      method: 'POST',
      // Solo producto, cantidad, como se paga y a quien. El precio, el total y
      // la sucursal los pone el servidor, y el esquema ni siquiera declara esos
      // campos: mandarlos hace fallar la peticion.
      body: {
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        payments: pagos,
        ...(extra.clientId === null ? {} : { clientId: extra.clientId }),
        ...(extra.autorizarExcesoDeCredito ? { autorizarExcesoDeCredito: true } : {}),
      },
      parse: parseVenta,
    })
    notificarCambioDeCaja()
    return venta.id
  }

  function nuevaVenta() {
    vaciar()
    setCobroAbierto(false)
    setTicketAbierto(false)
    setPesando(null)
    setSeleccionada(null)
    limpiarBusqueda()
    setEstadoCodigo('idle')
    setMensajeCodigo(null)
    setSinResolver(null)
    setRecargaFavoritos((n) => n + 1)
    void fetchProducts()
    devolverFoco()
  }

  const panelTicket = (
    <Ticket
      lineas={items}
      total={total}
      articulos={articulos}
      seleccionada={seleccionada}
      onSeleccionar={setSeleccionada}
      onCantidad={cambiarCantidad}
      onQuitar={quitarLinea}
      onEditarPeso={editarPeso}
      onEditando={setEditandoCantidad}
      onVaciar={() => {
        vaciar()
        setSeleccionada(null)
        devolverFoco()
      }}
      onCobrar={abrirCobro}
      onSalir={() => {
        campo.current?.focus()
      }}
      puedeCobrar={items.length > 0}
      className="h-full"
    />
  )

  const cerrarPeso = () => {
    setPesando(null)
    devolverFoco()
  }

  return (
    <PageContainer width="operational">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4">
        <AvisoCajaCerrada />

        {avisoRestauracion && (
          <Alert
            tone="info"
            title="Ticket recuperado"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAvisoRestauracion(null)
                }}
              >
                Entendido
              </Button>
            }
          >
            {avisoRestauracion}
          </Alert>
        )}

        <div className="flex items-start gap-2">
          <ScannerInput
            ref={campo}
            value={texto}
            onValueChange={alEscribir}
            onKey={alPresionarEnElCampo}
            status={estadoCodigo}
            message={mensajeCodigo}
            loading={buscando && isLoading}
            hint="↑↓ elegir · ←→ cantidad · Enter cobrar · Supr quitar"
            onEditingChange={setEscribiendo}
            className="min-w-0 flex-1"
          />
          <IconButton
            label="Escanear con la cámara"
            variant="secondary"
            size="lg"
            onClick={() => {
              setCamaraAbierta(true)
            }}
            className="shrink-0"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M4 8.5h2.5L8 6h8l1.5 2.5H20v10H4z" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3" />
            </svg>
          </IconButton>
          {/* Alta manual: para el producto sin codigo, el artesanal o la
              etiqueta rota. Discreto a proposito --no es la operacion normal
              de una caja-- y ausente sin permiso, en vez de deshabilitado. */}
          {/* Las clases de visibilidad van en un envoltorio y no en el boton: el
              boton ya declara su `display`, y dos utilidades de `display` en el
              mismo elemento se resuelven por el orden del CSS, no del `className`. */}
          {puedeCrearProducto && (
            <>
              <div className="hidden shrink-0 sm:block">
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    setCodigoDelAlta(null)
                    setAltaAbierta(true)
                  }}
                >
                  Nuevo producto
                </Button>
              </div>
              <div className="shrink-0 sm:hidden">
                <IconButton
                  label="Nuevo producto"
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    setCodigoDelAlta(null)
                    setAltaAbierta(true)
                  }}
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    +
                  </span>
                </IconButton>
              </div>
            </>
          )}
          <div className="hidden self-center lg:block">
            <AyudaAtajos />
          </div>
        </div>

        {/* Lo que pasó con el último código, cuando no terminó en el ticket.
            Va acá arriba, no en un aviso flotante: un toast que se va solo es
            justamente lo que hacía que el cajero no se enterara. Se limpia
            con la siguiente tecla. */}
        {sinResolver && (
          <CodigoSinResolver
            estado={sinResolver}
            puedeCrear={puedeCrearProducto}
            puedeReactivar={puedeReactivar}
            onCrear={() => {
              setCodigoDelAlta(sinResolver.codigo)
              setAltaAbierta(true)
            }}
            onReactivar={() => {
              if (sinResolver.tipo === 'inactivo') {
                void reactivar(sinResolver.productId, sinResolver.codigo)
              }
            }}
            onReintentar={() => {
              void procesarCodigo(sinResolver.codigo)
            }}
            onCerrar={() => {
              setSinResolver(null)
              devolverFoco()
            }}
          />
        )}

        <div className="min-h-0 flex-1">
          {error ? (
            <Alert tone="danger" title="No se pudo buscar">
              {error}
            </Alert>
          ) : buscando ? (
            isLoading && visibles.length === 0 ? (
              <SkeletonRows rows={4} />
            ) : visibles.length === 0 ? (
              <EmptyState
                title="Ningún producto coincide"
                description={`No hay resultados activos para "${texto.trim()}".`}
              />
            ) : (
              <ul className="flex flex-col gap-1.5" aria-label="Resultados de la búsqueda">
                {visibles.map((p, i) => (
                  <ResultadoBusqueda
                    key={p.id}
                    producto={p}
                    resaltada={i === resaltado}
                    favorito={favoritos.esFavorito(p.id)}
                    onFavorito={() => {
                      favoritos.alternar(p.id)
                    }}
                    onHover={() => {
                      setResaltado(i)
                    }}
                    onAgregar={() => {
                      elegirProducto(p)
                      limpiarBusqueda()
                      campo.current?.focus()
                    }}
                  />
                ))}
              </ul>
            )
          ) : (
            <div className="flex flex-col gap-4">
              <Favoritos
                ids={favoritos.ids}
                recarga={recargaFavoritos}
                onElegir={(p) => {
                  elegirProducto(p)
                  campo.current?.focus()
                }}
                onQuitar={favoritos.alternar}
              />
              {favoritos.ids.length === 0 && (
                <EmptyState
                  title="Escaneá un código o escribí un nombre"
                  description="Marcá con ★ los productos sin código —pan, verdura, fiambre— para tenerlos acá, a un toque."
                />
              )}
            </div>
          )}
        </div>

        {/* Deja aire abajo para que la barra fija no tape el ultimo resultado. */}
        <div aria-hidden="true" className="h-24 shrink-0 lg:hidden" />
      </div>

      {/* Escritorio: el ticket vive en el layout, siempre visible. */}
      <div className="hidden w-ticket shrink-0 border-l border-line lg:flex">{panelTicket}</div>

      {/* Movil y tablet: barra fija con el total, el acceso al ticket y el cobro. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-2 border-t border-line bg-surface px-3 py-2 safe-bottom lg:hidden">
        <button
          type="button"
          onClick={() => {
            setTicketAbierto(true)
          }}
          className="flex min-h-control-lg min-w-0 flex-1 flex-col items-start justify-center rounded-lg border border-line bg-raised px-3 text-left transition-colors hover:border-line-strong"
        >
          <span className="text-xs text-ink-muted">
            Ticket
            {articulos > 0 &&
              ` · ${String(articulos)} ${articulos === 1 ? 'artículo' : 'artículos'}`}
          </span>
          <Money amount={total} size="lg" />
        </button>
        <Button
          variant="confirm"
          size="lg"
          className="flex-[1.1]"
          disabled={items.length === 0}
          onClick={abrirCobro}
        >
          Cobrar
        </Button>
      </div>

      <Drawer
        open={ticketAbierto}
        onClose={() => {
          setTicketAbierto(false)
        }}
        title="Ticket"
        side="bottom"
      >
        <div className="flex h-[70dvh] flex-col">{panelTicket}</div>
      </Drawer>

      <DialogoPeso
        abierto={pesando !== null}
        producto={pesando?.producto ?? null}
        inicial={pesando?.linea?.quantity ?? null}
        onCerrar={cerrarPeso}
        onConfirmar={(cantidad) => {
          if (!pesando) return
          if (pesando.linea) {
            cambiarCantidad(pesando.linea.productId, cantidad)
            setSeleccionada(pesando.linea.productId)
          } else {
            // El peso confirmado puede seguir sin entrar --el diálogo acota al
            // vendible, pero entre que se abrió y se confirmó pudo cambiar-- y
            // entonces hay que decirlo, no perderlo en silencio.
            const motivo = agregarProducto(pesando.producto, cantidad)
            if (motivo !== null) {
              aviso.atencion(`${pesando.producto.name}: ${motivo}.`)
              setEstadoCodigo('error')
              setMensajeCodigo(`${pesando.producto.name} · ${motivo}`)
            } else {
              setEstadoCodigo('ok')
              setMensajeCodigo(`${pesando.producto.name} · agregado`)
            }
          }
          cerrarPeso()
        }}
      />

      <DialogoAltaRapida
        abierto={altaAbierta}
        codigo={codigoDelAlta}
        categorias={categories}
        onCerrar={() => {
          setAltaAbierta(false)
          devolverFoco()
        }}
        onCreado={usarProductoNuevo}
        onYaExistia={usarProductoNuevo}
        onCategoriaCreada={() => {
          void fetchCategories()
        }}
      />

      <EscanerCamara
        abierto={camaraAbierta}
        onCerrar={() => {
          setCamaraAbierta(false)
          devolverFoco()
        }}
        onCodigo={(codigo) => {
          void procesarCodigo(codigo)
        }}
      />

      <DialogoCobro
        abierto={cobroAbierto}
        onCerrar={() => {
          setCobroAbierto(false)
          devolverFoco()
        }}
        lineas={items}
        total={total}
        onCobrar={cobrar}
        onNuevaVenta={nuevaVenta}
      />
    </PageContainer>
  )
}
