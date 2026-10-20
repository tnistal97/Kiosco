/**
 * Importacion de productos contra la base. Fase P0-B.
 *
 * Lo que se comprueba es lo que el pedido marco como critico:
 *
 *   · la vista previa no escribe nada;
 *   · el stock entra por el libro, nunca pisado: INITIAL en un alta, ajuste
 *     manual con su delta en un producto existente, y el libro cuadra;
 *   · el costo cambia por el registrador unico y deja su historial;
 *   · una celda vacia no toca nada y no pone nada en cero;
 *   · "1.500" son mil quinientas unidades o un kilo y medio segun el producto;
 *   · el doble clic no importa dos veces;
 *   · si el catalogo cambio desde la vista previa, no se aplica;
 *   · todo o nada, con un fallo inyectado al final;
 *   · permisos, sucursal y lotes.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { seedFixture, prisma, descuadresDelLibro, stockExacto, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'
import type { VistaPrevia, ResultadoDeImportacion } from '@/modules/importacion/dto'
import type { Campo, ValorCrudo } from '@/modules/importacion/columnas'
import type { Modo, ModoDeStock } from '@/modules/importacion/schemas'
import { previsualizarImportacion } from '@/modules/importacion/service'
import type { Session } from '@/server/auth/session'
import { permissionsForRole } from '@/server/authz/permissions'
import type { TestUser } from '../helpers/db'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterEach(async () => {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS falla_importacion ON "AuditLog"')
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface Pedido {
  archivo: string
  campos: Campo[]
  filas: Array<{ f: number; v: ValorCrudo[] }>
  modo: Modo
  stock: ModoDeStock
}

function pedido(
  campos: Campo[],
  filas: ValorCrudo[][],
  opciones: Partial<Pick<Pedido, 'modo' | 'stock'>> = {},
): Pedido {
  return {
    archivo: 'lista.xlsx',
    campos,
    filas: filas.map((v, i) => ({ f: i + 2, v })),
    modo: opciones.modo ?? 'nuevos-y-existentes',
    stock: opciones.stock ?? 'no-tocar',
  }
}

async function vistaPrevia(usuario: TestUser, p: Pedido) {
  const { POST } = await import('@/app/api/products/import/preview/route')
  return call<VistaPrevia>(POST, '/api/products/import/preview', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: p,
  })
}

async function importar(usuario: TestUser, p: Pedido, vista: VistaPrevia) {
  const { POST } = await import('@/app/api/products/import/route')
  return call<ResultadoDeImportacion>(POST, '/api/products/import', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: { ...p, importacion: vista.importacion, huella: vista.huella },
  })
}

/** Vista previa y confirmacion, como la pantalla. */
async function previsualizarEImportar(usuario: TestUser, p: Pedido) {
  const vista = await vistaPrevia(usuario, p)
  expect(vista.status, vista.text).toBe(200)
  const res = await importar(usuario, p, vista.body)
  return { vista: vista.body, res }
}

async function productoPorCodigo(code: string) {
  const b = await prisma.productBarcode.findUnique({
    where: { code },
    include: { product: { include: { category: true } } },
  })
  return b?.product ?? null
}

const CAMPOS_COMPLETOS: Campo[] = [
  'codigo',
  'nombre',
  'categoria',
  'precio',
  'costo',
  'stock',
  'stockMinimo',
  'unidad',
]

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------

