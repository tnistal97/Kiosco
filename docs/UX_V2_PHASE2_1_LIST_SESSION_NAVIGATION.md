# UX V2 — Fase 2.1: lista de productos, sesión y navegación

Rama `feat/ux-v2-phase2-1-lista-navegacion`, sobre `feat/ux-v2-phase2-caja-venta` (fase 2). Sin migraciones. Sin cambios en reglas de negocio: servicios, esquemas de validación, ledger, stock, FEFO, pagos, cuentas corrientes y el parser numérico no se tocaron.

La fase tuvo dos mitades independientes:

- **A. La lista.** El catálogo del punto de venta dejó de ser una grilla de tarjetas y pasó a ser una lista operativa.
- **B. La navegación.** Una percepción de uso —«al cambiar de pantalla se traba, el menú desaparece, queda rara, parece que la sesión venció»— convertida en mediciones, y las cuatro fallas concretas que aparecieron, corregidas.

---

## 1. La lista del punto de venta

### 1.1 El problema

La fase 2 puso el catálogo a la vista, que era lo importante, pero lo dibujó como una grilla de tarjetas de 10 rem. En el mostrador eso se lee como una tienda, no como una herramienta:

- cada producto ocupaba 176 × 88 px para decir dos datos (nombre y precio);
- los nombres largos se partían en dos líneas: «Aceite de girasol 900 / ml», «Gaseosa lima limón 1.5 / L»;
- todas las tarjetas se parecían: sin un ancla vertical, encontrar una exigía barrer la pantalla en zigzag;
- no había forma de comparar precios de un vistazo: cada uno estaba en una coordenada distinta;
- faltaban dos datos que el mostrador sí usa —la categoría y cuánto queda—, y no entraban sin engordar la tarjeta.

### 1.2 Antes y después

`docs/ux-v2-phase2_1-evidence/before/` y `after/`, mismas pantallas y mismos anchos.

|                            | Antes (tarjetas)                   | Después (lista)                                                                  |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| Productos a la vista, 1366 | 16                                 | 11 ½                                                                             |
| Productos a la vista, 375  | 7                                  | 7                                                                                |
| Nombre                     | hasta 2 líneas, cortado con «…»    | un renglón entero                                                                |
| Datos por producto         | nombre, precio, «Se pesa»/«Quedan» | nombre, categoría, stock, precio, «Se pesa» / «Quedan 3» / «Agotado» / «Vencido» |
| Alineación                 | ninguna: cada precio en su tarjeta | cuatro columnas fijas, precios alineados a la derecha                            |
| Alto de fila               | 88 px                              | 44 px en escritorio, 56 px en el teléfono                                        |

Se cambió densidad por legibilidad y conviene decirlo con el número medido: en 1366 px entran **11 filas y media donde entraban 16 tarjetas**. A cambio, cada fila dice el nombre completo en un renglón y agrega dos datos que la tarjeta no mostraba. En el teléfono no hay que elegir: entran las mismas siete y además el nombre entra entero.

### 1.3 Escritorio y tablet (desde 768 px)

```
┌───────────────────────────────────────────────────────────────┬─────────────┐
│ [▌ Escaneá o buscá un producto            ] [📷] [Nuevo]      │ Ticket      │
│ (Frecuentes) Todos  Almacén  Bebidas  Lácteos  Limpieza  …    │ ─────────── │
│ ┌───────────────────────────────────────────────────────────┐ │ Yerba mate  │
│ │ PRODUCTO            CATEGORÍA      STOCK        PRECIO    │ │ 2 u. × …    │
│ ├───────────────────────────────────────────────────────────┤ │ …           │
│ │ Aceite de girasol   Almacén        18 u.     $ 3.290,00   │ │             │
│ │▌Agua mineral 2 L    Bebidas        44 u.     $ 1.490,00   │ │ ─────────── │
│ │ Queso cremoso  Se pesa  Lácteos    6,000 kg  $ 9.800,00/kg│ │ Total       │
│ │ Helado 1 L          Congelados     Agotado   $ 6.800,00   │ │ [ Cobrar  ] │
│ └───────────────────────────────────────────────────────────┘ │             │
└───────────────────────────────────────────────────────────────┴─────────────┘
```

