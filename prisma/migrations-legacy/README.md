# Migraciones archivadas — no ejecutar

Estas seis migraciones son el **registro histórico** de cómo evolucionó el
esquema entre el 29 de mayo y el 5 de junio de 2025. No forman parte de la
cadena que se aplica.

## Por qué están acá y no en `prisma/migrations/`

En algún momento de junio de 2025 el historial de migraciones se reinició en
el servidor, y `20250605201717_add_value_to_product` quedó como la baseline
real: pese a su nombre, no agrega una columna sino que crea las trece tablas
del esquema completo.

Aplicar las seis de mayo y después la baseline falla:

```
Applying migration `20250605201717_add_value_to_product`
Error: P3018
ERROR: relation "Branch" already exists
```

Con las seis fuera de la carpeta, la cadena se aplica de principio a fin sobre
una base vacía. Está comprobado en `tests/migrations/chain.test.ts`.

## Están registradas como aplicadas en producción

En la base del servidor, `_prisma_migrations` tiene las siete filas. Al no
estar en `prisma/migrations/`, `prisma migrate status` las lista como
_"not found locally"_. Es informativo: **no impide** que `migrate deploy`
aplique las migraciones nuevas. También está comprobado.

## Por qué no se borran

Documentan decisiones que no se recuperan de otra forma: cuándo se pasó de
`email` a `username`, cuándo se hizo único el nombre de sucursal, cuándo
aparecieron las categorías. Borrarlas ahorraría seis carpetas y perdería la
única explicación de por qué el esquema es como es.

Ver [`docs/DATABASE_MIGRATION_STRATEGY.md`](../../docs/DATABASE_MIGRATION_STRATEGY.md).