describe('Vista previa', () => {
  it('clasifica cada fila y no escribe nada', async () => {
    const antes = await prisma.product.count()

    const res = await vistaPrevia(
      fx.admin,
      pedido(
        ['codigo', 'nombre', 'precio'],
        [
          ['7799000000017', 'Arroz largo fino 1 kg', '1.500'],
          ['7790895000119', 'Fernet Branca 750ml', '13.000'],
          ['7790002000014', 'Gaseosa cola 2.25 L', '3450'],
          ['7799000000024', 'Fideos', 'abc'],
          ['7799000000031', 'Sal fina', '900'],
          ['7799000000031', 'Sal gruesa', '950'],
        ],
      ),
    )

    expect(res.status, res.text).toBe(200)
    const v = res.body
    expect(v.bloqueos).toEqual([])
    expect(v.filas.map((f) => [f.fila, f.accion])).toEqual([
      [2, 'crear'],
      [3, 'actualizar'],
      [4, 'sin-cambios'],
      [5, 'error'],
      [6, 'error'],
      [7, 'error'],
    ])
    expect(v.totales).toMatchObject({
      filas: 6,
      crear: 1,
      actualizar: 1,
      sinCambios: 1,
      conErrores: 3,
      repetidasEnArchivo: 2,
    })

    const fernet = v.filas[1]
    expect(fernet?.cambios).toEqual([{ campo: 'precio', antes: '12500.00', despues: '13000.00' }])
    expect(v.filas[3]?.errores[0]).toMatch(/^Precio: /)
    expect(v.filas[4]?.errores[0]).toMatch(/Código repetido en el archivo \(filas 6, 7\)/)

    // Un producto nuevo sin categoria va a "Sin categoría", que se crea.
    expect(v.categoriasNuevas).toEqual(['Sin categoría'])
    expect(await prisma.product.count(), 'la vista previa no escribe').toBe(antes)
  })

  it('sin codigo ni nombre no hay como reconocer productos: bloquea', async () => {
    const res = await vistaPrevia(fx.admin, pedido(['precio'], [['1500']]))
    expect(res.body.bloqueos.join(' ')).toMatch(/código de barras o la del nombre/)
  })

  it('codigo y stock alcanzan para los existentes; un producto nuevo necesita nombre y precio', async () => {
    const res = await vistaPrevia(
      fx.admin,
      pedido(
        ['codigo', 'stock'],
        [
          ['7790895000119', '12'],
          ['7799000000017', '5'],
        ],
        { stock: 'ajustar' },
      ),
    )
    expect(res.body.bloqueos).toEqual([])
    expect(res.body.filas[0]?.accion).toBe('actualizar')
    expect(res.body.filas[1]?.accion).toBe('error')
    expect(res.body.filas[1]?.errores).toEqual([
      'Falta el nombre: un producto nuevo lo necesita.',
      'Falta el precio: un producto nuevo lo necesita.',
    ])
  })

  it('una celda vacia es "no viene": no cambia nada ni pone nada en cero', async () => {
    const res = await vistaPrevia(
      fx.admin,
      pedido(['codigo', 'nombre', 'precio', 'costo'], [['7790895000119', '', '', '']]),
    )
    expect(res.body.filas[0]?.accion).toBe('sin-cambios')
  })

  it('un codigo de otra sucursal no se puede usar', async () => {
    const res = await vistaPrevia(
      fx.admin,
      pedido(['codigo', 'nombre', 'precio'], [['7792798000029', 'Yerba', '100']]),
    )
    expect(res.body.filas[0]?.accion).toBe('error')
    expect(res.body.filas[0]?.errores.join(' ')).toMatch(/otra sucursal/)
  })

  it('la unidad del archivo no le cambia la unidad a un producto existente', async () => {
    const res = await vistaPrevia(
      fx.admin,
      pedido(
        ['codigo', 'nombre', 'precio', 'unidad'],
        [['2000000000015', 'Queso cremoso', '9800', 'unidad']],
      ),
    )
    expect(res.body.filas[0]?.errores.join(' ')).toMatch(/se vende por kilogramo/)
  })

  it('"solo actualizar": las filas desconocidas se omiten sin revisarlas', async () => {
    const res = await vistaPrevia(
      fx.admin,
      pedido(
        ['codigo', 'nombre', 'precio'],
        [
          ['7799000000017', 'Producto que el almacen no vende', 'basura'],
          ['7790895000119', 'Fernet Branca 750ml', '13000'],
        ],
        { modo: 'solo-existentes' },
      ),
    )
    expect(res.body.filas.map((f) => [f.accion, f.errores.length])).toEqual([
      ['omitir', 0],
      ['actualizar', 0],
    ])
    expect(res.body.bloqueos).toEqual([])
  })

  it('sin permiso para ver costos, la vista previa no muestra el costo actual', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { cost: 9000 } })
    const permisos = new Set(permissionsForRole('admin'))
    permisos.delete('products.cost.view')
    const sesion: Session = {
      userId: fx.admin.id,
      name: 'admin',
      username: fx.admin.username,
      role: 'admin',
      branchId: fx.branchA.id,
      permissions: permisos,
      mustChangePassword: false,
    }
    const v = await previsualizarImportacion(
      sesion,
      pedido(['codigo', 'nombre', 'costo'], [['7790895000119', 'Fernet Branca 750ml', '9500']]),
    )
    expect(v.filas[0]?.cambios).toEqual([{ campo: 'costo', antes: null, despues: '9500.0000' }])
  })
})

