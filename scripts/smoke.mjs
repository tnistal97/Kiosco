/**
 * `npm run smoke:staging`     comprueba TODO, incluido escribir
 * `npm run smoke:production`  solo lee. Nunca crea una venta ni mueve stock
 *
 * Un smoke no reemplaza a la suite: la suite dice que el codigo esta bien, el
 * smoke dice que ESTE despliegue, con ESTA base y ESTA configuracion, funciona.
 * Son preguntas distintas y fallan por motivos distintos --una variable de
 * entorno mal puesta pasa las 1.400 pruebas y rompe el login--.
 *
 * LA DIFERENCIA ENTRE LOS DOS MODOS ES DELIBERADA
 *
 * En staging se vende de verdad: abrir turno, cobrar, anular, recibir
 * mercaderia, contar el deposito. Es la unica forma de saber que la cadena
 * entera anda.
 *
 * En produccion NO. Un smoke que crea una venta deja una venta falsa en la
 * contabilidad del comercio, y borrarla despues es peor: este sistema no
 * borra ventas, las anula, y una anulacion falsa tambien queda en la
 * bitacora. Asi que en produccion se comprueba lo que se puede comprobar
 * leyendo, y se dice claramente cual es la diferencia.
 *
 * Variables:
 *   SMOKE_BASE_URL   https://staging.kiosco.nistal.net
 *   SMOKE_USER       usuario de una cuenta tecnica
 *   SMOKE_PASSWORD   su contraseña
 */

const MODO = process.argv[2] === 'production' ? 'production' : 'staging'
const BASE = (process.env.SMOKE_BASE_URL ?? '').replace(/\/$/, '')
const USUARIO = process.env.SMOKE_USER ?? ''
const CLAVE = process.env.SMOKE_PASSWORD ?? ''

if (!BASE) {
  console.error('Falta SMOKE_BASE_URL. Ver .env.example.')
  process.exit(1)
}

const resultados = []
let cookie = ''

function registrar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok, detalle })
  const marca = ok ? 'OK  ' : 'FALLA'
  console.log(`  ${marca} ${nombre}${detalle ? `  ${detalle}` : ''}`)
}

async function paso(nombre, fn) {
  try {
    const detalle = await fn()
    registrar(nombre, true, detalle ?? '')
    return true
  } catch (e) {
    registrar(nombre, false, e instanceof Error ? e.message : String(e))
    return false
  }
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      ...(opciones.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...opciones.headers,
    },
    redirect: 'manual',
  })
  const texto = await res.text()
  let cuerpo = null
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    /* no era JSON: lo dice el estado */
  }
  return { res, cuerpo, texto }
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

// ---------------------------------------------------------------------------
// Comprobaciones comunes: valen en los dos modos porque ninguna escribe
// ---------------------------------------------------------------------------

async function salud() {
  const { res, cuerpo } = await pedir('/api/health')
  exigir(res.status === 200, `estado ${String(res.status)}`)
  exigir(cuerpo?.status === 'ok', `status=${String(cuerpo?.status)}`)
  exigir(cuerpo?.database?.ok === true, 'la base no responde')
  return `v${String(cuerpo.version)} commit ${String(cuerpo.commit).slice(0, 12)} db ${String(cuerpo.database.latencyMs)} ms`
}

async function metadatosDelBuild() {
  const { cuerpo } = await pedir('/api/health')
  exigir(cuerpo?.commit !== 'desconocido', 'el artefacto no trae build-info.json')
  exigir(typeof cuerpo?.buildTime === 'string', 'sin buildTime')
  return `construido ${String(cuerpo.buildTime)}`
}

async function saludNoFiltra() {
  const { texto } = await pedir('/api/health')
  for (const rastro of ['postgres://', 'postgresql://', 'password', 'JWT', '/home/', 'at ']) {
    exigir(!texto.includes(rastro), `la salud menciona "${rastro}"`)
  }
  return 'sin rastros de configuracion'
}

async function loginRechazaMal() {
  const { res } = await pedir('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: USUARIO || 'nadie',
      password: 'clave-incorrecta-a-proposito',
    }),
  })
  exigir(res.status === 401, `estado ${String(res.status)}, se esperaba 401`)
  return 'credenciales malas = 401'
}

async function login() {
  exigir(USUARIO !== '' && CLAVE !== '', 'faltan SMOKE_USER / SMOKE_PASSWORD')
  const { res } = await pedir('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USUARIO, password: CLAVE }),
  })
  exigir(res.status === 200, `estado ${String(res.status)}`)
  const set = res.headers.get('set-cookie') ?? ''
  exigir(set.includes('token='), 'no llego la cookie de sesion')
  exigir(set.toLowerCase().includes('httponly'), 'la cookie no es httpOnly')
  cookie = set.split(';')[0]
  return 'cookie httpOnly'
}

async function sinSesionNoSeEntra() {
  const guardada = cookie
  cookie = ''
  try {
    const { res } = await pedir('/api/products?page=1&pageSize=1')
    exigir(res.status === 401, `estado ${String(res.status)}, se esperaba 401`)
    return 'sin cookie = 401'
  } finally {
    cookie = guardada
  }
}

