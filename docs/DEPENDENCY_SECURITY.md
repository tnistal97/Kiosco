# Seguridad de dependencias

> Estado al cierre de la Fase 1: **`npm audit` → 0 vulnerabilidades**.
> Al inicio: 19 (15 altas, 2 moderadas, 2 bajas).
> Al inicio de la Fase 0: 25, con una **crítica**.

## Qué NO se hizo, y por qué

**No se ejecutó `npm audit fix`.** Ni con `--force` ni sin él. La versión sin
forzar sigue proponiendo esto:

```
change serialize-javascript 6.0.2 => 4.0.0
```

Bajar dos versiones mayores el paquete que tiene el aviso de ejecución remota
de código. `npm audit fix` resuelve el árbol de dependencias, no el problema
de seguridad: para él, una versión vieja que el aviso no menciona es una
solución válida.

**No se actualizó a `next@16` ni a `next-pwa@2.0.2`.** Son las dos
"correcciones" que `npm audit` marca como disponibles, y las dos son cambios
de versión mayor. En el caso de `next-pwa`, además, _hacia atrás_: de 5.6.0 a
2.0.2.

## Qué se hizo: `overrides`

`overrides` en `package.json` fuerza la versión de una dependencia transitiva
sin tocar las directas. Es la herramienta correcta acá: el problema no está en
lo que el proyecto pide, sino en lo que sus dependencias arrastran.

Cada entrada usa un **selector con rango**, no el nombre pelado:

```json
"picomatch@<2.3.2": "^2.3.2"
```

La diferencia importa. `"picomatch": "^2.3.2"` a secas forzaría la versión 2
en todas partes, y en el árbol conviven `2.3.1` (vulnerable) y `4.0.5` (sana,
usada por vite y vitest). El selector con rango toca solo la primera. Arreglar
una vulnerabilidad bajando otra dependencia sana es exactamente el error que
`npm audit fix` comete.

| Override                                                        | Aviso                                                 | Dónde estaba                                        | Riesgo del cambio                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `rollup@<2.80.0` → `^2.80.0`                                    | Escritura arbitraria de archivos por _path traversal_ | `rollup` 2.79.2, vía workbox                        | Nulo: parche dentro del mismo mayor                                                       |
| `picomatch@<2.3.2` → `^2.3.2`                                   | Inyección de métodos en clases POSIX                  | `picomatch` 2.3.1                                   | Nulo                                                                                      |
| `brace-expansion@<1.1.13` → `^1.1.13`                           | Cuelgue del proceso por secuencia de paso cero        | `brace-expansion` 1.1.12                            | Nulo                                                                                      |
| `brace-expansion@>=2.0.0 <2.0.3` → `^2.0.3`                     | Igual, en la rama 2.x                                 | `filelist`                                          | Nulo                                                                                      |
| `minimatch@>=5.0.0 <5.1.7` → `^5.1.7`                           | ReDoS con comodines repetidos                         | `filelist` 5.1.6                                    | Nulo. El selector deja intactas las copias 3.x y 10.x, que tienen APIs distintas          |
| `lodash@<=4.17.23` → `^4.18.1`                                  | Inyección de código vía `_.template`                  | `lodash` 4.17.21                                    | Bajo: menor dentro del mismo mayor                                                        |
| `fast-uri@<=3.1.0` → `^3.1.5`                                   | _Path traversal_ por codificación en porcentaje       | `fast-uri` 3.1.0                                    | Nulo                                                                                      |
| `ajv@>=7.0.0 <8.18.0` → `^8.20.0`                               | ReDoS con la opción `$data`                           | Las cuatro copias 8.17.1                            | Nulo. El selector no toca la copia 6.x, cuya API es incompatible                          |
| `serialize-javascript@<=7.0.2` → `^7.0.7`                       | **RCE vía `RegExp.flags`**                            | 6.0.2 y una 4.0.0 anidada en `rollup-plugin-terser` | Bajo. Sube de mayor, pero la API es una sola función y el uso es en tiempo de compilación |
| `sharp@<0.35.0` → `^0.35.3`                                     | Vulnerabilidades heredadas de libvips                 | `sharp` 0.34.5, traído por `next`                   | Bajo. Además el proyecto no usa `next/image`, así que sharp no se ejecuta                 |
| `postcss@<8.5.10` → `^8.5.10`                                   | XSS por `</style>` sin escapar                        | La copia 8.4.31 que **`next` trae adentro**         | Bajo: parche dentro del mismo menor                                                       |
| `@babel/core@<=7.29.0` → `^7.29.7`                              | Lectura arbitraria de archivos vía `sourceMappingURL` | Cadena de workbox                                   | Nulo                                                                                      |
| `@babel/plugin-transform-modules-systemjs@<=7.29.3` → `^7.29.8` | Genera código arbitrario                              | Cadena de workbox                                   | Nulo                                                                                      |
| `webpack@<=5.104.0` → `^5.109.2`                                | Evasión de la lista blanca de `buildHttp`             | `webpack` 5.103.0                                   | Bajo                                                                                      |

`postcss` además se subió como dependencia directa de `^8.5.4` a `^8.5.10`:
un override sobre una dependencia directa da `EOVERRIDE`, así que hay que
mover la directa y dejar que el override alcance solo a la copia anidada.

### Verificación

Los overrides pueden romper cosas en silencio: fuerzan una versión que el
paquete que la pide no declaró soportar. Después de aplicarlos se comprobó:

