# /venta UX V3 — implementación

Lo que se hizo, por qué, y qué se midió antes y después. La propuesta que se
aprobó está en [UX_V3_VENTA_PROPUESTA.md](UX_V3_VENTA_PROPUESTA.md); esto es
el resultado.

Base de desarrollo: `127.0.0.1:5433/kiosco_dev`. Mediciones y pruebas contra
la construcción de producción en `127.0.0.1:3099` (mediciones y capturas) y
`127.0.0.1:3101` (extremo a extremo). Producción: no se tocó. Migraciones: 0.

---

## 1. Qué cambió, en una línea cada uno

| #   | Cambio                                                                                                   | Por qué                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | **Gramática de teclado con tres zonas** (`campo`, `lista`, `ticket`).                                    | ← y → cambiaban la cantidad con sólo tener una línea elegida, y corregir "coca colaa" era imposible sin mouse. |
| 2   | **Enter no cobra.** Campo vacío → REVISAR; revisando → cobro; en el cobro, sólo con pago declarado.      | Dos Enter distraídos registraban una venta con el importe que el placeholder sugería.                          |
| 3   | **El foco vive en el campo**, siempre; lo elegido es una marca, no un foco.                              | El lector tiene que funcionar mientras se recorre la lista, y volver de un diálogo costaba 323 ms.             |
| 4   | **Lista de una columna sin encabezado**, nombre hasta dos renglones, estado en palabras, precio tabular. | Se leía como una planilla y en 1024 el nombre terminaba en "Aceite de girasol 9…".                             |
| 5   | **Carga incremental**: se acumulan páginas de 60.                                                        | "Se muestran 60 de N: buscá por nombre" era una pared sin salida.                                              |
| 6   | **"Frecuentes" no se activa solo.**                                                                      | Cambiaba la lista que el cajero estaba mirando en medio de una venta.                                          |
| 7   | **Debounce sólo al texto** (120 ms); categoría, página y filtros salen en el mismo cuadro.               | Un chip de categoría tardaba 315 ms para una consulta de 35.                                                   |
| 8   | **Sin regla de barra lateral por ruta** y sin animación de ancho.                                        | Entrar a /venta movía la pantalla entera: CLS 0,6.                                                             |
| 9   | **Modos Lector y Nombre**, elegidos por equipo y guardados.                                              | El campo dice para qué es, y el punto verde reemplaza al pitido del lector.                                    |
| 10  | **Deshacer** en quitar y vaciar, sin diálogos de confirmación.                                           | Un modal en medio de una venta cuesta más que el error que evita.                                              |
| 11  | **Dos paneles desde 1280** y ticket elástico `clamp(360px, 29vw, 440px)`.                                | Con dos paneles en 1024, al nombre le quedaban 199 px.                                                         |

---

## 2. Modelo de teclado

`src/components/venta/teclado.ts` es una función pura: dice qué significa cada
tecla, y la pantalla ejecuta. Tres zonas, sin excepciones.

| Tecla    | campo (escribiendo)                                              | lista (fila elegida)                             | ticket (revisando)           |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------ | ---------------------------- |
| `↓`      | entra a la lista (marca la primera)                              | fila siguiente                                   | línea siguiente              |
| `↑`      | nada (el cursor)                                                 | fila anterior; desde la primera, vuelve al campo | línea anterior               |
| `→`      | **mueve el cursor**                                              | +1 del producto elegido                          | +1 de la línea               |
| `←`      | **mueve el cursor**                                              | −1; en 1, lo quita con Deshacer                  | −1; en 1, lo quita           |
| `Enter`  | código → busca · texto → agrega el primero · vacío → **REVISAR** | agrega y limpia                                  | **abre el cobro**            |
| `Escape` | limpia el campo · cierra el aviso                                | suelta la fila, el texto queda                   | vuelve al campo              |
| `Supr`   | borra texto                                                      | nada                                             | quita la línea elegida       |
| `+` `−`  | nada                                                             | ±1 (sólo con el campo vacío)                     | ±1 (sólo con el campo vacío) |

Sigue habiendo alias: `F12` cobra, `Alt+N` producto nuevo, `Ctrl+K` va al
campo, `E D R T F O` eligen medio en el cobro y `J` pone el importe justo.

**Enter seguro, en cuatro pasos.** Con el ticket armado hacen falta cuatro
teclas deliberadas para que exista una venta: `Enter` (revisar) → `Enter`
(cobro) → declarar el pago (`J`, un importe, o un medio) → `Enter`. Antes eran
dos. `pagoDeclarado` (`cobro.ts`) decide si Enter alcanza; el botón
"Cobrar $ X" se puede apretar igual, porque apretarlo ya es declarar.

---

## 3. Foco

Una sola regla: **el foco vive en el campo**, y sólo se lo lleva un diálogo.
Lo elegido en la lista y en el ticket es estado, no foco, así que el lector
sigue vivo mientras se recorre el catálogo.

Los diálogos de la caja se abren con el foco ya puesto en el campo
(`abrirCapa`), de modo que Headless UI lo devuelva ahí se haya llegado con el
teclado o con el mouse, y salen sin transición (`rapido`). Se eliminaron los
reintentos en 0/120/260/420 ms.

Tab sigue metiendo el foco de verdad en la lista y en el ticket, que es el
camino de quien usa lector de pantalla.

---

## 4. Archivos

Nuevos:

- `src/components/venta/Secciones.tsx` — los chips, fuera de la lista.
- `src/components/venta/SelectorDeModo.tsx` — `[● Lector | Nombre]`.
- `src/components/venta/useModoDeVenta.ts` — la preferencia del equipo.
- `tests/ui/modo-de-venta.test.tsx`.

