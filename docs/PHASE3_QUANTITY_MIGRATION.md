# Migración de las cantidades: de Int a Decimal

> Se escribe **antes** de tocar la base, igual que
> [PHASE3_MONEY_MIGRATION.md](PHASE3_MONEY_MIGRATION.md). Lo que sigue es la
> decisión con su justificación y su vuelta atrás; las migraciones implementan
> esto y nada más.

## Por qué

Un almacén vende queso. El queso no viene en unidades: viene en 0,425 kg. Hoy
todas las cantidades del sistema son `Int`, así que la única forma de vender
425 gramos es no venderlos.

Eso es la mitad del problema. La otra mitad es **con qué tipo** se arregla, y
ahí no hay margen de opinión.

La Fase 3A dejó tres reglas escritas en la base como restricciones `CHECK`:

```sql
CHECK ("resultingQuantity" = "previousQuantity" + "quantity")
CHECK ("resultingQuantity" >= 0 AND "previousQuantity" >= 0)
```

Con `double precision`, la primera **falla sola**. `5.5 - 0.25` da exactamente
`5.25` en binario porque los tres números son potencias de dos, pero
`0.1 + 0.2` da `0.30000000000000004`, y un ajuste de 0,1 kg sobre un saldo de
0,2 kg escribiría una fila que PostgreSQL rechaza. La restricción no es un
adorno: es lo que hace que el libro de inventario signifique algo. No se puede
apoyar en un tipo donde la suma no es la suma.

Así que la elección no es "Decimal o Float": es **Decimal, porque Float rompe
una restricción que ya existe y que no se va a aflojar**.

## Qué se migra

| Modelo          | Campo               | Tipo actual | Tipo nuevo      | Precisión | Escala | Compatibilidad hacia atrás | Riesgo | Transformación histórica             |
| --------------- | ------------------- | ----------- | --------------- | --------- | ------ | -------------------------- | ------ | ------------------------------------ |
| `BranchStock`   | `quantity`          | `Int`       | `Decimal(14,3)` | 14        | 3      | Lee bien, escribe bien     | Bajo   | `24` → `24.000`. Exacta, sin pérdida |
| `StockMovement` | `quantity`          | `Int`       | `Decimal(14,3)` | 14        | 3      | Lee bien, escribe bien     | Bajo   | `-2` → `-2.000`. Exacta              |
| `StockMovement` | `previousQuantity`  | `Int`       | `Decimal(14,3)` | 14        | 3      | Lee bien, escribe bien     | Bajo   | Exacta                               |
| `StockMovement` | `resultingQuantity` | `Int`       | `Decimal(14,3)` | 14        | 3      | Lee bien, escribe bien     | Bajo   | Exacta                               |
| `SaleItem`      | `quantity`          | `Int`       | `Decimal(14,3)` | 14        | 3      | Lee bien, escribe bien     | Bajo   | Exacta                               |
| `Product`       | `minimumStock`      | `Int`       | `Decimal(14,3)` | 14        | 3      | Lee bien, escribe bien     | Bajo   | `6` → `6.000`. Exacta                |

Seis columnas en cuatro tablas. Se buscaron **por tipo y por significado**, no
por nombre: la consulta fue "toda columna entera que represente una cantidad
física de mercadería".

Lo que quedó afuera, con su motivo:

| Columna               | Por qué no                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `Product.value`       | `Int?` muerta desde mayo de 2025. No representa nada. Borrarla es lo que la estrategia prohíbe |
| `CashCount.amount`    | Es dinero. Ya es `Decimal(14,2)`                                                               |
| `StockCheck`          | No tiene cantidad: sólo registra quién revisó y cuándo                                         |
| `SalePayment.amount`  | Es dinero                                                                                      |
| `Pagination.pageSize` | Es un tamaño de página, no mercadería                                                          |

Y una columna **nueva** que nace ya decimal, en la migración siguiente:

| Modelo    | Campo                  | Tipo            | Migración              |
| --------- | ---------------------- | --------------- | ---------------------- |
| `Product` | `unitsPerPurchaseUnit` | `Decimal(14,3)` | `phase3_product_units` |

