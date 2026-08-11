# Inventario de la release

> Todo lo que compone `1.0.0-rc.1`, en un solo lugar. Sirve para dos cosas:
> saber qué se va a desplegar, y durante un incidente, saber qué **está**
> desplegado.
>
> **Ningún valor de ningún secreto aparece acá.** Solo nombres.

## Identidad

|                 |                                                                 |
| --------------- | --------------------------------------------------------------- |
| Versión         | **`1.0.0-rc.1`**                                                |
| Rama            | `release/almacen-v1`, publicada en `origin`                     |
| Creada desde    | `feat/almacen-phase3-operations`, HEAD idéntico                 |
| Fases incluidas | 0, 1, 2, 3, 3A–3D, 4A–4D, 5A                                    |
| Artefacto       | `dist/kiosco-<version>-<commit12>.tar.gz` + `.sha256` + `.json` |

El commit y el checksum exactos del artefacto final están en el informe de la
fase y en `dist/*.json`. La aplicación los reporta en vivo:

```bash
curl -s https://kiosco.nistal.net/api/health | jq '{version, commit, buildTime}'
```

**Por qué existe ese endpoint:** el checkout de producción no es un repositorio
git, así que ahí `git rev-parse` no contesta nada, y `package.json` solo dice
qué versión _pretende_ ser el código. `build-info.json` lo escribe el script de
release en el momento de construir.

## Versión del salto

De `0.1.0` a `1.0.0-rc.1`. El `0.1.0` venía del andamiaje inicial y no
distinguía seis meses de trabajo de un proyecto recién creado. El `-rc.1` es
literal: **es una candidata, no una versión publicada.** Pasa a `1.0.0` cuando
haya estado en producción y funcionando.

## Runtime

|            | Local      | CI            | **Servidor hoy** | **Requerido**                       |
| ---------- | ---------- | ------------- | ---------------- | ----------------------------------- |
| Node       | 24.14.1    | 20.19.0       | **18.20.3**      | `>=20.9.0 <25` · `.nvmrc` dice `22` |
| npm        | 11.11.0    | 10.x          | 10.7.0           | ≥10                                 |
| PostgreSQL | 18.3       | 16            | **16.14**        | ≥16                                 |
| SO         | Windows 11 | ubuntu-latest | Ubuntu 24.04 LTS | Linux                               |

**Tres versiones de Node distintas en tres lugares, y ninguna es la del
`.nvmrc`.** Ver la sección de diferencias de runtime más abajo.

## Dependencias

Las que corren en producción:

| Paquete                           | Versión                                    |
| --------------------------------- | ------------------------------------------ |
| `next`                            | ^15.5.22                                   |
| `react` / `react-dom`             | ^19.0.1                                    |
| `@prisma/client` / `prisma`       | ^6.19.3                                    |
| `jose`                            | ^6.2.8 (firma de sesión; funciona en Edge) |
| `bcrypt`                          | ^6.0.0                                     |
| `zod`                             | ^4.4.3                                     |
| `zustand`                         | ^5.0.5                                     |
| `serwist` / `@serwist/next`       | ^9.5.12 (service worker)                   |
| `@headlessui/react`               | ^2.2.4                                     |
| `@heroicons/react`                | ^2.2.0                                     |
| `@zxing/browser`                  | ^0.1.5 (lector de códigos)                 |
| `react-hot-toast`                 | ^2.5.2                                     |
| `tailwindcss`                     | ^4.1.8                                     |
| `clsx`, `postcss`, `autoprefixer` | —                                          |

`npm audit`: **0 vulnerabilidades**.

Hay dos `overrides` con motivo escrito en
[`DEPENDENCY_SECURITY.md`](DEPENDENCY_SECURITY.md): `postcss@<=8.5.22` y
`sharp@<0.35.0`.

### Actualizaciones pendientes, clasificadas

`npm outdated` lista 28 paquetes. **Ninguno se actualizó**: una fase de
preproducción no es el lugar para mover dependencias, porque invalida el
baseline que se acaba de validar.

