# UX V2 — Fase 2: caja + venta + apertura/cierre + listado de productos

Rama `feat/ux-v2-phase2-caja-venta`, sobre `feat/ux-v2-phase1-pos` (fase 1 + corrección de entrada numérica). Sin migraciones. Sin cambios en reglas de negocio: servicios, esquemas de validación, ledger, stock, FEFO, pagos y cuentas corrientes no se tocaron.

## 1. Problema original

La fase 1 dejó el POS operable sin mouse y con el cobro siempre a la vista, pero con tres problemas que la auditoría ya había anotado y la fase no cubría:

1. **La pantalla de venta estaba vacía hasta que alguien escribía.** La zona de resultados —1.250 × 860 px en 1920— mostraba un texto en el centro la mayor parte del día (H-29, §22). Vender sin lector exigía saber el nombre exacto y escribirlo primero.
2. **Abrir y cerrar la caja eran diálogos encima del listado de movimientos.** Para abrirla desde la venta había que ir a Caja, encontrar el botón, abrir, y volver (§6, 08:00: «navegación de ida y vuelta»). El cierre mostraba «Inicial · Ventas · Tiene que haber» con una suma que no cerraba a la vista porque faltaban entradas y salidas (H-12). «Cerrar la caja» —la acción del día— era el botón secundario; «Hacer arqueo», el primario (§11.1).
3. **El pago combinado obligaba a leer el pie para saber cuánto faltaba.** Lo cargado y lo pendiente estaban en una lista al final de los renglones.

## 2. Objetivo

Que una persona nueva pueda, sin explicación técnica, abrir la caja, vender tres productos —escaneando o tocando—, cambiar una cantidad, sacar una línea, cobrar en efectivo y cerrar la venta en menos de cinco minutos; y en menos de quince, cobrar con distintos medios, cerrar la caja y entender el flujo. Ver la lista de comprobación en `docs/UX_V2_MANUAL_UAT.md`.

## 3. Decisiones de diseño

| Decisión                                                                                                     | Por qué                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El catálogo se ve **antes de escribir**: «Frecuentes», «Todos» y una sección por categoría, en una grilla.   | Es lo que permite vender sin lector y sin saber el nombre exacto. Con más de 60 productos en una sección, la grilla dice cuántos hay y pide buscar por nombre: no se tiran miles de tarjetas.                                                                                          |
| «Frecuentes» = favoritos marcados a mano + lo que más se vendió **en esta caja**, contado en `localStorage`. | El ranking real de ventas existe en Reportes pero exige `reports.sales.view`, que el cajero no tiene. Guardar identificadores y cuentas en el equipo no necesita esquema ni migración; nombre, precio y stock se piden frescos cada vez. Otra caja no los ve: es un límite deliberado. |
| **La misma grilla** muestra los resultados de la búsqueda.                                                   | Un solo lugar donde mirar. Con una letra en el campo, las secciones se esconden y las tarjetas se filtran; ↑↓ resaltan, Enter agrega.                                                                                                                                                  |
| Tocar una tarjeta agrega **y devuelve el foco al lector**; elegirla con Enter deja el foco en la grilla.     | Quien toca va a escanear lo siguiente; quien navega con teclado quiere seguir eligiendo. Se distingue por `event.detail` (0 = teclado).                                                                                                                                                |
| Sin imágenes.                                                                                                | En un almacén no aportan y en una tablet pesan. Nombre, precio y —cuando importa— «Se pesa», «Quedan 3», «Agotado».                                                                                                                                                                    |
| Abrir y cerrar la caja son **páginas** (`/caja/abrir`, `/caja/cerrar`), no diálogos.                         | Un flujo guiado con un solo objetivo. Desde la venta, `?volver=/venta` trae de vuelta al mostrador en cuanto la caja queda abierta.                                                                                                                                                    |
| El cierre muestra los **cuatro renglones** de la suma y la diferencia «con todas las letras».                | Cuadra / Falta $X / Sobra $X, con una pista de por qué suele pasar y el aviso del umbral antes de confirmar. Firmar un faltante es un segundo botón distinto («Autorizar y cerrar»), nunca el mismo clic.                                                                              |
| El cierre lista además las ventas por medio de pago, leídas de los movimientos del turno.                    | «Solo el efectivo entra al cajón» se entiende viendo los tres números. Es lectura: el esperado lo calcula el servidor. Con más de cien ventas se dice cuántas son y no se inventa un desglose parcial.                                                                                 |
| `PageHeader` es un `h2`.                                                                                     | El armazón ya pone el `h1` con el nombre de la sección; dos `h1` en una página es una falta que axe encontró en la fase 4D.                                                                                                                                                            |
| El pago combinado lleva arriba una línea «Cargado $X · Falta $Y / ✓ Cubre el total».                         | Es lo único que hay que mirar mientras se arma; antes estaba al pie, debajo de los renglones.                                                                                                                                                                                          |
| Los atajos viejos (F12, Alt+N, Ctrl+K, `/`) siguen funcionando y no se muestran en botones.                  | Alias, no gramática. Igual que en la fase 1.                                                                                                                                                                                                                                           |