## Precisión y escala: `Decimal(14,3)`

### Escala 3

Tres decimales es exactamente **un gramo dentro de un kilo** y **un mililitro
dentro de un litro**. No es una cifra elegida por prolija: es la resolución de
las balanzas de mostrador, que pesan al gramo, y la de cualquier envase que un
cliente pueda verificar.

El requisito del pedido — poder representar `0.001` sin error — se cumple con
holgura y de forma exacta, porque `numeric` es base 10.

**Por qué no más.** Escala 4 permitiría `0,0001 kg`, o sea una décima de gramo.
Ninguna balanza de almacén la mide y ningún cliente la puede comprobar. Cada
decimal de más es un lugar donde puede esconderse una diferencia de redondeo
que nadie va a poder explicar.

**Por qué no menos.** Con escala 2 el gramo desaparece: 0,425 kg se guardaría
como 0,43 kg, y cinco cortes de queso acumularían 25 gramos que nadie vendió.

Hay una asimetría deliberada con el dinero, que usa escala 2 para lo que se
cobra y 4 para el costo unitario, que se deriva de una división. Las cantidades
usan una sola escala porque no se derivan de ninguna división: se pesan.

### Precisión 14

Deja 11 dígitos enteros. Cualquier cantidad concebible entra con muchísimo
margen; el tope real lo pone la validación de la aplicación
(`CANTIDAD_MAX = 1.000.000`), que es donde tiene que estar.

Se eligió 14 y no un número más justo para que **todas las columnas numéricas
del proyecto tengan la misma precisión**: `Decimal(14,2)` el dinero,
`Decimal(14,4)` el costo unitario, `Decimal(14,3)` las cantidades. Un solo
número que recordar, y la escala dice de qué se está hablando. En `numeric` el
almacenamiento es variable, así que la precisión de sobra no cuesta bytes.

## Estrategia de normalización: se guarda en la unidad de venta

Las dos alternativas que se evaluaron:

**A.** Guardar `0.250` con `saleUnit = KG`.
**B.** Normalizar internamente a `250` gramos y mostrarlo como kg.

### Se elige A

El argumento decisivo es que **el precio ya está denominado en la unidad de
venta**. El queso vale `$9.800/kg`, no `$9,80/g`. Con la estrategia A el
subtotal de una línea es una multiplicación directa entre dos columnas de la
misma fila:

```
subtotal = price × quantity        9800,00 × 0,425 = 4165,00
```

Con la estrategia B habría que dividir el precio por mil antes de multiplicar,
**en el cálculo que más veces se ejecuta de todo el sistema**. Y la propiedad
que hace verificable un ticket viejo — que precio por cantidad dé el subtotal,
leyendo la fila y nada más — dejaría de poder comprobarse sin conocer la tabla
de conversiones vigente el día de la venta.

### Consecuencias, revisadas una por una

| Área             | Con la estrategia A                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stock**        | `BranchStock.quantity` está en la unidad de venta del producto. `3.500` en un producto KG son tres kilos y medio                                                                             |
| **Movimientos**  | El libro hereda la unidad del producto. Una fila del historial se lee junto al producto, que es como se la lee en la pantalla                                                                |
| **Mínimos**      | `minimumStock` está en la misma unidad que el stock, que es la única forma de que la comparación `stock <= mínimo` tenga sentido                                                             |
| **Reportes**     | "Cuántos kg de queso se vendieron" es una suma de la columna, sin conversión                                                                                                                 |
| **Compras (3C)** | Es donde aparece la conversión, y ahí es inevitable con cualquiera de las dos estrategias: se compra una caja y se venden unidades. Para eso existen `purchaseUnit` y `unitsPerPurchaseUnit` |

### El riesgo de A, y cómo se cierra

La estrategia A tiene un punto débil real: si alguien cambia el `saleUnit` de
un producto de KG a G, **todas sus filas históricas cambian de significado en
silencio**. Un movimiento de `0.250` que era un cuarto de kilo pasa a leerse
como un cuarto de gramo, y nada falla.

