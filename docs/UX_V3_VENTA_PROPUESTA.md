# PROPUESTA UX /venta V3

> Estado: **propuesta, sin implementar**. Rama de partida `feat/ux-v2-phase2-1-lista-navegacion` @ `feb0a11`.
> Ningún componente, CSS ni regla de negocio fue modificado para escribir esto. Todo lo que dice «medido» sale de
> `docs/metrics/venta-v3-antes.json` (5 muestras, mediana, build de producción en `:3099`, 1366×768) y de las
> capturas en `docs/ux-v3-venta-evidence/antes/` (8 anchos, 10 casos).

---

## 0. Prefase — entorno local recuperado

|                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next**                                   | OK. `next dev --turbopack` en `localhost:3000` (por IPv6 `::1`).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **PostgreSQL · estado anterior**           | Apagado. `pg_ctl status`: _no server running_; nada escuchando en 5433.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **PostgreSQL · causa**                     | La instancia es la **opción B** de `docs/DEV_ENVIRONMENT.md` (`~/.kiosco-dev-pgdata`, `pg_ctl`, no es servicio). Hoy 10:49 un proceso hijo (autovacuum) murió con `0xC0000142` (fallo de inicialización de DLL), el postmaster reinició, el proceso de arranque murió igual y se apagó solo (`server.log` líneas 5385–5392). Mismo patrón que el 15/08 (dos veces). Docker está instalado pero su demonio apagado: no es el mecanismo en uso. El PostgreSQL de Windows en 5432 es otra instancia, ajena. |
| **PostgreSQL · estado final**              | Arriba, `127.0.0.1:5433`, PID 13496, lanzada con `Start-Process` (detached) como recomienda la doc; recuperación automática completa («redo done», «ready to accept connections»). Datos intactos.                                                                                                                                                                                                                                                                                                       |
| **Host / Port / DB / Usuario**             | `127.0.0.1` / `5433` / `kiosco_dev` / `kiosco_dev` · password present: YES (no impresa). También existen `kiosco_test` y `kiosco_rollback`.                                                                                                                                                                                                                                                                                                                                                              |
| **Prisma**                                 | OK. `npx prisma migrate status`: _43 migrations found · Database schema is up to date!_ (la tabla tiene 45 filas: dos migraciones figuran dos veces, aplicadas y consistentes). Sin migraciones pendientes; no se aplicó ni se reseteó nada.                                                                                                                                                                                                                                                             |
| **Login**                                  | OK. `POST /api/auth/login` (cajero) → 200 `{"success":true}`, cookie emitida, `/venta` → 200 con el campo del lector, `/api/products` → 200. El dev server se recuperó solo (Prisma reconecta por consulta): no hizo falta reiniciarlo.                                                                                                                                                                                                                                                                  |
| **/venta accesible**                       | YES (navegado en el navegador integrado y en el build de producción).                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Turbopack warning · causa**              | `next.config.ts` no define `webpack`. Lo agrega `withSerwistInit` de `@serwist/next` (`dist/index.mjs:121`) siempre, aunque `disable` sea `true`. Next avisa cuando hay `webpack` y no hay clave `turbopack` (`next/dist/lib/turbopack-warning.js:117-118`).                                                                                                                                                                                                                                             |
| **Turbopack warning · impacto**            | Ninguno funcional: en `next dev --turbopack` esa función nunca se ejecuta y el service worker está desactivado en desarrollo a propósito; en `next build` (webpack) sí corre y arma `public/sw.js` (`pwa:check` verde en 2.1). El aviso de Serwist ya está evitado por `disable: NODE_ENV === 'development'`.                                                                                                                                                                                            |
| **Turbopack warning · acción recomendada** | Opcional, en Fase A: `turbopack: {}` en `nextConfig` (es lo que documenta Next para «webpack config no necesaria en Turbopack»). Una línea, sin efecto sobre `.next-dev`/`.next`. No se tocó ahora.                                                                                                                                                                                                                                                                                                      |
| **Hallazgo colateral**                     | Otro proyecto (`Dario/.../administrador-pedidos`, `next dev -H 0.0.0.0`, PID 29396 desde 15:38) tiene `0.0.0.0:3000`; Kiosco quedó en `[::]:3000`. `127.0.0.1:3000` contesta «Administrador de pedidos» y `localhost:3000` contesta Kiosco. Un navegador que prefiera IPv4 ve el proyecto equivocado. No lo maté: es tuyo.                                                                                                                                                                               |
| **Producción tocada**                      | NO.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Datos borrados**                         | NO. (El baseline registró 5 ventas de prueba de «Sal fina 500 g» × 1 con `cajero` en `kiosco_dev`; es la base de demo.)                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 1. DIAGNÓSTICO ACTUAL

### Qué funciona (y no se rehace)

- **El lector es instantáneo.** Scan → línea en el ticket: **32,6 ms** (API `/api/products/barcode` 18,4 ms). El campo `data-barcode-input` recibe la ráfaga y el escucha global (`useBarcodeScanner`) toma las que caen fuera del campo, con detección por ritmo (≤ 45 ms/carácter) y silencio con cualquier capa abierta. Fue un bug real y está probado (`tests/ui/escaner.test.tsx`).
- **La gramática es pura y probada** (`teclado.ts`, 193 líneas de test): ↓ entra a la lista, Enter agrega, Escape vuelve, Supr con selección que nunca cae al `body`.
- **El ticket** muestra controles sólo en la línea elegida, el total y «Cobrar» viven fuera del scroll; en el teléfono hay barra fija y hoja.
- **El cobro** ya resuelve efectivo con «Paga con» + vuelto, J, letras para el medio, pago dividido, fiado con cliente y crédito, doble clic protegido.
- **Peso**: diálogo inmediato para KG/L, Enter confirma. **Alta rápida** y **código sin resolver** con acciones explícitas y sin botones muertos.
- El ticket sobrevive a F5 con precios frescos; sesión, armazón y límites de carga (fase 2.1) no se tocan.
- Base de accesibilidad: `focus-visible` global, 44 px, `aria-live`, axe verde sobre `/venta` y sobre el cobro.

### Qué no funciona

