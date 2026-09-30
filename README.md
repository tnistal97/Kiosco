# Kiosco

Sistema de gestión para un almacén de barrio: punto de venta, control de caja,
stock por sucursal y auditoría de operaciones. Funciona como PWA, con lector de
códigos de barras por cámara y por lector USB.

> **Estado al 30 de septiembre de 2026**
>
> - **En línea:** la rama `release/almacen-v1`, puesta en marcha el 3 de
>   septiembre de 2026. Qué corre, dónde y cómo se opera está en
>   [docs/DEPLOY_LUCHANDOPORMAS.md](docs/DEPLOY_LUCHANDOPORMAS.md).
> - **En `feat/ux-v2-phase2-1-lista-navegacion`, sin desplegar:** la nueva
>   experiencia de caja y venta (UX V2 y V3) y la preventa **P0**: contraseñas
>   desde la aplicación, alta de una instancia nueva, importación de productos
>   desde Excel o CSV y cambio masivo de precios. El informe está en
>   [docs/P0_PREVENTA.md](docs/P0_PREVENTA.md).
> - **Propuesto, esperando aprobación:** UX V4, la simplificación para
>   almacenes. Ver
>   [docs/UX_V4_ALMACENES_PROPUESTA.md](docs/UX_V4_ALMACENES_PROPUESTA.md).
>
> El diagnóstico del servidor anterior, y los bloqueantes que impidieron
> encenderlo, siguen escritos en
> [docs/PRODUCTION_CURRENT_STATE.md](docs/PRODUCTION_CURRENT_STATE.md) y
> [docs/PRODUCTION_CUTOVER.md](docs/PRODUCTION_CUTOVER.md).

## Funcionalidades

- **Ventas** — carrito, escaneo de códigos de barras, venta transaccional con
  precio tomado del catálogo.
- **Anulación** — lógica, con motivo obligatorio, restitución de stock y
  contramovimiento de caja. Nunca se borra una venta.
- **Caja** — turnos con apertura y cierre, movimientos, arqueos y diferencia
  calculada por el servidor.
- **Pagos** — uno o varios por venta, con vuelto. Solo el efectivo mueve el
  cajón: $20.000 por transferencia más $10.000 en efectivo suben la caja
  $10.000.
- **Productos y stock** — catálogo con categorías y proveedores, venta por
  unidad, por peso y por volumen, varios códigos de barras por producto,
  mínimo de reposición y alertas de agotado y bajo mínimo.
- **Alta rápida desde la caja** — un código que no está en el catálogo deja de
  frenar la venta: se da de alta con seis campos, entra al ticket y el foco
  vuelve al lector. El stock inicial pasa por el libro de inventario, no por un
  `UPDATE`. Ver [POS_QUICK_PRODUCT_CREATE.md](docs/POS_QUICK_PRODUCT_CREATE.md).
- **Importación y precios masivos** — el catálogo se carga desde un Excel o un
  CSV, con vista previa fila por fila, todo o nada y el stock por el libro; los
  precios se cambian en masa, con redondeo, confirmación y deshacer. Ver
  [IMPORTACION_Y_PRECIOS.md](docs/IMPORTACION_Y_PRECIOS.md).
- **Stock vendible en la caja** — con partidas vencidas, la pantalla separa lo
  que hay de lo que se puede vender: `Stock 22 · Vendible 10 · Vencido 12`. El
  ticket se corta en lo vendible en vez de que el rechazo aparezca al cobrar. El
  número del navegador es ayuda: el cobro lo recalcula igual.
- **Compras** — proveedores, órdenes de compra con estados, y recepción total
  o parcial. Lo que llega entra al stock convertido a la unidad de venta —5
  cajas de 8 son 40 botellas— y actualiza el costo del producto.
- **Cuentas por pagar** — la deuda nace de la entrega, con su vencimiento. Pagos
  en efectivo, transferencia o tarjeta, imputados a obligaciones concretas.
  **Anticipos** que se aplican después, y **devoluciones** que sacan la
  mercadería del depósito y acreditan su costo original.
