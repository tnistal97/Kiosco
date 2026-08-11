# Estado real de producción

> Medido el **11 de agosto de 2026**, entre las 19:05 y las 19:50 (−03), en
> **modo lectura**. No se modificó nada en el servidor: ni un archivo, ni un
> permiso, ni un proceso, ni una fila.
>
> Este documento describe lo que **hay**, no lo que debería haber. Las acciones
> que hacen falta están en [`PRODUCTION_CUTOVER.md`](PRODUCTION_CUTOVER.md) y en
> [`SECRET_ROTATION_PLAN.md`](SECRET_ROTATION_PLAN.md).

## Lo primero, porque cambia todo lo demás

**La aplicación no está corriendo.** El proceso `kiosco` de PM2 figura
`stopped`, nada escucha en el puerto 3099, y `https://kiosco.nistal.net`
devuelve **502**.

Eso reencuadra la fase entera: esto no es una migración de un sistema en
producción con usuarios adentro. Es la **puesta en marcha de un sistema
detenido**, con seis meses de datos históricos que hay que conservar.

Dos consecuencias prácticas, y las dos son buenas:

- **No hay ventana de mantenimiento que negociar.** No hay nadie vendiendo. El
  corte no interrumpe nada porque no hay nada que interrumpir.
- **No hay usuarios que puedan escribir durante la migración**, así que el
  riesgo de una escritura a mitad de camino —el más difícil de manejar— no
  existe.

La contracara: el sistema lleva meses caído y nadie lo notó, lo que dice algo
sobre cuánto se usaba. Vale la pena confirmarlo antes de invertir una ventana
en encenderlo.

## Aplicación

|                          |                                                                     |
| ------------------------ | ------------------------------------------------------------------- |
| Estado PM2               | **`stopped`** (id 7, namespace `default`)                           |
| Reinicios                | 0 · `unstable_restarts` 0                                           |
| Creado                   | 2025-11-10T15:42Z                                                   |
| Ruta                     | `/home/ubuntu/kiosco/kiosco`                                        |
| Script                   | `node_modules/next/dist/bin/next` · args `start -p 3099`            |
| Modo                     | `fork`, 1 instancia                                                 |
| `NODE_ENV`               | `production`                                                        |
| Node del proceso         | 18.20.3                                                             |
| Next.js                  | 15.3.8                                                              |
| `@prisma/client`         | 6.8.2 en `package.json`; los logs muestran 6.19.0 en ejecución      |
| Build                    | `.next/BUILD_ID` = `JZYZuJYkVXxoXvsxHCV8K`, del **12-dic-2025**     |
| Logs                     | `logs/out.log`, `logs/error.log`, rotados por `pm2-logrotate` 2.7.0 |
| Última actividad en logs | **5-feb-2026**                                                      |
| Tamaño del checkout      | 1,8 GB (`node_modules` 1,6 GB · `.next` 140 MB)                     |

### Por qué se detuvo

El último log de errores (`error__2026-01-22`) está lleno de una sola cosa:

```
PrismaClientUnknownRequestError
  code: "42501", message: "permission denied for table User"
  at .next/server/app/api/auth/login/route.js
```

El rol `kiosco` no tenía privilegios sobre las tablas y **nadie podía iniciar
sesión**. Hoy esos privilegios **sí existen** (`SELECT, INSERT, UPDATE, DELETE`
sobre las 14 tablas, `USAGE` sobre el esquema y las 13 secuencias, más
`DEFAULT PRIVILEGES` para lo que cree `postgres`). Alguien los concedió después.
No queda registro de cuándo.

### Qué commit está desplegado

**No se puede saber con certeza.** El checkout **no es un repositorio git**:

```
$ cd /home/ubuntu/kiosco/kiosco && git log
fatal: not a git repository
```

Se copió sin `.git`. Lo único que se puede afirmar es lo que dice
[`RECOVERY.md`](../RECOVERY.md): este código es el origen del que se recuperó el
repositorio el 6-ago-2026, y corresponde a diciembre de 2025.