## 4. Layout de escritorio (desde `lg`, 1024 px)

```
┌──────────────────────────────────────────────────────┬──────────────────────┐
│ [▌ Escaneá o buscá un producto        ] [📷] [Nuevo] │ Ticket · 3 artículos │
│ ↑↓ elegir · ←→ cantidad · Enter cobrar · Supr quitar │ ─────────────────────│
│ (Frecuentes) (Todos) (Almacén) (Bebidas) (Lácteos) … │ Yerba mate 1 kg      │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐ │   2 u. × $ 4.850,00  │
│ │Yerba   │ │Gaseosa │ │Leche   │ │Queso   │ │…     │ │ ▌Leche entera 1 L    │
│ │$ 4.850 │ │$ 3.450 │ │$ 1.690 │ │Se pesa │ │      │ │   [−] 1 [+]  Quitar  │
│ └────────┘ └────────┘ └────────┘ └────────┘ └──────┘ │ …                    │
│ …  (la grilla se desplaza por dentro)                │ ─────────────────────│
│                                                      │ Total     $ 18.450,00│
│                                                      │ [      Cobrar      ] │
└──────────────────────────────────────────────────────┴──────────────────────┘
```

- Dos columnas: catálogo (todo el ancho libre) y ticket fijo de 440 px (`--spacing-ticket`).
- Nada se desplaza como página: el lector queda arriba y el total y «Cobrar» abajo, siempre. Sólo la grilla tiene scroll.
- La barra lateral arranca contraída en `/venta` (fase 1).
- Grilla `repeat(auto-fill, minmax(10rem, 1fr))`: 4 columnas en 1366, 5 en 1440, 7 en 1920.

## 5. Layout de móvil y tablet (hasta `lg`)

```
┌──────────────────────────────┐
│ [▌ Escaneá o buscá   ] [📷] │  ← lector arriba
│ (Frecuentes)(Todos)(Bebidas)→│  ← secciones, con scroll lateral
│ ┌───────────┐ ┌───────────┐  │
│ │Yerba      │ │Gaseosa    │  │  ← 2 columnas en 375, 3 en 430, 4 en 768
│ │$ 4.850,00 │ │$ 3.450,00 │  │
│ └───────────┘ └───────────┘  │
│ …                            │
├──────────────────────────────┤
│ Ticket · 3 artículos [Cobrar]│  ← barra fija, al alcance del pulgar
│ $ 18.450,00                  │
└──────────────────────────────┘
```

- Tocar «Ticket» abre el carrito como hoja inferior (70 dvh) con las mismas líneas, el total y «Cobrar».
- «Cobrar» abre el cobro a pantalla completa, con el pie fijo (fase 1).
- La última fila de la grilla lleva 96 px de aire abajo para que la barra fija no la tape.

## 6. Flujo de apertura (`/caja/abrir`)

1. Cabecera «Abrir la caja» con el estado «Cerrada». Sucursal y quién abre, a la vista y sin escribirlos.
2. Un solo campo, con el foco puesto: «Efectivo inicial» (64 px, `MoneyInput` tolerante: `25000`, `25.000` y `0` valen).
3. «Agregar una nota» abre el textarea sólo si hace falta.
4. «Abrir caja» (o Enter). Al abrir: aviso «Caja abierta. Ya se puede cobrar.», la cabecera del armazón se actualiza y se vuelve a `?volver` (por omisión, `/caja`).
5. Si ya estaba abierta: «La caja ya está abierta», quién y cuándo, «Ir a vender» / «Ver la caja». Sin permiso: «Abrirla necesita un encargado».

