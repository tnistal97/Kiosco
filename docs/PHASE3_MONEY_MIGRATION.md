# Migración del dinero: de Float a Decimal

> Se escribe **antes** de tocar la base. Lo que sigue es la decisión, con su
> justificación y su vuelta atrás; la migración implementa esto y nada más.

## Por qué

Hoy todos los importes son `Float`, que en PostgreSQL es `double precision`:
un binario de base 2. Los precios se escriben en base 10. Hay decimales de
base 10 que **no existen** en base 2, igual que 1/3 no existe en base 10.

```
0.1 + 0.2 = 0.30000000000000004
```

Eso no es un error de PostgreSQL ni de JavaScript: es lo que pasa cuando se
guarda dinero en un tipo pensado para medir cosas continuas. Con dinero, el
resultado tiene que ser exacto o no sirve.

El código de las fases anteriores lo sabía y lo compensaba redondeando en cada
punto:

```ts
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}
```

Eso tapa el síntoma en la mayoría de los casos, y aun así falla:
`Math.round(1.005 * 100) / 100` da `1` porque `1.005 * 100` es
`100.49999999999999`. Más grave: **redondear en cada paso no es lo mismo que
calcular exacto y redondear una vez**. La suma de subtotales redondeados puede
diferir del total redondeado en un centavo, y ese centavo aparece cuando se
compara la venta contra los pagos, o el turno contra el arqueo.

La Fase 3 introduce pagos combinados, donde la comparación es literal:

```
suma de pagos == total de la venta
```

Con `Float` esa igualdad falla sola. No es una mejora estética: es la condición
para que el objetivo 4 funcione.

## Qué se migra

### Ya existe

| Modelo                 | Campo         | Tipo actual | Tipo nuevo      | Qué es                            |
| ---------------------- | ------------- | ----------- | --------------- | --------------------------------- |
| `Product`              | `price`       | `Float`     | `Decimal(14,2)` | Precio de venta                   |
| `SaleItem`             | `price`       | `Float`     | `Decimal(14,2)` | Precio congelado al vender        |
| `Branch`               | `currentCash` | `Float`     | `Decimal(14,2)` | Saldo acumulado de caja           |
| `CashRegisterMovement` | `amount`      | `Float`     | `Decimal(14,2)` | Importe del movimiento, con signo |
| `CashCount`            | `amount`      | `Float`     | `Decimal(14,2)` | Contado en el arqueo              |
| `CashCount`            | `expected`    | `Float`     | `Decimal(14,2)` | Esperado por el sistema           |
| `CashCount`            | `difference`  | `Float`     | `Decimal(14,2)` | Contado − esperado                |

Siete columnas en cinco tablas. Es toda la superficie monetaria actual: se
buscó por tipo (`SELECT ... WHERE data_type = 'double precision'`), no por
nombre, para no dejar afuera una columna que se llame distinto.

`Product.value` es `Int?`, no se usa en ninguna parte del código y quedó de una
migración de mayo de 2025. **No se toca**: borrar una columna en una migración
que corre en el servidor es exactamente lo que la estrategia prohíbe. Queda
anotada como deuda.

### Se crea después, con el mismo criterio

Las fases siguientes de este mismo trabajo agregan columnas monetarias. Se
listan acá para que la decisión de precisión sea una sola:

| Modelo                | Campo                                          | Tipo            | Migración              |
| --------------------- | ---------------------------------------------- | --------------- | ---------------------- |
| `Sale`                | `total`                                        | `Decimal(14,2)` | `phase3_sale_payments` |
| `SalePayment`         | `amount`, `cashReceived`, `changeGiven`        | `Decimal(14,2)` | `phase3_sale_payments` |
| `CashShift`           | `openingAmount`, `countedAmount`, `difference` | `Decimal(14,2)` | `phase3_cash_shifts`   |
| `Product`             | `cost`                                         | `Decimal(14,4)` | `phase3_product_costs` |
| `ProductCostHistory`  | `previousCost`, `newCost`                      | `Decimal(14,4)` | `phase3_product_costs` |
| `PurchaseOrderItem`   | `unitCost`                                     | `Decimal(14,4)` | `phase3_purchases`     |
| `PurchaseReceiptItem` | `unitCost`                                     | `Decimal(14,4)` | `phase3_purchases`     |

## Precisión y escala

### `Decimal(14,2)` para todo lo que es un peso

**Escala 2.** El peso argentino tiene centavos. Un precio de venta, un total,
un movimiento de caja y un arqueo se expresan y se cobran con dos decimales.
Guardar más sería guardar una cifra que no se puede pagar.

**Precisión 14** deja 12 dígitos enteros: hasta `999.999.999.999,99`. Casi un
billón de pesos. Es holgado a propósito. La alternativa razonable era 12
(`9.999.999.999,99`, diez mil millones), y con la inflación argentina un total
acumulado de sucursal puede acercarse a ese orden en unos años. Dos dígitos más
no cuestan nada en `numeric` --el almacenamiento es variable, no fijo-- y
evitan una segunda migración de un tipo que ya migramos una vez.

