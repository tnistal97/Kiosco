# Auditoría UX y Producto — Sistema Almacén

> **Tipo de documento:** auditoría integral de producto, operación y UX/UI, con propuesta de rediseño (UX V2).
> **Alcance:** todo el repositorio, la aplicación corriendo en local con datos de demostración, sus APIs, modelos, permisos y documentación.
> **Regla que gobernó el trabajo:** no se modificó código, componentes, estilos, esquema ni configuración del producto. El único entregable es este archivo y las capturas de `docs/ux-audit-evidence/`.
> **Versión auditada:** `1.0.0-rc.3` en `release/almacen-v1`, HEAD `bd07f63` (4 de septiembre de 2026), build de producción compilado a partir del árbol limpio.
> **Base de datos:** `kiosco_dev` sembrada con `npm run seed:demo` (43 productos, 15 ventas, 10 usuarios, 3 clientes, 5 proveedores, 2 sucursales).

---

## 1. Resumen ejecutivo

**Qué sistema hay hoy.** Un sistema de gestión completo para un almacén de una sucursal: punto de venta con lector físico y cámara, alta rápida desde la caja, productos por unidad y por peso, varios códigos por producto, stock vendible, caja por turnos con arqueo y cierre, pagos combinados, clientes con fiado y límite de crédito, proveedores con órdenes, recepción parcial, costos, cuenta corriente, anticipos, imputaciones y devoluciones, lotes con FEFO y vencimientos, inventario físico con conteo a ciegas y aplicación por diferencia, once reportes, bitácora, usuarios con nueve roles y sesenta y cinco permisos, PWA y modo oscuro. **Las 45 capacidades declaradas en el pedido existen, se verificaron contra código, rutas, modelos y comportamiento real**, con dos salvedades: la "navegación por teclado" es parcial y depende de F12, y "responsive" es cierto en el sentido de que no hay scroll horizontal, pero móvil no está diseñado como producto (§12).

**Lo que funciona muy bien.** El núcleo transaccional es serio: cada acción peligrosa pide motivo, queda en bitácora y es compensable; el servidor es la autoridad sobre precios, stock y crédito; los mensajes de error están escritos para personas y no filtran nada técnico; el escaneo es instantáneo (19–36 ms de API, sin ningún clic previo); la venta con producto desconocido se resuelve en cinco campos sin salir de la caja; el cierre de caja muestra la diferencia mientras se escribe; la recepción propone recibir todo lo pendiente; el pago a proveedor previsualiza a qué entregas se imputa. El sistema de diseño (tokens, un solo botón, un solo formato de dinero, 44 px táctiles, estados vacíos) está bien pensado y se nota en la coherencia de la mayor parte de las pantallas.

**Lo que puede complicar al personal.** Cinco cosas, todas de UX y ninguna de negocio:

1. **El cobro no cabe en la pantalla de una caja común.** En 1366×768 —y en cualquier celular— el botón «Cobrar» del diálogo queda debajo del pliegue: hay que desplazar el diálogo para cobrar. Es la acción más frecuente del sistema (`cobro-1366`, `cobro-375`).
2. **Los números mienten por formato.** «Pendiente 30.000 unidad», «Anterior 33.000», «Mínimo 5.000», «4.000 unidades vencidas»: en es-AR el punto separa miles. Un repositor lee treinta mil donde hay treinta. Aparece en recepción, órdenes, libro de movimientos, inventarios, lotes, reportes y en la ficha de producto.
3. **El teclado del POS depende de F12, Alt+N y Ctrl+K**, y no hay forma de moverse por las líneas del ticket con las flechas. Un cajero nuevo tiene que leer el diálogo de «Atajos de teclado» para descubrirlo.
4. **Códigos técnicos y textos viejos a la vista.** `CASH`, `DEBIT_CARD` y `customer_payment` en Caja y Ventas; 65 claves de permiso en Configuración; una lista de «lo que todavía no está» que dice que no existen turnos, compras ni clientes —existen todos—.
5. **Callejones sin salida.** Un inventario creado por error no se puede cancelar desde la pantalla; una línea «sin resolver» no se puede resolver desde la pantalla; cuatro enlaces del libro de movimientos y de las devoluciones llevan a un 404; dieciséis pantallas no tienen margen y en un celular el botón «Nuevo proveedor» queda fuera del borde.

**Veredicto operativo: B — Podría operar, pero con mejoras UX importantes.** Un almacén de una sucursal puede abrir mañana con este sistema si hay un encargado que conozca el sistema y un cajero con quince minutos de práctica. No hay bloqueantes funcionales para la operación diaria. Los bloqueantes que sí existen son de experiencia: el cobro fuera de pantalla, el formato numérico ambiguo y los callejones sin salida de inventario.

**Puntaje global operacional: 6,7 / 10. Puntaje global UX: 5,5 / 10.** El detalle está en §37.

**Qué cambiaría primero (las cinco de mayor impacto).**

1. Rediseñar el cobro como panel fijo con botones grandes por medio de pago, teclado numérico, vuelto en grande y el botón «Cobrar» siempre visible (§22, §29).
2. Una gramática de teclado única para toda la aplicación —↑↓ mueve, ←→ ajusta, Enter confirma, Esc vuelve— con F12 y Alt+N como alias secundarios (§30).
3. Un solo formato de cantidad y de dinero en toda la aplicación, resuelto en dos componentes (`QuantityText`, `MoneyInput`) y nunca más un `30.000` para treinta unidades (§28).
4. Un solo contenedor de página, una sola tabla responsiva (que no duplique filas en escritorio) y los cuatro enlaces rotos corregidos (§11, §17).
5. Inicio por rol con alertas accionables y «acciones rápidas», y un POS con favoritos para lo que no tiene código (pan, verdura, facturas) (§31, §22).

**Sobre el pedido original.** Se pidió un rediseño integral, no cosmético. La propuesta (§20–§32) parte de cero en arquitectura de información, navegación, POS, cobro, teclado, formularios, tablas, feedback y dashboards, pero **conserva deliberadamente** el sistema de tokens, la disciplina de motivo-y-bitácora, la autoridad del servidor y el flujo escanear → ticket → cobrar, que son correctos. La migración se propone en cinco fases sin big bang (§36).

---

## 2. Metodología

### 2.1 Qué se hizo

| Paso                        | Qué                                                                                                                         | Cómo                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventario estático         | Todas las rutas, páginas, componentes, modelos, permisos, códigos de error y documentos                                     | Lectura completa de `src/app` (28 páginas, 90 rutas de API), `src/components` (63 archivos, 13.334 líneas), `prisma/schema.prisma` (38 modelos, 45 migraciones), `src/server/authz/permissions.ts` (65 permisos, 9 roles), `src/server/http/errors.ts` (69 códigos), los 60 documentos de `docs/` y los 13 specs E2E (243 pruebas), que describen los flujos con precisión |
| Ejecución local             | Build de producción (`next build` + `next start -p 3099`) contra `kiosco_dev` sembrada con `seed:demo`                      | Producción y no `next dev`, para que la performance percibida sea la real                                                                                                                                                                                                                                                                                                  |
| Navegación manual           | Cada pantalla, cada diálogo, con admin, y los flujos completos del día simulado                                             | Panel de navegador integrado, 1366×768 como resolución principal, más 375×812 emulado                                                                                                                                                                                                                                                                                      |
| Capturas de evidencia       | 140 capturas en 375, 768, 1366 y 1920 px, con los diez usuarios de demostración según la pantalla                           | Guion de Playwright fuera del repositorio; las imágenes están en `docs/ux-audit-evidence/<pantalla>-<ancho>.png`                                                                                                                                                                                                                                                           |
| Mediciones                  | Tiempos de servidor y de API, tamaño de cada zona del POS, objetivos táctiles, padding de cada contenedor, foco del teclado | `performance.getEntries()`, `getBoundingClientRect()`, `document.activeElement` desde la consola del navegador                                                                                                                                                                                                                                                             |
| Verificación de capacidades | Cada ítem de la lista del pedido, contra código, UI, ruta, modelo, documentación y comportamiento                           | Ver §3; donde una capacidad está sólo en la API y no en la pantalla, se dice                                                                                                                                                                                                                                                                                               |
| Simulación operativa        | El día completo de 07:55 a 20:00, ejecutado de verdad (venta, cobro, cierre y apertura de caja, inventario), no sólo leído  | §6                                                                                                                                                                                                                                                                                                                                                                         |

### 2.2 Qué no se hizo

- No se tocó código, CSS, Tailwind, Prisma, migraciones, dependencias ni configuración del producto. Las únicas escrituras fueron en la base de demostración (una venta, un cierre y una apertura de caja, un inventario en estado «contando») y el directorio de evidencia.
- No se corrió la suite de pruebas completa: ya está verificada en la release (1.600 unitarias + 243 E2E en verde) y no aporta al objetivo de esta auditoría. Sí se leyeron los specs como fuente de verdad de los flujos.
- No se auditó accesibilidad con Axe porque la suite `e2e/accesibilidad.spec.ts` ya lo hace en 41 pantallas y estados; §10.4 evalúa lo que Axe no mide: orden de foco, teclado, información sólo por color, zoom, objetivos táctiles.
- No se probó con un lector de códigos físico: el hook `useBarcodeScanner` se ejercitó tipeando a velocidad de lector y con el campo de código, que son los dos caminos reales.

### 2.3 Escala de severidad

| Nivel | Significado                                                                            |
| ----- | -------------------------------------------------------------------------------------- |
| S0    | Cosmético. Nadie se equivoca por esto                                                  |
| S1    | Menor. Molesta, no frena                                                               |
| S2    | Fricción. Cuesta tiempo o atención cada vez                                            |
| S3    | Error probable u operación lenta. Alguien se va a equivocar, o la tarea tarda el doble |
| S4    | Bloquea la operación. No se puede completar la tarea sin ayuda técnica                 |

### 2.4 Cómo leer la evidencia

Cada hallazgo cita una captura por nombre. Todas están en `docs/ux-audit-evidence/`. Convención: `<pantalla>-<ancho>.png`; por ejemplo `cobro-1366.png` es el diálogo de cobro a 1366×768 y `cobro-375.png` el mismo diálogo en un celular. Las capturas de inicio se hicieron con distintos usuarios (`inicio-admin`, `inicio-cajero`, `inicio-repositor`, `inicio-compras`); el resto con el rol que de verdad usa esa pantalla.

Un aviso sobre las cantidades que se ven en las capturas del POS: el ticket persiste en `localStorage` y el guion de capturas escaneó los mismos códigos varias veces con el mismo usuario, así que en `ticket-movil-375` y `cobro-375` las cantidades están infladas (6 unidades, $ 71.080). No es un defecto de la aplicación —es la recuperación del ticket funcionando— y no afecta ninguna conclusión.

### 2.5 Dos hallazgos previos al análisis, que no son de UX

1. **La aplicación sólo responde en `localhost:3099`, `127.0.0.1:3099`, `localhost` y `127.0.0.1`.** El middleware añadido después de rc.3 (`src/middleware.ts`, `HOSTS_LOCALES`) responde `Host no reconocido` a cualquier otro origen. Esto rompe `npm run dev` (puerto 3000), la suite E2E (puerto 3101) y `pwa:check` (puerto 3100) tal como están configurados. Para esta auditoría se levantó la aplicación en el 3099. Se anota como bug de infraestructura de desarrollo (§10, H-40) y como riesgo: los siete commits posteriores a rc.3 no pudieron pasar por la suite con esta configuración.
2. **El panel de capturas de pantalla completa no sirve en esta aplicación**: el `main` se desplaza por dentro (`h-dvh overflow-hidden`), así que las capturas «full page» de Reportes y Usuarios muestran sólo el primer viewport. No es un defecto del producto; se menciona para que nadie lea esas dos imágenes como una pantalla vacía.

---

## 3. Inventario funcional verificado

Cada fila se verificó contra **código** (página, componente, ruta de API, servicio), **UI** (se navegó), **modelo** (Prisma), **documentación** (`docs/`) y **comportamiento real** (se ejecutó). Estado según la escala del pedido: `completo`, `parcial`, `difícil de usar`, `oculto`, `redundante`, `posiblemente obsoleto`. Cuando una capacidad está en la API pero no tiene pantalla, se marca `oculto`.

Superficie total: 28 páginas, 90 rutas de API, 38 modelos, 65 permisos, 9 roles, 69 códigos de error, 63 componentes.

### 3.1 POS — `/venta`

| Función                                              | Pantalla / componente                                                              | Quién lo usa                                                                     | Qué problema resuelve                                                                          | Estado                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Carrito (ticket) persistente                         | `Ticket.tsx`, `store/cart.ts`                                                      | Cajero                                                                           | Armar la venta; sobrevive a un F5 (12 h, por sucursal)                                         | **completo**                                                                                        |
| Escaneo con lector físico                            | `useBarcodeScanner`, `BarcodeInput`                                                | Cajero                                                                           | Ráfaga de teclado detectada en toda la ventana sin clic previo; se apaga con diálogos abiertos | **completo**                                                                                        |
| Escaneo con cámara                                   | `EscanerCamara` (`@zxing/browser`, carga diferida)                                 | Cajero en celular/tablet                                                         | Sin lector USB                                                                                 | **completo**                                                                                        |
| Búsqueda por nombre                                  | `SearchInput` + `/api/products?q=` (8 resultados, 250 ms de espera)                | Cajero                                                                           | Producto sin código o etiqueta rota                                                            | **completo**, pero **difícil de usar** con teclado: ↑↓ sólo entre resultados                        |
| Alta rápida (producto desconocido)                   | `DialogoAltaRapida`, `POST /api/products/quick`                                    | Cajero con `products.quickCreate` (encargado, supervisor, compras; el cajero no) | Un código desconocido no frena la venta: 6 campos y vuelve al lector                           | **completo** (una de las mejores piezas del sistema)                                                |
| Producto desconocido / inválido / inactivo / sin red | `CodigoSinResolver`                                                                | Cajero                                                                           | Cinco desenlaces distintos con su siguiente paso; nunca un botón muerto                        | **completo**                                                                                        |
| Producto inactivo → reactivar                        | `PUT /api/products/:id` desde el POS                                               | Encargado                                                                        | Volver a vender sin ir a Productos                                                             | **completo**                                                                                        |
| Stock insuficiente / vendible / vencidos             | `sellableStock`, `expiredStock`, `motivoDeStock`                                   | Cajero                                                                           | El ticket se corta en lo vendible; el rechazo no llega al cobrar                               | **completo**                                                                                        |
| Cantidades                                           | `QuantityInput` (paso por unidad, tope al vendible)                                | Cajero                                                                           | ↑↓ dentro del campo, +/− y Supr con el foco en la línea                                        | **parcial**: no hay forma de llegar a la línea con el teclado desde el lector                       |
| Pesables                                             | `DialogoPeso` (KG/L, subtotal en vivo, Enter agrega)                               | Cajero                                                                           | Se abre solo al escanear un producto por peso                                                  | **completo**; `scale.ts` es un stub: **no hay balanza**                                             |
| Cliente en la venta                                  | `SelectorDeCliente` (busca 8, alta en 3 campos)                                    | Cajero                                                                           | Asociar o crear cliente sin salir del cobro                                                    | **completo**                                                                                        |
| Pagos y pago combinado                               | `DialogoCobro` (6 medios, renglones, restante)                                     | Cajero                                                                           | Varios medios por venta; sólo efectivo mueve el cajón                                          | **completo**, **difícil de usar** (CTA fuera del pliegue en 1366×768 y móvil; medio en un `select`) |
| Cuenta corriente (fiado)                             | Medio `ACCOUNT` + previsualización de crédito (5 números) + autorización de exceso | Cajero / encargado                                                               | Fiar con límite comprobado en la transacción                                                   | **completo**                                                                                        |
| Vuelto                                               | «Con cuánto paga» → «Vuelto»                                                       | Cajero                                                                           | Calcular el vuelto                                                                             | **completo**, pero el vuelto se muestra en texto chico (S2)                                         |
| Anulación                                            | Desde `/ventas`, `DialogoAnular` (motivo ≥ 5 caracteres)                           | Supervisor/encargado                                                             | Revertir stock, caja, fiado y lotes                                                            | **completo** (no desde el POS: hay que ir a Ventas)                                                 |
| Teclado                                              | F12 cobrar, Alt+N alta, Ctrl+K y `/` buscar, ↑↓ resultados, Enter, +/−/Supr, Esc   | Cajero                                                                           | Operar sin mouse                                                                               | **parcial** y **oculto** (ver §15)                                                                  |
| Consulta de precio                                   | —                                                                                  | —                                                                                | Preguntar «¿cuánto sale?» sin vender                                                           | **no existe** (§8)                                                                                  |
| Venta en espera / recuperar                          | —                                                                                  | —                                                                                | Atender a otro mientras uno busca la billetera                                                 | **no existe** (§8)                                                                                  |
| Descuentos, promociones, combos                      | — (`sales/schemas.ts` los rechaza explícitamente)                                  | —                                                                                | —                                                                                              | **no existe** (§8)                                                                                  |
| Impresión del ticket de venta                        | — (sólo `window.print()` en comprobantes de pago)                                  | —                                                                                | Papel para el cliente                                                                          | **no existe** (§8)                                                                                  |
| Devolución parcial al cliente                        | — (sólo anulación completa)                                                        | —                                                                                | Cambiar una gaseosa                                                                            | **no existe** (§8)                                                                                  |

### 3.2 Caja — `/caja`

| Función                                         | Pantalla / componente                                                      | Quién                 | Qué resuelve                                   | Estado                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------- | --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Apertura de turno                               | `DialogoAbrirCaja` (efectivo inicial, notas)                               | Cajero                | Punto de partida del cierre                    | **completo**                                                                                                                   |
| Turno en curso                                  | `PanelTurno` (quién, desde cuándo, inicial, ventas, tiene que haber)       | Cajero/encargado      | La pregunta del mostrador                      | **completo**, pero **difícil de leer**: muestra Inicial + Ventas = Tiene que haber sin los egresos (25.000 + 102.495 ≠ 99.725) |
| Movimientos manuales: ingreso, retiro, depósito | `DialogoMovimiento` (monto positivo, medio)                                | Encargado/supervisor  | Sacar plata para pagar al panadero             | **completo** (retiro y depósito sólo en efectivo, la pantalla lo fuerza)                                                       |
| Egreso                                          | Es un «retiro» con detalle                                                 | —                     | —                                              | **redundante** con retiro; no hay tipo «egreso» propio                                                                         |
| Arqueo                                          | `DialogoArqueo` (esperado a la vista, diferencia en vivo)                  | Cajero                | Contar sin cerrar                              | **completo**                                                                                                                   |
| Diferencia y umbral                             | `cashDifferenceThreshold`, `cash.shift.authorize`                          | Encargado             | Un faltante grande pide autorización explícita | **completo** (el segundo paso aparece sólo después del 409; ver H-22)                                                          |
| Cierre                                          | `DialogoCerrarCaja` (4 renglones + tiene que haber + contado + diferencia) | Cajero                | Cerrar el turno; inmutable                     | **completo** (la mejor pantalla de dinero del sistema)                                                                         |
| Cerrar el turno de otro                         | `cash.shift.close.other`                                                   | Encargado             | Cajero que se fue                              | **oculto**: el permiso existe, la pantalla no lo distingue ni lo explica                                                       |
| Historial de turnos                             | `HistorialTurnos` (9 columnas / tarjetas)                                  | Encargado             | Cuándo faltó plata y quién estaba              | **completo**                                                                                                                   |
| Listado de movimientos                          | Tabla con tipo, medio, usuario, importe, detalle expandible                | Encargado             | Auditar el día                                 | **completo**, con **códigos técnicos a la vista**: `CASH`, `DEBIT_CARD`, `customer_payment`                                    |
| Saldo en la cabecera                            | `EstadoCaja`                                                               | Todos con `cash.view` | El número que el encargado mira más            | **completo**                                                                                                                   |

### 3.3 Productos — `/productos`

| Función                                        | Pantalla / componente                                       | Quién             | Qué resuelve                                | Estado                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------- | ----------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| Alta completa                                  | `DialogoProducto` (5 secciones, ~14 campos)                 | Encargado/compras | El catálogo                                 | **completo**, **difícil de usar** (todo a la vista, sin progressive disclosure)        |
| Edición                                        | Ídem + Trazabilidad + Actividad reciente                    | Encargado/compras | —                                           | **completo**                                                                           |
| Categorías                                     | `categories.manage`; alta inline desde el alta rápida       | Encargado         | —                                           | **parcial**: no hay pantalla de categorías (renombrar/borrar es imposible desde la UI) |
| Precio (permiso separado)                      | `products.price.update`; sin él el precio es texto          | Encargado         | Cambiar precio ≠ editar ficha               | **completo**                                                                           |
| Costo, historial de costos, motivo obligatorio | `PUT /api/products/:id/cost`, `ProductCostHistory`          | Compras           | Rentabilidad con costo histórico            | **completo** (el historial se ve sólo en «Actividad reciente», 8 eventos)              |
| Margen y markup                                | `calcularRentabilidad` en la ficha                          | Compras           | —                                           | **completo**                                                                           |
| Códigos de barras múltiples                    | `CodigosDeBarras` (principal + alternativos, Enter agrega)  | Encargado         | Pack vs unidad, cambio de partida           | **completo**                                                                           |
| Unidades de venta y de compra, factor          | `units.ts` (UNIT, KG, G, L, ML; PACK, BOX)                  | Compras           | Comprar por caja de 8, vender por botella   | **completo**, **vocabulario técnico** («Unidades por compra», «Contiene 1.000»)        |
| Stock mínimo                                   | `minimumStock`, `minimoSugerido`                            | Encargado         | Alertas de reposición                       | **completo**                                                                           |
| Proveedor principal                            | `ProductSupplier`, `isPreferred`                            | Compras           | —                                           | **parcial**: la ficha permite uno; el modelo admite varios; no hay UI para el resto    |
| Lotes / vencimientos por producto              | `Trazabilidad` (dos políticas + inicialización de partidas) | Encargado         | Activar rastreo sobre un producto con stock | **completo**, **oculto** (al fondo de un diálogo de cinco secciones)                   |
| Dar de baja / eliminar                         | Checkbox «En venta»; menú ⋯ → Eliminar (sólo sin historial) | Encargado         | —                                           | **completo**                                                                           |
| Imágenes, ubicaciones, etiquetas               | —                                                           | —                 | —                                           | **no existe**                                                                          |

### 3.4 Stock — `/stock`, `/stock/movimientos`

| Función                               | Pantalla / componente                                                                                | Quién     | Qué resuelve                        | Estado                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Stock actual                          | Tabla/tarjetas con `StockBadge` (mínimo del producto)                                                | Repositor | Cuánto hay                          | **completo** (métrica «Productos en esta página: 25» es ruido)                                                                |
| Stock vendible                        | Sólo en el POS y en `ProductoListado`                                                                | Cajero    | —                                   | **parcial**: `/stock` muestra el total, no el vendible                                                                        |
| Movimientos (libro)                   | `/stock/movimientos` (9 columnas, filtros, referencias)                                              | Encargado | Quién movió cada unidad             | **completo**; **formato** «Anterior 33.000 / Posterior 31» inconsistente en la misma fila; enlaces de referencia rotos (H-04) |
| Ajustes: entraron/salieron o recuento | `DialogoAjusteStock` (`PATCH` delta / `PUT` total)                                                   | Repositor | «Entraron 12» vs «quedan 30»        | **completo** (buena idea), con un error prematuro en «De qué partida»                                                         |
| Pérdidas, roturas, consumo interno    | Tipos `LOSS`, `BREAKAGE`, `INTERNAL_USE` con ayuda                                                   | Repositor | Merma con causa                     | **completo**                                                                                                                  |
| Vencido → baja                        | Vía «Pérdida — Faltante, vencido, robo» eligiendo la partida                                         | Repositor | Sacar lo vencido                    | **difícil de usar**: desde `/stock/lotes` no hay acción; hay que ir a Stock → Ajustar → elegir partida                        |
| Mínimos y agotados                    | `/api/inventory/replenishment` (3 números de toda la sucursal) + aviso de «sin mínimos configurados» | Encargado | Qué reponer                         | **completo**                                                                                                                  |
| Sugerencia de pedido                  | `POST /api/purchases/draft-from-restock`                                                             | —         | Borrador de orden con los faltantes | **oculto**: la ruta existe, ningún botón la llama                                                                             |

### 3.5 Clientes — `/clientes`, `/clientes/[id]`

| Función                        | Pantalla / componente                                                                                | Quién            | Qué resuelve                  | Estado                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------- | ---------------------------------------------------------- |
| Alta (sólo nombre obligatorio) | `DialogoCliente` (8 campos) y `clients/rapido` (3 campos desde el POS)                               | Cajero           | —                             | **completo**                                               |
| Ficha                          | Cuenta corriente (4 números), datos, extracto, últimas compras                                       | Cajero/encargado | ¿Cuánto debe?                 | **completo**                                               |
| Fiado, límite, cortar fiado    | `isCreditEnabled`, `creditLimit` (vacío ≠ cero)                                                      | Encargado        | Política de crédito           | **completo**; «Cortar fiado» actúa sin confirmación (H-11) |
| Cobros                         | `DialogoCobro` (importe propuesto, medio, entra o no a caja, saldo a favor) + comprobante imprimible | Cajero           | Cobrar una deuda              | **completo**; sólo desde la ficha, no desde el POS         |
| Ajuste manual de cuenta        | `DialogoAjusteCuenta` (dirección + cuánto + motivo)                                                  | Encargado        | Deuda anterior a la migración | **completo**                                               |
| Historial                      | Extracto con saldo resultante y quién                                                                | Encargado        | —                             | **completo**                                               |
| Comprobante de pago            | `/comprobantes/[id]` (`window.print`)                                                                | Cajero           | Papel para el cliente         | **completo** (no fiscal, y lo dice)                        |

### 3.6 Proveedores — `/proveedores`, `/proveedores/[id]`

| Función                          | Pantalla / componente                                                   | Quién             | Qué resuelve                   | Estado                                                                        |
| -------------------------------- | ----------------------------------------------------------------------- | ----------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| Ficha                            | Datos + productos que se le compran + compras recientes                 | Compras           | —                              | **completo**                                                                  |
| Cuenta corriente                 | `CuentaDeProveedor` (8 métricas, deudas abiertas por entrega, extracto) | Compras/encargado | Cuánto debemos y cuándo vence  | **completo** (denso)                                                          |
| Vencimientos financieros         | `dueDate` por recepción, «Vencida/Parcial/Pagada»                       | Compras           | —                              | **completo** (la fecha se corrige con motivo: `recepciones/[id]/vencimiento`) |
| Pagos + imputación FIFO o manual | `DialogoPagoProveedor`                                                  | Compras           | Pagar y decir contra qué       | **completo** (la mejor pieza de proveedores)                                  |
| Anticipos e imputación posterior | `AnticiposDeProveedor` + `DialogoImputacion`                            | Compras           | Plata entregada sin aplicar    | **completo**                                                                  |
| Sobrepago                        | `supplierAccounts.overpay`                                              | Encargado         | —                              | **completo**                                                                  |
| Nota de crédito y ajuste         | `DialogoAjusteProveedor`                                                | Compras           | —                              | **completo**                                                                  |
| Devoluciones del proveedor       | `DevolucionesDeProveedor`                                               | Compras           | —                              | **completo**                                                                  |
| Comprobante de pago a proveedor  | `/comprobantes/proveedor/[id]` con obligaciones canceladas              | Compras           | Lo que se discute por teléfono | **completo**                                                                  |

### 3.7 Compras — `/compras`, `/compras/nueva`, `/compras/[id]`, `/devoluciones`

| Función                                         | Pantalla / componente                                                                        | Quién   | Qué resuelve                         | Estado                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | ------- | ------------------------------------ | ------------------------------------------------------------------ |
| Orden / borrador                                | `/compras/nueva` (proveedor, notas, líneas con cantidad, unidad, contiene, costo)            | Compras | Pedir                                | **completo**; puede crear el producto inline                       |
| Confirmar / cancelar orden                      | Botones de detalle, cancelación con motivo                                                   | Compras | —                                    | **completo**                                                       |
| Recepción total o parcial                       | `DialogoRecepcion` (pendiente propuesto, costo de factura, partidas)                         | Compras | Lo que llegó                         | **completo**; formato «30.000»                                     |
| Recepción sin orden                             | —                                                                                            | —       | El proveedor llega sin pedido previo | **no existe** (§8): hay que crear y confirmar la orden primero     |
| Costo: esperado ≠ facturado, diferencia visible | Tabla de recepción                                                                           | Compras | El proveedor aumentó                 | **completo**                                                       |
| Lotes y vencimiento al recibir                  | Partidas por código (hasta 20), fecha si la política lo exige                                | Compras | —                                    | **completo** (sólo si el producto ya tiene rastreo activado)       |
| Anticipos al recibir                            | Casilla «Aplicar automáticamente» apagada por omisión                                        | Compras | —                                    | **completo**                                                       |
| Devolución a proveedor                          | `DialogoDevolucion` (4 números, costo original, borrador) → `/devoluciones/[id]` → confirmar | Compras | Mercadería que vuelve                | **completo**; dos pantallas y dos confirmaciones para dos unidades |
| Listado de devoluciones                         | `/devoluciones` (tabla, sin tarjetas móviles)                                                | Compras | —                                    | **completo**                                                       |
| Resumen para el panel                           | `/api/purchases/summary`                                                                     | —       | —                                    | **completo**                                                       |

### 3.8 Lotes — `/stock/lotes`, `/stock/lotes/[id]`

| Función                                      | Pantalla / componente                                           | Quién     | Qué resuelve                    | Estado                                                                  |
| -------------------------------------------- | --------------------------------------------------------------- | --------- | ------------------------------- | ----------------------------------------------------------------------- |
| Tracking (dos políticas: lote y vencimiento) | `Trazabilidad`                                                  | Encargado | Lavandina con partida sin fecha | **completo**                                                            |
| FEFO                                         | `resolverSalida` en la venta; `lots.adjust` elige a mano        | —         | Sale primero lo que vence antes | **completo** (no hay UI para elegir el lote a mano en el POS: `oculto`) |
| Vencimientos                                 | Estados VENCIDO / VENCE HOY / 7 DÍAS / 30 DÍAS / OK / SIN FECHA | Repositor | Qué sacar de la góndola         | **completo**                                                            |
| Alertas                                      | Tarjeta «Vencidos» en Inicio, 4 métricas en Lotes, reporte      | Encargado | —                               | **completo**                                                            |
| Stock por lote                               | Detalle con entradas, salidas, atribuido y por sucursal         | Encargado | —                               | **completo**                                                            |
| Ajustes por lote                             | En `DialogoAjusteStock` (modo delta)                            | Repositor | —                               | **completo**                                                            |
| Acción desde la lista de lotes               | —                                                               | —         | «Dar de baja este lote vencido» | **no existe**: la lista es de sólo lectura                              |
| Filas duplicadas en escritorio               | `CardList` sin `md:hidden`                                      | —         | —                               | **bug** (H-10)                                                          |

### 3.9 Inventario físico — `/inventarios`, `/inventarios/[id]`

