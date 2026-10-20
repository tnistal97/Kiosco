'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  Alert,
  Button,
  IconButton,
  ScannerInput,
  aviso,
  cn,
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
import { GuiaDeTeclado, ayudaEnTexto } from '@/components/venta/GuiaDeTeclado'
import { ProductBrowser } from '@/components/venta/ProductBrowser'
import { Secciones, type SeccionDelCatalogo } from '@/components/venta/Secciones'
import { POSLayout } from '@/components/venta/POSLayout'
import { VentasDeHoy } from '@/components/venta/VentasDeHoy'
import { AccionesDeCabecera } from '@/components/shell/AccionesDeCabecera'
import { useFavoritos } from '@/components/venta/useFavoritos'
import { useFrecuentes } from '@/components/venta/useFrecuentes'
import { useProductosPorIds } from '@/components/venta/useProductosPorIds'
import { enfocarCampo, esEditable } from '@/components/venta/foco'
import { useEstadoInmediato } from '@/components/venta/useEstadoInmediato'
import {
  accionDeTecla,
  enterAvanza,
  esRepeticionIgnorada,
  esTeclaReservada,
  modoDelCampo,
  moverResaltado,
  moverSeleccion,
  seleccionTrasQuitar,
  type AccionDelPos,
  type EtapaDelPos,
} from '@/components/venta/teclado'
import { useSession, usePermiso } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { buscarProductosPorIds, useProducts, type Product } from '@/hooks/useProducts'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parseVenta } from '@/modules/sales/dto'
import { useHayCapaAbierta } from '@/store/overlays'
import { articulosDelTicket, totalDelTicket, useCartStore, type CartLine } from '@/store/cart'
import type { Monto } from '@/lib/money'
import { aMilesimas, type TextoCantidad } from '@/lib/cantidad'
import { esFraccionable, formatearCantidadConUnidad, politicaDe } from '@/modules/products/units'
import { motivoDeCodigoInvalido, normalizarCodigo } from '@/modules/products/barcode'

/**
 * Cuantas filas trae cada consulta del catalogo.
 *
 * Sesenta son cuatro pantallas de lista: alcanzan para el catalogo entero de
 * un almacen chico y, cuando no, la lista SIGUE --se cargan las siguientes
 * sesenta y se suman a las que ya estan (`cargarMas`)--. Hasta la V3 el tope
 * era una pared: "Se muestran 60 de 200, buscá por nombre".
 *
 * Sesenta filas tampoco piden virtualizar nada: son sesenta botones.
 */
const FILAS_POR_CONSULTA = 60

/** Cuantos productos entran en "Frecuentes": favoritos primero, despues los mas vendidos. */
const TOPE_DE_FRECUENTES = 24

/**
 * Desde que ancho el carrito es un panel fijo y no una hoja (el `xl` de
 * Tailwind). Por debajo, pasar al carrito con el teclado abre la hoja.
 */
const CARRITO_COMO_PANEL = '(min-width: 1280px)'

/**
 * Lo minimo que hace falta saber de un producto para ponerlo en el ticket.
 * Es lo que tiene una fila del catalogo y --reconstruido-- una linea que
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
 * El punto de venta. UX V3, teclado V6.
 *
 * Desde el primer momento se ve la estructura entera: el buscador, las
 * etapas, las secciones, la lista de productos y el carrito con su total y
 * "Cobrar". Se vende de tres maneras que terminan en el mismo lugar:
 * escaneando, tocando una fila, o escribiendo el nombre y agregando con →.
 *
 * TRES IDEAS QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO
 * ---------------------------------------------------
 * 1. EL FOCO VIVE EN EL BUSCADOR. Lo elegido en la lista y en el carrito es
 *    estado, no foco: por eso el lector sigue funcionando mientras se
 *    recorre el catalogo. Solo un dialogo se lleva el foco, y vuelve solo.
 *    Si el foco quedo en otro lado, la primera letra lo trae de vuelta.
 * 2. LA VENTA TIENE TRES ETAPAS: productos, carrito y cobro. Cada tecla
 *    significa una sola cosa en cada etapa; la tabla completa esta en
 *    `teclado.ts` y es una funcion pura. Esta pantalla ejecuta, no decide.
 * 3. ENTER AVANZA UNA ETAPA, NUNCA SUMA. Productos → carrito → cobro →
 *    confirmar: cuatro Enter deliberados entre el ultimo producto y una venta
 *    registrada, y dos Enter demasiado pegados cuentan como uno. El Enter del
 *    lector es la unica excepcion: agrega el codigo leido y no cambia de
 *    etapa.
 *
 * Lo que no cambio: el lector escribe en el buscador y manda Enter, sin
 * ningun clic previo; el precio, el stock y el credito los decide el
 * servidor; el ticket sobrevive a un F5 y se restaura con precios frescos.
 */
