# Plan de rotación de secretos

> **Nada de esto se ejecutó.** Cada paso modifica producción, y esta fase es de
> solo lectura. El plan está escrito para poder ejecutarlo, no para tener un
> documento.
>
> Los secretos se midieron sin mostrarlos: se comparan huellas MD5 calculadas en
> cada lado. En ningún momento un secreto de producción salió del servidor.

## El hallazgo que ordena todo lo demás

|                                                                 |                               |
| --------------------------------------------------------------- | ----------------------------- |
| Huella de la clave del rol `kiosco` en producción               | **`d858acb4`** · 8 caracteres |
| Huella de la clave en `scrap.py`, commits `4e25736` y `a0e61ee` | **`d858acb4`** · 8 caracteres |

**Son la misma contraseña.** Y esos commits están en un repositorio de GitHub
que fue **público**, desde mayo de 2025 —quince meses—, y el archivo **sigue
existiendo hoy** en la rama publicada
`origin/backup/github-before-server-recovery-20260806-0928`.

Que hoy se vea privado no cambia nada: quince meses de exposición pública
alcanzan para que esté indexado, clonado o archivado en cualquier parte. Una
credencial que estuvo pública se considera **comprometida de forma permanente**.
La única acción que la vuelve inofensiva es cambiarla.

Lo que **limita el daño**, sin eliminarlo:

- PostgreSQL escucha únicamente en `127.0.0.1`. No se puede usar desde afuera
  sin tener antes acceso a la máquina.
- El rol `kiosco` no es superusuario y hoy solo tiene `SELECT/INSERT/UPDATE/DELETE`.

Lo que lo **agrava**:

- El servidor aloja **diez sistemas de terceros**. Cualquiera de ellos que
  permita ejecutar comandos convierte «solo desde localhost» en «desde acá».
- El `.env` tiene permisos **666**: cualquier usuario del sistema lo lee. La
  credencial también está disponible ahí, sin necesidad de mirar GitHub.
- `RECOVERY.md` recomendó rotarla el **6 de agosto de 2026**. Cinco días
  después, sigue sin rotarse.

## Inventario

| Secreto                           | Dónde vive                     | Estado                                    | Acción                                 |
| --------------------------------- | ------------------------------ | ----------------------------------------- | -------------------------------------- |
| Clave de PostgreSQL, rol `kiosco` | `.env` y `ecosystem.config.js` | **COMPROMETIDA** — pública 15 meses       | **ROTAR ANTES DE ENCENDER**            |
| `JWT_SECRET`                      | `ecosystem.config.js`          | **INVÁLIDO** — 9 caracteres (`change-me`) | **GENERAR**                            |
| `JWT_SECRET`                      | `.env`                         | **INVÁLIDO** — 14 caracteres              | **GENERAR** (el mismo que el anterior) |
| Clave del rol `postgres`          | fuera de este proyecto         | sin evaluar                               | fuera de alcance                       |
| Claves SSH                        | `~/.ssh` del equipo            | sin exposición conocida                   | ninguna                                |
| Contraseña del usuario `lautaro`  | `User.password`, bcrypt        | hash correcto, no expuesto                | recomendable cambiarla                 |

Los dos `JWT_SECRET` **son distintos entre sí**, y PM2 usa el de
`ecosystem.config.js`. Con 9 caracteres, `src/server/auth/token.ts` se niega a
firmar: **encender la aplicación hoy daría 500 en el login**. Rotar el JWT no es
solo higiene, es un requisito para que arranque.

## Orden

El orden importa. Cambiar la clave de la base antes de tener con qué arrancar
deja el sistema sin poder conectarse y sin forma cómoda de volver.

```
1. respaldo                          ← primero siempre
2. generar los secretos nuevos
3. escribirlos en la configuración
4. cambiar la clave EN PostgreSQL
5. arrancar y validar
6. invalidar la anterior
7. limpiar el rastro histórico
```

### 1 — Respaldo previo

Antes de tocar nada. Ver [`PRODUCTION_BACKUP_PLAN.md`](PRODUCTION_BACKUP_PLAN.md).
Si el paso 4 sale mal, la vuelta atrás es restaurar y volver a la clave vieja
—que todavía existe en algún lado— no adivinar.

### 2 — Generar

```bash
# En una máquina de confianza, NO en el servidor compartido.
openssl rand -base64 48                     # JWT_SECRET  (64 caracteres)
openssl rand -base64 24 | tr -d '/+=' | cut -c1-32   # clave de la base
```

La clave de la base sin `/`, `+` ni `=` a propósito: viaja dentro de una URL
(`postgresql://usuario:CLAVE@host/base`) y esos tres caracteres hay que
escaparlos. Un `/` sin escapar parte la cadena y el error que da no dice eso.

Guardarlos en el gestor de contraseñas del equipo **antes** de usarlos. Un
secreto generado y perdido a mitad del procedimiento deja el sistema caído.

### 3 — Escribirlos, en un solo lugar

Hoy los mismos dos valores están duplicados en `.env` y en
`ecosystem.config.js`. Dos copias de un secreto es una que se olvida de rotar.

