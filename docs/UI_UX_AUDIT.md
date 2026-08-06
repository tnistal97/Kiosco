# Auditoría de interfaz y experiencia de uso

> Basada en un recorrido **real** de la aplicación corriendo en `localhost:3000`, con una base PostgreSQL descartable en el puerto 5433 y 47 productos, 24 ventas, 2 sucursales y 3 usuarios ficticios.
> Las mediciones de layout, altura de objetivos táctiles y desbordes se tomaron del DOM en vivo, no del código.

## Cómo se levantó el entorno

| | |
|---|---|
| Base | Instancia PostgreSQL 18 **aislada**, creada con `initdb` en el directorio temporal de la sesión, escuchando en `127.0.0.1:5433` |
| Aislamiento | No se tocó el PostgreSQL del sistema (puerto 5432) ni ninguna base existente. La instancia es descartable |
| Esquema | Aplicado con `psql` desde `prisma/migrations/20250605201717_.../migration.sql`. **No se usó `prisma db push`, `migrate deploy`, `migrate reset` ni `db seed`**, según la restricción del brief |
| Datos | Script propio con productos y precios ficticios de almacén argentino. Ningún dato real |
| Producción | **No se tocó.** El servidor sigue con PM2 detenido |

**Limitación:** no se pudieron tomar capturas de pantalla porque el panel de navegador no estaba visible durante la sesión. En su lugar se midieron directamente las propiedades geométricas del DOM, que dan datos más precisos que una imagen. Las capturas quedan pendientes si se las quiere para el expediente.

---

## 1. Lo que se rompe en el uso real

Estos cuatro se reprodujeron en vivo. Son los que un empleado va a sufrir en un día normal.

### 1.1 · El escáner carga productos al carrito mientras hay un modal abierto

**Reproducido.** Secuencia: se escanea un código que no existe → se abre el modal "Crear nuevo producto" → el cajero escanea el código del producto para no tipearlo → **el producto se agrega al carrito de atrás**, invisible bajo el modal.

En la prueba, con el modal abierto, una ráfaga de escáner sobre el código de Fernet Branca dejó el carrito así:

```
🛒 Carrito   Fernet Branca 750ml   1 × $ 12.500,00   Total: $ 12.500,00
```

El cajero no lo ve. Si después confirma la venta, le cobra $12.500 de más al cliente.

**Causa:** `src/app/caja/page.tsx:155-191` registra `window.addEventListener('keydown')` y acumula toda tecla alfanumérica en un buffer, sin importar qué elemento tiene el foco ni si hay un modal abierto. El buffer se descarta a los 200 ms entre teclas — un humano tipeando no lo dispara, pero **un lector USB sí**, porque emite las teclas mucho más rápido.

**Severidad: alta.** Es un error de cobro silencioso.

### 1.2 · El buscador roba el foco

**Reproducido parcialmente.** Al abrirse el modal "Crear nuevo producto", el foco queda en el buscador de atrás (`search-input`), no en el primer campo del modal. El cajero tiene que hacer clic para empezar a escribir.

**Causa:** `src/components/caja/SearchBar.tsx:23-25`:

```ts
useEffect(() => { inputRef.current?.focus() })   // sin array de dependencias
```

Sin array de dependencias, se ejecuta **en cada render**. Mientras el modal esté abierto, cualquier cosa que haga re-renderizar la página de caja —una recarga de productos, un cambio en el carrito, el debounce de búsqueda— devuelve el foco al buscador y lo saca del formulario.

**Severidad: alta** en un flujo que debe ser 100 % de teclado.

### 1.3 · El botón de eliminar venta no funciona

**Reproducido:** `DELETE /api/sales/1` → **HTTP 405**.

En la pantalla Ventas, cada fila de venta tiene un ícono de papelera con su modal de confirmación. El usuario confirma, y recibe el toast rojo "Error al eliminar la venta". Está roto por dos motivos independientes:

1. `src/app/api/sales/[id]/route.ts` está **íntegramente comentado** — la ruta no existe.
2. `src/components/ventas/MovimientoRow.tsx:109` pasa `saleId={m.id}`, que es el id del **movimiento de caja**, no el de la venta.

La operación correcta (`DELETE /api/cash/[id]`) sí está implementada, es transaccional y repone stock — y **no se llama desde ningún lado**.

**Severidad: alta.** Anular una venta mal cargada es una operación diaria en un almacén.

### 1.4 · Un cajero puede hacer todo lo que hace el dueño

**Reproducido.** Con la sesión de "Bruno Cajero" (rol `vendedor`):

| Acción | Resultado |
|---|---|
| Cambiar el precio del Fernet de $12.500 a **$1** | HTTP 200 — aplicado |
| Borrar un producto del catálogo | HTTP 200 — borrado |
| Abrir `/admin/auditoria` escribiendo la URL | **Se abrió.** Vio la bitácora de la dueña |
| Consultar `/api/users`, `/api/audit`, `/api/admin/sales` | HTTP 200 en todos |

La barra de navegación **sí oculta** los enlaces de administración a los no-admin. Pero ocultar el botón no cierra la puerta: la página se abre escribiendo la dirección. Además, la respuesta de edición de producto devuelve el campo `value` (el costo), de modo que el cajero ve el margen.