Desde la venta con la caja cerrada: aviso «La caja está cerrada» con «Abrir caja» (`/caja/abrir?volver=/venta`) si el usuario puede, o «Pedile a un encargado» si no. El ticket se puede armar igual.

## 7. Flujo de venta

1. La pantalla arranca con el foco en el lector y el catálogo a la vista («Frecuentes» si hay, si no «Todos»).
2. Se vende de tres maneras que terminan en el mismo lugar:
   - **escaneando**: el lector escribe y manda Enter; el producto entra al ticket (o pide el peso);
   - **tocando** una tarjeta, o eligiéndola con el teclado;
   - **buscando**: una letra filtra la grilla; ↑↓ y Enter, o un toque.
3. La línea recién agregada queda elegida: → suma una, ← resta una, Supr la quita, Enter edita la cantidad (o el peso).
4. Cada línea dice producto, cantidad con su unidad («2 u.», «0,500 kg»), precio unitario («× $ 9.800,00 / kg») y subtotal.
5. «Cobrar» (o Enter con el campo vacío) abre el cobro.

Casos: código no registrado → «Crear producto» (alta rápida, fase 5A.1); producto agotado → la línea del lector dice «está agotado» y la tarjeta se ve apagada con «Agotado»; más de lo que hay → la cantidad se acota al stock y la línea dice «· sin más stock»; caja cerrada → el aviso de arriba.

## 8. Flujo de cobro

Sin cambios de fondo respecto de la fase 1 (total en grande, medios como botones, «Paga con» con el foco, vuelto en grande, pie fijo). Lo que cambia:

- **Combinado**: al dividir, arriba de los renglones hay una línea «Cargado $X · Falta $Y» que pasa a «✓ Cubre el total» cuando la suma cierra. «Agregar medio de pago» y «Quitar» por renglón, como antes.
- **Transferencia y tarjeta**: un toque y confirmar; la pantalla dice que no entra al cajón.
- **Cuenta corriente**: «Fiado» exige elegir el cliente (el selector se abre solo) y muestra saldo actual, esta venta, saldo resultante, límite y disponible.
- Al confirmar: «Venta registrada», vuelto en grande, «Nueva venta» (Enter) deja el lector enfocado y el ticket vacío.

## 9. Flujo de cierre (`/caja/cerrar`)

1. **El turno**: efectivo inicial, ventas en efectivo (cuántas), ingresos al cajón, retiros y depósitos (con signo) y **Tiene que haber**. Debajo, las ventas por medio: «12 ventas en el turno: 9 efectivo $X · 2 débito $Y · 1 transferencia $Z», con la aclaración de que sólo el efectivo entra al cajón.
2. **Contá el efectivo**: un campo de 64 px con el foco puesto. Mientras se escribe: «✓ Cuadra», o «Falta $X» en rojo, o «Sobra $X» en ámbar, cada uno con su pista («Revisá vueltos mal dados y retiros sin anotar»). Si supera el umbral de la sucursal, lo dice antes de confirmar.
3. **Observación** (opcional; la ayuda pide contar qué pasó cuando hay diferencia).
4. «Cerrar caja» (o Enter). Si el servidor pide autorización, el botón cambia a «Autorizar y cerrar» para quien puede, o aparece «Hace falta un encargado».
5. Resultado: «Caja cerrada» con tenía que haber / se contó / diferencia, y «Ver la caja» / «Abrir una caja nueva».

En `/caja`, «Cerrar la caja» pasó a ser la acción primaria del panel del turno; «Hacer arqueo» es secundaria. El panel muestra ahora inicial, ventas, entradas, salidas y tiene que haber.

## 10. Reglas de teclado

