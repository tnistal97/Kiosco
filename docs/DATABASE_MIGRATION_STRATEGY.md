# Estrategia de migraciones

> Todo lo que dice este documento está comprobado por
> [`tests/migrations/chain.test.ts`](../tests/migrations/chain.test.ts), que
> crea bases descartables, aplica las migraciones con el mismo comando que se
> usaría en el servidor y verifica el resultado. No es un plan sobre papel.

## El problema que había

El historial tenía siete migraciones y **no se podía aplicar de principio a
fin**. Comprobado:

```
Applying migration `20250529182757_add_branch_product_unique`
...
Applying migration `20250605201717_add_value_to_product`
Error: P3018
ERROR: relation "Branch" already exists
```

La causa: pese a su nombre, `20250605201717_add_value_to_product` no agrega
una columna. Es un `CREATE TABLE` de las trece tablas del esquema completo.
En algún momento entre el 29 de mayo y el 5 de junio de 2025 el historial se
reinició en el servidor y esa migración quedó como la baseline real. Las seis
de mayo crean las mismas tablas antes, así que la baseline choca con ellas.

Consecuencia práctica: **no había forma de levantar una base de cero**. Quien
quisiera un entorno nuevo tenía que aplicar un `.sql` a mano.

## La solución

Separar el registro histórico de la cadena que se ejecuta.

```
prisma/migrations/           ← la cadena oficial. Se aplica de principio a fin.
prisma/migrations-legacy/    ← registro histórico. NO se ejecuta nunca.
```

No se borra nada: las seis migraciones de mayo documentan cómo evolucionó el
esquema y esa información no se recupera después.

### Cadena oficial

| Orden | Migración                                     | Qué hace                                                                                                                             |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | `20250605201717_add_value_to_product`         | **Baseline.** Crea las trece tablas. Es lo que hay hoy en el servidor.                                                               |
| 2     | `20260806120000_phase0_security_baseline`     | Fase 0. `User.isActive`, `sessionVersion`, estado de anulación de ventas, `CashRegisterMovement.saleId`, dos CHECK y cuatro índices. |
| 3     | `20260806160000_phase1_audit_context`         | Fase 1. `AuditLog.branchId`, `requestId`, `ip`, `reason`, `result`, un CHECK y tres índices.                                         |
| 4     | `20260806190000_phase2_product_active`        | Fase 2. `Product.isActive` y su índice.                                                                                              |
| 5     | `20260806193000_phase2_cash_count_difference` | Fase 2. `CashCount.expected` y `CashCount.difference`, calculados por el servidor.                                                   |
| 6     | `20260807100000_phase3_decimal_money`         | Fase 3. **La única no aditiva.** Siete columnas de `double precision` a `numeric(14,2)`. Ver PHASE3_MONEY_MIGRATION.md.              |
| 7     | `20260807110000_phase3_cash_shifts`           | Fase 3. `CashShift`, dos índices únicos parciales, `shiftId` en movimientos y arqueos, turno `legacy` para lo anterior.              |
| 8     | `20260807120000_phase3_sale_payments`         | Fase 3. `Sale.total`, `SalePayment`, un pago por venta histórica, vocabulario único de medios de pago.                               |
| 9     | `20260807130000_phase3_stock_ledger`          | Fase 3A. `StockMovement` con disparador de inmutabilidad, `Product.minimumStock`, un `INITIAL` por saldo existente.                  |
| 10    | `20260807140000_phase3_fractional_quantities` | Fase 3B. **No aditiva.** Seis columnas de `INTEGER` a `numeric(14,3)`. Ver PHASE3_QUANTITY_MIGRATION.md.                             |
| 11    | `20260807150000_phase3_product_units`         | Fase 3B. `saleUnit`, `purchaseUnit`, `unitsPerPurchaseUnit` y el disparador que congela la unidad de venta.                          |
| 12    | `20260807160000_phase3_product_costs`         | Fase 3B. `Product.cost` y `ProductCostHistory`, inmutable por disparador.                                                            |
| 13    | `20260807170000_phase3_product_barcodes`      | Fase 3B. `ProductBarcode`, índice único parcial del principal, migración de los códigos existentes.                                  |
| 14    | `20260808100000_phase3_suppliers`             | Fase 3C. Datos del proveedor, `ProductSupplier` y migración de `Product.supplierId`.                                                 |
| 15    | `20260808110000_phase3_purchase_orders`       | Fase 3C. `PurchaseOrder`, `PurchaseOrderItem`, la secuencia de numeración y el `CHECK` que impide la sobre-recepción.                |
| 16    | `20260808120000_phase3_purchase_receipts`     | Fase 3C. `PurchaseReceipt` y sus líneas, inmutables por disparador.                                                                  |
| 17    | `20260808130000_phase3_purchase_cost_links`   | Fase 3C. `ProductCostHistory.purchaseId` → `receiptId`, con su clave foránea.                                                        |
| 18    | `20260808140000_phase3_remove_legacy_barcode` | Fase 3C. **Destructiva.** Borra `Product.barcode`, congelada desde la 3B.                                                            |