### `Decimal(14,4)` para costos unitarios

Acá sí hay una razón, y es aritmética, no estética.

El costo unitario **se deriva de una división**. Se compra una caja de 8
unidades a $12.345:

```
12345 / 8 = 1543,125
```

Con escala 2 eso se guarda como `1543,13`, y al reconstruir el costo de la caja
dan `12345,04`: cuatro centavos que no existen. Con 12 productos por caja el
error crece; con cantidades por peso --gramos, mililitros-- la división es peor
todavía.

El costo no se cobra: se usa para calcular margen y para valuar inventario. Un
número que sólo alimenta cálculos puede y debe guardarse con más resolución que
uno que se cobra. Cuatro decimales bastan para que la división por cualquier
`unitsPerPurchaseUnit` razonable (hasta 10.000) no pierda un centavo al
reconstruir el total.

**Lo que NO se hace:** usar escala 4 en precios de venta. Un precio con cuatro
decimales invita a mostrarlo, y no se puede cobrar `$1.543,1250`.

### `ROUND_HALF_UP`

Cuando hay que redondear a dos decimales --al pasar de un cálculo interno a un
importe cobrable-- se redondea medio hacia arriba, que es lo que hace una
calculadora y lo que espera cualquiera que revise una cuenta a mano.

No se usa "banker's rounding" (medio al par), que estadísticamente es más
neutral pero da resultados que nadie sabe explicar en el mostrador:
`2,5 → 2` y `3,5 → 4`.

## Estrategia de migración

### Es un `ALTER COLUMN TYPE`, no una columna nueva

```sql
ALTER TABLE "Product"
  ALTER COLUMN "price" TYPE DECIMAL(14,2) USING ROUND("price"::numeric, 2);
```

PostgreSQL convierte in situ, fila por fila, dentro de la transacción de la
migración. El `USING` es obligatorio: sin él, PostgreSQL se niega a convertir
`double precision` a `numeric` porque la conversión puede perder información.
Con `ROUND(...::numeric, 2)` la pérdida es explícita y es la que queremos.

**Qué pasa con un valor que tenía más de dos decimales.** Se redondea. Si en la
base hay un precio guardado como `4850.000000001` --residuo típico de haber
sumado en `Float`-- queda `4850.00`. Ese es el objetivo, no un efecto
colateral: la cifra correcta siempre fue `4850,00`.

**Qué pasa con un valor que no entra.** Un importe mayor a
`999.999.999.999,99` haría fallar la migración con `numeric field overflow`.
La migración **comprueba antes** y falla con un mensaje legible en vez de dejar
la tabla a medias. Falla en un `DO` block, dentro de la misma transacción, así
que no queda nada aplicado.

### Bloqueo

`ALTER TABLE ... ALTER COLUMN TYPE` toma un `ACCESS EXCLUSIVE` y **reescribe la
tabla**. Con las tablas del almacén --decenas de miles de filas en el peor
caso-- es cuestión de segundos. En una tabla de millones habría que hacerlo con
columna nueva + backfill + swap; no es el caso y complicarlo sería inventar un
problema.

Se aplica en ventana de mantenimiento igual, porque `Sale`, `SaleItem` y
`CashRegisterMovement` son las tablas calientes.

### Compatibilidad con la versión anterior del código

**Ninguna.** Es la primera migración de todo el proyecto que no es aditiva, y
hay que decirlo claro: si se aplica esta migración y después se revierte el
despliegue a la versión anterior de la aplicación, el código viejo recibe
`Decimal` donde espera `number`.

En la práctica el cliente de Prisma devuelve un objeto `Decimal`, y
`4850.00 + 1690.00` sobre dos objetos da la cadena `"48501690"`. No revienta:
calcula mal, que es peor.

Por eso el orden de despliegue es el inverso al habitual:

1. **Primero** el código nuevo, que ya sabe leer `Decimal` (el cliente de
   Prisma generado contra el esquema viejo devuelve `number`, y los helpers
   aceptan las dos cosas).
2. **Después** la migración.

Y la vuelta atrás real es el `DOWN`, no el redespliegue.

### `DOWN`

Va comentado al final de la migración, como todas. Es simétrico:

```sql
ALTER TABLE "Product"
  ALTER COLUMN "price" TYPE DOUBLE PRECISION USING "price"::double precision;
```

**Vuelve la estructura, no la información.** Los decimales que se redondearon
al aplicar no vuelven a aparecer: eran ruido de punto flotante y ya no están.
Si eso importara --no debería-- el respaldo previo es la única fuente.

## Riesgo

