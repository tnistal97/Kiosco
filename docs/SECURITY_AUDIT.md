# Auditoría de seguridad

> Revisión ofensiva y defensiva del código recuperado de producción (commit `92d3d65`).
> Alcance: autenticación, autorización, validación de entrada, integridad transaccional, secretos, frontend/PWA y dependencias.
> **No se ejecutó ninguna prueba contra el servidor de producción.** Las pruebas marcadas ✅ se reprodujeron contra una copia local con base descartable; el resto proviene del análisis del código.

## Clasificación

| Nivel | Criterio | Cantidad |
|---|---|---|
| **P0** | Permite alterar dinero o stock, escalar privilegios, o acceder a credenciales | **11** |
| **P1** | Exposición de datos sensibles, ausencia de controles de rol, integridad financiera | **13** |
| **P2** | Endurecimiento necesario; explotación condicionada | **9** |
| **P3** | Higiene; riesgo bajo o teórico | **4** |

## Resumen ejecutivo

Cuatro problemas estructurales explican casi todos los hallazgos:

1. **El middleware no se ejecuta.** Está escrito, es correcto, y Next.js lo descarta silenciosamente por estar en la carpeta equivocada. Toda la autenticación a nivel de rutas es decorativa (§P0-0).
2. **La autorización se apoyaba en ese middleware.** Diez de las dieciséis rutas de API no verifican rol, y cinco no verifican ni siquiera la sesión por su cuenta.
3. **No existe validación de entrada.** Ninguna ruta valida tipos, rangos ni forma del body. Varias lo pasan directo a Prisma.
4. **La operación crítica —la venta— no es atómica y confía en datos del navegador.** Es el único camino por el que entra dinero y el menos protegido.

Lo verificado en una copia local del código de producción, **sin ninguna sesión iniciada**:

- `GET /api/users` devolvió los tres usuarios con su hash de contraseña.
- `POST /api/users` creó una cuenta con rol `admin`.
- `POST /api/logs` escribió una entrada falsa en la bitácora atribuida a otro usuario.

Y con una sesión de cajero común:

- Una venta de 999 unidades de un producto con 23 en stock se registró con éxito. El stock quedó en **−976**.
- El mismo pedido declaró `price: 1` para un producto de $12.500. Se guardó **$1**, y la caja subió $999 en lugar de $12.487.500.
- El cajero cambió el precio de ese producto a $1 y borró otro del catálogo.
- El cajero abrió `/admin/auditoria` escribiendo la URL y vio la bitácora de la dueña.

> **Atenuante temporal:** el servidor de producción está detenido desde febrero de 2026 (PM2 parado, ver el informe de recuperación). **Nada de esto está expuesto en este momento.** Pero se expone íntegro en el instante en que se levante el proceso.

---

# P0-0 · El middleware de autenticación nunca se ejecuta

- **Archivo:** `middleware.ts` (ubicación)
- **Severidad:** P0 — **es el hallazgo principal de esta auditoría**
- **Verificado:** ✅ en el build de producción y en ejecución

`middleware.ts` está en la **raíz del proyecto**. El proyecto usa un directorio `src/`. En esa configuración Next.js espera el archivo en `src/middleware.ts` y **descarta el de la raíz sin emitir ningún aviso**.

Comprobación en el manifiesto que genera `next build`:

```
# con middleware.ts en la raíz  (estado actual del repositorio)
middleware: []

# con el mismo archivo movido a src/middleware.ts
ƒ Middleware    98.5 kB
middleware: [ '/' ]
```

Y en ejecución, sin ninguna cookie de sesión:

| Ruta | Esperado | Real |
|---|---|---|
| `/caja` | 302 → `/login` | **200** |
| `/productos` | 302 → `/login` | **200** |
| `/ventas` | 302 → `/login` | **200** |
| `/admin/auditoria` | 302 → `/login` | **200** |
| `/admin/sales` | 302 → `/login` | **200** |

Ni siquiera con una cookie `token=basura` hay redirección.

**Impacto:** el middleware era el **único** control de acceso para las páginas y el único control de rol para `/admin/*`. Sin él:

