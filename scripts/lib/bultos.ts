/**
 * Normalizacion por unidad de los productos cargados como BULTO.
 *
 * Las listas de House traen filas como "Clight naranja 8g bulto x20" o "Puré de
 * tomate Noel brick 520 g (bulto x12)" cuya cantidad cuenta BULTOS. La caja
 * vende por unidad, asi que cada una termina en UNA fila con el nombre de la
 * unidad y el stock en unidades:
 *
 *   consolidar  existe tambien la fila de la unidad --el mismo nombre sin el
 *               bulto--: le entran bultos × N y la del bulto se da de baja;
 *   renombrar   no existe: la del bulto se queda, con el nombre de la unidad y
 *               el stock multiplicado;
 *   revisar     algo no es inequivoco: no se toca y queda para mirar a mano.
 *
 * La regla es prudente a proposito. La unidad se busca por el nombre COMPLETO
 * --marca, variedad, medida--, no por parecido: "Clight naranja 8g" no es
 * "Clight naranja dulce 7.5g". Y si hay otro producto que se le parece mucho,
 * no se adivina: queda para revisar.
 *
 * Los codigos del bulto nunca pasan a la unidad: identifican la caja, y si se
 * escaneara la caja se venderia una unidad sola. Solo entra un codigo de la
 * unidad que alguien verifico (`codigosVerificados`).
 *
 * Todo es puro: recibe el catalogo y devuelve el plan. Lo aplica
 * scripts/lib/normalizar-bultos.ts; las pruebas estan en
 * tests/unit/bultos.test.ts.
 */
import { claveDeNombre } from '@/modules/importacion/valores'
import { comparar } from './coincidencia-de-productos'

export interface Bulto {
  /** El nombre sin el bulto: el de la unidad. */
  base: string
  /** Cuantas unidades trae el bulto. */
  multiplicador: number
}

/**
 * "(bulto x4)" o "bulto x8" al final del nombre. Son las dos formas que traen
 * las listas; se toleran los espacios y los ceros ("bulto x 04"), que no
 * cambian lo que dicen. "caja x24" o "x3" NO: en "Raid tabletas caja x24" y
 * "Esponja Task x3" la caja y el pack son lo que se vende entero.
 */
const BULTO = /\s*\(?\s*bulto\s*x\s*0*(\d+)\s*\)?\s*$/i

export function detectarBulto(nombre: string): Bulto | null {
  const m = BULTO.exec(nombre)
  if (!m) return null
  const base = nombre.slice(0, m.index).trim()
  const multiplicador = Number(m[1])
  if (base.length === 0) return null
  return { base, multiplicador }
}

/** Si el nombre dice "bulto" en cualquier lado, se entienda o no cuantas trae. */
export function mencionaBulto(nombre: string): boolean {
  return /\bbulto\b/i.test(nombre)
}

export interface ProductoDelCatalogo {
  id: number
  nombre: string
  /** Stock de la sucursal, en la unidad de venta. */
  stock: number
  saleUnit: string
  lotTracking: string
  purchaseUnit: string
  unitsPerPurchaseUnit: number
  /** El principal primero. */
  codigos: string[]
  tieneFoto: boolean
  /**
   * Si todo su stock salio de la carga inicial: ningun movimiento que no sea
   * `INITIAL`. Si ya se vendio o se ajusto, no se sabe si esas unidades eran
   * bultos o sueltas, y multiplicar seria inventar.
   */
  soloCargaInicial: boolean
}

/** Lo que pasa con la foto del bulto cuando se consolida. */
export type DestinoDeFoto = 'mover' | 'quitar' | null

export interface Renombrar {
  accion: 'renombrar'
  bulto: ProductoDelCatalogo
  nombre: string
  multiplicador: number
  bultos: number
  /** El stock final: bultos × N. */
  unidades: number
  /** El codigo de la unidad verificado que pasa a ser el principal, o null. */
  codigoDeUnidad: string | null
  /** Lo que se le agrega a la descripcion: el codigo del bulto, como dato. */
  nota: string | null
  /** Si se le fija la unidad de compra (caja de N). */
  fijarCompra: boolean
}

