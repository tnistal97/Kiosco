# Alta de una instancia nueva

Una instancia es **una base de datos y un proceso por comercio**. No hay
registro público: el alta la hace un técnico, en el servidor.

`npm run alta:instancia` reemplaza a `prisma/seed.ts`, que quedó retirado:
aquel borraba tablas sin mirar contra qué base corría y dejaba un
administrador con una clave fija publicada en el repositorio.

## Qué hace y qué se niega a hacer

| Hace                                                         | Se niega a                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `prisma migrate deploy` (nunca `reset` ni `db push`)         | trabajar sobre una base con datos (salvo `--completar`)      |
| Crea los 9 roles, la sucursal y el dueño, en una transacción | trabajar sobre una base con tablas que no son de Kiosco      |
| Genera la clave del dueño y la entrega **una vez**           | escribir la clave en un log: sin terminal exige `--clave-en` |
| Registra en la bitácora lo que creó (sin clave ni hash)      | borrar o modificar cualquier cosa que ya exista              |

`--completar` sirve para una instancia que ya existe y a la que le falta algo
(por ejemplo, un rol que agregó una versión nueva). Solo **agrega**.

`--dry-run` revisa la base y dice qué haría, sin escribir nada.

La moneda no se configura: el sistema opera en pesos argentinos.

## Pasos

**1. Base y usuario de base propios**, como `postgres`. El usuario de la
aplicación no es superusuario:

```bash
sudo -u postgres createuser --no-superuser --no-createdb --no-createrole kiosco_pepe
sudo -u postgres psql -c '\password kiosco_pepe'   # la pide sin mostrarla
sudo -u postgres createdb -O kiosco_pepe kiosco_pepe
```

**2. Código y archivo de entorno** de esta instancia (`.env`, permisos `600`,
dueño el usuario del servicio). Ninguno de estos valores se comparte con otra
instancia:

```bash
DATABASE_URL=postgresql://kiosco_pepe:<clave>@localhost:5432/kiosco_pepe?schema=public
JWT_SECRET=<openssl rand -base64 48>
NODE_ENV=production
PORT=<un puerto libre, solo en 127.0.0.1>
COMMERCE_NAME="Almacén Don Pepe"
KIOSCO_HOSTS=donpepe.example.com
```

`COMMERCE_NAME` y `KIOSCO_HOSTS` se leen al atender: cambiarlas pide
reiniciar, no recompilar.

**3. Construir:** `npm ci && npm run build`. El build escribe
`build-info.json` solo; `/api/health` muestra ese commit.

**4. Simulacro y alta**, desde la carpeta de la aplicación y con su entorno:

```bash
npm run alta:instancia -- --nombre-comercial "Almacén Don Pepe" \
  --admin-usuario pepe --admin-nombre "José Pérez" \
  --direccion "Av. Siempreviva 742" --dry-run

# lo mismo sin --dry-run
```

La clave inicial se muestra una vez en la terminal. Si la salida no es una
terminal, `--clave-en <archivo>` la guarda en un archivo **nuevo** con
permisos `600`: entregarla y borrar el archivo.

**5. Servicio, proxy y respaldo:** una unidad de systemd y un vhost de Nginx
por instancia, como los de [`DEPLOY_LUCHANDOPORMAS.md`](DEPLOY_LUCHANDOPORMAS.md),
con el puerto y el dominio nuevos. El respaldo diario de ese documento vuelca
la base `kiosco`: la instancia nueva necesita el suyo.

**6. Comprobar:**

```bash
curl -s http://127.0.0.1:<puerto>/api/health   # status ok y el commit del release
```

Entrar como el dueño con la clave inicial y cambiarla en **Configuración →
Contraseña**. Desde ahí, las claves de los empleados las resetea el dueño en
**Usuarios**; nadie necesita SSH.

## Si algo sale mal

| Mensaje                                   | Qué pasó                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NO SE HIZO NADA. … ya tiene datos`       | La base no es nueva. Revisar `DATABASE_URL`. Si es esta misma instancia a medio hacer, `--completar`.               |
| `NO SE HIZO NADA. … ninguna es de Kiosco` | `DATABASE_URL` apunta a la base de otra aplicación.                                                                 |
| `prisma migrate deploy falló`             | No se crearon datos. Corregir la causa y volver a correr: las migraciones aplicadas no se repiten.                  |
| Clave inicial perdida antes de entregarla | `scripts/establecer-clave.ts` por SSH (ver `DEPLOY_LUCHANDOPORMAS.md`), que además cierra las sesiones del usuario. |
