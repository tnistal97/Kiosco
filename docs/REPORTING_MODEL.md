# Reportes: qué se calcula y con qué

## El principio

**La rentabilidad histórica se calcula con el costo que tenía el producto al
venderse, nunca con el de hoy.**

```
Lunes    Coca a $1.500, costaba $1.000   →  ganancia $500
Viernes  llega mercadería a $1.300
```

Sin costo congelado, el informe del lunes se recalcula con el costo de hoy y la
ganancia del lunes pasa a $200. **El lunes ya pasó.** Su ganancia no puede
cambiar porque llegó un camión el viernes.

Es el mismo argumento por el que `SaleItem.price` existe desde siempre: cambiar
el precio de un producto no reescribe las ventas de ayer. `costAtSale` es su otra
mitad, y llegó tres fases después.

## `SaleItem.costAtSale`

```
costAtSale  NUMERIC(14,4)  NULL
```

Se copia de `Product.cost` en el momento de vender, dentro de la misma
transacción que crea la venta. Cuatro decimales, igual que el costo del producto:
se copia tal cual, sin redondear.

### `NULL` significa "no se sabía"

Y no se rellena. Ni con el costo de hoy —sería inventar exactamente el número que
esta columna existe para no inventar— ni con el historial de costos, que
permitiría estimar cuál regía en esa fecha pero mezclaría líneas reales con
líneas deducidas sin forma de distinguirlas.

Las ventas anteriores a la Fase 3D quedan en `NULL`, y los productos que nunca
tuvieron costo cargado también.

### Qué hace el informe con eso

Las excluye del cálculo **y dice cuántas fueron**:

```
Facturado        $128.400
Costo vendido     $79.250
Ganancia bruta    $49.150
Margen bruto          38,3 %

⚠ 12 de 87 líneas no tenían costo cargado y quedan fuera de este cálculo,
  junto con los $14.300 que facturaron.
```

La facturación que se compara contra el costo es **sólo la de las líneas con
costo conocido**. Comparar la facturación completa contra un costo parcial daría
un margen inflado, que es la misma mentira por otro camino.

Contarlas con costo cero las mostraría como lo más rentable del local.

## Las seis materias y sus permisos

| Reporte      | Permiso                  | Qué muestra                                                                               |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------------- |
| Ventas       | `reports.sales.view`     | Facturado, operaciones, ticket promedio, anuladas, por cajero, por medio de pago, por día |
| Rentabilidad | `reports.costs.view`     | Facturación, costo vendido, ganancia bruta, margen, y el desglose por producto            |
| Productos    | `reports.sales.view`     | Más y menos vendidos, cuántos no se vendieron                                             |
| Inventario   | `reports.inventory.view` | Productos, agotados, bajo mínimo, sin costo, movimientos por tipo                         |
| Compras      | `reports.purchases.view` | Total comprado, órdenes, recepciones, por proveedor, diferencias de costo                 |
| Caja         | `reports.cash.view`      | Turnos, diferencias, ingresos, egresos, retiros                                           |

Se separan por **materia** y no por pantalla, porque lo que hay que proteger es
la información y no el menú. `reports.view`, que era uno solo para todo,
desapareció en esta fase: daba lo mismo ver cuántas operaciones hubo que ver el
margen del negocio.

### La valorización del inventario es información de costos

El reporte de inventario muestra cantidades con `reports.inventory.view`. El
**stock valorizado** viaja sólo con `reports.costs.view`: sin ese permiso el
campo llega `null` y la tarjeta no se dibuja. No se esconde en la pantalla — no
sale de la respuesta, igual que el costo de un producto.

Es la única cifra del sistema que usa `Product.cost` (el actual) a propósito: la
pregunta es "cuánto vale **reponer** lo que tengo hoy", no "cuánto pagué por
ello".

## Decisiones de reparto

**El cajero no tiene ningún `reports.*`.** Ve sus ventas por `sales.view`, y la
caja que necesita para operar por `cash.view`. La facturación del local y el
ticket promedio son información de gestión. Es una línea de cambio si el almacén
decide otra cosa.

**El supervisor tiene ventas, caja e inventario, no costos.** Mismo motivo por el
que no tiene `products.cost.view`: está en el mostrador, su trabajo es que el
turno cierre, y el margen del negocio no hace falta para nada de eso.

**Compras tiene compras, costos e inventario, no caja ni ventas.** Separar quien
compra de quien cobra es el control básico contra el desvío de mercadería.

**El auditor tiene los cinco.** Es el único rol que ve todo sin poder cambiar
nada de lo que mira.

## Un defecto corregido de paso

Hasta esta fase, el endpoint del historial de ventas (`/api/admin/sales`) pedía
`reports.view`, que el cajero no tenía. Pero la entrada **"Ventas" del menú**
está gobernada por `sales.view`, que sí tiene.

Resultado: **el cajero veía el enlace y recibía un 403 al entrar**. Un enlace roto
para el rol más común del local.

El endpoint pasó a `sales.view` —es el historial de ventas, no un reporte— y la
**recaudación del rango** quedó protegida por `reports.sales.view`: llega `null`
sin el permiso. Contar operaciones y ver cuánto factura el local no son la misma
información.

## Rendimiento

Ni una consulta trae filas para sumarlas en JavaScript. Todo agrega en la base.

El caso que se corrigió: el total del historial de ventas hacía `findMany` sobre
`SaleItem` de todo el rango y sumaba con `Decimal.js`. Con un mes flojo eran
cientos de filas y no se notaba; con un año de un almacén que vende cien tickets
por día son decenas de miles de objetos construidos para devolver un número.

Los rankings devuelven 20 filas. Es suficiente para decidir y corto para leer;
un ranking de 4.000 productos no es un reporte, es un volcado.

## El día lo define la sucursal

Todo rango pasa por `rangoDeSucursal`. El agrupado "por día" convierte el
instante a la zona del local **dentro de la propia consulta**:

```sql
to_char(("date" AT TIME ZONE 'UTC' AT TIME ZONE $4), 'YYYY-MM-DD')
```

Agrupar por la fecha UTC pondría las ventas de después de las 21:00 en el día
siguiente, que es el error original de la Fase 3C escrito en SQL.

Ver [TIMEZONE_POLICY.md](TIMEZONE_POLICY.md).
