# Recuperación del código de producción — 6 de agosto de 2026

Este repositorio fue reemplazado con el código realmente desplegado en `kiosco.nistal.net`. La versión anterior estaba desactualizada unos seis meses y quedaba anidada en un subdirectorio `kiosco/`.

- **Origen:** `/home/ubuntu/kiosco/kiosco` en el servidor de producción
- **Estado anterior:** commit `f918c112` (30-may-2025), preservado en la rama `backup/github-before-server-recovery-20260806-0928`

## Qué cambió

|           | Antes               | Ahora                     |
| --------- | ------------------- | ------------------------- |
| Ubicación | `kiosco/` (anidado) | raíz del repositorio      |
| Next.js   | 15.3.2              | 15.3.8                    |
| Código    | mayo 2025           | septiembre–diciembre 2025 |

Módulos que no existían en el repositorio y sí en producción: `admin` (con auditoría y reporte de ventas), `caja`, `control`, `store`, las rutas de API `cash`, `audit`, `admin/sales`, `auth/logout`, las rutas dinámicas `[id]` de productos, ventas y stock, los componentes de caja, auditoría, productos y UI, el directorio `hooks/` y `middleware.ts`.

## Decisiones tomadas

### Gestor de paquetes: npm

El servidor tenía ambos lockfiles. Se conservó `package-lock.json` y **se eliminó `pnpm-lock.yaml`**, por tres evidencias convergentes:

1. `package-lock.json` es del 12-dic-2025, la misma fecha que `package.json` y que el build `.next` desplegado. El `pnpm-lock.yaml` era del 30-may-2025 — anterior a casi todas las dependencias actuales.
2. `node_modules` en producción tenía estructura plana con `node_modules/.package-lock.json` (marca de npm), sin `node_modules/.pnpm` ni `.modules.yaml` (marcas de pnpm).
3. El `pnpm-lock.yaml` no reflejaba las dependencias agregadas después de mayo (Headless UI, Heroicons, Lucide, react-hot-toast, react-icons, faker, tsx).

### Migraciones de Prisma: se conservaron las 7

Las seis migraciones históricas del repositorio se mantuvieron junto a la única que existía en producción. **No forman una cadena aplicable de principio a fin** — ver [`prisma/migrations/README.md`](prisma/migrations/README.md). Nada se descartó.

### Archivos preservados del repositorio anterior

| Archivo              | Destino          | Ajuste                                                                                                                                                                                                      |
| -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml` | raíz             | Montaba `./kiosco:/app`, ruta que ya no existe → ahora `.:/app`. Las credenciales embebidas pasaron a variables de entorno con defaults de desarrollo. Se quitó la clave `version`, obsoleta en Compose v2. |
| `scrap.py`           | `tools/scrap.py` | Movido desde la raíz por coherencia. Tenía la contraseña de PostgreSQL en el código → ahora se lee del entorno (`OPENFOOD_DB_*`).                                                                           |
| `kiosco/scripts/`    | `scripts/`       | Sin cambios de contenido. Contiene contraseñas de usuarios de ejemplo (`insertUsers`), aptas solo para datos de prueba.                                                                                     |

### Archivos del repositorio anterior que no existen en producción

Estos cuatro archivos estaban en el repositorio y **no existen en el código desplegado**. Fueron reemplazados por los módulos equivalentes de producción (`store/`, `caja/`, `control/`, `productos/`). Se conservan íntegros en la rama `backup/github-before-server-recovery-20260806-0928`:

- `src/app/dashboard/page.tsx`
- `src/app/scan/page.tsx`
- `src/app/stock/page.tsx`
- `src/components/dashboard/CartSidebar.tsx`

También se quitaron `pnpm-lock.yaml` (ver decisión de gestor de paquetes) y `prisma/client/index.d.ts`, que es código generado por `prisma generate` y ahora está en `.gitignore`.

### Correcciones aplicadas a los scripts preservados

`scripts/insertData.ts` y `scripts/insertData.js` no compilaban contra el esquema actual: creaban un `Product` sin `branchId`, campo que pasó a ser obligatorio en junio de 2025. Se agregó `branchId`, y de paso `categoryId` y `supplierId` —que estaban fijos en `1`— ahora referencian las entidades realmente creadas por el script.

### Archivos no incluidos

`.env`, `logs/`, `node_modules/`, `.next/`, `prisma/client/` (generado), y los respaldos `kiosco.zip` y `kiosco_23-49.sql` que estaban fuera del árbol del proyecto. `ecosystem.config.js` quedó fuera por contener credenciales; en su lugar se incluye `ecosystem.config.example.js`.

## Pendiente de acción

El `ecosystem.config.js` del servidor almacenaba la contraseña de PostgreSQL en texto plano, en un archivo con permisos de lectura para cualquier usuario del sistema. La misma contraseña aparecía en `scrap.py`, versionado en un repositorio **público** desde mayo de 2025 y aún presente en el historial de Git y en la rama de respaldo.

**Se recomienda rotar esa contraseña**, definir un `JWT_SECRET` real (el almacenado era un placeholder) y endurecer permisos con `chmod 600`. Ninguna de estas acciones se ejecutó: requieren modificar el servidor.
