'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  IconButton,
  ScannerInput,
  aviso,
  type BarcodeStatus,
  type TeclaDelLector,
} from '@/components/ui'
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
import {
  ProductBrowser,
  type ProductBrowserHandle,
  type SeccionDelCatalogo,
} from '@/components/venta/ProductBrowser'
import { POSLayout } from '@/components/venta/POSLayout'
import { useFavoritos } from '@/components/venta/useFavoritos'
import { useFrecuentes } from '@/components/venta/useFrecuentes'
import { useProductosPorIds } from '@/components/venta/useProductosPorIds'
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

/**
 * Cuantas tarjetas trae cada consulta del catalogo.
 *
 * Sesenta entran en dos o tres pantallas de grilla. Con mas, la grilla pide
 * buscar por nombre, que es mas rapido que desplazar cien tarjetas.
 */
const TARJETAS_POR_CONSULTA = 60

/** Cuantos productos entran en "Frecuentes": favoritos primero, despues los mas vendidos. */
const TOPE_DE_FRECUENTES = 24

/**
 * Lo minimo que hace falta saber de un producto para ponerlo en el ticket.
 * Es lo que tiene una tarjeta del catalogo y --reconstruido-- una linea que
 * se vuelve a pesar.
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
 * El punto de venta. UX V2, Fase 2.
 *
 * Desde el primer momento se ve la estructura entera: el lector, el catalogo
 * --frecuentes, categorias o resultados-- y el ticket con su total y "Cobrar".
 * Se vende de dos maneras que terminan en el mismo lugar: escaneando, o
 * tocando una tarjeta. La gramatica de teclado esta en `teclado.ts`; esta
 * pantalla ejecuta.
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
    aplicarFiltros,
    total: totalDelCatalogo,
    buscarPorCodigo,
    isLoading,
    error,
    fetchProducts,
    fetchCategories,
  } = useProducts({
    enServidor: true,
    pageSize: TARJETAS_POR_CONSULTA,
    // Un producto dado de baja no se vende, asi que tampoco aparece en la caja.
    filtrosIniciales: { estado: 'activos', sortBy: 'name', sortDir: 'asc' },
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
  /** Tarjeta resaltada desde el campo, mientras se busca. */
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
  /** Cambia tras cada venta: los frecuentes vuelven a pedir precio y stock. */
  const [recargaDeFrecuentes, setRecargaDeFrecuentes] = useState(0)

  const campo = useRef<HTMLInputElement>(null)
  const catalogo = useRef<ProductBrowserHandle>(null)

  const total = useMemo(() => totalDelTicket(items), [items])
  const articulos = articulosDelTicket(items)

  const branchId = session?.branchId ?? null
  const favoritos = useFavoritos(branchId)
  const frecuentes = useFrecuentes(branchId)

  const buscando = modoDelCampo(texto) === 'busqueda'

  // ------------------------------------------------------------- catalogo

  /**
   * "Frecuentes": los favoritos marcados a mano primero, despues lo que mas
   * se vendio en esta caja. Los dos viven en este equipo; ver useFrecuentes.
   */
  const idsDeFrecuentes = useMemo(() => {
    const marcados = new Set(favoritos.ids)
    return [...favoritos.ids, ...frecuentes.ids.filter((id) => !marcados.has(id))].slice(
      0,
      TOPE_DE_FRECUENTES,
    )
  }, [favoritos.ids, frecuentes.ids])

  const { productos: productosFrecuentes, cargando: cargandoFrecuentes } = useProductosPorIds(
    idsDeFrecuentes,
    recargaDeFrecuentes,
  )
  const hayFrecuentes = idsDeFrecuentes.length > 0

  const [seccion, setSeccion] = useState<SeccionDelCatalogo>('todos')
  const seccionElegidaAMano = useRef(false)

  // Arranca en "Frecuentes" en cuanto hay alguno, salvo que ya se haya
  // elegido otra cosa a mano. Un equipo nuevo arranca en "Todos".
  useEffect(() => {
    if (hayFrecuentes && !seccionElegidaAMano.current) setSeccion('frecuentes')
  }, [hayFrecuentes])

  const elegirSeccion = useCallback((s: SeccionDelCatalogo) => {
    seccionElegidaAMano.current = true
    setSeccion(s)
    setResaltado(0)
  }, [])

  // La categoria filtra el catalogo, pero NO la busqueda: "yerba" escrito
  // desde Bebidas tiene que encontrar la yerba.
  const filtrosAplicados = useRef('')
  useEffect(() => {
    const categoryId = !buscando && typeof seccion === 'number' ? seccion : undefined
    const clave = String(categoryId ?? '')
    if (filtrosAplicados.current === clave) return
    filtrosAplicados.current = clave
    aplicarFiltros({
      estado: 'activos',
      sortBy: 'name',
      sortDir: 'asc',
      ...(categoryId === undefined ? {} : { categoryId }),
    })
  }, [buscando, seccion, aplicarFiltros])

  const enFrecuentes = !buscando && seccion === 'frecuentes'
  const visibles = enFrecuentes ? productosFrecuentes : products
  const cargandoCatalogo = enFrecuentes ? cargandoFrecuentes : isLoading
  const totalVisible = enFrecuentes ? productosFrecuentes.length : totalDelCatalogo

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

  const registrarFrecuente = frecuentes.registrar

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
      registrarFrecuente(p.id)
      return null
    },
    [agregar, registrarFrecuente],
  )

  /**
   * Lo que pasa al elegir un producto, por escaneo, busqueda o tarjeta.
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

  /** Una tarjeta del catalogo, tocada o elegida con Enter. */
  const elegirDelCatalogo = useCallback(
    (p: Product, desdeElTeclado: boolean) => {
      elegirProducto(p)
      if (buscando) limpiarBusqueda()
      // Quien toca vuelve al lector: ahi cae el proximo codigo. Quien navega
      // con el teclado se queda en la grilla para seguir eligiendo.
      if (!desdeElTeclado) campo.current?.focus()
    },
    [elegirProducto, buscando, limpiarBusqueda],
  )

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

  useEffect(() => {
    if (branchId === null) return

    let vivo = true

    async function restaurar(sucursal: number) {
      const guardadas = hidratar(sucursal)
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

    void restaurar(branchId)
    return () => {
      vivo = false
    }
    // Depende SOLO de la sucursal: restaurar dos veces duplicaria las lineas.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver comentario
  }, [branchId])

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
      hayResultados: buscando && visibles.length > 0,
      hayAviso: sinResolver !== null,
      hayGrilla: visibles.length > 0,
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
      case 'ir-a-grilla':
        catalogo.current?.enfocar()
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
    setRecargaDeFrecuentes((n) => n + 1)
    void fetchProducts()
    devolverFoco()
  }

  const cerrarPeso = () => {
    setPesando(null)
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

  const cabecera = (
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
  )

  const avisos = (
    <>
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
    </>
  )

  return (
    <>
      <POSLayout
        cabecera={cabecera}
        avisos={avisos}
        catalogo={
          <ProductBrowser
            ref={catalogo}
            busqueda={buscando ? texto : null}
            seccion={seccion}
            onSeccion={elegirSeccion}
            categorias={categories}
            hayFrecuentes={hayFrecuentes}
            productos={visibles}
            cargando={cargandoCatalogo}
            error={error}
            total={totalVisible}
            resaltado={buscando ? resaltado : -1}
            onResaltar={setResaltado}
            onElegir={elegirDelCatalogo}
            esFavorito={favoritos.esFavorito}
            onFavorito={favoritos.alternar}
            onVolverAlLector={() => {
              campo.current?.focus()
            }}
            className="h-full"
          />
        }
        ticket={panelTicket}
        articulos={articulos}
        total={total}
        puedeCobrar={items.length > 0}
        ticketAbierto={ticketAbierto}
        onAbrirTicket={() => {
          setTicketAbierto(true)
        }}
        onCerrarTicket={() => {
          setTicketAbierto(false)
        }}
        onCobrar={abrirCobro}
      />

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
    </>
  )
}