// ---------------------------------------------------------------------------
// Importar
// ---------------------------------------------------------------------------

describe('Importar: altas', () => {
  it('da de alta con stock inicial POR EL LIBRO, codigo, categoria y bitacora', async () => {
    const { vista, res } = await previsualizarEImportar(
      fx.admin,
      pedido(
        CAMPOS_COMPLETOS,
        [
          [
            '7799000000017',
            'Arroz largo fino 1 kg',
            'Almacén',
            '1.500',
            '1.100,50',
            '24',
            '6',
            'unidad',
          ],
          ['7799000000024', 'Pan de campo', 'Panadería', '2.800', '', '0', '', 'kg'],
          ['', 'Queso de rallar', 'Fiambrería', '12.500,00', '9000', '1.500', '0,5', 'kg'],
        ],
        { modo: 'solo-nuevos', stock: 'ajustar' },
      ),
    )

    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ creados: 3, actualizados: 0, movimientosDeStock: 2 })
    expect(res.body.categoriasCreadas.sort()).toEqual(['Fiambrería', 'Panadería'])

    const arroz = await productoPorCodigo('7799000000017')
    expect(arroz).toMatchObject({ name: 'Arroz largo fino 1 kg', saleUnit: 'UNIT' })
    // "Almacén" coincide con la categoria "Almacen" que ya existia.
    expect(arroz?.category.name).toBe('Almacen')
    expect(arroz?.price.toFixed(2)).toBe('1500.00')
    expect(arroz?.cost?.toFixed(4)).toBe('1100.5000')
    expect(arroz?.minimumStock.toFixed(3)).toBe('6.000')
    expect(await stockExacto(fx.branchA.id, arroz?.id ?? 0)).toBe('24.000')

    const movimientos = await prisma.stockMovement.findMany({ where: { productId: arroz?.id } })
    expect(movimientos).toHaveLength(1)
    expect(movimientos[0]?.type).toBe('INITIAL')
    expect(movimientos[0]?.reason).toMatch(/Stock inicial · Importación de lista\.xlsx \(#/)

    // Sin codigo: se da de alta igual, y "1.500" en kilos es kilo y medio.
    const queso = await prisma.product.findFirstOrThrow({ where: { name: 'Queso de rallar' } })
    expect(queso.saleUnit).toBe('KG')
    expect(await stockExacto(fx.branchA.id, queso.id)).toBe('1.500')
    expect(queso.minimumStock.toFixed(3)).toBe('0.500')
    expect(vista.filas[2]?.avisos.join(' ')).toMatch(/se leyó como 1,5 kg/)

    // Con cero de stock no hay movimiento, y el costo vacio queda NULL, no cero.
    const pan = await productoPorCodigo('7799000000024')
    expect(pan?.cost).toBeNull()
    expect(await prisma.stockMovement.count({ where: { productId: pan?.id } })).toBe(0)

    const altas = await prisma.auditLog.count({
      where: { tableName: 'Product', actionType: 'create', origin: 'POST /api/products/import' },
    })
    expect(altas).toBe(3)

    const resumen = await prisma.auditLog.findFirstOrThrow({ where: { actionType: 'import' } })
    expect(resumen.changes).toMatchObject({
      after: { importacion: vista.importacion, creados: 3, archivo: 'lista.xlsx' },
    })

    expect(await descuadresDelLibro(), 'el libro cuadra').toEqual([])
  })

  it('"solo nuevos" no toca los que ya existen, ni su stock', async () => {
    const { res } = await previsualizarEImportar(
      fx.admin,
      pedido(
        ['codigo', 'nombre', 'precio', 'stock'],
        [['7790895000119', 'Otro nombre', '1', '999']],
        {
          modo: 'solo-nuevos',
          stock: 'ajustar',
        },
      ),
    )
    expect(res.body).toMatchObject({ creados: 0, actualizados: 0, omitidos: 1 })
    const fernet = await prisma.product.findUniqueOrThrow({ where: { id: fx.productoA.id } })
    expect(fernet.name).toBe('Fernet Branca 750ml')
    expect(await stockExacto(fx.branchA.id, fx.productoA.id)).toBe('10.000')
  })
})

