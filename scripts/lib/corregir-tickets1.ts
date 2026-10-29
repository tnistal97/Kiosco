/**
 * Corrige lo que la auditoria de las fotos de Tickets 1 demostro que se cargo
 * mal (docs/manual-house/auditoria-stock-house.md):
 *
 *   stock        los productos que la normalizacion de bultos multiplico otra
 *                vez. La planilla ya decia unidades ("2(4)" = 8 y decia 8) y
 *                `normalizar-bultos` sumo el "exceso" (8 -> 32). Se descuenta
 *                EXACTAMENTE ese exceso con un ajuste: no se escribe un saldo,
 *                asi que las ventas y los movimientos posteriores quedan;
 *   codigos      el codigo de venta copiado con un digito mal, por el que imprime
 *                el ticket (el viejo tiene el digito verificador invalido: ningun
 *                envase lo lleva);
 *   descripcion  un codigo de bulto mal copiado en la descripcion;
 *   nombres      los que el ticket desmiente ("ACE." es aceite, no aceitunas).
 *
 * Todo sale de un manifiesto revisado a ojo contra las fotos
 * (docs/manual-house/correcciones-tickets1.json). Cada producto se busca por
 * su nombre EXACTO de hoy, y cada correccion comprueba primero que la base
 * este como la auditoria la vio; si algo no coincide, no se corrige nada.
 *
 * Por las mismas puertas que el resto del sistema (`applyStockMovement` y la
 * bitacora con el antes y el despues), en UNA transaccion y una sola vez: la
 * entrada de resumen lleva la `marca`, y si ya esta, no se hace nada.
 * `aplicar: false` hace todo, comprueba y DESHACE.
 */
import type { PrismaClient } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { cantidad } from '@/server/cantidad'
import { applyStockMovement, type TxClient } from '@/modules/inventory/service'
import { claveDeNombre } from '@/modules/importacion/valores'
import { digitoVerificadorValido } from './coincidencia-de-productos'
import { ORIGEN as ORIGEN_DE_LA_NORMALIZACION, totales, type Totales } from './normalizar-bultos'

export const ORIGEN = 'scripts/corregir-tickets1'

/** La de la importacion de planillas y las compras: no corren a la vez. */
const LLAVE_DE_IMPORTACION = 7301

export interface CorreccionDeStock {
  /** Nombre exacto del producto activo, como esta hoy. */
  nombre: string
  /** Lo que imprime el ticket, para el motivo: "2(12) x 8147,90". */
  ticket: string
  /** Las unidades que dice el ticket: la verdad. */
  unidadesTicket: number
  /** Lo que sumo `normalizar-bultos` a este producto (sus movimientos). */
  agregadoPorLaNormalizacion: number
  /** Lo que sobra y se descuenta. */
  exceso: number
}

export interface CorreccionDeCodigo {
  nombre: string
  actual: string
  corregido: string
}

export interface CorreccionDeDescripcion {
  nombre: string
  buscar: string
  reemplazo: string
}

export interface CorreccionDeNombre {
  actual: string
  corregido: string
}

export interface Correcciones {
  marca: string
  stock: CorreccionDeStock[]
  codigos: CorreccionDeCodigo[]
  descripciones: CorreccionDeDescripcion[]
  nombres: CorreccionDeNombre[]
}

/** Un movimiento del libro de un producto, en orden. */
export interface Movimiento {
  id: number
  quantity: number
  previousQuantity: number
  /** Lo dejo `normalizar-bultos` (segun la bitacora). */
  deLaNormalizacion: boolean
}

export interface CuentaDeStock {
  /** El stock antes de la normalizacion. */
  base: number
  agregado: number
  /** La suma de todo lo que paso DESPUES de la normalizacion: ventas, ajustes. */
  posterior: number
  actual: number
  /** actual - exceso = unidades del ticket + posterior. */
  correcto: number
}

/**
 * La cuenta de un producto, pura. Tira error si la base no esta como la
 * auditoria la vio: entonces no se corrige nada.
 */
