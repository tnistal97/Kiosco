# Ticket3 y la corrección de Tickets 1

29/10/2026. Rama `fix/house-ticket3-final-stock`, que sale de `feat/house-tickets2-stock-audit`.

Las **fotos de los tickets** son la fuente. Todo lo demás (las Excel, la base, la auditoría anterior) se contrastó contra ellas. Las fotos y las planillas con precios quedan solo en `Stock\` (el repositorio es público).

## 1. Tickets 1: lo que se corrige

Lo aplica `scripts/corregir-tickets1.ts` con [`../correcciones-tickets1.json`](../correcciones-tickets1.json), en una transacción y una sola vez (marca `correccion-tickets1-house-2026-10` en la bitácora).

- **Los 12 bultos.** El ticket imprime `q(n) x precio por bulto` y las dos Excel ya tenían `q × n`. La normalización del 22/10 volvió a multiplicar, así que sobran **2872 unidades**. Se vuelven a mirar los 12 renglones en las fotos, uno por uno.
  - **Cómo se descuenta:** se resta exactamente lo que la normalización sumó de más, con un ajuste de stock y no escribiendo el saldo. Si hubo ventas o movimientos después, quedan.
  - **Qué comprueba el guion antes de tocar nada:** que los movimientos de la normalización sean los que vio la auditoría, que el libro explique el stock y que nada quede negativo.

  | Producto                           | Ticket          | Unidades | Había | Queda |
  | ---------------------------------- | --------------- | -------: | ----: | ----: |
  | Aceite de girasol Natura 5 L       | `1(1)` y `2(4)` |        9 |    33 |     9 |
  | Puré de tomate Noel brick 520 g    | `2(12)`         |       24 |   288 |    24 |
  | Baggio Pronto naranja 1L           | `1(8)`          |        8 |    64 |     8 |
  | Baggio Pronto naranja 200cc        | `1(18)`         |       18 |   324 |    18 |
  | Cerveza Andes Roja lata 473cc      | `1(6)`          |        6 |    36 |     6 |
  | Cerveza Corona porrón 330/355cc    | `2(6)`          |       12 |    72 |    12 |
  | Encendedor Candela                 | `1(25)`         |       25 |   625 |    25 |
  | Red Bull 250ml                     | `1(4)`          |        4 |    16 |     4 |
  | Clight (cada uno de los 4 sabores) | `1(20)`         |       20 |   400 |    20 |

- **Códigos de venta mal copiados** (dígito verificador inválido; el ticket, ampliado, muestra el correcto):
  - Monster Mango Loco: 7798427620045 → **7798422620045**
  - Papas Pehuamar acanaladas: 7790310985553 → **7790310983553**
  - Nieto Senetiner Malbec DOC: 7790070608767 → **7790070760876**
- **Corona porrón:** el código del ticket está en la línea del bulto x6. Se corrige en la descripción (2792798003723 → 7792798003723) y **no** se usa como código de venta.
- **Nombres** que el ticket desmiente:
  - `ACE.` es aceite: Cañuelas oliva 500 cc y Natura girasol 5 L.
  - `HAR.` es harina: Fainax.
  - `LAV.` es lavandina: Ayudín ×2 y Querubín.
  - `ALI.BAGGIO` es Baggio (×4).
  - El Aquarius es de 600cc.
  - Errores de tipeo: Niños, Maicito ×4, Ramitas Pep, Flow "frutos del bosque" (confirmado por su código en la tienda) y Lasfor Aritos.

No se tocan: los 79 productos de la factura T1-B no tienen código de barras porque la Excel 1 no los traía, aunque el ticket los imprime. No es un código incorrecto; queda propuesto aparte.

## 2. Ticket3

Ticket de mayorista "DN", **Control Interno Nro. 0103-00487394**, del 20/10/2026 a las 14:29, en cuenta corriente. Son 7 fotos superpuestas del mismo ticket.

- **Lectura:** a ojo, renglón por renglón, **antes** de abrir el Excel. Da 119 renglones (uno por unidad escaneada, uno de cantidad 4 y tres de cantidad 2, más una anulación de azúcar), **123 unidades** y 54 productos. La suma de importes es **362250,01**, igual al subtotal y al total impresos.
- **Excel de ChatGPT** (`stock_kiosco_ticket_20_octubre_2026.xlsx`, sin modificar):
  - Las 54 cantidades coinciden: no multiplica packs ni cajas y descuenta la anulación.
  - **Tiene 4 diferencias, todas de nombre.** Tres completan texto que la impresora corta:
    - "200 g" en las tostadas Equilibrio dulces: correcto según la tienda.
    - "tostado" en el café La Virginia: correcto según la tienda.
    - "White" en la Colgate Total 12: equivocado, la variante es Whitening.
  - La cuarta corrige la ortografía de Odolito ("tutti frutti").
- **Cantidades:** la columna del ticket ya es la unidad comprada. Un tripack, un paquete de 4 × 50 g o un renglón de 4 sachets quedan como se compraron: **no se multiplica nada**.
- **Contra el catálogo:**
  - **53 NUEVO, con 122 unidades.** Ninguno existía. La leche sachet no es la UAT fortificada que ya está, y la sal fina Dos Anclas no es el aceto Dos Anclas.
  - **1 REVISAR, no se carga:** el queso rallado La Quesera "100 u x 8 g", una caja de 100 sobres comprada como 1. Cargar 1 caja o 100 sobres cambia el stock por 100, y lo decide el dueño.
- **Carga:** `scripts/incorporar-compra.ts` con [`compra-ticket3.json`](compra-ticket3.json), con precio 0 y "Sin categoría". Lleva la marca `compra-ticket3-house-dn-0103-00487394` y la huella de lo que se carga, de las fotos y del Excel; una segunda corrida no suma nada.
- **Fotos:** [`imagenes-ticket3.json`](imagenes-ticket3.json), revisadas a ojo. **28 APROBADA, 16 DUDOSA y 9 SIN_IMAGEN.** Solo se cargan las aprobadas, con `scripts/cargar-imagenes.ts`.
  - **APROBADA** quiere decir misma marca, variante, tamaño y presentación. Las que el buscador eligió mal se corrigieron a mano, como las tostadas de arroz Manieri, donde había tomado las dulces en vez de las clásicas.
  - **Kalma** no tiene foto: la única publicada es el recuadro "Imagen no disponible".

## 3. Cómo se aplica

Primero en una base local nueva, copia del House local, que tiene el mismo catálogo que producción; después en producción, con respaldo previo. El orden es:

```bash
npx tsx scripts/corregir-tickets1.ts docs/manual-house/correcciones-tickets1.json --sucursal 1 --autor 1 --ensayo
npx tsx scripts/corregir-tickets1.ts docs/manual-house/correcciones-tickets1.json --sucursal 1 --autor 1 --aplicar
npx tsx scripts/incorporar-compra.ts docs/manual-house/ticket3/compra-ticket3.json --sucursal 1 --autor 1 --ensayo
npx tsx scripts/incorporar-compra.ts docs/manual-house/ticket3/compra-ticket3.json --sucursal 1 --autor 1 --aplicar
npx tsx scripts/cargar-imagenes.ts docs/manual-house/ticket3/imagenes-ticket3.json --sucursal 1 --autor 1 --aplicar
```

Resultado esperado: 191 → **244 productos** y 3695 → **945 unidades** (−2872 + 122), todos a $0, 147 → **175 fotos**.

Una segunda pasada aparte (`Stock\auditoria_fuentes\segunda_pasada_t3.py`) rehace la cuenta con el OCR de Windows sobre las fotos, sin usar la lectura a ojo:

- **Ticket3:** une por sí misma las 7 fotos superpuestas y llega al mismo orden. Confirma 116 renglones, y los 3 que no lee suman justo lo que falta para el total impreso.
- **Tickets 1:** confirma 11 de los 12 bultos y los 4 códigos.
- **Base:** la compara fila por fila con lo esperado.
