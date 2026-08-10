# `npm run integrity:check`

Comprueba que el sistema cierre. **Sólo lee.**

```bash
npm run integrity:check
```

`npm run reconcile` es el mismo comando con otro nombre.

## La salida

```
COMPROBACION DE INTEGRIDAD

  Ventas ............... OK      19
  Pagos ................ OK      19
  Venta y caja ......... OK      19
  Anulaciones .......... OK       4
  Turnos de caja ....... OK       3
  Inventario ........... OK      44
  Compras .............. OK       6
  Recepciones .......... OK       5
  Costos ............... OK       4

  Sin inconsistencias.  (369 ms)
```

El número de la derecha es **cuántas filas se miraron**. Un `OK 0` no es lo
mismo que un `OK 482`: el primero puede significar que no hay datos, no que
estén bien.

## Cuando encuentra algo

```
  INCONSISTENCIAS: 1

  ── Inventario ──
     Coca Cola 2,25 L
       regla:     stock = suma del libro
       esperado:  37.250
       encontrado: 37.500
       diferencia: 0.25
       sucursal 1
```

Cada hallazgo dice **qué fila**, **qué regla**, **qué se esperaba**, **qué se
encontró** y **cuánto es la diferencia**. Con eso se puede ir a mirar sin volver
a preguntarle a nadie.

## Códigos de salida

| Código | Qué pasó                                                |
| ------ | ------------------------------------------------------- |
| `0`    | Todo cierra                                             |
| `1`    | Al menos una inconsistencia                             |
| `2`    | La comprobación no pudo terminar (base caída, permisos) |

Sirve para colgarlo de una tarea programada sin leer la salida. Un `1` es una
alerta; un `2` es un problema distinto y por eso tiene su propio código.

## Lo que NO hace, y es deliberado

**No corrige nada.** Ni siquiera lo obvio.

Encontrar un descuadre de 0,250 kg y ajustar `BranchStock` para que cierre es
tentador y es lo peor que se puede hacer: tapa el síntoma, borra la evidencia de
que algo escribió mal, y deja intacto el error de origen. La próxima vez el
descuadre será de 3 kg y ya no habrá rastro del primero.

**No escribe en la bitácora.** Leer no es un evento auditable, y una herramienta
de control que deja rastro en lo que controla es una mala herramienta.

## Por qué es CLI y no una pantalla

Se evaluó agregar `Sistema > Integridad` y se decidió que no, por evidencia:

- Las nueve comprobaciones tardan **~370 ms sobre 44 productos y 19 ventas**, que
  es una base de demostración. Escalan con el volumen: son recorridos completos
  de `Sale`, `SaleItem`, `StockMovement` y `CashRegisterMovement`.
- Una pantalla que ejecuta eso **en cada render** es un recorrido completo de la
  base cada vez que alguien entra por curiosidad, y desde el navegador de un
  celular en el mostrador.
- La alternativa —guardar el último resultado en una tabla y mostrarlo— agrega
  una tabla, un trabajo programado y una fecha de "último control" que se puede
  quedar vieja sin que nadie lo note. Es más superficie para responder una
  pregunta que hoy se hace una vez por semana.

Cuando exista un mecanismo de tareas programadas —que hoy no hay— la pantalla
pasa a tener sentido: mostraría el resultado de la última corrida nocturna, sin
ejecutar nada. Ahí se agrega. Queda anotado como extensión, no como falta.

Mientras tanto, el comando corre en el servidor del local en menos de un segundo
y su código de salida se puede vigilar.

## Cuándo correrlo

- **Antes de cualquier migración destructiva**, sobre una restauración del
  respaldo. Ver [PRODUCTION_MIGRATION_REHEARSAL.md](PRODUCTION_MIGRATION_REHEARSAL.md).
- **Después de aplicarla**, sobre la base real.
- Después de restaurar un respaldo, siempre.
- Cuando algo no cuadra y no se sabe dónde empezar a mirar.

## Qué comprueba exactamente

Las nueve invariantes están en
[PHASE3_RECONCILIATION.md](PHASE3_RECONCILIATION.md), con el porqué de cada una.