| Comprobación   | Resultado                                             |
| -------------- | ----------------------------------------------------- |
| `tsc --noEmit` | 0 errores                                             |
| `eslint .`     | 0 errores                                             |
| `vitest run`   | 334 / 334                                             |
| `next build`   | Compila, `ƒ Middleware 39.4 kB`                       |
| Service worker | Regenerado, con `NetworkOnly` para las rutas privadas |

El último importa especialmente: casi todos los overrides tocan la cadena de
`next-pwa` (workbox, rollup, terser, babel). Si alguno hubiera roto la
generación del service worker, la PWA habría dejado de funcionar sin dar
error de compilación.

## Clasificación de los avisos originales

| Clase                                                                 | Cuántos                         | Cómo se resolvieron                                                                              |
| --------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Explotables en producción, en el camino de las peticiones             | 0                               | —                                                                                                |
| De la cadena de compilación (workbox, rollup, webpack, babel, terser) | 13                              | `overrides`                                                                                      |
| De herramientas de desarrollo                                         | 3                               | `overrides`                                                                                      |
| Sin corrección disponible                                             | 0                               | —                                                                                                |
| Con corrección solo mediante cambio mayor                             | 3 (`next`, `next-pwa`, `sharp`) | `sharp` con override; los otros dos se resolvieron al parchear la causa real (`postcss` anidado) |

Ninguno de los 19 era explotable por un visitante del sitio: todos estaban en
paquetes que corren durante `npm run build`, no al atender una petición. Eso
no los hace inofensivos —una máquina de compilación comprometida firma código
que después corre en producción— pero sí cambia la urgencia.

## `next-pwa`: la deuda que queda

`next-pwa` **está abandonado**. Última publicación: 5.6.0, marzo de 2022. Es
la raíz de la mayoría de los avisos que hubo que parchear a mano:

```
next-pwa 5.6.0
└─ workbox-webpack-plugin 6.x
   └─ workbox-build 6.x
      ├─ rollup-plugin-terser  →  serialize-javascript (RCE)
      ├─ @babel/*             →  dos avisos
      └─ rollup 2.x           →  path traversal
```

Los overrides tapan los agujeros de hoy. No impiden los de mañana: nadie va a
publicar un `next-pwa` 5.6.1 con las dependencias al día.

### Propuesta de reemplazo (Fase 2 o posterior)

Tres opciones, en orden de preferencia:

**1. `@serwist/next`.** Es el sucesor mantenido de `next-pwa`, escrito por
gente que venía de ahí. Usa workbox 7, soporta App Router y TypeScript de
verdad. La migración es acotada: cambia el envoltorio de `next.config.ts` y el
archivo de configuración del service worker; la política de caché que ya está
escrita en `src/server/pwa/cache-policy.ts` se reutiliza tal cual.

**2. Un service worker propio.** El proyecto necesita poco: cachear el
esqueleto de la aplicación y **no cachear nada privado**. Eso son unas
cincuenta líneas sin dependencias. Es la opción con menos superficie, y la que
más control da sobre lo único que importa acá, que es no guardar datos de la
caja en el disco de la máquina.

**3. Sacar la PWA.** Hoy no aporta gran cosa: no hay modo sin conexión y la
caja se usa desde una máquina fija con conexión. La única ventaja real es el
ícono en la pantalla de inicio. Es la opción más barata si el modo sin
conexión no entra en el plan.

**No se hizo ahora** porque la Fase 1 es de consolidación, no de cambios de
infraestructura, y porque los overrides dejaron `npm audit` limpio: la
urgencia bajó de "hay una cadena con RCE" a "hay una dependencia sin
mantenimiento". Lo segundo se resuelve con calma.

## Dependencias que se eliminaron

De la Fase 0, para que quede el registro completo:

| Paquete               | Motivo                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next-auth`           | Única vulnerabilidad **crítica**. Cero usos en el código                                                                                                 |
| `jsonwebtoken`        | Reemplazado por `jose`, que funciona en Edge                                                                                                             |
| `@types/jsonwebtoken` | Sobra al sacar el anterior                                                                                                                               |
| `@faker-js/faker`     | Solo lo usaba un artefacto compilado obsoleto                                                                                                            |
| `lucide-react`        | Cero usos                                                                                                                                                |
| `react-icons`         | Cero usos                                                                                                                                                |
| `ts-node`             | Cero usos                                                                                                                                                |
| `@types/next-pwa`     | Declaraba `next@13.5.11` como dependencia **real**, arrastrando un Next 13 completo a `node_modules`. Reemplazado por una declaración local de 20 líneas |
| `dotenv`              | Nunca llegó a usarse                                                                                                                                     |

Y dos que estaban en el lugar equivocado: `@prisma/client` y `bcrypt` estaban
en `devDependencies` pero se usan en tiempo de ejecución. Con
`npm ci --omit=dev` la aplicación no arrancaba.

## Cómo mantener esto

```bash
npm audit          # tiene que decir 0
npm outdated       # informativo
```

El paso de CI corre `npm audit` y **falla** ante cualquier vulnerabilidad
crítica o alta. Las moderadas y bajas se informan sin cortar la construcción:
cortar por una vulnerabilidad baja en una herramienta de compilación
entrenaría a todo el mundo a ignorar el paso.

Al agregar un override nuevo:

1. Usar selector con rango, nunca el nombre pelado.
2. Anotarlo en la tabla de arriba con su aviso y su riesgo.
3. Correr build **y** comprobar que el service worker se regeneró.
4. Revisarlos cada tanto: un override deja de hacer falta cuando el paquete
   que lo necesitaba se actualiza, y uno olvidado congela una versión sin
   motivo.
