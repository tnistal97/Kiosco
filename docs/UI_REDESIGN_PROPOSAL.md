# Propuesta de interfaz

> Diseño para un almacén real: un cajero sin formación técnica, un monitor de 1366×768, y las siete de la tarde con cola en la caja.
> Parte de los problemas medidos en [UI_UX_AUDIT.md](UI_UX_AUDIT.md).

## Principio rector

**La pantalla de venta es el producto.** Todo lo demás es administración y puede ser más lento, más denso y más completo. La caja tiene que resolver una venta común en un gesto y una compleja sin abandonar el teclado.

Segundo principio: **nada importante se aprende, se ve.** Si el cajero tiene que acordarse de algo, la interfaz falló.

---

## 1. Dirección visual

### 1.1 Un solo tema, decidido por la aplicación

Hoy cada pantalla elige, y el modo oscuro lo decide el sistema operativo porque `darkMode: 'class'` nunca se aplicó. Propuesta:

- **Tema oscuro por defecto**, alternable desde la aplicación y recordado por dispositivo.
- Definido en CSS con la sintaxis de Tailwind 4 (`@theme`), no en `tailwind.config.js` — que hoy es un archivo muerto.
- Un solo lugar donde vive la paleta.

```css
/* globals.css */
@import 'tailwindcss';

@theme {
  --color-fondo: #0f1115; /* fondo de la aplicación */
  --color-superficie: #171a21; /* tarjetas, tablas */
  --color-superficie-2: #1f242e; /* filas alternas, hover */
  --color-borde: #2b323d;

  --color-texto: #f2f4f7; /* 15.8:1 sobre fondo */
  --color-texto-suave: #a8b0be; /*  7.1:1 sobre fondo — legible de verdad */

  --color-accion: #2563eb; /* azul: acción primaria */
  --color-exito: #16a34a; /* verde: cobrar, confirmar */
  --color-alerta: #d97706; /* ámbar: stock bajo, por vencer */
  --color-peligro: #dc2626; /* rojo: anular, eliminar */
}
```

`--color-texto-suave` es el cambio que más se nota: hoy el texto secundario usa `gray-400` sobre `gray-800`, que ronda 4:1 y se pierde bajo la luz de un local.

### 1.2 Colores con significado, no decorativos

| Color | Significa                         | Dónde                                          |
| ----- | --------------------------------- | ---------------------------------------------- |
| Verde | Dinero entrando, confirmación     | Cobrar, total, stock sano                      |
| Ámbar | Requiere atención pronto          | Stock bajo, por vencer, compra pendiente       |
| Rojo  | Destructivo o diferencia negativa | Anular, eliminar, faltante de caja, stock cero |
| Azul  | Acción neutra                     | Guardar, filtrar, navegar                      |

Nunca color solo: siempre ícono o texto al lado. Un cajero con daltonismo tiene que poder trabajar.

### 1.3 Escala tipográfica y densidad

| Uso              | Tamaño                      | Por qué                                         |
| ---------------- | --------------------------- | ----------------------------------------------- |
| Total a cobrar   | 48 px, seminegrita, tabular | Legible desde el otro lado del mostrador        |
| Precios en tabla | 18 px, cifras tabulares     | Las columnas de números tienen que alinearse    |
| Texto de tabla   | 16 px                       | Hoy hay `text-sm` (14 px) en las tablas de caja |
| Etiquetas        | 14 px                       |                                                 |

**Cifras tabulares** (`font-variant-numeric: tabular-nums`) en toda columna de dinero: sin eso los importes bailan y el ojo no puede comparar de un vistazo.

### 1.4 Objetivos táctiles

Mínimo **44×44 px** en todo el flujo de venta; **56 px** en las acciones de cobro. Hoy 50 de 55 elementos interactivos quedan por debajo de 44 px.

### 1.5 Lo que no vamos a hacer

Sin degradados de fondo, sin animaciones de entrada, sin tarjetas con sombras flotantes, sin emojis como íconos (`🧃`, `🛒`, `💵` deben pasar a íconos vectoriales consistentes), sin encabezados que ocupen un cuarto de la pantalla, sin métricas de adorno en el inicio.

---

## 2. Navegación

### 2.1 Estructura

