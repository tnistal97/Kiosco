/**
 * Cambio masivo de precios. Fase P0-B.
 *
 *   seleccionar → configurar → vista previa → confirmar → aplicar
 *
 * La vista previa no escribe nada. Aplicar vuelve a calcular todo desde la
 * base, con las filas de los productos bloqueadas, y se niega si el resultado
 * no es el que se mostro: un precio que alguien cambio en el medio no se pisa
 * con una cuenta hecha sobre el precio viejo.
 *
 * EL HISTORIAL. El precio no tiene tabla de historial propia: su historia es
 * la bitacora, que es de donde la ficha del producto lee "Precio: antes →
 * despues" (`cambiosDePrecio` en service.ts). Cada producto cambiado deja ahi
 * su entrada `update` con el antes y el despues, igual que un cambio a mano, y
 * el cambio entero deja una entrada `price_bulk_update` con el criterio.
 *
 * DESHACER. Cada entrada por producto lleva el identificador del cambio
 * masivo. Deshacer el ULTIMO lee esas entradas y devuelve cada producto a su
 * precio anterior, pero SOLO si hoy sigue teniendo el precio que le puso ese
 * cambio: si alguien lo toco despues, se respeta y se informa. No hay tabla
 * nueva: es la misma bitacora, que solo escribe el servidor.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { audit } from '@/server/audit/audit'
import { conflict, forbidden, invalid } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { formatearMonto, type Monto } from '@/lib/money'
import {
  CERO_D,
  aMonto,
  aMontoCosto,
  comparar,
  dinero,
  dividir,
  esCero,
  multiplicar,
  restar,
  sumar,
  type Dinero,
} from '@/server/money'
import { puedeVerCosto } from './service'
import { calcularPrecio, describirCriterio, type CriterioDePrecio } from './precios'
import type { PedidoDeAplicarPrecios, PedidoDeVistaDePrecios, SeleccionDePrecios } from './schemas'
import type {
  ItemDePrecio,
  ResultadoDeDeshacer,
  ResultadoDePrecios,
  ResumenDePrecios,
  UltimoCambioMasivo,
  VistaDePrecios,
} from './precios-dto'

type Cliente = Prisma.TransactionClient | typeof prisma

export const ORIGEN_PRECIOS = 'POST /api/products/prices'
export const ORIGEN_DESHACER = 'POST /api/products/prices/undo'

/** Mas que esto no es un cambio de precios, es un error de seleccion. */
const TOPE_DE_PRODUCTOS = 10_000

/**
 * Tope de la transaccion. Cinco mil precios tardan unos segundos; esto es la
 * red por si la base esta ocupada. Tambien acota donde buscar las entradas de
 * un cambio al deshacerlo: todas se escribieron dentro de este lapso.
 */
const TIEMPO_MAXIMO_MS = 3 * 60_000

interface Candidato {
  id: number
  name: string
  price: Dinero
  cost: Dinero | null
  isActive: boolean
  categoria: string
  codigo: string | null
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex')
}

async function candidatos(
  db: Cliente,
  session: Session,
  seleccion: SeleccionDePrecios,
): Promise<Candidato[]> {
  const where: Prisma.ProductWhereInput = {
    branchId: session.branchId,
    ...(seleccion.incluirInactivos ? {} : { isActive: true }),
    ...(seleccion.categoriaId === undefined ? {} : { categoryId: seleccion.categoriaId }),
    ...(seleccion.proveedorId === undefined
      ? {}
      : { suppliers: { some: { supplierId: seleccion.proveedorId } } }),
    ...(seleccion.busqueda
      ? {
          OR: [
            { name: { contains: seleccion.busqueda, mode: 'insensitive' as const } },
            {
              barcodes: {
                some: { code: { contains: seleccion.busqueda, mode: 'insensitive' as const } },
              },
            },
          ],
        }
      : {}),
  }

  const productos = await db.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      price: true,
      cost: true,
      isActive: true,
      category: { select: { name: true } },
      barcodes: { where: { isPrimary: true }, select: { code: true }, take: 1 },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: TOPE_DE_PRODUCTOS + 1,
  })
  if (productos.length > TOPE_DE_PRODUCTOS) {
    throw invalid(
      `La selección tiene más de ${TOPE_DE_PRODUCTOS.toLocaleString('es-AR')} productos. Acotala con una categoría o una búsqueda.`,
    )
  }

  return productos.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    cost: p.cost,
    isActive: p.isActive,
    categoria: p.category.name,
    codigo: p.barcodes[0]?.code ?? null,
  }))
}

