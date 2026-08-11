# Manual de operación

> Qué mirar, cada cuánto, y qué hacer cuando algo se rompe. Escrito para que
> sirva a las tres de la mañana, cuando nadie se acuerda de nada.

## GO / NO-GO

Lista objetiva. **GO solo si las nueve están verdes.** Cualquier roja es NO-GO.

|   # | Criterio                                | Cómo se comprueba                                            | Estado hoy         |
| --: | --------------------------------------- | ------------------------------------------------------------ | ------------------ |
|   1 | Suite verde                             | `npm test` · `test:e2e` · coverage sobre umbrales            | ✅                 |
|   2 | Ensayo de migración verde               | `npm run rehearsal:prodlike`                                 | ✅                 |
|   3 | Respaldo **probado restaurando**        | `npm run rehearsal`                                          | ✅                 |
|   4 | Sin bloqueantes en el precheck de datos | [`PRODUCTION_DATA_PRECHECK.md`](PRODUCTION_DATA_PRECHECK.md) | ✅ 0               |
|   5 | Artefacto con checksum verificado       | `sha256sum -c` en el servidor                                | ✅ construido      |
|   6 | Disco y memoria suficientes             | `df -h` · `free -h`                                          | ✅ 51 GB · 6,1 GiB |
|   7 | **Secretos rotados**                    | huellas nuevas, `JWT_SECRET` ≥ 32                            | ❌ **NO-GO**       |
|   8 | **La migración puede correr**           | `has_schema_privilege(…,'CREATE')`                           | ❌ **NO-GO**       |
|   9 | **Staging verde con este artefacto**    | `npm run smoke:staging`                                      | ❌ **no existe**   |

**Estado: NO-GO.** Tres criterios rojos, y los tres requieren escribir en el
servidor —lo que esta fase no hace—. Ninguno es un problema de código.

## Después del despliegue

Procedimiento humano. No hay alertas automáticas todavía, y montar un SaaS de
observabilidad para un comercio con un usuario sería complejidad sin beneficio.

### +15 minutos

```bash
curl -s https://kiosco.nistal.net/api/health | jq       # 200, commit correcto
pm2 list | grep kiosco                                  # online, ↺ 0
pm2 logs kiosco --lines 50 --nostream | grep -iE "error|500"
```

- [ ] Salud 200 con el commit del artefacto
- [ ] **Cero reinicios** — uno solo ya es una pregunta
- [ ] Sin errores 500 en los logs
- [ ] Una venta real, hecha por una persona, funcionó

### +1 hora

```bash
sudo -u postgres psql -d kiosco -tAc \
  "SELECT count(*) FROM pg_stat_activity WHERE datname='kiosco'"     # < 20
npm run integrity:check                                              # 23/23
free -h && df -h /
```

- [ ] Conexiones estables, sin crecer (una fuga se ve acá primero)
- [ ] Integridad 23/23
- [ ] Memoria del proceso estable — `max_memory_restart` está en 512 MB
- [ ] La PWA instala y `/offline` aparece sin red

### +24 horas

```bash
pm2 describe kiosco | grep -E "restarts|uptime"
npm run integrity:check
sudo -u postgres psql -d kiosco -tAc \
  "SELECT count(*) FROM \"AuditLog\" WHERE \"timestamp\" > now() - interval '24 hours'"
```

- [ ] Reinicios: 0
- [ ] Integridad 23/23
- [ ] Las ventas del día cierran contra la caja
- [ ] La bitácora tiene actividad: si está vacía, **nadie usó el sistema**, y eso
      también es un resultado que hay que mirar

## Qué mirar siempre

| Señal                   | Dónde                                | Qué es normal | Cuándo preocuparse           |
| ----------------------- | ------------------------------------ | ------------- | ---------------------------- |
| **HTTP 5xx**            | `pm2 logs kiosco \| grep " 500"`     | ninguno       | **cualquiera**               |
| **Login fallido**       | `grep INVALID_CREDENTIALS`           | alguno suelto | muchos seguidos de una IP    |
| **Latencia de la base** | `/api/health` → `database.latencyMs` | < 20 ms       | > 200 ms sostenido           |
| **Migración fallida**   | `npx prisma migrate status`          | «no pending»  | cualquier otra cosa          |
| **Integridad**          | `npm run integrity:check`            | 23/23         | **cualquier inconsistencia** |
| **Reinicios de PM2**    | `pm2 list`, columna ↺                | 0             | ≥ 1                          |
| **Disco**               | `df -h /`                            | < 80 %        | > 85 %                       |
| **Memoria**             | `free -h`                            | > 1 GiB libre | < 500 MiB (**no hay swap**)  |
| **Certificado**         | `certbot certificates`               | > 30 días     | < 15 días                    |

Sobre la integridad: es la señal más valiosa y la que menos ruido hace. No dice
que la aplicación responde; dice que **los números cierran**. Una manipulación
directa en la base, un despliegue a medias o un error de lógica aparecen acá y
en ningún otro lado.

## Diagnóstico

