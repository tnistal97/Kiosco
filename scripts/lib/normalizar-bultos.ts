/**
 * Aplica en la base el plan de `scripts/lib/bultos.ts`: los productos cargados
 * como bulto pasan a contarse por unidad.
 *
 * Por las mismas puertas que el resto del sistema, dentro de UNA transaccion:
 *
 *   stock   `applyStockMovement`, como ajuste manual con su motivo ("2 bultos
 *           x 4 = 8 u.") y su entrada en la bitacora. Nunca se escribe el
 *           saldo, asi que el libro sigue reconstruyendo el stock.
 *   resto   el nombre, los codigos, la baja, la unidad de compra y la foto,
 *           cada uno con su entrada en la bitacora (el antes y el despues).
 *
 * Se puede repetir: lo que ya se normalizo no dice "bulto" o esta de baja, asi
 * que el plan siguiente no lo vuelve a multiplicar.
 *
 * `aplicar: false` hace todo, comprueba y DESHACE: el ensayo pasa por las
 * mismas restricciones de la base que la aplicacion de verdad.
 */
import type { PrismaClient } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { cantidad } from '@/server/cantidad'
import { applyStockMovement, type TxClient } from '@/modules/inventory/service'
import {
  planificar,
  type Consolidar,
  type Paso,
  type ProductoDelCatalogo,
  type Renombrar,
} from './bultos'

export const ORIGEN = 'scripts/normalizar-bultos'

/** Los productos activos de la sucursal, como los necesita el plan. */
export async function leerCatalogo(db: TxClient, sucursal: number): Promise<ProductoDelCatalogo[]> {
  const productos = await db.product.findMany({
    where: { branchId: sucursal, isActive: true },
    select: {
      id: true,
      name: true,
      saleUnit: true,
      lotTracking: true,
      purchaseUnit: true,
      unitsPerPurchaseUnit: true,
      imageSha256: true,
      barcodes: { select: { code: true, isPrimary: true }, orderBy: { id: 'asc' } },
      stocks: { where: { branchId: sucursal }, select: { quantity: true } },
    },
    orderBy: { id: 'asc' },
  })
  const conOtrosMovimientos = new Set(
    (
      await db.stockMovement.findMany({
        where: { productId: { in: productos.map((p) => p.id) }, type: { not: 'INITIAL' } },
        select: { productId: true },
        distinct: ['productId'],
      })
    ).map((m) => m.productId),
  )
  return productos.map((p) => ({
    id: p.id,
    nombre: p.name,
    stock: Number(p.stocks[0]?.quantity ?? 0),
    saleUnit: p.saleUnit,
    lotTracking: p.lotTracking,
    purchaseUnit: p.purchaseUnit,
    unitsPerPurchaseUnit: Number(p.unitsPerPurchaseUnit),
    codigos: [...p.barcodes]
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((c) => c.code),
    tieneFoto: p.imageSha256 !== null,
    soloCargaInicial: !conOtrosMovimientos.has(p.id),
  }))
}

export interface Totales {
  productos: number
  unidades: number
  /** Productos activos que dicen "bulto" en el nombre. */
  conBulto: number
  /** Productos activos con precio distinto de cero. */
  conPrecio: number
  conFoto: number
  conCodigo: number
}

export async function totales(db: TxClient, sucursal: number): Promise<Totales> {
  const [fila] = await db.$queryRaw<
    Array<{
      productos: bigint
      unidades: string | null
      con_bulto: bigint
      con_precio: bigint
      con_foto: bigint
      con_codigo: bigint
    }>
  >`
    SELECT count(*)                                                   AS productos,
           sum(coalesce(bs."quantity", 0))::text                      AS unidades,
           count(*) FILTER (WHERE p."name" ~* '\\mbulto\\M')          AS con_bulto,
           count(*) FILTER (WHERE p."price" <> 0)                     AS con_precio,
           count(*) FILTER (WHERE p."imageSha256" IS NOT NULL)        AS con_foto,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ProductBarcode" b WHERE b."productId" = p."id")) AS con_codigo
      FROM "Product" p
      LEFT JOIN "BranchStock" bs ON bs."productId" = p."id" AND bs."branchId" = p."branchId"
     WHERE p."branchId" = ${sucursal} AND p."isActive"
  `
  return {
    productos: Number(fila?.productos ?? 0),
    unidades: Number(fila?.unidades ?? 0),
    conBulto: Number(fila?.con_bulto ?? 0),
    conPrecio: Number(fila?.con_precio ?? 0),
    conFoto: Number(fila?.con_foto ?? 0),
    conCodigo: Number(fila?.con_codigo ?? 0),
  }
}

