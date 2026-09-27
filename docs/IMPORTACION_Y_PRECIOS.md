# Importación de productos y cambio masivo de precios (P0-B)

Dos herramientas para que un almacén cargue su catálogo y mantenga los precios
sin hacerlo producto por producto:

- **Productos → Importar**: carga o actualiza el catálogo desde un Excel
  (`.xlsx`) o un `.csv`.
- **Productos → Cambiar precios**: aumenta, baja o fija muchos precios de una
  vez, con vista previa, confirmación y "deshacer" del último cambio.

Ninguna de las dos escribe nada hasta que el usuario confirma. Las dos pasan
por las mismas reglas que el alta y la edición a mano: libro de stock,
historial de costos y bitácora.

---

## 1. Importar productos

### Cómo lo usa un comercio

1. **Elegir el archivo.** `.xlsx` o `.csv`, hasta 10 MB y 10.000 productos.
   Desde la pantalla se descarga
   [`productos-ejemplo.xlsx`](../public/productos-ejemplo.xlsx), con los
   encabezados correctos y tres productos inventados.
2. **Revisar las columnas.** El mapeo se hace solo con los nombres habituales;
   cada campo se puede corregir a mano. Se ven las primeras filas tal como se
   van a leer.
3. **Vista previa.** Para cada fila dice qué va a pasar: se agrega, se
   actualiza, no cambia nada, se omite o tiene un error, con el motivo. Ahí se
   elige qué hacer con los productos que ya existen y con el stock. Las filas
   con error se pueden descargar en un CSV para corregirlas.
4. **Confirmar.** Un diálogo resume lo que va a pasar. La importación se hace
   entera o no se hace.

### El archivo no viaja al servidor

La planilla se lee **en el navegador** (`src/modules/importacion/`). Al
servidor llegan solo las celdas de las columnas elegidas, fila por fila, en
JSON y con topes (10.000 filas, 1.000 caracteres por celda, números con forma
fija). El servidor nunca guarda ni abre un archivo subido, y vuelve a validar
cada valor, cada fila y cada permiso.

### Qué se acepta y qué no

| Caso                                                    | Resultado                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `.xlsx` común                                           | Se lee la primera hoja visible; las demás se nombran y no se leen |
| `.csv` de Excel en castellano (`;`, Windows-1252)       | Se detectan separador y codificación                              |
| `.csv` en UTF-8, con o sin marca, o separado por comas  | Se lee                                                            |
| Celdas con fórmula                                      | Se toma el último valor calculado; la fórmula **no se ejecuta**   |
| `.xlsm`, `vbaProject.bin` o tipo de contenido con macro | Rechazado: "La planilla tiene macros…"                            |
| `.xls` antiguo o planilla con contraseña                | Rechazado, con cómo guardarla                                     |
| `.ods`                                                  | Rechazado: guardarla como `.xlsx` o `.csv`                        |
| Ejecutable, PDF, imagen, comprimido, binario            | Rechazado por sus primeros bytes, no por la extensión             |
| Archivo cortado, CRC que no coincide, parte cifrada     | Rechazado                                                         |
| "Bomba" de compresión                                   | Se corta al pasar el tope de lo que **sale** del descompresor     |
| Más de 10 MB o de 10.000 productos                      | Rechazado: partirlo                                               |

El `.xlsx` se lee sin dependencias nuevas: el índice del `.zip` es propio, la
descompresión es la de la plataforma (`DecompressionStream`) y el XML se
recorre reconociendo solo las entidades predefinidas, sin definiciones del
documento (sin riesgo de "bombas" de XML).

### Columnas que se reconocen solas

| Campo            | Encabezados reconocidos (sin importar mayúsculas ni acentos)                           |
| ---------------- | -------------------------------------------------------------------------------------- |
| Código de barras | código, código de barras, cód. barras, barcode, EAN, EAN-13, UPC, GTIN                 |
| Nombre           | nombre, producto, descripción, artículo, detalle, ítem                                 |
| Categoría        | categoría, rubro, familia, sección, departamento, grupo                                |
| Precio de venta  | precio, precio venta, precio_venta, precio de venta, PVP, precio público, precio final |
| Costo            | costo, precio de costo, costo unitario, precio de compra, compra                       |
| Stock            | stock, cantidad, existencia, stock actual, unidades                                    |
| Stock mínimo     | stock mínimo, mínimo, stock min, punto de pedido                                       |
| Unidad           | unidad, unidad de venta, unidad de medida, medida                                      |