- **Lotes y vencimientos** — un producto puede seguirse por partida, con o sin
  fecha, y las dos cosas se deciden por separado: la lavandina necesita número
  de partida para poder retirarla y no tiene vencimiento que inventar. La venta
  sale por **FEFO** —primero lo que vence antes—, lo vencido deja de ser
  vendible sin dejar de ocupar stock, y la anulación devuelve a la misma
  partida de la que salió.
- **Inventario físico** — contar el depósito **sin cerrar el local**: lo que el
  sistema espera se lee en el momento de contar, no al empezar, así que una
  venta durante el recorrido no ensucia la diferencia. Conteo a ciegas,
  revisión antes de tocar nada, y aplicación **por diferencia**: si después de
  contar se vendió una unidad más, el ajuste la respeta en vez de borrarla.
- **Libro de inventario** — cada venta, anulación y ajuste deja un movimiento
  con el saldo anterior, el resultante y —desde la Fase 4D— de qué partida
  salió. No se edita ni se borra: los errores se corrigen con otro movimiento.
- **Administración** — usuarios y roles, reporte de ventas.
- **Contraseñas desde la aplicación** — cada usuario cambia la suya en
  Configuración, y quien administra usuarios resetea la de otro con una
  temporal que se muestra una sola vez. Las dos cosas cierran las sesiones
  abiertas y quedan en la bitácora, sin la clave. Ya no hace falta entrar al
  servidor. Ver [P0_PREVENTA.md](docs/P0_PREVENTA.md).
- **Auditoría** — bitácora de cada operación, con usuario, sucursal, motivo,
  identificador de petición y resultado.

## Tecnologías

| Área      | Stack                                             |
| --------- | ------------------------------------------------- |
| Framework | Next.js 15 (App Router) · React 19 · TypeScript 5 |
| Estilos   | Tailwind CSS 4 · Headless UI · Heroicons          |
| Datos     | Prisma 6 · PostgreSQL 16                          |
| Sesiones  | `jose` (JWT en cookie HttpOnly) · bcrypt          |
| Estado    | Zustand                                           |
| PWA       | Serwist (`@serwist/next`)                         |
| Escaneo   | @zxing/browser                                    |
| Calidad   | ESLint 9 · Prettier 3 · Vitest 4                  |

## Requisitos

- **Node.js 20.19 o superior** (hasta la 24). La integración continua valida
  con 20.19 y el servidor en línea usa la 22.
- PostgreSQL 16
- npm (el proyecto usa `package-lock.json`)

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # completar los valores
npx prisma generate
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

Para levantar PostgreSQL sin tocar el del sistema, ver
[docs/DEV_ENVIRONMENT.md](docs/DEV_ENVIRONMENT.md).

### Base de datos nueva

```bash
npx prisma migrate deploy
```

La cadena se aplica de principio a fin. Antes no: hacía falta un
`migrate resolve --applied` por cada una de las seis migraciones históricas.
Ver [prisma/migrations/README.md](prisma/migrations/README.md).

## Variables de entorno

Definidas en `.env.example`. Ninguna trae valores reales.

| Variable                                              | Descripción                                              |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                                        | Cadena de conexión PostgreSQL                            |
| `JWT_SECRET`                                          | Secreto de firma de sesiones. **Mínimo 32 caracteres**   |
| `NODE_ENV`                                            | `development` o `production`                             |
| `PORT`                                                | Puerto de escucha (producción usa 3099)                  |
| `COMMERCE_NAME`                                       | Nombre del comercio. Se lee al atender, sin recompilar   |
| `KIOSCO_HOSTS`                                        | Dominios por los que se entra, separados por coma        |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Solo para `docker-compose` local                         |
| `OPENFOOD_DB_*`                                       | Solo para `tools/scrap.py`, sobre una base independiente |