export function cuentaDeStock(
  c: CorreccionDeStock,
  movimientos: readonly Movimiento[],
  actual: number,
): CuentaDeStock {
  const deLaNormalizacion = movimientos.filter((m) => m.deLaNormalizacion)
  const primero = deLaNormalizacion[0]
  const ultimo = deLaNormalizacion.at(-1)
  if (primero === undefined || ultimo === undefined) {
    throw new Error(`"${c.nombre}": no tiene movimientos de la normalización de bultos`)
  }
  const agregado = deLaNormalizacion.reduce((s, m) => s + m.quantity, 0)
  if (agregado !== c.agregadoPorLaNormalizacion) {
    throw new Error(
      `"${c.nombre}": la normalización sumó ${String(agregado)}, el manifiesto dice ${String(c.agregadoPorLaNormalizacion)}`,
    )
  }
  const base = primero.previousQuantity
  if (base + agregado - c.exceso !== c.unidadesTicket) {
    throw new Error(
      `"${c.nombre}": ${String(base)} + ${String(agregado)} - ${String(c.exceso)} no da las ${String(c.unidadesTicket)} u. del ticket`,
    )
  }
  if (!Number.isInteger(c.exceso) || c.exceso <= 0 || c.exceso > agregado) {
    throw new Error(`"${c.nombre}": el exceso ${String(c.exceso)} no es un descuento posible`)
  }
  const posterior = movimientos.filter((m) => m.id > ultimo.id).reduce((s, m) => s + m.quantity, 0)
  const libro = movimientos.reduce((s, m) => s + m.quantity, 0)
  if (libro !== actual) {
    throw new Error(`"${c.nombre}": el libro suma ${String(libro)} y el stock es ${String(actual)}`)
  }
  if (ultimo.previousQuantity + ultimo.quantity + posterior !== actual) {
    throw new Error(`"${c.nombre}": el stock no se explica por la normalización y lo posterior`)
  }
  const correcto = actual - c.exceso
  if (correcto !== c.unidadesTicket + posterior) {
    throw new Error(`"${c.nombre}": la cuenta no cierra`)
  }
  if (correcto < 0) {
    throw new Error(
      `"${c.nombre}": quedaría en ${String(correcto)}: se vendió más de lo que entró según el ticket`,
    )
  }
  return { base, agregado, posterior, actual, correcto }
}

export interface ProductoCorregido {
  id: number
  nombre: string
  cuenta: CuentaDeStock
  stockDespues: number
}

export interface ResultadoDeCorreccion {
  antes: Totales
  despues: Totales
  stock: ProductoCorregido[]
  codigos: Array<{ id: number; nombre: string; antes: string; despues: string }>
  descripciones: Array<{ id: number; nombre: string; antes: string | null; despues: string }>
  nombres: Array<{ id: number; antes: string; despues: string }>
  aplicado: boolean
  yaAplicada: { id: number; timestamp: Date } | null
}

class Ensayo extends Error {
  constructor(readonly resultado: ResultadoDeCorreccion) {
    super('ensayo: se deshace')
  }
}

function exigir(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(`La corrección no cierra: ${mensaje}`)
}

async function productoPorNombre(tx: TxClient, sucursal: number, nombre: string) {
  const encontrados = await tx.product.findMany({
    where: { branchId: sucursal, isActive: true, name: nombre },
    select: {
      id: true,
      name: true,
      description: true,
      saleUnit: true,
      barcodes: { select: { code: true, isPrimary: true }, orderBy: { id: 'asc' } },
    },
  })
  const [producto] = encontrados
  if (encontrados.length !== 1 || producto === undefined) {
    throw new Error(
      `Hay ${String(encontrados.length)} productos activos llamados "${nombre}" (tiene que haber 1)`,
    )
  }
  return producto
}

async function stockDe(tx: TxClient, sucursal: number, productId: number): Promise<number> {
  const fila = await tx.branchStock.findUnique({
    where: { branchId_productId: { branchId: sucursal, productId } },
    select: { quantity: true },
  })
  return Number(fila?.quantity ?? 0)
}

async function movimientosDe(
  tx: TxClient,
  sucursal: number,
  productId: number,
): Promise<Movimiento[]> {
  const movimientos = await tx.stockMovement.findMany({
    where: { branchId: sucursal, productId },
    select: { id: true, quantity: true, previousQuantity: true },
    orderBy: { id: 'asc' },
  })
  const deLaNormalizacion = new Set(
    (
      await tx.auditLog.findMany({
        where: {
          tableName: 'StockMovement',
          actionType: 'create',
          origin: ORIGEN_DE_LA_NORMALIZACION,
          recordId: { in: movimientos.map((m) => m.id) },
        },
        select: { recordId: true },
      })
    ).map((a) => a.recordId),
  )
  return movimientos.map((m) => ({
    id: m.id,
    quantity: Number(m.quantity),
    previousQuantity: Number(m.previousQuantity),
    deLaNormalizacion: deLaNormalizacion.has(m.id),
  }))
}

async function ficha(tx: TxClient, id: number) {
  const p = await tx.product.findUniqueOrThrow({
    where: { id },
    select: {
      name: true,
      description: true,
      barcodes: { select: { code: true, isPrimary: true }, orderBy: { id: 'asc' } },
    },
  })
  return {
    name: p.name,
    description: p.description,
    barcode: p.barcodes.find((c) => c.isPrimary)?.code ?? null,
    alternateBarcodes: p.barcodes.filter((c) => !c.isPrimary).map((c) => c.code),
  }
}

