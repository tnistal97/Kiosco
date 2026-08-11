# Respaldo de producción: plan y restauración

> **No se ejecutó nada en producción.** Los comandos están escritos para
> copiarlos y pegarlos, y los tiempos están **medidos** —no estimados— sobre un
> conjunto con la forma y el volumen reales.
>
> Un respaldo que nunca se restauró es una suposición. Este documento tiene dos
> mitades y la segunda es la que importa.

## Punto de partida

Lo que hay hoy en el servidor, medido el 11-ago-2026:

- **No hay respaldos automáticos.** El `crontab` de `root` está vacío.
- El volcado más nuevo de `kiosco` es `/home/ubuntu/kiosco_23-49.sql`, de **1,3
  MB** y del **8-dic-2025**: ocho meses.
- Está **en el mismo disco** que la base. Un fallo de disco se lleva las dos
  cosas.
- Nadie lo restauró nunca para comprobar que sirve.

## El respaldo

### Comando exacto

```bash
# En el servidor, como root.
FECHA=$(date +%Y%m%d-%H%M%S)
DESTINO=/var/backups/kiosco
mkdir -p "$DESTINO"

sudo -u postgres pg_dump \
  --format=custom \
  --compress=6 \
  --file="$DESTINO/kiosco-$FECHA.dump" \
  kiosco
```

### Por qué así

| Decisión                             | Motivo                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--format=custom`                    | Se restaura con `pg_restore`, que permite restaurar **una** tabla, listar el contenido sin extraerlo y paralelizar. Un `.sql` plano solo se puede correr entero.              |
| `--compress=6`                       | La base es 96 % texto; comprime a ~1/8. El 6 es el punto donde dejar de ganar tamaño empieza a costar tiempo.                                                                 |
| `sudo -u postgres`                   | No necesita la credencial de la aplicación. Un procedimiento de respaldo que depende de un secreto rotable se rompe justo el día que se rota.                                 |
| Sin `--data-only` ni `--schema-only` | Un respaldo parcial obliga a acordarse de la otra mitad.                                                                                                                      |
| Sin `--globals`                      | Los roles y sus claves son del clúster, no de la base. Se respaldan aparte (abajo) y **no** van al mismo archivo, para no meter hashes de contraseñas en el volcado de datos. |

### Los roles, aparte

```bash
sudo -u postgres pg_dumpall --roles-only \
  > "$DESTINO/roles-$FECHA.sql"
chmod 600 "$DESTINO/roles-$FECHA.sql"
```

**Este archivo lleva los hashes de las contraseñas de los cuatro roles del
clúster**, incluidos los de los otros sistemas. Va con permisos `600`, no se
copia fuera del servidor sin cifrar, y no se archiva junto al volcado de datos.

Sin él, restaurar en una máquina nueva deja la base sin dueño y sin el rol
`kiosco`. Con él, se restaura en dos pasos y anda.

### Checksum

```bash
cd "$DESTINO"
sha256sum "kiosco-$FECHA.dump" > "kiosco-$FECHA.dump.sha256"
sha256sum -c "kiosco-$FECHA.dump.sha256"
```

Un respaldo sin checksum no permite distinguir «se copió mal» de «la base
estaba así».

### Validación, sin restaurar

```bash
# ¿Se puede leer entero? Si el archivo está truncado, esto falla.
pg_restore --list "$DESTINO/kiosco-$FECHA.dump" | wc -l

# ¿Están las tablas que tienen que estar?
pg_restore --list "$DESTINO/kiosco-$FECHA.dump" | grep -c "TABLE DATA"
```

Antes de la migración se esperan **14** tablas; después, **33**.

Esto detecta un archivo roto. **No** detecta un archivo con datos incompletos:
para eso hay que restaurar, y por eso existe la segunda mitad del documento.

### Cifrado

El volcado tiene datos del comercio: ventas, precios, costos, proveedores,
clientes y sus saldos.

- **Mientras vive en `/var/backups` del servidor**: no hace falta cifrarlo, pero
  sí `chmod 600` y un directorio `700`. Hoy el disco no está cifrado y hay diez
  sistemas de terceros en la misma máquina.
- **En cuanto sale del servidor** —a un equipo, a un disco, a la nube— se cifra:

```bash
gpg --symmetric --cipher-algo AES256 "kiosco-$FECHA.dump"
# deja kiosco-$FECHA.dump.gpg; la frase, en el gestor de contraseñas
```

Un respaldo cifrado con una frase que nadie anotó es un respaldo perdido. La
frase va al mismo lugar que los demás secretos, **antes** de cifrar.

### Espacio

|                            |                                 |
| -------------------------- | ------------------------------- |
| Base hoy                   | 11 MB                           |
| Volcado comprimido, medido | **~0,1 MB** con el volumen real |
| Base después de migrar     | ~15 MB (medido en el ensayo)    |
| Disco libre                | 51 GB de 96                     |

Con 30 días de retención diaria: **menos de 10 MB**. El espacio no es una
restricción y no vale la pena optimizarlo.

### Retención

| Cuándo          | Cuántos   | Por qué                                            |
| --------------- | --------- | -------------------------------------------------- |
| Antes del corte | 1, a mano | Es el rollback real. **No se borra nunca.**        |
| Diario          | 7         | Para volver de un error operativo de la semana     |
| Semanal         | 4         | Para volver de algo que se descubre tarde          |
| Mensual         | 6         | Para responder una pregunta contable de hace meses |

El del corte se archiva **fuera del servidor** y se etiqueta con el commit que
se desplegó. Es el único respaldo del que depende la decisión de volver atrás.

### Automatizarlo

No está automatizado y **hace falta**. Requiere escribir en el servidor, así que
queda propuesto:

```cron
# /etc/cron.d/kiosco-backup
30 4 * * * root /usr/local/bin/respaldo-kiosco.sh >> /var/log/respaldo-kiosco.log 2>&1
```

A las 04:30 (−03), fuera de horario comercial. El guion tiene que **fallar
ruidosamente**: un respaldo que falla en silencio durante tres semanas es peor
que no tenerlo, porque genera confianza sin fundamento.

## La restauración — la mitad que importa

### Comando exacto

```bash
# 1. Base nueva y VACÍA. Nunca sobre la base viva.
sudo -u postgres createdb kiosco_restaurada

