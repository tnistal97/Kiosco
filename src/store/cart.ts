import { create } from 'zustand'
import { CERO, sumarMontos, type Monto } from '@/lib/money'
import {
  aMilesimas,
  cantidad as normalizar,
  desdeMilesimas,
  precioPorCantidad,
  sumarCantidades,
  type TextoCantidad,
} from '@/lib/cantidad'
import { politicaDe, type UnidadDeVenta } from '@/modules/products/units'

/**
 * El ticket en curso.
 *
 * Dos decisiones que valen mas que el codigo:
 *
 * 1. **El precio y el stock que hay aca son de referencia.** Sirven para
 *    mostrar el total mientras se arma el ticket. La venta se cobra con el
 *    precio que decide el servidor: el cuerpo de `POST /api/sales` ni
 *    siquiera declara un campo de precio, asi que mandarlo hace fallar la
 *    peticion. Si alguien edita este objeto desde la consola, lo unico que
 *    consigue es ver un total que no coincide con el que le van a cobrar.
 *
 * 2. **Lo que se guarda en el navegador es el minimo.** Producto, cantidad,
 *    sucursal y momento. Nada de precios como fuente de verdad, nada de
 *    costos, nada de permisos, nada del usuario. Al restaurar se vuelve a
 *    preguntar al servidor por cada producto.
 *
 * El motivo de persistir: un F5 en medio de una venta de quince articulos
 * obligaba a rehacerla entera.
 */

const CLAVE = 'kiosco:ticket'

/**
 * Version 2 desde la Fase 3B.
 *
 * En la 1 la cantidad se guardaba como NUMERO. Leer un `2` viejo como
 * `TextoCantidad` daria `"2"` --que casualmente funciona-- pero un `0.425`
 * guardado en punto flotante podria volver como `0.42500000000000004`. El
 * cambio de version descarta los tickets anteriores en vez de arriesgarse a
 * interpretarlos mal: se pierde un ticket a medias, una sola vez, en el
 * despliegue.
 */
const VERSION = 2

/** Un ticket mas viejo que esto no se restaura: ya no es el de este turno. */
const VIGENCIA_MS = 12 * 60 * 60 * 1000

export interface CartLine {
  productId: number
  name: string
  barcode: string | null
  /** Ultimo precio conocido del servidor. Referencia, no fuente de verdad. */
  price: Monto
  /** Ultimo stock conocido del servidor, en la unidad de venta. */
  stock: TextoCantidad
  quantity: TextoCantidad
  saleUnit: UnidadDeVenta
}

/** Lo que de verdad se escribe en el navegador. */
interface TicketGuardado {
  v: number
  branchId: number
  ts: number
  lines: Array<{ p: number; q: TextoCantidad }>
}

export type ResultadoAgregar = 'agregado' | 'sumado' | 'sin-stock' | 'tope-de-stock'

export interface ProductoParaTicket {
  id: number
  name: string
  barcode: string | null
  price: Monto
  totalStock: TextoCantidad
  saleUnit: UnidadDeVenta
}

interface CartState {
  branchId: number | null
  items: CartLine[]
  /** Cambia cuando el ticket se rehidrata: sirve para no pintar antes de tiempo. */
  hidratado: boolean

  add: (producto: ProductoParaTicket, cantidad?: TextoCantidad) => ResultadoAgregar
  setQuantity: (productId: number, cantidad: TextoCantidad) => void
  remove: (productId: number) => void
  clear: () => void

  /** Refresca precio y stock de una linea con lo que dijo el servidor. */
  sincronizar: (frescos: ProductoParaTicket[]) => void

  /** Fija la sucursal del ticket y descarta el guardado si es de otra. */
  usarSucursal: (branchId: number) => void

  /** Vuelca el ticket guardado en memoria. No consulta al servidor. */
  hidratar: (branchId: number) => Array<{ p: number; q: TextoCantidad }>
}

