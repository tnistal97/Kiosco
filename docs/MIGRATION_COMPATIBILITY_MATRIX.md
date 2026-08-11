# Compatibilidad de migraciones y vuelta atrás

> La pregunta concreta: **después de aplicar la migración N, ¿alcanza con volver
> el código, o hay que volver también la base?**
>
> Es la pregunta que hay que tener contestada **antes** del corte, porque el
> momento de responderla es a las tres de la mañana con el sistema caído.

## Las cuatro categorías

| Categoría                               | Qué significa                                                                                | Vuelta atrás                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **A — Compatible hacia atrás**          | El código viejo sigue funcionando contra el esquema nuevo.                                   | Volver el artefacto. Nada más.                   |
| **B — Rollback de código seguro**       | El código viejo no usa lo nuevo, pero tampoco se rompe. Quedan tablas y columnas que ignora. | Volver el artefacto. La base queda «adelantada». |
| **C — Rollback de base necesario**      | El código viejo se rompe contra el esquema nuevo.                                            | Restaurar el respaldo.                           |
| **D — Irreversible / transforma datos** | Se reescribieron o se borraron datos. Ni volviendo el esquema vuelve la información.         | **Solo** el respaldo previo.                     |

## El resumen que importa

De las 43 migraciones de la cadena:

| Categoría                          | Cuántas |
| ---------------------------------- | ------: |
| A — compatible hacia atrás         |       1 |
| B — rollback de código seguro      |      31 |
| **C — rollback de base necesario** |   **8** |
| **D — irreversible**               |   **3** |

**La primera D es `20260807100000_phase3_decimal_money`, la sexta de la cadena.**

A partir de ahí, y para todo el resto del despliegue, **la única vuelta atrás
real es restaurar el respaldo previo**. No hay un punto intermedio.

Eso simplifica el runbook en vez de complicarlo: no hay que decidir _cuánto_
volver. O el despliegue entero avanza, o el despliegue entero se restaura.

## La matriz

