/**
 * Carga precios de venta desde una lista ya revisada, por nombre exacto.
 *
 * Aca no se decide que fila es que producto: eso lo hizo la revision, que deja
 * el manifiesto. Este modulo comprueba que siga siendo verdad y aplica:
 *
 *   - el producto existe, una sola vez, activo, con ese nombre exacto;
 *   - nunca pisa un precio: si ya no esta en $0, alguien lo fijo despues de la
 *     revision y ese se respeta;
 *   - cada cambio deja su entrada en la bitacora con el antes y el despues;
 *   - solo cambia el precio: ni stock, ni costo, ni nombre.
 *
 * El manifiesto lleva precios y por eso NO va al repositorio, que es publico.
 *
 * Se aplica UNA vez: la entrada de resumen lleva la `marca`. Usa el bloqueo de
 * la importacion de planillas. `aplicar: false` hace todo, comprueba y deshace.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { audit } from '@/server/audit/audit'

export const ORIGEN = 'scripts/cargar-precios'

/** La de la importacion de planillas (src/modules/importacion/service.ts). */
const LLAVE_DE_IMPORTACION = 7301

export interface PrecioDeLista {
  nombre: string
  /** En pesos, con dos decimales: "2400.00". */
  precio: string
  /** Fila de la planilla: va al motivo. */
  fila: number
}

export interface OpcionesDePrecios {
  sucursal: number
  autor: number
  marca: string
  /** De donde salen, para el motivo: el nombre de la lista. */
  origen: string
  precios: readonly PrecioDeLista[]
  /** false: hace todo, comprueba y deshace. */
  aplicar: boolean
}

export interface ResultadoDePrecios {
  cargados: number
  /** Ya no estaban en $0: se respetan. */
  conPrecio: string[]
  sumaDePrecios: number
  aplicado: boolean
  yaAplicada: { id: number; timestamp: Date } | null
}

class Ensayo extends Error {
  constructor(readonly resultado: ResultadoDePrecios) {
    super('ensayo: se deshace')
  }
}

async function huellaDelStock(tx: Prisma.TransactionClient): Promise<string> {
  const [fila] = await tx.$queryRaw<Array<{ huella: string }>>`
    SELECT md5(string_agg("branchId" || '|' || "productId" || '|' || quantity::text, E'\n'
             ORDER BY "branchId", "productId")) AS huella
    FROM "BranchStock"
  `
  return fila?.huella ?? ''
}

export async function cargarPrecios(
  db: PrismaClient,
  opciones: OpcionesDePrecios,
): Promise<ResultadoDePrecios> {
  const { sucursal, marca } = opciones

  const repetidos = opciones.precios.filter(
    (p, i) => opciones.precios.findIndex((q) => q.nombre === p.nombre) !== i,
  )
  const repetido = repetidos[0]
  if (repetido) throw new Error(`"${repetido.nombre}" está dos veces en la lista`)
  const malo = opciones.precios.find((p) => !(Number(p.precio) > 0))
  if (malo) throw new Error(`"${malo.nombre}" no tiene un precio válido: ${malo.precio}`)

  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LLAVE_DE_IMPORTACION}::int, ${sucursal}::int)`

        const ya = await tx.auditLog.findFirst({
          where: {
            branchId: sucursal,
            tableName: 'Product',
            actionType: 'import',
            changes: { path: ['after', 'importacion'], equals: marca },
          },
          select: { id: true, timestamp: true },
        })
        if (ya) {
          return { cargados: 0, conPrecio: [], sumaDePrecios: 0, aplicado: false, yaAplicada: ya }
        }

        const autor = await tx.user.findFirst({
          where: {
            id: opciones.autor,
            isActive: true,
            role: { name: { in: ['admin', 'duenio'] } },
          },
          select: { id: true },
        })
        if (!autor)
          throw new Error(`El autor ${String(opciones.autor)} no es un administrador activo`)

        const activos = await tx.product.findMany({
          where: { branchId: sucursal, isActive: true },
          select: { id: true, name: true, price: true },
        })
        const stockAntes = await huellaDelStock(tx)

        const conPrecio: string[] = []
        let cargados = 0
        let sumaDePrecios = 0
        for (const p of opciones.precios) {
          const candidatos = activos.filter((a) => a.name === p.nombre)
          const producto = candidatos[0]
          if (candidatos.length !== 1 || producto === undefined) {
            throw new Error(
              `"${p.nombre}": hay ${String(candidatos.length)} productos activos con ese nombre`,
            )
          }
          if (Number(producto.price) !== 0) {
            conPrecio.push(p.nombre)
            continue
          }

          await tx.product.update({ where: { id: producto.id }, data: { price: p.precio } })
          await audit(tx, {
            userId: autor.id,
            branchId: sucursal,
            table: 'Product',
            recordId: producto.id,
            action: 'update',
            before: { price: producto.price.toString() },
            after: { price: p.precio },
            reason: `${opciones.origen} · fila ${String(p.fila)}`,
            origin: ORIGEN,
          })
          cargados++
          sumaDePrecios += Number(p.precio)
        }

        await audit(tx, {
          userId: autor.id,
          branchId: sucursal,
          table: 'Product',
          recordId: null,
          action: 'import',
          after: { importacion: marca, precios: cargados, respetados: conPrecio.length },
          reason: `${opciones.origen}: ${String(cargados)} precios`,
          origin: ORIGEN,
        })

        // Comprobaciones, todavia adentro de la transaccion.
        if ((await huellaDelStock(tx)) !== stockAntes) throw new Error('La carga cambió el stock')
        const despues = await tx.product.findMany({
          where: { branchId: sucursal, isActive: true },
          select: { name: true, price: true },
        })
        const lista = new Map(opciones.precios.map((p) => [p.nombre, p.precio]))
        const fijados = new Set(conPrecio)
        for (const d of despues) {
          const antes = activos.find((a) => a.name === d.name)
          const esperado =
            lista.has(d.name) && !fijados.has(d.name) ? lista.get(d.name) : antes?.price.toString()
          if (Number(d.price) !== Number(esperado)) {
            throw new Error(`"${d.name}" no quedó con el precio esperado`)
          }
        }

        const resultado = {
          cargados,
          conPrecio,
          sumaDePrecios,
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
