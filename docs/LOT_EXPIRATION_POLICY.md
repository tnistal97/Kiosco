# Lotes y vencimientos: las dos políticas

## Por qué son dos banderas y no una

La tentación es obvia: un `trackLots: boolean` y listo. El caso que la descarta
es la lavandina.

Una lavandina **necesita número de partida** —si sale defectuosa hay que poder
retirar esa partida y no todas— y **no tiene vencimiento** que valga la pena
controlar. Con una sola bandera, rastrearla obligaría a inventarle una fecha, y
un vencimiento inventado es peor que ninguno: alguien va a mirar el tablero de
vencimientos y va a tirar mercadería buena.

Al revés no hay simetría, y también importa: la fecha **vive en el lote**. Exigir
vencimiento sin rastrear lotes no tiene dónde guardarse. Lo impide un `CHECK`:

```sql
CHECK ("expirationTracking" = 'NONE' OR "lotTracking" <> 'NONE')
```

## Los tres valores, y qué significan de verdad

|            | `lotTracking`                                      | `expirationTracking`              |
| ---------- | -------------------------------------------------- | --------------------------------- |
| `NONE`     | No se le pueden crear lotes.                       | Los lotes no llevan fecha.        |
| `OPTIONAL` | Puede tener lotes y puede tener stock sin asignar. | Un lote puede tener fecha o no.   |
| `REQUIRED` | Todo movimiento lleva lote. Sin asignar es cero.   | Un lote **sin fecha** se rechaza. |

Ejemplos, que son los del pedido:

```
Esponja           lote NONE       vencimiento NONE
Lavandina         lote OPTIONAL   vencimiento NONE
Bebida alcohólica lote OPTIONAL   vencimiento OPTIONAL
Yogur bebible     lote REQUIRED   vencimiento REQUIRED
Queso envasado    lote REQUIRED   vencimiento REQUIRED
```

**Todo el catálogo existente arranca en `NONE` / `NONE`**, y con eso se comporta
exactamente igual que antes de esta fase.

## Activar `REQUIRED` sobre un producto que ya tiene stock

No se puede de un tirón, y no es una restricción arbitraria: dejar 20 unidades
sin explicación convertiría la promesa de `REQUIRED` —_todo lleva lote_— en una
frase que el sistema no cumple desde el primer día.

El flujo es:

```
1. Crear los lotes que correspondan.
2. Atribuirles el stock existente:   Lote A: 8   Lote B: 12
3. Recién cuando  SUM(lotes) == stock actual,  se puede activar REQUIRED.
```

La atribución **no mueve stock** —había 20 y siguen habiendo 20— y por eso no
emite `StockMovement`: emite `LotAssignment`, que es su propio libro. Ver
[LOT_TRACKING_DESIGN.md](LOT_TRACKING_DESIGN.md).

El paso 3 se comprueba **dentro de la transacción** que activa la política, no
en la pantalla: entre que el navegador muestra "ya cierra" y el usuario aprieta
el botón puede haber entrado una venta.

## Bajar de `REQUIRED` a `OPTIONAL` o `NONE`

Se puede, y no borra nada: los lotes siguen existiendo, el stock por lote sigue
ahí y el historial no se toca. Lo único que cambia es que desde ese momento se
aceptan movimientos sin lote.

Queda auditado. Es la operación que hay que poder explicar: alguien decidió
dejar de rastrear un producto que se rastreaba.

## La fecha es una fecha, no un instante

```
expirationDate  DATE      →  2026-09-05
NO              TIMESTAMP →  2026-09-05T00:00:00Z
```

Esta distinción cuesta una línea en el esquema y evita reintroducir el error que
las Fases 3C, 3D y 4A tuvieron que arreglar tres veces.

Un `timestamp` de medianoche UTC, formateado en Buenos Aires (UTC−3), se lee como
**el día anterior**. Un yogur que vence el 5 aparecería vencido el 4, un lote de
30 días entraría en el tramo de 29, y el filtro "vence hoy" mostraría los de
mañana. Con `DATE` no hay conversión posible: no hay hora que convertir.

Del lado del servidor viaja como `FechaLocal` —`YYYY-MM-DD`, el tipo que existe
desde la Fase 3D— y nunca se convierte a `Date` para mostrarla.

## Los días que faltan

```
díasHastaVencer = cantidadDeDias(hoyEnLaSucursal, expirationDate)
```

**`hoyEnLaSucursal`**, no hoy en el servidor y no hoy en el navegador. Es
`Branch.timeZone`, la misma regla que decide qué ventas son "de hoy" desde la
Fase 3D. Un servidor en otro país no puede decidir si el yogur venció.

Hay pruebas con el proceso en `UTC` y en `America/Argentina/Buenos_Aires`, con
lotes que vencen hoy y mañana, que fallan si alguien reintroduce la conversión.

## Los seis estados de un lote

Son texto, no color. El color acompaña; no informa solo.

| Estado      | Cuándo                |
| ----------- | --------------------- |
| `VENCIDO`   | `díasHastaVencer < 0` |
| `VENCE HOY` | `= 0`                 |
| `7 DÍAS`    | `1..7`                |
| `30 DÍAS`   | `8..30`               |
| `OK`        | `> 30`                |
| `SIN FECHA` | el lote no vence      |

`SIN FECHA` **no es `OK`**, y por eso tiene su propia palabra: "OK" afirma que
falta mucho, y de un lote sin fecha no se sabe. Son dos cosas distintas y la
pantalla las dice distinto.

Y `AGOTADO` no está en esta lista porque no es un estado de vencimiento: es
`quantity = 0`. Se filtra aparte.

## Un lote vencido no se vende

Es la regla, y no tiene excepción en esta fase.

- FEFO **lo excluye**. Ver [FEFO_POLICY.md](FEFO_POLICY.md).
- El stock **vendible** de un producto es el que no está vencido, y es lo que la
  caja valida. `BranchStock.quantity` puede decir 10 y el vendible ser 3.
- La pantalla muestra los tres números por separado:

```
Disponible: 10
Vendible:    7
Vencido:     3
```

Mostrar sólo `Disponible` haría que la caja crea que hay stock suficiente y
descubra que no al cobrar.

**No hay override.** Se evaluó y se descartó: un botón para vender vencido es un
botón que se usa cuando hay apuro, y el apuro es exactamente el momento en que no
hay que usarlo. El lote vencido sigue existiendo físicamente hasta que se pierde,
se devuelve o se ajusta —esas son sus tres salidas— pero no es vendible.

## Dónde se ve

- **Inventario → Lotes** — el listado, con sus filtros y su estado textual.
- **Inventario → Lotes → detalle** — la partida, su stock por sucursal y su libro.
- **Ficha del producto** — sus lotes, cuando el producto los tiene.
- **Panel** — vencidos, unidades vencidas, vence en 7, vence en 30.
- **Reportes → Vencimientos** — la misma información valorizada.
