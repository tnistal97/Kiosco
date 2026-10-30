import type { Permission } from '@/server/authz/permissions'
import type { FuncionOpcional } from '@/lib/funciones'

/**
 * Mapa de navegacion.
 *
 * Una sola definicion para la barra lateral, el cajon de movil y las pruebas.
 * Cada entrada declara que permiso hace falta para verla, y la barra la
 * esconde si el usuario no lo tiene. No es una defensa --la defensa esta en
 * el servidor-- sino honestidad: mostrarle a un repositor un enlace a
 * Auditoria para que descubra a los golpes que no puede entrar es una forma
 * lenta de decirle que no.
 *
 * No hay entradas para modulos que todavia no existen. Clientes y cuenta
 * corriente llegan en fases siguientes; hasta entonces no hay boton.
 */

export interface EntradaNav {
  href: string
  label: string
  /** Permiso necesario. Sin el, la entrada no se muestra. */
  permission?: Permission
  /**
   * Basta con UNO de estos. Para pantallas que agrupan varias materias, como
   * Reportes: quien solo pueda ver compras tiene que poder entrar igual.
   *
   * No reemplaza a `permission`: la mayoria de las entradas protegen una sola
   * cosa y una lista de un elemento se lee peor.
   */
  anyOf?: Permission[]
  /** Coincide tambien con las subrutas, p. ej. /productos/12. */
  matchPrefix?: boolean
  /**
   * Funcion opcional de la instalacion. Sin ella habilitada, la entrada no se
   * muestra (ver `@/lib/funciones`).
   */
  funcion?: FuncionOpcional
}

export interface GrupoNav {
  /** Sin titulo, el grupo se dibuja suelto, separado por una linea. */
  title?: string
  items: EntradaNav[]
}

/*
 * UX V5 — almacen.
 *
 * Cinco tareas a la vista, con el nombre que les da quien atiende: Vender,
 * Caja, Productos, Stock, Inventario. Debajo, separado, lo que se usa de vez
 * en cuando: Clientes, Reportes, Configuracion. Y Usuarios, solo para quien
 * administra el personal del local.
 *
 * Lo que salio del menu NO se borro:
 *  - Movimientos se abre desde Stock ("Ver movimientos").
 *  - Ventas se abre desde Caja y desde Inicio.
 *  - Sucursales y el historial de cambios, desde Configuracion.
 *  - Lotes y Compras (ordenes, proveedores, devoluciones) son funciones
 *    opcionales: aparecen solo si la instalacion las habilita.
 */
export const NAVEGACION: GrupoNav[] = [
  {
    items: [
      { href: '/', label: 'Inicio' },
      { href: '/venta', label: 'Vender', permission: 'sales.create' },
      { href: '/caja', label: 'Caja', permission: 'cash.view', matchPrefix: true },
      { href: '/productos', label: 'Productos', permission: 'products.view', matchPrefix: true },
      { href: '/stock', label: 'Stock', permission: 'stock.view', matchPrefix: true },
      {
        href: '/inventarios',
        label: 'Inventario',
        permission: 'inventoryCounts.view',
        matchPrefix: true,
      },
    ],
  },
  {
    title: 'Compras',
    items: [
      {
        href: '/compras',
        label: 'Órdenes',
        permission: 'purchases.view',
        matchPrefix: true,
        funcion: 'compras',
      },
      {
        href: '/proveedores',
        label: 'Proveedores',
        permission: 'suppliers.view',
        matchPrefix: true,
        funcion: 'compras',
      },
      // Las devoluciones se ARMAN desde el detalle de una entrega --de ahi
      // salen el costo y el tope-- pero se LISTAN por su cuenta.
      {
        href: '/devoluciones',
        label: 'Devoluciones',
        permission: 'purchaseReturns.view',
        matchPrefix: true,
        funcion: 'compras',
      },
    ],
  },
  {
    items: [
      // `clients.view` y no `accounts.view`: es el permiso que gobierna la
      // pantalla a la que lleva el enlace. Un enlace visible que responde 403
      // es peor que no tenerlo.
      { href: '/clientes', label: 'Clientes', permission: 'clients.view', matchPrefix: true },
      // Un solo enlace para todas las materias. Cada seccion de la pantalla se
      // dibuja o no segun su propio permiso.
      {
        href: '/reportes',
        label: 'Reportes',
        anyOf: [
          'reports.sales.view',
          'reports.costs.view',
          'reports.inventory.view',
          'reports.cash.view',
          'reports.purchases.view',
        ],
      },
      // `users.manage` y no `users.view`: quien solo mira la lista (el auditor)
      // la abre desde Configuracion, como antes.
      { href: '/usuarios', label: 'Usuarios', permission: 'users.manage' },
      { href: '/configuracion', label: 'Configuración', matchPrefix: true },
    ],
  },
]

/**
 * Pantallas que no estan en el menu pero tienen nombre propio en la cabecera.
 * Se consultan ANTES que el menu: /stock/movimientos coincide tambien con la
 * entrada Stock, y la cabecera tiene que decir donde se esta.
 */
const TITULOS_SUELTOS: { href: string; titulo: string }[] = [
  { href: '/stock/movimientos', titulo: 'Movimientos de stock' },
  { href: '/stock/lotes', titulo: 'Lotes' },
  { href: '/ventas', titulo: 'Ventas' },
  { href: '/usuarios', titulo: 'Usuarios' },
  { href: '/sucursales', titulo: 'Sucursales' },
  { href: '/auditoria', titulo: 'Historial de cambios' },
  { href: '/comprobantes', titulo: 'Comprobante' },
]

/**
 * Grupos con al menos una entrada visible para estos permisos y estas
 * funciones opcionales.
 */
export function navegacionPara(
  permisos: ReadonlySet<string>,
  funciones: ReadonlySet<FuncionOpcional> = new Set(),
): GrupoNav[] {
  return NAVEGACION.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        (!i.permission || permisos.has(i.permission)) &&
        (!i.anyOf || i.anyOf.some((p) => permisos.has(p))) &&
        (!i.funcion || funciones.has(i.funcion)),
    ),
  })).filter((g) => g.items.length > 0)
}

/** La entrada activa segun la ruta actual. */
export function esActiva(entrada: EntradaNav, pathname: string): boolean {
  if (entrada.href === '/') return pathname === '/'
  if (entrada.matchPrefix) {
    return pathname === entrada.href || pathname.startsWith(`${entrada.href}/`)
  }
  return pathname === entrada.href
}

/** Titulo de la pantalla, para la cabecera. */
export function tituloDe(pathname: string): string {
  for (const suelto of TITULOS_SUELTOS) {
    if (pathname === suelto.href || pathname.startsWith(`${suelto.href}/`)) return suelto.titulo
  }
  for (const grupo of NAVEGACION) {
    for (const item of grupo.items) {
      if (esActiva(item, pathname)) return item.label
    }
  }
  return 'Almacén'
}
