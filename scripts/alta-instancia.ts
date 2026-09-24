/**
 * Alta de una instancia nueva de Kiosco, para quien la instala.
 *
 * No es un registro publico: lo corre un tecnico, en el servidor, contra la
 * base propia y vacia del comercio nuevo. Reemplaza a `prisma/seed.ts`.
 *
 *   npm run alta:instancia -- --nombre-comercial "Almacén Don Pepe" \
 *     --admin-usuario pepe --admin-nombre "José Pérez" --dry-run
 *
 * Trabaja contra `DATABASE_URL`, tomada del entorno o de `.env.local`/`.env`
 * como los demas guiones. Lo que hace, y lo que se niega a hacer, esta en
 * `scripts/lib/instancia.ts`. `--ayuda` lista las opciones.
 */

import './entorno'
import { closeSync, openSync, unlinkSync, writeSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { redactar } from '@/server/http/redaccion'
import { ZONA_POR_DEFECTO } from '@/lib/tiempo'
import {
  AltaRechazada,
  darDeAlta,
  describirBase,
  destinoDeLaClave,
  type ResultadoDeAlta,
} from './lib/instancia'

const AYUDA = `
Alta de una instancia nueva de Kiosco.

  npm run alta:instancia -- [opciones]

Obligatorias:
  --nombre-comercial "…"   Nombre del comercio (lo que se ve en la pantalla).
  --admin-usuario …        Usuario del primer administrador (el dueño).
  --admin-nombre "…"       Su nombre y apellido.

Opcionales:
  --sucursal "…"           Nombre de la sucursal. Por omisión: "Casa central".
  --direccion "…"          Dirección de la sucursal.
  --telefono "…"           Teléfono de la sucursal.
  --email …                Correo de la sucursal.
  --zona-horaria …         IANA. Por omisión: ${ZONA_POR_DEFECTO}.
  --rol duenio|admin       Rol del primer usuario. Por omisión: duenio.
  --dry-run                Simulacro: revisa la base y dice qué haría. No escribe.
  --completar              Sobre una instancia con datos, agrega solo lo que
                           falte (p. ej. un rol nuevo). Nunca modifica ni borra.
  --clave-en <archivo>     Guarda la clave inicial en un archivo NUEVO (600) en
                           vez de mostrarla. Obligatoria si la salida no es una
                           terminal: la clave no tiene que quedar en un log.

Se niega a trabajar sobre una base con datos (salvo --completar) o con tablas
que no son de Kiosco. Aplica las migraciones con "prisma migrate deploy";
nunca "reset" ni "db push". La moneda no se configura: el sistema opera en
pesos argentinos.
`

const OPCIONES = {
  'nombre-comercial': { type: 'string' },
  sucursal: { type: 'string' },
  direccion: { type: 'string' },
  telefono: { type: 'string' },
  email: { type: 'string' },
  'zona-horaria': { type: 'string' },
  'admin-usuario': { type: 'string' },
  'admin-nombre': { type: 'string' },
  rol: { type: 'string' },
  'dry-run': { type: 'boolean' },
  completar: { type: 'boolean' },
  'clave-en': { type: 'string' },
  ayuda: { type: 'boolean' },
  help: { type: 'boolean' },
} as const

function leerArgumentos() {
  try {
    return parseArgs({ options: OPCIONES, strict: true, allowPositionals: false }).values
  } catch (error) {
    throw new AltaRechazada(`${error instanceof Error ? error.message : String(error)}\n${AYUDA}`)
  }
}

/** La clave, en pantalla, una sola vez. */
function mostrarClave(usuario: string, clave: string): void {
  const linea = '='.repeat(64)
  console.log(`\n  ${linea}`)
  console.log(`    CLAVE INICIAL de "${usuario}":   ${clave}`)
  console.log('    Se muestra UNA vez. No quedó guardada en ningún lado.')
  console.log(`  ${linea}`)
}

/** Lo que queda por hacer fuera de la base. Ninguna linea lleva un secreto. */
function siguientesPasos(r: ResultadoDeAlta): void {
  const nombre = r.datos.nombreComercial
  const nombreActual = process.env.COMMERCE_NAME?.trim()
  const hosts = process.env.KIOSCO_HOSTS?.trim()

  console.log('\nFalta, en el archivo de entorno de ESTA instancia:')
  console.log(
    `  COMMERCE_NAME="${nombre.replace(/"/g, '\\"')}"` +
      (nombreActual === nombre ? '   (ya está)' : '   <- agregar'),
  )
  console.log(
    '  KIOSCO_HOSTS=<dominios de este comercio, separados por coma>' +
      (hosts ? `   (ya está: ${hosts})` : '   <- agregar'),
  )
  console.log(
    '\nDespués: reiniciar el servicio (no hace falta recompilar), comprobar /api/health,\n' +
      `entrar como "${r.datos.adminUsuario}" y cambiar la clave en Configuración > Contraseña.\n`,
  )
}

async function main(): Promise<void> {
  const v = leerArgumentos()
  if (v.ayuda === true || v.help === true) {
    console.log(AYUDA)
    return
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new AltaRechazada(
      'Falta DATABASE_URL: la base NUEVA del comercio, creada vacía y con su propio usuario.',
    )
  }

  const dryRun = v['dry-run'] === true
  const claveEn = v['clave-en']
  const destino = destinoDeLaClave({ esTerminal: process.stdout.isTTY, claveEn, dryRun })

  // El archivo de la clave se crea YA, vacio y exclusivo (`wx`): si no se
  // puede, se sabe antes de tocar la base y no despues de crear un usuario
  // con una clave que nadie va a conocer.
  let archivo: number | null = null
  if (destino === 'archivo' && claveEn !== undefined) {
    try {
      archivo = openSync(claveEn, 'wx', 0o600)
    } catch (error) {
      const codigo = (error as { code?: string }).code ?? 'error'
      throw new AltaRechazada(
        `No se pudo crear ${claveEn} (${codigo}). Tiene que ser un archivo que no exista.`,
      )
    }
  }

  const descartarArchivo = () => {
    if (archivo === null || claveEn === undefined) return
    closeSync(archivo)
    unlinkSync(claveEn)
    archivo = null
  }

  console.log(`\nALTA DE INSTANCIA${dryRun ? ' — simulacro: no se escribe nada' : ''}`)
  console.log(`  Base: ${describirBase(url)}\n`)

  let r: ResultadoDeAlta
  try {
    r = await darDeAlta(
      {
        nombreComercial: v['nombre-comercial'] ?? '',
        sucursal: v.sucursal ?? 'Casa central',
        direccion: v.direccion,
        telefono: v.telefono,
        email: v.email,
        zonaHoraria: v['zona-horaria'],
        adminUsuario: v['admin-usuario'] ?? '',
        adminNombre: v['admin-nombre'] ?? '',
        rolAdmin: v.rol as 'duenio' | 'admin' | undefined,
      },
      { url, dryRun, completar: v.completar === true },
    )
  } catch (error) {
    descartarArchivo()
    throw error
  }

  for (const accion of r.acciones) console.log(`  - ${accion}`)

  if (r.claveInicial !== null) {
    if (archivo !== null) {
      writeSync(archivo, `${r.claveInicial}\n`)
      closeSync(archivo)
      archivo = null
      console.log(
        `\n  La clave inicial de "${r.datos.adminUsuario}" quedó en ${String(claveEn)}.` +
          '\n  Entregala y borrá el archivo.',
      )
    } else {
      mostrarClave(r.datos.adminUsuario, r.claveInicial)
    }
  } else {
    descartarArchivo()
  }

  if (dryRun) {
    console.log('\nSimulacro terminado. Para hacerlo de verdad, la misma orden sin --dry-run.\n')
    return
  }
  siguientesPasos(r)
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    // Ni un mensaje de Prisma sale sin tachar: puede traer la conexion.
    const texto = redactar(error instanceof Error ? error.message : String(error))
    if (error instanceof AltaRechazada) {
      console.error(`\nNO SE HIZO NADA. ${texto}\n`)
      process.exit(2)
    }
    console.error(`\nERROR: ${texto}\n`)
    process.exit(1)
  },
)
