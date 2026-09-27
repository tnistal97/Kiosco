/**
 * Importacion de productos desde una planilla. Fase P0-B.
 *
 * Dos operaciones que comparten UN plan:
 *
 *   vista previa   arma el plan y lo devuelve. No escribe nada.
 *   importar       vuelve a armar el plan desde cero, comprueba que sea el
 *                  mismo que se mostro y lo aplica, todo o nada, en una sola
 *                  transaccion.
 *
 * El plan se arma dos veces a proposito: lo que llega a `importar` puede no
 * venir de la pantalla, y entre la vista previa y la confirmacion alguien pudo
 * cargar un producto del archivo. Nada de lo que dijo la vista previa se usa
 * para escribir; solo su huella, para saber si el plan sigue siendo el mismo.
 *
 * Lo que la importacion NO hace por su cuenta: dar de alta, cambiar costos ni
 * mover stock. Para eso usa las puertas de siempre (`crearProductoEn`,
 * `actualizarProductoImportado`, que adentro usan `registrarCambioDeCosto` y
 * `applyStockMovement`). Una planilla de cinco mil filas deja el mismo rastro
 * que cinco mil altas hechas a mano: movimiento INITIAL, historial de costos y
 * bitacora, producto por producto, mas una entrada que resume la importacion.
 *
 * Ver docs/IMPORTACION_Y_PRECIOS.md.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { audit } from '@/server/audit/audit'
import { conflict, invalid } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import type { Permission } from '@/server/authz/permissions'
import type { Monto } from '@/lib/money'
import type { TextoCantidad } from '@/lib/cantidad'
import { aMonto, aMontoCosto, comparar, dinero, iguales, type Dinero } from '@/server/money'
import {
  aTextoCantidad,
  cantidad as aCantidad,
  esCeroCantidad,
  igualesCantidades,
  sumarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import {
  actualizarProductoImportado,
  crearProductoEn,
  puedeVerCosto,
  type CambiosImportados,
} from '@/modules/products/service'
import {
  POLITICA_DE_UNIDAD,
  unidadDeVentaODefecto,
  type UnidadDeVenta,
} from '@/modules/products/units'
import type { Campo, ValorCrudo } from './columnas'
import type {
  AccionDeFila,
  CambioDeFila,
  FilaDeVistaPrevia,
  ResultadoDeImportacion,
  TotalesDeVistaPrevia,
  VistaPrevia,
} from './dto'
import type { PedidoDeImportacion, PedidoDeVistaPrevia } from './schemas'
import {
  claveDeNombre,
  leerCantidad,
  leerCategoria,
  leerCodigo,
  leerCosto,
  leerNombre,
  leerPrecio,
  leerUnidad,
  type Lectura,
} from './valores'

type Cliente = Prisma.TransactionClient | typeof prisma

/** Operacion de la bitacora, en cada producto y en el resumen. */
export const ORIGEN_IMPORTACION = 'POST /api/products/import'

/** La categoria de los productos nuevos que no traen una. */
export const SIN_CATEGORIA = 'Sin categoría'

/**
 * Espacio del bloqueo consultivo: una importacion por sucursal a la vez.
 *
 * Dos importaciones simultaneas --el doble clic, dos pestañas-- armarian su plan
 * sobre el mismo catalogo y las dos darian de alta los mismos productos. Con el
 * bloqueo, la segunda espera a que termine la primera y arma su plan sobre lo
 * que la primera dejo.
 */
const LLAVE_DE_IMPORTACION = 7301

/**
 * Tope de la transaccion. Cinco mil productos tardan bastante menos (ver el
 * informe de volumen en docs/IMPORTACION_Y_PRECIOS.md); esto es la red por si
 * la base esta ocupada, no una estimacion.
 */
const TIEMPO_MAXIMO_MS = 10 * 60_000

// ---------------------------------------------------------------------------
// El catalogo, leido una vez
// ---------------------------------------------------------------------------

interface ProductoDelCatalogo {
  id: number
  name: string
  price: Dinero
  cost: Dinero | null
  saleUnit: UnidadDeVenta
  minimumStock: Cantidad
  categoryId: number
  categoria: string
  isActive: boolean
  lotTracking: string
  stock: Cantidad
}

