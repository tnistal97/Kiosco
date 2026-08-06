# Estrategia de migraciones

> Todo lo que dice este documento está comprobado por
> [`tests/migrations/chain.test.ts`](../tests/migrations/chain.test.ts), que
> crea bases descartables, aplica las migraciones con el mismo comando que se
> usaría en el servidor y verifica el resultado. No es un plan sobre papel.

## El problema que había

El historial tenía siete migraciones y **no se podía aplicar de principio a
fin**. Comprobado:

```
Applying migration `20250529182757_add_branch_product_unique`
...
Applying migration `20250605201717_add_value_to_product`
Error: P3018
ERROR: relation "Branch" already exists
```

La causa: pese a su nombre, `20250605201717_add_value_to_product` no agrega
una columna. Es un `CREATE TABLE` de las trece tablas del esquema completo.
En algún momento entre el 29 de mayo y el 5 de junio de 2025 el historial se
reinició en el servidor y esa migración quedó como la baseline real. Las seis
de mayo crean las mismas tablas antes, así que la baseline choca con ellas.

Consecuencia práctica: **no había forma de levantar una base de cero**. Quien
quisiera un entorno nuevo tenía que aplicar un `.sql` a mano.

## La solución

Separar el registro histórico de la cadena que se ejecuta.

```
prisma/migrations/           ← la cadena oficial. Se aplica de principio a fin.
prisma/migrations-legacy/    ← registro histórico. NO se ejecuta nunca.
```

No se borra nada: las seis migraciones de mayo documentan cómo evolucionó el
esquema y esa información no se recupera después.

### Cadena oficial

| Orden | Migración                                 | Qué hace                                                                                                                             |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | `20250605201717_add_value_to_product`     | **Baseline.** Crea las trece tablas. Es lo que hay hoy en el servidor.                                                               |
| 2     | `20260806120000_phase0_security_baseline` | Fase 0. `User.isActive`, `sessionVersion`, estado de anulación de ventas, `CashRegisterMovement.saleId`, dos CHECK y cuatro índices. |
| 3     | `20260806160000_phase1_audit_context`     | Fase 1. `AuditLog.branchId`, `requestId`, `ip`, `reason`, `result`, un CHECK y tres índices.                                         |

### Archivadas

`20250529181604_init`, `20250529182757_add_branch_product_unique`,
`20250529183734_change_email_to_username`,
`20250529183930_make_branch_name_unique`,
`20250529211308_add_categories_and_product_data`,
`20250529211833_add_unique_supplier_name`.

Están registradas como aplicadas en la base del servidor. `migrate status`
las lista como _"not found locally"_, que es informativo y **no bloquea**
`migrate deploy` — comprobado en la prueba de "servidor existente".

## Instalación nueva

```bash
createdb kiosco_dev
DATABASE_URL='postgresql://usuario:clave@127.0.0.1:5433/kiosco_dev?schema=public' npx prisma migrate deploy
npx prisma generate
```

Eso es todo. Antes hacía falta un `migrate resolve --applied` por cada una de
las seis migraciones de mayo antes de poder correr `deploy`.

## Servidor existente

**Ninguno de estos pasos se ejecutó contra producción.** Están verificados
sobre una copia estructural con datos ficticios.

### 1. Antes de tocar nada

```bash
pg_dump --format=custom --file=kiosco-$(date +%Y%m%d-%H%M).dump kiosco
```

Comprobar que el archivo existe y **que se puede restaurar**, en otra base:

```bash
createdb kiosco_prueba_restore
pg_restore --dbname=kiosco_prueba_restore kiosco-AAAAMMDD-HHMM.dump
```

Un respaldo que nunca se restauró no es un respaldo.

### 2. Ver qué falta aplicar

```bash
npx prisma migrate status
```

Esperado:

```
The last common migration is: 20250605201717_add_value_to_product

The migrations have not yet been applied:
20260806120000_phase0_security_baseline
20260806160000_phase1_audit_context

The migrations from the database are not found locally in prisma/migrations:
20250529181604_init
...
```

Las seis últimas líneas son normales: son las archivadas.

### 3. Ensayar sobre la copia

```bash
createdb kiosco_ensayo
pg_restore --dbname=kiosco_ensayo kiosco-AAAAMMDD-HHMM.dump
DATABASE_URL='...kiosco_ensayo' npx prisma migrate deploy
DATABASE_URL='...kiosco_ensayo' npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma --exit-code
```

El último comando debe decir `No difference detected`. Si dice otra cosa, hay
deriva entre el esquema y las migraciones: **parar acá**.

### 4. Comprobar el relleno de datos

Las dos migraciones nuevas rellenan columnas a partir de lo que ya existe.
Sobre la copia, verificar que salió bien:

```sql
-- Fase 0: cada movimiento de venta debe haber quedado vinculado a su venta.
SELECT count(*) FILTER (WHERE "saleId" IS NULL) AS sin_vincular,
       count(*)                                 AS total
FROM "CashRegisterMovement" WHERE type = 'sale';

-- Fase 1: ninguna entrada de auditoría debería quedar sin sucursal.
SELECT count(*) FROM "AuditLog" WHERE "branchId" IS NULL;
```

`sin_vincular` puede ser mayor que cero si algún movimiento antiguo tenía una
descripción que no seguía el formato `Venta #N`. Es aceptable: son datos
históricos y el vínculo no existía. Anotar cuántos son.