Es exactamente el problema que resuelve `build-info.json` en el artefacto nuevo:
a partir de esta release, `GET /api/health` contesta esta pregunta.

## Nginx

Configuración en `/etc/nginx/sites-available/kiosco.nistal.net`, enlazada en
`sites-enabled`. Nginx 1.24.0 (Ubuntu).

|                        |                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Dominio                | `kiosco.nistal.net`                                                                  |
| Upstream               | `http://127.0.0.1:3099`                                                              |
| HTTP → HTTPS           | sí, `301`                                                                            |
| TLS                    | Let's Encrypt, `CN=kiosco.nistal.net`, válido hasta **4-nov-2026**                   |
| Renovación             | `certbot.timer` activo, próxima 12-ago 07:42                                         |
| Protocolos             | TLSv1.2 y TLSv1.3 (vía `options-ssl-nginx.conf`)                                     |
| `client_max_body_size` | 10 MB                                                                                |
| Cabeceras al upstream  | `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Upgrade`, `Connection` |

### Hallazgos (ninguno corregido; ver severidad)

- **MEDIA — `Connection "upgrade"` incondicional.** Se manda siempre, también
  cuando `$http_upgrade` viene vacío, que es el 100 % del tráfico real: la
  aplicación no usa WebSockets. La forma correcta es un `map`. Hoy no rompe
  nada visible, pero es una cabecera mentida en cada petición.
- **MEDIA — sin cabeceras de seguridad en Nginx.** No hay `Strict-Transport-Security`,
  ni `X-Content-Type-Options`, ni `X-Frame-Options`, ni `Referrer-Policy`. La
  aplicación pone las tres últimas desde `next.config.ts`, así que llegan
  igual; **HSTS no lo pone nadie**, y esa sí falta de verdad.
- **MEDIA — bloqueo genérico de `multipart/form-data`.** `if ($http_content_type
~* "multipart/form-data") { return 403; }`. Hoy no molesta porque la
  aplicación no sube archivos, pero es una trampa esperando: la primera carga de
  imágenes de producto va a fallar con un 403 sin explicación.
- **BAJA — `if ($http_next_action) { return 403; }`.** Bloquea Server Actions.
  Este proyecto no las usa —todo pasa por rutas de API— así que hoy es inocuo.
- **BAJA — sin `proxy_read_timeout` explícito.** Queda en los 60 s por omisión.
- **INFORMATIVA — `gzip on` sin `gzip_types`.** Solo comprime `text/html`.
- **INFORMATIVA — el `nginx.conf` global declara `ssl_protocols TLSv1 TLSv1.1
TLSv1.2 TLSv1.3`.** Para este sitio no aplica —`options-ssl-nginx.conf` lo
  pisa— pero cualquier sitio del servidor que no lo incluya queda con TLS 1.0.

## PostgreSQL

|                               |                                                            |
| ----------------------------- | ---------------------------------------------------------- |
| Versión                       | **16.14** (Ubuntu 16.14-0ubuntu0.24.04.1)                  |
| Escucha                       | `127.0.0.1:5432` y `[::1]:5432` — **no** expuesto a la red |
| Base                          | `kiosco`, **11 MB**                                        |
| Esquema                       | `public`, único                                            |
| Dueño de la base              | `postgres`                                                 |
| Usuario de la aplicación      | `kiosco` (solo el nombre; no superusuario, sin `CREATEDB`) |
| Zona horaria                  | `America/Argentina/Buenos_Aires`                           |
| Conexiones                    | 8 de 100                                                   |
| Extensiones                   | solo `plpgsql`                                             |
| Migraciones registradas       | **1**                                                      |
| Tablas · índices · secuencias | 14 · 22 · 13                                               |
| Disparadores · funciones      | **0** · **0**                                              |

### La migración registrada

```
20250605201717_add_value_to_product
checksum 2d0b96bae545e25e521fa398a1f5cabd363feb4f2ca4ebe9f30cb68b7bfbd3f0
```

**Coincide exactamente con el `sha256` del archivo local.** Es la mejor noticia
de esta auditoría: la cadena de 43 migraciones arranca desde donde produccion
está, sin conflicto de checksum, y `prisma migrate deploy` no va a negarse.