- Todas las pantallas se abren sin iniciar sesión. Las que cargan datos por API muestran errores, porque esas APIs sí validan por su cuenta — pero la estructura, los nombres de sección y los formularios quedan a la vista.
- Las rutas de API que **no** validan por su cuenta quedan abiertas a internet: `/api/users`, `/api/logs`, `/api/stock`, `/api/sales/recent`, `/api/categories`, `/api/roles`, `/api/suppliers`.

Eso convierte los hallazgos P0-4, P0-5, P0-6 y P0-8 de "cualquier empleado" en **"cualquiera con la dirección del sitio"**.

**Corrección:** mover el archivo a `src/middleware.ts`. Es un `git mv`.

**Riesgo de la corrección: medio, y hay que anticiparlo.** Hoy nada se ejecuta; al activarlo, el middleware pasa a correr en el runtime Edge e importa `jsonwebtoken` y `@prisma/client` — ninguno de los dos es apto para Edge. En el build de prueba, Next arrastró el motor de consultas de Prisma en formato WASM al bundle del middleware (98,5 kB) y emitió advertencias. **Activarlo sin más puede romper la aplicación entera.** La corrección correcta es moverlo *y* reescribirlo: verificar la firma del token con `jose` (compatible con Edge) y sacar la consulta a la base, apoyándose en el claim `role` que ya viaja firmado dentro del propio token.

**Prueba necesaria:** sin cookie, cada ruta privada debe responder 302 a `/login`; con un token de cajero, `/admin/*` debe redirigir; el build debe reportar la línea `ƒ Middleware`.

---

## Nota sobre el orden de corrección

P0-0 **no debe corregirse solo**. Mover el middleware sin arreglar las rutas de API deja la falsa sensación de que el problema está resuelto, cuando `/api/users` y compañía seguirían abiertas a cualquier sesión válida. La secuencia correcta es: primero dar autorización propia a cada ruta (P0-4 a P0-8), después activar el middleware como segunda capa.

---

# P0 — Críticas

## P0-1 · El precio de venta lo decide el navegador

- **Archivo:** `src/app/api/sales/route.ts:37-40`, `:69-73`, `:80`
- **Severidad:** P0 · **Verificado:** ✅

**Reproducción.** Con una sesión de cajero, un pedido declarando `price: 1` sobre un producto de $12.500:

```
precio en el catálogo:      12500
precio guardado en SaleItem:    1
caja antes:            $184.500,50
caja después:          $185.499,50    (subió $999, no $12.487.500)
```

`POST /api/sales` recibe `items: { productId, quantity, price }[]`. El campo `price` viaja desde el cliente y se usa sin contrastarlo contra la base:

```ts
items: { create: items.map((item) => ({ productId, quantity, price: item.price })) }
const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
```

Ese valor se escribe en `SaleItem.price` y determina el monto del `CashRegisterMovement` y el incremento de `Branch.currentCash`.

**Explotación:** interceptar la petición de "Confirmar Venta" desde las herramientas de desarrollo del navegador y modificar `price` antes de que salga. También se puede llamar al endpoint directamente con la cookie de sesión.

**Impacto:** el cajero se lleva la mercadería registrando cualquier importe, incluido cero o negativo. El arqueo cuadra porque el sistema espera lo que el propio cajero declaró. **Es un fraude indetectable con las herramientas actuales.**

**Corrección:** leer `price` de la base dentro de la transacción, por `productId`, y descartar el que envía el cliente. Si se quiere permitir descuentos, que sean un campo aparte, con permiso explícito y auditoría.

**Riesgo de la corrección:** bajo. Cambia el contrato de la API, pero el frontend ya envía el precio que obtuvo del servidor.
**Prueba necesaria:** una venta cuyo body declara `price: 1` debe registrarse con el precio real del catálogo.

## P0-2 · La venta no es una transacción

- **Archivo:** `src/app/api/sales/route.ts:64-165`
- **Severidad:** P0

El handler ejecuta cinco operaciones independientes, sin `$transaction`:

1. `sale.create` con sus `SaleItem`
2. `cashRegisterMovement.create`
3. lectura de `branch.currentCash` → `branch.update`
4. `auditLog.create`
5. bucle de `branchStock.update` con `{ decrement }`

**Explotación:** no requiere intención. Basta con que un producto no tenga fila en `BranchStock` — situación normal, porque `POST /api/stock` puede crear productos sin stock y `test.js` borra `branchStock` sin borrar productos. Prisma lanza `P2025` en el paso 5 y el handler devuelve 500.

**Impacto:** la venta y el movimiento de caja quedan guardados; el stock no se descuenta. El sistema cobró y no descontó. Al revés también ocurre: si falla el paso 3, hay venta sin registro de caja.

**Corrección:** envolver los cinco pasos en `prisma.$transaction`.
**Riesgo:** bajo — el patrón ya está bien resuelto en `/api/products/[id]` y `/api/cash/[id]`.
**Prueba:** forzar el fallo del descuento de stock y verificar que no queda ninguna `Sale`.

## P0-3 · No se valida el stock disponible

- **Archivo:** `src/app/api/sales/route.ts:146-153`
- **Severidad:** P0 · **Verificado:** ✅

**Reproducción.** Venta de **999 unidades** de un producto con **23** en stock → **HTTP 201**, stock resultante **−976**.

```ts
data: { quantity: { decrement: item.quantity } }
```

Sin comprobación previa. El frontend limita el botón "+" con `disabled={qty >= stock}` (`components/caja/ProductRow.tsx:70`), pero eso es solo la interfaz.

**Explotación:** enviar una cantidad mayor al stock directamente a la API. También ocurre sin malicia con dos cajas vendiendo el mismo producto simultáneamente.

**Impacto:** stock negativo. Los reportes de inventario, el valor de mercadería y las alertas de reposición quedan corrompidos.

**Corrección:** dentro de la transacción, bloquear la fila y verificar disponibilidad; rechazar con 409 si no alcanza. Permitir la venta en negativo solo con un permiso explícito que quede auditado.
**Prueba:** venta de 5 unidades con stock 3 → 409, sin `Sale` creada.

## P0-4 · `GET /api/users` publica los hashes de contraseña

- **Archivo:** `src/app/api/users/route.ts:5-10`
- **Severidad:** P0 · **Verificado:** ✅ **sin ninguna sesión** (por P0-0)

**Reproducción.** `GET /api/users` sin cookie alguna:

```
usuarios devueltos: 3
campos: id, password, name, roleId, branchId, createdAt, username, role, branch
password presente: true      (hashes bcrypt $2b$10$…)
```

```ts
const users = await prisma.user.findMany({ include: { role: true, branch: true } })
return NextResponse.json(users)
```

Sin `select`, Prisma devuelve **todos** los campos del modelo `User`, incluido `password`. La ruta **no verifica sesión ni rol** por su cuenta.

**Explotación:** cualquier sesión válida —un cajero— navega a `/api/users` y obtiene el listado completo con los hashes bcrypt de todos los usuarios de todas las sucursales.

**Impacto:** los hashes se pueden atacar sin límite fuera de línea. Las contraseñas observadas en los scripts del repositorio (`Lkiosco123`, y las de `insertUsers`) sugieren claves cortas y adivinables, que caen en minutos.

**Corrección:** `select` explícito sin `password`; exigir rol administrador.
**Prueba:** la respuesta no debe contener la clave `password`; un cajero debe recibir 403.

## P0-5 · `POST /api/users` permite crearse un administrador

- **Archivo:** `src/app/api/users/route.ts:12-19`
- **Severidad:** P0 · **Verificado:** ✅ **sin ninguna sesión** (por P0-0)

**Reproducción.** `POST /api/users` sin cookie, con `roleId` apuntando al rol administrador → **HTTP 200**, usuario creado, rol asignado: `admin`.

```ts
const data = await req.json()
const hashed = await bcrypt.hash(data.password, 10)
const user = await prisma.user.create({ data: { ...data, password: hashed } })
```

