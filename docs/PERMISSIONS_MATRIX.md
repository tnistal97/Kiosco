# Matriz de permisos

> Estado a la Fase 2. La fuente de verdad es
> [`src/server/authz/permissions.ts`](../src/server/authz/permissions.ts); este
> documento la explica. Si los dos difieren, manda el código, y el test
> `tests/authorization/permissions-matrix.test.ts` falla hasta que coincidan.

## La regla

Ninguna ruta pregunta por el nombre del rol. Todas preguntan por un permiso:

```ts
// nunca
if (session.role === 'admin') { ... }

// siempre
permission: 'sales.cancel'
```

El nombre del rol solo sirve para resolver qué permisos tiene, en un único
archivo. Agregar un rol nuevo no obliga a revisar las 30 rutas.

**Un rol que no figure en el catálogo recibe cero permisos.** Es deliberado:
es preferible que un rol nuevo no pueda hacer nada y haya que darle permisos
explícitamente, a que herede todo por descuido. `POST /api/users` se niega a
crear usuarios con un rol no catalogado, para que nadie termine con una cuenta
que no puede hacer nada sin entender por qué.

## Roles

Los nombres están en castellano porque son los que ya existen en la base. El
pedido sugería nombres en inglés; la equivalencia es directa y renombrarlos
habría exigido migrar los usuarios existentes sin ganar nada.

