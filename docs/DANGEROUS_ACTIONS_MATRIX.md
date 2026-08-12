# Acciones peligrosas

> Todo lo que puede hacer perder dinero, mercadería o rastro. Para cada una:
> qué permiso hace falta, si pide confirmación, si exige motivo, si queda en la
> bitácora y **si se puede deshacer**.
>
> La columna que más se mira es la última. Una acción irreversible con
> confirmación floja es peor que una reversible sin ninguna.

## Cómo leer la reversibilidad

|                  |                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| **Reversible**   | Hay una operación inversa en el sistema y deja las dos huellas.                                         |
| **Compensable**  | No se deshace: se corrige con un movimiento nuevo, y quedan los dos. Es lo normal en un libro contable. |
| **Irreversible** | No hay vuelta desde la aplicación. Solo el respaldo.                                                    |

Este sistema **casi no borra nada**. Es deliberado: un registro que desaparece
no se puede auditar. Casi todo lo destructivo está construido como
«compensable», y donde no se pudo, está dicho.

## La matriz

### Ventas y caja

| Acción                                        | Permiso                                                         | Confirma |              Motivo               |       Bitácora        | Reversibilidad                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------- | :------: | :-------------------------------: | :-------------------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| Anular una venta<br>`DELETE /api/sales/:id`   | `sales.cancel`                                                  |    sí    |          **obligatorio**          | sí, con antes/después | **Compensable.** La venta pasa a `canceled`; no se borra. Devuelve el stock, revierte la caja y el fiado. **No se puede des-anular.** |
| Vender a cuenta por encima del límite         | `accounts.overrideLimit`                                        |    sí    |                sí                 |          sí           | Compensable con un cobro.                                                                                                             |
| Movimiento de caja manual<br>`POST /api/cash` | `cash.movement.create`                                          |    sí    |          **obligatorio**          |          sí           | **Compensable**: se corrige con otro movimiento de signo contrario. Los dos quedan.                                                   |
| Cerrar turno con diferencia                   | `cash.shift.close` + `cash.shift.authorize` si supera el umbral |    sí    | **obligatorio** si hay diferencia |          sí           | **Irreversible.** Un turno cerrado no se reabre.                                                                                      |
| Cerrar el turno de otra persona               | `cash.shift.close.other`                                        |    sí    |                sí                 |          sí           | Irreversible.                                                                                                                         |

**La anulación es la acción más peligrosa del sistema y la mejor protegida.**
Toca cuatro cosas a la vez —stock, caja, cuenta corriente y lotes— y todo pasa
en una transacción. El motivo es obligatorio en el servidor, no solo en la
pantalla.

### Catálogo

| Acción                                                  | Permiso                 | Confirma | Motivo |         Bitácora          | Reversibilidad                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------- | :------: | :----: | :-----------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cambiar precio                                          | `products.price.update` |    no    |   no   |   sí, con antes/después   | **Reversible**: se vuelve a poner el anterior. Las ventas viejas **no** cambian: el precio queda congelado en `SaleItem`.                                              |
| Cambiar costo<br>`PUT /api/products/:id/cost`           | `products.cost.update`  |    no    |   no   | sí + `ProductCostHistory` | **Compensable.** El historial de costos es **inmutable**: corregir agrega una fila, no reescribe.                                                                      |
| Dar de baja un producto                                 | `products.update`       |    sí    |   no   |            sí             | **Reversible**: se reactiva.                                                                                                                                           |
| Borrar un producto<br>`DELETE /api/products/:id`        | `products.delete`       |    sí    |   no   |            sí             | **Irreversible.** Solo si nunca se vendió, no tiene movimientos y no tiene historial de costos: en cualquier otro caso el sistema **se niega** y ofrece darlo de baja. |
| Cambiar la unidad de venta                              | `products.update`       |    sí    |   no   |            sí             | **Irreversible** una vez que hay cantidades guardadas. El sistema lo bloquea (`PRODUCT_UNIT_LOCKED`): cambiarla reescribiría el significado del pasado.                |
| Alta rápida desde la caja<br>`POST /api/products/quick` | `products.quickCreate`  |    no    |   no   |   sí + `StockMovement`    | **Compensable**: se da de baja el producto y se ajusta el stock. No se borra si ya se vendió. El movimiento `INITIAL` queda en el libro y **no se puede borrar**.      |

