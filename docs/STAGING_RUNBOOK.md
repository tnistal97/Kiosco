# Staging: diseño y puesta en marcha

> **No se creó.** Crear staging exige escribir en el servidor —Nginx, PM2,
> PostgreSQL, certificados— y esta fase es de solo lectura. Esto es el
> procedimiento para hacerlo, con las decisiones ya tomadas.

## Para qué

Staging responde una pregunta que la suite no puede: **¿este artefacto, con esta
configuración, en esta máquina, funciona?**

La suite valida el código. Staging valida el **despliegue**. Una variable de
entorno mal puesta pasa las 1.446 pruebas y rompe el login.

Y para este proyecto tiene un uso más concreto: es donde se corre la migración
de 42 pasos **por primera vez sobre un servidor de verdad**, con el Node y el
PostgreSQL del servidor, y no sobre la máquina de desarrollo.

## La regla que no se negocia

**Staging NUNCA comparte la base con producción.**

Ni «solo para leer», ni «solo un ratito». Un smoke de staging abre turnos, cobra
ventas y las anula. Contra la base de producción eso es contabilidad falsa, y
este sistema **no borra ventas**: las anula, y la anulación también queda.

Lo mismo vale para el secreto de sesión: con el mismo `JWT_SECRET`, un token
emitido en staging abre sesión en producción.

## Qué se separa

|                   | Producción                        | Staging                                |
| ----------------- | --------------------------------- | -------------------------------------- |
| Dominio           | `kiosco.nistal.net`               | **`staging.kiosco.nistal.net`**        |
| Puerto            | 3099                              | **3098**                               |
| Proceso PM2       | `kiosco`                          | **`kiosco-staging`**                   |
| Base              | `kiosco`                          | **`kiosco_staging`**                   |
| Rol de PostgreSQL | `kiosco`                          | **`kiosco_staging`**                   |
| `.env`            | `/home/ubuntu/kiosco/kiosco/.env` | **`/home/ubuntu/kiosco-staging/.env`** |
| `JWT_SECRET`      | uno                               | **otro, distinto**                     |
| Sitio de Nginx    | `kiosco.nistal.net`               | **`staging.kiosco.nistal.net`**        |
| Certificado       | propio                            | **propio**                             |
| Logs              | `kiosco/logs/`                    | **`kiosco-staging/logs/`**             |

`NODE_ENV=production` **también en staging**. Lo que distingue a staging es la
base y el dominio, no el modo: con `development` se probaría otra cosa —otro
build, otras optimizaciones, sin service worker— y el ensayo no valdría.

## Qué datos

**Sintéticos, generados a partir de las métricas reales.** No una copia de
producción.

```bash
DATABASE_URL="postgresql://kiosco_staging:…@localhost:5432/kiosco_staging" \
  npm run seed:demo
```

Por qué no una copia: traería hashes de contraseñas y datos de personas a un
entorno con menos cuidado que producción, y para probar un despliegue no hacen
falta. Lo que hace falta es la **forma** y el **volumen**, y los dos están
medidos —ver [`PRODUCTION_DATA_PRECHECK.md`](PRODUCTION_DATA_PRECHECK.md)— y
reproducidos por `npm run rehearsal:prodlike`.

Si en algún momento se autoriza usar el volcado real, hay que sanitizar antes:
nombres, correos, teléfonos, documentos, CUIT, direcciones, notas libres y
**todos** los hashes de contraseña, conservando relaciones, fechas, cantidades e
importes. El objetivo es probar una migración, no reconstruir identidades.

## Puesta en marcha

Cada bloque **modifica el servidor**. Ninguno se ejecutó.

### 1 — DNS

Un registro `A` para `staging.kiosco.nistal.net` → `195.200.4.111`.

Se hace **primero**: certbot necesita resolver el nombre para emitir el
certificado.

### 2 — Base y rol

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE kiosco_staging LOGIN PASSWORD 'generar-uno-nuevo';
CREATE DATABASE kiosco_staging OWNER kiosco_staging;
SQL
```

**`OWNER kiosco_staging`, y esto es deliberado.** En producción el rol de la
aplicación no es dueño de nada, y por eso `migrate deploy` no puede correr con
él. En staging se hace bien desde el principio: el rol es dueño de su base,
puede crear tablas y disparadores, y las migraciones corren con la misma
credencial que usa la aplicación.

Que las dos configuraciones difieran hay que decirlo: staging no reproduce el
problema de privilegios de producción. Lo reproduce el punto 1 del cutover, que
es donde ese problema se resuelve.

### 3 — Directorio y configuración

```bash
mkdir -p /home/ubuntu/kiosco-staging/logs
chmod 750 /home/ubuntu/kiosco-staging

