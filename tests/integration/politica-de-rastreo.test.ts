/**
 * Endurecer el rastreo y aflojarlo no son el mismo permiso.
 *
 * `lots.manage` alcanza para subir el escalon --NONE -> OPTIONAL -> REQUIRED--
 * porque quien recibe mercaderia tiene que poder cargar la partida que llego.
 * Bajarlo apaga un control, y desde la Fase 5A exige `lots.tracking.relax`, que
 * compras NO tiene.
 *
 * Lo que se prueba es el EFECTO, no la existencia del permiso: compras endurece
 * y el producto queda endurecido; compras intenta aflojar y el producto queda
 * como estaba. Si mañana alguien devuelve `lots.tracking.relax` al perfil de
 * compras, estas pruebas fallan.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture, type TestUser } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'
import { permissionsForRole } from '@/server/authz/permissions'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

function rol(nombre: string): TestUser {
  const u = fx.porRol[nombre]
  if (!u) throw new Error(`La fixture no tiene un usuario con rol ${nombre}`)
  return u
}

async function ponerPolitica(lote: string, venc: string): Promise<void> {
  await prisma.product.update({
    where: { id: fx.productoA.id },
    data: { lotTracking: lote, expirationTracking: venc },
  })
}

/**
 * Deja el producto sin stock.
 *
 * Hace falta siempre que el PUT termine en `REQUIRED`: la Fase 4D no deja
 * exigir lotes con unidades que ninguna partida explica, y `productoA` nace
 * con saldo y sin partidas. La primera version de estas pruebas ponia
 * `REQUIRED` escribiendo la columna a mano --que saltea esa comprobacion-- y
 * el endpoint devolvia 409 con razon.
 */
async function sinStock(): Promise<void> {
  await prisma.branchStock.deleteMany({
    where: { branchId: fx.branchA.id, productId: fx.productoA.id },
  })
}

async function politicaActual(): Promise<{ lotTracking: string; expirationTracking: string }> {
  const p = await prisma.product.findUniqueOrThrow({
    where: { id: fx.productoA.id },
    select: { lotTracking: true, expirationTracking: true },
  })
  return p
}

async function cambiar(usuario: TestUser, lotTracking: string, expirationTracking: string) {
  const { PUT } = await import('@/app/api/productos/[id]/lotes/route')
  return call(PUT, `/api/productos/${String(fx.productoA.id)}/lotes`, {
    method: 'PUT',
    cookie: await sessionCookie(usuario),
    body: { lotTracking, expirationTracking },
    params: { id: String(fx.productoA.id) },
  })
}

describe('Compras endurece el rastreo', () => {
  it('sube de NONE a OPTIONAL', async () => {
    await ponerPolitica('NONE', 'NONE')

    const res = await cambiar(rol('compras'), 'OPTIONAL', 'NONE')

    expect(res.status).toBe(200)
    expect(await politicaActual()).toMatchObject({ lotTracking: 'OPTIONAL' })
  })

  it('sube de OPTIONAL a REQUIRED cuando no queda stock sin atribuir', async () => {
    await ponerPolitica('OPTIONAL', 'NONE')
    await sinStock()

    const res = await cambiar(rol('compras'), 'REQUIRED', 'NONE')

    expect(res.status).toBe(200)
    expect(await politicaActual()).toMatchObject({ lotTracking: 'REQUIRED' })
  })

  it('sube el vencimiento sin tocar el lote', async () => {
    await ponerPolitica('REQUIRED', 'NONE')
    await sinStock()

    const res = await cambiar(rol('compras'), 'REQUIRED', 'OPTIONAL')

    expect(res.status).toBe(200)
    expect(await politicaActual()).toMatchObject({ expirationTracking: 'OPTIONAL' })
  })

  it('puede reenviar la misma politica sin cambiarla', async () => {
    await ponerPolitica('REQUIRED', 'OPTIONAL')
    await sinStock()

    const res = await cambiar(rol('compras'), 'REQUIRED', 'OPTIONAL')

    expect(res.status).toBe(200)
  })
})

