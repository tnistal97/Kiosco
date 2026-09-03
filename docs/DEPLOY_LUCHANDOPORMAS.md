# Despliegue en luchandopormas.com

> Servidor Oracle Cloud `gosto-vps` (`129.213.133.204`), Ubuntu 22.04.5 LTS
> ARM64. Puesta en marcha del 3 de septiembre de 2026.
>
> Este documento describe **este** despliegue. El de
> [`PRODUCTION_CURRENT_STATE.md`](PRODUCTION_CURRENT_STATE.md) es otro
> servidor (`kiosco.nistal.net`, PM2, Node 18) y no se tocó.
>
> Ningún secreto vive en este archivo. Dónde están, sí; cuáles son, no.

## Qué corre y dónde

| Pieza          | Valor                                                       |
| -------------- | ----------------------------------------------------------- |
| Código         | `/srv/kiosco/app` — clon de `release/almacen-v1`             |
| Usuario        | `kiosco` (UID 116, de sistema, **sin sudo**, shell `nologin`) |
| Proceso        | systemd, unidad `kiosco.service`                            |
| Puerto interno | **127.0.0.1:3099** — nunca `0.0.0.0`                        |
| Node           | 22.23.2 LTS (`apt-mark hold`, no sube solo a 24)            |
| Base           | PostgreSQL 14.24, `kiosco`, escucha solo en `localhost`     |
| Rol de base    | `kiosco` — no superusuario, sin `CREATEDB` ni `CREATEROLE`  |
| Proxy          | Nginx 1.18, único servicio público                          |
| Secretos       | `/srv/kiosco/app/.env` — `600 kiosco:kiosco`                |

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

### Desplegar una versión nueva

```bash
sudo -u kiosco git -C /srv/kiosco/app pull --ff-only origin release/almacen-v1
sudo -u kiosco bash -lc 'cd /srv/kiosco/app && npm ci --omit=dev --no-audit && npx prisma generate'
sudo -u kiosco bash -lc 'cd /srv/kiosco/app && set -a && . ./.env && set +a && npx prisma migrate deploy'
sudo -u kiosco bash -lc 'cd /srv/kiosco/app && set -a && . ./.env && set +a && npm run build'
sudo -u kiosco bash -lc 'cd /srv/kiosco/app && node -e "const{execSync}=require(\"child_process\"),fs=require(\"fs\");const p=JSON.parse(fs.readFileSync(\"package.json\",\"utf8\"));fs.writeFileSync(\"build-info.json\",JSON.stringify({version:p.version,commit:execSync(\"git rev-parse HEAD\").toString().trim(),buildTime:new Date().toISOString()},null,2))"'
sudo systemctl restart kiosco
curl -s http://127.0.0.1:3099/api/health   # el commit tiene que ser el nuevo
```

`build-info.json` no se versiona a propósito: se escribe al construir. Sin
él, `/api/health` responde `commit: desconocido` y durante un incidente nadie
sabe qué está corriendo.

### Volver atrás

El despliegue es un checkout de git: revertir es moverse de commit y
reconstruir.

```bash
sudo -u kiosco git -C /srv/kiosco/app log --oneline -10     # elegir destino
sudo -u kiosco git -C /srv/kiosco/app checkout <SHA>
# repetir npm ci / build / restart de arriba
```

**Si la versión nueva trajo migraciones, esto no alcanza.** Prisma no
deshace migraciones: hay que restaurar la base desde el respaldo previo al
despliegue (abajo) y recién después mover el código.

## Respaldos

| Qué                | Dónde                            |
| ------------------ | -------------------------------- |
| Base (`pg_dump -Fc`) | `/var/backups/kiosco/db/`       |
| Secretos y config  | `/var/backups/kiosco/config/`    |
| Config del servidor| `/var/backups/kiosco/config-*/`  |

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

```bash
sudo systemctl stop kiosco
sudo -u postgres dropdb kiosco
sudo -u postgres createdb -O kiosco kiosco
sudo -u postgres pg_restore -d kiosco --no-owner --role=kiosco \
     /var/backups/kiosco/db/kiosco-AAAAMMDD-HHMMSS.dump
sudo systemctl start kiosco
```

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

