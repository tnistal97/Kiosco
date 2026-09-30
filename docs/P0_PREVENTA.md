# Preventa P0 — informe de cierre

> Estado: **implementado y verificado en local; sin desplegar.** Rama
> `feat/ux-v2-phase2-1-lista-navegacion`, 14 commits sobre `6827064`
> (de `02ee367` a `740408a`). **Cero migraciones.** Lo que está en línea
> sigue siendo `release/almacen-v1` y no tiene nada de esto.
>
> Lo que sigue es la simplificación para almacenes de
> [UX_V4_ALMACENES_PROPUESTA.md](UX_V4_ALMACENES_PROPUESTA.md), que está
> propuesta y espera aprobación.

---

## Qué es P0

Lo mínimo que le faltaba al sistema para ofrecérselo a un almacén de barrio, un
maxikiosco o una despensa de una sola caja sin que las tareas de todos los días
pidieran a un técnico entrando al servidor. Salió de un diagnóstico del 24 de
septiembre de 2026 y se partió en dos:

| Parte    | El problema                                                                                    | Lo que se hizo                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **P0-A** | Cambiar una contraseña, dar de alta un comercio o cambiarle el nombre pedía entrar al servidor | Contraseñas desde la aplicación, alta de instancia segura, nombre y dominios en runtime |
| **P0-B** | El catálogo y los precios se cargaban producto por producto                                    | Importación desde Excel o CSV y cambio masivo de precios                                |

Lo que P0 **no** incluye, a propósito:

- La simplificación de la interfaz para gente no técnica. Es UX V4 y está
  propuesta aparte.
