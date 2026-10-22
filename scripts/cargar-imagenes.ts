/**
 * Carga en la base las fotos del manifiesto que dejo `scripts/buscar-imagenes.ts`.
 *
 * Solo toma las entradas `encontrada`. Las `dudosa` y `no-encontrada` no se
 * tocan: para cargar una dudosa, alguien la mira y le cambia el estado en el
 * manifiesto, o le pone la foto a mano desde la ficha del producto. Ver
 * docs/PRODUCT_IMAGES.md.
 *
 * Cada foto se descarga, se comprueba que sea una imagen de verdad y se vuelve
 * a codificar con `prepararImagen` --la misma funcion que usa la ficha--, asi
 * que lo que entra a la base nunca es el archivo de la tienda.
 *
 * El producto se busca por su NOMBRE exacto entre los activos de la sucursal y,
 * si el manifiesto trae codigo, tiene que ser tambien su codigo principal. Los
 * ids no sirven: el manifiesto se arma en una base y se puede aplicar en otra.
 *
 * Se puede repetir: una foto que ya esta igual, con el mismo origen, no se
 * vuelve a escribir ni deja otra entrada en la bitacora.
 *
 * Uso:
 *
 *   npx tsx scripts/cargar-imagenes.ts imagenes.json --sucursal 1 --autor 1 --ensayo
 *   npx tsx scripts/cargar-imagenes.ts imagenes.json --sucursal 1 --autor 1 --aplicar
 *
 * `--ensayo` descarga y prepara todo, y no escribe nada. Con
 * `--vista-previa <carpeta>` deja ahi cada miniatura y un `index.html` para
 * revisarlas a ojo, dudosas incluidas.
 */
import './entorno'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import {
  BYTES_MAXIMOS,
  guardarImagenEn,
  prepararImagen,
  type ImagenPreparada,
} from '@/modules/products/imagen'
import type { EntradaDelManifiesto } from './buscar-imagenes'

const ORIGEN = 'scripts/cargar-imagenes'
const AGENTE = 'KioscoImagenes/1.0 (descarga la foto de los productos de un almacen)'

/**
 * De donde se aceptan fotos: los servidores de imagenes de las tiendas que
 * consulta la busqueda. Una direccion de otro lado en el manifiesto --editado a
 * mano, o de una version futura del buscador-- no se descarga sin pensarlo.
 */
const SERVIDORES = [/\.vteximg\.com\.br$/, /\.vtexassets\.com$/]

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function descargar(direccion: string): Promise<Uint8Array> {
  const url = new URL(direccion)
  if (url.protocol !== 'https:' || !SERVIDORES.some((s) => s.test(url.hostname))) {
    throw new Error(`no se descargan fotos de ${url.hostname}`)
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': AGENTE },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) {
    throw new Error(`no es una imagen (${res.headers.get('content-type') ?? 'sin tipo'})`)
  }
  const lector = res.body?.getReader()
  if (!lector) throw new Error('respuesta vacia')
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > BYTES_MAXIMOS) {
      await lector.cancel()
      throw new Error('pesa mas de 5 MB')
    }
    partes.push(value)
  }
  return Buffer.concat(partes)
}

function escapar(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )
}

/** Una hoja para mirar todas las fotos juntas, con el nombre de la lista y el de la tienda. */
function hojaDeRevision(
  filas: Array<{ entrada: EntradaDelManifiesto; archivo: string | null; error: string | null }>,
): string {
  const tarjetas = filas
    .map(({ entrada: e, archivo, error }, i) => {
      const foto = archivo
        ? `<img src="${escapar(archivo)}" alt="">`
        : `<div class="sin">${escapar(error ?? 'sin foto')}</div>`
      return `<figure class="${e.estado}"><span class="n">${String(i + 1)}</span>${foto}
<figcaption><b>${escapar(e.nombre)}</b><br><small>${escapar(e.estado)} · ${escapar(e.coincidencia ?? '')}</small><br>
<i>${escapar(e.nombreEnTienda ?? '')}</i><br><small>${escapar(e.nota)}</small>${e.revision ? `<br><small><b>Revisión:</b> ${escapar(e.revision)}</small>` : ''}</figcaption></figure>`
    })
    .join('\n')
  return `<!doctype html><meta charset="utf-8"><title>Revision de fotos</title>
<style>body{font:13px system-ui;margin:12px;background:#f4f5f7}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
figure{margin:0;background:#fff;border:3px solid #2e7d32;border-radius:8px;padding:8px;position:relative}figure.dudosa{border-color:#ed6c02}figure.no-encontrada{border-color:#999}
img{width:100%;height:170px;object-fit:contain;background:#fff}.sin{height:170px;display:grid;place-items:center;color:#777}.n{position:absolute;top:4px;left:6px;font-weight:700}
figcaption{margin-top:6px;line-height:1.3}i{color:#245}</style><main>${tarjetas}</main>`
}

