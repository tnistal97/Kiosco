# Auditoría del stock de House: Tickets 1 y Tickets 2

22/10/2026. Todo es local, nada de esto se desplegó.

> **29/10/2026:** los bultos, los códigos y los nombres de Tickets 1 se corrigieron, y se
> incorporó Ticket3. Ver [`ticket3/README.md`](ticket3/README.md). Tickets 2 sigue solo local.

- **Rama:** `feat/house-tickets2-stock-audit`, que sale de `fix/house-unit-stock-normalization`.
- **Bases:**
  - `kiosco_house_dev` es el House local de antes y **no se tocó**.
  - `kiosco_house_tickets2_dev` es una copia de esa base con Tickets 2 aplicado.
- **Producción: NO TOCADA.**

Las **fotos de los tickets** son la fuente. Las dos Excel que se usaron para cargar Tickets 1 solo se compararon contra ellas.

> En las carpetas, "Tickets 1" es `Stock\Tickets` y "Tickets 2" es `Stock\Tickets2`. Los nombres de las carpetas no se cambiaron.

## Lo más importante

1. **La normalización de bultos del 22/10 está mal: multiplicó dos veces.**
   - El ticket imprime cada bulto como `2(4) x 79996,00`: 2 bultos de 4 unidades, a $79.996 el bulto.
   - Las Excel ya tenían esas 12 líneas **en unidades**: 2 × 4 = 8.
   - La normalización volvió a multiplicar por 4, y lo mismo en las otras 11.
   - Hoy House tiene **2872 unidades de más** en 12 productos, en local y en producción. Por ejemplo, cada Clight tiene 400 en vez de 20, y el encendedor Candela 625 en vez de 25.
   - **No se corrigió nada**: queda para que decidas. El detalle está en la sección "Bultos" de Tickets 1.
2. **La Excel 2 tiene 4 códigos de barras mal copiados.** Los 4 tienen el dígito verificador inválido, y el ticket muestra el código válido.
   - Tres quedaron como código de venta en House: Monster Mango Loco, Papas Pehuamar acanaladas y Nieto Senetiner Malbec. El lector no encuentra esos productos con el código real del envase.
3. **Hay nombres que no son el producto.**
   - "Aceitunas" Cañuelas y "Aceitunas" Natura son **aceite**.
   - "Garbanzos" Fainax es **harina** de garbanzo.
   - Los 3 "Jabón lavarropas" Ayudín y Querubín son **lavandina**.
   - "Baño" es Baggio, el Aquarius es de 600 cc y no de 500, y las Ramitas son Pep y no Pehuamar.
4. **Las cantidades de Tickets 1 están bien.** Las 192 líneas coinciden en unidades con las dos Excel: no falta ningún producto y no sobra ninguno.
5. **Tickets 2** es un presupuesto escrito a mano, de 4 hojas y una sola compra.
   - Entraron **50 productos nuevos con 155 unidades**, todos a $0.
   - Quedaron afuera **5 líneas con 13 unidades**: 3 que no se leen con seguridad y 2 que se parecen a productos que ya existen.
   - Ninguna línea es un producto que ya estuviera, así que **no se sumó stock a ninguno**.

## Tickets 1

### Fotos y tickets físicos

Son **17 fotos**, todas JPEG de 1200×1600 y entre 148 y 209 kB. Contienen **2 tickets físicos**, los dos "FACTURA B (COD. 006)". Cada página se asignó a su foto con el OCR de Windows, que no conocía la transcripción, y coincide con la lectura a ojo.

| Ticket | Contenido                   | Líneas | Unidades | Fotos, en orden de página                                                                           | Excel que se cargó                                   |
| ------ | --------------------------- | -----: | -------: | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| T1-A   | bebidas, limpieza y almacén |    113 |      520 | 3.05.44 (1), 3.05.44 (2), 3.05.44, 3.05.43 (2), 3.05.43, 3.05.43 (1), 3.05.35 (1), 3.05.35, 3.05.34 | `stock_kiosco_ticket_2.xlsx`: 113 filas, con códigos |
| T1-B   | almacén                     |     79 |      303 | 3.05.47 (1), 3.05.47, 3.05.46 (1), 3.05.46, 3.05.45 (3), 3.05.45 (2), 3.05.45 (1), 3.05.45          | `stock_kiosco_ticket.xlsx`: 79 filas, sin códigos    |