| #   | Problema                                                                                                                                                                    | Evidencia                                                 | Causa                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Nombres cortados** en 1024–1279: «Aceite de girasol 9…», «Agua mineral sin g…», «Artesanal sin etiqu…».                                                                   | `antes/lista-inicial-1024.png`                            | La fila mide 482 px; stock y precio son columnas de ancho fijo (7,5 + 9 rem = 264 px) y el ticket se lleva 440 px. Al nombre le quedan ~150 px.                                                                                                                                          |
| 2   | **Sólo 10 filas visibles en 1366×768** (y en 1024).                                                                                                                         | medido: lista desde y=252, alto 500, fila 44              | 196 px consumidos entre cabecera, campo de 56, línea de estado, **chips en dos renglones (80 px)** y cabecera de tabla.                                                                                                                                                                  |
| 3   | **La sección cambia sola a «Frecuentes»** en cuanto hay frecuentes: después de los primeros agregados, la lista de 57 pasa a 3 filas y el resto de la pantalla queda vacío. | `antes/ticket-con-productos-1366.png`, `-375.png`         | `page.tsx:227-229`: `if (hayFrecuentes && !seccionElegidaAMano) setSeccion('frecuentes')`.                                                                                                                                                                                               |
| 4   | **Enter, Enter registra una venta.**                                                                                                                                        | código                                                    | Campo vacío + líneas → `'cobrar'` (`teclado.ts:74`); en el cobro, «Paga con» vacío cubre el total (`DialogoCobro.tsx:162-180`) y `puedeCobrar` es verdadero; la única guarda son 300 ms (`:363`). El placeholder muestra el total en gris, y parece cargado (`antes/checkout-1366.png`). |
| 5   | **Cambiar de categoría tarda 315 ms** con una API de 35.                                                                                                                    | medido                                                    | `useProducts.ts:206`: el debounce de 250 ms pensado para el tipeo se aplica a **cualquier** cambio (filtros, página).                                                                                                                                                                    |
| 6   | **Buscar tarda 312 ms** desde la última tecla (API 35).                                                                                                                     | medido                                                    | Los mismos 250 ms de debounce, más render.                                                                                                                                                                                                                                               |
| 7   | **Salir del cobro tarda 323 ms hasta poder escanear**; terminar la venta, **329 ms**.                                                                                       | medido                                                    | Transición de salida del diálogo (150 ms) + Headless UI devuelve el foco al terminar + `devolverFocoA` reintenta en [0,120,260,420] ms: el foco llega en el intento de 260.                                                                                                              |
| 8   | **Abrir el cobro queda estable a los 281 ms** (el panel está a los 26).                                                                                                     | medido                                                    | Transición de entrada 150 ms + cuadros. Enter no cobra hasta los 300 ms.                                                                                                                                                                                                                 |
| 9   | **CLS 0,6 al entrar a `/venta`.**                                                                                                                                           | fase 2.1, `docs/metrics/phase2_1-navegacion-despues.json` | `AppShell.tsx:89` `contraida = preferencia ?? pathname === '/venta'` + `Sidebar.tsx:34` `transition-[width]`: la barra pasa de 236 a 68 px en ~9 cuadros y toda la columna principal se reacomoda.                                                                                       |
| 10  | **Tope de 60 filas con leyenda** «Se muestran 60 de N. Buscá por nombre».                                                                                                   | `ProductBrowser.tsx:271-276`                              | No hay paginación ni carga incremental. Con 61+ productos no hay forma de ver el resto sin buscar.                                                                                                                                                                                       |
| 11  | **La lista se lee como tabla administrativa**: cabecera de columnas, «Categoría» repetida en cada fila («Almacen» × 40), precio a 500 px del nombre.                        | `antes/lista-inicial-1366.png`                            | Diseño 2.1: cuatro columnas fijas.                                                                                                                                                                                                                                                       |
| 12  | **La estrella de favorito ocupa 44 px en todas las filas** del teléfono y reserva `pr-13` en todas.                                                                         | `antes/lista-inicial-375.png`                             | `[@media(hover:none)]:opacity-100`.                                                                                                                                                                                                                                                      |
| 13  | **Nadie sabe si «si escaneo ahora, entra».** No hay señal de modo; la pista de teclas es de 12 px y sólo desde `lg`.                                                        | capturas                                                  | Campo único sin estado visible.                                                                                                                                                                                                                                                          |
| 14  | **Teléfono 375×667: 6 filas.** 216 px arriba de la lista, 65 de barra abajo; el precio va abajo a la izquierda bajo el nombre.                                              | `antes/lista-inicial-375.png`                             | Campo de 56, chips de 48, estado, separaciones.                                                                                                                                                                                                                                          |
| 15  | **«Cobrar» deshabilitado parece habilitado** (verde con opacidad) con el ticket vacío.                                                                                      | `antes/lista-inicial-375.png`, `-1366.png`                | `variant="confirm" disabled`.                                                                                                                                                                                                                                                            |
| 16  | **«Vaciar» no tiene vuelta atrás**: un clic vacía un ticket de 12 líneas.                                                                                                   | `Ticket.tsx:254`, `page.tsx:776`                          | Sin confirmación ni deshacer.                                                                                                                                                                                                                                                            |

### Qué confunde

- El «Frecuentes» que aparece solo y cambia lo que se estaba mirando (3).
- Enter con tres significados según lo escrito, y la pista dice «Enter cobrar» mientras se está buscando.
- ← → «no hacen nada» si no hay una línea elegida en el ticket; hay que saber que primero va ↓ con el campo vacío.
- En el teléfono el campo abre el teclado alfabético y la cámara está detrás de un ícono sin nombre.
- El modelo de flechas es doble: ↑↓ eligen líneas del ticket con el campo vacío, pero resultados con texto, y filas si el ticket está vacío.

### Qué es lento (medido, mediana de 5)

| Medición                                  |       Antes (ms) | Comentario                                       |
| ----------------------------------------- | ---------------: | ------------------------------------------------ |
| TTFB `/venta`                             |             46,4 |                                                  |
| F5 → primeras filas pintadas              |            184,7 | primera muestra 871 (arranque frío del servidor) |
| Clic en categoría → filas nuevas          |        **314,7** | API 35; el resto es debounce                     |
| «le» → resultados (desde la última tecla) |        **311,6** | API 35; debounce 250                             |
| Scan → línea en ticket                    |             32,6 | API 18,4                                         |
| ↓ → fila enfocada                         |             13,0 |                                                  |
| Enter → línea agregada                    |             11,7 |                                                  |
| Enter → cobro en el DOM / estable         | 26,5 / **281,5** | transición 150 ms                                |
| Escape en cobro → foco en el campo        |        **322,8** | transición + foco por reintentos                 |
| Enter → «Venta registrada»                |             96,2 | API `POST /api/sales` 51,8                       |
| Enter → listo para el próximo scan        |        **328,7** | transición + foco por reintentos                 |
| CLS `/` → `/venta`                        |          **0,6** | fase 2.1                                         |

### Qué sobra

Cabecera de columnas; columna «Categoría» por fila; estrella permanente; leyenda «Se muestran 60 de N»; el botón de cámara sin nombre en escritorio; la línea de estado de 12 px como único feedback; la transición de 150 ms en los diálogos de la caja.

### Densidad medida (estado actual)

| Viewport  | Filas visibles | Alto de fila | Lista: y inicial / alto | Ticket | Barra lateral |  Chips |
| --------- | -------------: | -----------: | ----------------------- | -----: | ------------: | -----: |
| 375×667   |              6 |           56 | 216 / 386               |   hoja |             — |     48 |
| 390×844   |              9 |           56 | 216 / 563               |   hoja |             — |     48 |
| 430×932   |             11 |           56 | 216 / 651               |   hoja |             — |     48 |
| 768×1024  |             15 |           44 | 220 / 739               |   hoja |             — |     48 |
| 1024×768  |             10 |           44 | 252 / 500               |    440 |            68 | **80** |
| 1366×768  |             10 |           44 | 252 / 500               |    440 |            68 | **80** |
| 1440×900  |             14 |           44 | 212 / 672               |    440 |            68 |     40 |
| 1920×1080 |             18 |           44 | 212 / 852               |    440 |            68 |     40 |

---

## 2. OBJETIVO

Que una persona que nunca usó el sistema pueda, en su primer turno y sin que nadie le explique: entrar, escanear o buscar, agregar muchos productos seguidos, ver qué está cobrando, corregir una cantidad, sacar una línea, agregar lo que faltaba, cobrar y quedar lista para la siguiente venta. En PC, **sin tocar el mouse**; en el teléfono, **con el pulgar**. Y que el que ya sabe usarla no pierda ni una tecla respecto de hoy, salvo la que evita cobrar por accidente.

Metas medibles (§15): ≥ 15 filas en 1366×768 (hoy 10), nombre entero desde 1024, categoría y búsqueda < 100 y < 180 ms, volver del cobro y terminar venta < 60 ms hasta el próximo scan, CLS 0 al entrar, cero ventas registradas con un Enter sin importe.

---

## 3. PERSONA PRINCIPAL

**Lucía, 46, cajera de un almacén de barrio.** Usa WhatsApp y poco más. Turno de 8 horas, picos de 20 clientes por hora, atiende y cobra a la vez, con el cliente enfrente y a veces con la mano ocupada. PC con lector USB; el mouse está lejos y la pantalla es una 1366×768 vieja. Su miedo no es el sistema: es cobrar mal o de más delante del cliente. Lo que necesita: que cada tecla haga una sola cosa obvia, que la pantalla le diga qué va a pasar antes de que pase, y que equivocarse se arregle en un segundo.

Secundarias: **el repositor con el celular** (busca por nombre para consultar precio y a veces vende), **la dueña con la tablet** (revisa el ticket antes de cobrar, usa pago dividido y fiado).

---

## 4. DESKTOP — LAYOUT PROPUESTO

1366×768, barra lateral en riel (68), lista 870, ticket 396 (`clamp(360px, 29vw, 440px)`).