**Dos no son aditivas, y las dos están señaladas.** Todas las demás agregan y
no tocan lo que ya había, así que el código anterior sigue funcionando sobre el
esquema nuevo. La del dinero exige desplegar el código PRIMERO y la migración
después; está explicado en `PHASE3_MONEY_MIGRATION.md` y no se repite acá.

### La única destructiva, y por qué se le permitió

`20260808140000_phase3_remove_legacy_barcode` borra una columna. Es la única de
las dieciocho que lo hace, y sólo pudo hacerlo porque:

1. la columna **dejó de usarse una fase antes** (regla 2, abajo);
2. la migración **aborta** si algún código de barras vive únicamente ahí;
3. figura en la lista `DESTRUCTIVAS_PERMITIDAS` de
   [`tests/migrations/chain.test.ts`](../tests/migrations/chain.test.ts), con
   su motivo escrito.

La lista es explícita a propósito: agregar una migración destructiva obliga a
escribir por qué, que es exactamente la conversación que tiene que ocurrir
antes de borrar una columna en un servidor con datos.

> **La guardia tenía un agujero, y esta migración lo encontró.** La expresión
> que buscaba sentencias peligrosas estaba anclada al principio de la línea
> (`^\s*DROP\s+COLUMN`), y PostgreSQL sólo acepta
> `ALTER TABLE "Product" DROP COLUMN "barcode"` — que empieza con `ALTER`. La
> prueba dejaba pasar precisamente el caso para el que existía. Se corrigió en
> la Fase 3C.

### Columnas congeladas

Una columna que dejó de usarse pero todavía no se borró está marcada
`/// CONGELADA` en `schema.prisma`. Hoy queda una:

| Columna                  | Reemplazo                       | Muere en                      |
| ------------------------ | ------------------------------- | ----------------------------- |
| ~~`Product.supplierId`~~ | `ProductSupplier`               | **borrada en la Fase 3D**     |
| ~~`Supplier.contact`~~   | `contactName`, `phone`, `email` | **borrada en la Fase 3D**     |
| `Product.value`          | ninguno: nunca significó nada   | sin fecha; no molesta a nadie |

`tests/unit/columnas-muertas.test.ts` comprueba que no se escriban, y también
que **toda columna marcada `CONGELADA` figure en esa prueba**: congelar una y
olvidarse de anotarla dejaría el agujero que la prueba existe para tapar.

### Archivadas

`20250529181604_init`, `20250529182757_add_branch_product_unique`,
`20250529183734_change_email_to_username`,
`20250529183930_make_branch_name_unique`,
`20250529211308_add_categories_and_product_data`,
`20250529211833_add_unique_supplier_name`.

Están registradas como aplicadas en la base del servidor. `migrate status`
las lista como _"not found locally"_, que es informativo y **no bloquea**
`migrate deploy` — comprobado en la prueba de "servidor existente".

## Instalación nueva

```bash
createdb kiosco_dev
DATABASE_URL='postgresql://usuario:clave@127.0.0.1:5433/kiosco_dev?schema=public' npx prisma migrate deploy
npx prisma generate
```

Eso es todo. Antes hacía falta un `migrate resolve --applied` por cada una de
las seis migraciones de mayo antes de poder correr `deploy`.

## Servidor existente

**Ninguno de estos pasos se ejecutó contra producción.** Están verificados
sobre una copia estructural con datos ficticios.

### 1. Antes de tocar nada