describe('Compras NO puede aflojar el rastreo', () => {
  it('rechaza bajar de REQUIRED a OPTIONAL, y el producto queda como estaba', async () => {
    await ponerPolitica('REQUIRED', 'NONE')

    const res = await cambiar(rol('compras'), 'OPTIONAL', 'NONE')

    expect(res.status).toBe(403)
    expect(errorDe(res).code).toBe('FORBIDDEN')
    expect(await politicaActual()).toMatchObject({ lotTracking: 'REQUIRED' })
  })

  it('rechaza bajar de REQUIRED a NONE', async () => {
    await ponerPolitica('REQUIRED', 'NONE')

    const res = await cambiar(rol('compras'), 'NONE', 'NONE')

    expect(res.status).toBe(403)
    expect(await politicaActual()).toMatchObject({ lotTracking: 'REQUIRED' })
  })

  it('rechaza bajar solo el vencimiento, aunque el lote no cambie', async () => {
    await ponerPolitica('REQUIRED', 'REQUIRED')

    const res = await cambiar(rol('compras'), 'REQUIRED', 'OPTIONAL')

    expect(res.status).toBe(403)
    expect(await politicaActual()).toMatchObject({ expirationTracking: 'REQUIRED' })
  })

  it('rechaza el cambio que sube una y baja la otra', async () => {
    // (OPTIONAL, OPTIONAL) -> (REQUIRED, NONE): el lote sube, el vencimiento
    // baja. Basta con que algo baje.
    await ponerPolitica('OPTIONAL', 'OPTIONAL')
    await sinStock()

    const res = await cambiar(rol('compras'), 'REQUIRED', 'NONE')

    expect(res.status).toBe(403)
    expect(await politicaActual()).toMatchObject({
      lotTracking: 'OPTIONAL',
      expirationTracking: 'OPTIONAL',
    })
  })

  it('el mensaje nombra el permiso que falta, sin filtrar nada mas', async () => {
    await ponerPolitica('REQUIRED', 'NONE')

    const res = await cambiar(rol('compras'), 'NONE', 'NONE')

    expect(errorDe(res).message).toContain('lots.tracking.relax')
    expect(res.text).not.toMatch(/    at |prisma|node_modules/)
  })
})

describe('Encargado y administrador si pueden aflojarlo', () => {
  it('el encargado baja de REQUIRED a NONE', async () => {
    await ponerPolitica('REQUIRED', 'REQUIRED')

    const res = await cambiar(rol('encargado'), 'NONE', 'NONE')

    expect(res.status).toBe(200)
    expect(await politicaActual()).toMatchObject({
      lotTracking: 'NONE',
      expirationTracking: 'NONE',
    })
  })

  it('el administrador tambien', async () => {
    await ponerPolitica('REQUIRED', 'NONE')

    const res = await cambiar(fx.admin, 'OPTIONAL', 'NONE')

    expect(res.status).toBe(200)
  })

  it('queda en la bitacora quien lo aflojo, con el antes y el despues', async () => {
    await ponerPolitica('REQUIRED', 'REQUIRED')
    await cambiar(rol('encargado'), 'NONE', 'NONE')

    const entrada = await prisma.auditLog.findFirst({
      where: { tableName: 'Product', recordId: fx.productoA.id, userId: rol('encargado').id },
      orderBy: { id: 'desc' },
    })

    expect(entrada).not.toBeNull()
    expect(JSON.stringify(entrada?.changes)).toContain('REQUIRED')
    expect(JSON.stringify(entrada?.changes)).toContain('NONE')
  })
})

describe('El reparto de permisos entre los roles', () => {
  it('compras administra lotes y no puede aflojar', () => {
    const p = permissionsForRole('compras')
    expect(p.has('lots.manage')).toBe(true)
    expect(p.has('lots.tracking.relax')).toBe(false)
  })

  it('encargado y admin pueden aflojar', () => {
    expect(permissionsForRole('encargado').has('lots.tracking.relax')).toBe(true)
    expect(permissionsForRole('admin').has('lots.tracking.relax')).toBe(true)
  })

  it('nadie que no administre lotes puede aflojarlos', () => {
    // Aflojar sin poder administrar seria un rol que apaga el rastreo y despues
    // no puede cargar una sola partida.
    for (const nombre of ['cajero', 'supervisor', 'repositor', 'auditor']) {
      const p = permissionsForRole(nombre)
      expect(p.has('lots.tracking.relax'), `rol ${nombre}`).toBe(false)
    }
  })
})