```
┌──68──┬──────────────────────────────── 870 ─────────────────────────────┬──── 396 ────┐
│  A   │ Venta                        Caja $ 183.430 · Almacén Centro · LB │             │
│      ├───────────────────────────────────────────────────────────────────┼─────────────┤
│  ⌂   │ [ ● Lector │ Nombre ]  [▮▮  Escaneá un código…               ]  ? │ Ticket · 3 artículos    Vaciar │
│  🛒  │ ✓ Arroz largo fino 1 kg · agregado                                │ Aceite de girasol 900 ml  $ 3.290 │
│  💰  │ Frecuentes   Todos   Almacén   Bebidas   Congelados   Fiambrería › │   1 u. × $ 3.290                  │
│  ▤   ├───────────────────────────────────────────────────────────────────┤ Agua mineral sin gas 2 L  $ 1.490 │
│  ○   │ Aceite de girasol 900 ml                          13 u.   $ 3.290 │   1 u. × $ 1.490                  │
│      │ Agua mineral sin gas 2 L                          44 u.   $ 1.490 │▌Arroz largo fino 1 kg     $ 1.780 │
│  ⬡   │ Alfajor de prueba                              Quedan 1   $ 1.500 │   1 u. × $ 1.780                  │
│  ▣   │▌Arroz largo fino 1 kg                             31 u.   $ 1.780 │   [ − ]  1  [ + ]        Quitar   │
│      │ Queso cremoso                    Se pesa · $/kg   4,2 kg  $ 9.000 │                                   │
│      │ Yerba Playadito 1 kg                            Agotado   $ 4.200 │                                   │
│  ☼   │ Yogur bebible 900 g                               12 u.   $ 2.890 │                                   │
│      │ …  (15 filas de 40 px)                                            │ Última venta #1287 · $ 6.560      │
│      │                                                                   ├───────────────────────────────────┤
│      │                                                                   │ Total                   $ 6.560   │
│  ›   │                                                                   │ [        Cobrar $ 6.560  ⏎      ] │
└──────┴───────────────────────────────────────────────────────────────────┴───────────────────────────────────┘
```

Decisiones:

- **Una fila del alto de la caja (48 px)** reúne el selector de modo, el campo y la ayuda. Debajo, la línea de estado (16 px, con ✓/✕ y texto legible de 13 px) y **una sola fila de chips** (36 px) con scroll horizontal si no entran: nunca dos renglones. La lista arranca en **y ≈ 156** (hoy 252): en 768 de alto entran **15 filas de 40 px** (hoy 10).
- **Sin cabecera de tabla, sin columna de categoría.** La fila es nombre · estado · precio. La categoría aparece sólo cuando aporta: en «Todos»/«Frecuentes» y desde 1536 px, como texto tenue después del nombre.
- **El ticket cede ancho**: 396 px en 1366, 360 en 1024, 440 desde 1520. Con eso la lista mide 564 px en 1024 (hoy 482) y el nombre nunca baja de 280 px.
- **La barra lateral no cambia con la ruta** (§ Sidebar en §19 y §15): riel por defecto debajo de 1536, expandida arriba, y la preferencia guardada manda. CLS 0.
- **«Cobrar» dice cuánto** y muestra `⏎` sólo cuando Enter efectivamente cobra (ticket con foco). Deshabilitado = estilo secundario, no verde apagado.
- **Última venta** en una línea tenue del ticket vacío: número, total, vuelto. Responde «¿cuánto era?» sin ir a `/ventas`.

En 1920: la lista puede crecer hasta 1212 px; se acota el bloque de texto (nombre máx. 60 caracteres en un renglón, luego dos) y aparece la categoría tenue. En 1024: riel + lista 564 + ticket 360; chips con scroll; fila de 40.

---

## 5. MOBILE — LAYOUT PROPUESTO

375×667, `hasTouch`. Una columna, lista de una columna, ticket como hoja.

```
┌────────────────────────────────────┐
│ ≡   Venta                     LB   │  56  cabecera de la aplicación
│ [   ● Lector    │    Nombre     ]  │  36  selector de modo, ancho completo
│ [▮▮  Escaneá un código…    ] [📷]  │  48  campo + cámara (Lector) / [🔍 Buscar producto por nombre…] (Nombre)
│ Frecuentes  Todos  Almacén  Bebi › │  36  chips, scroll horizontal, sin envolver
├────────────────────────────────────┤ 184
│ Aceite de girasol 900 ml           │
│ 13 u.                      $ 3.290 │  56
├────────────────────────────────────┤
│ Agua mineral sin gas 2 L           │
│ 44 u.                      $ 1.490 │
├────────────────────────────────────┤
│ Queso cremoso                      │
│ Se pesa · $ 9.000/kg        4,2 kg │
├────────────────────────────────────┤
│ Yerba Playadito 1 kg               │
│ Agotado                    $ 4.200 │  (atenuada, no se toca)
├────────────────────────────────────┤
│ …  7 filas                         │
├────────────────────────────────────┤
│ Ticket · 3 · $ 6.560   [ Cobrar ]  │  64  barra fija; tocar el ticket abre la hoja
└────────────────────────────────────┘
```

- **Toda la fila es el objetivo** (≥ 56 px). Un toque agrega y muestra un pulso en la barra de abajo («Ticket · 4 · $ 9.850»). Sin estrella en la fila: favoritos desde la hoja del ticket (mantener pulsado o «★» en la línea elegida) — DESPUÉS.
- **Nombre en el primer renglón, ancho completo, hasta dos líneas** antes de truncar. Segundo renglón: estado/stock a la izquierda (tenue; en color sólo «Quedan N», «Agotado», «Vencido»), precio a la derecha, alineado a la derecha. El ojo baja por los nombres y los precios quedan en una columna.
- **Modo Lector en el teléfono** = cámara primero: el botón de cámara tiene nombre («Cámara») y es primario; el campo acepta un código tipeado (`inputMode="numeric"`). **Modo Nombre** = el campo abre el teclado alfabético y tiene el foco.
- **Hoja del ticket** (existe, `Drawer side="bottom"`, 70 dvh): líneas con nombre y subtotal, la elegida con stepper y «Quitar», total y «Cobrar $ 6.560». Se cierra con ×, con un deslizamiento o tocando afuera; el foco vuelve al campo. Es el paso «revisar» del teléfono.
- **Cobro** a pantalla completa (existe). «Venta registrada» con vuelto grande y «Nueva venta».
- 390 y 430: lo mismo con 8–9 y 10–11 filas. La lista se mide después de implementar, no se estima.

---

## 6. MODO LECTOR

Un solo campo en el DOM (`ScannerInput`, `data-barcode-input`): **no** se vuelve a los dos campos que la auditoría descartó (H-07, H-18). El modo cambia lo que el campo **dice y prioriza**, dónde vuelve el foco y qué teclado abre el teléfono. El lector funciona en los dos modos: una ráfaga con Enter es inequívoca.

|                        | **● Lector**                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selector               | Control segmentado `[ ● Lector │ Nombre ]`, `role="radiogroup"`, dos opciones, 36–40 px, a la izquierda del campo (escritorio) o encima (teléfono). El punto verde está sólo en la opción activa; **pulsa** 300 ms con cada código leído: «entró». |
| Campo                  | Ícono de código de barras; placeholder «Escaneá un código…»; `inputMode="numeric"` en pantallas táctiles.                                                                                                                                          |
| Lista                  | Visible siempre: Frecuentes/Todos/categoría. Se recorre con ↓ y con el dedo.                                                                                                                                                                       |
| Letras tipeadas        | Buscan igual (nadie tiene que cambiar de modo para tipear «coca»); la línea de estado dice «Buscando por nombre · Esc vuelve al lector».                                                                                                           |
| Después de cada acción | El foco vuelve al campo, vacío (§11). Scan → scan → scan sin tocar nada, con o sin diálogos de por medio.                                                                                                                                          |
| Cámara                 | En pantallas táctiles, botón primario con nombre.                                                                                                                                                                                                  |
| Persistencia           | `localStorage` `kiosco:venta:modo` = `'lector' \| 'nombre'`, por dispositivo. Sin migración.                                                                                                                                                       |
| Detección automática   | La primera **ráfaga** válida en este equipo (`useBarcodeScanner` ya la reconoce: ≥ 4 caracteres a ≤ 45 ms) pone el modo en Lector y lo guarda. Una PC con lector nunca hay que configurarla.                                                       |
| Sin preferencia        | `(pointer: coarse)` → Nombre; si no → Lector.                                                                                                                                                                                                      |