cat > /home/ubuntu/kiosco-staging/.env <<'EOF'
NODE_ENV=production
PORT=3098
DATABASE_URL=postgresql://kiosco_staging:...@localhost:5432/kiosco_staging?schema=public
JWT_SECRET=<openssl rand -base64 48>
EOF
chmod 600 /home/ubuntu/kiosco-staging/.env
```

`600` desde el primer día. Los permisos de producción hoy son `666`, y así es
como se llega ahí: nadie decide dejarlos abiertos, simplemente nunca se
cierran.

### 4 — Desplegar el artefacto

```bash
cd /home/ubuntu/kiosco-staging
sha256sum -c kiosco-1.0.0-rc.1-<commit>.tar.gz.sha256   # ANTES de descomprimir
tar -xzf kiosco-1.0.0-rc.1-<commit>.tar.gz
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
```

El artefacto **no** trae `node_modules` —serían 1,6 GB— así que `npm ci` corre
en el servidor. Es la única parte que sigue dependiendo de la red, y por eso va
**antes** de cualquier corte, no durante.

### 5 — PM2

```js
// /home/ubuntu/kiosco-staging/ecosystem.config.js  —  SIN secretos adentro
module.exports = {
  apps: [
    {
      name: 'kiosco-staging',
      cwd: '/home/ubuntu/kiosco-staging',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3098',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true, // marca de tiempo en cada línea
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s', // arrancar y morir 10 veces no es "reiniciar"
    },
  ],
}
```

```bash
cd /home/ubuntu/kiosco-staging
pm2 start ecosystem.config.js
pm2 save
```

**Sin bloque `env`.** Los secretos van en `.env`, que se puede poner en `600`.
Lo que está en `ecosystem.config.js` termina además copiado dentro de
`~/.pm2/dump.pm2`, que es otro archivo más donde el secreto sobrevive sin que
nadie lo mire.

Tres campos que el ecosystem actual de producción no tiene y convienen:
`time`, `max_restarts` y `min_uptime`.

### 6 — Nginx

```nginx
map $http_upgrade $conexion_upgrade {
  default upgrade;
  ''      close;
}

server {
  server_name staging.kiosco.nistal.net;

  # Staging no se indexa. Es un sistema de pruebas con datos falsos.
  add_header X-Robots-Tag "noindex, nofollow" always;
  add_header Strict-Transport-Security "max-age=31536000" always;

  client_max_body_size 10m;

  location / {
    proxy_pass         http://127.0.0.1:3098;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection $conexion_upgrade;   # ← con map, no fijo
    proxy_read_timeout 60s;
  }

  listen 443 ssl;
  # certbot completa las líneas de certificado
}

server {
  if ($host = staging.kiosco.nistal.net) { return 301 https://$host$request_uri; }
  server_name staging.kiosco.nistal.net;
  listen 80;
  return 404;
}
```

Tres diferencias respecto del sitio de producción, y las tres son mejoras que
después conviene llevar allá: el `map` para `Connection`, `HSTS`, y
`proxy_read_timeout` explícito. **No se copia** el bloqueo genérico de
`multipart/form-data`.

```bash
ln -s /etc/nginx/sites-available/staging.kiosco.nistal.net /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d staging.kiosco.nistal.net
```

### 7 — Comprobar

```bash
export SMOKE_BASE_URL=https://staging.kiosco.nistal.net
export SMOKE_USER=…
export SMOKE_PASSWORD=…
npm run smoke:staging
```

Y la reconciliación, que es lo que dice si los libros cierran:

```bash
DATABASE_URL="postgresql://kiosco_staging:…" npm run integrity:check
```

## Qué se prueba acá y no en otro lado

|                                                           | Lo prueba            |
| --------------------------------------------------------- | -------------------- |
| El código está bien                                       | la suite             |
| La migración aplica sobre datos con la forma real         | `rehearsal:prodlike` |
| **El artefacto arranca en el servidor**                   | **staging**          |
| **Nginx enruta y el certificado sirve**                   | **staging**          |
| **PM2 lo levanta solo tras un reinicio**                  | **staging**          |
| **Node 18 del servidor corre un build hecho con Node 24** | **staging**          |
| **Los permisos de la base alcanzan para migrar**          | **staging**          |

Los dos últimos son los que justifican el esfuerzo. Todo lo demás ya está
demostrado en la máquina de desarrollo.

## Mantenimiento

- **Se rehace, no se arregla.** Staging es descartable: ante la duda, borrar la
  base, sembrar de nuevo, desplegar el artefacto.
- **Se actualiza antes que producción**, siempre. Un artefacto que no pasó por
  staging no va a producción.
- **Los datos son falsos y hay que poder decirlo en voz alta.** El día que
  alguien cargue algo real en staging, staging deja de ser descartable y deja de
  servir.