Asignación masiva pura: el cliente controla `roleId`, `branchId`, `username` y `name`. Sin autenticación propia, sin rol.

**Explotación:** un `POST` con `roleId` apuntando al rol `admin` crea una cuenta administradora. Después basta con iniciar sesión con ella.

**Impacto:** escalada de privilegios completa. Acceso a auditoría, reportes y administración de sucursales.

**Corrección:** exigir rol administrador; lista blanca de campos; no aceptar `roleId` por encima del propio nivel; auditar la creación.
**Prueba:** un cajero que intenta crear un usuario debe recibir 403.

## P0-6 · `/api/logs` permite falsificar la bitácora de auditoría

- **Archivo:** `src/app/api/logs/route.ts:12-16` (POST), `:4-10` (GET)
- **Severidad:** P0 · **Verificado:** ✅ **sin ninguna sesión** (por P0-0)

**Reproducción.** `POST /api/logs` sin cookie, declarando `userId: 1` (la dueña) y `actionType: "delete"` → **HTTP 200**, entrada escrita en la bitácora a nombre de otra persona.

```ts
const data = await req.json()
const log = await prisma.auditLog.create({ data })
```

El cliente controla **todos** los campos, incluido `userId`, `tableName`, `actionType`, `changes`, `origin` y —al no estar restringido— podría intentar `timestamp`.

**Explotación:** escribir entradas que atribuyan acciones a otro empleado, o inundar la bitácora para enterrar un rastro real.

**Impacto:** la auditoría deja de ser evidencia. Es el control que debería detectar los demás fraudes de esta lista, y es escribible por cualquiera.
Adicionalmente, `GET /api/logs` usa `include: { user: true }` → devuelve otra vez los hashes de contraseña (§P0-4).

**Corrección:** eliminar la ruta. La bitácora debe escribirse únicamente desde el servidor, dentro de las transacciones que la originan.
**Riesgo:** ninguno; nada del frontend la usa.

## P0-7 · `DELETE /api/products` borra el catálogo completo de la sucursal

- **Archivo:** `src/app/api/products/route.ts:158-205`
- **Severidad:** P0

Verifica sesión pero **no rol**. Borra todos los `BranchStock` y todos los `Product` de la sucursal en una transacción.

**Explotación:** una única petición `DELETE` a `/api/products` con una cookie de cajero.

**Impacto:** pérdida total del catálogo y del stock. No hay borrado lógico ni papelera; la recuperación exige un backup de base de datos.

**Corrección:** eliminar el método. Si se necesita una purga masiva, que sea una tarea administrativa fuera de la API pública, con doble confirmación.

## P0-8 · `/api/stock` sin autenticación y con escritura entre sucursales

- **Archivo:** `src/app/api/stock/route.ts:4-26`
- **Severidad:** P0

```ts
export async function GET() { return prisma.branchStock.findMany({ include: { product: true, branch: true } }) }
export async function POST(req) { const data = await req.json(); prisma.branchStock.upsert({ …, update: { quantity: { increment: data.quantity } }, create: data }) }
```

Ninguna verificación de sesión, rol ni sucursal. El `branchId` y el `productId` llegan del body.

**Explotación:** `POST /api/stock` con `{"branchId": 2, "productId": 57, "quantity": 9999}` altera el inventario de otra sucursal. Con `quantity` negativo, lo destruye. El `create: data` además pasa el objeto crudo del cliente a Prisma.

**Impacto:** manipulación arbitraria del inventario de cualquier sucursal, sin rastro en la auditoría (esta ruta no registra nada).

**Corrección:** eliminar la ruta. `/api/stock/[id]` ya hace lo correcto: valida pertenencia, es transaccional, rechaza negativos y audita.

## P0-9 · Condición de carrera en el saldo de caja

- **Archivo:** `src/app/api/sales/route.ts:96-109`
- **Severidad:** P0

```ts
const branchRecord = await prisma.branch.findUnique({ where: { id: branchId } })
const newCash = branchRecord.currentCash + totalAmount
await prisma.branch.update({ where: { id: branchId }, data: { currentCash: newCash } })
```

