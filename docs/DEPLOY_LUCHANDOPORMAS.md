# Despliegue en luchandopormas.com

> Servidor Oracle Cloud `gosto-vps` (`129.213.133.204`), Ubuntu 22.04.5 LTS
> ARM64. Puesta en marcha del 3 de septiembre de 2026; última actualización
> el 19 de octubre de 2026 (commit `fef6c65`, teclado de la venta V6).
>
> Este documento describe **este** despliegue. `almacen.nistal.net` y
> `kiosco.nistal.net` resuelven a este servidor. `luchandopormas.com` también
> lo hacía hasta que **venció el 18 de octubre** (ver
> [Lo que hay que saber](#lo-que-hay-que-saber-para-el-próximo-despliegue)).
> El de
> [`PRODUCTION_CURRENT_STATE.md`](PRODUCTION_CURRENT_STATE.md) es el servidor
> anterior (PM2, Node 18) y no se tocó.
>
> Ningún secreto vive en este archivo. Dónde están, sí; cuáles son, no.

## Qué corre y dónde

| Pieza          | Valor                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| Código         | `/srv/kiosco/app` — hoy en `fix/venta-keyboard-flow-v2` (`fef6c65`)          |
| Usuario        | `kiosco` (UID 116, de sistema, **sin sudo**, shell `nologin`)                |
| Proceso        | systemd, unidad `kiosco.service`                                             |
| Puerto interno | **127.0.0.1:3099** — nunca `0.0.0.0`                                         |
| Node           | 22.23.2 LTS (`apt-mark hold`, no sube solo a 24)                             |
| Base           | PostgreSQL 14.24, `kiosco`, escucha solo en `localhost`                      |
| Rol de base    | `kiosco` — no superusuario, sin `CREATEDB` ni `CREATEROLE`                   |
| Proxy          | Nginx 1.18, único servicio público                                           |
| Secretos       | `/srv/kiosco/app/.env` — `600 kiosco:kiosco`                                 |
| Funciones      | `KIOSCO_FUNCIONES` sin definir: modo almacén, sin Lotes ni Compras           |
| Dominios       | `KIOSCO_HOSTS` con los tres, más `www.luchandopormas.com`                    |
| Memoria        | 3,9 GB de RAM y 2 GB de swap, **compartidos con otras aplicaciones** (abajo) |

`/srv/kiosco` es `750 kiosco:kiosco`: como `ubuntu`, un `test -f`, un `ls` o un
comodín sobre algo de adentro fallan sin decir por qué. Para mirar, `sudo`; para
tocar, `sudo -u kiosco`. Un comodín lo expande la shell de `ubuntu` **antes** del
`sudo`: `sudo chmod 600 /srv/kiosco/backups/x/*` falla con "No such file";
`sudo bash -c 'chmod 600 /srv/kiosco/backups/x/*'` no.

El clon se instaló siguiendo **una sola rama**: su `remote.origin.fetch` es
`+refs/heads/feat/ux-v2-phase2-1-lista-navegacion:…`. Un `git fetch origin`
pelado no trae ninguna otra; hay que pedirla por nombre (abajo).

### Por qué systemd y no PM2

PM2 estaba instalado bajo el usuario `gosto` **sin ninguna aplicación
registrada** (`dump.pm2` vacío). Adoptarlo habría significado montar
`pm2 startup` + `pm2 save` para conseguir lo que systemd ya hace de
fábrica: arrancar al encender, reiniciar al caer, registrar en el journal
y aplicar límites de memoria. Se dejó PM2 instalado y sin usar; no molesta
a nadie.

La unidad además restringe lo que el proceso alcanza: `ProtectSystem=strict`
deja el disco en solo lectura salvo `.next/`, `CapabilityBoundingSet=` vacío,
y `SystemCallFilter=@system-service`.

## Comandos

```bash
# Estado y salud
systemctl status kiosco
curl -s http://127.0.0.1:3099/api/health

# Logs (en vivo, o los últimos 100)
journalctl -u kiosco -f
journalctl -u kiosco -n 100 --no-pager

# Reiniciar
sudo systemctl restart kiosco

# Integridad del modelo de datos (23 comprobaciones)
sudo -u kiosco bash -lc 'cd /srv/kiosco/app && set -a && . ./.env && set +a && npx tsx scripts/integrity-check.ts'
```

### Desplegar una versión nueva, sin corte

Desde el 19 de octubre de 2026 el build se hace **aparte**, en un `git worktree`,
con la aplicación atendiendo. El servicio solo se detiene para cambiar de
construcción: ese día el corte fue de **3 segundos** (`2a11b76` → `fef6c65`).
Antes de empezar: árbol limpio en el servidor, el commit ya subido a GitHub y
un respaldo de la base (ver [Respaldos](#respaldos)).

Sirve cuando **no cambian `package.json`, `package-lock.json` ni `prisma/`**: el
worktree usa el `node_modules` de producción a través de un enlace. Si cambian,
ver [Con dependencias o migraciones nuevas](#con-dependencias-o-migraciones-nuevas).

```bash
APP=/srv/kiosco/app
RAMA=fix/venta-keyboard-flow-v2                     # la que se despliega
NUEVO=<sha completo>                                # el commit esperado
ANTERIOR=$(sudo -u kiosco git -C $APP rev-parse HEAD)
TS=$(date -u +%Y%m%d-%H%M%S)
BUILD=/srv/kiosco/build/$TS
PREV=/srv/kiosco/releases/prev-$TS

# 0. Traer la rama, por nombre (el clon sigue una sola) y comprobar
sudo -u kiosco git -C $APP fetch origin "+refs/heads/$RAMA:refs/remotes/origin/$RAMA"
sudo -u kiosco git -C $APP rev-parse origin/$RAMA                      # = $NUEVO
sudo -u kiosco git -C $APP merge-base --is-ancestor $ANTERIOR $NUEVO   # avance rápido
sudo -u kiosco git -C $APP diff --name-only $ANTERIOR $NUEVO -- \
  package.json package-lock.json prisma                               # tiene que salir vacío

# 1. Build aparte, con la aplicación andando y la memoria acotada
sudo -u kiosco mkdir -p /srv/kiosco/build
sudo -u kiosco git -C $APP worktree add --detach $BUILD $NUEVO
sudo -u kiosco ln -s $APP/node_modules $BUILD/node_modules
sudo systemd-run --scope --unit=kiosco-build-$TS -p MemoryMax=2000M -p MemorySwapMax=900M \
  sudo -u kiosco -H bash -lc "cd $BUILD && set -a && . $APP/.env && set +a &&
    export NODE_OPTIONS=--max-old-space-size=2560 && npm run build -- --no-lint"
sudo test -f $BUILD/.next/BUILD_ID                  # sin esto, el build no terminó
sudo -u kiosco grep commit $BUILD/build-info.json   # tiene que ser $NUEVO

# 2. Probarlo en el 3097, sin tocar producción (ver abajo)

# 3. Cambiar: el único momento sin servicio
sudo systemctl stop kiosco
sudo -u kiosco mkdir -p $PREV
echo $ANTERIOR | sudo -u kiosco tee $PREV/sha.txt
sudo -u kiosco cp -p $APP/build-info.json $APP/public/sw.js $PREV/
sudo -u kiosco mv $APP/.next $PREV/next
sudo -u kiosco git -C $APP checkout --no-track -b $RAMA $NUEVO   # rama ya existente: checkout + merge --ff-only
sudo -u kiosco mv $BUILD/.next $APP/.next
sudo -u kiosco cp -p $BUILD/build-info.json $APP/build-info.json
sudo -u kiosco cp -p $BUILD/public/sw.js $APP/public/sw.js
sudo systemctl start kiosco
curl -s http://127.0.0.1:3099/api/health            # el commit tiene que ser el nuevo

# 4. Limpiar el worktree (el .next ya se movió)
sudo -u kiosco git -C $APP worktree remove --force $BUILD
```

**La prueba del paso 2.** La construcción nueva se levanta desde su propia
carpeta como servicio pasajero. Al arrancar, la aplicación solo valida el
entorno (`src/instrumentation.ts`), así que apuntarla a la base de producción
para pedir un par de páginas no escribe nada:

```bash
sudo systemd-run --unit=kiosco-prueba-$TS --uid=kiosco --gid=kiosco \
  -p WorkingDirectory=$BUILD -p EnvironmentFile=$APP/.env -p MemoryMax=768M \
  -E NODE_ENV=production /usr/bin/node $BUILD/node_modules/next/dist/bin/next start -p 3097 -H 127.0.0.1
curl -s http://127.0.0.1:3097/api/health                                             # commit nuevo
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: kiosco.nistal.net' http://127.0.0.1:3097/login   # 200
sudo systemctl stop kiosco-prueba-$TS
```

**Por qué el build va acotado, y con esos tres ajustes.** `systemd-run --scope`
encierra el build en su propio cgroup: si se pasa de memoria, el kernel mata al
build y no a otra aplicación del servidor, que es lo que pasó el 18 de octubre
(ver [Memoria](#memoria-el-build-puede-tirar-al-resto-del-servidor)). Con ese
tope, el 19 de octubre el build falló dos veces antes de salir:

- **Con lint**, el kernel lo mató (salida 137) en "Linting and checking validity
  of types": el ESLint con información de tipos y el chequeo de tipos corren a
  la vez y pasan los 2 GB. El lint se corre antes, en la máquina de desarrollo
  (`npm run lint`), sobre el mismo commit; los tipos **sí** se chequean en el
  servidor.
- **Sin lint pero con el heap por omisión**, V8 se quedó sin memoria en el
  chequeo de tipos: calcula su límite (~1 GB) a partir del tope del cgroup.
- Con `--no-lint`, `--max-old-space-size=2560` y 900 MB de swap dentro del
  cgroup tardó **64 segundos**, con un pico de 2,6 GB usados en todo el servidor
  y sin tocar la swap del resto.

**Si el build muere, el scope puede quedar vivo.** Cuando el kernel mata un
solo proceso, los demás siguen: el 19 de octubre quedaron dos `node` huérfanos
con 2 GB y la memoria disponible del servidor bajó a 855 MB.
`systemctl list-units 'kiosco-build-*'` los muestra y
`sudo systemctl stop kiosco-build-<ts>.scope` los termina. Revisarlo siempre
después de un build fallido.

**`--no-track`, no `--track`.** Como el clon sigue una sola rama,
`git checkout -b X --track origin/X` falla con "is not a branch" **después de
escribir los archivos**: queda la cabeza en el commit viejo, con el árbol y el
índice del nuevo. Pasó el 19 de octubre; el guion volvió solo a la versión
anterior (un par de segundos sin servicio) y se terminó con
`checkout --no-track -b X <sha>`, que no tocó ningún archivo porque el árbol ya
era ese.

**`public/sw.js` también viaja.** Serwist escribe el service worker en
`public/`, no en `.next`. Si se cambia solo `.next`, producción sigue sirviendo
el `sw.js` de la versión anterior, con su lista de archivos vieja.

**Mover `.next` de carpeta funciona.** En `.next/server` aparece la ruta
absoluta del worktree en unos 270 archivos, pero son claves de los manifiestos
de componentes cliente (`clientModules`, `entryCSSFiles`), no rutas que se lean
del disco. Se comprobó el 19 de octubre levantando una copia con el worktree
original renombrado, es decir inaccesible: `/login`, su CSS y su JS
respondieron 200.

**Correrlo desatendido.** El 19 de octubre la secuencia se dividió en tres
guiones subidos a `/tmp` (respaldos y build; prueba en el 3097; cambio con
vuelta atrás automática), cada uno en una sola conexión SSH. El build se lanzó
con `nohup setsid` para que un corte de la conexión no lo matara.

### Con dependencias o migraciones nuevas

Si cambian `package.json`, `package-lock.json` o `prisma/`, el worktree no puede
usar el `node_modules` de producción y hay que construir en el lugar, con el
servicio detenido. Es la secuencia del 18 de octubre de 2026; el build lleva
los mismos ajustes de memoria que arriba. El corte dura lo que tarden `npm ci`,
las migraciones y el build: unos 3 minutos si nada falla (`npm ci` ~30 s, build
~2 min):

```bash
APP=/srv/kiosco/app
RAMA=feat/ux-v2-phase2-1-lista-navegacion
PREV=/srv/kiosco/releases/prev-$(date -u +%Y%m%d-%H%M%S)

# 0. Comprobar antes de tocar nada
sudo -u kiosco git -C $APP status --porcelain        # tiene que salir vacío
sudo -u kiosco git -C $APP fetch origin "+refs/heads/$RAMA:refs/remotes/origin/$RAMA"
sudo -u kiosco git -C $APP rev-parse origin/$RAMA    # el commit esperado
free -m                                              # ver "Memoria", abajo

# 1. Detener y guardar lo que hoy funciona, para volver sin reconstruir
sudo systemctl stop kiosco
sudo -u kiosco mkdir -p $PREV
sudo -u kiosco git -C $APP rev-parse HEAD | sudo -u kiosco tee $PREV/sha.txt
sudo -u kiosco cp -a $APP/.next $PREV/next
sudo -u kiosco mv $APP/node_modules $PREV/node_modules
sudo test -f $APP/build-info.json && sudo -u kiosco cp -p $APP/build-info.json $PREV/
sudo -u kiosco cp -p $APP/public/sw.js $PREV/

# 2. Código, dependencias, base y build
sudo -u kiosco git -C $APP checkout $RAMA
sudo -u kiosco git -C $APP merge --ff-only origin/$RAMA
sudo -u kiosco bash -lc "cd $APP && npm ci --no-audit --no-fund && npx prisma generate"
sudo -u kiosco bash -lc "cd $APP && set -a && . ./.env && set +a && npx prisma migrate deploy"
sudo systemd-run --scope -p MemoryMax=2000M -p MemorySwapMax=900M \
  sudo -u kiosco -H bash -lc "cd $APP && set -a && . ./.env && set +a &&
    export NODE_OPTIONS=--max-old-space-size=2560 && npm run build -- --no-lint"
sudo test -f $APP/.next/BUILD_ID                     # sin esto, el build no terminó

# 3. Arrancar y comprobar
sudo systemctl daemon-reload
sudo systemctl start kiosco
curl -s http://127.0.0.1:3099/api/health             # el commit tiene que ser el nuevo
```

**`npm ci` completo, sin `--omit=dev`.** El build necesita las dependencias de
desarrollo —`typescript`, `tailwindcss`, `@tailwindcss/postcss`, `prisma`—: con
`--omit=dev` no compila. `--omit=dev` solo sirve donde llega un artefacto ya
construido, como en [`PRODUCTION_CUTOVER.md`](PRODUCTION_CUTOVER.md). Este
servidor construye en el lugar. Con la caché de npm del usuario `kiosco`,
`npm ci` tarda unos 30 segundos y el build unos 2 minutos.

**Correrlo desatendido.** Si la conexión SSH se corta a mitad de camino, el
servicio queda detenido y el árbol a medias. El 18 de octubre la secuencia se
subió como guion a `/tmp` y se lanzó con
`nohup setsid bash guion.sh > guion.log 2>&1 < /dev/null`. El guion volvía
solo a la versión anterior si fallaba cualquier paso; el log quedó en
`/srv/kiosco/backups/`. Ese día el build corrió sin tope de memoria; con el
tope de hoy, el OOM de abajo no habría alcanzado a otras aplicaciones.

`build-info.json` no se versiona a propósito: lo escribe `npm run build`
(`prebuild` → `scripts/escribir-build-info.mjs`) con la versión, el commit y
la hora. Antes era un paso manual aparte, y el 24 de septiembre de 2026 el
health de producción decía `commit: desconocido`: durante un incidente nadie
habría sabido qué estaba corriendo. Si el commit del health no es el que se
acaba de desplegar, el despliegue no terminó.

### Memoria: el build puede tirar al resto del servidor

El servidor tiene 3,9 GB de RAM y 2 GB de swap, y no es solo de Kiosco: corren
otras aplicaciones, entre ellas `crmleads-worker.service` y el sitio de
`cooperativajovenes.com`. Antes del despliegue del 18 de octubre la swap ya
estaba usada a medias (1,2 GB).

Ese día el primer build terminó bien. El segundo, idéntico, dejó al servidor
sin memoria a las 13:07 UTC. El kernel mató un proceso de `crmleads-worker`,
que systemd reinició solo a los 33 segundos. Durante unos cinco minutos el
servidor no contestó SSH ni HTTPS. El build terminó igual y la aplicación
arrancó bien.

- **Acotado con `systemd-run --scope`**, como en las dos secuencias de
  arriba: desde el 19 de octubre el build tiene su propio tope (2 GB de RAM y
  900 MB de swap). Si se pasa, muere el build y no otra aplicación.
- **Mirar `free -m` antes.** El 19 de octubre había 2,8 GB disponibles con la
  aplicación andando, y el pico del build llevó el servidor a 2,6 GB usados.
- **La salida de fondo es no construir acá:** armar el artefacto en otra
  máquina con `scripts/release-artifact.mjs`, como describe
  [`PRODUCTION_CUTOVER.md`](PRODUCTION_CUTOVER.md). No está probado en este
  servidor.

### Volver atrás

El despliegue es un checkout de git: revertir es moverse de commit y volver
a poner el `.next`, el `build-info.json`, el `public/sw.js` y, si se tocó, el
`node_modules` de esa versión.

**Después de un despliegue sin corte**, con lo que guardó el paso 3 (el
`node_modules` no cambió):

```bash
APP=/srv/kiosco/app
PREV=/srv/kiosco/releases/prev-AAAAMMDD-HHMMSS        # el del despliegue a deshacer
RAMA_ANTERIOR=feat/ux-v2-phase2-1-lista-navegacion    # sigue en $(cat $PREV/sha.txt)

sudo systemctl stop kiosco
sudo -u kiosco mv $APP/.next /srv/kiosco/build/next-descartado-$(date -u +%H%M%S)
sudo -u kiosco mv $PREV/next $APP/.next
sudo -u kiosco cp -p $PREV/build-info.json $APP/build-info.json
sudo -u kiosco cp -p $PREV/sw.js $APP/public/sw.js
sudo -u kiosco git -C $APP checkout $RAMA_ANTERIOR
sudo systemctl start kiosco
curl -s http://127.0.0.1:3099/api/health   # el commit anterior
```

Para el despliegue del 19 de octubre: `PREV=/srv/kiosco/releases/prev-20261019-221115`
(`2a11b76`), con la rama `feat/ux-v2-phase2-1-lista-navegacion` todavía en ese
commit.

**Después de un despliegue en el lugar**, con lo que guardó su paso 1 (sin
reconstruir):

```bash
APP=/srv/kiosco/app
PREV=/srv/kiosco/releases/prev-AAAAMMDD-HHMMSS        # el del despliegue a deshacer

sudo systemctl stop kiosco
sudo -u kiosco git -C $APP checkout "$(sudo cat $PREV/sha.txt)"
sudo -u kiosco rm -rf $APP/node_modules $APP/.next
sudo -u kiosco cp -a $PREV/node_modules $APP/node_modules
sudo -u kiosco cp -a $PREV/next $APP/.next
if sudo test -f $PREV/build-info.json; then
  sudo -u kiosco cp -p $PREV/build-info.json $APP/build-info.json
else
  sudo -u kiosco rm -f $APP/build-info.json
fi
if sudo test -f $PREV/sw.js; then sudo -u kiosco cp -p $PREV/sw.js $APP/public/sw.js; fi
sudo systemctl start kiosco
curl -s http://127.0.0.1:3099/api/health   # el commit anterior, o "desconocido"
```

**`build-info.json` también vuelve.** Vive fuera de `.next`. Si se restaura el
build viejo y se deja el `build-info.json` nuevo, `/api/health` informa el
commit nuevo mientras corre el viejo, que es justo la mentira que el archivo
vino a evitar. Pasó el 18 de octubre en una vuelta atrás automática y se
corrigió antes de seguir.

**Sin la copia del paso 1:** `checkout <SHA>` y repetir `npm ci` y build.

El `checkout` de un SHA deja el repositorio con la cabeza separada. Para el
despliegue siguiente, `git checkout <rama>` antes del `merge --ff-only`.

**Si la versión nueva trajo migraciones, esto no alcanza.** Prisma no
deshace migraciones: hay que restaurar la base desde el respaldo previo al
despliegue (abajo) y recién después mover el código.

## Respaldos

| Qué                                 | Dónde                              |
| ----------------------------------- | ---------------------------------- |
| Base (`pg_dump -Fc`)                | `/var/backups/kiosco/db/`          |
| Secretos y config                   | `/var/backups/kiosco/config/`      |
| Config del servidor                 | `/var/backups/kiosco/config-*/`    |
| Antes de cada despliegue (a mano)   | `/srv/kiosco/backups/pre-deploy-*` |
| Versión anterior, lista para volver | `/srv/kiosco/releases/prev-*`      |

**Antes de cada despliegue**, además del automático, un volcado propio con
nombre del despliegue. Los permisos son `600 kiosco:kiosco` y la carpeta es
`700`. `DATABASE_URL` sale del `.env` sin mostrarse. `pg_dump` no acepta el
`?schema=public` que lleva Prisma, así que se recorta:

```bash
TS=$(date -u +%Y%m%d-%H%M%S)
sudo install -d -m 700 -o kiosco -g kiosco /srv/kiosco/backups
sudo -u kiosco bash -c 'umask 077; set -a; . /srv/kiosco/app/.env; set +a;
  pg_dump --format=custom --no-password --file="$1" "${DATABASE_URL%%\?*}"' \
  _ /srv/kiosco/backups/pre-deploy-$TS.dump
sudo -u kiosco pg_restore --list /srv/kiosco/backups/pre-deploy-$TS.dump | head -5
```

Junto al volcado van copias del `.env`, de la unidad de systemd y de los vhosts
de Nginx, en `/srv/kiosco/backups/pre-deploy-$TS-config/`.

| Despliegue    | Respaldo previo                                      | Versión anterior, lista para volver          |
| ------------- | ---------------------------------------------------- | -------------------------------------------- |
| 18 de octubre | `pre-deploy-ux-v5-20261018-125545` (234.346 bytes)   | `6827064` en `releases/prev-20261018-130155` |
| 19 de octubre | `pre-deploy-teclado-20261019-220150` (234.799 bytes) | `2a11b76` en `releases/prev-20261019-221115` |

`releases/prev-20261019-220946` es del intento del 19 de octubre que volvió
atrás solo: tiene `sha.txt`, `build-info.json` y `sw.js`, no un `.next`.

- Automático: `kiosco-backup.timer`, todos los días a las **03:15 UTC**
  (00:15 en Argentina), con `Persistent=true` — si la máquina estaba apagada,
  corre al encender.
- Retención: **7 días**, en `/var/local` (disco de 45 GB, ~37 GB libres).
- Permisos `600 root:root`, directorio `700`.
- El script **comprueba que el volcado se pueda leer** (`pg_restore --list`),
  no solo que `pg_dump` haya salido con 0: un archivo truncado también sale
  con 0.

```bash
# Correr uno a mano
sudo systemctl start kiosco-backup.service
journalctl -u kiosco-backup -n 20 --no-pager

# Ver qué hay
sudo ls -lh /var/backups/kiosco/db/
```

### Restaurar

La base actual **no se borra antes de tener la restaurada comprobada**. El
procedimiento anterior empezaba con `dropdb kiosco`: con un volcado que no
restaurara, se quedaba sin la base de hoy y sin la de ayer.

```bash
# 1. Restaurar en una base NUEVA, con el servicio andando, y comprobarla.
sudo -u postgres createdb -O kiosco kiosco_restaurada
sudo -u postgres pg_restore -d kiosco_restaurada --no-owner --role=kiosco \
     /var/backups/kiosco/db/kiosco-AAAAMMDD-HHMMSS.dump
sudo -u postgres psql -d kiosco_restaurada -Atc 'SELECT count(*) FROM "Sale"'

# 2. Recién entonces, cambiar. La actual se RENOMBRA, no se borra.
sudo systemctl stop kiosco
sudo -u postgres psql -c 'ALTER DATABASE kiosco RENAME TO kiosco_anterior_AAAAMMDD'
sudo -u postgres psql -c 'ALTER DATABASE kiosco_restaurada RENAME TO kiosco'
sudo systemctl start kiosco
curl -s http://127.0.0.1:3099/api/health
```

`kiosco_anterior_*` se borra a mano cuando la restaurada ya esté en uso y
comprobada, no antes.

## Datos

El catálogo salió de `prisma/seed-demo.ts`, sembrado en una base auxiliar
`kiosco_seed_dev` (el seed **se niega** a correr contra una base que no
termine en `_dev`, y esa guarda no se tocó), limpiado allí y volcado a
`kiosco`.

**Por qué `TRUNCATE` y no `DELETE`:** diecisiete tablas llevan un trigger
`_inmutable` que rechaza `DELETE` y `UPDATE` fila por fila. Son libros
contables y la regla está bien puesta. `TRUNCATE` no dispara triggers de
fila, que es justo la distinción necesaria: esto no era corregir un asiento,
era reiniciar un entorno que todavía no abrió.

El libro de stock se reconstruyó con asientos `INITIAL` ("Carga inicial de
inventario") encadenados, uno por saldo de lote y uno por el remanente sin
atribuir. Sin eso, `BranchStock` habría quedado sin libro que lo explique y
`integrity:check` lo habría marcado. Resultado: **23/23 comprobaciones sin
inconsistencias**.

Las contraseñas del seed de demostración (la misma para diez usuarios, y está
en el repositorio, que es público) se reemplazaron: al `admin` una generada
en el servidor, a los otros nueve una aleatoria distinta que no se guardó en
ningún lado. No quedan inutilizados —el administrador puede resetearles la
clave desde **Usuarios**, desde la versión con el cambio de contraseñas en
la aplicación— pero nadie entra con la del repositorio.

## Seguridad del servidor

| Control          | Estado                                                  |
| ---------------- | ------------------------------------------------------- |
| Puertos públicos | 22, 80, 443 y nada más                                  |
| UFW              | activo, `deny (incoming)` por omisión                   |
| Fail2ban         | 3 jaulas: `sshd`, `nginx-limit-req`, `nginx-botsearch`  |
| Bloqueo          | 1 h de base, **creciente** (×2, hasta 1 semana)         |
| SSH root         | `PermitRootLogin no`                                    |
| SSH contraseña   | `PasswordAuthentication no` — solo clave pública        |
| Intentos SSH     | `MaxAuthTries 3`, `LoginGraceTime 30`                   |
| Base de datos    | solo `127.0.0.1:5432`, nunca expuesta                   |
| Aplicación       | solo `127.0.0.1:3099`, nunca expuesta                   |
| Actualizaciones  | `unattended-upgrades` activo, repos de seguridad y ESM  |
| `rpcbind`        | **deshabilitado** — 0 montajes NFS, nada dependía de él |
| Swap             | 2 GB, `vm.swappiness=10`, persistente en `/etc/fstab`   |
| Journal          | tope de 500 MB, retención 1 mes                         |

### Fail2ban también bloquea al que despliega

La jaula `sshd` no distingue entre un atacante y el operador. El 18 de
octubre, mientras el build tenía al servidor sin memoria, las conexiones SSH
se cortaron con timeouts y resets. Fail2ban bloqueó la IP del operador
durante una hora (13:07 a 14:07 UTC). Desde afuera se ve como un
`Connection timed out` en el puerto 22, mientras HTTPS sigue andando.

- Pocas conexiones y de a una. Nada de bucles que reintenten SSH cada pocos
  segundos ni sondas TCP sueltas al puerto 22.
- Lo largo, desatendido en el servidor (`nohup setsid`). Así un corte no
  obliga a reconectar a ciegas.
- Si el bloqueo ya ocurrió: esperar la hora. Si la IP ya había sido bloqueada
  antes, el bloqueo dura más (es creciente). Si hay otra vía de entrada, como
  otra IP o la consola de Oracle Cloud:
  `sudo fail2ban-client status sshd` y
  `sudo fail2ban-client set sshd unbanip <IP>`.

### Las dos capas de firewall

Oracle Cloud instala sus **propias** reglas iptables además de UFW. En la
imagen original la cadena `INPUT` tenía un `REJECT all` que se evaluaba
**antes** de las cadenas de UFW: abrir el 80 en UFW no servía de nada, y el
contador de la regla lo probaba —1178 paquetes rechazados, y las cadenas de
UFW con 0—. Se insertaron `ACCEPT` para 80 y 443 antes de ese `REJECT` y se
persistieron con `netfilter-persistent`.

Tras el reinicio el orden quedó al revés (UFW primero), pero las reglas están
en los dos caminos, así que el resultado es el mismo por cualquiera de ellos.

**Hay una tercera capa, fuera de la máquina:** la _Security List_ de la VCN.
Se administra desde la consola de Oracle Cloud y ninguna configuración del
servidor la sustituye.

### Si un cambio de seguridad molesta

La configuración original está en `/var/backups/kiosco/config-20260903-125046/`.
Se corrige la regla puntual que molesta —una jaula de Fail2ban, una opción de
SSH—, mirando ese respaldo. No hay receta para deshacer todo el
endurecimiento de una vez: tenerla a mano en un repositorio público no le
sirve a nadie de este lado.

## Nginx

- `/etc/nginx/sites-enabled/luchandopormas.com` — el vhost de
  `luchandopormas.com` y `www`. **Es un archivo, no un enlace, y no es el de
  Kiosco** (ver abajo).
- `/etc/nginx/sites-available/kiosco.nistal.net`, enlazado desde
  `sites-enabled/` — `kiosco.nistal.net` y `almacen.nistal.net`. Lo administra
  el plugin de Nginx de certbot y tiene tres bloques:
  - 443 para `kiosco.nistal.net`, con su certificado;
  - 443 para `almacen.nistal.net`, con el suyo;
  - 80 para los dos, que redirige a HTTPS.
- `/etc/nginx/conf.d/kiosco-global.conf` — zonas de límite y `server_tokens off`.
- El vhost `default` de Ubuntu **no se tocó**: sigue atendiendo cualquier otro nombre.

**`almacen.nistal.net` tiene bloque propio desde el 18 de octubre de 2026.**
Antes compartía el bloque 443 de `kiosco.nistal.net` y presentaba ese
certificado. El navegador daba error de certificado aunque la aplicación
respondía bien detrás. Ya existía un certificado de `almacen.nistal.net`, pero
ningún bloque lo usaba. Un bloque de Nginx tiene un solo certificado, así que
se separó en dos con las mismas `location`. La renovación se comprobó con
`certbot renew --dry-run --cert-name almacen.nistal.net`.

Al copiar un bloque `listen [::]:443 ssl ipv6only=on;`, el segundo va **sin**
`ipv6only=on`: ese parámetro se puede poner una sola vez por dirección y
puerto en toda la configuración.

### El vhost de `luchandopormas.com` es de otro proyecto

Revisado el 18 de octubre de 2026. El archivo activo,
`sites-enabled/luchandopormas.com`, lo escribió e instaló **otro proyecto del
servidor**: AMEIRAA / Cooperativa Jóvenes. Su encabezado dice que se instala
con el `deploy/install.sh` de ese proyecto y que su aplicación corre en
`127.0.0.1:3010` (`cooperativajovenes.service`).

En ese archivo alguien cambió a mano el `proxy_pass` a `3099`, y por eso el
dominio muestra Kiosco. La copia de `sites-available/luchandopormas.com`
todavía apunta a `3010`. El vhost original de Kiosco quedó guardado como
`sites-available/luchandopormas.com.previo-20261005`.

**El riesgo:** si ese otro proyecto vuelve a correr su instalador,
`luchandopormas.com` pasa a mostrar la otra aplicación y Kiosco desaparece de
ese dominio, sin tocar nada de Kiosco. `almacen.nistal.net` y
`kiosco.nistal.net` no dependen de ese archivo. Queda por decidir a qué
aplicación le corresponde el dominio.

### Límites y cabeceras

**`kiosco.nistal.net` y `almacen.nistal.net` los tienen desde el 18 de octubre
de 2026**, en los dos bloques 443. Son los del vhost original de Kiosco (la
copia `luchandopormas.com.previo-20261005`), con dos diferencias: HSTS sin
`includeSubDomains`, y el `X-Forwarded-For` reemplazado y no agregado, como ya
estaba.

| Qué                         | Valor                                                        |
| --------------------------- | ------------------------------------------------------------ |
| Todo el sitio               | `limit_req zone=kiosco_general burst=60 nodelay` (30 req/s)  |
| `/api/auth/login`           | `limit_req zone=kiosco_login burst=5 nodelay` (5 por minuto) |
| Conexiones                  | `limit_conn kiosco_conn 40`                                  |
| Cuerpo                      | `client_max_body_size 5m`                                    |
| `Strict-Transport-Security` | `max-age=31536000`                                           |
| `Content-Security-Policy`   | la original (abajo)                                          |

Comprobado ese día:

- **Login:** seis intentos seguidos desde una misma IP pasan y el séptimo
  recibe 429. La prueba se hizo desde el propio servidor, porque `127.0.0.1`
  está en el `ignoreip` de fail2ban.
- **Cuerpo:** 2 MB a `/api/products/import` llegan a la aplicación y 6 MB
  reciben 413. Antes no había `client_max_body_size`, y el valor por omisión
  de Nginx, **1 MB**, cortaba una importación de 10.000 productos (~1,2 MB de
  JSON).
- **CSP:** primero se puso como `Content-Security-Policy-Report-Only` y se
  recorrieron con sesión Inicio, Vender, Caja, Productos (con el alta),
  Importar, Precios, Stock, Movimientos, Inventario, Clientes, Reportes y
  Configuración. La única violación fue la sonda de `zod` 4:
  `try { Function("") } catch {}`. Con eso bloqueado, `zod` usa su camino sin
  `eval`, como dice su propio código. Después se pasó a `Content-Security-Policy`
  y las pantallas cargaron sin recursos fallidos ni de otros orígenes.

La CSP es:

```text
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none';
base-uri 'self'; form-action 'self'; object-src 'none'
```

Lleva `'unsafe-inline'` en `script-src` porque Next inyecta el estado de
hidratación como script en línea. Quitarlo pide nonces por petición, que es un
cambio en la aplicación y no en el proxy. `'unsafe-eval'` **no** está. Si una
pantalla nueva necesita algo de otro origen —una fuente, un mapa, un pago—, hay
que agregarlo acá. Para probar sin romper, conviene volver a
`Content-Security-Policy-Report-Only` y mirar la consola del navegador.

El vhost de antes y el de después están en
`/srv/kiosco/backups/pre-deploy-ux-v5-20261018-125545-config/`, como
`nginx__sites-available__kiosco.nistal.net.ANTES-LIMITES` y `.CON-LIMITES`.
Volver atrás es copiar el primero en su lugar, `nginx -t` y recargar.

Los 429 de estos dos dominios quedan en `kiosco-nistal.error.log`, y la jaula
`nginx-limit-req` de fail2ban mira solo `/var/log/nginx/error.log`. Nginx los
limita igual, pero fail2ban no banea a quien insiste. No se cambió.

**`luchandopormas.com` todavía no los tiene.** Su vhost es el de la Cooperativa
(arriba) y no se tocó:

- no aplica `limit_req` ni `limit_conn`;
- no manda `Strict-Transport-Security` ni `Content-Security-Policy`, porque
  supone que su aplicación las manda y Kiosco no lo hace (Kiosco sí manda
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` y
  `Permissions-Policy`, desde `next.config.ts`);
- el cuerpo máximo es de 15 MB;
- `/api/jobs/` responde 404, cosa que no afecta a Kiosco;
- si Kiosco está caído, el 502 muestra la página de error de la Cooperativa.

Igualarlo depende de decidir antes a quién le corresponde el dominio.

Después de cualquier cambio en Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Dos detalles de esta versión de Nginx

**`http2 on;` no existe en 1.18.** Esa forma llegó en 1.25.1. Acá va como
parámetro del listen: `listen 443 ssl http2;`. Con la sintaxis nueva, `nginx -t`
falla con `unknown directive "http2"`.

**Sin grapado OCSP.** Desde 2025 Let's Encrypt no publica la URL del
respondedor en sus certificados, y Nginx avisaba en cada recarga que ignoraba
`ssl_stapling`. Se quitaron las directivas: configuración muerta se retira, no
se silencia.

## HTTPS

| Dato       | Valor                                          |
| ---------- | ---------------------------------------------- |
| Emisor     | Let's Encrypt                                  |
| Nombres    | `luchandopormas.com`, `www.luchandopormas.com` |
| Emitido    | 2026-09-03                                     |
| Vence      | **2026-12-02**                                 |
| Renovación | `certbot.timer`, dos veces por día             |
| Método     | `webroot` sobre `/var/www/certbot`             |

Los de `kiosco.nistal.net` y `almacen.nistal.net` son dos certificados
separados, uno por nombre:

| Dato       | Valor                                                              |
| ---------- | ------------------------------------------------------------------ |
| Nombres    | `kiosco.nistal.net` y `almacen.nistal.net`, cada uno con el suyo   |
| Vencen     | **2027-01-12** los dos                                             |
| Renovación | `certbot.timer`; autenticador e instalador `nginx` (plugin)        |
| Comprobado | `certbot renew --dry-run --cert-name almacen.nistal.net`, 18/10/26 |

`certbot renew --dry-run` sin terminal espera un rato al azar, hasta unos 8
minutos, antes de empezar; parece colgado y no lo está. Para probar a mano,
`--no-random-sleep-on-renew`.

El certificado de `luchandopormas.com` se pidió con `certonly --webroot` **a
propósito**: el plugin de nginx reescribe el vhost, y no conviene que un
renovador automático toque ese archivo.

Como consecuencia, `options-ssl-nginx.conf` y `ssl-dhparams.pem` —que crea el
plugin— no existen. Los parámetros TLS están escritos en el vhost. No hace
falta `ssl_dhparam`: los cifradores son todos ECDHE.

El bloque `/.well-known/acme-challenge/` va **antes** de la redirección a
HTTPS. Si redirigiera, la validación HTTP-01 seguiría el 301 y la renovación
fallaría dentro de tres meses, sin nadie mirando.

`/etc/letsencrypt/renewal-hooks/deploy/recargar-nginx.sh` recarga Nginx tras
renovar. Sin ese hook la renovación funciona y el sitio sirve el certificado
viejo hasta el próximo reinicio.

```bash
sudo certbot certificates          # qué hay y cuándo vence
sudo certbot renew --dry-run       # probar la renovación sin gastarla
```

## Lo que hay que saber para el próximo despliegue

- **La `www` y el dominio pelado comparten certificado** pero no origen: `www`
  redirige con 301 al canónico. La cookie de sesión se emite por host, así que
  dos orígenes serían dos sesiones distintas.
- **El aviso de React #418** (hidratación) aparece en la consola del navegador.
  Es del código, no del despliegue, y no impide usar el sistema. Vale mirarlo
  cuando haya tiempo.
- **`luchandopormas.com` venció** en Hostinger el 18 de octubre de 2026 (se
  registró el 18 de octubre de 2024). Sus servidores de nombres pasaron a
  `ns1.dns-expired.com` y `ns2.dns-expired.com`, que lo apuntan a
  `2.57.91.92`: desde afuera no responde. Este servidor lo sigue sirviendo:
  `curl --resolve luchandopormas.com:443:127.0.0.1 https://luchandopormas.com/api/health`
  da 200. Se arregla renovándolo en Hostinger; acá no hay nada que tocar.
- **El health dice el commit.** Ante cualquier duda sobre qué está corriendo:
  `curl -s https://kiosco.nistal.net/api/health`.
- **Variables que se leen al atender** (cambiarlas es editar el `.env` y
  reiniciar, sin recompilar):
  - `COMMERCE_NAME` es el nombre del comercio. No está definida acá; vale
    `NEXT_PUBLIC_COMMERCE_NAME`.
  - `KIOSCO_HOSTS` son los dominios aceptados. Acá lleva los cuatro:
    `luchandopormas.com`, `www.luchandopormas.com`, `kiosco.nistal.net` y
    `almacen.nistal.net`. **Un dominio nuevo hay que agregarlo acá además de
    en Nginx**; si no, la aplicación contesta 421 "Host no reconocido".
  - `KIOSCO_FUNCIONES` no está definida, y eso es el modo almacén: sin Lotes ni
    Compras (órdenes, proveedores, devoluciones). `todas` las vuelve a mostrar;
    no borra datos, solo cambia lo que se ve.
  - Para otro comercio, ver [`ALTA_DE_INSTANCIA.md`](ALTA_DE_INSTANCIA.md).
- **systemd avisa en cada arranque** que ignora `StartLimitIntervalSec`. Esa
  clave va en `[Unit]` y no en `[Service]`, donde está. Como se ignora, el
  intervalo del límite de reinicios queda en el valor por omisión de systemd.
  Pendiente moverla; no se tocó la unidad.
- **Bots con nombres inventados**: más de mil respuestas 421 el 18 de octubre
  en el log de acceso. Es la lista de `KIOSCO_HOSTS` haciendo su trabajo, no un
  error. Lo mismo los `Server Reference ID did not match` del journal: son
  peticiones falsas de escáneres, no de usuarios.

## El fallo de `https://localhost:3099/login`

Vale contarlo porque la forma en que se escondió es reutilizable.

Abrir `https://luchandopormas.com/` desde un navegador terminaba con la barra
de direcciones en `https://localhost:3099/login`. El sitio era inusable.

**La causa** estaba en `src/middleware.ts`: `new URL('/login', req.url)`.
`req.url` **no se arma con la cabecera `Host`** — Next usa la dirección en la
que escucha el proceso, `127.0.0.1:3099`. Pedido a la aplicación sin Nginx
delante:

| Cabeceras enviadas            | `Location` que devolvía                                 |
| ----------------------------- | ------------------------------------------------------- |
| ninguna                       | `http://localhost:3099/login`                           |
| `Host: luchandopormas.com`    | `http://localhost:3099/login` ← la ignora               |
| `Host:` + `X-Forwarded-Proto` | `https://localhost:3099/login` ← solo cambia el esquema |

**Por qué la verificación anterior no lo vio:** se comprobó que
`/login` respondía 200 y se siguieron redirecciones sin mirar el `Location`.
Pero `/login` es la ruta pública, responde 200 y **nunca redirige**. El fallo
estaba en el salto desde `/`, que es exactamente por donde entra una persona.
Un 200 en la página de destino no dice nada del salto que lleva a ella.

**La corrección:** la URL se arma con el nombre público, tomado de
`X-Forwarded-Host`/`Host` y **validado contra una lista** antes de usarse. Un
`Location` relativo sería más simple y fue lo primero que se probó, pero Next
valida la cabecera y la rechaza (`TypeError: Invalid URL, input: '/login'`),
dejando la raíz en 500.

Como el nombre se valida antes, no hay confianza ciega en la cabecera: un
`Host` que no esté en la lista recibe **421** y no llega a construir nada.
Comprobado con `X-Forwarded-Host: evil.example` — la redirección sigue saliendo
al dominio real.

### Qué NO era

- **No estaba en el build.** Ningún `localhost:3099` en `.next/static` ni en
  `sw.js`; el `manifest.json` usa rutas relativas (`start_url: "/"`).
- **No estaba en el service worker.** La política de caché es una lista blanca
  y solo guarda `/offline` y estáticos con hash. Cero rutas privadas.
- **Ningún usuario tiene "localhost" guardado**: era un 307 generado en cada
  petición, y las redirecciones no se precachean. Nadie necesita limpiar nada.

Si aun así alguien quiere partir de cero en su navegador: DevTools →
Application → Service Workers → _Unregister_, y _Clear storage_. O una recarga
forzada con Ctrl-Shift-R. El `sw.js` se sirve con `cache-control: max-age=0` y
lleva `skipWaiting`/`clientsClaim`, así que la versión nueva entra sola en la
siguiente visita.

## Contraseña del administrador

No hay ninguna contraseña escrita en este repositorio, ni en la documentación,
ni en los registros. La de `admin` es una cadena aleatoria que **nadie conoce**.

Desde la versión con el cambio de contraseñas en la aplicación, el caso de
todos los días no pasa por acá: cada uno cambia la suya en **Configuración →
Contraseña**, y el dueño o un administrador resetea la de un empleado desde
**Usuarios**. Las dos cierran las sesiones abiertas y quedan en la bitácora.

El guion de abajo queda para cuando el que no puede entrar es el único que
administra. También cierra las sesiones abiertas de ese usuario:

```bash
cd /srv/kiosco/app
read -rs NUEVA
printf '%s' "$NUEVA" | sudo -u kiosco bash -lc 'cd /srv/kiosco/app && set -a && . ./.env && set +a && npx tsx scripts/establecer-clave.ts admin'
unset NUEVA
```

`read -rs` no muestra lo que se teclea y, al ser una variable del shell, no
queda en el historial. El guion la lee por entrada estándar: nunca viaja como
argumento, que sería visible en `ps` para cualquiera con una sesión abierta.

## kiosco.nistal.net y almacen.nistal.net

**Ya apuntan a este servidor.** Al 18 de octubre de 2026 los dos resuelven a
`129.213.133.204`, igual que `luchandopormas.com`. Antes `kiosco.nistal.net`
iba a `31.97.82.132`, el servidor que describe
[`PRODUCTION_CURRENT_STATE.md`](PRODUCTION_CURRENT_STATE.md).

Para comprobarlo hay que preguntarle a un DNS público. En una red con sufijo de
búsqueda, como `.com.ar`, el `nslookup` de Windows le agrega el sufijo al
nombre y devuelve una dirección que no tiene nada que ver:

```bash
nslookup kiosco.nistal.net. 8.8.8.8      # con el punto final, sin sufijos
```

Cada nombre tiene su certificado y su bloque 443 en
`/etc/nginx/sites-available/kiosco.nistal.net` (ver [Nginx](#nginx)), y los
dos están en `KIOSCO_HOSTS`. Para agregar otro nombre hacen falta las tres
cosas. Si falta el certificado, el navegador da error. Si falta el nombre en
`KIOSCO_HOSTS`, la aplicación contesta 421.

Estos dominios sirven la aplicación directamente, sin redirigir al canónico.
La aplicación no usa un framework de autenticación que exija una única URL: la
sesión es un JWT propio en una cookie por host, así que los tres nombres
funcionan por igual. `www` sí redirige, pero por otro motivo: `www` y el
dominio pelado son el mismo sitio, y dos orígenes serían dos sesiones distintas
para la misma persona.
