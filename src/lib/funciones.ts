/**
 * Funciones opcionales de la instalacion.
 *
 * Un almacen de barrio no usa lotes ni ordenes de compra, y verlas en el menu
 * solo le agrega preguntas a quien atiende. Estas funciones NO se borran: el
 * dominio, la API y los datos siguen intactos. Lo que cambia es si la
 * interfaz las muestra.
 *
 * Se habilitan por instalacion con la variable de entorno del servidor
 *
 *   KIOSCO_FUNCIONES=lotes,compras
 *
 * que se lee al atender, igual que `COMMERCE_NAME`: cambiarla es editar el
 * archivo de entorno y reiniciar, sin recompilar. Sin la variable, la
 * instalacion arranca en modo almacen: ninguna de las dos.
 *
 *   lotes    Lotes y vencimientos: /stock/lotes y los datos de partida en
 *            productos, movimientos y conteos.
 *   compras  Ordenes de compra, proveedores y devoluciones a proveedores.
 *
 * Es codigo puro: lo usan el servidor (para leer el entorno y cortar las
 * rutas) y el navegador (para dibujar el menu), que recibe la lista ya
 * resuelta con la sesion.
 */

export const FUNCIONES_OPCIONALES = ['lotes', 'compras'] as const

export type FuncionOpcional = (typeof FUNCIONES_OPCIONALES)[number]

/** Lo que se muestra cuando la variable no esta. Modo almacen. */
export const FUNCIONES_POR_DEFECTO: readonly FuncionOpcional[] = []

function esFuncion(valor: string): valor is FuncionOpcional {
  return (FUNCIONES_OPCIONALES as readonly string[]).includes(valor)
}

/**
 * Las funciones habilitadas en esta instalacion.
 *
 * Acepta comas o espacios y no distingue mayusculas. Un nombre desconocido se
 * ignora en vez de romper el arranque: una errata no puede dejar al comercio
 * sin sistema. `todas` habilita todo, para una instalacion completa.
 */
export function funcionesHabilitadas(
  env: Record<string, string | undefined> = process.env,
): FuncionOpcional[] {
  const crudo = env.KIOSCO_FUNCIONES
  if (crudo === undefined) return [...FUNCIONES_POR_DEFECTO]

  const pedidas = crudo
    .split(/[\s,]+/)
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f !== '')

  if (pedidas.includes('todas')) return [...FUNCIONES_OPCIONALES]
  return FUNCIONES_OPCIONALES.filter((f) => pedidas.some((p) => p === f && esFuncion(p)))
}

export function funcionHabilitada(
  funcion: FuncionOpcional,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return funcionesHabilitadas(env).includes(funcion)
}

/**
 * Permisos que pertenecen a cada funcion opcional.
 *
 * Con la funcion apagada, se quitan de la copia de permisos que baja al
 * navegador. Asi cada `puede('lots.view')` que ya existe --menu, inicio,
 * secciones de reportes, botones-- esconde lo suyo sin tocar cada pantalla.
 * El servidor sigue autorizando con los permisos reales del rol.
 */
const PERMISOS_DE: Record<FuncionOpcional, (permiso: string) => boolean> = {
  lotes: (p) => p.startsWith('lots.'),
  compras: (p) =>
    p.startsWith('purchases.') ||
    p.startsWith('suppliers.') ||
    p.startsWith('supplierAccounts.') ||
    p.startsWith('purchaseReturns.') ||
    p === 'reports.purchases.view',
}

export function permisosVisibles(
  permisos: Iterable<string>,
  funciones: readonly FuncionOpcional[],
): string[] {
  const apagadas = FUNCIONES_OPCIONALES.filter((f) => !funciones.includes(f))
  return [...permisos].filter((p) => !apagadas.some((f) => PERMISOS_DE[f](p)))
}

/** Rutas de pantalla de cada funcion, y a donde se va si esta apagada. */
const RUTAS_DE: Record<FuncionOpcional, { bases: string[]; destino: string }> = {
  lotes: { bases: ['/stock/lotes'], destino: '/stock' },
  compras: {
    bases: ['/compras', '/proveedores', '/devoluciones', '/comprobantes/proveedor'],
    destino: '/',
  },
}

/**
 * A donde mandar a quien abre a mano una pantalla de una funcion apagada, o
 * `null` si la ruta se puede ver. Solo pantallas: la API no pasa por aca.
 *
 * Compara por segmento: `/compras` no atrapa `/comprobantes`.
 */
export function rutaDeshabilitada(
  pathname: string,
  funciones: readonly FuncionOpcional[],
): string | null {
  for (const f of FUNCIONES_OPCIONALES) {
    if (funciones.includes(f)) continue
    const { bases, destino } = RUTAS_DE[f]
    if (bases.some((b) => pathname === b || pathname.startsWith(`${b}/`))) return destino
  }
  return null
}