```bash
pg_dump --format=custom --file=kiosco-$(date +%Y%m%d-%H%M).dump kiosco
```

Comprobar que el archivo existe y **que se puede restaurar**, en otra base:

```bash
createdb kiosco_prueba_restore
pg_restore --dbname=kiosco_prueba_restore kiosco-AAAAMMDD-HHMM.dump
```

Un respaldo que nunca se restauró no es un respaldo.

### 2. Ver qué falta aplicar

```bash
npx prisma migrate status
```

Esperado:

```
The last common migration is: 20250605201717_add_value_to_product

The migrations have not yet been applied:
20260806120000_phase0_security_baseline
20260806160000_phase1_audit_context

The migrations from the database are not found locally in prisma/migrations:
20250529181604_init
...
```

Las seis últimas líneas son normales: son las archivadas.

### 3. Ensayar sobre la copia

```bash
createdb kiosco_ensayo
pg_restore --dbname=kiosco_ensayo kiosco-AAAAMMDD-HHMM.dump
DATABASE_URL='...kiosco_ensayo' npx prisma migrate deploy
DATABASE_URL='...kiosco_ensayo' npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma --exit-code
```

El último comando debe decir `No difference detected`. Si dice otra cosa, hay
deriva entre el esquema y las migraciones: **parar acá**.

### 4. Comprobar el relleno de datos

Las dos migraciones nuevas rellenan columnas a partir de lo que ya existe.
Sobre la copia, verificar que salió bien:

```sql
-- Fase 0: cada movimiento de venta debe haber quedado vinculado a su venta.
SELECT count(*) FILTER (WHERE "saleId" IS NULL) AS sin_vincular,
       count(*)                                 AS total
FROM "CashRegisterMovement" WHERE type = 'sale';

-- Fase 1: ninguna entrada de auditoría debería quedar sin sucursal.
SELECT count(*) FROM "AuditLog" WHERE "branchId" IS NULL;
```

`sin_vincular` puede ser mayor que cero si algún movimiento antiguo tenía una
descripción que no seguía el formato `Venta #N`. Es aceptable: son datos
históricos y el vínculo no existía. Anotar cuántos son.

### 5. Aplicar

Fuera del horario de atención, con el sitio detenido:

```bash
DATABASE_URL='...produccion' npx prisma migrate deploy
npx prisma generate
npm run build
```

### 6. Verificar antes de abrir

```bash
npx prisma migrate status   # sin pendientes
```

Y comprobar que el middleware está en el build, que es lo que la Fase 0
arregló y no debe perderse:

```bash
grep -o '"middleware"' .next/server/middleware-manifest.json
```

## Si algo sale mal

Las dos migraciones son **aditivas**: no borran columnas, no borran filas, no
cambian tipos. Una prueba lo verifica leyendo el SQL y buscando `DROP TABLE`,
`DROP COLUMN`, `TRUNCATE` y `DELETE FROM` fuera de comentarios.

Eso significa que **la aplicación anterior sigue funcionando** sobre el
esquema nuevo: las columnas que agrega simplemente no las usa. La vuelta atrás
es volver a desplegar el código anterior, sin tocar la base.

Si aun así hay que revertir el esquema, cada migración tiene su bloque `DOWN`
escrito y comentado al final del archivo. Prisma no lo ejecuta: hay que
copiarlo y correrlo a mano, sobre una base restaurada del respaldo.

### Si `migrate deploy` falla a mitad de camino

Prisma marca la migración como fallida y se niega a seguir hasta resolverlo.
El procedimiento es:

1. Leer el error. Anotarlo entero.
2. **Restaurar del respaldo.** No intentar arreglar la base a mano.
3. Reproducir el fallo sobre la copia, corregir la migración, ensayar de nuevo.

`prisma migrate resolve --rolled-back <nombre>` solo marca la migración como
revertida en el registro; **no deshace lo que ya escribió**. Usarlo sin
restaurar deja la base en un estado que nadie puede describir.

## Reglas para las migraciones que vengan

1. **Aditivas por defecto.** Agregar una columna con valor por defecto o que
   admita null no rompe la versión anterior del código.
2. **Nunca borrar en la misma migración que deja de usar algo.** Primero deja
   de escribirse, se despliega, se comprueba, y recién después se borra la
   columna. Entre las dos cosas tiene que haber al menos un despliegue.