**Elegir `.env` y vaciar el bloque `env` de `ecosystem.config.js`.** Motivo:
`.env` se puede poner en `600`; `ecosystem.config.js` lo lee PM2 al arrancar y
además queda copiado dentro de `~/.pm2/dump.pm2`, que es otro archivo más donde
el secreto sobrevive.

```bash
chmod 600 /home/ubuntu/kiosco/kiosco/.env
chmod 750 /home/ubuntu/kiosco/kiosco
chmod 600 /home/ubuntu/kiosco/kiosco/ecosystem.config.js
```

Los permisos son parte de la rotación, no un extra: rotar una clave y dejarla
en un archivo `666` es cambiarle la cerradura a una puerta abierta.

### 4 — Cambiar la clave en PostgreSQL

```sql
-- Como postgres. \password no deja la clave en el historial de psql
-- ni en pg_stat_activity, a diferencia de ALTER ROLE ... PASSWORD '...'.
\password kiosco
```

Si hiciera falta hacerlo sin `\password`, entonces:

```sql
ALTER ROLE kiosco WITH PASSWORD 'la-clave-nueva';
```

…y después limpiar `~/.psql_history`. `\password` evita ese paso.

**Detalle que se descubre tarde:** cambiar la clave **no corta** las sesiones ya
abiertas. Las conexiones vivas del pool de Prisma siguen funcionando con la
credencial vieja hasta que se reinicien. Es cómodo —da margen— y confunde: la
prueba real de que la clave nueva sirve es **después** de reiniciar.

### 5 — Arrancar y validar

```bash
pm2 restart kiosco --update-env
sleep 5
curl -s localhost:3099/api/health | jq
```

Se espera `status: "ok"` y `database.ok: true`. Si `JWT_SECRET` quedó corto, el
proceso **no arranca** y `pm2 list` lo muestra `errored`: eso lo agregó esta
fase (`src/server/env.ts`), y es intencional que sea ruidoso.

Después, el login de verdad:

```bash
npm run smoke:production
```

### 6 — Invalidar la anterior

La clave vieja deja de servir en el momento del `ALTER ROLE`. Lo que queda es
comprobar que **nada más la estaba usando**:

```bash
grep -rl "kiosco:" /home/ubuntu --include=".env*" 2>/dev/null
grep -rn "postgresql://kiosco" /home/ubuntu/*/ecosystem.config.js 2>/dev/null
```

Si otro sistema del servidor se conectaba a la base `kiosco` con esa
credencial, se entera acá y no cuando falle.

### 7 — El rastro histórico

Rotar la clave la vuelve inútil. El texto **sigue** en el historial de Git y en
una rama publicada. Tres opciones, de menor a mayor esfuerzo:

| Opción                                          | Qué logra                           | Qué cuesta                                                  |
| ----------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| **No hacer nada**                               | nada; la clave vieja ya no sirve    | queda un dato viejo visible para siempre                    |
| **Borrar la rama de respaldo**                  | quita la copia más accesible        | se pierde el respaldo del código anterior a la recuperación |
| **Reescribir el historial** (`git filter-repo`) | quita el texto de todos los commits | cambia todos los SHA; hay que forzar el push y avisar       |

**Recomendación: la segunda.** La rama `backup/github-before-server-recovery-20260806-0928`
cumplió su función —el código está recuperado y anda— y es la copia que
cualquiera encuentra primero. Reescribir el historial entero cambia todos los
SHA de un repositorio del que ya hay clones, y el beneficio es marginal una vez
rotada la clave: quien tenga un clon viejo ya tiene el secreto.

Antes de borrarla, archivarla fuera de GitHub:

```bash
git bundle create kiosco-backup-20260806.bundle \
  origin/backup/github-before-server-recovery-20260806-0928
# guardar el bundle donde se guardan los respaldos, NO en el repositorio
git push origin --delete backup/github-before-server-recovery-20260806-0928
```

## Rotar el JWT cierra todas las sesiones

Tiene que ser una decisión, no una sorpresa.

Un `JWT_SECRET` nuevo invalida **todos** los tokens emitidos con el anterior. En
el navegador de cada persona eso se ve como una vuelta al login sin aviso, en
medio de lo que estuviera haciendo.

**Hoy no importa**: la aplicación está detenida y hay un solo usuario, así que
no hay ninguna sesión que cortar. Es el momento más barato que va a haber para
hacerlo. Con el sistema en marcha, rotarlo pide avisar y elegir la hora.

El sistema ya tiene, además, una forma de revocar una sola sesión sin tocar el
secreto global: `User.sessionVersion`. Subirlo cierra las sesiones de **esa**
persona. Rotar el `JWT_SECRET` es el martillo grande, para cuando el secreto se
sospecha filtrado.

## Después

- Rotar `JWT_SECRET` cada 6–12 meses, o de inmediato ante cualquier sospecha.
- La clave de la base, en cada cambio de quien tiene acceso al servidor.
- **Ningún secreto vuelve a un archivo versionado.** `.env` y
  `ecosystem.config.js` están en `.gitignore`; lo que se versiona es
  `.env.example`, con nombres y sin valores.
- La credencial de la aplicación **no debería ser dueña del esquema**. Ver la
  discusión de roles en [`PRODUCTION_CUTOVER.md`](PRODUCTION_CUTOVER.md): quien
  migra y quien atiende peticiones pueden no ser el mismo rol.