> La aplicación **se niega a arrancar** si `JWT_SECRET` tiene menos de 32
> caracteres. Es deliberado: un secreto corto produce tokens falsificables, y
> es preferible un fallo ruidoso al arrancar que una sesión falsificable en
> silencio. Generar uno con `openssl rand -base64 48`.

## Comandos

| Comando                      | Qué hace                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `npm run dev`                | Servidor de desarrollo                                       |
| `npm run build`              | Construcción de producción                                   |
| `npm start`                  | Servir la construcción                                       |
| `npm run lint`               | ESLint. Sin asistentes, apto para CI                         |
| `npm run lint:fix`           | ESLint corrigiendo lo corregible                             |
| `npm run format`             | Prettier sobre todo el proyecto                              |
| `npm run format:check`       | Prettier en modo comprobación                                |
| `npm run typecheck`          | `tsc --noEmit`                                               |
| `npm test`                   | Toda la suite unitaria y de integración                      |
| `npm run test:coverage`      | Pruebas con informe de cobertura                             |
| `npm run test:unit`          | Solo unitarias                                               |
| `npm run test:integration`   | Solo de integración                                          |
| `npm run test:authorization` | Solo de autorización                                         |
| `npm run test:concurrency`   | Solo de concurrencia                                         |
| `npm run test:migrations`    | Solo la cadena de migraciones                                |
| `npm run test:performance`   | Solo consultas y tamaño de respuesta                         |
| `npm run alta:instancia`     | Alta de una instancia nueva. Ver `docs/ALTA_DE_INSTANCIA.md` |
| `npm run seed`               | **Retirado:** explica qué usar y sale con error              |
| `npm run seed:demo`          | Datos de demostración (solo bases `_dev`)                    |
| `npm run integrity:check`    | **Comprueba que el sistema cierre.** Solo lectura            |
| `npm run reconcile`          | El mismo comando, con el otro nombre                         |
| `npm run rehearsal`          | Ensayo de migración: respaldar, migrar y **restaurar**       |
| `npm run rehearsal:prodlike` | El mismo ensayo, con la **forma y el volumen de producción** |
| `npm run release:artifact`   | Construye, empaqueta y calcula el **SHA-256** del artefacto  |
| `npm run smoke:staging`      | Smoke completo contra staging. **Escribe**                   |
| `npm run smoke:production`   | Smoke **de solo lectura**. No crea ventas ni mueve stock     |

Las pruebas **abortan** si `DATABASE_URL` no apunta a una base cuyo nombre
termine en `_test`. Nunca corren contra desarrollo ni contra producción.

`npm run plantilla:productos` regenera `public/productos-ejemplo.xlsx`, la
plantilla que se descarga desde Productos → Importar.

## Cómo está organizado

```
src/
├── app/
│   ├── api/            route handlers. Delgados: autenticar, permiso,
│   │                   validar, llamar al servicio, responder
│   ├── (inicio)/       tablero de entrada
│   ├── venta/          punto de venta
│   ├── caja/           apertura, cierre y movimientos de caja
│   ├── ventas/         ventas registradas y anulaciones
│   ├── productos/      catálogo, importación y precios masivos
│   ├── stock/          existencias, movimientos y lotes
│   ├── inventarios/    inventario físico
│   ├── compras/        órdenes de compra y recepciones
│   ├── proveedores/    proveedores y cuentas por pagar
│   ├── devoluciones/   devoluciones a proveedores
│   ├── clientes/       clientes y cuenta corriente
│   ├── comprobantes/   comprobantes de cobro y de pago
│   ├── reportes/       reportes
│   ├── auditoria/      bitácora
│   └── usuarios/ · sucursales/ · configuracion/
├── modules/            un directorio por dominio
│   └── <dominio>/
│       ├── schemas.ts  validación de entrada (Zod)
│       ├── service.ts  reglas de negocio
│       └── dto.ts      forma de los datos en la API + lectura en el cliente
├── server/
│   ├── auth/           sesión, token, límite de intentos
│   ├── authz/          catálogo de permisos y comprobaciones
│   ├── http/           handler, errores, paginación, validación, requestId
│   ├── audit/          registro de auditoría
│   └── pwa/            política de caché
├── components/         componentes de interfaz
├── hooks/              hooks de React
├── lib/                cliente HTTP del navegador, cliente Prisma, utilidades
└── middleware.ts       redirección al login. TIENE que estar en src/
```