/** El criterio aplicado a cada producto, y la huella de ese resultado. */
function calcular(
  lista: Candidato[],
  criterio: CriterioDePrecio,
  veCosto: boolean,
): { items: ItemDePrecio[]; huella: string } {
  const items = lista.map((p): ItemDePrecio => {
    const antes = aMonto(p.price)
    const costo = p.cost === null ? null : aMontoCosto(p.cost)
    const r = calcularPrecio(antes, costo, criterio)
    const base = {
      id: p.id,
      nombre: p.name,
      codigo: p.codigo,
      categoria: p.categoria,
      activo: p.isActive,
      antes,
      costo: veCosto ? costo : null,
    }
    if (!r.ok)
      return { ...base, despues: null, estado: 'no-aplica', motivo: r.motivo, bajoCosto: false }
    return {
      ...base,
      despues: r.precio,
      estado: r.precio === antes ? 'igual' : 'cambia',
      motivo: null,
      bajoCosto: veCosto && p.cost !== null && comparar(dinero(r.precio), p.cost) < 0,
    }
  })

  // La huella cubre la seleccion ENTERA con sus precios de antes y de despues:
  // un producto que entro o salio, o un precio que cambio, la cambian. Los
  // destildados no: se pueden destildar sin pedir otra vista previa.
  const huella = sha256(JSON.stringify([criterio, items.map((i) => [i.id, i.antes, i.despues])]))
  return { items, huella }
}

function resumir(items: ItemDePrecio[]): ResumenDePrecios {
  const cambian = items.filter((i) => i.estado === 'cambia')
  let minimo: Monto | null = null
  let maximo: Monto | null = null
  let antes = CERO_D
  let despues = CERO_D
  for (const i of cambian) {
    if (i.despues === null) continue
    const d = dinero(i.despues)
    if (minimo === null || comparar(d, dinero(minimo)) < 0) minimo = i.despues
    if (maximo === null || comparar(d, dinero(maximo)) > 0) maximo = i.despues
    antes = sumar(antes, dinero(i.antes))
    despues = sumar(despues, d)
  }
  // La variacion del TOTAL y no el promedio de los porcentajes: un aumento del
  // 50 % en un chicle no pesa lo mismo que uno del 5 % en un fernet.
  const variacion = esCero(antes)
    ? null
    : multiplicar(dividir(restar(despues, antes), antes), 100).toFixed(2)

  return {
    productos: items.length,
    cambian: cambian.length,
    iguales: items.filter((i) => i.estado === 'igual').length,
    noAplican: items.filter((i) => i.estado === 'no-aplica').length,
    minimo,
    maximo,
    variacion,
  }
}

function exigirCosto(session: Session, criterio: CriterioDePrecio): void {
  if (criterio.operacion === 'costo-mas' && !puedeVerCosto(session)) {
    throw forbidden('Para calcular el precio desde el costo hace falta poder ver los costos.')
  }
}

/** Vista previa. No escribe nada. */
export async function previsualizarPrecios(
  session: Session,
  pedido: PedidoDeVistaDePrecios,
): Promise<VistaDePrecios> {
  exigirCosto(session, pedido.criterio)
  const lista = await candidatos(prisma, session, pedido.seleccion)
  const { items, huella } = calcular(lista, pedido.criterio, puedeVerCosto(session))
  return { descripcion: describirCriterio(pedido.criterio), huella, resumen: resumir(items), items }
}

/**
 * Aplicar, todo junto o nada.
 *
 * Las filas se bloquean ANTES de releer los precios, y se comprueba que la
 * seleccion siga siendo la misma que se bloqueo: si entro un producto nuevo en
 * el medio, su precio podria cambiar sin bloqueo y se aplicaria una cuenta
 * vieja. En ese caso, como en cualquier otra diferencia con la vista previa,
 * no se aplica nada.
 */
