/**
 * A donde entra cada uno. V1 comercial.
 *
 * El cajero no va al Inicio: va a Venta. Su pantalla es el mostrador, y cada
 * pantalla intermedia es un clic antes del primer cliente de la manana. El
 * dueño y el administrador entran al Inicio, que es donde estan los numeros
 * del dia. El encargado tambien: el Inicio ya le muestra solo lo que sus
 * permisos le dejan hacer.
 *
 * Es una funcion pura sobre la sesion --y no una lectura del rol en tres
 * lugares-- para que el login y el Inicio decidan igual y una prueba pueda
 * afirmarlo.
 */

/** Los roles de mostrador. `vendedor` es el nombre historico de `cajero`. */
const ROLES_DE_MOSTRADOR: ReadonlySet<string> = new Set(['cajero', 'vendedor'])

export function destinoDeInicio(session: {
  role: string
  permissions: ReadonlySet<string> | readonly string[]
}): '/' | '/venta' {
  const permisos =
    session.permissions instanceof Set ? session.permissions : new Set(session.permissions)
  if (ROLES_DE_MOSTRADOR.has(session.role) && permisos.has('sales.create')) return '/venta'
  return '/'
}

/**
 * Las acciones grandes del Inicio, en orden, con el permiso que exige cada
 * una. La pantalla dibuja solo las que el usuario puede abrir.
 *
 * "Llegó mercadería" abre por ahora el modulo de compras existente: el flujo
 * rapido se implementa en la tanda siguiente, y mientras tanto el boton ya
 * dice lo que el dueño busca.
 */
export const ACCIONES_DE_INICIO: ReadonlyArray<{
  href: string
  titulo: string
  detalle: string
  permiso: string
  /** La accion principal: la unica que se dibuja en verde. */
  principal?: boolean
}> = [
  {
    href: '/venta',
    titulo: 'Vender',
    detalle: 'Cobrar en el mostrador',
    permiso: 'sales.create',
    principal: true,
  },
  {
    href: '/caja',
    titulo: 'Caja',
    detalle: 'Abrir, cerrar, contar la plata',
    permiso: 'cash.view',
  },
  {
    href: '/consultar-precio',
    titulo: 'Consultar precio',
    detalle: 'Escaneá y mirá el precio',
    permiso: 'products.view',
  },
  {
    href: '/compras',
    titulo: 'Llegó mercadería',
    detalle: 'Cargar lo que trajo el proveedor',
    permiso: 'purchases.view',
  },
  { href: '/clientes', titulo: 'Fiados', detalle: 'Quién debe y cobrar', permiso: 'clients.view' },
  {
    href: '/productos/precios',
    titulo: 'Cambiar precios',
    detalle: 'Actualizar precios de a muchos',
    permiso: 'products.price.update',
  },
]

export function accionesPara(permisos: ReadonlySet<string>) {
  return ACCIONES_DE_INICIO.filter((a) => permisos.has(a.permiso))
}