**El middleware va en `src/middleware.ts`.** Con un directorio `src/`, Next
solo reconoce esa ubicación. En la raíz se excluye del paquete sin dar ningún
error: compila, no falla, y sencillamente no se ejecuta. Así estuvo durante
meses. Hay una prueba y un paso de CI que lo comprueban.

## Reglas del código

Cuatro, y las cuatro tienen una razón concreta detrás:

1. **El navegador no decide nada que cueste dinero.** Precio, total, descuento,
   sucursal, identidad del cajero y saldo de caja salen siempre del servidor.
   Los esquemas ni siquiera declaran esos campos, así que mandarlos hace
   fallar la petición.
2. **Las rutas preguntan por permiso, nunca por nombre de rol.** Ver
   [docs/PERMISSIONS_MATRIX.md](docs/PERMISSIONS_MATRIX.md).
3. **Nada financiero se borra.** Las anulaciones son lógicas y dejan rastro.
4. **Cada operación relevante se audita**, con usuario, sucursal, motivo,
   estado anterior y posterior.

## Documentación

| Documento                                                                   | Para qué                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| [DEV_ENVIRONMENT.md](docs/DEV_ENVIRONMENT.md)                               | Levantar el entorno sin tocar producción             |
| [ARCHITECTURE_PROPOSAL.md](docs/ARCHITECTURE_PROPOSAL.md)                   | Hacia dónde va el esquema y por qué                  |
| [QUALITY_STRATEGY.md](docs/QUALITY_STRATEGY.md)                             | Herramientas, umbrales y decisiones de calidad       |
| [PERMISSIONS_MATRIX.md](docs/PERMISSIONS_MATRIX.md)                         | Qué puede hacer cada rol y qué prueba lo cubre       |
| [INVENTORY_LEDGER.md](docs/INVENTORY_LEDGER.md)                             | Cómo se mueve el stock y por qué no se edita         |
| [CASH_SHIFT_MODEL.md](docs/CASH_SHIFT_MODEL.md)                             | Turnos de caja: qué se deriva y qué se guarda        |
| [PHASE3_ARCHITECTURE.md](docs/PHASE3_ARCHITECTURE.md)                       | **Índice de la Fase 3**: cómo encaja todo            |
| [PHASE3_MONEY_MIGRATION.md](docs/PHASE3_MONEY_MIGRATION.md)                 | Por qué el dinero es Decimal y cómo se migró         |
| [PHASE3_QUANTITY_MIGRATION.md](docs/PHASE3_QUANTITY_MIGRATION.md)           | Por qué las cantidades son Decimal y qué unidad      |
| [PHASE3_BARCODES.md](docs/PHASE3_BARCODES.md)                               | Varios códigos por producto, y cómo se migró         |
| [SUPPLIER_MODEL.md](docs/SUPPLIER_MODEL.md)                                 | Qué sabe el sistema de un proveedor, y qué no        |
| [PURCHASE_FLOW.md](docs/PURCHASE_FLOW.md)                                   | Orden de compra: estados, numeración, unidades       |
| [PURCHASE_RECEIVING.md](docs/PURCHASE_RECEIVING.md)                         | Recepción, política de costo e inmutabilidad         |
| [TIMEZONE_POLICY.md](docs/TIMEZONE_POLICY.md)                               | El día comercial: por qué IANA y no `UTC-3`          |
| [CUSTOMER_MODEL.md](docs/CUSTOMER_MODEL.md)                                 | Qué sabe el sistema de un cliente, y qué no          |
| [CUSTOMER_ACCOUNT_LEDGER.md](docs/CUSTOMER_ACCOUNT_LEDGER.md)               | El libro de cuenta corriente y sus invariantes       |
| [CREDIT_POLICY.md](docs/CREDIT_POLICY.md)                                   | Límite, autorización y fiado cortado                 |
| [CUSTOMER_PAYMENT_FLOW.md](docs/CUSTOMER_PAYMENT_FLOW.md)                   | Cobrar, el comprobante y el ajuste manual            |
| [SUPPLIER_ACCOUNT_LEDGER.md](docs/SUPPLIER_ACCOUNT_LEDGER.md)               | El libro de cuentas por pagar y sus invariantes      |
| [ACCOUNTS_PAYABLE_POLICY.md](docs/ACCOUNTS_PAYABLE_POLICY.md)               | De dónde nace la deuda, vencimientos y estados       |
| [SUPPLIER_PAYMENT_FLOW.md](docs/SUPPLIER_PAYMENT_FLOW.md)                   | Pagar a un proveedor, la caja y el comprobante       |
| [SUPPLIER_PAYMENT_ALLOCATION.md](docs/SUPPLIER_PAYMENT_ALLOCATION.md)       | Qué obligación cancela cada peso de un pago          |
| [SUPPLIER_ADVANCES.md](docs/SUPPLIER_ADVANCES.md)                           | Anticipos e imputación diferida                      |
| [PURCHASE_RETURN_FLOW.md](docs/PURCHASE_RETURN_FLOW.md)                     | Devolver mercadería: estados, topes y stock          |
| [PURCHASE_RETURN_ACCOUNTING.md](docs/PURCHASE_RETURN_ACCOUNTING.md)         | Qué le hace una devolución a la cuenta del proveedor |
| [LOT_TRACKING_DESIGN.md](docs/LOT_TRACKING_DESIGN.md)                       | Los tres modelos de lote, y por qué se eligió éste   |
| [LOT_EXPIRATION_POLICY.md](docs/LOT_EXPIRATION_POLICY.md)                   | Vencimientos: fecha de calendario, no instante       |
| [FEFO_POLICY.md](docs/FEFO_POLICY.md)                                       | Por qué FEFO y no FIFO, y qué NO garantiza           |
| [PHYSICAL_INVENTORY.md](docs/PHYSICAL_INVENTORY.md)                         | Contar el depósito: estados, conteo ciego, delta     |
| [INVENTORY_COUNT_CONCURRENCY.md](docs/INVENTORY_COUNT_CONCURRENCY.md)       | Contar mientras se vende, y dos inventarios a la vez |
| [PHASE3_RECONCILIATION.md](docs/PHASE3_RECONCILIATION.md)                   | Las invariantes que demuestran que el sistema cierra |
| [INTEGRITY_CHECK.md](docs/INTEGRITY_CHECK.md)                               | Cómo se corre y cómo se lee la comprobación          |
| [REPORTING_MODEL.md](docs/REPORTING_MODEL.md)                               | Qué calcula cada reporte y con qué costo             |
| [PRODUCTION_MIGRATION_REHEARSAL.md](docs/PRODUCTION_MIGRATION_REHEARSAL.md) | Respaldar **y restaurar** antes de migrar            |
| [DATABASE_MIGRATION_STRATEGY.md](docs/DATABASE_MIGRATION_STRATEGY.md)       | Cómo aplicar migraciones sin romper el servidor      |
| [DEPENDENCY_SECURITY.md](docs/DEPENDENCY_SECURITY.md)                       | Qué avisos hubo y cómo se cerraron                   |
| [PHASE0_DECISIONS.md](docs/PHASE0_DECISIONS.md)                             | Qué quedó a medio camino a propósito, y por qué      |
| [SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)                                 | Las vulnerabilidades encontradas                     |
| [MASTER_ROADMAP.md](docs/MASTER_ROADMAP.md)                                 | El plan por fases                                    |

