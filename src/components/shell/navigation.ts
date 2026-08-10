import type { Permission } from '@/server/authz/permissions'

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
}

export interface GrupoNav {
  /** Sin titulo, el grupo se dibuja suelto arriba de todo. */
  title?: string
  items: EntradaNav[]
}

export const NAVEGACION: GrupoNav[] = [
  {
    items: [{ href: '/', label: 'Inicio' }],
  },
  {
    title: 'Operación',
    items: [
      { href: '/venta', label: 'Venta', permission: 'sales.create' },
      { href: '/caja', label: 'Caja', permission: 'cash.view' },
      { href: '/ventas', label: 'Ventas', permission: 'sales.view', matchPrefix: true },
      // En Operacion y no en Control: el cajero busca a Juan para cobrarle, y
      // eso pasa en el mostrador. `clients.view` y no `accounts.view` porque
      // ese es el permiso que gobierna la pantalla a la que lleva el enlace: un
      // enlace visible que responde 403 es peor que no tenerlo, y es
      // exactamente el error que la Fase 3D encontro en "Ventas".
      { href: '/clientes', label: 'Clientes', permission: 'clients.view', matchPrefix: true },
    ],
  },
  {
    title: 'Inventario',
    items: [
      { href: '/productos', label: 'Productos', permission: 'products.view', matchPrefix: true },
      { href: '/stock', label: 'Stock', permission: 'stock.view' },
      {
        href: '/stock/movimientos',
        label: 'Movimientos',
        permission: 'inventory.movements.view',
      },
    ],
  },
  {
    title: 'Compras',
    items: [
      { href: '/compras', label: 'Órdenes', permission: 'purchases.view', matchPrefix: true },
      {
        href: '/proveedores',
        label: 'Proveedores',
        permission: 'suppliers.view',
        matchPrefix: true,
      },
    ],
  },
  {
    title: 'Control',
    items: [
      // Un solo enlace para las seis materias. Cada seccion de la pantalla se
      // dibuja o no segun su propio permiso, asi que quien tenga uno solo
      // --el encargado de compras, por ejemplo-- entra y ve lo suyo.
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
      { href: '/auditoria', label: 'Auditoría', permission: 'audit.view' },
    ],
  },
  {
    title: 'Administración',
    items: [
      { href: '/usuarios', label: 'Usuarios', permission: 'users.view' },
      { href: '/sucursales', label: 'Sucursales', permission: 'branches.view' },
      { href: '/configuracion', label: 'Configuración' },
    ],
  },
]

/** Grupos con al menos una entrada visible para estos permisos. */
export function navegacionPara(permisos: ReadonlySet<string>): GrupoNav[] {
  return NAVEGACION.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) =>
        (!i.permission || permisos.has(i.permission)) &&
        (!i.anyOf || i.anyOf.some((p) => permisos.has(p))),
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
  for (const grupo of NAVEGACION) {
    for (const item of grupo.items) {
      if (esActiva(item, pathname)) return item.label
    }
  }
  return 'Almacén'
}