interface Contexto {
  sucursal: number
  autor: number
}

/** Lo que la bitacora guarda de un producto, antes y despues. */
async function ficha(tx: TxClient, id: number) {
  const p = await tx.product.findUniqueOrThrow({
    where: { id },
    select: {
      name: true,
      isActive: true,
      description: true,
      purchaseUnit: true,
      unitsPerPurchaseUnit: true,
      barcodes: { select: { code: true, isPrimary: true }, orderBy: { id: 'asc' } },
    },
  })
  return {
    name: p.name,
    isActive: p.isActive,
    description: p.description,
    purchaseUnit: p.purchaseUnit,
    unitsPerPurchaseUnit: p.unitsPerPurchaseUnit.toString(),
    barcode: p.barcodes.find((c) => c.isPrimary)?.code ?? null,
    alternateBarcodes: p.barcodes.filter((c) => !c.isPrimary).map((c) => c.code),
  }
}

async function anotar(
  tx: TxClient,
  ctx: Contexto,
  id: number,
  antes: Awaited<ReturnType<typeof ficha>>,
  motivo: string,
): Promise<void> {
  const despues = await ficha(tx, id)
  if (JSON.stringify(antes) === JSON.stringify(despues)) return
  await audit(tx, {
    userId: ctx.autor,
    branchId: ctx.sucursal,
    table: 'Product',
    recordId: id,
    action: 'update',
    before: antes,
    after: despues,
    reason: motivo,
    origin: ORIGEN,
  })
}

async function ajustar(
  tx: TxClient,
  ctx: Contexto,
  productId: number,
  delta: number,
  motivo: string,
  referencia: number,
) {
  if (delta === 0) return
  await applyStockMovement(tx, {
    branchId: ctx.sucursal,
    productId,
    type: 'MANUAL_ADJUSTMENT',
    quantity: cantidad(delta),
    saleUnit: 'UNIT',
    userId: ctx.autor,
    reason: motivo,
    referenceType: 'Product',
    referenceId: referencia,
    audit: { origin: ORIGEN },
  })
}

/** Deja exactamente estos codigos, el primero como principal. */
async function fijarCodigos(tx: TxClient, productId: number, codigos: string[]): Promise<void> {
  if (codigos.length > 0) {
    const ocupado = await tx.productBarcode.findFirst({
      where: { code: { in: codigos }, productId: { not: productId } },
      select: { code: true, product: { select: { name: true } } },
    })
    if (ocupado) throw new Error(`El código ${ocupado.code} ya es de "${ocupado.product.name}"`)
  }
  await tx.productBarcode.deleteMany({ where: { productId } })
  if (codigos.length > 0) {
    await tx.productBarcode.createMany({
      data: codigos.map((code, i) => ({ productId, code, isPrimary: i === 0 })),
    })
  }
}

function conNota(descripcion: string | null, nota: string | null): string | null {
  if (nota === null || descripcion?.includes(nota)) return descripcion
  return descripcion ? `${descripcion}\n${nota}` : nota
}

const caja = (n: number) => ({ purchaseUnit: 'BOX', unitsPerPurchaseUnit: n })

async function renombrar(tx: TxClient, ctx: Contexto, paso: Renombrar): Promise<void> {
  const { bulto: b } = paso
  const antes = await ficha(tx, b.id)
  await ajustar(
    tx,
    ctx,
    b.id,
    paso.unidades - paso.bultos,
    `Por unidad: ${String(paso.bultos)} bultos x ${String(paso.multiplicador)} = ${String(paso.unidades)} u. ` +
      `Figuraba como "${b.nombre}".`,
    b.id,
  )
  await fijarCodigos(tx, b.id, paso.codigoDeUnidad ? [paso.codigoDeUnidad] : [])
  await tx.product.update({
    where: { id: b.id },
    data: {
      name: paso.nombre,
      description: conNota(antes.description, paso.nota),
      ...(paso.fijarCompra ? caja(paso.multiplicador) : {}),
    },
  })
  await anotar(tx, ctx, b.id, antes, `Normalización por unidad: era "${b.nombre}"`)
}