/**
 * Total del ticket. Referencia: el definitivo lo calcula el servidor.
 *
 * La cuenta se hace en enteros --centavos por milesimas, dentro de
 * `precioPorCantidad`--, no en punto flotante. Con 0,425 kg a $9.800,
 * `9800 * 0.425` en `Float` da `4164.999999999999` y el ticket mostraria un
 * centavo menos que el que despues cobra el servidor.
 */
export function totalDelTicket(items: CartLine[]): Monto {
  if (items.length === 0) return CERO
  return sumarMontos(...items.map((i) => precioPorCantidad(i.price, i.quantity)))
}

/**
 * Cuantos articulos hay en el ticket.
 *
 * Cuenta LINEAS, no unidades, y desde la Fase 3B no puede ser de otra manera:
 * sumar 3 unidades de gaseosa con 0,425 kg de queso daria 3,425 de nada.
 */
export function articulosDelTicket(items: CartLine[]): number {
  return items.length
}

/** La cantidad con la que se agrega un producto cuando nadie la especifica. */
export function cantidadInicial(unidad: UnidadDeVenta): TextoCantidad {
  return politicaDe(unidad).minimo
}

function guardar(branchId: number | null, items: CartLine[]): void {
  if (typeof window === 'undefined') return
  try {
    if (branchId === null || items.length === 0) {
      localStorage.removeItem(CLAVE)
      return
    }
    const datos: TicketGuardado = {
      v: VERSION,
      branchId,
      ts: Date.now(),
      lines: items.map((i) => ({ p: i.productId, q: i.quantity })),
    }
    localStorage.setItem(CLAVE, JSON.stringify(datos))
  } catch {
    // Modo privado o almacenamiento lleno. El ticket sigue en memoria; lo
    // unico que se pierde es sobrevivir a un F5.
  }
}

function leer(): TicketGuardado | null {
  if (typeof window === 'undefined') return null
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return null

    const datos: unknown = JSON.parse(crudo)
    if (typeof datos !== 'object' || datos === null) return null

    // Todo lo que sale de `localStorage` es `unknown` de verdad: lo escribio
    // esta aplicacion, pero pudo escribirlo una version anterior, o una mano
    // desde la consola del navegador. Se comprueba campo por campo.
    const d = datos as Record<string, unknown>
    if (d.v !== VERSION) return null
    if (typeof d.branchId !== 'number' || typeof d.ts !== 'number') return null
    if (!Array.isArray(d.lines)) return null

    if (Date.now() - d.ts > VIGENCIA_MS) return null

    const crudas: unknown[] = d.lines
    const lines = crudas
      .flatMap((l): Array<{ p: number; q: TextoCantidad }> => {
        if (typeof l !== 'object' || l === null) return []
        const linea = l as { p?: unknown; q?: unknown }
        if (typeof linea.p !== 'number') return []
        if (typeof linea.q !== 'string') return []
        try {
          return [{ p: Math.trunc(linea.p), q: normalizar(linea.q) }]
        } catch {
          return []
        }
      })
      .slice(0, 200)

    return { v: VERSION, branchId: d.branchId, ts: d.ts, lines }
  } catch {
    return null
  }
}

export function olvidarTicketGuardado(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(CLAVE)
  } catch {
    // Nada que hacer: el ticket ya se vacio en memoria.
  }
}

/**
 * La cantidad, ajustada al paso de su unidad y acotada al stock.
 *
 * El paso importa tanto como el tope: sin el, `setQuantity(3.7)` sobre un
 * producto que se vende por unidad dejaria 3,7 unidades en el ticket, el
 * servidor lo rechazaria y el cajero no entenderia por que. Se redondea al
 * multiplo mas cercano, que es lo que hace el campo numerico.
 */
function acotar(
  cantidad: TextoCantidad,
  stock: TextoCantidad,
  unidad: UnidadDeVenta,
): TextoCantidad {
  const politica = politicaDe(unidad)
  const paso = aMilesimas(politica.paso)
  const minimo = aMilesimas(politica.minimo)
  const tope = aMilesimas(stock)

  const enPaso = Math.round(aMilesimas(cantidad) / paso) * paso
  return desdeMilesimas(Math.min(tope, Math.max(minimo, enPaso)))
}

