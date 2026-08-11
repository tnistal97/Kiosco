# Libro de inventario

**Fase 3A.** Estado: implementado.
Documentos relacionados: [PHASE3_MONEY_MIGRATION.md](PHASE3_MONEY_MIGRATION.md),
[CASH_SHIFT_MODEL.md](CASH_SHIFT_MODEL.md), [DATABASE_MIGRATION_STRATEGY.md](DATABASE_MIGRATION_STRATEGY.md).

---

## 1. El problema

Hasta la Fase 2 el stock era **un número**. `BranchStock.quantity` decía 36 y
eso era todo lo que el sistema sabía. Si ayer decía 40, no había forma de
responder por qué.

Se podía reconstruir _parte_ de la historia leyendo la bitácora de seguridad
(`AuditLog`), porque cada ajuste dejaba una entrada. Pero:

- Las ventas descontaban stock **sin dejar rastro por producto**. La bitácora
  guardaba la venta entera, no el efecto sobre cada artículo.
- Las anulaciones devolvían unidades **sin registrar nada**.
- La bitácora es un JSON pensado para leerse de a una fila, no para sumarse.
  No se puede preguntar «cuántas unidades entraron y salieron este mes».
- `AuditLog` mezcla intentos rechazados, inicios de sesión y cambios de
  contraseña con el movimiento de mercadería. Son dos preguntas distintas.

El resultado práctico: la única forma de saber por qué faltaban tres unidades
era acordarse.

## 2. La decisión

**El stock deja de ser un número y pasa a ser el saldo de un libro.**

`BranchStock.quantity` sigue existiendo y sigue siendo lo que se consulta para
vender —leer un saldo tiene que costar una fila, no una suma de dos años—,
pero ya no es la fuente de la verdad: es el **saldo materializado** de
`StockMovement`.

La propiedad que hace que esto valga algo:

```
para todo producto:  Σ StockMovement.quantity  ==  BranchStock.quantity
```

Si esa igualdad se rompe, el sistema está mintiendo en algún lado. Hay una
prueba que la verifica para **todos** los productos de la fixture después de
cada escenario, y otra que la verifica tras diez ventas concurrentes.

### Por qué `BranchStock` y no `Product`

El pedido original decía `Product.quantity`. En este esquema el stock no vive
en `Product`: vive en `BranchStock`, con clave `(branchId, productId)`, porque
un producto puede existir en varias sucursales con cantidades distintas. Todo
lo que sigue dice `BranchStock.quantity` por eso, y no por otra razón.

## 3. El modelo

```prisma
model StockMovement {
  id                Int      @id @default(autoincrement())
  branchId          Int
  productId         Int
  type              String
  quantity          Int // delta CON SIGNO
  previousQuantity  Int
  resultingQuantity Int
  referenceType     String?
  referenceId       Int?
  userId            Int
  reason            String?
  createdAt         DateTime @default(now())
}
```

### `quantity` es un delta con signo, no una cantidad absoluta

Una venta de 2 unidades escribe `-2`. Su anulación escribe `+2`. La suma de las
dos da cero, que es exactamente lo que pasó.

La alternativa —guardar `2` y deducir el signo del tipo— obliga a que cada
consulta conozca la tabla de signos. Con el delta firmado, `SUM(quantity)` es
la reconstrucción del stock y no hace falta saber nada más.

### Los tres números y la invariante

`previousQuantity`, `quantity` y `resultingQuantity` son redundantes: el
tercero se deduce de los dos primeros. Se guardan igual, y la base lo obliga:

```sql
CHECK ("resultingQuantity" = "previousQuantity" + "quantity")
CHECK ("resultingQuantity" >= 0)
```

Guardar los tres permite leer una fila del historial y entenderla sin
recorrer las anteriores: «38 → 36» se lee de un vistazo. Y la restricción
convierte en imposible —no en improbable— que una fila diga que 38 menos 2 son 35.

### Los tipos y sus signos

| Tipo                | Signo | Quién lo emite                                        |
| ------------------- | ----- | ----------------------------------------------------- |
| `INITIAL`           | ≥ 0   | La migración, y el alta de producto con stock inicial |
| `SALE`              | < 0   | `createSale`                                          |
| `SALE_CANCEL`       | > 0   | `cancelSale`                                          |
| `MANUAL_ADJUSTMENT` | ≠ 0   | Ajuste y recuento de inventario                       |
| `LOSS`              | < 0   | Ajuste declarado como pérdida                         |
| `BREAKAGE`          | < 0   | Ajuste declarado como rotura                          |
| `INTERNAL_USE`      | < 0   | Ajuste declarado como consumo interno                 |
| `PURCHASE_RECEIPT`  | > 0   | **Reservado.** Fase 3C. Nada lo emite todavía         |

