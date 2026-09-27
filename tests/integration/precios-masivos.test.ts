/**
 * Cambio masivo de precios contra la base. Fase P0-B.
 *
 *   · la vista previa no escribe nada;
 *   · aplicar deja una entrada por producto con el antes y el despues --que es
 *     lo que muestra la ficha como historial de precios-- y un resumen;
 *   · lo destildado no se toca;
 *   · si un precio cambio desde la vista previa, no se aplica nada;
 *   · deshacer el ultimo devuelve los precios, salvo los que alguien toco
 *     despues, y no se puede deshacer dos veces;
 *   · permisos.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture, type TestUser } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'
import type {
  ResultadoDeDeshacer,
  ResultadoDePrecios,
  VistaDePrecios,
} from '@/modules/products/precios-dto'
import type { CriterioDePrecio } from '@/modules/products/precios'
import { previsualizarPrecios } from '@/modules/products/precios-masivos'
import { permissionsForRole } from '@/server/authz/permissions'
import type { Session } from '@/server/auth/session'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface Seleccion {
  categoriaId?: number
  proveedorId?: number
  busqueda?: string
  incluirInactivos?: boolean
}

const MAS_10: CriterioDePrecio = { operacion: 'aumentar', valor: '10', redondeo: 'ninguno' }

async function vistaPrevia(usuario: TestUser, seleccion: Seleccion, criterio: CriterioDePrecio) {
  const { POST } = await import('@/app/api/products/prices/preview/route')
  return call<VistaDePrecios>(POST, '/api/products/prices/preview', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: { seleccion, criterio },
  })
}

async function aplicar(
  usuario: TestUser,
  seleccion: Seleccion,
  criterio: CriterioDePrecio,
  huella: string,
  excluidos: number[] = [],
) {
  const { POST } = await import('@/app/api/products/prices/route')
  return call<ResultadoDePrecios>(POST, '/api/products/prices', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: { seleccion, criterio, huella, excluidos },
  })
}

async function deshacer(usuario: TestUser, operacion: string) {
  const { POST } = await import('@/app/api/products/prices/undo/route')
  return call<ResultadoDeDeshacer>(POST, '/api/products/prices/undo', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: { operacion },
  })
}

async function ultimo(usuario: TestUser) {
  const { GET } = await import('@/app/api/products/prices/last/route')
  return call<{ ultimo: { operacion: string; deshacible: boolean; productos: number } | null }>(
    GET,
    '/api/products/prices/last',
    { cookie: await sessionCookie(usuario) },
  )
}

async function precioDe(id: number): Promise<string> {
  const p = await prisma.product.findUniqueOrThrow({ where: { id } })
  return p.price.toFixed(2)
}

/** Una categoria aparte con tres productos, para no depender de la fixture. */
async function bebidas() {
  const categoria = await prisma.category.create({ data: { name: 'Bebidas' } })
  const crear = (name: string, price: number, cost: number | null) =>
    prisma.product.create({
      data: { name, price, cost, categoryId: categoria.id, branchId: fx.branchA.id },
    })
  const [agua, soda, jugo] = await Promise.all([
    crear('Agua 1,5 L', 1000, 600),
    crear('Soda 2 L', 1234, 700),
    crear('Jugo 1 L', 999.99, null),
  ])
  return { categoria, agua, soda, jugo }
}

