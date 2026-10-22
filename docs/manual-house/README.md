# Manual de House

Material para el personal del primer local (House). No es documentación técnica:
está escrito para quien atiende el mostrador.

| Archivo                           | Qué es                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `Manual_Kiosco_House.pdf`         | La guía completa, 32 hojas A4, para imprimir o mandar.                       |
| `Guia_Rapida_Kiosco_House.pdf`    | Una sola hoja A4 para tener al lado de la caja.                              |
| `Manual_Kiosco_House.html`        | Fuente editable de la guía. Cada `<section class="pagina">` es una hoja.     |
| `Guia_Rapida_Kiosco_House.html`   | Fuente editable de la hoja rápida.                                           |
| `manual.css`, `manual.js`         | Estilos y armado (pie, índice, recortes, marcas naranjas).                   |
| `capturas/`                       | Capturas de la aplicación real y `marcas.js` (generados).                    |
| `bultos-house.md`                 | Los productos cargados como bulto, pasados a unidades: qué cambió y por qué. |
| `bultos-house.json`               | Los códigos de unidad verificados que usa `scripts/normalizar-bultos.ts`.    |
| `imagenes-house.md`               | Las fotos de los productos: cuáles se encontraron, cuáles faltan.            |
| `imagenes-house.json`             | El manifiesto de fotos que carga `scripts/cargar-imagenes.ts`.               |
| `auditoria-stock-house.md`        | Los tickets contra las listas y el stock, y la segunda tanda (Tickets 2).    |
| `tickets2/compra-tickets2.json`   | La segunda tanda, que carga `scripts/incorporar-compra.ts`.                  |
| `tickets2/imagenes-tickets2.json` | Las fotos de los productos de la segunda tanda, revisadas a ojo.             |

Ningún archivo lleva contraseñas. La clave inicial de cada persona se entrega
aparte.

## Cambiar un texto

Editar el HTML y volver a generar el PDF:

```bash
npx tsx scripts/manual-house/pdf.ts
```

El generador abre el HTML en Chromium y **no escribe el PDF** si alguna hoja
desborda (texto cortado), si falta una imagen o si un número naranja no tiene
posición: dice qué hoja corregir. Abrir el HTML en el navegador también sirve
para ver cómo queda.

## Volver a sacar las capturas

Cuando cambia una pantalla. Siempre contra una instancia **local** y nueva, con
datos de ejemplo, nunca contra la de producción:

1. Una base vacía con la instancia dada de alta (`npm run alta:instancia`), la
   sucursal "House" y un usuario con rol `operador` y clave temporal.
2. La aplicación compilada (`npm run build`) levantada contra esa base.
3. Las capturas, con la clave temporal por el entorno (no queda en el código):

```bash
MANUAL_URL=http://localhost:3102 MANUAL_USUARIO=Franco MANUAL_CLAVE=<temporal> npx tsx scripts/manual-house/capturas.ts
```

El guion recorre un día entero (primer ingreso, caja, productos, ventas,
inventario, cierre, reportes) y deja cada captura en `capturas/`. Después,
regenerar el PDF.