3. **Un `DOWN` comentado al final.** Aunque Prisma no lo use.
4. **Idempotente donde se pueda.** `IF NOT EXISTS`, y los `ALTER` envueltos en
   un `DO $$ ... END $$` que compruebe antes. Una migración que se puede
   correr dos veces sin romper nada es una migración que se puede reintentar.
5. **El relleno de datos va en la misma migración que la columna.** Una
   columna nueva vacía que alguien va a completar después nunca se completa.
6. **Probarla desde cero y sobre una copia con datos.** Las dos pruebas están
   automatizadas; agregar el caso nuevo a `tests/migrations/chain.test.ts`.
7. **Append-only: una migración aplicada no se edita.** Cambiarla altera su
   checksum y deja la base de cualquiera que ya la haya corrido en un estado
   que Prisma no reconoce. Si hace falta corregir algo, va en una migración
   nueva. La Fase 4A lo aprendió dos veces: el vínculo de la caja con el cobro
   y la ampliación de los medios de pago tuvieron que salir aparte de las
   migraciones que conceptualmente los contenían.
8. **Una restricción que se borra se vuelve a poner en la misma migración.**
   `DROP CONSTRAINT` no borra datos —por eso no está en la lista de
   destructivas— pero puede borrar una **garantía**. Ampliar una lista blanca
   se escribe necesariamente como `DROP` + `ADD` con el mismo nombre, y eso es
   legítimo; un `DROP` suelto no lo es. Lo comprueba
   `tests/migrations/chain.test.ts`, que exige el `ADD` correspondiente.

### Las migraciones de la Fase 4A

Seis, separadas por dominio y en el orden en que se pueden aplicar: cada una
sólo referencia lo que las anteriores ya crearon.

| Migración                     | Qué hace                                           |
| ----------------------------- | -------------------------------------------------- |
| `phase4_clients`              | La tabla `Client`                                  |
| `phase4_sale_client`          | `Sale.clientId`, nullable                          |
| `phase4_customer_payments`    | `CustomerPayment` y su secuencia                   |
| `phase4_customer_accounts`    | El libro, sus cinco `CHECK` y los dos disparadores |
| `phase4_cash_payment_link`    | `CashRegisterMovement.customerPaymentId`           |
| `phase4_sale_payment_account` | Amplía los medios de `SalePayment` con `ACCOUNT`   |

**Ninguna es destructiva.** Las cinco primeras son puramente aditivas; la sexta
reemplaza una lista blanca por una más amplia, y ninguna fila existente puede
dejar de cumplirla.

### Las migraciones de la Fase 4B

Cinco, con el mismo criterio: separadas por dominio y en orden de dependencia.

| Migración                     | Qué hace                                              |
| ----------------------------- | ----------------------------------------------------- |
| `phase4b_supplier_balance`    | `Supplier.balance` y `defaultPaymentTermDays`         |
| `phase4b_receipt_obligation`  | `PurchaseReceipt.total`, `dueDate` y `debtRecorded`   |
| `phase4b_supplier_payments`   | `SupplierPayment`, su secuencia y el vínculo con caja |
| `phase4b_supplier_accounts`   | El libro, sus cuatro `CHECK` y los dos disparadores   |
| `phase4b_payment_allocations` | `SupplierPaymentAllocation` y su disparador           |

**Ninguna inventa deuda histórica.** Es el objetivo 36 y la decisión segura: una
entrega de hace seis meses casi con seguridad ya se pagó. Ver
[`ACCOUNTS_PAYABLE_POLICY.md`](ACCOUNTS_PAYABLE_POLICY.md).

#### La segunda migración tuvo que apagar un disparador

`PurchaseReceipt` es inmutable desde la Fase 3C, y el primer intento de rellenar
`total` murió contra su disparador — que es exactamente lo que se le pide a un
disparador. La migración lo apaga, rellena, y lo reemplaza por uno nuevo que
congela la fila **entera menos `dueDate`**:

```sql
IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'dueDate') = (to_jsonb(OLD) - 'dueDate')
```

Comparar la fila entera y no una lista de columnas es deliberado: **falla
cerrado**. La columna que alguien agregue el año que viene nace congelada, sin
que nadie tenga que acordarse de sumarla a una lista.