Se comparó además el `pg_dump --schema-only` de producción contra lo que produce
esa migración: **14 tablas, 13 secuencias, 8 índices únicos, cero objetos
extra**. No hay deriva: nadie tocó el esquema a mano.

### El bloqueo que impide migrar

```sql
SELECT has_schema_privilege('kiosco','public','CREATE');  -- false
SELECT count(*) FROM pg_tables
 WHERE schemaname='public' AND tableowner='kiosco';       -- 0
```

El rol `kiosco` **no puede crear objetos en el esquema** y **no es dueño de
ninguna tabla**. Corriendo `prisma migrate deploy` con ese rol:

1. el primer `CREATE TABLE` falla con `42501`;
2. aunque se concediera `CREATE`, un no-dueño **no puede** `ALTER TABLE` ni
   `CREATE TRIGGER` sobre tablas de `postgres`, y la cadena crea 4 disparadores.

**Hay que decidir con qué rol se migra, y esa decisión requiere escribir en
producción.** Es un BLOQUEANTE y está en
[`PRODUCTION_CUTOVER.md`](PRODUCTION_CUTOVER.md) con las dos opciones.

## Sistema

|              |                                                                        |
| ------------ | ---------------------------------------------------------------------- |
| Host         | `srv546281` · `195.200.4.111`                                          |
| OS           | Ubuntu 24.04 LTS (Noble), kernel 6.8.0-134                             |
| Zona horaria | `America/Argentina/Buenos_Aires` (−03), NTP activo, reloj sincronizado |
| Uptime       | 35 días                                                                |
| Node         | **18.20.3**                                                            |
| npm          | 10.7.0                                                                 |
| PM2          | 5.4.2 (+ `pm2-logrotate` 2.7.0), `pm2-root` habilitado al arranque     |
| git          | 2.43.0                                                                 |
| RAM          | 7,8 GiB · 1,6 usados · **6,1 disponibles** · **sin swap**              |
| Disco `/`    | 96 GB · 46 usados · **51 libres (48 %)**                               |
| Acceso       | SSH con clave, `root`                                                  |

### El servidor es compartido

PM2 administra **11 aplicaciones**, de las cuales 6 están online:
`back`, `backend-brasil`, `constructora2v`, `nextjs-brasil`, `salon-v2-turnos`,
`vyvgroup`. Y PostgreSQL aloja **22 bases**, la mayor de 286 MB.

Consecuencias concretas para esta release:

- **Los recursos se comparten.** Una medición de rendimiento hecha en el
  servidor mide también lo que hagan las otras seis aplicaciones.
- **`postgres` es la misma instancia para todas.** Un `pg_dump` pesado o un
  bloqueo largo afecta a los otros nueve sistemas.
- **Sin swap y con 6,1 GiB libres**, el margen es cómodo pero no infinito.
- Hay un proxy SOCKS (`danted`, puerto 43210) y un Squid (3128) escuchando en
  la interfaz pública. **No son de este proyecto**, pero están en la misma
  máquina que la base de datos del comercio.

## Permisos de archivos

Esto es lo más grave que se encontró, y no tiene que ver con el código.

```
drwxr-x--x  ubuntu  /home/ubuntu
drwxrwxrwx  root    /home/ubuntu/kiosco/kiosco      777
-rw-rw-rw-  root    /home/ubuntu/kiosco/kiosco/.env 666
-rw-r--r--  root    /home/ubuntu/kiosco/kiosco/ecosystem.config.js 644
```

- `/home/ubuntu` tiene el bit `x` para todos: **se puede atravesar**.
- El directorio del proyecto es **777**: cualquier usuario del sistema puede
  crear, renombrar y borrar archivos ahí, incluido `.next`.
- El `.env` es **666**: cualquiera lo **lee y lo escribe**. Contiene
  `DATABASE_URL` y `JWT_SECRET`.
- `ecosystem.config.js` es **644** y lleva los mismos dos valores adentro.

