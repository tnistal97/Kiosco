'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  BarcodeInput,
  Button,
  Drawer,
  EmptyState,
  IconButton,
  SearchInput,
  SkeletonRows,
  aviso,
  cn,
  type BarcodeStatus,
} from '@/components/ui'
import { ResultadoBusqueda } from '@/components/venta/ResultadoBusqueda'
import { Ticket } from '@/components/venta/Ticket'
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
import { useSession, usePermiso } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { buscarProductosPorIds, useProducts, type Product } from '@/hooks/useProducts'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parseVenta } from '@/modules/sales/dto'
import { useHayCapaAbierta } from '@/store/overlays'
import { articulosDelTicket, totalDelTicket, useCartStore } from '@/store/cart'
import { aMilesimas, type TextoCantidad } from '@/lib/cantidad'
import { esFraccionable, formatearCantidadConUnidad } from '@/modules/products/units'
import { motivoDeCodigoInvalido, normalizarCodigo } from '@/modules/products/barcode'

/** Cuantos resultados se muestran. Mas no entran en pantalla sin scroll. */
const RESULTADOS_VISIBLES = 8

/**
 * Cuanto se insiste en devolver el foco al lector despues de cerrar un dialogo,
 * y cada cuanto. Cubre con holgura la transicion de salida (`duration-150`),
 * que es cuando Headless UI devuelve el foco a quien abrio.
 */
