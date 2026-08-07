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
  /**
   * Cambiar el precio de un producto que ya existe.
   *
   * Separado de `products.update` a proposito: corregir un nombre mal escrito
   * y cambiar cuanto sale un producto no son la misma responsabilidad. Quien
   * repone mercaderia necesita lo primero y no lo segundo.
   *
   * Alcance: solo la EDICION. El alta sigue cubierta por `products.create`,
   * porque dar de alta un producto implica ponerle un precio y no habria
   * forma de cargarlo si no. Queda anotado en docs/PERMISSIONS_MATRIX.md.
   */
  'products.price.update',
  'products.delete',
  'categories.manage',
  // Inventario
  'stock.view',
  /**
   * Emitir movimientos de stock: ajustes, perdidas, roturas, consumo interno.
   *
   * Es el `inventory.adjust` del libro de inventario. Existe desde la Fase 0
   * con este nombre, lo usan las dos rutas de ajuste y figura en la matriz;
   * renombrarlo hubiera tocado siete archivos para dejar el sistema igual.
   *
   * NO se separo en `inventory.loss` e `inventory.breakage`: quien puede
   * emitir un ajuste ya puede sacar unidades del sistema sin venderlas, asi
   * que obligarlo a declarar "perdida" en vez de "ajuste" no le impide nada.
   * Lo que importa es que el tipo quede registrado y auditado, y eso si esta.
   * Ver docs/INVENTORY_LEDGER.md, seccion 10.
   */
  'stock.adjust',
  /**
   * Ver el libro de movimientos.
   *
   * Separado de `stock.view` a proposito: el cajero necesita saber cuanto hay
   * para vender, pero el historial de quien ajusto que es informacion de
   * control, no de mostrador.
   */
  'inventory.movements.view',
  // Caja
  'cash.view',
  'cash.movement.create',
  'cash.count.create',
  /**
   * Turnos de caja. Ver docs/CASH_SHIFT_MODEL.md.
   *
   * `close` es el turno PROPIO. Cerrar el de otro es un permiso aparte:
   * pasa cuando alguien se fue sin cerrar, y es una operacion de encargado.
   *
   * `authorize` cubre una diferencia por encima del umbral de la sucursal.
   * Que un cajero no pueda autorizar su propio faltante es medio punto de
   * todo el mecanismo.
   */
  'cash.shift.open',
  'cash.shift.close',
  'cash.shift.close.other',
  'cash.shift.authorize',
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
  // Abre y cierra SU caja. No la de otro, y no autoriza su propio faltante.
  'cash.shift.open',
  'cash.shift.close',
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
    // El encargado si fija precios: es quien recibe la lista del proveedor.
    'products.price.update',
    'categories.manage',
    'stock.view',
    'stock.adjust',
    'inventory.movements.view',
    'cash.view',
    'cash.movement.create',
    'cash.count.create',
    'cash.shift.open',
    'cash.shift.close',
    'cash.shift.close.other',
    'cash.shift.authorize',
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
    'inventory.movements.view',
  ],

  cajero: PERFIL_CAJA,

  /**
   * Nombre historico del rol de caja en la base actual. Mismo alcance que
   * `cajero`. No se renombra para no tocar datos existentes.
   */
  vendedor: PERFIL_CAJA,

  repositor: ['products.view', 'stock.view', 'stock.adjust', 'inventory.movements.view'],

  /**
   * Compras. Ve el catalogo y los proveedores y da entrada a la mercaderia.
   *
   * No vende y no toca la caja: separar quien compra de quien cobra es el
   * control basico contra el desvio de mercaderia.
   *
   * Sin `products.price.update`: puede cargar un producto nuevo con su
   * precio, pero no retocar el de uno que ya se esta vendiendo. El precio de
   * venta lo decide quien maneja el local.
   */
  compras: [
    'products.view',
    'products.create',
    'products.update',
    'categories.manage',
    'stock.view',
    'stock.adjust',
    'inventory.movements.view',
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
    'inventory.movements.view',
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
