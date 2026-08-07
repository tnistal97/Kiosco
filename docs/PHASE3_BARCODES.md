# Códigos de barras: de uno a varios

## Por qué

Un producto puede tener más de un código, y no es un caso raro: el mismo yogur
cambia de código entre partidas, el proveedor manda el pack con un código
distinto al de la unidad, y una etiqueta rota se reemplaza por otra. Con un solo
código, el lector no encuentra la mitad de la mercadería y el cajero termina
buscando por nombre — que es exactamente lo que el lector vino a evitar.

## El modelo

```
ProductBarcode   id · productId · code · isPrimary · createdAt
```

Dos reglas, las dos en la base y no en el código:

| Regla                                 | Cómo se cumple                                                  |
| ------------------------------------- | --------------------------------------------------------------- |
| Un código apunta a UN solo producto   | `CREATE UNIQUE INDEX ON "ProductBarcode"("code")`               |
| Un producto tiene UN código principal | Índice único **parcial**: `... ("productId") WHERE "isPrimary"` |

El índice parcial es lo que permite tener todos los códigos alternativos que
haga falta sin aflojar la unicidad del principal.

**Para el lector, principal y alternativo son lo mismo.** La distinción es de
pantalla: el principal es el que se muestra en los listados. Escanear cualquiera
de los dos encuentra el mismo producto y se comporta idéntico. Hay una prueba
de extremo a extremo que lo comprueba con los dos códigos del mismo producto.

## Normalización: sólo se recorta

`btrim`, y nada más. **No se pasa a mayúsculas.**

Dos razones. La primera: hacerlo reescribiría códigos existentes durante una
migración, que es el tipo de cambio silencioso que este proyecto evita. La
segunda: para un lector, dos códigos que difieren en mayúsculas son dos códigos
distintos, y normalizarlos dejaría un producto inalcanzable con su propia
etiqueta.

Hay un `CHECK` que lo garantiza a nivel de fila:

```sql
CHECK ("code" = btrim("code") AND length("code") BETWEEN 1 AND 64)
```

## Qué pasa con `Product.barcode`

La preferencia era migrar completamente y no mantener dos fuentes de verdad.
**Eso es lo que se hizo**, con una salvedad de plazo que conviene decir clara.

Desde esta fase:

- `ProductBarcode` es la **única** fuente. Todo lo que lee o escribe códigos
  --el catálogo, el buscador, el lector, el historial de movimientos, la ficha--
  pasa por ahí.
- `Product.barcode` **no se lee y no se escribe**. Queda congelada, con su valor
  y su índice único.

No se borra en esta migración porque la regla 2 de
[DATABASE_MIGRATION_STRATEGY.md](DATABASE_MIGRATION_STRATEGY.md) lo prohíbe:

> **Nunca borrar en la misma migración que deja de usar algo.** Primero deja de
> escribirse, se despliega, se comprueba, y recién después se borra la columna.
> Entre las dos cosas tiene que haber al menos un despliegue.

La columna existe hoy por una sola razón: que la versión anterior de la
aplicación pueda volver a desplegarse. **Se borra en la Fase 3C**, en una
migración de una línea, cuando este despliegue lleve tiempo confirmado.

Mientras tanto no hay dos fuentes de verdad, porque sólo una se lee. Lo que hay
es una columna muerta con fecha de defunción, igual que `Product.value`.

### Consecuencia que conviene tener presente

Un producto creado **después** de esta fase tiene `Product.barcode = NULL` y sus
códigos en `ProductBarcode`. Si se revirtiera el despliegue, el código anterior
mostraría ese producto sin código de barras. Es una degradación describible y
temporal; la alternativa --mantener las dos columnas sincronizadas-- sería
exactamente la doble fuente de verdad que no queremos.

## El campo `barcode` de la API no cambió

Esto importa para no romper a nadie:

```json
{ "id": 12, "name": "Yerba", "barcode": "7790001000011" }
```

`barcode` sigue siendo el **código principal**, con el mismo nombre y en el mismo
lugar. Lo que se agrega es `alternateBarcodes`, y sólo en el detalle
(`GET /api/products/:id`), no en el listado: la caja pide hasta cien productos
por petición y no los necesita.

## Búsqueda: dos caminos con propósitos distintos

| Camino                            | Para qué                             | Coste                                      |
| --------------------------------- | ------------------------------------ | ------------------------------------------ |
| `GET /api/products?q=...`         | Buscar por nombre o parte del código | Recorrido con `ILIKE '%...%'`              |
| `GET /api/products/barcode/:code` | **El lector**                        | Un acierto sobre el índice único: una fila |

El endpoint dedicado es el cambio que importa para el rendimiento. Antes el
lector pedía veinte candidatos con `q=` y filtraba en el navegador; con diez mil
productos y varios códigos cada uno, esa diferencia deja de ser teórica. Hay una
prueba que mide el plan de consulta y falla si deja de usar el índice.

Un 404 de ese endpoint no es un error: es "ese código no está". Cualquier otro
fallo sí se propaga, porque el cajero tiene que saberlo antes de dar por
inexistente un producto que existe.

## Migración de los códigos actuales

Cada `Product.barcode` no vacío se copia como código **principal** de su
producto. `createdAt` es la fecha de la migración: no existe en ninguna parte el
dato de cuándo se le puso el código, y no se inventa.

La migración **aborta** si algún código no se pudo copiar, con el nombre de los
productos afectados. La causa más probable sería que dos productos compartieran
el mismo código, cosa que el índice único anterior debería haber impedido; si
pasó, es un dato que hay que mirar antes de seguir, no algo que la migración
deba resolver sola.

## Borrado de un producto

`ON DELETE CASCADE`, a diferencia del libro de inventario y del historial de
costos, que son `RESTRICT`.

Un código de barras **no es historia**: es un atributo del producto, como el
nombre. Sin el producto no significa nada, y conservarlo impediría borrar un
producto cargado por error — que desde la Fase 3A es el único caso en que un
producto todavía se puede borrar.