### 5. Aplicar

Fuera del horario de atención, con el sitio detenido:

```bash
DATABASE_URL='...produccion' npx prisma migrate deploy
npx prisma generate
npm run build
```

### 6. Verificar antes de abrir

```bash
npx prisma migrate status   # sin pendientes
```

Y comprobar que el middleware está en el build, que es lo que la Fase 0
arregló y no debe perderse:

```bash
grep -o '"middleware"' .next/server/middleware-manifest.json
```

## Si algo sale mal

Las dos migraciones son **aditivas**: no borran columnas, no borran filas, no
cambian tipos. Una prueba lo verifica leyendo el SQL y buscando `DROP TABLE`,
`DROP COLUMN`, `TRUNCATE` y `DELETE FROM` fuera de comentarios.

Eso significa que **la aplicación anterior sigue funcionando** sobre el
esquema nuevo: las columnas que agrega simplemente no las usa. La vuelta atrás
es volver a desplegar el código anterior, sin tocar la base.

Si aun así hay que revertir el esquema, cada migración tiene su bloque `DOWN`
escrito y comentado al final del archivo. Prisma no lo ejecuta: hay que
copiarlo y correrlo a mano, sobre una base restaurada del respaldo.

### Si `migrate deploy` falla a mitad de camino

Prisma marca la migración como fallida y se niega a seguir hasta resolverlo.
El procedimiento es:

1. Leer el error. Anotarlo entero.
2. **Restaurar del respaldo.** No intentar arreglar la base a mano.
3. Reproducir el fallo sobre la copia, corregir la migración, ensayar de nuevo.

`prisma migrate resolve --rolled-back <nombre>` solo marca la migración como
revertida en el registro; **no deshace lo que ya escribió**. Usarlo sin
restaurar deja la base en un estado que nadie puede describir.

## Reglas para las migraciones que vengan

1. **Aditivas por defecto.** Agregar una columna con valor por defecto o que
   admita null no rompe la versión anterior del código.
2. **Nunca borrar en la misma migración que deja de usar algo.** Primero deja
   de escribirse, se despliega, se comprueba, y recién después se borra la
   columna. Entre las dos cosas tiene que haber al menos un despliegue.
3. **Un `DOWN` comentado al final.** Aunque Prisma no lo use.
4. **Idempotente donde se pueda.** `IF NOT EXISTS`, y los `ALTER` envueltos en
   un `DO $$ ... END $$` que compruebe antes. Una migración que se puede
   correr dos veces sin romper nada es una migración que se puede reintentar.
5. **El relleno de datos va en la misma migración que la columna.** Una
   columna nueva vacía que alguien va a completar después nunca se completa.
6. **Probarla desde cero y sobre una copia con datos.** Las dos pruebas están
   automatizadas; agregar el caso nuevo a `tests/migrations/chain.test.ts`.

## Qué comprueba la prueba automatizada

| Caso               | Qué verifica                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| Cadena oficial     | Contiene exactamente las tres migraciones y ninguna archivada            |
| Cadena oficial     | Ninguna sentencia destructiva fuera de comentario                        |
| Instalación nueva  | `migrate deploy` sobre base vacía termina bien                           |
| Instalación nueva  | `migrate diff` no detecta deriva contra `schema.prisma`                  |
| Instalación nueva  | Existen las doce tablas del dominio                                      |
| Instalación nueva  | Existen los tres CHECK y los seis índices                                |
| Instalación nueva  | Se puede insertar sucursal, rol, usuario y venta                         |
| Instalación nueva  | Un estado de venta inventado se rechaza                                  |
| Instalación nueva  | Una anulación sin motivo ni responsable se rechaza                       |
| Instalación nueva  | Una anulación completa se acepta                                         |
| Servidor existente | Parte del esquema de junio con las siete registradas                     |
| Servidor existente | Se aplican solo las dos nuevas                                           |
| Servidor existente | Los datos previos siguen ahí                                             |
| Servidor existente | Sin deriva contra `schema.prisma`                                        |
| Servidor existente | Las cinco columnas nuevas de `AuditLog` están, y `result` no admite null |

Las bases de prueba se llaman `*_migtest` y se destruyen al terminar. El
nombre no es decorativo: la función que las borra se niega a tocar cualquier
base cuyo nombre no termine así.

## Riesgos que quedan

| Riesgo                                                               | Estado                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Producción no tiene aplicada ninguna de las dos migraciones nuevas   | **Abierto.** Es el paso que falta y depende de una ventana de mantenimiento.                                                                   |
| El relleno de `AuditLog.branchId` usa la sucursal actual del usuario | Aceptado. Con una sucursal no hay traslados; de acá en adelante el valor lo escribe la aplicación con la sucursal real del evento.             |
| Las seis archivadas aparecen como "not found locally"                | Aceptado, es informativo. Si molestara, se resuelve con `migrate resolve --applied` sobre una base nueva, pero no hace falta.                  |
| No hay migración probada que quite `Product.branchId`                | Abierto, y a propósito: es la más riesgosa del plan y con una sucursal no aporta. Ver [PHASE0_DECISIONS.md](PHASE0_DECISIONS.md).              |
| El dinero sigue en `Float`                                           | Abierto. Cambiar el tipo de columnas con datos es la migración de más riesgo pendiente. Conviene hacerla junto con la de cantidades decimales. |