interface Catalogo {
  porCodigo: Map<string, ProductoDelCatalogo>
  porNombre: Map<string, ProductoDelCatalogo[]>
  categorias: Map<string, { id: number; name: string }>
  /** Codigos del archivo que ya tiene un producto de OTRA sucursal. */
  ajenos: Set<string>
}

/** De a cuantos codigos se pregunta por los de otras sucursales. */
const LOTE_DE_CODIGOS = 5_000

async function leerCatalogo(db: Cliente, session: Session, codigos: string[]): Promise<Catalogo> {
  const [productos, categorias] = await Promise.all([
    db.product.findMany({
      where: { branchId: session.branchId },
      select: {
        id: true,
        name: true,
        price: true,
        cost: true,
        saleUnit: true,
        minimumStock: true,
        categoryId: true,
        isActive: true,
        lotTracking: true,
        category: { select: { name: true } },
        barcodes: { select: { code: true } },
        stocks: { where: { branchId: session.branchId }, select: { quantity: true } },
      },
    }),
    db.category.findMany({ select: { id: true, name: true } }),
  ])

  const porCodigo = new Map<string, ProductoDelCatalogo>()
  const porNombre = new Map<string, ProductoDelCatalogo[]>()
  for (const p of productos) {
    const producto: ProductoDelCatalogo = {
      id: p.id,
      name: p.name,
      price: p.price,
      cost: p.cost,
      saleUnit: unidadDeVentaODefecto(p.saleUnit),
      minimumStock: p.minimumStock,
      categoryId: p.categoryId,
      categoria: p.category.name,
      isActive: p.isActive,
      lotTracking: p.lotTracking,
      stock: p.stocks[0]?.quantity ?? aCantidad(0),
    }
    for (const b of p.barcodes) porCodigo.set(b.code, producto)
    const clave = claveDeNombre(p.name)
    porNombre.set(clave, [...(porNombre.get(clave) ?? []), producto])
  }

  const ajenos = new Set<string>()
  const buscar = codigos.filter((c) => !porCodigo.has(c))
  for (let i = 0; i < buscar.length; i += LOTE_DE_CODIGOS) {
    const ocupados = await db.productBarcode.findMany({
      where: { code: { in: buscar.slice(i, i + LOTE_DE_CODIGOS) } },
      select: { code: true },
    })
    for (const o of ocupados) ajenos.add(o.code)
  }

  return {
    porCodigo,
    porNombre,
    categorias: new Map(categorias.map((c) => [claveDeNombre(c.name), c])),
    ajenos,
  }
}

// ---------------------------------------------------------------------------
// El plan
// ---------------------------------------------------------------------------

/** Lo que hace falta para dar de alta una fila. Ya validado. */
interface Alta {
  nombre: string
  codigo: string | null
  precio: Monto
  costo: string | null
  unidad: UnidadDeVenta
  categoria: string
  stockInicial: TextoCantidad
  stockMinimo: TextoCantidad
}

/** Lo que hace falta para actualizar una fila. Ya validado. */
interface Actualizacion {
  productoId: number
  cambios: Omit<CambiosImportados, 'categoryId'>
  /** Nombre de la categoria nueva, si cambia. Se resuelve a id al aplicar. */
  categoria: string | null
}

interface FilaPlaneada {
  publica: FilaDeVistaPrevia
  alta: Alta | null
  actualizacion: Actualizacion | null
}

interface Plan {
  filas: FilaPlaneada[]
  bloqueos: string[]
  /** Clave normalizada → nombre con que se va a crear. */
  categoriasNuevas: Map<string, string>
  categorias: Map<string, { id: number; name: string }>
  huella: string
  totales: TotalesDeVistaPrevia
}

/** Las celdas de una fila, ya leidas, antes de mirar el catalogo. */
interface Leida {
  fila: number
  codigo: string | null
  /** El codigo vino pero no se pudo leer: no se sabe que producto es. */
  codigoIlegible: boolean
  nombre: string | null
  categoria: string | null
  unidad: UnidadDeVenta | null
  precio: Monto | null
  costo: string | null
  crudoStock: ValorCrudo | undefined
  crudoMinimo: ValorCrudo | undefined
  errores: string[]
  avisos: string[]
}