| Rol          | Equivale a  | Para qué es                                                                                                                                                             |
| ------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duenio`     | OWNER       | Hoy idéntico a `admin`. Separado porque con varias sucursales van a divergir: `admin` administra la suya, `duenio` las ve todas.                                        |
| `admin`      | ADMIN       | Todo, dentro de su sucursal.                                                                                                                                            |
| `encargado`  | MANAGER     | Opera y administra el día a día. No toca usuarios ni la bitácora.                                                                                                       |
| `supervisor` | SUPERVISOR  | Cajero con capacidad de anular y de mover la caja. Es el escalón que faltaba: sin él, cada anulación necesita al administrador.                                         |
| `cajero`     | CASHIER     | Vende, cobra y arquea. Nada más.                                                                                                                                        |
| `vendedor`   | CASHIER     | Alias histórico de `cajero`, con el mismo alcance. Existe porque es el rol que tienen los usuarios en la base.                                                          |
| `repositor`  | STOCK_CLERK | Repone mercadería. Ve el catálogo y ajusta stock; no vende ni ve la caja.                                                                                               |
| `compras`    | PURCHASING  | Catálogo, proveedores y entrada de mercadería. **No vende y no toca la caja**: separar quién compra de quién cobra es el control básico contra el desvío de mercadería. |
| `auditor`    | AUDITOR     | Solo lectura, incluida la bitácora. Ni un permiso de escritura, a propósito: quien revisa no debe poder modificar lo que revisa.                                        |

## Rol × permiso

| Permiso                     | duenio | admin | encargado | supervisor | cajero | vendedor | repositor | compras | auditor |
| --------------------------- | :----: | :---: | :-------: | :--------: | :----: | :------: | :-------: | :-----: | :-----: |
| `sales.create`              |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `sales.view`                |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ✔    |
| `sales.cancel`              |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `products.view`             |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ✔     |    ✔    |    ✔    |
| `products.create`           |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.update`           |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.price.update`     |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `products.cost.view`        |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.cost.update`      |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.delete`           |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `categories.manage`         |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `stock.view`                |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ✔     |    ✔    |    ✔    |
| `stock.adjust`              |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ✔     |    ✔    |    ·    |
| `inventory.movements.view`  |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ✔     |    ✔    |    ✔    |
| `cash.view`                 |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ✔    |
| `cash.movement.create`      |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `cash.count.create`         |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `cash.shift.open`           |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `cash.shift.close`          |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `cash.shift.close.other`    |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `cash.shift.authorize`      |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `reports.sales.view`        |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `reports.costs.view`        |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `reports.inventory.view`    |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `reports.cash.view`         |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `reports.purchases.view`    |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `audit.view`                |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `users.view`                |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `users.manage`              |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `branches.view`             |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `branches.manage`           |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `suppliers.view`            |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `suppliers.manage`          |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchases.view`            |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `purchases.create`          |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchases.update`          |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchases.receive`         |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchases.cancel`          |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `reports.clients.view`      |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `clients.view`              |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ✔    |
| `clients.manage`            |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `accounts.view`             |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ✔    |
| `accounts.charge`           |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `accounts.payment`          |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `accounts.adjust`           |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `accounts.overrideLimit`    |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `supplierAccounts.view`     |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `supplierAccounts.payment`  |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `supplierAccounts.credit`   |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `supplierAccounts.adjust`   |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `supplierAccounts.overpay`  |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `supplierAccounts.allocate` |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchaseReturns.view`      |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ✔     |    ✔    |    ✔    |
| `purchaseReturns.create`    |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchaseReturns.confirm`   |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `lots.view`                 |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ✔     |    ✔    |    ✔    |
| `lots.manage`               |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `lots.tracking.relax`       |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `lots.adjust`               |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `inventoryCounts.view`      |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ✔     |    ✔    |    ✔    |
| `inventoryCounts.create`    |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ✔     |    ·    |    ·    |
| `inventoryCounts.count`     |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ✔     |    ·    |    ·    |
| `inventoryCounts.review`    |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `inventoryCounts.apply`     |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |

### Quien cuenta no aplica

Es la casilla que da sentido a los cinco permisos del inventario físico. El
repositor tiene `create` y `count` —arma la sesión y recorre el depósito— y **no**
tiene `review` ni `apply`. El supervisor, al revés.

Si contar y aplicar fueran el mismo permiso, cualquiera podría hacer desaparecer
mercadería escribiendo un número más chico y aplicándolo. Es la misma separación
que hace que el conteo a ciegas signifique algo: quien recorre la góndola no
decide que la diferencia se convierta en un movimiento de stock.

### Compras administra lotes, pero ya no puede apagar el rastreo

`compras` tiene `lots.manage` porque recibir mercadería de un producto que exige
lote **es** cargar la partida que llegó, con su código y su vencimiento leídos del
envase. Sin ese permiso, compras no podría recibir ese producto en absoluto.

Hasta la Fase 4D, `lots.manage` incluía además cambiar la política de rastreo en
las dos direcciones, y la matriz lo decía así: «quien recibe puede aflojar el
rastreo de un producto; queda auditado». La Fase 5A revisó esa casilla con una
pregunta concreta —¿compras **necesita** poder bajar un producto de `REQUIRED` a
`NONE`?— y la respuesta fue no.

**La separación es por dirección, no por operación.** Endurecer y aflojar no son
simétricos:

|                    | Endurecer (`NONE → OPTIONAL → REQUIRED`)                           | Aflojar (`REQUIRED → OPTIONAL → NONE`)             |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------- |
| Qué hace           | enciende un control                                                | **apaga** un control                               |
| Se comprueba solo  | sí: exige atribuir todo el stock antes de dejar activar `REQUIRED` | no hay nada que lo frene                           |
| Efecto hacia atrás | ninguno                                                            | el producto empieza a aceptar unidades sin partida |
| Permiso            | `lots.manage`                                                      | `lots.tracking.relax`                              |

Partir `lots.manage` entero habría recreado el problema que lo hizo único: un rol
que puede exigir lotes y no crearlos deja un producto imposible de recibir. Partirlo
por dirección no: compras conserva **todo** lo que hacía y pierde exactamente lo que
no debía poder hacer.

La comprobación vive en el servicio, no en la ruta. La ruta no puede saber si el
cambio afloja: eso depende de cómo está hoy el producto, y `REQUIRED → REQUIRED` y
`NONE → REQUIRED` llegan con el mismo cuerpo. Se lee el estado real dentro de la
misma transacción que aplica el cambio.

«Queda auditado» no alcanzaba como única protección: la bitácora dice quién apagó el
control, no lo impide.

### El cajero no ve lotes

`lots.view` no está en el perfil de caja. Son dos preguntas distintas: para vender
hace falta saber **cuánto** hay, y eso lo sigue contestando `BranchStock`; de qué
partida es cada unidad y cuándo vence es información de depósito.

La caja igual no vende vencido: esa comprobación la hace el servidor con o sin el
permiso.

### `lots.adjust` es del mostrador, no del depósito

Elegir el lote a mano pasa por encima de la política de rotación en una operación
concreta, y eso aparece justo en el mostrador —lo que se llevaron no era del lote
que el sistema descontó—. Por eso lo tiene el supervisor y **no** el repositor,
que es quien tiene que respetar la rotación.

### Compras paga pero no acredita ni ajusta

Es la casilla menos obvia de la Fase 4B. `compras` tiene `view` y `payment`
—negocia el plazo, recibe la factura y habla con el proveedor cuando reclama—
y **no** tiene `credit`, `adjust` ni `overpay`.

Los tres que le faltan tienen algo en común: **bajan lo que debemos sin que
salga plata**. Una nota de crédito se apoya sólo en un papel que trajo el
proveedor; un ajuste no responde a nada; un sobrepago deja dinero nuestro en
manos de un tercero. Quien negocia con el proveedor no debería poder hacer
ninguna de las tres solo.

### El cajero no ve lo que le debemos a nadie

`supplierAccounts.view` no está en el perfil de caja, y no es un olvido. La
deuda con los proveedores es el pasivo del negocio: no hace falta para cobrar,
para vender ni para cerrar un turno. Es la contracara de que compras no tenga
la cartera de clientes.

### El repositor no recibe mercadería

Es la casilla menos obvia de la tabla, y es deliberada. Recibir **cambia el
costo del producto**, que es información financiera; el repositor no tiene
`products.cost.view` justamente para no verla. Darle `purchases.receive` le
permitiría fijarla sin poder leerla, que es lo peor de los dos mundos.

El día que el almacén quiera que el repositor descargue el camión, lo que hace
falta es una recepción "a ciegas" que no toque el costo. Eso es una función
nueva, no un permiso más.

### No existe `purchases.cost.override`

Se evaluó y se descartó. Recibir a un costo distinto del pedido ya exige
`products.cost.update`, y quien tiene ese permiso puede cambiar el costo desde
la ficha del producto de todos modos. Un tercer permiso que sólo sirve
acompañado del segundo no impide nada: sería una puerta con cerradura al lado
de una pared abierta.

La separación útil es la que ya existe: **`purchases.receive` sin
`products.cost.update` recibe al costo pedido y no puede tocarlo.**

## Permiso × ruta × impacto

| Permiso                     | Rutas                                                                                                                                                                                                             | Qué habilita                                                                      | Impacto si se otorga de más                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales.create`              | `POST /api/sales`                                                                                                                                                                                                 | Registrar una venta                                                               | Descuenta stock y suma a la caja.                                                                                                                                                                                                     |
| `sales.view`                | — _(sin uso)_                                                                                                                                                                                                     | Ver ventas propias                                                                | Ninguno hoy. Ver nota abajo.                                                                                                                                                                                                          |
| `sales.cancel`              | `POST /api/sales/:id/cancel`                                                                                                                                                                                      | Anular una venta                                                                  | **Devuelve dinero de la caja y restituye stock.** El permiso más sensible de la operación diaria.                                                                                                                                     |
| `products.view`             | `GET /api/products`<br>`GET /api/products/:id`<br>`GET /api/categories`                                                                                                                                           | Leer el catálogo                                                                  | Expone precios de costo si algún día se agregan.                                                                                                                                                                                      |
| `products.create`           | `POST /api/products`                                                                                                                                                                                              | Alta de producto                                                                  | Un producto con precio erróneo se vende a ese precio.                                                                                                                                                                                 |
| `products.update`           | `PUT /api/products/:id`                                                                                                                                                                                           | Editar la ficha                                                                   | Nombre, código, descripción, categoría, proveedor. No incluye el precio.                                                                                                                                                              |
| `products.price.update`     | `PUT /api/products/:id` (campo `price`)                                                                                                                                                                           | Cambiar el precio de venta                                                        | **Cambia cuánto se le cobra al cliente.** Separado de la edición desde la Fase 2.                                                                                                                                                     |
| `products.cost.view`        | `GET /api/products`<br>`GET /api/products/:id`                                                                                                                                                                    | Ver el costo, la ganancia, el margen y el markup                                  | **Es la información más sensible del catálogo:** con ella se calcula el margen del negocio entero. Sin el permiso, el servidor NO manda la clave `cost`; no se esconde, no viaja.                                                     |
| `products.cost.update`      | `PUT /api/products/:id/cost`<br>`PUT /api/products/:id` (campo `cost`)                                                                                                                                            | Cambiar el costo                                                                  | Exige motivo y deja una fila inmutable en `ProductCostHistory`. Autorización SEPARADA de la del precio: son dos decisiones distintas.                                                                                                 |
| `products.delete`           | `DELETE /api/products/:id`                                                                                                                                                                                        | Baja de producto                                                                  | Se niega si figura en ventas **o si tiene movimientos de stock**, así que no destruye historial.                                                                                                                                      |
| `categories.manage`         | `POST /api/categories`                                                                                                                                                                                            | Crear categorías                                                                  | Bajo.                                                                                                                                                                                                                                 |
| `stock.view`                | `GET /api/stock/:productId`                                                                                                                                                                                       | Consultar existencias                                                             | Bajo.                                                                                                                                                                                                                                 |
| `stock.adjust`              | `PUT /api/stock/:productId`<br>`PATCH /api/stock/:productId`                                                                                                                                                      | Recuento, ajuste, pérdida, rotura, consumo interno                                | **Permite tapar un faltante ajustando el inventario.** Exige motivo y tipo, y deja una fila inmutable en el libro. Es el `inventory.adjust` del pedido: se conservó el nombre existente.                                              |
| `inventory.movements.view`  | `GET /api/inventory/movements`                                                                                                                                                                                    | Ver el libro de movimientos                                                       | Expone quién movió cada unidad. Solo lectura: los movimientos no se editan ni se borran.                                                                                                                                              |
| `cash.view`                 | `GET /api/cash`<br>`GET /api/cash/balance`<br>`GET /api/cash/:id`                                                                                                                                                 | Ver movimientos y saldo                                                           | Expone la recaudación.                                                                                                                                                                                                                |
| `cash.movement.create`      | `POST /api/cash`                                                                                                                                                                                                  | Ingreso, retiro, depósito                                                         | **Retirar dinero de la caja.**                                                                                                                                                                                                        |
| `cash.count.create`         | `POST /api/cash/count`                                                                                                                                                                                            | Arqueo                                                                            | Bajo: el esperado y la diferencia los calcula el servidor.                                                                                                                                                                            |
| `cash.shift.open`           | `POST /api/cash/shift`                                                                                                                                                                                            | Abrir la caja                                                                     | Bajo: una sola por sucursal, y el monto inicial queda registrado.                                                                                                                                                                     |
| `cash.shift.close`          | `POST /api/cash/shift/:id/close`                                                                                                                                                                                  | Cerrar **el propio** turno                                                        | Medio: fija el contado y la diferencia, y el turno queda inmutable.                                                                                                                                                                   |
| `cash.shift.close.other`    | `POST /api/cash/shift/:id/close`                                                                                                                                                                                  | Cerrar el turno de otra persona                                                   | **Permite declarar el contado de una caja que no atendió.** Es para cuando alguien se fue sin cerrar.                                                                                                                                 |
| `cash.shift.authorize`      | `POST /api/cash/shift/:id/close`                                                                                                                                                                                  | Autorizar una diferencia sobre el umbral                                          | **Que un cajero no pueda autorizar su propio faltante es medio punto del mecanismo.**                                                                                                                                                 |
| `sales.view`                | `GET /api/admin/sales`                                                                                                                                                                                            | Historial de ventas del rango                                                     | Es el historial, no un reporte. Hasta la Fase 3D pedía `reports.view`, que el cajero no tiene: veía el enlace del menú y recibía un 403. La **recaudación** del rango sigue protegida.                                                |
| `reports.sales.view`        | `GET /api/reports/ventas`, `GET /api/reports/productos`, y el campo `totales.recaudado` de `/api/admin/sales`                                                                                                     | Facturación, operaciones, ticket, por cajero                                      | Expone cuánto factura el local.                                                                                                                                                                                                       |
| `reports.costs.view`        | `GET /api/reports/rentabilidad`, y el campo `valorizado` de `/api/reports/inventario`                                                                                                                             | Costo vendido, ganancia bruta, margen                                             | **El permiso más sensible**: con él se calcula cuánto gana el negocio.                                                                                                                                                                |
| `reports.inventory.view`    | `GET /api/reports/inventario`                                                                                                                                                                                     | Cantidades, agotados, bajo mínimo, sin costo                                      | Sin costos: la valorización va aparte.                                                                                                                                                                                                |
| `reports.cash.view`         | `GET /api/reports/caja`                                                                                                                                                                                           | Turnos, diferencias, ingresos, egresos, retiros                                   | Expone los faltantes de caja por persona.                                                                                                                                                                                             |
| `reports.purchases.view`    | `GET /api/reports/compras`                                                                                                                                                                                        | Total comprado, por proveedor, diferencias de costo                               | Expone lo que se le paga a cada proveedor.                                                                                                                                                                                            |
| `audit.view`                | `GET /api/audit`                                                                                                                                                                                                  | Leer la bitácora                                                                  | Expone toda la actividad, incluidos los intentos rechazados.                                                                                                                                                                          |
| `users.view`                | `GET /api/users`<br>`GET /api/roles`                                                                                                                                                                              | Listar personal                                                                   | Nombres de usuario. Nunca hashes.                                                                                                                                                                                                     |
| `users.manage`              | `POST /api/users`                                                                                                                                                                                                 | Alta de personal                                                                  | **Escalada de privilegios: crear un usuario con rol administrador.**                                                                                                                                                                  |
| `branches.view`             | `GET /api/branches`                                                                                                                                                                                               | Ver sucursales                                                                    | Bajo.                                                                                                                                                                                                                                 |
| `branches.manage`           | `POST /api/branches`<br>`PATCH /api/branches`                                                                                                                                                                     | Alta y edición de sucursal                                                        | Alto cuando haya varias.                                                                                                                                                                                                              |
| `suppliers.view`            | `GET /api/suppliers`<br>`GET /api/suppliers/:id`                                                                                                                                                                  | Ver proveedores y qué se les compra                                               | Bajo. El `lastCost` de cada producto sólo viaja con `products.cost.view`.                                                                                                                                                             |
| `suppliers.manage`          | `POST /api/suppliers`<br>`PUT /api/suppliers/:id`<br>`PATCH /api/suppliers/:id`<br>`DELETE /api/suppliers/:id`                                                                                                    | Alta, edición, baja lógica y borrado                                              | Medio. Desactivar un proveedor impide comprarle; el borrado se niega si tiene historial (`SUPPLIER_HAS_HISTORY`).                                                                                                                     |
| `purchases.view`            | `GET /api/purchases`<br>`GET /api/purchases/:id`                                                                                                                                                                  | Ver órdenes y sus recepciones                                                     | Expone qué se compró y a quién. **El importe total sólo viaja con `products.cost.view`**: un total de compras es información financiera tanto como un costo unitario.                                                                 |
| `purchases.create`          | `POST /api/purchases`<br>`POST /api/purchases/draft-from-restock`                                                                                                                                                 | Crear borradores de compra                                                        | Bajo: un borrador no le pide nada a nadie ni toca stock.                                                                                                                                                                              |
| `purchases.update`          | `PUT /api/purchases/:id`<br>`DELETE /api/purchases/:id`<br>`POST /api/purchases/:id/confirm`                                                                                                                      | Editar, borrar y confirmar un borrador                                            | Medio. Confirmar es un camino de ida: a partir de ahí la orden se recibe o se cancela.                                                                                                                                                |
| `purchases.receive`         | `POST /api/purchases/:id/receive`                                                                                                                                                                                 | Dar entrada a la mercadería                                                       | **Alto: suma stock y cambia el costo del producto.** Recibir a un costo distinto del pedido exige además `products.cost.update`. La recepción es inmutable.                                                                           |
| `purchases.cancel`          | `POST /api/purchases/:id/cancel`                                                                                                                                                                                  | Cancelar una orden                                                                | Medio. Exige motivo. No revierte lo ya recibido: la mercadería está en el depósito.                                                                                                                                                   |
| `reports.clients.view`      | `GET /api/reports/clientes`                                                                                                                                                                                       | Cartera: cuánto se debe, quiénes deben, top deudores                              | Expone la lista completa de deudores. Es el agregado del negocio, no la cuenta de una persona: por eso el cajero tiene `accounts.view` y no esto.                                                                                     |
| `clients.view`              | `GET /api/clients`<br>`GET /api/clients/buscar`<br>`GET /api/clients/:id`                                                                                                                                         | Ver la ficha y buscar en el mostrador                                             | Datos de contacto de los clientes. El saldo viaja en el listado, así que va de la mano con `accounts.view`.                                                                                                                           |
| `clients.manage`            | `POST /api/clients`<br>`PUT /api/clients/:id`<br>`PATCH /api/clients/:id`<br>`PATCH /api/clients/:id/fiado`<br>`DELETE /api/clients/:id`                                                                          | Alta, edición, baja, límite y fiado habilitado                                    | **Alto: cambiar el límite de crédito decide cuánto se le puede fiar a alguien.** Cortar el fiado tiene efecto inmediato sobre la próxima venta.                                                                                       |
| `accounts.view`             | `GET /api/clients/:id/cuenta`<br>`GET /api/clients/:id/pagos`<br>`GET /api/clients/:id/credito`<br>`GET /api/comprobantes/:id`                                                                                    | Ver el saldo y el extracto                                                        | Expone cuánto debe cada persona, que es información suya. Por eso el repositor y compras no lo tienen.                                                                                                                                |
| `accounts.charge`           | `POST /api/sales` (con línea `ACCOUNT`)<br>`POST /api/clients/rapido`                                                                                                                                             | Fiar, y dar de alta a quien se le fía                                             | Medio. Genera deuda, pero acotada por el límite de crédito y siempre con la venta detrás. Es una operación normal de mostrador.                                                                                                       |
| `accounts.payment`          | `POST /api/clients/:id/pagos`                                                                                                                                                                                     | Cobrar lo que el cliente debe                                                     | Medio. Baja el saldo y, en efectivo, entra al cajón: queda dentro del arqueo del turno.                                                                                                                                               |
| `accounts.adjust`           | `POST /api/clients/:id/ajuste`                                                                                                                                                                                    | Corregir un saldo con un movimiento manual                                        | **Alto: escribe un movimiento que no responde a ninguna venta ni a ningún cobro.** Es lo que separa a quien cobra de quien puede perdonar una deuda. Exige motivo.                                                                    |
| `accounts.overrideLimit`    | `POST /api/sales` (con `autorizarExcesoDeCredito`)                                                                                                                                                                | Autorizar una venta por encima del límite                                         | **Alto: deja pasar el tope que protege al negocio.** Queda registrado quién autorizó, en la fila del libro y no solo en la bitácora.                                                                                                  |
| `supplierAccounts.view`     | `GET /api/suppliers/:id/cuenta`<br>`GET /api/suppliers/:id/cuenta/resumen`<br>`GET /api/suppliers/:id/deudas`<br>`GET /api/suppliers/:id/pagos`<br>`GET /api/suppliers/pagos/:id`<br>`GET /api/suppliers/cartera` | Ver el saldo, las deudas abiertas y los pagos                                     | Expone el pasivo del negocio: cuánto se le debe a cada proveedor y qué está vencido. Por eso el cajero no lo tiene.                                                                                                                   |
| `supplierAccounts.payment`  | `POST /api/suppliers/:id/pagos`<br>`POST /api/purchases/:id/receive` (con `pago`)                                                                                                                                 | Pagar, y elegir a qué entregas se imputa                                          | **Alto: entrega dinero.** En efectivo sale del cajón y queda dentro del arqueo del turno; por transferencia no toca la caja.                                                                                                          |
| `supplierAccounts.credit`   | `POST /api/suppliers/:id/nota-credito`                                                                                                                                                                            | Registrar una nota de crédito del proveedor                                       | **Alto: baja la deuda SIN que salga plata.** Se apoya sólo en un papel que trajo el proveedor. Exige motivo.                                                                                                                          |
| `supplierAccounts.adjust`   | `POST /api/suppliers/:id/ajuste`<br>`PATCH /api/purchases/recepciones/:id/vencimiento`                                                                                                                            | Corregir un saldo, y correr un vencimiento                                        | **Alto: escribe un movimiento que no responde a ninguna entrega ni a ningún pago.** Es el camino para cargar la deuda anterior a la Fase 4B. Correr un vencimiento cambia si una deuda figura como vencida. Exige motivo.             |
| `supplierAccounts.allocate` | `POST /api/suppliers/:id/pagos/:pagoId/imputar`                                                                                                                                                                   | Aplicar un pago YA REGISTRADO a obligaciones concretas                            | **Medio.** No mueve un peso: cambia QUÉ ENTREGA figura como saldada. Aparte de `payment` porque pagar deja rastro en la caja o en el banco y esto no deja ninguno, y justamente por eso puede pasar desapercibido.                    |
| `purchaseReturns.view`      | `GET /api/devoluciones`, `GET /api/purchases/recepciones/:id/retornables`                                                                                                                                         | Ver devoluciones y lo retornable de una entrega                                   | Bajo. Lo tiene el repositor: es quien aparta la mercadería que se va.                                                                                                                                                                 |
| `purchaseReturns.create`    | `POST /api/devoluciones`, `PATCH`, `POST /api/devoluciones/:id/cancelar`                                                                                                                                          | Armar el borrador                                                                 | Bajo: un borrador no mueve stock ni saldo. Pero muestra el COSTO de cada renglón, y por eso el repositor no lo tiene.                                                                                                                 |
| `purchaseReturns.confirm`   | `POST /api/devoluciones/:id/confirmar`                                                                                                                                                                            | Sacar la mercadería y emitir el crédito                                           | **Alto: baja el stock y baja lo que se debe sin que salga plata.** Compras SÍ lo tiene, a diferencia de `supplierAccounts.credit`: acá hay mercadería detrás, con su movimiento en el libro de inventario.                            |
| `lots.view`                 | `GET /api/lotes`<br>`GET /api/lotes/:id`<br>`GET /api/productos/:id/lotes`<br>`GET /api/reportes/vencimientos`                                                                                                    | Ver las partidas, su stock y sus vencimientos                                     | Bajo. NO está en el perfil de caja: para vender alcanza con saber cuánto hay.                                                                                                                                                         |
| `lots.manage`               | `POST /api/lotes`<br>`PATCH /api/lotes/:id`<br>`POST /api/lotes/atribuir`<br>`PUT /api/productos/:id/lotes`<br>(y cargar partidas al recibir)                                                                     | Crear partidas, corregir vencimientos, atribuir stock y **endurecer** la política | Compras lo tiene porque recibir un producto REQUIRED es cargar su partida. Ya **no** alcanza para aflojar el rastreo. El CÓDIGO de un lote con historial no lo cambia nadie: eso es un disparador, no un permiso.                     |
| `lots.tracking.relax`       | `PUT /api/productos/:id/lotes` (sólo cuando el cambio baja el escalón)                                                                                                                                            | Bajar `REQUIRED → OPTIONAL → NONE`, en lote o en vencimiento                      | **Apaga un control, y hacia atrás.** No lo tiene compras. Se comprueba en el servicio contra el estado real del producto, dentro de la transacción: la ruta no puede saber si un cuerpo dado afloja o endurece.                       |
| `lots.adjust`               | `POST /api/sales` (campo `lots`)                                                                                                                                                                                  | Elegir el lote a mano donde el sistema elegiría por FEFO                          | Pasa por encima de la política de rotación en una operación concreta. Sin él, el POS no muestra la elección.                                                                                                                          |
| `inventoryCounts.view`      | `GET /api/inventarios`<br>`GET /api/inventarios/:id`<br>`GET /api/inventarios/:id/lineas`                                                                                                                         | Ver los inventarios físicos y sus diferencias                                     | Bajo. Con conteo a ciegas, lo esperado no sale mientras se cuenta.                                                                                                                                                                    |
| `inventoryCounts.create`    | `POST /api/inventarios`                                                                                                                                                                                           | Armar la sesión: alcance, conteo a ciegas, umbral                                 | Bajo: no toca stock.                                                                                                                                                                                                                  |
| `inventoryCounts.count`     | `POST /api/inventarios/:id/conteo`<br>`POST /api/inventarios/:id/lineas/:lineId/resolver`                                                                                                                         | Cargar conteos y resolver partidas sin identificar                                | Bajo: no toca stock. Es el permiso del operario que recorre el depósito.                                                                                                                                                              |
| `inventoryCounts.review`    | `POST /api/inventarios/:id/revision`<br>`POST /api/inventarios/:id/cancelar`                                                                                                                                      | Cerrar el conteo y mirar las diferencias                                          | Bajo: no toca stock. Es el paso que existe justamente para mirar antes de corregir.                                                                                                                                                   |
| `inventoryCounts.apply`     | `POST /api/inventarios/:id/aplicar`                                                                                                                                                                               | Convertir las diferencias en movimientos de stock                                 | **Alto: mueve el inventario sin que haya entrado ni salido mercadería, y de a cientos de productos.** Por eso NO lo tiene quien cuenta.                                                                                               |
| `supplierAccounts.overpay`  | `POST /api/suppliers/:id/pagos` (con `acceptCredit`)                                                                                                                                                              | Pagar más de lo que se le debe                                                    | **Alto: deja dinero nuestro en manos de un tercero.** Es más estricto que el sobrepago del cliente a propósito: allá la plata ya está sobre el mostrador; acá es una decisión. Queda registrado quién autorizó, en la fila del libro. |

