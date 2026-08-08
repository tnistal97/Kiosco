# Proveedores

## Qué sabe el sistema de un proveedor

Lo mínimo que hace falta para comprarle, y nada más. Un almacén de barrio
muchas veces conoce esto y nada más:

```
Distribuidora Pepe
11-4567-8900
```

y eso tiene que ser un proveedor válido. **El único campo obligatorio es el
nombre.** Ni CUIT, ni correo, ni dirección, ni razón social: exigir cualquiera
de esos obligaría a inventarlos, y un CUIT inventado es peor que ningún CUIT
porque parece un dato.

| Campo         | Obligatorio | Para qué                                            |
| ------------- | ----------- | --------------------------------------------------- |
| `name`        | **sí**      | Cómo se lo nombra. Único en todo el sistema         |
| `legalName`   | no          | Razón social, cuando difiere del nombre de fantasía |
| `taxId`       | no          | Identificación fiscal. En Argentina, el CUIT        |
| `phone`       | no          | Lo que más se usa                                   |
| `email`       | no          | Validado **si viene**                               |
| `address`     | no          | Dónde está                                          |
| `contactName` | no          | Con quién se habla                                  |
| `notes`       | no          | "Pasa los martes", "no entrega los feriados"        |
| `isActive`    | sí          | Baja lógica                                         |

### `taxId` no se llama `cuit`

El modelo no se ata a un país. `taxId` con una longitud generosa y sin formato
impuesto sirve para un CUIT argentino, un RUT chileno o un NIF español, y no
obliga a migrar el día que el sistema cruce una frontera. Lo que **sí** es
argentino es la etiqueta de la pantalla, que dice "CUIT", y eso está bien: la
pantalla habla el idioma de quien la usa; la base, no.

No se valida el dígito verificador. Un CUIT mal tipeado es un problema real,
pero la validación completa exige la tabla de prefijos y el algoritmo, y este
sistema todavía no emite nada fiscal. Cuando llegue ARCA se valida; hacerlo
ahora sería rechazar datos que hoy no se usan para nada.

## Baja lógica, no borrado

Un proveedor **con actividad no se borra nunca**: hay órdenes de compra,
recepciones y cambios de costo que lo referencian, y borrarlo dejaría el
historial de compras apuntando al vacío. Se desactiva.

Un proveedor desactivado:

- **no se puede elegir** para una orden de compra nueva;
- **sigue apareciendo** en las órdenes viejas, con su nombre;
- se puede reactivar.

Lo que sí se borra: un proveedor cargado por error, sin una sola orden y sin
productos asociados. Es el mismo criterio que el producto cargado por error, y
existe por la misma razón — que alguien se equivoque en un alta no puede
obligarlo a convivir con la equivocación para siempre.

El borrado se niega con `SUPPLIER_HAS_HISTORY` y el mensaje dice qué lo
retiene: "tiene 3 orden(es) de compra". Un "no se puede" sin motivo obliga a
adivinar.

## Un producto, varios proveedores

La misma Coca Cola se le compra a quien la tenga esa semana. El modelo lo
refleja:

```
ProductSupplier   productId · supplierId · supplierCode? · lastCost? · isPreferred
```

```
Coca Cola 2,25 L
Proveedor principal:  Distribuidora X
También comprado a:   Distribuidora Y, Mayorista Z
```

Dos reglas, las dos en la base:

| Regla                                     | Cómo se cumple                                                |
| ----------------------------------------- | ------------------------------------------------------------- |
| Un proveedor aparece una vez por producto | `UNIQUE ("productId", "supplierId")`                          |
| Un producto tiene UN proveedor principal  | Índice único **parcial**: `("productId") WHERE "isPreferred"` |

Es el mismo índice parcial que resuelve el código de barras principal. Permite
todos los proveedores alternativos que haga falta sin aflojar la unicidad del
principal.

### `supplierCode`

El código con el que **el proveedor** llama a ese producto, que casi nunca es
el nuestro. Es lo que aparece en su remito y en su lista de precios, y sin él
cotejar una factura es un trabajo manual. Opcional: se carga cuando se sabe.

### `lastCost`

El último costo pactado **con ese proveedor**, en su unidad de compra. No es
historial: es un dato de referencia para armar la próxima orden, y por eso se
pisa en cada recepción.

El historial completo vive en `ProductCostHistory`, que sí es inmutable y sí
guarda contra qué recepción y contra qué proveedor cambió cada costo. Duplicar
esa información acá sería tener dos versiones de la misma verdad; tener un
"último" denormalizado al lado de un historial inmutable no lo es, del mismo
modo que `BranchStock.quantity` convive con el libro de inventario.

## Qué pasa con `Product.supplierId`

Existía desde 2025: un producto, un proveedor, y nada más.

Desde esta fase **`ProductSupplier` es la única fuente**. Todo lo que lee o
escribe la relación producto-proveedor pasa por ahí, incluida la ficha del
producto y el listado. `Product.supplierId` queda **congelada**: no se lee y no
se escribe.

No se borra en esta migración porque la regla 2 de
[DATABASE_MIGRATION_STRATEGY.md](DATABASE_MIGRATION_STRATEGY.md) lo prohíbe:

> **Nunca borrar en la misma migración que deja de usar algo.** Primero deja de
> escribirse, se despliega, se comprueba, y recién después se borra la columna.

Es exactamente el camino que recorrió `Product.barcode` entre la Fase 3B y
esta, que es donde se borra. `Product.supplierId` muere en la 3D, en una
migración de una línea.

**El campo `supplier` de la API no cambió.** Sigue siendo el proveedor
principal, con el mismo nombre y en el mismo lugar:

```json
{
  "id": 12,
  "name": "Coca Cola 2,25 L",
  "supplier": { "id": 3, "name": "Distribuidora X" }
}
```

Lo que se agrega es `suppliers` --la lista completa, con código y último
costo-- y sólo en el detalle. El listado devuelve hasta cien productos por
petición y no la necesita.

## Migración de los datos actuales

Cada `Product.supplierId` no nulo se copia como proveedor **principal** de su
producto. `lastCost` arranca en `Product.cost`, que es lo más cercano a un
costo conocido que hay; `supplierCode` arranca nulo, porque ese dato no existe
en ninguna parte y no se inventa.

La migración **aborta** si algún vínculo no se pudo copiar, con el nombre de
los productos afectados.

## Permisos

| Permiso            | Quién                                         |
| ------------------ | --------------------------------------------- |
| `suppliers.view`   | dueño, admin, encargado, compras, **auditor** |
| `suppliers.manage` | dueño, admin, encargado, compras              |

El auditor ve y no toca, que es la definición del rol.

**Cajero, repositor y supervisor no ven proveedores.** No es información
sensible en sí misma, pero tampoco tiene ningún uso en el mostrador, y una
pantalla de más es una pantalla en la que alguien se puede perder.

`suppliers.manage` incluye dar de alta, editar, desactivar y reactivar. No se
partió en cuatro: quien puede crear un proveedor puede desactivar el que creó,
y separarlos daría permisos que nadie sabría cuándo repartir.