function tomar<T>(l: Lectura<T>, errores: string[], avisos: string[]): T | null {
  if (!l.ok) {
    errores.push(l.error)
    return null
  }
  if (l.aviso !== undefined) avisos.push(l.aviso)
  return l.valor
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex')
}

function nombreDeUnidad(u: UnidadDeVenta): string {
  return POLITICA_DE_UNIDAD[u].nombre.toLowerCase()
}

function listaDeFilas(filas: number[]): string {
  const primeras = filas.slice(0, 5).join(', ')
  return filas.length > 5 ? `${primeras} y ${filas.length - 5} más` : primeras
}

/** Lee las celdas de una fila sin mirar la base. */
function leerFila(
  pedido: PedidoDeVistaPrevia,
  indice: Map<Campo, number>,
  fila: { f: number; v: ValorCrudo[] },
): Leida {
  const errores: string[] = []
  const avisos: string[] = []
  const celda = (campo: Campo): ValorCrudo | undefined => {
    const i = indice.get(campo)
    return i === undefined ? undefined : fila.v[i]
  }
  const leer = <T>(campo: Campo, lector: (v: ValorCrudo) => Lectura<T>): T | null => {
    const v = celda(campo)
    return v === undefined ? null : tomar(lector(v), errores, avisos)
  }

  const antesDelCodigo = errores.length
  const codigo = leer('codigo', leerCodigo)

  return {
    fila: fila.f,
    codigo,
    codigoIlegible: errores.length > antesDelCodigo,
    nombre: leer('nombre', leerNombre),
    categoria: leer('categoria', leerCategoria),
    unidad: leer('unidad', leerUnidad),
    precio: leer('precio', leerPrecio),
    costo: leer('costo', leerCosto),
    // El stock depende de la unidad del producto, que se sabe despues de
    // buscarlo: "1.500" son mil quinientas unidades o un kilo y medio. Y si no
    // se va a tocar, no se lee: un valor raro en una columna que no se usa no
    // es un error de esta importacion.
    crudoStock: pedido.stock === 'no-tocar' ? undefined : celda('stock'),
    crudoMinimo: celda('stockMinimo'),
    errores,
    avisos,
  }
}