Si hay un título arriba ("Lista de precios septiembre"), la fila de encabezados
se detecta igual: es la que más campos reconoce entre las primeras veinte. Si
el archivo no tiene títulos, se marca y las columnas se llaman como en Excel.

No hay campos nuevos ni taxonomía nueva: la categoría es la de siempre, buscada
por nombre sin mayúsculas ni acentos ("Lácteos" y "LACTEOS" son la misma). Las
que no existen se crean, y la vista previa las lista antes. Un producto nuevo
sin categoría va a **Sin categoría**.

### Números: dinero, cantidad y peso no leen igual

La lectura de lo escrito es la de todo el sistema (`@/lib/numero-local`). Lo
que agrega la importación es la regla del "1.500" según la columna:

| Escrito      | Precio / costo | Stock por unidad | Stock por kg o litro         |
| ------------ | -------------- | ---------------- | ---------------------------- |
| `1500`       | 1.500          | 1.500            | 1.500                        |
| `1500,50`    | 1.500,50       | error: entero    | 1.500,5                      |
| `1.500`      | **1.500**      | **1.500**        | **1,5** (y la fila lo avisa) |
| `1.500,50`   | 1.500,50       | error: entero    | 1.500,5                      |
| `1500.50`    | 1.500,50       | error: entero    | 1.500,5                      |
| `1,500`      | error: ambiguo | error: entero    | 1,5                          |
| `$ 1.500,00` | 1.500          | —                | —                            |

- En **kilos y litros**, "1.500" es kilo y medio, que es como lo escribe una
  balanza y como lo lee la caja. Como en una planilla puede sorprender, la fila
  lleva el aviso "se leyó como 1,5 kg. Si eran 1500, escribilo sin el punto".
- En **dinero**, "1,500" puede ser uno coma cinco o mil quinientos: no se
  adivina, se pide escribirlo de otra forma.
- Un número **guardado como número** en el `.xlsx` no pasa por esta lectura:
  no tiene separadores. Se toma con las 15 cifras con que lo muestra Excel y se
  lleva a la escala del campo; si una fórmula dio `1815,605`, el precio queda
  en `1815,61` y la fila lo avisa.
- **Celda vacía es "no viene", nunca cero.** Al actualizar un producto, lo
  que no viene no se toca.

Los códigos de barras tienen sus propios avisos, porque Excel los arruina de
tres maneras conocidas: notación científica (`7,79E+12`), separador de miles
(`7.790.001.234.567`) y más de 15 cifras redondeadas. Los tres se explican con
el arreglo: poner la columna en formato Texto.

### Productos que ya existen

Se reconocen por **código de barras** (el principal o cualquier alternativo).
Una fila sin código se reconoce por **nombre exacto** (sin mayúsculas ni
acentos); si hay dos productos con ese nombre, la fila pide el código.

| Opción                                  | Nuevos     | Existentes                                    |
| --------------------------------------- | ---------- | --------------------------------------------- |
| Solo agregar los nuevos _(por omisión)_ | se agregan | no se tocan, ni su stock                      |
| Nuevos y actualizar los que existen     | se agregan | se les cambia lo que el archivo trae distinto |
| Solo actualizar los que existen         | se omiten  | se actualizan                                 |

La tercera es la lista de precios de un proveedor: trae cientos de productos
que el almacén no vende. Esas filas se **omiten sin revisarlas**, para que los
errores de filas que no se van a usar no tapen los que importan.

Al actualizar: nombre, categoría, precio, costo, stock mínimo y stock. La
**unidad** de un producto existente no se cambia desde una planilla (la regla
de siempre: cambiarla reescribiría su historial); si no coincide, la fila lo
dice.

### Stock: siempre por el libro

El stock nunca se pisa. Con columna de stock, elegir qué hacer es
**obligatorio**:

| Opción                             | Producto nuevo                    | Producto existente                                                 |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| No tocar el stock                  | arranca en cero                   | no cambia                                                          |
| Dejar el stock que dice el archivo | movimiento `INITIAL` por el valor | ajuste manual por la **diferencia** contra el saldo de ese momento |
| Sumar lo del archivo               | movimiento `INITIAL` por el valor | ajuste manual por lo que dice el archivo                           |