| Función                       | Pantalla / componente                                                     | Quién     | Qué resuelve                         | Estado                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------- | --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Creación con alcance          | `DialogoNuevoInventario` (todo / una categoría; a ciegas; segundo conteo) | Repositor | Contar los lácteos un martes         | **completo** (`SELECTION` existe en la API, no en la pantalla)                                                |
| Conteo ciego                  | El esperado no se muestra hasta cerrar                                    | Repositor | Que el conteo sea un conteo          | **completo**                                                                                                  |
| Conteo por lote               | Una línea por partida + «sin asignar»                                     | Repositor | —                                    | **completo**, **difícil de usar** («sin asignar» no se explica)                                               |
| Conteo concurrente            | `expectedAtCount` y aplicación por delta                                  | —         | Contar sin cerrar el local           | **completo** (diseño correcto, verificado en specs)                                                           |
| Entrada de conteos            | Un `Input` por línea, «Guardar conteos» arriba                            | Repositor | —                                    | **difícil de usar**: Enter no avanza, sin escaneo, sin buscar, sin guardado por línea, 47 inputs en una tabla |
| Cerrar conteo                 | Exige todas las líneas contadas o recontadas                              | Repositor | —                                    | **parcial**: no hay cierre parcial ni «lo no contado = 0»                                                     |
| Revisión y conflictos         | Filtros por diferencia y estado; aviso de conflicto con otra sesión       | Encargado | —                                    | **completo**                                                                                                  |
| Resolver línea «sin resolver» | API `lineas/[lineId]/resolver`                                            | —         | Decir de qué lote son las unidades   | **oculto**: no hay ningún control en la pantalla (H-03)                                                       |
| Aplicar                       | Un clic, sin confirmación                                                 | Encargado | Convertir diferencias en movimientos | **completo** pero **irreversible sin confirmar** (H-11)                                                       |
| Cancelar inventario           | API `/cancelar`                                                           | —         | Uno creado por error                 | **oculto**: no hay botón (H-03)                                                                               |

### 3.10 Administración

| Función                                          | Pantalla / componente                                                       | Quién         | Qué resuelve           | Estado                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------- | ------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usuarios: alta, edición, baja                    | `/usuarios` (nombre, usuario, clave, rol)                                   | Admin         | —                      | **completo**                                                                                                                                                                       |
| Cambio de clave                                  | `scripts/establecer-clave.ts` (desde el servidor)                           | Admin         | —                      | **parcial**: la pantalla dice «no se puede hacer desde acá todavía»                                                                                                                |
| Roles y permisos                                 | 9 roles fijos en código; `MatrizPermisos` de sólo lectura                   | Admin         | Ver qué puede cada rol | **parcial** y **desactualizado**: la matriz muestra 24 de 65 permisos (no lista compras, clientes, cuentas, lotes, inventarios)                                                    |
| Auditoría                                        | `/auditoria` (filtros, expandible, visor antes/después, requestId copiable) | Auditor/admin | —                      | **completo**                                                                                                                                                                       |
| Configuración                                    | `/configuracion`                                                            | Todos         | Tema                   | **posiblemente obsoleto**: «Lo que todavía no está» afirma que faltan turnos, compras, proveedores y clientes; muestra 65 claves de permiso y el nombre de una variable de entorno |
| Sucursales                                       | `/sucursales` sólo lectura                                                  | Admin         | —                      | **parcial**, honesto: «cambiar de sucursal es cambiar de usuario»                                                                                                                  |
| Umbral de diferencia, exigir turno, zona horaria | `Branch.cashDifferenceThreshold`, `requireOpenShift`, `timeZone`            | —             | Política de caja       | **oculto**: se cambian en la base, no hay pantalla                                                                                                                                 |
| PWA                                              | `manifest.json`, `sw.ts` (sólo estáticos públicos), `/offline`              | Todos         | Instalar en la tablet  | **completo**; sin venta offline (a propósito)                                                                                                                                      |
| Tema claro/oscuro                                | `ThemeToggle`                                                               | Todos         | —                      | **completo**                                                                                                                                                                       |

### 3.11 Reportes — `/reportes` (una sola página, 11 consultas)

| Reporte                                         | Contenido                                                                                                 | Permiso                  | Estado                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| Ventas                                          | Facturado, operaciones, ticket promedio, anuladas; por medio, por cajero, por día                         | `reports.sales.view`     | **completo**                              |
| Rentabilidad                                    | Con costo al momento de la venta; líneas sin costo excluidas y dichas                                     | `reports.costs.view`     | **completo** (honesto con lo que no sabe) |
| Productos                                       | Más y menos vendidos, activos sin ventas                                                                  | `reports.sales.view`     | **completo**; «Unidades 7.000»            |
| Clientes                                        | Cartera hoy + período; top deudores; cobros por medio                                                     | `reports.clients.view`   | **completo**                              |
| Proveedores                                     | Cuentas por pagar (vencido / por vencer / sin fecha / anticipos), recibido, pagado, notas de crédito; top | `reports.purchases.view` | **completo**                              |
| Inventario                                      | Activos, agotados, bajo mínimo, sin costo, stock valorizado, movimientos por tipo                         | `reports.inventory.view` | **completo**                              |
| Mermas                                          | Por causa y por producto, a costo actual; la diferencia de inventario aparte                              | `reports.inventory.view` | **completo**                              |
| Inventarios físicos                             | Sesiones con diferencias + y − separadas                                                                  | `reports.inventory.view` | **completo**                              |
| Vencimientos                                    | Tramos, sin fecha, valor a costo, 25 partidas más próximas                                                | `lots.view`              | **completo**                              |
| Compras                                         | Bruto, devuelto, neto; por proveedor; diferencias de costo                                                | `reports.purchases.view` | **completo**                              |
| Caja                                            | Turnos, sobrantes y faltantes separados, ventas en efectivo, ingresos, egresos, retiros                   | `reports.cash.view`      | **completo**                              |
| Exportar, imprimir, comparar períodos, gráficos | —                                                                                                         | —                        | **no existe**                             |

**Conclusión del inventario.** De los 45 ítems del pedido, 41 están completos, 3 parciales (teclado, categorías, cambio de clave) y 1 es cierto sólo en sentido estricto (responsive). Aparte, hay 6 capacidades ocultas (existen en la API sin pantalla) y 2 pantallas con texto obsoleto que niega funciones que existen.

---

## 4. Mapa actual de pantallas

### 4.1 Navegación (barra lateral, 6 grupos, 17 entradas)

```
Inicio
OPERACIÓN      Venta · Caja · Ventas · Clientes
INVENTARIO     Productos · Stock · Movimientos · Lotes · Inventarios
COMPRAS        Órdenes · Proveedores · Devoluciones
CONTROL        Reportes · Auditoría
ADMINISTRACIÓN Usuarios · Sucursales · Configuración
```

Cada entrada se esconde si falta el permiso. El cajero ve 8 (Inicio, Venta, Caja, Ventas, Clientes, Productos, Stock, Configuración); el repositor 8 (Inicio, Productos, Stock, Movimientos, Lotes, Inventarios, Devoluciones, Configuración); compras 12; encargado 16; admin 17. En móvil la misma lista vive en un cajón (`menu-movil-375`). Cabecera de 56 px: título, saldo de caja, sucursal, tema, usuario.

### 4.2 Pantallas y de dónde se llega

| Ruta                           | Pantalla                                      | Se llega desde                           | Contenedor      | Móvil                            |
| ------------------------------ | --------------------------------------------- | ---------------------------------------- | --------------- | -------------------------------- |
| `/login`                       | Login                                         | Middleware                               | propio          | ✓                                |
| `/`                            | Inicio (hasta 10 tarjetas + 2 listas)         | Menú, marca                              | `max-w-6xl p-5` | apila                            |
| `/venta`                       | POS                                           | Menú, «Ir a vender», atajo PWA           | propio (split)  | ticket en cajón, barra inferior  |
| `/caja`                        | Turno, métricas, movimientos, turnos, arqueos | Menú, saldo de cabecera, banner del POS  | `max-w-6xl p-5` | tarjetas                         |
| `/ventas`                      | Listado, anular                               | Menú, tarjeta Inicio                     | `max-w-7xl p-5` | tarjetas                         |
| `/clientes`                    | Listado                                       | Menú                                     | **sin margen**  | tarjetas                         |
| `/clientes/[id]`               | Ficha, cuenta, cobro, ajuste                  | Listado, ventas                          | **sin margen**  | tarjetas                         |
| `/productos`                   | Catálogo, alta/edición                        | Menú                                     | `max-w-7xl p-5` | tarjetas                         |
| `/stock`                       | Existencias, ajuste                           | Menú, tarjeta Inicio                     | `max-w-6xl p-5` | tarjetas                         |
| `/stock/movimientos`           | Libro                                         | Menú, botón en Stock                     | `max-w-6xl p-5` | tarjetas                         |
| `/stock/lotes`                 | Lotes                                         | Menú, botón en Stock, tarjeta «Vencidos» | **sin margen**  | tabla + tarjetas **duplicadas**  |
| `/stock/lotes/[id]`            | Detalle de lote                               | Lista de lotes                           | **sin margen**  | tabla                            |
| `/inventarios`                 | Sesiones                                      | Menú, botón en Stock                     | **sin margen**  | tabla + tarjetas **duplicadas**  |
| `/inventarios/[id]`            | Conteo / revisión                             | Lista                                    | **sin margen**  | tabla + tarjetas **duplicadas**  |
| `/compras`                     | Órdenes                                       | Menú, tarjeta Inicio                     | **sin margen**  | tarjetas                         |
| `/compras/nueva`               | Nueva compra                                  | Botón                                    | **sin margen**  | tabla ancha (scroll interno)     |
| `/compras/[id]`                | Detalle, recepciones, devolver                | Listado, proveedor, deudas               | **sin margen**  | tablas anchas                    |
| `/proveedores`                 | Listado                                       | Menú                                     | **sin margen**  | tarjetas (botón fuera del borde) |
| `/proveedores/[id]`            | Ficha + cuenta corriente                      | Listado                                  | **sin margen**  | tablas anchas                    |
| `/devoluciones`                | Listado                                       | Menú                                     | **sin margen**  | tabla (7 columnas)               |
| `/devoluciones/[id]`           | Detalle, confirmar                            | Listado, proveedor                       | **sin margen**  | tabla                            |
| `/comprobantes/[id]`           | Comprobante cliente                           | Cobro, extracto                          | **sin margen**  | ✓                                |
| `/comprobantes/proveedor/[id]` | Comprobante proveedor                         | Pago, anticipos                          | **sin margen**  | ✓                                |
| `/reportes`                    | 11 secciones apiladas                         | Menú, tarjetas Inicio                    | **sin margen**  | 10.966 px de alto                |
| `/auditoria`                   | Bitácora                                      | Menú                                     | `max-w-6xl p-5` | lista                            |
| `/usuarios`                    | Personal + matriz                             | Menú                                     | `max-w-6xl p-5` | tarjetas + lista                 |
| `/sucursales`                  | Sólo lectura                                  | Menú                                     | `max-w-4xl p-5` | ✓                                |
| `/configuracion`               | Tema, sesión, permisos                        | Menú, menú de usuario                    | `max-w-3xl p-5` | ✓                                |
| `/offline`                     | Sin conexión                                  | Service worker                           | propio          | ✓                                |

Dieciséis pantallas viven en un `div` sin `padding` ni ancho máximo (medido: `padding: 0px`, `left: 236`, `width: 1130` en `/clientes` contra `padding: 20px`, `max-width: 1152px` en `/caja`). Es la inconsistencia estructural más visible del sistema y en móvil produce botones fuera del borde (`proveedores-375`, `cliente-detalle-375`, `compra-detalle-375`).

### 4.3 Diálogos (26) y quién los abre

POS: peso, alta rápida, cobro, resultado de venta, cámara, atajos. Caja: abrir, cerrar, arqueo, movimiento. Ventas: anular. Productos: ficha (5 secciones + trazabilidad + inicialización de partidas), eliminar. Stock: ajuste. Inventarios: nuevo. Compras: recepción, devolución, cancelar orden. Devoluciones: confirmar, descartar. Proveedores: ficha, pago, nota de crédito/ajuste, imputar anticipo, baja. Clientes: ficha, cobro, ajuste. Usuarios: alta/edición, baja.

Todo lo que no es lista vive en un diálogo modal. En escritorio funciona; en móvil los 26 son hojas inferiores que ocupan `92dvh` y cuyo pie —donde está el botón principal— queda fuera de la vista en cuanto el contenido supera una pantalla (`cobro-375`, `producto-editar-375`, `stock-ajuste-375`, `compra-recepcion-375`).

### 4.4 Enlaces que no llevan a ningún lado

| Origen                                | Enlace                    | Qué pasa                                                                | Evidencia                             |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| Libro de movimientos → «Recepción #N» | `/compras/recepcion/:id`  | **404** (la ruta no existe; `/compras/[id]` recibe «recepcion» como id) | verificado                            |
| Devolución → «Entrega #N»             | `/compras/recepcion/:id`  | **404**                                                                 | código                                |
| Devolución → nombre del producto      | `/productos/:id`          | **404** (no hay página de producto)                                     | verificado                            |
| Proveedor → producto que se le compra | `/productos?producto=:id` | Abre el catálogo sin filtrar ni resaltar                                | código (`/productos` ignora la query) |
| Libro de movimientos → «Venta #N»     | `/ventas?venta=:id`       | Abre el listado completo, sin filtrar                                   | verificado                            |

---

## 5. Roles y usuarios

### 5.1 Los roles que existen (código) y los que se pidieron (personas)

| Rol en el sistema     | Persona del pedido | Qué puede (resumen de 65 permisos)                                                                                                                                              | Observación                                                                                                                |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `cajero` / `vendedor` | **Cajero**         | Vender, ver ventas, catálogo, stock, caja (ver, arquear, abrir, cerrar), clientes, cuenta corriente, fiar, cobrar deudas                                                        | No puede anular, no puede crear productos (`products.quickCreate` es del supervisor para arriba), no ve costos ni reportes |
| `supervisor`          | Cajero senior      | Cajero + anular, movimientos de caja, ajustar stock, alta rápida, reportes de ventas/caja/inventario/clientes, autorizar exceso de crédito, aplicar inventarios                 | Es el escalón que resuelve excepciones en el mostrador                                                                     |
| `encargado`           | **Encargado**      | Casi todo salvo usuarios, bitácora y sucursales                                                                                                                                 | Es quien opera el sistema completo                                                                                         |
| `repositor`           | **Repositor**      | Ver catálogo, stock, movimientos, lotes; ajustar; crear y contar inventarios; ver devoluciones                                                                                  | No aplica inventarios, no recibe mercadería, no ve precios de costo                                                        |
| `compras`             | **Compras**        | Catálogo (crear, editar, costos), proveedores, órdenes, recepciones, cancelar, cuenta corriente y pagos a proveedor, devoluciones, lotes, reportes de compras/costos/inventario | No vende ni toca la caja (control contra desvío). Ve la ganancia bruta en Inicio                                           |
| `duenio` / `admin`    | **Dueño**          | Todo                                                                                                                                                                            | Hoy idénticos; se separaron pensando en varias sucursales                                                                  |
| `auditor`             | —                  | Sólo lectura de todo, incluida la bitácora                                                                                                                                      | Sin escritura, a propósito                                                                                                 |

**Hallazgo de roles:** las personas del pedido calzan uno a uno con los roles existentes. La separación «cambiar precio ≠ editar ficha», «ver costo ≠ ver catálogo», «comprar ≠ cobrar» es correcta y poco común en sistemas de este tamaño. Lo que falta no es un rol: es que **la pantalla de inicio y la navegación se diseñen por rol**, no que se filtren por permiso (§31).

### 5.2 Personas operativas

#### Cajero (Lucía)

- **Quiere:** escanear, cobrar, buscar por nombre, crear rápido cuando corresponde, consultar un precio, cobrar una deuda al que pasa a pagar.
- **No quiere:** costos, configurar productos, reportes, saber qué es un «medio de pago combinado» antes de necesitarlo.
- **Hoy tiene:** 8 entradas de menú, un Inicio con «Efectivo en caja / Ventas de hoy / Faltantes» (la tercera no le sirve), un POS bueno pero con el cobro fuera del pliegue y sin consulta de precio. Para cobrar una deuda tiene que salir del POS a Clientes (3 pantallas).
- **Home ideal:** el POS mismo. Si la caja está cerrada, la apertura aparece adentro del POS. Un solo botón de menú.
- **Navegación ideal (móvil):** Vender · Caja · Clientes · Más. **Escritorio:** POS a pantalla completa con la barra contraída.
- **Visible:** ticket, cobro, cliente, consulta de precio, abrir/cerrar caja, arqueo, mis ventas de hoy (para anular hay que llamar a alguien, y la pantalla lo dice).
- **Oculto:** todo lo demás.
- **Quick actions:** Cobrar (Enter), Consultar precio (`?`), Cliente (`C`), Abrir/cerrar caja, Última venta.

#### Encargado (Marina)

- **Quiere:** resolver excepciones (anular, autorizar exceso, reactivar producto), cambiar precios, controlar la caja, revisar problemas (faltantes, vencidos, diferencias), autorizar.
- **Hoy tiene:** 16 entradas, un Inicio con 10 tarjetas de igual peso (`inicio-admin-1920`) y dos listas; el precio se cambia dentro de una ficha de cinco secciones.
- **Home ideal:** «Qué necesita mi atención hoy»: caja abierta/cerrada y por quién, diferencias de arqueo, agotados y vencidos, órdenes a medio recibir, clientes sobre el límite, inventarios sin aplicar. Cada tarjeta lleva a resolver.
- **Navegación:** Inicio · Vender · Caja · Stock · Compras · Clientes · Reportes · Administración.
- **Quick actions:** Cambiar precio (buscar → precio → guardar, sin abrir la ficha), Anular una venta, Abrir/cerrar caja de otro, Ajustar stock, Nuevo producto.

#### Repositor (Tomás)

- **Quiere:** ver qué falta, ajustar, contar, ver lotes y vencimientos. Usa el celular en el depósito.
- **Hoy tiene:** un Inicio correcto (`inicio-repositor-1366`: Faltantes, Vencidos, Hay que reponer); un ajuste de stock bueno pero con error prematuro; un conteo hecho para escritorio (47 inputs, Enter no avanza, sin escaneo); lotes sin acción.
- **Home ideal (móvil):** Faltantes · Vencidos · Contar · Escanear (ajuste directo desde el código).
- **Navegación móvil:** Stock · Contar · Recibir · Más. Escaneo con cámara como acción principal.
- **Quick actions:** Escanear para ajustar, Rotura, Vencido (dar de baja el lote), Recuento de un producto, Continuar el conteo abierto.

#### Compras (Delia)

- **Quiere:** faltantes, proveedores, órdenes, recepciones, costos, pagos según permiso.
- **Hoy tiene:** 12 entradas; «Sugerencia de pedido» existe en la API y no en la pantalla; la recepción exige una orden previa; un Inicio que le muestra la ganancia bruta del día (no la necesita para su trabajo).
- **Home ideal:** Órdenes esperando mercadería · Vencimientos de pago esta semana · Faltantes agrupados por proveedor con botón «Armar pedido» · Recibir sin orden.
- **Navegación:** Compras (Órdenes · Recibir · Proveedores) · Stock · Reportes de compras.
- **Quick actions:** Recibir mercadería (con o sin orden), Armar pedido con faltantes, Pagar a proveedor, Devolver.

#### Dueño (Héctor)

- **Quiere:** saber cómo va el negocio: caja, ventas, margen, deuda, stock, alertas. Entra dos veces por día, muchas veces desde el celular.
- **Hoy tiene:** el mismo Inicio que el admin y un reporte de 11 secciones en una sola página de 8.465 px (1366) / 10.966 px (375).
- **Home ideal:** cuatro números (vendido hoy, ganancia hoy, efectivo en caja, por cobrar − por pagar) y cinco alertas accionables. Reportes por tema, con pestañas y comparación contra el período anterior.
- **Navegación:** Inicio · Reportes · Caja · Administración. Todo lo demás, en «Más».
- **Quick actions:** Ventas de hoy, Cerrar el día (si quedó una caja abierta), Deudores, Cuentas por pagar esta semana.

---

## 6. Simulación de un día real

Se ejecutó, no sólo se leyó: la venta, el cierre y la apertura de caja y el inventario se hicieron de verdad en la base de demostración. Pantalla y pasos medidos con el sistema tal como está; «ideal» es la cantidad de pasos del rediseño de §22–§30.

| Hora  | Situación                                                                         | ¿Se puede?                                                                                       | Desde                                                                                                                                                                                                                | Pasos hoy                                                                                                         | Ideal                           | Puntos confusos / campos de más / conocimiento técnico                                                                                                                                                                 | Dead ends / errores probables / recuperación                                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 07:55 | Encargado abre el local                                                           | Sí                                                                                               | `/login`                                                                                                                                                                                                             | 3 (usuario, clave, Entrar)                                                                                        | 3                               | Ninguno. El login es impecable en los cuatro anchos                                                                                                                                                                    | La sesión vence «tras un rato sin uso» y lo dice al volver. Sin lista de apertura del local (opcional)                                                                                                                      |
| 08:00 | Cajero abre caja                                                                  | Sí                                                                                               | `/caja` → Abrir la caja → efectivo inicial → Abrir                                                                                                                                                                   | 4                                                                                                                 | 3 (desde el POS)                | «Puede ser cero» ayuda. Si el cajero va directo a Venta, un banner lo manda a Caja: **navegación de ida y vuelta** que sobra                                                                                           | Sin la caja abierta la venta se rechaza al confirmar con un mensaje claro pero sin botón para abrirla ahí                                                                                                                   |
| 08:10 | Primer cliente: 5 productos, uno escaneado, uno buscado, efectivo                 | Sí                                                                                               | `/venta`                                                                                                                                                                                                             | Escaneo ×4 (0 clics) + Ctrl+K, «yer», ↓, Enter + F12 + «con cuánto paga» + Enter + Nueva venta = **~10 acciones** | 7                               | F12 no se descubre solo (está escrito en el botón, lo que ayuda). En 1366×768 el botón «Cobrar» del diálogo queda **debajo del pliegue** (`cobro-1366`): hay que desplazar. El vuelto aparece en texto chico           | Recuperación buena («Volver»). Error probable: confundir «Importe» con «Con cuánto paga» (dos campos numéricos contiguos)                                                                                                   |
| 08:20 | Producto desconocido, alta rápida                                                 | Sí (supervisor/encargado); el cajero no tiene el permiso y la pantalla le dice a quién pedírselo | POS → bloque «Código no registrado» → Crear producto → nombre, precio, (categoría por omisión), Enter                                                                                                                | 5                                                                                                                 | 5                               | Ninguno. Es el mejor flujo del sistema (`venta-alta-rapida-1366`)                                                                                                                                                      | Creado con 0 unidades: avisa y manda a «Stock → Ajustar» en vez de ofrecer cargar el stock ahí                                                                                                                              |
| 09:00 | Venta combinada efectivo + transferencia                                          | Sí                                                                                               | Cobro → escribir importe efectivo → «+ Agregar otro medio» → cambiar el `select` de «Débito» a «Transferencia» → Cobrar                                                                                              | 6                                                                                                                 | 3                               | El segundo renglón arranca en **Débito** (el primer medio no usado), no en lo que se suele pedir; el medio es un `select` nativo; hay que tipear un importe en el primer renglón para que el resto caiga en el segundo | Sin dead ends. Error probable: dejar el segundo renglón en Débito                                                                                                                                                           |
| 10:00 | Cliente conocido compra fiado                                                     | Sí                                                                                               | Cobro → medio «A cuenta» → el selector se abre solo → «Juan» → elegir → previsualización de crédito → Cobrar                                                                                                         | 6                                                                                                                 | 5                               | «A cuenta» escondido dentro del `select` de medios; asterisco rojo en «Cliente» sin explicación; la previsualización (5 números) es excelente                                                                          | Sobre el límite: el cajero ve por qué y a quién pedírselo; el encargado marca la casilla y queda con su nombre. Correcto                                                                                                    |
| 10:30 | Otro cliente paga parte de su deuda                                               | Sí                                                                                               | `/clientes` → buscar → ficha → Registrar pago → importe → Registrar → comprobante                                                                                                                                    | 7 y **3 pantallas fuera del POS**                                                                                 | 4 (desde el POS)                | El importe propuesto es la deuda entera; hay que reescribirlo. El comprobante se abre solo (bien) pero deja al cajero lejos del POS                                                                                    | El ticket en curso sobrevive (bien). Cobrar fiado desde el POS no existe                                                                                                                                                    |
| 11:00 | Llega proveedor: orden, recepción, producto nuevo, lote, vencimiento, costo nuevo | Sí, **si hay orden previa**                                                                      | `/compras/nueva` → proveedor → buscar → (Crear producto inline) → cantidad, unidad, contiene, costo → Confirmar → detalle → Recibir → costo de factura → partidas (sólo si el producto ya rastrea lotes) → Confirmar | **~15**                                                                                                           | 8 (recepción directa)           | «Contiene 1.000», «Unidad de compra», «Pendiente 30.000 unidad»: vocabulario y formato técnicos. Para cargar lote y vencimiento el producto tiene que tener activada la trazabilidad, que está al fondo de la ficha    | **Recibir sin orden no se puede**: el proveedor que llega sin pedido obliga a crear y confirmar una orden antes. Error probable: leer «30.000» como treinta mil                                                             |
| 13:00 | Producto roto                                                                     | Sí                                                                                               | `/stock` → buscar → Ajustar → «Rotura» → (partida) → cantidad → chip de motivo → Guardar                                                                                                                             | 7                                                                                                                 | 5                               | El campo «De qué partida» aparece **ya en rojo** antes de tocar nada (`stock-ajuste-375`). El motivo se pide aunque el tipo ya lo dice                                                                                 | Recuperación: otro ajuste. Bien explicado en el diálogo                                                                                                                                                                     |
| 14:00 | Mercadería vencida                                                                | Sí, por un camino largo                                                                          | Inicio «Vencidos» → `/stock/lotes` (sólo lectura) → `/stock` → buscar → Ajustar → «Pérdida» → elegir la partida vencida → cantidad → motivo → Guardar                                                                | 9                                                                                                                 | 3 («Dar de baja» desde el lote) | La lista de lotes muestra VENCIDO en rojo y no ofrece nada. El POS ya no lo vende (bien)                                                                                                                               | **Dead end suave**: el repositor tiene que saber que la baja se hace desde otra pantalla                                                                                                                                    |
| 15:00 | Proveedor recibe la devolución                                                    | Sí                                                                                               | `/compras/[id]` → Recepción → Devolver mercadería → cantidad → motivo → Crear borrador → `/devoluciones/[id]` → Confirmar → diálogo de confirmación                                                                  | 8, **2 pantallas, 2 confirmaciones**                                                                              | 5                               | «Borrador» para dos bolsas de harina es más ceremonia que la que un almacén usa. Los cuatro números (recibido, devuelto, disponible, en depósito) son claros                                                           | Sin dead ends                                                                                                                                                                                                               |
| 16:00 | Pago parcial a proveedor                                                          | Sí                                                                                               | `/proveedores/[id]` → Registrar pago → importe → medio → Registrar → comprobante                                                                                                                                     | 6                                                                                                                 | 5                               | Previsualización FIFO excelente. «Aplicación» y «Se imputan» son palabras de contador                                                                                                                                  | Sin dead ends                                                                                                                                                                                                               |
| 17:00 | Inventario mientras se vende                                                      | Sí                                                                                               | `/inventarios` → Nuevo → (todo, a ciegas) → Crear → 47 casillas → Guardar conteos                                                                                                                                    | 4 + 47                                                                                                            | 4 + escaneo                     | Enter no pasa a la siguiente línea (Tab sí); no hay escaneo ni búsqueda dentro del conteo; las líneas «sin asignar» de un producto con lotes no se explican; en móvil es una tabla larguísima                          | **Dead end 1**: un inventario creado por error no se cancela desde la pantalla. **Dead end 2**: no se puede cerrar con líneas sin contar (mensaje claro, sin salida). La concurrencia con ventas funciona (diseño correcto) |
| 18:00 | Revisar diferencias                                                               | Sí                                                                                               | Cerrar conteo → filtros «con diferencia» / «sin resolver»                                                                                                                                                            | 2 + lectura                                                                                                       | 2                               | Buen filtro. El conflicto con otra sesión se avisa antes de aplicar (bien)                                                                                                                                             | **Dead end 3**: una línea «sin resolver el lote» **no tiene control para resolverla**; la API existe                                                                                                                        |
| 19:00 | Aplicar inventario                                                                | Sí                                                                                               | «Aplicar diferencias»                                                                                                                                                                                                | **1 clic, sin confirmación**                                                                                      | 2                               | —                                                                                                                                                                                                                      | Irreversible y sin confirmar (la matriz de acciones peligrosas dice «confirma: sí»; la pantalla no)                                                                                                                         |
| 20:00 | Arqueo y cierre                                                                   | Sí                                                                                               | `/caja` → Cerrar la caja → efectivo contado → «Cuadra / Falta / Sobra» → Cerrar                                                                                                                                      | 4                                                                                                                 | 4                               | Ninguno. La mejor pantalla del sistema (`caja-cerrar-375`). El umbral de autorización se descubre recién después del rechazo (segundo paso)                                                                            | Sin dead ends. Un turno cerrado no se reabre, y lo dice antes                                                                                                                                                               |

**Tiempo estimado del día para un operador nuevo** (sin contar la atención al cliente): las tareas del cajero se aprenden en 15 minutos con la ayuda de alguien; las de compras e inventario requieren que alguien explique «orden → recepción», «trazabilidad» y «sin asignar». Nada del día requirió tocar la base de datos ni conocer la API.

---

## 7. Veredicto operacional

### B — Podría operar, pero con mejoras UX importantes

**Por qué no es A.** Tres de las tareas más frecuentes tienen fricción medible: cobrar (CTA fuera del pliegue en la resolución más común y en móvil), leer cantidades (formato ambiguo en seis pantallas) y moverse con el teclado en el POS (sin flechas sobre el ticket, dependencia de F12). Dos flujos diarios de depósito terminan en callejones (inventario que no se cancela, línea que no se resuelve). Y dieciséis pantallas están sin margen, con botones fuera del borde en celular.

**Por qué no es C.** Un cajero nuevo vende, busca, cobra y corrige una cantidad en cinco minutos: el escaneo no pide clics, el ticket es claro, el resultado de la venta dice el vuelto y el botón «Nueva venta» está a un Enter. Las funciones administrativas complejas (imputar anticipos, trazabilidad, devoluciones) sí necesitan experiencia, y eso es aceptable.

**Por qué no es D ni E.** No falta ninguna función esencial para operar un almacén de una sucursal: hay caja por turnos, fiado, compras con recepción parcial, cuenta corriente de proveedores, lotes e inventario. Lo que falta (§8) son comodidades y algunas prácticas del rubro (ticket impreso, consulta de precio, recepción sin orden, devolución parcial), ninguna de las cuales impide abrir.

### BLOCKERS (hay que resolverlos antes de poner a operar a alguien que no conozca el sistema)

| #   | Qué                                                                                                    | Dónde                                                               | Evidencia                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| B1  | El botón «Cobrar» del diálogo queda fuera de la vista en 1366×768 y en todos los celulares             | POS → Cobro                                                         | `cobro-1366`, `cobro-375`, medido: pie del diálogo por debajo de 768 px                                    |
| B2  | Cantidades con tres decimales que se leen como miles («30.000», «33.000», «5.000»)                     | Recepción, órdenes, movimientos, inventario, lotes, reportes, ficha | `compra-recepcion-375`, `compra-detalle-1366`, `movimientos-1366`, `reportes-1366`, `producto-editar-1366` |
| B3  | Inventario: no se puede cancelar, no se puede resolver una línea, no se puede cerrar parcialmente      | `/inventarios/[id]`                                                 | verificado en vivo (IF-00000002 quedó «Contando» sin salida)                                               |
| B4  | Cuatro enlaces a 404 desde el libro de movimientos y las devoluciones; dos filtros por query ignorados | `/stock/movimientos`, `/devoluciones/[id]`, `/proveedores/[id]`     | verificado                                                                                                 |

### IMPORTANTES

