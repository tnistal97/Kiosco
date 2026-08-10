# Zona horaria: el día comercial

## El bug que originó esta política

La Fase 3C encontró esto, y conviene contarlo antes que la solución porque
explica cada decisión que sigue.

El reporte armaba el rango del día así:

```ts
new Date(`${fecha}T00:00:00.000Z`) // ← la Z
```

Eso es medianoche **UTC**. El navegador, en cambio, pedía el día que marcaba
su propio reloj. En Argentina —tres horas al oeste— el "día" del servidor iba
de las **21:00 de ayer a las 20:59 de hoy**.

Consecuencia: **toda venta posterior a las 21:00 desaparecía del día**. De la
pantalla de ventas, del reporte y del "recaudado hoy" del panel. Un almacén que
cierra a las 22 perdía de vista su última hora, y la veía reaparecer al día
siguiente como si hubiera vendido mañana.

Lo encontró la suite de extremo a extremo **por correr pasadas las nueve de la
noche**. Antes se ejecutaba más temprano y pasaba siempre. Las pruebas tampoco
lo detectaban porque usaban la misma convención equivocada para decir "hoy".

La corrección inmediata fue quitar la `Z`, lo que traslada la decisión a la
zona horaria **del proceso**. Correcto en el servidor del local; incorrecto en
cualquier otro. Esta fase la traslada a un dato del negocio, que es donde tiene
que estar.

## La regla, en una línea

> **El navegador manda `YYYY-MM-DD`. El servidor lo convierte con la zona de la
> sucursal.**

No tiene excepciones. Ni el navegador manda instantes UTC —no sabe dónde queda
el local—, ni el servidor usa su propia zona —puede estar en otro país—.

Lo que **no** decide nada, en ningún camino:

- la zona horaria de Windows
- la zona horaria de Linux
- la zona horaria del navegador
- `new Date("YYYY-MM-DDT00:00:00Z")`

## Por qué IANA y no un desfase

`Branch.timeZone` guarda `America/Argentina/Buenos_Aires`, no `UTC-3`.

|                                  | Qué es        | Qué pasa cuando cambia la regla        |
| -------------------------------- | ------------- | -------------------------------------- |
| `America/Argentina/Buenos_Aires` | Una **regla** | Nada: la regla ya contempla el cambio  |
| `UTC-3`                          | Un **número** | Todas las fechas anteriores quedan mal |

Argentina tuvo horario de verano en 2007–2009 y podría volver a tenerlo. Con el
identificador IANA, una consulta sobre diciembre de 2008 usa `UTC-2` porque
así era entonces; con un desfase fijo, usaría `UTC-3` y correría el día entero
una hora. Hay una prueba que lo comprueba exactamente sobre esa fecha.

Guardar el número obliga a acertarle al futuro. Guardar la regla no.

`esZonaValida` rechaza `UTC-3`, `GMT+3` y `-03:00` aunque la plataforma acepte
alguno: el punto es que sea una regla. `UTC` sí se acepta, porque es una zona de
verdad y las pruebas la necesitan.

## El modelo

```
Branch.timeZone   String  @default("America/Argentina/Buenos_Aires")
```

En la sucursal y no en una configuración global: dos locales en provincias
distintas es un caso que este sistema ya contempla en todo lo demás, y ponerlo
global obligaría a migrarlo después. Hay una restricción `CHECK` que impide
guardar la cadena vacía, y el servicio valida contra la base IANA antes de
escribir.

Todo el catálogo existente arranca con Buenos Aires. Es el único valor que
podría ser correcto para los datos que ya están.

## Los helpers

`src/lib/tiempo.ts` convierte dada una zona. No toca la base y lo puede usar el
navegador.

| Función                           | Qué devuelve                    |
| --------------------------------- | ------------------------------- |
| `inicioDelDia(fecha, zona)`       | El instante de las 00:00:00.000 |
| `finDelDia(fecha, zona)`          | El instante de las 23:59:59.999 |
| `rangoDeDias(desde, hasta, zona)` | Los dos, para un `gte`/`lte`    |
| `diaDe(instante, zona)`           | A qué día comercial pertenece   |
| `hoyEn(zona)`                     | Hoy, en el local                |
| `sumarDias(fecha, n)`             | Aritmética de calendario        |
| `cantidadDeDias(desde, hasta)`    | Días contando los dos extremos  |

`src/server/tiempo.ts` sabe de dónde sale la zona: `zonaDeSucursal`,
`hoyEnSucursal`, `rangoDeSucursal`.

### Por qué dos pasadas

Convertir "las 00:00 del 6 de septiembre en Santiago" a un instante requiere
saber el desfase de ese día, y el desfase depende del instante. La primera
pasada estima; la segunda recalcula ya sobre el instante correcto. Sin la
segunda, una fecha del otro lado de un cambio de horario de verano sale corrida
una hora.

### Los dos casos sin respuesta única

**Hora que no existe.** Cuando el reloj salta de 23:59 a 01:00, las 00:00 de
ese día no ocurrieron. `inicioDelDia` devuelve el instante en que el día empezó
de verdad. Argentina no tiene saltos a medianoche; Brasil los tuvo.

**Hora que ocurre dos veces.** Cuando el reloj vuelve atrás, las 00:30 pasan
dos veces. `inicioDelDia` devuelve la **primera**, lo que hace el día más largo
y no deja ninguna venta afuera. Un día de 25 horas es raro; una venta que no
figura en ningún día es un error.

## Dónde se aplica

Todo lo que dice "hoy" o filtra por fecha:

| Camino                             | Antes                               | Ahora                          |
| ---------------------------------- | ----------------------------------- | ------------------------------ |
| Reporte de ventas                  | Zona del proceso                    | Zona de la sucursal            |
| Saldo de caja ("efectivo hoy")     | Zona del proceso                    | Zona de la sucursal            |
| Movimientos de caja (últimos días) | Zona del proceso                    | Zona de la sucursal            |
| Bitácora                           | `T00:00:00Z` armado en el navegador | `YYYY-MM-DD` al servidor       |
| Movimientos de stock               | `T23:59:59.999` local del navegador | `YYYY-MM-DD` al servidor       |
| Panel                              | `new Date()` del navegador          | El día que informa el servidor |
| Reportes                           | —                                   | Zona de la sucursal            |
| Compras y recepciones              | —                                   | Zona de la sucursal            |
| Reconciliación                     | —                                   | Zona de la sucursal            |

El panel merece una nota: **el navegador ya no decide qué día es hoy**. Lo
pregunta. Un dispositivo con la fecha mal puesta —o alguien operando desde otro
huso— veía "las ventas de hoy" de un día que no era el del negocio.

## Los turnos de caja no usan el día comercial

Y es deliberado. Un turno tiene apertura y cierre propios: empieza cuando
alguien cuenta el cajón y termina cuando lo vuelve a contar. Un turno que cruza
la medianoche sigue siendo **un** turno, y partirlo por el día comercial
rompería la única pregunta que responde: "empecé con esto, pasó esto, ¿lo
tengo?".

El día comercial se usa para **listar** turnos por fecha, no para delimitarlos.

## Casos de borde con prueba

- `00:00:00.000` entra en su día
- `20:59` entra en su día
- `21:00` entra en su día — el caso del bug
- `23:59:59.999` entra en su día
- `00:00` del día siguiente **no** entra en el anterior
- un rango de varios días incluye los dos extremos completos
- diciembre de 2008 usa el horario de verano que regía entonces
- el día de un cambio de horario dura 23 o 25 horas y ninguna venta se pierde
- una zona inválida en la base cae a Buenos Aires en vez de romper el reporte