Las dos Excel son las que se cargaron: tienen el mismo SHA-256 que registró la carga inicial (`a2673d3c…` y `b8f196ea…`).

### Productos y unidades

|                     | Según las fotos | Según las Excel |
| ------------------- | --------------: | --------------: |
| Líneas / filas      |             192 |             192 |
| Productos distintos |             191 |             191 |
| Unidades            |         **823** |         **823** |

Las líneas son 192 y los productos 191 porque el aceite Natura 5 L aparece dos veces en T1-B: suelto (1) y en bulto (2×4). Es el mismo producto.

### Controles de cada ticket

- **Cantidad × precio = importe** en las 192 líneas. Tres difieren en centavos de redondeo, entre 0,06 y 0,08.
- **Suma de importes = subtotal impreso:** en T1-A da 1 centavo menos y en T1-B da exacto.
- **Subtotal − descuentos = total impreso**, con centavos de redondeo: 0,08 en T1-A y 0,02 en T1-B.
- **Dígito verificador:** los 192 códigos de barras son válidos.
- **Segunda lectura con OCR:** el OCR lee igual 159 códigos completos y 104 líneas con la misma cantidad y el mismo precio.
  - En ninguna línea el OCR lee otra cantidad.
  - No hay ningún código válido en las fotos que falte en la planilla.
- **Confianza:** las 192 líneas son ALTA. No hay filas de lectura para revisar.

### Comparación con las Excel

Está en `comparacion_tickets1.xlsx`.

| Estado            | Filas |
| ----------------- | ----: |
| OK                |   167 |
| NOMBRE_DUDOSO     |    21 |
| CODIGO_DISTINTO   |     4 |
| CANTIDAD_DISTINTA |     0 |
| FALTA_EN_EXCEL    |     0 |
| SOBRA_EN_EXCEL    |     0 |
| DUPLICADO         |     0 |
| REVISAR           |     0 |

Los 4 **códigos distintos** se verificaron en la foto, uno por uno. El de la Excel es siempre inválido y el del ticket, válido.

| Producto                               | Excel (inválido) | Ticket (válido) | En House hoy                                     |
| -------------------------------------- | ---------------- | --------------- | ------------------------------------------------ |
| Cerveza Corona porrón 330/355 bulto x6 | 2792798003723    | 7792798003723   | escrito en la descripción, como código del bulto |
| Monster Mango Loco lata 473            | 7798427620045    | 7798422620045   | **código de venta equivocado**                   |
| Papas fritas Pehuamar acanaladas 230 g | 7790310985553    | 7790310983553   | **código de venta equivocado**                   |
| Vino Nieto Senetiner Malbec DOC 750    | 7790070608767    | 7790070760876   | **código de venta equivocado**                   |

Los 21 **nombres dudosos**:

| Filas            | Qué dice el ticket                                              | Qué dice la Excel                                    |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| T1-B 1, 2 y 3    | ACE. = aceite (de oliva Cañuelas 500 cc; de girasol Natura 5 L) | "Aceitunas"                                          |
| T1-B 47          | HAR.GARBANZO FAINAX = harina de garbanzo                        | "Garbanzos"                                          |
| T1-A 59, 60 y 61 | LAV. = lavandina (Ayudín Glaciar, Ayudín Lavanda, Querubín)     | "Jabón lavarropas"                                   |
| T1-A 4 a 7       | ALI.BAGGIO                                                      | "Baño"                                               |
| T1-A 1 y 2       | Aquarius 600CC                                                  | 500cc                                                |
| T1-A 113         | RAMITAS PEP                                                     | "Pehuamar" (es el mismo fabricante, pero otra marca) |
| Menores          | NIÑOS, MAICITO (×4), ARITOS, frutos del bosque                  | "Nitos", "Macito", "Arttos", "frutilla bosque"       |

### Bultos: la cantidad ya eran unidades

Las 12 líneas con bulto, con la evidencia del propio ticket:

| Línea del ticket                      | Impreso           | Unidades |  Excel | Precio por unidad | Comparable en el ticket                | Si fueran bultos |
| ------------------------------------- | ----------------- | -------: | -----: | ----------------: | -------------------------------------- | ---------------: |
| ACE.NATURA GIR.5LT Bul.4              | 2(4) × 79.996,00  |        8 |      8 |         19.999,00 | **la misma botella suelta: 19.999,00** |         4.999,75 |
| PUR.TOM.NOEL BRICK 520GR Bul.12       | 2(12) × 8.147,90  |       24 |     24 |            678,99 | Knorr pomarola 340 g: 1.329,90         |            56,58 |
| ALI.BAGGIO PRONTO NAR.1LT Bul.8       | 1(8) × 15.191,99  |        8 |      8 |          1.899,00 | Baggio Fresh 1 L: 1.693,88             |           237,37 |
| ALI.BAGGIO PRONTO NAR.200CC Bul.18    | 1(18) × 13.030,10 |       18 |     18 |            723,89 | Baggio Fresh 1 L: 1.693,88             |            40,22 |
| CERVEZA ANDES ROJA LATA 473CC Bul.6   | 1(6) × 13.465,34  |        6 |      6 |          2.244,22 | Amstel lata 473: 2.033,53              |           374,04 |
| CERVEZA CORONA PORRON 330/355CC Bul.6 | 2(6) × 19.000,58  |       12 |     12 |          3.166,76 | Corona lata 473: 3.941,70              |           527,79 |
| ENC.CANDELA Bul.25                    | 1(25) × 7.724,94  |       25 |     25 |            309,00 | —                                      |            12,36 |
| ENE.RED BULL 250ML Bul.4              | 1(4) × 12.346,40  |        4 |      4 |          3.086,60 | Monster 473: 2.799,00                  |           771,65 |
| JUG.CLIGHT … ×4 Bul.20                | 1(20) × 7.380,03  |   20 c/u | 20 c/u |            369,00 | Gelatina Exquisita en sobre: 849,00    |            18,45 |

Esto **refuta** la normalización.

- **Cómo imprime el ticket:** el primer número son los bultos, el que va entre paréntesis las unidades de cada bulto, y el precio es por bulto. En las 12 líneas, la cantidad de la Excel es exactamente bultos × unidades.
- **El aceite Natura lo deja claro:** la botella suelta cuesta $19.999 y el bulto de 4, $79.996, que es 4 × 19.999. Contar la cantidad como bultos daría precios imposibles: $12 por encendedor, $18 por sobre de Clight o $40 por un Baggio de 200 cc.

| Producto (hoy)                                                        | Stock según los tickets | Stock hoy, local y producción* |   De más |
| --------------------------------------------------------------------- | ----------------------: | -----------------------------: | -------: |
| Aceitunas Natura girasol 5 L (es aceite)                              |        9 (1 suelta + 8) |                             33 |       24 |
| Puré de tomate Noel brick 520 g                                       |                      24 |                            288 |      264 |
| Baño Pronto naranja 1L (es Baggio)                                    |                       8 |                             64 |       56 |
| Baño Pronto naranja 200cc (es Baggio)                                 |                      18 |                            324 |      306 |
| Cerveza Andes Roja lata 473cc                                         |                       6 |                             36 |       30 |
| Cerveza Corona porrón 330/355cc                                       |                      12 |                             72 |       60 |
| Encendedor Candela                                                    |                      25 |                            625 |      600 |
| Red Bull 250ml                                                        |                       4 |                             16 |       12 |
| Clight limonada rosa, manzana deliciosa, naranja dulce y naranja (×4) |                  20 c/u |                        400 c/u |     1520 |
| **Total**                                                             |                 **125** |                       **2997** | **2872** |

\* Es el stock de producción al desplegar, el 22/10 a las 12:47 UTC. Las ventas que hubo desde entonces no se miraron, porque producción no se tocó.

### Para revisar (Tickets 1)

No hay ninguna fila de lectura dudosa. Las decisiones que te quedan:

- Si se corrige la doble multiplicación de los 12 bultos, en local y en producción. El arreglo serían 13 ajustes de stock con motivo; los nombres y las fotos quedan como están.
- Los 3 códigos de venta equivocados.
- Los nombres de aceite, lavandina y harina.

## Tickets 2

### Fotos y tickets físicos

Son **4 fotos**, JPEG de 1200×1600 y entre 191 y 215 kB. Cada foto es **una hoja de un talonario de presupuesto** ("Documento no válido como factura"), escrita a mano.

