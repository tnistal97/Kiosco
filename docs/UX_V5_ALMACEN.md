# UX V5 — el sistema listo para un almacén

> Estado: **implementado** en la rama `feat/ux-v2-phase2-1-lista-navegacion`.
> Toma lo mejor de la propuesta [UX_V4_ALMACENES_PROPUESTA.md](UX_V4_ALMACENES_PROPUESTA.md)
> y las decisiones que pidió el dueño para la primera instalación real.
> Evidencia: antes en [`docs/ux-v5-evidence/antes/`](ux-v5-evidence/antes/); capturas finales y
> resumen de entrega en [ENTREGA_ALMACEN_UI.md](ENTREGA_ALMACEN_UI.md)
> ([`docs/entrega-almacen/capturas/`](entrega-almacen/capturas/)).

## Criterio de éxito

Una persona que entra por primera vez tiene que poder **vender un producto, ver su
caja, encontrar un producto, consultar stock y hacer un inventario** sin que nadie
le explique la interfaz.

---

## 1. Cómo estaba (UX anterior)

- **Tema oscuro por defecto**, pensado para "un mostrador con poca luz". Para alguien
  nuevo se leía como un panel técnico.
- **Menú de 18 entradas en 6 grupos** (Operación, Inventario, Compras, Control,
  Administración): Stock, Movimientos, Lotes e Inventarios uno debajo del otro, sin
  saber qué diferencia hay.
- **Inicio = tablero de 10 tarjetas** (efectivo, faltantes, por cobrar, cuentas por
  pagar, vencidos, esperando mercadería…).
- **Venta**: un selector "Lector / Nombre" que no cambiaba nada; ← → en la lista
  **sumaban y restaban unidades** y Enter después **volvía a sumar**; los controles de
  cantidad solo aparecían al tocar la línea; el total en tamaño mediano; cobro con seis
  botones chicos, "Paga con", un segundo diálogo de "Venta registrada" siempre.
- **Caja**: cinco cifras chicas, la misma cifra repetida en dos lugares, un único
  botón "Nuevo movimiento" con tres tipos (uno contradictorio: Depósito), y toda la
  historia abierta debajo.
- **Productos**: estado, stock como etiqueta, código bajo el nombre, acciones
  escondidas en un menú ⋮, alta con ~13 campos en 5 secciones (Markup, Trazabilidad…).
- **Stock**: tres tarjetas (una de ellas "Productos en esta página"), botones de Lotes,
  Inventarios, Movimientos, precio y categoría en la tabla.
- **Movimientos**: aviso "Este libro no se edita", 9 columnas (anterior, posterior,
  referencia, usuario…), filtros por tipo y fechas.
- **Inventario**: número `IF-00000001`, "conteo a ciegas" activado por omisión, una
  sola acción "Guardar conteos" para todo, **"Cerrar conteo" y "Aplicar diferencias"
  sin confirmación**, y la pantalla **cortaba en 100 productos**: un inventario de todo
  el catálogo de un almacén mediano no se podía terminar.

## 2. Problemas encontrados

Auditoría con siete perspectivas separadas (UX de POS, UI visual, accesibilidad,
arquitectura Next.js, productos/stock/inventario, teclado y lector, QA). Lo más grave:

| #   | Problema                                                                          | Dónde                                      |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | → en la lista sumaba una unidad y Enter volvía a sumar: "→ y Enter" dejaba 2      | `teclado.ts`, `venta/page.tsx`             |
| 2   | Enter sobre un producto ya cargado sumaba otro                                    | `venta/page.tsx`                           |
| 3   | Un Enter, + o Supr sostenido se repetía 30 veces por segundo                      | `ScannerInput`, `Ticket`, `ProductBrowser` |
| 4   | Después de tocar un botón, el lector escribía en la nada                          | foco en `venta/page.tsx`                   |
| 5   | Un escaneo encima de un nombre a medio escribir se perdía                         | `ScannerInput`                             |
| 6   | Inventario de más de 100 productos imposible de terminar                          | `inventarios/[id]`                         |
| 7   | Aplicar un inventario: un clic, sin confirmación ni resumen                       | `inventarios/[id]`                         |
| 8   | Bordes de campos a 1,2:1 en el tema claro (un campo no parecía campo)             | `Field`, inputs                            |
| 9   | Deshabilitados con opacidad: 2:1, ilegibles                                       | `Button`, `Field`                          |
| 10  | Foco invisible en el ticket, la cantidad, el menú de usuario                      | `Ticket`, `QuantityInput`, `DropdownMenu`  |
| 11  | Íconos de botones grandes reducidos a un punto (la cámara de Vender)              | `IconButton`                               |
| 12  | Verde usado para acciones (Cobrar, Guardar): dos colores de acción                | `Button confirm`                           |
| 13  | Códigos internos en pantalla (`products.price.update`, permisos en Configuración) | varias                                     |
| 14  | Mercado Pago no existía como opción (se cargaba como "Transferencia")             | `PaymentSelector`                          |

