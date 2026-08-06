# Historial de migraciones — leer antes de aplicar

Este directorio contiene **7 migraciones**, pero **no forman una cadena aplicable de principio a fin**. Conviene entender por qué antes de correr cualquier comando de Prisma.

## Qué hay acá

| Migración | Fecha | Origen | Naturaleza |
|---|---|---|---|
| `20250529181604_init` | 29-may-2025 | GitHub | Incremental |
| `20250529182757_add_branch_product_unique` | 29-may-2025 | GitHub | Incremental |
| `20250529183734_change_email_to_username` | 29-may-2025 | GitHub | Incremental |
| `20250529183930_make_branch_name_unique` | 29-may-2025 | GitHub | Incremental |
| `20250529211308_add_categories_and_product_data` | 29-may-2025 | GitHub | Incremental |
| `20250529211833_add_unique_supplier_name` | 29-may-2025 | GitHub | Incremental |
| `20250605201717_add_value_to_product` | 05-jun-2025 | Servidor de producción | **Baseline completa** |

## El problema

Pese a su nombre, `20250605201717_add_value_to_product` **no agrega una columna**: es un `CREATE TABLE` de las 13 tablas del esquema completo. En algún momento entre el 29 de mayo y el 5 de junio de 2025 el historial de migraciones se reinició en el servidor, y esa migración quedó como la nueva baseline. Es la única que existía en producción.

Consecuencia: aplicar las siete en orden falla. Las seis de mayo crean las tablas, y la baseline de junio intenta crearlas de nuevo → `relation "Branch" already exists`.

Las seis migraciones de mayo se conservan por decisión explícita, como **registro histórico** de la evolución del esquema. No están pensadas para ejecutarse junto con la baseline.

## Cómo aplicar, según el caso

**Base de datos nueva (desarrollo local):** usar solo la baseline. La forma más simple es partir del esquema:

```bash
npx prisma migrate resolve --applied 20250529181604_init
```

Repetir `--applied` para las seis de mayo, marcándolas como ya aplicadas sin ejecutarlas, y luego correr `npx prisma migrate deploy`, que ejecutará únicamente la baseline de junio.

**Base de datos existente (producción):** el esquema ya está aplicado. No correr `migrate deploy` sin antes verificar el estado con:

```bash
npx prisma migrate status
```

**Nunca** correr `prisma migrate reset` contra producción: borra todos los datos.

## Recomendación a futuro

Consolidar en una sola baseline limpia (archivando las seis de mayo en un directorio aparte, fuera de `prisma/migrations/`) y retomar desde ahí un historial incremental correcto. Eso no se hizo en esta recuperación para no descartar información sin autorización.