### Preproducción (Fase 5A)

| Documento                                                                   | Qué contesta                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [RELEASE_INVENTORY.md](docs/RELEASE_INVENTORY.md)                           | Qué compone la release, hasta el último índice             |
| [PRODUCTION_CURRENT_STATE.md](docs/PRODUCTION_CURRENT_STATE.md)             | Qué había en el servidor anterior, medido en solo lectura  |
| [PRODUCTION_DATA_PRECHECK.md](docs/PRODUCTION_DATA_PRECHECK.md)             | Si los datos reales sobreviven a la migración              |
| [MIGRATION_COMPATIBILITY_MATRIX.md](docs/MIGRATION_COMPATIBILITY_MATRIX.md) | Después de cada migración, ¿alcanza con volver el código?  |
| [PRODUCTION_BACKUP_PLAN.md](docs/PRODUCTION_BACKUP_PLAN.md)                 | Cómo respaldar y, sobre todo, cómo **restaurar**           |
| [SECRET_ROTATION_PLAN.md](docs/SECRET_ROTATION_PLAN.md)                     | Qué secretos rotar, en qué orden y con qué consecuencia    |
| [DANGEROUS_ACTIONS_MATRIX.md](docs/DANGEROUS_ACTIONS_MATRIX.md)             | Qué se puede deshacer y qué no                             |
| [STAGING_RUNBOOK.md](docs/STAGING_RUNBOOK.md)                               | Cómo montar staging sin tocar producción                   |
| [PRODUCTION_CUTOVER.md](docs/PRODUCTION_CUTOVER.md)                         | El encendido, paso a paso, con puntos de decisión          |
| [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)                         | GO/NO-GO, qué mirar después y cómo diagnosticar            |
| [POS_QUICK_PRODUCT_CREATE.md](docs/POS_QUICK_PRODUCT_CREATE.md)             | Alta rápida desde la caja: permiso, flujo y concurrencia   |
| [BARCODE_BRANCH_ARCHITECTURE.md](docs/BARCODE_BRANCH_ARCHITECTURE.md)       | Código de barras y sucursales: modelo, opciones y decisión |
| [PERFORMANCE_BASELINE.md](docs/PERFORMANCE_BASELINE.md)                     | Línea base de rendimiento, medida y con su método          |