## 3. Decisiones de diseño

Cuando dos perspectivas proponían cosas distintas, se eligió **lo más simple para un
empleado sin conocimientos técnicos**.

- **Tema claro por defecto.** Fondos neutros (`#f4f5f7`), superficie blanca, texto casi
  negro. El oscuro sigue disponible en Configuración. Todos los pares de color pasan
  WCAG AA (texto ≥ 4,5:1; bordes de control ≥ 3:1). Ver `src/app/globals.css`.
- **Un solo color de acción: azul.** Verde solo "salió bien", ámbar solo "cuidado",
  rojo solo "error o peligro". La variante `confirm` se conserva por compatibilidad pero
  se ve igual que `primary`. Ingresos y egresos se distinguen por el signo, no por color.
- **Menos cajas, más jerarquía.** Componentes nuevos `Section`, `Metric` y `MetricRow`:
  título, espacio y líneas divisorias en lugar de tarjetas.
- **Lo secundario detrás de una palabra**: "Más opciones" (producto, cobro, inventario),
  "Ver detalle" (caja), "Más acciones" (productos).
- **Funciones opcionales por instalación, sin borrar nada.** `KIOSCO_FUNCIONES` (ver §6).
- **Las reglas de negocio no cambiaron.** Mismos endpoints, mismas validaciones, mismos
  permisos. Los nombres nuevos ("Corrección", "Ajuste de inventario", "Para revisar")
  son de la pantalla; la API devuelve lo mismo que antes.
- **Mercado Pago = transferencia con referencia.** No es un medio nuevo del dominio: el
  pago se guarda como `TRANSFER` con `reference: "Mercado Pago"` (columna que ya existía).
  No toca la caja ni la base; se distingue en el detalle de la venta.

## 4. Cambios implementados

### Sistema visual (`src/app/globals.css`, `src/components/ui/*`)

- Tokens claros por defecto, oscuro bajo `[data-theme='dark']`; `field`, `scrim`,
  `disabled-*`, `text-md`, `text-metric`; `text-xs` sube a 13 px; controles de 48 px.
- `Button`: un color de acción, deshabilitado con colores propios, `md` = 48 px.
  `IconButton` ya no encoge el ícono.
- `Field`/`Input`/`Select`/`SearchInput`/`MoneyInput`/`QuantityInput`/`BarcodeInput`/
  `ScannerInput`: borde `line-strong` (3:1), fondo blanco, etiqueta en negrita, foco
  visible. `SearchInput` puede mostrar su etiqueta (`labelVisible`).
- `Table`: encabezados en minúscula, filas más cómodas, columnas `secondary` que se
  ocultan en pantallas angostas.
- `Badge`: sin azul de estado; `EstadoStockBadge` ("Sin stock" / "Stock bajo").
- `EmptyState` sin caja punteada; `ConfirmationDialog` con mensaje legible.
- Nuevos: `Section`, `Metric`, `MetricRow`.

### Navegación (`src/components/shell/*`)

- Menú: **Inicio · Vender · Caja · Productos · Stock · Inventario**, y separado
  **Clientes · Reportes · Configuración**. Ventas, Usuarios, Sucursales e Historial de
  cambios se abren desde Configuración (y Ventas también desde Caja e Inicio);
  Movimientos, desde Stock.
- Cabecera más limpia: título, estado de la caja y usuario. El tema pasó a Configuración.

### Vender (`/venta`)

- Gramática de teclado nueva (ver §7) y lector (ver §8).
- Se quitó el selector "Lector / Nombre": un solo campo, "Escaneá el código o escribí
  el nombre".
