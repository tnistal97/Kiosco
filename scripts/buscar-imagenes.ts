/**
 * Busca en internet una foto para cada producto activo de una sucursal y deja
 * un MANIFIESTO para revisar: que encontro, donde, y con cuanta certeza.
 *
 * NO ESCRIBE EN LA BASE. Solo lee el catalogo. Las fotos aprobadas se cargan
 * despues con `scripts/cargar-imagenes.ts`, que lee este mismo manifiesto. Ver
 * docs/PRODUCT_IMAGES.md.
 *
 * Donde busca: en el catalogo publico de supermercados argentinos que
 * publican la foto de frente del producto, la que les manda el fabricante
 * --Carrefour, Jumbo, Mas Online--. Los sitios de los fabricantes casi nunca
 * dejan buscar por codigo de barras, y la foto suele ser la misma.
 *
 * Como busca, de mas seguro a menos:
 *
 *   1. por CODIGO DE BARRAS: si una tienda tiene ese codigo exacto, es ese
 *      producto. `encontrada`, aunque el nombre no se parezca --Pehuamar paso
 *      a llamarse Pep, y el codigo sigue siendo el mismo--;
 *   2. por el codigo de la UNIDAD, cuando el de la lista es el de un bulto;
 *   3. por NOMBRE, con la regla prudente de `lib/coincidencia-de-productos`:
 *      misma marca, misma medida y todas las palabras que distinguen. Si falta
 *      algo, `dudosa`, y no se carga sin que alguien la mire.
 *
 * Se identifica con un agente propio y hace una consulta cada medio segundo:
 * son pocas consultas, a la interfaz publica que usa la misma tienda.
 *
 * Uso:
 *
 *   npx tsx scripts/buscar-imagenes.ts --sucursal 1 --salida imagenes.json
 *
 * Deja `imagenes.json` (para el guion de carga) e `imagenes.md` (para leer).
 * Con `--solo <texto>` busca solo los productos cuyo nombre lo contiene: sirve
 * para probar, o para repetir unos pocos.
 */
import './entorno'
import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  codigoDeUnidad,
  comparar,
  digitoVerificadorValido,
  normalizar,
  palabras,
  sinBulto,
  type Veredicto,
} from './lib/coincidencia-de-productos'

const prisma = new PrismaClient()

const AGENTE =
  'KioscoImagenes/1.0 (busca la foto de los productos de un almacen; una consulta cada 500 ms)'
const PAUSA_MS = 500

interface Tienda {
  nombre: string
  host: string
}

/** En orden de preferencia: la primera que tenga el producto gana. */
const TIENDAS: readonly Tienda[] = [
  { nombre: 'Carrefour', host: 'www.carrefour.com.ar' },
  { nombre: 'Jumbo', host: 'www.jumbo.com.ar' },
  { nombre: 'Más Online', host: 'www.masonline.com.ar' },
]

export type Estado = 'encontrada' | 'dudosa' | 'no-encontrada'

export interface EntradaDelManifiesto {
  nombre: string
  codigo: string | null
  estado: Estado
  /** Como se encontro: el codigo es inequivoco; el nombre, no tanto. */
  coincidencia: 'codigo' | 'codigo-de-unidad' | 'nombre' | null
  tienda: string | null
  paginaUrl: string | null
  imagenUrl: string | null
  nombreEnTienda: string | null
  marcaEnTienda: string | null
  codigoEnTienda: string | null
  nota: string
  /**
   * Lo que anoto quien reviso la foto a ojo. El buscador no lo escribe: lo
   * agrega la revision, que ademas puede cambiar `estado` --aprobar una dudosa
   * o dejar pendiente una encontrada--.
   */
  revision?: string
}