- **Es una sola compra:** el único TOTAL está en la hoja 4 y es exactamente la suma de las 55 líneas de las 4 hojas.
- **Número del talonario:** la hoja 1 es la N° 023411. En las demás el número no sale en la foto.
- **Orden:** el de la hora de las fotos, 2.11.12, 2.11.12 (1), 2.11.12 (2) y 2.11.13. El total está en la última.

### Productos

|                                  |                           |
| -------------------------------- | ------------------------: |
| Líneas leídas                    |                        55 |
| Unidades escritas                |                       168 |
| Confianza ALTA / MEDIA / REVISAR |               37 / 15 / 3 |
| Duplicados exactos               |   0: no se consolidó nada |
| Bultos, packs o cajas            |                         0 |
| Códigos de barras                | 0: el presupuesto no trae |
| Productos finales                |                        55 |
| NUEVO, se cargan                 |           **50 (155 u.)** |
| EXISTENTE_EXACTO, suman stock    |                         0 |
| EXISTENTE_PROBABLE               |                         0 |
| AMBIGUO, no se cargan            |                  2 (6 u.) |
| REVISAR, no se cargan            |                  3 (7 u.) |

Reglas que se aplicaron:

- Precio $0 y "Sin categoría" en todos, porque el catálogo de House no usa categorías.
- Ningún código.
- Las comillas repiten la palabra de la línea de arriba, y las abreviaturas se expandieron solo cuando no hay duda: C/ = con, S/ = sin, F SECOS = frutos secos, H = harina.

### Para revisar (Tickets 2)

**No se cargaron:**

- **CANUAS(?) CHÍA, LINO Y GIRASOL** (2 u., hoja 3 fila 4): la primera palabra no se lee con seguridad.
- **ARÁNDANOS CUMANÁ** (hoja 4 fila 3): dice cantidad 1, pero el importe es de 2 (2 × 3060). No se sabe si son 1 o 2.
- **MUECAS(?) PROTEICA** (4 u., hoja 4 fila 7): la primera palabra puede ser MUECAS o NUECAS.
- **Bolitas choco** (3 u.): se parece a "Cereal Nesquik bolitas chocolate 230 g", que ya está.
- **Anillitos frutales** (3 u.): se parece a "Cereal Lasfor Arttos frutales 500 g", que ya está.

**Se cargaron, pero conviene mirar el envase:**

- **Leídas tal cual, confirmadas en las tiendas:** Gell Singh (sal), Dicomere (cacao) y Wakas existen.
- **Leídas tal cual, sin confirmar:**
  - Donina (4 productos)
  - Entronuts (quizás es Entrenuts)
  - Nutrifood
- **Abreviaturas que se interpretaron:**
  - "C/ALGAR", que se cargó como con algarroba
  - "H" en "H ALMENDRAS" y "H COCO", que se cargó como harina
- **Correcciones a mano en el presupuesto:**
  - "Mix ensaladas", con una palabra tachada
  - Sal gruesa Macrozen y Cacao amargo: el importe no da por $1
  - Choco Smams: el precio está reescrito

Los duplicados se miraron en `tickets2_duplicados.xlsx`. Pares como "Granola 5 semillas" y "Donina 5 semillas", o los tres mixes de frutos secos, son productos distintos: otra marca, otra variedad y otro precio.

## Integración local

Se aplicó con `scripts/incorporar-compra.ts`, que es nuevo:

- Corre en una transacción y valida adentro.
- Tiene ensayo.
- Es idempotente: una segunda pasada dice "YA APLICADA" y no toca nada.

|                                      |                            |
| ------------------------------------ | -------------------------: |
| Productos de House antes             |                        191 |
| Productos existentes incrementados   |                          0 |
| Productos nuevos                     |                         50 |
| Ambiguos y para revisar, no cargados | 5 (2 ambiguos + 3 REVISAR) |
| **Productos de House después**       |                    **241** |
| Unidades antes                       |                       3695 |
| Unidades agregadas                   |                        155 |
| **Unidades después**                 |                   **3850** |

- **Cómo entran los productos nuevos:** cada uno entra por el alta de siempre, con precio $0, sin costo, por unidad y "Sin categoría". Tiene un movimiento INITIAL con el motivo `Compra compra-tickets2-house-2026-10 · hoja X fila Y`.
- **Lo que no cambió:**
  - **Productos de antes:** los 191 están idénticos, con el mismo nombre, stock, precio, códigos y foto.
  - **Ventas, cajas, clientes y usuarios:** tienen la misma huella md5 en las dos bases.
  - **Franco:** no existe en la base local; es un usuario de producción.

