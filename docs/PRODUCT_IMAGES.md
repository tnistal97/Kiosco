# Fotos de productos

## Por qué

En un catálogo de 200 productos con nombres parecidos —cuatro Sprite, cinco
gelatinas Exquisita, tres dulces de leche La Serenísima— la foto es lo más
rápido para confirmar que se eligió el correcto. La foto acompaña al nombre: no
lo reemplaza.

## El modelo

```
ProductImage   productId (PK) · mimeType · data · width · height · sha256 · sourceUrl · createdAt · updatedAt
Product        … · imageSha256
```

- **Una foto como mucho por producto.** La clave primaria es `productId`.
- **En la base, no en el disco.** Son miniaturas WebP de 480 px de lado mayor,
  de 10 a 40 kB. El respaldo de la base (`pg_dump`) ya las incluye y la
  restauración las trae junto con su producto. No hay una carpeta más que crear
  en el servidor, permisos que ajustar, archivos huérfanos que limpiar ni
  cambios en Nginx.
- **Tabla aparte.** El listado y la caja leen el producto en cada tecla y no
  arrastran los bytes.
- **`Product.imageSha256` es una copia de la huella**, y la mantiene un
  disparador de `ProductImage` (`ProductImage_version_en_producto`). La
  aplicación no la escribe nunca. Existe porque el lector de códigos es el
  camino más caliente del sistema y tiene un presupuesto de consultas
  (`tests/performance/queries.test.ts`): leer la versión desde `ProductImage`
  le costaba una consulta más, por un dato que ni siquiera muestra.
- **CASCADE**, como los códigos de barras: una foto es un atributo, no historia.
- La base rechaza lo que la aplicación no escribiría: `mimeType` distinto de
  `image/webp`, más de 1 MB, más de 1024 px, una huella que no sea hexadecimal
  o un origen que no sea `https://`.

## Lo que se guarda nunca es el archivo que llegó

Toda foto pasa por `prepararImagen` (`src/modules/products/imagen.ts`), venga
de la ficha o del guion de carga:

1. se decodifica con `sharp`; si no es JPG, PNG, WebP, AVIF o GIF se rechaza
   (SVG no: es un documento con código adentro);
2. se endereza según la orientación EXIF;
3. se recorta el margen liso: las fotos de catálogo traen el producto chiquito
   en un lienzo blanco de 1000 px, y a 48 px solo se vería el blanco;
4. se achica a 480 px y se codifica como WebP.

Los metadatos del archivo original —la ubicación del teléfono, por ejemplo—
no llegan a la base.

## La API

| Método   | Ruta                                           | Permiso           |
| -------- | ---------------------------------------------- | ----------------- |
| `GET`    | `/api/products/:id/imagen?v=<ver>`             | `products.view`   |
| `PUT`    | `/api/products/:id/imagen` (cuerpo: la imagen) | `products.update` |
| `DELETE` | `/api/products/:id/imagen`                     | `products.update` |

- El listado, el detalle y el lector devuelven `imageUrl`: la dirección con la
  versión (los primeros 16 caracteres de la huella), o `null`.
- Con la versión vigente la foto se sirve con
  `Cache-Control: private, max-age=31536000, immutable`: otra foto es otra
  dirección, así que nunca se muestra una vieja. Sin versión, o con una vieja,
  `private, no-cache` con `ETag`, y `304` si no cambió.
- `next.config.ts` pone `no-store` en toda la API, para que el navegador no
  guarde respuestas privadas. La foto es la única excepción: es la foto del
  envase, no un dato privado, y sin la excepción la caja volvería a pedir cada
  foto en cada pantalla.
- Una sucursal no ve ni toca las fotos de otra (404, como el resto del
  catálogo).
- Cada alta, cambio o baja deja una entrada en la bitácora con la tabla
  `ProductImage`, la huella y el origen. Nunca los bytes. Volver a guardar la
  misma foto con el mismo origen no escribe nada.
