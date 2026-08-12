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
  /**
   * Dar de alta un producto DESDE LA CAJA, con el formulario minimo.
   *
   * Aparte de `products.create` y no un alias suyo. La pregunta que lo decidio
   * fue si hacia falta un permiso nuevo cuando ya existe uno de alta, y la
   * respuesta es que los dos no reparten el mismo poder:
   *
   *   `products.create`            el formulario entero: costo, proveedor,
   *                                varios codigos, unidad de compra, minimo.
   *   `products.quickCreate`       seis campos y nada mas, en el mostrador,
   *                                con el codigo que acaba de pasar el lector.
   *
   * Que sea MAS CHICO es lo que lo hace util: se le puede dar al supervisor de
   * turno --que tiene que poder destrabar una venta a las nueve de la noche--
   * sin darle el catalogo entero. Al reves tambien vale: quien administra el
   * catalogo desde la oficina no necesita este.
   *
   * NO lo tiene el cajero por omision. Es la unica decision del reparto que el
   * pedido fijo de antemano, y coincide con el criterio del resto del sistema:
   * quien cobra no define que se vende ni a cuanto.
   *
   * Sobre el precio: quien puede crear fija el precio INICIAL, igual que con
   * `products.create` desde la Fase 2.4 --un producto sin precio no se puede
   * vender, que es justamente lo que se viene a destrabar--. Cambiar el precio
   * de un producto que YA EXISTE sigue necesitando `products.price.update`.
   * Ver docs/POS_QUICK_PRODUCT_CREATE.md.
   */
  'products.quickCreate',
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
  /**
   * Cartera de clientes: cuanto se debe, quienes deben y cuanto se cobro.
   *
   * Aparte de `accounts.view`, que es la cuenta de UNA persona. Este es el
   * agregado del negocio, y son dos preguntas distintas: el cajero necesita
   * saber cuanto debe Juan para cobrarle; no necesita ver la cartera entera ni
   * el ranking de deudores. Ver el objetivo 31.
   */
  'reports.clients.view',
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
  // Clientes y cuenta corriente. Ver docs/CREDIT_POLICY.md.
  //
  // Separados en dos ejes que no son el mismo: QUIEN es el cliente (la ficha)
  // y QUE le pasa a su plata (la cuenta). Un cajero necesita poder buscar a
  // Juan y cobrarle; no necesita poder cambiarle el limite de credito.
  'clients.view',
  /** Alta, edicion y baja de la ficha. Incluye limite y fiado habilitado. */
  'clients.manage',
  /** Ver el saldo y el extracto de la cuenta corriente. */
  'accounts.view',
  /**
   * Fiar: registrar una venta con una parte a cuenta.
   *
   * Es del mostrador y por eso lo tiene el cajero: fiarle a un cliente conocido
   * es una operacion normal de un almacen de barrio, no una excepcion
   * administrativa. Lo que el cajero NO puede es fiar por encima del limite ni
   * corregir un saldo a mano, que son los dos permisos de abajo.
   */
  'accounts.charge',
  /** Cobrar lo que el cliente debe. Tambien del mostrador. */
  'accounts.payment',
  /**
   * Corregir un saldo con un ajuste manual.
   *
   * NO lo tiene el cajero, y es la separacion que da sentido a todo el modulo:
   * quien cobra no puede bajarle la deuda a nadie sin que se note. Con este
   * permiso se puede escribir un movimiento que no responde a ninguna venta ni
   * a ningun cobro --por eso exige motivo obligatorio y queda auditado--.
   */
  'accounts.adjust',
  /**
   * Autorizar una venta a cuenta por encima del limite de credito.
   *
   * Existe, y no como una casilla escondida. El caso es real: el cliente de
   * siempre esta $2.000 por encima del limite y el duenio dice "dale igual".
   * Sin un mecanismo, eso termina siendo un limite que nadie configura porque
   * estorba, y un limite que nadie configura no protege nada.
   *
   * Cuando se usa quedan las cinco cosas: quien autorizo (en la fila del libro,
   * no solo en la bitacora), el motivo, el importe, el saldo anterior y el
   * resultante.
   */
  'accounts.overrideLimit',
  // Cuentas por pagar a proveedores. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
  //
  // Cinco permisos, y el prefijo es `supplierAccounts.` --no `accounts.`-- a
  // proposito: `accounts.view` ya significa "el saldo de UN CLIENTE" y
  // reutilizarlo aca haria que darle a alguien la cartera de deudores le diera
  // de regalo la deuda con los proveedores, que es informacion de otra materia
  // y de otro rol. Compras negocia con proveedores; caja atiende clientes.
  //
  // La simetria con el catalogo existente se mantiene en la forma
  // (`view` / `payment` / `adjust`) para que la matriz se lea de corrido.
  /** Ver el saldo, el extracto y las deudas abiertas de un proveedor. */
  'supplierAccounts.view',
  /** Registrar un pago y elegir a que obligaciones se imputa. */
  'supplierAccounts.payment',
  /**
   * Registrar una nota de credito del proveedor.
   *
   * Aparte de `payment` porque no es lo mismo: un pago entrega plata y deja su
   * rastro en la caja o en el banco; una nota de credito baja la deuda SIN que
   * salga nada, apoyada solo en un papel que trajo el proveedor. Quien puede
   * hacer la segunda puede reducir lo que debemos sin mover un peso.
   */
  'supplierAccounts.credit',
  /**
   * Corregir un saldo con un ajuste manual.
   *
   * El equivalente de `accounts.adjust` del otro lado del mostrador, y la misma
   * separacion: con este permiso se escribe un movimiento que no responde a
   * ninguna entrega ni a ningun pago. Por eso exige motivo y queda auditado.
   * Es tambien el camino para cargar la deuda anterior a esta fase, que la
   * migracion NO inventa.
   */
  'supplierAccounts.adjust',
  /**
   * Pagarle a un proveedor MAS de lo que se le debe.
   *
   * Existe como permiso propio --y no solo como una confirmacion, que es lo que
   * alcanza del lado del cliente-- porque los dos casos no son simetricos. Que
   * un cliente pague de mas es un hecho consumado: la plata ya esta sobre el
   * mostrador y rechazarla seria absurdo. Que nosotros paguemos de mas es una
   * DECISION, y una que deja plata en manos de un tercero.
   *
   * Cuando se usa quedan las cinco cosas, igual que en el override de credito:
   * quien autorizo (en la fila del libro), el importe, el saldo anterior, el
   * resultante y el comprobante.
   */
  'supplierAccounts.overpay',
  /**
   * Aplicar un pago ya registrado a obligaciones concretas. Fase 4C.
   *
   * Es el permiso del ANTICIPO: la plata se entrego en marzo, la mercaderia
   * llego en agosto, y esto es decidir que ese anticipo cancela esta entrega.
   *
   * Aparte de `payment` porque no es lo mismo, aunque lo parezca. Pagar entrega
   * dinero y deja rastro en la caja o en el banco; imputar no mueve un peso: solo
   * cambia QUE ENTREGA figura como saldada. Quien puede imputar puede hacer que
   * una entrega vieja aparezca pagada consumiendo un anticipo destinado a otra
   * compra, y eso es una decision administrativa, no de mostrador.
   *
   * NO hace falta para imputar al pagar --el reparto de un pago nuevo va con
   * `payment`, porque es la misma operacion-- sino para la imputacion DIFERIDA,
   * que ocurre despues y sobre plata que ya se entrego.
   */
  'supplierAccounts.allocate',
  // Devoluciones a proveedor. Ver docs/PURCHASE_RETURN_FLOW.md.
  //
  // Tres permisos y no uno, porque una devolucion tiene dos mitades que no
  // siempre hace la misma persona: preparar el papel --que producto vuelve y
  // cuanto-- y confirmarlo, que es cuando la mercaderia sale del deposito y el
  // proveedor recibe un credito.
  /** Ver las devoluciones y lo que se puede devolver de una entrega. */
  'purchaseReturns.view',
  /** Armar el borrador: elegir renglones y cantidades. No mueve nada todavia. */
  'purchaseReturns.create',
  /**
   * Confirmar: sacar la mercaderia y emitir el credito.
   *
   * Es el permiso que importa de los tres. Un borrador es un papel; confirmar
   * baja el stock y baja lo que le debemos al proveedor SIN que salga plata, que
   * es exactamente el poder que `supplierAccounts.credit` protege del otro lado.
   *
   * La diferencia con la nota de credito --y el motivo de que compras SI tenga
   * este y NO aquel-- es que aca hay mercaderia detras: el movimiento de stock
   * queda en el libro de inventario, se reconcilia contra la devolucion y
   * aparece en el recuento del deposito. Una nota de credito no deja mas rastro
   * que el papel que alguien dice haber recibido.
   */
  'purchaseReturns.confirm',
  // Lotes y vencimientos. Ver docs/LOT_TRACKING_DESIGN.md.
  /**
   * Ver las partidas, su stock y sus vencimientos.
   *
   * Aparte de `stock.view` y NO incluido en el perfil de caja. Son dos preguntas
   * distintas: el cajero necesita saber CUANTO hay para poder vender --y eso lo
   * sigue contestando `BranchStock`, sin este permiso-- mientras que de que
   * partida es cada unidad y cuando vence es informacion de deposito.
   *
   * La caja igual no vende vencido: esa comprobacion la hace el servidor con o
   * sin este permiso.
   */
  'lots.view',
  /**
   * Crear partidas, corregir su vencimiento, atribuirles stock existente y
   * cambiar la politica de rastreo de un producto.
   *
   * Las cuatro cosas juntas y no cuatro permisos, porque son la misma decision
   * mirada en distintos momentos: quien puede decidir que un producto se sigue
   * por lote es quien va a cargar sus partidas. Partirlo daria roles que pueden
   * exigir lotes y no crearlos, que es un producto que no se puede recibir.
   *
   * El CODIGO de una partida con historial no lo cambia nadie: eso no es un
   * permiso, es un disparador en la base.
   *
   * Incluye ENDURECER la politica --NONE -> OPTIONAL -> REQUIRED-- pero ya no
   * aflojarla: eso se separo en `lots.tracking.relax`.
   */
  'lots.manage',
  /**
   * AFLOJAR el rastreo de un producto: bajar de REQUIRED a OPTIONAL o a NONE,
   * en lote o en vencimiento.
   *
   * Se separo de `manage` en la Fase 5A, y la separacion es por DIRECCION, no
   * por operacion. El argumento original de juntarlas sigue siendo cierto en un
   * sentido: quien exige lotes tiene que poder crearlos, o queda un producto
   * que no se puede recibir. Pero no es simetrico. Endurecer es una decision
   * operativa que se comprueba sola --el sistema exige atribuir el stock antes
   * de dejar activar REQUIRED-- mientras que aflojar APAGA UN CONTROL, y lo
   * apaga hacia atras: desde ese momento el producto acepta unidades sin
   * partida, y lo que ya estaba trazado deja de exigirse.
   *
   * La pregunta concreta que lo motivo: compras necesita cargar la partida que
   * llego para poder recibir; NO necesita poder decidir que ese producto deje
   * de seguirse. Con este permiso aparte, compras conserva todo lo que hacia y
   * pierde exactamente lo que no debia poder hacer.
   *
   * "Queda auditado" no alcanzaba como unica proteccion: la bitacora dice quien
   * apago el control, no lo impide.
   */
  'lots.tracking.relax',
  /**
   * Elegir el lote A MANO donde el sistema elegiria por FEFO.
   *
   * Separado de `manage` porque no es administrar el catalogo de partidas: es
   * pasar por encima de la politica de rotacion en una operacion concreta. Es lo
   * que permite corregir cuando lo que se llevaron no era del lote que el
   * sistema descontó. Ver docs/FEFO_POLICY.md.
   *
   * NO esta en el flujo normal de la caja: sin este permiso el POS no muestra la
   * eleccion, y con el la muestra solo para productos con lotes.
   */
  'lots.adjust',
  // Inventario fisico. Ver docs/PHYSICAL_INVENTORY.md.
  //
  // CINCO permisos, y no es exceso: un inventario tiene cuatro momentos que casi
  // nunca hace la misma persona --armarlo, contar, revisar las diferencias y
  // aplicarlas-- y el sentido entero del mecanismo es que quien cuenta no sea
  // quien decide que la diferencia se aplique.
  'inventoryCounts.view',
  /** Armar la sesion: alcance, conteo a ciegas, umbral de segundo conteo. */
  'inventoryCounts.create',
  /** Cargar conteos. Es el permiso del operario que recorre el deposito. */
  'inventoryCounts.count',
  /** Cerrar el conteo y mirar las diferencias antes de que existan. */
  'inventoryCounts.review',
  /**
   * Aplicar: convertir las diferencias en movimientos de stock.
   *
   * Es el permiso que importa de los cinco. Aplicar mueve el inventario sin que
   * haya entrado ni salido mercaderia, que es exactamente el poder que
   * `stock.adjust` protege producto por producto --acá son cientos de una vez--.
   *
   * Por eso NO lo tiene quien cuenta: si contar y aplicar fueran el mismo
   * permiso, cualquiera podria hacer desaparecer mercaderia escribiendo un
   * numero mas chico y aplicandolo.
   */
  'inventoryCounts.apply',
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
  // Fiar y cobrar son operaciones de mostrador. Ajustar un saldo a mano y
  // pasarse del limite, no: esos dos quedan afuera a proposito, y esa es la
  // separacion que hace que el modulo signifique algo. Quien cobra no puede
  // bajarle la deuda a nadie sin que se note.
  'clients.view',
  'accounts.view',
  'accounts.charge',
  'accounts.payment',
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
    'products.quickCreate',
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
    'reports.clients.view',
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
    // La cuenta corriente entera, incluido el ajuste y el override: es quien
    // responde por el resultado del local, y por lo tanto por lo que se fia.
    'clients.view',
    'clients.manage',
    'accounts.view',
    'accounts.charge',
    'accounts.payment',
    'accounts.adjust',
    'accounts.overrideLimit',
    // Cuentas por pagar completas, incluido el sobrepago: es quien responde por
    // el resultado del local, y por lo tanto por lo que se le debe a cada
    // proveedor.
    'supplierAccounts.view',
    'supplierAccounts.payment',
    'supplierAccounts.credit',
    'supplierAccounts.adjust',
    'supplierAccounts.overpay',
    'supplierAccounts.allocate',
    // Devoluciones enteras: es quien discute con el proveedor cuando algo llega
    // roto, y quien responde por el credito que eso genera.
    'purchaseReturns.view',
    'purchaseReturns.create',
    'purchaseReturns.confirm',
    // Lotes e inventario fisico, todo: es quien responde por el deposito.
    // Incluido aflojar el rastreo: si un producto deja de necesitar lote, la
    // decision es suya. Es el escalon que compras ya no tiene.
    'lots.view',
    'lots.manage',
    'lots.tracking.relax',
    'lots.adjust',
    'inventoryCounts.view',
    'inventoryCounts.create',
    'inventoryCounts.count',
    'inventoryCounts.review',
    'inventoryCounts.apply',
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
    /**
     * Alta rapida desde la caja, y SOLO la rapida: sin `products.create`.
     *
     * Es el caso que motiva todo el permiso. Cuando el cajero pasa por el lector
     * algo que no esta en el catalogo, quien esta a mano en el mostrador es el
     * supervisor; si el escalon mas bajo que puede resolverlo es el encargado,
     * el callejon sin salida no se cierra, se corre un piso mas arriba y a las
     * nueve de la noche sigue sin haber nadie.
     *
     * Lo que suma sobre lo que ya podia: fijar el precio inicial de un producto
     * que no existia. NO puede tocar el de uno que si existe --eso es
     * `products.price.update`, que no tiene-- ni cargar costo --no tiene
     * `products.cost.update`, asi que el servidor le rechaza el campo--. Declarar
     * stock inicial no le agrega nada: ya podia con `stock.adjust`.
     */
    'products.quickCreate',
    // Lo que necesita para que el turno cierre: cuanto se vendio, como esta la
    // caja y que falta reponer. SIN `reports.costs.view`, por el mismo motivo
    // por el que no tiene `products.cost.view`: el margen del negocio no hace
    // falta para nada de lo que hace.
    'reports.sales.view',
    'reports.cash.view',
    'reports.inventory.view',
    // La cartera si: el supervisor cierra el turno y necesita saber cuanto se
    // fio y cuanto se cobro en su guardia.
    'reports.clients.view',
    // Edita la ficha del cliente --corregir un telefono mal cargado es
    // exactamente su trabajo-- y autoriza pasarse del limite, que es el caso
    // que hoy obliga a llamar al duenio por telefono.
    //
    // SIN `accounts.adjust`, y es deliberado: pasarse del limite es autorizar
    // una operacion que EXISTE, con su venta detras. Un ajuste manual es
    // escribir un movimiento que no responde a nada, y eso queda en el escalon
    // de arriba.
    'clients.manage',
    'accounts.overrideLimit',
    // Lotes: ve y puede elegir a mano. NO administra el catalogo de partidas ni
    // cambia la politica de un producto: eso es una decision de catalogo, y el
    // supervisor esta en el mostrador. Elegir el lote a mano SI, porque es la
    // correccion que aparece justo en el mostrador --lo que se llevaron no era
    // del lote que el sistema descontó-- y es el mismo escalon que autorizar un
    // exceso de limite.
    'lots.view',
    'lots.adjust',
    // Del inventario fisico: revisa y aplica, NO cuenta. Es exactamente la
    // separacion que hace util el mecanismo --quien cuenta no decide que la
    // diferencia se aplique-- y es el escalon que hoy falta: sin el, cada
    // inventario necesita al administrador.
    'inventoryCounts.view',
    'inventoryCounts.review',
    'inventoryCounts.apply',
  ],

  cajero: PERFIL_CAJA,

  /**
   * Nombre historico del rol de caja en la base actual. Mismo alcance que
   * `cajero`. No se renombra para no tocar datos existentes.
   */
  vendedor: PERFIL_CAJA,

  /**
   * Repositor. Sin cuenta corriente, como pide el objetivo 3.
   *
   * No vende, no cobra y no atiende: no hay ninguna operacion suya que necesite
   * saber quien debe cuanto. Y el saldo de un cliente es informacion privada de
   * esa persona.
   */
  /**
   * Repositor. Sin cuenta corriente, como pide el objetivo 3 de la Fase 4A.
   *
   * VE las devoluciones y NO las crea, que es la respuesta al "evaluar
   * participacion fisica" del objetivo 26 de la Fase 4C. Verlas le sirve: es
   * quien tiene que apartar la mercaderia que se va a devolver. Crearlas, no:
   * armar una devolucion es elegir renglones Y VER SU COSTO --de ahi sale el
   * credito-- y el repositor no tiene `products.cost.view` desde la Fase 3B, a
   * proposito. Darle el boton obligaria a una de dos cosas: filtrarle el costo,
   * que es la informacion mas sensible del catalogo, o darle una pantalla ciega
   * que no puede mostrar el credito que esta generando. Las dos son peores que
   * no tener el boton.
   */
  /*
   * SIN `products.quickCreate`, y no por descuido. El repositor no tiene
   * `products.create`: hoy no puede dar de alta nada, y darle la version rapida
   * seria AMPLIARLE el alcance con la excusa de una comodidad. Ademas no esta en
   * el mostrador --el alta rapida existe para no frenar una venta con el cliente
   * enfrente-- y lo que encuentra sin etiqueta en el deposito no tiene apuro:
   * entra por el formulario completo o por una recepcion de compra, que es donde
   * se carga el costo.
   */
  repositor: [
    'products.view',
    'stock.view',
    'stock.adjust',
    'inventory.movements.view',
    'purchaseReturns.view',
    // Lotes: VE y no administra. Ver es su trabajo --es quien mira que vence y
    // quien saca de la gondola lo vencido-- pero crear partidas y cambiar la
    // politica de un producto es una decision de catalogo.
    //
    // SIN `lots.adjust`: elegir el lote a mano es pasar por encima de la
    // rotacion, y el repositor es justamente quien tiene que respetarla.
    'lots.view',
    // Del inventario fisico: arma y cuenta, NO revisa ni aplica. Es el reparto
    // del objetivo 37 y el que da sentido al conteo a ciegas: quien recorre el
    // deposito con el papel no es quien decide que la diferencia se convierta en
    // un movimiento de stock.
    'inventoryCounts.view',
    'inventoryCounts.create',
    'inventoryCounts.count',
  ],

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
    // Y la rapida, porque ya administra el catalogo: negarsela solo le sacaria
    // el atajo desde la orden de compra --donde tambien aparece el producto que
    // falta-- sin quitarle ningun poder, porque con `products.create` puede
    // cargar exactamente lo mismo por el formulario largo.
    'products.quickCreate',
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
    // SIN cuenta corriente DE CLIENTES, como pide el objetivo 3 de la Fase 4A.
    // Compras negocia con proveedores; la cuenta corriente es la relacion con
    // los CLIENTES, que es el otro lado del mostrador. Separar quien compra de
    // quien cobra ya es el control basico del rol, y darle la cartera de
    // deudores lo desharia.
    //
    // CON cuentas por PAGAR, que es exactamente su materia: es quien negocia el
    // plazo, quien recibe la factura y quien habla con el proveedor cuando
    // reclama. Ver y pagar, "segun politica operativa" como pide el objetivo 32.
    //
    // SIN `credit`, `adjust` ni `overpay`, y es la separacion que da sentido al
    // reparto: quien negocia con el proveedor no puede bajarle la deuda sin que
    // salga plata (nota de credito), ni escribir un movimiento que no responde
    // a nada (ajuste), ni entregarle de mas. Esos tres quedan en el escalon de
    // arriba, que es quien responde por el dinero.
    'supplierAccounts.view',
    'supplierAccounts.payment',
    // Y la imputacion diferida: es quien sabe a que compra corresponde el
    // anticipo que se entrego en marzo, porque fue quien lo negocio.
    'supplierAccounts.allocate',
    // Las devoluciones, las tres. Es quien recibe la mercaderia, quien nota que
    // llego rota y quien la discute con el proveedor.
    //
    // CON `confirm`, a diferencia de `supplierAccounts.credit`, que no tiene. La
    // asimetria es deliberada y no una distraccion: las dos bajan la deuda sin
    // que salga plata, pero la devolucion deja mercaderia saliendo del deposito
    // --con su movimiento en el libro de inventario, su reconciliacion y su
    // efecto en el recuento-- y la nota de credito no deja mas rastro que un
    // papel. Se puede inventar una nota de credito; no se puede inventar una
    // devolucion sin que falte el stock.
    'purchaseReturns.view',
    'purchaseReturns.create',
    'purchaseReturns.confirm',
    // Lotes: ve Y ADMINISTRA. `manage` no es un exceso: recibir mercaderia de un
    // producto que exige lote significa cargar la partida que llego --con su
    // codigo y su vencimiento, leidos del envase-- y sin este permiso compras no
    // podria recibir ese producto en absoluto.
    //
    // Puede ENDURECER la politica de rastreo --marcar que un producto pase a
    // seguirse por lote-- pero desde la Fase 5A ya NO puede aflojarla. La
    // pregunta que lo decidio fue directa: ¿compras necesita poder bajar un
    // producto de REQUIRED a NONE? No. Necesita cargar la partida que llego
    // para poder recibir, y eso lo sigue dando `manage`. Aflojar apaga un
    // control, y ese escalon quedo en `lots.tracking.relax`, que tienen
    // encargado y administrador.
    //
    // SIN `lots.adjust`: elegir el lote a mano es una operacion de mostrador.
    'lots.view',
    'lots.manage',
    // Del inventario fisico solo VE. Contar el deposito es del almacen, y
    // aplicar diferencias es la corrección de stock que compras no hace: quien
    // recibe la mercaderia no debe poder ajustar cuanta hay.
    'inventoryCounts.view',
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
    'reports.clients.view',
    'audit.view',
    'users.view',
    'branches.view',
    'suppliers.view',
    'purchases.view',
    // Lectura de la cuenta corriente: es la mitad nueva de lo que hay que
    // auditar. Sin `charge`, `payment`, `adjust` ni `overrideLimit`: quien
    // revisa no debe poder modificar lo que revisa.
    'clients.view',
    'accounts.view',
    // Y la otra mitad: lo que se le debe a los proveedores. Solo `view`, por lo
    // mismo. Sin esto el auditor podria revisar de quien se cobra y no a quien
    // se le paga, que es la mitad del dinero del negocio.
    'supplierAccounts.view',
    // Las devoluciones tambien, solo lectura. Sin `create` ni `confirm`, y sin
    // `supplierAccounts.allocate`: quien revisa no debe poder modificar lo que
    // revisa, y una imputacion cambia que entrega figura como saldada.
    'purchaseReturns.view',
    // Lotes e inventarios, solo lectura. Es material de auditoria de primera
    // linea: un inventario aplicado es una correccion de stock sin mercaderia
    // detras, y quien revisa tiene que poder verla. Sin `manage`, sin `adjust`,
    // sin `count`, sin `review` y sin `apply`.
    'lots.view',
    'inventoryCounts.view',
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
