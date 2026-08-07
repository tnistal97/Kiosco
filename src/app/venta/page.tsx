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
import { DialogoCobro, type MedioDePago } from '@/components/venta/DialogoCobro'
import { AyudaAtajos } from '@/components/venta/AyudaAtajos'
import { EscanerCamara } from '@/components/venta/EscanerCamara'
import { useSession } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { buscarProductosPorIds, useProducts, type Product } from '@/hooks/useProducts'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parseVenta } from '@/modules/sales/dto'
import { useHayCapaAbierta } from '@/store/overlays'
import { totalDelTicket, unidadesDelTicket, useCartStore } from '@/store/cart'

/** Cuantos resultados se muestran. Mas no entran en pantalla sin scroll. */
const RESULTADOS_VISIBLES = 8

export default function VentaPage() {
  const { session } = useSession()
  const hayCapa = useHayCapaAbierta()

  const { products, searchTerm, setSearchTerm, buscarPorCodigo, isLoading, error, fetchProducts } =
    useProducts({
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
  const [estadoCodigo, setEstadoCodigo] = useState<BarcodeStatus>('idle')
  const [mensajeCodigo, setMensajeCodigo] = useState<string | null>(null)
  const [avisoRestauracion, setAvisoRestauracion] = useState<string | null>(null)

  const campoCodigo = useRef<HTMLInputElement>(null)
  const campoBusqueda = useRef<HTMLInputElement>(null)

  const total = useMemo(() => totalDelTicket(items), [items])
  const unidades = useMemo(() => unidadesDelTicket(items), [items])

  /**
   * El escaner escucha salvo cuando molestaria.
   *
   * Con un dialogo o un cajon abierto, mientras se edita una cantidad y
   * mientras el cursor esta en el campo de codigo --que se maneja solo--.
   * Es lo que impide que un escaneo agregue productos detras de la pantalla
   * de cobro.
   */
  const escanerActivo = !hayCapa && !editandoCantidad && !escribiendoCodigo && !cobroAbierto

  const visibles = products.slice(0, RESULTADOS_VISIBLES)

  // ---------------------------------------------------------------- ticket

  const devolverFoco = useCallback(() => {
    // Un `setTimeout` de 0 deja que el dialogo termine de desmontarse antes
    // de mover el foco; si no, Headless UI lo devuelve al abridor y pisa esto.
    setTimeout(() => campoCodigo.current?.focus(), 0)
  }, [])

  const agregarProducto = useCallback(
    (p: Product, cantidad = 1) => {
      const r = agregar(
        {
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          price: p.price,
          totalStock: p.totalStock,
        },
        cantidad,
      )
      if (r === 'sin-stock') {
        aviso.atencion(`${p.name} está agotado.`)
        return false
      }
      if (r === 'tope-de-stock') {
        aviso.atencion(`No quedan más unidades de ${p.name}.`)
        return false
      }
      return true
    },
    [agregar],
  )

  // --------------------------------------------------------------- escaneo

  const procesarCodigo = useCallback(
    async (codigo: string) => {
      setEstadoCodigo('reading')
      setMensajeCodigo(null)
      try {
        // Primero entre los activos, que es lo normal.
        const activo = await buscarPorCodigo(codigo)
        if (activo) {
          const ok = agregarProducto(activo)
          setEstadoCodigo(ok ? 'ok' : 'error')
          setMensajeCodigo(
            ok ? `${activo.name} · agregado` : `${activo.name} · sin stock disponible`,
          )
          return
        }

        // Si no aparece, se mira si existe pero esta dado de baja: no es lo
        // mismo "no existe" que "lo sacamos de venta", y el cajero necesita
        // poder decirselo al cliente.
        const cualquiera = await buscarPorCodigo(codigo, { soloActivos: false })
        setEstadoCodigo('error')
        setMensajeCodigo(
          cualquiera
            ? `${cualquiera.name} está dado de baja y no se puede vender`
            : `Código ${codigo} desconocido`,
        )
      } catch (err) {
        setEstadoCodigo('error')
        setMensajeCodigo(mensajeDeError(err, 'No se pudo consultar el código.'))
      }
    },
    [agregarProducto, buscarPorCodigo],
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
          if (p.totalStock <= 0) {
            cambios.push(`${p.name} quedó sin stock`)
            continue
          }
          const cantidad = Math.min(linea.q, p.totalStock)
          if (cantidad < linea.q) cambios.push(`${p.name}: solo quedan ${p.totalStock}`)
          agregar(
            {
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              price: p.price,
              totalStock: p.totalStock,
            },
            cantidad,
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
  }, [cobroAbierto, hayCapa, items.length, visibles.length])

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
        agregarProducto(elegido)
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

  async function cobrar(medio: MedioDePago): Promise<number> {
    const venta = await apiRequest('/api/sales', {
      method: 'POST',
      // Solo producto y cantidad: el precio, el total y la sucursal los pone
      // el servidor. El esquema ni siquiera declara esos campos.
      body: {
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        paymentMethod: medio,
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
    setSearchTerm('')
    setResaltado(0)
    setEstadoCodigo('idle')
    setMensajeCodigo(null)
    void fetchProducts()
    devolverFoco()
  }

  const panelTicket = (
    <Ticket
      lineas={items}
      total={total}
      unidades={unidades}
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
                    agregarProducto(p)
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
          {unidades > 0 && (
            <span
              className="ml-1.5 rounded-full bg-primary px-2 py-0.5 text-xs text-ink-on-solid"
              data-numeric=""
            >
              {unidades}
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