async function planificar(
  db: Cliente,
  session: Session,
  pedido: PedidoDeVistaPrevia,
): Promise<Plan> {
  const indice = new Map<Campo, number>(pedido.campos.map((c, i) => [c, i]))
  const leidas = pedido.filas.map((f) => leerFila(pedido, indice, f))

  const codigos = [...new Set(leidas.flatMap((l) => (l.codigo === null ? [] : [l.codigo])))]
  const catalogo = await leerCatalogo(db, session, codigos)
  const veCosto = puedeVerCosto(session)

  // Repetidas en el mismo archivo: por codigo, o por nombre si no tienen. No se
  // elige una: se marcan todas, y la vista previa dice en que filas estan.
  const claveDe = (l: Leida): string | null =>
    l.codigoIlegible
      ? null
      : l.codigo !== null
        ? `c:${l.codigo}`
        : l.nombre !== null
          ? `n:${claveDeNombre(l.nombre)}`
          : null
  const porClave = new Map<string, number[]>()
  for (const l of leidas) {
    const clave = claveDe(l)
    if (clave !== null) porClave.set(clave, [...(porClave.get(clave) ?? []), l.fila])
  }
  const repetidas = new Set<number>()

  const planeadas: FilaPlaneada[] = []
  const categoriasNuevas = new Map<string, string>()
  const categoriaDe = (nombre: string): string => {
    const clave = claveDeNombre(nombre)
    const existente = catalogo.categorias.get(clave)
    if (existente) return existente.name
    if (!categoriasNuevas.has(clave)) categoriasNuevas.set(clave, nombre)
    return categoriasNuevas.get(clave) ?? nombre
  }

  // Para detectar dos filas distintas que resultan ser el mismo producto: por
  // el codigo principal en una y un alternativo en la otra.
  const filasPorProducto = new Map<number, number[]>()

  for (const l of leidas) {
    const errores = l.errores
    const avisos = l.avisos
    let producto: ProductoDelCatalogo | null = null
    let ambiguo = false

    if (l.codigo !== null) {
      producto = catalogo.porCodigo.get(l.codigo) ?? null
    } else if (!l.codigoIlegible && l.nombre !== null) {
      const candidatos = catalogo.porNombre.get(claveDeNombre(l.nombre)) ?? []
      ambiguo = candidatos.length > 1
      producto = ambiguo ? null : (candidatos[0] ?? null)
    }

    // Lo que el modo deja afuera no se valida. Una celda rara en una fila que
    // no se va a aplicar no es un error de ESTA importacion: la lista de un
    // proveedor trae cientos de productos que el almacen no vende, y marcarlos
    // todos en rojo taparia los diez que importan.
    const clave = claveDe(l)
    const omitida =
      (producto !== null && pedido.modo === 'solo-nuevos') ||
      (producto === null && clave !== null && !ambiguo && pedido.modo === 'solo-existentes')
    if (omitida) {
      planeadas.push({
        publica: {
          fila: l.fila,
          accion: 'omitir',
          productoId: producto?.id ?? null,
          nombre: producto?.name ?? l.nombre ?? '',
          codigo: l.codigo,
          unidad: producto?.saleUnit ?? l.unidad ?? 'UNIT',
          cambios: [],
          errores: [],
          avisos: [],
          motivo: producto === null ? 'No está en el catálogo.' : 'Ya está en el catálogo.',
        },
        alta: null,
        actualizacion: null,
      })
      continue
    }

    const grupo = clave === null ? [] : (porClave.get(clave) ?? [])
    if (grupo.length > 1) {
      repetidas.add(l.fila)
      errores.push(
        l.codigo !== null
          ? `Código repetido en el archivo (filas ${listaDeFilas(grupo)}).`
          : `Nombre repetido en el archivo y sin código que los distinga (filas ${listaDeFilas(grupo)}).`,
      )
    }

    if (l.codigo !== null && producto === null) {
      if (catalogo.ajenos.has(l.codigo)) {
        errores.push('Código: ya lo tiene un producto de otra sucursal.')
      }
      const mismoNombre = l.nombre === null ? [] : (catalogo.porNombre.get(claveDeNombre(l.nombre)) ?? []) // prettier-ignore
      if (mismoNombre.length > 0) {
        avisos.push(
          'Ya hay un producto con este nombre y otro código: se va a crear otro. ' +
            'Si es el mismo, cargale este código desde su ficha.',
        )
      }
    }
    if (ambiguo) {
      errores.push(
        'Hay varios productos con este nombre en el catálogo: agregá el código de barras para saber cuál es.',
      )
    }
    if (l.codigo === null && l.nombre === null && !l.codigoIlegible) {
      errores.push('Falta el código y el nombre: no hay forma de saber qué producto es.')
    }

    const unidad: UnidadDeVenta = producto?.saleUnit ?? l.unidad ?? 'UNIT'
    if (producto !== null && l.unidad !== null && l.unidad !== producto.saleUnit) {
      errores.push(
        `Unidad: el producto se vende por ${nombreDeUnidad(producto.saleUnit)} y el archivo dice ` +
          `${nombreDeUnidad(l.unidad)}. La unidad se cambia desde la ficha del producto.`,
      )
    }

    const stock =
      l.crudoStock === undefined ? null : tomar(leerCantidad(l.crudoStock, unidad, 'Stock'), errores, avisos) // prettier-ignore
    const minimo =
      l.crudoMinimo === undefined ? null : tomar(leerCantidad(l.crudoMinimo, unidad, 'Stock mínimo'), errores, avisos) // prettier-ignore

    const cambios: CambioDeFila[] = []
    let accion: AccionDeFila
    let alta: Alta | null = null
    let actualizacion: Actualizacion | null = null

    if (errores.length > 0) {
      accion = 'error'
    } else if (producto === null) {
      // `solo-existentes` ya se omitio arriba: aca siempre es un alta.
      if (l.nombre === null) errores.push('Falta el nombre: un producto nuevo lo necesita.')
      if (l.precio === null) errores.push('Falta el precio: un producto nuevo lo necesita.')
      if (l.nombre === null || l.precio === null) {
        accion = 'error'
      } else {
        accion = 'crear'
        const categoria = categoriaDe(l.categoria ?? SIN_CATEGORIA)
        alta = {
          nombre: l.nombre,
          codigo: l.codigo,
          precio: l.precio,
          costo: l.costo,
          unidad,
          categoria,
          stockInicial: stock ?? '0.000',
          stockMinimo: minimo ?? '0.000',
        }
        cambios.push({ campo: 'nombre', antes: null, despues: l.nombre })
        if (l.codigo !== null) cambios.push({ campo: 'codigo', antes: null, despues: l.codigo })
        cambios.push({ campo: 'categoria', antes: null, despues: categoria })
        cambios.push({ campo: 'precio', antes: null, despues: l.precio })
        if (l.costo !== null) cambios.push({ campo: 'costo', antes: null, despues: l.costo })
        cambios.push({ campo: 'unidad', antes: null, despues: unidad })
        if (stock !== null && !esCeroCantidad(aCantidad(stock))) {
          cambios.push({ campo: 'stock', antes: null, despues: stock })
        }
        if (minimo !== null) cambios.push({ campo: 'stockMinimo', antes: null, despues: minimo })
        if (l.costo !== null && comparar(dinero(l.precio), dinero(l.costo)) < 0) {
          avisos.push('El precio queda por debajo del costo.')
        }
      }
    } else {
      // `solo-nuevos` ya se omitio arriba: aca siempre es una actualizacion.
      const p = producto
      const cambiosDelProducto: Omit<CambiosImportados, 'categoryId'> = {}
      let categoria: string | null = null

      if (l.nombre !== null && l.nombre !== p.name) {
        cambiosDelProducto.name = l.nombre
        cambios.push({ campo: 'nombre', antes: p.name, despues: l.nombre })
      }
      if (l.categoria !== null && claveDeNombre(l.categoria) !== claveDeNombre(p.categoria)) {
        categoria = categoriaDe(l.categoria)
        cambios.push({ campo: 'categoria', antes: p.categoria, despues: categoria })
      }
      if (l.precio !== null && !iguales(dinero(l.precio), p.price)) {
        cambiosDelProducto.price = l.precio
        cambios.push({ campo: 'precio', antes: aMonto(p.price), despues: l.precio })
      }
      if (l.costo !== null && (p.cost === null || !iguales(dinero(l.costo), p.cost))) {
        cambiosDelProducto.cost = l.costo
        cambios.push({
          campo: 'costo',
          antes: veCosto && p.cost !== null ? aMontoCosto(p.cost) : null,
          despues: l.costo,
        })
      }
      if (minimo !== null && !igualesCantidades(aCantidad(minimo), p.minimumStock)) {
        cambiosDelProducto.minimumStock = minimo
        cambios.push({
          campo: 'stockMinimo',
          antes: aTextoCantidad(p.minimumStock),
          despues: minimo,
        })
      }
      if (stock !== null) {
        const final =
          pedido.stock === 'ajustar' ? aCantidad(stock) : sumarCantidades(p.stock, aCantidad(stock))
        if (!igualesCantidades(final, p.stock)) {
          if (p.lotTracking === 'REQUIRED') {
            errores.push(
              'Stock: el producto se sigue por lote. Su stock se carga desde Stock → Lotes, partida por partida.',
            )
          } else {
            cambiosDelProducto.stock = {
              modo: pedido.stock === 'ajustar' ? 'ajustar' : 'sumar',
              cantidad: stock,
            }
            cambios.push({
              campo: 'stock',
              antes: aTextoCantidad(p.stock),
              despues: aTextoCantidad(final),
            })
          }
        }
      }

      if (errores.length > 0) {
        accion = 'error'
        cambios.length = 0
      } else if (cambios.length === 0) {
        accion = 'sin-cambios'
      } else {
        accion = 'actualizar'
        actualizacion = { productoId: p.id, cambios: cambiosDelProducto, categoria }
        if (!p.isActive) avisos.push('Está dado de baja: se actualiza, pero sigue sin venderse.')
        const precioFinal = cambiosDelProducto.price ?? aMonto(p.price)
        const costoFinal = cambiosDelProducto.cost ?? (p.cost === null ? null : aMontoCosto(p.cost))
        if (costoFinal !== null && comparar(dinero(precioFinal), dinero(costoFinal)) < 0) {
          avisos.push('El precio queda por debajo del costo.')
        }
      }
    }

    if (producto !== null && accion !== 'error') {
      filasPorProducto.set(producto.id, [...(filasPorProducto.get(producto.id) ?? []), l.fila])
    }

    planeadas.push({
      publica: {
        fila: l.fila,
        accion,
        productoId: producto?.id ?? null,
        nombre: producto?.name ?? l.nombre ?? '',
        codigo: l.codigo,
        unidad,
        cambios,
        errores,
        avisos,
        motivo: null,
      },
      alta,
      actualizacion,
    })
  }

  // Dos filas que caen en el mismo producto: ninguna se aplica.
  for (const f of planeadas) {
    const id = f.publica.productoId
    const filas = id === null ? [] : (filasPorProducto.get(id) ?? [])
    if (filas.length < 2 || f.publica.accion === 'error') continue
    f.publica.errores.push(
      `Otra fila del archivo es el mismo producto (filas ${listaDeFilas(filas)}).`,
    )
    f.publica.accion = 'error'
    f.publica.cambios = []
    f.alta = null
    f.actualizacion = null
    repetidas.add(f.publica.fila)
  }

  // Las categorias nuevas son solo las de filas que de verdad se aplican.
  const usadas = new Set<string>()
  for (const f of planeadas) {
    if (f.alta) usadas.add(claveDeNombre(f.alta.categoria))
    if (f.actualizacion?.categoria) usadas.add(claveDeNombre(f.actualizacion.categoria))
  }
  for (const clave of [...categoriasNuevas.keys()]) {
    if (!usadas.has(clave)) categoriasNuevas.delete(clave)
  }

  const bloqueos = bloqueosDe(session, pedido, planeadas, categoriasNuevas)
  const totales = totalesDe(planeadas, repetidas.size)

  const huella = sha256(
    JSON.stringify({
      version: 1,
      modo: pedido.modo,
      stock: pedido.stock,
      campos: pedido.campos,
      filas: sha256(JSON.stringify(pedido.filas)),
      plan: planeadas.map((f) => [f.publica.fila, f.publica.accion, f.publica.productoId]),
      categorias: [...categoriasNuevas.keys()].sort(),
    }),
  )

  return {
    filas: planeadas,
    bloqueos,
    categoriasNuevas,
    categorias: catalogo.categorias,
    huella,
    totales,
  }
}

