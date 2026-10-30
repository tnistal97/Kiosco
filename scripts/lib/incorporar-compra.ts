/**
 * Aplica en la base el plan de `scripts/lib/compra.ts`: una compra que entra
 * al stock.
 *
 * Por las mismas puertas que el resto del sistema, dentro de UNA transaccion,
 * todo o nada:
 *
 *   crear  `crearProductoEn`, la puerta del formulario y de la importacion:
 *          precio 0, sin costo, por unidad, categoria "Sin categoría" y un
 *          movimiento INITIAL por la cantidad, con el origen de la linea;
 *   sumar  `applyStockMovement`, como ajuste manual con su motivo. Nunca se
 *          escribe el saldo, asi que el libro sigue reconstruyendo el stock.
 *
 * Si alguna linea queda para revisar, no se carga ninguna: una compra a medias
 * es mas dificil de seguir que una que no entro.
 *
 * Se aplica UNA vez: la entrada de resumen de la bitacora lleva la `marca` de
 * la compra, y si ya esta, no se hace nada. Usa el mismo bloqueo que la
 * importacion de planillas, asi que no corre a la vez que una.
 *
 * `aplicar: false` hace todo, comprueba y DESHACE: el ensayo pasa por las
 * mismas restricciones de la base que la aplicacion de verdad.
 */
import type { PrismaClient } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { permissionsForRole } from '@/server/authz/permissions'
import { cantidad } from '@/server/cantidad'
import { applyStockMovement, type TxClient } from '@/modules/inventory/service'
import { crearProductoEn } from '@/modules/products/service'
import { crearProductoSchema } from '@/modules/products/schemas'
import { SIN_CATEGORIA } from '@/modules/importacion/service'
import { planificarCompra, type LineaDeCompra, type PasoDeCompra } from './compra'
import { totales, type Totales } from './normalizar-bultos'

export const ORIGEN = 'scripts/incorporar-compra'

/** La de la importacion de planillas (src/modules/importacion/service.ts). */
const LLAVE_DE_IMPORTACION = 7301

export interface OpcionesDeCompra {
  sucursal: number
  autor: number
  /** Identifica la compra en la bitacora: la segunda vez no se aplica. */
  marca: string
  /** Motivo de los movimientos de stock. Por omision, "Compra <marca>". */
  motivo?: string
  lineas: readonly LineaDeCompra[]
  /** false: hace todo, comprueba y deshace. */
  aplicar: boolean
}

export interface ProductoTocado {
  id: number
  nombre: string
  cantidad: number
  stockAntes: number
  stockDespues: number
}

export interface ResultadoDeCompra {
  pasos: PasoDeCompra[]
  antes: Totales
  despues: Totales
  creados: ProductoTocado[]
  sumados: ProductoTocado[]
  aplicado: boolean
  /** La entrada de la bitacora de la vez que ya se aplico, si la hay. */
  yaAplicada: { id: number; timestamp: Date } | null
}

class Ensayo extends Error {
  constructor(readonly resultado: ResultadoDeCompra) {
    super('ensayo: se deshace')
  }
}

function exigir(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(`La compra no cierra: ${mensaje}`)
}

async function stockDe(tx: TxClient, sucursal: number, productId: number): Promise<number> {
  const fila = await tx.branchStock.findUnique({
    where: { branchId_productId: { branchId: sucursal, productId } },
    select: { quantity: true },
  })
  return Number(fila?.quantity ?? 0)
}

async function libroDe(tx: TxClient, sucursal: number, productId: number): Promise<number> {
  const suma = await tx.stockMovement.aggregate({
    where: { branchId: sucursal, productId },
    _sum: { quantity: true },
  })
  return Number(suma._sum.quantity ?? 0)
}

async function sesionDe(tx: TxClient, autor: number, sucursal: number) {
  const usuario = await tx.user.findFirst({
    where: { id: autor, isActive: true, role: { name: { in: ['admin', 'duenio'] } } },
    select: { id: true, name: true, username: true, role: { select: { name: true } } },
  })
  if (!usuario) throw new Error(`El autor ${String(autor)} no es un administrador activo`)
  return {
    userId: usuario.id,
    name: usuario.name,
    username: usuario.username,
    role: usuario.role.name,
    branchId: sucursal,
    permissions: permissionsForRole(usuario.role.name),
    mustChangePassword: false,
  }
}