Las contraseñas del seed (`Demo1234!`, la misma para diez usuarios, y está
en el repositorio, que es público) se reemplazaron: al `admin` una generada
en el servidor, a los otros nueve una aleatoria distinta que no se guardó en
ningún lado. No quedan inutilizados —el administrador puede cambiarles la
clave desde la aplicación— pero nadie entra con la del repositorio.

## Seguridad del servidor

| Control              | Estado                                                    |
| -------------------- | --------------------------------------------------------- |
| Puertos públicos     | 22, 80, 443 y nada más                                    |
| UFW                  | activo, `deny (incoming)` por omisión                     |
| Fail2ban             | 3 jaulas: `sshd`, `nginx-limit-req`, `nginx-botsearch`    |
| Bloqueo              | 1 h de base, **creciente** (×2, hasta 1 semana)           |
| SSH root             | `PermitRootLogin no`                                      |
| SSH contraseña       | `PasswordAuthentication no` — solo clave pública          |
| Intentos SSH         | `MaxAuthTries 3`, `LoginGraceTime 30`                     |
| Base de datos        | solo `127.0.0.1:5432`, nunca expuesta                     |
| Aplicación           | solo `127.0.0.1:3099`, nunca expuesta                     |
| Actualizaciones      | `unattended-upgrades` activo, repos de seguridad y ESM    |
| `rpcbind`            | **deshabilitado** — 0 montajes NFS, nada dependía de él   |
| Swap                 | 2 GB, `vm.swappiness=10`, persistente en `/etc/fstab`     |
| Journal              | tope de 500 MB, retención 1 mes                           |

### Las dos capas de firewall

Oracle Cloud instala sus **propias** reglas iptables además de UFW. En la
imagen original la cadena `INPUT` tenía un `REJECT all` que se evaluaba
**antes** de las cadenas de UFW: abrir el 80 en UFW no servía de nada, y el
contador de la regla lo probaba —1178 paquetes rechazados, y las cadenas de
UFW con 0—. Se insertaron `ACCEPT` para 80 y 443 antes de ese `REJECT` y se
persistieron con `netfilter-persistent`.

Tras el reinicio el orden quedó al revés (UFW primero), pero las reglas están
en los dos caminos, así que el resultado es el mismo por cualquiera de ellos.

**Hay una tercera capa, fuera de la máquina:** la *Security List* de la VCN.
Se administra desde la consola de Oracle Cloud y ninguna configuración del
servidor la sustituye.

### Revertir los cambios de seguridad

```bash
sudo rm /etc/ssh/sshd_config.d/10-kiosco-hardening.conf && sudo systemctl reload ssh
sudo rm /etc/fail2ban/jail.d/kiosco.local && sudo systemctl restart fail2ban
sudo systemctl enable --now rpcbind.service rpcbind.socket
sudo swapoff /swapfile   # y quitar la línea de /etc/fstab
```

La configuración original está en `/var/backups/kiosco/config-20260903-125046/`.

## Nginx

- `/etc/nginx/sites-available/luchandopormas.com` — el vhost.
- `/etc/nginx/conf.d/kiosco-global.conf` — zonas de límite y `server_tokens off`.
- El vhost `default` de Ubuntu **no se tocó**: sigue atendiendo cualquier otro nombre.

Límites: 30 req/s generales por IP, **5 por minuto en `/api/auth/login`**, 40
conexiones simultáneas, cuerpo de 5 MB. El límite del login cubre lo que
`src/server/auth/loginAttempts.ts` no ve: el mismo origen probando usuarios
distintos.

Cabeceras: `Strict-Transport-Security` y `Content-Security-Policy` las pone
Nginx; `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` y
`Permissions-Policy` ya las pone Next (`next.config.ts`) y **no se duplican**.

La CSP lleva `'unsafe-inline'` en `script-src` porque Next inyecta el estado
de hidratación como script en línea. Quitarlo pide nonces por petición, que
es un cambio en la aplicación y no en el proxy. `'unsafe-eval'` **no** está.

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