const MS_ESPERA_FOCO = 600
const MS_ENTRE_INTENTOS = 40

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

  const [resaltado, setResaltado] = useState(0)
  const [editandoCantidad, setEditandoCantidad] = useState(false)
  const [escribiendoCodigo, setEscribiendoCodigo] = useState(false)
  const [cobroAbierto, setCobroAbierto] = useState(false)
  const [ticketAbierto, setTicketAbierto] = useState(false)
  const [camaraAbierta, setCamaraAbierta] = useState(false)
  /** El producto cuyo peso se esta pidiendo. Null: no hay dialogo de peso. */
  const [pesando, setPesando] = useState<Product | null>(null)
  const [estadoCodigo, setEstadoCodigo] = useState<BarcodeStatus>('idle')
  const [mensajeCodigo, setMensajeCodigo] = useState<string | null>(null)
  const [avisoRestauracion, setAvisoRestauracion] = useState<string | null>(null)
  /**
   * El ultimo codigo que NO se resolvio en una linea del ticket.
   *
   * Null mientras todo va bien: el camino del producto encontrado no muestra
   * nada extra y sigue siendo instantaneo.
   */
  const [sinResolver, setSinResolver] = useState<EstadoDelCodigo | null>(null)
  /** Codigo con el que se abre el alta rapida. `null` = alta manual. */
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [codigoDelAlta, setCodigoDelAlta] = useState<string | null>(null)

  const campoCodigo = useRef<HTMLInputElement>(null)
  const campoBusqueda = useRef<HTMLInputElement>(null)

  const total = useMemo(() => totalDelTicket(items), [items])
  const articulos = articulosDelTicket(items)

  /**
   * El escaner escucha salvo cuando molestaria.
   *
   * Con un dialogo o un cajon abierto, mientras se edita una cantidad y
   * mientras el cursor esta en el campo de codigo --que se maneja solo--.
   * Es lo que impide que un escaneo agregue productos detras de la pantalla
   * de cobro.
   */
  const escanerActivo =
    !hayCapa &&
    !editandoCantidad &&
    !escribiendoCodigo &&
    !cobroAbierto &&
    pesando === null &&
    !altaAbierta

  const visibles = products.slice(0, RESULTADOS_VISIBLES)

  // ---------------------------------------------------------------- ticket

  /**
   * El foco vuelve al lector, y se INSISTE hasta que quede.
   *
   * Un `setTimeout` de cero no alcanza. Headless UI devuelve el foco al elemento
   * que lo tenia antes de abrir, y lo hace cuando termina la transicion de
   * salida, no al desmontar. Mientras el abridor desaparecia junto con el
   * dialogo --el boton de cobrar, el de peso-- no se notaba: no habia adonde
   * devolverlo. Con el alta rapida si, porque el boton "Crear producto" sigue en
   * pantalla y se lleva el foco despues de que nosotros lo pusimos.
   *
   * Se insiste en vez de esperar un numero fijo porque la duracion depende de la
   * transicion y de la maquina, y un numero fijo es una carrera que se gana casi
   * siempre. Casi siempre no sirve: el sintoma es que el escaneo siguiente no
   * entra en ningun lado, y eso en una caja es el sistema roto.
   *
   * Lo encontro la prueba 7 de `e2e/alta-rapida.spec.ts`.
   */
  const devolverFoco = useCallback(() => {
    const campo = campoCodigo.current
    if (!campo) return

    campo.focus()

    // Se insiste toda la ventana, SIN cortar al primer acierto. Cortar ahi era
    // el error de la primera version: el foco quedaba en el campo a los 240 ms,
    // el intervalo se detenia, y Headless UI lo devolvia al abridor a los 300.
    let restantes = Math.ceil(MS_ESPERA_FOCO / MS_ENTRE_INTENTOS)
    const id = setInterval(() => {
      campo.focus()
      restantes--
      if (restantes <= 0) clearInterval(id)
    }, MS_ENTRE_INTENTOS)
  }, [])

  const agregarProducto = useCallback(
    (p: Product, cantidad?: TextoCantidad) => {
      const r = agregar(
        {
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          price: p.price,
          totalStock: p.totalStock,
          saleUnit: p.saleUnit,
        },
        cantidad,
      )
      if (r === 'sin-stock') {
        aviso.atencion(`${p.name} está agotado.`)
        return false
      }
      if (r === 'tope-de-stock') {
        aviso.atencion(`No queda más stock de ${p.name}.`)
        return false
      }
      return true
    },
    [agregar],
  )

  /**
   * Lo que pasa al elegir un producto, por escaneo o por busqueda.
   *
   * Un producto por unidad se agrega y listo. Uno que se pesa abre el dialogo
   * INMEDIATAMENTE, sin pasos intermedios: despues de pasar un queso por el
   * lector, lo unico que puede seguir es el peso. Pedir un clic mas seria
   * hacerle avisar al cajero algo que el sistema ya sabe.
   */
  const elegirProducto = useCallback(
    (p: Product): boolean => {
      if (aMilesimas(p.totalStock) <= 0) {
        aviso.atencion(`${p.name} está agotado.`)
        return false
      }
      if (esFraccionable(p.saleUnit)) {
        setPesando(p)
        return true
      }
      return agregarProducto(p)
    },
    [agregarProducto],
  )

  // --------------------------------------------------------------- escaneo

  /**
   * Que hacer con un codigo leido.
   *
   * UNA sola consulta, con `soloActivos: false`. Antes eran dos --primero entre
   * los activos y despues entre todos-- lo que duplicaba el trabajo del camino
   * mas frecuente de todos los que fallan: el codigo que no existe pagaba dos
   * viajes al servidor para enterarse de lo mismo. Las dos consultas eran
   * ademas literalmente la misma: el filtro de activo se aplica despues de leer
   * la fila, no en la consulta.
   *
   * Los cinco desenlaces se distinguen, y cada uno tiene su siguiente paso:
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
          // La linea del campo y el bloque de abajo NO dicen lo mismo: repetir
          // la misma frase dos veces en la misma pantalla es ruido, y ademas
          // haria imposible referirse a una de las dos. Acá va el código --que
          // el campo ya vació-- y el bloque explica qué se puede hacer.
          setMensajeCodigo(`${codigo} · sin resultado`)
          setSinResolver({ tipo: 'no-registrado', codigo })
          return
        }

        // Existe pero esta de baja: no es lo mismo "no existe" que "lo sacamos
        // de venta", y el cajero necesita poder decirselo al cliente.
        if (!producto.isActive) {
          setEstadoCodigo('error')
          // Corto, por lo mismo que arriba: el bloque de abajo ya explica el
          // caso entero y ofrece reactivar. Repetir la frase completa deja dos
          // veces el mismo texto en la misma pantalla.
          setMensajeCodigo(`${producto.name} · dado de baja`)
          setSinResolver({
            tipo: 'inactivo',
            codigo,
            nombre: producto.name,
            productId: producto.id,
          })
          return
        }

        const ok = elegirProducto(producto)
        setEstadoCodigo(ok ? 'ok' : 'error')
        setMensajeCodigo(
          ok
            ? esFraccionable(producto.saleUnit)
              ? `${producto.name} · ingresá el peso`
              : `${producto.name} · agregado`
            : `${producto.name} · sin stock disponible`,
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
      const ok = elegirProducto(p)
      setEstadoCodigo(ok ? 'ok' : 'error')
      setMensajeCodigo(
        ok
          ? esFraccionable(p.saleUnit)
            ? `${p.name} · ingresá el peso`
            : `${p.name} · agregado`
          : `${p.name} · sin stock disponible`,
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
          // La respuesta no se usa: lo que interesa es el estado nuevo, y ese
          // se relee escaneando otra vez el mismo codigo.
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

  // Sucursal primero: si cambio, el ticket guardado no vale y se descarta.
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
          if (aMilesimas(p.totalStock) <= 0) {
            cambios.push(`${p.name} quedó sin stock`)
            continue
          }
          if (aMilesimas(linea.q) > aMilesimas(p.totalStock)) {
            cambios.push(
              `${p.name}: solo quedan ${formatearCantidadConUnidad(p.totalStock, p.saleUnit)}`,
            )
          }
          // El store acota al stock por su cuenta, con el paso de la unidad.
          agregar(
            {
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              price: p.price,
              totalStock: p.totalStock,
              saleUnit: p.saleUnit,
            },
            linea.q,
          )
          restauradas++
        }

        if (restauradas > 0) {
          setAvisoRestauracion(
            cambios.length > 0
              ? `Se recuperó el ticket. Cambios: ${cambios.join('; ')}.`
              : 'Se recuperó el ticket que había quedado abierto.',
          )
        }
      } catch {
        // Sin red no se restaura nada. Es preferible a restaurar con precios
        // viejos del navegador, que es justamente lo que no debe pasar.
        setAvisoRestauracion('No se pudo recuperar el ticket anterior: no hubo respuesta del servidor.') // prettier-ignore
      }
    }

    void restaurar(sucursal)
    return () => {
      vivo = false
    }
    // Depende SOLO de la sucursal. `agregar` e `hidratar` son estables
    // (vienen del store de zustand y no cambian de identidad), y agregarlas
    // no cambiaria nada; lo que si importa es que este efecto no se vuelva a
    // ejecutar por otro motivo, porque restaurar dos veces duplicaria las
    // lineas del ticket.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ver comentario
  }, [sucursal])

  // El foco arranca en el codigo: es lo que hace que el lector funcione sin
  // ningun click previo.
  useEffect(() => {
    campoCodigo.current?.focus()
  }, [])

  // --------------------------------------------------------------- atajos

  useEffect(() => {
    function alPresionar(e: KeyboardEvent) {
      const enCampo =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)

      // F12 cobra desde cualquier lado. El navegador lo usa para las
      // herramientas de desarrollo, y en una caja eso no le sirve a nadie.
      if (e.key === 'F12') {
        e.preventDefault()
        if (items.length > 0 && !cobroAbierto) setCobroAbierto(true)
        return
      }

      if (hayCapa || cobroAbierto) return

      // Alt+N abre el alta rapida manual. No choca con nada: los atajos que ya
      // existian son F12, Ctrl+K, "/" y las flechas, y Alt+N no lo usa el
      // navegador. Sin permiso no hace nada, en vez de abrir un formulario que
      // el servidor va a rechazar.
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (puedeCrearProducto) {
          setCodigoDelAlta(null)
          setAltaAbierta(true)
        }
        return
      }

      // Ctrl+K y "/" llevan a la busqueda. La barra sola no, si se esta
      // escribiendo: seria imposible tipear una fraccion.
      if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && !enCampo)) {
        e.preventDefault()
        campoBusqueda.current?.focus()
        return
      }

      if (enCampo) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setResaltado((i) => Math.min(i + 1, Math.max(0, visibles.length - 1)))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setResaltado((i) => Math.max(0, i - 1))
      }
    }

    window.addEventListener('keydown', alPresionar)
    return () => {
      window.removeEventListener('keydown', alPresionar)
    }
  }, [cobroAbierto, hayCapa, items.length, visibles.length, puedeCrearProducto])

  /** Atajos de la lista de resultados, mientras el foco esta en el buscador. */
  function atajosDeBusqueda(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setResaltado((i) => Math.min(i + 1, Math.max(0, visibles.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const elegido = visibles[resaltado]
      if (elegido) {
        elegirProducto(elegido)
        setSearchTerm('')
        setResaltado(0)
        campoCodigo.current?.focus()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setSearchTerm('')
      campoCodigo.current?.focus()
    }
  }

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
        // Las dos claves solo van si corresponden: `.strict()` acepta que
        // falten, y mandar `clientId: null` en cada venta al mostrador seria
        // decir algo donde no hay nada que decir.
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
    setSearchTerm('')
    setResaltado(0)
    setEstadoCodigo('idle')
    setMensajeCodigo(null)
    setSinResolver(null)
    void fetchProducts()
    devolverFoco()
  }

  const panelTicket = (
    <Ticket
      lineas={items}
      total={total}
      articulos={articulos}
      onCantidad={cambiarCantidad}
      onQuitar={quitar}
      onEditando={setEditandoCantidad}
      onVaciar={() => {
        vaciar()
        devolverFoco()
      }}
      onCobrar={() => {
        setCobroAbierto(true)
      }}
      puedeCobrar={items.length > 0}
      className="h-full"
    />
  )

  return (
    <div className="flex h-full min-h-0">
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

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex items-start gap-2 sm:max-w-sm sm:flex-1">
            <BarcodeInput
              ref={campoCodigo}
              status={estadoCodigo}
              message={mensajeCodigo}
              onEditingChange={setEscribiendoCodigo}
              onSubmit={(codigo) => {
                void procesarCodigo(codigo)
              }}
            />
            <IconButton
              label="Escanear con la cámara"
              variant="secondary"
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
          </div>
          {/* Alta manual: para el producto sin codigo, el artesanal o la
              etiqueta rota. Discreto a proposito --no es la operacion normal
              de una caja-- y ausente sin permiso, en vez de deshabilitado. */}
          {puedeCrearProducto && (
            <Button
              variant="secondary"
              className="shrink-0"
              onClick={() => {
                setCodigoDelAlta(null)
                setAltaAbierta(true)
              }}
            >
              + Producto
            </Button>
          )}
          <div className="flex-1">
            <SearchInput
              ref={campoBusqueda}
              label="Buscar un producto por nombre"
              placeholder="Buscar por nombre…"
              hint="Ctrl+K o / para buscar · ↑ ↓ para elegir · Enter para agregar"
              value={searchTerm}
              loading={isLoading && searchTerm !== ''}
              onKeyDown={atajosDeBusqueda}
              onClear={() => {
                setSearchTerm('')
                setResaltado(0)
              }}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setResaltado(0)
              }}
            />
          </div>
        </div>

        {/* Lo que pasó con el último código, cuando no terminó en el ticket.
            Va acá arriba, no en un aviso flotante: un toast que se va solo es
            justamente lo que hacía que el cajero no se enterara. */}
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
          ) : searchTerm === '' ? (
            <EmptyState
              title="Escaneá o buscá un producto"
              description="El lector funciona sin tocar nada. Para buscar por nombre, Ctrl+K."
              className="h-full"
            />
          ) : isLoading ? (
            <SkeletonRows rows={4} />
          ) : visibles.length === 0 ? (
            <EmptyState
              title="Ningún producto coincide"
              description={`No hay resultados activos para "${searchTerm}".`}
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visibles.map((p, i) => (
                <ResultadoBusqueda
                  key={p.id}
                  producto={p}
                  resaltada={i === resaltado}
                  onHover={() => {
                    setResaltado(i)
                  }}
                  onAgregar={() => {
                    elegirProducto(p)
                    campoCodigo.current?.focus()
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        <AyudaAtajos />
      </div>

      {/* Escritorio: el ticket vive en el layout, siempre visible. */}
      <div className="hidden w-ticket shrink-0 border-l border-line lg:flex">{panelTicket}</div>

      {/* Movil y tablet: barra fija con el total y acceso al ticket. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface px-3 py-2.5 lg:hidden',
        )}
      >
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={() => {
            setTicketAbierto(true)
          }}
        >
          Ticket
          {articulos > 0 && (
            <span
              className="ml-1.5 rounded-full bg-primary px-2 py-0.5 text-xs text-ink-on-solid"
              data-numeric=""
            >
              {articulos}
            </span>
          )}
        </Button>
        <Button
          variant="confirm"
          size="lg"
          className="flex-[1.6]"
          disabled={items.length === 0}
          onClick={() => {
            setCobroAbierto(true)
          }}
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
        side="right"
        className="w-[92vw] max-w-md"
      >
        {panelTicket}
      </Drawer>

      <DialogoPeso
        abierto={pesando !== null}
        producto={pesando}
        onCerrar={() => {
          setPesando(null)
          devolverFoco()
        }}
        onConfirmar={(cantidad) => {
          if (pesando) agregarProducto(pesando, cantidad)
          setPesando(null)
          devolverFoco()
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

      {/* Deja aire abajo para que la barra fija no tape el ultimo resultado. */}
      <div aria-hidden="true" className="h-16 lg:hidden" />
    </div>
  )
}