- La cabecera de columnas queda pegada arriba mientras la lista se desplaza, y es `aria-hidden`: para quien escucha, cada fila ya dice nombre y precio en su etiqueta.
- La fila elegida se marca con **cuatro** señales a la vez, no sólo con color: barra de acento a la izquierda (3 px), fondo, `aria-current` y —cuando se llega con el teclado— el contorno de foco.
- «Se pesa» es una etiqueta al lado del nombre; el precio de lo pesable lleva su denominador (`/ kg`).
- El stock se lee sin color: «Quedan 3 u.», «Agotado», «Vencido» —cuando lo que hay no se puede vender por vencimiento, que para el que repone no es lo mismo— o la cantidad a secas.
- Sin proveedor, sin costo, sin margen, sin identificadores: nada administrativo en el mostrador.

Las columnas se acomodan al ancho **disponible**, que no es el de la pantalla: desde 1024 px aparece el ticket de 440 px y al catálogo le quedan unos 520.

| Ancho de pantalla | Ticket al costado | Columnas de la lista                           |
| ----------------- | ----------------- | ---------------------------------------------- |
| hasta 767         | no (barra fija)   | dos renglones: nombre / precio (§1.4)          |
| 768 – 1023        | no                | Producto · Categoría · Stock · Precio          |
| 1024 – 1279       | sí                | Producto · Stock · Precio (la categoría sobra) |
| desde 1280        | sí                | Producto · Categoría · Stock · Precio          |

La categoría es lo primero que se va porque es lo que menos se usa para elegir: para eso están los chips de arriba.

### 1.4 Teléfono (hasta 767 px)

```
┌──────────────────────────────┐
│ [▌ Escaneá o buscá   ] [📷] │
│ (Frecuentes) Todos  Bebidas →│
│ ┌──────────────────────────┐ │
│ │ Aceite de girasol 900 ml ☆│ │
│ │ $ 3.290,00               │ │
│ ├──────────────────────────┤ │
│ │ Jugo naranja 1 L  Quedan 3│ │
│ │ $ 1.980,00               ☆│ │
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ Ticket · 3 artículos [Cobrar]│
└──────────────────────────────┘
```

La misma fila, reacomodada: el nombre arriba, el precio abajo en grande, el estado a la derecha del nombre y la categoría escondida —en el mostrador nadie elige por categoría, elige por nombre; para eso están los chips—. **Ningún dato se duplica en el DOM**: las celdas cambian de lugar con CSS (`grid`), no se dibujan dos veces «una para móvil y otra para escritorio». Hay una prueba que lo comprueba, porque es exactamente el error que después se arregla en una sola de las dos copias.

Cada fila mide 56 px de alto en el teléfono y toda la fila es el objetivo: se toca donde caiga el dedo.

### 1.5 Categorías y frecuentes

Los chips adelgazaron: el inactivo es texto sin borde y sólo el activo tiene fondo y borde. La fila de secciones no tiene por qué pesar más que la lista que filtra. Siguen midiendo 44 px en pantalla táctil (36 px en escritorio), se desplazan de costado en el teléfono y se envuelven en escritorio, y se recorren con ← → desde un solo Tab (roving tabindex, fase 2).

«Frecuentes» sigue siendo lo que era —favoritos marcados con ★ más lo más vendido en esta caja, todo en `localStorage`— y sigue siendo **un chip más**, no una segunda lista arriba de la principal. Era la opción que la fase pedía evaluar («filtro Frecuentes», sin generar otra grilla). La estrella pasó a ser una columna fija de 44 px al final de cada fila, visible siempre en pantalla táctil y al pasar por encima en escritorio.

### 1.6 Teclado

Sin cambios respecto de la fase 2, porque la aritmética es la misma con una sola columna:

| Tecla      | En la lista                                       |
| ---------- | ------------------------------------------------- |
| ↑ ↓        | fila anterior / siguiente (sin dar la vuelta)     |
| ← →        | lo mismo: una fila                                |
| Inicio Fin | primera / última                                  |
| Enter      | agrega, y el foco se queda en la lista            |
| Escape     | vuelve al lector                                  |
| Tab        | una sola fila entra con Tab; el resto con flechas |

Desde el campo de escaneo: con el ticket vacío, ↓ entra a la lista; buscando, ↑ ↓ resaltan un resultado y Enter lo agrega.

### 1.7 Rendimiento

No se pierde nada y no hace falta virtualizar todavía:

- la consulta sigue trayendo **60 productos por página** (`FILAS_POR_CONSULTA`), con «Se muestran 42 de 120. Buscá por nombre para encontrar el resto» cuando no entran todos;
- 60 filas son 60 botones con cuatro celdas: el DOM de la lista es **más liviano** que el de las tarjetas, que llevaban un contenedor extra y dos capas por tarjeta;
- entrar a `/venta` (F5, build de producción, mediana de 5): **350 ms** hasta ver el catálogo, contra 337 ms antes. La diferencia está dentro del ruido de la medición y viene de la consulta, no del dibujo;
- cambiar de categoría o buscar dispara **una** consulta al servidor (con 250 ms de espera mientras se escribe, fase 3);
- el ranking de frecuentes sigue siendo local y sin esquema.