Cambiados: `src/app/venta/page.tsx`, `src/components/venta/{teclado,foco,cobro}.ts`,
`src/components/venta/{ProductBrowser,Ticket,POSLayout,DialogoCobro,AyudaAtajos}.tsx`,
`src/components/ui/{Dialog,ScannerInput,toast}.tsx`, `src/hooks/useProducts.ts`,
`src/components/shell/{AppShell,Sidebar}.tsx`, `src/app/globals.css`.

Sin tocar: `prisma/**`, `src/modules/**`, `src/server/**`, `src/store/cart.ts`,
`src/app/api/**`. Cero migraciones, cero cambios de reglas de negocio.

---

## 5. Números

### Velocidad

Mismo método que el baseline: el instante de la tecla lo registra un escucha
en fase de captura dentro de la página, el del resultado un `MutationObserver`
confirmado en el cuadro siguiente. Cinco muestras, mediana, contra la
construcción de producción en 1366×768 (`scripts/medir-venta-v3.mts`;
`docs/metrics/venta-v3-{antes,despues}.json`).

| Medición (mediana de 5, ms) | Antes |   Después |    Objetivo |
| --------------------------- | ----: | --------: | ----------: |
| F5 → primera fila           | 184,7 | **131,0** |           — |
| Cambio de categoría         | 314,7 |  **29,1** |       < 100 |
| Búsqueda por nombre         | 311,6 |   **2,6** |       < 180 |
| Escaneo → ticket            |  32,6 |  **22,8** | no empeorar |
| ↓ (elegir fila)             |  13,0 |  **10,1** |           — |
| Enter agrega                |  11,7 |  **15,1** |           — |
| Enter → revisar             |     — |  **12,2** |           — |
| Abrir el cobro              |  26,5 |  **15,1** |           — |
| Cobro estable               | 281,5 |  **30,8** |       < 120 |
| Volver del cobro            | 322,8 |  **27,0** |        < 60 |
| Cobrar → registrada         |  96,2 |  **45,8** |           — |
| Registrada → listo          | 328,7 |  **20,6** |        < 60 |

Dos aclaraciones honestas:

- **Búsqueda 2,6 ms** es lo que tarda la LISTA en mostrar sólo lo que coincide,
  no la respuesta del servidor: mientras la consulta viaja se filtra lo que ya
  está cargado con el mismo criterio que usa el servidor. La respuesta llega
  después (unos 35 ms más) y confirma. El número del baseline —311,6— medía lo
  mismo: cuándo cambiaban las filas. Por eso `busqueda_api` quedó en −1 en el
  "después": cuando la lista ya cambió, la petición todavía no terminó.
- **Enter agrega** y **↓** quedaron dentro del ruido de medición a esa escala
  (una decena de ms): ninguno de los dos se percibe. Las dos corridas —antes y
  después— se tomaron con la misma máquina en reposo; una corrida intermedia
  con compilaciones en paralelo dio números peores en todo (56 ms de categoría
  en vez de 29) y exactamente las mismas conclusiones.

### Estabilidad y densidad

|                                         |               Antes |     Después | Objetivo |
| --------------------------------------- | ------------------: | ----------: | -------: |
| CLS al entrar a /venta (`/` → `/venta`) |                 0,6 |       **0** |      ≈ 0 |
| CLS al salir (`/venta` → `/`)           |                 0,1 |       **0** |      ≈ 0 |
| "Datos en pantalla" al entrar a /venta  |            372,9 ms | **64,1 ms** |        — |
| Peticiones al entrar a /venta           |                  12 |       **3** |        — |
| Filas visibles 1366×768                 |                  10 |      **15** |     ≥ 15 |
| Filas visibles 1024×768                 |                  10 |      **13** |        — |
| Filas visibles 375×667                  |                   6 |       **7** |        — |
| Ancho del nombre 1024                   |    ~150 px, cortado |  **597 px** |    ≥ 280 |
| Ancho del nombre 1366                   | cortado a una línea |  **507 px** |    ≥ 280 |
| Alto de fila (puntero fino)             |               44 px |   **40 px** |      ~40 |

CLS y navegación: `scripts/medir-navegacion.ts`
(`docs/metrics/phase2_1-navegacion-{despues,v3-despues}.json`).
Densidad: `scripts/densidad-venta-v3.mts`. El ancho del nombre "antes" es el
de la auditoría (§1 de la propuesta): la columna era fija y el nombre se
cortaba con puntos suspensivos, así que el número medido no dice cuánto
NECESITABA sino cuánto le tocaba.

### Capturas

`docs/ux-v3-venta-evidence/antes` (43) y `.../despues` (51), en 375, 390, 430,
768, 1024, 1366, 1440 y 1920, para: lista inicial, búsqueda, categoría, fila
elegida, ticket, ticket largo, producto por peso, agotado, revisar, checkout,
modo lector, modo nombre y ticket en el teléfono.

---

## 6. Lo que queda para después

- Favoritos desde el teléfono (hoy sólo desde 1280 px, con el mouse).
- Recientes, consulta de precio, suspender y recuperar un ticket.
- Reimprimir desde /venta (hoy vive en `/comprobantes/[id]`).
- Virtualización de la lista: hoy no hace falta —se cargan de a 60 y una
  sesión normal no pasa de un par de cientos de filas—, pero si aparece un
  catálogo de miles hay que medirlo antes de agregar dependencias.
