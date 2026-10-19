# Teclado de la venta (V6)

> Octubre de 2026. Reemplaza la gramática de la UX V5 (`docs/UX_V5_ALMACEN.md`, §7).
> Código: `src/components/venta/teclado.ts` (función pura), `src/app/venta/page.tsx`,
> `ProductBrowser.tsx`, `Ticket.tsx`, `DialogoCobro.tsx`, `GuiaDeTeclado.tsx`.

## Por qué cambió

En la V5 las cuatro flechas solo recorrían, la cantidad se cambiaba con + y −, y Enter
sobre un producto lo "elegía": si no estaba en el ticket sumaba una unidad y si ya
estaba solo marcaba su línea. La misma tecla hacía dos cosas según el estado, y había
un modo "escribiendo" (← → mueven el cursor) distinto de "eligiendo" (← → recorren).
El dueño pidió una gramática sin ambigüedades: **cada eje, una sola responsabilidad**.

## Las tres etapas

La venta tiene tres etapas y la pantalla muestra siempre en cuál está, debajo del
buscador: **1. Productos › 2. Carrito › 3. Cobro**, con la actual en un fondo lleno y
`aria-current="step"`. Al lado, las teclas de esa etapa.

### 1. Productos

| Tecla             | Qué hace                                                                       |
| ----------------- | ------------------------------------------------------------------------------ |
| letras, números   | Van al buscador, aunque el foco esté en la lista o en un botón                 |
| ↑ ↓               | Eligen el producto anterior / siguiente. Nunca cambian cantidades              |
| →                 | Agrega **exactamente una** unidad del producto elegido                         |
| ←                 | Resta una, si está en el carrito; si no está, nada. En cero la línea se quita  |
| Enter             | Pasa al carrito. **No suma ni resta.** Con el carrito vacío, avisa             |
| Enter con dígitos | Es un código (el lector, o uno tipeado): agrega una unidad, no cambia de etapa |
| Esc               | Con texto: limpia la búsqueda. Sin texto: suelta el producto elegido           |
| Retroceso         | Borra del buscador. No toca el carrito                                         |

Escribiendo un nombre, el **primer resultado** queda elegido solo: "yerba" y → agrega
la primera yerba, la que se ve marcada. Sin búsqueda y sin haber apretado ↑ ↓ no hay
nada elegido, y → no agrega nada que nadie eligió. Después de una lectura del lector
tampoco queda nada elegido en la lista: para llevar otra, se lee otra vez, o se pasa al
carrito (la línea leída queda elegida ahí) y se aprieta →.

En el buscador ← → **no mueven el cursor**: son de la gramática aunque en ese momento
no haya nada que sumar, para que una misma tecla no signifique dos cosas. Para corregir
lo escrito están Retroceso y Esc.

Cada fila que ya está en el carrito muestra cuánto hay ("2 u.") delante del nombre.

### 2. Carrito

| Tecla  | Qué hace                                                             |
| ------ | -------------------------------------------------------------------- |
| ↑ ↓    | Eligen la línea anterior / siguiente                                 |
| →      | Una unidad más de esa línea (en el tope de stock, avisa y no suma)   |
| ←      | Una menos; en cero la línea se quita, con "Deshacer". Nunca negativo |
| Enter  | Abre el cobro                                                        |
| Esc    | Vuelve a productos. El carrito no se toca                            |
| Supr   | Quita la línea elegida (con "Deshacer")                              |
| letras | Vuelven a productos y buscan                                         |

Entrar al carrito limpia la búsqueda (al volver se busca lo que sigue) y elige la última
línea que entró. Si el carrito queda vacío, se vuelve solo a productos. En un producto
por peso, → y ← abren el peso. Por debajo de 1280 px el carrito no está a la vista: Enter
lo abre como hoja, con el foco en las líneas, y Esc la cierra.

### 3. Cobro

| Paso          | Tecla           | Qué hace                                                                                                   |
| ------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| Forma de pago | ← → ↑ ↓         | Recorren Efectivo, Transferencia, Mercado Pago, Débito, Crédito, Fiado                                     |
|               | Enter           | La elige: efectivo → Recibido; fiado → cliente; otra → Confirmar                                           |
| Recibido      | números         | Cuánto dio; el vuelto se ve al instante                                                                    |
|               | Enter           | Si alcanza: pasa a **Confirmar venta**. Vacío: pone el justo, a la vista, y pasa. Si no alcanza, no avanza |
| Confirmar     | Enter           | **Registra la venta**                                                                                      |
| Resultado     | Enter           | Nueva venta, con el foco en el buscador                                                                    |
| Siempre       | Esc             | Vuelve al carrito sin perder nada                                                                          |
|               | E T M D C F · J | Eligen la forma de pago · Recibido = justo                                                                 |

Enter en Recibido **ya no confirma** (en la V5 sí): el único Enter que registra una venta
es el que se aprieta con el foco en "Confirmar venta", con el vuelto ya en pantalla.

## Seguridad contra Enter de más

- **Teclas sostenidas**: Enter, →, ←, +, − y Supr no se repiten (↑ ↓ sí).
- **Doble Enter rápido**: un Enter que llega a menos de 300 ms
  (`PAUSA_ENTRE_ETAPAS_MS`) del anterior no avanza otra etapa. Vale en cada paso:
  productos → carrito, carrito → cobro, forma de pago → recibido → confirmar, y en el
  resultado (un Enter que rebota no cierra el VUELTO). El mouse no tiene esa espera.
- **El Enter del lector** nunca avanza de etapa. Si un lector manda un Enter de más
  (CR + LF), ese segundo Enter cae dentro de la pausa y se ignora.

Desde productos hasta una venta registrada hacen falta, como mínimo, cinco Enter
deliberados: carrito, cobro, forma de pago, recibido, confirmar.

## Lector de códigos

Sin cambios de mecanismo: el buscador reconoce la ráfaga del lector (≥ 6 dígitos con
≤ 40 ms entre teclas) y la separa de lo escrito a mano. Probado con el foco en el
buscador, en la lista, en un botón, después de texto, después de números, dos lecturas
seguidas (dos unidades), un código inexistente ("Código no registrado") y desde el
carrito (agrega y sigue revisando).

## Atajos que siguen

Siguen funcionando las teclas `+` y `−` (sinónimos de → y ← con el buscador vacío),
Supr, F12 (cobrar), Alt+N (producto nuevo), Ctrl+K y "/" (ir al buscador). Están en la
ayuda "?" pero no en los botones.

## Pruebas

- `tests/ui/teclado-pos.test.ts`: la tabla completa de `accionDeTecla`, tecla por tecla.
- `tests/ui/catalogo.test.tsx`, `ticket.test.tsx`, `cobro.test.tsx`,
  `scanner-input.test.tsx`: el foco real en la lista y el carrito, el cobro paso a paso,
  las repeticiones y los Enter pegados.
- `e2e/teclado.spec.ts`: los 19 casos pedidos y una venta entera solo con el teclado.