export interface Consolidar {
  accion: 'consolidar'
  bulto: ProductoDelCatalogo
  /** La fila de la unidad. Si es otro bulto que se renombra en este plan, ya con su nombre final. */
  unidad: ProductoDelCatalogo
  nombre: string
  multiplicador: number
  bultos: number
  /** Las que entran a la unidad: bultos × N. */
  unidades: number
  stockPrevio: number
  stockFinal: number
  codigoDeUnidad: string | null
  nota: string | null
  fijarCompra: boolean
  foto: DestinoDeFoto
}

export interface Revisar {
  accion: 'revisar'
  producto: ProductoDelCatalogo
  motivo: string
}

export type Paso = Renombrar | Consolidar | Revisar

function nota(
  multiplicador: number,
  codigos: string[],
  codigoDeUnidad: string | null,
): string | null {
  const delBulto = codigos.filter((c) => c !== codigoDeUnidad)
  if (delBulto.length === 0) return null
  return `Código del bulto x${String(multiplicador)}: ${delBulto.join(', ')} (no es el de la unidad).`
}

/**
 * Si dos nombres pueden ser el mismo producto escrito distinto: todas las
 * palabras que distinguen de uno estan en el otro, y no hay medida ni
 * porcentaje distintos. "Red Bull 250ml" y "Red Bull lata 250 ml", si;
 * "Baño Pronto naranja 1L" y "Baño Fresh Liviano naranja dulce 1L", no.
 */
export function seParecen(a: string, b: string): boolean {
  const ida = comparar(a, { nombre: b, marca: '' })
  const vuelta = comparar(b, { nombre: a, marca: '' })
  return (
    (ida.veredicto !== null && ida.cobertura === 1) ||
    (vuelta.veredicto !== null && vuelta.cobertura === 1)
  )
}

/** Por que este producto no se puede normalizar solo, o null si se puede. */
function impedimento(p: ProductoDelCatalogo, papel: 'bulto' | 'unidad'): string | null {
  if (p.saleUnit !== 'UNIT') return `se vende por ${p.saleUnit}, no por unidad`
  if (p.lotTracking !== 'NONE') return 'se sigue por lote'
  if (papel === 'bulto') {
    if (!Number.isInteger(p.stock) || p.stock < 0)
      return `el stock (${String(p.stock)}) no es un número de bultos`
    if (!p.soloCargaInicial) {
      return 'tuvo ventas o ajustes después de la carga: no se sabe si esas unidades eran bultos'
    }
  }
  return null
}

export interface OpcionesDelPlan {
  /**
   * Codigo del bulto → codigo de la unidad, verificado por alguien. Sin esto
   * la unidad queda sin codigo y se le pone a mano mirando la etiqueta.
   */
  codigosVerificados?: ReadonlyMap<string, string>
}

/**
 * El plan para un catalogo: un paso por cada producto activo que dice "bulto".
 *
 * Los bultos del mismo producto se agrupan por el nombre de la unidad. Si la
 * unidad existe, todos se consolidan en ella; si no, el primero se renombra y
 * los demas se consolidan en el.
 */