/**
 * Lo que impide importar, sea cual sea la fila: columnas que faltan y
 * permisos. Cada permiso se exige solo si el plan lo usa: quien no puede
 * cambiar precios igual puede importar stock, si la planilla no trae precios.
 */
function bloqueosDe(
  session: Session,
  pedido: PedidoDeVistaPrevia,
  filas: FilaPlaneada[],
  categoriasNuevas: Map<string, string>,
): string[] {
  const bloqueos: string[] = []
  const tiene = (p: Permission) => session.permissions.has(p)
  const campos = new Set(pedido.campos)

  // Sin nombre o sin precio NO se bloquea: una planilla de codigo y stock es
  // valida para los productos que ya existen, y cada fila nueva a la que le
  // falte el dato ya lo dice en su propio error.
  if (!campos.has('codigo') && !campos.has('nombre')) {
    bloqueos.push(
      'Elegí la columna del código de barras o la del nombre: sin ninguna de las dos no hay forma de reconocer los productos.',
    )
  }

  const altas = filas.filter((f) => f.alta !== null)
  const cambios = filas.flatMap((f) => (f.actualizacion === null ? [] : [f.actualizacion]))

  if (altas.length > 0 && !tiene('products.create')) {
    bloqueos.push('Tu usuario no puede dar de alta productos.')
  }
  if (
    cambios.some(
      (c) =>
        c.cambios.name !== undefined ||
        c.categoria !== null ||
        c.cambios.minimumStock !== undefined,
    ) &&
    !tiene('products.update')
  ) {
    bloqueos.push('Tu usuario no puede modificar productos (nombre, categoría o stock mínimo).')
  }
  if (cambios.some((c) => c.cambios.price !== undefined) && !tiene('products.price.update')) {
    bloqueos.push('Tu usuario no puede cambiar precios. Quitá la columna del precio del mapeo.')
  }
  if (
    (altas.some((f) => f.alta?.costo !== null) ||
      cambios.some((c) => c.cambios.cost !== undefined)) &&
    !tiene('products.cost.update')
  ) {
    bloqueos.push('Tu usuario no puede cargar costos. Quitá la columna del costo del mapeo.')
  }
  if (cambios.some((c) => c.cambios.stock !== undefined) && !tiene('stock.adjust')) {
    bloqueos.push('Tu usuario no puede ajustar el stock. Elegí "No tocar el stock".')
  }
  if (categoriasNuevas.size > 0 && !tiene('categories.manage')) {
    const nombres = [...categoriasNuevas.values()].slice(0, 5).join(', ')
    bloqueos.push(
      `Tu usuario no puede crear categorías, y el archivo trae ${categoriasNuevas.size} que no existen ` +
        `(${nombres}${categoriasNuevas.size > 5 ? '…' : ''}). Pedile a alguien con permiso que las cree.`,
    )
  }
  return bloqueos
}