- Ticket: **− cantidad +** y **Quitar** en todas las líneas, **TOTAL** en el tamaño más
  grande de la pantalla, botón **Cobrar** azul de 64 px.
- Cobro: **TOTAL** → **¿Cómo paga?** (Efectivo, Transferencia, Mercado Pago, Débito,
  Crédito, Fiado; "Otro" en Más opciones) → **RECIBIDO** y **VUELTO** lado a lado →
  **CONFIRMAR VENTA**. El cliente aparece solo con Fiado. Sin vuelto que dar, la venta
  termina sola con el aviso "✓ Venta registrada"; con vuelto, se muestra en grande.

### Caja (`/caja`)

- **CAJA ABIERTA / CAJA CERRADA** en grande, con símbolo.
- **Tiene que haber en el cajón** como cifra principal, y debajo Ventas de hoy (si el
  usuario puede verlas), Ventas en efectivo, Ingresos y Egresos.
- Botones **Registrar ingreso**, **Registrar egreso**, **Contar caja** y **Cerrar caja**.
  "Depósito" ya no se ofrece (su efecto en los totales era contradictorio).
- Movimientos, conteos y cajas anteriores detrás de **Ver detalle**.

### Inicio (`/`)

- "¿Qué vas a hacer?": **Vender** grande y Caja, Productos, Stock, Hacer inventario.
- **Hoy**: ventas de hoy, la caja y los productos con poco stock (con enlace al filtro).

### Productos (`/productos`)

- Buscador grande con etiqueta, **+ Nuevo producto**, Categoría y "Más acciones"
  (Cambiar precios, Importar desde Excel, Ver dados de baja).
- Columnas: **Producto · Categoría · Precio · Stock · Código de barras · Editar**.
  Eliminar quedó en el menú ⋮.
- Nuevo producto: **Nombre, Categoría (con + Nueva), Precio, Unidades que tenés ahora,
  Código de barras**. Lo demás en "Más opciones". Campo de código con
  "✓ Código detectado" (ver §8).

### Stock (`/stock`)

- **Producto · Stock actual · Estado** (solo "Stock bajo" o "Sin stock" cuando dice
  algo) · **Ajustar**. Filtros **Todos / Stock bajo (N) / Sin stock (N)** y Categoría.
  `?estado=bajo|sin` abre la lista filtrada.

### Movimientos (`/stock/movimientos`)

- **Fecha · Producto · Movimiento · Cantidad · Motivo**, con "+10 u." / "−2 u." y
  nombres simples (Entrada, Venta, Venta anulada, Corrección, Ajuste de inventario,
  Stock inicial, Rotura, Pérdida…). Buscador y **Hoy / 7 días / 30 días / Todos**.

### Inventario (`/inventarios`, `/inventarios/[id]`)

- Acción principal **Nuevo inventario**; aviso grande "Tenés un inventario sin
  terminar → Seguir contando".
- Pasos **Contar → Revisar diferencias → Listo**, siempre a la vista.
- Contar: progreso "Contaste 12 de 43", **lector o nombre** para encontrar el producto,
  tabla **Producto · Sistema · Contado · Diferencia**, cada cantidad **se guarda sola**
  (Enter o al salir del campo), paginado de a 100 (ya no se corta), filtros Sin contar /
  Contados / Todos.
- Revisar: "**Encontramos diferencias en X productos.**" con Faltan / Sobran /
  Coinciden. Color solo en la diferencia (rojo falta, ámbar sobra, ✓ coincide).
- **APLICAR INVENTARIO** con confirmación ("Esto no se puede deshacer"); también
  "Terminé de contar" y "Cancelar inventario" piden confirmación.
- Por omisión se ve el stock del sistema mientras se cuenta; contar sin verlo y el
  segundo conteo quedaron en "Más opciones".
- Cada cantidad viaja **una sola vez**: Enter guarda y pasa a la siguiente sin que el
  "al salir" la mande de nuevo, y recorrer con Tab líneas ya contadas no las vuelve a
  marcar como "sin guardar".
