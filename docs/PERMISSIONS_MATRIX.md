# Matriz de permisos

> Estado a la Fase 1. La fuente de verdad es
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

| Permiso                | duenio | admin | encargado | supervisor | cajero | vendedor | repositor | compras | auditor |
| ---------------------- | :----: | :---: | :-------: | :--------: | :----: | :------: | :-------: | :-----: | :-----: |
| `sales.create`         |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `sales.view`           |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ✔    |
| `sales.cancel`         |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `products.view`        |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ✔     |    ✔    |    ✔    |
| `products.create`      |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.update`      |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `products.delete`      |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `categories.manage`    |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |
| `stock.view`           |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ✔     |    ✔    |    ✔    |
| `stock.adjust`         |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ✔     |    ✔    |    ·    |
| `cash.view`            |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ✔    |
| `cash.movement.create` |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `cash.count.create`    |   ✔    |   ✔   |     ✔     |     ✔      |   ✔    |    ✔     |     ·     |    ·    |    ·    |
| `reports.view`         |   ✔    |   ✔   |     ✔     |     ✔      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `audit.view`           |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `users.view`           |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `users.manage`         |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `branches.view`        |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ·    |    ✔    |
| `branches.manage`      |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ·    |    ·    |
| `suppliers.view`       |   ✔    |   ✔   |     ✔     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ✔    |
| `suppliers.manage`     |   ✔    |   ✔   |     ·     |     ·      |   ·    |    ·     |     ·     |    ✔    |    ·    |

## Permiso × ruta × impacto

| Permiso                | Rutas                                                                   | Qué habilita                | Impacto si se otorga de más                                                                       |
| ---------------------- | ----------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `sales.create`         | `POST /api/sales`                                                       | Registrar una venta         | Descuenta stock y suma a la caja.                                                                 |
| `sales.view`           | — _(sin uso)_                                                           | Ver ventas propias          | Ninguno hoy. Ver nota abajo.                                                                      |
| `sales.cancel`         | `POST /api/sales/:id/cancel`                                            | Anular una venta            | **Devuelve dinero de la caja y restituye stock.** El permiso más sensible de la operación diaria. |
| `products.view`        | `GET /api/products`<br>`GET /api/products/:id`<br>`GET /api/categories` | Leer el catálogo            | Expone precios de costo si algún día se agregan.                                                  |
| `products.create`      | `POST /api/products`                                                    | Alta de producto            | Un producto con precio erróneo se vende a ese precio.                                             |
| `products.update`      | `PUT /api/products/:id`                                                 | Editar ficha y precio       | **Cambiar el precio de venta.**                                                                   |
| `products.delete`      | `DELETE /api/products/:id`                                              | Baja de producto            | Se niega si figura en ventas, así que no destruye historial.                                      |
| `categories.manage`    | `POST /api/categories`                                                  | Crear categorías            | Bajo.                                                                                             |
| `stock.view`           | `GET /api/stock/:productId`                                             | Consultar existencias       | Bajo.                                                                                             |
| `stock.adjust`         | `PUT /api/stock/:productId`<br>`PATCH /api/stock/:productId`            | Recuento y ajuste           | **Permite tapar un faltante ajustando el inventario.** Exige motivo y queda auditado.             |
| `cash.view`            | `GET /api/cash`<br>`GET /api/cash/balance`<br>`GET /api/cash/:id`       | Ver movimientos y saldo     | Expone la recaudación.                                                                            |
| `cash.movement.create` | `POST /api/cash`                                                        | Ingreso, retiro, depósito   | **Retirar dinero de la caja.**                                                                    |
| `cash.count.create`    | `POST /api/cash/count`                                                  | Arqueo                      | Bajo: el esperado y la diferencia los calcula el servidor.                                        |
| `reports.view`         | `GET /api/admin/sales`                                                  | Reporte de ventas por rango | Expone la facturación del período.                                                                |
| `audit.view`           | `GET /api/audit`                                                        | Leer la bitácora            | Expone toda la actividad, incluidos los intentos rechazados.                                      |
| `users.view`           | `GET /api/users`<br>`GET /api/roles`                                    | Listar personal             | Nombres de usuario. Nunca hashes.                                                                 |
| `users.manage`         | `POST /api/users`                                                       | Alta de personal            | **Escalada de privilegios: crear un usuario con rol administrador.**                              |
| `branches.view`        | `GET /api/branches`                                                     | Ver sucursales              | Bajo.                                                                                             |
| `branches.manage`      | `POST /api/branches`<br>`PATCH /api/branches`                           | Alta y edición de sucursal  | Alto cuando haya varias.                                                                          |
| `suppliers.view`       | `GET /api/suppliers`                                                    | Ver proveedores             | Bajo.                                                                                             |
| `suppliers.manage`     | `POST /api/suppliers`                                                   | Alta de proveedor           | Bajo hoy; alto cuando existan compras y cuenta corriente.                                         |

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
administrativo por `reports.view`.

Queda anotado como deuda: si en la Fase 2 no aparece esa pantalla, hay que
sacarlo del catálogo en vez de dejarlo dando una sensación falsa de control.

### Permisos con alcance demasiado amplio

Uno, y está señalado aquí porque conviene corregirlo en la Fase 2:

**`products.update` incluye el cambio de precio.** Editar la descripción de un
producto y cambiar su precio de venta son operaciones de riesgo muy distinto,
y hoy comparten permiso. Debería separarse en `products.update` y
`products.price.update`. No se hizo ahora porque implica decidir quién puede
cambiar precios en el almacén, que es una decisión del negocio y no técnica.

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