## Imágenes

Se buscaron con `scripts/buscar-imagenes.ts --compra`, en Carrefour, Jumbo y Más Online, y se revisaron una por una a ojo. Una foto se aprueba solo si **coinciden la marca y la variedad y las tiendas tienen una sola presentación**, porque el presupuesto no dice ni el peso ni el sabor. No se aprobó ninguna por parecido general.

|                                                 |                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| Nuevas encontradas por el buscador (candidatas) |                                                                                                                                                                                                                                                    41 |
| **APROBADAS**, cargadas en la base local        |                                                                                                               **2**: Cacao amargo Dicomere (200 g, la única presentación) y Premezcla Delicel universal (el envase dice "Premezcla Universal", 500 g) |
| **DUDOSAS**, no cargadas                        | **9**: Choco Smams, Chips choco Smams, Rosquita Smams (el envase dice sabor vainilla), Fideos Wakas kale, Fideos Wakas maíz, Sal fina Gell Singh, Barra Brava arándanos, Iron Bar y Barrita Entronuts. Cada una tiene varias presentaciones o sabores |
| **SIN_IMAGEN**                                  |                                         **39** de los 50 nuevos. Son productos sueltos sin marca (copos, frutos secos, granolas), marcas que no están en las tiendas (Donina, Wik, Praderas) y Cumaná, que en las tiendas es otra marca, de conservas |

- **Rechazos a ojo:** el buscador había marcado como encontradas "Quinoa pop" (trajo una premezcla para falafel) y "Premezcla universal Natuzen" (en la foto es de bizcochuelo). Se rechazaron al mirarlas.
- **Fotos de antes:** las 147 quedaron intactas. Ningún producto de antes gana mejor identificación con Tickets 2.

## Riesgos

Solo los problemas reales que aparecieron:

1. **Hay stock de más en 12 productos, en producción: 2872 unidades.** Los reportes de stock, el valor del inventario y los avisos de reposición de esos productos están inflados. La venta no se traba, porque sobra stock. Para corregirlo en producción hay que tener en cuenta lo que se vendió desde el 22/10 a las 12:47 UTC.
2. **Tres productos tienen el código de venta equivocado en producción:** Monster Mango Loco, Pehuamar acanaladas y Nieto Senetiner. Al escanear el envase real, el sistema dice que no existe.
3. **Hay nombres equivocados:** aceite, lavandina y harina. Buscar "aceite" o "lavandina" en la caja no encuentra esos productos.
4. **Tickets 2 deja 5 líneas sin cargar (13 u.)** y 15 nombres para confirmar con el envase. Si se despliega así, esos productos no van a estar o van a tener el nombre tal como se leyó.

## Segunda pasada independiente

Es otro guion, `segunda_pasada.py`, que no lee la transcripción. Parte del OCR, de las planillas generadas, de las Excel originales, del manifiesto y de las dos bases.

| Control                                                                  | Resultado                                                                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Tickets 1: imagen contra planilla                                        | 192 líneas y 823 u. 104 cantidades confirmadas por el OCR al mismo precio, 0 contradichas y 0 códigos de las fotos ausentes |
| Tickets 1: planilla contra Excel, por código                             | 4 códigos distintos (los mismos), 0 cantidades distintas, 12 de 12 bultos con la Excel en unidades                          |
| Tickets 2: planilla contra presupuesto                                   | la suma = el TOTAL escrito; la normalizada tiene una fila por línea; el manifiesto es igual a los NUEVO                     |
| House antes / después: productos                                         | 191 / 241                                                                                                                   |
| House antes / después: unidades                                          | 3695 / 3850                                                                                                                 |
| Con código                                                               | 105 / 105                                                                                                                   |
| Fotos                                                                    | 147 / 149                                                                                                                   |
| Nombres repetidos, códigos repetidos, "bulto" en el nombre               | 0 / 0 / 0                                                                                                                   |
| Precio distinto de $0, stock negativo, nombres vacíos, sin fila de stock | 0 / 0 / 0 / 0                                                                                                               |
| Libro de stock que no cierra (suma de movimientos ≠ stock)               | 0                                                                                                                           |
| Tickets 1 contra el catálogo final                                       | 823 u. según los tickets y 3695 en el catálogo. Las 2872 de diferencia están todas en los 12 bultos, y el resto da exacto   |
| Huella del catálogo (SHA-256 de nombre\|stock\|precio\|códigos)          | antes `7ee0ba67…6824f`, después `af06f4c0…759f1e`                                                                           |
| Problemas sin explicar                                                   | **0**                                                                                                                       |