Que el vencimiento sí se pueda corregir no es una excepción arbitraria: la
inmutabilidad de la 3C protege lo que la recepción **hizo** —movió stock, cambió
un costo— y el vencimiento no movió nada. Es una condición comercial que se
acuerda entre personas y puede cambiar sin que la entrega cambie. Exige permiso
y queda auditado con el antes y el después.

**No hay una migración de permisos.** Los permisos viven en
`src/server/authz/permissions.ts`, no en la base: no hay nada que migrar. El día
que se muevan a tablas `Permission`/`RolePermission` —que es lo que anticipa ese
archivo— esa sí será una migración.

### Las migraciones de la Fase 4C

Cuatro, con el mismo criterio.

| Migración                         | Qué hace                                                                 |
| --------------------------------- | ------------------------------------------------------------------------ |
| `phase4c_supplier_advances`       | `SupplierPaymentAllocation.createdById`; el par deja de ser único        |
| `phase4c_purchase_returns`        | `PurchaseReturn` y `PurchaseReturnItem`, su secuencia y sus disparadores |
| `phase4c_purchase_return_finance` | `SupplierAccountMovement.returnId` y un crédito por devolución           |
| `phase4c_purchase_return_stock`   | `PURCHASE_RETURN` en la tabla de signos del libro de inventario          |

#### La primera volvió a chocar contra un disparador

Y también estuvo bien. `SupplierPaymentAllocation` es inmutable desde la 4B, y el
`UPDATE` que rellena `createdById` murió contra su disparador. La migración lo
**apaga y lo vuelve a encender dentro de su propia transacción**, así que no hay
ningún instante en el que otra sesión pueda escribir con la guardia baja.

La diferencia con lo que hubo que hacer en la 4B con `PurchaseReceipt`: allá una
columna quedó editable para siempre; acá el disparador vuelve **intacto** y sigue
rechazando todo, incluida la columna nueva. Nada queda más flojo de lo que estaba.

#### La primera también AFLOJA una restricción

Deja de ser único el par `(paymentId, receiptId)`. Aflojar no puede invalidar
ningún dato existente —todo lo que cumplía la regla vieja cumple la nueva— pero
**el rollback sí puede fallar**: restaurar el índice único exige que no haya
quedado ningún par repetido. El bloque `ROLLBACK` lo comprueba y **aborta con un
mensaje** en vez de borrar filas: cuál de las dos imputaciones sobra es una
decisión de negocio, no de una migración.

El motivo del cambio está en
[`SUPPLIER_PAYMENT_ALLOCATION.md`](SUPPLIER_PAYMENT_ALLOCATION.md), sección 6 bis.

#### La cuarta reescribe una tabla de signos entera

`StockMovement_tipo_signo_check` se reemplaza completa en vez de agregarle una
restricción aparte, para que siga habiendo **una** tabla de signos y no dos que
haya que leer juntas. La lista se repite entera a propósito: así el archivo dice
cuál es la regla resultante y no sólo qué le cambió.

La prueba que compara el catálogo de TypeScript contra la restricción de
PostgreSQL lee la **última** definición y no la primera, justamente porque esta
tabla se reescribe cada vez que aparece un tipo nuevo.

### Las migraciones de la Fase 4D

Cinco, por dominio, y **ninguna inventa historia**. Es la decisión que las
atraviesa: el catálogo entero arranca en `lotTracking = 'NONE'`, y el stock que
ya existe no se convierte en partidas ficticias.

| Migración                  | Qué hace                                                                    |
| -------------------------- | --------------------------------------------------------------------------- |
| `phase4d_product_lots`     | `Product.lotTracking` y `expirationTracking`, y la tabla `ProductLot`       |
| `phase4d_lot_stock`        | `BranchLotStock`, `LotAssignment` y `StockMovement.lotId`                   |
| `phase4d_lot_receiving`    | `PurchaseReceiptItemLot`                                                    |
| `phase4d_lot_sales`        | `SaleItemLotAllocation` y `PurchaseReturnItem.lotId`                        |
| `phase4d_inventory_counts` | `InventoryCountSession`, `InventoryCountLine` y `INVENTORY_COUNT` en signos |

#### Nada de `LEGACY-2026`