| Clase                                      | Paquetes                                                                                                                                                                  | Cuándo                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **REQUERIDO ANTES DE RELEASE**             | _ninguno_                                                                                                                                                                 | `npm audit` da 0                                            |
| **SEGURO DE POSPONER** (parches y menores) | `next` 15.5.22→15.5.23 · `react` 19.0.1→19.2.8 · `@types/*` · `tailwindcss` 4.1→4.3 · `pg` · `tsx` · `globals` · `zustand` · `@headlessui/react` · `@axe-core/playwright` | Después del despliegue, uno por uno, con la suite corriendo |
| **MAYOR — POSPONER**                       | `next` 16 · `eslint` 10 · `@eslint/js` 10 · `typescript` 7 · **`prisma` 7** · `@types/node` 26 · `@types/bcrypt` 6 · `@zxing/browser` 0.2                                 | Cada uno es su propio proyecto                              |

**`prisma` 6 → 7 merece un párrafo.** Es el salto más caro de la lista: cambia
el motor de consultas y la generación del cliente, y este proyecto tiene 43
migraciones, 17 disparadores y SQL crudo en la reconciliación. No se hace junto
con un despliegue.

## Base de datos

Lo que crea la cadena completa, medido sobre la base de pruebas ya migrada:

|                       |                                                      |
| --------------------- | ---------------------------------------------------- |
| Migraciones           | **43** (1 aplicada en producción, **42 pendientes**) |
| Modelos Prisma        | 38                                                   |
| Tablas                | 39                                                   |
| Índices               | 162, de los cuales **69 únicos**                     |
| Secuencias            | 43                                                   |
| Restricciones `CHECK` | **87**                                               |
| Claves foráneas       | 109                                                  |
| Disparadores          | **17**                                               |
| Funciones             | 17                                                   |

Los 17 disparadores son la parte que no depende de que la aplicación se porte
bien: hacen inmutables el libro de cuenta corriente, el de proveedores, las
recepciones y el historial de costos, y validan que los saldos del libro de
stock cierren fila por fila.

### Índices críticos

| Índice                                          | Para qué                           | Sin él                                                         |
| ----------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `ProductBarcode_code_key`                       | El lector del mostrador            | Cada escaneo recorre el catálogo                               |
| `ProductLot` (`productId`, vencimiento, `id`)   | FEFO                               | Cargar todos los lotes y ordenar en JavaScript                 |
| `SaleItem_saleId_idx`                           | Abrir, anular o imprimir una venta | Recorrido completo por venta — **es el que agregó la Fase 5A** |
| `SaleItem_productId_idx`                        | Rentabilidad por producto          | Recorrido completo por informe                                 |
| `StockMovement` (`branchId`, `productId`, `id`) | El libro de inventario             | La reconciliación se vuelve inviable                           |
| `CashRegisterMovement_branchId_date_idx`        | Arqueo del turno                   | Recorrido completo por cierre                                  |
| `Sale_branchId_date_idx`                        | Ventas del día                     | Recorrido completo en el panel                                 |

## Superficie de la aplicación

|              |                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Rutas de API | **89**                                                                                                       |
| Páginas      | **29**                                                                                                       |
| Permisos     | **64**                                                                                                       |
| Roles        | **9**: `duenio`, `admin`, `encargado`, `supervisor`, `cajero`, `vendedor`, `repositor`, `compras`, `auditor` |

Rutas principales: `/venta` · `/ventas` · `/caja` · `/productos` · `/stock` ·
`/stock/lotes` · `/stock/movimientos` · `/inventarios` · `/compras` ·
`/proveedores` · `/clientes` · `/reportes` · `/auditoria` · `/usuarios` ·
`/sucursales` · `/configuracion` · `/login` · `/offline`.

**Ninguna ruta pregunta por el nombre del rol.** Todas preguntan por un permiso;
la equivalencia vive en un solo archivo. Ver
[`PERMISSIONS_MATRIX.md`](PERMISSIONS_MATRIX.md), que un test mantiene sincronizada
con el código.

### Service worker

Serwist 9.5. La política de qué se guarda vive en
`src/server/pwa/cache-policy.ts` y es una **lista blanca**: se guarda lo
explícitamente permitido y todo lo demás va a la red.

`npm run pwa:check` comprueba 18 reglas, incluida la que importa: **ninguna
ruta bajo `/api/` se cachea**, tampoco `/api/health`.

## Scripts operativos