Las huellas SHA-256 de cada foto están en las hojas "fuentes" de las planillas, y las de cada archivo, en `auditoria_fuentes/segunda_pasada.json`.

## Revisión en la app local

Se revisó con la compilación de esta rama, en http://localhost:3104, contra `kiosco_house_tickets2_dev`. El usuario de prueba es `admin`, con la clave de demostración que está en `docs/DEV_ENVIRONMENT.md`. No se hizo ninguna venta.

- **API:**
  - 241 activos y 3850 u., con 0 a precio distinto de $0 y 0 con "bulto" en el nombre.
  - La foto nueva de Dicomere se sirve como WebP.
- **/productos:**
  - "Cacao" trae el Cacao amargo Dicomere nuevo, con foto y 2 u., junto a los Nesquik y Toddy de Tickets 1, que no tienen foto.
  - "Cuman" trae los 7 Cumaná nuevos, sin foto y con 2 u. cada uno.
  - "Clight" trae los 4 Clight con foto y 400 u., que es el exceso de los bultos.
- **/stock:**
  - "Coca Cola" trae los 4 de Tickets 1, con 18 y 8 u.
  - "Granola" trae las 4 nuevas, con 5 u.
- **/venta:**
  - "Delicel" muestra la foto, "Hay 2 u." y $0.
  - "Nueces" muestra "Hay 5 u.".
  - El carrito quedó vacío. Las ventas siguen en 15, y lo único nuevo en la bitácora es el inicio de sesión.
- **Lector de códigos:**
  - 7790895650833 encuentra Coca Cola 600cc y 7790036000329 encuentra Baggio Pronto 1L.
  - El código real del Monster, 7798422620045, da 404: es el riesgo 2.
  - El código de bulto 37790036000320 da 404, como debe.
- **Productos que ya existían y sumaron stock:** no hay, porque Tickets 2 no trae ninguno.
- **Servidor:** sin errores.
- **Hoja de contacto:** abre bien, y los filtros "Nuevos Tickets 2" y "Eran bulto" funcionan.

## Archivos

- **Tickets 1:**
  - `Stock\Tickets\auditoria\tickets1_desde_imagenes.xlsx`
  - `Stock\Tickets\auditoria\comparacion_tickets1.xlsx`, con las hojas comparacion, resumen, bultos, normalizacion_vs_tickets y alineacion
- **Tickets 2:**
  - `Stock\Tickets2\procesado\tickets2_transcripcion.xlsx`
  - `Stock\Tickets2\procesado\tickets2_normalizado.xlsx`
  - `Stock\Tickets2\procesado\tickets2_duplicados.xlsx`
  - `Stock\Tickets2\procesado\imagenes_tickets2.xlsx`
- **Hoja de contacto:** `Stock\Tickets2\procesado\hoja_contacto_house_local.html`. Se abre con doble clic y tiene foto, stock, código y origen de los 241 productos, con filtros.
- **Fuentes y controles:** `Stock\auditoria_fuentes\`, con las transcripciones, los guiones y el resultado de la segunda pasada.
- **En el repositorio:**
  - `docs/manual-house/tickets2/compra-tickets2.json` y `imagenes-tickets2.json`
  - `scripts/incorporar-compra.ts` y `scripts/lib/compra.ts`, `scripts/lib/incorporar-compra.ts`
  - Pruebas en `tests/unit/compra.test.ts` y `tests/integration/incorporar-compra.test.ts`
  - Una copia de este informe en `docs/manual-house/auditoria-stock-house.md`

El repositorio de GitHub es **público**. Por eso las fotos de los tickets y las planillas con precios quedan solo en `Stock\`, que está fuera de git. Este informe solo muestra los precios de las 12 líneas de bulto, porque son la evidencia, y no tiene totales de compra.