| #   | Qué                                                                                                                                                                                      | Dónde                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| I1  | Códigos técnicos a la vista: `CASH`, `DEBIT_CARD`, `customer_payment`; filtro de medios con valores heredados («Mercado Pago» = transferencia; «Tarjeta» no encuentra débito ni crédito) | `/ventas`, `/caja`                                                                       |
| I2  | Gramática de teclado incompleta y dependiente de F-keys y combinaciones                                                                                                                  | POS, inventario, recepción                                                               |
| I3  | Contenedor de página inconsistente (16 pantallas sin margen; botones fuera del borde en móvil)                                                                                           | Clientes, proveedores, compras, devoluciones, inventarios, lotes, reportes, comprobantes |
| I4  | Filas duplicadas en escritorio (tabla + tarjetas)                                                                                                                                        | Lotes, inventarios, conteo                                                               |
| I5  | Acciones irreversibles sin confirmación: aplicar inventario, cerrar conteo, cortar fiado, dar de baja proveedor desde la lista                                                           | varios                                                                                   |
| I6  | Textos obsoletos que niegan funciones existentes; matriz de permisos con 24 de 65; claves técnicas en Configuración                                                                      | `/configuracion`, `/usuarios`                                                            |
| I7  | Recepción sin orden previa no existe; sugerencia de pedido existe en la API y no en la UI                                                                                                | Compras                                                                                  |
| I8  | Cobrar deuda, consultar precio y cobrar fiado viven fuera del POS o no existen                                                                                                           | POS                                                                                      |
| I9  | Móvil: diálogos de `92dvh` con el pie fuera de la vista; Reportes de 10.966 px; filtros que ocupan la primera pantalla                                                                   | Cobro, ficha, ajuste, recepción, reportes, movimientos, auditoría                        |
| I10 | El panel de turno muestra Inicial + Ventas = Tiene que haber sin ingresos ni egresos: la cuenta no cierra a simple vista                                                                 | `/caja`                                                                                  |

### MEJORAS

| #   | Qué                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Segundo renglón de pago arranca en Débito; medio en `select` en vez de botones; sin atajos de importe («$20.000», «Justo»)                                                                               |
| M2  | Vuelto y total del resultado de venta con la misma jerarquía que el resto                                                                                                                                |
| M3  | Error prematuro en «De qué partida» del ajuste de stock                                                                                                                                                  |
| M4  | Focus: tras quitar una línea del ticket el foco cae al `body`; 600 ms después de cerrar un diálogo el foco vuelve por la fuerza al lector aunque el usuario haya hecho clic en la búsqueda               |
| M5  | Bloque «Código no registrado» y línea «ingresá el peso» quedan en pantalla después de resolverse                                                                                                         |
| M6  | «Ticket recuperado» exige «Entendido» cada vez; podría ser un aviso efímero                                                                                                                              |
| M7  | Métrica «Productos en esta página» en Stock; «Tiene que haber» duplicado en Caja; badge «En venta» en cada fila de Productos                                                                             |
| M8  | Fechas en tres formatos (`04/09/26, 11:37 p. m.`, `2026-09-05`, `4/9, 07:26 p. m.`) y los `<input type="date">` nativos dependen del idioma del dispositivo (en la evidencia aparecen como `mm/dd/yyyy`) |
| M9  | Diálogo de ficha de producto: 14 campos a la vista, 3 desplazamientos en 768 px                                                                                                                          |
| M10 | Hint «Ctrl+K o / para buscar · ↑↓ para elegir» visible en celular                                                                                                                                        |

### NICE TO HAVE

Balanza conectada (el stub ya existe), imágenes de producto, etiquetas internas, promociones y combos, exportar reportes, comparación de períodos, transferencias entre sucursales, venta offline.

---

## 8. Funciones faltantes

Criterio: qué necesita un almacén de barrio para operar todos los días sin inventar procedimientos por afuera del sistema. No todo lo que se sugirió en el pedido hace falta; se dice cuál sí y por qué.

### NECESARIO PARA OPERAR

| Función                                                           | Por qué es necesaria                                                                                                                                                                                                                                    | Qué hay hoy                                                                                                                                | Costo estimado                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **Recepción directa (compra sin orden previa)**                   | En un almacén la mayoría de los proveedores llegan con el camión, sin pedido formal. Hoy hay que crear una orden, confirmarla y recién después recibirla: ~10 pasos de ceremonia para cargar lo que ya está en la puerta, y la tentación es no cargarlo | El modelo lo soporta (una orden creada y recibida en el mismo acto); falta la pantalla «Recibir mercadería» que genere la orden por detrás | Bajo: UI sobre `POST /api/purchases` + `/receive`                           |
| **Cancelar un inventario y resolver una línea desde la pantalla** | Sin esto, un conteo abierto por error queda «Contando» para siempre y una línea «sin resolver» bloquea aplicar el inventario. Las dos rutas de API existen                                                                                              | `/api/inventarios/:id/cancelar` y `/lineas/:id/resolver` sin botón                                                                         | Bajo                                                                        |
| **Dar de baja lo vencido desde el lote**                          | «Vencidos: 1» en el Inicio lleva a una lista de sólo lectura. El repositor tiene que ir a Stock → Ajustar → Pérdida → elegir partida. Hoy el sistema detecta lo vencido y no ofrece la acción                                                           | Ajuste con partida                                                                                                                         | Bajo: botón «Dar de baja» que abre el ajuste con tipo y partida precargados |

### IMPORTANTE

| Función                                                       | Por qué                                                                                                                                                                 | Qué hay hoy                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Consulta rápida de precio**                                 | «¿Cuánto sale?» es la pregunta más frecuente después de «cobrame». Hoy escanear agrega al ticket; buscar por nombre sí muestra el precio sin agregar, pero el lector no | Un modo «consulta» (`?`) en el POS: escanear muestra precio y stock sin tocar el ticket             |
| **Ticket de venta para el cliente (no fiscal), reimprimible** | El cliente pide el papel; el fiado necesita constancia; el arqueo se discute con el ticket en la mano. Hoy sólo se imprimen los comprobantes de pago                    | `window.print()` con una hoja de estilo de 58/80 mm, como ya hacen los comprobantes. Sin biblioteca |
| **Ticket en espera / recuperar**                              | Uno busca la billetera, otro quiere pagar. Hoy el ticket es uno solo por sucursal y navegador                                                                           | «Dejar en espera» guarda el ticket con nombre; «Recuperar» lo trae. Local al navegador alcanza      |
| **Devolución parcial y cambio de producto**                   | Devolver una gaseosa hoy es anular la venta entera y volver a cobrar todo                                                                                               | Anulación parcial por línea (mismo mecanismo: contramovimiento de stock y caja)                     |
| **Descuento / redondeo por ticket**                           | «Te lo dejo en 10.000» es diario. Hoy el esquema lo rechaza a propósito (bien: evita descuentos invisibles)                                                             | Un descuento por ticket con motivo y permiso, visible en el reporte de ventas                       |
| **Cobrar una deuda desde el POS**                             | El que pasa a pagar no quiere que el cajero salga a otra pantalla                                                                                                       | Acción «Cobrar deuda» en el selector de cliente del POS (reusa `clients/:id/pagos`)                 |
| **Sugerencia de pedido → borrador de orden**                  | La ruta `purchases/draft-from-restock` existe; los faltantes ya están calculados                                                                                        | Botón «Armar pedido con los faltantes» en Stock y en Inicio (compras)                               |
| **Configuración de la sucursal**                              | Umbral de diferencia, exigir turno, zona horaria, nombre del comercio: hoy viven en la base o en una variable de entorno                                                | Pantalla de sucursal con `branches.manage`                                                          |
| **Cambio de clave desde la aplicación**                       | Hoy exige un script en el servidor                                                                                                                                      | Pantalla «Mi cuenta» (clave actual + nueva) y «Restablecer» para admin                              |
| **Gestión de categorías**                                     | Se crean inline; no se pueden renombrar ni ordenar                                                                                                                      | Lista simple dentro de Productos                                                                    |
| **Anular desde el POS (última venta)**                        | Hoy hay que ir a Ventas y encontrarla                                                                                                                                   | «Última venta → Anular» con el mismo diálogo y permiso                                              |

### MEJORA FUTURA

| Función                                                  | Comentario                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Etiquetas / códigos internos para lo que no tiene código | Con favoritos en el POS (§22) la necesidad baja mucho; queda para fiambrería                                                           |
| Promociones y combos                                     | Sólo después de descuentos por ticket, y con reporte propio                                                                            |
| Balanza integrada                                        | `src/lib/scale.ts` ya deja el punto de entrada; hoy el peso se tipea y funciona                                                        |
| Exportar reportes (CSV) y comparación de períodos        | El contador lo va a pedir                                                                                                              |
| Reposición con sugerencia por consumo                    | Cuando haya 3 meses de historia                                                                                                        |
| Imágenes de producto                                     | Poco valor en almacén; útil sólo para favoritos táctiles                                                                               |
| Transferencias entre sucursales                          | Bloqueado por la decisión de arquitectura de códigos de barras (`DEFERRED MULTIBRANCH BLOCKER`, `docs/BARCODE_BRANCH_ARCHITECTURE.md`) |

### NO NECESARIO AHORA

| Función                              | Por qué no                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ubicaciones de depósito              | Un almacén no las usa; agregarlas es un campo más en cada alta                                                                                    |
| ARCA / facturación electrónica       | Decisión fiscal del dueño, no de UX. Si el negocio factura, es un módulo entero. Hoy el sistema es explícito: «Documento no fiscal»               |
| Conciliación bancaria                | No hay cuentas bancarias modeladas; los pagos por transferencia se registran con referencia y alcanza                                             |
| Venta sin conexión                   | Decisión de arquitectura documentada. El riesgo real es un corte de internet: se mitiga con un plan de datos en el celular, no con sincronización |
| Integración de balanza por protocolo | Ver arriba: mejora futura                                                                                                                         |

---

## 9. Funciones redundantes / complejidad

Lo que sobra, lo que está demasiado expuesto, lo que debería fusionarse y lo que debería ser contextual. Más funciones no es mejor producto.

| Qué                                                                                    | Problema                                                                                                                                                | Propuesta                                                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Menú de 17 entradas en 6 grupos**                                                    | Movimientos, Lotes, Inventarios, Devoluciones, Ventas, Sucursales y Auditoría son subvistas, no destinos. Un repositor ve 8 entradas para hacer 3 cosas | 8 áreas (§20); lo demás dentro de su área como pestañas o botones                                  |
| **`/productos` y `/stock` son la misma lista**                                         | Misma búsqueda, mismos filtros, misma tabla; cambian dos columnas y el botón de la fila (menú ⋯ vs «Ajustar»)                                           | Una sola pantalla «Productos» con vista «Catálogo / Existencias» y las acciones según permiso      |
| **«Ventas» como destino**                                                              | Existe para anular y para ver el día. Las métricas de arriba repiten las del Inicio                                                                     | Pestaña «Ventas de hoy» dentro de Caja; historial completo en Reportes                             |
| **«Tiene que haber» dos veces en Caja** (panel + tarjeta)                              | Redundante                                                                                                                                              | Una vez, grande, con el desglose a un clic                                                         |
| **Métrica «Productos en esta página»**                                                 | No informa nada                                                                                                                                         | Quitar                                                                                             |
| **Badge «En venta» en las 25 filas**                                                   | Sólo «De baja» es información                                                                                                                           | Mostrar sólo la excepción                                                                          |
| **`/sucursales` de sólo lectura con dos tarjetas**                                     | Es una nota informativa, no una pantalla                                                                                                                | Sección dentro de Configuración                                                                    |
| **Configuración: 65 claves de permiso, nombre de variable de entorno, lista obsoleta** | Vocabulario técnico y afirmaciones falsas                                                                                                               | Quitar las tres cosas; mostrar «Podés: vender, cobrar, …» en lenguaje humano                       |
| **Matriz de permisos con 24 de 65**                                                    | Información incompleta que parece completa                                                                                                              | O completa y generada desde el catálogo, o quitarla                                                |
| **Botón «+ Producto» en la barra principal del POS**                                   | Acción rara (una vez por día) en el lugar más caro. En móvil ocupa una fila entera                                                                      | Al menú «…» del POS o sólo dentro del bloque «Código no registrado»                                |
| **Segundo conteo con umbral en el alta de inventario**                                 | Función avanzada visible en el formulario base                                                                                                          | «Más opciones»                                                                                     |
| **Trazabilidad dentro de la ficha de producto**                                        | Cambiar la política de lotes no es «editar un campo»                                                                                                    | Acción propia «Activar lotes» con un asistente de dos pasos                                        |
| **Dos roles iguales (`cajero`, `vendedor`)**                                           | Confunde al administrador                                                                                                                               | Un solo nombre visible («Cajero»); el alias queda en la base                                       |
| **Aviso permanente «Este libro no se edita»** en Movimientos                           | Ocupa 70 px en cada visita                                                                                                                              | Texto de pie de página o ayuda contextual una sola vez                                             |
| **«Menos vendidos» en Reportes**                                                       | Con 43 productos es «Más vendidos» al revés                                                                                                             | Reemplazar por «Sin ventas en el período» (ya se calcula el número)                                |
| **Hint «Ctrl+K o / para buscar · ↑↓ para elegir · Enter»** en móvil                    | Sin teclado físico no significa nada                                                                                                                    | Ocultarlo por debajo de `lg`                                                                       |
| **«Atajos de teclado» como enlace al pie**                                             | Es la única documentación de F12 y Alt+N                                                                                                                | Reemplazar por atajos descubribles (`kbd` en los botones, `?` para el panel)                       |
| **Dos confirmaciones para una devolución** (borrador + confirmar + diálogo)            | Tres pasos para dos bolsas de harina                                                                                                                    | Borrador opcional: «Devolver ahora» y «Guardar para confirmar después»                             |
| **Actividad reciente + Auditoría + Movimientos**                                       | Tres lugares para «qué pasó con este producto»                                                                                                          | Una ficha de producto (pantalla, no diálogo) con su historial; auditoría sólo para administradores |

---

## 10. Auditoría heurística

Criterios: 1 visibilidad del estado · 2 lenguaje del usuario · 3 control y libertad · 4 consistencia · 5 prevención de errores · 6 reconocimiento antes que memoria · 7 eficiencia · 8 minimalismo · 9 recuperación de errores · 10 ayuda contextual. Severidad S0–S4 (§2.3). Orden: por severidad y luego por frecuencia de uso de la pantalla.

### 10.1 Hallazgos S3–S4

| ID   | Pantalla                                                                                                     | Problema                                                                                                                                                                             | Sev.                                 | Evidencia                                                                                                                                                                                                                        | Por qué importa                                                                                                                                                           | Recomendación                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H-01 | POS → Cobro                                                                                                  | El pie del diálogo (Volver / Cobrar $) queda fuera de la vista en 1366×768 y en todo celular; hay que desplazar el diálogo para cobrar                                               | S3 (7)                               | `cobro-1366`, `cobro-375`; el diálogo mide más que `92dvh − cabecera`                                                                                                                                                            | Es la acción más frecuente del sistema, con el cliente enfrente                                                                                                           | Cobro como panel con pie fijo; lista de ítems colapsada; total y CTA siempre visibles (§22, §29)                                                                   |
| H-02 | Recepción, orden, movimientos, inventario, lotes, reportes, ficha                                            | Cantidades con tres decimales sin separador local: «30.000» para 30, «5.000» para 5, «4.000 unidades»                                                                                | S3 (2, 5)                            | `compra-recepcion-375`, `compra-detalle-1366`, `movimientos-1366` («Anterior 33.000» junto a «Posterior 31»), `reportes-1366` («Unidades 7.000»), `inventarios-1366` («4.000 unidades»), `producto-editar-1366` («Mínimo 5.000») | En es-AR el punto es de miles. Un repositor recibe «30.000» y no sabe si son 30 o 30.000. `formatearCantidad` existe y se usa en el POS; el resto muestra la cadena cruda | Un solo componente de cantidad (`QuantityText`) que use `formatearCantidadConUnidad` en toda la app; prohibir renderizar `TextoCantidad` crudo (regla de lint)     |
| H-03 | Inventario físico                                                                                            | No se puede cancelar un inventario ni resolver una línea «sin resolver» desde la pantalla; no se puede cerrar con líneas pendientes                                                  | S3 (3, 9)                            | Verificado: IF-00000002 quedó «Contando»; `find "Cancelar"` sin resultados; API `/cancelar` y `/resolver` existen                                                                                                                | Un conteo equivocado bloquea el siguiente; una línea sin lote bloquea aplicar                                                                                             | Botón «Cancelar inventario» (con motivo); acción «Resolver» por línea (elegir lote o «sin lote»); «Cerrar contando lo que falta como 0» con confirmación explícita |
| H-04 | Movimientos, devoluciones, proveedores                                                                       | Enlaces a `/compras/recepcion/:id` (404), `/productos/:id` (404), `/ventas?venta=` y `/productos?producto=` (ignorados)                                                              | S3 (3, 9)                            | Verificado en vivo                                                                                                                                                                                                               | Un 404 desde el libro de inventario destruye la confianza en el sistema                                                                                                   | Crear `/compras/recepcion/:id` o apuntar a `/compras/:orderId#recepcion-N`; `/productos/:id` como ficha; que `/ventas` y `/productos` lean la query                |
| H-05 | Ventas, Caja                                                                                                 | Códigos técnicos: `CASH`, `DEBIT_CARD`, `customer_payment`; filtro de medios con valores heredados (`efectivo`, `tarjeta`, `mercado_pago`)                                           | S3 (2, 4)                            | `ventas-1366`, `caja-1366`; `MovimientoRow.medioLegible` sólo conoce las claves viejas                                                                                                                                           | «Mercado Pago» filtra transferencias; «Tarjeta» (→ `CARD`) no encuentra débito ni crédito; el cajero lee siglas en inglés                                                 | Usar `etiquetaDeMedio` (ya existe) en todos lados; filtro con los medios reales                                                                                    |
| H-06 | POS                                                                                                          | El teclado del ticket no es navegable: no hay ↑↓ sobre las líneas; +/−/Supr requieren llegar a la línea con Tab (8 tabulaciones desde el lector); tras Supr el foco cae al `body`    | S3 (7)                               | Verificado: `activeElement = BODY` tras Supr                                                                                                                                                                                     | Corregir una cantidad sin mouse es imposible en la práctica                                                                                                               | Gramática de §30: ↑↓ mueve la selección del ticket, ←→ cambia cantidad, Supr quita, foco vuelve a la línea siguiente                                               |
| H-07 | POS, alta rápida, peso                                                                                       | Dependencia de F12, Alt+N, Ctrl+K, `/`: ninguno se descubre solo; F12 abre las herramientas del navegador en cualquier otra pantalla                                                 | S3 (6)                               | `AyudaAtajos.tsx`; hint de texto chico                                                                                                                                                                                           | Un cajero nuevo no sabe que puede cobrar sin mouse                                                                                                                        | Enter como acción principal (ticket → cobrar); F12/Alt+N como alias; `kbd` visibles en los botones                                                                 |
| H-08 | Inventario físico (conteo)                                                                                   | Enter no pasa a la siguiente línea; no hay escaneo para saltar a un producto; sin búsqueda; guardado global arriba de una tabla de 47 filas; las líneas «sin asignar» no se explican | S3 (7, 10)                           | Verificado: `trasEnter = mismo input`; `inventarios/[id]`                                                                                                                                                                        | Contar 200 productos en un celular con este flujo es inviable                                                                                                             | Conteo guiado por escaneo (§27.9): escanear → foco en la línea → cantidad → Enter guarda y avanza; progreso visible                                                |
| H-09 | 16 pantallas                                                                                                 | Sin contenedor: `padding: 0`, sin ancho máximo. En móvil los títulos y botones tocan o superan el borde («Nuevo proveedor», «Registrar pago»)                                        | S3 en móvil, S2 en escritorio (4)    | `proveedores-375`, `cliente-detalle-375`, `compra-detalle-375`, `lotes-375`; medido `padding: 0px` en `/clientes` vs `20px` en `/caja`                                                                                           | Botones parcialmente fuera de la pantalla                                                                                                                                 | Un `PageContainer` único (§26)                                                                                                                                     |
| H-10 | Inventarios, conteo, lotes                                                                                   | En escritorio se dibujan la tabla **y** la lista de tarjetas con los mismos datos                                                                                                    | S2→S3 (4, 8)                         | `inventarios-1366`, `lotes-1366` (dos veces IF-00000001; «Leche entera 1 L» repetida)                                                                                                                                            | Parece que hay el doble de registros                                                                                                                                      | `CardList` con `md:hidden` o, mejor, una `DataTable` responsiva única                                                                                              |
| H-11 | Inventario → Aplicar; Clientes → Cortar fiado; Proveedores (lista) → Dar de baja; Inventario → Cerrar conteo | Acciones irreversibles o de política ejecutadas con un clic, sin confirmación                                                                                                        | S3 (5)                               | `inventarios/[id]/page.tsx`, `clientes/[id]/page.tsx`, `proveedores/page.tsx`                                                                                                                                                    | La matriz de acciones peligrosas afirma que confirman; la pantalla no                                                                                                     | `ConfirmDanger` con resumen del efecto (N líneas, M unidades) y motivo donde la matriz lo pide                                                                     |
| H-12 | Caja (turno)                                                                                                 | «Inicial $25.000 · Ventas $102.495 · Tiene que haber $99.725»: la suma no cierra a la vista porque faltan ingresos y egresos                                                         | S3 (1)                               | `caja-1366`, `caja-375`                                                                                                                                                                                                          | El cajero cree que el sistema calcula mal                                                                                                                                 | Mostrar los cuatro renglones (como el diálogo de cierre) o «Inicial + Ventas + Ingresos − Retiros = …»                                                             |
| H-13 | Compras                                                                                                      | Recibir mercadería exige una orden confirmada                                                                                                                                        | S3 (7)                               | `compras-1366` sólo tiene «Nueva compra»; `DialogoRecepcion` vive en el detalle                                                                                                                                                  | El proveedor está en la puerta y hay que hacer 10 pasos de trámite                                                                                                        | «Recibir mercadería» de primer nivel que crea la orden por detrás                                                                                                  |
| H-14 | Lotes                                                                                                        | La lista de lotes vencidos no ofrece acción                                                                                                                                          | S3 (7, 9)                            | `lotes-1366`: VENCIDO en rojo, sin botón                                                                                                                                                                                         | Detectar sin permitir actuar es un callejón                                                                                                                               | «Dar de baja» por fila (ajuste tipo pérdida con partida precargada)                                                                                                |
| H-15 | Reportes                                                                                                     | Once secciones apiladas en una sola página (8.465 px en 1366; 10.966 en 375), sin índice, pestañas ni exportación                                                                    | S3 en móvil, S2 en escritorio (7, 8) | `reportes-1366`, `reportes-375`                                                                                                                                                                                                  | El dueño no encuentra el número que vino a buscar                                                                                                                         | Reportes por tema con pestañas y un resumen arriba (§27.12)                                                                                                        |

### 10.2 Hallazgos S2

| ID   | Pantalla                                                   | Problema                                                                                                                                                           | Sev.      | Evidencia                                                                         | Por qué importa                                                                   | Recomendación                                                                                                           |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| H-16 | POS → Cobro                                                | Medio de pago en un `<select>`; el segundo renglón arranca en «Débito»; sin importes rápidos                                                                       | S2 (7)    | `cobro-combinado-1366`                                                            | Tres clics donde alcanzaría uno                                                   | Botones grandes por medio; segundo renglón con el medio más usado después del efectivo; chips $10.000 / $20.000 / Justo |
| H-17 | POS → Cobro                                                | «Vuelto: $ 2.395,00» en texto de 14 px debajo del campo; en el resultado, mismo tamaño que los pagos                                                               | S2 (1)    | `cobro-efectivo-vuelto-1366`; resultado de venta                                  | Es el número que se lee en voz alta                                               | Vuelto en tamaño `xl` en el panel y en `hero` en el resultado                                                           |
| H-18 | POS                                                        | Tras cerrar un diálogo, el foco vuelve al lector a la fuerza durante 600 ms aunque el cajero haga clic en la búsqueda; el texto termina en el campo de código      | S2 (3)    | Reproducido: «gase» tipeado en el campo de código tras «Nueva venta»              | Una de cada N búsquedas rápidas se convierte en un «código no registrado» falso   | Devolver el foco una sola vez al terminar la transición (`afterLeave`) y no insistir si el usuario ya movió el foco     |
| H-19 | POS                                                        | El bloque «Código no registrado» y la línea «ingresá el peso» quedan después de resolverse; «Ticket recuperado» pide «Entendido» en cada carga                     | S2 (1, 8) | Verificado                                                                        | Ruido persistente sobre la zona de resultados                                     | Limpiar al siguiente evento; ticket recuperado como toast                                                               |
| H-20 | Stock → Ajuste                                             | «De qué partida» aparece en rojo con «Este producto exige decir de qué partida sale» antes de que el usuario toque nada                                            | S2 (5, 9) | `stock-ajuste-375`, `stock-ajuste-1366`                                           | Error antes del error: el usuario cree que hizo algo mal                          | Marcar el error al intentar guardar, o al salir del campo                                                               |
| H-21 | Ficha de producto                                          | 14 campos en cinco secciones más trazabilidad y actividad, todo a la vista; tres pantallas de desplazamiento en 768 px; precios crudos en los inputs («4850.00»)   | S2 (8)    | `producto-editar-1366`, `producto-editar-375`                                     | Cambiar un precio obliga a leer catorce campos                                    | Progressive disclosure (§16); `MoneyInput` con formato local                                                            |
| H-22 | Caja → Cierre                                              | El umbral de autorización se descubre recién cuando el servidor rechaza el cierre («segundo paso»); la pantalla lo anticipa sólo si conoce el umbral               | S2 (1, 5) | `DialogoCerrarCaja`                                                               | Cerrar con faltante grande da un error rojo antes de ofrecer «Autorizar y cerrar» | Mostrar el umbral desde el principio y ofrecer el botón de autorizar sin rechazo previo                                 |
| H-23 | Configuración                                              | «Lo que todavía no está» dice que no hay turnos, compras, proveedores ni clientes; muestra 65 claves de permiso y `NEXT_PUBLIC_COMMERCE_NAME`                      | S2 (2, 4) | `configuracion-1366`, `configuracion-375`                                         | El sistema niega funciones que tiene                                              | Quitar la lista; permisos en lenguaje humano; nombre del comercio editable desde Sucursal                               |
| H-24 | Usuarios → Matriz                                          | Muestra 24 de los 65 permisos; sin cabecera fija al desplazar                                                                                                      | S2 (1, 4) | `usuarios-1366` (desplazada)                                                      | Parece completa y no lo es                                                        | Generar la matriz desde `PERMISSIONS` con etiquetas humanas, o quitarla                                                 |
| H-25 | Móvil: Ventas, Movimientos, Auditoría, Clientes, Productos | Filtros y métricas ocupan la primera pantalla entera; la lista empieza dos pantallas abajo                                                                         | S2 (7, 8) | `ventas-375`, `movimientos-375`, `auditoria-375`, `clientes-375`                  | En un celular el contenido es lo último que se ve                                 | Filtros colapsados detrás de un botón «Filtrar (2)»; métricas en una fila compacta                                      |
| H-26 | Devoluciones, cuenta de proveedor, detalle de compra       | Tablas de 7–9 columnas sin versión de tarjetas: en móvil se desplazan por dentro                                                                                   | S2 (4)    | `devoluciones-375` (no capturada: tabla con scroll interno), `compra-detalle-375` | Comparar columnas arrastrando el dedo                                             | `DataTable` responsiva con columnas prioritarias                                                                        |
| H-27 | Fechas                                                     | Tres formatos: `04/09/26, 11:37 p. m.`, `2026-09-05`, `4/9, 07:26 p. m.`; los `<input type="date">` nativos muestran `mm/dd/yyyy` si el dispositivo está en inglés | S2 (4)    | `movimientos-1366` («vence 2026-09-05»), `ventas-1366` («08/28/2026»)             | El mismo día se escribe de tres maneras                                           | Un `formatearFecha` con dos variantes (corta, con hora) y un selector de fecha propio o `lang="es-AR"` forzado          |
| H-28 | Inicio                                                     | Diez tarjetas del mismo peso en tres filas (la tercera con dos huecos); nada distingue una alerta («Vencidos 1») de una cifra informativa («Recaudado hoy»)        | S2 (8, 1) | `inicio-admin-1920`, `inicio-admin-1366`                                          | Lo urgente no salta                                                               | Dashboard por rol con alertas primero (§31)                                                                             |
| H-29 | POS (1920)                                                 | La zona de resultados vacía ocupa 1.250×860 px con un texto en el centro; el ticket queda en 399 px                                                                | S2 (8)    | `venta-con-productos-1920`                                                        | Espacio para favoritos, últimos vendidos y un ticket más ancho                    | Layout de §22                                                                                                           |
| H-30 | Menú de usuario                                            | «Cerrar sesión» sin confirmación borra el ticket en curso (documentado a propósito)                                                                                | S2 (3)    | `UserMenu.tsx`                                                                    | Un clic fallido en el mostrador borra 15 líneas                                   | Confirmar sólo si hay ticket con líneas                                                                                 |
| H-31 | Ventas                                                     | Botón rojo «Anular» en las 25 filas del listado                                                                                                                    | S2 (5, 8) | `ventas-1366`                                                                     | La acción más peligrosa es también la más visible                                 | Dentro del detalle de la venta, con el mismo diálogo                                                                    |
| H-32 | Compras → Nueva                                            | «Unidad», «Contiene 1.000», «Costo» por línea: vocabulario de conversión en la tabla; el «Contiene» se edita por línea aunque casi nunca cambia                    | S2 (2, 8) | `compra-nueva-1366`                                                               | Compras necesita saber qué es «unidades por unidad de compra»                     | Mostrar «caja de 8» como texto y editar sólo al tocar                                                                   |
| H-33 | Recepción                                                  | El costo de factura se pide por línea aunque no haya cambiado; las partidas aparecen sólo si el producto rastrea lotes (regla invisible)                           | S2 (10)   | `compra-recepcion-1366`                                                           | «¿Y dónde pongo el vencimiento?»                                                  | Hint «Este producto no lleva lote. Activarlo» con enlace; costo colapsado («Cambió el precio?»)                         |
| H-34 | Conteo                                                     | Estado de la línea sólo en texto («Sin contar», «Contada»), sin progreso global visible al desplazarse                                                             | S2 (1)    | `inventarios/[id]`                                                                | 47 filas sin saber cuánto falta                                                   | Barra de progreso fija y filtro «sólo pendientes» por omisión                                                           |

### 10.3 Hallazgos S0–S1

| ID   | Pantalla            | Problema                                                                                                                                                         | Sev.                                                | Recomendación                                                               |
| ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| H-35 | Stock               | Métrica «Productos en esta página: 25»                                                                                                                           | S1                                                  | Quitar                                                                      |
| H-36 | Caja                | «Tiene que haber» repetido (panel y tarjeta); «Hacer arqueo» disponible con la caja cerrada                                                                      | S1                                                  | Una sola cifra; deshabilitar o explicar                                     |
| H-37 | Productos           | Badge «✓ En venta» en cada fila                                                                                                                                  | S1                                                  | Sólo «De baja»                                                              |
| H-38 | POS móvil           | Hint «Ctrl+K o / para buscar»; botón «+ Producto» a ancho completo                                                                                               | S1                                                  | Ocultar por debajo de `lg`; demover                                         |
| H-39 | Lotes / Inventarios | Título `h2` de 2xl repite el `h1` de la cabecera («Lotes» dos veces)                                                                                             | S0                                                  | Un solo título por pantalla                                                 |
| H-40 | Middleware          | Sólo `localhost:3099` y `localhost` responden: `next dev` (3000), la suite E2E (3101) y `pwa:check` (3100) reciben «Host no reconocido»                          | S3 para el equipo de desarrollo, S0 para el usuario | Permitir `localhost:*` fuera de producción o leer los hosts de una variable |
| H-41 | Comprobantes        | Alcanzables sólo desde el extracto o desde el cobro; sin lista ni reimpresión desde la ficha del cliente                                                         | S1                                                  | Botón «Reimprimir» en cada cobro de la ficha                                |
| H-42 | Menú                | El icono de las entradas secundarias es un círculo genérico (Clientes, Movimientos, Lotes, Inventarios, Órdenes, Proveedores, Devoluciones, Reportes, Auditoría) | S1                                                  | Un icono por área (§25)                                                     |