export const useCartStore = create<CartState>((set, get) => ({
  branchId: null,
  items: [],
  hidratado: false,

  add(producto, cantidad) {
    if (aMilesimas(producto.totalStock) <= 0) return 'sin-stock'

    const pedida = cantidad ?? cantidadInicial(producto.saleUnit)
    const { items, branchId } = get()
    const existente = items.find((i) => i.productId === producto.id)

    if (existente) {
      const deseada = sumarCantidades(existente.quantity, pedida)
      const permitida = acotar(deseada, producto.totalStock, producto.saleUnit)
      if (permitida === existente.quantity) return 'tope-de-stock'

      const nuevos = items.map((i) =>
        i.productId === producto.id
          ? {
              ...i,
              quantity: permitida,
              price: producto.price,
              stock: producto.totalStock,
              saleUnit: producto.saleUnit,
            }
          : i,
      )
      set({ items: nuevos })
      guardar(branchId, nuevos)
      return 'sumado'
    }

    const nuevos: CartLine[] = [
      ...items,
      {
        productId: producto.id,
        name: producto.name,
        barcode: producto.barcode,
        price: producto.price,
        stock: producto.totalStock,
        saleUnit: producto.saleUnit,
        quantity: acotar(pedida, producto.totalStock, producto.saleUnit),
      },
    ]
    set({ items: nuevos })
    guardar(branchId, nuevos)
    return 'agregado'
  },

  setQuantity(productId, cantidad) {
    const { items, branchId } = get()
    // Cero no vacia la linea por accidente: quitar es una accion aparte, con
    // su propio boton. Un cero tipeado se corrige al minimo de su unidad.
    const nuevos = items.map((i) =>
      i.productId === productId ? { ...i, quantity: acotar(cantidad, i.stock, i.saleUnit) } : i,
    )
    set({ items: nuevos })
    guardar(branchId, nuevos)
  },

  remove(productId) {
    const { items, branchId } = get()
    const nuevos = items.filter((i) => i.productId !== productId)
    set({ items: nuevos })
    guardar(branchId, nuevos)
  },

  clear() {
    set({ items: [] })
    olvidarTicketGuardado()
  },

  sincronizar(frescos) {
    const { items, branchId } = get()
    const porId = new Map(frescos.map((p) => [p.id, p]))
    const nuevos = items
      // Un producto que el servidor ya no devuelve --borrado o dado de baja--
      // desaparece del ticket.
      .filter((i) => porId.has(i.productId))
      .map((i) => {
        const p = porId.get(i.productId)
        if (!p) return i
        return {
          ...i,
          name: p.name,
          barcode: p.barcode,
          price: p.price,
          stock: p.totalStock,
          saleUnit: p.saleUnit,
          quantity: acotar(i.quantity, p.totalStock, p.saleUnit),
        }
      })
      .filter((i) => aMilesimas(i.stock) > 0)

    set({ items: nuevos })
    guardar(branchId, nuevos)
  },

  usarSucursal(branchId) {
    const actual = get().branchId
    if (actual === branchId) return

    if (actual === null) {
      // Primera vez en esta pestania. NO es un cambio de sucursal: es el
      // arranque, y el ticket guardado todavia no se leyo. Borrarlo aca
      // dejaba sin efecto la restauracion entera --lo detecto la prueba de
      // extremo a extremo del F5--. De si el ticket guardado corresponde a
      // esta sucursal se ocupa `hidratar`.
      set({ branchId })
      return
    }

    // Cambio de sucursal de verdad: el ticket anterior no vale aca, porque
    // los precios y el stock son de otra sucursal.
    set({ branchId, items: [] })
    olvidarTicketGuardado()
  },

  hidratar(branchId) {
    const guardado = leer()
    set({ branchId, hidratado: true })

    if (!guardado || guardado.branchId !== branchId) {
      // Ticket de otra sucursal o vencido: se descarta sin preguntar.
      olvidarTicketGuardado()
      return []
    }
    return guardado.lines
  },
}))
