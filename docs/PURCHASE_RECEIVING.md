# Recepción de mercadería

## Una transacción, quince pasos

Confirmar una recepción hace todo esto, y lo hace **junto**:

| #   | Paso                                                   | Si falla                   |
| --- | ------------------------------------------------------ | -------------------------- |
| 1   | Cargar la orden y comprobar que es de esta sucursal    | 404                        |
| 2   | Comprobar el estado (`ORDERED` o `PARTIALLY_RECEIVED`) | 409 `ORDER_NOT_RECEIVABLE` |
| 3   | Comprobar que el proveedor sigue activo                | 409 `SUPPLIER_INACTIVE`    |
| 4   | Comprobar que las líneas pertenecen a esta orden       | 400                        |
| 5   | Comprobar cantidades contra lo pendiente               | 409 `OVER_RECEIPT`         |
| 6   | Crear `PurchaseReceipt`                                |                            |
| 7   | Crear los `PurchaseReceiptItem`                        |                            |
| 8   | Sumar a `receivedQuantity`, atómicamente               | 409 `OVER_RECEIPT`         |
| 9   | Emitir `StockMovement` de tipo `PURCHASE_RECEIPT`      |                            |
| 10  | Actualizar `BranchStock`                               | (lo hace el paso 9)        |
| 11  | Actualizar `Product.cost`                              |                            |
| 12  | Escribir `ProductCostHistory` si el costo cambió       |                            |
| 13  | Actualizar `ProductSupplier.lastCost`                  |                            |
| 14  | Recalcular el estado de la orden                       |                            |
| 15  | Auditar                                                |                            |

**Si falla el séptimo producto de diez, no queda recibido ninguno.** No hay
recepción a medias: el camión entró entero o no entró.

Los pasos 9 y 10 son uno solo desde afuera: la recepción llama a
`applyStockMovement`, que es la única puerta que escribe sobre `BranchStock` y
la que garantiza que el libro y el saldo no se separen. La recepción **no toca
el stock directamente**; hay una regla de ESLint que lo impide.

## Recibir de menos, sí. De más, no.

```
Coca Cola

Pedido:     10 cajas
Recibido:    6 cajas
Pendiente:   4 cajas

Recibir ahora:  [ 4 ]
```

Recibir menos de lo pendiente es normal y no necesita explicación: el
proveedor mandó lo que tenía.

**Recibir más de lo pedido se rechaza.** Y no se rechaza sólo en el servicio:

```sql
CHECK ("receivedQuantity" <= "orderedQuantity")
```

Con esa restricción, ninguna fila que diga "recibí 12 de 10" puede existir,
venga de donde venga.

### Dos recepciones simultáneas

Es el caso que el `CHECK` solo no resuelve, porque dos transacciones pueden
comprobar por separado y confirmar las dos. La solución es la misma que cierra
la venta de la última unidad desde la Fase 0: **decidir y escribir en la misma
sentencia**.

```sql
UPDATE "PurchaseOrderItem"
   SET "receivedQuantity" = "receivedQuantity" + $delta
 WHERE "id" = $id
   AND "receivedQuantity" + $delta <= "orderedQuantity"
RETURNING "receivedQuantity"
```

PostgreSQL toma el bloqueo de la fila y **reevalúa la condición después de
esperarlo**. Con 5 pendientes y dos procesos pidiendo 4 cada uno:

```
A pide 4  →  0 + 4 <= 5   ✓  recibe 4
B pide 4  →  4 + 4 <= 5   ✗  no actualiza ninguna fila → 409
```

Nunca 8 recibidos de 5. Sin fila devuelta, la transacción entera se deshace.

La versión ingenua --leer, comparar en JavaScript, escribir-- deja un hueco
entre la lectura y la escritura. Ese hueco no se cierra con más
comprobaciones: se cierra no teniéndolo.

### Sobre-recepción, si alguna vez hace falta

Hoy **no se permite**, que es la preferencia declarada. El día que un almacén
necesite aceptar las 12 cajas que mandaron cuando había pedido 10, lo que hace
falta es: relajar el `CHECK` a una tolerancia declarada, un permiso propio y
que la diferencia quede visible como tal. Es un cambio de política, no un
agujero que dejamos abierto por las dudas.

## Costo: la última recepción manda

```
Product.cost = stockUnitCost de la última recepción confirmada
```

Antes $900, llega una recepción a $1.025 → `Product.cost` pasa a $1.025.

Es la política **LAST RECEIVED COST**. No es promedio ponderado y no es FIFO,
y la diferencia es real: con promedio ponderado, 100 unidades a $900 más 40 a
$1.025 darían $935,71. Con esta política dan $1.025.

Por qué la última y no el promedio, para un almacén: **el precio de venta se
fija mirando a cuánto hay que reponer**, no a cuánto costó lo que está en la
góndola. Si la próxima caja sale $1.025, vender a un margen calculado sobre
$935 es vender perdiendo. El promedio ponderado es la respuesta correcta para
valuar un inventario en un balance; la última recepción es la respuesta
correcta para poner un precio en una etiqueta.

