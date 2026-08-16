# Cutover a producción

> **No se ejecutó.** Es el procedimiento, paso a paso, con los puntos de
> decisión explícitos.
>
> Léelo entero **antes** de empezar. La parte más importante no son los
> comandos: son los cuatro bloqueantes de la primera sección, que hay que
> resolver antes de que este documento sirva para algo.

## Esto no es una migración: es un encendido

La aplicación **está detenida**. `pm2 list` la muestra `stopped`, nada escucha
en 3099, `kiosco.nistal.net` devuelve 502, y los logs se cortan en febrero.

Eso cambia el carácter de la operación:

- **No hay ventana de mantenimiento que negociar.** No hay nadie vendiendo.
- **Nadie puede escribir mientras se migra**, así que el riesgo más difícil de
  todos —una escritura a mitad de camino— no existe.
- **Si algo sale mal, el estado al que se vuelve es «apagado»**, que es el
  estado actual. El costo de fallar es bajo.

La contracara es que **no hay un sistema en marcha que sirva de referencia**.
Nadie sabe hoy si el flujo completo funciona en ese servidor, porque hace meses
que no funciona.

## Bloqueantes — antes de fijar fecha

Ninguno se resuelve desde el código. Los cuatro requieren escribir en el
servidor, y por eso ninguno se hizo.

### 1. La credencial de la base está comprometida

La clave del rol `kiosco` tiene la **misma huella** que la que estuvo en un
repositorio público quince meses, y que sigue en el historial y en una rama
publicada.

**Acción:** rotarla. Ver [`SECRET_ROTATION_PLAN.md`](SECRET_ROTATION_PLAN.md).
**Cuándo:** antes de encender. Es el momento más barato: no hay sesiones que
cortar ni operación que interrumpir.

### 2. El `JWT_SECRET` es inválido

9 caracteres en `ecosystem.config.js` (`change-me`), 14 en `.env`. El mínimo es 32. **Si se enciende hoy, el login devuelve 500.**

**Acción:** generar uno de 48 bytes y dejarlo **solo** en `.env`.

### 3. Permisos de archivo

`.env` en `666` y el directorio en `777`, en un servidor con diez sistemas de
terceros. Rotar los secretos y dejarlos en un archivo que todos leen no sirve de
nada.

```bash
chmod 750 /home/ubuntu/kiosco/kiosco
chmod 600 /home/ubuntu/kiosco/kiosco/.env
chmod 600 /home/ubuntu/kiosco/kiosco/ecosystem.config.js
```

### 4. El rol de la aplicación no puede migrar

```sql
SELECT has_schema_privilege('kiosco','public','CREATE');   -- false
```

`kiosco` no puede crear objetos y no es dueño de ninguna tabla. `prisma migrate
deploy` falla en el primer `CREATE TABLE`, y aunque se le diera `CREATE`, un
no-dueño no puede `ALTER TABLE` ni `CREATE TRIGGER` sobre tablas de `postgres`.
La cadena crea 17 disparadores.

**Dos opciones. Hay que elegir una:**

|                         | A — Migrar como `postgres`                                                                                           | B — Hacer dueño a `kiosco`                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Qué se hace             | `DATABASE_URL` con `postgres` **solo** durante `migrate deploy`                                                      | `REASSIGN OWNED BY postgres TO kiosco`                                                                |
| La aplicación corre con | `kiosco`, sin privilegios de esquema                                                                                 | `kiosco`, dueño de todo                                                                               |
| A favor                 | Menor privilegio permanente. La aplicación nunca puede alterar el esquema.                                           | Un solo rol. Las migraciones futuras no necesitan otra credencial.                                    |
| En contra               | Cada despliegue con migraciones pide la credencial de `postgres`                                                     | Si la credencial de la aplicación se filtra, se puede **borrar tablas**                               |
| Detalle                 | Los objetos nuevos quedan de `postgres`; los `DEFAULT PRIVILEGES` ya existentes le dan a `kiosco` `arwd` sobre ellos | `REASSIGN OWNED` afecta **todo lo que `postgres` tenga en ese clúster**: hay que acotarlo a esta base |

**Recomendación: A.** Este es un servidor compartido y la credencial de la
aplicación acaba de demostrar que puede terminar en un repositorio público. Que
esa credencial no pueda `DROP TABLE` vale más que la comodidad de no escribir
una URL distinta una vez por despliegue.

Hay que verificar una cosa antes: que los `DEFAULT PRIVILEGES` actuales
(`kiosco=arwd` para tablas, `rwU` para secuencias, otorgados por `postgres`)
alcancen para las 25 tablas nuevas. **Se comprueba en staging**, no acá.

## Antes del corte

### T−24 h

