# Kiosco

Sistema de gestión para un almacén de barrio: punto de venta, control de caja,
stock por sucursal y auditoría de operaciones. Funciona como PWA, con lector de
códigos de barras por cámara y por lector USB.

> **El sitio está fuera de línea.** La versión en producción tiene once
> vulnerabilidades corregidas en la rama de trabajo pero **todavía no
> desplegadas**. Antes de volver a levantarlo hay que rotar `JWT_SECRET` y la
> contraseña de PostgreSQL, y aplicar las migraciones. Ver
> [docs/DATABASE_MIGRATION_STRATEGY.md](docs/DATABASE_MIGRATION_STRATEGY.md).

## Funcionalidades

- **Ventas** — carrito, escaneo de códigos de barras, venta transaccional con
  precio tomado del catálogo.
- **Anulación** — lógica, con motivo obligatorio, restitución de stock y
  contramovimiento de caja. Nunca se borra una venta.
- **Caja** — movimientos, arqueos, saldo por sucursal.
- **Productos y stock** — catálogo con categorías y proveedores, ajustes de
  inventario con motivo y auditoría.
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

| Comando                      | Qué hace                             |
| ---------------------------- | ------------------------------------ |
| `npm run dev`                | Servidor de desarrollo               |
| `npm run build`              | Construcción de producción           |
| `npm start`                  | Servir la construcción               |
| `npm run lint`               | ESLint. Sin asistentes, apto para CI |
| `npm run lint:fix`           | ESLint corrigiendo lo corregible     |
| `npm run format`             | Prettier sobre todo el proyecto      |
| `npm run format:check`       | Prettier en modo comprobación        |
| `npm run typecheck`          | `tsc --noEmit`                       |
| `npm test`                   | Las 354 pruebas                      |
| `npm run test:coverage`      | Pruebas con informe de cobertura     |
| `npm run test:unit`          | Solo unitarias                       |
| `npm run test:integration`   | Solo de integración                  |
| `npm run test:authorization` | Solo de autorización                 |
| `npm run test:concurrency`   | Solo de concurrencia                 |
| `npm run test:migrations`    | Solo la cadena de migraciones        |
| `npm run test:performance`   | Solo consultas y tamaño de respuesta |
| `npm run seed`               | Datos de prueba                      |

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

| Documento                                                             | Para qué                                        |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| [DEV_ENVIRONMENT.md](docs/DEV_ENVIRONMENT.md)                         | Levantar el entorno sin tocar producción        |
| [ARCHITECTURE_PROPOSAL.md](docs/ARCHITECTURE_PROPOSAL.md)             | Hacia dónde va el esquema y por qué             |
| [QUALITY_STRATEGY.md](docs/QUALITY_STRATEGY.md)                       | Herramientas, umbrales y decisiones de calidad  |
| [PERMISSIONS_MATRIX.md](docs/PERMISSIONS_MATRIX.md)                   | Qué puede hacer cada rol y qué prueba lo cubre  |
| [DATABASE_MIGRATION_STRATEGY.md](docs/DATABASE_MIGRATION_STRATEGY.md) | Cómo aplicar migraciones sin romper el servidor |
| [DEPENDENCY_SECURITY.md](docs/DEPENDENCY_SECURITY.md)                 | Qué avisos hubo y cómo se cerraron              |
| [PHASE0_DECISIONS.md](docs/PHASE0_DECISIONS.md)                       | Qué quedó a medio camino a propósito, y por qué |
| [SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)                           | Las vulnerabilidades encontradas                |
| [MASTER_ROADMAP.md](docs/MASTER_ROADMAP.md)                           | El plan por fases                               |

## Despliegue

Producción corre con PM2 detrás de Nginx, que hace proxy inverso al puerto
interno 3099 con TLS de Let's Encrypt.

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