### Preventa (P0) y despliegue en línea

| Documento                                                 | Qué contesta                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| [P0_PREVENTA.md](docs/P0_PREVENTA.md)                     | Qué se hizo para poder vender el sistema, cómo se probó y qué falta |
| [ALTA_DE_INSTANCIA.md](docs/ALTA_DE_INSTANCIA.md)         | Dar de alta un comercio nuevo sin borrar nada                       |
| [IMPORTACION_Y_PRECIOS.md](docs/IMPORTACION_Y_PRECIOS.md) | Importar productos y cambiar precios en masa, con su volumen medido |
| [DEPLOY_LUCHANDOPORMAS.md](docs/DEPLOY_LUCHANDOPORMAS.md) | El despliegue que está en línea: qué corre, dónde y cómo se opera   |

### Experiencia de uso

De la más nueva a la más vieja. Las propuestas se escriben antes de tocar
código y se aprueban; los informes de implementación dicen qué se hizo y qué se
midió.

| Documento                                                                                   | Qué contesta                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [UX_V4_ALMACENES_PROPUESTA.md](docs/UX_V4_ALMACENES_PROPUESTA.md)                           | UX V4, simplificación para almacenes. **Propuesta, sin aprobar** |
| [UX_V3_VENTA_IMPLEMENTACION.md](docs/UX_V3_VENTA_IMPLEMENTACION.md)                         | UX V3 de la venta: lo que se hizo y lo que se midió              |
| [UX_V3_VENTA_PROPUESTA.md](docs/UX_V3_VENTA_PROPUESTA.md)                                   | UX V3 de la venta: la propuesta, con sus mediciones              |
| [UX_V2_PHASE2_1_LIST_SESSION_NAVIGATION.md](docs/UX_V2_PHASE2_1_LIST_SESSION_NAVIGATION.md) | UX V2, fase 2.1: lista de productos, sesión y navegación         |
| [UX_V2_PHASE2_CAJA_VENTA.md](docs/UX_V2_PHASE2_CAJA_VENTA.md)                               | UX V2, fase 2: caja, venta, apertura y cierre                    |
| [UX_V2_PHASE1_IMPLEMENTATION.md](docs/UX_V2_PHASE1_IMPLEMENTATION.md)                       | UX V2, fase 1: fundaciones visuales, caja, cobro y teclado       |
| [UX_V2_MANUAL_UAT.md](docs/UX_V2_MANUAL_UAT.md)                                             | La prueba manual con una persona que nunca vio el sistema        |
| [UX_PRODUCT_AUDIT_MASTERPLAN.md](docs/UX_PRODUCT_AUDIT_MASTERPLAN.md)                       | La auditoría de producto y de uso que dio origen a UX V2         |
| [PHASE2_VISUAL_REPORT.md](docs/PHASE2_VISUAL_REPORT.md)                                     | Fase 2: antes y después, con capturas                            |
| [PHASE2_UI_BASELINE.md](docs/PHASE2_UI_BASELINE.md)                                         | El estado visual antes de la Fase 2                              |
| [UI_REDESIGN_PROPOSAL.md](docs/UI_REDESIGN_PROPOSAL.md)                                     | La propuesta de interfaz de la Fase 2                            |
| [UI_UX_AUDIT.md](docs/UI_UX_AUDIT.md)                                                       | La primera auditoría de interfaz, con mediciones del DOM         |
| [CURRENT_SYSTEM_AUDIT.md](docs/CURRENT_SYSTEM_AUDIT.md)                                     | El mapa del código recuperado de producción (agosto de 2026)     |