Detalle técnico completo en [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

---

## 2. Jerarquía visual y navegación

### 2.1 · La pantalla de venta desperdicia un cuarto del monitor

Medido en 1366×768, la resolución típica de un monitor de caja:

| Elemento | Alto |
|---|---|
| Barra de navegación (`sticky`) | 65 px |
| Cabecera de búsqueda (`sticky`) | 71 px |
| Relleno y márgenes | 64 px |
| **Total antes del primer producto** | **200 px — el 26 % de la pantalla** |
| Alto de cada fila de producto | 61 px |
| **Productos visibles sin scrollear** | **9** |

Con 47 productos hay que scrollear cinco pantallas. En un almacén con mil artículos, la tabla es inutilizable sin buscar.

Además, **las 46 filas están en el DOM** simultáneamente: no hay paginación ni virtualización en la pantalla de caja (sí la hay en Productos). Con un catálogo grande el navegador de la caja se va a arrastrar.

### 2.2 · La landing muestra la aplicación a quien no inició sesión

**Reproducido.** Abriendo `http://localhost:3000/` sin ninguna sesión, la barra superior muestra:

```
🧃 KioscoApp  |  Caja  Productos  Ventas  Cierre Caja  |  [Cerrar sesión]
```

Con el nombre de usuario vacío. `/` es ruta pública y `layout.tsx` renderiza el `Navbar` incondicionalmente. Un visitante ve el mapa completo del sistema y un botón de "Cerrar sesión" sin haber iniciado ninguna.

### 2.3 · La navegación no representa un almacén

La barra tiene tres enlaces (Caja, Productos, Ventas), un botón (Cierre Caja) y dos enlaces más si sos admin. Faltan por completo: stock, proveedores, compras, clientes, reportes, usuarios, sucursales, configuración.

Y los nombres confunden:

| Etiqueta | Lo que realmente es |
|---|---|
| **Caja** | El punto de venta |
| **Ventas** | El listado de movimientos de caja |
| **Cierre Caja** | Un arqueo (registra el monto contado, no cierra nada) |
| `/control/caja` | El mismo arqueo, en una página sin enlaces |

Un empleado nuevo va a "Ventas" buscando las ventas y encuentra la caja. Va a "Caja" buscando la caja y encuentra el punto de venta.

### 2.4 · El inicio no es un panel

`/` es una landing de marketing con el eslogan *"Controlá productos, ventas y stock con una app simple, rápida y elegante"* y un botón "¿Necesitás ayuda?" que ejecuta `alert('Contacto: soporte@kioscoapp.com')`. Un empleado que abre el sistema no ve nada accionable: ni la caja del día, ni alertas de stock, ni ventas.

---

## 3. Coherencia visual

### 3.1 · Cada pantalla decide su propio tema

Medido en el HTML servido:

| Pantalla | Clase de fondo | Comportamiento |
|---|---|---|
| `/caja` | `bg-gray-100 dark:bg-gray-900` | Sigue la preferencia del sistema operativo |
| `/productos` | `bg-gray-900` | **Siempre oscuro** |
| `/ventas` | `bg-gray-900` | **Siempre oscuro** |
| `/admin/auditoria` | `bg-gray-900` | **Siempre oscuro** |
| `/login`, `/` | `bg-gradient-to-br from-blue-100…` | Degradado celeste, sigue el sistema |

En una máquina con el sistema en modo claro, el cajero pasa de una caja blanca a un catálogo negro y vuelve. En modo oscuro, de una caja negra a un login celeste.

### 3.2 · La configuración de diseño no se aplica

`tailwind.config.js` define una paleta (`primary`, `card`, `border`, `text`), la tipografía Inter y `darkMode: 'class'`. **Nada de eso llega al CSS final.**

El proyecto usa Tailwind 4, que ignora los archivos de configuración JavaScript salvo que se los cargue explícitamente con la directiva `@config` en el CSS. `globals.css` no lo hace. Consecuencias:

- Los colores del sistema de diseño no existen; todo el código usa `blue-600`, `gray-800`, etc. directamente.
- `globals.css:5` usa `theme('fontFamily.sans')`, sintaxis de Tailwind 3.
- `darkMode: 'class'` se ignora → **el modo oscuro no se puede alternar desde la aplicación**, lo decide el sistema operativo. Para un monitor de caja fijo eso es un problema: no se puede elegir el tema.

### 3.3 · Toasts con estilos copiados a mano

El mismo objeto de estilo de ocho propiedades (`background: '#1f2937'`, `fontSize: '1.2rem'`, `border: '2px solid #374151'`…) aparece copiado literalmente en seis archivos. Cambiar la apariencia de las notificaciones exige editar seis lugares.

---

## 4. Adaptación a pantallas

Probado en las cuatro resoluciones pedidas.

| Resolución | Resultado |
|---|---|
| **1920×1080** (escritorio) | Correcto. El carrito lateral ocupa un tercio; sobra espacio horizontal sin aprovechar |
| **1366×768** (monitor de caja) | Funcional pero apretado: 26 % de cromo, 9 productos visibles |
| **768×1024** (tablet) | El carrito lateral desaparece (`hidden md:flex` corta en 768). Se pasa al modal de carrito. Aceptable |
| **375×812** (móvil) | **Falla.** Ver abajo |

### 4.1 · La barra de navegación desborda en móvil

Medido a 375 px de ancho:

| | |
|---|---|
| Ancho del contenedor | 375 px |
| Suma del ancho de sus hijos | **718 px** |
| Lista de enlaces (`ul`) sola | 395 px |
| ¿Hay menú hamburguesa? | **No** |

Los elementos se comprimen y superponen dentro de un contenedor que mide la mitad de lo necesario. No hay menú colapsable, ni scroll horizontal deliberado, ni versión reducida. El `<body>` no desborda solo porque los hijos se achican, no porque el diseño se adapte.

### 4.2 · Objetivos táctiles

En la pantalla de caja a 375 px: **50 de 55 elementos interactivos miden menos de 44 px de alto.**

Los peores son los del flujo de venta: los botones `−` / `+` / `❌` de cada fila usan `px-3 py-1`, unos 26 px. Sobre una pantalla táctil, con las manos ocupadas y a las siete de la tarde, son imposibles de acertar. La recomendación de accesibilidad (WCAG 2.5.5) es 44×44 px.

---

## 5. Formularios, validaciones y estados

### 5.1 · Diálogos nativos del navegador

| Dónde | Qué usa |
|---|---|
| `productos/page.tsx:130` | `confirm('¿Confirma que desea eliminar este producto?')` |
| `productos/page.tsx:126` | `alert('Función de exportar CSV no implementada.')` |
| `caja/NewProductModal.tsx:50` | `alert('✅ Producto creado correctamente.')` |
| `ventas/NewMovementModal.tsx:26,44` | `alert('El monto no puede ser cero.')` |
| `page.tsx:25` | `alert('Contacto: soporte@kioscoapp.com')` |

Los diálogos nativos bloquean el hilo, no se pueden estilar, en algunos navegadores se pueden silenciar, y en pantalla táctil aparecen fuera de contexto. El proyecto **ya tiene** `react-hot-toast` y un componente `Modal` propio; conviven sin criterio.

### 5.2 · Validación solo en el cliente, y desigual

- `NewProductModal` exige nombre, stock y precio, pero **fija `categoryId: 1`** sin preguntar. Todo producto creado desde el escáner cae en la categoría con id 1, exista o no.
- `ProductoModal` valida `price > 0` en el cliente; la API acepta cualquier número, incluido negativo.
- `NewMovementModal` valida `amount !== 0`, pero acepta negativos y **falla siempre**: envía `{amount, paymentMethod, description}` mientras la API exige además `movementType` → HTTP 400. Es funcionalidad muerta: además, ningún botón abre ese modal.
- Ningún formulario indica qué campos son obligatorios antes de intentar enviar; el error llega después.

### 5.3 · Estados vacíos, de carga y de error

Lo que está bien:

- La tabla de productos de la caja tiene un esqueleto de carga animado.
- El estado vacío de la caja (`🛒 No hay productos / Intenta otra búsqueda`) es correcto.
- El error de carga de productos (`⚠️ Error al cargar productos` + botón "Reintentar") está bien resuelto — se verificó levantando la app sin base.

Lo que falta:

- El estado vacío de la tabla de caja dice *"Ajusta el filtro de fechas o método de pago"* — **esos filtros no existen** en la pantalla.
- `/ventas` muestra el spinner "Actualizando..." **y** la tabla al mismo tiempo, así que la tabla parpadea entre datos viejos y nuevos.
- La auditoría no tiene estado vacío: si no hay registros, se ve una sección en blanco.
- Ningún formulario muestra estado de error por campo; todo va a un toast global.

### 5.4 · Acciones peligrosas sin fricción proporcional

| Acción | Confirmación actual | Debería |
|---|---|---|
| Eliminar producto | `confirm()` nativo | Modal, nombre del producto, aviso si tiene stock o ventas |
| Anular venta | Modal (correcto) — pero está roto | Modal + motivo obligatorio + permiso |
| Vaciar carrito | **Ninguna** | Confirmación si hay ítems cargados |
| Registrar arqueo | Doble paso (correcto) | Mantener, y mostrar la diferencia esperada |
| Borrar catálogo completo | **Ninguna** (`DELETE /api/products`) | Que no exista como endpoint |

El único flujo con doble confirmación bien hecho es el arqueo de `CashControlModal`: valida, muestra el monto y pide confirmar. Es el patrón a replicar.

---

## 6. Velocidad del flujo de venta

Camino más corto para vender un producto con lector, hoy:

1. Escanear → el producto entra al carrito. **1 acción.**

Bien. El problema aparece en todo lo demás:

| Situación | Acciones hoy |
|---|---|
| Cambiar la cantidad de un ítem | Buscarlo en la tabla y hacer clic en `+` tantas veces como haga falta. **No se puede escribir la cantidad** |
| Cobrar | Elegir método en un `<select>` → clic "Confirmar Venta" → clic "Confirmar Venta" en el modal. **3 acciones** |
| Calcular el vuelto | **No existe.** Lo hace el cajero de cabeza |
| Cobrar en dos medios | **No existe** |
| Aplicar un descuento | **No existe** |
| Dejar una venta en espera | **No existe.** Hay que vaciar el carrito y perderla |
| Vender algo sin código de barras | Buscarlo por nombre en una tabla de 47+ filas y hacer clic en "Agregar" |
| Devolver un producto | **No existe** |
| Reimprimir un comprobante | **No existe** (tampoco hay comprobante) |

**No hay ningún atajo de teclado** más allá del Enter del escáner. Ni F-teclas para el método de pago, ni Escape para cancelar, ni un campo de cantidad tipo `3 * <código>`.

Y el carrito **no persiste**: vive solo en memoria (`store/cart.ts`, Zustand sin `persist`). Un F5, un cierre accidental de pestaña o un corte de luz pierden la venta en curso.

---

## 7. Accesibilidad

**A favor:** los botones de acción del carrito tienen `aria-label` descriptivos ("Agregar Fernet Branca 750ml al carrito"); el buscador tiene `aria-label`; los modales usan `@headlessui/react` en dos de los cinco casos, que aporta el manejo de foco correcto.

**En contra:**

- Los modales propios (`NewProductModal`, `ConfirmSaleModal`) son `<div>` con `fixed inset-0`, sin `role="dialog"`, sin `aria-modal`, sin atrapar el foco ni cerrar con Escape.
- El estado de stock crítico se comunica **solo por color** (`bg-red-100`). Sin ícono ni texto, no se percibe con daltonismo.
- Ningún estilo `focus-visible` propio: la navegación por teclado usa el anillo del navegador, que sobre `bg-gray-900` casi no se ve.
- Contraste bajo en varios textos secundarios: `text-gray-400` sobre `bg-gray-800`, y `text-gray-500` sobre fondos oscuros en los estados vacíos.
- Sin enlace para saltar al contenido, sin `lang` en subsecciones, sin regiones `aria-live` para los toasts.
- La tabla de productos no tiene `scope` en los encabezados ni `<caption>`.

---

## 8. Rendimiento percibido

| Observación | Medición |
|---|---|
| La caja recarga **todo** el catálogo después de cada venta (`fetchProducts()`) | 47 productos hoy; con miles, cada venta congela la pantalla |
| Las 46 filas están todas en el DOM, sin virtualización | Confirmado |
| `/ventas` hace N+1 consultas: una por movimiento para traer sus ítems | 26 movimientos → 27 consultas |
| `/admin/auditoria` trae toda la bitácora sin paginar | 37 registros hoy; crece sin techo |
| Cada navegación ejecuta `jwt.verify` + una consulta a la base en el layout raíz | Una consulta extra por página |
| Advertencia del servidor de desarrollo | `⚠ Webpack is configured while Turbopack is not` — `next-pwa` configura Webpack pero `npm run dev` usa `--turbopack` |

---

## 9. Resumen de prioridades de UI/UX

### Corregir antes que nada (rompen la operación)

1. El escáner carga productos al carrito con modales abiertos (§1.1)
2. El buscador roba el foco de los formularios (§1.2)
3. Anular una venta devuelve 405 (§1.3)
4. Las pantallas de administración se abren por URL a cualquier rol (§1.4)

### Corregir en la nueva experiencia de caja

5. Cantidad escribible y atajos de teclado (§6)
6. Vuelto, pago combinado y descuentos (§6)
7. Ventas en espera y persistencia del carrito (§6)
8. Recuperar el alto útil de la pantalla: 26 % de cromo es demasiado (§2.1)
9. Objetivos táctiles de 44 px en todo el flujo de venta (§4.2)

### Corregir en la base visual

10. Un solo tema, decidido por la aplicación y alternable (§3.1, §3.2)
11. Cargar realmente el sistema de diseño o migrarlo a CSS (§3.2)
12. Barra de navegación responsive con menú colapsable (§4.1)
13. Reemplazar `alert`/`confirm` por los componentes propios (§5.1)
14. Renombrar las secciones según lo que hacen (§2.3)
15. Convertir el inicio en un panel accionable (§2.4)
