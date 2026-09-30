# V1 comercial — primera tanda

> Rama `feat/commercial-v1`, creada desde
> `feat/ux-v2-phase2-1-lista-navegacion` en `68234e63717795a32b4a7f6d89c4cae6bc0f16bb`
> (2026-09-30). **Sin desplegar, sin merge, sin push hasta autorización.**
>
> Nace del análisis [FABLE_COMMERCIAL_READINESS.md](FABLE_COMMERCIAL_READINESS.md)
> y de la propuesta [UX_V4_ALMACENES_PROPUESTA.md](UX_V4_ALMACENES_PROPUESTA.md).
> Es la primera de varias tandas: mejora lo que el dueño de un almacén ve y usa
> todos los días. Lo que NO entra en esta tanda está al final.

## Qué se hizo

| #   | Cambio                       | Commit                | Dónde                                                    |
| --- | ---------------------------- | --------------------- | -------------------------------------------------------- |
| 1   | Mercado Pago como medio fijo | `feat(payment)`       | `payment-methods.ts`, migración, selector de cobro       |
| 2   | Cierre del día               | `feat(cash)`          | `/caja/cierre`, `GET /api/cash/cierre`                   |
| 3   | Inicio por acciones y roles  | `ux(home)`            | `/`, `components/inicio/destino.ts`                      |
| 4   | Ticket térmico 58/80         | `feat(print)`         | `components/impresion/*`, Configuración                  |
| 5   | Consultar precio             | `feat(price-check)`   | `/consultar-precio`                                      |
| 6   | Menú y lenguaje              | `ux(navigation)`      | `shell/navigation.ts`, `Sidebar.tsx`, textos de UI       |
| 7   | Pruebas, e2e, capturas, docs | `test(commercial-v1)` | `tests/`, `e2e/comercial-v1.spec.ts`, `docs/screenshots` |

Nada se reescribió: la venta V3, la caja, el libro de stock, la bitácora, la
importación, los precios masivos, el fiado, los costos, las compras y los
permisos siguen como estaban. Todo lo nuevo reutiliza los servicios existentes.

## 1. Mercado Pago

Hasta ahora Mercado Pago se guardaba como `TRANSFER` con la referencia
"Mercado Pago". Ahora es un código propio, **fijo** (no hay medios
configurables): `MERCADO_PAGO`.

- Está en `MEDIOS_DE_PAGO`, `MEDIOS_COBRABLES`, `MEDIOS_DE_CAJA` y
  `MEDIOS_DE_COBRANZA`. **No** en `MEDIOS_DE_PAGO_A_PROVEEDOR`: a un proveedor
  se le sigue pagando con efectivo, transferencia, tarjeta u otro.
- Etiqueta "Mercado Pago". Tecla **M** en el cobro (E, D, R, T, M, F, O).
- **No mueve el efectivo**: `esEfectivo('MERCADO_PAGO') === false`. El esperado
  del turno sigue sumando solo `CASH`. Deja su movimiento de caja con su
  medio, como la transferencia, para que la comprobación de integridad
  "venta y caja" cierre medio por medio.
- Sirve en venta simple, pago combinado, cobro de fiado y reportes (el
  desglose por medio lo agrupa solo, sin cambios en las consultas).
- La forma vieja `paymentMethod: 'mercado_pago'` que mande un navegador sin
  actualizar ahora se guarda como `MERCADO_PAGO`.

### Migración `20260930120000_commercial_v1_mercado_pago`

Amplía tres `CHECK`: `SalePayment.method`, `CashRegisterMovement.paymentMethod`
y `CustomerPayment.method`. Aditiva (no agrega columnas ni cambia tipos),
compatible con el código anterior, con rollback documentado, y **no toca
ninguna fila**.

**Filas históricas `TRANSFER` + referencia "Mercado Pago": se dejan como
están.** Motivo: desde la Fase 3 cualquier cajero pudo escribir esa misma
referencia a mano en una transferencia común, y esa fila es indistinguible de
la migrada. Además, cada una tiene su movimiento de caja `TRANSFER` y su fila
de bitácora con los pagos tal como se guardaron; reescribirlas exigiría
reescribir la bitácora, que es inmutable por diseño. Regla aplicada: no se
adivina un dato a partir de una referencia ambigua. El reporte las sigue
mostrando como "Transferencia" con la referencia visible.