Barra lateral colapsable en escritorio, barra inferior en tablet y móvil. **La sección visible depende del permiso, no del nombre del rol.**

```
Inicio            todos
Venta rápida      ventas.crear
Caja              caja.ver
Productos         productos.ver
Stock             stock.ver
Compras           compras.ver
Proveedores       proveedores.ver
Clientes          clientes.ver
Reportes          reportes.ver
Auditoría         auditoria.ver
Usuarios          usuarios.administrar
Sucursales        sucursales.administrar
Configuración     configuracion.administrar
```

Un cajero típico ve tres entradas: Inicio, Venta rápida, Caja. Un encargado ve nueve. La barra no crece con el rol: **se recorta con el permiso**.

### 2.2 Nombres que dicen lo que hacen

| Hoy             | Propuesto                 | Motivo                          |
| --------------- | ------------------------- | ------------------------------- |
| Caja            | **Venta rápida**          | Es el punto de venta            |
| Ventas          | **Caja**                  | Es el movimiento de caja        |
| Cierre Caja     | **Arqueo** dentro de Caja | Hoy no cierra nada, solo cuenta |
| `/control/caja` | _(se elimina)_            | Duplicado del modal             |

### 2.3 Modo caja

En el monitor de la caja, la barra lateral arranca colapsada a íconos (56 px). Recupera ~200 px de ancho y, sobre todo, saca los 65 px de la barra superior actual, que hoy es `sticky` sobre otra cabecera `sticky`.

---

## 3. Venta rápida

La pantalla más importante. Objetivo: **una venta común con lector = escanear, escanear, F12.**

### 3.1 Disposición (1366×768)

```
┌──┬──────────────────────────────────────────────┬─────────────────────────────┐
│  │  ⌕ Código, nombre o F2 para buscar…          │  TICKET            3 ítems  │
│▣ │                                              ├─────────────────────────────┤
│  ├───────┬──────────────────────────────────────┤  Coca-Cola 2.25L            │
│🛒│ Favoritos │ Almacén │ Bebidas │ Limpieza │ ⋯ │    2 × 3.200        6.400   │
│  ├───────┴──────────────────────────────────────┤                             │
│📦│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │  Pan Lactal Bimbo           │
│  │ │Coca 2¼L│ │Pan Lact│ │Yerba 1k│ │Fernet  │  │    1 × 2.350        2.350   │
│📊│ │ $3.200 │ │ $2.350 │ │ $4.850 │ │$12.500 │  │                             │
│  │ │ 24 un. │ │ 12 un. │ │  8 un. │ │ 23 un. │  │  Yerba Playadito 1kg        │
│  │ └────────┘ └────────┘ └────────┘ └────────┘  │    1 × 4.850        4.850   │
│  │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │                             │
│  │ │Leche 1L│ │Azúcar  │ │Fideos  │ │Aceite  │  ├─────────────────────────────┤
│  │ │ $1.890 │ │ $1.560 │ │ $1.240 │ │ $3.450 │  │  Subtotal          13.600   │
│  │ │⚠ 3 un. │ │ 31 un. │ │ 18 un. │ │ 15 un. │  │  Descuento F9           —   │
│  │ └────────┘ └────────┘ └────────┘ └────────┘  │                             │
│  │                                              │  TOTAL          $ 13.600    │
│  │                                              │                             │
│  │                                              │  [ F12 · COBRAR ]           │
│  │                                              │  F8 en espera · Esc vaciar  │
└──┴──────────────────────────────────────────────┴─────────────────────────────┘
```

**Cambios respecto de hoy:**

- **Fichas en cuadrícula, no tabla.** Objetivo táctil de 120×90 px contra los 26 px de los botones `+`/`−` actuales. El precio y el stock se leen sin buscar la columna.
- **Favoritos y frecuentes primero.** Los veinte artículos que son el 80 % de las ventas, sin buscar ni escanear.
- **Pestañas por categoría**, para lo que no tiene código de barras (verdulería, fiambrería, suelto).
- **El ticket siempre visible a la derecha**, con el total en 48 px.
- **El foco vuelve al buscador después de cada acción** — pero de forma controlada, no con un `useEffect` sin dependencias que lo robe a los modales.

### 3.2 Atajos de teclado