interface ProductoDeTienda {
  nombre: string
  marca: string
  link: string
  items: Array<{ ean: string; imagen: string | null }>
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Cuando puede salir la proxima consulta. Se reserva el turno ANTES de esperar. */
let siguiente = 0
async function turno(): Promise<void> {
  const ahora = Date.now()
  const espera = Math.max(0, siguiente - ahora)
  siguiente = ahora + espera + PAUSA_MS
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function leerProducto(raw: unknown): ProductoDeTienda[] {
  if (typeof raw !== 'object' || raw === null) return []
  const p = raw as Record<string, unknown>
  const link = texto(p.link)
  if (!link.startsWith('https://')) return []
  const items = Array.isArray(p.items) ? p.items : []
  return [
    {
      nombre: texto(p.productName),
      marca: texto(p.brand),
      link,
      items: items.map((i: unknown) => {
        const item = (typeof i === 'object' && i !== null ? i : {}) as Record<string, unknown>
        const imagenes = Array.isArray(item.images) ? (item.images as unknown[]) : []
        const primera = imagenes[0] as Record<string, unknown> | undefined
        const url = texto(primera?.imageUrl)
        return { ean: texto(item.ean), imagen: url.startsWith('https://') ? url : null }
      }),
    },
  ]
}

async function consultar(tienda: Tienda, parametros: string): Promise<ProductoDeTienda[]> {
  const url = `https://${tienda.host}/api/catalog_system/pub/products/search?${parametros}`
  for (let intento = 1; ; intento++) {
    await turno()
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': AGENTE, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      // VTEX contesta 206 cuando la busqueda tiene mas paginas.
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${String(res.status)}`)
      const datos: unknown = await res.json()
      return Array.isArray(datos) ? datos.flatMap(leerProducto) : []
    } catch (error) {
      if (intento >= 2) {
        console.warn(
          `  ${tienda.nombre}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return []
      }
    }
  }
}

const sinCeros = (codigo: string) => codigo.replace(/^0+/, '')

// ---------------------------------------------------------------------------
// Busqueda de un producto
// ---------------------------------------------------------------------------

function vacia(nombre: string, codigo: string | null, nota: string): EntradaDelManifiesto {
  return {
    nombre,
    codigo,
    estado: 'no-encontrada',
    coincidencia: null,
    tienda: null,
    paginaUrl: null,
    imagenUrl: null,
    nombreEnTienda: null,
    marcaEnTienda: null,
    codigoEnTienda: null,
    nota,
  }
}

async function porCodigo(
  nombre: string,
  codigo: string,
  buscado: string,
  coincidencia: 'codigo' | 'codigo-de-unidad',
): Promise<EntradaDelManifiesto | null> {
  for (const tienda of TIENDAS) {
    const productos = await consultar(tienda, `fq=alternateIds_Ean:${buscado}`)
    for (const p of productos) {
      const item = p.items.find((i) => sinCeros(i.ean) === sinCeros(buscado) && i.imagen !== null)
      if (!item?.imagen) continue
      return {
        nombre,
        codigo,
        estado: 'encontrada',
        coincidencia,
        tienda: tienda.nombre,
        paginaUrl: p.link,
        imagenUrl: item.imagen,
        nombreEnTienda: p.nombre,
        marcaEnTienda: p.marca,
        codigoEnTienda: item.ean,
        nota:
          coincidencia === 'codigo'
            ? 'Mismo código de barras.'
            : `Foto de la unidad: el código de la lista es el del bulto (${buscado} es el de la unidad).`,
      }
    }
  }
  return null
}

interface Opcion {
  tienda: Tienda
  producto: ProductoDeTienda
  item: { ean: string; imagen: string }
  veredicto: Veredicto
  cobertura: number
  motivos: string[]
}