## 2. Cierre del día

`/caja/cierre`, desde el botón "Cierre del día" de la pantalla de Caja y desde
la tarjeta "Ventas" del Inicio. Exige `reports.cash.view` (dueño, admin,
encargado, supervisor, auditor; el cajero no).

Tres bloques, en el orden en que el dueño pregunta:

```
HOY                         MEDIOS DE PAGO              CAJA (solo efectivo)
Ventas          $ 485.400   Efectivo       $ 210.000    Caja inicial        $ 20.000
Operaciones            91   Transferencia  $ 105.000    + Ventas efectivo  $ 210.000
Ticket promedio             Mercado Pago   $ 120.000    + Ingresos           $ 8.000
Anuladas                    Débito          $ 30.000    − Egresos           $ 15.000
                            Crédito         $ 20.400    Debería haber      $ 223.000
                            Fiado (no es plata)         Contaste           $ 222.500
                                                        Diferencia            −$ 500
```

- **Todos los números vienen del servidor** (`cierreDelDia` en
  `modules/cash/service.cierre.ts`): ventas completadas del día y sus pagos
  agrupados por medio (mismo criterio que el reporte de ventas), y la cuenta del
  cajón a partir de los turnos de caja del día (`turnosDelDia`), que reutiliza
  el resumen de turno existente. El navegador no suma nada.
- "Ventas" suma todos los medios, incluido lo fiado (marcado como "no es plata
  que entró"). "Debería haber" es solo el efectivo: inicial + ventas en
  efectivo + ingresos − egresos. La pantalla lo dice en texto.
- "Contaste" y "Diferencia" aparecen cuando la caja se cerró. Con la caja
  abierta se avisa y se ofrece cerrarla.
- Avisos: sin caja hoy, caja abierta, **caja de otro día que sigue abierta**,
  varios turnos en el día (los números de CAJA son la suma; el detalle va por
  turno).
- Se puede mirar otro día con el selector de fecha (siempre en la zona de la
  sucursal).
- **[Imprimir cierre]**: el mismo cierre en el ancho del ticket, para dejar en
  el sobre con la plata.

## 3. Inicio

`¿Qué querés hacer?` con seis acciones grandes, solo las que el usuario puede
abrir: **Vender** (`sales.create`), **Caja** (`cash.view`), **Consultar
precio** (`products.view`), **Llegó mercadería** (`purchases.view`, abre por
ahora el módulo de compras existente), **Fiados** (`clients.view`), **Cambiar
precios** (`products.price.update`).

Después, HOY: Ventas (`reports.sales.view`), Cantidad de ventas
(`sales.view`), Ganancia estimada (`reports.costs.view`), Fiado pendiente
(`reports.clients.view`). Y los avisos: caja sin abrir, caja de ayer abierta,
poco stock, clientes sobre el límite. Sin gráficos.

Roles: **cajero y vendedor entran directo a Venta** (`destinoDeInicio`, en el
Inicio mismo; si escriben `/` a mano también los manda). Dueño y admin entran
al Inicio. Encargado y el resto entran al Inicio y ven lo que sus permisos les
dejan.

## 4. Ticket térmico

Comprobante interno de venta, **no fiscal**, y el papel lo dice en la última
línea ("Comprobante interno · No válido como factura").

- `window.print()` y `@media print`; sin drivers ni aplicación nativa. Lo que
  se imprime se dibuja en un portal `#impresion` al final del `body` y la hoja
  de estilos esconde todo lo demás (el armazón ocupa la pantalla con
  `overflow: hidden`, así que "imprimir la página" no servía).
- 58 mm (48 imprimibles) y 80 mm (72). Se elige en **Configuración →
  Impresión**, junto con el texto del pie. Se guarda en el navegador: la
  impresora es de la máquina, no del comercio.
- Contenido: comercio, fecha/hora, número de venta, cajero, líneas (cantidad,
  nombre, precio, subtotal), total, medios de pago, entregado y vuelto si hubo
  efectivo, cliente si corresponde, texto final.
- Se imprime **A)** al terminar una venta (botón "Imprimir ticket", tecla
  **I**) y **B)** desde el detalle de una venta del historial (reimpresión;
  una anulada sale con "ANULADA" arriba). Para B, el listado de ventas
  devuelve ahora `payments` y `client` (aditivo).

