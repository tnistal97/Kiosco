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
