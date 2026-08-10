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
  /**
   * Ver cuanto cuesta comprar un producto.
   *
   * No alcanza con esconder la columna en la pantalla: el costo NO SALE de los
   * DTO de quien no tiene este permiso. La diferencia importa porque el costo
   * es la informacion mas sensible del catalogo --con ella cualquiera calcula
   * el margen del negocio-- y una respuesta de la API se lee con las
   * herramientas del navegador sin saber programar.
   *
   * El endpoint que usa la caja NUNCA lo incluye, tenga o no el permiso quien
   * este atendiendo: para cobrar no hace falta saber cuanto costo.
   */
  'products.cost.view',
  /** Cambiar el costo. Exige motivo y deja historial inmutable. */
  'products.cost.update',
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
  //
  // Los reportes se separan por MATERIA y no por pantalla, porque lo que hay
  // que proteger es la informacion y no el menu. `reports.view`, que era uno
  // solo para todo, desaparecio en la Fase 3D: daba lo mismo ver cuantas
  // operaciones hubo que ver el margen del negocio.
  /**
   * Facturacion, operaciones, ticket promedio, anulaciones, por cajero y por
   * medio de pago. Ni un costo, ni un margen.
   */
  'reports.sales.view',
  /**
   * Costo vendido, ganancia bruta, margen y la valorizacion del inventario.
   *
   * Es el permiso mas sensible del sistema: con el se calcula cuanto gana el
   * negocio. Va aparte de `reports.sales.view` a proposito --se puede necesitar
   * saber cuanto se vendio sin saber cuanto se gano-- y acompania a
   * `products.cost.view`, que protege el mismo dato producto por producto.
   */
  'reports.costs.view',
  /** Cantidades, stock bajo, agotados, movimientos por tipo, sin costo. */
  'reports.inventory.view',
  /** Turnos, diferencias de arqueo, ingresos, egresos y retiros. */
  'reports.cash.view',
  /** Total comprado, ordenes, recepciones, por proveedor y diferencias. */
  'reports.purchases.view',
  'audit.view',
  // Administracion
  'users.view',
  'users.manage',
  'branches.view',
  'branches.manage',
  'suppliers.view',
  'suppliers.manage',
  // Compras. Ver docs/PURCHASE_FLOW.md.
  'purchases.view',
  'purchases.create',
  'purchases.update',
  /**
   * Dar entrada a la mercaderia.
   *
   * NO lo tiene el repositor, y es la decision menos obvia del reparto.
   * Recibir cambia el costo del producto, que es informacion financiera; el
   * repositor no tiene `products.cost.view` justamente para no verla. Darle
   * este permiso le dejaria fijarla sin poder leerla, que es lo peor de los
   * dos mundos. El dia que el almacen quiera que descargue el camion, lo que
   * hace falta es una recepcion "a ciegas" que no toque el costo, y eso es una
   * funcion nueva y no un permiso mas.
   *
   * Recibir a un costo DISTINTO del pedido exige ademas
   * `products.cost.update`. No se creo un `purchases.cost.override` para eso:
   * quien tiene `products.cost.update` puede cambiar el costo desde la ficha
   * del producto de todos modos, asi que un tercer permiso que solo sirve
   * acompanado del segundo no impide nada. La separacion util --recibir sin
   * poder tocar el costo-- ya se consigue con los dos que existen.
   */
  'purchases.receive',
  'purchases.cancel',
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
    // Y ve y carga costos: es quien decide a cuanto se vende, y eso no se
    // puede decidir sin saber a cuanto se compro.
    'products.cost.view',
    'products.cost.update',
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
    // El encargado ve todo: es quien responde por el resultado del local.
    'reports.sales.view',
    'reports.costs.view',
    'reports.inventory.view',
    'reports.cash.view',
    'reports.purchases.view',
    // Administra proveedores y compra: es quien recibe la lista de precios y
    // quien decide a quien comprarle. Ver docs/SUPPLIER_MODEL.md.
    'suppliers.view',
    'suppliers.manage',
    'purchases.view',
    'purchases.create',
    'purchases.update',
    'purchases.receive',
    'purchases.cancel',
    'branches.view',
  ],

  /**
   * Supervisor de turno.
   *
   * Igual que el cajero, mas anular ventas y hacer movimientos de caja. Es el
   * escalon que hoy falta: sin el, cada anulacion necesita al administrador.
   *
   * SIN `products.cost.view`, y es deliberado. El supervisor esta en el
   * mostrador: su trabajo es que el turno cierre, no fijar precios. El costo
   * es la informacion con la que se calcula el margen del negocio entero, y no
   * hace falta para nada de lo que el supervisor hace. Se puede agregar el dia
   * que se le den responsabilidades de compra.
   */
  supervisor: [
    ...PERFIL_CAJA,
    'sales.cancel',
    'cash.movement.create',
    'stock.adjust',
    'inventory.movements.view',
    // Lo que necesita para que el turno cierre: cuanto se vendio, como esta la
    // caja y que falta reponer. SIN `reports.costs.view`, por el mismo motivo
    // por el que no tiene `products.cost.view`: el margen del negocio no hace
    // falta para nada de lo que hace.
    'reports.sales.view',
    'reports.cash.view',
    'reports.inventory.view',
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
    // El costo es su materia prima: es quien negocia con el proveedor y quien
    // carga la factura. Sin esto no podria hacer su trabajo.
    'products.cost.view',
    'products.cost.update',
    'categories.manage',
    'stock.view',
    'stock.adjust',
    'inventory.movements.view',
    'suppliers.view',
    'suppliers.manage',
    'purchases.view',
    'purchases.create',
    'purchases.update',
    'purchases.receive',
    'purchases.cancel',
    // Compras, costos e inventario. Sin caja --no cobra-- y sin el reporte de
    // ventas, que es informacion de mostrador y no de compra.
    'reports.purchases.view',
    'reports.costs.view',
    'reports.inventory.view',
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
    // Lectura amplia, cero escritura: es el unico rol que ve todos los
    // reportes sin poder cambiar nada de lo que mira.
    'reports.sales.view',
    'reports.costs.view',
    'reports.inventory.view',
    'reports.cash.view',
    'reports.purchases.view',
    'audit.view',
    'users.view',
    'branches.view',
    'suppliers.view',
    'purchases.view',
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
