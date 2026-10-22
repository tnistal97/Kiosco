# Productos de House cargados como bulto, pasados a unidades

La caja vende siempre **por unidad**. Las dos listas de stock de House traían 12 filas
cargadas como bulto, por ejemplo "Clight naranja 8g bulto x20", con la cantidad en
**bultos**. Desde el 22/10/2026 cada una es una sola fila con el nombre de la unidad y el
stock en unidades: 20 bultos × 20 = 400 sobres.

Lo hace `scripts/normalizar-bultos.ts`. La regla está en `scripts/lib/bultos.ts` y la
aplicación en `scripts/lib/normalizar-bultos.ts`.

> **Auditoría del 22/10/2026, contra las fotos de los tickets:** la cantidad de las 12
> filas ya eran **unidades**. El ticket imprime "2(4) x precio por bulto", y la lista tiene
> 2 × 4 = 8. La normalización multiplicó dos veces: hay 2872 unidades de más en 12
> productos. No se corrigió. Ver [`auditoria-stock-house.md`](auditoria-stock-house.md).

## Qué es cada cantidad

El dueño confirmó el 22/10/2026 que en las filas de bulto la cantidad cuenta **bultos**.
Queda anotado porque las listas sugerían otra cosa: en las 12 filas la cantidad es N o un
múltiplo exacto de N (bulto x20 → 20, bulto x6 → 12), y la columna de la segunda lista se
llama "Stock unidades". Si alguna vez hace falta deshacerlo, cada ajuste dice en su motivo
cuántos bultos multiplicó.

## 1. Relevamiento

Se releyeron completas `Stock/stock_kiosco_ticket.xlsx` (lista 1, 79 filas) y
`Stock/stock_kiosco_ticket_2.xlsx` (lista 2, 113 filas). Las dos son las mismas de la
carga del 22/10: tienen la misma huella SHA-256.

Las listas escriben el bulto de **dos** formas: "(bulto x4)" y "bulto x8" al final del
nombre. Ningún bulto aparece como "pack x" ni como "bulto" sin la x. "caja x" aparece una
sola vez, en "Raid tabletas caja x24", que es el producto que se vende. Los multiplicadores
son 4, 6, 8, 12, 18, 20 y 25.

| Archivo | Fila | Descripción original                        | Cantidad | Multiplicador | Nombre base                     | Unidades reales | ¿Tiene unidad? | Producto unitario                                 |
| ------- | ---: | ------------------------------------------- | -------: | ------------: | ------------------------------- | --------------: | -------------- | ------------------------------------------------- |
| lista 1 |    4 | Aceitunas Natura girasol 5 L (bulto x4)     |        8 |            x4 | Aceitunas Natura girasol 5 L    |              32 | sí             | Aceitunas Natura girasol 5 L (lista 1, fila 3: 1) |
| lista 1 |   68 | Puré de tomate Noel brick 520 g (bulto x12) |       24 |           x12 | Puré de tomate Noel brick 520 g |             288 | no             | —                                                 |
| lista 2 |    7 | Baño Pronto naranja 1L bulto x8             |        8 |            x8 | Baño Pronto naranja 1L          |              64 | no             | —                                                 |
| lista 2 |    8 | Baño Pronto naranja 200cc bulto x18         |       18 |           x18 | Baño Pronto naranja 200cc       |             324 | no             | —                                                 |
| lista 2 |   16 | Cerveza Andes Roja lata 473cc bulto x6      |        6 |            x6 | Cerveza Andes Roja lata 473cc   |              36 | no             | —                                                 |
| lista 2 |   19 | Cerveza Corona porrón 330/355cc bulto x6    |       12 |            x6 | Cerveza Corona porrón 330/355cc |              72 | no             | —                                                 |
| lista 2 |   24 | Encendedor Candela bulto x25                |       25 |           x25 | Encendedor Candela              |             625 | no             | —                                                 |
| lista 2 |   26 | Red Bull 250ml bulto x4                     |        4 |            x4 | Red Bull 250ml                  |              16 | no             | —                                                 |
| lista 2 |   53 | Clight limonada rosa 7.5g bulto x20         |       20 |           x20 | Clight limonada rosa 7.5g       |             400 | no             | —                                                 |
| lista 2 |   54 | Clight manzana deliciosa 7g bulto x20       |       20 |           x20 | Clight manzana deliciosa 7g     |             400 | no             | —                                                 |
| lista 2 |   55 | Clight naranja dulce 7.5g bulto x20         |       20 |           x20 | Clight naranja dulce 7.5g       |             400 | no             | —                                                 |
| lista 2 |   56 | Clight naranja 8g bulto x20                 |       20 |           x20 | Clight naranja 8g               |             400 | no             | —                                                 |

