# Precheck de datos de producción

> Ejecutado el **11 de agosto de 2026** contra la base real, con **consultas de
> solo lectura**. No se corrigió ni un dato. Ninguna consulta escribió.
>
> Las migraciones ya traen sus propias comprobaciones; acá se corrieron **las
> mismas ideas** antes de tiempo, para saber qué va a pasar durante la ventana
> en vez de descubrirlo con la aplicación detenida.

## Método

Cada regla nace de algo concreto de la cadena: una restricción `CHECK` que se
agrega, un índice único que se crea, un `NOT NULL` que se activa, o un bloque
`DO $$ ... RAISE EXCEPTION` que aborta la migración. No hay reglas inventadas
«por las dudas»: si una migración no la comprueba, no está acá.

| Estado      | Significado                                                           |
| ----------- | --------------------------------------------------------------------- |
| **PASS**    | Los datos cumplen. La migración pasa por acá sin ruido.               |
| **WARN**    | No impide migrar. Cambia lo que se ve después, y hay que saberlo.     |
| **BLOCKER** | La migración aborta o los datos quedan mal. Hay que resolverlo antes. |

## Resultado

**24 reglas: 21 PASS · 3 WARN · 0 BLOCKER.**

Los datos de producción están notablemente limpios. Es coherente con lo que se
midió aparte: cero deriva de esquema, una sola migración registrada y su
checksum idéntico al del archivo.

## Volúmenes medidos

| Tabla                  | Filas |     | Tabla         | Filas |
| ---------------------- | ----: | --- | ------------- | ----: |
| `AuditLog`             | 5.035 |     | `Product`     |   379 |
| `Sale`                 | 1.130 |     | `BranchStock` |   379 |
| `SaleItem`             | 1.701 |     | `Role`        |     2 |
| `CashRegisterMovement` | 1.130 |     | `User`        |     1 |
| `StockCheck`           |     0 |     | `Branch`      |     1 |
| `CashCount`            |     0 |     | `Category`    |     1 |
|                        |       |     | `Supplier`    |     1 |

Base de **11 MB**. Ventas del **3-oct-2025 al 6-dic-2025**. `Branch.currentCash`
= 3.818.350.

## Las reglas

### Stock y cantidades

| #   | Regla                                             | De dónde sale                      | Medido                   |          |
| --- | ------------------------------------------------- | ---------------------------------- | ------------------------ | -------- |
| 1   | `BranchStock.quantity >= 0`                       | `CHECK ("quantity" >= 0)`, fase 3A | 0 negativos; rango 0–925 | **PASS** |
| 2   | Cantidades enteras convertibles a `Decimal(14,3)` | `phase3_fractional_quantities`     | todas enteras            | **PASS** |
| 3   | `SaleItem.quantity > 0`                           | `CHECK ("quantity" <> 0)`          | 0 en cero o negativas    | **PASS** |
| 4   | `BranchStock` sin producto o sin sucursal         | FKs de la fase 3                   | 0 huérfanas              | **PASS** |

### Dinero

| #   | Regla                                             | De dónde sale                         | Medido                          |          |
| --- | ------------------------------------------------- | ------------------------------------- | ------------------------------- | -------- |
| 5   | `Product.price` no nulo, no negativo              | `phase3_decimal_money`                | 0 nulos, 0 negativos, 0 en cero | **PASS** |
| 6   | `Product.price` con ≤ 2 decimales                 | `Decimal(14,2)` redondea al convertir | 0 con más de 2                  | **PASS** |
| 7   | `Product.price` entra en `Decimal(12,2)`          | idem                                  | 0 por encima de 10¹⁰            | **PASS** |
| 8   | `SaleItem.price` ≤ 2 decimales y ≥ 0              | idem                                  | 0 y 0                           | **PASS** |
| 9   | `CashRegisterMovement.amount` ≤ 2 decimales y ≥ 0 | idem                                  | 0 y 0                           | **PASS** |

**El punto 6 importa más de lo que parece.** Convertir `double precision` a
`Decimal` redondea en silencio: si hubiera un precio con tres decimales, la
migración lo cambiaría sin avisar. No hay ninguno.

### Ventas y cobros — el caso más delicado de la cadena

`phase0_security_baseline` reconstruye el vínculo entre cada cobro y su venta
**leyendo un texto libre**:

```sql
description ~ '[Vv]enta[[:space:]]*#[0-9]+'
```

Si ese formato no coincidiera, los 1.130 cobros quedarían sin `saleId`, y
después `phase3_sale_payments` —que exige `saleId IS NOT NULL`— dejaría **las
1.130 ventas sin ningún pago registrado**. La migración no fallaría: quedaría
un sistema donde ninguna venta histórica dice cómo se cobró.

| #   | Regla                                         | Medido             |          |
| --- | --------------------------------------------- | ------------------ | -------- |
| 10  | Los cobros casan `Venta #N`                   | **1.130 de 1.130** | **PASS** |
| 11  | El `N` extraído apunta a una venta que existe | **1.130 de 1.130** | **PASS** |
| 12  | Toda venta queda con al menos un pago         | **1.130 de 1.130** | **PASS** |
| 13  | El total calculado coincide con lo cobrado    | **0 descuadradas** | **PASS** |
| 14  | Ninguna venta queda con total 0               | 0                  | **PASS** |
| 15  | Ninguna venta sin renglones                   | 0                  | **PASS** |