El signo también está en la base:

```sql
CHECK (
     ("type" = 'INITIAL'                                        AND "quantity" >= 0)
  OR ("type" IN ('SALE','LOSS','BREAKAGE','INTERNAL_USE')       AND "quantity" <  0)
  OR ("type" IN ('SALE_CANCEL','PURCHASE_RECEIPT')              AND "quantity" >  0)
  OR ("type" = 'MANUAL_ADJUSTMENT'                              AND "quantity" <> 0)
)
```

Una venta que **aumente** el stock no es un error de programación que haya que
buscar: es una fila que la base rechaza. La misma restricción sirve de lista
blanca de tipos: un tipo inventado no cumple ninguna rama.

`PURCHASE_RECEIPT` figura en la restricción aunque nada lo emita. Es
deliberado: cuando la Fase 3C dé entrada a la mercadería no va a hacer falta
alterar una restricción sobre una tabla que para entonces va a tener volumen.
Agregarlo hoy no cuesta nada; agregarlo después cuesta un `ALTER TABLE` con
validación de toda la tabla.

### `referenceType` / `referenceId`

De dónde vino el movimiento: `'Sale'` + el id de la venta, `'BranchStock'` +
el id del ajuste. Es lo que permite que el historial diga «Venta #4832» y
enlace, en vez de guardar esa frase como texto —que fue exactamente el
problema que tenía `CashRegisterMovement.description` antes de la Fase 3—.

No es una clave foránea: apunta a tablas distintas según el tipo, y una FK
polimórfica no se puede declarar. Se compensa con un índice
`(referenceType, referenceId)` y con la regla de que solo el servidor la
escribe.

## 4. Inmutabilidad

**Un movimiento no se edita y no se borra.** Los errores se corrigen con otro
movimiento, igual que en un libro contable.

Esto no es una convención: es un disparador.

```sql
CREATE FUNCTION stock_movement_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de stock son inmutables (intento de % sobre el id %)',
    TG_OP, OLD."id";
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_inmutable"
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION stock_movement_inmutable();
```

Vale para todos: para un `UPDATE` de Prisma, para un `DELETE` desde psql y para
quien entre con la contraseña de la base. Hay una prueba que intenta las dos
operaciones y comprueba que las dos fallan.

`TRUNCATE` no dispara disparadores de fila, así que el reinicio de la base de
pruebas sigue funcionando. Es la única puerta, y solo la usa el arranque de los
tests.

### Consecuencia: un producto con historial ya no se borra

`DELETE /api/products/:id` borraba físicamente el producto si no figuraba en
ninguna venta. Ahora se niega también si tiene movimientos de stock, porque
borrarlo obligaría a borrar su historial —y el disparador no lo permite—.

En la práctica: un producto que se cargó con stock, o al que se le ajustó
alguna vez la cantidad, **se da de baja** (`isActive = false`), no se borra. Un
producto cargado por error con cero unidades y sin ninguna operación sí se
puede borrar, que es el caso para el que servía el botón.

## 5. El servicio central

Toda modificación de stock pasa por **una sola función**:

```ts
applyStockMovement(tx, {
  branchId, productId, type, quantity, userId,
  reason?, referenceType?, referenceId?, audit?
}): Promise<ResultadoMovimiento>
```

Está en `src/modules/inventory/service.ts`. Los pasos, en orden:

1. **Exige una transacción.** El parámetro `tx` es `Prisma.TransactionClient`,
   no el cliente global. No se puede llamar fuera de una transacción porque no
   hay forma de pasarle el cliente que no sea una.
2. **Valida el tipo y el signo** antes de tocar la base, con el mismo criterio
   que la restricción. La base es la garantía; esto es el mensaje legible.
3. **Valida la cantidad**: entero, distinto de cero (salvo `INITIAL`), dentro
   del rango del producto.
4. **Asegura la fila de stock** con `INSERT … ON CONFLICT DO NOTHING`. Un
   producto sin fila en `BranchStock` no es un caso de error: es un producto al
   que nunca le entró mercadería.