Leer-modificar-escribir sin transacción ni bloqueo.

**Explotación:** no requiere intención. Dos cajas cobrando en efectivo al mismo tiempo: ambas leen el mismo saldo, ambas escriben; una de las dos ventas desaparece del saldo.

**Impacto:** el saldo esperado de caja queda por debajo del real. Se manifiesta como un sobrante recurrente en el arqueo que nadie sabe explicar. Es también una vía de fraude: provocar el solapamiento a propósito.

**Corrección:** dejar de mantener un total mutable. Calcular el saldo como suma de movimientos, o —si se conserva un total denormalizado— actualizarlo con `{ increment }` atómico dentro de la transacción de la venta.
**Prueba:** dos ventas en efectivo concurrentes deben sumar exactamente ambos importes.

## P0-10 · `next-auth` con vulnerabilidad crítica, y sin usarse

- **Archivo:** `package.json:22`
- **Severidad:** P0 (por la clasificación del aviso) · **riesgo real bajo**
- **Avisos:** GHSA-7rqj-j65f-68wh (crítico), GHSA-xmf8-cvqr-rfgj (alto), GHSA-x445-f3h2-j279 (moderado)

`next-auth@4.24.13` es la **única vulnerabilidad crítica** del proyecto. La autenticación es propia (`jsonwebtoken` + `bcrypt`): **`next-auth` no se importa en ningún archivo**.

**Corrección:** `npm uninstall next-auth`. Elimina la crítica sin tocar una línea de lógica.
**Riesgo:** nulo.

---

# P1 — Altas

## P1-1 · Un cajero puede cambiar precios y borrar productos · **Verificado:** ✅

`src/app/api/products/[id]/route.ts` — `PUT` y `DELETE` verifican sesión y sucursal, **no rol**. El precio es el dato más sensible del sistema después de la caja.

**Reproducción.** Con sesión de cajero: `PUT /api/products/14` con `{"price": 1}` sobre un producto de $12.500 → **HTTP 200**, precio aplicado. `DELETE /api/products/47` → **HTTP 200**, producto borrado.

La respuesta del `PUT` además devuelve el campo `value` (el costo): **el cajero ve el margen del producto que acaba de editar.**

**Corrección:** permiso `products.write` / `products.price` verificado en el servidor; `select` explícito en la respuesta, sin `value`.

## P1-2 · `GET /api/audit` sin control de rol · **Verificado:** ✅

`src/app/api/audit/route.ts:24-53`. La página `/admin/auditoria` está protegida por el middleware; la API que la alimenta, no. Un cajero puede leer toda la bitácora, y los snapshots de `changes` incluyen el objeto `Product` completo con el campo `value` (costo).
**Corrección:** exigir rol; recortar los campos sensibles de `changes` según el permiso del solicitante.

## P1-3 · `GET /api/admin/sales` sin control de rol

`src/app/api/admin/sales/route.ts:61-69`. Solo comprueba que exista token. Expone las ventas de todo un rango con usuario, ítems y precios.

## P1-4 · `GET /api/sales/recent` sin autenticación y sin filtro de sucursal

`src/app/api/sales/recent/route.ts:5-18`. `findMany` sin `where`. Devuelve las últimas 5 ventas de **cualquier** sucursal a cualquiera que alcance la ruta.

## P1-5 · `/api/categories`, `/api/roles`, `/api/suppliers` sin autenticación propia

Ninguna verifica sesión ni rol. `POST /api/roles` pasa `data` crudo a `prisma.role.create` y permite crear un rol llamado `admin` si no existiera.

## P1-6 · El service worker cachea respuestas autenticadas

`public/sw.js` — regla `NetworkFirst` sobre `cacheName: "apis"` para todo `/api/` **excepto** `/api/auth/`.

**Impacto:** el catálogo con precios, los movimientos de caja y las ventas quedan en `CacheStorage` del dispositivo hasta 24 h. Sobreviven al cierre de sesión: quien tome la tablet después ve los datos del turno anterior sin credenciales.
**Corrección:** excluir del caché toda ruta autenticada; limpiar `CacheStorage` en el logout.