Con la estrategia B eso no pasa, porque el número guardado nunca cambia de
significado.

La mitigación no es documental: **`saleUnit` no se puede cambiar en un producto
que ya tiene movimientos de stock o líneas de venta**. Se comprueba en el
servidor y devuelve 409 `PRODUCT_UNIT_LOCKED`. Un producto mal configurado y
todavía sin historial sí se corrige; uno con historial se da de baja y se carga
de nuevo, que es lo mismo que se hace hoy con un producto cargado mal.

Esto es una restricción de verdad y hay que decirla: **A es más simple mientras
la unidad no cambie, y la única forma de garantizar eso es prohibir el cambio.**

## Unidades de medida

### Dos listas, no una

```
Unidades de VENTA    UNIT  KG  G  L  ML
Unidades de COMPRA   UNIT  KG  G  L  ML  +  PACK  BOX
```

`PACK` y `BOX` existen **sólo como unidades de compra**, y esa asimetría es la
respuesta a si convenía agregarlas.

Como unidad de venta no aportan nada: un six-pack que se vende entero es un
producto que se vende por unidad, y la unidad es el six-pack. No hay ninguna
operación aritmética que distinga `PACK` de `UNIT` en la venta.

Como unidad de compra sí aportan, y son necesarias para que
`unitsPerPurchaseUnit` se pueda leer. El ejemplo del pedido:

```
Coca Cola 2.25 L    purchaseUnit BOX    unitsPerPurchaseUnit 8    saleUnit UNIT
Queso cremoso       purchaseUnit KG     unitsPerPurchaseUnit 1    saleUnit KG
Arroz suelto        purchaseUnit KG     unitsPerPurchaseUnit 1    saleUnit KG
```

Sin `BOX`, la primera línea habría que escribirla `purchaseUnit UNIT,
unitsPerPurchaseUnit 8`, que se lee "una unidad contiene ocho unidades".

### Regla de fraccionamiento

Vive en `src/modules/products/units.ts`, **sin Prisma**, y la importan las dos
puntas: el servidor para validar y el navegador para el paso del campo
numérico. No hay dos definiciones de la regla que puedan separarse.

| Unidad | Paso    | Mínimo  | Decimales | Ejemplo válido | Ejemplo rechazado |
| ------ | ------- | ------- | --------- | -------------- | ----------------- |
| `UNIT` | `1`     | `1`     | 0         | `3`            | `1.235` → 400     |
| `KG`   | `0.001` | `0.001` | 3         | `0.425`        | `0.4255`          |
| `L`    | `0.001` | `0.001` | 3         | `1.500`        | `0`               |
| `G`    | `1`     | `1`     | 0         | `250`          | `0.5`             |
| `ML`   | `1`     | `1`     | 0         | `500`          | `0.5`             |

### Por qué `G` y `ML` son enteros

Era la pregunta explícita del pedido: si `G` y `ML` se guardan de verdad como
gramos o si conviene normalizarlos internamente.

**Se guardan como gramos y mililitros**, coherente con la estrategia A. Y su
paso es **1, no 0,001**, porque medio gramo no lo pesa ninguna balanza de
mostrador y nadie lo vende. Permitir `0.5 G` sería ofrecer una precisión que no
existe fuera del sistema.

La consecuencia práctica es útil: **las únicas unidades fraccionables son `KG` y
`L`**. `UNIT`, `G` y `ML` se comportan igual entre sí para toda la validación,
y el diálogo de peso del punto de venta se abre exactamente para dos casos, no
para cinco.

Un producto de especias que se vende por gramo se configura `saleUnit = G` con
el precio por gramo. Uno que se vende por kilo, `saleUnit = KG`. Que las dos
formas existan no obliga a nadie a elegir mal: la pantalla propone la unidad y
muestra el precio con su denominador (`$9.800 / kg`).

## Restricciones del libro, adaptadas

Las tres restricciones de la Fase 3A siguen existiendo, con los mismos nombres,
sobre `numeric`:

```sql
CHECK ("resultingQuantity" = "previousQuantity" + "quantity")
CHECK ("resultingQuantity" >= 0 AND "previousQuantity" >= 0)
CHECK ( ("type" = 'INITIAL' AND "quantity" >= 0) OR ... )
```

**No hacen falta cambios en el texto de las restricciones.** `=`, `>=`, `<>` y
`+` funcionan sobre `numeric` con la misma semántica, y `ALTER COLUMN TYPE`
revalida cada restricción contra todas las filas al convertir. Que el SQL no
cambie es exactamente lo que se busca: la ley del dominio es la misma, cambia
el tipo sobre el que se escribe.

Lo que **sí** cambia son los ejemplos que ahora son representables:

```
SALE          5.500 → 5.250    delta -0.250
SALE_CANCEL   5.250 → 5.500    delta +0.250
LOSS          2.750 → 2.500    delta -0.250
```

### Casts en el servicio: los que había ya no sirven

`applyStockMovement` cerraba la ventana de concurrencia con una sola sentencia
que devolvía los dos saldos:

```sql
RETURNING (bs."quantity" - $1)::integer AS previo,
          bs."quantity"::integer        AS resultante
```

Ese `::integer` **truncaría** el decimal, que es precisamente el cast que pierde
precisión que hay que evitar. Se reemplaza por el propio tipo de la columna:

```sql
RETURNING (bs."quantity" - $1::numeric)::numeric(14,3) AS previo,
          bs."quantity"::numeric(14,3)                 AS resultante
```

`::numeric(14,3)` no pierde nada: los dos operandos ya son `numeric(14,3)`, así
que su resta tiene a lo sumo tres decimales y el cast sólo fija la escala del
resultado para que vuelva con la forma canónica. El `::numeric` sobre el
parámetro sí es necesario: sin él PostgreSQL no sabe de qué tipo es `$1`.

## Compatibilidad y orden de despliegue

Ésta es la **segunda migración no aditiva** del proyecto, después de la del
dinero, y comparte su característica incómoda: cambia el tipo de columnas con
datos.

La diferencia a favor es que `Int → Decimal` es **una ampliación**, no una
conversión con pérdida. Todo entero es un decimal exacto. Ninguna fila puede
fallar la conversión, ningún valor cambia, y por eso no hace falta la
comprobación previa de rango que sí necesitaba la del dinero.

La diferencia en contra es la misma que allá: **el código anterior recibe un
objeto `Decimal` donde espera un `number`**, y `24 + 1` sobre un objeto da la
cadena `"241"`. No revienta: calcula mal.

Por eso el orden de despliegue vuelve a ser el inverso al habitual:

1. **Primero** el código nuevo, que ya sabe leer `Decimal`.
2. **Después** la migración.

Y la vuelta atrás real es el `DOWN`, no el redespliegue.

### `DOWN`

Va comentado al final de la migración, como todas, y es simétrico:

```sql
ALTER TABLE "BranchStock"
  ALTER COLUMN "quantity" TYPE INTEGER USING ROUND("quantity")::integer;
```

**Y acá sí hay pérdida, al revés que en la ida.** Volver a `Int` redondea cada
cantidad fraccionada: 0,425 kg de queso pasa a ser 0 kg. Si en el momento de
revertir ya se vendió mercadería por peso, esa información **no está en ningún
otro lado**.

El `DOWN` es una salida de emergencia estructural, no un botón de deshacer. La
vuelta atrás buena es restaurar el respaldo.

## Riesgos