5. **Aplica el delta y lee los dos saldos en la misma sentencia**:

   ```sql
   UPDATE "BranchStock"
      SET "quantity" = "quantity" + $delta
    WHERE "branchId" = $b AND "productId" = $p
      AND "quantity" + $delta >= 0
   RETURNING "quantity" - $delta AS previo, "quantity" AS resultante
   ```

   Una sola sentencia hace las tres cosas que no pueden separarse: comprobar
   que no queda negativo, aplicar el delta y decir cuánto había antes.
   PostgreSQL toma el bloqueo de la fila y **reevalúa la condición después de
   esperarlo**, así que dos ventas simultáneas de la última unidad no pueden
   pasar las dos.

6. **Si afectó 0 filas, el stock quedaría negativo** —la fila existe seguro,
   por el paso 4—. Se lanza `INSUFFICIENT_STOCK` con la cantidad real.
7. **Crea el movimiento** con los saldos que devolvió el `RETURNING`. No se
   vuelve a leer el stock: entre la lectura y la escritura otra transacción
   podría haberlo movido, y la fila del libro diría un número que nunca existió.
8. **Audita**, si el llamador lo pide.
9. **Devuelve** `{ movementId, previousQuantity, resultingQuantity }`.

### Por qué el paso 5 es una sentencia y no tres

La versión ingenua —leer, decidir en JavaScript, escribir— deja una ventana
entre la lectura y la escritura. Con dos cajas vendiendo la última unidad, las
dos leen «hay 1», las dos deciden «alcanza», y el stock queda en −1. Esa
ventana no se cierra con más comprobaciones: se cierra no teniéndola.

### La única puerta

Una regla de ESLint prohíbe `create`, `update`, `upsert`, `delete` y sus
variantes sobre `branchStock`, y también el SQL crudo que mencione
`"BranchStock"`, en todo `src/` **salvo** `src/modules/inventory/`.

```
src/modules/inventory/service.ts   ← única excepción
```

Las lecturas (`findUnique`, `findMany`, `count`, `aggregate`) siguen
permitidas en cualquier parte: leer un saldo no lo corrompe.

La regla vive en `eslint.config.mjs` y no en un comentario porque un
comentario se rompe el día que alguien tiene apuro y necesita restar una
unidad rápido.

## 6. Quién lo usa

| Operación                     | Tipo                | Referencia    | Audita aparte           |
| ----------------------------- | ------------------- | ------------- | ----------------------- |
| Venta                         | `SALE`              | `Sale` #id    | Sí, la venta entera     |
| Anulación                     | `SALE_CANCEL`       | `Sale` #id    | Sí, la anulación entera |
| Alta con stock inicial        | `INITIAL`           | `Product` #id | Sí, el alta             |
| Ajuste `PATCH /api/stock/:id` | el declarado        | `BranchStock` | **Sí, aquí**            |
| Recuento `PUT /api/stock/:id` | `MANUAL_ADJUSTMENT` | `BranchStock` | **Sí, aquí**            |
| Ajuste desde la ficha         | `MANUAL_ADJUSTMENT` | `Product` #id | Sí, la edición          |

### Sobre la doble bitácora

`StockMovement` y `AuditLog` no son la misma tabla con distinto nombre:

- **`StockMovement`** es el registro **operativo**. Responde «cuántas unidades
  hay y por qué». Se suma, se filtra por producto, se reconstruye.
- **`AuditLog`** es la bitácora de **seguridad**. Responde «quién hizo qué y
  desde dónde», incluidos los intentos rechazados, que no mueven stock y por lo
  tanto no dejan movimiento.

Las ventas y las anulaciones ya se auditan enteras. Emitir además una entrada
de auditoría por cada línea convertiría una venta de quince productos en
dieciséis filas de bitácora que dicen lo mismo. Por eso `applyStockMovement`
solo audita cuando el llamador se lo pide, y los ajustes son los únicos que lo
piden: un ajuste **es** el evento, no la línea de un evento más grande.

## 7. El recuento se convierte en delta

`PUT /api/stock/:id` sigue aceptando «quedan 30». Internamente:

```
stock actual  40
objetivo      50
                 →  MANUAL_ADJUSTMENT  delta +10   40 → 50
```