## P1-7 · Sin encabezados de seguridad

`next.config.ts` no define `headers()`. La configuración de Nginx tampoco los agrega. Faltan: `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`.

**Impacto:** la aplicación es embebible en un iframe (clickjacking sobre "Confirmar Venta"), y sin CSP cualquier XSS futuro tiene alcance total.
**Nota:** el vhost de producción contiene dos reglas `if ($http_next_action) { return 403; }` y un bloqueo de `multipart/form-data` — parches puntuales contra Server Actions que confirman que ya hubo una preocupación por esto, pero no sustituyen a los encabezados.

## P1-8 · Sin límite de intentos de inicio de sesión

`src/app/api/auth/login/route.ts`. Sin contador, sin bloqueo, sin retardo, sin CAPTCHA. El usuario `lautaro` y las contraseñas de ejemplo están publicados en `prisma/seed.ts:44-45` de un repositorio **público**.

**Corrección:** límite por IP y por usuario, con bloqueo temporal creciente y registro en auditoría.

## P1-9 · Dinero representado en punto flotante

`prisma/schema.prisma` — `Product.price`, `SaleItem.price`, `CashRegisterMovement.amount`, `CashCount.amount`, `Branch.currentCash` son `Float`.

**Impacto:** errores de redondeo que se acumulan en `currentCash` venta tras venta y aparecen como diferencias inexplicables en el arqueo.
**Corrección:** `Decimal @db.Decimal(12,2)` o enteros en centavos. **Requiere migración de datos** — ver [MASTER_ROADMAP.md](MASTER_ROADMAP.md).

## P1-10 · Borrado físico de registros financieros

`src/app/api/cash/[id]/route.ts:154-192`. Anular una venta ejecuta `saleItem.delete`, `sale.delete` y `cashRegisterMovement.delete`. El `AuditLog` conserva un snapshot, pero la venta desaparece de la tabla.

**Impacto:** el historial de ventas es reescribible. Las ventas anuladas no se pueden contar, ni auditar, ni reconstruir.
**Corrección:** anulación lógica (`status: 'anulada'` + asiento de reversión), nunca `DELETE`.

## P1-11 · El método de pago se deduce de una cadena de texto

`src/app/api/admin/sales/route.ts:97-104`. El vínculo venta ↔ pago se reconstruye con `description.match(/Venta\s*#(\d+)/i)`, y si no hay coincidencia se asume `'efectivo'` (`:126`).

**Impacto:** el reporte de ventas por medio de pago puede ser incorrecto sin ningún indicio de error. `POST /api/cash` acepta una `description` arbitraria del cliente, de modo que la asociación es influenciable desde el navegador.
**Corrección:** clave foránea `Sale.id` en `CashRegisterMovement`.

## P1-12 · Next.js 15.3.8 desactualizado

`npm audit` reporta avisos vigentes para esta versión, entre ellos varios de omisión de middleware en App Router (GHSA-267c-6grr-h53f, GHSA-26hh-7cqf-hhc6) y SSRF en Server Actions (GHSA-fr5h-rqp8-mj6g).

**Por qué importa acá:** el control de acceso a `/admin/*` vive **exclusivamente** en el middleware. Cualquier omisión del middleware es una omisión de la autorización de administración.
**Corrección:** actualizar a `15.5.x` (la rama estable de la misma major, sin cambios de ruptura). No pasar a 16 en esta etapa.

## P1-13 · PostCSS con lectura arbitraria de archivos

`postcss@8.5.6` — GHSA-6g55-p6wh-862q y GHSA-r28c-9q8g-f849 (altas). Solo afecta al momento de construir. **Explotable únicamente si se procesa CSS de terceros**, cosa que este proyecto no hace.
**Clasificación real: solo desarrollo.** Actualizar a 8.5.26 igualmente, es una actualización de parche.

---

# P2 — Medias