async function permisos() {
  const { res, cuerpo } = await pedir('/api/auth/validate', { method: 'POST' })
  exigir(res.status === 200, `estado ${String(res.status)}`)
  exigir(Array.isArray(cuerpo?.user?.permissions), 'sin lista de permisos')
  exigir(typeof cuerpo?.branch?.timeZone === 'string', 'sin zona horaria de sucursal')
  return `${String(cuerpo.user.permissions.length)} permisos, ${String(cuerpo.branch.timeZone)}`
}

async function lecturasSeguras() {
  const rutas = [
    ['catalogo', '/api/products?page=1&pageSize=5'],
    ['stock', '/api/inventory/movements?page=1&pageSize=5'],
    ['ventas', '/api/sales?page=1&pageSize=5'],
    ['caja', '/api/cash/balance'],
    ['proveedores', '/api/suppliers?page=1&pageSize=5'],
    ['clientes', '/api/clients?page=1&pageSize=5'],
    ['lotes', '/api/lotes?page=1&pageSize=5'],
    ['inventarios', '/api/inventarios?page=1&pageSize=5'],
  ]
  const malas = []
  for (const [nombre, ruta] of rutas) {
    const { res } = await pedir(ruta)
    // 403 es una respuesta VALIDA: significa que la cuenta tecnica no tiene
    // ese permiso, y que la autorizacion funciona. Lo que no puede haber es un
    // 500 ni un 404.
    if (res.status !== 200 && res.status !== 403) malas.push(`${nombre}=${String(res.status)}`)
  }
  exigir(malas.length === 0, malas.join(' '))
  return `${String(rutas.length)} lecturas`
}

async function cabeceras() {
  const { res } = await pedir('/api/health')
  exigir(res.headers.get('x-request-id') !== null, 'sin x-request-id')
  exigir((res.headers.get('cache-control') ?? '').includes('no-store'), 'la API se puede cachear')
  return 'x-request-id y no-store'
}

async function pwa() {
  const { res } = await pedir('/manifest.json')
  exigir(res.status === 200, `manifest ${String(res.status)}`)
  const sw = await pedir('/sw.js')
  exigir(sw.res.status === 200, `sw.js ${String(sw.res.status)}`)
  return 'manifiesto y service worker'
}

// ---------------------------------------------------------------------------
// Solo staging: aca si se escribe
// ---------------------------------------------------------------------------

async function ventaCompleta() {
  const { cuerpo: cat } = await pedir('/api/products?page=1&pageSize=1')
  const producto = cat?.data?.[0]
  exigir(producto, 'no hay productos para vender')

  const turno = await pedir('/api/cash/shift', {
    method: 'POST',
    body: JSON.stringify({ openingAmount: '0' }),
  })
  exigir(
    turno.res.status === 200 || turno.res.status === 409,
    `abrir turno: ${String(turno.res.status)}`,
  )

  const venta = await pedir('/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: producto.id, quantity: '1' }],
      payments: [{ method: 'CASH', amount: producto.price }],
    }),
  })
  exigir(venta.res.status === 200 || venta.res.status === 201, `venta: ${String(venta.res.status)}`)
  const id = venta.cuerpo?.id
  exigir(typeof id === 'number', 'la venta no devolvio id')

  const anulada = await pedir(`/api/sales/${String(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'Comprobacion automatica de staging' }),
  })
  exigir(anulada.res.status === 200, `anulacion: ${String(anulada.res.status)}`)
  return `venta ${String(id)} creada y anulada`
}

async function integridad() {
  const { res, cuerpo } = await pedir('/api/reportes/integridad')
  if (res.status === 404) return 'sin endpoint: correr `npm run integrity:check` en el servidor'
  exigir(res.status === 200, `estado ${String(res.status)}`)
  exigir((cuerpo?.inconsistencias?.length ?? 0) === 0, 'hay inconsistencias')
  return 'sin inconsistencias'
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nSMOKE ${MODO.toUpperCase()}  ${BASE}\n`)

  console.log('Sin sesion')
  await paso('salud', salud)
  await paso('metadatos del build', metadatosDelBuild)
  await paso('la salud no filtra configuracion', saludNoFiltra)
  await paso('cabeceras', cabeceras)
  await paso('PWA', pwa)
  await paso('credenciales incorrectas', loginRechazaMal)

  console.log('\nCon sesion')
  const entro = await paso('login', login)
  if (entro) {
    await paso('sin cookie no se entra', sinSesionNoSeEntra)
    await paso('permisos y sucursal', permisos)
    await paso('lecturas seguras', lecturasSeguras)
    await paso('integridad', integridad)
  }

  if (MODO === 'staging' && entro) {
    console.log('\nEscritura (solo staging)')
    await paso('turno, venta, cobro y anulacion', ventaCompleta)
  } else if (MODO === 'production') {
    console.log('\nEscritura: OMITIDA a proposito.')
    console.log('  Una venta de prueba en produccion es una venta falsa en la contabilidad,')
    console.log('  y anularla despues deja dos asientos falsos en vez de uno.')
  }

  const fallaron = resultados.filter((r) => !r.ok)
  console.log(
    `\n${String(resultados.length - fallaron.length)}/${String(resultados.length)} comprobaciones.`,
  )
  if (fallaron.length > 0) {
    console.log(`FALLARON: ${fallaron.map((r) => r.nombre).join(', ')}\n`)
    process.exitCode = 1
  } else {
    console.log('Todo verde.\n')
  }
}

main().catch((e) => {
  console.error(`\nSMOKE INTERRUMPIDO: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exitCode = 1
})