### Stock

| Acción                              | Permiso                   | Confirma |                Motivo                |             Bitácora              | Reversibilidad                                                                                        |
| ----------------------------------- | ------------------------- | :------: | :----------------------------------: | :-------------------------------: | ----------------------------------------------------------------------------------------------------- |
| Ajuste manual de stock              | `stock.adjust`            |    sí    | **obligatorio** (`CHECK` en la base) |       sí + `StockMovement`        | **Compensable**: otro ajuste. El libro conserva los dos.                                              |
| Merma / rotura                      | `stock.adjust`            |    sí    |           **obligatorio**            |       sí + `StockMovement`        | Compensable.                                                                                          |
| Aplicar un inventario físico        | `inventoryCounts.apply`   |    sí    |                  sí                  | sí + un `StockMovement` por línea | **Irreversible.** No se «des-aplica»: se cuenta de nuevo.                                             |
| Elegir el lote a mano (FEFO manual) | `lots.adjust`             |    sí    |                  sí                  |                sí                 | Compensable con un ajuste.                                                                            |
| **Aflojar el rastreo de lotes**     | **`lots.tracking.relax`** |    sí    |                  no                  |       sí, con antes/después       | **Reversible** en la política; **no** en sus efectos: mientras estuvo floja, entró stock sin partida. |

**El renglón nuevo de la Fase 5A.** Hasta 4D, aflojar el rastreo lo podía hacer
cualquiera con `lots.manage` —incluido compras—. Se separó por dirección:
endurecer sigue en `lots.manage`, aflojar exige el permiso nuevo, que compras no
tiene. Ver [`PERMISSIONS_MATRIX.md`](PERMISSIONS_MATRIX.md).

### Compras y proveedores

| Acción                           | Permiso                     | Confirma |     Motivo      | Bitácora | Reversibilidad                                                                                                                                           |
| -------------------------------- | --------------------------- | :------: | :-------------: | :------: | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancelar una orden               | `purchases.cancel`          |    sí    |       sí        |    sí    | **Compensable.** Solo si no tiene recepciones.                                                                                                           |
| Confirmar una recepción          | `purchases.receive`         |    sí    |       no        |    sí    | **Irreversible.** Entra stock, fija costo y genera deuda. Se corrige con una devolución, no deshaciéndola. Hay un **disparador** que impide modificarla. |
| Confirmar una devolución         | `purchaseReturns.confirm`   |    sí    | **obligatorio** |    sí    | **Irreversible.** Saca stock y genera crédito.                                                                                                           |
| Pagar a un proveedor             | `supplierAccounts.payment`  |    sí    |       sí        |    sí    | **Compensable** con una anulación de pago, que deja las dos entradas.                                                                                    |
| Sobrepagar (generar anticipo)    | `supplierAccounts.overpay`  |    sí    |       sí        |    sí    | Compensable.                                                                                                                                             |
| Imputar un pago a mano           | `supplierAccounts.allocate` |    sí    |       sí        |    sí    | Compensable: se desimputa y se vuelve a imputar.                                                                                                         |
| Ajustar el saldo de un proveedor | `supplierAccounts.adjust`   |    sí    | **obligatorio** |    sí    | Compensable. **Es la puerta de atrás del libro de proveedores**: cambia un saldo sin una operación real detrás.                                          |

### Clientes