### La aplicación no responde (502)

```bash
pm2 list                                  # ¿está online?
ss -ltnp | grep 3099                      # ¿algo escucha?
pm2 logs kiosco --lines 100 --nostream
systemctl status nginx
```

Por probabilidad:

1. **PM2 `stopped` o `errored`** → el mensaje del log dice por qué. Si nombra
   una variable de entorno, es eso: `src/server/env.ts` mata el proceso a
   propósito antes de servir nada.
2. **PM2 online pero nada en 3099** → el proceso arrancó y murió; `pm2 logs`.
3. **Los dos bien, 502 igual** → Nginx apunta a otro puerto. `nginx -t` y
   revisar el sitio.

### El login devuelve 500

Casi siempre `JWT_SECRET`. La aplicación se niega a firmar con menos de 32
caracteres, y el mensaje lo dice. Con el arranque validado desde la Fase 5A esto
debería impedir que el proceso levante; si llegó a servir el login, alguien
cambió el entorno sin reiniciar.

```bash
pm2 restart kiosco --update-env
```

### La base no responde

```bash
curl -s localhost:3099/api/health | jq .database
systemctl status postgresql
sudo -u postgres psql -c "SELECT count(*) FROM pg_stat_activity"
```

Con más de 90 conexiones de 100, el problema es de conexiones y no de la base.
**El límite es del clúster entero**, compartido con las otras nueve bases del
servidor: puede agotarlo un sistema ajeno.

### La reconciliación falla

**No reiniciar. No tocar la base.** Primero entender.

```bash
npm run integrity:check           # dice QUÉ invariante falló y con cuántas filas
```

Cada comprobación nombra su tabla y su regla. Con eso y `AuditLog` —que guarda
antes y después de cada operación, con usuario y hora— se reconstruye qué pasó.

Corregir «para que cierre» es lo peor que se puede hacer: borra la evidencia de
un problema real.

### La aplicación consume memoria y reinicia

`max_memory_restart: 512M` la reinicia sola. Un reinicio suelto tras un informe
pesado es tolerable; uno cada media hora es una fuga.

```bash
pm2 describe kiosco | grep -E "memory|restarts"
```

## Mantenimiento

| Cuándo                    | Qué                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| **Diario**                | Respaldo automático (**hay que crearlo**); `integrity:check`                                  |
| **Semanal**               | Reinicios, disco, memoria; errores 500 de la semana                                           |
| **Mensual**               | `npm audit`; probar una restauración de verdad; revisar la bitácora                           |
| **Trimestral**            | `npm run rehearsal`; revisar usuarios y permisos; rotar secretos si cambió quién tiene acceso |
| **Antes de cada release** | Todo el checklist GO/NO-GO                                                                    |

## Observabilidad: lo que hay

Sin SaaS. Lo que existe:

- **`requestId`** en cada petición. Viaja en la cabecera `x-request-id`, en el
  cuerpo de los errores que ve el usuario y en la línea del log del servidor.
  Convierte «me dio error» en algo investigable: la persona dice el código y
  aparece exactamente la petición que falló, con su stack, sin haberle mostrado
  nada de eso.
- **Códigos de error cerrados.** Un catálogo de ~60, no cadenas libres. El
  cliente puede reaccionar a una condición sin comparar textos.
- **`AuditLog`**, escrito en la misma transacción que la operación. Si falla el
  registro, falla la operación.
- **`/api/health`** con versión, commit, hora de construcción y latencia de la
  base.
- **Redacción de logs.** Ningún secreto llega a `logs/error.log`: se tacha por
  valor, no por nombre de campo, porque el problema real es una cadena de
  conexión dentro de un mensaje —no un campo llamado `password`—.
- **PM2 con `pm2-logrotate`.**

Lo que **no** hay: alertas, métricas históricas, trazas distribuidas, panel.
Para un comercio con un usuario y 1.130 ventas en tres meses, mirar `pm2 logs`
alcanza. Cuando deje de alcanzar, la señal va a ser que estas comprobaciones
manuales empiecen a saltearse.

## Contactos y accesos

|             |                                                                          |
| ----------- | ------------------------------------------------------------------------ |
| Servidor    | `195.200.4.111` (`srv546281`), SSH con clave, `root`                     |
| Aplicación  | `/home/ubuntu/kiosco/kiosco`, PM2 `kiosco`, puerto 3099                  |
| Base        | `kiosco` en PostgreSQL 16.14 local, rol `kiosco`                         |
| Dominio     | `kiosco.nistal.net`, Let's Encrypt vía `certbot.timer`                   |
| Repositorio | `github.com/tnistal97/Kiosco`, rama `release/almacen-v1`                 |
| Secretos    | `/home/ubuntu/kiosco/kiosco/.env` — **hoy en `666`, hay que arreglarlo** |

**El servidor es compartido**: 11 aplicaciones en PM2 y 22 bases en PostgreSQL.
Un reinicio de PostgreSQL afecta a los otros nueve sistemas. Nada de lo que se
haga acá es solo de este proyecto.