Cada cambio deja su fila inmutable:

```
ProductCostHistory
  previousCost  900,0000
  newCost      1025,0000
  supplierId   → Distribuidora X
  receiptId    → la recepción concreta
  userId       → quién recibió
  reason       "Recepción OC-00000042"
```

**`receiptId`, no `purchaseId`.** El costo cambia cuando la mercadería
**llega**, no cuando se pide: una orden confirmada a $1.025 que nunca llega no
tiene por qué haber movido nada. Apuntar a la recepción también permite
distinguir las dos recepciones de una misma orden, que pueden traer costos
distintos.

Si el costo recibido es **igual** al que ya tenía, no se escribe historial. Un
"cambio" que deja el número igual es ruido que después hace parecer que el
costo se movió cuando no se movió — y hay un `CHECK` en la base que lo impide
de todos modos.

### Concurrencia de costos

Dos recepciones del mismo producto confirmando a la vez: **la que confirma
último gana**, y es lo correcto — es la última en el orden real de los hechos.

PostgreSQL lo garantiza sin ayuda: el `UPDATE` sobre `Product.cost` toma el
bloqueo de la fila, así que la segunda espera a la primera y escribe encima.
Las dos filas de `ProductCostHistory` quedan, en orden, y la segunda tiene como
`previousCost` lo que dejó la primera. El historial cuenta la secuencia real.

## Costo esperado ≠ costo recibido

La orden decía $1.000. La factura dice $1.050. Pasa todo el tiempo.

**El receptor puede corregirlo**, con dos permisos: `purchases.receive` para
recibir y `products.cost.update` para tocar el costo. Sin el segundo, recibe al
costo pedido y no puede cambiarlo.

Lo que **no** pasa es que la orden original se reescriba. Los dos números
quedan guardados y la diferencia queda a la vista:

```
Coca Cola

Costo esperado:   $ 8.800,00   (lo que dice la orden)
Costo recibido:   $ 8.900,00   (lo que dice la factura)
Diferencia:       $   100,00   +1,1 %
```

Modificar `PurchaseOrderItem.unitCost` al recibir haría desaparecer la
diferencia, y con ella la única pista de que el proveedor aumentó. La orden
dice lo que se pidió. La recepción dice lo que llegó. Ninguna de las dos miente
por comodidad de la otra.

La diferencia se audita aparte, con su propia entrada, para poder preguntar
después "¿en qué recepciones nos cobraron de más?".

## Una recepción confirmada no se edita

`PurchaseReceipt` y `PurchaseReceiptItem` son **inmutables**, con disparador en
la base:

```sql
CREATE TRIGGER "PurchaseReceipt_inmutable"
  BEFORE UPDATE OR DELETE ON "PurchaseReceipt"
  FOR EACH ROW EXECUTE FUNCTION "purchase_receipt_inmutable"();
```

Mismo mecanismo que `StockMovement` y que `ProductCostHistory`, y por el mismo
motivo: una recepción movió stock y cambió un costo. Editarla dejaría el libro
de inventario contando una historia y la recepción contando otra.

Un error se corrige **con un movimiento nuevo**, no editando el anterior. Se
recibió de más: un ajuste de inventario con su motivo. Se recibió al costo
equivocado: un cambio de costo con su motivo. Las dos cosas dejan su propio
rastro, que es exactamente lo que hace falta para entender qué pasó.

### Devolución a proveedor: punto de extensión

**No está implementada.** Cuando llegue, el lugar es:

```
StockMovement.type = 'PURCHASE_RETURN'      delta negativo
PurchaseReturn                              cabecera propia, inmutable
PurchaseReturnItem                          qué se devolvió de qué recepción
```

`PURCHASE_RETURN` **todavía no figura** en el catálogo de tipos ni en la
restricción de la base. Se agrega en la fase que la implemente, junto con su
tabla — reservarlo ahora sería dejar un tipo que nada emite y que aparece en
los selectores de filtro sin resultados.

Lo que **no** hay que hacer, y por eso queda escrito acá: resolver una
devolución con un ajuste de inventario. Un ajuste dice "faltan 3" y una
devolución dice "le devolví 3 a Distribuidora X, de la recepción del 8, porque
vinieron rotas". Es la misma resta de stock y es información completamente
distinta.

## Qué ve el dashboard

Para quien tiene `purchases.view`:

- órdenes pendientes de recibir (`ORDERED`);
- recepciones parciales (`PARTIALLY_RECEIVED`), que son las que hay que
  perseguir.

Sin `purchases.view` no aparece la sección. **El importe total sólo se muestra
a quien tiene `products.cost.view`**: un total de compras es información
financiera tanto como un costo unitario, y esconderla en la ficha para
mostrarla sumada en la portada no sería esconderla.