|      # | Migración                                         | Cat.  | Por qué                                                                                                                                                                                                                     |
| -----: | ------------------------------------------------- | :---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|      1 | `20250605201717_add_value_to_product`             |   A   | Ya aplicada en producción. Es el punto de partida.                                                                                                                                                                          |
|      2 | `20260806120000_phase0_security_baseline`         |   B   | Agrega columnas con `DEFAULT` y rellena `saleId` desde la descripción. El código viejo las ignora.                                                                                                                          |
|      3 | `20260806160000_phase1_audit_context`             |   B   | Columnas nuevas en `AuditLog`.                                                                                                                                                                                              |
|      4 | `20260806190000_phase2_product_active`            |   B   | `Product.isActive` con default `true`.                                                                                                                                                                                      |
|      5 | `20260806193000_phase2_cash_count_difference`     |   B   | Columnas calculadas en `CashCount`.                                                                                                                                                                                         |
|  **6** | **`20260807100000_phase3_decimal_money`**         | **D** | **`double precision` → `Decimal`. Reescribe cada importe del sistema.** El código viejo espera números; recibe cadenas decimales y suma mal, en silencio. Y la conversión **redondea**: los decimales sobrantes no vuelven. |
|      7 | `20260807110000_phase3_cash_shifts`               |   C   | `CashRegisterMovement.shiftId` pasa a ser obligatorio. El código viejo inserta sin turno y viola la restricción.                                                                                                            |
|      8 | `20260807120000_phase3_sale_payments`             |   C   | `Sale.total` `NOT NULL` y `SalePayment` nueva. El POS viejo crea ventas sin total.                                                                                                                                          |
|      9 | `20260807130000_phase3_stock_ledger`              |   C   | `StockMovement` con disparador que exige que el saldo cierre. El código viejo escribe `BranchStock` directo y el disparador lo rechaza.                                                                                     |
| **10** | **`20260807140000_phase3_fractional_quantities`** | **D** | **`integer` → `Decimal(14,3)` en cantidades.** Segunda reescritura de tabla.                                                                                                                                                |
|     11 | `20260807150000_phase3_product_units`             |   B   | Columnas de unidad con default.                                                                                                                                                                                             |
|     12 | `20260807160000_phase3_product_costs`             |   B   | `Product.cost` y su historial.                                                                                                                                                                                              |
|     13 | `20260807170000_phase3_product_barcodes`          |   B   | Crea `ProductBarcode` y **copia** los códigos. `Product.barcode` sigue ahí: el código viejo lo lee igual.                                                                                                                   |
|     14 | `20260808100000_phase3_suppliers`                 |   B   | Amplía `Supplier`, crea `ProductSupplier`.                                                                                                                                                                                  |
|     15 | `20260808110000_phase3_purchase_orders`           |   B   | Tablas nuevas.                                                                                                                                                                                                              |
|     16 | `20260808120000_phase3_purchase_receipts`         |   B   | Tablas nuevas + disparador de inmutabilidad.                                                                                                                                                                                |
|     17 | `20260808130000_phase3_purchase_cost_links`       |   B   | Columnas de enlace.                                                                                                                                                                                                         |
| **18** | **`20260808140000_phase3_remove_legacy_barcode`** | **D** | **`ALTER TABLE "Product" DROP COLUMN "barcode"`.** El dato vive en `ProductBarcode`, así que se puede reconstruir; **la columna no vuelve sola** y el código viejo la busca y no la encuentra.                              |
|     19 | `20260810100000_phase3d_branch_timezone`          |   B   | Columna con default `UTC`.                                                                                                                                                                                                  |
|     20 | `20260810110000_phase3d_sale_cost_snapshot`       |   B   | `SaleItem.costAtSale`, nullable.                                                                                                                                                                                            |
|     21 | `20260810120000_phase3d_cost_history_nullable`    |   B   | Afloja una restricción.                                                                                                                                                                                                     |
|     22 | `20260810130000_phase3d_drop_legacy_columns`      |   C   | Borra `Product.supplierId` y `Supplier.contact`. **Los datos se conservan** en `ProductSupplier` y `contactName`; el esquema, no.                                                                                           |
|  23–29 | Fase 4A — clientes y cuenta corriente             |   C   | Tablas nuevas + `Sale.clientId` + disparador de inmutabilidad del libro.                                                                                                                                                    |
|  30–34 | Fase 4B — cuentas por pagar                       |   C   | Ídem, del lado de proveedores.                                                                                                                                                                                              |
|  35–38 | Fase 4C — anticipos y devoluciones                |   B   | Tablas nuevas; el resto no las mira.                                                                                                                                                                                        |
|  39–43 | Fase 4D — lotes e inventario físico               |   B   | Tablas nuevas + columnas con default `'NONE'`.                                                                                                                                                                              |
|     43 | `20260814100000_phase5a_indices_de_lectura`       | **A** | Un índice. Se crea y se borra sin tocar un dato.                                                                                                                                                                            |

## Las tres irreversibles, en detalle

### `phase3_decimal_money` — la que define el punto de no retorno

```sql
ALTER TABLE "Product"  ALTER COLUMN "price" TYPE DECIMAL(14,2);
ALTER TABLE "SaleItem" ALTER COLUMN "price" TYPE DECIMAL(14,2);
ALTER TABLE "Branch"   ALTER COLUMN "currentCash" TYPE DECIMAL(14,2);
…
```

- **Reescribe la tabla entera** y toma `ACCESS EXCLUSIVE`.
- **Redondea a dos decimales.** El precheck confirmó que en producción no hay
  ningún valor con más de dos, así que hoy no se pierde nada. Eso es una
  propiedad de **estos** datos, no de la migración.
- Volver a `double precision` sería posible en el esquema; los centavos
  redondeados no vuelven.

### `phase3_fractional_quantities`

Mismo mecanismo con las cantidades: `integer` → `Decimal(14,3)`. Segunda —y
última— reescritura completa de tabla de la cadena.

### `phase3_remove_legacy_barcode`

```sql
DROP INDEX IF EXISTS "Product_barcode_key";
ALTER TABLE "Product" DROP COLUMN "barcode";
```