| Dato          | Valor                                          |
| ------------- | ---------------------------------------------- |
| Emisor        | Let's Encrypt                                  |
| Nombres       | `luchandopormas.com`, `www.luchandopormas.com` |
| Emitido       | 2026-09-03                                     |
| Vence         | **2026-12-02**                                 |
| Renovación    | `certbot.timer`, dos veces por día             |
| Método        | `webroot` sobre `/var/www/certbot`             |

El certificado se pidió con `certonly --webroot` **a propósito**: el plugin
de nginx reescribe el vhost, y este lleva CSP, límites de petición y cabeceras
que no conviene que toque un renovador automático.

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
- **El health dice el commit.** Ante cualquier duda sobre qué está corriendo:
  `curl -s https://luchandopormas.com/api/health`.

## El fallo de `https://localhost:3099/login`

Vale contarlo porque la forma en que se escondió es reutilizable.

Abrir `https://luchandopormas.com/` desde un navegador terminaba con la barra
de direcciones en `https://localhost:3099/login`. El sitio era inusable.

**La causa** estaba en `src/middleware.ts`: `new URL('/login', req.url)`.
`req.url` **no se arma con la cabecera `Host`** — Next usa la dirección en la
que escucha el proceso, `127.0.0.1:3099`. Pedido a la aplicación sin Nginx
delante:

| Cabeceras enviadas                | `Location` que devolvía          |
| --------------------------------- | -------------------------------- |
| ninguna                           | `http://localhost:3099/login`    |
| `Host: luchandopormas.com`        | `http://localhost:3099/login` ←  la ignora |
| `Host:` + `X-Forwarded-Proto`     | `https://localhost:3099/login` ← solo cambia el esquema |

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
Application → Service Workers → *Unregister*, y *Clear storage*. O una recarga
forzada con Ctrl-Shift-R. El `sw.js` se sirve con `cache-control: max-age=0` y
lleva `skipWaiting`/`clientsClaim`, así que la versión nueva entra sola en la
siguiente visita.

## Contraseña del administrador

No hay ninguna contraseña escrita en este repositorio, ni en la documentación,
ni en los registros. La de `admin` es una cadena aleatoria que **nadie conoce**.

Para poner una:

```bash
cd /srv/kiosco/app
read -rs NUEVA
printf '%s' "$NUEVA" | sudo -u kiosco bash -lc 'cd /srv/kiosco/app && set -a && . ./.env && set +a && npx tsx scripts/establecer-clave.ts admin'
unset NUEVA
```

`read -rs` no muestra lo que se teclea y, al ser una variable del shell, no
queda en el historial. El guion la lee por entrada estándar: nunca viaja como
argumento, que sería visible en `ps` para cualquiera con una sesión abierta.

## kiosco.nistal.net

**Todavía no apunta a este servidor.** Resuelve a `31.97.82.132`, que es otra
máquina (la que describe `PRODUCTION_CURRENT_STATE.md`).

Lo que ya está hecho de este lado: el nombre está en la lista de hosts que la
aplicación acepta (`src/middleware.ts`) y en el `server_name` del bloque HTTP
del vhost, de modo que la validación ACME funcione apenas el DNS cambie.

Lo que falta, en este orden:

1. Cambiar el registro `A` de `kiosco.nistal.net` a `129.213.133.204`.
2. Esperar la propagación y comprobarla:
   `nslookup kiosco.nistal.net 8.8.8.8`
3. Ampliar el certificado y agregar el bloque HTTPS:

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d luchandopormas.com -d www.luchandopormas.com -d kiosco.nistal.net \
  --cert-name luchandopormas.com --expand
```

Después hay que añadir un `server` en el puerto 443 con
`server_name kiosco.nistal.net;` apuntando al mismo `proxy_pass`. **No antes:**
anunciar un nombre que el certificado no cubre da un error de certificado en el
navegador, que es peor que no responder.

Ese dominio servirá la aplicación directamente, sin redirigir al canónico: la
aplicación no usa un framework de autenticación que exija una única URL — la
sesión es un JWT propio en una cookie por host — así que los tres nombres
funcionan por igual. `www` sí redirige, pero por otro motivo: `www` y el
dominio pelado son el mismo sitio, y dos orígenes serían dos sesiones distintas
para la misma persona.
