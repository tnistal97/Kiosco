# Kiosco

Sistema de gestión para kioscos y comercios minoristas: punto de venta, control de caja, stock por sucursal y auditoría de operaciones. Funciona como PWA, con lector de códigos de barras por cámara.

En producción corre en [kiosco.nistal.net](https://kiosco.nistal.net).

## Funcionalidades

- **Ventas** — carrito, escaneo de códigos de barras, registro de operaciones.
- **Caja** — apertura y cierre, movimientos, arqueos y conteos, saldo por sucursal.
- **Productos y stock** — catálogo con categorías y proveedores, stock por sucursal, verificaciones de stock.
- **Administración** — usuarios y roles, reporte de ventas, panel de control.
- **Auditoría** — bitácora de cambios por tabla, registro y origen de cada acción.
- **PWA** — service worker e instalación en dispositivos móviles.

## Tecnologías

| Área      | Stack                                             |
| --------- | ------------------------------------------------- |
| Framework | Next.js 15 (App Router) · React 19 · TypeScript 5 |
| Estilos   | Tailwind CSS 4 · Headless UI · Heroicons · Lucide |
| Datos     | Prisma 6 · PostgreSQL                             |
| Auth      | next-auth · JWT · bcrypt                          |
| Estado    | Zustand                                           |
| PWA       | next-pwa · Workbox                                |
| Escaneo   | @zxing/browser                                    |

## Requisitos

- Node.js 18.20 o superior (producción corre sobre 18.20.3)
- PostgreSQL 16
- npm (el proyecto usa `package-lock.json`; ver _Gestor de paquetes_)

## Instalación

```bash
npm install
```

Copiar la plantilla de variables y completarla:

```bash
cp .env.example .env.local
```

Generar el cliente de Prisma:

```bash
npx prisma generate
```

## Variables de entorno

Definidas en `.env.example`. Ninguna trae valores reales.

| Variable                                              | Descripción                                              |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `NODE_ENV`                                            | `development` o `production`                             |
| `PORT`                                                | Puerto de escucha (producción usa 3099)                  |
| `DATABASE_URL`                                        | Cadena de conexión PostgreSQL para Prisma                |
| `JWT_SECRET`                                          | Secreto de firma de tokens. Generar uno propio           |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Solo para `docker-compose` local                         |
| `OPENFOOD_DB_*`                                       | Solo para `tools/scrap.py`, sobre una base independiente |

## Desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

Alternativa con Docker (levanta PostgreSQL y la app):

```bash
docker compose up
```

## Build y ejecución

```bash
npm run build
npm start
```

## Base de datos

El esquema vive en `prisma/schema.prisma`.

> **Antes de aplicar migraciones, leer [`prisma/migrations/README.md`](prisma/migrations/README.md).** El historial contiene seis migraciones históricas más una baseline consolidada, y **no es aplicable en cadena de principio a fin**.

Comandos habituales:

```bash
npx prisma generate        # genera el cliente
npx prisma migrate status  # estado de migraciones (solo lectura)
npm run seed               # datos de prueba (prisma/seed.ts)
```

`scripts/` contiene inserciones puntuales de datos de ejemplo (usuarios, categorías, productos), previas al seed actual.

⚠️ Nunca correr `prisma migrate reset` ni `prisma db push` contra la base de producción.

## Gestor de paquetes

El proyecto usa **npm**. El `pnpm-lock.yaml` que existía quedó desactualizado (mayo 2025, frente a un `package.json` de diciembre 2025) y el `node_modules` de producción fue construido con npm; se eliminó para evitar ambigüedad. Detalle en [`RECOVERY.md`](RECOVERY.md).

## Despliegue

Producción corre con PM2 detrás de Nginx, que hace proxy inverso al puerto interno 3099 con TLS de Let's Encrypt.

`ecosystem.config.example.js` es la plantilla de PM2. Copiarla a `ecosystem.config.js` en el servidor y completar los valores — ese archivo está en `.gitignore` y **no debe versionarse con credenciales**.

```bash
npm ci
npm run build
pm2 start ecosystem.config.js
```

## Estructura

```
├── src/
│   ├── app/            # rutas (App Router)
│   │   ├── admin/      # panel de administración y auditoría
│   │   ├── api/        # route handlers
│   │   ├── caja/       # caja registradora
│   │   ├── control/    # panel de control
│   │   ├── productos/  # catálogo
│   │   ├── store/      # tienda
│   │   └── ventas/     # punto de venta
│   ├── components/     # componentes de UI
│   ├── hooks/          # hooks de React
│   ├── lib/            # utilidades y cliente Prisma
│   ├── store/          # estado global (Zustand)
│   └── types/          # tipos compartidos
├── prisma/             # esquema, migraciones y seed
├── public/             # estáticos, manifest y service worker
├── scripts/            # inserciones de datos de ejemplo
├── tools/              # utilidades auxiliares (scraper OpenFoodFacts)
├── middleware.ts       # middleware de autenticación
└── docker-compose.yml  # entorno local
```