### Rutas sin permiso

Tres, y las tres a propósito:

| Ruta                      | Por qué                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `POST /api/auth/login`    | Pública por definición. Tiene límite de intentos y auditoría de fallos.                |
| `POST /api/auth/logout`   | Pública: cerrar sesión no debe fallar por una sesión ya vencida.                       |
| `POST /api/auth/validate` | Exige sesión pero ningún permiso: solo devuelve quién es el usuario y qué puede hacer. |

### Permiso sin uso

`sales.view` está declarado y asignado a cinco roles, pero **ninguna ruta lo
exige hoy**. No es un descuido que convenga borrar: es el permiso que va a
gatillar la pantalla de "mis ventas del turno", que hoy no existe. Mientras
tanto, el listado de ventas de la caja pasa por `cash.view` y el reporte
administrativo por los cinco permisos `reports.*`.

Queda anotado como deuda: si en la Fase 2 no aparece esa pantalla, hay que
sacarlo del catálogo en vez de dejarlo dando una sensación falsa de control.

### El precio, separado de la ficha

Hasta la Fase 1, `products.update` incluía el cambio de precio: editar la
descripción de un producto y cambiar cuánto sale eran la misma operación. En
la Fase 2 se separaron.

`products.price.update` lo tienen **solo** `duenio`, `admin` y `encargado`.
No lo tienen `supervisor`, `cajero`, `repositor`, `compras` ni `auditor`. Un
repositor que corrige un nombre mal escrito no puede tocar el precio.