/** El manifiesto no se contradice a si mismo. */
export function revisarManifiesto(c: Correcciones): void {
  const repetidos = (lista: string[]) => lista.filter((x, i) => lista.indexOf(x) !== i)
  const nombresDeStock = repetidos(c.stock.map((s) => s.nombre))
  if (nombresDeStock.length > 0) throw new Error(`Stock repetido: ${nombresDeStock.join(', ')}`)
  const corregidos = repetidos(c.nombres.map((n) => claveDeNombre(n.corregido)))
  if (corregidos.length > 0)
    throw new Error(`Dos productos quedarían con el mismo nombre: ${corregidos.join(', ')}`)
  for (const k of c.codigos) {
    if (digitoVerificadorValido(k.actual)) {
      throw new Error(
        `"${k.nombre}": el código actual ${k.actual} es válido; esta corrección es solo para los mal copiados`,
      )
    }
    if (!digitoVerificadorValido(k.corregido)) {
      throw new Error(`"${k.nombre}": el código ${k.corregido} no es válido`)
    }
  }
  for (const n of c.nombres) {
    if (n.corregido.trim() !== n.corregido || n.corregido === '') {
      throw new Error(`"${n.actual}": el nombre corregido tiene espacios de más o está vacío`)
    }
  }
}

export interface OpcionesDeCorreccion {
  sucursal: number
  autor: number
  correcciones: Correcciones
  /** false: hace todo, comprueba y deshace. */
  aplicar: boolean
}