### 10.4 Accesibilidad (lo que Axe no mide)

La suite `e2e/accesibilidad.spec.ts` ya garantiza WCAG 2.1 AA con Axe en 41 pantallas y en los dos temas, y comprueba 44 px en todos los controles. Lo que sigue son las cosas que sólo se ven usando la aplicación:

| Aspecto                     | Estado      | Detalle                                                                                                                                                                                                                         |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navegación con teclado      | **Parcial** | Todo es alcanzable con Tab, pero el orden en el POS es lector → cámara → + Producto → búsqueda → resultados → Vaciar → cada línea (× 4 controles) → Cobrar: 20 tabulaciones para llegar a la segunda línea. Sin atajos de salto |
| Foco visible                | **Bien**    | Anillo de 2 px en todos los controles (`:focus-visible`); resultado resaltado con borde + fondo                                                                                                                                 |
| Orden y devolución del foco | **Regular** | Diálogos devuelven el foco al que los abrió (Headless UI); pero tras Supr en una línea el foco cae al `body`, y el POS lo fuerza al lector 600 ms después de cada cierre (H-18)                                                 |
| Lectores de pantalla        | **Bien**    | `role="status"` en el resultado del lector, `spinbutton` con `aria-valuetext` («0,425 kilogramos»), `caption` en tablas, `aria-sort`, etiquetas en todos los campos, `role="alert"` sólo en errores                             |
| Contraste                   | **Bien**    | Tokens medidos para 4,5:1 en el peor fondo, en los dos temas (`venta-claro-1366`)                                                                                                                                               |
| Zoom                        | **Bien**    | Sin scroll horizontal a 200 % en los layouts contenedores; el POS reorganiza a una columna                                                                                                                                      |
| Objetivos táctiles          | **Bien**    | Medido en 375 px: ningún control por debajo de 44 px salvo el enlace «Saltar al contenido» (1×1, intencional)                                                                                                                   |
| Información sólo por color  | **Bien**    | Cada estado lleva glifo y palabra («✕ Anulada», «▲ Quedan 4 u.»); importes con signo explícito                                                                                                                                  |
| Errores                     | **Bien**    | `aria-invalid` + `aria-describedby` desde `Field`; el mensaje del lector se anuncia                                                                                                                                             |
| Movimiento reducido         | **Bien**    | `prefers-reduced-motion` respetado                                                                                                                                                                                              |
| Idioma                      | **Regular** | `<html lang>` en es-AR; pero los `<input type="date">` dependen del sistema y en la evidencia se ven en inglés                                                                                                                  |
| Ayuda contextual            | **Regular** | Hints buenos en formularios; la única documentación de atajos es un diálogo al pie                                                                                                                                              |

### 10.5 Acciones peligrosas (auditoría desde UX)

Contraste entre lo que dice `docs/DANGEROUS_ACTIONS_MATRIX.md` y lo que hace la pantalla:

| Acción                           | Confirma (matriz) | Confirma (pantalla)                                                       | Motivo                        | Undo / inversa                    | Veredicto UX                                                         |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------- | ----------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| Anular venta                     | sí                | **sí**, con efectos listados y motivo ≥ 5 caracteres, foco en «No anular» | obligatorio                   | compensable (no des-anular)       | **Correcta.** Modelo a seguir                                        |
| Ajustar stock                    | sí                | **sí** (el diálogo es la confirmación: muestra «va a quedar en N»)        | obligatorio                   | otro ajuste                       | Correcta; el error prematuro de partida (H-20)                       |
| Aplicar inventario               | sí                | **no** (un clic)                                                          | no                            | irreversible                      | **Falta confirmación con resumen**                                   |
| Cerrar conteo                    | —                 | no                                                                        | —                             | no vuelve a «contando»            | Falta confirmación                                                   |
| Bajar tracking de lotes          | sí                | sí (guardar con aviso; permiso aparte)                                    | no                            | reversible en política            | Correcta                                                             |
| Cambiar límite de crédito        | no                | no (campo de la ficha)                                                    | no                            | reversible                        | Aceptable; debería mostrar el saldo actual al lado                   |
| Cortar / habilitar fiado         | sí                | **no** (un clic en la ficha)                                              | no                            | reversible                        | Falta confirmación                                                   |
| Cambiar precio                   | no                | no (campo de la ficha)                                                    | no                            | reversible                        | Aceptable; debería mostrar el precio anterior y el margen resultante |
| Cambiar costo                    | no                | sí (motivo obligatorio en la ficha)                                       | obligatorio                   | historial inmutable               | Correcta                                                             |
| Devolución a proveedor           | sí                | sí (dos veces: borrador y confirmar)                                      | obligatorio                   | irreversible                      | Excesiva ceremonia; una confirmación con resumen alcanza             |
| Pago a proveedor                 | sí                | el diálogo es la confirmación; sobrepago pide permiso y aviso             | sí                            | anulación de pago (no hay UI)     | Correcta; **anular un pago no tiene pantalla**                       |
| Cobro a cliente                  | sí                | ídem; saldo a favor con aviso                                             | sí                            | anular cobro (**sin UI**)         | Correcta; falta la inversa en pantalla                               |
| Cerrar turno con diferencia      | sí                | sí; autorización en segundo paso                                          | obligatorio si hay diferencia | irreversible                      | Correcta, con H-22                                                   |
| Cancelar orden                   | sí                | sí, con motivo                                                            | sí                            | compensable                       | Correcta                                                             |
| Dar de baja proveedor            | —                 | desde la ficha sí; **desde la lista no**                                  | no                            | reversible                        | Inconsistente                                                        |
| Cerrar sesión con ticket abierto | —                 | no                                                                        | —                             | se pierde el ticket               | Falta confirmación condicional                                       |
| Eliminar producto                | sí                | sí                                                                        | no                            | irreversible (sólo sin historial) | Correcta                                                             |
| Cambiar rol de usuario           | sí                | sí (el diálogo)                                                           | no                            | reversible                        | Correcta                                                             |

**Regla propuesta (§29):** confirmación sólo cuando la acción es irreversible o toca dinero/stock de terceros; motivo cuando la matriz lo pide; nunca modal de confirmación para lo trivial (guardar un cliente, agregar una línea); «deshacer» efímero para lo que sea reversible (quitar línea del ticket, cortar fiado); operación inversa visible al lado de toda acción compensable (anular cobro, anular pago).

---

## 11. Auditoría visual

### 11.1 Las siete preguntas

| Pregunta                                            | Respuesta                                                                                                                                                                                                                                                                                                        | Evidencia                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| ¿Hay demasiadas cajas dentro de cajas?              | **Sí, en tres lugares.** `Card` → `TableWrap` (borde) → tabla; el diálogo de cobro anida ítems (borde) dentro del panel; la recepción anida partidas (borde) dentro de líneas (borde) dentro del diálogo. En el resto, el sistema separa por color y no por borde, como dice `Card.tsx`, y funciona              | `cobro-1366`, `compra-recepcion-1366`, `proveedor-detalle-1366` |
| ¿Hay demasiados bordes?                             | **Moderado.** Cada tarjeta lleva borde de 1 px; los MetricCard también; en Inicio hay 12 rectángulos con borde. Es legible pero pesado                                                                                                                                                                           | `inicio-admin-1920`                                             |
| ¿Todo parece tener la misma importancia?            | **Sí, en el Inicio y en los listados.** Diez tarjetas idénticas; en Ventas la métrica «Anuladas 1» pesa lo mismo que «Recaudado $176.185». En el POS no: el total y «Cobrar» dominan, correctamente                                                                                                              | `inicio-admin-1366`, `ventas-1366`, `venta-con-productos-1366`  |
| ¿Hay demasiada información secundaria visible?      | **Sí.** Código de barras en cada fila de Productos, Stock y Movimientos; categoría en cada resultado del POS; «✓ En venta» en cada fila; el hint de atajos siempre visible; el aviso permanente del libro                                                                                                        | `productos-1366`, `movimientos-1366`                            |
| ¿Los CTAs principales se distinguen inmediatamente? | **En el POS sí** (verde, grande, fijo). **En los listados no siempre**: «Nuevo producto» compite con tres selectores; en el detalle de compra «Recibir mercadería» y «Cancelar» tienen el mismo tamaño y están pegados; en Caja, «Hacer arqueo» es primario y «Cerrar la caja» (la acción del día) es secundario | `compra-detalle-1366`, `caja-1366`                              |
| ¿Los colores tienen significado consistente?        | **Sí.** Cuatro tonos con significado fijo (azul interactivo/informativo, verde confirma/entra, ámbar advierte, rojo destruye/sale) y nunca solo color. Una excepción: el texto rojo se usa tanto para «Faltantes» (alerta) como para «debe $3.740» (dato)                                                        | `globals.css`, `inicio-admin-1366`, `clientes-1366`             |
| ¿El operador distingue en 300 ms qué debe hacer?    | **En el POS y en el cierre de caja, sí. En Inicio, Reportes, ficha de producto y conteo, no.**                                                                                                                                                                                                                   | —                                                               |

### 11.2 Jerarquía y tipografía

- Escala real en uso: 12 (`xs`), 14 (`sm`), 16, 18 (`lg`), 20 (`xl`), 24 (`2xl`), 30 (`3xl`), 36/48 (`hero`). Es una buena escala; el problema es de uso, no de sistema: los títulos de sección dentro de tarjetas son `text-base` (16 px) y compiten con el texto; los títulos de página son 18 px en la cabecera y en algunas pantallas se repiten a 24 px en el cuerpo (Lotes, Inventarios).
- Dinero: `Money` con tabular-nums y un solo formato es una de las mejores decisiones del sistema. Pero los **inputs** de dinero muestran `4850.00` (`producto-editar-1366`, `cliente-cobro-1366`, `proveedor-pago-1366`): la misma cifra con dos escrituras en la misma pantalla.
- Densidad: la misma en todos lados (`px-3 py-2.5` en celdas, 44 px en controles). Es correcto para administración y poco denso para operación: en 1366×768 el POS muestra 4 líneas de ticket y Productos muestra 8 filas.

### 11.3 Iconografía, botones, formularios, tablas, cards, banners, toasts, estados vacíos, loaders, errores, confirmaciones

| Elemento            | Estado   | Observación                                                                                                                                                                                                                                    |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Iconos              | Regular  | Heroicons está instalado, pero la barra lateral usa SVG propios y nueve entradas muestran un círculo genérico (H-42). Dentro de los botones casi no hay iconos: bien para no depender de ellos, pero «Escanear con la cámara» es un icono solo |
| Botones             | Bien     | Cinco variantes con significado; 44 px siempre; `confirm` verde reservado a dinero. Falta un tamaño «XL» para el CTA del POS en tablet                                                                                                         |
| Formularios         | Bien     | `Field` garantiza etiqueta, ayuda y error; hints escritos con criterio («Vacío: sin límite. Cero: no se le fía»)                                                                                                                               |
| Inputs              | Regular  | Sin formato local en dinero ni cantidades; `inputMode` correcto; sin teclado numérico propio para táctil                                                                                                                                       |
| Modales             | Regular  | 26 diálogos; en móvil son hojas de `92dvh` con pie no fijo                                                                                                                                                                                     |
| Tablas              | Regular  | Sólidas en escritorio; en móvil hay tres tratamientos distintos (tarjetas, tabla desplazable, tabla + tarjetas)                                                                                                                                |
| Cards               | Bien     | Sin sombra, borde fino, fondo apenas más claro. Anidado en tres lugares                                                                                                                                                                        |
| Banners (`Alert`)   | Bien     | Tono + glifo + título + acción. Se abusa en algunas pantallas (POS con la caja cerrada muestra dos banners y el bloque de código)                                                                                                              |
| Toasts              | Bien     | 3,2 s / 5 s, abajo a la derecha en escritorio y arriba en móvil, con glifo. Se usan para éxito y para errores de acción: correcto                                                                                                              |
| Estados vacíos      | Bien     | Casi todos con título, explicación y acción; algunos genéricos («Nada que mostrar», «No hay lotes», «No hay usuarios con ese filtro»)                                                                                                          |
| Loaders y skeletons | Bien     | `SkeletonRows` con la forma de la tabla; `Skeleton` en tarjetas; sin spinners de página completa                                                                                                                                               |
| Errores             | Muy bien | `ErrorState` con reintento; mensajes humanos; `requestId` copiable en auditoría                                                                                                                                                                |
| Confirmaciones      | Regular  | `ConfirmationDialog` foca «Cancelar» y bloquea el doble clic (excelente), pero varias acciones irreversibles no lo usan (H-11)                                                                                                                 |

### 11.4 Auditoría de consistencia

| Categoría                  | Inconsistencia                                                                                                                                                                                                                                                                                                                                                                    | Dónde                                     | Propuesta                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verbo del botón principal  | «Crear» (producto, usuario), «Crear y agregar» (alta rápida), «Crear cliente», «Crear proveedor», «Crear inventario», «Guardar cambios», «Guardar ajuste», «Guardar conteos», «Registrar» (movimiento, pago, arqueo), «Confirmar recepción», «Cobrar», «Abrir la caja», «Cerrar la caja», «Aplicar diferencias», «Imputar», «Asignar», «Anular la venta», «Eliminar», «Descartar» | todos los diálogos                        | Regla: `Guardar` para altas y ediciones, `Registrar` para movimientos de dinero/stock, `Confirmar` para lo irreversible, `Cobrar` sólo en el POS. Un verbo por familia |
| Botón secundario           | «Cancelar», «Volver», «Cerrar», «No anular», «Entendido»                                                                                                                                                                                                                                                                                                                          | diálogos                                  | `Cancelar` (no ejecuta), `Volver` (paso atrás), `Cerrar` (informativo)                                                                                                 |
| Posición del CTA           | Pie derecho en diálogos; cabecera derecha en detalles; a la izquierda del pie en el ticket; en la barra de filtros en Productos (junto a los `select`)                                                                                                                                                                                                                            | listados                                  | Siempre en la cabecera de página, a la derecha; en diálogos siempre en el pie                                                                                          |
| Título de pantalla         | El `h1` lo pone la cabecera; Lotes, Inventarios, Nueva compra, detalles y fichas agregan un `h2` de 20–24 px; Clientes y Proveedores no agregan nada («3 en total»)                                                                                                                                                                                                               | varios                                    | Un `PageHeader` único: título, subtítulo, acciones                                                                                                                     |
| Contenedor                 | Con margen y ancho máximo en 12 pantallas; sin nada en 16                                                                                                                                                                                                                                                                                                                         | ver §4.2                                  | `PageContainer`                                                                                                                                                        |
| Formato de dinero          | `$ 4.850,00` (Money) vs `4850.00` (inputs) vs `1190.00` (costo en recepción)                                                                                                                                                                                                                                                                                                      | inputs, recepción                         | `MoneyInput`                                                                                                                                                           |
| Formato de cantidad        | `33 u.` / `5,575 kg` (POS, stock) vs `33.000` (movimientos, órdenes, inventarios) vs `2` («limpia» en devoluciones)                                                                                                                                                                                                                                                               | seis pantallas                            | `QuantityText`                                                                                                                                                         |
| Fechas                     | `04/09/26, 11:37 p. m.` · `4/9, 07:26 p. m.` · `03/10/26` · `2026-09-05` · `mm/dd/yyyy`                                                                                                                                                                                                                                                                                           | ventas, caja, proveedores, lotes, filtros | `formatearFecha(corta                                                                                                                                                  | conHora)` |
| Medios de pago             | «Efectivo/Débito/Transferencia/A cuenta» (cobro, reportes) vs `CASH/DEBIT_CARD` (ventas, caja) vs «efectivo/tarjeta/mercado_pago» (filtros y movimiento manual)                                                                                                                                                                                                                   | ventas, caja                              | `etiquetaDeMedio` en todos lados; un solo catálogo de medios                                                                                                           |
| Estados                    | Badges con glifo y palabra en casi todo; «Completada» en texto plano en la ficha de cliente; «Pedida/Parcial/Recibida» azul/ámbar/verde en compras vs «Contando/En revisión/Aplicado» azul/ámbar/verde en inventarios (coherente); «Vigente» verde en ventas                                                                                                                      | varios                                    | Bien en general; documentar el mapa estado → tono                                                                                                                      |
| Filtros                    | Selectores sueltos (Caja), `Field` con etiqueta (Ventas, Auditoría), `SearchInput` + selectores (Productos), fechas con etiqueta (Compras)                                                                                                                                                                                                                                        | listados                                  | `FilterBar` única, colapsable en móvil                                                                                                                                 |
| Icono ⋯ vs botones en fila | Productos y Usuarios usan menú ⋯; Stock usa botón «Ajustar»; Ventas botón rojo «Anular»; Proveedores botón «Dar de baja»                                                                                                                                                                                                                                                          | listados                                  | Una acción principal visible por fila + ⋯ para el resto                                                                                                                |
| Rojo                       | Alerta (faltantes, vencidos), dato (debe $3.740, importe negativo), destrucción (Anular)                                                                                                                                                                                                                                                                                          | Inicio, clientes, ventas                  | Rojo sólo para destrucción y alerta; deuda en `warning` o neutro con palabra                                                                                           |
| Paginación                 | Presente y uniforme (`1–25 de 43`)                                                                                                                                                                                                                                                                                                                                                | todos                                     | Bien                                                                                                                                                                   |

---

## 12. Auditoría mobile

Se auditó en 375×667, 375×812, 390×844 y 430×932 (emulación); la evidencia está en 375×667 (`*-375.png`) y 768×1024 (`*-768.png`). «Responsive» es cierto en el sentido de que ninguna pantalla desplaza el `body` horizontalmente (`overflow-x: clip` y `min-w-0` en `Card`, comprobado). Pero **móvil no está diseñado como producto**: es el escritorio reordenado en una columna.

### 12.1 Por pantalla

| Pantalla                                                 | Orden de información                                                                                                     | Sticky / acciones inferiores                                                         | Modales                                                       | Tablas                                                        | Touch                     | Una mano                                                                     | Veredicto                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| POS (`venta-vacia-768`, `venta-con-productos-375`)       | Banner(s) → lector → cámara → «+ Producto» (fila entera) → búsqueda → hint de teclado → zona vacía → barra Ticket/Cobrar | Barra inferior fija con «Ticket (n)» y «Cobrar» (bien)                               | Ticket en cajón de 92 vw; cobro como hoja                     | —                                                             | Todo ≥ 44 px (medido)     | La barra inferior sí; el lector y la búsqueda están arriba, fuera del pulgar | **Aceptable**; el cobro no                                   |
| Cobro (`cobro-375`, `cobro-combinado-375`)               | Ítems → total → cliente → medio → importe → con cuánto paga → restante → pie                                             | **El pie con «Cobrar» queda fuera de la vista**; hay que desplazar dentro de la hoja | Hoja de 92 dvh                                                | —                                                             | ≥ 44                      | No                                                                           | **Malo**                                                     |
| Peso (`venta-peso-375`)                                  | Título, precio/kg, campo grande, subtotal, botones a ancho completo                                                      | —                                                                                    | Hoja corta, entra entera                                      | —                                                             | Campo de 56 px            | Sí                                                                           | **Bueno**                                                    |
| Alta rápida (`venta-alta-rapida-375`)                    | Código, nombre, precio, unidad, categoría, stock, costo                                                                  | Pie fuera de la vista                                                                | Hoja                                                          | —                                                             | ≥ 44                      | Parcial                                                                      | Regular (7 campos, 2 pantallas)                              |
| Inicio (`inicio-cajero-375`, `inicio-admin-375`)         | Saludo y CTA → tarjetas apiladas (hasta 10) → listas                                                                     | Ninguno                                                                              | —                                                             | —                                                             | ≥ 44                      | «Ir a vender» arriba a la derecha: lejos del pulgar                          | Regular                                                      |
| Caja (`caja-375`, `caja-cerrar-375`)                     | Turno → 3 métricas → filtros → movimientos → turnos → arqueos                                                            | Ninguno; «Cerrar la caja» dentro del panel                                           | Cierre como hoja: entra hasta las notas, el botón queda abajo | Tarjetas                                                      | ≥ 44                      | Parcial                                                                      | Regular                                                      |
| Ventas (`ventas-375`)                                    | 3 métricas → 5 filtros → lista                                                                                           | Ninguno                                                                              | Anular como hoja                                              | Tarjetas con detalle inline y botón «Anular» a ancho completo | ≥ 44                      | No                                                                           | Regular: el contenido empieza a 1.100 px                     |
| Productos (`productos-375`)                              | Búsqueda → 3 selectores → «Nuevo producto» → tarjetas                                                                    | Ninguno                                                                              | Ficha como hoja de 3 pantallas                                | Tarjetas con ⋯                                                | ≥ 44                      | Parcial                                                                      | Regular                                                      |
| Stock (`stock-768`, `stock-ajuste-375`)                  | 3 métricas → 3 botones → búsqueda → filtros → tarjetas con «Ajustar»                                                     | Ninguno                                                                              | Ajuste como hoja larga (error prematuro)                      | Tarjetas                                                      | ≥ 44                      | «Ajustar» a la derecha: bien                                                 | **Aceptable** (es la pantalla de depósito)                   |
| Movimientos (`movimientos-375`)                          | Aviso → búsqueda → tipo → desde → hasta → tarjetas                                                                       | Ninguno                                                                              | —                                                             | Tarjetas con «33 → 32» (bien)                                 | ≥ 44                      | No                                                                           | Regular                                                      |
| Lotes (`lotes-375`)                                      | Título grande → 4 métricas → búsqueda → filtro → **tabla de 6 columnas desplazable + tarjetas**                          | Ninguno                                                                              | —                                                             | Tabla y tarjetas                                              | ≥ 44                      | No                                                                           | **Malo** (sin margen, duplicado)                             |
| Inventarios (`inventarios-375`)                          | Título → botón → filtro → tabla comprimida + tarjetas                                                                    | Ninguno                                                                              | Nuevo como hoja                                               | Duplicado                                                     | ≥ 44                      | No                                                                           | **Malo**                                                     |
| Conteo                                                   | Cabecera → 4 métricas → aviso → tabla + tarjetas con un input cada una                                                   | «Guardar conteos» arriba, fuera de vista al contar                                   | —                                                             | Duplicado                                                     | Input de 44               | No                                                                           | **Malo** para el uso real (contar con el celular en la mano) |
| Compras / detalle (`compra-detalle-375`)                 | Sin margen; título recortado a la izquierda; tablas de 6–8 columnas                                                      | Ninguno                                                                              | Recepción como hoja larga                                     | Desplazables                                                  | ≥ 44                      | No                                                                           | Malo                                                         |
| Proveedores (`proveedores-375`)                          | «5 en total» → **«Nuevo proveedor» fuera del borde derecho** → búsqueda → tarjetas                                       | Ninguno                                                                              | —                                                             | Tarjetas                                                      | ≥ 44                      | —                                                                            | **Malo**                                                     |
| Clientes / ficha (`clientes-375`, `cliente-detalle-375`) | Sin margen; 3 selectores; tarjetas; ficha con cuenta, datos, movimientos                                                 | Ninguno                                                                              | Cobro como hoja (entra casi entera)                           | Tarjetas (bien)                                               | ≥ 44                      | Parcial                                                                      | Regular                                                      |
| Reportes (`reportes-375`)                                | 10.966 px de alto                                                                                                        | Ninguno                                                                              | —                                                             | Tablas desplazables                                           | —                         | No                                                                           | **Malo**                                                     |
| Auditoría (`auditoria-375`)                              | 6 filtros → lista                                                                                                        | Ninguno                                                                              | —                                                             | Lista expandible (bien)                                       | ≥ 44                      | No                                                                           | Regular                                                      |
| Configuración (`configuracion-375`)                      | Tema → sesión → 65 badges                                                                                                | —                                                                                    | —                                                             | —                                                             | —                         | —                                                                            | Regular                                                      |
| Login (`login-375`)                                      | —                                                                                                                        | —                                                                                    | —                                                             | —                                                             | Campos de 44, botón de 56 | Sí                                                                           | **Bueno**                                                    |
| Menú (`menu-movil-375`)                                  | Cajón con los 6 grupos                                                                                                   | —                                                                                    | —                                                             | —                                                             | ≥ 44                      | Izquierda, fuera del pulgar derecho                                          | Regular                                                      |

### 12.2 Teclado móvil

`inputMode="decimal"` en cantidades y dinero, `numeric` en códigos y documentos, `tel` en teléfonos: correcto. Lo que falta es un **teclado numérico propio** para el cobro y el peso (el nativo tapa el subtotal y el botón de confirmar) y el uso de `enterKeyHint="done"`.

### 12.3 Diagnóstico

1. Los diálogos como hojas de 92 dvh con **pie no fijo** son el problema estructural: todo lo que importa (Cobrar, Guardar, Confirmar) queda debajo del teclado o del pliegue.
2. Sin **navegación inferior**: cada cambio de pantalla es abrir el cajón, leer 17 entradas, elegir.
3. **Filtros y métricas antes que contenido** en todas las listas.
4. **Sin contenedor** en 16 pantallas: texto y botones al borde.
5. El **conteo de inventario** —la tarea móvil por excelencia— no está pensado para el celular.

La propuesta móvil (§23, §32) trata cada uno.

---

## 13. Auditoría desktop

### 13.1 Mediciones en 1366×768 (medidas reales, DOM)

| Zona                    | Alto / ancho                                  | Comentario                                                                  |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| Cabecera                | 56 px                                         | Bien                                                                        |
| Barra lateral           | 236 px (68 contraída)                         | Contraída deja 1.130 px de contenido                                        |
| POS: campo de código    | 236 px de ancho                               | Placeholder recortado («Escanea o escribe un»)                              |
| POS: búsqueda           | 288 px con la barra expandida                 | —                                                                           |
| POS: ticket             | 399 px de ancho, 712 px de alto               | Lista útil de 514 px; cada línea 113 px → **4 líneas visibles**; pie 129 px |
| POS: zona de resultados | ~700×560 px, vacía sin búsqueda               | El 45 % de la pantalla no muestra nada la mayor parte del tiempo            |
| Diálogo de cobro        | ancho 512 px; alto > 92 dvh con dos renglones | Pie fuera de la vista                                                       |
| Productos               | 8 filas visibles bajo filtros + cabecera      | 65 px por fila                                                              |
| Inicio                  | 10 tarjetas de 116 px en 3 filas + 2 listas   | Entra sin desplazar sólo la primera fila de listas                          |

### 13.2 1366×768 (la caja)

- **Entra sin desplazar:** POS con 4 líneas; Caja hasta las métricas y 5 movimientos; Inicio hasta la segunda fila de tarjetas.
- **Tamaño del carrito:** 399 px fijos (`--spacing-ticket`). Con nombres largos («Cerveza rubia lata 473 ml») la línea usa dos filas: nombre+precio, stepper+subtotal. 113 px por línea es mucho: un ticket de 12 productos necesita tres pantallas.
- **Posición del total:** correcta (pie fijo, `xl`, a la derecha). El botón «Cobrar F12» debajo, verde, 56 px. Es lo mejor de la pantalla.
- **Búsqueda y lector:** el lector es angosto y la búsqueda ancha, al revés de la frecuencia de uso (lector 90 %, búsqueda 10 %). Funciona porque el lector no necesita foco, pero el mensaje de resultado del lector («Yerba mate 1 kg · agregado») va en 12 px debajo de un campo de 236 px.
- **Navegación:** la barra ocupa 17 % del ancho; contraída, 5 %. La preferencia se recuerda. Bien.
- **Tablas:** 7 columnas en Ventas, 9 en Movimientos, 9 en turnos: entran, pero con `text-sm` y celdas de 44 px.
- **Espacio desperdiciado:** la zona de resultados del POS; la tercera fila del Inicio; el 40 % derecho de Sucursales y Configuración (`max-w-3xl`).

### 13.3 1440×900

Sin cambios de layout. El ticket sigue en 399 px (el `--spacing-ticket` no escala); 6 líneas visibles. Los listados ganan 4 filas.

### 13.4 1920×1080

- POS: zona vacía de 1.250×860 px (`venta-con-productos-1920`). Ticket de 399 px en una pantalla de 1.920: el 21 %. 8 líneas visibles.
- Inicio: `max-w-6xl` (1.152 px) centrado: bien; pero la tercera fila con dos tarjetas y ocho huecos, y las dos listas debajo con 5 y 3 ítems.
- Listados: `max-w-7xl` en Productos y Ventas; los sin contenedor se estiran a 1.684 px (Clientes, Compras): filas de 1.600 px de ancho con 7 columnas.

### 13.5 Diagnóstico desktop

El escritorio está bien resuelto como _administración_ y a medias como _operación_: el POS regala la mitad de la pantalla y comprime el ticket; el cobro no cabe en 768 px de alto; los listados muestran pocas filas por la densidad única. La propuesta (§24) define dos densidades y un POS que usa el espacio.

---

## 14. Auditoría POS

### 14.1 Lo que está bien (y hay que conservar)

1. **El lector funciona sin tocar nada.** `useBarcodeScanner` distingue una ráfaga de una persona escribiendo, cancela los caracteres para que no terminen en otro campo y se apaga con un diálogo abierto. Verificado: 19–36 ms de API por escaneo, línea en el ticket antes de 100 ms.
2. **Escanear dos veces suma cantidad**, no líneas.
3. **Un producto por peso abre el peso solo**, con subtotal en vivo, Enter agrega, Esc cancela.
4. **Los cinco desenlaces de un código** (encontrado, sin stock, inactivo, no registrado, sin red) tienen cada uno su siguiente paso y nunca un botón muerto.
5. **Alta rápida:** seis campos, foco en el nombre, código fijo, vuelve al lector.
6. **Stock vendible:** «Stock 22 · Vendible 10 · Vencido 12» en el resultado y tope en el ticket.
7. **Cobro seguro:** no deja enviar si los pagos no suman; bloquea el doble clic; el diálogo no se cierra con la venta en vuelo; el precio lo decide el servidor.
8. **Resultado de venta** con número, total, pagos, vuelto y «Nueva venta» a un Enter.
9. **Ticket persistente** con restauración a precios del servidor y aviso de lo que cambió.
10. **Caja cerrada:** lo dice al entrar y el servidor lo rechaza al cobrar con un mensaje humano.

### 14.2 Lo que falla

