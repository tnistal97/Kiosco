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
  /**
   * Arranca plegado, con el titulo como boton. Se despliega solo si la ruta
   * actual esta adentro. Para el "Más" de la V1 comercial.
   */
  plegable?: boolean
  items: EntradaNav[]
}

export const NAVEGACION: GrupoNav[] = [
  {
    items: [{ href: '/', label: 'Inicio' }],
  },
  /*
    V1 comercial. Cuatro grupos con el nombre de lo que el dueño hace --vender,
    el negocio, controlar, el sistema-- y un "Más" plegado con lo que se abre
    una vez por semana. Dieciocho entradas a la vista eran un menu de sistema;
    once son un menu de almacen. Ninguna pantalla desaparece: lo que sale de
    la vista sigue en "Más", y ahi tambien esta lo que la cabecera necesita
    para titular cada ruta.
  */
  {
    title: 'Vender',
    items: [
      { href: '/venta', label: 'Venta', permission: 'sales.create' },
      { href: '/caja', label: 'Caja', permission: 'cash.view', matchPrefix: true },
      { href: '/consultar-precio', label: 'Consultar precio', permission: 'products.view' },
    ],
  },
  {
    title: 'Negocio',
    items: [
      { href: '/productos', label: 'Productos', permission: 'products.view', matchPrefix: true },
      // Abre por ahora el modulo de compras existente. El flujo rapido de
      // recepcion es de la tanda siguiente; el nombre ya es el que el dueño
      // busca.
      {
        href: '/compras',
        label: 'Llegó mercadería',
        permission: 'purchases.view',
        matchPrefix: true,
      },
      {
        href: '/proveedores',
        label: 'Proveedores',
        permission: 'suppliers.view',
        matchPrefix: true,
      },
      // `clients.view` y no `accounts.view` porque ese es el permiso que
      // gobierna la pantalla a la que lleva el enlace: un enlace visible que
      // responde 403 es peor que no tenerlo.
      {
        href: '/clientes',
        label: 'Clientes y fiado',
        permission: 'clients.view',
        matchPrefix: true,
      },
    ],
  },
  {
    title: 'Control',
    items: [
      { href: '/stock', label: 'Stock', permission: 'stock.view' },
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
    ],
  },
  {
    title: 'Sistema',
    items: [
      { href: '/usuarios', label: 'Usuarios', permission: 'users.view' },
      { href: '/configuracion', label: 'Configuración' },
    ],
  },
  {
    title: 'Más',
    plegable: true,
    items: [
      {
        href: '/ventas',
        label: 'Historial de ventas',
        permission: 'sales.view',
        matchPrefix: true,
      },
      {
        href: '/stock/movimientos',
        label: 'Historial de stock',
        permission: 'inventory.movements.view',
      },
      {
        href: '/inventarios',
        label: 'Recuento',
        permission: 'inventoryCounts.view',
        matchPrefix: true,
      },
      // "Cuando corresponda": para quien pueda ver partidas. Un almacen sin
      // vencimientos no tiene el permiso repartido y no ve la entrada.
      { href: '/stock/lotes', label: 'Vencimientos', permission: 'lots.view', matchPrefix: true },
      { href: '/auditoria', label: 'Historial de cambios', permission: 'audit.view' },
      {
        href: '/devoluciones',
        label: 'Devoluciones a proveedores',
        permission: 'purchaseReturns.view',
        matchPrefix: true,
      },
      // "Cuando haya mas de una": hoy se decide por permiso. El navegador no
      // sabe cuantas sucursales hay, y la pantalla lo dice al entrar.
      { href: '/sucursales', label: 'Sucursales', permission: 'branches.view' },
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