export default function VentaPage() {
  const { session } = useSession()
  const hayCapa = useHayCapaAbierta()
  const puedeCrearProducto = usePermiso('products.quickCreate')
  const puedeVerVentas = usePermiso('sales.view')
  const puedeReactivar = usePermiso('products.update')

  const {
    products,
    terminoAplicado,
    cargarMas,
    hayMas,
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
    pageSize: FILAS_POR_CONSULTA,
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

  /** Lo escrito en el buscador. Digitos: codigo. Letras: busqueda. */
  const [texto, setTexto] = useState('')
  // Los tres se leen y se escriben dentro de la misma rafaga de teclas, asi
  // que van con `useEstadoInmediato`: el manejador de la tecla siguiente
  // tiene que ver lo que hizo la anterior, no el estado del ultimo dibujo.
  /** Productos o carrito. El cobro es `cobroAbierto`. Ver `teclado.ts`. */
  const [etapa, setEtapa, etapaRef] = useEstadoInmediato<EtapaDelPos>('productos')
  /**
   * El producto ELEGIDO a proposito con ↑ ↓, por su id.
   *
   * Por id y no por posicion: mientras la busqueda viaja al servidor la lista
   * se reacomoda, y "la tercera fila" pasa a ser otro producto. Null es "nada
   * elegido a mano"; escribiendo un nombre, entonces, manda el primero.
   */
  const [elegido, setElegido, elegidoRef] = useEstadoInmediato<number | null>(null)
  /** Producto de la linea del carrito elegida con el teclado. */
  const [seleccionada, setSeleccionada, seleccionadaRef] = useEstadoInmediato<number | null>(null)
  const [editandoCantidad, setEditandoCantidad] = useState(false)
  const [escribiendo, setEscribiendo] = useState(false)
  const [cobroAbierto, setCobroAbierto] = useState(false)
  const [ticketAbierto, setTicketAbierto] = useState(false)
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  const [ventasDeHoyAbierto, setVentasDeHoyAbierto] = useState(false)
  /** Lo que se esta pesando: un producto nuevo, o una linea que se corrige. */
  const [pesando, setPesando] = useState<{
    producto: ProductoVendible
    linea: CartLine | null
    /** Al cerrar, ¿se limpia la busqueda? No cuando se llego con →. */
    limpiar: boolean
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
  /** La ultima venta registrada en esta pantalla. Referencia, nada mas. */
  const [ultimaVenta, setUltimaVenta] = useState<{ id: number; total: Monto } | null>(null)

  /**
   * Cuando fue el ultimo Enter que hizo algo: avanzar una etapa o agregar un
   * codigo. Un Enter de avance que llega antes de `PAUSA_ENTRE_ETAPAS_MS` se
   * ignora: es lo que impide que un doble Enter rapido salte dos etapas, o
   * que el Enter de mas de un lector mal configurado pase al carrito.
   */
  const ultimoEnter = useRef<number | null>(null)

  const campo = useRef<HTMLInputElement>(null)

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

  /**
   * Que se esta mirando: frecuentes, todos, o una categoria.
   *
   * NUNCA cambia sola (V3). Hasta la 2.1 saltaba a "Frecuentes" en cuanto
   * habia alguno: se escaneaban dos productos y, en medio de la venta, la
   * lista de cincuenta y siete pasaba a tres y la pantalla parecia vaciarse.
   * La lista que el cajero esta mirando no se toca sin que la toque el.
   */
  const [seccion, setSeccion] = useState<SeccionDelCatalogo>('todos')

  const elegirSeccion = useCallback(
    (s: SeccionDelCatalogo) => {
      setSeccion(s)
      setElegido(null)
      setEtapa('productos')
      // Elegir una categoria con el mouse dejaba el foco en el boton, y el
      // proximo codigo leido no caia en el campo (V5).
      enfocarCampo(() => campo.current)
    },
    [setElegido, setEtapa],
  )

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

  /**
   * Lo que se ve en la lista, sin filas viejas.
   *
   * Mientras la consulta viaja --120 ms de espera mas lo que tarde el
   * servidor-- la lista seguia mostrando los resultados anteriores. Escribir
   * "yerba" y agregar enseguida elegia la primera fila de la lista VIEJA.
   * Ahora, mientras el servidor no haya contestado para lo que hay escrito,
   * se muestra lo ya cargado que coincide: mismo criterio que el servidor
   * --el nombre contiene el texto, sin distinguir mayusculas-- y una lista
   * que nunca miente.
   */
  const termino = texto.trim()
  const esperandoResultados = buscando && terminoAplicado !== termino
  const encontrados = useMemo(() => {
    if (!esperandoResultados) return products
    const t = termino.toLowerCase()
    return products.filter((p) => p.name.toLowerCase().includes(t))
  }, [products, esperandoResultados, termino])

  const visibles = enFrecuentes ? productosFrecuentes : encontrados
  const cargandoCatalogo = enFrecuentes ? cargandoFrecuentes : isLoading
  const totalVisible = enFrecuentes
    ? productosFrecuentes.length
    : esperandoResultados
      ? encontrados.length
      : totalDelCatalogo
  // En "Frecuentes" la lista esta completa por definicion: son veinticuatro
  // como mucho y ya estan todos.
  const hayMasParaVer = !enFrecuentes && !esperandoResultados && hayMas

  /**
   * El producto sobre el que actuan → y ←.
   *
   * El elegido a mano con ↑ ↓, si sigue en la lista. Si no hay ninguno y se
   * esta escribiendo un nombre, el PRIMER resultado: escribir "coca" y
   * apretar → agrega la primera coca, la que se ve marcada. Sin busqueda y
   * sin nada elegido, ninguno: → no agrega algo que nadie eligio.
   */
  const productoElegido = useCallback(
    (textoActual: string, id: number | null = elegidoRef.current): Product | null => {
      if (id !== null) {
        const p = visibles.find((v) => v.id === id)
        if (p) return p
      }
      return modoDelCampo(textoActual) === 'busqueda' ? (visibles[0] ?? null) : null
    },
    [visibles, elegidoRef],
  )

  /** La fila marcada en la lista: solo en la etapa de productos. */
  const indiceResaltado = useMemo(() => {
    if (etapa !== 'productos') return -1
    const p = productoElegido(texto, elegido)
    return p ? visibles.findIndex((v) => v.id === p.id) : -1
  }, [etapa, productoElegido, texto, visibles, elegido])

  /** Cuanto hay de cada producto en el carrito, para la marca de la lista. */
  const enCarrito = useMemo(
    () => new Map(items.map((l) => [l.productId, formatearCantidadConUnidad(l.quantity, l.saleUnit)])), // prettier-ignore
    [items],
  )

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

  /** El foco vuelve al campo, en el mismo cuadro. Ver `foco.ts`. */
  const enfocar = useCallback(() => {
    enfocarCampo(() => campo.current)
  }, [])

  /**
   * Abre una capa --cobro, peso, alta, camara-- con el foco ya en el campo.
   *
   * Headless UI devuelve el foco al elemento que estaba activo cuando el
   * dialogo se monto. Si se llego con el mouse, ese elemento es el boton que
   * se toco, y al cerrar el foco quedaba ahi: el lector dejaba de funcionar
   * hasta que alguien hiciera clic en el campo. Poniendo el foco en el campo
   * ANTES de abrir, la restauracion cae siempre donde tiene que caer, sin
   * reintentos ni temporizadores.
   */
  const abrirCapa = useCallback(
    (abrir: () => void) => {
      enfocar()
      abrir()
    },
    [enfocar],
  )

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
      // Lo que se acaba de agregar queda elegido en el carrito: al pasar a
      // revisarlo, las flechas arrancan ahi.
      setSeleccionada(p.id)
      registrarFrecuente(p.id)
      return null
    },
    [agregar, registrarFrecuente, setSeleccionada],
  )

  /**
   * Una unidad de un producto, por escaneo, por → o por un toque.
   *
   * Un producto por unidad se agrega y listo. Uno que se pesa abre el dialogo
   * INMEDIATAMENTE, sin pasos intermedios: despues de pasar un queso por el
   * lector, lo unico que puede seguir es el peso. Vale igual para →: un
   * producto por kilo no tiene "una unidad mas" (decision V3).
   */
  const elegirProducto = useCallback(
    (
      p: ProductoVendible,
      opciones: { limpiar?: boolean; linea?: CartLine | null } = {},
    ): string | null => {
      // Lo VENDIBLE, no el total: con 10 unidades de las que 7 estan vencidas
      // hay 3 para vender, y dejar armar el ticket con 10 solo mueve el
      // rechazo al momento de cobrar.
      if (aMilesimas(p.sellableStock) <= 0) {
        const motivo = motivoDeStock(p, 'sin-stock')
        aviso.atencion(`${p.name}: ${motivo}.`)
        return motivo
      }
      if (esFraccionable(p.saleUnit)) {
        const limpiar = opciones.limpiar ?? true
        const linea = opciones.linea ?? null
        // El foco al campo ANTES de abrir el peso, para que al cerrarlo vuelva
        // solo. Si ya hay una capa abierta --la camara-- no se la toca.
        if (!hayCapa) enfocar()
        setPesando({ producto: p, linea, limpiar })
        return null
      }
      const motivo = agregarProducto(p)
      if (motivo !== null) aviso.atencion(`${p.name}: ${motivo}.`)
      return motivo
    },
    [agregarProducto, enfocar, hayCapa],
  )

  const limpiarBusqueda = useCallback(() => {
    setTexto('')
    setElegido(null)
    setSearchTerm('')
  }, [setSearchTerm, setElegido])

  /**
   * Una fila del catalogo tocada con el dedo o el mouse: una unidad mas.
   *
   * Tocar dos veces la gaseosa son dos gaseosas, como en cualquier caja
   * tactil. El foco vuelve al campo, que es donde cae el proximo codigo leido.
   */
  const tocarProducto = useCallback(
    (p: Product) => {
      elegirProducto(p, { limpiar: true })
      if (buscando) limpiarBusqueda()
      setEtapa('productos')
      enfocarCampo(() => campo.current)
    },
    [elegirProducto, buscando, limpiarBusqueda, setEtapa],
  )

  // --------------------------------------------------------------- escaneo

  /**
   * Que hacer con un codigo leido.
   *
   * UNA sola consulta, con `soloActivos: false`. Los cinco desenlaces se
   * distinguen, y cada uno tiene su siguiente paso:
   *
   *   invalido      el codigo no puede existir. Ni se consulta.
   *   encontrado    se agrega UNA unidad, o se pide el peso. Sin ruido.
   *   sin stock     se dice y no se agrega.
   *   inactivo      se nombra el producto y se ofrece reactivarlo.
   *   no registrado se ofrece darlo de alta.
   *   sin red       se ofrece reintentar, y se aclara que no se creo nada.
   *
   * La etapa NO cambia (V6): leer un codigo mientras se revisa el carrito
   * agrega el producto y se sigue revisando, con esa linea elegida.
   */
  const procesarCodigo = useCallback(
    async (crudo: string) => {
      const codigo = normalizarCodigo(crudo)
      setSinResolver(null)
      // Un codigo leido manda: lo elegido a mano en la lista se suelta, y →
      // ya no suma un producto que el cajero dejo de mirar.
      setElegido(null)

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
    [elegirProducto, buscarPorCodigo, setElegido],
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
      enfocar()
    },
    [elegirProducto, fetchProducts, enfocar],
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
  }, [ids, seleccionada, setSeleccionada])

  // Un carrito vacio no se revisa: si se quito la ultima linea, se vuelve a
  // productos.
  useEffect(() => {
    if (etapa === 'carrito' && items.length === 0) setEtapa('productos')
  }, [etapa, items.length, setEtapa])

  /**
   * Abrir el cobro: la tercera etapa. Esc vuelve al carrito, asi que abrirlo
   * --con Enter, con F12 o con el boton-- deja la venta en el carrito.
   */
  const abrirCobro = useCallback(() => {
    if (items.length > 0 && !cobroAbierto) {
      setEtapa('carrito')
      abrirCapa(() => {
        setCobroAbierto(true)
      })
    }
  }, [items.length, cobroAbierto, abrirCapa, setEtapa])

  /**
   * Pasar a revisar el carrito: la segunda etapa.
   *
   * La busqueda se limpia: al volver con Esc se empieza a buscar lo que
   * sigue, sin tener que borrar lo anterior. La linea elegida es la ultima
   * que entro, o la primera. Por debajo de 1280 px el carrito no esta a la
   * vista y se abre como hoja.
   */
  const entrarAlCarrito = useCallback(
    (linea?: number) => {
      setEtapa('carrito')
      setSeleccionada((s) => linea ?? (s !== null && ids.includes(s) ? s : (ids[0] ?? null)))
      setTexto('')
      setElegido(null)
      setSearchTerm('')
      if (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        !window.matchMedia(CARRITO_COMO_PANEL).matches
      ) {
        abrirCapa(() => {
          setTicketAbierto(true)
        })
      }
    },
    [ids, setEtapa, setSeleccionada, setElegido, setSearchTerm, abrirCapa],
  )

  const volverAProductos = useCallback(() => {
    setEtapa('productos')
    setTicketAbierto(false)
  }, [setEtapa])

  const editarPeso = useCallback(
    (productId: number, limpiar = true) => {
      const linea = items.find((l) => l.productId === productId)
      if (!linea) return
      abrirCapa(() => {
        setPesando({ producto: productoDeLinea(linea), linea, limpiar })
      })
    },
    [items, abrirCapa],
  )

  /**
   * Volver atras una accion destructiva del ticket.
   *
   * No hay confirmacion antes de quitar ni de vaciar: un modal en medio de una
   * venta cuesta mas que el error que evita. Lo que hay es vuelta atras, con
   * el ticket entero guardado --lineas, cantidades y orden-- y ocho segundos
   * para arrepentirse.
   *
   * Se reconstruye con `add`, que es el mismo camino que usa el escaneo: las
   * reglas de stock se vuelven a aplicar, no se inyecta estado a mano.
   */
  const restaurarTicket = useCallback(
    (guardado: CartLine[]) => {
      vaciar()
      for (const l of guardado) {
        agregar(
          {
            id: l.productId,
            name: l.name,
            barcode: l.barcode,
            price: l.price,
            sellableStock: l.stock,
            saleUnit: l.saleUnit,
          },
          l.quantity,
        )
      }
      setSeleccionada(null)
      enfocar()
    },
    [vaciar, agregar, enfocar, setSeleccionada],
  )

  const conDeshacer = useCallback(
    (mensaje: string, accion: () => void) => {
      const antes = items
      accion()
      aviso.deshacer(mensaje, () => {
        restaurarTicket(antes)
      })
    },
    [items, restaurarTicket],
  )

  const quitarLinea = useCallback(
    (productId: number) => {
      const linea = items.find((l) => l.productId === productId)
      const siguiente = seleccionTrasQuitar(ids, productId)
      conDeshacer(linea ? `${linea.name} · quitado` : 'Producto quitado', () => {
        quitar(productId)
        setSeleccionada(siguiente)
      })
    },
    [ids, items, quitar, conDeshacer, setSeleccionada],
  )

  /**
   * Una unidad mas o menos sobre una linea del carrito.
   *
   * EXACTAMENTE una. Con una sola unidad, ← la quita --nunca queda una linea
   * en cero ni en negativo-- y volver atras esta a un toque. En el tope de
   * stock, + no suma y se dice por que. Un producto por peso no tiene paso:
   * abre el peso.
   */
  const ajustarLinea = useCallback(
    (linea: CartLine, delta: -1 | 1) => {
      const cantidad = cantidadAjustada(linea, delta)
      if (cantidad === null) {
        editarPeso(linea.productId, false)
        return
      }
      const minimo = aMilesimas(politicaDe(linea.saleUnit).minimo)
      if (delta === -1 && aMilesimas(cantidad) < minimo) {
        quitarLinea(linea.productId)
        return
      }
      if (delta === 1 && aMilesimas(cantidad) > aMilesimas(linea.stock)) {
        aviso.atencion(`${linea.name}: ${motivoDeStock(productoDeLinea(linea), 'tope-de-stock')}.`)
        return
      }
      cambiarCantidad(linea.productId, cantidad)
    },
    [cambiarCantidad, editarPeso, quitarLinea],
  )

  const ajustarSeleccionada = useCallback(
    (delta: -1 | 1) => {
      const linea = items.find((l) => l.productId === seleccionadaRef.current)
      if (linea) ajustarLinea(linea, delta)
    },
    [items, seleccionadaRef, ajustarLinea],
  )

  /**
   * → y ← sobre un producto de la lista (V6).
   *
   * → agrega exactamente una unidad: si no estaba en el carrito entra con
   * una, si estaba suma una. ← resta una solo si esta en el carrito; si no
   * esta, no hace nada. En cero la linea se quita, como en el carrito.
   */
  const ajustarProducto = useCallback(
    (p: Product, delta: -1 | 1) => {
      const linea = items.find((l) => l.productId === p.id)
      if (delta === 1) {
        if (linea && esFraccionable(linea.saleUnit)) editarPeso(linea.productId, false)
        else elegirProducto(p, { limpiar: false })
        return
      }
      if (linea) ajustarLinea(linea, -1)
    },
    [items, elegirProducto, editarPeso, ajustarLinea],
  )

  /** ↑ ↓ en la lista de productos. Bajar desde la ultima trae mas. */
  const moverProducto = useCallback(
    (delta: -1 | 1, textoActual: string) => {
      const actual = productoElegido(textoActual)
      const indice = actual ? visibles.findIndex((v) => v.id === actual.id) : -1
      const siguiente = moverResaltado(indice, delta, visibles.length)
      if (siguiente === indice && delta === 1 && hayMas) cargarMas()
      setElegido(visibles[siguiente]?.id ?? null)
    },
    [productoElegido, visibles, hayMas, cargarMas, setElegido],
  )

  // --------------------------------------------------------------- teclado

  /**
   * Lo que se escribe en el buscador.
   *
   * Letras: una busqueda, y escribir es SIEMPRE estar en productos --tambien
   * si se estaba revisando el carrito--. El primer resultado queda elegido.
   * Digitos: un codigo (el lector, o uno tipeado), que se resuelve con Enter
   * y no cambia de etapa.
   */
  function alEscribir(t: string) {
    setTexto(t)
    setElegido(null)
    if (sinResolver !== null) setSinResolver(null)
    if (modoDelCampo(t) === 'busqueda') {
      setEtapa('productos')
      setSearchTerm(t)
    } else if (searchTerm !== '') {
      setSearchTerm('')
    }
  }

  // La version vigente de `alEscribir`, para el manejador de teclas de la
  // ventana, que se suscribe una sola vez.
  const alEscribirRef = useRef(alEscribir)
  // Y la de las teclas de la gramatica, para cuando el foco esta fuera del
  // campo (un clic en un lugar vacio, una fila de la lista).
  const alPresionarRef = useRef<(tecla: TeclaDelLector, texto: string) => boolean>(() => false)
  useEffect(() => {
    alEscribirRef.current = alEscribir
    alPresionarRef.current = alPresionarEnElCampo
  })

  /** Hacer lo que dice la gramatica. Ver `accionDeTecla`. */
  function ejecutar(accion: AccionDelPos, textoActual: string): void {
    const ahora = performance.now()
    switch (accion) {
      case 'buscar-codigo':
        // El Enter del lector agrega y NO cambia de etapa. Cuenta como Enter:
        // si el lector manda uno de mas, ese no pasa al carrito.
        ultimoEnter.current = ahora
        setTexto('')
        void procesarCodigo(textoActual)
        return
      case 'ir-al-carrito':
        // Dos Enter demasiado pegados no saltan dos etapas.
        if (!enterAvanza(ahora, ultimoEnter.current)) return
        ultimoEnter.current = ahora
        entrarAlCarrito()
        return
      case 'carrito-vacio':
        setEstadoCodigo('idle')
        setMensajeCodigo('El carrito está vacío · elegí un producto y agregalo con →')
        return
      case 'ir-al-cobro':
        if (!enterAvanza(ahora, ultimoEnter.current)) return
        ultimoEnter.current = ahora
        abrirCobro()
        return
      case 'producto-anterior':
        moverProducto(-1, textoActual)
        return
      case 'producto-siguiente':
        moverProducto(1, textoActual)
        return
      case 'sumar-producto':
      case 'restar-producto': {
        const p = productoElegido(textoActual)
        if (p) ajustarProducto(p, accion === 'sumar-producto' ? 1 : -1)
        return
      }
      case 'linea-anterior':
        setSeleccionada(moverSeleccion(ids, seleccionadaRef.current, -1))
        return
      case 'linea-siguiente':
        setSeleccionada(moverSeleccion(ids, seleccionadaRef.current, 1))
        return
      case 'sumar-linea':
        ajustarSeleccionada(1)
        return
      case 'restar-linea':
        ajustarSeleccionada(-1)
        return
      case 'quitar-linea':
        if (seleccionadaRef.current !== null) quitarLinea(seleccionadaRef.current)
        return
      case 'limpiar-busqueda':
        limpiarBusqueda()
        return
      case 'soltar-producto':
        setElegido(null)
        return
      case 'volver-a-productos':
        volverAProductos()
        return
      case 'cerrar-aviso':
        setSinResolver(null)
        setEstadoCodigo('idle')
        setMensajeCodigo(null)
        return
      case 'nada':
        return
    }
  }

  /**
   * Una tecla de la gramatica, desde el buscador o --por la ventana-- desde
   * cualquier lugar que no sea un campo de texto. `true` = la tecla se uso y
   * no hace lo nativo.
   */
  function alPresionarEnElCampo(tecla: TeclaDelLector, textoActual: string): boolean {
    // De las referencias y no del render: dos teclas seguidas llegan mas
    // rapido de lo que React vuelve a dibujar.
    const accion = accionDeTecla(tecla, {
      etapa: etapaRef.current,
      texto: textoActual,
      hayLineas: items.length > 0,
      haySeleccion: seleccionadaRef.current !== null,
      hayResultados: visibles.length > 0,
      hayProductoElegido: productoElegido(textoActual) !== null,
      hayAviso: sinResolver !== null,
    })
    ejecutar(accion, textoActual)
    return accion !== 'nada' || esTeclaReservada(tecla)
  }

  /**
   * Las teclas que llegan a la ventana sin que nadie las haya usado.
   *
   * Es lo que hace que la gramatica funcione "aunque el foco este en otro
   * lado": despues de un clic en una categoria, en un lugar vacio, en una
   * fila. Nunca dentro de un campo de texto --ahi se escribe-- ni con un
   * dialogo o un cajon abierto --tienen sus propias teclas--.
   */
  useEffect(() => {
    function alPresionar(e: KeyboardEvent) {
      const enCampo = esEditable(e.target)

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
          abrirCapa(() => {
            setCodigoDelAlta(null)
            setAltaAbierta(true)
          })
        }
        return
      }

      // Ctrl+K lleva al campo unico desde cualquier lado; "/" tambien, salvo
      // que se este escribiendo en otro campo.
      if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !enCampo)) {
        e.preventDefault()
        campo.current?.focus()
        return
      }

      if (enCampo || e.defaultPrevented) return

      const sinModificador = !e.ctrlKey && !e.altKey && !e.metaKey
      const signo = e.key === '−' ? '-' : e.key

      // + y − fuera del campo --despues de un clic en un lugar vacio de la
      // pantalla-- son → y ←, como con el campo vacio. Con algo escrito en el
      // campo, se escriben ahi como cualquier letra (mas abajo).
      if (
        sinModificador &&
        (signo === '+' || signo === '-') &&
        (campo.current?.value ?? '') === ''
      ) {
        e.preventDefault()
        if (!e.repeat) alPresionarRef.current(signo, '')
        return
      }

      // Escribir sin estar en el campo lleva al campo (V5).
      //
      // Una tecla imprimible pone el foco en el campo y ESCRIBE ahi ese
      // caracter (no se confia en que el navegador lo mueva solo: con un
      // lector rapido el primer digito se perdia). Las teclas siguientes ya
      // caen en el campo, y el Enter del lector se procesa ahi.
      //
      // El espacio no: activa el boton enfocado.
      if (sinModificador && e.key.length === 1 && e.key !== ' ') {
        const input = campo.current
        if (input) {
          e.preventDefault()
          input.focus()
          const siguiente = input.value + e.key
          // En el acto: la tecla siguiente del lector llega en milisegundos y
          // tiene que encontrar este caracter ya escrito en el campo.
          flushSync(() => {
            alEscribirRef.current(siguiente)
          })
        }
        return
      }

      // Las flechas y Escape con el foco en un lugar sin teclas propias
      // (V6): significan lo mismo que en el campo, y el foco vuelve ahi.
      // Enter solo si el foco no esta en un boton o un enlace: ahi Enter es
      // el boton. Y solo dentro de la venta: en el menu lateral las flechas
      // siguen siendo del navegador.
      const enLaVenta =
        e.target === document.body ||
        (e.target instanceof Element && e.target.closest('main') !== null)
      if (!enLaVenta) return
      const enControl =
        e.target instanceof Element && e.target.closest('button, a[href], summary') !== null
      const esDeLaGramatica =
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'Escape' ||
        (e.key === 'Enter' && !enControl)
      if (sinModificador && esDeLaGramatica) {
        e.preventDefault()
        if (esRepeticionIgnorada(e.key, e.repeat)) return
        const input = campo.current
        input?.focus()
        alPresionarRef.current(e.key, input?.value ?? '')
      }
    }

    window.addEventListener('keydown', alPresionar)
    return () => {
      window.removeEventListener('keydown', alPresionar)
    }
  }, [abrirCobro, abrirCapa, cobroAbierto, hayCapa, puedeCrearProducto])

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
    setUltimaVenta({ id: venta.id, total })
    return venta.id
  }

  function nuevaVenta() {
    vaciar()
    setCobroAbierto(false)
    setTicketAbierto(false)
    setPesando(null)
    setSeleccionada(null)
    setEtapa('productos')
    limpiarBusqueda()
    setEstadoCodigo('idle')
    setMensajeCodigo(null)
    setSinResolver(null)
    setRecargaDeFrecuentes((n) => n + 1)
    void fetchProducts()
    enfocar()
  }

  const cerrarPeso = () => {
    // Se vuelve exactamente al contexto anterior: si se llego con → desde la
    // lista, el nombre buscado sigue escrito y la fila sigue elegida.
    if (pesando?.limpiar === true) limpiarBusqueda()
    setPesando(null)
    enfocar()
  }

  const panelTicket = (
    <Ticket
      lineas={items}
      total={total}
      articulos={articulos}
      seleccionada={seleccionada}
      revisando={etapa === 'carrito' && items.length > 0}
      ultimaVenta={ultimaVenta}
      onSeleccionar={(id) => {
        // Tocar una linea es revisar el carrito; las flechas pasan a mandar
        // ahi.
        if (id === null) {
          setSeleccionada(null)
          volverAProductos()
        } else if (etapaRef.current === 'carrito') {
          setSeleccionada(id)
        } else {
          entrarAlCarrito(id)
        }
      }}
      onVolverAlCampo={enfocar}
      onCantidad={cambiarCantidad}
      onAjustar={ajustarLinea}
      onQuitar={quitarLinea}
      onEditando={(editando) => {
        setEditandoCantidad(editando)
        // Terminada la cantidad escrita a mano, el foco vuelve al campo: el
        // proximo codigo leido tiene que caer ahi y no en la nada. Pero
        // despues de que el foco termine de moverse: si se fue con Tab al "+"
        // o con un clic a otra linea, se respeta. Moverlo durante la salida
        // cancelaba ese movimiento y dejaba el resto del ticket sin Tab.
        if (!editando) {
          requestAnimationFrame(() => {
            const activo = document.activeElement
            if (activo === null || activo === document.body) enfocar()
          })
        }
      }}
      onVaciar={() => {
        conDeshacer('Carrito vaciado', () => {
          vaciar()
          setSeleccionada(null)
          setEtapa('productos')
          enfocar()
        })
      }}
      onCobrar={abrirCobro}
      onSalir={() => {
        volverAProductos()
        campo.current?.focus()
      }}
      puedeCobrar={items.length > 0}
      className="h-full"
    />
  )

  const etapaVisible = cobroAbierto ? 'cobro' : etapa

  const cabecera = (
    <div className="flex items-center gap-2">
      <ScannerInput
        ref={campo}
        value={texto}
        onValueChange={alEscribir}
        onKey={alPresionarEnElCampo}
        status={estadoCodigo}
        message={mensajeCodigo}
        loading={buscando && isLoading}
        hint={ayudaEnTexto(etapaVisible)}
        pie={false}
        label="Escaneá o buscá un producto"
        placeholder="Escaneá el código o escribí el nombre…"
        onEditingChange={setEscribiendo}
        className="min-w-0 flex-1"
      />
      <IconButton
        label="Escanear con la cámara"
        variant="secondary"
        size="lg"
        onClick={() => {
          abrirCapa(() => {
            setCamaraAbierta(true)
          })
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
                abrirCapa(() => {
                  setCodigoDelAlta(null)
                  setAltaAbierta(true)
                })
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
                abrirCapa(() => {
                  setCodigoDelAlta(null)
                  setAltaAbierta(true)
                })
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

  /**
   * Lo elegido con las flechas, para quien no lo ve.
   *
   * El foco no se mueve --vive en el campo, por el lector-- asi que nada lo
   * anuncia solo. Es el mismo recurso que ya usa el carrito para su linea
   * elegida, y con el mismo texto que dice la fila.
   */
  const productoAnunciado =
    etapa === 'productos' && indiceResaltado >= 0 ? visibles[indiceResaltado] : undefined
  const enCarritoAnunciado = productoAnunciado ? enCarrito.get(productoAnunciado.id) : undefined
  const anuncioDeSeleccion = (
    // `aria-live` sin `role="status"`: el resultado del lector ya es el
    // `status` de esta pantalla, y dos regiones con el mismo rol se pisan.
    <p className="sr-only" aria-live="polite">
      {productoAnunciado
        ? `${productoAnunciado.name}, ${formatearCantidadConUnidad(productoAnunciado.sellableStock, productoAnunciado.saleUnit)}${enCarritoAnunciado ? `, ${enCarritoAnunciado} en el carrito` : ''}`
        : ''}
    </p>
  )

  /**
   * El renglon de abajo del campo: las secciones y lo ultimo que paso.
   *
   * Uno solo, de 28 px, y SIEMPRE presente --tambien mientras se busca--.
   * Antes eran dos: los chips, que desaparecian al buscar y hacian saltar la
   * lista 40 px, y el pie del campo. Juntos costaban una fila y media de
   * producto y se movian solos.
   */
  const barraDeSecciones = (
    <div className="flex min-h-7 shrink-0 items-center gap-3">
      <Secciones
        seccion={seccion}
        onSeccion={elegirSeccion}
        categorias={categories}
        hayFrecuentes={hayFrecuentes}
        deshabilitado={buscando}
        className="min-w-0 flex-1"
      />
      {/* El resultado del ultimo codigo. El error se queda. Lo que hacen las
          teclas va en la guia de arriba (V6). */}
      {mensajeCodigo && (
        <p
          aria-hidden="true"
          className={cn(
            'shrink-0 truncate text-sm',
            estadoCodigo === 'error'
              ? 'max-w-[45%] font-semibold text-danger'
              : 'hidden max-w-[50%] font-medium text-ink sm:block',
          )}
        >
          {mensajeCodigo}
        </p>
      )}
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
            abrirCapa(() => {
              setCodigoDelAlta(sinResolver.codigo)
              setAltaAbierta(true)
            })
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
            enfocar()
          }}
        />
      )}
    </>
  )

  return (
    <>
      {anuncioDeSeleccion}
      {/* Junto al titulo "Vender": consultar lo vendido sin perder el carrito. */}
      {puedeVerVentas && (
        <AccionesDeCabecera>
          <Button
            variant="secondary"
            size="sm"
            data-ventas-de-hoy=""
            onClick={() => {
              abrirCapa(() => {
                setVentasDeHoyAbierto(true)
              })
            }}
          >
            Ventas de hoy
          </Button>
        </AccionesDeCabecera>
      )}
      <POSLayout
        cabecera={
          <>
            {cabecera}
            <GuiaDeTeclado etapa={etapaVisible} className="hidden shrink-0 md:flex" />
          </>
        }
        secciones={barraDeSecciones}
        avisos={avisos}
        catalogo={
          <ProductBrowser
            busqueda={buscando ? texto : null}
            seccion={seccion}
            productos={visibles}
            cargando={cargandoCatalogo}
            error={error}
            total={totalVisible}
            hayMas={hayMasParaVer}
            onCargarMas={cargarMas}
            resaltado={indiceResaltado}
            listaActiva={etapa === 'productos'}
            onResaltar={(i) => {
              setEtapa('productos')
              setElegido(visibles[i]?.id ?? null)
            }}
            onElegir={tocarProducto}
            onAjustar={(p, delta) => {
              setEtapa('productos')
              setElegido(p.id)
              ajustarProducto(p, delta)
            }}
            onContinuar={() => {
              campo.current?.focus()
              alPresionarRef.current('Enter', '')
            }}
            enCarrito={enCarrito}
            esFavorito={favoritos.esFavorito}
            onFavorito={favoritos.alternar}
            onVolverAlLector={() => {
              setEtapa('productos')
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
          if (items.length > 0) setEtapa('carrito')
          abrirCapa(() => {
            setTicketAbierto(true)
          })
        }}
        onCerrarTicket={volverAProductos}
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
          enfocar()
        }}
        onCreado={usarProductoNuevo}
        onYaExistia={usarProductoNuevo}
        onCategoriaCreada={() => {
          void fetchCategories()
        }}
      />

      <VentasDeHoy
        abierto={ventasDeHoyAbierto}
        onCerrar={() => {
          setVentasDeHoyAbierto(false)
          enfocar()
        }}
      />

      <EscanerCamara
        abierto={camaraAbierta}
        onCerrar={() => {
          setCamaraAbierta(false)
          enfocar()
        }}
        onCodigo={(codigo) => {
          void procesarCodigo(codigo)
        }}
      />

      <DialogoCobro
        abierto={cobroAbierto}
        onCerrar={() => {
          // Esc en el cobro vuelve al carrito, con la venta intacta.
          setCobroAbierto(false)
          if (items.length > 0) setEtapa('carrito')
          enfocar()
        }}
        lineas={items}
        total={total}
        onCobrar={cobrar}
        onNuevaVenta={nuevaVenta}
      />
    </>
  )
}