| #   | Problema                                                                                                                                    | Sev. | Referencia |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| 1   | «Cobrar» del diálogo fuera de la vista en 1366×768 y móvil                                                                                  | S3   | H-01       |
| 2   | Sin ↑↓ sobre el ticket; foco perdido tras Supr; 8 tabulaciones hasta la primera cantidad                                                    | S3   | H-06       |
| 3   | F12 / Alt+N / Ctrl+K como forma principal                                                                                                   | S3   | H-07       |
| 4   | Medio de pago en `select`; segundo renglón en «Débito»; sin importes rápidos; dos campos numéricos contiguos («Importe», «Con cuánto paga») | S2   | H-16       |
| 5   | Vuelto en 14 px                                                                                                                             | S2   | H-17       |
| 6   | Foco forzado 600 ms tras cerrar diálogos                                                                                                    | S2   | H-18       |
| 7   | Restos en pantalla (bloque de código, «ingresá el peso», «Ticket recuperado»)                                                               | S2   | H-19       |
| 8   | Sin consulta de precio, sin ticket en espera, sin cobrar deuda, sin última venta/anular, sin descuento                                      | S2   | §8         |
| 9   | Sin favoritos para lo que no tiene código (pan, facturas, verdura, fiambre al corte)                                                        | S2   | —          |
| 10  | Zona de resultados vacía la mayor parte del tiempo; ticket angosto; 4 líneas visibles                                                       | S2   | H-29       |
| 11  | «+ Producto» (acción rara) en la barra principal; hint de teclado en móvil                                                                  | S1   | H-38       |
| 12  | No hay indicación de a quién se le está vendiendo hasta abrir el cobro (cliente sólo dentro del diálogo)                                    | S1   | —          |
| 13  | El lector no tiene «modo multiplicador» («3 ×» antes de escanear) ni «cantidad rápida»                                                      | S1   | —          |

### 14.3 Click / step budget (flujos principales)

Se cuentan acciones del operador después de tener el producto en la mano. «Enter» cuenta como acción. No se buscan menos pasos donde el paso evita un error grave.

| Flujo                                       | Actual                                                                                                     | Ideal (V2)                                                                                              | Nota                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Vender un producto conocido, efectivo justo | escaneo (0) → F12 (1) → Enter (1) → Enter «Nueva venta» (1) = **3**                                        | escaneo → Enter (cobrar) → Enter (confirmar) = **2**; la siguiente venta arranca con el próximo escaneo | El tercer paso sobra: el resultado puede irse solo         |
| Vender con vuelto                           | 3 + tipear «con cuánto paga» = **4**                                                                       | Enter → tipear → Enter = **3**                                                                          | El campo de recibido debe tener el foco al abrir           |
| Corregir una cantidad                       | mouse: clic en +/− (1); teclado: 8 Tab + ↑ = **9**                                                         | ↑↓ hasta la línea (1–3) + → (1) = **2–4**                                                               | —                                                          |
| Producto desconocido con alta               | escaneo → «Crear producto» (1) → nombre (1) → Tab (1) → precio (1) → Enter (1) = **5**                     | escaneo → Enter (crear) → nombre → Tab → precio → Enter = **5**                                         | Ya está bien; sólo mover el foco al botón «Crear producto» |
| Buscar por nombre y agregar                 | Ctrl+K (1) → tipear (1) → ↓ (0–2) → Enter (1) = **3–5**                                                    | tipear letras (el POS enruta letras a la búsqueda) → ↓ → Enter = **2–4**                                | Sin atajo para enfocar                                     |
| Cobrar con transferencia                    | F12 → abrir `select` (1) → elegir (1) → Enter (1) → Nueva venta (1) = **5**                                | Enter → `T` o botón (1) → Enter = **3**                                                                 | —                                                          |
| Cobrar combinado (efectivo + transferencia) | F12 → importe efectivo (1) → «+ Agregar otro medio» (1) → `select` (2) → Enter → Nueva venta = **7**       | Enter → botón Efectivo → importe → botón Transferencia (resto automático) → Enter = **5**               | —                                                          |
| Fiar a cliente conocido                     | F12 → `select` «A cuenta» (2) → tipear (1) → elegir (1) → Enter → Nueva venta = **7**                      | Enter → botón «Fiado» (1) → tipear (1) → Enter (1) → Enter = **5**                                      | —                                                          |
| Cobrar una deuda (fuera de venta)           | Clientes → buscar → ficha → Registrar pago → importe → Registrar = **6 + 3 pantallas**                     | POS: `C` → tipear → Enter → «Cobrar deuda» → importe → Enter = **5, sin salir**                         | —                                                          |
| Consultar un precio                         | escaneo → leer → quitar la línea = **2 (y toca el ticket)**                                                | `?` → escaneo → leer = **1**                                                                            | —                                                          |
| Abrir la caja                               | Caja → Abrir → monto → Abrir = **4 + 1 pantalla**                                                          | POS: «Abrir la caja» → monto → Enter = **3**                                                            | —                                                          |
| Cerrar la caja                              | Caja → Cerrar → contado → Cerrar = **4**                                                                   | **4**                                                                                                   | Ya está bien                                               |
| Recibir mercadería con orden                | Compras → orden → Recibir → Confirmar = **4**                                                              | **4**                                                                                                   | Ya está bien                                               |
| Recibir sin orden                           | Nueva compra → proveedor → buscar → agregar → cantidad → costo → Confirmar → Recibir → Confirmar = **~10** | Recibir → proveedor → escanear → cantidad → Confirmar = **5**                                           | —                                                          |
| Ajustar stock (rotura)                      | Stock → buscar → Ajustar → tipo → cantidad → motivo → Guardar = **7**                                      | Stock → escanear → «Rotura» → cantidad → Guardar = **5**                                                | Motivo implícito en el tipo                                |
| Dar de baja lote vencido                    | Inicio → Lotes → Stock → buscar → Ajustar → Pérdida → partida → cantidad → motivo → Guardar = **10**       | Lotes → «Dar de baja» → confirmar = **3**                                                               | —                                                          |
| Contar 50 productos                         | Inventarios → Nuevo → Crear → 50 clics + 50 números + Guardar → Cerrar = **~103**                          | Nuevo → Crear → (escanear + número + Enter) × 50 → Cerrar = **~102, pero sin mouse y con progreso**     | El ahorro es de atención, no de pasos                      |

---

## 15. Auditoría teclado

### 15.1 Lo que existe hoy

| Contexto                         | Tecla                           | Efecto                                                              | Descubrible                       |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| POS (global)                     | F12                             | Abre el cobro (si hay ticket)                                       | Sí: `kbd` en el botón             |
| POS (global)                     | Alt+N                           | Alta manual (con permiso)                                           | No                                |
| POS (global)                     | Ctrl+K, `/`                     | Foco en la búsqueda                                                 | Sólo en el hint de 12 px          |
| POS (búsqueda)                   | ↑ ↓                             | Mover el resaltado entre 8 resultados                               | En el hint                        |
| POS (búsqueda)                   | Enter                           | Agrega el resaltado y vuelve al lector                              | En el hint                        |
| POS (búsqueda)                   | Esc                             | Vacía y vuelve al lector                                            | No                                |
| POS (línea del ticket, con foco) | `+` `−`                         | Cambia la cantidad                                                  | Sólo en el diálogo de atajos      |
| POS (línea del ticket, con foco) | Supr                            | Quita la línea                                                      | Sólo en el diálogo de atajos      |
| POS (cantidad)                   | ↑ ↓                             | Suma/resta un paso; Enter sale del campo                            | No                                |
| Peso                             | Enter / Esc                     | Agrega / cancela                                                    | En el texto de ayuda              |
| Cobro                            | Enter (con el foco en «Cobrar») | Cobra                                                               | No; pero el foco inicial está ahí |
| Cobro                            | Esc                             | Vuelve (salvo con la venta en vuelo)                                | Convención                        |
| Alta rápida                      | Enter en cualquier campo        | Crea (form submit oculto)                                           | No                                |
| Diálogos                         | Esc, Tab, foco atrapado         | Headless UI                                                         | Convención                        |
| Códigos de barras (ficha)        | Enter                           | Agrega el alternativo                                               | En el placeholder                 |
| Tablas / listas                  | —                               | Nada                                                                | —                                 |
| Inventario (conteo)              | Tab                             | Siguiente línea (Enter no hace nada)                                | No                                |
| Recepción                        | Tab                             | Siguiente campo                                                     | —                                 |
| Global                           | —                               | Sin atajo para «ir a vender», «abrir caja», «buscar en toda la app» | —                                 |

### 15.2 Problemas

1. **La forma principal de operar depende de F12, Alt+N y Ctrl+K.** F12 es la tecla de las herramientas del navegador y en cualquier pantalla que no sea el POS abre DevTools; Alt+N y Ctrl+K no se ven en ningún lado.
2. **↑↓ sólo sirven en los resultados de búsqueda.** El objeto principal del POS —el ticket— no tiene navegación.
3. **No hay una gramática común:** en el conteo Enter no avanza; en el peso Enter agrega; en el cobro Enter cobra sólo si el foco quedó en el botón; en la cantidad Enter sale del campo.
4. **Foco:** se pierde tras quitar una línea; se fuerza tras cerrar diálogos.
5. **Sin atajos de navegación** (ir a vender, ir a caja) ni de multiplicador (`3*`).
6. **Tablas y listas** no se recorren con teclado (sólo Tab por cada control).

El modelo propuesto está en §30.

---

## 16. Auditoría formularios

Clasificación por campo: **OBLIGATORIO AHORA** (sin esto no se puede guardar), **ÚTIL AHORA** (se completa en el 50 % de los casos), **AVANZADO** (una vez por semana o menos), **RARO** (casi nunca). La propuesta de progressive disclosure es «primero lo indispensable; lo demás detrás de «Más opciones»».

### 16.1 Alta rápida (POS) — 7 campos hoy

| Campo                                      | Clase                    | Propuesta                                                              |
| ------------------------------------------ | ------------------------ | ---------------------------------------------------------------------- |
| Código (fijo del lector / editable manual) | OBLIGATORIO (viene dado) | Igual                                                                  |
| Nombre                                     | OBLIGATORIO              | Foco inicial (ya)                                                      |
| Precio                                     | OBLIGATORIO              | `MoneyInput` con teclado numérico                                      |
| Categoría                                  | ÚTIL                     | Última usada por omisión; «+ Nueva» detrás de «Más»                    |
| Unidad de venta                            | ÚTIL                     | Dos botones («Por unidad» / «Por peso») en vez de un `select` de cinco |
| Stock inicial (1)                          | ÚTIL                     | Igual, visible                                                         |
| Costo (con permiso)                        | AVANZADO                 | «Más opciones»                                                         |

**Veredicto: ya está bien**; es el formulario mejor pensado del sistema. Sólo dos cambios: unidad como botones y costo escondido.

### 16.2 Ficha de producto — 14 campos + trazabilidad + actividad

| Campo                                             | Clase                              | Propuesta                                                |
| ------------------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| Nombre                                            | OBLIGATORIO                        | Primero                                                  |
| Precio                                            | OBLIGATORIO                        | Segundo, con margen resultante al lado si se ve el costo |
| Código principal                                  | ÚTIL                               | Tercero, con lector                                      |
| Categoría                                         | ÚTIL                               | Cuarto                                                   |
| Stock inicial (sólo alta)                         | ÚTIL                               | Quinto                                                   |
| Unidad de venta                                   | ÚTIL en alta, bloqueada en edición | Dos botones                                              |
| **— Más opciones —**                              |                                    |                                                          |
| Códigos alternativos                              | AVANZADO                           | Con lector                                               |
| Proveedor                                         | AVANZADO                           | —                                                        |
| Costo + motivo                                    | AVANZADO                           | —                                                        |
| Unidad de compra y factor                         | AVANZADO                           | «Se compra por caja de 8» en lenguaje                    |
| Mínimo de reposición                              | AVANZADO                           | Sugerido                                                 |
| Descripción                                       | RARO                               | —                                                        |
| En venta                                          | RARO                               | Como acción («Dar de baja»), no como checkbox            |
| Trazabilidad (lotes, vencimiento, inicialización) | RARO                               | Asistente aparte: «Activar lotes»                        |
| Actividad reciente                                | Lectura                            | Pestaña «Historial» en la ficha (pantalla, no diálogo)   |

**Veredicto:** convertir el diálogo en una **pantalla de producto** (`/productos/:id`, hoy 404) con cabecera (nombre, precio, stock, código), acciones (Cambiar precio, Ajustar stock, Dar de baja) y pestañas (Datos, Códigos, Compra y costo, Lotes, Historial). El alta queda en cuatro campos.

### 16.3 Cliente — 8 campos

Nombre (OBLIGATORIO); teléfono (ÚTIL); documento, CUIT, correo, dirección (AVANZADO); límite de crédito (AVANZADO, delicado: vacío ≠ 0, bien explicado); notas (RARO). Propuesta: nombre y teléfono; «Más» para el resto; el límite de crédito como acción propia en la ficha («Fijar límite») con el saldo actual a la vista.

### 16.4 Proveedor — 8 campos

Nombre (OBLIGATORIO); contacto y teléfono (ÚTIL); razón social, CUIT, correo, dirección, notas (AVANZADO). Propuesta: tres campos y «Más».

### 16.5 Nueva compra — cabecera 2 + por línea 4

Proveedor (OBLIGATORIO); notas (RARO). Por línea: cantidad (OBLIGATORIO), costo (ÚTIL: proponer el último costo conocido —hoy el campo arranca vacío—), unidad de compra (AVANZADO: viene del producto), contiene (RARO: viene del producto). Propuesta: la línea muestra «12 × caja de 8 a $8.800» como texto y edita al tocar; el costo se propone.

### 16.6 Recepción — por línea 2 + partidas 3 × n + notas + anticipos

Recibir ahora (OBLIGATORIO, propuesto); costo de factura (ÚTIL: colapsado detrás de «¿Cambió el precio?»); partidas: código, cantidad, vencimiento (OBLIGATORIO sólo si la política lo exige); notas (RARO); aplicar anticipos (AVANZADO, bien resuelto: casilla apagada y explicada).

### 16.7 Ajuste de stock — 5 campos

Modo (ÚTIL: «Entraron/salieron» vs «Recuento»); qué pasó (OBLIGATORIO); partida (OBLIGATORIO sólo si REQUIRED; **error prematuro**); cantidad (OBLIGATORIO); motivo (OBLIGATORIO, con chips). Propuesta: el tipo como tiles grandes (Entrada · Rotura · Vencido · Consumo · Recuento) y el motivo pre-llenado con el tipo, editable.

### 16.8 Cobro — cliente + n × (medio, importe, recibido)

Medio (OBLIGATORIO); importe (ÚTIL: vacío = total); con cuánto paga (ÚTIL en efectivo); cliente (OBLIGATORIO sólo con fiado). Propuesta en §22/§27.3: medios como botones, un solo campo numérico grande con foco («¿Con cuánto paga?»), combinado detrás de «Dividir el pago».

### 16.9 Nuevo inventario — 6 controles

Alcance (OBLIGATORIO); categoría (si aplica); a ciegas (ÚTIL, por omisión sí); segundo conteo + umbral (AVANZADO → «Más»); notas (RARO).

### 16.10 Usuario — 4 campos

Nombre y apellido, usuario, contraseña, rol: todos OBLIGATORIOS en el alta. Bien. Falta «cambiar contraseña» como acción.

### 16.11 Pago a proveedor / Cobro a cliente / Movimiento de caja / Abrir y cerrar caja

Correctos: un importe propuesto, un medio, una referencia opcional y notas. Sólo dos ajustes: `MoneyInput` con formato local y el medio como botones cuando son cuatro o menos.

### 16.12 Reglas transversales para V2

1. Un formulario muestra como máximo **cinco campos** antes de «Más opciones».
2. **El primer campo tiene el foco** y es el que más se escribe.
3. Los `select` con ≤ 5 opciones fijas se reemplazan por **botones segmentados**.
4. Dinero y cantidades con **formato local mientras se escribe** (`MoneyInput`, `QuantityInput`).
5. **Errores al intentar guardar o al salir del campo**, nunca al abrir.
6. **Enter guarda** en todo formulario de un solo paso; en los de varios, Enter avanza.
7. Los valores por omisión se **proponen desde los datos** (último costo, última categoría, deuda total, lo pendiente).

---

## 17. Auditoría tablas

| Tabla                                | Hoy (escritorio)                      | Hoy (móvil)                                  | Debería ser                                                                                                                             | Por qué                                       |
| ------------------------------------ | ------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Productos / Stock                    | Tabla 6 col.                          | Tarjetas                                     | **Tabla** en escritorio (comparar precio y stock); **lista** en móvil con nombre, stock y acción                                        | Es un catálogo: se compara                    |
| Resultados del POS                   | Lista de botones                      | Lista                                        | **Lista** (ya) con nombre, precio grande, stock                                                                                         | Se elige, no se compara                       |
| Ticket                               | Lista de líneas                       | Cajón                                        | **Lista** densa (una fila por línea en escritorio: cantidad · nombre · subtotal)                                                        | 113 px por línea es demasiado                 |
| Ventas                               | Tabla 7 col. + fila expandible        | Tarjetas con detalle                         | **Master-detail**: lista a la izquierda, detalle a la derecha en escritorio; lista → pantalla en móvil                                  | Anular vive en el detalle                     |
| Movimientos de caja                  | Tabla 7 col. expandible               | Tarjetas                                     | **Tabla** agrupada por día con subtotal                                                                                                 | Se busca «qué pasó a las 15:00»               |
| Turnos                               | Tabla 9 col.                          | Tarjetas                                     | **Lista de tarjetas** en ambos (cajero, apertura → cierre, diferencia con color)                                                        | 9 columnas no se leen; hay 1–2 turnos por día |
| Arqueos                              | Lista                                 | Lista                                        | Lista (ya)                                                                                                                              | —                                             |
| Libro de movimientos                 | Tabla 9 col.                          | Tarjetas «33 → 32»                           | **Tabla** con columnas prioritarias (fecha, producto, variación, quién) y detalle al expandir (anterior, posterior, referencia, motivo) | 9 columnas obligan a `text-sm`                |
| Lotes                                | Tabla 6 col. **+ tarjetas**           | Ambas                                        | **Tabla** agrupada por estado (Vencidos · 7 días · 30 días) con acción por fila                                                         | La agrupación es el mensaje                   |
| Detalle de lote «por sucursal»       | Tabla 2 col.                          | Tabla                                        | Lista                                                                                                                                   | Dos filas                                     |
| Inventarios                          | Tabla 6 col. **+ tarjetas**           | Ambas                                        | **Tarjetas** en ambos (número, estado, progreso, responsable)                                                                           | Hay pocas sesiones                            |
| Conteo                               | Tabla 6 col. **+ tarjetas** con input | Ambas                                        | **Lista de conteo** (§27.9): una fila por producto, lote como sub-fila, input grande, estado por color                                  | Es una herramienta, no un informe             |
| Órdenes                              | Tabla 7 col.                          | Tarjetas                                     | **Tabla** con estado como primera columna; móvil lista                                                                                  | Se compara estado y avance                    |
| Detalle de orden: productos          | Tabla 6 col.                          | Desplazable                                  | **Tabla** de 4 (producto, pedido, recibido, costo); subtotal al expandir                                                                | —                                             |
| Detalle de orden: recepción          | Tabla 8 col.                          | Desplazable                                  | **Acordeón por entrega** con 3 números por línea (llegó, devuelto, entró) y el financiero en una fila                                   | 8 columnas es un informe contable             |
| Deudas abiertas (proveedor)          | Tabla 9 col.                          | Desplazable                                  | **Lista** por entrega: documento, vence, pendiente, estado; el resto al expandir                                                        | Lo que se mira es «cuánto y cuándo»           |
| Extracto (cliente/proveedor)         | Tabla 5 col.                          | Tarjetas (cliente) / desplazable (proveedor) | **Tabla** de extracto bancario (fecha, concepto, importe, saldo) en ambos, con fecha y concepto apilados en móvil                       | Es el formato que todos conocen               |
| Anticipos                            | Tabla 6 col.                          | Desplazable                                  | Lista                                                                                                                                   | Pocos registros                               |
| Devoluciones (lista y por proveedor) | Tabla 7 col.                          | Desplazable                                  | Tabla en escritorio, lista en móvil                                                                                                     | —                                             |
| Reportes (×15 tablas)                | Tablas de 2–8 col.                    | Desplazables                                 | Tablas cortas dentro de pestañas; «top» como lista con barra proporcional                                                               | Comparar es el punto                          |
| Usuarios                             | Tabla 6 col.                          | Tarjetas                                     | Lista de tarjetas en ambos                                                                                                              | 10 registros                                  |
| Matriz de permisos                   | Tabla 10 col. sticky                  | Lista por rol                                | Acordeón por rol en ambos, con los 65 permisos agrupados                                                                                | —                                             |
| Auditoría                            | Lista expandible                      | Lista                                        | Lista (ya)                                                                                                                              | —                                             |
| Clientes                             | Tabla 7 col.                          | Tarjetas                                     | **Tabla** de 4 (nombre, saldo, límite, última compra) + lista móvil con saldo                                                           | El resto es filtro                            |
| Proveedores                          | Tabla 7 col.                          | Tarjetas                                     | Tabla de 4 + lista móvil                                                                                                                | —                                             |

**Reglas:** una sola `DataTable` que reciba «columnas prioritarias» y decida sola tabla o lista según el ancho (nunca las dos); densidad `operacion` en POS, conteo, recepción y `admin` en el resto; filas navegables con ↑↓ y Enter; una acción visible por fila.

---

## 18. Auditoría feedback / errores

### 18.1 Lo que hay

- **Éxito:** toast de 3,2 s con ✓ («Venta anulada. Volvió el stock y se revirtió la caja.», «Caja abierta», «Se guardaron 1 conteo(s)»). Correcto: breve y dice el efecto.
- **Error de acción:** toast de 5 s con ✕, o `Alert` rojo dentro del diálogo con título «No se registró la venta / No se guardó / No se ajustó» y el mensaje del servidor. Los mensajes son humanos: «No hay una caja abierta. Abrí la caja antes de vender.», «Solo hay 10 u. vendibles, 12 u. están vencidos», «No se puede recibir más de lo pendiente (30.000)».
- **Error de carga:** `ErrorState` con «Reintentar».
- **Advertencia previa:** `Alert` ámbar («Se pasa del límite», «Va a quedar saldo a favor», «Falta plata −$4.725», «Otro inventario ya corrigió parte de esto»).
- **Confirmación peligrosa:** `ConfirmationDialog` con foco en cancelar (anular, eliminar, cancelar orden, baja de usuario/proveedor).
- **Estado del lector:** borde + glifo + texto anunciado (`role=status`).

### 18.2 Lo que falla

| Problema                                | Ejemplo                                                                                                                      | Regla V2                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Error sin siguiente paso                | «No hay una caja abierta. Abrí la caja antes de vender.» sin botón para abrirla; «Quedan 46 línea(s) sin contar…» sin opción | Todo error accionable trae su botón                |
| Error prematuro                         | Partida en rojo al abrir el ajuste                                                                                           | Validar al guardar o al salir del campo            |
| Aviso que exige clic                    | «Ticket recuperado — Entendido» en cada carga                                                                                | Informativo → toast                                |
| Texto técnico en un error de validación | `mensajeVisible` junta problemas con « · »; algunos vienen de Zod en tercera persona («debe ser…»)                           | Un diccionario de mensajes por campo               |
| Falta de confirmación                   | Aplicar inventario, cortar fiado, cerrar sesión con ticket                                                                   | §10.5                                              |
| Doble ceremonia                         | Devolución: borrador + confirmar + diálogo                                                                                   | Una confirmación con resumen                       |
| Estados que se quedan                   | «Código no registrado» tras agregar otro producto                                                                            | Limpiar al siguiente evento                        |
| Toast tapado en móvil                   | Arriba, sobre el lector                                                                                                      | Abajo, sobre la barra de acciones, con `safe-area` |

### 18.3 Política propuesta (resumen; detalle en §29)

- **Éxito:** toast de 2–3 s, verbo en pasado, sin «correctamente» («Venta registrada», «Caja abierta», «Stock ajustado»).
- **Error:** título con lo que no pasó + causa + qué hacer, con botón. Nunca un código.
- **Advertencia:** antes del problema, en el lugar del problema, con el número.
- **Confirmación:** sólo para irreversible o dinero ajeno; con el efecto enumerado; foco en cancelar.
- **Deshacer:** para lo reversible y frecuente (quitar línea, cortar fiado) en el mismo toast.

---

## 19. Auditoría performance percibida

### 19.1 Medido (build de producción, base local, 43 productos)

| Métrica                                                              | Valor                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TTFB de `/venta` y `/`                                               | 30–40 ms                                                                                                                            |
| DOM interactivo                                                      | 48–59 ms                                                                                                                            |
| `load`                                                               | 82–91 ms                                                                                                                            |
| API escaneo (`/api/products/barcode/:code`)                          | 19–36 ms                                                                                                                            |
| API búsqueda (`/api/products?q=`)                                    | ~34 ms, con 250 ms de espera de tipeo                                                                                               |
| Peticiones por pantalla                                              | POS 4 · Caja 4 · Conteo 3 · Inicio (admin) **12** · Reportes **11** · Ficha de producto 3 al abrir · Cobro con fiado +1 por importe |
| Línea de baseline (10.000 productos, `docs/PERFORMANCE_BASELINE.md`) | escaneo 6,3 ms, venta 15 líneas 37,8 ms, recepción 20 líneas 126 ms                                                                 |

El servidor no es el cuello de botella en ningún flujo. La percepción de lentitud, cuando aparece, es del cliente.

### 19.2 Dónde se siente lento aunque no lo sea

| Dónde                        | Qué pasa                                                                                                    | Por qué se siente                                                                                   | Arreglo                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Inicio                       | 12 peticiones en paralelo, skeleton de 4 tarjetas mientras llegan; luego aparecen 10                        | Salto de layout y espera «a lo último»                                                              | Skeleton con la forma final; render por tarjeta a medida que llega                                            |
| Reportes                     | 11 peticiones, `Promise.all`, un solo skeleton de 160 px; todo aparece a la vez tras la más lenta           | Pantalla en blanco hasta el final                                                                   | Por sección, con pestañas: sólo se pide la que se ve                                                          |
| Cambio de filtro en listados | Skeleton de 8 filas reemplaza la tabla entera en cada tecla (tras 250 ms)                                   | Parpadeo de contenido                                                                               | Mantener la tabla anterior atenuada y actualizar en el lugar                                                  |
| Ficha de producto            | Se abre vacía y se llenan alternativos, trazabilidad («Cargando trazabilidad…») y actividad en tres tiempos | El diálogo «se mueve» mientras se lee                                                               | Pedir todo con la ficha o reservar el alto                                                                    |
| Cobro con fiado              | Cada cambio de importe consulta el crédito                                                                  | Tres números que parpadean                                                                          | Debounce de 300 ms y estado «calculando» discreto                                                             |
| Navegación entre pantallas   | Cada pantalla vuelve a pedir categorías, saldo de caja y estado de turno                                    | Micro-esperas de 50–100 ms en cada cambio                                                           | Caché por sesión (SWR) para catálogos y estado de caja; invalidar por evento (`kiosco:caja-cambio` ya existe) |
| Después de una venta         | «Nueva venta» → `fetchProducts()` recarga la lista aunque esté vacía                                        | Un skeleton de 4 filas en una zona vacía                                                            | No recargar si no hay búsqueda                                                                                |
| Diálogos                     | Transición de 150 ms + foco devuelto por Headless UI al terminar; el POS insiste 600 ms más                 | Sensación de «se pegó» al cerrar y volver a escanear rápido                                         | Devolver el foco en `afterLeave` una sola vez                                                                 |
| Tema                         | Sin flash (script en `<head>`)                                                                              | —                                                                                                   | Bien                                                                                                          |
| Optimistic UI                | Ninguna acción es optimista; todo espera al servidor (30–50 ms)                                             | Imperceptible con esta latencia local; en una red 4G con 200 ms se notará en «quitar línea» y «+/−» | El ticket es local (ya optimista); el resto puede esperar                                                     |
| Re-render                    | `LineaTicket` memoizada (bien); el POS re-renderiza la lista de resultados en cada tecla                    | Imperceptible con 8 resultados                                                                      | —                                                                                                             |
| Fuentes                      | Inter declarada pero no servida localmente; cae a `system-ui`                                               | Sin FOUT visible porque no hay `@font-face`                                                         | Decidir: servir Inter o quitarla del stack                                                                    |

### 19.3 Presupuestos de experiencia (UX performance targets)

No son leyes: son umbrales por debajo de los cuales una persona no percibe espera, tomados de los tres tiempos clásicos (100 ms = instantáneo, 1 s = fluido, 10 s = límite de atención) y ajustados al mostrador, donde hay una persona esperando enfrente.

| Acción                             | Objetivo percibido                                                    | Reparto sugerido                             | Hoy                                                       |
| ---------------------------------- | --------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| Escaneo → línea visible            | **< 150 ms**                                                          | red 30 · servidor 20 · render 20 · margen 80 | ~60 ms ✓                                                  |
| Tecla en búsqueda → resultados     | **< 250 ms** desde la última tecla                                    | espera 150 · red+servidor 60 · render 20     | 250 + 34 ≈ 290 ms (bajar la espera a 150 ms)              |
| Abrir el cobro                     | **inmediato** (< 100 ms, sin red)                                     | render                                       | ~150 ms de transición ✓                                   |
| Confirmar cobro → resultado        | **< 500 ms**                                                          | servidor 50 · red 50 · render                | ~100 ms ✓                                                 |
| Navegación entre pantallas         | **sin pantalla en blanco**; skeleton estable < 100 ms; datos < 500 ms | —                                            | 50–90 ms de HTML, datos 30–300 ms ✓ salvo Inicio/Reportes |
| Acción confirmada (toast)          | **< 300 ms** desde el clic                                            | —                                            | ✓                                                         |
| Abrir un diálogo con datos (ficha) | **< 300 ms** con todo el contenido                                    | una sola petición                            | 3 peticiones en cascada ✗                                 |
| Conteo: escaneo → foco en la línea | **< 150 ms**                                                          | local                                        | no existe                                                 |
| Inicio                             | **< 1 s** con las alertas primero                                     | priorizar 3 peticiones, diferir el resto     | 12 en paralelo, se ve a ~300 ms ✓ en local                |

Con la red real (4G en el depósito, 100–300 ms de ida y vuelta) los únicos que corren riesgo son búsqueda, ficha y cobro con fiado; los tres se resuelven con caché por sesión y una petición por diálogo.

---

# UX V2 — Propuesta de rediseño

> Lo que sigue (§20 a §32) es la arquitectura completa de la versión 2 de la experiencia. No es una lista de retoques: se parte de las preguntas «¿esta pantalla debería existir?», «¿por qué el usuario tiene que saber esto?», «¿podemos deducirlo?». Se conserva lo que es correcto (tokens, servidor como autoridad, motivo y bitácora, escanear → ticket → cobrar) y se rehace todo lo demás.

## 20. Arquitectura de información V2

### 20.1 Ocho áreas mentales

```
Inicio            lo que necesita mi atención hoy (por rol)
Vender            el POS, y todo lo que pasa en el mostrador
Caja              turno, ventas de hoy, movimientos, arqueo, cierre
Stock             productos, existencias, recibir, vencimientos, contar, historial
Compras           pedidos, recepciones, devoluciones, proveedores y su cuenta
Clientes          fichas, fiado, cobros
Reportes          por tema, con pestañas
Administración    usuarios, sucursal y políticas, auditoría, mi cuenta, apariencia
```

### 20.2 Qué va a la barra, qué va adentro, qué sobra, qué se duplica, qué es contextual