| Tecla                | En el campo de escaneo                                                                                                  | En la grilla de productos                | En el ticket                  | En el cobro                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------- | ------------------------------- |
| ↑ ↓                  | Buscando: resaltan un resultado. Campo vacío con ticket: eligen una línea. Campo vacío sin ticket: ↓ entra a la grilla. | Una fila arriba / abajo                  | Línea anterior / siguiente    | Recorren los medios de pago     |
| ← →                  | Con línea elegida: una unidad menos / más (KG y L abren el peso)                                                        | Tarjeta anterior / siguiente             | Una unidad menos / más        | Recorren los medios de pago     |
| Enter                | Dígitos: busca el código. Letras: agrega el resultado resaltado. Vacío con ticket: abre el cobro                        | Agrega (y el foco se queda en la grilla) | Edita la cantidad (o el peso) | Cobra (pasados 300 ms)          |
| Escape               | Vacía el campo → deselecciona → cierra el aviso                                                                         | Vuelve al lector                         | Vuelve al lector              | Vuelve al ticket                |
| Supr                 | Quita la línea elegida                                                                                                  | —                                        | Quita la línea elegida        | —                               |
| Tab                  | Lleva a la grilla (una sola tarjeta entra con Tab)                                                                      | Sale de la grilla                        | —                             | Recorre los controles           |
| Inicio / Fin         | —                                                                                                                       | Primera / última tarjeta                 | —                             | —                               |
| E D R T F O · J      | —                                                                                                                       | —                                        | —                             | Eligen el medio · importe justo |
| F12 · Alt+N · Ctrl+K | Alias: cobrar · producto nuevo · ir al campo. No se muestran en botones.                                                |                                          |                               |                                 |

El lector USB sigue siendo instantáneo con el foco en cualquier lado: la ráfaga la toma el campo si está enfocado, y el escucha global si no (salvo dentro de otro campo de texto o con un diálogo abierto).

## 11. Componentes creados y reutilizados

| Pedido                          | Resuelto con                                                                                 | Estado                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| PageContainer                   | `ui/PageContainer` (fase 1)                                                                  | reutilizado (`narrow` en apertura y cierre)            |
| PageHeader operativo            | `ui/PageHeader` — título (h2), estado, descripción, acciones                                 | **nuevo**                                              |
| ProductBrowser / ProductList    | `venta/ProductBrowser` — secciones, grilla, tarjeta, teclado, favoritos                      | **nuevo**; reemplaza `Favoritos` y `ResultadoBusqueda` |
| POSLayout                       | `venta/POSLayout` — dos columnas en escritorio, barra fija y hoja del ticket en móvil        | **nuevo**                                              |
| TicketPanel                     | `venta/Ticket` (fase 1)                                                                      | reutilizado                                            |
| CheckoutPanel / CheckoutSheet   | `venta/DialogoCobro` (fase 1) — pantalla completa en móvil                                   | reutilizado; línea «Cargado / Falta» nueva             |
| MoneyInput tolerante            | `ui/MoneyInput` + `ui/NumericInput` + `lib/numero-local` (corrección numérica)               | reutilizado                                            |
| QuantityDisplay / QuantityInput | `ui/QuantityText`, `ui/QuantityInput` (fase 1)                                               | reutilizado                                            |
| StatusBadge humano              | `ui/StatusBadge`, `ui/EstadoBadge` (fase 1)                                                  | reutilizado («Abierta» / «Cerrada» en las cabeceras)   |
| PaymentMethodSelector           | `venta/PaymentSelector` (fase 1)                                                             | reutilizado                                            |
| EmptyState / ErrorState         | `ui/States` (fase 1)                                                                         | reutilizado (catálogo vacío, sin resultados, error)    |
| Mobile bottom bar / sticky      | `venta/POSLayout` → `BarraDeTicket`                                                          | **nuevo** (antes inline en la página)                  |
| Drawer / Sheet                  | `ui/Drawer` `side="bottom"` (fase 1)                                                         | reutilizado                                            |
| Frecuentes                      | `venta/useFrecuentes` (ranking local), `venta/useProductosPorIds` (productos frescos por id) | **nuevos**                                             |
| Apertura y cierre               | `caja/AperturaDeCaja`, `caja/CierreDeCaja`, rutas `/caja/abrir` y `/caja/cerrar`             | **nuevos**; reemplazan `DialogoTurno` (borrado)        |