## 5. Consultar precio

`/consultar-precio`, con `products.view` (la usa el cajero). Un campo, un
resultado:

```
Coca Cola 2,25 L
$ 3.400
Stock: 14 u.
```

- Código (lector USB o a mano, solo dígitos): búsqueda exacta contra el índice
  de códigos, la misma que la caja.
- Nombre: coincidencias a medida que se escribe, Enter toma la primera.
- No está: "No está cargado" y, con `products.quickCreate`, **[Cargar
  producto]** con el alta rápida existente.
- Esc limpia y vuelve al campo. No agrega nada a ningún ticket.

## 6. Menú y lenguaje

```
INICIO
VENDER      Venta · Caja · Consultar precio
NEGOCIO     Productos · Llegó mercadería · Proveedores · Clientes y fiado
CONTROL     Stock · Reportes
SISTEMA     Usuarios · Configuración
MÁS ▸       Historial de ventas · Historial de stock · Recuento · Vencimientos ·
            Historial de cambios · Devoluciones a proveedores · Sucursales
```

"Más" arranca plegado y se despliega solo si la ruta actual está adentro.
Ninguna pantalla desapareció. "Vencimientos" y "Sucursales" se muestran por
permiso (`lots.view`, `branches.view`): el navegador no sabe cuántas sucursales
hay, así que "cuando haya más de una" queda para cuando la sesión lo diga.

Lenguaje (solo UI; nada de Prisma, tablas, API, servicios ni conceptos
internos):

| Antes               | Ahora                               |
| ------------------- | ----------------------------------- |
| Cuenta corriente    | Fiado (en clientes; proveedores no) |
| Arqueo              | Contar la plata / conteo            |
| Turno de caja       | Caja / Historial de caja            |
| Movimientos         | Historial de stock                  |
| Movimiento de stock | Ajustar stock                       |
| Inventario físico   | Recuento                            |
| Auditoría           | Historial de cambios                |
| Ganancia bruta      | Ganancia estimada                   |
| Markup              | Recargo sobre el costo              |
| Recepción           | Llegó mercadería                    |

## Pruebas

Corridas en este entorno (PostgreSQL 16 local, Node 22, Chromium
preinstalado) sobre el HEAD de la tanda. Ningún test se borró ni se saltó, y
ningún timeout se tocó.

| Suite                                                         | Resultado                            |
| ------------------------------------------------------------- | ------------------------------------ |
| `prettier --check`                                            | limpio                               |
| `eslint .`                                                    | limpio                               |
| `tsc --noEmit`                                                | limpio                               |
| `vitest tests/unit tests/ui`                                  | 52 archivos, 989 pruebas, 2 saltadas |
| `vitest tests/authorization`                                  | 6 archivos, 226 pruebas              |
| `vitest tests/integration tests/migrations tests/concurrency` | 46 archivos, 831 pruebas             |
| `playwright comercial-v1 navegacion caja-venta` (escritorio)  | 34 de 35 (ver fallos)                |
| `playwright movil` (375 px)                                   | 33 pruebas                           |
| `next build`                                                  | limpio                               |
| Capturas 375 / 390 / 768 / 1366                               | 24, sin scroll horizontal            |

Pruebas nuevas de esta tanda:

- `tests/integration/mercado-pago.test.ts`: vocabulario, venta simple, venta
  combinada (MP + efectivo, y tres medios), cobro de fiado por MP, reporte con
  MP y transferencia como renglones distintos.
- `tests/integration/cierre-del-dia.test.ts`: desglose por medio con fiado,
  efectivo esperado vs. ventas totales, anuladas, contado y diferencia al
  cerrar, dos turnos en el día, caja de otro día, permisos, fecha inválida.
- `tests/ui/inicio.test.tsx`: destino por rol (cajero → Venta), acciones por
  permiso, panel del dueño con HOY y avisos, repositor.
- `tests/ui/impresion.test.tsx`: ticket de venta (contenido, anulada, fiado,
  venta vieja sin pagos), cierre impreso, preferencias, área de impresión con
  `window.print` y `afterprint`.