Nunca se escribe «el stock nuevo es 50» sin registrar cómo se llegó. Y como el
delta se calcula dentro de la transacción a partir del saldo real, un recuento
sobre un producto que otro acaba de vender queda registrado con los números que
de verdad había.

El caso «el objetivo es igual al stock actual» —delta cero— se rechaza: no hay
nada que registrar, y un movimiento de cero unidades ensucia el historial sin
decir nada.

## 8. Stock mínimo

`Product.minimumStock`, entero, por omisión **0**.

| Estado | Condición                                  |
| ------ | ------------------------------------------ |
| `OUT`  | `quantity <= 0`                            |
| `LOW`  | `quantity > 0 && quantity <= minimumStock` |
| `OK`   | `quantity > minimumStock`                  |

**No se guarda.** Se calcula al leer, en un único lugar
(`src/modules/inventory/minimum.ts`), compartido por el servidor y el
navegador. Un estado guardado se desincroniza en cuanto alguien cambia el
mínimo sin recalcular.

Con `minimumStock = 0` —el valor que la migración le pone a todo el catálogo
existente— la condición de `LOW` no se cumple nunca: `quantity > 0` y
`quantity <= 0` no pueden ser ciertas a la vez. Es intencional. **La migración
no inventa mínimos**: no sé cuántos fideos quiere tener este almacén, y
poner un 10 global haría sonar una alarma que nadie configuró.

Hasta la Fase 2 el umbral era la constante `STOCK_CRITICO = 10`, igual para el
agua mineral y para el fernet. Esa constante desaparece como umbral: sigue
existiendo solo como **sugerencia** en el formulario de producto, que es donde
tiene sentido proponerla.

## 9. Migración

`prisma/migrations/20260807130000_phase3_stock_ledger/`

Hace, en este orden:

1. **Comprueba antes de tocar nada** que no haya stock negativo. Si lo hay,
   aborta con el listado: un `INITIAL` negativo violaría la restricción, y
   convertirlo en cero falsearía el inventario. Es un dato que hay que arreglar
   a mano, no en una migración.
2. Crea `StockMovement` con sus restricciones, sus claves foráneas y sus
   índices.
3. Crea el disparador de inmutabilidad.
4. Agrega `Product.minimumStock` con valor 0.
5. **Crea un `INITIAL` por cada fila de `BranchStock` con cantidad distinta de
   cero**, fechado en el momento de la migración.

### Sobre la fecha del `INITIAL`

`createdAt` es **la fecha de la migración**, no la fecha en que esa mercadería
entró al depósito. Esa fecha no existe en ninguna parte y el sistema no la va a
inventar.

El `reason` de esas filas lo dice con todas las letras:

> «Saldo existente al implantar el libro de inventario. No refleja cuándo
> ingresó la mercadería.»

El `userId` es el del usuario más antiguo de la sucursal, por necesidad
—`userId` no admite nulo y la fila tiene que existir—. El motivo aclara que no
fue esa persona quien cargó ese stock.

### Idempotencia

El paso 5 se protege con `WHERE NOT EXISTS (SELECT 1 FROM "StockMovement" …)`
por producto y sucursal. Correrla dos veces no duplica nada. Y como la tabla se
crea en la misma migración, el `NOT EXISTS` es barato: en una base nueva no hay
nada que comprobar.

### Rollback

Documentado dentro del propio archivo, comentado. Quita el disparador, la
función, la tabla y la columna. **La marcha atrás pierde el libro**: los
movimientos que se hayan generado entre la migración y el rollback no están en
ningún otro lado. Es información nueva, no información duplicada.

## 10. Permisos

| Permiso                    | Qué habilita                                        |
| -------------------------- | --------------------------------------------------- |
| `stock.view`               | Ver el stock de la sucursal                         |
| `stock.adjust`             | Emitir ajustes, pérdidas, roturas y consumo interno |
| `inventory.movements.view` | Ver el historial de movimientos                     |

`stock.adjust` **es** el `inventory.adjust` del pedido. Existe desde la Fase 0,
lo usan las dos rutas de ajuste y figura en la matriz. Renombrarlo hubiera
tocado siete archivos para dejar el sistema igual.

`inventory.movements.view` sí es nuevo, y no lo tiene todo el que tiene
`stock.view`: el cajero ve cuánto hay porque lo necesita para vender, pero el
historial de quién ajustó qué es información de control. Lo tienen dueño,
administrador, encargado, supervisor, repositor, compras y auditor.