La alternativa fácil era crear una partida sintética por producto y meterle
todo el stock existente. Se descartó: sería un dato falso con formato de dato
real, indistinguible en pantalla de una partida que alguien leyó de un envase.
Lo que los lotes no explican aparece como **`sinAsignar`**, que además es
**derivado y no una columna** —`BranchStock.quantity − Σ BranchLotStock`— para
que no haya dos cifras que puedan divergir.

Es el mismo criterio con el que `Product.cost` migró a `NULL` en vez de a cero
en la Fase 3B.

#### La cuarta AFLOJA una clave única de la Fase 4C

`PurchaseReturnItem` pasa de ser único por `(devolución, línea)` a serlo por
`(devolución, línea, lote)`, más un índice parcial para el caso sin partida. El
motivo es concreto: una línea de recepción que llegó en dos partidas se devuelve
entera con **dos renglones**, uno por cada una.

Como toda restricción aflojada, el `ROLLBACK` puede fallar legítimamente si
quedaron pares repetidos, y **aborta con un mensaje** en vez de borrar filas.
Mismo criterio que la primera de la 4C.

#### La quinta vuelve a reescribir la tabla de signos

`INVENTORY_COUNT` entra en la rama `<> 0` —**de los dos signos**— porque un
sobrante contado no es una pérdida negativa. Se reescribe la restricción entera
por el mismo motivo que en la 4C: una sola tabla de signos, no dos.

#### Los índices parciales son invisibles para el control de deriva

`prisma migrate diff` no ve un `CREATE UNIQUE INDEX ... WHERE`, así que los
índices parciales de esta fase —los del caso `lotId IS NULL`— viven sólo en el
SQL. No es un descuido: es la razón por la que la comprobación de deriva de esta
fase se corrió con `--shadow-database-url` y se leyó a mano.

## Qué comprueba la prueba automatizada

| Caso                   | Qué verifica                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Cadena oficial         | Contiene exactamente las nueve migraciones y ninguna archivada                               |
| Cadena oficial         | Ninguna sentencia destructiva fuera de comentario                                            |
| Instalación nueva      | `migrate deploy` sobre base vacía termina bien                                               |
| Instalación nueva      | `migrate diff` no detecta deriva contra `schema.prisma`                                      |
| Instalación nueva      | Existen las tablas del dominio                                                               |
| Instalación nueva      | Existen los CHECK y los índices                                                              |
| Instalación nueva      | Se puede insertar sucursal, rol, usuario y venta                                             |
| Instalación nueva      | Un estado de venta inventado se rechaza                                                      |
| Instalación nueva      | Una anulación sin motivo ni responsable se rechaza                                           |
| Instalación nueva      | Una anulación completa se acepta                                                             |
| Instalación nueva      | El dinero quedó en `numeric(14,2)` y nada en `double precision`                              |
| Servidor existente     | Parte del esquema de junio con las siete registradas                                         |
| Servidor existente     | Se aplican solo las nuevas                                                                   |
| Servidor existente     | Los datos previos siguen ahí                                                                 |
| Servidor existente     | El residuo de punto flotante se limpia sin perder el valor                                   |
| Servidor existente     | Sin deriva contra `schema.prisma`                                                            |
| Servidor existente     | Las cinco columnas nuevas de `AuditLog` están, y `result` no admite null                     |
| Servidor existente     | El stock existente se convierte en `INITIAL`, con fecha de migración y sin inventar historia |
| Servidor existente     | El libro cuadra con el stock desde el primer día                                             |
| Servidor existente     | Volver a correr el relleno de `INITIAL` no duplica nada                                      |
| Servidor existente     | `UPDATE` y `DELETE` sobre `StockMovement` fallan, incluso con SQL directo                    |
| Servidor con negativos | La migración del libro **aborta** y explica qué filas revisar, sin dejar nada creado         |

Las bases de prueba se llaman `*_migtest` y se destruyen al terminar. El
nombre no es decorativo: la función que las borra se niega a tocar cualquier
base cuyo nombre no termine así.

## Riesgos que quedan