function totalesDe(filas: FilaPlaneada[], repetidas: number): TotalesDeVistaPrevia {
  const cuenta = (a: AccionDeFila) => filas.filter((f) => f.publica.accion === a).length
  const validas = filas.filter((f) => f.publica.accion !== 'error')
  return {
    filas: filas.length,
    conErrores: cuenta('error'),
    crear: cuenta('crear'),
    actualizar: cuenta('actualizar'),
    sinCambios: cuenta('sin-cambios'),
    omitir: cuenta('omitir'),
    existentes: validas.filter((f) => f.publica.productoId !== null).length,
    nuevos: validas.filter((f) => f.publica.productoId === null).length,
    repetidasEnArchivo: repetidas,
    conStock: filas.filter(
      (f) =>
        (f.alta !== null && !esCeroCantidad(aCantidad(f.alta.stockInicial))) ||
        f.actualizacion?.cambios.stock !== undefined,
    ).length,
  }
}

// ---------------------------------------------------------------------------
// Las dos operaciones
// ---------------------------------------------------------------------------

/** Vista previa: el plan, sin escribir nada. */
export async function previsualizarImportacion(
  session: Session,
  pedido: PedidoDeVistaPrevia,
): Promise<VistaPrevia> {
  const plan = await planificar(prisma, session, pedido)
  return {
    importacion: randomUUID(),
    huella: plan.huella,
    totales: plan.totales,
    bloqueos: plan.bloqueos,
    categoriasNuevas: [...plan.categoriasNuevas.values()],
    filas: plan.filas.map((f) => f.publica),
  }
}