Si algún día hay que mostrar miles de filas de una vez, la respuesta es paginar o virtualizar; hoy el tope de 60 hace ese trabajo y la lista dice cuántos quedan afuera.

---

## 2. Sesión

### 2.1 Cuánto dura

| Qué                    | Valor                                                                    | Dónde                                      |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| Duración del token     | **12 h** (`SESSION_TTL_SECONDS`), «una jornada de almacén»               | `src/server/auth/token.ts`                 |
| Algoritmo              | HS256, `jose` (sirve en Node y en el Edge)                               | ídem                                       |
| Cookie                 | `token`, `httpOnly`, `sameSite=lax`, `secure` en producción, `path=/`    | `sessionCookieOptions`                     |
| Renovación             | **no hay**: el token no se refresca al usarlo                            | —                                          |
| Revocación             | `sessionVersion` en la base; cambiarla invalida las sesiones del usuario | `getSession`                               |
| Comprobación por salto | firma y vencimiento en el middleware; usuario/estado/sucursal en la base | `middleware.ts` / `server/auth/session.ts` |

### 2.2 Qué pasa cuando vence, paso por paso

Hay tres caminos y hasta esta fase sólo uno estaba resuelto.

1. **La persona navega a otra pantalla.** El middleware no encuentra un token válido, borra la cookie y redirige al ingreso con `?next=`. Funcionaba bien y sigue igual. Medido contra el servidor de pruebas:

   | Petición                         | Respuesta | `Location` / cuerpo                         |
   | -------------------------------- | --------- | ------------------------------------------- |
   | `GET /` sin cookie               | 307       | `/login`                                    |
   | `GET /caja` sin cookie           | 307       | `/login?next=%2Fcaja`                       |
   | `GET /caja` con token inservible | 307       | `/login?next=%2Fcaja` + `token=; Max-Age=0` |
   | `GET /login`, `GET /offline`     | 200       | son públicas                                |
   | `GET /api/products` sin cookie   | 401       | `{"error":{"code":"UNAUTHENTICATED",…}}`    |
   | `GET /api/*` con token vencido   | 401       | `code: "SESSION_EXPIRED"` + borra cookie    |

   No hay cadenas de redirecciones: un solo salto, y la cookie rota se limpia para no entrar en bucle. Tras ingresar, `destinoSeguro()` valida el `next` (tiene que empezar con `/` y no ser `//`) y devuelve a la pantalla.

   **El escenario se prueba sin esperar doce horas.** `e2e/navegacion.spec.ts` toma la sesión real, vuelve a firmar los mismos datos con el vencimiento en el pasado —con el mismo secreto que usa el servidor— y comprueba las dos mitades: la API contesta 401 con `SESSION_EXPIRED` y la navegación termina en `/login?next=%2Fcaja`.

2. **La persona sigue en la pantalla que ya tenía abierta** y toca algo que consulta al servidor. La API contesta 401 y **hasta ahora cada pantalla lo mostraba como un error suyo**: «Error al cargar productos», «No se pudo cobrar». Nadie decía que la sesión se había terminado. Ahora el cliente HTTP avisa una sola vez —un evento— y el armazón muestra «Tu sesión venció» con **Volver a ingresar** apuntando a `/login?next=<pantalla actual>`. El 401 de `/api/auth/*` queda afuera: ahí significa «esa contraseña no es».

Y una cuarta que NO es sesión vencida y hay que distinguir: **sin conexión**. El service worker guarda el documento de `/offline` y lo sirve para cualquier dirección —se pide `/productos` sin red y llega esa pantalla—, con lo cual la barra del navegador dice `/productos` y lo que se muestra es otra cosa. La primera versión de esta fase no lo distinguía y **mostraba «Tu sesión venció» encima de la pantalla de sin conexión**: lo encontró `npm run pwa:check`, que ya comprobaba justamente eso. Ahora el documento de sin conexión se marca (`data-pantalla="sin-conexion"`) y el armazón lo reconoce; `navigator.onLine` se mira también, pero no alcanza solo —con la red emulada de las pruebas sigue diciendo `true`, y un wifi sin salida también—.