export async function aplicarPrecios(
  session: Session,
  pedido: PedidoDeAplicarPrecios,
): Promise<ResultadoDePrecios> {
  exigirCosto(session, pedido.criterio)
  const descripcion = describirCriterio(pedido.criterio)
  const operacion = randomUUID()
  const excluidos = new Set(pedido.excluidos)

  return prisma.$transaction(
    async (tx) => {
      const primera = await candidatos(tx, session, pedido.seleccion)
      const ids = primera.map((p) => p.id)
      if (ids.length > 0) {
        await tx.$queryRaw`
          SELECT "id" FROM "Product"
           WHERE "id" = ANY(${ids}::int[]) AND "branchId" = ${session.branchId}
           FOR NO KEY UPDATE
        `
      }
      const lista = await candidatos(tx, session, pedido.seleccion)
      const mismos = lista.length === ids.length && lista.every((p, i) => p.id === ids[i])

      const { items, huella } = calcular(lista, pedido.criterio, puedeVerCosto(session))
      if (!mismos || huella !== pedido.huella) {
        throw conflict(
          'Cambiaron precios o productos desde la vista previa. Revisala de nuevo antes de aplicar.',
          { code: 'PRICES_CHANGED' },
        )
      }

      const aplicar = items.filter((i) => i.estado === 'cambia' && !excluidos.has(i.id))
      if (aplicar.length === 0) throw invalid('No quedó ningún precio para cambiar.')

      for (const i of aplicar) {
        if (i.despues === null) continue
        await tx.product.update({ where: { id: i.id }, data: { price: i.despues } })
        await audit(tx, {
          userId: session.userId,
          branchId: session.branchId,
          table: 'Product',
          recordId: i.id,
          action: 'update',
          reason: descripcion,
          before: { price: i.antes },
          after: { price: i.despues, cambioMasivo: operacion },
          origin: ORIGEN_PRECIOS,
        })
      }

      const resumen = resumir(aplicar)
      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Product',
        recordId: null,
        action: 'price_bulk_update',
        reason: descripcion,
        after: {
          operacion,
          criterio: pedido.criterio,
          seleccion: pedido.seleccion,
          productos: aplicar.length,
          destildados: excluidos.size,
          minimo: resumen.minimo,
          maximo: resumen.maximo,
          variacion: resumen.variacion,
        },
        origin: ORIGEN_PRECIOS,
      })

      return { operacion, cambiados: aplicar.length, descripcion }
    },
    { timeout: TIEMPO_MAXIMO_MS, maxWait: 10_000 },
  )
}

// ---------------------------------------------------------------------------
// Deshacer el ultimo
// ---------------------------------------------------------------------------

const ACCIONES_MASIVAS = ['price_bulk_update', 'price_bulk_undo']

function objeto(v: Prisma.JsonValue | undefined): Prisma.JsonObject | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null
}

async function ultimaEntrada(db: Cliente, session: Session) {
  return db.auditLog.findFirst({
    where: {
      branchId: session.branchId,
      tableName: 'Product',
      actionType: { in: ACCIONES_MASIVAS },
      result: 'success',
    },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      actionType: true,
      timestamp: true,
      reason: true,
      changes: true,
      user: { select: { name: true } },
    },
  })
}

/** El ultimo cambio masivo de la sucursal, y si se puede deshacer. */
export async function ultimoCambioMasivo(session: Session): Promise<UltimoCambioMasivo | null> {
  const ultima = await ultimaEntrada(prisma, session)
  if (!ultima) return null
  const despues = objeto(objeto(ultima.changes)?.after)
  const operacion = despues?.operacion
  const productos = despues?.productos ?? despues?.restaurados
  return {
    operacion: typeof operacion === 'string' ? operacion : '',
    fecha: ultima.timestamp.toISOString(),
    usuario: ultima.user.name,
    descripcion: ultima.reason ?? '',
    productos: typeof productos === 'number' ? productos : 0,
    // Deshacer un "deshacer" seria rehacer: no se ofrece.
    deshacible: ultima.actionType === 'price_bulk_update' && typeof operacion === 'string',
  }
}

