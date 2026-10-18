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
import { ProductBrowser } from '@/components/venta/ProductBrowser'
import { Secciones, type SeccionDelCatalogo } from '@/components/venta/Secciones'
import { POSLayout } from '@/components/venta/POSLayout'
import { useFavoritos } from '@/components/venta/useFavoritos'
import { useFrecuentes } from '@/components/venta/useFrecuentes'
import { useProductosPorIds } from '@/components/venta/useProductosPorIds'
import { enfocarCampo } from '@/components/venta/foco'
import { useEstadoInmediato } from '@/components/venta/useEstadoInmediato'
import {
  accionDeTecla,
  modoDelCampo,
  moverResaltado,
  moverSeleccion,
  seleccionTrasQuitar,
  type ZonaDelPos,
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
 * El punto de venta. UX V3.
 *
 * Desde el primer momento se ve la estructura entera: el modo, el campo, las
 * secciones, la lista de productos y el ticket con su total y "Cobrar". Se
 * vende de tres maneras que terminan en el mismo lugar: escaneando, tocando
 * una fila, o escribiendo el nombre y eligiendo con las flechas.
 *
 * TRES IDEAS QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO
 * ---------------------------------------------------
 * 1. EL FOCO VIVE EN EL CAMPO. Lo elegido en la lista y en el ticket es
 *    estado, no foco: por eso el lector sigue funcionando mientras se
 *    recorre el catalogo. Solo un dialogo se lleva el foco, y vuelve solo.
 * 2. LA TECLA SIGNIFICA LO QUE DICE LA ZONA. `campo`, `lista` o `ticket`;
 *    la tabla completa esta en `teclado.ts` y es una funcion pura. Esta
 *    pantalla ejecuta, no decide.
 * 3. ENTER NO COBRA. Campo vacio con ticket pasa a REVISAR; revisando abre
 *    el cobro; el cobro exige un pago declarado. Tres pasos deliberados
 *    entre el ultimo producto y una venta registrada.
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

  /** Lo escrito en el campo unico. Digitos: codigo. Letras: busqueda. */
  const [texto, setTexto] = useState('')
  /**
   * A que responden las flechas: al texto, a la lista, o al ticket.
   *
   * El foco del navegador no se mueve --vive en el campo, por el lector--,
   * asi que esto es lo unico que distingue "estoy escribiendo" de "tengo un
   * producto elegido". Ver `teclado.ts`.
   */
  // Los tres se leen y se escriben dentro de la misma rafaga de teclas, asi
  // que van con `useEstadoInmediato`: el manejador de la tecla siguiente
  // tiene que ver lo que hizo la anterior, no el estado del ultimo dibujo.
  const [zona, setZona, zonaRef] = useEstadoInmediato<ZonaDelPos>('campo')
  /** Fila de la lista elegida con ↑ ↓. */
  const [resaltado, setResaltado, resaltadoRef] = useEstadoInmediato(0)
  /** Producto de la linea del ticket elegida con el teclado. */
  const [seleccionada, setSeleccionada, seleccionadaRef] = useEstadoInmediato<number | null>(null)
  const [editandoCantidad, setEditandoCantidad] = useState(false)
  const [escribiendo, setEscribiendo] = useState(false)
  const [cobroAbierto, setCobroAbierto] = useState(false)
  const [ticketAbierto, setTicketAbierto] = useState(false)
  const [camaraAbierta, setCamaraAbierta] = useState(false)
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
      setResaltado(0)
      setZona('campo')
      // Elegir una categoria con el mouse dejaba el foco en el boton, y el
      // proximo codigo leido no caia en el campo (V5).
      enfocarCampo(() => campo.current)
    },
    [setResaltado, setZona],
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
   * "yerba" y bajar enseguida elegia la primera fila de la lista VIEJA, y →
   * agregaba ese producto. Ahora, mientras el servidor no haya contestado
   * para lo que hay escrito, se muestra lo ya cargado que coincide: mismo
   * criterio que el servidor --el nombre contiene el texto, sin distinguir
   * mayusculas-- y una lista que nunca miente.
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
   * Que fila se marca.
   *
   * Eligiendo, la que dicen las flechas. Escribiendo, la PRIMERA y con una
   * marca mas floja: es la que agregaria Enter, y conviene que se vea cual es
   * antes de apretarlo.
   */
  const indiceResaltado = zona === 'lista' ? resaltado : buscando && visibles.length > 0 ? 0 : -1

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
      // Lo que se acaba de agregar queda elegido: → suma una, Supr lo quita.
      setSeleccionada(p.id)
      registrarFrecuente(p.id)
      return null
    },
    [agregar, registrarFrecuente, setSeleccionada],
  )

  /**
   * Lo que pasa al elegir un producto, por escaneo, busqueda o fila.
   *
   * Un producto por unidad se agrega y listo. Uno que se pesa abre el dialogo
   * INMEDIATAMENTE, sin pasos intermedios: despues de pasar un queso por el
   * lector, lo unico que puede seguir es el peso. Vale igual para → sobre una
   * fila: un producto por kilo no tiene "una unidad mas" (decision V3).
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
    setResaltado(0)
    setZona('campo')
    setSearchTerm('')
  }, [setSearchTerm, setResaltado, setZona])

  /**
   * ELEGIR un producto con el teclado (V5): Enter sobre una fila, o Enter con
   * un nombre escrito.
   *
   * Si todavia no esta en el ticket, entra una unidad (o se pide el peso). Si
   * YA esta, NO se suma otra: se selecciona su linea y se avisa que + suma.
   * Era el "Enter que agrega de mas" de la V3: elegir y sumar eran la misma
   * tecla, y repetir un Enter para confirmar dejaba dos unidades.
   */
  const elegirSinSumar = useCallback(
    (p: ProductoVendible): string | null => {
      const linea = items.find((l) => l.productId === p.id)
      if (linea) {
        setSeleccionada(p.id)
        setEstadoCodigo('idle')
        setMensajeCodigo(`${p.name} ya está en el ticket · con + sumás otra unidad`)
        return null
      }
      return elegirProducto(p, { limpiar: true })
    },
    [items, elegirProducto, setSeleccionada],
  )

  /**
   * Una fila del catalogo.
   *
   * Tocada con el mouse o el dedo, agrega una unidad: tocar dos veces la
   * gaseosa son dos gaseosas, como en cualquier caja tactil. Elegida con
   * Enter desde el teclado, ELIGE (ver `elegirSinSumar`). En los dos casos
   * el foco vuelve al campo, que es donde cae el proximo codigo leido.
   */
  const elegirDelCatalogo = useCallback(
    (p: Product, desdeElTeclado: boolean) => {
      if (desdeElTeclado) elegirSinSumar(p)
      else elegirProducto(p, { limpiar: true })
      if (buscando) limpiarBusqueda()
      setZona('campo')
      enfocarCampo(() => campo.current)
    },
    [elegirProducto, elegirSinSumar, buscando, limpiarBusqueda, setZona],
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
      // Un codigo leido manda: lo elegido en la lista o en el ticket se suelta
      // y la pantalla vuelve a estar lista para el siguiente.
      setZona('campo')

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
    [elegirProducto, buscarPorCodigo, setZona],
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

  const abrirCobro = useCallback(() => {
    if (items.length > 0 && !cobroAbierto) {
      abrirCapa(() => {
        setCobroAbierto(true)
      })
    }
  }, [items.length, cobroAbierto, abrirCapa])

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
   * Una unidad mas o menos sobre una linea del ticket.
   *
   * Con una sola unidad, ← la quita: es lo que se espera cuando se resta
   * hasta cero, y volver atras esta a un toque. Un producto por peso no tiene
   * paso: abre el peso.
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
   * + y - sobre la fila resaltada de la LISTA (V5: ya no con las flechas).
   *
   * Suma o resta una unidad de ese producto sin salir de la lista: es la
   * forma EXPLICITA de cambiar una cantidad desde ahi. Las flechas solo
   * recorren.
   */
  const ajustarResaltado = useCallback(
    (delta: -1 | 1) => {
      const p = visibles[resaltadoRef.current]
      if (!p) return
      const linea = items.find((l) => l.productId === p.id)
      if (delta === 1) {
        if (linea && esFraccionable(linea.saleUnit)) editarPeso(linea.productId, false)
        else elegirProducto(p, { limpiar: false })
        return
      }
      // Restar de lo que no esta en el ticket no hace nada: no hay de donde.
      if (linea) ajustarLinea(linea, -1)
    },
    [visibles, resaltadoRef, items, elegirProducto, editarPeso, ajustarLinea],
  )

  // --------------------------------------------------------------- teclado

  /** Lo que se escribe en el campo unico: letras buscan, digitos esperan Enter. */
  function alEscribir(t: string) {
    setTexto(t)
    // Escribir SIEMPRE devuelve el mando al texto: ← y → vuelven a mover el
    // cursor en cuanto se toca una letra, aunque hubiera una fila elegida.
    setZona('campo')
    setResaltado(0)
    if (sinResolver !== null) setSinResolver(null)
    if (modoDelCampo(t) === 'busqueda') setSearchTerm(t)
    else if (searchTerm !== '') setSearchTerm('')
  }

  // La version vigente de `alEscribir`, para el manejador de teclas de la
  // ventana, que se suscribe una sola vez.
  const alEscribirRef = useRef(alEscribir)
  // Y la de las teclas de la gramatica, para + y − con el foco fuera del campo.
  const alPresionarRef = useRef<(tecla: TeclaDelLector, texto: string) => boolean>(() => false)
  useEffect(() => {
    alEscribirRef.current = alEscribir
    alPresionarRef.current = alPresionarEnElCampo
  })

  function alPresionarEnElCampo(tecla: TeclaDelLector, textoActual: string): boolean {
    // Del `ref` y no del render: dos teclas seguidas llegan mas rapido de lo
    // que React vuelve a dibujar.
    const zonaActual = zonaRef.current
    const resaltadoActual = resaltadoRef.current
    const seleccionadaActual = seleccionadaRef.current
    const accion = accionDeTecla(tecla, {
      zona: zonaActual,
      texto: textoActual,
      hayLineas: items.length > 0,
      haySeleccion: seleccionadaActual !== null,
      hayResultados: visibles.length > 0,
      resaltado: resaltadoActual,
      hayAviso: sinResolver !== null,
    })

    switch (accion) {
      case 'buscar-codigo':
        setTexto('')
        setZona('campo')
        void procesarCodigo(textoActual)
        return true
      case 'elegir-resaltado': {
        // Con texto y sin haber bajado todavia, Enter elige el PRIMERO: es lo
        // que dice la lista con la marca tenue del primer renglon. Elegir no
        // es sumar: si ya esta en el ticket, solo se selecciona su linea.
        const elegido = visibles[zonaActual === 'lista' ? resaltadoActual : 0]
        if (elegido) {
          elegirSinSumar(elegido)
          limpiarBusqueda()
        }
        return true
      }
      case 'revisar-ticket':
        // Enter con el campo vacio NO cobra: pasa a revisar el ticket, que es
        // donde se ve lo que se esta por cobrar. El segundo Enter abre el cobro.
        setZona('ticket')
        setSeleccionada((s) => s ?? ids[0] ?? null)
        return true
      case 'cobrar':
        abrirCobro()
        return true
      case 'entrar-a-la-lista':
        setZona('lista')
        setResaltado(0)
        return true
      case 'resultado-anterior':
        setResaltado((i) => moverResaltado(i, -1, visibles.length))
        return true
      case 'resultado-siguiente':
        setResaltado((i) => {
          const siguiente = moverResaltado(i, 1, visibles.length)
          // Bajar desde la ultima trae mas, en vez de quedarse trabado en el
          // final de la pagina cargada.
          if (siguiente === i && hayMas) cargarMas()
          return siguiente
        })
        return true
      case 'sumar-resaltado':
        ajustarResaltado(1)
        return true
      case 'restar-resaltado':
        ajustarResaltado(-1)
        return true
      case 'linea-anterior':
        setSeleccionada(moverSeleccion(ids, seleccionadaActual, -1))
        return true
      case 'linea-siguiente':
        setSeleccionada(moverSeleccion(ids, seleccionadaActual, 1))
        return true
      case 'cantidad-menos':
        ajustarSeleccionada(-1)
        return true
      case 'cantidad-mas':
        ajustarSeleccionada(1)
        return true
      case 'quitar-linea':
        if (seleccionadaActual !== null) quitarLinea(seleccionadaActual)
        return true
      case 'limpiar-campo':
        limpiarBusqueda()
        return true
      case 'volver-al-campo':
        // Escape suelta lo elegido y devuelve el mando al texto, que queda
        // como estaba: un paso atras, sin perder nada.
        setZona('campo')
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

      // Escribir sin estar en el campo lleva al campo (V5).
      //
      // Despues de tocar un boton --una categoria, una linea del ticket, el
      // + de una cantidad-- el foco quedaba ahi, y lo que se tecleaba o se
      // leia con el lector no llegaba a ningun lado. Una tecla imprimible
      // fuera de un campo de texto pone el foco en el campo y ESCRIBE ahi
      // ese caracter (no se confia en que el navegador lo mueva solo: con un
      // lector rapido el primer digito se perdia). Las teclas siguientes ya
      // caen en el campo, y el Enter del lector se procesa ahi, sin depender
      // de ningun reloj.
      //
      // + y − fuera del campo --despues de un clic en un lugar vacio de la
      // pantalla-- cambian la cantidad de la linea elegida, como con el campo
      // vacio. Escribirlos en el campo buscaba "+" y no sumaba nada. Con algo
      // escrito en el campo, se escriben ahi como cualquier tecla.
      const signo = e.key === '−' ? '-' : e.key
      if (
        !enCampo &&
        !e.defaultPrevented &&
        (signo === '+' || signo === '-') &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        (campo.current?.value ?? '') === ''
      ) {
        e.preventDefault()
        if (!e.repeat) alPresionarRef.current(signo, '')
        return
      }

      // El espacio no: activa el boton enfocado. La barra tampoco: es el
      // atajo al campo, mas abajo. Y nada que otro manejador ya haya resuelto
      // (el + y el - del ticket).
      if (
        !enCampo &&
        !e.defaultPrevented &&
        e.key.length === 1 &&
        e.key !== ' ' &&
        e.key !== '/' &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
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
      revisando={zona === 'ticket'}
      ultimaVenta={ultimaVenta}
      onSeleccionar={(id) => {
        setSeleccionada(id)
        setZona(id === null ? 'campo' : 'ticket')
      }}
      onVolverAlCampo={enfocar}
      onCantidad={cambiarCantidad}
      onAjustar={ajustarLinea}
      onQuitar={quitarLinea}
      onEditarPeso={editarPeso}
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
        conDeshacer('Ticket vaciado', () => {
          vaciar()
          setSeleccionada(null)
          setZona('campo')
          enfocar()
        })
      }}
      onCobrar={abrirCobro}
      onSalir={() => {
        setZona('campo')
        setSeleccionada(null)
        campo.current?.focus()
      }}
      puedeCobrar={items.length > 0}
      className="h-full"
    />
  )

  /**
   * La ayuda del campo dice lo que hacen las teclas AHORA.
   *
   * Es la mitad de la seniial de en que estado esta el teclado --la otra
   * mitad es la fila resaltada o el ticket senialado-- y evita el cartel de
   * "modo" que nadie lee. Cambia sola y nunca miente.
   */
  const ayudaDeTeclado =
    zona === 'ticket'
      ? '↑↓ elegir línea · + − cantidad · Supr quitar · Enter cobrar · Esc volver'
      : zona === 'lista'
        ? '↑↓ recorrer · Enter elegir · + − cantidad · Esc volver'
        : buscando
          ? '↓ recorrer la lista · Enter elegir el primero'
          : items.length > 0
            ? 'Enter: pasar a cobrar · + − cantidad de la última línea'
            : 'Escaneá un producto o escribí su nombre'

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
        hint={ayudaDeTeclado}
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
   * El renglon de abajo del campo: las secciones y lo ultimo que paso.
   *
   * Uno solo, de 28 px, y SIEMPRE presente --tambien mientras se busca--.
   * Antes eran dos: los chips, que desaparecian al buscar y hacian saltar la
   * lista 40 px, y el pie del campo. Juntos costaban una fila y media de
   * producto y se movian solos.
   */
  /**
   * Lo elegido con las flechas, para quien no lo ve.
   *
   * El foco no se mueve --vive en el campo, por el lector-- asi que nada lo
   * anuncia solo. Es el mismo recurso que ya usa el ticket para su linea
   * elegida, y con el mismo texto que dice la fila.
   */
  const productoElegido = zona === 'lista' ? visibles[resaltado] : undefined
  const anuncioDeSeleccion = (
    // `aria-live` sin `role="status"`: el resultado del lector ya es el
    // `status` de esta pantalla, y dos regiones con el mismo rol se pisan.
    <p className="sr-only" aria-live="polite">
      {productoElegido
        ? `${productoElegido.name}, ${formatearCantidadConUnidad(productoElegido.sellableStock, productoElegido.saleUnit)}`
        : ''}
    </p>
  )

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
      {/* El resultado del ultimo codigo, o lo que hacen las teclas ahora. El
          error se queda; la ayuda solo donde hay ancho. */}
      <p
        aria-hidden="true"
        className={cn(
          'shrink-0 truncate text-sm',
          estadoCodigo === 'error'
            ? 'max-w-[45%] font-semibold text-danger'
            : mensajeCodigo
              ? 'hidden max-w-[50%] font-medium text-ink sm:block'
              : 'hidden text-ink-muted lg:block',
        )}
      >
        {mensajeCodigo ?? ayudaDeTeclado}
      </p>
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
      <POSLayout
        cabecera={cabecera}
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
            listaActiva={zona === 'lista'}
            onResaltar={setResaltado}
            onElegir={elegirDelCatalogo}
            esFavorito={favoritos.esFavorito}
            onFavorito={favoritos.alternar}
            onVolverAlLector={() => {
              setZona('campo')
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
          abrirCapa(() => {
            setTicketAbierto(true)
          })
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
          enfocar()
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
          enfocar()
        }}
        onCodigo={(codigo) => {
          void procesarCodigo(codigo)
        }}
      />

      <DialogoCobro
        abierto={cobroAbierto}
        onCerrar={() => {
          setCobroAbierto(false)
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