Todos los movimientos pasan por `applyStockMovement`, con usuario, fecha,
producto, cantidad, saldo anterior y resultante, y un motivo que nombra el
archivo y la importación: `Importación de lista.xlsx (#0b4f7a0e)`. Los
productos que se siguen **por lote** (`REQUIRED`) no reciben stock por planilla:
la fila lo explica y remite a Stock → Lotes.

### Todo o nada, doble clic y vista previa vieja

- **Una sola transacción.** Si una escritura falla, no queda nada. Está
  probado con un fallo inyectado en la última escritura.
- **La vista previa no se reutiliza para escribir.** Al importar, el servidor
  vuelve a armar el plan desde cero. Si no coincide con la **huella** que
  mostró la vista previa (alguien cargó un producto del archivo en el medio),
  responde `409 IMPORT_PREVIEW_STALE` y no aplica nada; la pantalla vuelve a
  pedir la vista previa.
- **El doble clic no importa dos veces.** Cada vista previa tiene un
  identificador; una importación ya aplicada con ese identificador responde
  `409 IMPORT_ALREADY_APPLIED`. Un bloqueo consultivo por sucursal pone en fila
  a dos importaciones simultáneas.
- **Si la respuesta no llega** (corte de red, tiempo de espera del proxy), la
  pantalla avisa que pudo haberse aplicado y pide revisar la vista previa antes
  de reintentar: si se aplicó, los productos figuran como existentes.

### Permisos

Para entrar alcanza `products.create` o `products.update`. Después, cada
columna exige el suyo, y la vista previa dice cuál falta y qué columna sacar:

| Si el plan…                             | Hace falta              |
| --------------------------------------- | ----------------------- |
| da de alta productos                    | `products.create`       |
| cambia nombre, categoría o stock mínimo | `products.update`       |
| cambia precios de productos existentes  | `products.price.update` |
| carga o cambia costos                   | `products.cost.update`  |
| ajusta el stock de productos existentes | `stock.adjust`          |
| crea categorías                         | `categories.manage`     |

Sin `products.cost.view`, la vista previa no muestra el costo actual.

### El rastro

Cada producto deja el mismo rastro que un alta o una edición a mano: `create`
o `update` en la bitácora (con el antes y el después), `ProductCostHistory`
por `registrarCambioDeCosto` cuando cambia el costo, y su movimiento de stock.
La importación entera deja además una entrada **Importación de productos** con
el archivo, el modo, los totales y el identificador.

---

## 2. Cambiar precios en masa

### Cómo se usa

1. **Qué productos.** Categoría, proveedor, nombre o código, y si se incluyen
   los dados de baja. Se combinan.
2. **Qué cambio.** Aumentar %, bajar %, sumar monto, restar monto, precio fijo
   o costo + % (este último exige poder ver costos). Y el redondeo.
3. **Así quedan.** "Precio actual → precio nuevo" de cada producto, con la
   variación. Cuántos cambian, el más barato y el más caro, y la variación del
   total. Cada producto se puede destildar ("marcar/desmarcar todos" para
   elegir a mano). Se avisa lo que queda por debajo del costo y lo que no se
   puede calcular.
4. **Confirmar y aplicar.** Un diálogo con el resumen.

### Redondeo: en la dirección del cambio

| Redondeo          | Sube 1.234 → 1.357,40 | Baja 1.290 → 1.225,50 |
| ----------------- | --------------------- | --------------------- |
| Sin redondeo      | 1.357,40              | 1.225,50              |
| A peso entero     | 1.358                 | 1.225                 |
| Que termine en 0  | 1.360                 | 1.220                 |
| Que termine en 50 | 1.450                 | 1.150                 |
| Que termine en 90 | 1.390                 | 1.190                 |
| Que termine en 99 | 1.399                 | 1.199                 |

Si el precio **sube**, se redondea para arriba: el precio nuevo nunca queda
por debajo de lo calculado. Si **baja**, para abajo: una rebaja nunca termina
más cara que antes por el redondeo. "Costo + %" redondea siempre para arriba,
para no comerse el margen pedido. El precio fijo no se redondea. Toda la cuenta
es en centavos enteros.

