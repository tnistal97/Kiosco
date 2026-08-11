# Kiosco

Sistema de gestión para un almacén de barrio: punto de venta, control de caja,
stock por sucursal y auditoría de operaciones. Funciona como PWA, con lector de
códigos de barras por cámara y por lector USB.

> **El sitio está fuera de línea, y se midió por qué.** El proceso de PM2 figura
> `stopped`, nada escucha en el puerto y el dominio devuelve 502. Los logs se
> cortan en febrero de 2026: la aplicación dejó de arrancar cuando el rol de
> PostgreSQL perdió los privilegios sobre las tablas.
>
> La release candidate **`1.0.0-rc.1`** está lista en `release/almacen-v1`, con
> su artefacto y su checksum, pero el despliegue es **NO-GO** por tres
> bloqueantes que no son de código y que requieren escribir en el servidor:
>
> 1. la contraseña de PostgreSQL estuvo en un repositorio público quince meses;
> 2. `JWT_SECRET` tiene 9 caracteres —el mínimo es 32— y el login fallaría;
> 3. el rol de la aplicación no puede crear objetos, así que `migrate deploy`
>    falla en la primera migración.
>
> Todo está medido y escrito en
> [docs/PRODUCTION_CURRENT_STATE.md](docs/PRODUCTION_CURRENT_STATE.md) y el
> procedimiento en
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
| PWA       | next-pwa · Workbox                                |
| Escaneo   | @zxing/browser                                    |
| Calidad   | ESLint 9 · Prettier 3 · Vitest 4                  |

## Requisitos

- **Node.js 20.19 o superior.** Producción corría sobre 18.20, que ya no
  recibe soporte; hay que actualizarlo antes del próximo despliegue.
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
| `npm run seed`               | Datos de prueba                                              |
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

## Cómo está organizado

```
src/
├── app/
│   ├── api/            route handlers. Delgados: autenticar, permiso,
│   │                   validar, llamar al servicio, responder
│   ├── caja/           punto de venta
│   ├── productos/      catálogo
│   ├── ventas/         movimientos de caja
│   └── admin/          reportes y auditoría
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

| Documento                                                                   | Qué contesta                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------- |
| [RELEASE_INVENTORY.md](docs/RELEASE_INVENTORY.md)                           | Qué compone la release, hasta el último índice            |
| [PRODUCTION_CURRENT_STATE.md](docs/PRODUCTION_CURRENT_STATE.md)             | Qué hay **hoy** en el servidor, medido en solo lectura    |
| [PRODUCTION_DATA_PRECHECK.md](docs/PRODUCTION_DATA_PRECHECK.md)             | Si los datos reales sobreviven a la migración             |
| [MIGRATION_COMPATIBILITY_MATRIX.md](docs/MIGRATION_COMPATIBILITY_MATRIX.md) | Después de cada migración, ¿alcanza con volver el código? |
| [PRODUCTION_BACKUP_PLAN.md](docs/PRODUCTION_BACKUP_PLAN.md)                 | Cómo respaldar y, sobre todo, cómo **restaurar**          |
| [SECRET_ROTATION_PLAN.md](docs/SECRET_ROTATION_PLAN.md)                     | Qué secretos rotar, en qué orden y con qué consecuencia   |
| [DANGEROUS_ACTIONS_MATRIX.md](docs/DANGEROUS_ACTIONS_MATRIX.md)             | Qué se puede deshacer y qué no                            |
| [STAGING_RUNBOOK.md](docs/STAGING_RUNBOOK.md)                               | Cómo montar staging sin tocar producción                  |
| [PRODUCTION_CUTOVER.md](docs/PRODUCTION_CUTOVER.md)                         | El encendido, paso a paso, con puntos de decisión         |
| [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)                         | GO/NO-GO, qué mirar después y cómo diagnosticar           |

## Despliegue

Producción corre con PM2 detrás de Nginx, que hace proxy inverso al puerto
interno 3099 con TLS de Let's Encrypt.

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
