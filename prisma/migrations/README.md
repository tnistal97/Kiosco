# Cadena oficial de migraciones

Estas tres migraciones se aplican de principio a fin sobre una base vacía:

```bash
DATABASE_URL='postgresql://usuario:clave@host:puerto/base?schema=public' npx prisma migrate deploy
```

| Orden | Migración | Qué hace |
|---|---|---|
| 1 | `20250605201717_add_value_to_product` | **Baseline.** Crea las trece tablas. Es el esquema que hoy tiene el servidor. |
| 2 | `20260806120000_phase0_security_baseline` | Baja lógica de usuarios, revocación de sesiones, anulación de ventas, vínculo venta↔movimiento de caja. |
| 3 | `20260806160000_phase1_audit_context` | Sucursal, requestId, IP, motivo y resultado en la bitácora. |

> El nombre de la primera engaña: no agrega una columna, crea el esquema
> entero. En junio de 2025 el historial se reinició en el servidor y esa
> migración quedó como la baseline real.

Las seis migraciones anteriores están en
[`../migrations-legacy/`](../migrations-legacy/README.md) como registro
histórico. **No se ejecutan**: crean las mismas tablas que la baseline y
aplicarlas juntas falla con `relation "Branch" already exists`.

## Antes de aplicar en producción

Leer [`docs/DATABASE_MIGRATION_STRATEGY.md`](../../docs/DATABASE_MIGRATION_STRATEGY.md).
Resumen: respaldo, restaurarlo para comprobar que sirve, ensayar sobre la
copia, verificar el relleno de datos, y recién entonces aplicar.

**Nunca** correr `prisma migrate reset` contra producción: borra todos los
datos.

## Al agregar una migración

Las reglas están en el documento de estrategia. Las dos que más importan:

- **Aditiva.** Agregar columnas que admitan null o tengan valor por defecto.
  Así la versión anterior del código sigue funcionando y la vuelta atrás es
  volver a desplegar, sin tocar la base.
- **Con su `DOWN` comentado al final.** Prisma no lo ejecuta, pero es lo único
  que queda si hay que revertir a mano.

`tests/migrations/chain.test.ts` comprueba que la cadena se aplica desde cero
y sobre una copia con datos, y falla si alguna migración contiene una
sentencia destructiva fuera de comentario.