| Comando                                   | Qué hace                                                            |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `npm run build`                           | Construye                                                           |
| `npm run release:artifact`                | **Construye, empaqueta y calcula el SHA-256**                       |
| `npm run integrity:check`                 | 23 reconciliaciones sobre la base                                   |
| `npm run rehearsal`                       | Ensayo de respaldo → migración → restauración                       |
| `npm run rehearsal:prodlike`              | Lo mismo, con la forma y el volumen de producción                   |
| `npm run smoke:staging`                   | Smoke completo, **escribe**                                         |
| `npm run smoke:production`                | Smoke **de solo lectura**                                           |
| `npm run pwa:check`                       | 18 comprobaciones del service worker                                |
| `npm test` · `test:coverage` · `test:e2e` | Suite                                                               |
| `npm run seed:demo`                       | Datos de demostración. **Se niega** si la base no termina en `_dev` |

## Variables de entorno

**Solo los nombres.** Los valores viven en `.env` en el servidor, con permisos
`600`, y nunca en el repositorio.

### Obligatorias — la aplicación no arranca sin ellas

```
DATABASE_URL
JWT_SECRET
```

Se comprueban al arrancar (`src/server/env.ts`, llamado desde
`src/instrumentation.ts`). Si falta alguna o `JWT_SECRET` tiene menos de 32
caracteres, el proceso **muere** nombrando la variable —nunca su valor— y PM2 lo
deja en `errored`.

Antes de esto, la aplicación arrancaba con `JWT_SECRET=change-me`, servía el
login y fallaba recién al firmar el token. Media aplicación levantada es peor
que ninguna: parece que anda.

### Opcionales

```
NODE_ENV          production en el servidor, y TAMBIÉN en staging
PORT              3099 en producción; otro en staging
NEXT_PUBLIC_COMMERCE_NAME
```

### De herramientas, no de la aplicación

```
PG_BIN
REHEARSAL_ADMIN_URL
PWA_CHECK_URL
SCREENSHOT_BASE_URL  SCREENSHOT_USER  SCREENSHOT_PASSWORD
SMOKE_BASE_URL       SMOKE_USER       SMOKE_PASSWORD
POSTGRES_USER  POSTGRES_PASSWORD  POSTGRES_DB
OPENFOOD_DB_*
```

La plantilla completa, con qué va en cada entorno, está en
[`.env.example`](../.env.example).

## Diferencias de runtime

|            | Servidor         | Requerido | Severidad |
| ---------- | ---------------- | --------- | --------- |
| Node       | **18.20.3**      | ≥20.9.0   | **ALTA**  |
| PostgreSQL | 16.14            | ≥16       | ok        |
| SO         | Ubuntu 24.04 LTS | —         | ok        |

**Node 18 no tiene soporte desde abril de 2025.** No recibe parches de
seguridad. Next.js 15.5 todavía arranca con él, así que hoy _funciona_; el
problema es que corre sin mantenimiento.

Y hay un problema más silencioso: **el artefacto se construye con Node 24 y
correría con Node 18.** Es la razón por la que el guion de release registra en
el manifiesto con qué versión se construyó.

**Esta fase no actualiza Node**: hacerlo requiere escribir en el servidor. Lo
que sí deja es el requisito escrito, en `.nvmrc` (`22`) y en `engines`
(`>=20.9.0 <25`).

Nota aparte: **el CI corre con Node 20.19.0, que también entró en fin de vida en
abril de 2026.** Conviene mover CI y servidor a 22 LTS a la vez, después del
despliegue, para no tener tres versiones distintas otra vez.

## Compatibilidad de la base

|                |                                     |
| -------------- | ----------------------------------- |
| Mínima probada | PostgreSQL 16 (docker-compose y CI) |
| Producción     | 16.14                               |
| Desarrollo     | 18.3                                |

La cadena usa SQL estándar: sin `MERGE`, sin `generated columns`, sin nada
posterior a 16. Se aplica limpia en las dos versiones.

**Advertencia honesta:** el ensayo con volumen de producción corrió sobre
**18.3**, no sobre 16.14. Los tiempos son del orden correcto pero no son los del
servidor. Con una base de 11 MB, la diferencia no cambia ninguna decisión.