export async function incorporarCompra(
  db: PrismaClient,
  opciones: OpcionesDeCompra,
): Promise<ResultadoDeCompra> {
  const { sucursal, marca } = opciones
  const motivo = (linea: LineaDeCompra) =>
    `${opciones.motivo ?? `Compra ${marca}`} · ${linea.origen}`
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LLAVE_DE_IMPORTACION}::int, ${sucursal}::int)`
        const antes = await totales(tx, sucursal)
        const vacio = { antes, despues: antes, creados: [], sumados: [] }

        const ya = await tx.auditLog.findFirst({
          where: {
            branchId: sucursal,
            tableName: 'Product',
            actionType: 'import',
            changes: { path: ['after', 'importacion'], equals: marca },
          },
          select: { id: true, timestamp: true },
        })
        if (ya) return { ...vacio, pasos: [], aplicado: false, yaAplicada: ya }

        const session = await sesionDe(tx, opciones.autor, sucursal)
        const catalogo = await tx.product.findMany({
          where: { branchId: sucursal, isActive: true },
          select: {
            id: true,
            name: true,
            saleUnit: true,
            lotTracking: true,
            barcodes: { where: { isPrimary: true }, select: { code: true } },
          },
          orderBy: { id: 'asc' },
        })
        const pasos = planificarCompra(
          catalogo.map((p) => ({
            id: p.id,
            nombre: p.name,
            codigoPrincipal: p.barcodes[0]?.code ?? null,
            saleUnit: p.saleUnit,
            lotTracking: p.lotTracking,
          })),
          opciones.lineas,
        )
        if (pasos.some((p) => p.accion === 'revisar')) {
          return { ...vacio, pasos, aplicado: false, yaAplicada: null }
        }

        // Los codigos nuevos no pueden ser de ningun producto, en ninguna
        // sucursal ni de baja: el lector de codigos los busca en todos.
        const codigos = pasos.flatMap((p) =>
          p.accion === 'crear' && p.linea.codigo ? [p.linea.codigo] : [],
        )
        const ocupado = await tx.productBarcode.findFirst({
          where: { code: { in: codigos } },
          select: { code: true, product: { select: { name: true } } },
        })
        if (ocupado) throw new Error(`El código ${ocupado.code} ya es de "${ocupado.product.name}"`)

        let categoria = await tx.category.findUnique({
          where: { name: SIN_CATEGORIA },
          select: { id: true, name: true },
        })
        if (categoria === null && pasos.some((p) => p.accion === 'crear')) {
          categoria = await tx.category.create({
            data: { name: SIN_CATEGORIA },
            select: { id: true, name: true },
          })
          await audit(tx, {
            userId: session.userId,
            branchId: sucursal,
            table: 'Category',
            recordId: categoria.id,
            action: 'create',
            after: categoria,
            reason: `Compra ${marca}`,
            origin: ORIGEN,
          })
        }

        const creados: ProductoTocado[] = []
        const sumados: ProductoTocado[] = []
        for (const paso of pasos) {
          if (paso.accion === 'crear' && categoria !== null) {
            const { linea } = paso
            const input = crearProductoSchema.parse({
              name: linea.nombre,
              barcode: linea.codigo,
              description: null,
              price: '0.00',
              cost: null,
              categoryId: categoria.id,
              supplierId: null,
              saleUnit: 'UNIT',
              purchaseUnit: 'UNIT',
              unitsPerPurchaseUnit: '1',
              totalStock: `${String(linea.cantidad)}.000`,
              minimumStock: '0.000',
            })
            exigir(input.name === linea.nombre, `el esquema cambió el nombre de "${linea.nombre}"`)
            const { producto } = await crearProductoEn(
              tx,
              session,
              input,
              categoria,
              ORIGEN,
              motivo(linea),
            )
            creados.push({
              id: producto.id,
              nombre: producto.name,
              cantidad: linea.cantidad,
              stockAntes: 0,
              stockDespues: await stockDe(tx, sucursal, producto.id),
            })
          } else if (paso.accion === 'sumar') {
            const { linea, producto } = paso
            const stockAntes = await stockDe(tx, sucursal, producto.id)
            await applyStockMovement(tx, {
              branchId: sucursal,
              productId: producto.id,
              type: 'MANUAL_ADJUSTMENT',
              quantity: cantidad(linea.cantidad),
              saleUnit: 'UNIT',
              userId: session.userId,
              reason: motivo(linea),
              referenceType: 'Product',
              referenceId: producto.id,
              audit: { origin: ORIGEN },
            })
            sumados.push({
              id: producto.id,
              nombre: producto.nombre,
              cantidad: linea.cantidad,
              stockAntes,
              stockDespues: await stockDe(tx, sucursal, producto.id),
            })
          }
        }

        const unidades = opciones.lineas.reduce((s, l) => s + l.cantidad, 0)
        await audit(tx, {
          userId: session.userId,
          branchId: sucursal,
          table: 'Product',
          recordId: null,
          action: 'import',
          after: {
            importacion: marca,
            creados: creados.length,
            sumados: sumados.length,
            unidades,
          },
          reason: `Compra ${marca}: ${String(creados.length)} productos nuevos y ${String(sumados.length)} con más stock`,
          origin: ORIGEN,
        })

        // Comprobaciones, todavia adentro de la transaccion.
        const despues = await totales(tx, sucursal)
        exigir(despues.productos === antes.productos + creados.length, 'la cantidad de productos')
        exigir(despues.unidades === antes.unidades + unidades, 'las unidades')
        exigir(despues.conPrecio === antes.conPrecio, 'un producto nuevo quedó con precio')
        for (const t of [...creados, ...sumados]) {
          exigir(t.stockDespues === t.stockAntes + t.cantidad, `el stock de "${t.nombre}"`)
          exigir(
            (await libroDe(tx, sucursal, t.id)) === t.stockDespues,
            `el libro de "${t.nombre}"`,
          )
        }

        const resultado = {
          pasos,
          antes,
          despues,
          creados,
          sumados,
          aplicado: opciones.aplicar,
          yaAplicada: null,
        }
        if (!opciones.aplicar) throw new Ensayo(resultado)
        return resultado
      },
      { timeout: 120_000, maxWait: 10_000 },
    )
  } catch (error) {
    if (error instanceof Ensayo) return error.resultado
    throw error
  }
}