describe('Importar: productos existentes', () => {
  it('ajustar: el delta contra el saldo, como un recuento, con motivo y bitacora', async () => {
    const { res } = await previsualizarEImportar(
      fx.admin,
      pedido(['codigo', 'stock'], [['7790895000119', '1.500']], { stock: 'ajustar' }),
    )
    expect(res.status, res.text).toBe(200)

    // "1.500" en un producto por unidad son mil quinientas.
    expect(await stockExacto(fx.branchA.id, fx.productoA.id)).toBe('1500.000')
    const ajuste = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: fx.productoA.id, type: 'MANUAL_ADJUSTMENT' },
    })
    expect(ajuste.quantity.toFixed(3)).toBe('1490.000')
    expect(ajuste.previousQuantity.toFixed(3)).toBe('10.000')
    expect(ajuste.reason).toMatch(/^Importación de lista\.xlsx/)

    const bitacora = await prisma.auditLog.count({
      where: {
        tableName: 'StockMovement',
        recordId: ajuste.id,
        origin: 'POST /api/products/import',
      },
    })
    expect(bitacora).toBe(1)
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('sumar: lo del archivo entra y se suma', async () => {
    await previsualizarEImportar(
      fx.admin,
      pedido(['codigo', 'stock'], [['2000000000015', '1,25']], { stock: 'sumar' }),
    )
    expect(await stockExacto(fx.branchA.id, fx.productoPeso.id)).toBe('6.250')
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('el costo cambia por el registrador unico y deja historial encadenado', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { cost: 9000 } })

    const { res } = await previsualizarEImportar(
      fx.admin,
      pedido(['codigo', 'precio', 'costo'], [['7790895000119', '14.000', '9.800,50']]),
    )
    expect(res.body.actualizados).toBe(1)

    const historial = await prisma.productCostHistory.findMany({
      where: { productId: fx.productoA.id },
    })
    expect(historial).toHaveLength(1)
    expect(historial[0]?.previousCost?.toFixed(4)).toBe('9000.0000')
    expect(historial[0]?.newCost?.toFixed(4)).toBe('9800.5000')
    expect(historial[0]?.reason).toMatch(/^Importación de lista\.xlsx/)

    // El cambio de precio queda en la bitacora como lo lee la ficha del
    // producto: antes y despues, como cadena.
    const cambio = await prisma.auditLog.findFirstOrThrow({
      where: { tableName: 'Product', recordId: fx.productoA.id, actionType: 'update' },
    })
    expect(cambio.changes).toMatchObject({
      before: { price: '12500.00' },
      after: { price: '14000.00' },
    })
  })

  it('un producto que se sigue por lote no recibe stock por planilla', async () => {
    await prisma.product.update({
      where: { id: fx.productoCaja.id },
      data: { lotTracking: 'REQUIRED' },
    })
    const res = await vistaPrevia(
      fx.admin,
      pedido(['codigo', 'stock'], [['7790002000014', '50']], { stock: 'ajustar' }),
    )
    expect(res.body.filas[0]?.accion).toBe('error')
    expect(res.body.filas[0]?.errores.join(' ')).toMatch(/se sigue por lote/)
  })
})