| Hoy (17 entradas) | V2                                                                                         | Motivo                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Inicio            | **Inicio** (barra)                                                                         | —                                                         |
| Venta             | **Vender** (barra)                                                                         | —                                                         |
| Caja              | **Caja** (barra)                                                                           | —                                                         |
| Ventas            | Caja › _Ventas de hoy_ (pestaña); histórico en Reportes › Ventas                           | Existe para anular y ver el día; no es un destino         |
| Clientes          | **Clientes** (barra)                                                                       | Frecuente para cajero y encargado                         |
| Productos + Stock | **Stock** › _Productos_ (una sola lista con vista catálogo/existencias)                    | Eran la misma lista con dos columnas distintas            |
| Movimientos       | Stock › _Historial_                                                                        | Contextual: se llega desde un producto o desde una alerta |
| Lotes             | Stock › _Vencimientos_                                                                     | Lo que importa es el vencimiento, no el lote              |
| Inventarios       | Stock › _Contar_                                                                           | Es una tarea del depósito                                 |
| —                 | Stock › _Recibir_                                                                          | Nuevo: recepción directa                                  |
| Órdenes           | **Compras** › _Pedidos_                                                                    | «Pedido» es la palabra del almacén                        |
| Proveedores       | Compras › _Proveedores_                                                                    | Quien compra es quien paga                                |
| Devoluciones      | Compras › _Devoluciones_ y dentro de cada proveedor                                        | Se listan por su cuenta, se crean desde una entrega       |
| Reportes          | **Reportes** (barra), con pestañas por tema                                                | —                                                         |
| Auditoría         | Administración › _Auditoría_                                                               | Sólo admin y auditor                                      |
| Usuarios          | **Administración** › _Usuarios_                                                            | —                                                         |
| Sucursales        | Administración › _Sucursal y caja_ (políticas: umbral, exigir turno, zona horaria, nombre) | Hoy es de lectura; pasa a ser configuración real          |
| Configuración     | Menú de usuario › _Mi cuenta_ (clave) y _Apariencia_                                       | Preferencias personales, no administración                |

Se eliminan como destinos: Ventas, Movimientos, Lotes, Inventarios, Devoluciones, Sucursales, Configuración (7). Se agregan como pestañas o acciones dentro de su área. Ninguna función desaparece.

### 20.3 Reglas de la IA

1. **Una pantalla = un objetivo.** Un listado lista; un detalle detalla; una tarea (cobrar, contar, recibir) tiene su pantalla o panel propio, no un diálogo de 92 dvh.
2. **Lo contextual nace del objeto**, no del menú: «Devolver» desde la entrega, «Dar de baja» desde el lote, «Cobrar deuda» desde el cliente en el POS, «Historial» desde el producto.
3. **Los reportes no son un destino para el cajero**: su «reporte» es _Ventas de hoy_ dentro de Caja.
4. **Todo lo que existe en la API tiene un lugar en la UI** o se quita de la API (sugerencia de pedido, cancelar inventario, resolver línea, anular cobro/pago, `SELECTION` de inventario).

### 20.4 Matriz de frecuencia y prominencia

| Frecuencia                  | Acciones                                                                                                                                 | Prominencia en V2                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Varias veces por minuto** | Escanear, agregar por nombre, corregir cantidad, cobrar en efectivo, dar vuelto                                                          | Sin navegación, sin mouse, siempre en pantalla, una tecla      |
| **Varias veces por hora**   | Débito/transferencia, consultar precio, fiar, cliente nuevo, alta rápida, cobrar deuda, dejar en espera, pesar                           | Una tecla o un toque desde el POS; nunca un cambio de pantalla |
| **Diarias**                 | Abrir/cerrar caja, arqueo, retiro, anular última venta, rotura, dar de baja vencidos, recibir mercadería, ver faltantes, pagar proveedor | Botón principal en la portada de su área; alerta en Inicio     |
| **Semanales**               | Armar pedido, cambiar precios, reportes, contar una categoría, devolver a proveedor, revisar cuentas                                     | Dentro del área, a un clic                                     |
| **Raras**                   | Inventario completo, activar lotes, nuevo proveedor, ajustar cuenta, nota de crédito, imputar anticipo, cancelar orden                   | Menú «…» o «Más opciones»                                      |
| **Administrativas**         | Usuarios, roles, auditoría, políticas de caja, apariencia                                                                                | Administración                                                 |

---

## 21. Navegación V2

### 21.1 Escritorio

- **Barra lateral** de 8 entradas con icono propio (uno por área), contraíble a 68 px, ordenada por rol (el cajero ve Vender primero; compras ve Compras y Stock primero).
- **Cabecera de página** (`PageHeader`): título, subtítulo, **una** acción principal a la derecha, pestañas debajo cuando el área las tiene.
- **Búsqueda global** con `/`: productos, clientes, proveedores, pedidos y pantallas («ir a caja»). Reemplaza a Ctrl+K.
- **Estado de caja** en la cabecera (ya existe): abierta/cerrada, por quién, saldo. Al tocarlo, abre/cierra sin ir a Caja.
- **Volver**: en detalles, «← Pedidos» arriba; Alt+← también.

### 21.2 Móvil

- **Barra inferior de 4 + «Más»**, por rol:
  - Cajero: **Vender · Caja · Clientes · Más**
  - Repositor: **Stock · Contar · Recibir · Más**
  - Compras: **Compras · Stock · Recibir · Más**
  - Encargado: **Inicio · Vender · Stock · Más**
  - Dueño: **Inicio · Reportes · Caja · Más**
- «Más» abre una hoja con las áreas restantes y «Mi cuenta».
- Las pestañas de cada área son **chips desplazables** debajo de la cabecera.
- El cajón lateral desaparece.

### 21.3 Inventario de pantallas V2

| Ruta conceptual                 | Objetivo                            | Usuario                     | Información principal                            | CTA principal                  | Acciones secundarias                                       | Desktop                                                 | Mobile                                                 | Keyboard                       | Estados                                               |
| ------------------------------- | ----------------------------------- | --------------------------- | ------------------------------------------------ | ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------ | ----------------------------------------------------- |
| `/` Inicio                      | Qué necesita mi atención            | Todos (por rol)             | Alertas accionables + 3–4 cifras                 | La primera alerta              | Ir a vender / Abrir caja                                   | Tarjetas en 2 filas + listas                            | Apilado, alertas primero                               | ↑↓ Enter                       | vacío («Nada urgente»), cargando por tarjeta          |
| `/vender` POS                   | Vender                              | Cajero                      | Ticket, total, campo único                       | Cobrar (Enter)                 | Cliente · Consulta · En espera · Última venta · Abrir caja | Split: favoritos/resultados · ticket 440 px             | Escaneo con cámara · ticket como hoja · barra inferior | §30                            | caja cerrada (apertura inline), ticket vacío, sin red |
| `/vender/cobro` (panel)         | Cobrar                              | Cajero                      | Total, medios, paga con, vuelto                  | Cobrar $X (Enter)              | Dividir · Fiado · Descuento (permiso)                      | Panel que reemplaza a los resultados                    | Pantalla completa con pie fijo y teclado propio        | E/D/C/T/F, dígitos, Enter, Esc | error con botón, caja cerrada con botón               |
| `/vender/consulta` (modo)       | Ver precio y stock                  | Cajero                      | Precio hero, stock, vencible                     | Agregar al ticket              | —                                                          | Sobre el POS                                            | Sobre el POS                                           | `?` entra, Esc sale            | no encontrado                                         |
| `/caja`                         | El turno                            | Cajero/encargado            | Abierta por, desde, tiene que haber con desglose | Cerrar la caja / Abrir la caja | Retiro · Ingreso · Arqueo                                  | Panel + pestañas (Ventas de hoy · Movimientos · Turnos) | Panel + chips                                          | ↑↓ en listas                   | cerrada, sin turnos                                   |
| `/caja/ventas`                  | Ventas de hoy                       | Cajero/supervisor           | Lista, detalle al lado                           | Anular (con permiso)           | Reimprimir                                                 | Master-detail                                           | Lista → detalle                                        | ↑↓ Enter                       | vacío                                                 |
| `/stock` Productos              | Catálogo y existencias              | Repositor/compras/encargado | Nombre, stock vendible, precio, mínimo           | Nuevo producto                 | Vista catálogo/existencias · Armar pedido                  | Tabla densa con panel lateral de detalle                | Lista con escaneo                                      | ↑↓ Enter `/`                   | vacío, filtrado                                       |
| `/stock/:id` Producto           | Todo sobre un producto              | Encargado                   | Cabecera (precio, stock, código) + pestañas      | Cambiar precio / Ajustar       | Códigos · Compra y costo · Lotes · Historial · Dar de baja | Pantalla                                                | Pantalla                                               | Tab entre pestañas             | —                                                     |
| `/stock/ajustar` (panel)        | Entró/salió/recuento                | Repositor                   | Ahora hay N                                      | Guardar                        | Tipos como tiles                                           | Panel lateral                                           | Hoja con pie fijo                                      | tiles 1–5, Enter               | partida obligatoria (al guardar)                      |
| `/stock/recibir`                | Recibir mercadería con o sin pedido | Compras/repositor           | Proveedor, líneas escaneadas                     | Confirmar recepción            | Elegir pedido · Cambió el precio · Lotes                   | Pantalla                                                | Pantalla escaneo-primero                               | escaneo, Tab, Ctrl+Enter       | sin proveedor, sin líneas                             |
| `/stock/vencimientos`           | Qué vence                           | Repositor                   | Agrupado: vencidos / 7 días / 30 días            | Dar de baja (por fila)         | Ver producto                                               | Tabla agrupada                                          | Lista agrupada                                         | ↑↓ Enter                       | nada que vence                                        |
| `/stock/contar`                 | Inventarios                         | Repositor                   | Sesiones con progreso                            | Nuevo inventario               | Continuar · Cancelar                                       | Tarjetas                                                | Tarjetas                                               | —                              | vacío                                                 |
| `/stock/contar/:id`             | Contar                              | Repositor                   | Progreso, línea activa, cantidad                 | Enter (guardar y seguir)       | Cerrar conteo · Cancelar · Sólo pendientes                 | Lista de conteo                                         | Lista escaneo-primero                                  | §30                            | revisión, conflicto, sin resolver (con acción)        |
| `/stock/historial`              | Libro                               | Encargado                   | Fecha, producto, variación, quién                | —                              | Filtrar                                                    | Tabla con detalle expandible                            | Lista                                                  | ↑↓                             | vacío                                                 |
| `/compras` Pedidos              | Órdenes                             | Compras                     | Estado, avance, total                            | Nuevo pedido                   | Armar con faltantes · Recibir                              | Tabla                                                   | Lista                                                  | ↑↓ Enter                       | vacío con acción                                      |
| `/compras/:id`                  | Un pedido                           | Compras                     | Líneas, entregas                                 | Recibir                        | Cancelar · Devolver (por entrega)                          | Pantalla                                                | Pantalla                                               | —                              | —                                                     |
| `/compras/proveedores` y `/:id` | Proveedor y cuenta                  | Compras                     | Saldo, vencido, próximo vencimiento              | Registrar pago                 | Nota de crédito · Ajustar · Devoluciones                   | Ficha + pestañas                                        | Ficha + chips                                          | —                              | sin deuda                                             |
| `/clientes` y `/:id`            | Cliente y cuenta                    | Cajero/encargado            | Saldo, límite, disponible                        | Registrar pago                 | Fijar límite · Cortar fiado (confirmar) · Historial        | Ficha + pestañas                                        | Ficha + chips                                          | `/` buscar                     | al día                                                |
| `/reportes/:tema`               | Un tema                             | Dueño/encargado             | Resumen + 2–3 tablas                             | Cambiar período                | Exportar                                                   | Pestañas                                                | Pestañas                                               | ←→ pestañas                    | sin datos                                             |
| `/admin/usuarios`               | Personal                            | Admin                       | Lista                                            | Nuevo usuario                  | Restablecer clave · Dar de baja                            | Lista                                                   | Lista                                                  | —                              | —                                                     |
| `/admin/sucursal`               | Políticas                           | Admin                       | Nombre, umbral, exigir turno, zona               | Guardar                        | —                                                          | Formulario                                              | Formulario                                             | —                              | —                                                     |
| `/admin/auditoria`              | Bitácora                            | Admin/auditor               | Lista expandible                                 | —                              | Filtrar                                                    | Lista                                                   | Lista                                                  | —                              | —                                                     |
| Menú › Mi cuenta                | Clave, apariencia                   | Todos                       | —                                                | Guardar                        | —                                                          | Hoja                                                    | Hoja                                                   | —                              | —                                                     |

---

## 22. POS V2

### 22.1 Objetivo

> Un cajero nuevo vende casi sin capacitación: escanea, ve el ticket crecer, aprieta Enter, escribe con cuánto le pagan, aprieta Enter, lee el vuelto en grande. Todo lo demás está a una tecla o un toque, y nunca a una pantalla.

### 22.2 Principios

1. **Un solo campo** («Escaneá o escribí»): los dígitos son un código; las letras, una búsqueda. Sin Ctrl+K, sin `/`, sin decidir dónde escribir. El lector sigue funcionando sin foco.
2. **El ticket es el objeto principal**: siempre visible, denso (una fila por línea), con una línea seleccionada que se mueve con ↑↓ y cuya cantidad cambia con ←→.
3. **Enter es cobrar.** Con el ticket lleno y el campo vacío, Enter abre el cobro; Enter otra vez cobra en efectivo con el importe justo; escribir un número antes del segundo Enter es «paga con».
4. **La zona libre trabaja**: favoritos (lo que no tiene código), últimos vendidos, y los resultados cuando se escribe.
5. **El cobro no es un modal**: es un panel que ocupa el lugar de los favoritos, con pie fijo y teclado numérico.
6. **Después de cobrar no hay que hacer nada**: el resultado se muestra 2–3 s con el vuelto en grande y el próximo escaneo arranca el ticket nuevo.
7. **Lo excepcional tiene un lugar**: cliente, consulta de precio, en espera, última venta, abrir caja, todo dentro del POS.

### 22.3 Layout escritorio (1366×768 primero)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ Almacén   Caja abierta · Lucía  $ 25.000     [ ? Consulta ]  [ ⏸ En espera 1 ]│  40 px
├──────────────────────────────────────────────┬───────────────────────────────┤
│ ▌ Escaneá o escribí…                        │  TICKET              Juan P. ▾│
│ ─────────────────────────────────────────── │  1 × Yerba mate 1 kg   4.850 │
│  FAVORITOS   Panadería · Fiambres · Verdura  │▶2 × Gaseosa cola 2,25  6.900 │  ← línea
│  ┌────────┐┌────────┐┌────────┐┌────────┐    │  1 × Leche entera 1 L  1.690 │     seleccionada
│  │ Pan    ││Facturas││ Jamón  ││ Queso  │    │  0,425 kg Queso crem.  4.165 │
│  │ $ 1.200││ x6 3600││ al corte│ x kg   │    │                              │
│  └────────┘└────────┘└────────┘└────────┘    │                              │
│  ÚLTIMOS  Yerba · Gaseosa · Leche · Azúcar   │                              │
│                                              │──────────────────────────────│
│  (al escribir: resultados con precio y stock)│  4 artículos    TOTAL        │
│                                              │              $ 17.605        │
│                                              │  [   COBRAR  ⏎   ]  56 px    │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

- Cabecera del POS de 40 px (no la de 56 de la app) con estado de caja y dos acciones raras. La barra lateral queda contraída por omisión en `/vender`.
- Ticket de 440 px en 1366 (ganado a la barra contraída), líneas de 44 px: **11 líneas visibles** contra 4 hoy.
- Línea seleccionada con barra a la izquierda + fondo (`primary-quiet`), igual que el resultado resaltado de hoy.
- «Cobrar ⏎» de 56 px; F12 sigue funcionando como alias.

### 22.4 Cobro (panel)

```
┌──────────────────────────────────────────────┬───────────────────────────────┐
│  COBRAR                    $ 17.605          │  TICKET (sólo lectura)        │
│  ┌───────────┐┌───────────┐┌───────────┐     │  …                            │
│  │ Efectivo E││ Débito  D ││ Transf. T │     │                               │
│  └───────────┘└───────────┘└───────────┘     │                               │
│  ┌───────────┐┌───────────┐┌───────────┐     │                               │
│  │ Crédito  R││ Fiado   F ││ Otro    O │     │                               │
│  └───────────┘└───────────┘└───────────┘     │                               │
│  Paga con   [  20000   ]  ← foco             │                               │
│  [ Justo ] [ 20.000 ] [ 50.000 ]             │                               │
│  VUELTO              $ 2.395  ← 40 px        │                               │
│  ▸ Dividir el pago    ▸ Descuento             │                               │
│──────────────────────────────────────────────│                               │
│  [ Volver Esc ]        [ COBRAR $ 17.605 ⏎ ] │                               │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

- Medios como botones con letra de atajo. Efectivo seleccionado por omisión; el foco entra en «Paga con».
- «Fiado» abre el selector de cliente en el mismo panel (buscar, crear en 2 campos) y muestra los cinco números de crédito que ya existen.
- «Dividir el pago» agrega un segundo medio con el resto ya escrito; no hay `select`.
- Pie fijo siempre visible: es la garantía contra H-01.
- Resultado: tarjeta sobre el ticket con «Vuelto $ 2.395» en `hero` y «Venta #3563 · Efectivo». Se va sola al escanear o a los 3 s; «Imprimir» y «Deshacer (anular)» accesibles 30 s (con permiso).

### 22.5 Móvil (375 px)

```
┌───────────────────────┐
│ ☰ Vender    Caja ● Lucía│
│ ▌ Escaneá o escribí  📷│  ← cámara como acción principal
│ Panadería Fiambres Verd│  ← chips de favoritos
│ ┌──────┐┌──────┐┌────┐ │
│ │ Pan  ││Factur││Jamó│ │
│ └──────┘└──────┘└────┘ │
│ (resultados al escribir)│
│ …                      │
├───────────────────────┤
│ 4 art.  $ 17.605  ▲    │  ← tirador: abre el ticket como hoja
│ [      COBRAR         ]│  56 px, ancho completo
└───────────────────────┘
```

- El ticket es una **hoja inferior con tirador** que muestra siempre total y cantidad de artículos; se sube para editar líneas (fila de 56 px, −/+ grandes, deslizar para quitar).
- El cobro es una **pantalla completa** con los seis botones, teclado numérico propio (el nativo tapa el vuelto) y pie fijo.
- La cámara de escaneo se abre a pantalla completa y vuelve sola tras leer; «modo ráfaga» opcional para varios productos.

### 22.6 Lo que el POS deja de tener

Botón «+ Producto» en la barra (va al bloque de código desconocido y al menú «…»), hint de atajos, diálogo de atajos (reemplazado por `kbd` en los botones y el panel `?`), banner permanente de «Ticket recuperado» (toast), bloque de código desconocido persistente (se limpia al siguiente evento).

---

## 23. Mobile V2

Móvil se diseña como producto para dos usos concretos: **depósito** (repositor/compras, celular en la mano, a veces con guantes) y **dueño** (mirar cómo va). El POS móvil existe para la feria, el reparto o una tablet de mostrador, no como caja principal.

| Tarea               | Diseño móvil                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Navegar             | Barra inferior de 4 + Más por rol. Sin cajón lateral                                                                                                                                 |
| Escanear (depósito) | Botón de cámara siempre visible en Stock, Recibir y Contar; al leer, salta al producto o a la línea                                                                                  |
| Ajustar stock       | Hoja con tiles grandes (Entrada · Rotura · Vencido · Consumo · Recuento), campo de cantidad de 56 px con teclado numérico propio, pie fijo «Guardar»                                 |
| Contar              | Pantalla de conteo: barra de progreso fija arriba, lista de pendientes, línea activa grande, escaneo o toque para elegir, cantidad + Enter guarda y avanza; «Cerrar conteo» al final |
| Recibir             | Escanear → aparece la línea del pedido (o se crea) → cantidad propuesta → siguiente; costo y lotes detrás de «Detalles»                                                              |
| Vencimientos        | Lista agrupada; deslizar una fila → «Dar de baja»                                                                                                                                    |
| Listas              | Contenido primero; filtros detrás de «Filtrar (n)»; métricas en una sola fila compacta                                                                                               |
| Hojas (sheets)      | Pie fijo con la acción principal; el contenido se desplaza; el teclado empuja el pie, no lo tapa (`env(safe-area-inset-bottom)`)                                                     |
| Formularios         | Máximo 5 campos visibles; «Más» al final                                                                                                                                             |
| Detalles            | Pantalla completa con «←» y acciones en el pie                                                                                                                                       |
| Dueño               | Inicio con 4 cifras y alertas; Reportes con pestañas y tablas cortas                                                                                                                 |
| Una mano            | Todo lo que se toca más de una vez por minuto en el 40 % inferior de la pantalla                                                                                                     |
| Tablets (768)       | Se comportan como escritorio con barra contraída y POS split; el ticket fijo a partir de 900 px de ancho                                                                             |

---

## 24. Desktop V2

- **Dos densidades** (§25.8): `operacion` en POS, conteo, recepción y existencias; `admin` en el resto.
- **1366×768 es la referencia**: nada importante por debajo de 700 px de alto; el pie de cualquier panel es fijo.
- **Paneles laterales en vez de modales** para formularios (ficha, ajuste, cobro a cliente, pago a proveedor): mantienen el contexto y no tienen problema de alto.
- **Modales sólo para confirmar** (≤ 2 campos: motivo).
- **Master-detail** en Ventas de hoy, Pedidos y Clientes: la lista a la izquierda con ↑↓, el detalle a la derecha con Enter.
- **Listados densos** (filas de 40 px en `operacion`): Productos muestra 14 filas en 1366×768 en vez de 8.
- **Búsqueda global** con `/`.
- **1920**: el POS usa el ancho (favoritos en 6 columnas, ticket de 480 px); los listados topean en 1.400 px.

---

## 25. Design System V2

Se conserva `globals.css` tal como está (paleta, radios, sombras, tamaños táctiles, foco). Lo que sigue son las reglas de uso y las adiciones.

### 25.1 Color roles

| Rol                  | Token actual                              | Uso en V2                                                                                |
| -------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| background           | `--color-bg`                              | Fondo de la app                                                                          |
| surface              | `--color-surface`                         | Paneles, tarjetas, barra                                                                 |
| surface elevated     | `--color-raised`                          | Filas activas, cabeceras de tabla, chips                                                 |
| sunken               | `--color-sunken`                          | Inputs, zonas hundidas                                                                   |
| border               | `--color-line` / `--color-line-strong`    | Separación fina; fuerte sólo en inputs con hover y tablas densas                         |
| primary              | `--color-primary`                         | Interactivo, selección, informativo. **No** para dinero                                  |
| confirm / success    | `--color-success`                         | Cobrar, guardar dinero, «entra», «cuadra»                                                |
| warning              | `--color-warning`                         | Antes del problema; pendiente; diferencia                                                |
| danger               | `--color-danger`                          | Destruir, anular, «sale», vencido. **No** para deuda de cliente (usa neutro con palabra) |
| text / muted / faint | `--color-ink*`                            | Ya medidos a 4,5:1                                                                       |
| money                | `--color-money`                           | Todas las cifras de dinero                                                               |
| selection (nuevo)    | `primary-quiet` + barra de 3 px `primary` | Línea seleccionada en ticket, fila activa en tablas, tile activo                         |

Oscuro por omisión, claro opcional: se conserva.

### 25.2 Tipografía

| Rol     | Tamaño / peso                              | Uso                                         |
| ------- | ------------------------------------------ | ------------------------------------------- |
| Display | 40–48 / 700, tabular                       | Total del ticket, vuelto, «tiene que haber» |
| Title   | 20 / 600                                   | Título de página                            |
| Section | 15 / 600 · mayúsculas 12 / 600 para grupos | Tarjetas, secciones                         |
| Body    | 15 (`operacion` 14) / 400                  | Todo el texto                               |
| Caption | 13 / 400 muted                             | Ayudas, metadatos                           |
| Mono    | 13                                         | Códigos de barras y de lote, requestId      |

Inter servida localmente o eliminada del stack (hoy se declara y no se carga).

### 25.3 Radios · 25.4 Espaciado · 25.5 Elevación

- Radios: 6 (controles), 10 (tarjetas, paneles), 14 (hojas y diálogos). Se quita el 20.
- Espaciado en base 4: 4, 8, 12, 16, 24, 32, 48. Densidad `operacion` baja un escalón en padding de filas y celdas.
- Elevación: 0 plano (fondo), 1 borde (tarjeta), 2 `shadow-pop` (menús, tooltips), 3 `shadow-modal` (diálogos y hojas). Regla: **nunca una tarjeta con borde dentro de otra tarjeta con borde**; la segunda se separa con `surface elevated` o con un divisor.

### 25.6 Iconos

Heroicons outline 20 px en navegación y 24 px en acciones principales; uno por área (Inicio casa, Vender carrito, Caja billete, Stock caja, Compras camión, Clientes personas, Reportes gráfico, Administración engranaje). Icono sólo cuando acompaña texto o tiene `aria-label`.

### 25.7 Botones

| Variante        | Uso                                                     | Tamaños                            |
| --------------- | ------------------------------------------------------- | ---------------------------------- |
| Primary (azul)  | La acción principal de una pantalla que no mueve dinero | md 44 · lg 56                      |
| Confirm (verde) | Cobrar, guardar dinero o stock, abrir/cerrar caja       | lg 56 · xl 64 (POS)                |
| Secondary       | El resto de las acciones                                | md 44                              |
| Ghost           | Acciones de fila y barra                                | md 44 (sm sólo visual, área 44)    |
| Danger          | Anular, eliminar, dar de baja                           | md 44, nunca al lado de un Confirm |

Regla nueva: **una sola Primary o Confirm por pantalla**; las teclas se muestran con `kbd` dentro del botón.

### 25.8 Inputs · Tablas · Cards · Modals · Drawers

- **Inputs:** 44 px (`admin`) / 40 px (`operacion`) / 56 px (dinero y cantidad en POS y conteo). `MoneyInput` y `QuantityInput` formatean mientras se escribe (`4.850,00`; `0,425 kg`), `inputMode` correcto, error debajo, ayuda debajo.
- **Tablas:** una sola `DataTable` con `density` (36/44/56 px de fila), columnas con prioridad (1 = siempre, 2 = ≥ 768, 3 = ≥ 1280), fila activa con teclado, una acción visible por fila y «…» para el resto; se convierte en lista por debajo del ancho mínimo, **nunca las dos a la vez**.
- **Cards:** borde 1 px, sin sombra, sin anidar; `MetricTile` con tono y acción.
- **Modals:** sólo `ConfirmDanger`, `Prompt` (un campo) y `Result` (venta registrada). Máximo 480 px de ancho, siempre entra en 768 de alto.
- **Drawers / side panels:** formularios y detalles en escritorio (480–560 px), con cabecera, cuerpo desplazable y pie fijo.
- **Sheets:** el equivalente móvil, con tirador, pie fijo y respeto del teclado.

### 25.9 Densidad

| Contexto    | Pantallas                                                    | Fila  | Control          | Texto | Padding de página |
| ----------- | ------------------------------------------------------------ | ----- | ---------------- | ----- | ----------------- |
| `operacion` | POS, cobro, conteo, recepción, existencias, ajuste           | 40 px | 40 / 56 (dinero) | 14    | 12                |
| `admin`     | Inicio, reportes, fichas, usuarios, auditoría, configuración | 48 px | 44               | 15    | 20–24             |

Se declara con `data-density` en el contenedor y los componentes lo leen; no se duplican componentes.

---

## 26. Componentes V2

| Componente                       | Responsabilidad                                                            | Reemplaza a / Nota                                 |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| `AppShell`                       | Barra lateral (escritorio) o barra inferior (móvil) + cabecera + contenido | `AppShell` actual + `BottomNav` nuevo              |
| `Sidebar`                        | 8 áreas con icono, orden por rol, contraíble                               | Actual, con iconos por área                        |
| `BottomNav`                      | 4 + Más por rol                                                            | Nuevo                                              |
| `PageContainer`                  | Padding, ancho máximo y densidad de toda pantalla                          | Corrige las 16 sin margen                          |
| `PageHeader`                     | Título, subtítulo, una acción principal, pestañas                          | Unifica `h2` sueltos y cabeceras ad hoc            |
| `CommandSearch`                  | Búsqueda global con `/`                                                    | Reemplaza Ctrl+K                                   |
| `ScannerInput`                   | Campo único código/texto + escucha global + estado                         | `BarcodeInput` + `SearchInput` del POS             |
| `ProductPicker`                  | Resultados con precio y stock, ↑↓ Enter                                    | `ResultadoBusqueda`                                |
| `FavoriteGrid`                   | Tiles configurables por categoría                                          | Nuevo                                              |
| `TicketList` / `TicketLine`      | Líneas densas, selección con teclado, ←→ cantidad                          | `Ticket`                                           |
| `PaymentPanel`                   | Medios como botones, paga con, vuelto, dividir, fiado                      | `DialogoCobro`                                     |
| `PaymentSelector`                | Botones de medio con atajo (reutilizable en cobros y pagos)                | `select` de medios                                 |
| `NumericKeypad`                  | Teclado numérico táctil                                                    | Nuevo                                              |
| `ClientPicker`                   | Buscar/crear cliente en 2 campos, saldo a la vista                         | `SelectorDeCliente`                                |
| `MoneyInput` / `MoneyText`       | Formato local siempre                                                      | `Money` + inputs crudos                            |
| `QuantityInput` / `QuantityText` | Formato por unidad siempre                                                 | `QuantityInput` + cadenas crudas                   |
| `DataTable` + `MobileDataList`   | Una fuente, dos renders, columnas por prioridad, fila activa               | `Table*` + `CardList*`                             |
| `FilterBar`                      | Filtros con contador, colapsable en móvil                                  | Selectores sueltos                                 |
| `ActionBar`                      | Pie fijo con acciones (paneles, hojas, POS móvil)                          | Barra del POS móvil                                |
| `SidePanel` / `Sheet`            | Contenedor de formularios y detalles con pie fijo                          | `Dialog` para formularios                          |
| `ConfirmDanger`                  | Confirmación con efecto enumerado y motivo opcional                        | `ConfirmationDialog` (se conserva la lógica)       |
| `StatusBadge`                    | Tono + glifo + palabra                                                     | Actual                                             |
| `MetricTile`                     | Cifra + detalle + tono + acción; variante «alerta»                         | `MetricCard`                                       |
| `EmptyState`                     | Título + explicación + acción                                              | Actual (con acción obligatoria cuando hay permiso) |
| `InlineError`                    | Error debajo del campo, al guardar                                         | `Field.error`                                      |
| `Toast`                          | Con «Deshacer» opcional                                                    | `aviso`                                            |
| `KeyHint`                        | `kbd` dentro de botones y en el panel `?`                                  | `AyudaAtajos`                                      |
| `Stepper`                        | Progreso de tareas de varios pasos (conteo, recepción)                     | Nuevo                                              |
| `FormSection` + `Disclosure`     | Secciones y «Más opciones»                                                 | `Seccion` de la ficha                              |
| `DateRange`                      | Selector de fecha con formato es-AR garantizado                            | `<input type="date">`                              |
| `CashStatus`                     | Estado de caja en cabecera con acción                                      | `EstadoCaja`                                       |

---

## 27. Wireframes

Wireframes textuales de las doce pantallas principales de V2. Las medidas de referencia son 1366×768 (escritorio) y 375×812 (móvil). `▶` marca la línea o fila seleccionada con el teclado; `[ ]` es un botón; `⏎` significa que Enter lo activa.

### 27.1 POS — escritorio

```
┌────┬──────────────────────────────────────────────┬─────────────────────────────┐
│ ▣  │ ● Caja abierta · Lucía · $ 25.000            │        ? Consulta  ⏸ Espera │ 40
│ 🏠 │ ▌ Escaneá o escribí…                 [📷]    │ TICKET            Cliente ▾ │
│ 🛒 │──────────────────────────────────────────────│  1 × Yerba mate 1 kg   4.850│
│ 💵 │ FAVORITOS   Panadería  Fiambres  Verdulería  │▶ 2 × Gaseosa cola 2,25 6.900│
│ 📦 │ ┌──────────┐┌──────────┐┌──────────┐┌──────┐ │  1 × Leche entera 1 L  1.690│
│ 🚚 │ │ Pan      ││ Facturas ││ Medialun ││ Torta│ │  0,425 kg Queso crem.  4.165│
│ 👥 │ │ $ 1.200  ││ x6 3.600 ││ $ 350    ││ x kg │ │                             │
│ 📈 │ └──────────┘└──────────┘└──────────┘└──────┘ │                             │
│ ⚙  │ ┌──────────┐┌──────────┐┌──────────┐┌──────┐ │  (11 líneas visibles)       │
│    │ │ Jamón    ││ Queso    ││ Salame   ││ Mort.│ │                             │
│    │ │ al corte ││ x kg     ││ x kg     ││ x kg │ │                             │
│    │ └──────────┘└──────────┘└──────────┘└──────┘ │─────────────────────────────│
│    │ ÚLTIMOS  Yerba · Gaseosa · Leche · Azúcar    │ 4 artículos     TOTAL       │
│    │                                              │             $ 17.605        │
│    │ ↑↓ línea · ←→ cantidad · Supr quita · ⏎ cobra│ [        COBRAR  ⏎        ] │ 56
└────┴──────────────────────────────────────────────┴─────────────────────────────┘
  68                    ~810                                    440