En un servidor con diez sistemas de terceros, esto es **BLOQUEANTE**.

## Los secretos, medidos sin mostrarlos

| Secreto          | Dónde                 | Medida                              | Veredicto                     |
| ---------------- | --------------------- | ----------------------------------- | ----------------------------- |
| `JWT_SECRET`     | `.env`                | 14 caracteres                       | **inválido**: el mínimo es 32 |
| `JWT_SECRET`     | `ecosystem.config.js` | 9 caracteres                        | **inválido** — es `change-me` |
| `DATABASE_URL`   | los dos archivos      | idéntico (huella `c3f38191`)        | ver abajo                     |
| Clave de la base | `.env`                | 8 caracteres, huella **`d858acb4`** | **comprometida**              |

Los dos `JWT_SECRET` **difieren entre sí**, y PM2 usa el de
`ecosystem.config.js`. Con 9 caracteres, `src/server/auth/token.ts` se niega a
firmar: **si la aplicación se encendiera hoy, el login devolvería 500.**

Y el hallazgo que ordena la lista de tareas: la clave de la base de producción
tiene la **misma huella** que la credencial que estuvo en `scrap.py` en un
repositorio **público** desde mayo de 2025, y que **sigue** en el historial de
Git y en la rama publicada `origin/backup/github-before-server-recovery-20260806-0928`.

Ninguna clave se imprimió, se copió ni se probó. Comparar huellas MD5 calculadas
en cada lado alcanza para saber que son la misma sin mover el secreto de sitio.
Ver [`SECRET_ROTATION_PLAN.md`](SECRET_ROTATION_PLAN.md).

## Respaldos

En `/home/ubuntu` hay volcados sueltos del **8-dic-2025**:

```
kiosco_23-49.sql     1,3 MB
gerardo_23-49.sql     25 MB
brasil_23-49.sql      84 KB
salonbellezaBack.sql  50 KB
```

- **No hay respaldos automáticos.** `crontab -l` de `root` está vacío, sin una
  sola tarea. Los cuatro archivos son de un día puntual.
- El más nuevo tiene **ocho meses**.
- Están en el mismo disco que la base: un fallo del disco se los lleva a los dos.
- `kiosco_23-49.sql` **no se descargó ni se leyó**. Existe y podría servir como
  copia autorizada de datos, pero bajarlo trae hashes de contraseña y datos de
  personas, y para probar la migración no hace falta —ver
  [el ensayo con volumen](../scripts/rehearsal-produccion.ts)—. **Es una decisión
  tuya**, no una que corresponda tomar en modo lectura.

## Resumen por severidad

| Sev.            | Hallazgo                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| **BLOQUEANTE**  | La clave de la base de producción estuvo en un repositorio público y sigue en el historial y en una rama publicada |
| **BLOQUEANTE**  | `.env` con permisos 666 y directorio 777 en un servidor con diez sistemas de terceros                              |
| **BLOQUEANTE**  | `JWT_SECRET` de 9 y 14 caracteres: por debajo del mínimo. El login fallaría                                        |
| **BLOQUEANTE**  | El rol `kiosco` no puede crear objetos ni es dueño de las tablas: `migrate deploy` falla                           |
| **ALTA**        | Sin respaldos automáticos. El más nuevo tiene ocho meses y está en el mismo disco                                  |
| **ALTA**        | Node 18.20.3, sin soporte desde abril de 2025                                                                      |
| **ALTA**        | No se puede saber qué commit está desplegado: el checkout no es un repositorio                                     |
| **MEDIA**       | Nginx sin HSTS; `Connection: upgrade` incondicional; `multipart/form-data` bloqueado de raíz                       |
| **MEDIA**       | 41 migraciones pendientes, con dos que reescriben tablas enteras                                                   |
| **BAJA**        | Sin swap; disco al 48 %                                                                                            |
| **INFORMATIVA** | Servidor compartido con 10 aplicaciones y 22 bases                                                                 |
| **INFORMATIVA** | La aplicación lleva detenida al menos desde febrero de 2026 y nadie lo reportó                                     |