| Tecla        | Acción                                                   |
| ------------ | -------------------------------------------------------- |
| _(escribir)_ | Va al buscador siempre, salvo que haya un modal abierto  |
| `Enter`      | Agrega el resultado exacto; si no existe, ofrece crearlo |
| `3 * Enter`  | Multiplica: agrega 3 unidades del último producto        |
| `F2`         | Buscar por nombre                                        |
| `F4`         | Cambiar cantidad del ítem seleccionado                   |
| `F8`         | Dejar la venta en espera                                 |
| `F9`         | Descuento (pide permiso si el rol no lo tiene)           |
| `F12`        | Cobrar                                                   |
| `Supr`       | Quitar el ítem seleccionado                              |
| `Esc`        | Vaciar (con confirmación si hay ítems)                   |
| `↑` `↓`      | Navegar el ticket                                        |

**El lector se aísla.** Hoy escucha en `window` y captura teclas incluso con un modal abierto — se verificó que eso mete productos al carrito sin que el cajero lo vea. Propuesta: detectar la ráfaga del lector (más de 3 caracteres a menos de 30 ms) y **suspender la captura mientras haya un diálogo abierto**.

### 3.3 Cobro (F12)

```
┌───────────────────────────────────────────────────────┐
│  COBRAR                                    Esc cerrar │
├───────────────────────────────────────────────────────┤
│                                                       │
│                TOTAL   $ 13.600                       │
│                                                       │
│   ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│   │ 1 EFECTIVO│ │ 2 TARJETA │ │3 TRANSFER.│           │
│   └───────────┘ └───────────┘ └───────────┘           │
│   ┌───────────┐ ┌───────────┐                         │
│   │4 CTA. CTE.│ │5 COMBINAR │                         │
│   └───────────┘ └───────────┘                         │
│                                                       │
│   Recibe   [ 20.000        ]   ← teclado numérico     │
│                                                       │
│              VUELTO   $ 6.400                         │
│                                                       │
│   [ ENTER · CONFIRMAR ]                               │
└───────────────────────────────────────────────────────┘
```

- **Vuelto calculado**, que hoy no existe.
- Botones de importe redondo ($10.000, $20.000, "justo").
- **Pago combinado**: efectivo + tarjeta en la misma venta.
- **Cuenta corriente** solo si el cliente está identificado y tiene crédito.
- Confirmación **en un solo paso** — hoy son tres clics para lo mismo.

### 3.4 Ventas en espera

Un almacén las necesita: el cliente vuelve a buscar algo, entra alguien apurado por un cigarrillo. `F8` deja la venta en espera con el nombre que se le quiera dar; una franja arriba muestra las que hay. **Y el carrito se persiste en el dispositivo**: hoy un F5 pierde la venta.

---

## 4. Inicio