- `tests/ui/consultar-precio.test.tsx`: lector, nombre, no cargado con y sin
  permiso, Esc.
- `tests/ui/etiquetas.test.tsx`, `permisos-visuales.test.tsx`,
  `anulacion.test.tsx`, `tests/migrations/chain.test.ts`: actualizadas.
- `e2e/comercial-v1.spec.ts`: 10 pruebas de punta a punta (Inicio por rol,
  menú, consultar precio, MP combinado + ticket, reimpresión, cierre del día
  con los números iguales a los del reporte, permiso del cajero).

Las capturas están en `docs/screenshots/commercial-v1/` (seis pantallas por
cuatro anchos) y se generan con `scripts/capturas-comercial-v1.ts` contra el
servidor de las e2e.

## Fallos conocidos

Clasificación: **A** regresión de este cambio · **B** flaky existente ·
**C** infraestructura/CI · **D** fallo real anterior.

- **C/D — `e2e/navegacion.spec.ts` › "8. un token VENCIDO"**: lee
  `JWT_SECRET` de `.env.local`, que no existe en este entorno (ni en CI; ya
  figuraba en `P0_PREVENTA.md` como fallo previo). No la toca esta tanda.
- **C — Playwright y el navegador**: la versión de Playwright del repo pide
  un Chromium (`chromium_headless_shell-1234`) distinto del preinstalado en
  este contenedor (`chromium-1194`). Se corrió con una configuración local no
  commiteada que apunta al ejecutable disponible. En CI `playwright install`
  lo resuelve.
- **A, corregidos antes del commit**: el importe de Ventas a tamaño de
  titular pisaba la columna Operaciones en el cierre a 1366 px; las acciones
  nuevas no tenían ícono. Las cuatro e2e nuevas que fallaron en la primera
  corrida eran errores de la prueba (permiso de alta rápida del cajero,
  carrera con `afterprint`, selector ambiguo, cookie Secure con
  `page.request`), no del producto.
- Ninguna prueba se marcó como saltada ni se cambió un timeout.

## Riesgos

- **Migración en producción.** Amplía tres `CHECK` con `DROP` + `ADD` del mismo
  nombre. Es rápida y no toca filas, pero toma un lock breve sobre las tres
  tablas: aplicarla con la caja cerrada. Rollback documentado en el archivo.
- **Históricos de Mercado Pago.** Las ventas anteriores siguen como
  "Transferencia · Mercado Pago". El primer cierre del día después del
  despliegue los muestra así; a partir de ahí, separado. Si el dueño quiere
  reinterpretarlos, es una decisión suya y una consulta manual, no automática.
- **Impresión.** Depende de que la térmica esté instalada en el sistema
  operativo y de que el navegador respete `@page { margin: 0 }`. Chrome lo
  hace; el diálogo de impresión aparece igual (no hay impresión "silenciosa"
  sin extensiones). En un teléfono, "imprimir" muestra la vista previa del
  sistema.
- **Inicio.** El cajero pierde el acceso al panel; su pantalla es Venta y lo
  suyo lo ve en Caja. Si un comercio quiere un cajero que mire el Inicio, se
  le da otro rol.
- **Menú.** Las pruebas e2e y los scripts de captura que nombraban entradas
  viejas se actualizaron; cualquier documento o captura anterior sigue con los
  nombres anteriores.
- **Nombre del comercio.** El ticket y el cierre usan `COMMERCE_NAME` (variable
  de entorno por instancia), no una columna: es lo que hay hoy. La columna
  `commerceName` es de la tanda del onboarding.

## Qué queda para la siguiente tanda

En orden sugerido:

1. **Llegó mercadería** (flujo rápido de recepción sin orden previa; hoy el
   botón abre compras).
2. **Onboarding** en menos de 30 minutos: asistente inicial, nombre del
   comercio en la base (`commerceName`), primer usuario, primeros productos.
3. **Provisioning** de instancias sin SSH manual (`nueva-instancia.sh`).
4. **Backup externo y monitoreo** mínimo con alerta.
5. Impresión automática opcional al cobrar (hoy es un botón / tecla I).
6. Lo excluido a propósito: descuentos, venta suspendida, devoluciones
   parciales, ARCA, offline, multi-sucursal real, promociones, IA.