describe('Vista previa', () => {
  it('filtra por categoria, calcula y redondea, sin escribir nada', async () => {
    const { categoria, agua, soda } = await bebidas()

    const res = await vistaPrevia(
      fx.admin,
      { categoriaId: categoria.id },
      { operacion: 'aumentar', valor: '10', redondeo: 'termina-90' },
    )
    expect(res.status, res.text).toBe(200)
    const v = res.body
    expect(v.descripcion).toBe('Aumento del 10 %, que termine en 90')
    expect(v.items.map((i) => [i.nombre, i.antes, i.despues])).toEqual([
      ['Agua 1,5 L', '1000.00', '1190.00'],
      ['Jugo 1 L', '999.99', '1190.00'],
      ['Soda 2 L', '1234.00', '1390.00'],
    ])
    expect(v.resumen).toMatchObject({
      productos: 3,
      cambian: 3,
      minimo: '1190.00',
      maximo: '1390.00',
    })

    expect(await precioDe(agua.id), 'la vista previa no escribe').toBe('1000.00')
    expect(await precioDe(soda.id)).toBe('1234.00')
  })

  it('costo mas un porcentaje: el que no tiene costo no aplica, y lo dice', async () => {
    const { categoria } = await bebidas()
    const res = await vistaPrevia(
      fx.admin,
      { categoriaId: categoria.id },
      { operacion: 'costo-mas', valor: '50', redondeo: 'entero' },
    )
    const jugo = res.body.items.find((i) => i.nombre === 'Jugo 1 L')
    expect(jugo).toMatchObject({ estado: 'no-aplica', motivo: 'No tiene costo cargado.' })
    const agua = res.body.items.find((i) => i.nombre === 'Agua 1,5 L')
    expect(agua).toMatchObject({ estado: 'cambia', despues: '900.00', costo: '600.0000' })
    expect(res.body.resumen.noAplican).toBe(1)
  })

  it('por proveedor', async () => {
    const res = await vistaPrevia(fx.admin, { proveedorId: fx.proveedor.id }, MAS_10)
    expect(res.body.items.map((i) => i.nombre)).toEqual(['Gaseosa cola 2.25 L'])
  })

  it('sin permiso para ver costos no se puede calcular desde el costo', async () => {
    const permisos = new Set(permissionsForRole('admin'))
    permisos.delete('products.cost.view')
    const sesion: Session = {
      userId: fx.admin.id,
      name: 'admin',
      username: fx.admin.username,
      role: 'admin',
      branchId: fx.branchA.id,
      permissions: permisos,
    }
    await expect(
      previsualizarPrecios(sesion, {
        seleccion: { incluirInactivos: false },
        criterio: { operacion: 'costo-mas', valor: '40', redondeo: 'ninguno' },
      }),
    ).rejects.toThrow(/poder ver los costos/)
  })
})

describe('Aplicar', () => {
  it('cambia los precios, deja el historial de cada producto y un resumen', async () => {
    const { categoria, agua, soda, jugo } = await bebidas()
    const seleccion = { categoriaId: categoria.id }
    const v = await vistaPrevia(fx.admin, seleccion, MAS_10)

    const res = await aplicar(fx.admin, seleccion, MAS_10, v.body.huella)
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ cambiados: 3, descripcion: 'Aumento del 10 %' })

    expect(await precioDe(agua.id)).toBe('1100.00')
    expect(await precioDe(soda.id)).toBe('1357.40')
    expect(await precioDe(jugo.id)).toBe('1099.99')

    // El historial de precios de la ficha sale de la bitacora.
    const { GET } = await import('@/app/api/products/[id]/activity/route')
    const actividad = await call<Array<{ tipo: string; texto: string }>>(
      GET,
      `/api/products/${String(soda.id)}/activity`,
      { cookie: await sessionCookie(fx.admin), params: { id: String(soda.id) } },
    )
    expect(actividad.body).toContainEqual(
      expect.objectContaining({ tipo: 'precio', texto: 'Precio: 1234.00 → 1357.40' }),
    )

    const resumen = await prisma.auditLog.findFirstOrThrow({
      where: { actionType: 'price_bulk_update' },
    })
    expect(resumen.reason).toBe('Aumento del 10 %')
    expect(resumen.changes).toMatchObject({
      after: { operacion: res.body.operacion, productos: 3 },
    })
  })

  it('lo destildado no se toca', async () => {
    const { categoria, agua, soda } = await bebidas()
    const seleccion = { categoriaId: categoria.id }
    const v = await vistaPrevia(fx.admin, seleccion, MAS_10)

    const res = await aplicar(fx.admin, seleccion, MAS_10, v.body.huella, [agua.id])
    expect(res.body.cambiados).toBe(2)
    expect(await precioDe(agua.id)).toBe('1000.00')
    expect(await precioDe(soda.id)).toBe('1357.40')
  })

  it('si un precio cambio desde la vista previa, no se aplica nada', async () => {
    const { categoria, agua, soda } = await bebidas()
    const seleccion = { categoriaId: categoria.id }
    const v = await vistaPrevia(fx.admin, seleccion, MAS_10)

    await prisma.product.update({ where: { id: agua.id }, data: { price: 1050 } })

    const res = await aplicar(fx.admin, seleccion, MAS_10, v.body.huella)
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('PRICES_CHANGED')
    expect(await precioDe(soda.id), 'ninguno se aplico').toBe('1234.00')
  })

  it('un cajero o quien no puede cambiar precios, no puede', async () => {
    expect((await vistaPrevia(fx.cajero, {}, MAS_10)).status).toBe(403)
    const compras = fx.porRol.compras
    if (!compras) throw new Error('falta el rol compras en la fixture')
    expect((await vistaPrevia(compras, {}, MAS_10)).status).toBe(403)
  })

  it('no toca productos de otra sucursal', async () => {
    const v = await vistaPrevia(fx.admin, { busqueda: 'Yerba' }, MAS_10)
    expect(v.body.items).toEqual([])
  })
})