/**
 * Importar: todo o nada.
 *
 * Las filas con errores y las omitidas no se aplican --la vista previa ya dijo
 * cuales son y por que--; todas las demas se aplican juntas. Si una sola falla
 * al escribir, no queda ninguna.
 */
export async function importarProductos(
  session: Session,
  pedido: PedidoDeImportacion,
): Promise<ResultadoDeImportacion> {
  const inicio = Date.now()
  const referencia = `#${pedido.importacion.slice(0, 8)}`
  const motivo = `Importación de ${pedido.archivo} (${referencia})`

  const resultado = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LLAVE_DE_IMPORTACION}::int, ${session.branchId}::int)`

      const aplicada = await tx.auditLog.findFirst({
        where: {
          branchId: session.branchId,
          tableName: 'Product',
          actionType: 'import',
          changes: { path: ['after', 'importacion'], equals: pedido.importacion },
        },
        select: { id: true },
      })
      if (aplicada) {
        throw conflict(
          'Esta importación ya se aplicó. Para volver a importar el archivo, pedí una vista previa nueva.',
          { code: 'IMPORT_ALREADY_APPLIED' },
        )
      }

      const plan = await planificar(tx, session, pedido)
      if (plan.bloqueos.length > 0) {
        throw invalid(plan.bloqueos[0] ?? 'No se puede importar', { bloqueos: plan.bloqueos })
      }
      if (plan.huella !== pedido.huella) {
        throw conflict(
          'El catálogo cambió desde la vista previa: alguien cargó o modificó productos del archivo. ' +
            'Revisá la vista previa de nuevo antes de importar.',
          { code: 'IMPORT_PREVIEW_STALE' },
        )
      }

      const categorias = new Map(plan.categorias)
      for (const [clave, nombre] of plan.categoriasNuevas) {
        const creada = await tx.category.create({
          data: { name: nombre },
          select: { id: true, name: true },
        })
        categorias.set(clave, creada)
        await audit(tx, {
          userId: session.userId,
          branchId: session.branchId,
          table: 'Category',
          recordId: creada.id,
          action: 'create',
          reason: motivo,
          after: creada,
          origin: ORIGEN_IMPORTACION,
        })
      }
      const categoriaDe = (nombre: string): { id: number; name: string } => {
        const categoria = categorias.get(claveDeNombre(nombre))
        if (categoria === undefined) throw new Error(`Categoría sin resolver: ${nombre}`)
        return categoria
      }

      let creados = 0
      let actualizados = 0
      let movimientos = 0

      for (const f of plan.filas) {
        if (f.alta !== null) {
          const a = f.alta
          const categoria = categoriaDe(a.categoria)
          await crearProductoEn(
            tx,
            session,
            {
              name: a.nombre,
              barcode: a.codigo,
              alternateBarcodes: undefined,
              description: null,
              price: a.precio,
              cost: a.costo,
              categoryId: categoria.id,
              supplierId: null,
              saleUnit: a.unidad,
              // Como el alta rapida: se compra en la unidad en que se vende,
              // de a uno. La ficha lo corrige si hace falta.
              purchaseUnit: a.unidad,
              unitsPerPurchaseUnit: '1',
              totalStock: a.stockInicial,
              minimumStock: a.stockMinimo,
            },
            categoria,
            ORIGEN_IMPORTACION,
            `Stock inicial · ${motivo}`,
          )
          creados++
          if (!esCeroCantidad(aCantidad(a.stockInicial))) movimientos++
        } else if (f.actualizacion !== null) {
          const u = f.actualizacion
          const { movioStock } = await actualizarProductoImportado(
            tx,
            session,
            u.productoId,
            {
              ...u.cambios,
              ...(u.categoria === null ? {} : { categoryId: categoriaDe(u.categoria).id }),
            },
            { origen: ORIGEN_IMPORTACION, motivo },
          )
          actualizados++
          if (movioStock) movimientos++
        }
      }

      const categoriasCreadas = [...plan.categoriasNuevas.values()]
      const resumen = {
        importacion: pedido.importacion,
        archivo: pedido.archivo,
        modo: pedido.modo,
        stock: pedido.stock,
        filas: plan.totales.filas,
        creados,
        actualizados,
        sinCambios: plan.totales.sinCambios,
        omitidos: plan.totales.omitir,
        conErrores: plan.totales.conErrores,
        movimientosDeStock: movimientos,
        // Acotado: la bitacora trunca las entradas grandes, y el identificador
        // de arriba es lo que impide aplicar dos veces la misma importacion.
        categoriasCreadas: categoriasCreadas.length,
        primerasCategorias: categoriasCreadas.slice(0, 10),
      }
      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Product',
        recordId: null,
        action: 'import',
        reason: motivo,
        after: resumen,
        origin: ORIGEN_IMPORTACION,
      })

      return {
        importacion: pedido.importacion,
        creados,
        actualizados,
        sinCambios: plan.totales.sinCambios,
        omitidos: plan.totales.omitir,
        conErrores: plan.totales.conErrores,
        categoriasCreadas,
        movimientosDeStock: movimientos,
      }
    },
    { timeout: TIEMPO_MAXIMO_MS, maxWait: 15_000 },
  )

  return { ...resultado, milisegundos: Date.now() - inicio }
}