| Riesgo                                        | Probabilidad          | Impacto                   | Mitigación                                                                                                                |
| --------------------------------------------- | --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Un importe fuera de rango aborta la migración | Muy baja              | La migración no se aplica | Comprobación previa con mensaje claro; la transacción no deja nada a medias                                               |
| El código viejo lee `Decimal` como objeto     | Baja                  | Cálculos mal              | Orden de despliegue documentado arriba; `DOWN` disponible                                                                 |
| Bloqueo prolongado en tablas calientes        | Baja                  | Caja parada unos segundos | Ventana de mantenimiento                                                                                                  |
| Un `Float` con más de 2 decimales se redondea | Alta (es el objetivo) | Ninguno                   | Es la corrección, no el daño                                                                                              |
| Queda una columna monetaria sin migrar        | Baja                  | Precisión mixta           | La prueba de migración consulta `information_schema` y falla si queda alguna `double precision` en las tablas del dominio |

## Cómo se prueba

`tests/migrations/chain.test.ts` cubre:

- **Desde cero.** La cadena entera sobre una base vacía. Las siete columnas
  quedan `numeric(14,2)`.
- **Sobre datos existentes.** Se siembra una base con el esquema de junio de
  2025 y valores con residuo de punto flotante (`4850.000000001`,
  `0.1 + 0.2`), se aplica la cadena y se comprueba el valor exacto resultante.
- **Que no quede ninguna.** Consulta a `information_schema.columns`: ninguna
  columna de las tablas del dominio puede seguir siendo `double precision`.
- **Que no haya deriva.** `prisma migrate diff --exit-code` contra el esquema.

`tests/unit/money.test.ts` cubre la aritmética, que es lo que de verdad se
rompía:

```
0.1 + 0.2 == 0.30           exacto
99.99 + 0.01 == 100.00      exacto
suma de líneas == total     sin diferencia de un centavo
vuelto = recibido − total   exacto
suma de pagos == total      exacto, con tres métodos
anulación revierte exacto   el contramovimiento cierra en cero
```

## Cómo queda el código

### En el servidor: nunca un `number`

```ts
// src/server/money.ts
export type Dinero = Prisma.Decimal
export function sumar(...montos: Dinero[]): Dinero
export function multiplicar(a: Dinero, b: Dinero | number): Dinero
export function comparar(a: Dinero, b: Dinero): -1 | 0 | 1
```

La regla es una sola y no admite excepción: **un importe no se convierte a
`number` para operar**. Ni con `Number(d)`, ni con `d.toNumber()`, ni sumando
en un `reduce` sobre floats. Se convierte a `number` únicamente para nada:
sale de la base como `Decimal` y sale hacia la API como cadena.

Hay una regla de ESLint que lo hace cumplir --`no-restricted-syntax` sobre
`.toNumber()` en `src/modules` y `src/server`-- porque una regla que sólo vive
en un comentario se rompe el día que alguien tiene apuro.

### En la API: cadenas decimales

```json
{ "total": "6540.00", "items": [{ "price": "4850.00", "quantity": 1 }] }
```

Un `number` de JSON es un `double` de IEEE 754: mandar el importe como número
lo devolvería al mismo tipo del que lo estamos sacando. Se manda como cadena,
con la escala fija, y el cliente no tiene que adivinar cuántos decimales tenía.

Se aceptan las dos formas **de entrada** --cadena y número-- para no romper a
nadie, y se normaliza a cadena en el borde.

### En el navegador: centavos enteros

```ts
// src/lib/money.ts
export type Monto = string // "1234.56"
export function aCentavos(m: Monto): number // 123456
```

El navegador también necesita hacer cuentas: el vuelto mientras se escribe, el
restante de un pago combinado. Hacerlas en `Float` mostraría "$0,00" restante
cuando falta un centavo.

No se agregó una biblioteca decimal al paquete del cliente. Para dos decimales
alcanza con trabajar en **centavos enteros**: `"1234.56"` → `123456`, sumar y
restar como enteros, y volver a formatear. Es exacto hasta
`Number.MAX_SAFE_INTEGER / 100`, unos 90 billones de pesos, y no pesa nada.

El parseo es por cadena, no `Number(m) * 100`: eso último da `114.99999999999999`
para `"1.15"`.

**El cliente calcula para mostrar; el servidor calcula para cobrar.** Lo que el
navegador computa es una previsualización. El total, el vuelto y el reparto de
pagos que se guardan los recalcula el servidor a partir de la base.

## Lo que esta migración NO hace

- **No agrega `Sale.total`.** Va en `phase3_sale_payments`, junto con la
  entidad que lo necesita.
- **No agrega `Product.cost`.** Va en `phase3_product_costs`.
- **No toca cantidades.** `SaleItem.quantity` y `BranchStock.quantity` siguen
  siendo `Int` hasta `phase3_product_units`, que es donde aparecen los
  productos por peso.
- **No borra `Product.value`.** Ver arriba.