| Riesgo                                                               | Estado                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Producción no tiene aplicada ninguna de las dos migraciones nuevas   | **Abierto.** Es el paso que falta y depende de una ventana de mantenimiento.                                                                   |
| El relleno de `AuditLog.branchId` usa la sucursal actual del usuario | Aceptado. Con una sucursal no hay traslados; de acá en adelante el valor lo escribe la aplicación con la sucursal real del evento.             |
| Las seis archivadas aparecen como "not found locally"                | Aceptado, es informativo. Si molestara, se resuelve con `migrate resolve --applied` sobre una base nueva, pero no hace falta.                  |
| No hay migración probada que quite `Product.branchId`                | Abierto, y a propósito: es la más riesgosa del plan y con una sucursal no aporta. Ver [PHASE0_DECISIONS.md](PHASE0_DECISIONS.md).              |
| El dinero sigue en `Float`                                           | Abierto. Cambiar el tipo de columnas con datos es la migración de más riesgo pendiente. Conviene hacerla junto con la de cantidades decimales. |

## Migraciones destructivas: la política

Una migración que borra datos **puede** entrar en la cadena, pero sólo con las
cuatro condiciones cumplidas y comprobadas por
`tests/migrations/chain.test.ts`:

1. **Marcada.** Figura en `DESTRUCTIVAS_PERMITIDAS` con su nombre exacto.
2. **Documentada.** Un `motivo` de más de cuarenta caracteres que alguien pueda
   discutir. "Limpieza" no es un motivo.
3. **Probada.** Nombra una prueba que **existe**: la suite comprueba que el
   texto citado aparezca de verdad entre sus pruebas.
4. **Con respaldo.** Nombra el documento que explica cómo respaldar y —lo que
   suele faltar— cómo **restaurar**. La suite comprueba que el archivo exista.

La misma aserción falla al revés: una excepción que dejó de borrar algo tiene
que salir de la lista, o en dos fases nadie leerá los motivos.

### Qué cuenta como destructivo

| Patrón                      | Por qué                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DROP COLUMN`, `DROP TABLE` | Lo obvio                                                                                                                |
| `TRUNCATE`                  | Sin exigir la palabra `TABLE`: PostgreSQL la acepta opcional, y `TRUNCATE "Sale"` pasaba limpio por la guardia anterior |
| `DELETE FROM`               | Cualquiera. **Sin `WHERE` no admite excepción**, ni marcada                                                             |
| `ALTER COLUMN … TYPE`       | Puede **truncar en silencio**: `TEXT` a `VARCHAR(20)` recorta; `numeric(14,4)` a `numeric(14,2)` pierde centavos        |
| `DROP … CASCADE`            | Se lleva por delante lo que dependa, que por definición es lo que no se está mirando                                    |
| `DROP SCHEMA/DATABASE`      | No hace falta explicarlo                                                                                                |

**No** cuentan `DROP INDEX` ni `DROP CONSTRAINT`: no borran datos, y marcarlos
llenaría la lista de excepciones rutinarias.

La expresión **no está anclada al principio de la línea**. Ésa fue la corrección
de la Fase 3C: `^\s*DROP\s+COLUMN` no encuentra
`ALTER TABLE "Product" DROP COLUMN "barcode"`, que es la única forma en que
PostgreSQL acepta esa sentencia. La guardia dejaba pasar exactamente el caso
para el que existía.

Al reforzarla en la 3D aparecieron **dos conversiones de tipo de la Fase 3** que
nunca habían estado marcadas: el dinero a `DECIMAL(14,2)` y las cantidades a
`NUMERIC(14,3)`. Las dos son legítimas y ahora tienen su ficha escrita.

### Los guiones de `scripts/`

Corren a mano contra la base real y no pasan por la revisión que sí tiene una
migración. La suite comprueba que **ninguno** contenga `deleteMany`, `TRUNCATE`
ni `DROP TABLE`. Es lo que mantiene `npm run integrity:check` de sólo lectura
por construcción y no por buena voluntad. Los seeds quedan afuera: su trabajo es
escribir, y el de demostración tiene su propia guarda `_dev`.

### Antes de aplicar una en producción

`npm run rehearsal`. Ver
[PRODUCTION_MIGRATION_REHEARSAL.md](PRODUCTION_MIGRATION_REHEARSAL.md).

## Fase 5A: lo que se midió contra el servidor real

El 11 de agosto de 2026 se auditó producción en **solo lectura**. Tres
resultados cambian cómo se lee todo lo anterior.

### La cadena arranca donde produccion está, sin conflicto

|                                       |                                               |
| ------------------------------------- | --------------------------------------------- |
| Migraciones registradas en producción | **1** — `20250605201717_add_value_to_product` |
| Checksum en la base                   | `2d0b96ba…bfbd3f0`                            |
| Checksum del archivo local            | **idéntico**                                  |
| Pendientes                            | **42**                                        |
| Deriva de esquema                     | **ninguna**                                   |

El `pg_dump --schema-only` de producción se comparó contra lo que produce esa
migración: 14 tablas, 13 secuencias, 8 índices únicos, **cero objetos extra**.
Nadie tocó el esquema a mano en quince meses.

Esto era la incógnita mayor —un checksum distinto habría hecho que `migrate
deploy` se negara a seguir, y resolverlo en plena ventana es feo— y está
descartada.

### El bloqueo que sí existe: privilegios

```sql
SELECT has_schema_privilege('kiosco','public','CREATE');   -- false
SELECT count(*) FROM pg_tables
 WHERE schemaname='public' AND tableowner='kiosco';        -- 0