## Despliegue

**El despliegue que está en línea** es el de
[docs/DEPLOY_LUCHANDOPORMAS.md](docs/DEPLOY_LUCHANDOPORMAS.md): systemd, Node 22
y Nginx delante, con sus comandos para publicar una versión, volver atrás y
restaurar un respaldo. Lo que sigue es el procedimiento por artefacto de la
Fase 5A, escrito para el servidor anterior (PM2, Node 18), y se conserva como
referencia.

En aquel servidor la aplicación corría con PM2 detrás de Nginx, que hacía de
proxy inverso al puerto interno 3099 con TLS de Let's Encrypt.

**Desde la Fase 5A el despliegue es por artefacto**, no por `git pull`. Se
construye una vez, se calcula su SHA-256 y se despliega **ese**: construir en el
servidor mete tres variables que nadie controla durante el corte —la red, el
runtime (el servidor tiene Node 18 y la suite se valida con 20) y la falta de un
hash con que contestar «¿esto que corre es lo que aprobamos?»—.

```bash
npm run release:artifact          # en la máquina de desarrollo
# copiar dist/kiosco-<version>-<commit>.tar.gz* al servidor
sha256sum -c kiosco-<version>-<commit>.tar.gz.sha256
```

El procedimiento completo, con sus seis puntos de decisión, está en
[docs/PRODUCTION_CUTOVER.md](docs/PRODUCTION_CUTOVER.md).

`ecosystem.config.example.js` es la plantilla de PM2. Copiarla a
`ecosystem.config.js` en el servidor y completar los valores — ese archivo está
en `.gitignore` y **no debe versionarse con credenciales**.

```bash
npm ci
npx prisma generate
npm run build
pm2 start ecosystem.config.js
```

Antes de eso, leer la lista de pasos previos en
[docs/DATABASE_MIGRATION_STRATEGY.md](docs/DATABASE_MIGRATION_STRATEGY.md).

⚠️ Nunca correr `prisma migrate reset` ni `prisma db push` contra producción.
