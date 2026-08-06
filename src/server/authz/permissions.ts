/**
 * Catalogo de permisos explicitos.
 *
 * Las rutas NUNCA preguntan `role === 'admin'`. Preguntan por un permiso
 * concreto. El nombre del rol solo sirve para resolver que permisos tiene,
 * en un unico lugar: este archivo.
 *
 * Por que importa: hoy el sistema tiene dos roles ('admin', 'vendedor') y la
 * autorizacion esta dispersa como comparaciones de cadenas. Cuando el almacen
 * necesite un repositor o un encargado de turno, agregar el rol no deberia
 * obligar a revisar 22 archivos.
 *
 * Fase siguiente: mover ROLE_PRESETS a tablas `Permission` y `RolePermission`
 * para poder editar permisos desde la pantalla de usuarios. Las rutas no
 * cambian: siguen llamando a requirePermission con el mismo string.
 */

export const PERMISSIONS = [
  // Venta
  'sales.create',
  'sales.view',
  'sales.cancel',
  // Catalogo
  'products.view',
  'products.create',
  'products.update',
  'products.delete',
  'categories.manage',
  // Inventario
  'stock.view',
  'stock.adjust',
  // Caja
  'cash.view',
  'cash.movement.create',
  'cash.count.create',
  // Informacion administrativa
  'reports.view',
  'audit.view',
  // Administracion
  'users.view',
  'users.manage',
  'branches.view',
  'branches.manage',
  'suppliers.view',
  'suppliers.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * Permisos por rol.
 *
 * Un rol que no figure aca no recibe NINGUN permiso. Es intencional: es
 * preferible que un rol nuevo no pueda hacer nada y haya que darle permisos,
 * a que herede todo por descuido.
 */
const PERFIL_CAJA: readonly Permission[] = [
  'sales.create',
  'sales.view',
  'products.view',
  'stock.view',
  'cash.view',
  'cash.count.create',
]

const ROLE_PRESETS: Record<string, readonly Permission[]> = {
  /**
   * Duenio del negocio. Hoy identico a `admin`.
   *
   * Existe separado porque cuando haya varias sucursales van a divergir:
   * `admin` administra la suya, `duenio` las ve todas. Mientras no exista esa
   * distincion, tener dos nombres para lo mismo es preferible a tener que
   * migrar los usuarios despues.
   */
  duenio: [...PERMISSIONS],

  admin: [...PERMISSIONS],

  encargado: [
    'sales.create',
    'sales.view',
    'sales.cancel',
    'products.view',
    'products.create',
    'products.update',
    'categories.manage',
    'stock.view',
    'stock.adjust',
    'cash.view',
    'cash.movement.create',
    'cash.count.create',
    'reports.view',
    'suppliers.view',
    'branches.view',
  ],

  /**
   * Supervisor de turno.
   *
   * Igual que el cajero, mas anular ventas y hacer movimientos de caja. Es el
   * escalon que hoy falta: sin el, cada anulacion necesita al administrador.
   */
  supervisor: [
    ...PERFIL_CAJA,
    'sales.cancel',
    'cash.movement.create',
    'reports.view',
    'stock.adjust',
  ],

  cajero: PERFIL_CAJA,

  /**
   * Nombre historico del rol de caja en la base actual. Mismo alcance que
   * `cajero`. No se renombra para no tocar datos existentes.
   */
  vendedor: PERFIL_CAJA,

  repositor: ['products.view', 'stock.view', 'stock.adjust'],

  /**
   * Compras. Ve el catalogo y los proveedores y da entrada a la mercaderia.
   *
   * No vende y no toca la caja: separar quien compra de quien cobra es el
   * control basico contra el desvio de mercaderia.
   */
  compras: [
    'products.view',
    'products.create',
    'products.update',
    'categories.manage',
    'stock.view',
    'stock.adjust',
    'suppliers.view',
    'suppliers.manage',
    'reports.view',
  ],

  /**
   * Auditor. Solo lectura, incluida la bitacora.
   *
   * Ni un solo permiso de escritura, a proposito: quien revisa no debe poder
   * modificar lo que revisa.
   */
  auditor: [
    'sales.view',
    'products.view',
    'stock.view',
    'cash.view',
    'reports.view',
    'audit.view',
    'users.view',
    'branches.view',
    'suppliers.view',
  ],
}

const EMPTY: ReadonlySet<Permission> = new Set()

const RESOLVED: Record<string, ReadonlySet<Permission>> = Object.fromEntries(
  Object.entries(ROLE_PRESETS).map(([role, perms]) => [role, new Set(perms)]),
)

/** Permisos de un rol. Rol desconocido → conjunto vacio (denegar por defecto). */
export function permissionsForRole(roleName: string): ReadonlySet<Permission> {
  return RESOLVED[roleName] ?? EMPTY
}

/** Roles reconocidos. Util para la pantalla de usuarios y para los tests. */
export function knownRoles(): string[] {
  return Object.keys(ROLE_PRESETS)
}
