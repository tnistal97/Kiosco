/**
 * @vitest-environment jsdom
 *
 * El ticket: reglas de cantidad y persistencia segura.
 *
 * Dos casos obligatorios de la fase viven aca:
 *
 *   - el carrito se restaura consultando los precios actuales;
 *   - el carrito se limpia al cerrar sesion.
 *
 * Y la regla que los sostiene: **lo que se guarda en el navegador no es
 * fuente de verdad de nada**. Solo producto, cantidad, sucursal y momento.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  useCartStore,
  totalDelTicket,
  unidadesDelTicket,
  olvidarTicketGuardado,
  type ProductoParaTicket,
} from '@/store/cart'

const YERBA: ProductoParaTicket = {
  id: 1,
  name: 'Yerba mate 1 kg',
  barcode: '7790001000011',
  price: 4850,
  totalStock: 24,
}

const ULTIMO: ProductoParaTicket = {
  id: 2,
  name: 'Queso cremoso x kg',
  barcode: '7790003000048',
  price: 9800,
  totalStock: 1,
}

const AGOTADO: ProductoParaTicket = {
  id: 3,
  name: 'Helado 1 L',
  barcode: '7790008000036',
  price: 6800,
  totalStock: 0,
}

const CLAVE = 'kiosco:ticket'

function estado() {
  return useCartStore.getState()
}

beforeEach(() => {
  useCartStore.setState({ items: [], branchId: null, hidratado: false })
  olvidarTicketGuardado()
})

describe('Reglas de cantidad', () => {
  it('agrega un producto con cantidad 1', () => {
    estado().usarSucursal(1)
    expect(estado().add(YERBA)).toBe('agregado')
    expect(estado().items).toHaveLength(1)
    expect(estado().items[0]?.quantity).toBe(1)
  })

  it('sumar el mismo producto acumula en la misma linea', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)
    expect(estado().add(YERBA)).toBe('sumado')
    expect(estado().items).toHaveLength(1)
    expect(estado().items[0]?.quantity).toBe(2)
  })

  it('nunca acepta un producto agotado', () => {
    estado().usarSucursal(1)
    expect(estado().add(AGOTADO)).toBe('sin-stock')
    expect(estado().items).toHaveLength(0)
  })

  it('nunca supera el stock disponible', () => {
    estado().usarSucursal(1)
    estado().add(ULTIMO)
    expect(estado().add(ULTIMO)).toBe('tope-de-stock')
    expect(estado().items[0]?.quantity).toBe(1)
  })

  it('nunca acepta cantidad cero ni negativa', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)

    estado().setQuantity(YERBA.id, 0)
    expect(estado().items[0]?.quantity).toBe(1)

    estado().setQuantity(YERBA.id, -5)
    expect(estado().items[0]?.quantity).toBe(1)
  })

  it('las cantidades son enteras', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)
    estado().setQuantity(YERBA.id, 3.7)
    expect(estado().items[0]?.quantity).toBe(3)
  })

  it('recorta la cantidad al stock', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)
    estado().setQuantity(YERBA.id, 999)
    expect(estado().items[0]?.quantity).toBe(YERBA.totalStock)
  })

  it('el total y las unidades salen de las lineas', () => {
    estado().usarSucursal(1)
    estado().add(YERBA, 2)
    estado().add(ULTIMO)

    expect(totalDelTicket(estado().items)).toBe(4850 * 2 + 9800)
    expect(unidadesDelTicket(estado().items)).toBe(3)
  })
})

describe('Lo que se guarda en el navegador', () => {
  it('guarda solo producto, cantidad, sucursal y momento', () => {
    estado().usarSucursal(7)
    estado().add(YERBA, 2)

    const crudo = window.localStorage.getItem(CLAVE)
    expect(crudo).not.toBeNull()

    const datos = JSON.parse(crudo ?? '{}') as Record<string, unknown>
    expect(Object.keys(datos).sort()).toEqual(['branchId', 'lines', 'ts', 'v'])

    const lineas = datos.lines as Array<Record<string, unknown>>
    expect(Object.keys(lineas[0] ?? {}).sort()).toEqual(['p', 'q'])

    // Lo que NO puede estar, dicho de forma explicita.
    expect(crudo).not.toContain('4850')
    expect(crudo).not.toContain('price')
    expect(crudo).not.toContain('Yerba')
    expect(crudo).not.toContain('barcode')
  })

  it('vaciar el ticket borra lo guardado', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)
    expect(window.localStorage.getItem(CLAVE)).not.toBeNull()

    estado().clear()
    expect(window.localStorage.getItem(CLAVE)).toBeNull()
  })
})

describe('Restauracion', () => {
  it('devuelve las lineas guardadas para volver a consultarlas', () => {
    estado().usarSucursal(1)
    estado().add(YERBA, 3)

    // Otra pestania, o la misma despues de un F5.
    useCartStore.setState({ items: [], branchId: null, hidratado: false })

    const lineas = estado().hidratar(1)
    expect(lineas).toEqual([{ p: YERBA.id, q: 3 }])
    // Se devuelven identificadores y cantidades: precio y stock los trae el
    // servidor. El ticket sigue vacio hasta que respondan.
    expect(estado().items).toHaveLength(0)
  })

  it('NO restaura un ticket de otra sucursal', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)

    useCartStore.setState({ items: [], branchId: null, hidratado: false })

    expect(estado().hidratar(2)).toEqual([])
    expect(window.localStorage.getItem(CLAVE)).toBeNull()
  })

  it('NO restaura un ticket vencido', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)

    const guardado = JSON.parse(window.localStorage.getItem(CLAVE) ?? '{}') as Record<string, unknown> // prettier-ignore
    guardado.ts = Date.now() - 13 * 60 * 60 * 1000
    window.localStorage.setItem(CLAVE, JSON.stringify(guardado))

    useCartStore.setState({ items: [], branchId: null, hidratado: false })
    expect(estado().hidratar(1)).toEqual([])
  })

  it('descarta un ticket manipulado a mano', () => {
    window.localStorage.setItem(
      CLAVE,
      '{"v":1,"branchId":1,"ts":' + Date.now() + ',"lines":"nada"}',
    )
    expect(estado().hidratar(1)).toEqual([])

    window.localStorage.setItem(CLAVE, 'esto no es json')
    expect(estado().hidratar(1)).toEqual([])
  })

  it('sincronizar aplica el precio y el stock que dijo el servidor', () => {
    estado().usarSucursal(1)
    estado().add(YERBA, 5)

    // El precio subio y quedan menos unidades de las que tenia el ticket.
    estado().sincronizar([{ ...YERBA, price: 5200, totalStock: 2 }])

    expect(estado().items[0]?.price).toBe(5200)
    expect(estado().items[0]?.quantity).toBe(2)
  })

  it('sincronizar saca los productos que el servidor ya no devuelve', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)
    estado().add(ULTIMO)

    // El servidor solo devuelve uno: el otro se dio de baja o se borro.
    estado().sincronizar([YERBA])

    expect(estado().items).toHaveLength(1)
    expect(estado().items[0]?.productId).toBe(YERBA.id)
  })

  it('sincronizar saca lo que quedo sin stock', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)

    estado().sincronizar([{ ...YERBA, totalStock: 0 }])

    expect(estado().items).toHaveLength(0)
  })
})

describe('Cambio de sucursal y cierre de sesion', () => {
  it('cambiar de sucursal vacia el ticket', () => {
    estado().usarSucursal(1)
    estado().add(YERBA)

    estado().usarSucursal(2)

    expect(estado().items).toHaveLength(0)
    expect(window.localStorage.getItem(CLAVE)).toBeNull()
  })

  it('la PRIMERA sucursal no borra el ticket guardado', () => {
    // Fijar la sucursal al montar la pantalla no es un cambio de sucursal:
    // es el arranque. Borrar ahi dejaba sin efecto toda la restauracion, y
    // el ticket no sobrevivia a un F5.
    estado().usarSucursal(1)
    estado().add(YERBA, 2)

    // Otra pestania, o la misma despues de recargar: el store arranca limpio.
    useCartStore.setState({ items: [], branchId: null, hidratado: false })
    estado().usarSucursal(1)

    expect(window.localStorage.getItem(CLAVE)).not.toBeNull()
    expect(estado().hidratar(1)).toEqual([{ p: YERBA.id, q: 2 }])
  })

  it('el ticket no sobrevive a un cierre de sesion', () => {
    estado().usarSucursal(1)
    estado().add(YERBA, 4)

    // Es lo que hace el menu de usuario al salir.
    estado().clear()

    expect(estado().items).toHaveLength(0)
    expect(window.localStorage.getItem(CLAVE)).toBeNull()

    // Y no vuelve al entrar de nuevo.
    expect(estado().hidratar(1)).toEqual([])
  })
})