| # | Hallazgo | Archivo | Corrección |
|---|---|---|---|
| P2-1 | **El middleware exime cualquier ruta con un punto.** `if (/\.(.*)$/.test(pathname))` pretende dejar pasar assets, pero es una exención por patrón de texto | `middleware.ts:15` | Excluir por prefijo (`/_next/`, `/icons/`) o usar el `matcher` |
| P2-2 | **Cero validación de entrada en todo el proyecto.** `amount`, `quantity`, `price`, `totalStock` se aceptan como vengan: negativos, `NaN`, notación científica | 16 rutas | Esquemas Zod compartidos, validados antes de tocar Prisma |
| P2-3 | **`POST /api/cash` acepta importes negativos** y no impacta el saldo | `api/cash/route.ts:97-137` | Validar signo según `movementType`; impactar el saldo en la misma transacción |
| P2-4 | **Sin revocación de sesión.** El logout borra la cookie; el JWT sigue válido hasta 24 h. Cambiar rol o sucursal no invalida nada | `api/auth/logout/route.ts` | Versión de sesión en el usuario, verificada al validar el token |
| P2-5 | **Los mensajes de error internos llegan al cliente.** `error.message` en el 500 de ventas; `reason: e?.message` en los 401 de productos y sucursales | `api/sales/route.ts:170`, `api/products/route.ts:44` | Mensaje genérico afuera, detalle en el log del servidor |
| P2-6 | **`bcrypt.compareSync` bloquea el bucle de eventos** durante el login | `api/auth/login/route.ts:13` | Usar `bcrypt.compare` asíncrono |
| P2-7 | **Depuración en producción.** Dos `console.log` que imprimen el usuario validado en cada petición | `api/auth/validate/route.ts:34-42` | Eliminar |
| P2-8 | **Sin límite de tamaño de payload en la aplicación.** El único límite es `client_max_body_size 10m` de Nginx | — | Validar longitud de arrays y strings en los esquemas |
| P2-9 | **`test.js` es un script destructivo en la raíz del repositorio.** Borra `stockCheck`, `saleItem`, `branchStock` y `product` sin guarda de entorno, usando el `DATABASE_URL` que encuentre | `test.js:15-19` | Eliminar del repositorio |

**Sobre CSRF:** la cookie usa `sameSite: 'lax'`, que impide su envío en peticiones POST de origen cruzado. El riesgo está razonablemente mitigado sin token CSRF. Conviene pasar a `strict` cuando se implemente el resto.

---

# P3 — Bajas

| # | Hallazgo | Nota |
|---|---|---|
| P3-1 | **Enumeración de usuarios por tiempo de respuesta.** Si el usuario no existe se responde sin ejecutar bcrypt; si existe, se ejecuta. La diferencia es medible | Comparar siempre contra un hash señuelo |
| P3-2 | **`sharp` (alto, sin corrección disponible).** Vulnerabilidades heredadas de libvips. Llega como dependencia transitiva de Next para optimización de imágenes; el proyecto no procesa imágenes subidas por usuarios | **Riesgo bajo en este contexto.** Seguir el aviso |
| P3-3 | **`webpack`, `serialize-javascript`, `rollup-plugin-terser`, `workbox-*` (vía `next-pwa`).** Solo intervienen al construir | **Solo desarrollo.** Se resuelven al reemplazar `next-pwa` |
| P3-4 | **`@types/next-pwa` marcado como vulnerable.** Es un paquete de tipos; hereda la clasificación de `next-pwa` | **Falso positivo** a efectos de ejecución |

---

# Dependencias

`npm audit`: **28 vulnerabilidades — 1 crítica, 21 altas, 3 moderadas, 3 bajas.**

## Clasificación por explotabilidad real

| Clase | Paquetes | Acción |
|---|---|---|
| **Explotable, corrección trivial** | `next-auth` (crítica) | **Desinstalar.** No se usa |
| **Explotable en producción** | `next` 15.3.8 | Actualizar a 15.5.x |
| **Probablemente explotable** | `prisma`/`@prisma/config` | Actualizar a 6.19.3 (parche) |
| **Solo desarrollo / construcción** | `postcss`, `webpack`, `terser-webpack-plugin`, `serialize-javascript`, `rollup*`, `workbox*`, `@babel/*`, `ajv`, `minimatch`, `brace-expansion`, `lodash`, `picomatch`, `defu`, `effect`, `fast-uri`, `preact`, `diff`, `uuid` | Se arrastran vía `next-pwa` y las herramientas de build |
| **Transitiva sin corrección** | `sharp` | Sin parche disponible; riesgo bajo acá |
| **Falso positivo** | `@types/next-pwa` | Paquete de tipos |
| **Sin usar — desinstalar** | `next-auth`, `@faker-js/faker`, `lucide-react`, `react-icons`, `ts-node` | Reducen superficie sin ningún costo |