export async function corregirTickets1(
  db: PrismaClient,
  opciones: OpcionesDeCorreccion,
): Promise<ResultadoDeCorreccion> {
  const { sucursal, autor, correcciones: c } = opciones
  revisarManifiesto(c)
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LLAVE_DE_IMPORTACION}::int, ${sucursal}::int)`
        const antes = await totales(tx, sucursal)
        const vacio = {
          antes,
          despues: antes,
          stock: [],
          codigos: [],
          descripciones: [],
          nombres: [],
        }
        const ya = await tx.auditLog.findFirst({
          where: {
            branchId: sucursal,
            tableName: 'Product',
            actionType: 'update',
            changes: { path: ['after', 'correccion'], equals: c.marca },
          },
          select: { id: true, timestamp: true },
        })
        if (ya) return { ...vacio, aplicado: false, yaAplicada: ya }

        const administrador = await tx.user.findFirst({
          where: { id: autor, isActive: true, role: { name: { in: ['admin', 'duenio'] } } },
          select: { id: true },
        })
        if (!administrador)
          throw new Error(`El autor ${String(autor)} no es un administrador activo`)
        const entrada = { userId: autor, branchId: sucursal, origin: ORIGEN }

        // 1. Stock: se descuenta el exceso, nunca se escribe el saldo.
        const stock: ProductoCorregido[] = []
        for (const s of c.stock) {
          const producto = await productoPorNombre(tx, sucursal, s.nombre)
          exigir(producto.saleUnit === 'UNIT', `"${s.nombre}" no se vende por unidad`)
          const actual = await stockDe(tx, sucursal, producto.id)
          const cuenta = cuentaDeStock(s, await movimientosDe(tx, sucursal, producto.id), actual)
          await applyStockMovement(tx, {
            branchId: sucursal,
            productId: producto.id,
            type: 'MANUAL_ADJUSTMENT',
            quantity: cantidad(-s.exceso),
            saleUnit: 'UNIT',
            userId: autor,
            reason:
              `Corrección Tickets 1 (${c.marca}): el ticket dice ${s.ticket} = ${String(s.unidadesTicket)} u. ` +
              `y la planilla ya decía unidades; la normalización de bultos había sumado ${String(s.exceso)} de más.` +
              (cuenta.posterior !== 0
                ? ` Se conserva lo posterior (${String(cuenta.posterior)}).`
                : ''),
            referenceType: 'Product',
            referenceId: producto.id,
            audit: { origin: ORIGEN },
          })
          stock.push({
            id: producto.id,
            nombre: producto.name,
            cuenta,
            stockDespues: await stockDe(tx, sucursal, producto.id),
          })
        }

        // 2. Codigos de venta mal copiados: el del ticket.
        const codigos: ResultadoDeCorreccion['codigos'] = []
        for (const k of c.codigos) {
          const producto = await productoPorNombre(tx, sucursal, k.nombre)
          const antesDe = await ficha(tx, producto.id)
          exigir(
            antesDe.barcode === k.actual,
            `"${k.nombre}" tiene el código ${String(antesDe.barcode)}, no ${k.actual}`,
          )
          const ocupado = await tx.productBarcode.findFirst({
            where: { code: k.corregido },
            select: { product: { select: { name: true } } },
          })
          if (ocupado)
            throw new Error(`El código ${k.corregido} ya es de "${ocupado.product.name}"`)
          await tx.productBarcode.deleteMany({ where: { productId: producto.id, code: k.actual } })
          await tx.productBarcode.updateMany({
            where: { productId: producto.id },
            data: { isPrimary: false },
          })
          await tx.productBarcode.create({
            data: { productId: producto.id, code: k.corregido, isPrimary: true },
          })
          await audit(tx, {
            ...entrada,
            table: 'Product',
            recordId: producto.id,
            action: 'update',
            before: antesDe,
            after: await ficha(tx, producto.id),
            reason: `Corrección Tickets 1: el ticket imprime ${k.corregido}; ${k.actual} tenía un dígito mal copiado`,
          })
          codigos.push({
            id: producto.id,
            nombre: producto.name,
            antes: k.actual,
            despues: k.corregido,
          })
        }

        // 3. Descripciones.
        const descripciones: ResultadoDeCorreccion['descripciones'] = []
        for (const d of c.descripciones) {
          const producto = await productoPorNombre(tx, sucursal, d.nombre)
          const antesDe = await ficha(tx, producto.id)
          exigir(
            antesDe.description?.includes(d.buscar) === true,
            `la descripción de "${d.nombre}" no dice "${d.buscar}"`,
          )
          const despues = (antesDe.description ?? '').replace(d.buscar, d.reemplazo)
          await tx.product.update({ where: { id: producto.id }, data: { description: despues } })
          await audit(tx, {
            ...entrada,
            table: 'Product',
            recordId: producto.id,
            action: 'update',
            before: antesDe,
            after: await ficha(tx, producto.id),
            reason: `Corrección Tickets 1: en la descripción, ${d.buscar} es ${d.reemplazo} según el ticket`,
          })
          descripciones.push({
            id: producto.id,
            nombre: producto.name,
            antes: antesDe.description,
            despues,
          })
        }

        // 4. Nombres, al final: lo anterior busca por el nombre de hoy.
        const activos = await tx.product.findMany({
          where: { branchId: sucursal, isActive: true },
          select: { id: true, name: true },
        })
        const nombres: ResultadoDeCorreccion['nombres'] = []
        for (const n of c.nombres) {
          const producto = await productoPorNombre(tx, sucursal, n.actual)
          const choca = activos.find(
            (p) => p.id !== producto.id && claveDeNombre(p.name) === claveDeNombre(n.corregido),
          )
          if (choca) throw new Error(`"${n.corregido}" ya es el nombre de #${String(choca.id)}`)
          const antesDe = await ficha(tx, producto.id)
          await tx.product.update({ where: { id: producto.id }, data: { name: n.corregido } })
          await audit(tx, {
            ...entrada,
            table: 'Product',
            recordId: producto.id,
            action: 'update',
            before: antesDe,
            after: await ficha(tx, producto.id),
            reason: `Corrección Tickets 1: el ticket desmiente "${n.actual}"`,
          })
          nombres.push({ id: producto.id, antes: n.actual, despues: n.corregido })
        }

        const exceso = c.stock.reduce((s, x) => s + x.exceso, 0)
        await audit(tx, {
          ...entrada,
          table: 'Product',
          recordId: null,
          action: 'update',
          after: {
            correccion: c.marca,
            stock: stock.length,
            unidadesDescontadas: exceso,
            codigos: codigos.length,
            descripciones: descripciones.length,
            nombres: nombres.length,
          },
          reason:
            `Corrección Tickets 1 (${c.marca}): ${String(stock.length)} stocks (-${String(exceso)} u.), ` +
            `${String(codigos.length)} códigos, ${String(descripciones.length)} descripciones y ${String(nombres.length)} nombres`,
        })

        // Comprobaciones, todavia adentro de la transaccion.
        const despues = await totales(tx, sucursal)
        exigir(despues.productos === antes.productos, 'la cantidad de productos')
        exigir(despues.unidades === antes.unidades - exceso, 'las unidades')
        exigir(despues.conPrecio === antes.conPrecio, 'los precios')
        exigir(despues.conCodigo === antes.conCodigo, 'los productos con código')
        exigir(despues.conFoto === antes.conFoto, 'las fotos')
        for (const s of stock) {
          exigir(s.stockDespues === s.cuenta.correcto, `el stock de "${s.nombre}"`)
          const libro = (await movimientosDe(tx, sucursal, s.id)).reduce(
            (t, m) => t + m.quantity,
            0,
          )
          exigir(libro === s.stockDespues, `el libro de "${s.nombre}"`)
        }

        const resultado = {
          antes,
          despues,
          stock,
          codigos,
          descripciones,
          nombres,
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