Qué **no** cambia: la detección de ráfaga, el silencio con capas abiertas, `data-barcode-input`, la consulta por código exacto.

---

## 7. MODO BÚSQUEDA POR NOMBRE

|                    | **Nombre**                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campo              | Ícono de lupa; placeholder «Buscar producto por nombre…»; `inputMode="text"`; **tiene el foco**.                                                                                                                                                                                                                    |
| Al escribir        | La misma lista pasa a resultados en **una columna**; el primero queda resaltado (existe). Debounce **120 ms** (hoy 250) sólo para el tipeo; abort de la consulta anterior (existe); reuso del resultado anterior cuando el nuevo término lo extiende («coc» → «coca» filtra en memoria mientras llega el servidor). |
| ↓ ↑                | Mueven el resaltado **sin sacar el foco del campo** (se sigue escribiendo).                                                                                                                                                                                                                                         |
| →                  | Agrega **una** unidad del resaltado y **no** limpia la búsqueda: `coca → →` son dos Coca.                                                                                                                                                                                                                           |
| ←                  | Resta una del resaltado si ya está en el ticket; si no, dice «Coca Cola 2,25 L no está en el ticket» en la línea de estado.                                                                                                                                                                                         |
| Enter              | Agrega el resaltado, **limpia el campo** y deja el cursor ahí: `coca ↓ Enter · yerba ↓ Enter · leche Enter`.                                                                                                                                                                                                        |
| Escape             | Limpia el texto (primer Escape); vuelve al modo Lector si el modo guardado es Lector y se entró a buscar tipeando (segundo Escape).                                                                                                                                                                                 |
| Ráfaga del lector  | Dígitos + Enter en el campo = código (regla de `modoDelCampo`, existe): escanear funciona igual en este modo.                                                                                                                                                                                                       |
| Después de agregar | El foco queda en el campo, texto vacío, resaltado en la primera fila de la lista base.                                                                                                                                                                                                                              |

La regla que une los dos modos, en una frase para la ayuda: **«→ suma y te deja seguir; Enter agrega y limpia; Escape vuelve».**

---

## 8. PRODUCT LIST

**Una sola columna de productos.** Un producto por fila, sin tarjetas, sin mosaico, sin cabecera de tabla. La fila tiene tres celdas: **nombre · estado · precio**.

### Fila (escritorio, 40 px con puntero fino; 48 px táctil; teléfono 56 px en dos renglones)

```
▌ Aceite de girasol 900 ml                                  13 u.    $ 3.290
  Queso cremoso                             Se pesa · $/kg  4,2 kg   $ 9.000
  Alfajor de prueba                                      Quedan 1    $ 1.500
  Yerba Playadito 1 kg                                    Agotado    $ 4.200   (opacidad 55 %, disabled)
  Leche entera 1 L                                        Vencido    $ 1.690   (idem)
```

- **Nombre**: `minmax(0, 1fr)`, 15 px medium, un renglón; si no entra, **dos renglones** (`line-clamp-2`) antes de truncar; `title` con el nombre completo. Nunca «Aceite de girasol 900 / ml»: el ancho mínimo del nombre es 280 px y el corte, si lo hay, cae en un espacio.
- **Estado**: `auto`, 13 px, tenue. Texto, no badge: «13 u.» · «4,2 kg» · «Quedan 2» (warning) · «Agotado» (danger) · «Vencido» (danger) · «Se pesa · $/kg» (tenue). En el teléfono el stock normal no se muestra; sí lo que cambia una decisión (existe).
- **Precio**: `6.5rem`, 15 px semibold tabular, alineado a la derecha; no domina al nombre (mismo cuerpo, más peso).
- **Categoría**: sólo desde 1536 y sólo en Todos/Frecuentes, tenue, después del nombre.
- **Selección** (resaltado o foco): barra de 3 px `primary` a la izquierda + fondo `selection` + `aria-current` + anillo `focus-visible`. Cuatro señales, ninguna es sólo color (existe; se conserva).
- **Estrella**: en escritorio aparece al pasar o enfocar (existe); en táctil **no** va en la fila (§5).

### Densidad objetivo

| Viewport  | Filas hoy | Filas objetivo |
| --------- | --------: | -------------: |
| 375×667   |         6 |              7 |
| 768×1024  |        15 |             19 |
| 1024×768  |        10 |             15 |
| 1366×768  |        10 |             15 |
| 1440×900  |        14 |             18 |
| 1920×1080 |        18 |             23 |

Se mide después con el mismo script (`scripts/densidad-venta-v3.mts`), no se estima.

### Carga y paginación («tengo todos mis productos acá»)

- **Páginas de 60 acumuladas**: la primera página llega como hoy; al llegar al final (centinela con `IntersectionObserver`, o `End` en la lista) se pide la siguiente y se **agrega** (no reemplaza). El índice de teclado es global: ↓ sigue en la página nueva. Última fila: «Cargando 60 más…» (`aria-busy`).
- **Sin virtualizar por ahora, con `content-visibility: auto`** en cada fila (`contain-intrinsic-size` 40/56 px): el navegador no dibuja lo que no se ve. El DOM crece sólo con lo que se desplazó (60 por página); nadie recorre 10.000 filas, busca. Umbral documentado: si una sesión carga **> 600 filas** (10 páginas) se activa ventana de render (sólo se montan las filas visibles ± 20). Se prueba con un catálogo sintético de 5.000 en `kiosco_test` (Fase B).
- **Categoría y búsqueda** son consultas al servidor como hoy (`/api/products?q=&categoryId=&page=`), sin cambios en la API. Caché en memoria de las últimas 20 respuestas por clave para que «volver a Todos» sea inmediato.
- **Frecuentes**: chip como hoy, **sin cambio automático** durante la sesión. Al entrar: «Frecuentes» si este equipo tiene ≥ 6, si no «Todos». Después de una venta la lista **se queda** donde estaba (se refresca en silencio).

---

## 9. TICKET

```
Ticket · 3 artículos                                      Vaciar
─────────────────────────────────────────────────────────────────
Aceite de girasol 900 ml                                  $ 3.290
1 u. × $ 3.290
Agua mineral sin gas 2 L                                  $ 1.490
1 u. × $ 1.490
▌Arroz largo fino 1 kg                                    $ 1.780
 1 u. × $ 1.780
 [ − ]   1   [ + ]                                  Quitar  Supr
─────────────────────────────────────────────────────────────────
Última venta #1287 · $ 6.560 · vuelto $ 440                (tenue)
─────────────────────────────────────────────────────────────────
Total                                                     $ 6.560
[                 Cobrar $ 6.560                 ⏎                ]
```

- Estructura actual (nombre + subtotal, «cantidad × precio», controles sólo en la elegida) se conserva. Nombre hasta dos renglones.
- **Estado «revisar»**: cuando el foco entra al ticket (Enter desde el campo vacío, o Tab) el panel muestra un anillo de foco y la cabecera cambia a «Revisá el ticket · ↑↓ elegir · ←→ cantidad · Supr quitar · **Enter cobra** · Esc vuelve». Es el «Subtotal» de una caja de supermercado: el momento de mirar antes de cobrar.
- **Escribir un número** con una línea elegida abre la cantidad con ese dígito (tipo-para-editar); en una línea que se pesa abre el peso. Sin F-keys.
- **Deshacer**: «Quitar» y «Vaciar» muestran un aviso de 8 s con «Deshacer» (vuelve a agregar por el mismo camino, con el stock recontrolado). Sin confirmaciones que frenen.
- **Ancho**: `clamp(360px, 29vw, 440px)` desde `lg`. Hoja en el teléfono y en 768.
- **Última venta**: número, total y vuelto de la última venta de esta pestaña, tenue, sólo con el ticket vacío. Sin API nueva (es la respuesta del `POST`).

