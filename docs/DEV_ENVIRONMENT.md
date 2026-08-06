# Entorno de desarrollo local

> Cómo levantar el proyecto sin tocar producción. Estos son los pasos que se usaron para el recorrido de [UI_UX_AUDIT.md](UI_UX_AUDIT.md).

## Regla

**Nunca apuntar el entorno local a la base de producción.** `.env.local` está en `.gitignore` y solo debe contener valores de desarrollo.

## Opción A · Docker (preferida si el demonio arranca)

```bash
docker run -d --name kiosco-dev-db -p 5433:5432 \
  -e POSTGRES_USER=kiosco_dev -e POSTGRES_PASSWORD=kiosco_dev -e POSTGRES_DB=kiosco_dev \
  postgres:16
```

Puerto **5433** a propósito: evita chocar con un PostgreSQL instalado en el sistema.

## Opción B · Instancia PostgreSQL aislada

Sirve cuando Docker no está disponible y no se quiere tocar el PostgreSQL del sistema. Requiere los binarios de PostgreSQL instalados.

```bash
export PGBIN="/c/Program Files/PostgreSQL/18/bin"
export PGDATA="$HOME/.kiosco-dev-pgdata"

"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 5433 -c listen_addresses=127.0.0.1" -l "$PGDATA/pg.log" start
"$PGBIN/psql" -h 127.0.0.1 -p 5433 -U postgres \
  -c "CREATE USER kiosco_dev WITH PASSWORD 'kiosco_dev';" \
  -c "CREATE DATABASE kiosco_dev OWNER kiosco_dev;"
```

Para detenerla:

```bash
"$PGBIN/pg_ctl" -D "$PGDATA" stop
```

## Variables de entorno

`.env.local` (leído por Next.js):

```
DATABASE_URL=postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_dev?schema=public
JWT_SECRET=dev-only-not-a-real-secret-0000000000
```

> **Atención:** el CLI de Prisma **no lee `.env.local`**, solo `.env`. Para correr comandos de Prisma hay que pasar la variable en línea o mantener un `.env` local con el mismo valor. Es una fuente habitual de confusión: la aplicación funciona y `npx prisma …` falla con _"Environment variable not found: DATABASE_URL"_.

## Esquema

Desde la Fase 1 la cadena se aplica de principio a fin:

```bash
npx prisma migrate deploy
npx prisma generate
npm run dev
```

Antes no se podía: las seis migraciones de mayo de 2025 chocaban con la
baseline de junio y `migrate deploy` fallaba con
`relation "Branch" already exists`. Ahora están archivadas en
`prisma/migrations-legacy/`. El detalle está en
[DATABASE_MIGRATION_STRATEGY.md](DATABASE_MIGRATION_STRATEGY.md).

## Base de pruebas

La suite corre contra una base propia, **distinta de la de desarrollo**:

```bash
"$PGBIN/psql" -h 127.0.0.1 -p 5433 -U postgres \
  -c "CREATE DATABASE kiosco_test OWNER kiosco_dev;"

DATABASE_URL='postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_test?schema=public' \
  npx prisma migrate deploy
```

Las pruebas **abortan** si `DATABASE_URL` no termina en `_test`. Es la guarda
que impide vaciar por accidente la base de desarrollo: la suite hace
`TRUNCATE` de todas las tablas entre casos.

Las pruebas de migraciones además crean y destruyen bases `*_migtest`, así que
el usuario necesita permiso para crear bases:

```bash
"$PGBIN/psql" -h 127.0.0.1 -p 5433 -U postgres -c "ALTER ROLE kiosco_dev CREATEDB;"
```

## Calidad

```bash
npm run format:check   # Prettier
npm run lint           # ESLint, sin asistentes
npm run typecheck      # tsc --noEmit
npm test               # 354 pruebas
npm run test:coverage  # con informe en coverage/
npm run build          # construcción
npm audit              # tiene que decir 0
```

Es exactamente lo que corre el paso de CI
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Si pasa en local,
pasa en CI.

## Datos de prueba

`prisma/seed.ts` crea un único producto y el usuario `lautaro` / `Lkiosco123`. Sirve para arrancar, pero **no alcanza para evaluar la interfaz**: no hay stock crítico, ni ventas, ni movimientos de caja, ni bitácora, ni una segunda sucursal.

Para el recorrido de la auditoría se usó un conjunto más completo: 2 sucursales, 3 usuarios con roles distintos, 47 productos de almacén argentino con stock variado (incluyendo casos borde: stock cero, bajo mínimo, sin código de barras, sin precio), 24 ventas repartidas entre hoy y ayer con los tres medios de pago, movimientos manuales, un arqueo con faltante y 37 entradas de bitácora.

Conviene incorporar un seed así al repositorio (`prisma/seed.dev.ts`) para que cualquiera pueda evaluar la interfaz con datos realistas. Queda como tarea pendiente.

## Advertencias

- **No correr `prisma migrate reset`, `migrate deploy`, `db push` ni `db seed`**
  sin verificar antes a qué base apunta `DATABASE_URL`. Con el `.env`
  equivocado, cualquiera de los cuatro puede destruir producción. El CLI de
  Prisma lee `.env`, **no** `.env.local`: es la fuente habitual de confusión
  —la aplicación funciona y `npx prisma …` falla con _"Environment variable not
  found: DATABASE_URL"_, o peor, apunta a otra base.
- El servidor de desarrollo emite `⚠ Webpack is configured while Turbopack is not`:
  `next-pwa` configura Webpack pero `npm run dev` usa `--turbopack`. Es
  inofensivo en desarrollo, pero significa que **la PWA no se prueba nunca en
  local** — solo se genera al hacer `next build`. El paso de CI comprueba que
  el `sw.js` generado declare `NetworkOnly` para las rutas privadas.
- `test.js`, que borraba productos y stock sin ninguna guarda de entorno, se
  eliminó en la Fase 0. Si reaparece algo parecido, tiene que llevar la misma
  comprobación que `tests/setup.ts`.