describe('Deshacer el ultimo cambio masivo', () => {
  it('devuelve los precios, salvo el que alguien cambio despues, y no se deshace dos veces', async () => {
    expect((await ultimo(fx.admin)).body.ultimo).toBeNull()

    const { categoria, agua, soda, jugo } = await bebidas()
    const seleccion = { categoriaId: categoria.id }
    const v = await vistaPrevia(fx.admin, seleccion, MAS_10)
    const hecho = await aplicar(fx.admin, seleccion, MAS_10, v.body.huella)

    const antes = await ultimo(fx.admin)
    expect(antes.body.ultimo).toMatchObject({
      operacion: hecho.body.operacion,
      productos: 3,
      deshacible: true,
    })

    // Alguien corrige a mano el precio de la soda despues del cambio masivo.
    await prisma.product.update({ where: { id: soda.id }, data: { price: 1500 } })

    const res = await deshacer(fx.admin, hecho.body.operacion)
    expect(res.status, res.text).toBe(200)
    expect(res.body.restaurados).toBe(2)
    expect(res.body.saltados).toEqual([
      { nombre: 'Soda 2 L', motivo: expect.stringMatching(/Lo cambiaron después/) as string },
    ])

    expect(await precioDe(agua.id)).toBe('1000.00')
    expect(await precioDe(jugo.id)).toBe('999.99')
    expect(await precioDe(soda.id), 'la decision posterior se respeta').toBe('1500.00')

    expect((await ultimo(fx.admin)).body.ultimo?.deshacible).toBe(false)
    const otra = await deshacer(fx.admin, hecho.body.operacion)
    expect(otra.status).toBe(409)
    expect(await prisma.auditLog.count({ where: { actionType: 'price_bulk_undo' } })).toBe(1)
  })

  it('solo el ultimo: uno anterior ya no se puede deshacer', async () => {
    const { categoria } = await bebidas()
    const seleccion = { categoriaId: categoria.id }
    const v1 = await vistaPrevia(fx.admin, seleccion, MAS_10)
    const primero = await aplicar(fx.admin, seleccion, MAS_10, v1.body.huella)
    const v2 = await vistaPrevia(fx.admin, seleccion, MAS_10)
    await aplicar(fx.admin, seleccion, MAS_10, v2.body.huella)

    const res = await deshacer(fx.admin, primero.body.operacion)
    expect(res.status).toBe(409)
  })
})