3. **El token todavía tiene firma válida pero la base ya no lo acepta**: usuario dado de baja, sesión revocada (`sessionVersion`) o sucursal cambiada. El middleware **no consulta la base** —corre en el Edge, donde Prisma no funciona— así que deja pasar; el layout pide la sesión de verdad y recibe `null`. Antes eso dibujaba la pantalla **sin armazón**: sin barra lateral, sin cabecera y sin ninguna explicación. Es, textualmente, «el menú desaparece y la app queda rara». Ahora dice lo mismo que en los otros dos casos.

### 2.3 Lo que NO se tocó

La duración de 12 h, la ausencia de renovación deslizante y el límite de intentos de ingreso se auditaron y se dejaron como están: cambiarlos es una decisión de seguridad, no de interfaz. Queda anotado en «Riesgos y diferidos».

### 2.4 El límite de intentos, y su efecto en el uso

`src/server/auth/loginAttempts.ts`: 8 intentos fallidos por usuario **y** origen en 15 minutos bloquean 15 minutos; un ingreso correcto limpia el contador; el contador vive en la memoria del proceso.

Para una persona en el mostrador eso es correcto y el mensaje es claro («Demasiados intentos fallidos. Espere 15 minutos.», 429). El problema real es de desarrollo y ya se cobró dos tardes: si una corrida de pruebas se corta a la mitad y queda un `next start` huérfano, ese proceso **conserva los contadores**, y la corrida siguiente —que lo reutilizaba— fallaba todos los ingresos. Se corrigió por el lado de las pruebas (§5), no aflojando el límite.

---

## 3. Barra lateral y armazón

### 3.1 Dónde se monta

Un solo layout, `src/app/layout.tsx`, que es un componente de servidor asíncrono: pide la sesión (`getSession` + una consulta a la sucursal) y envuelve todo con `SessionProvider` → `AppShell`. `AppShell` dibuja la barra lateral, el cajón de móvil, la cabecera y `<main>`. **No hay layouts anidados**: ninguna ruta tiene el suyo.

Consecuencia buena: al navegar entre rutas, el armazón **no se vuelve a dibujar**; Next sólo pide el segmento que cambia. Consecuencia mala: al usar `headers()`, el layout vuelve dinámica toda la aplicación, así que cada navegación es un viaje al servidor.

### 3.2 ¿Se desmonta al navegar?

No. Se comprobó de dos maneras y las dos dicen lo mismo:

- **Medido** (`npm run nav:metrics`): durante cada navegación un observador mira cada cuadro y anota si el `<aside>` desapareció o si cambió de nodo. En 7 rutas × 5 muestras, antes y después: **nunca faltó y nunca se remontó**.
- **Probado** (`e2e/navegacion.spec.ts`): se marca el nodo de la barra lateral con un atributo, se navega venta → inicio → venta, y el atributo sigue ahí.

Es decir: **la barra lateral no desaparecía al navegar**. La percepción era real, pero la causa era otra —las tres de §2.2 y la de §3.3—, y por eso la fase empezó midiendo en vez de arreglando el token.

### 3.3 Los cuatro agujeros que sí existían

| Qué se veía                                      | Causa                                                                                                  | Corrección                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| «Hago clic y no pasa nada»                       | **No había ningún `loading.tsx`.** Sin límite de carga, el enrutador se queda en la pantalla anterior. | Un límite por sección (§3.4), con barra de progreso y esqueleto, y el armazón intacto. |
| «La pantalla queda en blanco dentro del marco»   | Sin `error.tsx`, un fallo al dibujar dejaba el contenido vacío y sin explicación.                      | `src/app/error.tsx`, con «Probar de nuevo» e «Ir al inicio».                           |
| «La página entera en blanco» (con la base caída) | Un fallo del **layout** no lo puede atajar `error.tsx`.                                                | `src/app/global-error.tsx`, con su propio HTML y su propio estilo.                     |
| «Desaparece el menú y no dice nada»              | Sin sesión, `AppShell` dibujaba el contenido pelado (§2.2, caso 3).                                    | Pantalla «Tu sesión venció» con `?next=`.                                              |

### 3.4 Dónde va el límite de carga, y por qué no en la raíz

Lo obvio era un solo `src/app/loading.tsx` para toda la aplicación. Se hizo así, y una prueba de la fase 1 lo desarmó: `/compras/recepcion/<id>` —que no es una pantalla sino una dirección que redirige, y que llama a `notFound()` cuando el número no existe— **pasó de responder 404 a responder 200**.