- La pantalla achica la foto en el navegador a 1024 px antes de mandarla (100 a
  300 kB). Así no hace falta tocar el `client_max_body_size` de Nginx, que por
  omisión corta en 1 MB. El servidor acepta hasta 5 MB por si alguien la manda
  sin achicar.

## Dónde se ve

- **Productos**: un cuadrado de 48 px al lado del nombre, en la tabla y en las
  tarjetas del teléfono. Sin foto, el mismo cuadrado con un dibujo neutro:
  se ve a simple vista a cuál le falta.
- **Ficha del producto** (Editar): la foto a 160 px, con «Agregar foto»,
  «Cambiar foto» y «Quitar foto» para quien puede editar productos, y el sitio
  de donde salió. Se guarda en el momento, sin «Guardar cambios».
- **Vender**: un cuadrado de 32 px en cada fila, que entra en el renglón de
  40 px sin agrandarlo. Solo desde 640 px de ancho; en el teléfono el ancho es
  para el nombre. Y solo si alguno de los productos a la vista tiene foto: en
  un catálogo sin fotos no aparece.

## Buscar fotos en internet

Dos guiones, para que entre buscar y cargar haya una revisión:

```bash
npx tsx scripts/buscar-imagenes.ts --sucursal 1 --salida imagenes.json
npx tsx scripts/cargar-imagenes.ts imagenes.json --sucursal 1 --autor 1 --ensayo --vista-previa revision/
npx tsx scripts/cargar-imagenes.ts imagenes.json --sucursal 1 --autor 1 --aplicar
```

**`buscar-imagenes`** no escribe en la base. Busca en el catálogo público de
supermercados argentinos que publican la foto de frente que manda el fabricante
(Carrefour, Jumbo, Más Online), una consulta cada medio segundo y con un agente
propio. Deja un manifiesto (`.json`) y un resumen para leer (`.md`). Para cada
producto anota la tienda, la página, la foto, el nombre en la tienda y uno de
tres estados:

| Estado          | Cuándo                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `encontrada`    | La tienda tiene **el mismo código de barras**, o el mismo nombre con la misma marca, medida y variedad. |
| `dudosa`        | Se parece, pero falta algo (una palabra que distingue, la medida) o hay dos candidatos igual de buenos. |
| `no-encontrada` | Ninguna tienda tiene algo parecido.                                                                     |

La regla por nombre (`scripts/lib/coincidencia-de-productos.ts`, con sus
pruebas en `tests/unit/`) es prudente a propósito: otra medida es otro producto,
y "sin azúcar" o el sabor distinguen. Una foto equivocada en la caja es peor que
no tener foto.

**`cargar-imagenes`** solo carga las `encontrada`. Busca cada producto por su
nombre exacto entre los activos de la sucursal y, si el manifiesto trae código,
exige que sea también su código principal: los ids no sirven, porque el
manifiesto se puede armar en una base y aplicar en otra. Solo descarga de los
servidores de imágenes de esas tiendas. `--ensayo` descarga y prepara todo sin
escribir; con `--vista-previa` deja las miniaturas y una hoja `index.html`
para revisarlas a ojo, dudosas incluidas. Se puede repetir sin duplicar nada.

Para cargar una dudosa: mirarla, y si está bien, cambiarle el estado a
`encontrada` en el manifiesto. O ponerle la foto desde la ficha del producto.

## Desplegar

1. Migración aditiva (`20261022100000_product_images`): una tabla nueva, una
   columna que admite null y un disparador. La versión anterior del código sigue
   funcionando. La vuelta atrás es volver a desplegar el código anterior; las
   fotos quedan en la base sin que nadie las lea.
2. `sharp` pasa a ser dependencia directa (ya venía instalada como opcional de
   Next): `npm ci` tiene que poder instalar el binario de la plataforma del
   servidor.
3. Cargar las fotos con `cargar-imagenes --ensayo` y después `--aplicar`, con
   un autor administrador.

No hay cambios de Nginx, CSP ni dominios: las fotos se sirven desde el mismo
sitio (`img-src 'self'`).