# 2. Los roles primero, si es una máquina distinta.
sudo -u postgres psql -f "$DESTINO/roles-$FECHA.sql" postgres

# 3. Los datos.
sudo -u postgres pg_restore \
  --dbname=kiosco_restaurada \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$DESTINO/kiosco-$FECHA.dump"
```

| Bandera                          | Por qué                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--exit-on-error`                | Sin esto, `pg_restore` **sigue después de un error** y termina con código 0. Una restauración a medias que informa éxito es el peor resultado posible. |
| `--no-owner` / `--no-privileges` | Permite restaurar en una máquina donde los roles no existen o se llaman distinto. Los privilegios se vuelven a dar después, a propósito.               |
| Base nueva                       | Restaurar sobre una base con datos mezcla dos estados y no se puede deshacer.                                                                          |

### Comprobar que lo restaurado es lo que había

```bash
sudo -u postgres psql -d kiosco_restaurada -tA -c "
  SELECT 'ventas',   count(*)::text FROM \"Sale\"
  UNION ALL SELECT 'renglones', count(*)::text FROM \"SaleItem\"
  UNION ALL SELECT 'productos', count(*)::text FROM \"Product\"
  UNION ALL SELECT 'total',     COALESCE(sum(\"total\"),0)::text FROM \"Sale\""
```

Y, si ya está migrada:

```bash
DATABASE_URL="postgresql://…/kiosco_restaurada" npm run integrity:check
```

Contar filas dice que están. **`integrity:check` dice que cierran**: que la suma
de los movimientos explica el stock, que los pagos suman el total de cada venta,
que los saldos de cuenta corriente coinciden con su libro. Son 23 comprobaciones
y es lo que convierte «se restauró» en «sirve».

### Restaurar UNA tabla

Cuando alguien borró algo puntual y no hace falta volver el sistema entero:

```bash
pg_restore --dbname=kiosco_restaurada --table=Sale "$DESTINO/kiosco-$FECHA.dump"
```

Sobre la base **restaurada**, nunca sobre la viva. Después se mira, se decide, y
recién ahí se mueve el dato. Restaurar una tabla directamente sobre producción
la deja inconsistente con las que la referencian.

## Tiempos medidos

Con el conjunto de la forma y el volumen reales (`npm run rehearsal:prodlike`),
sobre PostgreSQL 18.3 local:

| Paso                        |       Volumen real |    20× el real |
| --------------------------- | -----------------: | -------------: |
| Respaldo (`pg_dump`)        | **0,3 s** · 0,1 MB | 0,5 s · 2,1 MB |
| Restauración (`pg_restore`) |          **0,3 s** |          0,6 s |
| `integrity:check`           |         **0,10 s** |         0,27 s |

**Advertencia sobre estos números.** Se midieron en PostgreSQL **18.3** en
Windows; producción es **16.14** en Linux, en un servidor compartido con otras
nueve bases. El orden de magnitud es el correcto —segundos, no minutos— pero no
son el tiempo exacto del servidor. Con una base de 11 MB, cualquier variación
razonable sigue siendo despreciable.

## Ensayo periódico

Un respaldo no probado deja de servir en silencio. Hay dos guiones y prueban
cosas distintas:

```bash
npm run rehearsal            # respaldar, migrar, restaurar, comparar
npm run rehearsal:prodlike   # lo mismo, con el volumen y la forma de producción
```

Los dos crean bases descartables terminadas en `_dev`, las usan y las borran, y
**se niegan a trabajar sobre cualquier otro nombre**. Ninguno toca producción.

Conviene correrlos antes de cada release y una vez por trimestre.

## Lo que este plan no cubre

- **No hay réplica.** Si el servidor se pierde, se pierde todo lo posterior al
  último respaldo. Con respaldo diario, hasta 24 horas de ventas.
- **No hay recuperación a un punto en el tiempo.** Eso necesita archivado de
  WAL, que no está configurado. Se puede volver a un respaldo, no a «las 15:42».
- **El respaldo no sale del servidor por sí solo.** Copiarlo a otro sitio sigue
  siendo un paso manual, y mientras lo sea, un fallo de disco se lleva la base y
  sus respaldos juntos.

Las tres son decisiones de infraestructura, no de código, y ninguna es urgente
para este despliegue. La primera sí conviene resolverla poco después.
