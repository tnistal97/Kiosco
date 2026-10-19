# Entrega al primer almacén — interfaz

> Rama `feat/ux-v2-phase2-1-lista-navegacion`. Detalle técnico completo, con la tabla de
> problemas y cada archivo tocado: [UX_V5_ALMACEN.md](UX_V5_ALMACEN.md).
> Capturas finales: [`docs/entrega-almacen/capturas/`](entrega-almacen/capturas/).

## 1. Objetivo

Que una persona que entra por primera vez, sin capacitación, pueda **vender, ver la
caja, encontrar un producto, consultar el stock y hacer un inventario**. Mostrador con
computadora (1366 × 768 o 1920 × 1080), teclado y lector USB de códigos de barras.

## 2. Problemas UX originales

- Tema oscuro y menú de 18 entradas en 6 grupos; inicio con 10 tarjetas.
- En Vender, ← → en la lista **sumaban unidades** y Enter **volvía a sumar**; Enter
  sobre un producto ya cargado sumaba otro; teclas sostenidas se repetían 30 veces por
  segundo; después de tocar un botón el lector escribía en la nada.
- Cobro con seis botones chicos y un segundo diálogo siempre.
- Caja con cinco cifras chicas y un "Nuevo movimiento" con tres tipos.
- Alta de producto con ~13 campos en 5 secciones.
- Inventario cortado en 100 productos, "conteo a ciegas" por omisión y **aplicar sin
  confirmación**.
- Bordes de campos y deshabilitados por debajo del contraste mínimo, foco invisible.

## 3. Decisiones de diseño

- **Fondo claro**, texto casi negro, bordes visibles (3:1), **un solo color de acción**
  (azul). Verde solo éxito, ámbar solo advertencia, rojo solo error o peligro.