### Lo que se evaluó y no se hizo

Permisos separados `inventory.loss` e `inventory.breakage`. **No aportan.**
Quien puede emitir un `MANUAL_ADJUSTMENT` ya puede sacar unidades del sistema
sin venderlas; obligarlo a declarar «pérdida» en vez de «ajuste» no le impide
nada. Lo que importa es que el tipo quede **registrado** y **auditado**, y eso
sí está. Separar el permiso daría la sensación de control sin agregar ninguno.

## 11. Rendimiento

Índices creados:

| Índice                             | Para qué consulta                            |
| ---------------------------------- | -------------------------------------------- |
| `(branchId, createdAt DESC)`       | El historial, que es lo que abre la pantalla |
| `(productId, createdAt DESC)`      | La ficha de un producto                      |
| `(branchId, type, createdAt DESC)` | Filtrar por tipo                             |
| `(referenceType, referenceId)`     | «¿Qué movió la venta #4832?»                 |
| `(userId)`                         | Filtrar por quién                            |

El historial se pagina siempre. No hay endpoint que devuelva el libro entero:
con dos años de operación son cientos de miles de filas.

La venta **no** hace una consulta más por producto: `applyStockMovement`
reemplaza al `UPDATE` que ya existía y agrega un `INSERT`. La prueba de
`tests/performance/queries.test.ts` cuenta las consultas de una venta y falla si
crecen más de lo declarado.

## 12. Lo que esta fase NO hace

- **Cantidades decimales.** El stock es entero. Vender 0,250 kg llega en la
  Fase 3B, junto con las unidades de medida.
- **`PURCHASE_RECEIPT`.** El tipo está reservado en la restricción; nada lo
  emite. La recepción de mercadería es Fase 3C.
- **Transferencias entre sucursales.** Serían dos movimientos con una
  referencia común. No hay tipo para eso todavía.
- **Costo del movimiento.** Un movimiento no guarda a qué costo entró o salió
  la unidad. Llega con `ProductCostHistory`, en la Fase 3C.
- **Órdenes de compra automáticas** a partir de las alertas de reposición.
- **Reserva de stock.** Un ticket abierto en la pantalla de venta no bloquea
  unidades: el stock se descuenta al cobrar.

## Fase 4D: el libro, ahora por lote

`StockMovement.lotId`, nulo en todo el historial anterior y en todo producto con
`lotTracking = NONE` —que es como arranca el catálogo entero—.

**No se rellena hacia atrás.** Nadie sabe de qué partida eran las unidades que se
vendieron el año pasado, y un lote inventado se ve igual que uno real.

`applyStockMovement()` pasa a escribir **dos** saldos: el del producto y el del
lote. Los dos con la misma técnica —`quantity + delta >= 0` dentro de la misma
sentencia que descuenta— y en un orden que es parte del contrato: `BranchStock`
primero, `BranchLotStock` después. Como todos los caminos pasan por ahí, todas
las transacciones toman los bloqueos igual.

La política del producto viaja **dentro** de la sentencia, junto a la
comprobación de sucursal: un movimiento sin lote sobre un producto `REQUIRED` —o
con lote sobre uno `NONE`— no afecta ninguna fila, y el camino de error dice cuál
de las dos cosas fue.

Que el lote pertenezca al producto lo garantiza una clave foránea **compuesta**
`(productId, lotId)`. Con `lotId` nulo se satisface sola, que es exactamente lo
que hace falta para el historial.

### Un tipo más: `INVENTORY_COUNT`

De los **dos signos**, y eso es exactamente por qué no es un `LOSS`: un sobrante
contado no es una pérdida negativa, y mezclarlos haría que el reporte de mermas
mienta. Tampoco figura entre los tipos de ajuste manual: si estuviera, cualquiera
con `stock.adjust` podría escribir la diferencia de un inventario que nadie
contó. Ver [PHYSICAL_INVENTORY.md](PHYSICAL_INVENTORY.md).

### Un segundo libro: `LotAssignment`

Atribuir stock existente a una partida **no es un movimiento**: había 20 y siguen
habiendo 20, lo que cambia es la atribución. Fabricar un `+20` seguido de un
`−20` para representarlo escribiría en este libro dos operaciones que nunca
ocurrieron, y contaminaría todo reporte de movimientos por tipo.

Ver [LOT_TRACKING_DESIGN.md](LOT_TRACKING_DESIGN.md).
