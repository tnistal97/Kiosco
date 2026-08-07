import { create } from 'zustand'
import { CERO, multiplicarMonto, sumarMontos, type Monto } from '@/lib/money'

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
const VERSION = 1

/** Un ticket mas viejo que esto no se restaura: ya no es el de este turno. */
const VIGENCIA_MS = 12 * 60 * 60 * 1000

export interface CartLine {
  productId: number
  name: string
  barcode: string | null
  /** Ultimo precio conocido del servidor. Referencia, no fuente de verdad. */
  price: Monto
  /** Ultimo stock conocido del servidor. */
  stock: number
  quantity: number
}

/** Lo que de verdad se escribe en el navegador. */
interface TicketGuardado {
  v: number
  branchId: number
  ts: number
  lines: Array<{ p: number; q: number }>
}

export type ResultadoAgregar = 'agregado' | 'sumado' | 'sin-stock' | 'tope-de-stock'

export interface ProductoParaTicket {
  id: number
  name: string
  barcode: string | null
  price: Monto
  totalStock: number
}

interface CartState {
  branchId: number | null
  items: CartLine[]
  /** Cambia cuando el ticket se rehidrata: sirve para no pintar antes de tiempo. */
  hidratado: boolean

  add: (producto: ProductoParaTicket, cantidad?: number) => ResultadoAgregar
  setQuantity: (productId: number, cantidad: number) => void
  remove: (productId: number) => void
  clear: () => void

  /** Refresca precio y stock de una linea con lo que dijo el servidor. */
  sincronizar: (frescos: ProductoParaTicket[]) => void

  /** Fija la sucursal del ticket y descarta el guardado si es de otra. */
  usarSucursal: (branchId: number) => void

  /** Vuelca el ticket guardado en memoria. No consulta al servidor. */
  hidratar: (branchId: number) => Array<{ p: number; q: number }>
}

/**
 * Total del ticket. Referencia: el definitivo lo calcula el servidor.
 *
 * La cuenta se hace en centavos enteros --dentro de `multiplicarMonto` y
 * `sumarMontos`--, no en punto flotante. Con quince lineas de precios con
 * centavos, sumar en `Float` mostraba un total un centavo distinto del que
 * despues cobraba el servidor, y el cajero no tenia forma de saber cual era
 * el bueno.
 */
export function totalDelTicket(items: CartLine[]): Monto {
  if (items.length === 0) return CERO
  return sumarMontos(...items.map((i) => multiplicarMonto(i.price, i.quantity)))
}

export function unidadesDelTicket(items: CartLine[]): number {
  return items.reduce((s, i) => s + i.quantity, 0)
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
      .filter(
        (l): l is { p: number; q: number } =>
          typeof l === 'object' &&
          l !== null &&
          typeof (l as { p?: unknown }).p === 'number' &&
          typeof (l as { q?: unknown }).q === 'number',
      )
      .map((l) => ({ p: Math.trunc(l.p), q: Math.max(1, Math.trunc(l.q)) }))
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

export const useCartStore = create<CartState>((set, get) => ({
  branchId: null,
  items: [],
  hidratado: false,

  add(producto, cantidad = 1) {
    if (producto.totalStock <= 0) return 'sin-stock'

    const { items, branchId } = get()
    const existente = items.find((i) => i.productId === producto.id)

    if (existente) {
      const deseada = existente.quantity + cantidad
      const permitida = Math.min(deseada, producto.totalStock)
      if (permitida === existente.quantity) return 'tope-de-stock'

      const nuevos = items.map((i) =>
        i.productId === producto.id
          ? { ...i, quantity: permitida, price: producto.price, stock: producto.totalStock }
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
        quantity: Math.min(cantidad, producto.totalStock),
      },
    ]
    set({ items: nuevos })
    guardar(branchId, nuevos)
    return 'agregado'
  },

  setQuantity(productId, cantidad) {
    const { items, branchId } = get()
    // Cero no vacia la linea por accidente: quitar es una accion aparte, con
    // su propio boton. Un cero tipeado se corrige al minimo.
    const entera = Math.max(1, Math.trunc(cantidad))
    const nuevos = items.map((i) =>
      i.productId === productId ? { ...i, quantity: Math.min(entera, Math.max(1, i.stock)) } : i,
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
          quantity: Math.min(i.quantity, Math.max(1, p.totalStock)),
        }
      })
      .filter((i) => i.stock > 0)

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