- Botones grandes con verbos simples ("Cobrar", "Registrar ingreso", "Guardar
  producto"); etiquetas permanentes en los campos; nada de gradientes ni sombras.
- Tablas con pocas columnas; lo secundario se oculta en pantallas angostas.
- Lo que el almacén no usa se **oculta con una variable**, sin borrar nada (§12).
- Si dos opciones chocaban, ganó la más simple para un empleado nuevo.

## 4. Navegación final

**Inicio · Vender · Caja · Productos · Stock · Inventario**, separados de
**Clientes · Reportes · Configuración**. Cada entrada aparece solo si el rol tiene el
permiso. El inicio tiene cinco accesos grandes (Vender, Caja, Productos, Stock, Hacer
inventario) y tres datos: Ventas de hoy, Caja y Productos con poco stock.

## 5. Vender (`/venta`)

Flujo único: **buscar o escanear → ticket → TOTAL → Cobrar**. Un solo campo sirve para
escanear o escribir el nombre. El ticket muestra cada línea con − cantidad + y "Quitar";
el **TOTAL** va en grande con el botón **Cobrar**.

Cobro: TOTAL arriba, **¿Cómo paga?** con seis opciones grandes (Efectivo,
Transferencia, Mercado Pago, Débito, Crédito, Fiado), y en efectivo **RECIBIDO** y
**VUELTO** lado a lado; botón **Confirmar venta**. Si no hay vuelto, la venta termina
sola con un aviso; si hay, queda el VUELTO en grande y "Nueva venta".

## 6. Gramática exacta de teclado

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

## 7. Lector de códigos de barras

Cualquier lector USB que escriba como teclado (CÓDIGO + Enter), sin configurarlo. No
depende de un escucha global frágil: el campo de venta recibe la lectura y la reconoce
por su ritmo (≥ 6 dígitos con ≤ 40 ms entre teclas).

- **Dos lecturas, dos unidades.** Una lectura agrega exactamente una.
- **Con el foco en otro botón**: la primera tecla devuelve el foco al campo y se
  escribe ahí en el acto, así que no se pierde ningún dígito.
- **Encima de un nombre a medio escribir** ("coc" + lectura): se agrega el producto y
  vuelve "coc".
- **Después de números escritos a mano** ("123" o "agua 500" + lectura): se separa lo
  escrito de lo leído por el ritmo de las teclas y por el dígito verificador del código;
  se agrega el producto y vuelve lo escrito.
- **Nuevo producto**: Enter en "Código de barras" no guarda el formulario; muestra
  **✓ Código detectado**, avisa si el código ya es de otro producto y pasa a "Guardar".
- **Inventario**: escanear lleva a la cantidad de ese producto; Enter guarda y vuelve.
  Si se escanea con el cursor en otra cantidad, no la llena de dígitos: busca el
  producto y lleva a su cantidad.

## 8. Caja

**CAJA ABIERTA** (verde) o **CAJA CERRADA** (ámbar, con "Abrir caja"). Abierta: la cifra
grande **Tiene que haber en el cajón**, con "Empezó con", y debajo **Ventas de hoy**,
Ventas en efectivo, Ingresos y Egresos. Cuatro acciones: **Registrar ingreso**,
**Registrar egreso**, **Contar caja**, **Cerrar caja**. Movimientos, conteos y cajas
anteriores quedan detrás de **Ver detalle**.

## 9. Productos

Tabla **Producto · Categoría · Precio · Stock · Código de barras · Acciones** (botón
**Editar** visible). Buscador grande por nombre o código, filtro de categoría,
**+ Nuevo producto** y "Más acciones" (cambiar precios, importar desde Excel, dados de
baja). El alta muestra **Nombre, Categoría (con "+ Nueva"), Precio, Unidades que tenés
ahora y Código de barras**; costo, unidad de venta, mínimo y otros códigos van en
**Más opciones**. Crear una categoría desde la ficha no borra lo escrito, y editar un
producto no toca sus códigos alternativos si todavía no se leyeron.

## 10. Stock

`/stock`: **Producto · Stock actual · Estado · Ajustar**. Estados **● Stock normal**,
**▲ Stock bajo** (ámbar) y **✕ Sin stock** (rojo), con palabra y símbolo. Filtros
**Todos / Stock bajo (N) / Sin stock (N)** y categoría. En Productos solo se marcan
los dos que piden atención, para no llenar la tabla de etiquetas.

`/stock/movimientos`: **Fecha · Producto · Movimiento · Cantidad · Motivo**, con
palabras simples (Venta, Entrada, Corrección, Ajuste de inventario…) y cantidades con
signo ("+10", "−2"). Filtros **Hoy / 7 días / 30 días / Todos** y buscador.

## 11. Inventario

**Nuevo inventario** → todo el negocio o una categoría → **Contar** → **Revisar
diferencias** → **Listo**, con los pasos a la vista.

- Tabla **Producto · Sistema · Contado · Diferencia**; color solo en la diferencia
  (rojo falta, ámbar sobra, ✓ coincide).
- Cada cantidad se guarda sola con Enter o al salir del campo y muestra **✓ Guardado**
  (también en el teléfono). Enter pasa **en el acto** a la próxima cantidad y guarda en
  segundo plano: lo que se teclea rápido va a la línea siguiente, no a la recién
  confirmada. Cada cantidad viaja **una sola vez**: Enter y "al salir" no la mandan dos
  veces (probado contando los envíos).
- Lector o nombre para encontrar el producto; paginado de a 100 sin cortar; filtros
  Sin contar / Contados / Todos. En "Sin contar", "Siguiente" no saltea productos:
  los contados salen de la lista y entran los que seguían.
- Revisar: **"Encontramos diferencias en X productos."** con Faltan / Sobran /
  Coinciden. **APLICAR INVENTARIO** pide confirmación ("Esto no se puede deshacer").
- "Contar dos veces" (en Más opciones) pide el segundo conteo **una sola vez**; el
  servidor y la pantalla siguen la misma regla.

## 12. Funciones ocultas

| Función                                     | Dónde se oculta                                                   |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Lotes y vencimientos                        | Menú, Stock, ficha del producto, movimientos, inventario          |
| Compras: Órdenes, Proveedores, Devoluciones | Menú, inicio, ficha del producto (proveedor), reportes de compras |

Nada se borró: tablas, API y datos siguen. Entrar a mano a `/stock/lotes` lleva a
`/stock`; `/compras`, `/proveedores`, `/devoluciones` y `/comprobantes/proveedor/*` llevan
al inicio. Verificado contra la aplicación en modo almacén: el menú solo muestra
Inicio, Vender, Caja, Productos, Stock, Inventario, Clientes, Reportes y Configuración,
y ninguna pantalla menciona lotes ni compras.

## 13. Variable `KIOSCO_FUNCIONES`

| Valor                       | Qué se ve                                                 |
| --------------------------- | --------------------------------------------------------- |
| **vacía o sin definir**     | **Modo almacén** (esta instalación): sin Lotes ni Compras |
| `lotes`                     | Agrega Lotes y vencimientos                               |
| `compras`                   | Agrega Órdenes, Proveedores y Devoluciones                |
| `todas` (o `lotes,compras`) | Todo                                                      |

**Para el primer almacén: `KIOSCO_FUNCIONES=` (vacía).** Se lee al atender cada pedido:
cambiarla es editar el entorno y reiniciar, sin recompilar. Las pruebas automáticas
corren con `todas` para seguir cubriendo el sistema completo.

## 14. Responsive

Prioridad: la computadora del mostrador.

| Tamaño               | Qué se comprobó                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1366 × 768           | Venta, ticket, TOTAL y cobro (RECIBIDO, VUELTO, Confirmar venta) sin desplazarse (pruebas e2e y capturas 02–03); todas las pantallas de la entrega |
| 1920 × 1080          | Inicio, Caja, Productos, Stock, Inventario y cobro: sin desbordes; "Confirmar venta" a la vista                                                    |
| Tableta (768 × 1024) | Las mismas pantallas y el cobro: sin desborde horizontal; tablas con columnas secundarias ocultas                                                  |
| Teléfono (375 × 812) | Inicio, Vender, Productos e Inventario (capturas 12–15); tablas como tarjetas, menú en cajón, total y Cobrar fijos abajo                           |

En la revisión final se corrigieron tres detalles que solo se veían en pantalla: el panel
del ticket se angostaba con productos cargados y dejaba una franja a la derecha; en el
teléfono el total de la barra de abajo se cortaba contra Cobrar; y en las pantallas con
tablas la ventana entera se podía desplazar y dejaba una franja vacía debajo (ahora solo
se desplaza el contenido, con una prueba que lo controla).

## 15. Accesibilidad

- Paleta calculada para WCAG AA: texto secundario ≥ 4,5:1, bordes de campos ≥ 3:1,
  deshabilitados legibles (sin opacidad).
- Foco visible en todos los controles; todo se puede operar con teclado.
- Estados con palabra o símbolo, nunca solo color (✓, ▲, ✕, "Falta", "Sobra").
- axe (WCAG 2.1 AA) sin faltas en todas las pantallas de esta entrega, incluidos el
  cobro, el alta de producto, el conteo de inventario, Configuración y el tema oscuro.
  Ningún control por debajo de 44 px.

## 16. Pruebas finales

Todas corridas sobre el código final (18/10/2026), sin omitir ninguna:

| Verificación                   | Comando                      | Resultado                                                |
| ------------------------------ | ---------------------------- | -------------------------------------------------------- |
| Formato                        | `npm run format:check`       | Sin diferencias                                          |
| Lint                           | `npm run lint`               | 0 errores, 0 advertencias                                |
| Tipos                          | `npm run typecheck`          | 0 errores                                                |
| Vitest completo (110 archivos) | `npm test`                   | **2.125 pasaron, 0 fallaron, 0 omitidas**                |
| · unitarias                    | `npm run test:unit`          | 636 / 636                                                |
| · integración (base real)      | `npm run test:integration`   | 727 / 727                                                |
| · autorización                 | `npm run test:authorization` | 226 / 226                                                |
| · concurrencia                 | `npm run test:concurrency`   | 47 / 47                                                  |
| · interfaz (jsdom)             | `npx vitest run tests/ui`    | 365 / 365                                                |
| · migraciones y rendimiento    | (dentro de `npm test`)       | 124 / 124                                                |
| E2E Playwright completo        | `npm run e2e`                | **324 pasaron, 0 fallaron, 0 omitidas, 0 intermitentes** |
| Compilación de producción      | `npm run build`              | OK                                                       |

La suite e2e corre contra la compilación de producción con `KIOSCO_FUNCIONES=todas`
para seguir probando también Lotes y Compras. El modo almacén (sin la variable) se
comprobó aparte contra la aplicación: menú, inicio, pantallas y redirecciones (§12), y
con pruebas unitarias del middleware.

Casos pedidos para la entrega y dónde se prueban (e2e salvo indicación):

| Caso                                                                                                                                                    | Prueba                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Buscar, ↓, ← →, Enter: elige, no suma                                                                                                                   | `teclado.spec.ts` (flechas + Enter no agregan unidades) |
| Enter sobre un producto ya agregado no suma                                                                                                             | `teclado.spec.ts`                                       |
| + suma una, − resta una (también con el foco fuera del campo)                                                                                           | `teclado.spec.ts`                                       |
| Lector: CÓDIGO+Enter agrega; dos lecturas, dos unidades                                                                                                 | `teclado.spec.ts`, `caja-venta.spec.ts`                 |
| Lector con el foco en otro botón: no pierde el primer carácter                                                                                          | `teclado.spec.ts`                                       |
| Lector después de números escritos a mano / de texto: no mezcla                                                                                         | `teclado.spec.ts`, `tests/ui/scanner-input.test.tsx`    |
| Enter avanza etapa por etapa hasta cobrar; venta entera con teclado                                                                                     | `teclado.spec.ts`                                       |
| Tab desde la cantidad del ticket; atajo "/"                                                                                                             | `teclado.spec.ts`                                       |
| Nuevo producto: lector sin guardar el formulario, "✓ Código detectado"                                                                                  | `almacen.spec.ts`, `tests/ui/ficha-producto.test.tsx`   |
| Crear categoría sin borrar lo escrito; editar sin perder códigos alternativos                                                                           | `tests/ui/ficha-producto.test.tsx`                      |
| Inventario: crear, lector, sistema, contado, ✓ Guardado, faltante y sobrante, más de una página, "Sin contar", revisar, confirmar, aplicar, stock final | `inventario-fisico.spec.ts`                             |
| Inventario: cada cantidad viaja una vez (Enter + salir del campo)                                                                                       | `inventario-fisico.spec.ts` (cuenta los envíos)         |
| Contar dos veces: el segundo conteo se pide una sola vez                                                                                                | `tests/integration/inventario-fisico.test.ts`           |
| Caja: abrir, ingreso, egreso, venta, ventas de hoy, contar, cerrar                                                                                      | `caja-venta.spec.ts`                                    |
| La ventana no se desplaza (sin franja vacía)                                                                                                            | `navegacion.spec.ts`                                    |
| Accesibilidad WCAG 2.1 AA (axe)                                                                                                                         | `accesibilidad.spec.ts` (45 pruebas)                    |

## 17. Capturas finales

En [`docs/entrega-almacen/capturas/`](entrega-almacen/capturas/), contra la compilación de
producción en modo almacén, con los datos de demostración:

| Computadora (1366 × 768)   | Teléfono (375 px)          |
| -------------------------- | -------------------------- |
| `01-inicio.png`            | `12-mobile-inicio.png`     |
| `02-venta.png`             | `13-mobile-venta.png`      |
| `03-venta-cobro.png`       | `14-mobile-productos.png`  |
| `04-caja.png`              | `15-mobile-inventario.png` |
| `05-productos.png`         |                            |
| `06-nuevo-producto.png`    |                            |
| `07-stock.png`             |                            |
| `08-movimientos.png`       |                            |
| `09-inventarios.png`       |                            |
| `10-inventario-conteo.png` |                            |
| `11-configuracion.png`     |                            |

Se generan con `CAPTURAS_URL=http://localhost:3102 npx tsx scripts/capturas-ux.ts final`.

## 18. Limitaciones que permanecen

- **Instalaciones que ya usan Lotes o Compras**: sin `KIOSCO_FUNCIONES`, esas pantallas
  se ocultan. Antes de actualizar una instalación existente que las use, hay que poner
  `KIOSCO_FUNCIONES=todas` (o las que use) en su `.env`.
- **Mercado Pago en los reportes**: se registra como transferencia con referencia
  "Mercado Pago"; los reportes por medio de pago lo suman a Transferencia. El detalle de
  cada venta sí lo distingue.
- **Productos con lote obligatorio** cargados antes de apagar Lotes: el inventario avisa
  ("Hay productos que piden lote…") y no se puede aplicar hasta que un técnico los
  pase a "sin lote".
- **Lector encima de números escritos con el foco fuera del campo**: si alguien empieza
  a escribir números con el foco en otro botón y escanea un código interno que no es
  EAN, los dígitos se pueden juntar; el aviso dice que no existe y basta volver a
  escanear. Con el foco en el campo, o con códigos EAN, no pasa.
- **"Siguiente" en "Sin contar"**, después de contar algo en la página, vuelve a traer
  lo que falta desde el principio: no saltea nada, pero muestra de nuevo los que se
  dejaron sin contar.
- **Enter en "Recibido" vacío** confirma en efectivo justo, una vez elegida la forma de
  pago (cada Enter avanza una etapa); hacen falta cuatro Enter deliberados desde el
  campo vacío y nunca en los primeros 300 ms del cobro.
- **Permisos del cajero**: no registra ingresos/egresos, no crea productos ni hace
  inventarios; esos botones no le aparecen. "Ventas de hoy" en Caja se ve solo con
  permiso de reportes de ventas.
- **Depósito** sigue en el sistema (movimientos viejos) pero ya no se ofrece al
  registrar un movimiento de caja.

## 19. Instrucciones mínimas para producción

1. Base, usuario y entorno propios de la instancia, y el alta con
   `npm run alta:instancia`: paso a paso en [ALTA_DE_INSTANCIA.md](ALTA_DE_INSTANCIA.md).
2. En el `.env` de la instancia (ver `.env.example`): `DATABASE_URL`, `JWT_SECRET`,
   `COMMERCE_NAME`, `KIOSCO_HOSTS` y **`KIOSCO_FUNCIONES=` vacía**.
3. Construir y servir como dice el README (`npm ci`, `npx prisma generate`,
   `npm run build`, PM2 o systemd); para una instalación que ya tiene datos, seguir
   [PRODUCTION_CUTOVER.md](PRODUCTION_CUTOVER.md). Nunca `prisma migrate reset` ni
   `db push` contra producción.
4. Entrar con el dueño, crear los usuarios del negocio con su rol (cajero, encargado),
   cargar o importar los productos (Productos → Más acciones → Importar desde Excel) y
   abrir la primera caja.
5. Probar el lector en Vender: escanear un producto dos veces tiene que dejar 2
   unidades; Enter en la lista no tiene que sumar.