async function consolidar(tx: TxClient, ctx: Contexto, paso: Consolidar): Promise<void> {
  const { bulto: b, unidad: u } = paso
  const antesDelBulto = await ficha(tx, b.id)
  const antesDeLaUnidad = await ficha(tx, u.id)
  const cuenta = `${String(paso.bultos)} bultos x ${String(paso.multiplicador)} = ${String(paso.unidades)} u.`

  await ajustar(
    tx,
    ctx,
    b.id,
    -paso.bultos,
    `Por unidad: pasa a "${paso.nombre}" (#${String(u.id)}) como ${cuenta}`,
    u.id,
  )
  await ajustar(
    tx,
    ctx,
    u.id,
    paso.unidades,
    `Por unidad: ${cuenta} de "${b.nombre}" (#${String(b.id)})`,
    b.id,
  )

  // La foto del bulto: a la unidad si no tiene, y si tiene, sobra. El
  // disparador de ProductImage actualiza `imageSha256` de los dos productos.
  if (paso.foto !== null) {
    const foto = await tx.productImage.findUniqueOrThrow({
      where: { productId: b.id },
      select: { sha256: true, sourceUrl: true, width: true, height: true },
    })
    const entrada = {
      userId: ctx.autor,
      branchId: ctx.sucursal,
      table: 'ProductImage',
      origin: ORIGEN,
    }
    if (paso.foto === 'mover') {
      await tx.productImage.update({ where: { productId: b.id }, data: { productId: u.id } })
      await audit(tx, {
        ...entrada,
        recordId: u.id,
        action: 'create',
        after: foto,
        reason: `Era la foto de "${b.nombre}"`,
      })
    } else {
      await tx.productImage.delete({ where: { productId: b.id } })
    }
    await audit(tx, {
      ...entrada,
      recordId: b.id,
      action: 'delete',
      before: foto,
      reason: paso.foto === 'mover' ? `Pasa a "${paso.nombre}"` : `"${paso.nombre}" ya tiene foto`,
    })
  }

  await fijarCodigos(tx, b.id, [])
  await tx.product.update({ where: { id: b.id }, data: { isActive: false } })
  await anotar(tx, ctx, b.id, antesDelBulto, `Normalización por unidad: pasa a "${paso.nombre}"`)

  if (paso.codigoDeUnidad !== null && antesDeLaUnidad.barcode === null) {
    await fijarCodigos(tx, u.id, [paso.codigoDeUnidad, ...antesDeLaUnidad.alternateBarcodes])
  }
  await tx.product.update({
    where: { id: u.id },
    data: {
      description: conNota(antesDeLaUnidad.description, paso.nota),
      ...(paso.fijarCompra ? caja(paso.multiplicador) : {}),
    },
  })
  await anotar(tx, ctx, u.id, antesDeLaUnidad, `Normalización por unidad: recibe "${b.nombre}"`)
}

export interface OpcionesDeNormalizacion {
  sucursal: number
  autor: number
  codigosVerificados?: ReadonlyMap<string, string>
  /** false: hace todo, comprueba y deshace. */
  aplicar: boolean
}

export interface Resultado {
  pasos: Paso[]
  antes: Totales
  despues: Totales
  aplicado: boolean
}

class Ensayo extends Error {
  constructor(readonly resultado: Resultado) {
    super('ensayo: se deshace')
  }
}

export async function normalizarBultos(
  db: PrismaClient,
  opciones: OpcionesDeNormalizacion,
): Promise<Resultado> {
  const ctx: Contexto = { sucursal: opciones.sucursal, autor: opciones.autor }
  try {
    return await db.$transaction(
      async (tx) => {
        const antes = await totales(tx, ctx.sucursal)
        const pasos = planificar(await leerCatalogo(tx, ctx.sucursal), {
          codigosVerificados: opciones.codigosVerificados,
        })
        for (const paso of pasos) {
          if (paso.accion === 'renombrar') await renombrar(tx, ctx, paso)
          else if (paso.accion === 'consolidar') await consolidar(tx, ctx, paso)
        }
        const resultado = {
          pasos,
          antes,
          despues: await totales(tx, ctx.sucursal),
          aplicado: opciones.aplicar,
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