- El trabajo de operación que no es código: publicar esta versión, respaldo
  fuera del servidor, avisos de caída, licencia. Está en la
  [sección 6](#6-pendiente-antes-de-vender).

---

## 1. P0-A — operar sin entrar al servidor

### Contraseñas desde la aplicación

Hasta P0-A la única forma de cambiar una clave era entrar por SSH y correr
`scripts/establecer-clave.ts`.

- **Cambio propio** — Configuración → Contraseña (`POST /api/auth/password`).
  Pide la actual, la nueva y la confirmación, con la política de contraseñas
  que ya existía. Cierra las otras sesiones del usuario y mantiene la de ese
  equipo. Los intentos fallidos cuentan en el mismo límite que el ingreso: 8
  intentos, 15 minutos.
- **Reseteo por quien administra usuarios** — Usuarios → Resetear contraseña
  (`POST /api/users/:id/password`, permiso `users.manage`). Genera una temporal
  que se muestra una sola vez, o acepta una escrita, y cierra todas las
  sesiones de ese usuario. No se puede sobre uno mismo, sobre alguien de otra
  sucursal, ni sobre alguien con permisos que quien resetea no tiene.
- **Rastro.** La bitácora registra `password_change` y `password_reset`, sin la
  clave ni su hash. Los logs tachan los campos de clave de un cuerpo
  serializado.
- El guion por SSH sigue existiendo como último recurso y ahora también cierra
  las sesiones.

### Nombre del comercio y dominios, sin recompilar

- El nombre salía de `NEXT_PUBLIC_COMMERCE_NAME`, que Next congela al
  construir: cambiarlo pedía recompilar. Ahora `COMMERCE_NAME` se lee en el
  servidor en cada petición. La variable anterior queda de respaldo.
- La lista de dominios que acepta el middleware estaba escrita en el código: la
  instancia de otro comercio respondía 421 a todo. Ahora sale de
  `KIOSCO_HOSTS`. Sin la variable valen los dominios de siempre.
- Configuración muestra también la zona horaria de la sucursal.

### Alta de una instancia nueva

`npm run alta:instancia` reemplaza a `prisma/seed.ts`, que borraba tablas sin
mirar contra qué base corría y dejaba un administrador con una clave fija
publicada en el repositorio.

- Se niega sobre una base con datos, y sobre una base con tablas que no son de
  Kiosco, antes de cualquier escritura.
- Aplica `prisma migrate deploy`; nunca `reset` ni `db push`.
- Crea roles, sucursal y dueño en una sola transacción, con su rastro en la
  bitácora.
- Genera la clave del dueño y la entrega una sola vez: en la terminal, o en un
  archivo nuevo con permisos `600`.
- `--dry-run` solo lee. Ningún mensaje imprime credenciales de la base.

El procedimiento completo está en [ALTA_DE_INSTANCIA.md](ALTA_DE_INSTANCIA.md).
`prisma/seed.ts` queda como aviso: explica qué usar y sale con error.

### Textos que decían cosas falsas

Configuración listaba como «lo que todavía no está» cosas que existían hace
varias fases (turnos de caja, compras, proveedores, clientes). Usuarios decía
que la contraseña se cambiaba «desde el servidor». Quedaron los dos pendientes
que siguen siendo ciertos: permisos por rol editables y venta sin conexión.

### El build dice quién es

`npm run build` escribe antes `build-info.json` con la versión, el commit, la
hora y si el árbol tenía cambios sin confirmar. `/api/health` ya lo leía, pero
el paso era manual y el chequeo de salud respondía `commit: desconocido`.

### Documentación de operación

[DEPLOY_LUCHANDOPORMAS.md](DEPLOY_LUCHANDOPORMAS.md) quedó sin claves y sin
recetas peligrosas: la restauración ya no empieza borrando la base —restaura en
una nueva, la comprueba y recién entonces la cambia—, y las contraseñas se
manejan primero desde la aplicación.

### Propuesto y no hecho

Dos mejoras necesitan una columna nueva cada una, y por eso no se hicieron sin
aprobación:

- que el dueño edite el nombre del comercio desde la aplicación;
- obligar a cambiar la contraseña temporal en el primer ingreso.

---

## 2. P0-B — cargar el catálogo y mover los precios

El detalle —formatos, reglas, permisos, rastro y dónde está cada cosa en el
código— está en [IMPORTACION_Y_PRECIOS.md](IMPORTACION_Y_PRECIOS.md). Acá va el
resumen.

### Productos → Importar

| Paso                | Qué pasa                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1. Elegir           | Un `.xlsx` o `.csv`, hasta 10 MB y 10.000 productos. Se lee en el navegador; todavía no se guarda nada       |
| 2. Columnas         | La aplicación encuentra la fila de títulos y reconoce las columnas por sinónimos. Cada una se corrige a mano |
| 3. Vista previa     | Cuántos se agregan, se actualizan, quedan igual, se omiten y tienen errores; cada fila con su motivo         |
| 4. Elegir qué hacer | Con los que ya existen, y con el stock si el archivo lo trae                                                 |
| 5. Confirmar        | «¿Importamos?» avisa que, si algo falla, no se guarda nada                                                   |
| 6. Resumen          | Las filas con error no entran: se bajan en un CSV para corregirlas                                           |

- **Campos:** código de barras, nombre, categoría, precio, costo, stock, stock
  mínimo y unidad. Ninguno más.
- **Productos que ya existen:** se reconocen por código y, sin código, por
  nombre. Hay tres opciones: solo agregar los nuevos, agregar y actualizar, o
  solo actualizar (la lista de un proveedor). Al actualizar, una celda vacía no
  toca nada y nunca se vuelve cero.
- **Stock:** nunca se escribe directo. Los nuevos entran con un movimiento de
  stock inicial; para los existentes se elige entre no tocarlo, dejarlo en lo
  que dice el archivo (un ajuste por la diferencia) o sumar lo del archivo.
  Cada movimiento lleva usuario, fecha, producto, cantidad y un motivo como
  `Importación de lista.xlsx (#1a2b3c4d)`, que es el mismo identificador de la
  importación en la bitácora.
- **Costo:** pasa por el historial de costos.
- **Todo o nada:** una sola transacción. Un doble clic no duplica, y una vista
  previa vieja se rechaza y se rehace sola.
- **Números:** `1500`, `1500,50`, `1.500`, `1.500,50` y `1500.50` se leen bien
  como dinero; `1,500` se marca como ambiguo. En el stock de un producto por
  kilo, `1.500` es 1,5 kg y la vista previa lo avisa.
- **El archivo:** se rechazan macros, `.xls` viejos, `.ods`, archivos con
  contraseña, ejecutables y archivos corruptos. Las fórmulas no se ejecutan. No
  se sumó ninguna dependencia: el lector de `.xlsx` es propio.

### Productos → Cambiar precios

| Paso               | Qué pasa                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| 1. ¿Qué productos? | Todos, una categoría, un proveedor o una búsqueda; se destildan los que no van                      |
| 2. ¿Qué cambio?    | Subir o bajar un porcentaje, sumar o restar pesos, fijar un precio, o costo más un porcentaje       |
| 3. Así quedan      | Precio actual y nuevo de cada uno; cuántos cambian; mínimo, máximo y variación                      |
| 4. Confirmar       | «¿Cambiamos los precios?» Si alguien tocó un precio desde la vista previa, no aplica y pide revisar |
| 5. Deshacer        | Devuelve los precios del último cambio masivo que siguen como ese cambio los dejó                   |

- **Redondeo:** ninguno, a peso entero, o que termine en 0, 50, 90 o 99. Va en
  la dirección del cambio: un aumento nunca queda por debajo de lo calculado.
- **Rastro:** una fila de bitácora por producto, con el precio anterior y el
  nuevo, y una fila de resumen con el usuario, la fecha, la cantidad y el
  criterio en palabras («Aumento del 10 %, que termine en 90»). No hizo falta
  un subsistema nuevo.

### Volumen

Con una planilla sintética de 5.000 productos, en una portátil con PostgreSQL
local. La prueba vacía la base al terminar.

| Paso                                                 | Medido |
| ---------------------------------------------------- | ------ |
| Leer el `.xlsx`                                      | 0,09 s |
| Vista previa                                         | 0,2 s  |
| Importar 5.000 productos nuevos con stock            | 19,4 s |
| Volver a importar actualizando precio, costo y stock | 23,7 s |
| Cambiar 200 precios                                  | 0,44 s |
| Cambiar 5.000 precios                                | 6,9 s  |
| Deshacer 5.000 precios                               | 7,7 s  |

Cambiar 500 precios no se midió: por las dos mediciones que lo rodean, anda
cerca de un segundo.

---

## 3. Reglas que se respetaron

- **Sin migraciones.** La carpeta `prisma/migrations` no cambió. De `prisma/`
  solo cambió `seed.ts`, que se retiró.
- **Sin dependencias nuevas.** `package.json` suma dos comandos
  (`alta:instancia` y `plantilla:productos`) y el paso `prebuild`.
- **El stock solo se mueve por el libro de inventario**, con la misma puerta
  que usan las ventas y los ajustes.
- **El costo solo cambia por su historial.**
- **FEFO y los lotes obligatorios no se tocan:** el archivo no modifica el stock
  de un producto con lote obligatorio.
- **Los permisos son los que ya existían.** Las rutas nuevas están en
  [PERMISSIONS_MATRIX.md](PERMISSIONS_MATRIX.md).
- **Todo queda en la bitácora**, con el valor anterior y el nuevo.

---

## 4. Verificación

En local, sobre `740408a`.

| Qué                                                           | Cuándo     | Resultado                                                                                                                                           |
| ------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check` · `npm run lint` · `npm run typecheck` | 30/09/2026 | Sin observaciones                                                                                                                                   |
| `npm run build`                                               | 30/09/2026 | Correcta                                                                                                                                            |
| Toda la suite: 2.087 pruebas en 107 archivos                  | 30/09/2026 | 2.085 pasaron. Las otras 2 eran la prueba de volumen, que se cortaba por tiempo con la cobertura encendida; se corrigió en `740408a` y pasa, 4 de 4 |
| Punta a punta: accesibilidad, móvil, navegación e importación | 27/09/2026 | 87 de 87                                                                                                                                            |

Pendiente al momento de subir: el informe de cobertura y la suite completa de
punta a punta sobre el último commit. La suite pasó de 1.851 pruebas en 92
archivos (antes de P0) a 2.087 en 107.

Pruebas que P0 agregó:

| Parte | Unitarias | Integración | Pantalla | Volumen | Punta a punta |
| ----- | --------- | ----------- | -------- | ------- | ------------- |
| P0-A  | 15        | 32          | 9        | —       | 2             |
| P0-B  | 124       | 33          | 14       | 4       | 3             |

### La integración continua

Un `push` a esta rama corre `.github/workflows/ci.yml`: formato, lint, tipos,
toda la suite con cobertura, la construcción, las pruebas de punta a punta y la
auditoría de dependencias. No despliega nada.

La última corrida anterior a P0 (10 de septiembre de 2026, commit `6827064`) ya
fallaba en cuatro de los cinco trabajos, por causas que no son de este trabajo y
que P0 no tocó:

| Trabajo                   | Por qué fallaba                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Pruebas                   | Una prueba de pantalla del cobro (`tests/ui/cobro.test.tsx`) se queda sin tiempo en el servidor de CI |
| Construcción              | El paso busca la palabra `NetworkOnly` en `public/sw.js` y el service worker construido ya no la trae |
| Extremo a extremo         | Una prueba lee `.env.local`, que en CI no existe; otra mide un desborde de `/proveedores/2` en 375 px |
| Auditoría de dependencias | `npm audit` encuentra avisos altos en dependencias de terceros                                        |

---

## 5. Riesgos conocidos

1. **El proxy corta a los 60 segundos.** Importar 5.000 productos tarda entre
   19 y 24 s en una portátil; en el servidor puede tardar más, y 10.000 se
   acercarían al límite. Si el proxy corta, el servidor igual termina o deshace
   todo, y reintentar no duplica. Conviene subir el tiempo de espera del proxy
   para `/api/products/import`.
2. **Excel real.** El lector se probó con archivos generados en muchas
   variantes, no con listas de comercios. Hay que probarlo con dos o tres
   listas reales, exportadas desde Excel, LibreOffice y Google Sheets.
3. **Ventas durante una importación grande.** La importación es una sola
   transacción: una venta de un producto que se está actualizando puede esperar
   unos segundos. No se midió. Conviene importar con el local tranquilo.
4. **Navegadores viejos.** Leer un `.xlsx` necesita un navegador de 2023 en
   adelante. Si es más viejo aparece un mensaje claro, y el `.csv` funciona
   igual.
5. **Categorías mal escritas.** «Almacn» se crea como categoría nueva. La vista
   previa la muestra antes de confirmar.
6. **Deshacer** alcanza solo al último cambio masivo y depende de la bitácora.
7. **No se importan:** proveedor, descripción, códigos alternativos, cambio de
   unidad de un producto existente ni vencimientos.
8. **La contraseña temporal no obliga a cambiarse.** Es una de las dos mejoras
   propuestas y no hechas.

---

## 6. Pendiente antes de vender

- [ ] Publicar esta versión, con el chequeo de salud diciendo el commit.
- [ ] Respaldo diario fuera del servidor, con una restauración probada.
- [ ] Aviso automático si la aplicación se cae.
- [ ] Decidir la licencia y la visibilidad del repositorio.
- [ ] Subir el tiempo de espera del proxy para la importación.
- [ ] Probar la importación con listas reales.
- [ ] UX V4: aprobar la propuesta y hacer las fases F1 a F5 y F7.
- [ ] Prueba de usabilidad con personas no técnicas.
- [ ] Piloto de dos semanas en un almacén real.

Los criterios completos, con lo que queda para los primeros clientes y para más
adelante, están en la sección 14 de
[UX_V4_ALMACENES_PROPUESTA.md](UX_V4_ALMACENES_PROPUESTA.md).

---

## 7. Commits

| Commit    | Parte | Qué                                                                    |
| --------- | ----- | ---------------------------------------------------------------------- |
| `02ee367` | P0-A  | Cambio de contraseña propia y reseteo por el administrador             |
| `4f29a26` | P0-A  | Nombre del comercio y dominios en runtime, sin recompilar              |
| `38e498d` | P0-A  | Alta segura de una instancia nueva; `seed.ts` retirado                 |
| `44de7c8` | P0-A  | Configuración y Usuarios dejan de decir cosas falsas                   |
| `f3e3ab9` | P0-A  | El build escribe su identidad; documentación de operación saneada      |
| `0022cd6` | P0-A  | Pruebas de contraseñas y de Configuración                              |
| `f861b1f` | P0-B  | Leer planillas CSV y XLSX, mapear columnas y entender los números      |
| `584b388` | P0-B  | Vista previa e importación, todo o nada, por las puertas del dominio   |
| `5149e00` | P0-B  | Rangos de acentos escritos como escape                                 |
| `f935fa1` | P0-B  | Productos → Importar, con plantilla de ejemplo                         |
| `c27fcfe` | P0-B  | Productos → Cambiar precios, con vista previa, confirmación y deshacer |
| `be99701` | P0-B  | Textos que entran en el teléfono y cabecera de Productos               |
| `e2c0cac` | P0-B  | Pruebas de punta a punta, volumen de 5.000 productos y documentación   |
| `740408a` | P0-B  | La prueba de volumen declara su propio límite de tiempo                |