### Aplicar

En una transacción: bloquea las filas de los productos, recalcula y, si algo
cambió desde la vista previa (un precio, un producto que entró o salió de la
selección), responde `409 PRICES_CHANGED` y no aplica nada.

Cada producto cambiado deja su entrada `update` con el precio de antes y el de
después: es el mismo historial de precios que muestra la ficha del producto
("Precio: 1234.00 → 1357.40"). El cambio entero deja una entrada **Cambio
masivo de precios** con el criterio, la selección, la cantidad y los números.

### Deshacer

Se puede deshacer **el último** cambio masivo de la sucursal. Cada producto
vuelve a su precio anterior **solo si hoy sigue teniendo el precio que le puso
ese cambio**: si alguien lo tocó después, se respeta y se informa ("Lo
cambiaron después: hoy está a $ 1.500,00"). Deshacer queda en la bitácora como
**Cambio masivo deshecho**, y no se puede deshacer dos veces.

No hizo falta tabla nueva: cada entrada por producto lleva el identificador
del cambio masivo, generado en el servidor, y deshacer las busca por él.

### Permisos

`products.price.update`, el mismo de cambiar un precio a mano; "costo + %"
exige además `products.cost.view`.

---

## 3. Volumen

Medido con `tests/performance/importacion.test.ts`: una planilla sintética de
5.000 productos (códigos del prefijo 99, reservado para cupones: ninguno es un
producto real), en una portátil con Windows y PostgreSQL local. La prueba
vacía la base al terminar.

| Paso (5.000 productos)                                     | Medido         |
| ---------------------------------------------------------- | -------------- |
| Leer el `.xlsx` en el navegador                            | 0,09 s         |
| Lo que viaja al servidor                                   | 619 KB de JSON |
| Vista previa (el plan entero, sin escribir)                | 0,2 s          |
| Respuesta de la vista previa                               | 3 MB           |
| Importar: 5.000 altas con stock inicial por el libro       | 19,4 s         |
| Reimportar: 5.000 actualizaciones de precio, costo y stock | 23,7 s         |
| Comprobar que el libro de stock cuadra después             | 0,04 s         |
| Precios: vista previa de 5.000                             | 0,15 s         |
| Precios: aplicar a 200 (una categoría)                     | 0,44 s         |
| Precios: aplicar a 5.000                                   | 6,9 s          |
| Precios: deshacer 5.000                                    | 7,7 s          |

Cada alta pasa por la misma puerta que el formulario (movimiento `INITIAL`,
código, bitácora): unas 8 consultas por producto. Cada actualización completa
--precio, costo con su historial y stock con su movimiento-- unas 12. Ese es el
costo de no saltear las reglas, y por eso importar tarda lo que tarda. Cambiar
**500 precios** lleva alrededor de un segundo.

Con 2.000 productos, que es el caso más común del almacén, la importación
tardaría unos 8 segundos (estimado a partir de la medición, no medido).

---

## 4. Límites conocidos

- Una sola hoja por archivo: la primera visible.
- La unidad de un producto existente no cambia por planilla.
- Proveedor, descripción y códigos alternativos no se importan.
- El deshacer de precios alcanza solo al último cambio masivo.
- Una importación grande tarda: ver la tabla de volumen. En producción, el
  proxy corta a los 60 s por omisión (`proxy_read_timeout`); si pasa, la
  importación termina igual del lado del servidor y la pantalla lo explica.

## 5. Dónde está

| Qué                        | Dónde                                                           |
| -------------------------- | --------------------------------------------------------------- |
| Lectura de planillas       | `src/modules/importacion/{planilla,xlsx,zip,csv}.ts`            |
| Mapeo y valores            | `src/modules/importacion/{columnas,valores}.ts`                 |
| Plan e importación         | `src/modules/importacion/service.ts`                            |
| Alta y cambio por planilla | `crearProductoEn`, `actualizarProductoImportado` en products    |
| Cuenta de precios          | `src/modules/products/precios.ts`                               |
| Cambio masivo y deshacer   | `src/modules/products/precios-masivos.ts`                       |
| Pantallas                  | `/productos/importar`, `/productos/precios`                     |
| Plantilla                  | `public/productos-ejemplo.xlsx` (`npm run plantilla:productos`) |