/**
 * Devuelve a su precio anterior los productos del ULTIMO cambio masivo.
 *
 * Solo el ultimo, y solo los productos que hoy siguen con el precio que les
 * puso ese cambio. Los demas se informan y no se tocan: alguien los cambio
 * despues, y deshacer no puede pisar una decision posterior.
 */
export async function deshacerCambioMasivo(
  session: Session,
  operacion: string,
): Promise<ResultadoDeDeshacer> {
  return prisma.$transaction(
    async (tx) => {
      const ultima = await ultimaEntrada(tx, session)
      const despues = objeto(objeto(ultima?.changes)?.after)
      if (
        !ultima ||
        ultima.actionType !== 'price_bulk_update' ||
        despues?.operacion !== operacion
      ) {
        throw conflict(
          'Solo se puede deshacer el último cambio masivo de precios, y ese ya no es el último.',
          { code: 'PRICES_CHANGED' },
        )
      }

      // Las entradas de cada producto se escribieron en la misma transaccion,
      // justo antes del resumen: se buscan en esa ventana, por su identificador.
      const entradas = await tx.auditLog.findMany({
        where: {
          branchId: session.branchId,
          tableName: 'Product',
          actionType: 'update',
          origin: ORIGEN_PRECIOS,
          timestamp: {
            gte: new Date(ultima.timestamp.getTime() - TIEMPO_MAXIMO_MS),
            lte: ultima.timestamp,
          },
          changes: { path: ['after', 'cambioMasivo'], equals: operacion },
        },
        select: { recordId: true, changes: true },
      })

      const ids = entradas.flatMap((e) => (e.recordId === null ? [] : [e.recordId]))
      if (ids.length > 0) {
        await tx.$queryRaw`
          SELECT "id" FROM "Product"
           WHERE "id" = ANY(${ids}::int[]) AND "branchId" = ${session.branchId}
           FOR NO KEY UPDATE
        `
      }
      const hoy = new Map(
        (
          await tx.product.findMany({
            where: { id: { in: ids }, branchId: session.branchId },
            select: { id: true, name: true, price: true },
          })
        ).map((p) => [p.id, p]),
      )

      const nueva = randomUUID()
      const motivo = `Deshacer: ${ultima.reason ?? 'cambio masivo de precios'}`
      const saltados: Array<{ nombre: string; motivo: string }> = []
      let restaurados = 0

      for (const e of entradas) {
        const cambios = objeto(e.changes)
        const anterior = objeto(cambios?.before)?.price
        const puesto = objeto(cambios?.after)?.price
        const producto = e.recordId === null ? undefined : hoy.get(e.recordId)
        if (typeof anterior !== 'string' || typeof puesto !== 'string' || !producto) {
          saltados.push({
            nombre: producto?.name ?? `#${String(e.recordId)}`,
            motivo: 'Ya no existe.',
          })
          continue
        }
        if (aMonto(producto.price) !== puesto) {
          saltados.push({
            nombre: producto.name,
            motivo: `Lo cambiaron después: hoy está a ${formatearMonto(aMonto(producto.price))}.`,
          })
          continue
        }
        await tx.product.update({ where: { id: producto.id }, data: { price: anterior } })
        await audit(tx, {
          userId: session.userId,
          branchId: session.branchId,
          table: 'Product',
          recordId: producto.id,
          action: 'update',
          reason: motivo,
          before: { price: puesto },
          after: { price: anterior, cambioMasivo: nueva },
          origin: ORIGEN_DESHACER,
        })
        restaurados++
      }

      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Product',
        recordId: null,
        action: 'price_bulk_undo',
        reason: motivo,
        after: { operacion: nueva, deshace: operacion, restaurados, saltados: saltados.length },
        origin: ORIGEN_DESHACER,
      })

      return { restaurados, saltados: saltados.slice(0, 50), totalSaltados: saltados.length }
    },
    { timeout: TIEMPO_MAXIMO_MS, maxWait: 10_000 },
  )
}