- [ ] **Los cuatro bloqueantes, resueltos y verificados.**
- [ ] Staging desplegado con este mismo artefacto y `smoke:staging` verde.
- [ ] `sha256sum -c` del artefacto en el servidor.
- [ ] `npm run rehearsal:prodlike` verde en la máquina de desarrollo.
- [ ] Precheck de datos repetido —si alguien encendió la aplicación desde el
      11-ago, los datos pueden haber cambiado.
- [ ] Espacio: `df -h` con más de 5 GB libres. Hay 51.
- [ ] `certbot.timer` activo y el certificado con más de 30 días.
- [ ] Alguien más sabe que esto va a pasar y cómo avisar si algo falla.

### T−1 h

- [ ] `npm ci --omit=dev` y `npx prisma generate` **ya hechos** en el servidor.
      Es el único paso que depende de la red y no puede quedar dentro del corte.
- [ ] Respaldo de prueba: `pg_dump` completo, restaurado en una base descartable
      y `integrity:check` verde sobre ella. El respaldo de verdad se hace en T0;
      este comprueba que el procedimiento funciona.

## El corte

### T0 — Respaldo, y verificarlo

```bash
FECHA=$(date +%Y%m%d-%H%M%S)
DESTINO=/var/backups/kiosco
mkdir -p "$DESTINO" && chmod 700 "$DESTINO"

sudo -u postgres pg_dump --format=custom --compress=6 \
  --file="$DESTINO/kiosco-precutover-$FECHA.dump" kiosco
sudo -u postgres pg_dumpall --roles-only > "$DESTINO/roles-$FECHA.sql"
chmod 600 "$DESTINO"/*

cd "$DESTINO"
sha256sum "kiosco-precutover-$FECHA.dump" > "kiosco-precutover-$FECHA.dump.sha256"
pg_restore --list "kiosco-precutover-$FECHA.dump" | grep -c "TABLE DATA"   # 14
```

**PUNTO DE DECISIÓN 1** — ¿el respaldo existe, tiene checksum y lista 14 tablas?
**No** → detenerse. No se avanza sin la única vuelta atrás que existe.

Medido: **0,3 s, ~0,1 MB**.

### T0+1 — Copiar el respaldo fuera del servidor

```bash
scp "$DESTINO/kiosco-precutover-$FECHA.dump"* equipo:~/respaldos-kiosco/
```

Un respaldo en el mismo disco que la base no protege de un fallo de disco. Es
un minuto y es la diferencia entre «tenemos respaldo» y «teníamos».

### T0+2 — El artefacto

```bash
cd /home/ubuntu/kiosco
mv kiosco kiosco-anterior-$FECHA        # el checkout viejo, intacto
mkdir kiosco && cd kiosco

sha256sum -c ~/kiosco-1.0.0-rc.3-<commit>.tar.gz.sha256   # ANTES de descomprimir
tar -xzf ~/kiosco-1.0.0-rc.3-<commit>.tar.gz
cp ../kiosco-anterior-$FECHA/.env .                        # el .env NO viaja en el artefacto
chmod 600 .env

npm ci --omit=dev
npx prisma generate
```

**Renombrar y no borrar.** El checkout viejo son 1,8 GB en un disco con 51 GB
libres, y es la vuelta atrás del código sin depender de nada más.

### T0+3 — Migrar

```bash
cd /home/ubuntu/kiosco/kiosco
npx prisma migrate status     # se esperan 42 pendientes

# Opción A: como postgres, SOLO para esto
DATABASE_URL="postgresql://postgres:…@localhost:5432/kiosco?schema=public" \
  npx prisma migrate deploy
```

Medido con volumen real: **1,7 s las 42 migraciones**. Se esperan segundos, no
minutos.

**PUNTO DE DECISIÓN 2** — ¿`migrate deploy` terminó con código 0 y
`migrate status` dice que no queda ninguna pendiente?
**No** → **RESTAURAR**. Ver más abajo. No se intenta arreglar a mano: a partir
de la migración 6 los datos están transformados.

### T0+4 — Verificar la base antes de encender

```bash
DATABASE_URL="postgresql://kiosco:…@localhost:5432/kiosco?schema=public" \
  npm run integrity:check
```

Se esperan **23/23 sin inconsistencias**, con `Ventas 1130`, `Pagos 1130`,
`Venta y caja 1130`, `Inventario 379`.

**PUNTO DE DECISIÓN 3** — ¿23/23?
**No** → **RESTAURAR**. Una inconsistencia acá significa que la migración
transformó mal los datos, y eso no se corrige con la aplicación encendida.

### T0+5 — Encender

```bash
pm2 restart kiosco --update-env
sleep 5
pm2 list | grep kiosco
curl -s localhost:3099/api/health | jq
```

Se espera `status: "ok"`, `database.ok: true`, y `commit` **igual al del
artefacto**. Si dice `desconocido`, se desplegó algo que no es el artefacto.