Hay **una sola forma** de descripción en las 1.130 filas: `Venta #N`. Sin
variantes, sin mayúsculas raras, sin espacios de más.

### Medios de pago

| #   | Regla                                         | Medido                               |          |
| --- | --------------------------------------------- | ------------------------------------ | -------- |
| 16  | `paymentMethod` entra en el vocabulario nuevo | `efectivo` 1.090 · `mercado_pago` 40 | **PASS** |
| 17  | `CashRegisterMovement.type` reconocido        | `sale` × 1.130                       | **PASS** |

Los dos valores existentes están contemplados en el `CASE` de la migración
(`efectivo → CASH`, `mercado_pago → TRANSFER` con la referencia «Mercado
Pago»). El tercero previsto, `tarjeta`, no aparece en los datos.

### Códigos de barras

`phase3_product_barcodes` copia `Product.barcode` a `ProductBarcode` y después
**aborta si algún producto quedó sin copiar**.

| #   | Regla                                     | Medido |          |
| --- | ----------------------------------------- | ------ | -------- |
| 18  | Sin colisiones tras recortar espacios     | 0      | **PASS** |
| 19  | Ninguno supera 64 caracteres              | 0      | **PASS** |
| 20  | Ninguno vacío tras recortar               | 0      | **PASS** |
| 21  | **205 de 379 productos no tienen código** | 54 %   | **WARN** |

**WARN-1 — más de la mitad del catálogo no se puede escanear.** No rompe la
migración: la copia saltea los `NULL` y el control posterior también. Pero
después del despliegue, 205 productos solo se encuentran escribiendo el nombre.
No es un problema de datos: es una tarea de carga que nadie hizo. Conviene
saberlo **antes** de que alguien lo reporte como «el lector no anda».

### Textos y nombres

| #   | Regla                                                            | Medido     |          |
| --- | ---------------------------------------------------------------- | ---------- | -------- |
| 22  | Nombres no vacíos en `Product`, `Category`, `Supplier`, `Branch` | 0 vacíos   | **PASS** |
| 23  | Nombres de producto ≤ 200 caracteres                             | 0 se pasan | **PASS** |

### Proveedores y catálogo

`phase3d_drop_legacy_columns` **aborta** si un proveedor tiene `contact` cargado
sin su equivalente en `contactName`, o si un producto tiene `supplierId` sin su
fila en `ProductSupplier`.

| #   | Regla                                      | Medido       |            |
| --- | ------------------------------------------ | ------------ | ---------- |
| 24  | El proveedor único tiene `contact` cargado | sí           | **PASS** ✔ |
| 24b | Productos con `supplierId`                 | **0 de 379** | **PASS**   |

El `contact` **sí** está cargado, pero `phase3_suppliers` lo copia a
`contactName` antes, así que el aborto no se dispara. Se verificó que esa copia
ocurre en la cadena, no que «probablemente ocurra».

### Usuarios y roles

| #   | Regla                                  | Medido                  |          |
| --- | -------------------------------------- | ----------------------- | -------- |
| 25  | Contraseñas con hash bcrypt            | 1 de 1 empieza con `$2` | **PASS** |
| 26  | Sin huérfanos en `AuditLog.userId`     | 0                       | **PASS** |
| 27  | **Un solo usuario en todo el sistema** | `lautaro`, rol 1        | **WARN** |
| 28  | **Los roles son `admin` y `vendedor`** | 2 roles                 | **WARN** |

**WARN-2 — un solo usuario, con rol de administrador.** La separación de
funciones que construyen las fases 0 a 4D —quien cuenta no aplica, quien compra
no cobra, compras ya no afloja el rastreo— **no protege nada si una sola persona
tiene todos los permisos**. No impide desplegar. Sí conviene crear los usuarios
por función antes de dar por bueno cualquier control interno.

**WARN-3 — `vendedor` es alias de `cajero`.** Está previsto en el catálogo de
permisos y resuelve al mismo perfil, así que funciona. Queda anotado porque
cualquiera que lea la matriz va a buscar `cajero` y no lo va a encontrar en la
base.

## Lo que este precheck NO puede ver

Honestidad sobre el alcance:

- **Corrió contra los datos de hoy.** Si alguien enciende la aplicación y
  registra ventas antes del corte, hay que volver a correrlo.
- **No prueba la migración**, prueba los datos. Que la cadena aplique está
  demostrado aparte, con un conjunto sintético del mismo volumen y la misma
  forma: `npm run rehearsal:prodlike`.
- **No mira lo que no está**. Un producto que debería existir y no existe, o un
  precio cargado mal desde el principio, pasa todas las reglas.

## Consultas

Todas las de este documento son `SELECT`. Están en el historial de la sesión y
se pueden repetir; el patrón es siempre el mismo:

```bash
sudo -u postgres psql -d kiosco -tA -c "<consulta>"
```

Ninguna necesita la credencial de la aplicación, y ninguna escribe.