```

**El rol de la aplicación no puede correr las migraciones.** No puede crear
objetos, y aunque se le concediera `CREATE`, un no-dueño no puede `ALTER TABLE`
ni `CREATE TRIGGER` sobre tablas de `postgres` —y la cadena crea 17
disparadores—.

Es un bloqueante de despliegue, no de código. Las dos salidas posibles, con sus
consecuencias, están en [`PRODUCTION_CUTOVER.md`](PRODUCTION_CUTOVER.md).

**Regla nueva:** antes de dar por buena una cadena de migraciones, comprobar que
el rol que la va a correr **puede correrla**. Que las migraciones sean correctas
y que se puedan aplicar son dos cosas distintas, y esta cadena estuvo cuatro
fases siendo lo primero sin que nadie comprobara lo segundo.

### El ensayo con volumen de producción

`npm run rehearsal:prodlike` parte del estado exacto de producción —la migración
1 aplicada, 42 pendientes— y lo carga con la forma real de esos datos antes de
migrar. Medido:

|                                  |   Volumen real |            20× |
| -------------------------------- | -------------: | -------------: |
| Respaldo                         | 0,3 s · 0,1 MB | 0,5 s · 2,1 MB |
| **Migración (42 pasos)**         |      **1,7 s** |     **35,2 s** |
| Restauración del respaldo previo |          0,3 s |          0,6 s |
| `integrity:check`                |         0,10 s |         0,27 s |
| Base resultante                  |          15 MB |          76 MB |

Y el hallazgo: **`phase3_sale_payments` pasa de 113 ms a 31.119 ms**. Veinte
veces el volumen, doscientas setenta y cinco veces el tiempo.

La causa es un relleno con subconsulta correlacionada sobre `SaleItem`, que no
tenía índice por `saleId`: PostgreSQL **no indexa las claves foráneas**. La
migración `20260814100000_phase5a_indices_de_lectura` lo crea.

**No se corrigió la migración vieja.** Cambiar su checksum haría que `migrate
deploy` se niegue a seguir en desarrollo, pruebas y el ensayo, donde ya está
aplicada; en producción son 113 ms. El índice al final de la cadena **no mejora
la ventana** —se midió: 38 s contra 35 s— y sí elimina el costo permanente de
abrir, anular o imprimir cada venta.

**Regla nueva:** toda columna por la que se busque en un `WHERE` necesita
índice, aunque sea clave foránea. Y toda migración con una subconsulta
correlacionada hay que medirla con volumen antes de darla por barata.

### Expand / contract: cuándo empieza a aplicar

Esta cadena tiene tres pares expand/contract —códigos de barras, proveedor del
producto, contacto del proveedor— y los tres caen en el **mismo** despliegue.

Es aceptable **solo esta vez**, por dos motivos medidos: la reversibilidad ya se
pierde en la migración 6, que es anterior a los tres contracts; y no hay código
viejo que sostener, porque la aplicación está detenida.

**De acá en adelante no.** Con el sistema en marcha, cada `DROP COLUMN` va en un
despliegue **posterior** al que dejó de usar esa columna. Si no, volver el
artefacto deja de ser una opción.