La causa no es un descuido: un límite de carga hace que la respuesta **empiece a viajar** antes de que la página termine, y el estado HTTP se manda con el primer byte. Comprobado quitando y poniendo el archivo, con el servidor de desarrollo en marcha:

```
con src/app/loading.tsx     GET /compras/recepcion/99999999 → 200
sin src/app/loading.tsx     GET /compras/recepcion/99999999 → 404
```

Así que el límite se pone **por sección** —dieciséis archivos de tres líneas que devuelven el mismo componente, `CargandoPantalla`— y `/compras` se queda sin él a propósito, para no perder el estado de esa ruta. El inicio se movió a un grupo de rutas, `src/app/(inicio)/`, que no cambia la dirección (`/`) y le da su propio límite sin cubrir a las demás.

Efecto colateral medido y aceptado: durante una navegación del lado del cliente hacia una ruta con límite de carga, el `<title>` **se desprende por un cuadro** —16 ms, medido cuadro a cuadro en la construcción de producción— porque Next vuelve a dibujar los metadatos después del esqueleto. Es de Next, no de la aplicación; se documenta y las pruebas de accesibilidad esperan a que la pantalla se asiente antes de analizar (si el título faltara de verdad, esa espera vence y la prueba falla igual).

### 3.5 Parpadeo y salto de layout

El desplazamiento acumulado (`layout-shift`) durante cada navegación, medido:

| Navegación      | CLS | Por qué                                                                                                                                  |
| --------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/` → `/venta`  | 0,6 | La barra lateral **se contrae sola al entrar a la caja** (decisión de la fase 1: 168 px más para el ticket). Todo el contenido se corre. |
| `/venta` → `/`  | 0,1 | La misma barra, volviendo a expandirse.                                                                                                  |
| Las otras cinco | 0   | Nada se mueve.                                                                                                                           |

No se cambió: es una decisión de la fase 1 con un motivo medido, ocurre una vez por navegación a la caja y no mueve nada bajo el dedo. Queda anotado como candidato a suavizarse con una transición (§7).

---

## 4. Navegación: mediciones

Build de **producción** (`next build` + `next start -p 3099`), base de desarrollo sembrada, misma máquina, sesión de `admin`, 1366 × 768. **Cinco muestras por ruta; se informa la mediana.** El reloj es el del navegador (`performance.now()`) y el clic lo dispara la propia página: así no se cuela el ida y vuelta del protocolo de automatización, que en la primera versión de la herramienta daba 100 ms clavados en las siete rutas y no medía nada.

Qué es cada columna:

- **visual** — del clic hasta el primer cambio en pantalla (aparece el esqueleto, o ya cambió el título). Es el «no pasa nada» del reporte.
- **commit** — hasta que el enrutador acepta la navegación.
- **datos** — hasta que no queda ningún esqueleto en el contenido: lo que la persona vino a leer.

| Desde → hasta      | visual antes | visual después | datos antes | datos después | APIs | CLS |
| ------------------ | ------------ | -------------- | ----------- | ------------- | ---- | --- |
| `/venta` → `/`     | 46,3 ms      | **24,1 ms**    | 150,8 ms    | 167,0 ms      | 12   | 0,1 |
| `/` → `/venta`     | 53,5 ms      | **19,2 ms**    | 357,6 ms    | 372,9 ms      | 3    | 0,6 |
| `/` → `/caja`      | 49,4 ms      | **17,4 ms**    | 103,9 ms    | 92,4 ms       | 5    | 0   |
| `/` → `/ventas`    | 44,7 ms      | **16,0 ms**    | 78,6 ms     | 84,3 ms       | 1    | 0   |
| `/` → `/clientes`  | 45,1 ms      | **20,3 ms**    | 69,3 ms     | 62,2 ms       | 1    | 0   |
| `/` → `/productos` | 45,4 ms      | **17,2 ms**    | 396,6 ms    | 389,8 ms      | 3    | 0   |
| `/` → `/stock`     | 44,9 ms      | **20,1 ms**    | 336,2 ms    | 335,7 ms      | 3    | 0   |

Carga directa (F5), leída del Navigation Timing del navegador:

| Ruta         | TTFB antes | TTFB después | DOMContentLoaded después | datos después |
| ------------ | ---------- | ------------ | ------------------------ | ------------- |
| `/`          | 14,0 ms    | 16,1 ms      | 28,4 ms                  | 137 ms        |
| `/venta`     | 17,0 ms    | 18,6 ms      | 39,9 ms                  | 350 ms        |
| `/caja`      | 12,1 ms    | 12,7 ms      | 27,5 ms                  | 107 ms        |
| `/ventas`    | 11,6 ms    | 11,9 ms      | 26,5 ms                  | 93 ms         |
| `/clientes`  | 34,6 ms    | 21,6 ms      | 36,5 ms                  | 72 ms         |
| `/productos` | 16,6 ms    | 15,9 ms      | 36,9 ms                  | 412 ms        |
| `/stock`     | 15,7 ms    | 16,9 ms      | 43,1 ms                  | 367 ms        |

Cómo leer esto, sin adornos:

- **El primer cambio visible se redujo a menos de la mitad** (mediana de las siete rutas: 45,4 ms → 19,2 ms). El motivo no es que la aplicación «vaya más rápido»: es que `<Link>` **ya puede precargar**. Next sólo precarga de una ruta dinámica su límite de carga, y no había ninguno; con `loading.tsx` la precarga tiene algo que traer y la navegación arranca desde algo ya descargado.
- Con la precarga funcionando, el esqueleto **no llega a verse** en esta máquina: la transición se resuelve antes. Su trabajo aparece cuando el enlace no se precargó o el servidor tarda —una tablet vieja, la red del local, el servidor de desarrollo—, y ahí es la diferencia entre un esqueleto y una pantalla congelada.
- **En producción, en esta máquina, nada de esto tardaba lo suficiente como para sentirse «trabado».** La percepción del reporte es real, pero su causa está en §7: el modo desarrollo, la construcción contaminada y los tres caminos de sesión vencida. Decir otra cosa sería inventar.
- Los tiempos de **datos** no cambiaron: los manda la consulta, no la interfaz. `/productos` (396 ms) y `/venta` (342 ms) son los dos que piden más.
- `/venta` → `/` dispara 12 peticiones a `/api`: es la portada, que arma su tablero. No se tocó en esta fase.

Datos crudos, con las cinco muestras de cada ruta: `docs/metrics/phase2_1-navegacion-antes.json` y `-despues.json`. Se regeneran con `npm run nav:metrics -- antes|despues`.

---

## 5. `next dev` y el aislamiento de `.next`

`next dev --turbopack` y `next build` escribían **los dos** en `.next`. Con un servidor de desarrollo olvidado en el puerto 3000, la construcción de producción quedaba mezclada con artefactos de Turbopack y `next start` levantaba roto:

```
Error: Cannot find module '../chunks/ssr/[turbopack]_runtime.js'
TypeError: routesManifest.dataRoutes is not iterable
```

Todas las páginas contestaban 500 **después** de que el login respondiera 200, así que la suite de extremo a extremo fallaba en `waitForURL` y el síntoma no se parecía en nada a la causa. Pasó dos veces, en las fases 1 y 2, y las dos veces se perdió media tarde buscando en el lugar equivocado.

**Decisión: separar las carpetas, no la disciplina.**

```ts
// next.config.ts
distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
```

`next dev` pone `NODE_ENV=development` antes de leer la configuración; `next build` y `next start`, `production`. El despliegue, `scripts/release-artifact.mjs` y `pwa:check` siguen usando `.next` sin cambios. Se agregó `.next-dev/` a `.gitignore`, a `.prettierignore`, a los ignorados de ESLint y a `include` de `tsconfig.json` (si no, Next reescribe el archivo entero en cada arranque).

**Comprobado**: `npm run build` completo con el servidor de desarrollo encendido en el 3000, y `next start` funcionando después.

Y el otro lado del mismo problema, en las pruebas:

```ts
// playwright.config.ts
reuseExistingServer: process.env.E2E_REUSE === '1',   // antes: !process.env.CI
```

Un `next start` huérfano de una corrida cortada servía una construcción vieja **y** conservaba en memoria el bloqueo por intentos de ingreso (§2.4). Ahora, si el puerto está ocupado, Playwright lo dice y se planta —que es el aviso que hacía falta—; `E2E_REUSE=1 npm run e2e` permite reutilizarlo a propósito.

`tests/unit/aislamiento-de-build.test.ts` comprueba que las dos decisiones sigan en su lugar.

**Tercera aparición, esta vez a propósito.** Durante esta fase hubo que descartar una hipótesis y se puso `distDir: '.next'` un rato para probar en desarrollo. Bastó eso: el siguiente `next start` volvió a levantar con `TypeError: routesManifest.dataRoutes is not iterable`. Es la demostración más directa de que el problema era ese y de que la separación lo cierra.

**Y una trampa nueva, que conviene tener anotada.** La caché de Turbopack vive dentro de la carpeta de construcción. Al agregar los dieciséis `loading.tsx` con el servidor de desarrollo encendido, esa caché quedó vieja y **todas** las pantallas se quedaron mostrando el esqueleto para siempre —el servidor respondía 200 y el contenido no llegaba nunca—. No es un defecto de la aplicación: con `rm -rf .next-dev` y el servidor reiniciado, todo volvió a la normalidad. Anotado en `docs/DEV_ENVIRONMENT.md`: si el desarrollo se comporta raro después de agregar o mover archivos de ruta, hay que borrar `.next-dev`.

---

## 6. Qué se tocó

| Archivo                                     | Qué                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/components/venta/ProductBrowser.tsx`   | La lista: cabecera de columnas, filas, chips más finos, estrella al final             |
| `src/components/shell/CargandoPantalla.tsx` | **nuevo** — el esqueleto de carga, uno solo para todas las secciones                  |
| `src/app/*/loading.tsx` (16)                | **nuevos** — el límite de carga por sección; `/compras` queda afuera (§3.4)           |
| `src/app/(inicio)/page.tsx`                 | movido desde `src/app/page.tsx` para que el inicio tenga su propio límite             |
| `src/app/error.tsx`                         | **nuevo** — una pantalla que falla, dentro del armazón                                |
| `src/app/global-error.tsx`                  | **nuevo** — el armazón mismo falla                                                    |
| `src/components/shell/SesionVencida.tsx`    | **nuevo** — pantalla y aviso de sesión vencida, con `?next=`                          |
| `src/components/shell/AppShell.tsx`         | Sin sesión ya no dibuja el contenido pelado; monta el aviso; distingue «sin conexión» |
| `src/app/offline/page.tsx`                  | Lleva la marca con la que el armazón la reconoce servida en otra dirección            |
| `tests/ui/armazon.test.tsx`                 | **nuevo** — las tres situaciones sin sesión, separadas (3)                            |
| `src/lib/api-client.ts`                     | Un 401 (salvo `/api/auth/*`) avisa una sola vez, para todas las pantallas             |
| `src/app/inventarios/page.tsx`              | `router.push` en lugar de `window.location`: era la única navegación dura             |
| `next.config.ts`, `playwright.config.ts`    | Aislamiento de `.next` y de los servidores de prueba                                  |
| `scripts/medir-navegacion.ts`               | **nuevo** — `npm run nav:metrics`                                                     |
| `tests/ui/catalogo.test.tsx`                | Columnas, estados y «cada dato una sola vez» (22)                                     |
| `tests/ui/sesion-vencida.test.tsx`          | **nuevo** — pantalla, aviso y quién avisa (10)                                        |
| `tests/ui/cargando.test.tsx`                | **nuevo** — el límite de carga se anuncia (2)                                         |
| `tests/unit/aislamiento-de-build.test.ts`   | **nuevo** — las dos decisiones de §5 siguen en su lugar (6)                           |
| `e2e/navegacion.spec.ts`                    | **nuevo** — ida y vuelta, armazón, sesión vencida, 401 y 403 (8)                      |
| `e2e/caja-venta.spec.ts`, `movil.spec.ts`   | La lista: columnas, categoría que filtra, ↑ ↓, y un toque con el dedo                 |
| `e2e/accesibilidad.spec.ts`                 | Axe espera a que la pantalla se asiente (el `<title>`, §3.4)                          |
| `e2e/alta-rapida.spec.ts`                   | Espera a que el lector tenga el foco antes de usar los atajos                         |