- **Contar dos veces pide el segundo conteo una sola vez** (antes, un segundo conteo
  que confirmaba la diferencia pedía un tercero). Es el único cambio de regla en el
  servidor: `src/modules/inventory-counts/service.ts`, con su prueba en
  `tests/integration/inventario-fisico.test.ts`.
- Escanear un producto lo busca por su id (`GET /api/inventarios/:id/lineas?productId=`,
  filtro nuevo y opcional), no por el nombre: con muchos parecidos ya no queda afuera.

### Configuración (`/configuracion`)

- Tu cuenta, contraseña, apariencia, accesos de administración y datos del comercio.
  Sin la lista de códigos de permisos.

## 5. Rutas modificadas

`/`, `/venta`, `/caja` (y los textos de `/caja/abrir` y `/caja/cerrar`), `/productos`,
`/stock`, `/stock/movimientos`, `/inventarios`, `/inventarios/[id]`, `/configuracion`.
Redirecciones nuevas en el middleware para las funciones apagadas (§6).

API: ningún contrato cambió. Se agregó un filtro **opcional** `productId` a
`GET /api/inventarios/:id/lineas`, y el conteo de inventario ya no pide un tercer conteo
(§4, Inventario).

## 6. Funcionalidades ocultadas

| Función                                     | Qué se oculta                                                               | Cómo se vuelve a habilitar |
| ------------------------------------------- | --------------------------------------------------------------------------- | -------------------------- |
| Lotes y vencimientos                        | Menú, botón en Stock, sección en la ficha, lote en movimientos e inventario | `KIOSCO_FUNCIONES=lotes`   |
| Compras: Órdenes, Proveedores, Devoluciones | Grupo del menú, proveedor en la ficha, secciones de reportes                | `KIOSCO_FUNCIONES=compras` |
| (las dos)                                   |                                                                             | `KIOSCO_FUNCIONES=todas`   |

- **No se borró nada**: dominio, API, tablas y datos siguen igual.
- El servidor recorta de la sesión que baja al navegador los permisos de las funciones
  apagadas (`permisosVisibles`), así que cada pantalla esconde lo suyo sola. La
  autorización real del servidor sigue usando los permisos del rol.
- Entrar a mano a `/stock/lotes` lleva a `/stock`; a `/compras`, `/proveedores`,
  `/devoluciones` o `/comprobantes/proveedor/*` lleva a Inicio (redirección 307 en el
  middleware). La API no se redirige.
- Código: `src/lib/funciones.ts`, `src/middleware.ts`, `src/app/layout.tsx`.
- Pruebas: `tests/unit/funciones.test.ts`, `tests/unit/middleware-funciones.test.ts`.
  La suite e2e corre con `KIOSCO_FUNCIONES=todas` para seguir probando esas pantallas.

## 7. Teclado en `/venta`

Desde octubre de 2026 rige la **gramática V6**: la venta tiene tres etapas
(**1. Productos › 2. Carrito › 3. Cobro**) y cada eje tiene una sola responsabilidad:
**↑ ↓ eligen, → suma una unidad, ← resta una, Enter avanza una etapa, Esc vuelve una**.
Enter nunca suma. El detalle completo, con el cobro paso a paso y las protecciones contra
Enter de más, está en `docs/TECLADO_VENTA_V6.md`.

| Etapa     | ↑ ↓             | →             | ←                      | Enter            | Esc                 |
| --------- | --------------- | ------------- | ---------------------- | ---------------- | ------------------- |
| Productos | Elegir producto | Agregar uno   | Quitar uno (si está)   | Pasar al carrito | Limpiar la búsqueda |
| Carrito   | Elegir línea    | +1            | −1 (en cero, se quita) | Abrir el cobro   | Volver a productos  |
| Cobro     | Forma de pago   | Forma de pago | Forma de pago          | Avanzar un paso  | Volver al carrito   |

Escribir busca aunque el foco esté en otro lado. El lector (CÓDIGO + Enter) agrega una
unidad y no cambia de etapa. Enter, ←, →, + y − no se repiten si se dejan apretados, y dos
Enter a menos de 300 ms avanzan una sola etapa.

## 8. Lector de código de barras

Funciona con cualquier lector USB que se comporte como teclado (CÓDIGO + Enter), sin
configurarlo.

- **Con el foco en el campo** (lo normal: la pantalla arranca así y vuelve ahí después de
  cada acción): CÓDIGO + Enter busca el código y agrega una unidad. **Dos lecturas, dos
  unidades.**
