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

| Permiso                    | duenio | admin | encargado | supervisor | cajero | vendedor | repositor | compras | auditor |
| -------------------------- | :----: | :---: | :-------: | :--------: | :----: | :------: | :-------: | :-----: | :-----: |
| `sales.create`             |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `sales.view`               |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ✔    |
| `sales.cancel`             |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `products.view`            |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ✔     |    ✔    |    ✔    |
| `products.create`          |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.update`          |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.price.update`    |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `products.cost.view`       |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.cost.update`     |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.delete`          |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `categories.manage`        |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `stock.view`               |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ✔     |    ✔    |    ✔    |
| `stock.adjust`             |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ✔     |    ✔    |    ·    |
| `inventory.movements.view` |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ✔     |    ✔    |    ✔    |
| `cash.view`                |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ✔    |
| `cash.movement.create`     |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `cash.count.create`        |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `cash.shift.open`          |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `cash.shift.close`         |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `cash.shift.close.other`   |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `cash.shift.authorize`     |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `reports.sales.view`       |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `reports.costs.view`       |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `reports.inventory.view`   |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `reports.cash.view`        |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `reports.purchases.view`   |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `audit.view`               |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `users.view`               |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `users.manage`             |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `branches.view`            |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `branches.manage`          |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `suppliers.view`           |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `suppliers.manage`         |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchases.view`           |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `purchases.create`         |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchases.update`         |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchases.receive`        |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `purchases.cancel`         |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |

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

| Permiso                    | Rutas                                                                                                          | Qué habilita                                        | Impacto si se otorga de más                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales.create`             | `POST /api/sales`                                                                                              | Registrar una venta                                 | Descuenta stock y suma a la caja.                                                                                                                                                        |
| `sales.view`               | — _(sin uso)_                                                                                                  | Ver ventas propias                                  | Ninguno hoy. Ver nota abajo.                                                                                                                                                             |
| `sales.cancel`             | `POST /api/sales/:id/cancel`                                                                                   | Anular una venta                                    | **Devuelve dinero de la caja y restituye stock.** El permiso más sensible de la operación diaria.                                                                                        |
| `products.view`            | `GET /api/products`<br>`GET /api/products/:id`<br>`GET /api/categories`                                        | Leer el catálogo                                    | Expone precios de costo si algún día se agregan.                                                                                                                                         |
| `products.create`          | `POST /api/products`                                                                                           | Alta de producto                                    | Un producto con precio erróneo se vende a ese precio.                                                                                                                                    |
| `products.update`          | `PUT /api/products/:id`                                                                                        | Editar la ficha                                     | Nombre, código, descripción, categoría, proveedor. No incluye el precio.                                                                                                                 |
| `products.price.update`    | `PUT /api/products/:id` (campo `price`)                                                                        | Cambiar el precio de venta                          | **Cambia cuánto se le cobra al cliente.** Separado de la edición desde la Fase 2.                                                                                                        |
| `products.cost.view`       | `GET /api/products`<br>`GET /api/products/:id`                                                                 | Ver el costo, la ganancia, el margen y el markup    | **Es la información más sensible del catálogo:** con ella se calcula el margen del negocio entero. Sin el permiso, el servidor NO manda la clave `cost`; no se esconde, no viaja.        |
| `products.cost.update`     | `PUT /api/products/:id/cost`<br>`PUT /api/products/:id` (campo `cost`)                                         | Cambiar el costo                                    | Exige motivo y deja una fila inmutable en `ProductCostHistory`. Autorización SEPARADA de la del precio: son dos decisiones distintas.                                                    |
| `products.delete`          | `DELETE /api/products/:id`                                                                                     | Baja de producto                                    | Se niega si figura en ventas **o si tiene movimientos de stock**, así que no destruye historial.                                                                                         |
| `categories.manage`        | `POST /api/categories`                                                                                         | Crear categorías                                    | Bajo.                                                                                                                                                                                    |
| `stock.view`               | `GET /api/stock/:productId`                                                                                    | Consultar existencias                               | Bajo.                                                                                                                                                                                    |
| `stock.adjust`             | `PUT /api/stock/:productId`<br>`PATCH /api/stock/:productId`                                                   | Recuento, ajuste, pérdida, rotura, consumo interno  | **Permite tapar un faltante ajustando el inventario.** Exige motivo y tipo, y deja una fila inmutable en el libro. Es el `inventory.adjust` del pedido: se conservó el nombre existente. |
| `inventory.movements.view` | `GET /api/inventory/movements`                                                                                 | Ver el libro de movimientos                         | Expone quién movió cada unidad. Solo lectura: los movimientos no se editan ni se borran.                                                                                                 |
| `cash.view`                | `GET /api/cash`<br>`GET /api/cash/balance`<br>`GET /api/cash/:id`                                              | Ver movimientos y saldo                             | Expone la recaudación.                                                                                                                                                                   |
| `cash.movement.create`     | `POST /api/cash`                                                                                               | Ingreso, retiro, depósito                           | **Retirar dinero de la caja.**                                                                                                                                                           |
| `cash.count.create`        | `POST /api/cash/count`                                                                                         | Arqueo                                              | Bajo: el esperado y la diferencia los calcula el servidor.                                                                                                                               |
| `cash.shift.open`          | `POST /api/cash/shift`                                                                                         | Abrir la caja                                       | Bajo: una sola por sucursal, y el monto inicial queda registrado.                                                                                                                        |
| `cash.shift.close`         | `POST /api/cash/shift/:id/close`                                                                               | Cerrar **el propio** turno                          | Medio: fija el contado y la diferencia, y el turno queda inmutable.                                                                                                                      |
| `cash.shift.close.other`   | `POST /api/cash/shift/:id/close`                                                                               | Cerrar el turno de otra persona                     | **Permite declarar el contado de una caja que no atendió.** Es para cuando alguien se fue sin cerrar.                                                                                    |
| `cash.shift.authorize`     | `POST /api/cash/shift/:id/close`                                                                               | Autorizar una diferencia sobre el umbral            | **Que un cajero no pueda autorizar su propio faltante es medio punto del mecanismo.**                                                                                                    |
| `sales.view`               | `GET /api/admin/sales`                                                                                         | Historial de ventas del rango                       | Es el historial, no un reporte. Hasta la Fase 3D pedía `reports.view`, que el cajero no tiene: veía el enlace del menú y recibía un 403. La **recaudación** del rango sigue protegida.   |
| `reports.sales.view`       | `GET /api/reports/ventas`, `GET /api/reports/productos`, y el campo `totales.recaudado` de `/api/admin/sales`  | Facturación, operaciones, ticket, por cajero        | Expone cuánto factura el local.                                                                                                                                                          |
| `reports.costs.view`       | `GET /api/reports/rentabilidad`, y el campo `valorizado` de `/api/reports/inventario`                          | Costo vendido, ganancia bruta, margen               | **El permiso más sensible**: con él se calcula cuánto gana el negocio.                                                                                                                   |
| `reports.inventory.view`   | `GET /api/reports/inventario`                                                                                  | Cantidades, agotados, bajo mínimo, sin costo        | Sin costos: la valorización va aparte.                                                                                                                                                   |
| `reports.cash.view`        | `GET /api/reports/caja`                                                                                        | Turnos, diferencias, ingresos, egresos, retiros     | Expone los faltantes de caja por persona.                                                                                                                                                |
| `reports.purchases.view`   | `GET /api/reports/compras`                                                                                     | Total comprado, por proveedor, diferencias de costo | Expone lo que se le paga a cada proveedor.                                                                                                                                               |
| `audit.view`               | `GET /api/audit`                                                                                               | Leer la bitácora                                    | Expone toda la actividad, incluidos los intentos rechazados.                                                                                                                             |
| `users.view`               | `GET /api/users`<br>`GET /api/roles`                                                                           | Listar personal                                     | Nombres de usuario. Nunca hashes.                                                                                                                                                        |
| `users.manage`             | `POST /api/users`                                                                                              | Alta de personal                                    | **Escalada de privilegios: crear un usuario con rol administrador.**                                                                                                                     |
| `branches.view`            | `GET /api/branches`                                                                                            | Ver sucursales                                      | Bajo.                                                                                                                                                                                    |
| `branches.manage`          | `POST /api/branches`<br>`PATCH /api/branches`                                                                  | Alta y edición de sucursal                          | Alto cuando haya varias.                                                                                                                                                                 |
| `suppliers.view`           | `GET /api/suppliers`<br>`GET /api/suppliers/:id`                                                               | Ver proveedores y qué se les compra                 | Bajo. El `lastCost` de cada producto sólo viaja con `products.cost.view`.                                                                                                                |
| `suppliers.manage`         | `POST /api/suppliers`<br>`PUT /api/suppliers/:id`<br>`PATCH /api/suppliers/:id`<br>`DELETE /api/suppliers/:id` | Alta, edición, baja lógica y borrado                | Medio. Desactivar un proveedor impide comprarle; el borrado se niega si tiene historial (`SUPPLIER_HAS_HISTORY`).                                                                        |
| `purchases.view`           | `GET /api/purchases`<br>`GET /api/purchases/:id`                                                               | Ver órdenes y sus recepciones                       | Expone qué se compró y a quién. **El importe total sólo viaja con `products.cost.view`**: un total de compras es información financiera tanto como un costo unitario.                    |
| `purchases.create`         | `POST /api/purchases`<br>`POST /api/purchases/draft-from-restock`                                              | Crear borradores de compra                          | Bajo: un borrador no le pide nada a nadie ni toca stock.                                                                                                                                 |
| `purchases.update`         | `PUT /api/purchases/:id`<br>`DELETE /api/purchases/:id`<br>`POST /api/purchases/:id/confirm`                   | Editar, borrar y confirmar un borrador              | Medio. Confirmar es un camino de ida: a partir de ahí la orden se recibe o se cancela.                                                                                                   |
| `purchases.receive`        | `POST /api/purchases/:id/receive`                                                                              | Dar entrada a la mercadería                         | **Alto: suma stock y cambia el costo del producto.** Recibir a un costo distinto del pedido exige además `products.cost.update`. La recepción es inmutable.                              |
| `purchases.cancel`         | `POST /api/purchases/:id/cancel`                                                                               | Cancelar una orden                                  | Medio. Exige motivo. No revierte lo ya recibido: la mercadería está en el depósito.                                                                                                      |

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