Borrados (duplicaban lo que ahora hace un solo componente): `venta/Favoritos.tsx`, `venta/ResultadoBusqueda.tsx`, `caja/DialogoTurno.tsx`.

## 12. Copy

Ningún código técnico en las pantallas de esta fase: los medios de pago se muestran con `etiquetaDeMedio` (Efectivo, Débito, Crédito, Transferencia), los estados del turno con «Abierta» / «Cerrada», los movimientos con `describirMovimientoDeCaja`. Botones: «Abrir caja», «Cobrar», «Cerrar caja», «Autorizar y cerrar», «Nueva venta», «Quitar», «Volver», «Ir a vender», «Ver la caja».

## 13. Casos diferidos

- Frecuentes compartidos entre cajas (necesita esquema o un endpoint de ranking accesible al cajero).
- Imágenes en las tarjetas (no aportan en almacén; útil sólo para fiambrería).
- Categorías anidadas o reordenables (no hay pantalla de categorías).
- Ventas del turno por medio con más de cien movimientos (hoy se dice «más de N ventas»; necesita un endpoint por turno).
- Apertura inline dentro del POS sin salir de la pantalla (se optó por la página con `?volver` para no meter un formulario dentro del mostrador).
- Ticket en espera, consulta de precio, cobrar deuda desde el POS (fase 1, diferidos).

## 14. Evidencia

`docs/ux-v2-phase2-evidence/before/` y `docs/ux-v2-phase2-evidence/after/`: venta vacía y con productos (375/390/430/768/1366/1440/1920), buscando (375/1366), ticket móvil (375/430), cobro (375/390/430/768/1366/1920), cobro dividido (375/1366), caja (375/1366), cierre (375/390/768/1366/1920), venta con la caja cerrada (375/1366), apertura (375/390/768/1366/1920).

## 15. Verificación

Antes = `feat/ux-v2-phase1-pos` en `17d3a97` (fase 1 + corrección numérica); después = esta rama en su último commit. Misma máquina, base de desarrollo sembrada con `seed:demo`.

| Comprobación                                | Antes                                          | Después                                                                             |
| ------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run format:check`                      | Pasa                                           | Pasa                                                                                |
| `npm run lint`                              | Pasa                                           | Pasa                                                                                |
| `npm run typecheck`                         | Pasa                                           | Pasa                                                                                |
| `npm test`                                  | 85 archivos · 1.762 pruebas                    | 87 archivos · 1.790 pruebas · 1.079 s                                               |
| `npm run test:e2e` (puerto 3101)            | 259 pruebas (fase 1)                           | 289 pruebas · 289 pasan · 11,0 min                                                  |
| `npm run build`                             | Pasa                                           | Pasa                                                                                |
| `npm run pwa:check` (contra 3099)           | Pasa                                           | Pasa                                                                                |
| `npm audit`                                 | 5 high preexistentes (browserslist, deepmerge) | Igual: no se tocaron dependencias                                                   |
| `npm run integrity:check`                   | Sin inconsistencias                            | Sin inconsistencias                                                                 |
| Axe (WCAG 2.1 AA)                           | 41 pantallas                                   | 43: se suman `/caja/abrir` y `/caja/cerrar` (con la diferencia a la vista)          |
| Teclado (`teclado.spec`, `caja-venta.spec`) | 11 pruebas                                     | 11 + 16: grilla con ↓ / flechas / Enter / Escape, foco tras cobrar                  |
| Móvil (`movil.spec`)                        | 375 px, 44 px, sin scroll lateral              | + `/caja/abrir` y `/caja/cerrar` en 375; 10,5 kg con teclado decimal en 375/390/430 |

Pruebas nuevas: `tests/ui/catalogo.test.tsx` (17), `tests/unit/frecuentes.test.ts` (4), 5 casos más en `tests/ui/teclado-pos.test.ts`; `e2e/caja-venta.spec.ts` (16). Specs adaptados por la nueva UX: `accesibilidad`, `administracion`, `movil`, `alta-rapida`, `compras`, `numeros`.

Código de negocio: sin cambios. `git diff 17d3a97..HEAD -- src/modules src/server src/lib prisma` está vacío. Migraciones: 0.