---

## 10. KEYBOARD MODEL

Principio: **cada tecla hace una sola cosa por contexto, y el contexto se ve** (dónde está el foco: campo, lista, ticket, diálogo). Ninguna acción irreversible sale de una tecla sola.

### Tabla

| Tecla                        | Campo (vacío)                                                                                        | Campo (con texto)                                              | Lista (fila enfocada)                                                              | Ticket (revisar)                                   | Cobro                                       | Peso / Alta              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- | ------------------------ |
| **↓ / ↑**                    | Entra a la lista (↓); ↑ nada                                                                         | Mueve el resaltado sin salir del campo                         | Fila siguiente / anterior (sin dar la vuelta)                                      | Línea siguiente / anterior                         | Medio de pago (radiogroup)                  | —                        |
| **→ / +**                    | +1 a la **línea marcada** del ticket (la última agregada)                                            | +1 al resultado resaltado, sin limpiar                         | +1 a la fila, se queda                                                             | +1 a la línea                                      | —                                           | —                        |
| **← / −**                    | −1 a la línea marcada (a 0 la quita, con «Deshacer»)                                                 | −1 al resaltado si está en el ticket                           | −1 a la fila, se queda                                                             | −1 a la línea (a 0 la quita, con «Deshacer»)       | —                                           | —                        |
| **Enter**                    | **Revisar**: foco al ticket (si hay líneas)                                                          | Dígitos: busca el código. Letras: agrega el resaltado y limpia | Agrega y **vuelve al campo**                                                       | **Cobrar**: abre el cobro                          | Cobra **sólo con pago declarado** (§ abajo) | Confirma                 |
| **Escape**                   | Cierra el aviso; si no hay, nada                                                                     | Limpia el texto                                                | Vuelve al campo sin agregar                                                        | Vuelve al campo (ticket intacto)                   | Vuelve al campo (ticket intacto)            | Cancela, vuelve al campo |
| **Supr**                     | Quita la línea marcada (con «Deshacer»)                                                              | —                                                              | —                                                                                  | Quita la elegida; la selección pasa a la siguiente | —                                           | —                        |
| **Inicio / Fin**             | —                                                                                                    | Primer / último resultado                                      | Primera / última fila (Fin carga la página siguiente)                              | Primera / última línea                             | —                                           | —                        |
| **0–9 · letras**             | Escribe                                                                                              | Escribe                                                        | **Salta al campo** con esa tecla puesta (buscar o tipear un código desde la lista) | Dígito: edita la cantidad de la elegida            | E D R T F O medio · J justo · importes      | —                        |
| **Tab**                      | Chips → lista → ticket → Cobrar                                                                      | idem                                                           | Ticket                                                                             | Cobrar                                             | Campos del cobro                            | —                        |
| **F12 · Alt+N · Ctrl+K · /** | Alias: cobrar directo · producto nuevo · ir al campo (existen; no se muestran como camino principal) |                                                                |                                                                                    |                                                    |                                             |                          |

### Por qué así, y cómo se evitan los accidentes

- **Enter nunca registra una venta desde la lista ni desde el campo.** Del campo vacío lleva al ticket (revisar); del ticket abre el cobro; en el cobro cobra **sólo si el pago está declarado**: efectivo con «Paga con» cargado (tipeado, chip o J) o un medio no efectivo elegido a propósito (tecla o clic). Con «Paga con» vacío, Enter no cobra y la línea de estado dice «Escribí con cuánto paga, o J si paga justo». La guarda de 300 ms se mantiene. Camino completo desde tres scans: `Enter · Enter · 5000 · Enter` — **un Enter más que hoy** (el de revisar) y **uno menos** que puede cobrar sin importe. F12 sigue abriendo el cobro directo para quien lo prefiere.
- **↑↓ significan siempre «moverse por la lista que estoy mirando»**: resultados o catálogo desde el campo, líneas desde el ticket. Se elimina la doble vida actual de ↑↓ (líneas del ticket con el campo vacío, filas si el ticket está vacío).
- **→ y ← son «más / menos» sobre lo marcado** y nunca mueven el cursor del campo: en un buscador nadie edita con flechas, se borra con Backspace. La única pérdida es Inicio/Fin dentro del texto, que se conservan.
- **← a cero quita la línea**, con «Deshacer» 8 s. Es lo más rápido para el mostrador («sacame una… no, sacala») y es reversible; pedir confirmación en cada resta es lo que hace que nadie use el teclado.
- **Escape es siempre «un paso atrás y nunca pierde nada»**: texto → nada; lista/ticket/cobro/peso/alta → campo, con el ticket como estaba.
- **Supr sólo actúa sobre una selección visible** (barra + fondo + `aria-current`) y la selección nunca queda en la nada mientras haya líneas (existe, `seleccionTrasQuitar`).
- **Enter dentro de un botón hace lo del botón** (Volver, Justo, un medio): no se intercepta (existe).
- **Ráfaga del lector con el foco en la lista o en el ticket**: la toma el escucha global y agrega; el foco no se mueve; la línea nueva queda marcada. Con el cobro abierto, el lector sigue mudo, salvo en la pantalla «Venta registrada»: ahí un scan **cierra el resultado y empieza la venta siguiente** (es una pantalla de lectura, no de decisión).
- Todo esto entra en `teclado.ts` como acciones nuevas (`'revisar-ticket'`, `'sumar-resaltado'`, `'restar-resaltado'`, `'ir-al-campo-con'`) y se prueba tecla por tecla antes de tocar un componente.

---

## 11. FOCUS MODEL

Regla: **el foco vuelve al campo** después de cualquier acción que no sea recorrer una lista, **de inmediato** (no por reintentos), y **nunca se le saca a quien está escribiendo en otro campo** (H-18, existe). En modo Lector el campo es el lector; en modo Nombre, el buscador: es el mismo elemento.

| Acción                                           | Dónde queda el foco                                                                           | Estado visible                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Entrar a `/venta`                                | Campo (vacío)                                                                                 | Modo guardado o por defecto; lista base; «Frecuentes» o «Todos»                   |
| Scan correcto (unidad)                           | Campo                                                                                         | ✓ «Nombre · agregado» (13 px), punto del lector pulsa, línea marcada en el ticket |
| Scan correcto (se pesa)                          | Campo «Peso» del diálogo, texto seleccionado                                                  | Al confirmar o cancelar: campo                                                    |
| Scan desconocido / inválido / inactivo / sin red | Campo                                                                                         | Bloque «Código no registrado» con acciones (existe). Escape lo cierra             |
| «Crear producto» (alta rápida)                   | Nombre del alta                                                                               | Al crear / ya existía / cancelar: campo; el producto entra por el camino del scan |
| Agregar por nombre (Enter con texto)             | Campo, texto limpio                                                                           | Resaltado en la primera fila de la lista base                                     |
| → / ← con texto                                  | Campo, texto intacto                                                                          | Estado «+1 · Coca Cola 2,25 L · 2 u.»                                             |
| ↓ desde el campo vacío                           | Fila resaltada (o la primera)                                                                 | Anillo + barra                                                                    |
| Agregar desde la lista (→)                       | Misma fila                                                                                    | Estado en la línea y pulso en el ticket                                           |
| Agregar desde la lista (Enter)                   | Campo                                                                                         | idem                                                                              |
| Toque en una fila (táctil)                       | Campo **no** (en táctil no se roba el teclado): se queda en la lista, la barra de abajo pulsa | «Ticket · 4 · $ 9.850»                                                            |
| Sumar / restar con →← desde el campo vacío       | Campo                                                                                         | La línea marcada del ticket cambia y se anuncia (`aria-live`, existe)             |
| Modificar cantidad (dígito en el ticket)         | Campo de cantidad de la línea                                                                 | Enter o Tab: vuelve al ticket (revisar)                                           |
| Quitar (Supr / ← a cero)                         | Donde estaba (ticket → siguiente línea; campo → campo)                                        | Aviso «Quitado · Deshacer»                                                        |
| Enter con el campo vacío                         | **Ticket** (grupo enfocable, línea marcada)                                                   | Cabecera «Revisá el ticket · Enter cobra $ 6.560»                                 |
| Escape en el ticket                              | Campo                                                                                         | Ticket intacto                                                                    |
| Enter en el ticket (abrir cobro)                 | «Paga con» (efectivo) o botón «Cobrar» (otros)                                                | Diálogo estable en < 120 ms                                                       |
| Cancelar cobro (Escape / Volver)                 | Campo, **inmediato**                                                                          | Ticket intacto                                                                    |
| Cobrar (venta hecha)                             | Botón «Nueva venta»                                                                           | Vuelto grande                                                                     |
| Nueva venta (Enter / scan)                       | Campo, vacío, **inmediato**                                                                   | Ticket vacío, «Última venta …», lista donde estaba                                |
| Error del servidor al cobrar                     | Botón «Cobrar» (reintentar)                                                                   | Alerta con el mensaje; nada se cobró                                              |
| Cerrar hoja del ticket (teléfono)                | Campo si el modo es Nombre; nada (lista) si es Lector con táctil                              | —                                                                                 |
| Cerrar cámara                                    | Campo                                                                                         | —                                                                                 |
| Volver de cualquier diálogo                      | Campo                                                                                         | —                                                                                 |
| Sesión vencida                                   | Diálogo «Tu sesión venció» (fase 2.1)                                                         | —                                                                                 |

Implementación: `devolverFocoA` deja de reintentar a ciegas; los diálogos de la caja llaman `campo.focus()` en `onClose` **antes** de la transición de salida y Headless UI no vuelve a mover el foco (`initialFocus`/`onClose` ya lo permiten). Se conserva la única condición: si `document.activeElement` es editable y no es el campo, no se toca.

---

## 12. COLORS

Se usan los tokens que ya existen en `src/app/globals.css` (`@theme`, oscuro por defecto, claro con `data-theme`). Sin paleta nueva; se **nombran los roles** y se corrigen dos:

| Rol pedido       | Token                                                                                                                           | Oscuro                | Uso en `/venta`                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ |
| background       | `--color-bg`                                                                                                                    | `#0c1117`             | fondo de la pantalla                                   |
| surface          | `--color-surface`                                                                                                               | `#131a22`             | lista, ticket, diálogos                                |
| surface-hover    | `--color-raised`                                                                                                                | `#1a232d`             | fila al pasar, chip al pasar                           |
| surface-selected | `--color-selection` → **nuevo valor propio** `#1b2f4b` (hoy alias de `primary-quiet` `#16283f`, indistinguible del chip activo) |                       | fila resaltada, línea del ticket elegida               |
| border           | `--color-line` / `--color-line-strong`                                                                                          | `#26313d` / `#384857` | hairlines entre filas, bordes de campos                |
| primary          | `--color-primary`                                                                                                               | `#4a90ff`             | barra de selección, chip activo, punto del modo Nombre |
| text             | `--color-ink`                                                                                                                   | `#eef4f9`             | nombres, precios (`--color-money` `#fff`)              |
| muted            | `--color-ink-muted` / `--color-ink-faint`                                                                                       | `#9aabbb` / `#7e909f` | stock, «cantidad × precio», categoría                  |
| success          | `--color-success`                                                                                                               | `#3ddc84`             | ✓ agregado, punto «Lector activo», «Cobrar»            |
| warning          | `--color-warning`                                                                                                               | `#ffb020`             | «Quedan 2», «Falta $»                                  |
| danger           | `--color-danger`                                                                                                                | `#ff5c5c`             | «Agotado», «Vencido», ✕ código inválido                |
| focus            | `--color-focus`                                                                                                                 | `#8fbcff`             | anillo de foco (global)                                |

Reglas: el color **comunica estado o interacción y nada más**. Una fila normal no tiene color además del texto; un estado es texto en color **y** una palabra («Agotado»), nunca un punto de color solo. Botón «Cobrar» deshabilitado: `secondary` (gris con borde), no `confirm` apagado. Claro: los mismos roles ya definidos en `:root[data-theme='light']`; se vuelve a pasar axe en claro (la suite ya lo hace).

---

## 13. TYPOGRAPHY

Fuente del sistema (decisión D23, sin webfont). Base 16 px.

| Elemento                     | Tamaño / peso             | Notas                                                                    |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| Nombre de producto (lista)   | **15 px · 500**           | un renglón, dos si hace falta; es el elemento más legible de la pantalla |
| Precio (lista)               | 15 px · 600 · tabular     | `.money`; no más grande que el nombre                                    |
| Stock / estado (lista)       | 13 px · 400 · muted       | color sólo en warning/danger                                             |
| Categoría (lista, ≥ 1536)    | 13 px · 400 · faint       |                                                                          |
| Chip de sección              | 14 px · 500 activo / 400  |                                                                          |
| Campo de escaneo/búsqueda    | 17 px                     | 48 px de alto (56 en táctil)                                             |
| Línea de estado del campo    | 13 px                     | ✓/✕ + texto; hoy 12 px                                                   |
| Ticket · nombre              | 14 px · 500               | dos renglones máx.                                                       |
| Ticket · subtotal            | 14 px · 600 · tabular     |                                                                          |
| Ticket · «cantidad × precio» | 12 px · muted · tabular   |                                                                          |
| Total                        | **28 px · 600 · tabular** | hoy `text-xl`→ `xl`; en el teléfono 24 px en la barra                    |
| «Cobrar $ 6.560»             | 17 px · 600               |                                                                          |
| Cobro · total                | 40 px (hero)              | existe                                                                   |
| Vuelto                       | 40 px · success           | existe                                                                   |

Todos los números en `tabular-nums` (`data-numeric`, existe). Nada por debajo de 12 px.

---

## 14. COMPONENT ARCHITECTURE

`page.tsx` (1.031 líneas) se parte en piezas con una responsabilidad cada una. Nada de esto toca `src/modules`, `src/server` ni Prisma.

```
src/app/venta/page.tsx                 orquestador: compone y conecta (≈ 300 líneas)
src/components/venta/
  useModoDeVenta.ts        NUEVO  modo Lector/Nombre, persistencia, auto-detección por ráfaga
  SelectorDeModo.tsx       NUEVO  control segmentado (radiogroup), punto que pulsa
  CampoDeVenta.tsx         NUEVO  ScannerInput + modo: ícono, placeholder, inputMode, línea de estado
  teclado.ts               EXT.   acciones nuevas; sigue puro y probado
  useTecladoDelPos.ts      NUEVO  ejecuta las acciones de teclado.ts contra el estado (hoy el switch de page.tsx)
  ListaDeProductos.tsx     NUEVO  (reemplaza ProductBrowser) lista, estados vacíos, carga incremental, foco por índice
  FilaDeProducto.tsx       NUEVO  la fila; memo; content-visibility
  Secciones.tsx            NUEVO  los chips (roving tabindex, scroll horizontal) → base de ui/Chips
  Ticket.tsx               EXT.   estado revisar, tipo-para-editar, última venta, Enter = cobrar
  POSLayout.tsx            EXT.   fila de cabecera de 48 px, ticket clamp, barra móvil con pulso
  DialogoCobro.tsx         EXT.   Enter sólo con pago declarado; artículos desplegados; transición corta
  DialogoPeso.tsx          =      sin cambios
  DialogoAltaRapida.tsx    =      sin cambios (vuelve al campo, ya lo hace)
  CodigoSinResolver.tsx    =      sin cambios
  AyudaAtajos.tsx          EXT.   nueva gramática
  foco.ts                  EXT.   devolución inmediata + la única condición
  useFrecuentes.ts         EXT.   sin cambio automático de sección (la decisión sale de page)
src/components/ui/
  Chips.tsx                NUEVO  primitivo extraído de las secciones
  ScannerInput.tsx         EXT.   props de modo (ícono, placeholder, inputMode, indicador)
  Dialog.tsx               EXT.   prop `rapido` (transición 80 ms) para los diálogos de la caja
  Button.tsx               EXT.   `confirm` deshabilitado se ve secundario
src/hooks/
  useProducts.ts           EXT.   debounce sólo al tipeo; páginas acumuladas; caché corta
  useBarcodeScanner.ts     EXT.   `onRafaga` (para el auto-modo); la detección no cambia
src/components/shell/
  AppShell.tsx / Sidebar.tsx  EXT.  sin regla por ruta; default por ancho; sin transición de ancho
src/app/globals.css        EXT.   `--color-selection` propio; `--spacing-ticket` → clamp; alto de fila
```

Estado: el ticket sigue en `zustand` (`store/cart.ts`, sin cambios de reglas); el modo en `useModoDeVenta`; el foco y la selección en el orquestador. Contratos de prueba que **se conservan**: `[data-barcode-input]`, `[data-fila]`+`[data-indice]`, `[data-linea]`, `[data-seccion]`, `[data-medio]`, `[data-money-input]`, región «Ticket en curso», diálogo «Ticket», botón `/^cobrar/i`.

---

## 15. PERFORMANCE PLAN

| Medición                             |      Antes |                              Objetivo | Cómo                                                                              |
| ------------------------------------ | ---------: | ------------------------------------: | --------------------------------------------------------------------------------- |
| F5 → primeras filas                  |      184,7 |                                 ≤ 185 | no empeorar; fila más liviana (sin cabecera ni categoría)                         |
| Clic en categoría → filas            |      314,7 |                             **< 100** | debounce sólo al tipeo (−250) + caché de respuestas                               |
| Búsqueda (última tecla → resultados) |      311,6 |                             **< 180** | debounce 120 + reuso por prefijo (filtro en memoria inmediato, servidor confirma) |
| Scan → ticket                        |       32,6 |                                  ≤ 35 | sin cambios                                                                       |
| ↓ + → producto agregado              |    13 + 12 |                                  ≤ 30 | sin cambios de fondo                                                              |
| Abrir cobro estable                  |      281,5 |                             **< 120** | transición 80 ms en diálogos de la caja; render del cobro memoizado               |
| Cobro → volver (foco listo)          |      322,8 |                              **< 60** | foco inmediato en `onClose`; sin reintentos                                       |
| Venta terminada → listo              |      328,7 |                              **< 60** | idem + limpiar en el mismo tick                                                   |
| CLS al entrar                        |        0,6 |                                 **0** | barra lateral sin regla por ruta, sin `transition-[width]`                        |
| Filas visibles 1366×768              |         10 |                              **≥ 15** | cabecera de 48, chips en un renglón, fila de 40                                   |
| DOM de la lista                      | 57 botones | ≤ 60 por página, `content-visibility` | carga incremental; ventana de render sólo > 600 filas                             |

Método: el mismo script (`scripts/medir-venta-v3.mts`, in-page, 5 muestras, mediana) antes y después, contra el build de producción; `docs/metrics/venta-v3-despues.json`. Más: `nav:metrics` de la fase 2.1 para el CLS, y un caso con 5.000 productos sintéticos en `kiosco_test` para carga incremental y búsqueda.

---

## 16. RESPONSIVE PLAN

| Ancho                 | Barra lateral                  | Lista                                                      | Ticket                                                                      | Selector de modo                 | Chips                            |
| --------------------- | ------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------- | -------------------------------- |
| 375 / 390 / 430       | cajón (≡)                      | 1 col, filas 56, dos renglones                             | barra fija 64 + hoja 70 dvh                                                 | encima del campo, ancho completo | scroll horizontal                |
| 768 (tablet vertical) | cajón                          | 1 col, filas 48, un renglón (estado y precio a la derecha) | barra fija + hoja (no hay ancho para dos columnas cómodas: 768 − 360 = 408) | encima del campo                 | scroll                           |
| 1024                  | riel 68                        | 564 px, filas 40                                           | 360, fijo                                                                   | inline, a la izquierda del campo | scroll                           |
| 1366                  | riel 68 (pref. guardada manda) | 870 px                                                     | 396                                                                         | inline                           | un renglón (scroll si no entran) |
| 1440                  | riel 68                        | 940 px                                                     | 418                                                                         | inline                           | un renglón                       |
| 1920                  | expandida 236                  | 1.212 px; categoría tenue; nombre a 60 caracteres          | 440                                                                         | inline                           | un renglón                       |

Decisión 768: se prueba con la tablet real de la dueña; si el ticket al costado resulta mejor a 768 en horizontal (1024×768 cae en la fila de 1024), se ajusta. Capturas obligatorias después de implementar: los 8 anchos × {lista inicial, búsqueda, categoría, ticket vacío, ticket con productos, ticket largo, producto pesado, agotado, cobro, lector activo, nombre activo, fila seleccionada} con `scripts/capturas-venta-v3.mts` (ya escrito; hoy genera el «antes»).

---

## 17. FEATURES

| Función                   | Decisión                                                                                                      | Por qué                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Frecuentes             | **AHORA** (chip, sin cambio automático)                                                                       | Ya existe; el defecto es el salto de sección                                                                                                                                      |
| 2. Categorías             | **AHORA** (chips en un renglón)                                                                               | Existe                                                                                                                                                                            |
| 3. Recientes              | **DESPUÉS**                                                                                                   | «Frecuentes» ya pondera recencia (`ordenarFrecuentes`); una sección más es ruido                                                                                                  |
| 4. Favoritos              | **AHORA** en escritorio (como está); táctil **DESPUÉS** (desde la hoja del ticket)                            | La estrella en cada fila del teléfono roba 44 px                                                                                                                                  |
| 5. Consulta de precio     | **DESPUÉS**                                                                                                   | La lista ya muestra precio; un modo «consultar sin agregar» necesita UI propia y prueba con la persona                                                                            |
| 6. Suspender ticket       | **DESPUÉS** (localStorage, sin migración)                                                                     | Útil («dejá que busco plata»), pero es un flujo nuevo con sus propios errores                                                                                                     |
| 7. Recuperar ticket       | **DESPUÉS** (va con 6)                                                                                        |                                                                                                                                                                                   |
| 8. Alta rápida            | **AHORA** (como está, discreta)                                                                               | Existe y está probada                                                                                                                                                             |
| 9. Cliente rápido         | **AHORA** (dentro del cobro, como está)                                                                       | Existe                                                                                                                                                                            |
| 10. Última venta          | **AHORA** (línea tenue en el ticket vacío)                                                                    | Cero API, responde una pregunta frecuente                                                                                                                                         |
| 11. Reimprimir            | **DESPUÉS** (enlace «Ver comprobante» a `/comprobantes/[id]` desde «Venta registrada» y desde «Última venta») | La página de comprobante existe; no hay impresora integrada                                                                                                                       |
| 12. Deshacer/anular venta | **NO en /venta**                                                                                              | Anular es una operación de negocio con caja y stock; ya vive en `/ventas` (`/api/sales/[id]/cancel`). En la caja sí hay **Deshacer** para quitar/vaciar líneas (cliente, sin API) |

---

## 18. FILES THAT WOULD CHANGE

**Cambian** (UI y pruebas):
`src/app/venta/page.tsx` · `src/components/venta/{teclado.ts, foco.ts, POSLayout.tsx, Ticket.tsx, DialogoCobro.tsx, AyudaAtajos.tsx, useFrecuentes.ts}` · `src/components/venta/ProductBrowser.tsx` (se reemplaza por `ListaDeProductos.tsx` + `FilaDeProducto.tsx` + `Secciones.tsx`) · `src/components/ui/{ScannerInput.tsx, Dialog.tsx, Button.tsx, index.ts}` · `src/hooks/{useProducts.ts, useBarcodeScanner.ts}` · `src/components/shell/{AppShell.tsx, Sidebar.tsx}` · `src/app/globals.css` · `next.config.ts` (opcional, `turbopack: {}`).

**Nuevos**: `src/components/venta/{useModoDeVenta.ts, SelectorDeModo.tsx, CampoDeVenta.tsx, useTecladoDelPos.ts, ListaDeProductos.tsx, FilaDeProducto.tsx, Secciones.tsx}` · `src/components/ui/Chips.tsx` · `scripts/{medir-venta-v3.mts, capturas-venta-v3.mts, densidad-venta-v3.mts}` (ya escritos, sin commit).

**Pruebas que cambian**: `tests/ui/{teclado-pos, catalogo, ticket, cobro, escaner, scanner-input}.test.*`, `e2e/{teclado, caja-venta, venta, movil, accesibilidad}.spec.ts`. Nuevas: `tests/ui/modo-de-venta.test.tsx`, `e2e/venta-v3.spec.ts` (modos, → ←, revisar, Enter sin importe no cobra, carga incremental, foco tras cada acción).

**No se tocan**: `prisma/**`, `src/modules/**`, `src/server/**`, `src/store/cart.ts` (reglas de cantidad y stock), `src/app/api/**`, sesiones, middleware, ledger, FEFO, pagos, cuentas, compras, costos.

---

## 19. RISKS

| Riesgo                                                                                                    | Mitigación                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cambiar ↑↓ del campo** (hoy eligen líneas del ticket) rompe hábitos de quien ya usa la fase 2.          | La línea recién agregada queda marcada, así que Supr y ←→ desde el campo siguen actuando sobre «lo último» sin ↓; ayuda actualizada; UAT con la persona (`docs/UX_V2_MANUAL_UAT.md`). |
| **Enter sin importe no cobra**: un cajero rápido lo va a sentir como «no anda».                           | Mensaje inmediato en la línea de estado y `aria-live`; J = justo (una tecla); F12 sigue existiendo. Se mide en UAT si aparece la queja.                                               |
| **← / → dejan de mover el cursor** en el campo.                                                           | Inicio/Fin/Backspace se conservan; en un buscador de una palabra no se edita con flechas. Si en UAT resulta un problema, → sólo actúa con el cursor al final del texto.               |
| **Barra lateral por ancho y no por ruta** cambia el resto de las pantallas (riel por defecto < 1536).     | Preferencia guardada manda; una sola línea en `AppShell`; se documenta y se captura en las 7 rutas de la 2.1. Alternativa (DESPUÉS): riel fijo + expansión flotante.                  |
| **Carga incremental + índice de teclado** (foco en una fila que aún no llegó).                            | Índice global y `End` que espera la página; prueba E2E con 5.000 productos sintéticos.                                                                                                |
| **`content-visibility: auto`** y filas de alto variable (nombres de dos renglones) → saltos al desplazar. | `contain-intrinsic-size` por variante (40/48/56) y nombre acotado a dos renglones; se mide CLS de scroll.                                                                             |
| **Scan sobre «Venta registrada» empieza otra venta**: excepción a «lector mudo con capas».                | Sólo ese diálogo, sólo con ráfaga válida, y el diálogo se cierra **antes** de agregar; prueba unitaria y E2E.                                                                         |
| **Transiciones de 80 ms** pueden sentirse bruscas.                                                        | Sólo en los diálogos de la caja; `prefers-reduced-motion` ya está; se compara en UAT.                                                                                                 |
| **Deshacer** re-agrega con el stock recontrolado: si el stock cambió, no vuelve.                          | El aviso lo dice («No se pudo deshacer: no queda stock»).                                                                                                                             |
| **E2E**: 20+ pruebas fijan «Enter con el campo vacío cobra» y «↓ elige líneas».                           | Se actualizan en la misma fase que el código, nunca después; la suite completa corre antes de cada parada.                                                                            |
| **Otro dev server en el puerto 3000** confunde las verificaciones manuales.                               | Comprobar `<title>` = «Almacén» y usar `localhost:3000`; documentado en memoria.                                                                                                      |

---

## 20. IMPLEMENTATION PLAN

Cada fase termina con: `npm test`, `npm run e2e`, `npm run build`, `pwa:check`, `integrity:check`, capturas y métricas comparadas, y **parada** para tu revisión. Sin merge a `main`, sin deploy.

**Fase A — Cimientos sin cambio visual** (gramática, foco, tiempos)

1. `teclado.ts`: acciones nuevas + pruebas unitarias (tecla por tecla) — sin tocar pantalla.
2. `useProducts.ts`: debounce sólo al tipeo (120 ms); caché corta. Medir categoría y búsqueda.
3. Foco inmediato al cerrar diálogos; `Dialog` con transición corta para la caja. Medir volver/terminar.
4. `DialogoCobro`: Enter sólo con pago declarado; artículos desplegados en escritorio.
5. Barra lateral: sin regla por ruta, default por ancho, sin `transition-[width]`. Medir CLS con `nav:metrics`.
6. Opcional: `turbopack: {}`.
   Entrega: métricas A vs baseline; E2E actualizados.

**Fase B — La lista**

1. `ListaDeProductos` + `FilaDeProducto` + `Secciones` (chips en un renglón, `ui/Chips`).
2. Fila nombre · estado · precio; dos renglones para el nombre; categoría sólo ≥ 1536.
3. Carga incremental de 60 + `content-visibility`; caso de 5.000 productos en `kiosco_test`.
4. Frecuentes sin cambio automático; estrella fuera de la fila táctil.
5. Ticket: ancho `clamp`, nombre de dos renglones, «Cobrar $ X», deshabilitado secundario.
   Entrega: densidad medida en los 8 anchos; capturas.

**Fase C — Modos y foco**

1. `useModoDeVenta` + `SelectorDeModo` + `CampoDeVenta` (persistencia, auto-detección por ráfaga, inputMode).
2. `useTecladoDelPos`: → ← desde el campo y la lista; Enter = revisar → cobrar; tipo-para-buscar desde la lista; tipo-para-editar en el ticket.
3. Estado «revisar» en el ticket; Deshacer para quitar/vaciar; última venta.
4. Scan sobre «Venta registrada».
5. `AyudaAtajos` con la gramática nueva; mapa de foco verificado acción por acción (E2E `venta-v3.spec.ts`).
   Entrega: E2E de teclado y foco; UAT con la persona.

**Fase D — Móvil y tablet**

1. Cabecera móvil (selector, campo, cámara con nombre, chips de 36).
2. Fila de 56 con estado y precio en el segundo renglón; barra con pulso; hoja como paso «revisar».
3. 768: decisión tomada con la tablet real.
4. Touch targets ≥ 44 medidos (la prueba existe) y `hasTouch` en el proyecto `movil`.
   Entrega: capturas 375/390/430/768 × 12 casos.

**Fase E — Verificación y cierre**

1. Métricas «después» (5 muestras, mediana) y tabla antes/después.
2. Capturas de los 8 anchos × 12 casos; densidad.
3. Accesibilidad: axe (oscuro y claro) + revisión manual de foco visible, orden de Tab, `aria`, contraste, teclado, táctil, `reduced-motion`.
4. Docs: `docs/UX_V3_VENTA_IMPLEMENTACION.md`, UAT actualizado, `DEV_ENVIRONMENT.md` (PostgreSQL detached, puerto 3000 compartido).
5. Parada final. No producción, no deploy, no merge.

---

### Anexo — cómo se midió

- `scripts/medir-venta-v3.mts` (copia de trabajo, sin commit): reloj y disparo **dentro de la página** (keydown/click en fase de captura → `MutationObserver` → `requestAnimationFrame`), 5 muestras, mediana; F5 limpio por muestra; venta real por muestra con el producto más barato por unidad.
- `scripts/densidad-venta-v3.mts`: filas enteramente visibles dentro del contenedor con scroll y por encima de la barra fija, alto de fila, anchos reales.
- `scripts/capturas-venta-v3.mts`: 8 anchos × 10 casos contra el build de producción, tema oscuro, `hasTouch` < 768.
- Servidor: `next start -p 3099` sobre `.next` (build de esta rama, `BUILD_ID 2hgLdCHinKkaHxPVB7c30`), aislado del dev server (`.next-dev`).