async function main(): Promise<void> {
  const manifiesto = process.argv[2]
  const sucursal = Number(argumento('--sucursal'))
  const autor = Number(argumento('--autor'))
  const aplicar = process.argv.includes('--aplicar')
  const ensayo = process.argv.includes('--ensayo')
  const vistaPrevia = argumento('--vista-previa')
  if (
    !manifiesto?.endsWith('.json') ||
    !Number.isInteger(sucursal) ||
    !Number.isInteger(autor) ||
    aplicar === ensayo
  ) {
    console.error(
      'Uso: npx tsx scripts/cargar-imagenes.ts imagenes.json --sucursal 1 --autor 1 ' +
        '(--ensayo [--vista-previa carpeta] | --aplicar)',
    )
    process.exit(2)
  }

  const quien = await prisma.user.findFirst({
    where: { id: autor, isActive: true, role: { name: { in: ['admin', 'duenio'] } } },
    select: { id: true, username: true },
  })
  if (!quien) throw new Error(`El autor ${String(autor)} no es un administrador activo`)

  const { productos: entradas } = JSON.parse(readFileSync(manifiesto, 'utf8')) as {
    productos: EntradaDelManifiesto[]
  }

  const activos = await prisma.product.findMany({
    where: { branchId: sucursal, isActive: true },
    select: {
      id: true,
      name: true,
      barcodes: { where: { isPrimary: true }, select: { code: true } },
    },
  })
  const porNombre = new Map<string, typeof activos>()
  for (const p of activos) porNombre.set(p.name, [...(porNombre.get(p.name) ?? []), p])

  const revisar = entradas.filter((e) =>
    vistaPrevia === null ? e.estado === 'encontrada' : e.imagenUrl !== null,
  )
  if (vistaPrevia !== null) mkdirSync(vistaPrevia, { recursive: true })

  const hoja: Array<{
    entrada: EntradaDelManifiesto
    archivo: string | null
    error: string | null
  }> = []
  let escritas = 0
  let iguales = 0
  const fallas: string[] = []

  for (const [i, entrada] of revisar.entries()) {
    const candidatos = porNombre.get(entrada.nombre) ?? []
    const producto = candidatos[0]
    let motivo: string | null = null
    if (!producto) motivo = 'no hay un producto activo con ese nombre'
    else if (candidatos.length > 1) motivo = 'hay mas de un producto activo con ese nombre'
    else if (entrada.codigo !== null && producto.barcodes[0]?.code !== entrada.codigo) {
      motivo = `el codigo del producto no es ${entrada.codigo}`
    } else if (entrada.imagenUrl === null) motivo = 'el manifiesto no trae foto'

    let imagen: ImagenPreparada | null = null
    if (motivo === null && entrada.imagenUrl !== null) {
      try {
        imagen = await prepararImagen(await descargar(entrada.imagenUrl))
      } catch (error) {
        motivo = error instanceof Error ? error.message : String(error)
      }
    }

    let archivo: string | null = null
    if (imagen && vistaPrevia !== null) {
      archivo = `${String(i + 1).padStart(3, '0')}.webp`
      writeFileSync(path.join(vistaPrevia, archivo), imagen.data)
    }
    hoja.push({ entrada, archivo, error: motivo })

    if (motivo !== null || !imagen || !producto) {
      fallas.push(`${entrada.nombre}: ${motivo ?? 'sin foto'}`)
      console.log(`${String(i + 1).padStart(3)} FALLA  ${entrada.nombre}: ${motivo ?? ''}`)
      continue
    }

    if (aplicar && entrada.estado === 'encontrada') {
      const listo = imagen
      const cambio = await prisma.$transaction((tx) =>
        guardarImagenEn(tx, {
          productId: producto.id,
          branchId: sucursal,
          userId: quien.id,
          imagen: listo,
          sourceUrl: entrada.paginaUrl,
          origin: ORIGEN,
        }),
      )
      if (cambio) escritas++
      else iguales++
    }
    console.log(
      `${String(i + 1).padStart(3)} ${entrada.estado === 'encontrada' ? 'ok    ' : 'dudosa'} ` +
        `${entrada.nombre} (${String(imagen.width)}x${String(imagen.height)}, ` +
        `${String(Math.round(imagen.data.byteLength / 1024))} kB)`,
    )
  }

  if (vistaPrevia !== null) {
    writeFileSync(path.join(vistaPrevia, 'index.html'), hojaDeRevision(hoja))
    console.log(`\nHoja de revision: ${path.join(vistaPrevia, 'index.html')}`)
  }
  console.log(
    `\n${aplicar ? 'APLICADO' : 'ENSAYO, no se escribio nada'}: ` +
      `${String(revisar.length)} revisadas · ${String(escritas)} fotos escritas · ` +
      `${String(iguales)} ya estaban iguales · ${String(fallas.length)} fallas`,
  )
  if (fallas.length > 0) console.log(fallas.map((f) => `  - ${f}`).join('\n'))
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
