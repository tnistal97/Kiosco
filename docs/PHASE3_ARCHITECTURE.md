# La arquitectura de la Fase 3, de una mirada

> Un índice. Cada pieza tiene su propio documento con el porqué; esto dice cómo
> encajan y en qué orden aparecieron.

## El sistema, en un diagrama

```
COMPRAS                          VENTAS
Proveedor                        Producto
  → Orden de compra                → Venta
    → Recepción                      → Pagos
      → StockMovement                  → Movimiento de caja
        → BranchStock                    → Turno
          → Product.cost                   → Arqueo
            → ProductCostHistory             → Cierre
                    │                            │
                    └──────────┬─────────────────┘
                               ▼
                            CONTROL
                     AuditLog · Reconciliación · Reportes
```

## Las cuatro subfases

|        | Qué construyó                                                                              | Documento                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **3A** | El inventario deja de ser un número y pasa a ser el saldo de un libro inmutable            | [INVENTORY_LEDGER.md](INVENTORY_LEDGER.md)                                                                                               |
| **3B** | El producto sabe en qué unidad se vende y se compra, cuánto cuesta, y tiene varios códigos | [PHASE3_QUANTITY_MIGRATION.md](PHASE3_QUANTITY_MIGRATION.md), [PHASE3_BARCODES.md](PHASE3_BARCODES.md)                                   |
| **3C** | Proveedores, órdenes y recepción: la mercadería entra por algún lado                       | [SUPPLIER_MODEL.md](SUPPLIER_MODEL.md), [PURCHASE_FLOW.md](PURCHASE_FLOW.md), [PURCHASE_RECEIVING.md](PURCHASE_RECEIVING.md)             |
| **3D** | El sistema **cierra**, y se puede demostrar                                                | [PHASE3_RECONCILIATION.md](PHASE3_RECONCILIATION.md), [REPORTING_MODEL.md](REPORTING_MODEL.md), [TIMEZONE_POLICY.md](TIMEZONE_POLICY.md) |

Antes de las cuatro, la Fase 3 propiamente dicha llevó el dinero a `Decimal`
([PHASE3_MONEY_MIGRATION.md](PHASE3_MONEY_MIGRATION.md)), creó los turnos de caja
([CASH_SHIFT_MODEL.md](CASH_SHIFT_MODEL.md)) y separó los pagos de la venta.

## Las cinco puertas únicas

El sistema tiene cinco lugares por los que **tiene** que pasar cierta escritura,
y ninguno se puede saltear:

| Puerta                         | Qué protege                                      | Cómo se garantiza                                |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `applyStockMovement`           | Nadie más escribe `BranchStock`                  | Regla de ESLint                                  |
| `registrarCambioDeCosto`       | Nadie más escribe `Product.cost` ni el historial | Bloqueo `FOR UPDATE` + convención                |
| `handler`                      | Toda ruta declara su permiso                     | `tests/authorization/permissions-matrix.test.ts` |
| `audit`                        | La bitácora tiene una sola forma                 | Convención + pruebas                             |
| `rangoDeSucursal`              | Todo filtro por fecha usa la zona del local      | [TIMEZONE_POLICY.md](TIMEZONE_POLICY.md)         |
| `applyAccountMovement`         | Nadie más escribe `Client.balance`               | Regla de ESLint (Fase 4A)                        |
| `applySupplierAccountMovement` | Nadie más escribe `Supplier.balance`             | Regla de ESLint (Fase 4B)                        |

> **Sexta puerta, Fase 4A.** El saldo de un cliente sigue la misma regla que el
> stock: no se escribe, se mueve. Ver
> [CUSTOMER_ACCOUNT_LEDGER.md](CUSTOMER_ACCOUNT_LEDGER.md).
>
> **Séptima puerta, Fase 4B.** Y lo que le debemos a un proveedor, también:
> mismo diseño, mismo vocabulario, el signo mirando para el otro lado. Ver
> [SUPPLIER_ACCOUNT_LEDGER.md](SUPPLIER_ACCOUNT_LEDGER.md).
>
> Y `rangoDeSucursal` resultó tener una segunda mitad que la Fase 3D no cubrió:
> calcular bien el rango no alcanza si la comparación en SQL lo convierte con la
> zona de la sesión. Ver la corrección al principio de
> [TIMEZONE_POLICY.md](TIMEZONE_POLICY.md).

## Lo que la base garantiza por sí sola

No todo se defiende en el código. Estas reglas viven en PostgreSQL y siguen
valiendo aunque alguien escriba con `psql`:

- El libro de inventario y el historial de costos **no se editan ni se borran**
  (disparadores).
- Una recepción confirmada tampoco (disparador).
- `previousQuantity + quantity = resultingQuantity` (`CHECK`).
- `receivedQuantity <= orderedQuantity` (`CHECK`).
- `stockQuantity = round(receivedQuantity × unitsPerPurchaseUnit, 3)` (`CHECK`).
- Un producto tiene **un** código principal y **un** proveedor principal
  (índices únicos parciales).
- Una sucursal tiene **un** turno abierto (índice único parcial).
- El número de orden sale de una **secuencia**, no de `count() + 1`.

Desde la Fase 4A, además:

- El libro de cuenta corriente y los cobros **no se editan ni se borran**
  (disparadores).
- `previousBalance + amount = resultingBalance` (`CHECK`).
- Un pago no puede aumentar la deuda, ni un cargo bajarla (`CHECK` de tipo y
  signo).
- Un ajuste manual **sin motivo** no se puede escribir (`CHECK`).
- Cada tipo de movimiento apunta a lo que le corresponde y a nada más: una
  venta, un cobro, o ninguno de los dos (`CHECK`).
- `ACCOUNT` es válido en `SalePayment` y **rechazado** en `CashRegisterMovement`
  y en `CustomerPayment` (`CHECK`).
- El número de comprobante sale de una **secuencia**.

## Cómo se comprueba que todo eso es cierto

```bash
npm run integrity:check
```

Diecisiete invariantes —nueve de la Fase 3, cuatro de cuenta corriente y cuatro
de cuentas por pagar—, calculadas
**por otro camino** que el que las escribió: SQL
sobre las tablas contra `Decimal.js` en la aplicación. Sólo lectura, sin
corregir nada. Ver [INTEGRITY_CHECK.md](INTEGRITY_CHECK.md).

## Las preguntas que la Fase 3 puede responder

| Pregunta                                                   | Respuesta                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| ¿Puede perder stock sin dejar movimiento?                  | No: `applyStockMovement` es la única puerta y hay regla de ESLint |
| ¿Puede una venta no coincidir con sus pagos?               | No: se comprueba al cobrar y lo verifica la reconciliación        |
| ¿Puede una transferencia aumentar el efectivo?             | No: un movimiento por medio de pago, y el turno suma sólo `CASH`  |
| ¿Se puede modificar una recepción?                         | No: disparador `BEFORE UPDATE OR DELETE`                          |
| ¿Se puede modificar un `StockMovement`?                    | No: mismo mecanismo                                               |
| ¿Puede cambiar el costo histórico de una venta?            | No: `costAtSale` congelado en la línea                            |
| ¿Puede el reporte cambiar de día por el huso del servidor? | No: `Branch.timeZone`                                             |
| ¿Puede recibirse más de lo pedido?                         | No: `UPDATE` condicional + `CHECK`                                |

El detalle de cada mecanismo, con su prueba, está en el informe de cierre de la
Fase 3.