export function planificar(
  catalogo: ProductoDelCatalogo[],
  opciones: OpcionesDelPlan = {},
): Paso[] {
  const verificados = opciones.codigosVerificados ?? new Map<string, string>()
  const pasos: Paso[] = []

  const bultos: Array<{ producto: ProductoDelCatalogo; bulto: Bulto }> = []
  const sueltos: ProductoDelCatalogo[] = []
  for (const p of catalogo) {
    const bulto = detectarBulto(p.nombre)
    if (bulto) bultos.push({ producto: p, bulto })
    else if (mencionaBulto(p.nombre)) {
      pasos.push({
        accion: 'revisar',
        producto: p,
        motivo: 'dice "bulto" pero no cuántas unidades trae',
      })
    } else sueltos.push(p)
  }

  const grupos = new Map<string, Array<{ producto: ProductoDelCatalogo; bulto: Bulto }>>()
  for (const b of [...bultos].sort((x, y) => x.producto.id - y.producto.id)) {
    const clave = claveDeNombre(b.bulto.base)
    grupos.set(clave, [...(grupos.get(clave) ?? []), b])
  }

  // Los codigos que ya usa otro producto: un codigo de unidad verificado no
  // puede terminar repetido.
  const usados = new Map<string, number>()
  for (const p of catalogo) for (const c of p.codigos) usados.set(c, p.id)

  for (const [clave, miembros] of grupos) {
    const base = miembros[0]?.bulto.base ?? ''
    const revisarTodos = (motivo: string) => {
      for (const m of miembros) pasos.push({ accion: 'revisar', producto: m.producto, motivo })
    }

    const iguales = sueltos.filter((s) => claveDeNombre(s.nombre) === clave)
    if (iguales.length > 1) {
      revisarTodos(`hay ${String(iguales.length)} productos llamados "${base}"`)
      continue
    }
    const unidad = iguales[0] ?? null
    if (unidad === null) {
      const parecidos = sueltos.filter((s) => seParecen(base, s.nombre))
      if (parecidos.length > 0) {
        revisarTodos(
          `se parece a ${parecidos.map((p) => `"${p.nombre}"`).join(', ')}: ¿es la misma unidad?`,
        )
        continue
      }
    }

    const problemas: string[] = []
    for (const { producto, bulto } of miembros) {
      const motivo = impedimento(producto, 'bulto')
      if (motivo) problemas.push(`"${producto.nombre}" ${motivo}`)
      if (bulto.multiplicador < 2) {
        problemas.push(`"${producto.nombre}" trae ${String(bulto.multiplicador)}: no es un bulto`)
      }
    }
    const motivoDeLaUnidad = unidad && impedimento(unidad, 'unidad')
    if (unidad && motivoDeLaUnidad) problemas.push(`"${unidad.nombre}" ${motivoDeLaUnidad}`)
    if (problemas.length > 0) {
      revisarTodos(problemas.join('; '))
      continue
    }

    // El codigo de la unidad: el verificado del bulto, si no lo usa otro.
    const codigoVerificado = (
      b: ProductoDelCatalogo,
      destino: ProductoDelCatalogo,
    ): string | null => {
      const principal = b.codigos[0]
      if (principal === undefined) return null
      const codigo = verificados.get(principal) ?? null
      if (codigo === null) return null
      const duenio = usados.get(codigo)
      if (duenio !== undefined && duenio !== b.id && duenio !== destino.id) return null
      return codigo
    }

    let destino: ProductoDelCatalogo | null = unidad
    let stock = unidad?.stock ?? 0
    // La unidad de compra se fija una vez, y nunca encima de una que alguien ya puso.
    const tieneCompra = (p: ProductoDelCatalogo) =>
      p.purchaseUnit !== 'UNIT' || p.unitsPerPurchaseUnit !== 1
    let compraFijada = unidad !== null && tieneCompra(unidad)
    let codigoDelDestino: string | null = unidad?.codigos[0] ?? null
    for (const { producto: b, bulto } of miembros) {
      const unidades = b.stock * bulto.multiplicador
      if (destino === null) {
        const codigoDeUnidad = codigoVerificado(b, b)
        pasos.push({
          accion: 'renombrar',
          bulto: b,
          nombre: bulto.base,
          multiplicador: bulto.multiplicador,
          bultos: b.stock,
          unidades,
          codigoDeUnidad,
          nota: nota(bulto.multiplicador, b.codigos, codigoDeUnidad),
          fijarCompra: !tieneCompra(b),
        })
        destino = {
          ...b,
          nombre: bulto.base,
          stock: unidades,
          codigos: codigoDeUnidad ? [codigoDeUnidad] : [],
        }
        stock = unidades
        compraFijada = true
        codigoDelDestino = codigoDeUnidad
        continue
      }
      // Un codigo de unidad verificado solo entra si la unidad no tiene uno.
      const codigoDeUnidad = codigoDelDestino === null ? codigoVerificado(b, destino) : null
      pasos.push({
        accion: 'consolidar',
        bulto: b,
        unidad: destino,
        nombre: destino.nombre,
        multiplicador: bulto.multiplicador,
        bultos: b.stock,
        unidades,
        stockPrevio: stock,
        stockFinal: stock + unidades,
        codigoDeUnidad,
        nota: nota(bulto.multiplicador, b.codigos, codigoDeUnidad),
        fijarCompra: !compraFijada,
        foto: !b.tieneFoto ? null : destino.tieneFoto ? 'quitar' : 'mover',
      })
      stock += unidades
      compraFijada = true
      if (codigoDeUnidad !== null) codigoDelDestino = codigoDeUnidad
      if (b.tieneFoto) destino = { ...destino, tieneFoto: true }
    }
  }

  return pasos
}