```

Estados: caja cerrada → la fila de estado se vuelve ámbar con «[Abrir la caja]» inline y el ticket sigue armándose; ticket vacío → «Escaneá para empezar» en el ticket, favoritos a la vista; escribiendo → los favoritos se reemplazan por resultados (nombre, precio grande, stock vendible); sin red → banda roja «Sin conexión: no se puede cobrar» y el ticket se conserva.

### 27.2 POS — móvil

```
┌─────────────────────────┐
│ Vender      ● Caja Lucía │
│ ▌ Escaneá o escribí  [📷]│
│ Panadería Fiambres Verd…│
│ ┌───────┐┌───────┐┌────┐│
│ │ Pan   ││Factur.││Jamó││
│ │ 1.200 ││ 3.600 ││x kg││
│ └───────┘└───────┘└────┘│
│ ┌───────┐┌───────┐┌────┐│
│ │ Queso ││Salame ││Mort││
│ └───────┘└───────┘┴────┘│
│                         │
│ ═══ 4 artículos $17.605 │ ← tirador: hoja del ticket
│ [        COBRAR        ]│ 56
│ Vender  Caja  Clientes ⋯│ ← barra inferior
└─────────────────────────┘

Hoja del ticket (arrastrada arriba):
┌─────────────────────────┐
│ ═══  Ticket · 4 art.    │
│ Yerba mate 1 kg   4.850 │
│   [ − ]  1  [ + ]     ✕ │
│ Gaseosa cola 2,25 6.900 │
│   [ − ]  2  [ + ]     ✕ │
│ …                       │
│ TOTAL          $ 17.605 │
│ [        COBRAR        ]│
└─────────────────────────┘
```

### 27.3 Checkout (panel de cobro)

```
Escritorio (reemplaza la zona de favoritos; el ticket queda a la derecha en sólo lectura)
┌──────────────────────────────────────────────┐
│ COBRAR                          $ 17.605     │
│ ┌────────────┐┌────────────┐┌────────────┐   │
│ │ Efectivo  E││ Débito    D││ Transfer. T│   │  ← seleccionado: Efectivo
│ └────────────┘└────────────┘└────────────┘   │
│ ┌────────────┐┌────────────┐┌────────────┐   │
│ │ Crédito   R││ Fiado     F││ Otro      O│   │
│ └────────────┘└────────────┘└────────────┘   │
│ Paga con      ┌──────────────────────┐       │
│               │ 20.000               │ ⌨     │  ← foco, 56 px
│               └──────────────────────┘       │
│  [ Justo ]  [ 10.000 ]  [ 20.000 ]  [ 50.000 ]│
│                                              │
│ VUELTO                        $ 2.395        │  ← 40 px
│ ▸ Dividir el pago     ▸ Descuento (encargado)│
│──────────────────────────────────────────────│
│ [ Volver  Esc ]           [ COBRAR $ 17.605 ⏎]│  ← pie fijo
└──────────────────────────────────────────────┘

Con «Fiado»:
│ Cliente  ▌ Buscar o crear…                    │
│  Juan Pérez · debe 3.740     [ elegir ⏎ ]     │
│  + Crear «Marta»                              │
│ Saldo 3.740 → 21.345 · Límite 50.000 · OK    │  ← los cinco números actuales, en una línea

Resultado (3 s, sobre el ticket):
┌────────────────────────────┐
│ ✓ Venta #3563              │
│ VUELTO         $ 2.395     │  ← hero
│ Efectivo 20.000            │
│ [ Imprimir ] [ Deshacer ]  │
│ Escaneá para la próxima    │
└────────────────────────────┘

Móvil: pantalla completa, botones de medio en 2 columnas, teclado numérico propio abajo, pie fijo.
```

### 27.4 Dashboard encargado

```
┌────┬─────────────────────────────────────────────────────────────────────┐
│    │ Hola, Marina · jueves 4 de septiembre           [ Ir a vender ]     │
│    │                                                                     │
│    │ NECESITA TU ATENCIÓN                                                │
│    │ ┌───────────────────────────┐ ┌───────────────────────────┐        │
│    │ │ ▲ 3 productos agotados    │ │ ● 1 lote vencido (4 u.)   │        │
│    │ │   Mermelada, Prepizza, He…│ │   Leche entera LP-2510    │        │
│    │ │   [ Armar pedido ]        │ │   [ Dar de baja ]         │        │
│    │ └───────────────────────────┘ └───────────────────────────┘        │
│    │ ┌───────────────────────────┐ ┌───────────────────────────┐        │
│    │ │ ▲ 1 pedido a medio recibir│ │ ● 1 inventario sin aplicar│        │
│    │ │   OC-3 Mayorista Central  │ │   IF-2 · 47 líneas        │        │
│    │ │   [ Recibir ]             │ │   [ Revisar ]             │        │
│    │ └───────────────────────────┘ └───────────────────────────┘        │
│    │                                                                     │
│    │ HOY                                                                 │
│    │  Vendido        Ganancia       Caja (Lucía, desde 8:02)   Por cobrar│
│    │  $ 103.645      $ 30.585 · 29 %   $ 25.000 · cuadró ayer  $ 19.060 │
│    │  9 ventas       [ ver ]        [ ir a la caja ]           3 deben  │
│    │                                                                     │
│    │ ÚLTIMAS VENTAS                     HAY QUE REPONER                 │
│    │ #3563  Ana     $ 17.605  ✓         Salame milan   quedan 4 · mín 4 │
│    │ #3548  Lucía   $ 13.440  ✓         Pasta dental   quedan 2 · mín 4 │
└────┴─────────────────────────────────────────────────────────────────────┘
```

Regla: las alertas sólo aparecen cuando hay algo; si no, «Nada urgente. Todo en orden.» y las cifras suben.

### 27.5 Productos (Stock › Productos)

```
┌────┬──────────────────────────────────────────────────────────┬────────────────┐
│    │ Productos              Catálogo ▾ Existencias   [ Nuevo ]│ PANEL (al ⏎)   │
│    │ ▌ Buscar o escanear…   Categoría ▾  Stock ▾  Filtrar (1) │ Yerba mate 1 kg│
│    │──────────────────────────────────────────────────────────│ $ 4.850  33 u. │
│    │ PRODUCTO                 STOCK        PRECIO   ACCIÓN    │ 7790001000011  │
│    │ Yogur bebible 900 g      16 u.        2.890    Ajustar   │ [Cambiar precio]│
│    │▶Yerba mate 1 kg          33 u.        4.850    Ajustar   │ [Ajustar stock] │
│    │ Vino tinto malbec 750 ml 15 u.        7.400    Ajustar   │ Categoría Almac.│
│    │ Salame milan x kg      ▲ 4 u. · mín 4 15.900   Ajustar   │ Mínimo 4       │
│    │ Mermelada frutilla     ✕ agotado      2.150    Ajustar   │ Último costo…  │
│    │ … (14 filas en 768 px, densidad operación)               │ [ Abrir ficha ]│
│    │ 1–25 de 43                            ‹ 1/2 ›            │                │
└────┴──────────────────────────────────────────────────────────┴────────────────┘
```

Móvil: lista (nombre, stock, precio) con botón de cámara; tocar abre la ficha; deslizar → Ajustar.

### 27.6 Stock (existencias y ajuste)

```
Vista «Existencias» de la misma pantalla, con el panel de ajuste a la derecha:
┌────┬────────────────────────────────────────┬──────────────────────────────────┐
│    │ 3 agotados · 3 bajo mínimo · 1 vencido │ AJUSTAR  Yogur bebible 900 g     │
│    │ [ Armar pedido ] [ Recibir ] [ Contar ]│ Ahora hay          16 u.         │
│    │ ▌ Buscar o escanear…     Sólo faltantes│ ┌───────┐┌───────┐┌───────┐      │
│    │ Yogur bebible 900 g    16 u.  ▶ Ajustar│ │Entrada││Rotura ││Vencido│      │
│    │ Yerba mate 1 kg        33 u.    Ajustar│ └───────┘└───────┘└───────┘      │
│    │ Salame milan x kg   ▲ 4 · mín 4 Ajustar│ ┌───────┐┌───────┐              │
│    │ Mermelada frutilla  ✕ agotado   Ajustar│ │Consumo││Recuent│              │
│    │ …                                      │ └───────┘└───────┘              │
│    │                                        │ Cuánto se rompió   [  3  ] u.   │
│    │                                        │ De qué partida  YG-260801 ▾     │
│    │                                        │ Va a quedar en 13 u.            │
│    │                                        │ Motivo  Rotura (editable)       │
│    │                                        │ [ Cancelar ]     [ Guardar ⏎ ]  │
└────┴────────────────────────────────────────┴──────────────────────────────────┘
```

Móvil: la misma lista con cámara; el ajuste es una hoja con los tiles, el campo de 56 px, «Va a quedar en» y pie fijo.

### 27.7 Ficha de producto (pantalla, no diálogo)

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│    │ ← Productos                                                              │
│    │ Yerba mate 1 kg                     $ 4.850   33 u. (33 vendibles)       │
│    │ Almacén · 7790001000011 · Distribuidora del Norte                        │
│    │ [ Cambiar precio ]  [ Ajustar stock ]  [ Dar de baja ]  [ … ]            │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ Datos │ Códigos │ Compra y costo │ Lotes │ Historial                      │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ DATOS                                                                    │
│    │ Nombre         [ Yerba mate 1 kg              ]                          │
│    │ Categoría      [ Almacén ▾ ]      Se vende por  ( Unidad ) ( Peso )      │
│    │ Mínimo         [ 5 ] u.  — avisa cuando quede esto o menos               │
│    │ ▸ Más opciones (descripción, proveedor)                                  │
│    │                                              [ Guardar ⏎ ]               │
└────┴──────────────────────────────────────────────────────────────────────────┘
Cambiar precio → hoja de dos números: «Hoy $ 4.850 → Nuevo [ 5.200 ]  Margen 38 % → 42 %  [Guardar]».
Lotes → «Este producto no lleva lotes. [ Activar lotes ]» (asistente de 2 pasos).
Historial → precio, costo, stock, ventas, en una sola lista con filtro.
```

### 27.8 Recepción (Stock › Recibir)

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│    │ Recibir mercadería                                                       │
│    │ Proveedor  [ Distribuidora del Norte ▾ ]   Pedido  [ OC-3 (30 pend.) ▾ ] │
│    │            (o «sin pedido»)                                              │
│    │ ▌ Escaneá o escribí el producto…                                         │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ PRODUCTO                    PEDIDO   LLEGÓ        COSTO       ▸ detalles │
│    │▶Arroz largo fino 1 kg       30       [ 30 ] u.    $ 1.190  ✓  ▸          │
│    │ Harina 000 1 kg (nuevo)     —        [ 10 ] u.    $ 850       ▸ lote/venc│
│    │ Fideos guiseros 500 g       —        [  5 ] u.    $ 720                  │
│    │                                                                          │
│    │ Entran 3 productos · 45 u. · $ 47.800     ¿Cambió algún precio? ▸        │
│    │ Notas (remito 0001-00004521)                                             │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ [ Guardar para después ]                      [ Confirmar recepción ⏎ ]  │
└────┴──────────────────────────────────────────────────────────────────────────┘
Detalles de una línea (al abrir ▸): costo de factura, partida (código, cantidad, vencimiento) si el producto lleva lotes; si no, «Este producto no lleva lote · Activar».
Móvil: cámara arriba, cada escaneo agrega/enfoca la línea; cantidad con teclado numérico; pie fijo.
```

### 27.9 Inventario físico (conteo)

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│    │ Contar · IF-2 · Todo el catálogo · a ciegas         12 de 47 ▓▓▓▓░░░░░░  │
│    │ ▌ Escaneá o escribí…                        Ver: ( Pendientes ) Todos   │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ ✓ Yerba mate 1 kg                                     contado 20        │
│    │ ✓ Azúcar 1 kg                                         contado 40        │
│    │▶ Arroz largo fino 1 kg                 Contaste  [  31  ] u.   ⏎ guarda │
│    │   Fideos guiseros 500 g                                pendiente        │
│    │   Leche entera 1 L                                     pendiente        │
│    │     ├ LP-2510 (vence 2/9)                              pendiente        │
│    │     ├ LP-2604 (vence 5/9)                              pendiente        │
│    │     └ sin lote conocido                                pendiente        │
│    │   …                                                                      │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ [ Cancelar inventario ]        [ Cerrar conteo (35 pendientes → 0) ]     │
└────┴──────────────────────────────────────────────────────────────────────────┘
Revisión: la misma lista con «esperado · contado · diferencia», filtros «con diferencia», «sin resolver» → cada «sin resolver» tiene [ Elegir lote ▾ ] o [ Sin lote ]; «Aplicar diferencias» pide confirmación con el resumen (+20 / −7 / $ …).
Móvil: barra de progreso fija; línea activa grande; escanear salta a la línea; el teclado numérico no tapa el botón.
```

### 27.10 Cliente

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│    │ ← Clientes                                                               │
│    │ Juan Pérez  · 11-5555-1234                          [ Registrar pago ]   │
│    │ DEBE $ 3.740     Límite $ 50.000     Disponible $ 46.260    Fiado activo │
│    │ [ Cobrar todo ] [ Fijar límite ] [ Cortar fiado ] [ … ]                  │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ Movimientos │ Compras │ Datos                                            │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ 4/9 19:26  Venta a cuenta #3561          +1.690    saldo 3.740  Lucía    │
│    │ 4/9 03:26  Pago RC-1 (transferencia)     −8.000    saldo 2.050  Marina   │
│    │ 3/9 17:26  Venta a cuenta #3560         +10.050    saldo 10.050 Lucía    │
│    │ [ Reimprimir comprobante ] en cada pago                                  │
└────┴──────────────────────────────────────────────────────────────────────────┘
Registrar pago (panel): «Debe 3.740 · Paga [ 3.740 ] · ( Efectivo ) ( Transferencia ) · entra a la caja · [ Registrar ⏎ ]». Si paga de más: «Quedan 260 a favor» antes de confirmar.
```

### 27.11 Proveedor

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│    │ ← Proveedores                                                            │
│    │ Distribuidora del Norte · Marisa · 11-4567-8900       [ Registrar pago ] │
│    │ LE DEBEMOS $ 7.344   vence 3/10   nada vencido   1 entrega sin saldar    │
│    │ [ Recibir mercadería ] [ Nuevo pedido ] [ Nota de crédito ] [ … ]        │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ Deudas │ Movimientos │ Pedidos │ Devoluciones │ Productos │ Datos        │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ OC-1 · entrega #2 · 3/9    vence 3/10    pendiente $ 7.344   Pendiente   │
│    │   ▸ original 9.180 · devuelto 1.836 · pagado 0                           │
└────┴──────────────────────────────────────────────────────────────────────────┘
Pago (panel): importe propuesto, medio como botones, «se imputa a: OC-1 entrega #2 $ 7.344» (FIFO editable), «no sale de la caja» si no es efectivo, pie fijo.
```