## Plan de actualización controlada

**No ejecutar `npm audit fix --force`.** Degradaría `next-pwa` de 5.6.0 a 2.0.2, una regresión de cuatro versiones mayores que rompería la PWA.

Cuatro pasos, cada uno verificable de forma aislada:

| Paso | Comando | Qué resuelve | Riesgo |
|---|---|---|---|
| 1 | `npm uninstall next-auth @faker-js/faker lucide-react react-icons ts-node` | La crítica y parte de las altas | Nulo — nada los importa |
| 2 | `npm i next@15.5.22 postcss@8.5.26` | Omisión de middleware, SSRF, lectura de archivos | Bajo — misma versión mayor |
| 3 | `npm i -D prisma@6.19.3 && npm i @prisma/client@6.19.3` | Alta transitiva de `@prisma/config` | Bajo — solo parche |
| 4 | Reemplazar `next-pwa` por `@serwist/next` | ~12 altas de la cadena `workbox`/`rollup` | **Medio** — `next-pwa` está sin mantenimiento desde 2022. Es una migración, no una actualización. Merece su propia tarea |

Verificar después de cada paso: `npx tsc --noEmit` y `npm run build`.

---

# Secretos

| Hallazgo | Estado |
|---|---|
| `ecosystem.config.js` con la contraseña de PostgreSQL en texto plano y permisos `-rw-rw-rw-` en el servidor | **Documentado en la recuperación. Pendiente de rotación** |
| La misma contraseña estuvo versionada en `scrap.py` en un repositorio **público** desde mayo de 2025 | **Sigue en el historial de git y en la rama de respaldo.** La rotación es obligatoria |
| `JWT_SECRET` con valor `change-me` en producción | **Crítico si aún es así.** Cualquiera que conozca el valor por defecto puede firmar un token de administrador |
| Contraseñas de ejemplo en `prisma/seed.ts:44-45` y `scripts/insertUsers.ts` | Solo datos de prueba, pero **`lautaro`/`Lkiosco123` es una cuenta administradora**. Verificar que no exista en producción |
| `.env` | Correctamente excluido del repositorio |
| Ningún secreto en el código de `src/` | Verificado |

> **`JWT_SECRET: "change-me"` es, potencialmente, el hallazgo más grave de todo este documento.** Con ese valor, firmar un token válido con `role: "admin"` no requiere ninguna vulnerabilidad: solo conocer el valor por defecto. No se pudo verificar si sigue vigente sin leer el `.env` del servidor, algo que quedó fuera del alcance autorizado. **Conviene confirmarlo antes que cualquier otra cosa de esta lista.**

---

# Cobertura de pruebas de seguridad requerida

Los diez casos que deben existir antes de considerar cerrada la Fase 0:

1. Una venta descuenta el stock exactamente una vez.
2. Una venta fallida no deja `Sale`, ni `CashRegisterMovement`, ni descuento de stock.
3. Vender por encima del stock disponible se rechaza sin permiso explícito.
4. Un cajero no puede modificar precios ni costos (403).
5. Un usuario de la sucursal A no accede a datos de la B (404/403).
6. Dos ventas concurrentes en efectivo suman ambos importes al saldo.
7. Anular una venta repone el stock y deja asiento de reversión, sin borrar filas.
8. Un cierre de caja no se puede modificar sin quedar auditado.
9. Un `price` manipulado en el body se ignora: se usa el de la base.
10. Toda ruta bajo `/api/` que no sea de autenticación responde 401 sin sesión y 403 sin permiso.