Solo lo accionable. Cada tarjeta lleva al problema, no a una lista.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Buenas tardes, Bruno            Almacén Centro · Turno abierto 08:15   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐                     │
│  │ CAJA DEL TURNO       │  │ VENTAS DE HOY        │                     │
│  │ $ 184.500            │  │ $ 342.800   47 tick. │                     │
│  │ Inicial 20.000       │  │ ▲ 12 % vs. ayer      │                     │
│  │ [ Arquear ]          │  │ [ Ver detalle ]      │                     │
│  └──────────────────────┘  └──────────────────────┘                     │
│                                                                         │
│  REQUIEREN ATENCIÓN                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 🔴  3 productos sin stock                        [ Reponer ]    │    │
│  │ 🟠  11 productos por debajo del mínimo           [ Ver lista ]  │    │
│  │ 🟠  6 productos vencen en menos de 7 días        [ Ver lista ]  │    │
│  │ 🟠  2 productos sin precio cargado               [ Cargar ]     │    │
│  │ 🔵  1 orden de compra pendiente de recepción     [ Recibir ]    │    │
│  │ 🔴  Arqueo de ayer: faltante de $600             [ Revisar ]    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Si no hay nada pendiente: "Todo en orden. 47 ventas hoy."              │
└─────────────────────────────────────────────────────────────────────────┘
```

**Regla:** si no hay nada que atender, la sección desaparece. Un panel que siempre muestra seis alertas deja de mirarse a la semana.

---

## 5. Resto de las pantallas

### 5.1 Productos

Conserva el patrón actual (filtros + métricas + tabla + paginación), que es bueno, con tres cambios:

- **Paginación y búsqueda en el servidor.** Hoy se descarga el catálogo entero y filtra el navegador.
- **Columnas según permiso:** costo y margen solo para quien puede verlos.
- **Acciones masivas:** cambiar precios por porcentaje, reasignar categoría, activar/desactivar.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Productos                        [+ Nuevo]  [Importar]  [Exportar CSV]   │
├──────────────────────────────────────────────────────────────────────────┤
│ ⌕ nombre o código   Categoría ▾   Proveedor ▾   ☐ Bajo mínimo  ☐ Inactivos│
├──────────────────────────────────────────────────────────────────────────┤
│ 1.247 productos · $ 4.380.200 valorizado · 14 bajo mínimo · 3 sin stock  │
├──────┬────────────────────────┬──────────┬───────┬────────┬──────┬───────┤
│Código│ Nombre                 │ Categoría│ Stock │ Costo* │Precio│Margen*│
├──────┼────────────────────────┼──────────┼───────┼────────┼──────┼───────┤
│779…18│ Fernet Branca 750ml    │ Bebidas  │  23   │ 8.500  │12.500│ 32 %  │
│779…33│ Leche Entera 1L        │ Almacén  │ ⚠ 3   │ 1.290  │ 1.890│ 32 %  │
│779…07│ Yerba Playadito 1kg    │ Almacén  │   8   │ 3.400  │ 4.850│ 30 %  │
└──────┴────────────────────────┴──────────┴───────┴────────┴──────┴───────┘
                                     * solo con permiso productos.ver_costo
```

### 5.2 Edición de producto

Cuatro pestañas, para no volcar cuarenta campos en un formulario:

```
┌───────────────────────────────────────────────────────────────┐
│  Fernet Branca 750ml                          Esc  [Guardar]  │
├───────────────────────────────────────────────────────────────┤
│  ‹ General ›  Precios  Stock  Historial                       │
├───────────────────────────────────────────────────────────────┤
│  Nombre       [ Fernet Branca 750ml                        ]  │
│  Códigos      [ 7790000001918 ] [+ agregar otro]              │
│  Categoría    [ Bebidas        ▾ ]  Marca [ Branca        ]   │
│  Proveedor    [ Distribuidora Pampa ▾ ]                       │
│  Unidad venta [ unidad ▾ ]   Unidad compra [ caja de 6  ▾ ]   │
│  Ubicación    [ Góndola 3 · Estante B ]                       │
│  ☑ Activo    ☐ Discontinuado    ☐ Controla vencimiento        │
└───────────────────────────────────────────────────────────────┘
```

En **Precios**: costo, margen (se calculan mutuamente), precio, precio mayorista, impuestos.
En **Stock**: actual, mínimo, ideal, y el **ajuste con motivo obligatorio**.
En **Historial**: precios, costos y movimientos.