### 27.12 Reportes

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│    │ Reportes            Esta semana ▾   29/8 – 4/9   vs. semana anterior     │
│    │ Ventas │ Rentabilidad │ Caja │ Stock │ Compras │ Clientes │ Proveedores  │
│    │──────────────────────────────────────────────────────────────────────────│
│    │ VENTAS                                                                   │
│    │  Facturado $ 176.185 (+12 %)   15 ventas   ticket $ 11.746   1 anulada   │
│    │  Por medio            Por cajero            Por día                      │
│    │  Efectivo  96.305 ▓▓▓▓▓▓  Lucía 108.890 ▓▓▓▓  2/9  20.810 ▓             │
│    │  Débito    38.610 ▓▓      Marina 27.920 ▓     3/9  51.730 ▓▓▓           │
│    │  Transf.   27.290 ▓▓      Pablo  21.770 ▓     4/9 103.645 ▓▓▓▓▓▓        │
│    │  A cuenta  13.980 ▓                                                      │
│    │                                                      [ Exportar CSV ]    │
└────┴──────────────────────────────────────────────────────────────────────────┘
Móvil: las pestañas como chips; cada tema entra en una o dos pantallas; barras proporcionales en vez de tablas anchas.
```

---

## 28. Copy y microcopy

### 28.1 Estado

La voz del sistema es buena: voseo, frases cortas, verbos concretos («Contá el efectivo del cajón y abrila», «Escribí qué pasó: es lo que se va a leer mañana», «Vacío: sin límite. Cero: no se le fía. No es lo mismo»). Los mensajes de error del servidor están escritos para personas y ninguno filtra SQL, stack ni nombres de restricción (verificado en la Fase 5A.2 y en esta auditoría). Lo que falla es puntual y se corrige con un diccionario.

### 28.2 Principios

1. Verbos humanos en los botones: Cobrar, Guardar, Cancelar, Recibir mercadería, Registrar pago, Dar de baja.
2. Nunca un código, una clave de permiso, un nombre de tabla ni una variable de entorno a la vista.
3. Un error dice **qué no pasó, por qué y qué hacer**, en ese orden, y trae el botón.
4. Cantidades y dinero siempre con su unidad y en formato local.
5. Sin «correctamente», «exitosamente», «entidad», «persistir», «registro», «operación».
6. El sistema no niega lo que tiene ni promete lo que no.

### 28.3 Reemplazos concretos

| Dónde                                | Hoy                                                                             | Propuesta                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Ventas y Caja, columna Medio         | `CASH`, `DEBIT_CARD`, `TRANSFER`                                                | Efectivo, Débito, Transferencia (`etiquetaDeMedio`)                                                           |
| Caja, tipo de movimiento             | `customer_payment`, `supplier_payment`                                          | Cobro a cliente, Pago a proveedor                                                                             |
| Ventas, filtro de medio              | Efectivo / Tarjeta / Mercado Pago                                               | Efectivo / Débito / Crédito / Transferencia / A cuenta / Otro                                                 |
| Recepción, orden, movimientos        | «Pendiente 30.000 unidad», «Anterior 33.000»                                    | «Pendiente 30 u.», «Antes 33 u.»                                                                              |
| Reportes                             | «Unidades 7.000», «Unidades perdidas 0.000»                                     | «7 u.», «Ninguna»                                                                                             |
| Lotes, Inicio                        | «4.000 unidades»                                                                | «4 u.»                                                                                                        |
| Ficha de producto                    | «Unidades por compra 1.000», «Mínimo de reposición 5.000»                       | «Se compra por caja de 8», «Avisar cuando queden 5 u.»                                                        |
| Nueva compra, columna                | «Contiene 1.000»                                                                | «caja de 8» (texto), editable al tocar                                                                        |
| Ficha de producto, hints             | «Cambiar precios necesita el permiso `products.price.update`»                   | «Sólo el encargado puede cambiar precios»                                                                     |
| Configuración                        | «PERMISOS (65): accounts.adjust, …»                                             | «Podés: vender, cobrar, abrir y cerrar la caja, fiar…»                                                        |
| Configuración                        | «El nombre sale de `NEXT_PUBLIC_COMMERCE_NAME`…»                                | Campo «Nombre del comercio» en Sucursal                                                                       |
| Configuración                        | «Lo que todavía no está: turnos… compras, proveedores y clientes»               | Quitar (existen)                                                                                              |
| Inventario, línea                    | «sin asignar»                                                                   | «sin lote conocido»                                                                                           |
| Inventario, cierre                   | «Quedan 46 línea(s) sin contar o esperando segundo conteo.»                     | «Faltan contar 46 productos. [ Ver pendientes ] [ Cerrar contando el resto como 0 ]»                          |
| Cobro sin caja                       | «No hay una caja abierta. Abrí la caja antes de vender.»                        | Igual + botón «[ Abrir la caja ]»                                                                             |
| Alta rápida con 0 stock              | «Cargá el stock desde Stock → Ajustar.»                                         | «[ Cargar stock ahora ]»                                                                                      |
| Proveedor sin productos              | «Se asocian solos al recibir una compra, o desde la ficha del producto.»        | «Se asocian al recibirle mercadería. [ Recibir ]»                                                             |
| Devoluciones vacío                   | «Se arman desde el detalle de una entrega, con el botón “Devolver mercadería”.» | «Se arman desde una entrega. [ Ver pedidos recibidos ]»                                                       |
| Stock, métrica                       | «Productos en esta página 25»                                                   | Quitar                                                                                                        |
| Caja, panel                          | «Inicial 25.000 · Ventas 102.495 · Tiene que haber 99.725»                      | «Inicial 25.000 + ventas 102.495 + ingresos 5.120 − retiros 32.890 = **99.725**»                              |
| Caja, botón                          | «Hacer arqueo»                                                                  | «Contar la caja»                                                                                              |
| Compras, menú                        | «Órdenes»                                                                       | «Pedidos»                                                                                                     |
| Recepción, hint                      | «Cambialo solo si la factura dice otra cosa.»                                   | «¿La factura dice otro precio?» (colapsado)                                                                   |
| Pago a proveedor                     | «Aplicación · Automática (vencimiento más viejo primero) · Se imputan»          | «A qué entregas se aplica · Automático (la más vieja primero) · Se aplica»                                    |
| Anticipos                            | «Pagos sin imputar»                                                             | «Plata entregada sin aplicar»                                                                                 |
| Ajuste de stock                      | «Entraron / salieron — Sumar o restar» / «Recuento — Cuántas hay ahora»         | Tiles: Entrada · Rotura · Vencido · Consumo · Recuento                                                        |
| Inventario, alta                     | «Requerir segundo conteo si hay diferencia»                                     | «Volver a contar lo que dé diferente» (en Más opciones)                                                       |
| Trazabilidad                         | «Lotes obligatorios · Toda entrada y toda salida dicen de qué partida son»      | «Con lote (obligatorio) · Cada unidad tiene número de lote»                                                   |
| Login                                | — (está bien)                                                                   | —                                                                                                             |
| Toasts                               | «Se guardaron 1 conteo(s)»                                                      | «1 conteo guardado» (pluralización real)                                                                      |
| Toasts                               | «Stock ajustado. Quedó registrado en el libro de inventario.»                   | «Stock ajustado: quedan 13 u.»                                                                                |
| Códigos de error (nunca deben verse) | `INSUFFICIENT_SELLABLE_STOCK`, `NO_OPEN_SHIFT`, `CREDIT_LIMIT_EXCEEDED`         | ya traducidos por el servidor; mantener la regla de que `code` es para la pantalla, `message` para la persona |
| Permisos faltantes                   | «Missing products.quickCreate» (no aparece hoy; se verificó)                    | «Pedile a un encargado que dé de alta este producto» (ya)                                                     |

---

## 29. Estados y feedback

### 29.1 Matriz de estados

| Estado                      | Componente                                             | Cuándo                                  | Duración                | Copy                                                                                       |
| --------------------------- | ------------------------------------------------------ | --------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| Cargando primera vez        | Skeleton con la forma final                            | < 100 ms de espera ya muestra skeleton  | hasta datos             | —                                                                                          |
| Recargando (filtro, página) | Contenido anterior atenuado + barra fina arriba        | siempre                                 | hasta datos             | —                                                                                          |
| Vacío sin datos             | `EmptyState` con acción                                | lista sin registros                     | —                       | «Todavía no hay proveedores. Cargá el primero para registrar compras. [ Nuevo proveedor ]» |
| Vacío por filtro            | `EmptyState` corto                                     | filtros activos                         | —                       | «Nada con esos filtros. [ Limpiar ]»                                                       |
| Éxito                       | Toast ✓                                                | tras la acción                          | 2–3 s                   | «Venta registrada», «Caja abierta», «Stock ajustado: quedan 13 u.»                         |
| Éxito con reversa           | Toast ✓ + «Deshacer»                                   | quitar línea, cortar fiado, dar de baja | 5 s                     | «Línea quitada · Deshacer»                                                                 |
| Error de acción             | `InlineError` en el panel (título + causa + botón)     | tras rechazo                            | hasta resolver          | «No se registró la venta. No hay una caja abierta. [ Abrir la caja ]»                      |
| Error de carga              | `ErrorState` con reintento                             | fallo de red/servidor                   | —                       | «No se pudo cargar. [ Reintentar ]»                                                        |
| Advertencia previa          | `Alert` ámbar en el lugar                              | antes de confirmar                      | —                       | «Falta plata: −$ 4.725. Escribí qué pasó.»                                                 |
| Confirmación peligrosa      | `ConfirmDanger` con efecto enumerado, foco en cancelar | irreversible o dinero ajeno             | —                       | «Se van a aplicar 12 diferencias: +20 u. y −7 u. ($ 18.400). No se puede deshacer.»        |
| Confirmación condicional    | `ConfirmDanger` sólo si hay pérdida                    | cerrar sesión con ticket                | —                       | «Hay un ticket de 4 artículos. ¿Cerrar igual?»                                             |
| Deshabilitado con motivo    | Botón deshabilitado + texto                            | permiso o estado                        | —                       | «Sólo un encargado puede anular»                                                           |
| Sin conexión                | Banda fija roja                                        | `offline`                               | hasta volver            | «Sin conexión: se puede armar el ticket, no cobrar»                                        |
| Caja cerrada                | Banda ámbar con acción                                 | en Vender                               | hasta abrir             | «La caja está cerrada. [ Abrir la caja ]»                                                  |
| Progreso de tarea           | `Stepper` / barra                                      | conteo, recepción                       | —                       | «12 de 47»                                                                                 |
| Resultado de venta          | `Result` sobre el ticket                               | tras cobrar                             | 3 s o siguiente escaneo | «Vuelto $ 2.395»                                                                           |

### 29.2 Reglas

1. **Éxito: breve.** Un toast de una línea, verbo en pasado, con la cifra que importa si la hay.
2. **Error: accionable.** Título (qué no pasó) + causa + botón. Nunca «Error», nunca un código.
3. **Advertencia: antes.** En el lugar del problema, con el número.
4. **Confirmación: sólo cuando corresponde.** Irreversible, dinero de terceros, o pérdida de trabajo. Enumerar el efecto. Foco en cancelar. Nunca para guardar un cliente.
5. **Deshacer** para lo reversible y frecuente.
6. **Toasts abajo** en escritorio (ya) y **arriba de la barra de acciones** en móvil, nunca sobre el campo de escaneo.

---

## 30. Modelo de teclado

### 30.1 Gramática única

| Tecla              | Significado en toda la aplicación                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| ↑ ↓                | Mover la selección (líneas del ticket, resultados, filas de tabla, líneas de conteo)               |
| ← →                | Cambiar el valor de lo seleccionado cuando tiene sentido (cantidad, pestaña, opción segmentada)    |
| Enter              | Acción principal de lo seleccionado o de la pantalla (agregar, cobrar, guardar, abrir detalle)     |
| Esc                | Volver, cerrar, vaciar la búsqueda, salir del modo                                                 |
| Escritura directa  | Dígitos → código; letras → búsqueda; en un campo, lo que corresponde                               |
| Lector             | Igual que escribir dígitos + Enter, en cualquier pantalla con escaneo                              |
| Tab / Shift+Tab    | Siguiente / anterior control (nunca la forma principal)                                            |
| Supr               | Quitar lo seleccionado (con Deshacer)                                                              |
| `+` `−`            | Alias de → ← en cantidades                                                                         |
| `?`                | Panel de atajos de la pantalla (y en el POS, modo consulta con el lector)                          |
| F12, Alt+N, Ctrl+K | **Alias secundarios** que se mantienen por compatibilidad, no se muestran en la interfaz principal |

### 30.2 POS

| Situación                      | ↑ ↓                         | ← →                                                          | Enter                                                    | Esc                                                 | Otras                                                                                            |
| ------------------------------ | --------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Campo vacío, ticket con líneas | Selecciona línea del ticket | Cantidad −/+ de la línea seleccionada (respeta paso y stock) | Abre el cobro                                            | Deselecciona; con Shift, vacía el ticket (confirma) | Supr quita la línea; `3*` antes de escanear multiplica; `C` cliente; `?` consulta; `P` en espera |
| Escribiendo letras             | Selecciona resultado        | —                                                            | Agrega el resultado seleccionado y vuelve al campo vacío | Vacía la búsqueda                                   | —                                                                                                |
| Escribiendo dígitos            | —                           | —                                                            | Busca el código (como el lector)                         | Vacía                                               | —                                                                                                |
| Producto por peso              | —                           | —                                                            | Agrega con el peso escrito                               | Cancela                                             | Dígitos escriben el peso                                                                         |
| Cobro abierto                  | —                           | Cambia el medio seleccionado                                 | Cobra (con «Paga con» escrito, calcula vuelto)           | Vuelve al ticket                                    | `E D T R F O` eligen medio; dígitos escriben «paga con»; `J` justo                               |
| Resultado de venta             | —                           | —                                                            | Nueva venta (o escanear)                                 | Nueva venta                                         | `I` imprimir; `Z` deshacer (permiso)                                                             |
| Cliente                        | Selecciona resultado        | —                                                            | Elige; en «Crear», guarda                                | Cierra                                              | —                                                                                                |
| Caja cerrada                   | —                           | —                                                            | Abre el diálogo de apertura si es lo seleccionado        | —                                                   | —                                                                                                |

### 30.3 Diálogos, paneles y hojas

Enter = acción principal (salvo en `ConfirmDanger`, donde el foco arranca en Cancelar y Enter cancela); Esc = cerrar (bloqueado con una petición en vuelo); Tab en orden visual; el primer campo útil tiene el foco al abrir; el foco vuelve **una sola vez** al elemento que lo abrió, o al campo de escaneo en el POS, sin insistir.

### 30.4 Búsqueda

`/` desde cualquier pantalla abre la búsqueda global; escribir filtra en 150 ms; ↑↓ Enter; Esc cierra; los resultados agrupan Productos / Clientes / Proveedores / Pedidos / Ir a.

### 30.5 Tablas y listas

↑↓ fila activa (con `aria-selected`); Enter abre el detalle o ejecuta la acción principal de la fila; `/` va al buscador de la lista; `←→` cambian de página cuando la fila activa está al borde; Esc limpia filtros.

### 30.6 Inventario (conteo)

Escaneo o ↑↓ eligen la línea; dígitos escriben; Enter guarda y pasa a la siguiente pendiente; Shift+Enter guarda y queda; Esc descarta lo escrito; `Ctrl+Enter` cierra el conteo (con confirmación). En revisión: ↑↓ por líneas con diferencia; Enter abre «resolver» si hace falta.

### 30.7 Recepción

Escaneo enfoca la línea (o la crea); Tab entre cantidad y costo; Enter siguiente línea; `Ctrl+Enter` confirma; Esc en una línea nueva la quita.

### 30.8 Cómo se muestra la selección

- Barra de 3 px `primary` a la izquierda + fondo `primary-quiet` + texto `ink` (es el patrón del resultado resaltado de hoy, generalizado).
- El foco real (anillo de 2 px `focus`) sólo cuando el elemento lo tiene de verdad; la selección de teclado no mueve el foco del campo de escaneo en el POS.
- Cada botón principal muestra su tecla con `kbd` («Cobrar ⏎», «Guardar ⏎», «Volver Esc»).
- `?` abre un panel lateral con los atajos de la pantalla actual; no hay diálogo de atajos.

---

## 31. Dashboard por rol

Principio: **primero lo que hay que resolver, después lo que hay que saber**. Cada tarjeta tiene un botón que lleva a resolverlo. Sin gráficos. Las cifras del día están debajo de las alertas. Si no hay alertas: «Nada urgente».

| Rol       | Alertas (sólo si existen)                                                                                                                                                                                                         | Cifras                                                                                                   | Acciones rápidas                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Cajero    | Caja cerrada [Abrir] · Ticket en espera [Recuperar] · Cliente sobre el límite en el último fiado                                                                                                                                  | Mis ventas de hoy · Efectivo que tiene que haber                                                         | Ir a vender · Contar la caja · Cerrar la caja                          |
| Encargado | Agotados [Armar pedido] · Vencidos [Dar de baja] · Diferencia en el último cierre [Ver] · Pedido a medio recibir [Recibir] · Inventario sin aplicar [Revisar] · Cliente sobre el límite [Ver] · Deuda vencida a proveedor [Pagar] | Vendido hoy · Ganancia hoy (%) · Caja (quién, desde, cuánto) · Por cobrar / por pagar                    | Ir a vender · Abrir/cerrar caja · Cambiar precio · Anular última venta |
| Repositor | Agotados y bajo mínimo [Ver] · Vencidos [Dar de baja] · Vence en 7 días [Ver] · Conteo abierto [Continuar] · Pedido por recibir [Recibir]                                                                                         | —                                                                                                        | Escanear para ajustar · Contar · Recibir                               |
| Compras   | Faltantes por proveedor [Armar pedido] · Pedidos esperando mercadería [Recibir] · Vence esta semana (pagos) [Pagar] · Diferencias de costo en la última recepción [Ver]                                                           | Comprado esta semana · Cuentas por pagar (vencido / por vencer) · Anticipos sin aplicar                  | Recibir mercadería · Nuevo pedido · Pagar a proveedor                  |
| Dueño     | Caja abierta fuera de horario · Faltante en un cierre · Deuda vencida · Clientes sobre el límite                                                                                                                                  | Vendido hoy y esta semana (vs. anterior) · Ganancia y margen · Efectivo en caja · Por cobrar − por pagar | Reportes · Cerrar el día                                               |

Cada tarjeta se alimenta de un endpoint que ya existe (`replenishment`, `reportes/vencimientos`, `purchases/summary`, `suppliers/cartera`, `reports/clientes`, `cash/count`, `inventarios?estado=`). No hay que crear cálculos nuevos, sólo priorizarlos.

---

## 32. Responsive strategy

No se define por breakpoints sino por tipo de tarea:

| Tarea                                        | Escritorio (≥ 1024)                                               | Tablet (768–1023)                                             | Móvil (< 768)                                                       |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| POS                                          | Split: favoritos/resultados + ticket fijo de 440 px               | Split con ticket de 360 px y barra contraída                  | Escaneo-primero; ticket como hoja con tirador; barra inferior       |
| Cobro                                        | Panel que reemplaza a los favoritos; pie fijo                     | Panel                                                         | Pantalla completa con teclado propio y pie fijo                     |
| Listados                                     | `DataTable` densa + panel de detalle a la derecha (master-detail) | `DataTable` con columnas de prioridad ≤ 2, detalle como panel | `MobileDataList`; filtros detrás de un botón; detalle como pantalla |
| Fichas y formularios                         | Panel lateral de 520 px con pie fijo                              | Panel de 480 px                                               | Hoja de pantalla completa con pie fijo                              |
| Confirmaciones                               | Modal chico                                                       | Modal                                                         | Hoja corta                                                          |
| Conteo y recepción                           | Lista de trabajo con escaneo                                      | Igual                                                         | Lista de trabajo con cámara y progreso fijo                         |
| Navegación                                   | Barra lateral (contraíble; contraída en Vender)                   | Barra contraída (iconos)                                      | Barra inferior 4 + Más                                              |
| Reportes                                     | Pestañas + tablas cortas                                          | Pestañas                                                      | Chips + listas con barras                                           |
| Dashboards                                   | 2 columnas de alertas + fila de cifras                            | 2 columnas                                                    | 1 columna, alertas primero                                          |
| Comprobantes                                 | Vista de impresión (58/80 mm)                                     | Igual                                                         | Igual + compartir                                                   |
| Diálogos de dinero (abrir/cerrar caja, pago) | Panel                                                             | Panel                                                         | Hoja con pie fijo; el teclado empuja, no tapa                       |

Umbrales: el ticket se fija a partir de 900 px de ancho; las tablas pasan a lista por debajo de su ancho mínimo declarado (no por un breakpoint global); la barra inferior aparece por debajo de 768.

---

## 33. Top 10 problemas UX

| #   | Problema                                                                                                                     | Pantalla                                                            | Quién sufre               | Frecuencia                              | Consecuencia                                                          | Solución                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------- | --------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **El botón «Cobrar» del diálogo queda fuera de la vista** en 1366×768 y en móvil                                             | Cobro                                                               | Cajero                    | Cada venta (cientos por día)            | Desplazar con el cliente enfrente; en móvil, buscar el botón a ciegas | Cobro como panel con pie fijo (§22.4, §27.3)                            |
| 2   | **Cantidades que se leen como miles** («30.000», «5.000», «4.000 unidades»)                                                  | Recepción, pedidos, movimientos, inventario, lotes, reportes, ficha | Compras, repositor, dueño | Cada recepción, cada consulta del libro | Recibir o contar mal; desconfiar del sistema                          | `QuantityText` único; prohibir la cadena cruda                          |
| 3   | **Sin teclado sobre el ticket** y dependencia de F12/Alt+N/Ctrl+K                                                            | POS                                                                 | Cajero                    | Cada corrección de cantidad             | Mouse obligatorio; F12 abre DevTools fuera del POS                    | Gramática de §30                                                        |
| 4   | **Inventario sin salida**: no se cancela, no se resuelve una línea, no se cierra parcial                                     | Conteo                                                              | Repositor, encargado      | Cada inventario con un error            | Conteo bloqueado; stock sin corregir                                  | Botones sobre las rutas que ya existen; cierre parcial con confirmación |
| 5   | **Enlaces a 404 y filtros ignorados**                                                                                        | Movimientos, devoluciones, proveedores                              | Encargado                 | Cada vez que se sigue una referencia    | Pérdida de confianza; navegación a mano                               | Rutas de detalle (`/productos/:id`, recepción) y lectura de la query    |
| 6   | **Códigos técnicos y textos viejos** (`CASH`, `customer_payment`, claves de permiso, «lo que todavía no está»)               | Ventas, Caja, Configuración, Usuarios                               | Todos                     | Diario                                  | Lenguaje ajeno; el sistema niega lo que tiene                         | Diccionario de etiquetas; quitar textos                                 |
| 7   | **Dieciséis pantallas sin margen**; botones fuera del borde en móvil                                                         | Clientes, proveedores, compras, lotes, inventarios, reportes        | Todos                     | Diario                                  | «Nuevo proveedor» recortado; títulos pegados al borde                 | `PageContainer`                                                         |
| 8   | **Recibir mercadería exige pedido previo**; vencido sin acción desde el lote                                                 | Compras, lotes                                                      | Compras, repositor        | Diario                                  | Diez pasos de trámite; mercadería vencida en góndola                  | Recepción directa; «Dar de baja» por lote                               |
| 9   | **Filas duplicadas en escritorio** (tabla + tarjetas)                                                                        | Lotes, inventarios, conteo                                          | Repositor                 | Cada visita                             | Parece que hay el doble                                               | `DataTable` única                                                       |
| 10  | **Acciones irreversibles sin confirmar** (aplicar inventario, cerrar conteo, cortar fiado, baja de proveedor desde la lista) | Inventarios, clientes, proveedores                                  | Encargado                 | Semanal                                 | Un clic equivocado cambia 47 saldos                                   | `ConfirmDanger` con resumen                                             |

---

## 34. Top 20 mejoras

Si sólo se pudieran hacer veinte cosas, en este orden:

1. **Panel de cobro con pie fijo, medios como botones, teclado numérico y vuelto en grande** (escritorio y móvil).
2. **Gramática de teclado única**: ↑↓ sobre el ticket, ←→ cantidad, Enter cobra, Esc vuelve; F12/Alt+N como alias; `kbd` en los botones.
3. **Un solo formato de cantidad y dinero** (`QuantityText`, `MoneyInput`) en toda la aplicación.
4. **`PageContainer` + `PageHeader` únicos** en las 28 pantallas.
5. **`DataTable` responsiva única** (nunca tabla y tarjetas a la vez; columnas por prioridad; fila activa con teclado).
6. **Corregir los cuatro enlaces rotos** y crear la pantalla de producto (`/productos/:id`).
7. **Inventario con salida**: cancelar, resolver línea, cierre parcial, Enter avanza, escaneo salta a la línea, progreso fijo.
8. **Etiquetas humanas para medios y tipos de movimiento** en Ventas y Caja; filtro con los medios reales.
9. **Confirmaciones con resumen** para aplicar inventario, cerrar conteo, cortar fiado, dar de baja; **deshacer** para quitar línea.
10. **Inicio por rol con alertas accionables** (§31), con los endpoints que ya existen.
11. **Recepción directa** (sin pedido previo) desde Stock › Recibir, con escaneo.
12. **«Dar de baja» desde el lote vencido** (ajuste tipo pérdida con partida precargada).
13. **Favoritos en el POS** para lo que no tiene código (panadería, fiambrería, verdulería).
14. **Consulta de precio, ticket en espera, última venta/anular y cobrar deuda desde el POS.**
15. **Barra inferior por rol en móvil** y hojas con pie fijo.
16. **Ficha de producto como pantalla** con pestañas y progressive disclosure; alta en 4 campos.
17. **Reportes con pestañas** y comparación contra el período anterior; exportar CSV.
18. **Quitar textos obsoletos y técnicos** de Configuración y completar (o quitar) la matriz de permisos.
19. **Foco correcto**: una sola devolución al cerrar diálogos; foco a la línea siguiente tras Supr; error de partida al guardar.
20. **Ticket de venta imprimible (no fiscal)** y reimpresión de comprobantes desde la ficha.

---

## 35. Roadmap P0–P3

| Prioridad | Mejora                                                                            | Problema   | Impacto                       | Esfuerzo                | Riesgo                                 | Fase |
| --------- | --------------------------------------------------------------------------------- | ---------- | ----------------------------- | ----------------------- | -------------------------------------- | ---- |
| P0        | Panel de cobro con pie fijo                                                       | H-01       | Muy alto (cada venta)         | Medio                   | Bajo (misma API)                       | 2    |
| P0        | Formato único de cantidad y dinero                                                | H-02       | Muy alto (errores de lectura) | Bajo                    | Bajo                                   | 1    |
| P0        | Cancelar / resolver / cierre parcial de inventario                                | H-03       | Alto                          | Bajo (rutas existentes) | Bajo                                   | 1    |
| P0        | Enlaces rotos y query ignorada                                                    | H-04       | Alto                          | Bajo                    | Bajo                                   | 1    |
| P0        | Etiquetas de medios y tipos; filtro real                                          | H-05       | Alto                          | Bajo                    | Bajo                                   | 1    |
| P0        | Teclado sobre el ticket (↑↓ ←→ Supr) + Enter cobra                                | H-06, H-07 | Muy alto                      | Medio                   | Medio (cambia hábitos; mantener alias) | 2    |
| P0        | `PageContainer` en las 16 pantallas                                               | H-09       | Alto (móvil)                  | Bajo                    | Bajo                                   | 1    |
| P0        | Quitar la duplicación tabla + tarjetas                                            | H-10       | Medio                         | Bajo                    | Bajo                                   | 1    |
| P0        | Middleware: hosts locales configurables                                           | H-40       | Alto para el equipo           | Bajo                    | Bajo                                   | 1    |
| P1        | Confirmaciones faltantes + deshacer                                               | H-11       | Alto                          | Bajo                    | Bajo                                   | 1    |
| P1        | Desglose del turno en Caja                                                        | H-12       | Medio                         | Bajo                    | Bajo                                   | 1    |
| P1        | Recepción directa                                                                 | H-13       | Alto                          | Medio                   | Medio (orden implícita)                | 3    |
| P1        | Dar de baja desde el lote                                                         | H-14       | Alto                          | Bajo                    | Bajo                                   | 3    |
| P1        | Conteo guiado por escaneo, Enter avanza, progreso                                 | H-08       | Alto                          | Medio                   | Bajo                                   | 3    |
| P1        | Medios como botones; segundo renglón inteligente; importes rápidos; vuelto grande | H-16, H-17 | Alto                          | Bajo                    | Bajo                                   | 2    |
| P1        | Favoritos en el POS                                                               | §22        | Alto                          | Medio                   | Bajo                                   | 2    |
| P1        | Consulta de precio · ticket en espera · última venta · cobrar deuda desde el POS  | §8         | Alto                          | Medio                   | Bajo                                   | 2    |
| P1        | Barra inferior móvil + hojas con pie fijo                                         | §23        | Alto (depósito)               | Medio                   | Bajo                                   | 3    |
| P1        | Inicio por rol con alertas                                                        | H-28, §31  | Alto                          | Medio                   | Bajo                                   | 4    |
| P1        | Textos obsoletos, claves de permiso, matriz                                       | H-23, H-24 | Medio                         | Bajo                    | Bajo                                   | 1    |
| P1        | Foco (devolución única; tras Supr; error prematuro)                               | H-18, H-20 | Medio                         | Bajo                    | Bajo                                   | 1    |
| P2        | Ficha de producto como pantalla + alta en 4 campos                                | H-21       | Alto                          | Alto                    | Medio                                  | 4    |
| P2        | `DataTable` única con prioridades y teclado                                       | §17        | Alto                          | Alto                    | Medio                                  | 4    |
| P2        | IA V2: 8 áreas, pestañas, búsqueda global                                         | §20        | Alto                          | Alto                    | Medio (reaprendizaje; redirecciones)   | 4    |
| P2        | Reportes con pestañas y comparación                                               | H-15       | Medio                         | Medio                   | Bajo                                   | 4    |
| P2        | Formularios con «Más opciones» (cliente, proveedor, compra, recepción)            | §16        | Medio                         | Medio                   | Bajo                                   | 4    |
| P2        | Fechas con un formato y selector propio                                           | H-27       | Medio                         | Bajo                    | Bajo                                   | 1    |
| P2        | Paneles laterales en vez de modales para formularios                              | §24        | Medio                         | Medio                   | Bajo                                   | 4    |
| P2        | Ticket de venta imprimible; reimpresión                                           | §8         | Medio                         | Bajo                    | Bajo                                   | 5    |
| P3        | Descuento por ticket con motivo y permiso                                         | §8         | Medio                         | Medio                   | Medio (política)                       | 5    |
| P3        | Devolución parcial / cambio                                                       | §8         | Medio                         | Alto                    | Medio                                  | 5    |
| P3        | Sugerencia de pedido → borrador                                                   | §8         | Medio                         | Bajo                    | Bajo                                   | 5    |
| P3        | Configuración de sucursal; cambio de clave; categorías                            | §8         | Medio                         | Medio                   | Bajo                                   | 5    |
| P3        | Exportar CSV; anular cobro/pago desde la UI                                       | §8, §10.5  | Bajo                          | Bajo                    | Bajo                                   | 5    |
| P3        | Densidad `operacion`/`admin` en tokens                                            | §25.9      | Medio                         | Medio                   | Bajo                                   | 4    |
| P3        | Servir Inter o quitarla                                                           | §11.2      | Bajo                          | Bajo                    | Bajo                                   | 1    |

---

## 36. Plan de implementación por fases

Criterio de orden: **impacto operativo × frecuencia × riesgo ÷ esfuerzo**. Cada fase deja el sistema usable y verificable con la suite existente; ninguna requiere migraciones de base ni cambios de API salvo donde se dice. No hay big bang: el POS actual convive con el nuevo detrás de una preferencia hasta que el nuevo pase las mismas 11 pruebas de `e2e/venta.spec.ts` y las 20 de `alta-rapida.spec.ts`.

### UX Phase 1 — «Sin sorpresas» (2–3 semanas)

Correcciones sin cambio de estructura. Formato único de cantidad y dinero; etiquetas de medios y tipos; enlaces rotos; `PageContainer`; duplicación de tablas; confirmaciones y deshacer; cancelar/resolver/cierre parcial de inventario; error prematuro; foco; textos obsoletos; matriz de permisos; desglose del turno; fechas; hosts del middleware; Inter. **Verificación:** suite completa + capturas de regresión en los cuatro anchos con el guion de esta auditoría.

### UX Phase 2 — «Cobrar sin mirar» (3–4 semanas)

El POS: panel de cobro, gramática de teclado, medios como botones, vuelto grande, favoritos v1, consulta de precio, ticket en espera, última venta, cobrar deuda, resultado que se va solo. **Riesgo controlado:** F12, Alt+N y Ctrl+K siguen funcionando; el diálogo viejo queda disponible una release. **Verificación:** las pruebas E2E del POS reescritas contra el nuevo panel; un cajero real 15 minutos.

### UX Phase 3 — «El depósito en el celular» (3–4 semanas)

Barra inferior por rol; hojas con pie fijo; recepción directa con escaneo; conteo guiado; dar de baja vencidos; ajuste por escaneo; filtros colapsados; listas primero. **Verificación:** `movil.spec.ts` ampliado a estas tareas en 375 y 390.

### UX Phase 4 — «Estructura» (4–6 semanas)

IA de 8 áreas con redirecciones desde las rutas viejas; `PageHeader`; `DataTable` única con teclado; ficha de producto como pantalla; formularios con «Más opciones»; paneles laterales; Inicio por rol; Reportes con pestañas; densidades. **Riesgo:** reaprendizaje de la navegación; se mitiga con redirecciones y con el orden por rol.

### UX Phase 5 — «Funciones» (continuo)

Ticket imprimible; descuento por ticket; devolución parcial; sugerencia de pedido; configuración de sucursal; cambio de clave; categorías; exportar; anular cobro/pago desde la UI.

### Qué no cambia en ninguna fase

Los tokens de `globals.css`; el servidor como autoridad de precio, stock y crédito; motivo obligatorio y bitácora; el flujo escanear → ticket → cobrar; la política de errores sin detalle técnico; los 65 permisos y 9 roles.

---

## 37. Scorecard

Sin inflar. Cada puntaje se explica en una línea.

| Área                  | / 10  | Por qué                                                                                                                                                                               |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POS                   | **7** | Escaneo, alta rápida, vendible y cobro seguro son de primer nivel; el cobro fuera de pantalla, el teclado incompleto y la falta de favoritos, consulta y espera le quitan tres puntos |
| Caja                  | **8** | Turnos, cierre con diferencia y arqueo excelentes; códigos técnicos, desglose que no cierra y umbral descubierto tarde                                                                |
| Stock                 | **7** | Ajuste con motivo y libro inmutable; formato ambiguo, lista duplicada con Productos, sin acción sobre vencidos                                                                        |
| Compras               | **7** | Recepción parcial, costo esperado vs. facturado y devoluciones bien modelados; sin recepción directa, vocabulario técnico, formato                                                    |
| Clientes              | **7** | Fiado con previsualización y cobro con comprobante; el cobro no está en el POS; cortar fiado sin confirmar                                                                            |
| Proveedores           | **8** | Cuenta corriente, FIFO previsualizado, anticipos e imputación: completos y claros; denso, sin margen                                                                                  |
| Inventario            | **5** | El modelo (a ciegas, concurrente, por delta) es correcto; la pantalla no: sin cancelar, sin resolver, sin escaneo, Enter no avanza, duplicado                                         |
| Lotes                 | **6** | FEFO, vendible y alertas funcionan; la lista no permite actuar; el rastreo se activa al fondo de un diálogo                                                                           |
| Reportes              | **5** | Cálculos honestos y completos; una sola página sin navegación, sin exportar, formato de unidades                                                                                      |
| Mobile                | **4** | Nada se rompe, todo entra, pero los pies quedan fuera de vista, hay 16 pantallas sin margen, botones al borde, y el conteo no es usable                                               |
| Desktop               | **7** | Sólido en administración; el POS desperdicia espacio y el cobro no cabe en 768 px                                                                                                     |
| UX                    | **6** | Copy, estados y accesibilidad muy por encima de la media; jerarquía, navegación, teclado y móvil por debajo                                                                           |
| Velocidad operativa   | **7** | Escaneo a 60 ms y ningún flujo con espera; pasos de más en cobro combinado, fiado, recepción y vencidos                                                                               |
| Facilidad de aprender | **5** | Vender se aprende en 5 minutos; F12, «orden → recepción», «trazabilidad», «sin asignar» e «imputación» necesitan a alguien que explique                                               |

**Puntaje global operacional: 6,7 / 10** (promedio de POS, Caja, Stock, Compras, Clientes, Proveedores, Inventario, Lotes, Reportes y Velocidad).
**Puntaje global UX: 5,5 / 10** (promedio de Mobile, Desktop, UX y Facilidad de aprender).

---

## 38. Recomendación ejecutiva

**Qué tenemos.** Un sistema de gestión completo para un almacén de una sucursal: caja registradora con lector, caja por turnos, fiado, compras a proveedores con su cuenta corriente, lotes y vencimientos, inventario e informes. Todo lo que se pidió está, y por debajo hay una contabilidad seria: nada se borra, todo lleva motivo y queda registrado, y la computadora del servidor —no la pantalla— decide precios, stock y crédito.

**Qué funciona muy bien.** Cobrar: se pasa el producto por el lector y aparece, sin tocar nada, en menos de un décimo de segundo. Si un producto no está cargado, se carga en cinco casilleros sin salir de la caja. La caja se abre contando el cajón y se cierra viendo si sobra o falta plata, en el momento. A los proveedores se les paga viendo a qué entregas va la plata. Los mensajes hablan en castellano y dicen qué hacer.

**Qué puede complicar al personal.** El botón de «Cobrar» queda escondido debajo del borde en las computadoras de caja comunes y en cualquier celular. Varios números se escriben como «30.000» cuando son treinta. Para mover cantidades en el ticket hay que usar el mouse. Un inventario que se empezó mal no se puede cancelar. Algunas pantallas muestran siglas en inglés y una dice que faltan cosas que en realidad están.

**Qué falta.** Nada que impida abrir. Sí conviene sumar pronto: recibir mercadería sin haber hecho un pedido antes, dar de baja lo vencido con un botón, consultar un precio sin agregarlo al ticket, dejar un ticket en espera, cobrar un fiado desde la caja y un ticket de papel para el cliente.

**Qué cambiaría primero.** En dos o tres semanas: los números, los textos, los enlaces rotos, los márgenes de pantalla y las tres salidas del inventario (no cambian cómo se trabaja, sólo sacan trampas). Después, un mes de caja: el cobro rediseñado para que entre en cualquier pantalla y se maneje con Enter y flechas, más favoritos, consulta de precio y ticket en espera. Recién después el celular para el depósito y la reorganización de menús.

**Si abriría el almacén mañana con este sistema.** Sí, con dos condiciones: que la persona de la caja tenga quince minutos de práctica con alguien al lado, y que el encargado sepa que las compras se cargan como pedido antes de recibirlas. Con las correcciones de la primera fase hechas, sin condiciones.

---

## Anexo A — Índice de evidencia

Directorio `docs/ux-audit-evidence/` (140 archivos, 11 MB). Convención `<pantalla>-<ancho>.png`, anchos 375, 768, 1366, 1920 (los diálogos y variantes sólo en 375 y 1366).

| Grupo                    | Archivos                                                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso e inicio          | `login-*`, `inicio-admin-*`, `inicio-cajero-{375,1366}`, `inicio-repositor-{375,1366}`, `inicio-compras-1366`, `inicio-claro-1366`                                                                                                                                         |
| POS                      | `venta-vacia-*`, `venta-con-productos-*`, `venta-busqueda-{375,1366}`, `venta-codigo-desconocido-{375,1366}`, `venta-codigo-desconocido-encargado-1366`, `venta-alta-rapida-{375,1366}`, `venta-peso-{375,1366}`, `venta-claro-1366`, `ticket-movil-375`, `menu-movil-375` |
| Cobro                    | `cobro-*`, `cobro-efectivo-vuelto-{375,1366}`, `cobro-combinado-{375,1366}`, `cobro-cuenta-{375,1366}`                                                                                                                                                                     |
| Caja                     | `caja-*`, `caja-cerrar-{375,1366}`, `caja-arqueo-1366`, `caja-movimiento-1366`                                                                                                                                                                                             |
| Ventas                   | `ventas-*`, `ventas-anular-1366`                                                                                                                                                                                                                                           |
| Productos y stock        | `productos-*`, `producto-editar-{375,1366}`, `producto-nuevo-1366`, `stock-*`, `stock-ajuste-{375,1366}`, `stock-claro-1366`, `movimientos-*`, `lotes-*`                                                                                                                   |
| Inventarios              | `inventarios-*`, `inventario-nuevo-{375,1366}`                                                                                                                                                                                                                             |
| Compras                  | `compras-*`, `compra-nueva-*`, `compra-detalle-*`, `compra-recepcion-{375,1366}`, `devoluciones-*`                                                                                                                                                                         |
| Proveedores              | `proveedores-*`, `proveedor-detalle-*`, `proveedor-pago-{375,1366}`                                                                                                                                                                                                        |
| Clientes                 | `clientes-*`, `cliente-detalle-*`, `cliente-cobro-{375,1366}`                                                                                                                                                                                                              |
| Control y administración | `reportes-*`, `auditoria-*`, `usuarios-*`, `sucursales-1366`, `configuracion-*`                                                                                                                                                                                            |

Nota: las capturas «full page» (`reportes-*`, `usuarios-*`) muestran sólo el primer viewport por el desplazamiento interno del `main` (§2.5).

## Anexo B — Defectos para el equipo de desarrollo (documentados, no corregidos)

| #   | Defecto                                                                                                                                                                              | Dónde                                                                | Evidencia                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------- |
| D1  | `HOSTS_LOCALES` sólo admite `localhost:3099`, `127.0.0.1:3099`, `localhost`, `127.0.0.1`: `next dev` (3000), E2E (3101) y `pwa:check` (3100) reciben «Host no reconocido»            | `src/middleware.ts`                                                  | Verificado en 3105               |
| D2  | `enlaceDeReferencia` genera `/compras/recepcion/:id` (sin página) y `/ventas?venta=:id` (query ignorada)                                                                             | `src/modules/inventory/referencias.ts`, `src/app/ventas/page.tsx`    | 404 verificado                   |
| D3  | `devoluciones/[id]` enlaza a `/productos/:id` (sin página) y `/compras/recepcion/:id`                                                                                                | `src/app/devoluciones/[id]/page.tsx`                                 | 404 verificado                   |
| D4  | `proveedores/[id]` enlaza a `/productos?producto=:id`; `/productos` no lee la query                                                                                                  | `src/app/proveedores/[id]/page.tsx`                                  | Código                           |
| D5  | `CardList` sin `md:hidden` en `/stock/lotes`, `/inventarios`, `/inventarios/[id]`: tabla y tarjetas a la vez                                                                         | esas tres páginas                                                    | `lotes-1366`, `inventarios-1366` |
| D6  | `medioLegible` y `TIPOS` en `MovimientoRow.tsx` sólo conocen claves heredadas: `CASH`, `DEBIT_CARD`, `customer_payment` se muestran crudos                                           | `src/components/caja/MovimientoRow.tsx` (usado también en `/ventas`) | `caja-1366`, `ventas-1366`       |
| D7  | Filtro «Medio de pago» de `/ventas` con valores `efectivo`/`tarjeta`/`mercado_pago`; «tarjeta» → `CARD` no coincide con `DEBIT_CARD`/`CREDIT_CARD`; «Mercado Pago» → `TRANSFER`      | `src/app/ventas/page.tsx`                                            | Código + prueba con «efectivo»   |
| D8  | `DialogoMovimiento` envía `paymentMethod: 'efectivo'                                                                                                                                 | 'tarjeta'                                                            | 'mercado_pago'` (heredados)      | `src/components/caja/DialogoMovimiento.tsx` | Código |
| D9  | Cantidades renderizadas como `TextoCantidad` crudo («30.000») en recepción, órdenes, movimientos (columna Anterior), inventarios, lotes (métricas), reportes, ficha (mínimo, factor) | varios                                                               | §10 H-02                         |
| D10 | Importes renderizados crudos en inputs («4850.00»)                                                                                                                                   | ficha, cobros, pagos                                                 | §11.2                            |
| D11 | Sin botón para `POST /api/inventarios/:id/cancelar` ni para `lineas/:lineId/resolver`                                                                                                | `src/app/inventarios/[id]/page.tsx`                                  | Verificado                       |
| D12 | Enter en el input de conteo no avanza (sólo Tab)                                                                                                                                     | ídem                                                                 | Verificado (`activeElement`)     |
| D13 | «De qué partida» marca error antes de interacción                                                                                                                                    | `DialogoAjusteStock.tsx` (`falta` se evalúa al abrir)                | `stock-ajuste-375`               |
| D14 | `devolverFoco` insiste 600 ms y pisa un clic del usuario en la búsqueda                                                                                                              | `src/app/venta/page.tsx`                                             | Reproducido                      |
| D15 | Tras `Supr` en una línea del ticket el foco cae al `body`                                                                                                                            | `Ticket.tsx`                                                         | Verificado                       |
| D16 | Acciones sin confirmación: aplicar inventario, cerrar conteo (`accion()`), cortar fiado (`cambiarFiado`), dar de baja proveedor desde la lista (`cambiarEstado`)                     | páginas respectivas                                                  | Código                           |
| D17 | `/configuracion`: lista «Lo que todavía no está» obsoleta; claves de permiso; variable de entorno                                                                                    | `src/app/configuracion/page.tsx`                                     | `configuracion-1366`             |
| D18 | `MatrizPermisos.AREAS` cubre 24 de 65 permisos                                                                                                                                       | `src/components/usuarios/MatrizPermisos.tsx`                         | `usuarios-1366`                  |
| D19 | 16 páginas sin `PageContainer` (`padding: 0`, sin `max-width`)                                                                                                                       | ver §4.2                                                             | Medido                           |
| D20 | `<input type="date">` nativo: formato según el idioma del dispositivo                                                                                                                | ventas, compras, movimientos, auditoría, reportes                    | `ventas-1366` («08/28/2026»)     |
| D21 | Panel de turno omite ingresos y egresos: la suma mostrada no cierra                                                                                                                  | `PanelTurno.tsx`                                                     | `caja-1366`                      |
| D22 | «Hacer arqueo» habilitado con la caja cerrada                                                                                                                                        | `src/app/caja/page.tsx`                                              | Verificado tras cerrar           |
| D23 | Inter declarada en `--font-sans` sin `@font-face` ni `next/font`: cae a `system-ui`                                                                                                  | `globals.css`, `layout.tsx`                                          | Código                           |
| D24 | Título duplicado (`h1` de cabecera + `h2` 2xl) en Lotes, Inventarios, Nueva compra                                                                                                   | páginas                                                              | `lotes-375`                      |
| D25 | `SELECTION` de inventario, `draft-from-restock`, anular cobro y anular pago: rutas sin UI                                                                                            | API                                                                  | Código                           |

_Fin del documento._