async function porNombre(nombre: string, codigo: string | null): Promise<EntradaDelManifiesto> {
  const base = sinBulto(nombre)
  // Dos consultas por tienda, de mas a menos especifica: el nombre sin la
  // medida --las tiendas la escriben de mil maneras-- y, si no aparece nada,
  // solo las palabras.
  const consultas = [
    normalizar(base)
      .replace(/\d+(?:[.,]\d+)?\s*(?:kg|g|gr|grs|l|lt|ml|cc|m)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    palabras(base).join(' '),
  ].filter((c, i, todas) => c !== '' && todas.indexOf(c) === i)

  const opciones: Opcion[] = []
  for (const tienda of TIENDAS) {
    for (const consulta of consultas) {
      const productos = await consultar(tienda, `ft=${encodeURIComponent(consulta)}&_from=0&_to=19`)
      for (const p of productos) {
        const item = p.items.find((i) => i.imagen !== null)
        if (!item?.imagen) continue
        const { veredicto, cobertura, motivos } = comparar(nombre, {
          nombre: p.nombre,
          marca: p.marca,
        })
        if (veredicto === null) continue
        opciones.push({
          tienda,
          producto: p,
          item: { ean: item.ean, imagen: item.imagen },
          veredicto,
          cobertura,
          motivos,
        })
      }
      if (opciones.some((o) => o.tienda === tienda && o.veredicto === 'encontrada')) break
    }
    if (opciones.some((o) => o.veredicto === 'encontrada')) break
  }

  if (opciones.length === 0) {
    return vacia(nombre, codigo, 'Ninguna tienda tiene un producto parecido.')
  }

  const orden = (o: Opcion) => (o.veredicto === 'encontrada' ? 2 : 1) + o.cobertura
  opciones.sort((a, b) => orden(b) - orden(a))
  const mejor = opciones[0]
  if (!mejor) return vacia(nombre, codigo, 'Ninguna tienda tiene un producto parecido.')

  const motivos = [...mejor.motivos]
  let estado: Estado = mejor.veredicto

  // Dos productos DISTINTOS de la misma tienda que cumplen igual es una
  // ambiguedad: no se elige uno por las dudas.
  if (estado === 'encontrada') {
    const rivales = new Set(
      opciones
        .filter((o) => o.veredicto === 'encontrada' && o.tienda === mejor.tienda)
        .map((o) => normalizar(o.producto.nombre)),
    )
    if (rivales.size > 1) {
      estado = 'dudosa'
      motivos.push(`${String(rivales.size)} productos de ${mejor.tienda.nombre} coinciden igual`)
    }
  }

  // El nombre coincide pero la tienda le pone OTRO codigo: puede ser otra
  // presentacion, u otro producto con el mismo nombre. Que lo mire alguien.
  if (
    estado === 'encontrada' &&
    codigo !== null &&
    digitoVerificadorValido(codigo) &&
    mejor.item.ean !== '' &&
    sinCeros(mejor.item.ean) !== sinCeros(codigo)
  ) {
    estado = 'dudosa'
    motivos.push(`la tienda tiene otro código (${mejor.item.ean})`)
  }

  return {
    nombre,
    codigo,
    estado,
    coincidencia: 'nombre',
    tienda: mejor.tienda.nombre,
    paginaUrl: mejor.producto.link,
    imagenUrl: mejor.item.imagen,
    nombreEnTienda: mejor.producto.nombre,
    marcaEnTienda: mejor.producto.marca,
    codigoEnTienda: mejor.item.ean === '' ? null : mejor.item.ean,
    nota: estado === 'encontrada' ? 'Mismo nombre, marca y medida.' : motivos.join('; '),
  }
}

async function buscar(nombre: string, codigo: string | null): Promise<EntradaDelManifiesto> {
  const notas: string[] = []
  if (codigo !== null) {
    if (digitoVerificadorValido(codigo)) {
      const exacto = await porCodigo(nombre, codigo, codigo, 'codigo')
      if (exacto) return exacto
      const unidad = codigoDeUnidad(codigo)
      if (unidad !== null) {
        const deUnidad = await porCodigo(nombre, codigo, unidad, 'codigo-de-unidad')
        if (deUnidad) return deUnidad
      }
      notas.push('Ninguna tienda tiene el código.')
    } else {
      notas.push('El código de la lista tiene el dígito verificador mal: se buscó por nombre.')
    }
  }
  const porTexto = await porNombre(nombre, codigo)
  // Con el codigo mal escrito, el que tiene la tienda es la pista para
  // corregirlo: se mira la etiqueta y se compara.
  if (codigo !== null && !digitoVerificadorValido(codigo) && porTexto.codigoEnTienda !== null) {
    notas.push(
      `La tienda lo tiene con el código ${porTexto.codigoEnTienda}: comparar con la etiqueta.`,
    )
  }
  return notas.length === 0
    ? porTexto
    : { ...porTexto, nota: `${notas.join(' ')} ${porTexto.nota}` }
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

function resumenEnMarkdown(entradas: EntradaDelManifiesto[], sucursal: string): string {
  const fila = (e: EntradaDelManifiesto) =>
    `| ${e.nombre.replace(/\|/g, '/')} | ${e.codigo ?? '—'} | ${e.tienda ?? '—'} | ${
      e.paginaUrl ? `[${(e.nombreEnTienda ?? 'ver').replace(/[|[\]]/g, ' ')}](${e.paginaUrl})` : '—'
    } | ${e.nota.replace(/\|/g, '/')} |`
  const seccion = (titulo: string, estado: Estado) => {
    const lista = entradas.filter((e) => e.estado === estado)
    return [
      `## ${titulo} (${String(lista.length)})`,
      '',
      '| Producto | Código | Tienda | Producto en la tienda | Nota |',
      '|---|---|---|---|---|',
      ...lista.map(fila),
      '',
    ].join('\n')
  }
  return [
    `# Fotos de productos — sucursal ${sucursal}`,
    '',
    `Generado el ${new Date().toISOString()} por \`scripts/buscar-imagenes.ts\`.`,
    '',
    seccion('Encontradas', 'encontrada'),
    seccion('Dudosas: para revisar a mano', 'dudosa'),
    seccion('No encontradas', 'no-encontrada'),
  ].join('\n')
}

async function main(): Promise<void> {
  const sucursal = argumento('--sucursal')
  const salida = argumento('--salida')
  if (
    sucursal === null ||
    !/^\d+$/.test(sucursal) ||
    salida === null ||
    !salida.endsWith('.json')
  ) {
    console.error('Uso: npx tsx scripts/buscar-imagenes.ts --sucursal 1 --salida imagenes.json')
    process.exit(2)
  }

  const solo = argumento('--solo')
  const productos = await prisma.product.findMany({
    where: {
      branchId: Number(sucursal),
      isActive: true,
      ...(solo === null ? {} : { name: { contains: solo, mode: 'insensitive' as const } }),
    },
    select: { name: true, barcodes: { where: { isPrimary: true }, select: { code: true } } },
    orderBy: { name: 'asc' },
  })
  console.log(`${String(productos.length)} productos activos en la sucursal ${sucursal}`)

  const entradas: EntradaDelManifiesto[] = []
  for (const [i, p] of productos.entries()) {
    const entrada = await buscar(p.name, p.barcodes[0]?.code ?? null)
    entradas.push(entrada)
    console.log(
      `${String(i + 1).padStart(3)}/${String(productos.length)} ${entrada.estado.padEnd(13)} ${p.name}` +
        (entrada.nombreEnTienda ? `  →  ${entrada.nombreEnTienda} (${entrada.tienda ?? ''})` : ''),
    )
  }

  const cuenta = (e: Estado) => entradas.filter((x) => x.estado === e).length
  writeFileSync(
    salida,
    `${JSON.stringify(
      {
        generado: new Date().toISOString(),
        sucursal: Number(sucursal),
        tiendas: TIENDAS.map((t) => t.host),
        resumen: {
          encontradas: cuenta('encontrada'),
          dudosas: cuenta('dudosa'),
          noEncontradas: cuenta('no-encontrada'),
        },
        productos: entradas,
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(salida.replace(/\.json$/, '.md'), resumenEnMarkdown(entradas, sucursal))
  console.log(
    `\nencontradas ${String(cuenta('encontrada'))} · dudosas ${String(cuenta('dudosa'))} · ` +
      `no encontradas ${String(cuenta('no-encontrada'))}\n${salida}`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