| Riesgo                                                        | Probabilidad | Impacto                                          | Mitigación                                                                                                      |
| ------------------------------------------------------------- | ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| El código viejo lee `Decimal` como objeto                     | Baja         | Cálculos mal, en silencio                        | Orden de despliegue documentado; `DOWN` disponible                                                              |
| Bloqueo por reescritura de tabla                              | Baja         | Caja parada unos segundos                        | Ventana de mantenimiento. `SaleItem` es la tabla más grande y son decenas de miles de filas                     |
| Un `Decimal` se convierte a `number` en algún servicio        | Media        | Vuelve el error de punto flotante por la ventana | Regla de ESLint sobre `src/modules/inventory` y `src/modules/products`, más una prueba que lee el código fuente |
| Alguien cambia el `saleUnit` de un producto con historial     | Media        | Todo su pasado cambia de significado             | Prohibido en el servidor con 409 `PRODUCT_UNIT_LOCKED`, con su prueba                                           |
| `1.235 UNIT` llega al servidor desde un cliente que no valida | Media        | Stock imposible de contar                        | La política de fraccionamiento se valida en el servidor, no sólo en React                                       |
| El `DOWN` redondea cantidades fraccionadas                    | Baja         | Pérdida de información real                      | Documentado arriba con todas las letras. El camino bueno es restaurar el respaldo                               |

## Cómo se prueba

- **Desde cero.** La cadena entera sobre base vacía; las seis columnas quedan
  `numeric(14,3)`.
- **Sobre datos de la Fase 3A.** Base con productos, ventas y libro de
  inventario; se aplica y se comprueba que ninguna cantidad cambió de valor y
  que el libro sigue cuadrando.
- **Que no quede ninguna.** Consulta a `information_schema.columns`: ninguna
  columna de cantidad de las tablas del dominio puede seguir siendo `integer`.
- **Que las restricciones sigan vivas.** Se intenta insertar una fila con
  `resultingQuantity != previousQuantity + quantity` usando decimales, y la base
  la rechaza.
- **Aritmética exacta.** `0.1 + 0.2 == 0.3` sobre cantidades, reconstrucción del
  stock desde el libro con fracciones, y concurrencia con dos ventas de 0,5 kg
  sobre un saldo de 0,75.
- **Sin deriva.** `prisma migrate diff --exit-code`.

## Cómo queda el código

Misma forma que el dinero, que ya está resuelta y probada:

### En el servidor: nunca un `number`

```ts
// src/server/cantidad.ts
export type Cantidad = Prisma.Decimal
export function cantidad(v: Prisma.Decimal.Value): Cantidad
export function sumarCantidades(...c: Cantidad[]): Cantidad
export function aCantidad(c: Cantidad): TextoCantidad // "0.425"
```

### En la API: cadenas decimales

```json
{
  "items": [{ "quantity": "0.425", "price": "9800.00", "subtotal": "4165.00" }]
}
```

Por lo mismo que el dinero: un `number` de JSON es un `double`, y mandar la
cantidad como número la devolvería al tipo del que la estamos sacando.

### En el navegador: milésimas enteras

```ts
// src/lib/cantidad.ts
export type TextoCantidad = string // "0.425"
export function aMilesimas(c: TextoCantidad): number // 425
```

Exactamente el mismo recurso que los centavos enteros del dinero, con la escala
que corresponde. No entra ninguna biblioteca decimal al paquete del cliente: la
aritmética de enteros en JavaScript es exacta hasta 2^53, o sea nueve billones
de kilos.

**El navegador calcula para mostrar; el servidor calcula para cobrar.** El peso
que se tipea en el diálogo de la balanza se muestra con su subtotal al
instante, y el subtotal que queda guardado lo vuelve a calcular el servidor.

## Lo que estas migraciones NO hacen

- **No agregan proveedores, compras ni recepción.** Fase 3C.
- **No conectan una balanza.** Se deja la interfaz `ScaleProvider` para que el
  diálogo de peso no quede casado con la entrada manual, y nada más. No hay
  WebSerial, no hay librería y no hay balanza simulada.
- **No tocan el dinero.** Ya está en `Decimal` desde `phase3_decimal_money`.
- **No borran `Product.value`.** Sigue muerta y sigue sin borrarse.
- **No borran `Product.barcode`.** Deja de leerse y de escribirse en esta fase;
  se borra en la siguiente, que es lo que exige la regla 2 de la estrategia de
  migraciones. Ver [PHASE3_BARCODES.md](PHASE3_BARCODES.md).