### 5.3 Caja

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Caja · Turno de Bruno Cajero                    Abierto 08:15   [Cerrar] │
├──────────────────────────────────────────────────────────────────────────┤
│  Inicial 20.000  +Ventas 342.800  +Ingresos 0  −Egresos 33.400           │
│  ESPERADO EN CAJA   $ 329.400                        [ Arquear ]         │
├──────────────────────────────────────────────────────────────────────────┤
│  Hoy ▾   Todos los medios ▾   ⌕ buscar                    [+ Movimiento] │
├──────┬──────────┬────────────┬──────────────────────┬────────┬───────────┤
│ Hora │ Tipo     │ Medio      │ Detalle              │  Monto │           │
├──────┼──────────┼────────────┼──────────────────────┼────────┼───────────┤
│ 18:42│ Venta    │ Efectivo   │ Ticket #1042 · 3 ít. │ 13.600 │ ▾  Anular │
│ 18:20│ Egreso   │ Efectivo   │ Flete verdulería     │ −8.400 │    Anular │
│ 17:55│ Venta    │ Tarjeta    │ Ticket #1041 · 1 ít. │  4.850 │ ▾  Anular │
│ 16:10│ Retiro   │ Efectivo   │ A banco              │−25.000 │    Anular │
└──────┴──────────┴────────────┴──────────────────────┴────────┴───────────┘
```

**Lo nuevo:** el esperado se calcula (hoy `currentCash` es un acumulador desde el origen de los tiempos), el filtro de fechas existe de verdad, hay botón para cargar un movimiento (hoy el modal está pero ningún botón lo abre) y anular funciona (hoy da 405).

### 5.4 Cierre de caja

```
┌───────────────────────────────────────────────────────────┐
│  CERRAR TURNO · Bruno Cajero · 08:15 → 20:30              │
├───────────────────────────────────────────────────────────┤
│  Esperado en efectivo                    $ 329.400        │
│                                                           │
│  Contado          $2000 [  12 ]   $1000 [  45 ]           │
│                    $500 [  30 ]    $200 [  18 ]           │
│                    $100 [  22 ]   Otros [ 3.400 ]         │
│                                                           │
│  TOTAL CONTADO                           $ 328.800        │
│  DIFERENCIA                              − $ 600  ⚠       │
│                                                           │
│  Observación (obligatoria si hay diferencia)              │
│  [ Vuelto mal dado en la tarde                        ]   │
│                                                           │
│  Supervisor            [ Ana Duenia ▾ ]  [ contraseña ]   │
│                                                           │
│  [ Cancelar ]                        [ CERRAR TURNO ]     │
└───────────────────────────────────────────────────────────┘
```

Conteo por denominación (el cajero cuenta billetes, no calcula), diferencia visible **antes** de confirmar, observación obligatoria si no cuadra, autorización de supervisor si supera un umbral configurable, y **cierre inmutable**: una vez cerrado no se edita, se corrige con un asiento nuevo.

### 5.5 Compra a proveedor y recepción

```
┌───────────────────────────────────────────────────────────────────────┐
│  ORDEN DE COMPRA #34 · Distribuidora Pampa      Estado: Pendiente     │
├──────────────────────────┬────────┬─────────┬─────────┬───────────────┤
│ Producto                 │ Pedido │ Recibido│  Costo  │   Subtotal    │
├──────────────────────────┼────────┼─────────┼─────────┼───────────────┤
│ Fernet Branca 750ml      │  12    │ [ 12 ]  │ [8.500] │      102.000  │
│ Coca-Cola 2.25L          │  24    │ [ 20 ]  │ [2.180] │       43.600  │
│ Yerba Playadito 1kg      │   6    │ [  0 ]  │ [3.400] │            0  │
├──────────────────────────┴────────┴─────────┴─────────┴───────────────┤
│  ⚠ 4 Coca-Cola y 6 Yerba no llegaron.                                 │
│    ○ Recepción parcial, queda pendiente   ● Cerrar y ajustar el pedido│
│                                                                       │
│  ⚠ El costo del Fernet subió de $8.100 a $8.500 (+4,9 %).             │
│    Precio actual $12.500 → margen baja de 35 % a 32 %.                │
│    ☑ Actualizar costo    ☐ Recalcular precio manteniendo el margen    │
│                                                                       │
│  [ Cancelar ]                                    [ CONFIRMAR INGRESO ]│
└───────────────────────────────────────────────────────────────────────┘
```

La recepción es donde de verdad se gana o se pierde plata en un almacén: **lo que llegó, a qué costo, y qué pasa con el precio de venta.** Que el sistema avise que el margen se comió el aumento es más valioso que cualquier reporte.

### 5.6 Reportes

Un buscador de reportes, no un panel de gráficos. Cada uno con rango de fechas, sucursal y exportación a CSV.

```
Ventas          por día · por hora · por cajero · por medio de pago · por sucursal
Productos       más vendidos · menos vendidos · sin movimiento · margen por producto
Inventario      stock valorizado · stock inmovilizado · por vencer · diferencias
Caja            arqueos · diferencias por cajero · egresos por concepto
Compras         por proveedor · deuda a proveedores · evolución de costos
Clientes        deuda por cliente · vencidas · ventas fiadas
```

**Ventas por hora** es el más útil y el que nadie pide: dice cuándo hace falta un segundo cajero.

### 5.7 Usuarios y permisos

```
┌────────────────────────────────────────────────────────────────────┐
│  Bruno Cajero · @cajero                              [Guardar]     │
├────────────────────────────────────────────────────────────────────┤
│  Rol base  [ Cajero ▾ ]     Sucursal [ Centro ▾ ]     ☑ Activo     │
├────────────────────────────────────────────────────────────────────┤
│  PERMISOS                              del rol   ajuste            │
│  Registrar ventas                        ☑        —                │
│  Aplicar descuentos                      ☐       ☑ hasta 10 %      │
│  Anular ventas                           ☐        —                │
│  Ver costos y márgenes                   ☐        —                │
│  Modificar precios                       ☐        —                │
│  Abrir y cerrar caja                     ☑        —                │
│  Registrar egresos                       ☐       ☑                 │
│  Ajustar stock                           ☐        —                │
│  Ver reportes                            ☐        —                │
│  Acceder a otras sucursales              ☐        —                │
└────────────────────────────────────────────────────────────────────┘
```

El rol es un preajuste; el permiso es lo que se verifica. Así "Bruno puede hacer descuentos de hasta 10 % pero no anular" se expresa sin inventar un rol nuevo.

---

## 6. Patrones transversales

| Patrón           | Regla                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Confirmación** | Proporcional al daño: cambio reversible → sin confirmar, con deshacer; irreversible → modal nombrando el objeto; financiero → modal + motivo + permiso |
| **Estado vacío** | Explica qué es la sección y ofrece la acción para empezar. Nunca una tabla en blanco                                                                   |
| **Errores**      | Junto al campo que falló, en lenguaje de almacén: "El stock quedaría en −3. Autorizá la venta en negativo o corregí la cantidad"                       |
| **Carga**        | Esqueleto con la forma del contenido; nunca spinner y datos viejos a la vez                                                                            |
| **Guardado**     | Optimista con posibilidad de deshacer, salvo en dinero y stock, donde se espera la confirmación del servidor                                           |
| **Modales**      | Solo para decisiones que bloquean. Editar un producto es una página o un panel lateral, no un modal                                                    |
| **Tablas**       | Cabecera fija, filas alternas, cifras tabulares, orden por columna, densidad configurable                                                              |
| **Dinero**       | Siempre con signo y color: `+13.600` verde, `−8.400` rojo                                                                                              |
| **Fechas**       | Relativas hasta 7 días ("hace 2 h"), absolutas después                                                                                                 |

---

## 7. Qué se conserva del sistema actual

No todo hay que rehacerlo. Se conserva:

- El **flujo escanear → carrito → confirmar**, que es correcto.
- El **alta rápida de producto desde el escáner**: es una idea muy buena para un almacén, que carga productos mientras vende. Se mantiene, pidiendo categoría en vez de forzar `categoryId: 1`.
- La estructura de **Productos** (filtros + métricas + tabla + paginación).
- La **tabla de caja con detalle expandible** por venta.
- El **doble paso del arqueo** de `CashControlModal`, que es el patrón de confirmación mejor resuelto del proyecto.
- La **disciplina de auditoría**: casi toda mutación deja registro con `before`/`after`. Es una base valiosa.

---

## 8. Orden de implementación

| #   | Entrega                                                                                                          | Depende de                     |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Base visual: tema en CSS, tipografía, colores semánticos, componentes (botón, campo, tabla, modal, estado vacío) | —                              |
| 2   | Barra de navegación por permisos + inicio accionable                                                             | permisos del servidor (Fase 1) |
| 3   | **Venta rápida**: cuadrícula, favoritos, atajos, cobro con vuelto, ventas en espera                              | precios del servidor (Fase 0)  |
| 4   | Caja: turnos, arqueo con diferencia, cierre inmutable                                                            | modelo `CashSession` (Fase 2)  |
| 5   | Productos y stock: costos, mínimos, ajustes con motivo                                                           | esquema ampliado (Fase 3)      |
| 6   | Compras y recepción                                                                                              | módulo de compras (Fase 3)     |
| 7   | Reportes                                                                                                         | —                              |
| 8   | Usuarios, permisos, sucursales, configuración                                                                    | permisos (Fase 1)              |

Detalle y dependencias completas en [MASTER_ROADMAP.md](MASTER_ROADMAP.md).