### Presentaciones múltiples que NO son bulto

Se dejaron como están porque el envase se vende entero y la cantidad cuenta envases. No hay
nada en las listas que diga otra cosa.

| Lista | Fila | Producto                                         | Cantidad | Por qué no se toca                                                         |
| ----- | ---: | ------------------------------------------------ | -------: | -------------------------------------------------------------------------- |
| 2     |   98 | Raid tabletas caja x24                           |        6 | La caja de 24 tabletas es el producto.                                     |
| 2     |   30 | Esponja Task fibra spun oro plata x3             |        2 | Pack de 3 esponjas que se vende cerrado.                                   |
| 2     |   84 | Paño Virulana Twist x3                           |        2 | Pack de 3.                                                                 |
| 2     |   46 | Higienol Max HS 4x50m                            |        3 | Paquete de 4 rollos.                                                       |
| 2     |   11 | Curitas Nitos Frozen 20un                        |        3 | Caja de 20 curitas.                                                        |
| 2     |   12 | Curitas Transpiel 10un                           |        3 | Caja de 10 curitas.                                                        |
| 2     |   14 | Bolsas residuos Virutex rollo 45x60 x20          |        2 | Rollo de 20 bolsas.                                                        |
| 1     |   20 | Cereal bar Flow yogur frutilla bosque 6 x 27 g   |        3 | Caja de 6 barras. **Revisar**: si se venden sueltas, es otro producto.     |
| 1     |   25 | Chupetines Mr Pops Evolution blueberry 24 x 18 g |        1 | Caja de 24 chupetines. **Revisar**: en un kiosco suelen venderse de a uno. |
| 1     |   26 | Chupetines Mr Pops Evolution cereza 24 u         |        1 | Igual que el anterior.                                                     |

"Trapo piso My Hogar tejido blanco 40x60" es una medida, y "doypack" y "brick" son el tipo
de envase.

## 2. Bulto y unidad

La unidad se busca por el nombre **completo**, ignorando solo tildes, mayúsculas y espacios.
El nombre ya incluye marca, variedad y medida. Solo se juntan dos filas cuando el nombre
coincide entero:

| Consolidaciones                      | Cantidad | Cuáles                                                                       |
| ------------------------------------ | -------: | ---------------------------------------------------------------------------- |
| Bulto y unidad juntos (match seguro) |        1 | Aceitunas Natura girasol 5 L                                                 |
| Solo bulto: se renombra              |       11 | El resto                                                                     |
| Ambiguos                             |        0 | La regla no encontró ningún nombre casi igual, y nada se juntó por parecido. |

Una fila no se junta con otra que solo se le parece, aunque sea de la misma marca. Corona
porrón 330/355 cc no es la Corona lata 473 cc ni la descartable de 710 cc. Baggio Pronto
naranja 1 L no es el Baggio Fresh naranja 1 L. Clight naranja 8 g no es el Clight naranja
dulce 7,5 g.

Un nombre casi igual al de la unidad no se adivina: queda para revisar y no se toca. Por
ejemplo, "Red Bull 250ml" contra "Red Bull lata 250 ml". Tampoco se toca un bulto que ya
tuvo ventas o ajustes, porque no se sabe si esas unidades eran bultos.

## 3. Resultado, producto por producto