| Acción                            | Permiso            | Confirma |     Motivo      | Bitácora | Reversibilidad                                                                        |
| --------------------------------- | ------------------ | :------: | :-------------: | :------: | ------------------------------------------------------------------------------------- |
| Ajustar el saldo de un cliente    | `accounts.adjust`  |    sí    | **obligatorio** |    sí    | Compensable. Misma advertencia que el de proveedores.                                 |
| Anular un cobro                   | `accounts.payment` |    sí    | **obligatorio** |    sí    | Compensable.                                                                          |
| Cambiar el límite de crédito      | `clients.manage`   |    no    |       no        |    sí    | Reversible.                                                                           |
| Habilitar o deshabilitar el fiado | `clients.manage`   |    sí    |       no        |    sí    | Reversible.                                                                           |
| Borrar un cliente                 | `clients.manage`   |    sí    |       no        |    sí    | **Irreversible**, y solo si no tiene movimientos. Con historial, el sistema se niega. |

### Usuarios y configuración

| Acción                                 | Permiso           | Confirma | Motivo |       Bitácora        | Reversibilidad                                                                          |
| -------------------------------------- | ----------------- | :------: | :----: | :-------------------: | --------------------------------------------------------------------------------------- |
| Crear o editar un usuario              | `users.manage`    |    sí    |   no   |          sí           | Reversible.                                                                             |
| Cambiar el rol de un usuario           | `users.manage`    |    sí    |   no   | sí, con antes/después | Reversible. **Es la acción más potente del sistema**: da cualquier otro permiso.        |
| Dar de baja un usuario                 | `users.manage`    |    sí    |   no   |          sí           | Reversible. Cierra sus sesiones.                                                        |
| Cambiar la zona horaria de la sucursal | `branches.manage` |    sí    |   no   |          sí           | Reversible en la configuración; **no** en los informes ya emitidos, que cambian de día. |

### Por qué el alta rápida es de riesgo BAJO

Crea un producto y declara un saldo de partida. Las dos cosas son visibles y
compensables, y ninguna toca dinero ni historial ajeno:

- el producto se da de baja si se cargó por error;
- el stock declarado se corrige con un ajuste, y los dos movimientos quedan;
- el precio inicial se puede cambiar —con `products.price.update`— y las ventas
  ya hechas conservan el suyo, congelado en `SaleItem`.

Lo que **no** puede hacer, y por eso no sube de escalón: no carga costo sin
`products.cost.update`, no toca lotes, no elige sucursal y no puede pisar un
producto que ya existe. Ver
[POS_QUICK_PRODUCT_CREATE.md](POS_QUICK_PRODUCT_CREATE.md).

## Los tres controles que no son permisos

Valen más que la matriz de arriba, porque no dependen de que alguien elija bien:

1. **Disparadores de inmutabilidad.** Cuatro tablas —el libro de cuenta
   corriente, el de proveedores, las recepciones y el historial de costos— tienen
   disparadores que **rechazan** `UPDATE` y `DELETE` en la base. No hay permiso
   que los saltee, ni desde la aplicación ni desde `psql`.
2. **Reconciliación.** `npm run integrity:check` recorre 23 invariantes y dice si
   los saldos explican sus libros. Una manipulación directa en la base aparece acá.
3. **Bitácora obligatoria.** Toda acción de esta matriz escribe en `AuditLog`
   dentro de la misma transacción. Si falla el registro, falla la operación.

## Lo que sigue sin estar cubierto

- **Un administrador puede hacer todo.** No hay doble aprobación para ninguna
  acción. Con un solo usuario en producción, hoy es la situación real.
- **Borrar el último movimiento y ajustar el saldo** deja la reconciliación
  cuadrada. Lo tapa el disparador, no la reconciliación. Es el punto ciego
  documentado desde la Fase 4B.
- **`lots.adjust` deja pasar por encima de FEFO** en cada venta. Queda auditado,
  pero es una decisión por operación y nadie la revisa después.
- **No hay límite de importe** para ningún ajuste. Un ajuste de saldo de un
  millón pide lo mismo que uno de cien pesos: motivo y permiso.