- **Con el foco en otro lado** (un botón que se tocó con el mouse): la primera tecla
  imprimible devuelve el foco al campo antes de escribirse, así que el código entero cae
  ahí y Enter lo procesa. Como respaldo sigue el detector global por ráfaga
  (`useBarcodeScanner`), que solo actúa fuera de campos de texto y sin diálogos abiertos.
- **Encima de un nombre a medio escribir** ("coc" + lectura): los dígitos que llegaron en
  ráfaga (≥ 6, ≤ 40 ms entre teclas) se toman como código, se agrega el producto y vuelve
  "coc" al campo. Si lo escrito terminaba en números ("agua 500" + lectura), gana la
  parte que es un código válido (EAN-8, UPC, EAN-13 o GTIN-14 con su dígito
  verificador) y vuelve "agua 500".
- **Enter de una persona no suma**: Enter en la lista o con un nombre escrito _elige_;
  solo un código (dígitos) agrega.
- **Nuevo producto**: el campo "Código de barras" acepta lector o teclado. Enter **no
  guarda** el formulario: confirma el código, muestra **✓ Código detectado** y pasa el foco
  a "Guardar producto". Si el código ya es de otro producto, lo dice con el nombre antes
  de guardar. Una ráfaga sin Enter también se confirma.
- **Inventario**: escanear un producto lo busca en el inventario y deja el cursor en su
  cantidad; Enter guarda y vuelve al campo del lector.

## 9. Revisión visual

Capturas automáticas con `scripts/capturas-ux.ts` contra la aplicación local:
el estado anterior en [`docs/ux-v5-evidence/antes/`](ux-v5-evidence/antes/) (1366 × 768
y 375 × 812) y las capturas finales de la entrega, con nombre fijo, en
[`docs/entrega-almacen/capturas/`](entrega-almacen/capturas/) (modo `final`).

## 10. Pruebas

Resultados finales, con números exactos, en
[ENTREGA_ALMACEN_UI.md §16](ENTREGA_ALMACEN_UI.md#16-pruebas-finales).

## 11. Riesgos que todavía existen

La lista final, revisada después de la última revisión de riesgos, está en
[ENTREGA_ALMACEN_UI.md §18](ENTREGA_ALMACEN_UI.md#18-limitaciones-que-permanecen).

- **Mercado Pago en reportes**: como es una transferencia con referencia, los reportes
  por medio de pago lo suman a "Transferencia". El detalle de cada venta sí lo distingue.
- **Instalaciones existentes**: sin `KIOSCO_FUNCIONES`, Lotes y Compras se ocultan.
  Una instalación que ya los usa tiene que agregar `KIOSCO_FUNCIONES=todas` antes de
  actualizar.
- **Productos con lote obligatorio**: con Lotes apagado nadie puede crear lotes; un
  producto que ya tenga `lotTracking = REQUIRED` necesitaría volver a `NONE` antes de
  apagar la función. Si igual pasa, el inventario lo avisa ("Hay productos que piden
  lote… pedí ayuda a quien instaló el sistema") en vez de dejar "Aplicar" apagado sin
  explicación.
- **Lector encima de números escritos con un código interno** (no EAN): si alguien
  escribió "agua 500" y escanea un código propio del local, los dígitos se juntan y el
  código no se encuentra; el aviso lo dice y basta volver a escanear.
- **Enter en "Recibido" vacío confirma en efectivo justo** una vez elegida la forma de
  pago (es el flujo pedido: cada Enter avanza una etapa). Hacen falta cuatro Enter
  deliberados desde el campo vacío, y nunca en los primeros 300 ms del cobro.
- **Rol cajero**: no tiene permiso para registrar ingresos/egresos de caja, crear
  productos ni hacer inventarios; la interfaz respeta los permisos y esos botones no le
  aparecen. Si el almacén quiere que el cajero haga esas tareas, hay que darle otro rol.
- **Depósito** sigue existiendo en el sistema (se puede ver en movimientos viejos) pero
  ya no se ofrece al registrar.
- **Ventas de hoy en Caja** se muestra solo a quien puede ver reportes de ventas; para el
  resto se ven las ventas en efectivo del turno.