Sin cambios en `src/modules`, `src/server`, `prisma` ni en el parser numérico.

---

## 7. Hallazgos

1. **La barra lateral no se desmonta al navegar.** Medido en 7 rutas × 5 muestras, antes y después: nunca faltó, nunca cambió de nodo. La causa de «desaparece el menú» era quedarse sin sesión (§2.2, caso 3), donde el armazón entero no se dibujaba.
2. **No había ningún `loading.tsx` en toda la aplicación**, y eso además impedía que `<Link>` precargara las rutas dinámicas. Es el hallazgo con más efecto por línea escrita de la fase.
   - Y su reverso: **un límite de carga se lleva puesto el estado HTTP** de la ruta que envuelve (404 → 200). Por eso se pone por sección y no en la raíz (§3.4).
3. **El middleware y el layout no comprueban lo mismo, y esa diferencia se veía.** El middleware mira firma y vencimiento (Edge, sin base); el layout pregunta a la base. En la ventana entre los dos, la aplicación se dibujaba sin armazón.
4. **Un 401 no se distinguía de un error de pantalla.** Ahora hay cuatro cosas distintas y se ven distintas: sesión vencida (401), permiso que falta (403), servidor caído (500) y sin conexión (`NetworkError`).
   - Y una quinta, que la propia corrección estuvo a punto de confundir: **sin red no es sesión vencida**. La comprobación de la PWA lo encontró antes de que saliera de la rama (§2.2).