**PUNTO DE DECISIÓN 4** — ¿`/api/health` responde 200 con el commit correcto?
**No** → mirar `pm2 logs kiosco --lines 50`. Si el proceso está `errored`, casi
seguro es una variable de entorno: eso lo dice el propio mensaje, con el nombre
de la variable. **La base ya está migrada**: se arregla el entorno y se
reintenta, no se restaura.

### T0+6 — Smoke

```bash
export SMOKE_BASE_URL=https://kiosco.nistal.net
npm run smoke:production
```

Solo lecturas. No crea ventas ni mueve stock, a propósito.

**PUNTO DE DECISIÓN 5** — ¿todo verde?
**No** → decidir según qué falló. Un 502 es Nginx o el proceso; un 401 en el
login es el `JWT_SECRET`; un 500 en las lecturas es la base.

### T0+7 — Una venta real, a mano

La única prueba que el smoke de producción no hace, y hay que hacerla:
**entrar con un navegador y vender algo de verdad**, con una persona mirando.

1. Iniciar sesión.
2. Abrir turno de caja.
3. Buscar un producto **escaneando** —174 de los 379 tienen código.
4. Cobrar en efectivo.
5. Ver la venta en `/ventas`.
6. Anularla, con motivo.
7. Comprobar que el stock volvió.

Después:

```bash
npm run integrity:check     # sigue 23/23
```

**PUNTO DE DECISIÓN 6 — GO / NO-GO FINAL.**
Verde → el despliegue queda. Rojo → decidir entre restaurar o dejarlo apagado y
diagnosticar; con el sistema detenido desde febrero, apagar un rato más no
cuesta nada.

## Restaurar

```bash
# 1. Bajar la aplicación
pm2 stop kiosco

# 2. La base, a como estaba
sudo -u postgres psql -c 'ALTER DATABASE kiosco RENAME TO kiosco_fallida'
sudo -u postgres createdb kiosco
sudo -u postgres pg_restore --dbname=kiosco --no-owner --no-privileges \
  --exit-on-error "$DESTINO/kiosco-precutover-$FECHA.dump"

# 3. El código, a como estaba
cd /home/ubuntu/kiosco
rm -rf kiosco && mv kiosco-anterior-$FECHA kiosco

# 4. Comprobar
sudo -u postgres psql -d kiosco -tAc 'SELECT count(*) FROM "Sale"'   # 1130
sudo -u postgres psql -d kiosco -tAc \
  'SELECT count(*) FROM _prisma_migrations'                          # 1
```

**`RENAME` en vez de `DROP`.** La base fallida se conserva para poder mirar qué
pasó. Se borra días después, no en el momento.

`--exit-on-error` no es opcional: sin él, `pg_restore` sigue después de un error
y termina con código 0. Una restauración a medias que informa éxito es el peor
resultado posible de esta noche.

### Cuándo alcanza con volver solo el código

**Antes de la migración 6.** Después, no. Ver
[`MIGRATION_COMPATIBILITY_MATRIX.md`](MIGRATION_COMPATIBILITY_MATRIX.md): la
sexta migración convierte todo el dinero a `Decimal` y reescribe cada importe.
El código viejo lee esos valores como cadenas y suma mal, en silencio.

Como la migración corre entera en un solo paso, en la práctica la regla es:
**si `migrate deploy` empezó, la vuelta atrás es el respaldo.**

## Después

- [ ] Etiquetar el commit: `git tag v1.0.0 && git push origin v1.0.0`
- [ ] Guardar en el inventario: artefacto, SHA-256, commit, fecha, quién.
- [ ] Programar el respaldo automático (hoy **no existe**).
- [ ] Crear los usuarios por función. Hoy hay **uno solo, administrador**, y
      toda la separación de funciones del sistema no protege nada así.
- [ ] Cargar los códigos de barras faltantes: **205 de 379 productos** no se
      pueden escanear.
- [ ] Agendar la actualización de Node 18 → 22.
- [ ] Aplicar a Nginx las tres mejoras que staging ya tiene: `map` para
      `Connection`, HSTS, `proxy_read_timeout`.
- [ ] Borrar `kiosco_fallida` y `kiosco-anterior-*`, si el despliegue quedó.

## Lo que este runbook no resuelve

- **No hay despliegue sin corte.** Una instancia, un puerto. Para el volumen de
  este comercio, dos instancias serían complejidad sin beneficio.
- **`npm ci` sigue dependiendo de la red.** Está fuera del corte a propósito;
  si falla, se pospone el despliegue, no se sigue.
- **Nadie usó este sistema todavía en producción.** Todo lo que dice este
  documento está probado en desarrollo, en la suite y —cuando exista— en
  staging. La primera vez que un cajero venda va a ser la primera vez.