Se comprueba en el servidor, en `editarProducto`, y no solamente escondiendo
el campo en la pantalla: esconder un input no impide mandar el `PUT` a mano.
Un `price` idéntico al que ya tiene el producto no se rechaza — no es un
intento de saltear el permiso, y fallar ahí obligaría a la pantalla a saber
qué campos vienen "sucios".

**Límite conocido:** el alta sí lleva precio y está cubierta por
`products.create`. Es deliberado: dar de alta un producto implica ponerle un
precio, y exigir los dos permisos dejaría a `compras` sin poder cargar
mercadería nueva, que es exactamente su trabajo. Lo que `compras` no puede
hacer es retocar el precio de algo que ya se está vendiendo.

## Pruebas asociadas

| Qué se comprueba                                                  | Prueba                                           |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| Un rol desconocido recibe cero permisos                           | `tests/unit/permissions.test.ts`                 |
| La matriz del documento coincide con el código                    | `tests/authorization/permissions-matrix.test.ts` |
| Toda ruta privada declara permiso o es de la lista de excepciones | `tests/authorization/permissions-matrix.test.ts` |
| El cajero no administra usuarios                                  | `tests/authorization/permissions.test.ts`        |
| El cajero no anula ventas                                         | `tests/authorization/permissions.test.ts`        |
| El cajero no lee la bitácora                                      | `tests/authorization/permissions.test.ts`        |
| El cajero no borra ni cambia el precio de un producto             | `tests/authorization/permissions.test.ts`        |
| Ningún endpoint devuelve hashes                                   | `tests/authorization/permissions.test.ts`        |
| Cada perfil operativo puede exactamente lo suyo                   | `tests/authorization/roles.test.ts`              |
| El aislamiento por sucursal se respeta en lectura y escritura     | `tests/authorization/branch-isolation.test.ts`   |
| Un anónimo no entra a ninguna ruta privada                        | `tests/authorization/anonymous.test.ts`          |
| Cada reporte pide **su** permiso y ningún otro                    | `tests/integration/reportes.test.ts`             |
| La valorización del inventario no sale sin `reports.costs.view`   | `tests/integration/reportes.test.ts`             |
| El cajero abre su historial de ventas y no ve la recaudación      | `tests/integration/reportes.test.ts`             |

## Lo que sigue

El paso pendiente es mover `ROLE_PRESETS` a la base, con dos tablas:

```prisma
model Permission     { id Int @id, code String @unique, description String }
model RolePermission { roleId Int, permissionId Int, @@id([roleId, permissionId]) }
```

`permissionsForRole()` pasa a consultar la base con caché y
`requirePermission` sigue recibiendo el mismo string: **ninguna ruta cambia**.

No se hizo en la Fase 1 por una razón concreta: cambiar el modelo de permisos
y activar la autorización a la vez habría hecho imposible saber cuál de las
dos cosas rompió algo. Ahora que la autorización está probada, la migración se
puede hacer sola y verificar contra esta misma matriz.
