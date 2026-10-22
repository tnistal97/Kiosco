/**
 * Una compra que entra al stock: cada linea de un ticket o presupuesto, ya
 * transcripta y revisada, se suma a un producto que existe o crea uno nuevo.
 *
 * Si una linea es un producto que ya existe NO se decide aca: lo decide quien
 * reviso la compra, y lo escribe en el manifiesto (`accion`). Este modulo solo
 * comprueba que esa decision sea coherente con el catalogo. Lo que no lo es
 * queda para revisar, y entonces no se carga nada de la compra:
 *
 *   crear  el nombre no puede ser el de un producto activo de la sucursal
 *          --sin distinguir mayusculas ni tildes--: si ya existe, o es el
 *          mismo producto (y la linea tiene que decir "sumar") o hay que
 *          elegir otro nombre;
 *   sumar  existe UN producto activo con ese nombre exacto, que se vende por
 *          unidad y sin lotes; si la linea trae codigo, es su codigo principal;
 *   todas  cantidad entera y positiva; el codigo, si viene, con digito
 *          verificador valido; ni el nombre ni el codigo se repiten en la
 *          compra --dos lineas del mismo producto se suman antes, en una--.
 *
 * Todo es puro: recibe el catalogo y devuelve el plan. Lo aplica
 * scripts/lib/incorporar-compra.ts; las pruebas estan en
 * tests/unit/compra.test.ts.
 */
import { claveDeNombre } from '@/modules/importacion/valores'
import { digitoVerificadorValido } from './coincidencia-de-productos'

export interface LineaDeCompra {
  nombre: string
  cantidad: number
  codigo: string | null
  accion: 'crear' | 'sumar'
  /** De donde sale ("hoja 2 fila 5"): va al motivo del movimiento de stock. */
  origen: string
}

export interface ProductoActivo {
  id: number
  nombre: string
  codigoPrincipal: string | null
  saleUnit: string
  lotTracking: string
}

export interface Crear {
  accion: 'crear'
  linea: LineaDeCompra
}

export interface Sumar {
  accion: 'sumar'
  linea: LineaDeCompra
  producto: ProductoActivo
}

export interface Revisar {
  accion: 'revisar'
  linea: LineaDeCompra
  motivo: string
}

export type PasoDeCompra = Crear | Sumar | Revisar

function contar<T>(valores: T[]): Map<T, number> {
  const cuenta = new Map<T, number>()
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1)
  return cuenta
}

function problemaDeLaLinea(
  linea: LineaDeCompra,
  nombresEnLaCompra: Map<string, number>,
  codigosEnLaCompra: Map<string, number>,
): string | null {
  if (linea.nombre.trim() === '' || linea.nombre.trim() !== linea.nombre) {
    return 'el nombre está vacío o tiene espacios de más'
  }
  if (!Number.isInteger(linea.cantidad) || linea.cantidad <= 0) {
    return `la cantidad ${String(linea.cantidad)} no es un entero positivo`
  }
  if (linea.codigo !== null && !digitoVerificadorValido(linea.codigo)) {
    return `el código ${linea.codigo} no es válido`
  }
  if ((nombresEnLaCompra.get(claveDeNombre(linea.nombre)) ?? 0) > 1) {
    return 'el producto se repite en la compra: sumar las cantidades en una sola línea'
  }
  if (linea.codigo !== null && (codigosEnLaCompra.get(linea.codigo) ?? 0) > 1) {
    return `el código ${linea.codigo} se repite en la compra`
  }
  return null
}

export function planificarCompra(
  catalogo: readonly ProductoActivo[],
  lineas: readonly LineaDeCompra[],
): PasoDeCompra[] {
  const porClave = new Map<string, ProductoActivo[]>()
  for (const p of catalogo) {
    const clave = claveDeNombre(p.nombre)
    porClave.set(clave, [...(porClave.get(clave) ?? []), p])
  }
  const nombresEnLaCompra = contar(lineas.map((l) => claveDeNombre(l.nombre)))
  const codigosEnLaCompra = contar(lineas.flatMap((l) => (l.codigo === null ? [] : [l.codigo])))

  return lineas.map((linea): PasoDeCompra => {
    const revisar = (motivo: string): Revisar => ({ accion: 'revisar', linea, motivo })
    const problema = problemaDeLaLinea(linea, nombresEnLaCompra, codigosEnLaCompra)
    if (problema !== null) return revisar(problema)

    if (linea.accion === 'crear') {
      const existente = porClave.get(claveDeNombre(linea.nombre))?.[0]
      if (existente) {
        return revisar(
          `ya existe "${existente.nombre}" (#${String(existente.id)}): si es el mismo producto, la línea tiene que sumar`,
        )
      }
      const conElCodigo = catalogo.find(
        (p) => linea.codigo !== null && p.codigoPrincipal === linea.codigo,
      )
      if (conElCodigo) {
        return revisar(`el código ${String(linea.codigo)} ya es de "${conElCodigo.nombre}"`)
      }
      return { accion: 'crear', linea }
    }

    const candidatos = catalogo.filter((p) => p.nombre === linea.nombre)
    const producto = candidatos[0]
    if (candidatos.length !== 1 || producto === undefined) {
      return revisar(
        candidatos.length === 0
          ? 'no hay un producto activo con ese nombre exacto'
          : `hay ${String(candidatos.length)} productos activos con ese nombre`,
      )
    }
    if (producto.saleUnit !== 'UNIT' || producto.lotTracking !== 'NONE') {
      return revisar(
        `"${producto.nombre}" se vende por peso o lleva lotes: la cantidad se carga a mano`,
      )
    }
    if (linea.codigo !== null && producto.codigoPrincipal !== linea.codigo) {
      return revisar(
        `el código ${linea.codigo} no es el de "${producto.nombre}" (${producto.codigoPrincipal ?? 'sin código'})`,
      )
    }
    return { accion: 'sumar', linea, producto }
  })
}