describe('Importar: seguridad del proceso', () => {
  it('el doble clic no importa dos veces', async () => {
    const p = pedido(['codigo', 'stock'], [['7790895000119', '5']], { stock: 'sumar' })
    const vista = await vistaPrevia(fx.admin, p)

    const [a, b] = await Promise.all([
      importar(fx.admin, p, vista.body),
      importar(fx.admin, p, vista.body),
    ])
    const estados = [a.status, b.status].sort()
    expect(estados).toEqual([200, 409])
    const rechazada = a.status === 409 ? a : b
    expect(errorDe(rechazada).code).toBe('IMPORT_ALREADY_APPLIED')

    expect(await stockExacto(fx.branchA.id, fx.productoA.id), 'sumo UNA vez').toBe('15.000')
  })

  it('si el catalogo cambio desde la vista previa, no aplica nada', async () => {
    const p = pedido(['codigo', 'nombre', 'precio'], [['7799000000017', 'Arroz', '1500']], {
      modo: 'solo-nuevos',
    })
    const vista = await vistaPrevia(fx.admin, p)

    // Mientras tanto, alguien lo carga a mano.
    await prisma.product.create({
      data: {
        name: 'Arroz',
        price: 1400,
        categoryId: fx.categoryId,
        branchId: fx.branchA.id,
        barcodes: { create: { code: '7799000000017', isPrimary: true } },
      },
    })

    const res = await importar(fx.admin, p, vista.body)
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('IMPORT_PREVIEW_STALE')
    expect(await prisma.auditLog.count({ where: { actionType: 'import' } })).toBe(0)
  })

  it('una huella inventada no pasa', async () => {
    const p = pedido(['codigo', 'nombre', 'precio'], [['7799000000017', 'Arroz', '1500']])
    const vista = await vistaPrevia(fx.admin, p)
    const res = await importar(fx.admin, p, { ...vista.body, huella: '0'.repeat(64) })
    expect(res.status).toBe(409)
    expect(await productoPorCodigo('7799000000017')).toBeNull()
  })

  it('todo o nada: si falla la ultima escritura, no queda ningun producto', async () => {
    const p = pedido(
      ['codigo', 'nombre', 'precio', 'stock'],
      [
        ['7799000000017', 'Arroz', '1500', '10'],
        ['7799000000024', 'Fideos', '900', '20'],
      ],
      { stock: 'ajustar' },
    )
    const vista = await vistaPrevia(fx.admin, p)
    const productos = await prisma.product.count()
    const movimientos = await prisma.stockMovement.count()

    // El resumen de la importacion es lo ULTIMO que se escribe: si falla ahi,
    // todo lo anterior tiene que deshacerse.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION falla_importacion() RETURNS trigger AS $cuerpo$
      BEGIN
        RAISE EXCEPTION 'fallo inyectado por la prueba';
      END;
      $cuerpo$ LANGUAGE plpgsql;
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER falla_importacion BEFORE INSERT ON "AuditLog"
      FOR EACH ROW WHEN (NEW."actionType" = 'import') EXECUTE FUNCTION falla_importacion()
    `)

    const res = await importar(fx.admin, p, vista.body)
    expect(res.status).toBe(500)
    expect(res.text, 'no cuenta detalles internos').not.toMatch(
      /trigger|disparador|falla_importacion/i,
    )

    expect(await prisma.product.count()).toBe(productos)
    expect(await prisma.stockMovement.count()).toBe(movimientos)
    expect(await productoPorCodigo('7799000000017')).toBeNull()
  })
})

describe('Importar: permisos', () => {
  it('un cajero no puede importar', async () => {
    const res = await vistaPrevia(
      fx.cajero,
      pedido(['codigo', 'nombre', 'precio'], [['7799000000017', 'Arroz', '1500']]),
    )
    expect(res.status).toBe(403)
  })

  it('sin permiso de precios, la columna del precio bloquea con su explicacion', async () => {
    const permisos = new Set(permissionsForRole('admin'))
    permisos.delete('products.price.update')
    const sesion: Session = {
      userId: fx.admin.id,
      name: 'admin',
      username: fx.admin.username,
      role: 'admin',
      branchId: fx.branchA.id,
      permissions: permisos,
      mustChangePassword: false,
    }
    const v = await previsualizarImportacion(
      sesion,
      pedido(['codigo', 'precio'], [['7790895000119', '20000']], { modo: 'solo-existentes' }),
    )
    expect(v.bloqueos.join(' ')).toMatch(/no puede cambiar precios/)
  })

  it('sin permiso de categorias, las categorias nuevas bloquean y se nombran', async () => {
    const permisos = new Set(permissionsForRole('admin'))
    permisos.delete('categories.manage')
    const sesion: Session = {
      userId: fx.admin.id,
      name: 'admin',
      username: fx.admin.username,
      role: 'admin',
      branchId: fx.branchA.id,
      permissions: permisos,
      mustChangePassword: false,
    }
    const v = await previsualizarImportacion(
      sesion,
      pedido(
        ['codigo', 'nombre', 'categoria', 'precio'],
        [['7799000000017', 'Arroz', 'Granos', '1500']],
      ),
    )
    expect(v.bloqueos.join(' ')).toMatch(/no puede crear categorías.*Granos/)
  })

  it('el encargado puede', async () => {
    const encargado = fx.porRol.encargado
    if (!encargado) throw new Error('falta el encargado en la fixture')
    const { res } = await previsualizarEImportar(
      encargado,
      pedido(['codigo', 'nombre', 'precio'], [['7799000000017', 'Arroz', '1500']]),
    )
    expect(res.status, res.text).toBe(200)
  })
})
