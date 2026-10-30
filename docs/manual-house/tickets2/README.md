# Tickets 2

Presupuesto manuscrito de 4 hojas, una sola compra. Las fotos quedan solo en `Stock\Tickets2`, porque el repositorio es público.

La lectura se revisó el 30/10/2026 contra las fotos y contra el catálogo de producción de ese día, con Ticket3 ya cargado. La comparación del 22/10 contra 191 productos ya no vale.

## Lectura

- **55 líneas y 168 unidades.** La suma de los importes da $341.493, que es el TOTAL escrito en la hoja 4.
- **Bultos:** no hay. La cantidad de cada línea es la unidad comprada, así que no se multiplica nada.
- **Códigos:** el presupuesto no trae, así que ninguna línea puede ser EXISTENTE_POR_CODIGO.
- **Marca corregida:** "ENTRONUTS" es Entrenuts. En estas hojas la "e" manuscrita se lee como "o" (ALMONDRAS, PROMOZCLA), y Jumbo vende la barra proteica Entrenuts.

## Qué se carga

Solo las líneas **CONFIRMADO**: **50 productos y 155 unidades**, todos NUEVO. Ninguna línea existía en el catálogo, ni por Ticket3 ni por Tickets 1, así que no se suma stock a ningún producto.

**No se cargan 5 líneas (13 unidades):**

| Línea                          | Cantidad | Estado  | Motivo                                                                              |
| ------------------------------ | -------: | ------- | ----------------------------------------------------------------------------------- |
| BOLITAS CHOCO                  |        3 | AMBIGUO | Se parece a "Cereal Nesquik bolitas chocolate 230 g"; sin marca ni peso no se sabe. |
| ANILLITOS FRUTALES             |        3 | AMBIGUO | Se parece a "Cereal Lasfor Aritos frutales 500 g"; sin marca ni peso no se sabe.    |
| CANUAS(?) CHÍA, LINO Y GIRASOL |        2 | REVISAR | La primera palabra no se lee con seguridad.                                         |
| ARÁNDANOS CUMANÁ               |        1 | REVISAR | Dice 1, pero el importe es de 2 (2 × 3060).                                         |
| MUECAS(?) PROTEICA             |        4 | REVISAR | La primera palabra no se lee con seguridad.                                         |

## Cómo se carga

```bash
npx tsx scripts/incorporar-compra.ts docs/manual-house/tickets2/compra-tickets2.json --sucursal 1 --autor 1 --ensayo
npx tsx scripts/incorporar-compra.ts docs/manual-house/tickets2/compra-tickets2.json --sucursal 1 --autor 1 --aplicar
npx tsx scripts/cargar-imagenes.ts docs/manual-house/tickets2/imagenes-tickets2.json --sucursal 1 --autor 1 --aplicar
```

- **Movimientos:** tienen el motivo `Carga Tickets 2 · hoja X fila Y`, con precio $0 y "Sin categoría".
- **Una sola vez:** la marca `compra-tickets2-house-2026-10` queda en la bitácora. Si se corre de nuevo, dice "YA APLICADA" y no toca nada.

## Fotos

| Estado     | Cantidad | Detalle                                                                   |
| ---------- | -------: | ------------------------------------------------------------------------- |
| APROBADA   |        2 | Cacao amargo Dicomere 200 g y Premezcla Universal DeliCel 500 g           |
| DUDOSA     |        9 | Hay varios sabores o tamaños y el presupuesto no dice cuál. No se cargan. |
| SIN_IMAGEN |       39 | Productos sueltos sin marca, o marcas que no están en las tiendas.        |

La aprobación de DeliCel del 22/10 tenía un error: el texto describía el envase correcto, pero el enlace apuntaba a una foto de **Dicomere 450 g**. Se corrigió el 30/10 y se revisó la foto nueva a ojo.