| Antes: bulto                                | Bultos | Unidad que ya existía        | Stock previo | Después                             | Stock final |
| ------------------------------------------- | -----: | ---------------------------- | -----------: | ----------------------------------- | ----------: |
| Aceitunas Natura girasol 5 L (bulto x4)     |      8 | Aceitunas Natura girasol 5 L |            1 | **Aceitunas Natura girasol 5 L**    |      **33** |
| Puré de tomate Noel brick 520 g (bulto x12) |     24 | — (no había)                 |            — | **Puré de tomate Noel brick 520 g** |     **288** |
| Baño Pronto naranja 1L bulto x8             |      8 | — (no había)                 |            — | **Baño Pronto naranja 1L**          |      **64** |
| Baño Pronto naranja 200cc bulto x18         |     18 | — (no había)                 |            — | **Baño Pronto naranja 200cc**       |     **324** |
| Cerveza Andes Roja lata 473cc bulto x6      |      6 | — (no había)                 |            — | **Cerveza Andes Roja lata 473cc**   |      **36** |
| Cerveza Corona porrón 330/355cc bulto x6    |     12 | — (no había)                 |            — | **Cerveza Corona porrón 330/355cc** |      **72** |
| Encendedor Candela bulto x25                |     25 | — (no había)                 |            — | **Encendedor Candela**              |     **625** |
| Red Bull 250ml bulto x4                     |      4 | — (no había)                 |            — | **Red Bull 250ml**                  |      **16** |
| Clight limonada rosa 7.5g bulto x20         |     20 | — (no había)                 |            — | **Clight limonada rosa 7.5g**       |     **400** |
| Clight manzana deliciosa 7g bulto x20       |     20 | — (no había)                 |            — | **Clight manzana deliciosa 7g**     |     **400** |
| Clight naranja dulce 7.5g bulto x20         |     20 | — (no había)                 |            — | **Clight naranja dulce 7.5g**       |     **400** |
| Clight naranja 8g bulto x20                 |     20 | — (no había)                 |            — | **Clight naranja 8g**               |     **400** |

|                                     | Antes |  Después |
| ----------------------------------- | ----: | -------: |
| Productos activos                   |   192 |      191 |
| Unidades                            |   823 | **3695** |
| Productos que dicen "bulto"         |    12 |    **0** |
| Productos con precio distinto de $0 |     0 |    **0** |
| Productos con foto                  |   148 |      147 |
| Productos con código de barras      |   113 |      105 |

Las unidades suben porque ahora los bultos se multiplican: 185 unidades en filas de bulto
pasan a ser 3057. El precio no se toca: todos siguen en $0.

### Cómo queda registrado

- **Stock:** cada cambio es un ajuste del libro de movimientos. El motivo lleva la
  cuenta, por ejemplo "Por unidad: 20 bultos x 20 = 400 u.". Se ve en el historial del
  producto y el libro sigue reconstruyendo el saldo.
- **Bulto consolidado:** "Aceitunas Natura girasol 5 L (bulto x4)" queda **dado de
  baja**, en 0, sin borrarse. Conserva su carga inicial y el ajuste que lo pasó a la
  unidad.
- **Renombrados:** son el mismo producto, con el mismo número y la misma foto. La
  bitácora guarda el nombre anterior.
- **Unidad de compra:** queda en "Caja" de N unidades, el mismo dato que usa Compras.
  Al recibir 2 cajas de Clight entran 40 sobres.

## 4. Códigos de barras

El código que traía cada fila de bulto es el de la **caja**. La lista misma lo marca con
"Bulto: verificar código de unidad individual". En la caja, escanearlo vendería una sola
unidad, así que **ninguno queda como código de venta**. Cada uno queda escrito en la
descripción del producto, por ejemplo "Código del bulto x20: 7622201682019 (no es el de
la unidad)", y en la bitácora.

Solo entraron dos códigos de unidad, los que se pudieron **verificar**. El código de la
lista es un DUN-14 de GS1, que contiene el código de la unidad, y además una tienda publica
la botella suelta con ese código. El detalle está en
[`bultos-house.json`](bultos-house.json).