Es la única migración que **borra** una columna con datos. Está a seis pasos de
distancia de la que los copió (`phase3_product_barcodes`, #13), y esa separación
es a propósito: es un expand/contract hecho bien, salvo que las dos mitades
caen en el mismo despliegue.

## Expand / contract: dónde se cumple y dónde no

El patrón es **expandir → desplegar código compatible → validar → contraer más
tarde**. Esta cadena lo cumple en el diseño y **no** en el calendario: expand y
contract van en el mismo corte.

| Par                    | Expand                       | Contract                       | ¿Separados?                               |
| ---------------------- | ---------------------------- | ------------------------------ | ----------------------------------------- |
| Códigos de barras      | #13 copia a `ProductBarcode` | #18 borra `Product.barcode`    | **No.** Cinco migraciones, un solo corte. |
| Proveedor del producto | #14 crea `ProductSupplier`   | #22 borra `Product.supplierId` | **No.**                                   |
| Contacto del proveedor | #14 copia a `contactName`    | #22 borra `contact`            | **No.**                                   |

**¿Es un problema? Acá, no.** El motivo por el que expand/contract se separa en
el tiempo es poder volver el código sin volver la base. Eso **ya es imposible
desde la migración 6**, que es anterior a las tres. Separar los contracts en un
segundo despliegue no compraría ninguna reversibilidad que no se haya perdido
antes.

Y hay una razón más fuerte: **no hay código viejo que sostener**. La aplicación
está detenida. No existe una versión anterior conviviendo con la nueva.

**Dónde sí importaría:** en el _próximo_ despliegue, con el sistema en marcha.
De ahí en adelante, cada `DROP COLUMN` debería ir en un despliegue posterior al
que dejó de usarla. Queda como regla en
[`DATABASE_MIGRATION_STRATEGY.md`](DATABASE_MIGRATION_STRATEGY.md).

## Bloqueos y tablas grandes

Medido con `npm run rehearsal:prodlike`, clasificando el bloqueo desde el SQL:

| Migración                      | Volumen real |           20× | Bloqueo                            |
| ------------------------------ | -----------: | ------------: | ---------------------------------- |
| `phase3_sale_payments`         |       113 ms | **31.119 ms** | `ACCESS EXCLUSIVE`                 |
| `phase1_audit_context`         |        61 ms |      1.531 ms | `ACCESS EXCLUSIVE`                 |
| `phase3_decimal_money`         |        46 ms |        186 ms | `ACCESS EXCLUSIVE` — **reescribe** |
| `phase0_security_baseline`     |        35 ms |        321 ms | `ACCESS EXCLUSIVE`                 |
| `phase3_fractional_quantities` |        25 ms |        113 ms | `ACCESS EXCLUSIVE` — **reescribe** |
| **Cadena completa**            |    **1,7 s** |    **35,2 s** |                                    |

**`phase3_sale_payments` crece de forma cuadrática**: veinte veces el volumen,
doscientas setenta y cinco veces el tiempo. La causa está identificada —el
relleno de `Sale.total` recorre `SaleItem` entero por cada venta, porque
PostgreSQL no indexa las claves foráneas— y **no se corrigió en esa migración**,
a propósito: cambiar su checksum haría que `migrate deploy` se niegue a seguir
en desarrollo, pruebas y el ensayo, y en producción son 113 ms.

El índice que faltaba se agrega al final de la cadena (#43). No mejora la
ventana; elimina el costo permanente.

**Umbral:** con la base actual, la cadena entera son ~2 segundos. Si algún día
llegara a 20× —unas 22.000 ventas— el corte pasaría a ~35 s, que sigue siendo
aceptable. El día que se acerque a 100×, hay que revisar aquella migración
antes de correrla.

## Cómo se decide volver atrás

```
¿Falló ANTES de la migración 6?
   → volver el artefacto. La base queda como estaba.

¿Falló EN o DESPUÉS de la 6?
   → restaurar el respaldo previo. Siempre. Sin excepciones.
     No hay un rollback parcial que sirva.
```

Los bloques `DOWN` comentados al pie de cada migración **existen y sirven para
leer**, no para ejecutar a ciegas. Se ejecutaron de verdad una vez, contra una
base descartable, en la Fase 4D: los objetos de esa fase se quitaron y se
volvieron a aplicar, con cero residuos. Eso demuestra que están bien escritos.
**No** demuestra que ejecutarlos sobre producción sea buena idea: el respaldo lo
es más.