5. **El salto de layout al entrar a la caja es real y medible**: CLS 0,6 por la barra lateral que se contrae sola. Es una decisión de la fase 1, no un defecto, pero está medido.
6. **`next dev` podía romper la construcción de producción** y lo hizo dos veces (§5) —tres, contando la que se provocó en esta fase para confirmar la causa—. Ya no puede.
   - La caché de Turbopack, ahora en `.next-dev`, puede quedar vieja al agregar archivos de ruta y dejar todas las pantallas en el esqueleto. Se arregla borrando la carpeta; queda documentado.
7. **El bloqueo por intentos de ingreso vive en la memoria del proceso** y sobrevive a las corridas de prueba cortadas por la mitad (§2.4).
8. **La portada dispara 12 peticiones a `/api` al abrirse.** No se tocó: es otra pantalla y otra fase.

---

## 8. Verificación

Antes = `feat/ux-v2-phase2-caja-venta` en `dae6d0b` (fase 2); después = esta rama en su último commit. Misma máquina, misma base de desarrollo sembrada con `seed:demo`.

| Comprobación                 | Antes (fase 2)              | Después (2.1)                                                        |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `npm run format:check`       | Pasa                        | Pasa                                                                 |
| `npm run lint`               | Pasa                        | Pasa                                                                 |
| `npm run typecheck`          | Pasa                        | Pasa                                                                 |
| `npm test`                   | 87 archivos · 1.790 pruebas | **91 archivos · 1.814 pruebas** · 643 s                              |
| `npm run test:e2e`           | 289 pruebas                 | **299 pruebas** · todas pasan                                        |
| `npm run build`              | Pasa                        | Pasa, **y con el servidor de desarrollo encendido** (§5)             |
| `npm run pwa:check`          | Pasa                        | Pasa —y encontró un defecto de esta fase antes de que saliera (§2.2) |
| `npm run integrity:check`    | Sin inconsistencias         | Sin inconsistencias                                                  |
| `npm audit`                  | 5 high preexistentes        | Iguales: no se tocaron dependencias                                  |
| Axe (WCAG 2.1 AA)            | 43 pantallas, sin faltas    | 44 pruebas, sin faltas (incluida la lista nueva)                     |
| Móvil (`movil.spec`, 375 px) | sin scroll lateral, 44 px   | + tocar una fila con el dedo                                         |

Pruebas nuevas de esta fase: `tests/ui/sesion-vencida.test.tsx` (10), `tests/ui/armazon.test.tsx` (3), `tests/ui/cargando.test.tsx` (2), `tests/unit/aislamiento-de-build.test.ts` (6), más los casos agregados a `tests/ui/catalogo.test.tsx`; y `e2e/navegacion.spec.ts` (8), la categoría que filtra en `caja-venta` y el toque con el dedo en `movil`.

Código de negocio: sin cambios. `git diff dae6d0b..HEAD -- src/modules src/server prisma` está vacío. Migraciones: 0.

---

## 9. Riesgos y diferidos

- **La sesión no se renueva.** A las 12 horas exactas, quien esté trabajando va a ver «Tu sesión venció» —ahora con un mensaje claro y volviendo a su pantalla, que antes no pasaba—. Una renovación deslizante es una decisión de seguridad: alarga la ventana de un token robado. No se cambió en una fase de interfaz.
- **El bloqueo de ingreso no es global.** Con más de un proceso detrás de un balanceador deja de contar bien. Ya estaba anotado en `docs/SECURITY_AUDIT.md`.
- **El salto de la barra lateral al entrar a `/venta`** (CLS 0,6) se puede suavizar con una transición de ancho, o no contraerla sola. No se hizo en esta fase para no revisar una decisión de la fase 1 sin datos de uso.
- **Virtualización de la lista**: no hace falta con el tope de 60 por consulta. Si algún día se muestran miles de filas de una vez, hay que paginar o virtualizar, no subir el tope.
- **Frecuentes compartidos entre cajas**, imágenes en las filas y categorías anidadas siguen diferidos desde la fase 2.
- **La portada y sus 12 peticiones**, sin tocar.