| Producto                        | Código de la lista (bulto) | Código que queda | Código de la unidad sugerido: comparar con la etiqueta         |
| ------------------------------- | -------------------------- | ---------------- | -------------------------------------------------------------- |
| Baño Pronto naranja 1L          | `37790036000320`           | `7790036000329`  | Verificado                                                     |
| Baño Pronto naranja 200cc       | `27790036000569`           | `7790036000565`  | Verificado                                                     |
| Cerveza Andes Roja lata 473cc   | `7792798002337`            | ninguno          | `7792798992317` (Jumbo, la lata suelta)                        |
| Cerveza Corona porrón 330/355cc | `2792798003723`            | ninguno          | `7792798003709`, dudoso: Carrefour tiene tres Corona parecidas |
| Encendedor Candela              | `7798322400686`            | ninguno          | —                                                              |
| Red Bull 250ml                  | `9002490203306`            | ninguno          | `9002490100070` (Más Online, la lata suelta)                   |
| Clight limonada rosa 7.5g       | `7622201682019`            | ninguno          | `7622201682026` (Más Online, el sobre)                         |
| Clight manzana deliciosa 7g     | `7622201703073`            | ninguno          | `7622201703080` (Carrefour, el sobre)                          |
| Clight naranja dulce 7.5g       | `7622201703134`            | ninguno          | `7622210812797` (Carrefour, el sobre)                          |
| Clight naranja 8g               | `7622201703103`            | ninguno          | `7622201703110` (Carrefour, el sobre)                          |

Aceitunas Natura y Puré Noel no tenían código en la lista.

Los sugeridos **no se cargaron** porque salen de un solo catálogo. Para cargar uno, se
escanea el envase suelto en el local y se agrega desde la ficha del producto ("Código de
barras").

## 5. Fotos

- **Aceitunas Natura girasol 5 L:** el bulto y la unidad tenían la misma foto. Queda la
  de la unidad y la del bulto se quitó, para no tener dos copias.
- **Los 11 renombrados:** mantienen la foto, que ya era la de la unidad: el sobre de
  Clight, la botella de Baggio, el brick de Noel.
- **Andes Roja y Red Bull:** tenían la foto del pack de 6 y de 4, porque salía del
  código del bulto. Se reemplazaron por la de la lata suelta, revisada a ojo, y quedaron
  en [`imagenes-house.json`](imagenes-house.json).
- **Corona porrón y Encendedor Candela:** siguen sin foto. Estaban entre las ambiguas.

## 6. En producción

Aplicado el 22/10/2026 a las 12:47 UTC, con la versión `a2b54e2`. El ensayo y la
aplicación dieron lo mismo que la sección 3: 12 pasos, ninguno para revisar, 191
productos y 3695 unidades. Una segunda pasada no encontró nada que hacer. Después se
cargaron las 147 fotos, y una segunda carga no escribió ninguna. El catálogo de
producción quedó igual, fila por fila, al que se revisó en local.

Se hizo en este orden:

1. Desplegar la rama, con la migración de fotos de `docs/PRODUCT_IMAGES.md`.
2. Normalizar, primero en ensayo. El ensayo hace todo dentro de una transacción, muestra
   el resultado y la deshace:

   ```bash
   npx tsx scripts/normalizar-bultos.ts --sucursal 1 --autor <admin> --codigos docs/manual-house/bultos-house.json --ensayo
   npx tsx scripts/normalizar-bultos.ts --sucursal 1 --autor <admin> --codigos docs/manual-house/bultos-house.json --aplicar
   ```

   El ensayo tiene que mostrar lo mismo que la sección 3: 191 productos y 3695 unidades.
   Si un bulto tuvo ventas o ajustes desde la carga, aparece como "REVISAR" y no se toca.

3. Cargar las fotos con `cargar-imagenes`. El manifiesto ya tiene los nombres por unidad.

Repetir cualquiera de los dos pasos no cambia nada: lo ya normalizado no dice "bulto", y
una foto igual no se vuelve a escribir.
